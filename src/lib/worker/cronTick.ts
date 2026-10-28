import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/log";
import { runSendTick, type SendTickSummary } from "./sendTick";

/**
 * The production cron pass behind GET /api/cron/tick.
 *
 * Vercel Cron sends `Authorization: Bearer {CRON_SECRET}` natively, so
 * the route is a thin wrapper over isCronAuthorized + scheduleCronTick.
 * runSendTick performs the reply sync pass before sending; its summary
 * carries the per account sync results, which this module aggregates
 * into the cron summary it logs on completion.
 */

export function isCronAuthorized(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export interface CronTickSummary {
  sends: SendTickSummary;
  syncedAccounts: number;
  repliesImported: number;
  syncErrors: number;
}

export type CronTickRunner = () => Promise<CronTickSummary>;
export type CronTickScheduler = (task: () => Promise<void>) => void;

/**
 * Schedules one cron tick to run in the background through the
 * caller's scheduler (the route passes Next's `after()`, so the work
 * runs once the response has been sent and the platform keeps the
 * invocation alive until it finishes). A full tick (reply sync across
 * every account, then sends) regularly takes longer than external
 * schedulers allow a single request (cron-job.org caps at 30
 * seconds), so the route answers with a fast acceptance and the tick
 * completes here instead. The wrapped task catches every error and
 * logs it, so a failed tick never becomes an unhandled rejection.
 */
export function scheduleCronTick(
  schedule: CronTickScheduler,
  runTick: CronTickRunner = runCronTick,
): void {
  schedule(async () => {
    try {
      await runTick();
    } catch (error) {
      logger.error("Cron tick failed", { error });
    }
  });
}

export async function runCronTick(db: PrismaClient = prisma): Promise<CronTickSummary> {
  const sends = await runSendTick({ db });
  const summary: CronTickSummary = {
    sends,
    syncedAccounts: sends.sync.length,
    repliesImported: sends.sync.reduce((total, entry) => total + entry.imported, 0),
    syncErrors: sends.sync.filter((entry) => entry.error).length,
  };
  logger.info("Cron tick complete", {
    sent: sends.sent,
    syncedAccounts: summary.syncedAccounts,
    repliesImported: summary.repliesImported,
    syncErrors: summary.syncErrors,
  });
  return summary;
}
