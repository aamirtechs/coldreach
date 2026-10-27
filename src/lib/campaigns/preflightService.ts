import type { PrismaClient } from "@prisma/client";
import { runPreflight, type PreflightResult } from "@/lib/domain/preflight";
import { effectiveDailyLimit } from "@/lib/domain/limits";
import { warmupCapFor } from "@/lib/domain/warmup";
import { findSuppression } from "@/lib/domain/suppression";
import { loadSuppressions } from "@/lib/suppressions";
import { countMonthlySends, getPlanForWorkspace } from "@/lib/billing/subscription";

/**
 * Assembles preflight inputs from the database and runs the pure
 * preflight engine. Used by the preflight panel (read only) and by the
 * launch action (which refuses when the result contains a FAIL).
 */
export async function getCampaignPreflight(
  db: PrismaClient,
  args: { workspaceId: string; campaignId: string },
): Promise<PreflightResult> {
  const campaign = await db.campaign.findFirst({
    where: { id: args.campaignId, workspaceId: args.workspaceId },
    include: {
      steps: { orderBy: { order: "asc" } },
      accounts: { include: { sendingAccount: true } },
      workspace: true,
    },
  });
  if (!campaign) {
    throw Object.assign(new Error("Campaign not found"), { status: 404 });
  }

  const enrollments = await db.enrollment.findMany({
    where: { campaignId: campaign.id, status: "ACTIVE" },
    include: { lead: { select: { email: true, fields: true } } },
  });

  const suppressions = await loadSuppressions(db, args.workspaceId);
  let suppressedEnrolledCount = 0;
  const availableFields = new Set<string>(["email"]);
  for (const enrollment of enrollments) {
    if (findSuppression(enrollment.lead.email, suppressions)) {
      suppressedEnrolledCount += 1;
    }
    const fields = enrollment.lead.fields;
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
      for (const key of Object.keys(fields)) {
        availableFields.add(key);
      }
    }
  }

  const now = Date.now();
  const accounts = campaign.accounts.map(({ sendingAccount }) => ({
    id: sendingAccount.id,
    email: sendingAccount.email,
    status: sendingAccount.status,
    effectiveDailyLimit: effectiveDailyLimit({
      dailyLimit: sendingAccount.dailyLimit,
      ageInDays: Math.max(
        0,
        Math.floor((now - sendingAccount.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      ),
    }),
  }));

  // Warm-up ceilings (Phase 6): only accounts with warm-up enabled
  // and an active ceiling today participate in the check.
  const today = new Date(now);
  const warmupCaps = campaign.accounts
    .map(({ sendingAccount }) => ({
      email: sendingAccount.email,
      cap: warmupCapFor(sendingAccount, today),
    }))
    .filter((entry): entry is { email: string; cap: number } => entry.cap !== null);

  // Plan quota (Phase 4): the campaign's projection is every ACTIVE
  // enrollment receiving every step, on top of this month's real
  // SENT count under the workspace's plan.
  const [plan, sentThisMonth] = await Promise.all([
    getPlanForWorkspace(db, args.workspaceId),
    countMonthlySends(db, args.workspaceId),
  ]);

  return runPreflight({
    steps: campaign.steps.map((step) => ({ subject: step.subject, body: step.body })),
    enrolledCount: enrollments.length,
    suppressedEnrolledCount,
    accounts,
    availableFields: [...availableFields],
    unsubscribeConfigured: Boolean(campaign.workspace.senderAddress),
    senderIdentity: {
      displayName: campaign.workspace.senderName,
      postalAddress: campaign.workspace.senderAddress,
    },
    projectedDailyVolume: enrollments.length,
    warmupCaps,
    quota: {
      planName: plan.name,
      monthlyLimit: plan.monthlySends,
      sentThisMonth,
      projectedTotalSends: enrollments.length * campaign.steps.length,
    },
  });
}
