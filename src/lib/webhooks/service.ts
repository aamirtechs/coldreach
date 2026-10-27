import { createHmac, randomBytes } from "node:crypto";
import type { PrismaClient, WebhookDelivery, WebhookEndpoint } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { logger } from "@/lib/log";

/**
 * Outbound webhooks.
 *
 * Workspaces subscribe endpoints to provider event types. When
 * applyProviderEvent records one of those events, a WebhookDelivery
 * row is enqueued per subscribed endpoint; the worker tick POSTs the
 * payload with an HMAC-SHA256 signature over the exact body bytes
 * (header X-ColdReach-Signature) and the event type in
 * X-ColdReach-Event, so receivers can verify authenticity with the
 * endpoint secret. Signing secrets are stored only as AES-256-GCM
 * ciphertext (the crypto helper), and shown once at creation.
 *
 * Retry policy: a failed delivery retries after 1 minute, 5 minutes,
 * 30 minutes, then 2 hours; the fifth failed attempt marks the
 * delivery FAILED permanently. The full history stays in the
 * delivery log; nothing is retried or dropped silently.
 */

export const WEBHOOK_EVENT_TYPES = [
  "DELIVERED",
  "REPLIED",
  "BOUNCED",
  "UNSUBSCRIBED",
  "COMPLAINED",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000];

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/** Delay before the next attempt, given how many attempts have failed. */
export function retryDelayMs(failedAttempts: number): number {
  const index = Math.min(Math.max(failedAttempts, 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[index];
}

/** HMAC-SHA256 over the exact body bytes, hex encoded. */
export function signWebhookPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Endpoint URLs must be https, except plaintext http to localhost
 * for local development receivers (the smoke test uses one).
 */
export function validateEndpointUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error("The endpoint URL is not a valid URL."), { status: 400 });
  }
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol === "https:") {
    return url.toString();
  }
  if (url.protocol === "http:" && isLocalhost) {
    return url.toString();
  }
  throw Object.assign(
    new Error("Endpoint URLs must use https (http is allowed only for localhost during development)."),
    { status: 400 },
  );
}

export async function createWebhookEndpoint(
  db: PrismaClient,
  input: { workspaceId: string; url: string; eventTypes: string[] },
): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
  const url = validateEndpointUrl(input.url);
  const eventTypes = [...new Set(input.eventTypes)];
  if (eventTypes.length === 0 || !eventTypes.every(isWebhookEventType)) {
    throw Object.assign(
      new Error(`eventTypes must be a non-empty subset of: ${WEBHOOK_EVENT_TYPES.join(", ")}`),
      { status: 400 },
    );
  }
  const secret = generateWebhookSecret();
  const endpoint = await db.webhookEndpoint.create({
    data: {
      workspaceId: input.workspaceId,
      url,
      secret: encryptSecret(secret),
      eventTypes,
      active: true,
    },
  });
  return { endpoint, secret };
}

export function endpointEventTypes(endpoint: WebhookEndpoint): string[] {
  return Array.isArray(endpoint.eventTypes) ? endpoint.eventTypes.map(String) : [];
}

/**
 * Enqueues one delivery per active endpoint in the workspace that
 * subscribes to this event type. Called from applyProviderEvent for
 * every recorded (non-duplicate) provider event.
 */
export async function enqueueEventDeliveries(
  db: PrismaClient,
  input: { workspaceId: string; eventType: string; payload: Record<string, unknown>; now?: Date },
): Promise<number> {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { workspaceId: input.workspaceId, active: true },
  });
  const subscribed = endpoints.filter((endpoint) =>
    endpointEventTypes(endpoint).includes(input.eventType),
  );
  if (subscribed.length === 0) {
    return 0;
  }
  const now = input.now ?? new Date();
  await db.webhookDelivery.createMany({
    data: subscribed.map((endpoint) => ({
      endpointId: endpoint.id,
      eventType: input.eventType,
      payload: input.payload as object,
      status: "PENDING" as const,
      nextAttemptAt: now,
    })),
  });
  return subscribed.length;
}

type FetchImpl = typeof fetch;

export interface DeliveryAttemptResult {
  delivered: boolean;
  statusCode: number | null;
  error: string | null;
}

