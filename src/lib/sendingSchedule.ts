import type { PrismaClient } from "@prisma/client";
import { effectiveDailyLimit } from "@/lib/domain/limits";
import { effectiveDailyLimit as warmupDailyLimit } from "@/lib/domain/warmup";
import { resolveLeadTimezone } from "@/lib/domain/leadTimezone";
import type { LeadFields } from "@/lib/domain/personalize";

/**
 * Sending schedule for the dashboard (v1.7.0).
 *
 * The worker's truth, made visible: when the last email actually
 * went out, when the next sends come due, what the upcoming queue
 * looks like, and how much of today's capacity is used. Every figure
 * is read from the same records the worker itself uses (SENT events,
 * enrollment nextSendAt stamps, and the same per-account limit math
 * as sendTick: the age ramp minimum the warm-up ceiling), so the
 * panel can disagree with the worker only if the records do.
 *
 * Due times are enrollment stamps. The external scheduler ticks
 * every few minutes, so a due send leaves on the first tick after
 * its stamp; the panel shows the stamp, never a fake countdown.
 */

export interface UpcomingSend {
  enrollmentId: string;
  /** The enrollment's nextSendAt stamp. */
  at: Date;
  campaignName: string;
  leadEmail: string;
  company: string | null;
  /** 1-based step the send will deliver. */
  stepNumber: number;
  /** The lead's resolved timezone, falling back to the campaign's. */
  timezone: string;
  /** True when the stamp is already past and the send awaits a tick. */
  due: boolean;
}

export interface SendingSchedule {
  /** Most recent recorded SENT event, or null when nothing sent yet. */
  lastSentAt: Date | null;
  /** SENT events since the start of the current UTC day. */
  sentToday: number;
  /** Effective capacity for today across eligible accounts. */
  capacity: {
    /** Sends used today (same count as sentToday). */
    used: number;
    /** Sum of per-account effective limits for today. */
    cap: number;
    /** Accounts counted towards the cap (not paused or in error). */
    accounts: number;
  };
  /** The next sends to come due, soonest first, at most 8. */
  upcoming: UpcomingSend[];
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function companyOf(fields: unknown): string | null {
  if (fields && typeof fields === "object") {
    const record = fields as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key.toLowerCase() === "company" && typeof record[key] === "string" && record[key]) {
        return record[key] as string;
      }
    }
  }
  return null;
}

export async function getSendingSchedule(
  db: PrismaClient,
  workspaceId: string,
  now: Date = new Date(),
): Promise<SendingSchedule> {
  const dayStart = startOfUtcDay(now);

  const [lastSent, sentToday, accounts, upcomingRows] = await Promise.all([
    db.emailEvent.findFirst({
      where: { workspaceId, type: "SENT" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
    db.emailEvent.count({
      where: { workspaceId, type: "SENT", occurredAt: { gte: dayStart } },
    }),
    db.sendingAccount.findMany({
      where: { workspaceId },
      select: {
        id: true,
        status: true,
        dailyLimit: true,
        createdAt: true,
        warmupEnabled: true,
        warmupStartedAt: true,
      },
    }),
    db.enrollment.findMany({
      where: {
        status: "ACTIVE",
        nextSendAt: { not: null },
        campaign: { workspaceId, status: "RUNNING" },
      },
      orderBy: { nextSendAt: "asc" },
      take: 8,
      select: {
        id: true,
        nextSendAt: true,
        currentStep: true,
        campaign: { select: { name: true, timezone: true } },
        lead: { select: { email: true, fields: true } },
      },
    }),
  ]);

  const eligible = accounts.filter((account) => account.status !== "PAUSED" && account.status !== "ERROR");
  const cap = eligible.reduce((sum, account) => {
    const rampLimit = effectiveDailyLimit({
      dailyLimit: account.dailyLimit,
      ageInDays: Math.max(
        0,
        Math.floor((now.getTime() - account.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      ),
    });
    return sum + Math.min(rampLimit, warmupDailyLimit(account, now));
  }, 0);

  const upcoming: UpcomingSend[] = upcomingRows.map((row) => ({
    enrollmentId: row.id,
    at: row.nextSendAt as Date,
    campaignName: row.campaign.name,
    leadEmail: row.lead.email,
    company: companyOf(row.lead.fields),
    stepNumber: row.currentStep + 1,
    timezone:
      resolveLeadTimezone(row.lead.fields as LeadFields | null) ?? row.campaign.timezone,
    due: (row.nextSendAt as Date).getTime() <= now.getTime(),
  }));

  return {
    lastSentAt: lastSent?.occurredAt ?? null,
    sentToday,
    capacity: { used: sentToday, cap, accounts: eligible.length },
    upcoming,
  };
}
