import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Open tracking (v1.9.0).
 *
 * Campaign emails carry a 1x1 image whose URL holds a signed token
 * naming the workspace, enrollment and step. When a mail client
 * loads the image, the /o/[token] endpoint verifies the token and
 * records one OPENED event per enrollment and step, keyed exactly
 * like provider events (evt:<enrollmentId>:<stepIndex>:OPENED), so
 * repeat loads, proxy refetches and privacy prefetch storms never
 * inflate the count beyond one recorded open. The token is an HMAC
 * under SESSION_SECRET with an "open" payload prefix, so it cannot
 * be forged for another enrollment and can never collide with an
 * unsubscribe token.
 *
 * Open numbers stay approximate by nature: some clients prefetch
 * images (inventing opens) and others block them (hiding opens).
 * The analytics page carries that caveat; this module only makes
 * the signal exist at all.
 */

/**
 * Open tracking went live with v1.9.0 at this moment. Sends before
 * it carried no pixel, so no open could ever be recorded for them.
 * The open-gated follow-ups rule (v1.17.0) exempts those legacy
 * sends: a lead is only held back for not opening when opening was
 * actually trackable.
 */
export const OPEN_TRACKING_SINCE = new Date("2026-10-28T16:23:00.000Z");

/**
 * Machine-open filter (v1.20.0, at Amir's instruction).
 *
 * Privacy prefetch (Apple Mail Privacy Protection) and corporate
 * security scanners load the tracking pixel within seconds of
 * delivery, long before a human could read the email. An open
 * recorded within this window of its step's send is classified
 * "MACHINE" on the OPENED event: it stays visible in the Outbox as
 * an automatic open, but it no longer counts in open rates and no
 * longer satisfies the open-gated follow-ups rule, so machines stop
 * deciding who gets follow-ups and stop inflating the numbers.
 * Opens with no known send time are treated as human: machine is a
 * claim that needs the timing evidence.
 */
export const MACHINE_OPEN_WINDOW_MS = 60_000;

export function isMachineOpen(sentAt: Date, openedAt: Date): boolean {
  const gap = openedAt.getTime() - sentAt.getTime();
  return gap >= 0 && gap <= MACHINE_OPEN_WINDOW_MS;
}

function hmacSecret(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short");
  }
  return Buffer.from(secret, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", hmacSecret()).update(payload).digest("base64url");
}

export function createOpenToken(workspaceId: string, enrollmentId: string, stepIndex: number): string {
  const payload = `open.${workspaceId}.${enrollmentId}.${stepIndex}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

export interface OpenClaims {
  workspaceId: string;
  enrollmentId: string;
  stepIndex: number;
}

export function verifyOpenToken(token: string): OpenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  let payload: string;
  try {
    payload = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = Buffer.from(sign(payload), "utf8");
  const provided = Buffer.from(parts[1], "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }
  const segments = payload.split(".");
  if (segments.length !== 4 || segments[0] !== "open" || !segments[1] || !segments[2]) {
    return null;
  }
  const stepIndex = Number(segments[3]);
  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    return null;
  }
  return { workspaceId: segments[1], enrollmentId: segments[2], stepIndex };
}

/**
 * Backfill for opens recorded before v1.20.0 (v1.20.1).
 *
 * Historical OPENED events carry no classification, so the filter
 * cannot see them. This pass takes the oldest unclassified opens,
 * pairs each with its step's send (parsed from the event's
 * idempotency key, falling back to the enrollment's most recent
 * send, exactly like recordOpen), and stamps the verdict on the
 * event: MACHINE inside the window, HUMAN outside it. Stamping
 * HUMAN as well is what lets the pool drain: an event is scanned
 * once, never again. Events whose send cannot be found stay
 * unclassified and are retried on later passes; they keep counting
 * as human everywhere, the same evidence rule as recordOpen.
 * Returns how many events were stamped MACHINE.
 */
export async function backfillMachineOpens(db: PrismaClient, limit = 200): Promise<number> {
  const events = await db.emailEvent.findMany({
    where: { type: "OPENED", classification: null },
    select: { id: true, enrollmentId: true, idempotencyKey: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
    take: limit,
  });
  let machine = 0;
  for (const event of events) {
    if (!event.enrollmentId) {
      continue;
    }
    const stepMatch = /:(\d+):OPENED$/.exec(event.idempotencyKey);
    let sentAt: Date | null = null;
    if (stepMatch) {
      const stepSent = await db.emailEvent.findUnique({
        where: { idempotencyKey: `send:${event.enrollmentId}:${Number(stepMatch[1])}` },
        select: { occurredAt: true },
      });
      sentAt = stepSent?.occurredAt ?? null;
    }
    if (!sentAt) {
      const latest = await db.emailEvent.findFirst({
        where: { enrollmentId: event.enrollmentId, type: "SENT" },
        select: { occurredAt: true },
        orderBy: { createdAt: "desc" },
      });
      sentAt = latest?.occurredAt ?? null;
    }
    if (!sentAt) {
      continue;
    }
    const verdict = isMachineOpen(sentAt, event.occurredAt) ? "MACHINE" : "HUMAN";
    await db.emailEvent.update({
      where: { id: event.id },
      data: { classification: verdict },
    });
    if (verdict === "MACHINE") {
      machine += 1;
    }
  }
  return machine;
}

export interface RecordOpenResult {
  recorded: boolean;
  duplicate: boolean;
}

/**
 * Records the first OPENED event for an enrollment and step.
 * Attribution (campaign, sending account, A/B variant) is copied
 * from the enrollment's most recent SENT event, the same fallback
 * applyProviderEvent uses for direct enrollment references.
 */
export async function recordOpen(db: PrismaClient, claims: OpenClaims): Promise<RecordOpenResult> {
  const enrollment = await db.enrollment.findUnique({
    where: { id: claims.enrollmentId },
    include: { campaign: { select: { id: true, workspaceId: true } } },
  });
  if (!enrollment || enrollment.campaign.workspaceId !== claims.workspaceId) {
    return { recorded: false, duplicate: false };
  }

  const idempotencyKey = `evt:${claims.enrollmentId}:${claims.stepIndex}:OPENED`;
  const existing = await db.emailEvent.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (existing) {
    return { recorded: false, duplicate: true };
  }

  const sent = await db.emailEvent.findFirst({
    where: { enrollmentId: claims.enrollmentId, type: "SENT" },
    select: { sendingAccountId: true, variant: true, occurredAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Machine-open classification: compare against this step's own
  // send when it can be found (the worker keys it send:<id>:<step>),
  // falling back to the most recent send used for attribution.
  const stepSent = await db.emailEvent.findUnique({
    where: { idempotencyKey: `send:${claims.enrollmentId}:${claims.stepIndex}` },
    select: { occurredAt: true },
  });
  const openedAt = new Date();
  const sentAt = stepSent?.occurredAt ?? sent?.occurredAt ?? null;
  const classification = sentAt && isMachineOpen(sentAt, openedAt) ? "MACHINE" : null;

  await db.emailEvent.create({
    data: {
      workspaceId: claims.workspaceId,
      campaignId: enrollment.campaignId,
      enrollmentId: claims.enrollmentId,
      sendingAccountId: sent?.sendingAccountId ?? null,
      type: "OPENED",
      idempotencyKey,
      classification,
      variant: sent?.variant ?? null,
      occurredAt: openedAt,
    },
  });
  return { recorded: true, duplicate: false };
}
