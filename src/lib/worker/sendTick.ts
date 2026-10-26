import type { PrismaClient, SendingAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeNextSendAt } from "@/lib/domain/scheduling";
import { findSuppression, type SuppressionEntry } from "@/lib/domain/suppression";
import { renderTemplate, type LeadFields } from "@/lib/domain/personalize";
import { effectiveDailyLimit } from "@/lib/domain/limits";
import { resolveProvider as defaultResolveProvider, type MailProvider } from "@/lib/providers";
import { loadSuppressions } from "@/lib/suppressions";
import { createUnsubscribeToken } from "./unsubscribe";

/**
 * One sending worker tick.
 *
 * Finds enrollments that are due (ACTIVE, nextSendAt in the past,
 * campaign RUNNING) and sends the current step for each, in due order.
 * Every send is preceded by a fresh suppression check, a terminal lead
 * status check, and an account capacity check under the limits engine.
 * Accounts rotate in the campaign's configured order. Each send is
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
  resolveProvider?: (account: SendingAccount) => MailProvider;
  now?: Date;
  appUrl?: string;
  batchLimit?: number;
}

export interface SendTickSummary {
  processed: number;
  sent: number;
  simulated: number;
  completed: number;
  skippedSuppressed: number;
  deferredNoCapacity: number;
  failed: number;
}

const TERMINAL_LEAD_STATUSES = new Set(["UNSUBSCRIBED", "BOUNCED", "SUPPRESSED", "INVALID"]);

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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
  const appUrl = (deps.appUrl ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const summary: SendTickSummary = {
    processed: 0,
    sent: 0,
    simulated: 0,
    completed: 0,
    skippedSuppressed: 0,
    deferredNoCapacity: 0,
    failed: 0,
  };

  const due = await db.enrollment.findMany({
    where: {
      status: "ACTIVE",
      nextSendAt: { lte: now },
      campaign: { status: "RUNNING" },
    },
    include: {
      lead: true,
      campaign: {
        include: {
          steps: { orderBy: { order: "asc" } },
          accounts: { include: { sendingAccount: true }, orderBy: { createdAt: "asc" } },
          workspace: true,
        },
      },
    },
    orderBy: { nextSendAt: "asc" },
    take: deps.batchLimit ?? 200,
  });

  const suppressionCache = new Map<string, SuppressionEntry[]>();
  const sentTodayCache = new Map<string, number>();
  const providerCache = new Map<string, MailProvider>();
  const rotationPointers = new Map<string, number>();
  const dayStart = startOfUtcDay(now);

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

    // Gate 2: capacity, rotating across the campaign's accounts in
    // order and honouring each account's effective daily limit.
    const accounts = campaign.accounts.map((entry) => entry.sendingAccount);
    const pointer = rotationPointers.get(campaign.id) ?? 0;
    let chosen: SendingAccount | null = null;
    for (let i = 0; i < accounts.length; i += 1) {
      const candidate = accounts[(pointer + i) % accounts.length];
      if (candidate.status === "PAUSED" || candidate.status === "ERROR") {
        continue;
      }
      const limit = effectiveDailyLimit({
        dailyLimit: candidate.dailyLimit,
        ageInDays: Math.max(
          0,
          Math.floor((now.getTime() - candidate.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
        ),
      });
      if ((await sentTodayFor(candidate)) < limit) {
        chosen = candidate;
        rotationPointers.set(campaign.id, pointer + i + 1);
        break;
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
        timezone: campaign.timezone,
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

    // Render with the lead's real fields and append the compliance
    // footer: sender identity, postal address, and the unsubscribe link.
    const leadFields: LeadFields =
      lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
        ? { ...(lead.fields as Record<string, string>), email: lead.email }
        : { email: lead.email };
    const subject = renderTemplate(step.subject, leadFields);
    const bodyText = renderTemplate(step.body, leadFields);
    const unsubscribeUrl = `${appUrl}/u/${createUnsubscribeToken(workspaceId, lead.id, campaign.id)}`;
    const senderLine = campaign.workspace.senderName ?? campaign.workspace.name;
    const footerText = [
      "",
      "--",
      senderLine,
      ...(campaign.workspace.senderAddress ? [campaign.workspace.senderAddress] : []),
      `Unsubscribe: ${unsubscribeUrl}`,
    ].join("\n");
    const fullText = `${bodyText}\n${footerText}`;
    const footerHtml = `<hr /><p style="font-size:12px;color:#666">${senderLine}${
      campaign.workspace.senderAddress ? `<br />${campaign.workspace.senderAddress}` : ""
    }<br /><a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
    const fullHtml = `${textToHtml(bodyText)}\n${footerHtml}`;

    let provider = providerCache.get(chosen.id);
    if (!provider) {
      try {
        provider = resolve(chosen);
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
        html: fullHtml,
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
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
          occurredAt: now,
        },
      });
      sentTodayCache.set(chosen.id, (sentTodayCache.get(chosen.id) ?? 0) + 1);
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
          occurredAt: now,
        },
      });
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { lastError: message },
      });
    }
  }

  return summary;
}
