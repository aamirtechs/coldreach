import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ensureSuppression } from "@/lib/suppressions";

/**
 * Unsubscribe tokens and effects.
 *
 * A token is an HMAC of "workspaceId.leadId" under SESSION_SECRET, so a
 * link cannot be forged for another contact and needs no database lookup
 * to verify. Tokens do not expire: an unsubscribe link in an old email
 * must keep working. Applying an unsubscribe is idempotent: the lead is
 * marked UNSUBSCRIBED, a workspace suppression is ensured, and every
 * active or paused enrollment for the lead in that workspace stops.
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

export function createUnsubscribeToken(
  workspaceId: string,
  leadId: string,
  campaignId?: string,
): string {
  const payload = campaignId
    ? `${workspaceId}.${leadId}.${campaignId}`
    : `${workspaceId}.${leadId}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

export interface UnsubscribeClaims {
  workspaceId: string;
  leadId: string;
  /** The campaign whose email carried the link, when known. Used to
   *  attribute the UNSUBSCRIBED event to that campaign's analytics. */
  campaignId?: string;
}

export function verifyUnsubscribeToken(token: string): UnsubscribeClaims | null {
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
  if (segments.length < 2 || !segments[0] || !segments[1]) {
    return null;
  }
  return {
    workspaceId: segments[0],
    leadId: segments[1],
    campaignId: segments[2] || undefined,
  };
}

export interface UnsubscribeResult {
  applied: boolean;
  email: string | null;
  stoppedEnrollments: number;
}

export async function applyUnsubscribe(
  db: PrismaClient,
  claims: UnsubscribeClaims,
): Promise<UnsubscribeResult> {
  const lead = await db.lead.findFirst({
    where: { id: claims.leadId, workspaceId: claims.workspaceId },
    select: { id: true, email: true, status: true },
  });
  if (!lead) {
    return { applied: false, email: null, stoppedEnrollments: 0 };
  }

  if (lead.status !== "UNSUBSCRIBED") {
    await db.lead.update({
      where: { id: lead.id },
      data: { status: "UNSUBSCRIBED" },
    });
  }
  await ensureSuppression(db, claims.workspaceId, lead.email, "Unsubscribed via email link");

  const stopped = await db.enrollment.updateMany({
    where: {
      leadId: lead.id,
      status: { in: ["ACTIVE", "PAUSED"] },
      campaign: { workspaceId: claims.workspaceId },
    },
    data: { status: "UNSUBSCRIBED", nextSendAt: null },
  });

  // One UNSUBSCRIBED event per lead and source campaign, keyed so
  // repeat clicks never double count in analytics. The event is
  // attributed to the campaign whose email carried the link, so that
  // campaign's metrics see the unsubscribe.
  const eventKey = `evt:unsub:${lead.id}:${claims.campaignId ?? "direct"}`;
  const existingEvent = await db.emailEvent.findUnique({
    where: { idempotencyKey: eventKey },
    select: { id: true },
  });
  if (!existingEvent) {
    let enrollmentId: string | null = null;
    if (claims.campaignId) {
      const enrollment = await db.enrollment.findUnique({
        where: { campaignId_leadId: { campaignId: claims.campaignId, leadId: lead.id } },
        select: { id: true },
      });
      enrollmentId = enrollment?.id ?? null;
    }
    await db.emailEvent.create({
      data: {
        workspaceId: claims.workspaceId,
        campaignId: claims.campaignId ?? null,
        enrollmentId,
        type: "UNSUBSCRIBED",
        idempotencyKey: eventKey,
        occurredAt: new Date(),
      },
    });
  }

  return { applied: true, email: lead.email, stoppedEnrollments: stopped.count };
}
