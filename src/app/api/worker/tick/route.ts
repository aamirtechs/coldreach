import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { runSendTick } from "@/lib/worker/sendTick";

/**
 * Runs one sending tick. Intended to be called by an external scheduler
 * (cron, a queue driver, or the worker:once CLI). Authentication is the
 * shared worker secret, never a user session.
 */
export async function POST(request: Request) {
  const secret = process.env.WORKER_SECRET;
  const provided = request.headers.get("x-worker-secret");
  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runSendTick();
    return NextResponse.json({ summary });
  } catch (error) {
    return apiError(error);
  }
}
