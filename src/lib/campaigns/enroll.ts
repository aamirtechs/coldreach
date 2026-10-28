import type { PrismaClient } from "@prisma/client";
import { computeNextSendAt } from "@/lib/domain/scheduling";
import { resolveLeadTimezone } from "@/lib/domain/leadTimezone";
import type { LeadFields } from "@/lib/domain/personalize";
import { findSuppression } from "@/lib/domain/suppression";
import { loadSuppressions } from "@/lib/suppressions";

/**
 * Campaign enrollment.
 *
 * Reads the campaign's attached lead list and creates one Enrollment per
 * eligible lead. A lead is eligible when it is not suppressed (workspace
 * or global), its status is not one of the terminal contact states
 * (UNSUBSCRIBED, BOUNCED, SUPPRESSED, INVALID), its stored verification
 * status (Phase 6) is not INVALID, and it is not already
 * enrolled, which the unique (campaignId, leadId) constraint also
 * guarantees at the database level. Leads verified RISKY do enroll;
 * they are counted in enrolledRisky so the operator sees the
 * deliverability risk they accepted.
 */

export interface EnrollResult {
  enrolled: number;
  skippedSuppressed: number;
  skippedDuplicate: number;
  skippedIneligible: number;
  /** Leads skipped because verification marked them INVALID. */
  skippedInvalidVerification: number;
  /** Enrolled leads whose verification status is RISKY. */
  enrolledRisky: number;
  totalInList: number;
}

const INELIGIBLE_STATUSES = new Set(["UNSUBSCRIBED", "BOUNCED", "SUPPRESSED", "INVALID"]);

export async function enrollCampaign(
  db: PrismaClient,
  args: { workspaceId: string; campaignId: string; now?: Date },
): Promise<EnrollResult> {
  const now = args.now ?? new Date();
  const campaign = await db.campaign.findFirst({
    where: { id: args.campaignId, workspaceId: args.workspaceId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!campaign) {
    throw Object.assign(new Error("Campaign not found"), { status: 404 });
  }
  if (!campaign.leadListId) {
    throw Object.assign(new Error("Attach a lead list to the campaign before enrolling"), {
      status: 400,
    });
  }

  const leads = await db.lead.findMany({
    where: { workspaceId: args.workspaceId, listId: campaign.leadListId },
    select: { id: true, email: true, status: true, verificationStatus: true, fields: true },
  });
  const suppressions = await loadSuppressions(db, args.workspaceId);
  const existingEnrollments = await db.enrollment.findMany({
    where: { campaignId: campaign.id },
    select: { leadId: true },
  });
  const enrolledLeadIds = new Set(existingEnrollments.map((e) => e.leadId));

  let skippedSuppressed = 0;
  let skippedDuplicate = 0;
  let skippedIneligible = 0;
  let skippedInvalidVerification = 0;
  let enrolledRisky = 0;
  const eligible: { leadId: string; fields: LeadFields }[] = [];

  for (const lead of leads) {
    if (enrolledLeadIds.has(lead.id)) {
      skippedDuplicate += 1;
      continue;
    }
    if (lead.verificationStatus === "INVALID") {
      skippedInvalidVerification += 1;
      continue;
    }
    if (INELIGIBLE_STATUSES.has(lead.status)) {
      skippedIneligible += 1;
      continue;
    }
    if (findSuppression(lead.email, suppressions)) {
      skippedSuppressed += 1;
      continue;
    }
    if (lead.verificationStatus === "RISKY") {
      enrolledRisky += 1;
    }
    eligible.push({ leadId: lead.id, fields: (lead.fields ?? {}) as LeadFields });
  }

  const firstStep = campaign.steps[0];
  const firstDelayHours = firstStep ? firstStep.delayDays * 24 + firstStep.delayHours : 0;

  if (eligible.length > 0) {
    await db.enrollment.createMany({
      // Per-lead timezone (v1.5.0): each lead's first send is stamped
      // in its own timezone when one resolves from its fields, so the
      // campaign window opens on the lead's local morning. Leads with
      // no resolvable zone keep the campaign timezone, unchanged.
      data: eligible.map((entry) => ({
        campaignId: campaign.id,
        leadId: entry.leadId,
        currentStep: 0,
        status: "ACTIVE" as const,
        nextSendAt: firstStep
          ? computeNextSendAt(now, {
              timezone: resolveLeadTimezone(entry.fields) ?? campaign.timezone,
              windowStart: campaign.windowStart,
              windowEnd: campaign.windowEnd,
              businessDaysOnly: campaign.businessDaysOnly,
              delayHours: firstDelayHours,
            })
          : null,
      })),
    });
  }

  return {
    enrolled: eligible.length,
    skippedSuppressed,
    skippedDuplicate,
    skippedIneligible,
    skippedInvalidVerification,
    enrolledRisky,
    totalInList: leads.length,
  };
}
