import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { pauseAllCampaigns } from "@/lib/campaigns/pauseAll";
import { writeAuditLog } from "@/lib/audit";

/**
 * Pause sending for every campaign in the workspace (v1.37.0).
 *
 * The Campaigns page's "Pause all campaigns" button posts here.
 * RUNNING and SCHEDULED campaigns move to PAUSED in one update;
 * the response reports how many were paused so the page can say
 * exactly what happened.
 */
export async function POST() {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const pausedCount = await pauseAllCampaigns(prisma, ctx.workspace.id);
    await writeAuditLog({
      action: "campaign.pause_all",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { pausedCount },
    });
    return NextResponse.json({ pausedCount });
  } catch (error) {
    return apiError(error);
  }
}
