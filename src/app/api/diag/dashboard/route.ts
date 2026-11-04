import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api";
import { getOnboardingState } from "@/lib/onboarding";
import { getSendingSchedule } from "@/lib/sendingSchedule";
import { computeAccountHealthForAccounts } from "@/lib/accountHealth";

/**
 * TEMPORARY diagnostic for the dashboard 500 (2026-11-04).
 *
 * The dashboard page (/app) throws during server rendering for the
 * AamirTechs workspace with a stable production digest that hides the
 * real message. This route re-runs the dashboard's exact data steps
 * one by one, in isolation, and reports which step throws and why.
 * OWNER only, scoped to the caller's own workspace. Remove this
 * route in the fix release once the root cause is known.
 */

interface StepResult {
  step: string;
  ok: boolean;
  detail?: string;
  error?: string;
}

function formatInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

async function runStep(step: string, fn: () => Promise<string>): Promise<StepResult> {
  try {
    const detail = await fn();
    return { step, ok: true, detail };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      step,
      ok: false,
      error: `${err.name}: ${err.message}\n${(err.stack ?? "").split("\n").slice(0, 6).join("\n")}`,
    };
  }
}

export async function GET() {
  const session = await requireSession("OWNER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const workspaceId = ctx.workspace.id;
  const results: StepResult[] = [];

  results.push(
    await runStep("countsA", async () => {
      const [campaignCount, leadCount, accountCount, suppressionCount] = await Promise.all([
        prisma.campaign.count({ where: { workspaceId } }),
        prisma.lead.count({ where: { workspaceId } }),
        prisma.sendingAccount.count({ where: { workspaceId } }),
        prisma.suppression.count({ where: { OR: [{ workspaceId }, { scope: "GLOBAL" }] } }),
      ]);
      return `campaigns=${campaignCount} leads=${leadCount} accounts=${accountCount} suppressions=${suppressionCount}`;
    }),
  );

  results.push(
    await runStep("countsB", async () => {
      const [running, sent, opened, replied, automated, suspended, warmup] = await Promise.all([
        prisma.campaign.count({ where: { workspaceId, status: "RUNNING" } }),
        prisma.emailEvent.count({ where: { workspaceId, type: "SENT" } }),
        prisma.emailEvent.count({ where: { workspaceId, type: "OPENED" } }),
        prisma.emailEvent.count({ where: { workspaceId, type: "REPLIED" } }),
        prisma.emailEvent.count({ where: { workspaceId, type: "REPLIED", classification: "AUTOMATED" } }),
        prisma.sendingAccount.count({ where: { workspaceId, status: { in: ["PAUSED", "ERROR"] } } }),
        prisma.sendingAccount.findMany({
          where: { workspaceId, warmupEnabled: true },
          select: { warmupStartedAt: true },
        }),
      ]);
      return `running=${running} sent=${sent} opened=${opened} replied=${replied} automated=${automated} suspended=${suspended} warmup=${warmup.length}`;
    }),
  );

  results.push(
    await runStep("accountHealth", async () => {
      const accounts = await prisma.sendingAccount.findMany({
        where: { workspaceId },
        select: { id: true, email: true, status: true, lastError: true },
        orderBy: { createdAt: "asc" },
      });
      const byId = await computeAccountHealthForAccounts(prisma, accounts);
      const unhealthy = accounts
        .map((account) => ({ email: account.email, health: byId.get(account.id) }))
        .filter((entry) => entry.health !== undefined && entry.health.state !== "healthy");
      return `accounts=${accounts.length} unhealthy=${unhealthy.length}`;
    }),
  );

  results.push(
    await runStep("onboarding", async () => {
      const state = await getOnboardingState(prisma, workspaceId);
      return `done=${state.doneCount}/${state.total} complete=${state.complete}`;
    }),
  );

  let scheduleDetail = "";
  results.push(
    await runStep("sendingSchedule", async () => {
      const schedule = await getSendingSchedule(prisma, workspaceId);
      scheduleDetail = JSON.stringify({
        lastSentAt: schedule.lastSentAt,
        sentToday: schedule.sentToday,
        capacity: schedule.capacity,
        upcoming: schedule.upcoming.map((send) => ({
          at: send.at,
          timezone: send.timezone,
          campaignName: send.campaignName,
          stepNumber: send.stepNumber,
          due: send.due,
        })),
      });
      return scheduleDetail.slice(0, 900);
    }),
  );

  results.push(
    await runStep("renderFormatting", async () => {
      const schedule = await getSendingSchedule(prisma, workspaceId);
      const notes: string[] = [];
      if (schedule.lastSentAt) {
        notes.push(`lastSent fmt=${formatInZone(schedule.lastSentAt, "UTC")}`);
        notes.push(`lastSent iso=${schedule.lastSentAt.toISOString()}`);
      }
      for (const send of schedule.upcoming) {
        notes.push(
          `${send.campaignName} tz=${send.timezone} fmt=${formatInZone(send.at, send.timezone)} iso=${send.at.toISOString()}`,
        );
      }
      const nextReset = new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) +
          86_400_000,
      );
      notes.push(`nextReset iso=${nextReset.toISOString()}`);
      return notes.join(" | ").slice(0, 900);
    }),
  );

  return NextResponse.json({ workspaceId, results });
}
