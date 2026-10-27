import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/log";
import { runSendTick, type SendTickSummary } from "./sendTick";

/**
 * The production cron pass behind GET /api/cron/tick.
 *
 * Vercel Cron sends `Authorization: Bearer {CRON_SECRET}` natively, so
 * the route is a thin wrapper over isCronAuthorized + runCronTick.
 * runSendTick performs the reply sync pass before sending; its summary
 * carries the per account sync results, which this module aggregates
 * into the cron response.
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
