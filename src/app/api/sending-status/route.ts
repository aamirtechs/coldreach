import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { getSendingSchedule } from "@/lib/sendingSchedule";

/**
 * Live sending status for the sidebar card: today's send count against
 * the capacity cap (the same figures the dashboard schedule panel
 * shows, from getSendingSchedule) plus one status row per sending
 * account.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const [schedule, accounts] = await Promise.all([
      getSendingSchedule(prisma, ctx.workspace.id),
      prisma.sendingAccount.findMany({
        where: { workspaceId: ctx.workspace.id },
        orderBy: { createdAt: "asc" },
        select: { email: true, status: true },
      }),
    ]);
    return NextResponse.json({
      sentToday: schedule.sentToday,
      capacityCap: schedule.capacity.cap,
      capacityUsed: schedule.capacity.used,
      lastSentAt: schedule.lastSentAt,
      accounts,
    });
  } catch (error) {
    return apiError(error);
  }
}
