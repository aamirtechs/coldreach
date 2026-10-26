import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createWebhookEndpoint,
  enqueueEventDeliveries,
  processDueDeliveries,
  retryDelayMs,
  signWebhookPayload,
  validateEndpointUrl,
} from "./service";
import { decryptSecret } from "@/lib/security/crypto";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

const DB_NAME = "test-webhooks";
let db: PrismaClient;
let workspaceId: string;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= Buffer.from(new Uint8Array(32).fill(9)).toString("base64");
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "webhooks");
  workspaceId = seeded.workspace.id;
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("signWebhookPayload", () => {
  it("matches a manually computed HMAC-SHA256", () => {
    const secret = "whsec_test_secret";
    const body = JSON.stringify({ event: "REPLIED", leadEmail: "a@example.com" });
    const manual = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(signWebhookPayload(secret, body)).toBe(manual);
  });
});

describe("retryDelayMs", () => {
  it("follows the 1m, 5m, 30m, 2h backoff schedule", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(300_000);
    expect(retryDelayMs(3)).toBe(1_800_000);
    expect(retryDelayMs(4)).toBe(7_200_000);
  });
});

describe("validateEndpointUrl", () => {
  it("accepts https and localhost http, rejects other http", () => {
    expect(validateEndpointUrl("https://example.com/hook")).toContain("https://example.com");
    expect(validateEndpointUrl("http://localhost:3999/hook")).toContain("localhost");
    expect(validateEndpointUrl("http://127.0.0.1:3999/hook")).toContain("127.0.0.1");
    expect(() => validateEndpointUrl("http://example.com/hook")).toThrow(/https/);
    expect(() => validateEndpointUrl("not a url")).toThrow(/valid URL/);
  });
});

describe("webhook delivery flow", () => {
  it("stores the secret encrypted and delivers signed payloads to subscribers only", async () => {
    const { endpoint, secret } = await createWebhookEndpoint(db, {
      workspaceId,
      url: "http://localhost:3999/hook",
      eventTypes: ["REPLIED"],
    });
    // The stored value is ciphertext; the plaintext appears nowhere.
    expect(endpoint.secret).not.toBe(secret);
    expect(decryptSecret(endpoint.secret)).toBe(secret);

    // A BOUNCED event has no subscribers on this endpoint.
    const bouncedCount = await enqueueEventDeliveries(db, {
      workspaceId,
      eventType: "BOUNCED",
      payload: { event: "BOUNCED" },
    });
    expect(bouncedCount).toBe(0);

    const payload = { event: "REPLIED", leadEmail: "lead@example.com" };
    const enqueued = await enqueueEventDeliveries(db, {
      workspaceId,
      eventType: "REPLIED",
      payload,
    });
    expect(enqueued).toBe(1);

    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const stubFetch = (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      seen.push({ url, headers: init?.headers ?? {}, body: init?.body ?? "" });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const summary = await processDueDeliveries(db, { fetchImpl: stubFetch });
    expect(summary).toMatchObject({ attempted: 1, delivered: 1, failed: 0 });

    expect(seen).toHaveLength(1);
    expect(seen[0].headers["X-ColdReach-Event"]).toBe("REPLIED");
    const expectedSignature = createHmac("sha256", secret).update(seen[0].body, "utf8").digest("hex");
    expect(seen[0].headers["X-ColdReach-Signature"]).toBe(expectedSignature);
    expect(JSON.parse(seen[0].body)).toEqual(payload);

    const delivery = await db.webhookDelivery.findFirst({ where: { endpointId: endpoint.id } });
    expect(delivery?.status).toBe("DELIVERED");
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.lastStatusCode).toBe(200);
  });

  it("schedules a retry with backoff when the receiver fails", async () => {
    const { endpoint } = await createWebhookEndpoint(db, {
      workspaceId,
      url: "http://localhost:3999/failing",
      eventTypes: ["BOUNCED"],
    });
    await enqueueEventDeliveries(db, {
      workspaceId,
      eventType: "BOUNCED",
      payload: { event: "BOUNCED" },
    });
    const failingFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const now = new Date();
    const summary = await processDueDeliveries(db, { fetchImpl: failingFetch, now });
    expect(summary.attempted).toBe(1);
    expect(summary.retrying).toBe(1);
    const delivery = await db.webhookDelivery.findFirst({ where: { endpointId: endpoint.id } });
    expect(delivery?.status).toBe("PENDING");
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.lastStatusCode).toBe(500);
    expect(delivery?.nextAttemptAt?.getTime()).toBe(now.getTime() + 60_000);
  });
});
