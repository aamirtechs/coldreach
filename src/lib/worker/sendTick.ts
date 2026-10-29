import type { PrismaClient, SendingAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeNextSendAt } from "@/lib/domain/scheduling";
import { resolveLeadTimezone } from "@/lib/domain/leadTimezone";
import { findSuppression, type SuppressionEntry } from "@/lib/domain/suppression";
import { renderTemplate, type LeadFields } from "@/lib/domain/personalize";
import { effectiveDailyLimit } from "@/lib/domain/limits";
import { effectiveDailyLimit as warmupDailyLimit } from "@/lib/domain/warmup";
import { resolveProvider as defaultResolveProvider, type MailProvider } from "@/lib/providers";
import { loadSuppressions } from "@/lib/suppressions";
import { syncAllConnectedAccounts, type AccountSyncSummary } from "@/lib/sync/syncService";
import { pickVariant } from "@/lib/domain/abtest";
import { canSend, type Plan } from "@/lib/domain/plans";
import { countMonthlySends, getPlanForWorkspace } from "@/lib/billing/subscription";
import { processDueDeliveries, type ProcessDueSummary } from "@/lib/webhooks/service";
import { logger, newRequestId } from "@/lib/log";
import { createUnsubscribeToken } from "./unsubscribe";
import { createOpenToken } from "./openTracking";
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
   *  outside the lead's own local window; the enrollment is
   *  re-stamped to the lead's next window opening (per-lead
   *  timezone sending, v1.5.0). */
  deferredOutsideWindow: number;
  failed: number;
  /** Sends refused because the workspace hit its plan's monthly quota. */
  quotaBlocked: number;
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
    failed: 0,
    quotaBlocked: 0,
    sync: syncSummaries,
    webhooks: { attempted: 0, delivered: 0, failed: 0, retrying: 0 },
  };

  // Fetch a wider due pool than the batch, then interleave it across
  // campaigns (v1.8.1) so the batch is shared fairly. The pool fetch
  // stays in due order, so each campaign's own queue keeps its order.
  const batchLimit = deps.batchLimit ?? 200;
  const duePool = await db.enrollment.findMany({
    where: {
      status: "ACTIVE",
      nextSendAt: { lte: now },
      campaign: { status: "RUNNING" },
    },
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
    take: batchLimit * 5,
  });
  const due = interleaveByCampaign(duePool, batchLimit);

  const suppressionCache = new Map<string, SuppressionEntry[]>();
  const sentTodayCache = new Map<string, number>();
  const providerCache = new Map<string, MailProvider>();
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

    // Gate: per-lead timezone window (v1.5.0). The enrollment's
    // stamped time is the intended send moment. When the lead's own
    // timezone resolves and differs from the campaign's, check the
    // stamp itself against the lead's local window: a stamp that
    // falls outside it (enrollments stamped before per-lead
    // scheduling carry campaign-zone times) is re-stamped once to
    // the lead's next window opening. A stamp that is already a
    // valid lead-local send time always sends when a tick finds it
    // due, even if the tick itself runs late, so a sparse tick
    // cadence degrades to late delivery rather than starving a lead
    // whose window no tick happens to land inside.
    const leadTimezone = resolveLeadTimezone(lead.fields as LeadFields);
    if (leadTimezone && leadTimezone !== campaign.timezone && enrollment.nextSendAt) {
      const slot = computeNextSendAt(enrollment.nextSendAt, {
        timezone: leadTimezone,
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

    // Gate 2: capacity, honouring each account's effective daily
    // limit. Among the campaign's accounts with capacity left, pick
    // the one that has sent least today (v1.8.2), so sends balance
    // across accounts instead of every campaign walking the same
    // list from the top and draining the first accounts while the
    // last ones idle. sentTodayFor reads the real counts and this
    // tick's own sends, so the balance holds across campaigns and
    // across ticks. Ties keep the campaign's configured order.
    const accounts = campaign.accounts.map((entry) => entry.sendingAccount);
    const healthById = await healthForAccounts(accounts);
    let chosen: SendingAccount | null = null;
    let chosenSentToday = Number.POSITIVE_INFINITY;
    for (const candidate of accounts) {
      if (candidate.status === "PAUSED" || candidate.status === "ERROR") {
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
      if (sentToday < limit && sentToday < chosenSentToday) {
        chosen = candidate;
        chosenSentToday = sentToday;
      }
    }
    if (!chosen) {
      summary.deferredNoCapacity += 1;
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

    // A/B variant (Phase 4): deterministic per enrollment and step,
    // so a retry after a provider failure renders the identical copy.
    // Variant A is the step's own subject and body.
    const variantLabel = pickVariant(enrollment.id, stepIndex, [
      { label: "A", weight: 1 },
      ...step.variants.map((variant) => ({ label: variant.label, weight: variant.weight })),
    ]);
    const variant = step.variants.find((entry) => entry.label === variantLabel) ?? null;

    // Render with the lead's real fields and append the compliance
    // footer: sender identity, postal address, and the unsubscribe link.
    const leadFields: LeadFields =
      lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
        ? { ...(lead.fields as Record<string, string>), email: lead.email }
        : { email: lead.email };
    // Spintax (v1.11.0): after template rendering, resolve any
    // {a|b|c} groups in the subject and body. The seed is the
    // enrollment and step, so a retry of this send renders the
    // identical variant while different leads get different ones.
    // Copy without spintax syntax passes through unchanged.
    const spintaxSeed = `${enrollment.id}:${stepIndex}`;
    const subject = renderSpintax(
      renderTemplate(variant?.subject ?? step.subject, leadFields),
      spintaxSeed,
    );
    const bodyText = renderSpintax(
      renderTemplate(variant ? variant.bodyText : step.body, leadFields),
      spintaxSeed,
    );
    const unsubscribeUrl = `${appUrl}/u/${createUnsubscribeToken(workspaceId, lead.id, campaign.id)}`;
    const senderLine = campaign.workspace.senderName ?? campaign.workspace.name;
    const footerText = [
      "",
      "--",
      senderLine,
      ...(campaign.workspace.senderAddress ? [campaign.workspace.senderAddress] : []),
      `Unsubscribe: ${unsubscribeUrl}`,
    ].join("\n");
    // Per-campaign signature (v1.4.0): rendered with the same lead
    // fields and placed between the body and the compliance footer,
    // so it applies to every step and A/B variant without editing
    // any step copy, and takes effect from the next send onward.
    const signatureText = campaign.signatureText
      ? renderTemplate(campaign.signatureText, leadFields).trim()
      : "";
    const fullText = signatureText
      ? `${bodyText}\n\n${signatureText}\n${footerText}`
      : `${bodyText}\n${footerText}`;
    const footerHtml = `<hr /><p style="font-size:12px;color:#666">${senderLine}${
      campaign.workspace.senderAddress ? `<br />${campaign.workspace.senderAddress}` : ""
    }<br /><a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
    const signatureHtml = signatureText ? `\n${textToHtml(signatureText)}` : "";
    const renderedHtml = variant?.bodyHtml
      ? renderSpintax(renderTemplate(variant.bodyHtml, leadFields), spintaxSeed)
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

    try {
      const result = await provider.send({
        fromEmail: chosen.email,
        fromName: chosen.displayName,
        toEmail: lead.email,
        subject,
        text: fullText,
        html: trackedHtml,
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
    webhooksAttempted: summary.webhooks.attempted,
    webhooksDelivered: summary.webhooks.delivered,
  });

  return summary;
}
