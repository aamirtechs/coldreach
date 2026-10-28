import { after, NextResponse } from "next/server";
import { isCronAuthorized, scheduleCronTick } from "@/lib/worker/cronTick";

/**
 * Production scheduler entry point. Vercel Cron invokes this route on
 * the schedule in vercel.json and sends the CRON_SECRET as a bearer
 * token natively; external schedulers can send the same header. The
 * legacy worker endpoint (POST /api/worker/tick with x-worker-secret)
 * keeps working for schedulers that cannot set an Authorization
 * header. Without the secret the route answers 401 and schedules no
 * work.
 *
 * With the secret, the route schedules the tick through Next's
 * after() and answers immediately with a small acceptance body. A
 * full tick takes longer than some external schedulers allow a
 * request (cron-job.org caps execution at 30 seconds and recorded
 * Failed (timeout) even though the tick completed), so the tick runs
 * to completion in the background and logs its summary there; the
 * response is only the acceptance, never the tick results.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  scheduleCronTick(after);
  return NextResponse.json({ ok: true, accepted: true });
}
