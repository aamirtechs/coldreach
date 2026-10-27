import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { computeCampaignMetricsFromCounts } from "@/lib/domain/metrics";

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
    // Aggregated in the database: the counts helper returns exactly
    // what computeCampaignMetrics would on the raw rows, at any volume.
    const groups = await prisma.emailEvent.groupBy({
      by: ["type", "classification"],
      where: { workspaceId: ctx.workspace.id, campaignId: campaign.id },
      _count: { _all: true },
    });
    const metrics = computeCampaignMetricsFromCounts(
      groups.map((group) => ({
        type: group.type,
        classification: group.classification,
        count: group._count._all,
      })),
    );
    return NextResponse.json({ metrics });
  } catch (error) {
    return apiError(error);
  }
}