/** Performs one HTTP attempt for a delivery row (no state writes). */
export async function attemptDelivery(
  endpoint: WebhookEndpoint,
  delivery: WebhookDelivery,
  fetchImpl: FetchImpl = fetch,
): Promise<DeliveryAttemptResult> {
  const secret = decryptSecret(endpoint.secret);
  const body = JSON.stringify(delivery.payload);
  try {
    const response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ColdReach-Event": delivery.eventType,
        "X-ColdReach-Signature": signWebhookPayload(secret, body),
        "X-ColdReach-Delivery": delivery.id,
      },
      body,
    });
    if (response.status >= 200 && response.status < 300) {
      return { delivered: true, statusCode: response.status, error: null };
    }
    return { delivered: false, statusCode: response.status, error: `Receiver answered HTTP ${response.status}` };
  } catch (error) {
    return {
      delivered: false,
      statusCode: null,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

/** Attempts one delivery and records the outcome on the row. */
export async function processDelivery(
  db: PrismaClient,
  delivery: WebhookDelivery & { endpoint: WebhookEndpoint },
  fetchImpl: FetchImpl = fetch,
  now: Date = new Date(),
): Promise<WebhookDelivery> {
  const result = await attemptDelivery(delivery.endpoint, delivery, fetchImpl);
  const attempts = delivery.attempts + 1;
  if (result.delivered) {
    return db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "DELIVERED", attempts, lastStatusCode: result.statusCode, lastError: null, nextAttemptAt: null },
    });
  }
  const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS;
  return db.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      attempts,
      lastStatusCode: result.statusCode,
      lastError: result.error,
      nextAttemptAt: exhausted ? null : new Date(now.getTime() + retryDelayMs(attempts)),
    },
  });
}

export interface ProcessDueSummary {
  attempted: number;
  delivered: number;
  failed: number;
  /** Failed this pass but still scheduled for another retry. */
  retrying: number;
}

/** Processes every due PENDING delivery. Runs inside the worker tick. */
export async function processDueDeliveries(
  db: PrismaClient,
  options: { now?: Date; fetchImpl?: FetchImpl; limit?: number } = {},
): Promise<ProcessDueSummary> {
  const now = options.now ?? new Date();
  const due = await db.webhookDelivery.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      endpoint: { active: true },
    },
    include: { endpoint: true },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 50,
  });
  const summary: ProcessDueSummary = { attempted: 0, delivered: 0, failed: 0, retrying: 0 };
  for (const delivery of due) {
    summary.attempted += 1;
    try {
      const updated = await processDelivery(db, delivery, options.fetchImpl, now);
      if (updated.status === "DELIVERED") {
        summary.delivered += 1;
      } else if (updated.status === "FAILED") {
        summary.failed += 1;
      } else {
        summary.retrying += 1;
      }
    } catch (error) {
      // A broken endpoint (for example an undecryptable secret after a
      // key rotation) must not stall the rest of the queue. Count it
      // as a failed attempt so it follows the same retry path.
      logger.error("Webhook delivery attempt failed", {
        error,
        deliveryId: delivery.id,
        endpointId: delivery.endpointId,
      });
      summary.retrying += 1;
      const attempts = delivery.attempts + 1;
      const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS;
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          attempts,
          lastError: error instanceof Error ? error.message : "Delivery failed",
          nextAttemptAt: exhausted ? null : new Date(now.getTime() + retryDelayMs(attempts)),
        },
      });
    }
  }
  return summary;
}

/**
 * Sends a test payload through the exact production path: a delivery
 * row is created and immediately attempted, so the delivery log shows
 * the test and its outcome like any real event.
 */
export async function sendTestDelivery(
  db: PrismaClient,
  endpoint: WebhookEndpoint,
  fetchImpl: FetchImpl = fetch,
): Promise<WebhookDelivery> {
  const delivery = await db.webhookDelivery.create({
    data: {
      endpointId: endpoint.id,
      eventType: "test",
      payload: {
        event: "test",
        message: "This is a ColdReach webhook test delivery. If you can verify the signature, your endpoint is wired correctly.",
        endpointId: endpoint.id,
        sentAt: new Date().toISOString(),
      },
      status: "PENDING",
      nextAttemptAt: new Date(),
    },
  });
  return processDelivery(db, { ...delivery, endpoint }, fetchImpl);
}
