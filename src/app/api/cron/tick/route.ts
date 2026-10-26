import { NextResponse } from "next/server";
import { isCronAuthorized, runCronTick } from "@/lib/worker/cronTick";

/**
 * Production scheduler entry point. Vercel Cron invokes this route on
 * the schedule in vercel.json and sends the CRON_SECRET as a bearer
 * token natively; external schedulers can send the same header. The
 * legacy worker endpoint (POST /api/worker/tick with x-worker-secret)
 * keeps working for schedulers that cannot set an Authorization
 * header. Without the secret the route answers 401 and does no work.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runCronTick();
  return NextResponse.json({
    ok: true,
    sent: summary.sends.sent,
    simulated: summary.sends.simulated,
    processed: summary.sends.processed,
    failed: summary.sends.failed,
    syncedAccounts: summary.syncedAccounts,
    repliesImported: summary.repliesImported,
    syncErrors: summary.syncErrors,
  });
}
