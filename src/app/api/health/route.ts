import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkHealth } from "@/lib/health";

/**
 * Public health probe for uptime monitoring (see DEPLOYMENT.md).
 * 200 when the app and database respond, 503 when the database
 * check fails. The body carries no internal detail beyond status,
 * database reachability, app version, and the current time.
 */
export async function GET() {
  const report = await checkHealth(prisma);
  return NextResponse.json(report, { status: report.status === "ok" ? 200 : 503 });
}
