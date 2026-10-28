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
    select: { sendingAccountId: true, variant: true },
    orderBy: { createdAt: "desc" },
  });

  await db.emailEvent.create({
    data: {
      workspaceId: claims.workspaceId,
      campaignId: enrollment.campaignId,
      enrollmentId: claims.enrollmentId,
      sendingAccountId: sent?.sendingAccountId ?? null,
      type: "OPENED",
      idempotencyKey,
      variant: sent?.variant ?? null,
      occurredAt: new Date(),
    },
  });
  return { recorded: true, duplicate: false };
}
