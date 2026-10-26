import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { computeCampaignMetrics, type MetricEvent } from "@/lib/domain/metrics";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const events = await prisma.emailEvent.findMany({
      where: { workspaceId: ctx.workspace.id, campaignId: campaign.id },
      select: { type: true, classification: true },
    });
    const metrics = computeCampaignMetrics(events as MetricEvent[]);
    return NextResponse.json({ metrics });
  } catch (error) {
    return apiError(error);
  }
}
