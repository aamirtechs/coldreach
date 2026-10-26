import type { PrismaClient } from "@prisma/client";
import { ensureSuppression } from "@/lib/suppressions";

/**
 * Provider event application.
 *
 * This is the seam real provider webhooks will use in Phase 3, and the
 * local event ingestion endpoint uses today. An inbound event either
 * resolves its enrollment directly (enrollmentId plus stepIndex) or
 * through the SENT event recorded for a provider message id. Every event
 * gets a deterministic idempotency key, so a provider that retries or
 * redelivers can never apply the same outcome twice.
 *
 * Reply, bounce, unsubscribe, and complaint events stop the sequence:
 * the enrollment leaves ACTIVE and its nextSendAt is cleared, so the
 * worker can never send a follow-up after one of these outcomes.
 */

export type InboundEventType = "DELIVERED" | "BOUNCED" | "REPLIED" | "UNSUBSCRIBED" | "COMPLAINED";

export interface InboundEvent {
  providerMessageId?: string;
  enrollmentId?: string;
  stepIndex?: number;
  type: InboundEventType;
  classification?: string;
  occurredAt?: Date;
}

export interface ApplyEventResult {
  applied: boolean;
  duplicate: boolean;
  enrollmentId: string | null;
}

export async function applyProviderEvent(
  db: PrismaClient,
  event: InboundEvent,
): Promise<ApplyEventResult> {
  let enrollmentId: string | null = event.enrollmentId ?? null;
  let sendingAccountId: string | null = null;

  if (!enrollmentId && event.providerMessageId) {
    const sent = await db.emailEvent.findFirst({
      where: { providerMessageId: event.providerMessageId, type: "SENT" },
      select: { enrollmentId: true, sendingAccountId: true },
      orderBy: { createdAt: "asc" },
    });
    if (sent) {
      enrollmentId = sent.enrollmentId;
      sendingAccountId = sent.sendingAccountId;
    }
  }
  if (!enrollmentId) {
    throw Object.assign(
      new Error("Event could not be resolved to an enrollment. Provide enrollmentId or a known providerMessageId."),
      { status: 404 },
    );
  }

  const idempotencyKey =
    event.stepIndex !== undefined
      ? `evt:${enrollmentId}:${event.stepIndex}:${event.type}`
      : `evt:pmid:${event.providerMessageId}:${event.type}`;

  const existing = await db.emailEvent.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (existing) {
    return { applied: false, duplicate: true, enrollmentId };
  }

  const enrollment = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      campaign: { select: { id: true, workspaceId: true } },
      lead: { select: { id: true, email: true } },
    },
  });
  if (!enrollment) {
    throw Object.assign(new Error("Enrollment not found"), { status: 404 });
  }
  const workspaceId = enrollment.campaign.workspaceId;

  await db.emailEvent.create({
    data: {
      workspaceId,
      campaignId: enrollment.campaignId,
      enrollmentId: enrollment.id,
      sendingAccountId,
      type: event.type,
      providerMessageId: event.providerMessageId ?? null,
      idempotencyKey,
      classification: event.classification ?? null,
      occurredAt: event.occurredAt ?? new Date(),
    },
  });

  switch (event.type) {
    case "REPLIED":
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "REPLIED", nextSendAt: null },
      });
      break;
    case "BOUNCED":
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "BOUNCED", nextSendAt: null },
      });
      await db.lead.update({ where: { id: enrollment.lead.id }, data: { status: "BOUNCED" } });
      await ensureSuppression(db, workspaceId, enrollment.lead.email, "Hard bounce reported by provider");
      break;
    case "UNSUBSCRIBED":
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "UNSUBSCRIBED", nextSendAt: null },
      });
      await db.lead.update({ where: { id: enrollment.lead.id }, data: { status: "UNSUBSCRIBED" } });
      await ensureSuppression(db, workspaceId, enrollment.lead.email, "Unsubscribed (provider event)");
      break;
    case "COMPLAINED":
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "SUPPRESSED", nextSendAt: null },
      });
      await db.lead.update({ where: { id: enrollment.lead.id }, data: { status: "SUPPRESSED" } });
      await ensureSuppression(db, workspaceId, enrollment.lead.email, "Spam complaint reported by provider");
      break;
    case "DELIVERED":
      break;
  }

  return { applied: true, duplicate: false, enrollmentId };
}
