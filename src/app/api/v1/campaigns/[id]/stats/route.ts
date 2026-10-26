import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApiKey } from "@/lib/apiKeys/auth";
import { computeCampaignMetrics, type MetricEvent } from "@/lib/domain/metrics";
import { pickWinner, variantStats } from "@/lib/domain/abtest";

/**
 * Public API: campaign statistics from the real metrics engine, plus
 * the per-variant A/B breakdown. The campaign must belong to the API
 * key's workspace; another workspace's campaign is a 404, not a leak.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiKey(request, "stats:read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: ctx.workspaceId },
      select: { id: true, name: true, status: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const events = await prisma.emailEvent.findMany({
      where: { workspaceId: ctx.workspaceId, campaignId: campaign.id },
      select: { type: true, classification: true, variant: true },
    });
    const metrics = computeCampaignMetrics(events as MetricEvent[]);
    const variants = variantStats(events);
    return NextResponse.json({
      campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
      metrics,
      variants,
      winner: pickWinner(variants),
    });
  } catch (error) {
    return apiError(error);
  }
}
