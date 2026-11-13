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
 *
 * Cross-campaign rule (v1.27.0, replacing the v1.11.0 block-all
 * guard): a lead whose email already sits in ANY other campaign of
 * the workspace, whether as the same lead row or as a duplicate row
 * in another list, is SKIPPED and counted in skippedCrossCampaign,
 * with the conflicts attached to the result; the rest of the list
 * enrolls normally. force still enrolls them anyway, for callers
 * that deliberately want double outreach.
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
  /** Leads skipped because their email is already enrolled in
   *  another campaign of this workspace (v1.27.0). */
  skippedCrossCampaign: number;
  /** One entry per cross-campaign skip, for operator reporting. */
  conflicts: EnrollConflict[];
  totalInList: number;
}

/**
 * One cross-campaign conflict: a lead this enroll call skipped
 * (v1.27.0; the v1.11.0 guard blocked the whole enroll instead)
 * because it is already enrolled in another campaign of the same
 * workspace, so enrolling would put the same contact into two live
 * outreach sequences at once.
 */
export interface EnrollConflict {
  leadId: string;
  email: string;
  campaignName: string;
  status: string;
  /** True when the other enrollment has already been sent at least
   *  one step, so the contact has genuinely been pitched before. */
  contacted: boolean;
}

const INELIGIBLE_STATUSES = new Set(["UNSUBSCRIBED", "BOUNCED", "SUPPRESSED", "INVALID"]);

export async function enrollCampaign(
  db: PrismaClient,
  args: { workspaceId: string; campaignId: string; now?: Date; force?: boolean },
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

  // Cross-campaign duplicate rule (v1.27.0): skip any eligible
  // lead whose email already sits in another campaign of this
  // workspace, and enroll the rest. Matching is by email as well
  // as by lead row, because the same contact can exist as two lead
  // rows in two lists. force enrolls them anyway.
  const conflicts: EnrollConflict[] = [];
  let skippedCrossCampaign = 0;
  if (eligible.length > 0) {
    const eligibleEmails = [...new Set(eligible.map((entry) => {
      const lead = leads.find((candidate) => candidate.id === entry.leadId);
      return (lead?.email ?? "").toLowerCase();
    }).filter(Boolean))];
    const sameEmailLeads = eligibleEmails.length
      ? await db.lead.findMany({
          where: { workspaceId: args.workspaceId, email: { in: eligibleEmails } },
          select: { id: true, email: true },
        })
      : [];
    const emailByLeadId = new Map(sameEmailLeads.map((lead) => [lead.id, lead.email.toLowerCase()]));
    const candidateLeadIds = [...new Set([...eligible.map((entry) => entry.leadId), ...sameEmailLeads.map((lead) => lead.id)])];
    const otherEnrollments = await db.enrollment.findMany({
      where: {
        leadId: { in: candidateLeadIds },
        campaign: { workspaceId: args.workspaceId, id: { not: campaign.id } },
      },
      select: {
        leadId: true,
        status: true,
        currentStep: true,
        campaign: { select: { name: true } },
      },
    });
    if (otherEnrollments.length > 0) {
      const conflictByEmail = new Map<string, EnrollConflict>();
      const leadEmailById = new Map(leads.map((lead) => [lead.id, lead.email.toLowerCase()]));
      for (const entry of otherEnrollments) {
        const email = emailByLeadId.get(entry.leadId) ?? leadEmailById.get(entry.leadId) ?? "";
        if (!email || conflictByEmail.has(email)) continue;
        conflictByEmail.set(email, {
          leadId: entry.leadId,
          email,
          campaignName: entry.campaign.name,
          status: entry.status,
          contacted: entry.currentStep >= 1,
        });
      }
      if (!args.force && conflictByEmail.size > 0) {
        const kept: typeof eligible = [];
        for (const entry of eligible) {
          const lead = leads.find((candidate) => candidate.id === entry.leadId);
          const email = (lead?.email ?? "").toLowerCase();
          const conflict = conflictByEmail.get(email);
          if (conflict) {
            skippedCrossCampaign += 1;
            conflicts.push({ ...conflict, leadId: entry.leadId, email: lead?.email ?? email });
          } else {
            kept.push(entry);
          }
        }
        eligible.length = 0;
        eligible.push(...kept);
      }
    }
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
    skippedCrossCampaign,
    conflicts,
    totalInList: leads.length,
  };
}
