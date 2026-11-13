import type { Prisma, PrismaClient, SendingAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeNextSendAt } from "@/lib/domain/scheduling";
import { resolveLeadTimezone } from "@/lib/domain/leadTimezone";
import { findSuppression, type SuppressionEntry } from "@/lib/domain/suppression";
import { renderTemplate, type LeadFields } from "@/lib/domain/personalize";
import { renderEmailCopy } from "@/lib/campaigns/previewEmail";
import { effectiveDailyLimit } from "@/lib/domain/limits";
import { hourlyBudget, hourlySendCap, resolveHourlyCap, tickSendCeiling } from "@/lib/domain/pacing";
import { effectiveDailyLimit as warmupDailyLimit } from "@/lib/domain/warmup";
import {
  resolveProvider as defaultResolveProvider,
  type MailProvider,
  type SendAttachment,
} from "@/lib/providers";
import { loadSuppressions } from "@/lib/suppressions";
import { syncAllConnectedAccounts, type AccountSyncSummary } from "@/lib/sync/syncService";
import { canSend, type Plan } from "@/lib/domain/plans";
import { countMonthlySends, getPlanForWorkspace } from "@/lib/billing/subscription";
import { processDueDeliveries, type ProcessDueSummary } from "@/lib/webhooks/service";
import { logger, newRequestId } from "@/lib/log";
import { createUnsubscribeToken } from "./unsubscribe";
import { backfillMachineOpens, createOpenToken, OPEN_TRACKING_SINCE } from "./openTracking";
import { resolveTrackingBase, rewriteLinksForTracking } from "./clickTracking";
import { renderSpintax } from "@/lib/domain/spintax";
import { computeAccountHealthForAccounts, type AccountHealth } from "@/lib/accountHealth";

/**
 * One sending worker tick.
 *
 * Finds enrollments that are due (ACTIVE, nextSendAt in the past,
 * campaign RUNNING) and sends the current step for each, in due order.
 * Every send is preceded by a fresh suppression check, a terminal lead
 * status check, and an account capacity check under the limits engine.
 * The sending account is the campaign's least-used account today.
 * Each send is
 * idempotent: the event key send:{enrollmentId}:{stepIndex} is claimed
 * by the SENT event itself, so a re-run tick can never send a step
 * twice; it detects the recorded event and only advances state.
 *
 * Provider failures never crash the tick. They are recorded as a FAILED
 * event plus lastError on the enrollment, which stays due for a later
 * retry, bounded by the provider or the operator pausing the campaign.
 */

export interface SendTickDeps {
  db?: PrismaClient;
  resolveProvider?: (
    account: SendingAccount,
    db: PrismaClient,
  ) => MailProvider | Promise<MailProvider>;
  now?: Date;
  appUrl?: string;
  batchLimit?: number;
  /** Pacing overrides (v1.11.4); default to the env-derived caps in
   *  domain/pacing. Tests pass explicit values to exercise the gates
   *  without depending on the production numbers. */
  hourlyCap?: number;
  tickSendCeiling?: number;
  /** Set false in tests that exercise sending in isolation. The tick
   *  syncs replies for connected OAuth accounts before sending, so a
   *  reply that just landed stops its follow-up in the same run. */
  skipSync?: boolean;
}

export interface SendTickSummary {
  processed: number;
  sent: number;
  simulated: number;
  completed: number;
  skippedSuppressed: number;
  deferredNoCapacity: number;
  /** Sends deferred because the enrollment's stamped time falls
   *  outside the sending window under the campaign's current
   *  schedule (checked in the lead's own timezone when one
   *  resolves); the enrollment is re-stamped to the next window
   *  opening (per-lead timezone sending, v1.5.0; revalidation
   *  generalised to every enrollment in v1.21.0). */
  deferredOutsideWindow: number;
  /** Sends deferred because the sending domain reached its
   *  rolling 60 minute send cap (v1.11.4 pacing; counted per
   *  sending domain across workspaces since v1.21.0). */
  deferredHourlyCap: number;
  /** Sends deferred because this tick reached its per-tick send
   *  ceiling (v1.11.4 pacing). */
  deferredTickPacing: number;
  failed: number;
  /** Sends refused because the workspace hit its plan's monthly quota. */
  quotaBlocked: number;
  /** Follow-ups (step 2 and later) not sent because the lead never
   *  opened the previous step; the enrollment is completed instead
   *  (open-gated follow-ups, v1.17.0, at Amir's instruction). */
  skippedNotOpened: number;
  /** Enrollments parked for 24 hours because their schedule could
   *  not be computed at all (a broken window, an unrecognised
   *  timezone); the failure is kept on the enrollment instead of
   *  escaping and killing the whole tick (v1.23.1). */
  quarantined: number;
  /** Reply sync pass that runs before sends (empty when skipped). */
  sync: AccountSyncSummary[];
  /** Outbound webhook delivery pass that runs after sends. */
  webhooks: ProcessDueSummary;
}

const TERMINAL_LEAD_STATUSES = new Set(["UNSUBSCRIBED", "BOUNCED", "SUPPRESSED", "INVALID"]);

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Round-robin a due pool across campaigns (v1.8.1). The pool arrives
 * in due order; grouping by campaign and taking one enrollment from
 * each campaign in turn means a single tick's batch is shared fairly
 * instead of the oldest-stamped campaign consuming the whole batch
 * while the others wait for later ticks.
 */
export function interleaveByCampaign<T extends { campaignId: string }>(
  items: T[],
  limit: number,
): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.campaignId);
    if (group) {
      group.push(item);
    } else {
      groups.set(item.campaignId, [item]);
    }
  }
  const queues = [...groups.values()];
  const pointers = queues.map(() => 0);
  const result: T[] = [];
  while (result.length < limit) {
    let advanced = false;
    for (let q = 0; q < queues.length && result.length < limit; q += 1) {
      const item = queues[q][pointers[q]];
      if (item !== undefined) {
        result.push(item);
        pointers[q] += 1;
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return result;
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

export async function runSendTick(deps: SendTickDeps = {}): Promise<SendTickSummary> {
  const db = deps.db ?? prisma;
  const resolve = deps.resolveProvider ?? defaultResolveProvider;
  const now = deps.now ?? new Date();
  const requestId = newRequestId();

  // Machine-open backfill (v1.20.1): opens recorded before the
  // filter existed carry no classification. Each tick stamps a
  // bounded batch with its verdict (MACHINE or HUMAN) before the
  // gate below reads them, so history converges within a few ticks
  // and the scan then finds nothing left. Best effort by design: a
  // failed hygiene pass must never block sending.
  try {
    await backfillMachineOpens(db);
  } catch (error) {
    logger.error("Machine-open backfill failed before send tick", { error, requestId });
  }

  let syncSummaries: AccountSyncSummary[] = [];
  if (!deps.skipSync) {
    // Reply sync first: a reply sitting in a mailbox must stop its
    // follow-up before this tick considers sending it. Sync failures
    // are recorded per account inside the sync service and never block
    // the send pass.
    try {
      syncSummaries = await syncAllConnectedAccounts(db);
    } catch (error) {
      logger.error("Reply sync pass failed before send tick", { error, requestId });
    }
  }
  const appUrl = (deps.appUrl ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const summary: SendTickSummary = {
    processed: 0,
    sent: 0,
    simulated: 0,
    completed: 0,
    skippedSuppressed: 0,
    deferredNoCapacity: 0,
    deferredOutsideWindow: 0,
    deferredHourlyCap: 0,
    deferredTickPacing: 0,
    failed: 0,
    quotaBlocked: 0,
    skippedNotOpened: 0,
    quarantined: 0,
    sync: syncSummaries,
    webhooks: { attempted: 0, delivered: 0, failed: 0, retrying: 0 },
  };

  // Fetch the due pool PER CAMPAIGN, then interleave it across
  // campaigns (v1.8.1) so the batch is shared fairly.
  //
  // The fetch used to be one global oldest-first window (the
  // batchLimit * 5 oldest due enrollments across the whole
  // platform). That window starved campaigns silently (v1.23.0):
  // on 2026-11-12 one workspace accumulated a backlog of about
  // 1,235 due enrollments stamped over two midday hours, and 1,199
  // due enrollments platform-wide carried older stamps than another
  // workspace's earliest due item. That workspace's 197 due
  // enrollments never entered the fetched window at all, so its
  // campaigns recorded no sends, no failures, and no deferrals for
  // hours while the backlogged tenant kept sending. Fetching each
  // campaign's own earliest slice guarantees every running campaign
  // with due work is represented in the pool; the interleave then
  // shares the batch across campaigns as designed.
  const batchLimit = deps.batchLimit ?? 200;
  const perCampaignPool = Math.max(50, batchLimit);
  // Null stamps are due too (v1.21.0): enrollments created before
  // their campaign had any sequence steps were stamped null by
  // enrollCampaign, and a lte filter can never match null, so those
  // enrollments were stranded permanently. The schedule gate below
  // stamps them on first sight.
  const dueWhere: Prisma.EnrollmentWhereInput = {
    status: "ACTIVE",
    OR: [{ nextSendAt: { lte: now } }, { nextSendAt: null }],
    campaign: { status: "RUNNING" },
  };
  const dueGroups = await db.enrollment.groupBy({
    by: ["campaignId"],
    where: dueWhere,
  });
  const fetchDueForCampaign = (campaignId: string) =>
    db.enrollment.findMany({
      where: { ...dueWhere, campaignId },
      include: {
        lead: true,
        campaign: {
          include: {
            steps: {
              orderBy: { order: "asc" },
              include: { variants: { orderBy: { createdAt: "asc" } } },
            },
            accounts: { include: { sendingAccount: true }, orderBy: { createdAt: "asc" } },
            workspace: true,
          },
        },
      },
      orderBy: { nextSendAt: "asc" },
      take: perCampaignPool,
    });
  const duePool: Awaited<ReturnType<typeof fetchDueForCampaign>> = [];
  for (const group of dueGroups) {
    duePool.push(...(await fetchDueForCampaign(group.campaignId)));
  }
  const due = interleaveByCampaign(duePool, batchLimit);

  const suppressionCache = new Map<string, SuppressionEntry[]>();
  const sentTodayCache = new Map<string, number>();
  const providerCache = new Map<string, MailProvider>();
  // Per-step attachment bytes (v1.19.0), loaded at most once per
  // campaign and step per tick, however many emails share the step.
  const attachmentCache = new Map<string, SendAttachment[]>();
  const dayStart = startOfUtcDay(now);

  // Account health gate state (v1.11.0): health is computed once per
  // account per tick, and the auto-pause audit note is written at
  // most once per account per UTC day (checked against the audit
  // log itself, so the rule also holds across ticks).
  const healthCache = new Map<string, AccountHealth>();
  const healthNoted = new Set<string>();
  const healthForAccounts = async (accounts: SendingAccount[]): Promise<Map<string, AccountHealth>> => {
    const missing = accounts.filter((account) => !healthCache.has(account.id));
    if (missing.length > 0) {
      try {
        const computed = await computeAccountHealthForAccounts(db, missing, now);
        for (const [id, health] of computed) {
          healthCache.set(id, health);
        }
      } catch (error) {
        // Health is a guardrail, not a dependency: if it cannot be
        // computed, sending continues exactly as before this gate
        // existed rather than stalling live campaigns.
        logger.error("Account health computation failed in send tick", { error, requestId });
      }
    }
    return healthCache;
  };
  const noteHealthPause = async (
    account: SendingAccount,
    workspaceId: string,
    reasons: string[],
  ): Promise<void> => {
    if (healthNoted.has(account.id)) {
      return;
    }
    healthNoted.add(account.id);
    try {
      const auditLog = db.auditLog;
      if (!auditLog?.findMany || !auditLog?.create) {
        return;
      }
      const todays = await auditLog.findMany({
        where: { workspaceId, action: "account.auto_paused_health", createdAt: { gte: dayStart } },
        select: { metadata: true },
      });
      const already = todays.some(
        (row) => (row.metadata as { accountId?: string } | null)?.accountId === account.id,
      );
      if (already) {
        return;
      }
      await auditLog.create({
        data: {
          workspaceId,
          userId: null,
          action: "account.auto_paused_health",
          metadata: {
            accountId: account.id,
            email: account.email,
            reasons,
            date: dayStart.toISOString().slice(0, 10),
          },
        },
      });
    } catch (error) {
      logger.error("Failed to write account health audit entry", { error, requestId });
    }
  };

  // Plan quota state per workspace (Phase 4): the plan plus this
  // month's real SENT count, loaded once per workspace per tick and
  // incremented locally on every successful send.
  const quotaCache = new Map<string, { plan: Plan; sentThisMonth: number }>();
  const quotaFor = async (wsId: string): Promise<{ plan: Plan; sentThisMonth: number }> => {
    const cached = quotaCache.get(wsId);
    if (cached) {
      return cached;
    }
    const [plan, sentThisMonth] = await Promise.all([
      getPlanForWorkspace(db, wsId),
      countMonthlySends(db, wsId, now),
    ]);
    const entry = { plan, sentThisMonth };
    quotaCache.set(wsId, entry);
    return entry;
  };

  const sentTodayFor = async (account: SendingAccount): Promise<number> => {
    const cached = sentTodayCache.get(account.id);
    if (cached !== undefined) {
      return cached;
    }
    const count = await db.emailEvent.count({
      where: { sendingAccountId: account.id, type: "SENT", occurredAt: { gte: dayStart } },
    });
    sentTodayCache.set(account.id, count);
    return count;
  };

  // Send pacing (v1.11.4): the sending domain's host enforces a hard
  // per-domain hourly relay limit, and a tick that finds a large due
  // pool at a window opening can submit it all inside a minute. The
  // host defers the excess, delivery lags, and the deferral notices
  // pollute the sending inboxes. Two budgets keep submission smooth:
  // a per-tick ceiling per workspace and a rolling 60 minute cap.
  // Only real sends consume them; simulated sends never reach SMTP.
  //
  // Two scope corrections (v1.21.0, from a customer report):
  // - The tick ceiling is counted PER WORKSPACE. It was one global
  //   counter for the whole tick, so on a shared platform the first
  //   workspaces processed consumed the entire ceiling (20 sends
  //   per tick across every tenant) and later campaigns in the
  //   batch were deferred tick after tick.
  // - The rolling hour is counted PER SENDING DOMAIN, across every
  //   workspace that sends from it. The host limit is per domain,
  //   so two workspaces on one domain could each stay under a
  //   per-workspace cap while their combined volume breached the
  //   host's, and the excess was discarded by the server after
  //   being accepted (and recorded SENT here). Simulated sends are
  //   excluded from the count: their provider message ids start
  //   with "demo-" and they never reach an SMTP server.
  const platformHourlyCap = hourlySendCap();
  // An explicit deps.hourlyCap (tests, one-off operations) forces
  // one cap for every workspace and wins over both the platform
  // default and any workspace setting (v1.24.0).
  const forcedHourlyCap = deps.hourlyCap;
  const tickCeiling = deps.tickSendCeiling ?? tickSendCeiling();
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);
  const realSendsByWorkspace = new Map<string, number>();
  const hourlyByDomain = new Map<string, number>();
  const domainOf = (email: string): string => email.split("@")[1]?.toLowerCase() ?? "";
  const sentLastHourForDomain = async (domain: string): Promise<number> => {
    const cached = hourlyByDomain.get(domain);
    if (cached !== undefined) {
      return cached;
    }
    const count = await db.emailEvent.count({
      where: {
        type: "SENT",
        occurredAt: { gte: hourStart },
        sendingAccount: { email: { endsWith: `@${domain}` } },
        OR: [
          { providerMessageId: null },
          { providerMessageId: { not: { startsWith: "demo-" } } },
        ],
      },
    });
    hourlyByDomain.set(domain, count);
    return count;
  };

  for (const enrollment of due) {
    summary.processed += 1;
    const { campaign, lead } = enrollment;
    const workspaceId = campaign.workspaceId;

    let suppressions = suppressionCache.get(workspaceId);
    if (!suppressions) {
      suppressions = await loadSuppressions(db, workspaceId);
      suppressionCache.set(workspaceId, suppressions);
    }

    // Gate 1: suppression and terminal lead state. Close the enrollment
    // rather than skipping silently, so it never becomes due again.
    if (TERMINAL_LEAD_STATUSES.has(lead.status) || findSuppression(lead.email, suppressions)) {
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "SUPPRESSED", nextSendAt: null },
      });
      summary.skippedSuppressed += 1;
      continue;
    }

    const step = campaign.steps[enrollment.currentStep];
    if (!step) {
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "COMPLETED", nextSendAt: null },
      });
      summary.completed += 1;
      continue;
    }

    // Gate: open-gated follow-ups (v1.17.0, at Amir's instruction).
    // Step 2 and later send only to leads who opened the previous
    // step. The open is the recorded OPENED event for the previous
    // step index (one per enrollment and step, recorded by the
    // tracking pixel). A due follow-up with no such open completes
    // the enrollment instead of sending: the sequence ends for that
    // lead, with the reason kept on the enrollment. One exemption:
    // a previous step sent before open tracking existed (v1.9.0,
    // 2026-10-28 16:23 UTC) carried no pixel, so no open could ever
    // be recorded for it; those legacy follow-ups still send.
    // Opens are an approximate signal (privacy prefetch invents
    // them, image blocking hides real ones); that caveat is Amir's
    // accepted trade-off for this rule and is stated in the UI copy
    // on the campaign page.
    if (enrollment.currentStep >= 1) {
      const previousStepIndex = enrollment.currentStep - 1;
      const opened = await db.emailEvent.findUnique({
        where: { idempotencyKey: `evt:${enrollment.id}:${previousStepIndex}:OPENED` },
        select: { id: true, classification: true },
      });
      // Machine opens (v1.20.0) do not satisfy the gate: an open
      // the tracker classified MACHINE was a mail app or scanner
      // loading the pixel within a minute of the send, not the
      // lead reading the email.
      const humanOpened = opened !== null && opened.classification !== "MACHINE";
      // Crash recovery exemption: when this step's send is already
      // recorded (a previous tick sent it but crashed before
      // advancing), there is nothing left to gate; the already-sent
      // path below advances the enrollment as before.
      const currentAlreadySent = await db.emailEvent.findUnique({
        where: { idempotencyKey: `send:${enrollment.id}:${enrollment.currentStep}` },
        select: { id: true },
      });
      if (!humanOpened && !currentAlreadySent) {
        const previousSent = await db.emailEvent.findUnique({
          where: { idempotencyKey: `send:${enrollment.id}:${previousStepIndex}` },
          select: { occurredAt: true },
        });
        const legacySend =
          previousSent !== null && previousSent.occurredAt.getTime() < OPEN_TRACKING_SINCE.getTime();
        if (!legacySend) {
          await db.enrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "COMPLETED",
              nextSendAt: null,
              lastError:
                opened !== null
                  ? "Follow-up not sent: the previous email shows only an automatic open (a mail app or security scanner loaded it within a minute of sending), which does not count as the lead opening it. Steps 2 and later go only to leads who opened the previous step."
                  : "Follow-up not sent: the lead did not open the previous email. Steps 2 and later go only to leads who opened the previous step.",
            },
          });
          summary.skippedNotOpened += 1;
          continue;
        }
      }
    }

    // Gate: send pacing, per-tick ceiling (v1.11.4, counted per
    // workspace since v1.21.0). Deferred enrollments stay due and
    // are picked up by later ticks as budget frees; nothing is
    // re-stamped or error-marked, so pacing is invisible to the
    // lead. The rolling hourly budget is enforced per sending
    // domain during account selection below, where the account
    // that would send (and therefore its domain) is known.
    if ((realSendsByWorkspace.get(workspaceId) ?? 0) >= tickCeiling) {
      summary.deferredTickPacing += 1;
      continue;
    }

    // Gate: schedule revalidation (v1.21.0, generalising the
    // per-lead window gate of v1.5.0). The stamp on the enrollment
    // was computed under the campaign settings in force when it was
    // stamped; settings edited afterwards never re-stamped it, and
    // before this version the stamp was only re-checked when the
    // lead's own timezone differed from the campaign's. A stamp
    // made before business-days-only was switched on (or under a
    // wider window) therefore still fired on a Saturday or late at
    // night. Now every stamp is validated against the campaign's
    // CURRENT window and business-days rule, in the effective
    // timezone (the lead's, when one resolves, else the
    // campaign's): a stamp that is no longer a valid send moment
    // is re-stamped to the next valid opening and deferred. A
    // stamp that IS valid always sends when a tick finds it due,
    // even if the tick itself runs late, so a sparse tick cadence
    // still degrades to late delivery rather than starving a lead
    // (the v1.5.0 rule, unchanged).
    //
    // The same gate recovers null stamps: enrollments created
    // before their campaign had any steps carry nextSendAt null
    // and could never become due. They are stamped now, under the
    // current schedule; when the next opening is in the future
    // they defer like any out-of-window enrollment, otherwise
    // they proceed to send in this same pass.
    const leadTimezone = resolveLeadTimezone(lead.fields as LeadFields);
    const effectiveTimezone = leadTimezone ?? campaign.timezone;
    try {
      if (enrollment.nextSendAt === null) {
        const slot = computeNextSendAt(now, {
          timezone: effectiveTimezone,
          windowStart: campaign.windowStart,
          windowEnd: campaign.windowEnd,
          businessDaysOnly: campaign.businessDaysOnly,
          delayHours: 0,
        });
        if (slot.getTime() > now.getTime()) {
          await db.enrollment.update({
            where: { id: enrollment.id },
            data: { nextSendAt: slot },
          });
          summary.deferredOutsideWindow += 1;
          continue;
        }
        enrollment.nextSendAt = slot;
      } else {
        const slot = computeNextSendAt(enrollment.nextSendAt, {
          timezone: effectiveTimezone,
          windowStart: campaign.windowStart,
          windowEnd: campaign.windowEnd,
          businessDaysOnly: campaign.businessDaysOnly,
          delayHours: 0,
        });
        if (slot.getTime() > enrollment.nextSendAt.getTime()) {
          await db.enrollment.update({
            where: { id: enrollment.id },
            data: { nextSendAt: slot },
          });
          summary.deferredOutsideWindow += 1;
          continue;
        }
      }
    } catch (error) {
      // Quarantine (v1.23.1): a schedule that cannot be computed
      // for one enrollment must never escape and kill the tick for
      // every other campaign on the platform, which is how a
      // single tenant's overnight window (05:00 to 00:00, read as
      // closing before it opened) stopped all sending on
      // 2026-11-12. Park this enrollment for 24 hours with the
      // reason recorded on it, count it, and move on.
      logger.error("Schedule check failed for enrollment; quarantined for 24 hours", {
        error,
        requestId,
        enrollmentId: enrollment.id,
        campaignId: campaign.id,
      });
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: {
          nextSendAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          lastError: `Schedule check failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
      summary.quarantined += 1;
      continue;
    }

    // Gate 2: capacity, honouring each account's effective daily
    // limit. Among the campaign's accounts with capacity left, pick
    // the one that has sent least today (v1.8.2), so sends balance
    // across accounts instead of every campaign walking the same
    // list from the top and draining the first accounts while the
    // last ones idle. sentTodayFor reads the real counts and this
    // tick's own sends, so the balance holds across campaigns and
    // across ticks. Ties keep the campaign's configured order.
    const accounts = campaign.accounts.map((entry) => entry.sendingAccount);
    // Per-workspace hourly cap (v1.24.0): a workspace can set its
    // own ceiling in Settings, matched to its mail host's hourly
    // limit; it replaces the platform default for this workspace's
    // sends. The count it is measured against stays per sending
    // domain across workspaces (v1.21.0), so this only changes
    // the ceiling, never the counting.
    const effectiveHourlyCap =
      forcedHourlyCap ?? resolveHourlyCap(campaign.workspace.hourlySendCap, platformHourlyCap);
    const healthById = await healthForAccounts(accounts);
    let chosen: SendingAccount | null = null;
    let chosenSentToday = Number.POSITIVE_INFINITY;
    // Set when a candidate with daily capacity left was skipped
    // only because its sending domain is at the rolling hourly
    // cap (v1.21.0); decides which deferral counter a no-choice
    // outcome is reported under.
    let domainBlockedEligible = false;
    // Diagnostic detail (v1.11.6): when no account is chosen, record
    // why each candidate was rejected, so a capacity stall can be
    // diagnosed from the tick logs instead of guessed at.
    const capacityDetail: Array<{
      email: string;
      status: string;
      bounceCritical: boolean | null;
      limit: number;
      sentToday: number;
    }> = [];
    for (const candidate of accounts) {
      if (candidate.status === "PAUSED" || candidate.status === "ERROR") {
        capacityDetail.push({
          email: candidate.email,
          status: candidate.status,
          bounceCritical: null,
          limit: -1,
          sentToday: -1,
        });
        continue;
      }
      // Health gate (v1.11.0): an account whose recent bounce rate
      // is critical is excluded from selection, exactly as if it had
      // no capacity. The account's stored status is never mutated;
      // it becomes eligible again on its own when the 7 day window
      // recovers. The exclusion is audit logged once per day.
      const health = healthById.get(candidate.id);
      if (health?.bounceCritical) {
        void noteHealthPause(candidate, workspaceId, health.reasons);
        capacityDetail.push({
          email: candidate.email,
          status: candidate.status,
          bounceCritical: true,
          limit: -1,
          sentToday: -1,
        });
        continue;
      }
      // The existing age ramp from limits.ts, additionally capped by
      // the Phase 6 warm-up schedule when the account has warm-up
      // enabled. Taking the minimum extends the enforcement rather
      // than forking it: warm-up off, the warm-up function returns
      // the configured dailyLimit, which the ramp never exceeds, so
      // behaviour is unchanged for accounts without warm-up.
      const limit = Math.min(
        effectiveDailyLimit({
          dailyLimit: candidate.dailyLimit,
          ageInDays: Math.max(
            0,
            Math.floor((now.getTime() - candidate.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
          ),
        }),
        warmupDailyLimit(candidate, now),
      );
      const sentToday = await sentTodayFor(candidate);
      capacityDetail.push({
        email: candidate.email,
        status: candidate.status,
        bounceCritical: false,
        limit,
        sentToday,
      });
      if (sentToday >= limit) {
        continue;
      }
      // Domain pacing (v1.21.0): the candidate has daily capacity,
      // but its sending domain may already be at the rolling
      // hourly cap, counted across every workspace sending from
      // that domain. A capped candidate is skipped like a full
      // one, so an account on a quieter domain can still send.
      if (hourlyBudget(await sentLastHourForDomain(domainOf(candidate.email)), effectiveHourlyCap) <= 0) {
        domainBlockedEligible = true;
        continue;
      }
      if (sentToday < chosenSentToday) {
        chosen = candidate;
        chosenSentToday = sentToday;
      }
    }
    if (!chosen) {
      if (domainBlockedEligible) {
        // At least one account could have sent today; only the
        // domain's hourly budget stopped it. Reported as an hourly
        // deferral, not a capacity one, so the two stalls stay
        // distinguishable in the tick logs.
        summary.deferredHourlyCap += 1;
        continue;
      }
      summary.deferredNoCapacity += 1;
      // Cap the detail lines so one stalled tick cannot flood the
      // logs; the first few carry the full picture.
      if (summary.deferredNoCapacity <= 3) {
        logger.warn("Send tick deferred: no account capacity", {
          requestId,
          campaignId: campaign.id,
          workspaceId,
          capacityDetail,
        });
      }
      continue;
    }

    const stepIndex = enrollment.currentStep;
    const sendKey = `send:${enrollment.id}:${stepIndex}`;
    const alreadySent = await db.emailEvent.findUnique({
      where: { idempotencyKey: sendKey },
      select: { id: true },
    });

    const advance = async () => {
      const nextStep = campaign.steps[stepIndex + 1];
      if (!nextStep) {
        await db.enrollment.update({
          where: { id: enrollment.id },
          data: { status: "COMPLETED", currentStep: stepIndex + 1, nextSendAt: null, lastError: null },
        });
        summary.completed += 1;
        return;
      }
      const nextSendAt = computeNextSendAt(now, {
        timezone: resolveLeadTimezone(lead.fields as LeadFields) ?? campaign.timezone,
        windowStart: campaign.windowStart,
        windowEnd: campaign.windowEnd,
        businessDaysOnly: campaign.businessDaysOnly,
        delayHours: nextStep.delayDays * 24 + nextStep.delayHours,
      });
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { currentStep: stepIndex + 1, nextSendAt, lastError: null },
      });
    };

    if (alreadySent) {
      // A previous tick recorded the send but did not finish advancing
      // (crash between the two writes). Advance only; never resend.
      await advance();
      continue;
    }

    // Gate 3: plan quota (Phase 4). A workspace at its monthly send
    // limit does not send, and the reason is recorded on the
    // enrollment rather than skipped silently. The enrollment stays
    // due, so raising the plan or the month rolling over resumes it.
    const quota = await quotaFor(workspaceId);
    if (!canSend(quota.plan, quota.sentThisMonth)) {
      summary.quotaBlocked += 1;
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: {
          lastError: `Monthly send quota reached: the ${quota.plan.name} plan allows ${quota.plan.monthlySends} sends per month and this workspace has sent ${quota.sentThisMonth}. Upgrade in Billing or wait for next month.`,
        },
      });
      continue;
    }

    // Copy rendering lives in renderEmailCopy (v1.16.0), shared
    // with the dashboard's Upcoming sends preview, so the previewed
    // email and the sent email are produced by the same code.
    const unsubscribeUrl = `${appUrl}/u/${createUnsubscribeToken(workspaceId, lead.id, campaign.id)}`;
    const renderedCopy = renderEmailCopy({
      enrollmentId: enrollment.id,
      stepIndex,
      step,
      leadEmail: lead.email,
      leadFields:
        lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
          ? (lead.fields as LeadFields)
          : {},
      campaign,
      workspace: campaign.workspace,
      unsubscribeUrl,
    });
    const variantLabel = renderedCopy.variantLabel;
    const variant = renderedCopy.variant;
    const renderFields = renderedCopy.renderFields;
    const spintaxSeed = renderedCopy.spintaxSeed;
    const subject = renderedCopy.subject;
    const bodyText = renderedCopy.bodyText;
    const effectiveSignature = renderedCopy.effectiveSignature;
    const footerSenderLines = renderedCopy.footerSenderLines;
    const fullText = renderedCopy.fullText;
    const footerHtmlParts = [
      ...footerSenderLines,
      ...(campaign.workspace.senderAddress ? [campaign.workspace.senderAddress] : []),
      `<a href="${unsubscribeUrl}">Unsubscribe</a>`,
    ];
    const footerHtml = `<hr /><p style="font-size:12px;color:#666">${footerHtmlParts.join("<br />")}</p>`;
    const signatureHtml = effectiveSignature ? `\n${textToHtml(effectiveSignature)}` : "";
    const renderedHtml = variant?.bodyHtml
      ? renderSpintax(renderTemplate(variant.bodyHtml, renderFields), spintaxSeed)
      : textToHtml(bodyText);
    const fullHtml = `${renderedHtml}${signatureHtml}\n${footerHtml}`;
    // Tracking base (v1.11.0): the workspace's custom tracking
    // domain when one is saved, otherwise the app URL. Opens and
    // clicks share it, so both kinds of tracking URL live on the
    // same host.
    const trackingBase = resolveTrackingBase(campaign.workspace, appUrl);
    // Click tracking (v1.11.0): anchor hrefs in the body are
    // rewritten to signed redirect URLs. The unsubscribe link, the
    // pixel, mailto links, and URLs already on the tracking host
    // are never touched, and the plain text part is unchanged.
    const linkedHtml = rewriteLinksForTracking(fullHtml, {
      trackingBase,
      workspaceId,
      enrollmentId: enrollment.id,
      stepIndex,
      unsubscribeUrl,
    });
    // Open tracking (v1.9.0): a 1x1 pixel whose signed URL records
    // one OPENED event per enrollment and step when a mail client
    // loads it. HTML part only; the text part is untouched.
    const openPixel = `<img src="${trackingBase}/o/${createOpenToken(workspaceId, enrollment.id, stepIndex)}" width="1" height="1" alt="" style="display:none;border:0;" />`;
    const trackedHtml = `${linkedHtml}\n${openPixel}`;

    let provider = providerCache.get(chosen.id);
    if (!provider) {
      try {
        provider = await resolve(chosen, db);
      } catch (error) {
        summary.failed += 1;
        await db.enrollment.update({
          where: { id: enrollment.id },
          data: { lastError: error instanceof Error ? error.message : "Provider resolution failed" },
        });
        continue;
      }
      providerCache.set(chosen.id, provider);
    }

    // Per-step attachments (v1.19.0): the step's files ride on every
    // send of that step, for every variant, exactly as uploaded.
    const attachmentKey = `${campaign.id}:${stepIndex}`;
    let stepAttachments = attachmentCache.get(attachmentKey);
    if (!stepAttachments) {
      const rows = await db.stepAttachment.findMany({
        where: { campaignId: campaign.id, stepOrder: stepIndex },
        orderBy: { createdAt: "asc" },
      });
      stepAttachments = rows.map((row) => ({
        filename: row.filename,
        contentType: row.contentType,
        content: Buffer.from(row.data),
      }));
      attachmentCache.set(attachmentKey, stepAttachments);
    }

    try {
      const result = await provider.send({
        fromEmail: chosen.email,
        // Per-campaign identity (v1.12.0): the campaign's own sender
        // name, when set, is the From display name for its sends,
        // overriding the sending account's display name.
        fromName: campaign.senderName?.trim() ? campaign.senderName.trim() : chosen.displayName,
        toEmail: lead.email,
        subject,
        text: fullText,
        html: trackedHtml,
        attachments: stepAttachments.length > 0 ? stepAttachments : undefined,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          // RFC 8058 one-click unsubscribe, required by the Gmail and
          // Yahoo bulk sender rules alongside List-Unsubscribe.
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      await db.emailEvent.create({
        data: {
          workspaceId,
          campaignId: campaign.id,
          enrollmentId: enrollment.id,
          sendingAccountId: chosen.id,
          type: "SENT",
          providerMessageId: result.providerMessageId,
          idempotencyKey: sendKey,
          variant: variantLabel,
          occurredAt: now,
        },
      });
      // Record the send in the lead's conversation thread (v1.8.1).
      // The Outbox and the inbox thread history read outbound
      // ThreadMessages; before this, campaign sends wrote only the
      // SENT event, so real sends never appeared in the Outbox. The
      // thread is matched the same way reply sync matches it
      // (workspace + lead + sending account), so a later reply lands
      // in the same conversation. A failure here must not fail the
      // send, which already happened and is evented above.
      try {
        let thread = await db.thread.findFirst({
          where: { workspaceId, leadId: lead.id, sendingAccountId: chosen.id },
          orderBy: { lastMessageAt: "desc" },
        });
        if (!thread) {
          thread = await db.thread.create({
            data: {
              workspaceId,
              leadId: lead.id,
              campaignId: campaign.id,
              sendingAccountId: chosen.id,
              subject,
              status: "OPEN",
              unread: false,
              lastMessageAt: now,
            },
          });
        } else {
          await db.thread.update({
            where: { id: thread.id },
            data: { lastMessageAt: now },
          });
        }
        await db.threadMessage.create({
          data: {
            threadId: thread.id,
            direction: "OUTBOUND",
            fromEmail: chosen.email,
            toEmail: lead.email,
            subject,
            body: fullText,
            providerMessageId: result.providerMessageId,
            occurredAt: now,
          },
        });
      } catch (error) {
        logger.error("Outbound thread recording failed after send", { error, requestId });
      }
      sentTodayCache.set(chosen.id, (sentTodayCache.get(chosen.id) ?? 0) + 1);
      quota.sentThisMonth += 1;
      summary.sent += 1;
      if (provider.isSimulation) {
        summary.simulated += 1;
      } else {
        // Real sends consume the pacing budgets (v1.11.4): the
        // per-workspace tick ceiling and the sending domain's
        // rolling hour (v1.21.0).
        realSendsByWorkspace.set(workspaceId, (realSendsByWorkspace.get(workspaceId) ?? 0) + 1);
        const sentDomain = domainOf(chosen.email);
        hourlyByDomain.set(sentDomain, (hourlyByDomain.get(sentDomain) ?? 0) + 1);
      }
      await advance();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown provider error";
      summary.failed += 1;
      await db.emailEvent.create({
        data: {
          workspaceId,
          campaignId: campaign.id,
          enrollmentId: enrollment.id,
          sendingAccountId: chosen.id,
          type: "FAILED",
          idempotencyKey: `fail:${enrollment.id}:${stepIndex}:${now.getTime()}`,
          variant: variantLabel,
          occurredAt: now,
        },
      });
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { lastError: message },
      });
    }
  }

  // Outbound webhook pass (Phase 4): deliver everything due,
  // including deliveries enqueued by events applied earlier and any
  // retries whose backoff has elapsed. Failures inside the pass are
  // recorded on the delivery rows themselves; a broken webhook
  // receiver must never fail the send tick.
  try {
    summary.webhooks = await processDueDeliveries(db, { now });
  } catch (error) {
    logger.error("Webhook delivery pass failed during send tick", { error, requestId });
  }

  logger.info("Send tick complete", {
    requestId,
    processed: summary.processed,
    sent: summary.sent,
    simulated: summary.simulated,
    completed: summary.completed,
    failed: summary.failed,
    quotaBlocked: summary.quotaBlocked,
    deferredHourlyCap: summary.deferredHourlyCap,
    deferredTickPacing: summary.deferredTickPacing,
    // Log every deferral bucket (v1.11.5): the 2026-10-30 sending
    // stall showed ticks processing 200 enrollments with zero sends
    // and zero in every logged counter, which left the real bucket
    // (suppressed, no-capacity, or outside-window) invisible.
    skippedSuppressed: summary.skippedSuppressed,
    skippedNotOpened: summary.skippedNotOpened,
    deferredNoCapacity: summary.deferredNoCapacity,
    deferredOutsideWindow: summary.deferredOutsideWindow,
    quarantined: summary.quarantined,
    webhooksAttempted: summary.webhooks.attempted,
    webhooksDelivered: summary.webhooks.delivered,
  });

  return summary;
}
