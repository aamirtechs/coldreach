import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, requireSession } from "@/lib/api";
import { DEFAULT_MIN_WINNER_SAMPLE, pickWinner, variantStats } from "@/lib/domain/abtest";

/**
 * Per-campaign A/B breakdown: variant statistics from recorded
 * events plus the winner verdict. The verdict is null until the
 * leading variant beats every other at 95% confidence with at least
 * minSample delivered events each; the response always carries the
 * numbers so the UI can say exactly what is still needed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const url = new URL(request.url);
  const minSample = Math.max(1, intField(url.searchParams.get("minSample"), DEFAULT_MIN_WINNER_SAMPLE));
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, name: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const events = await prisma.emailEvent.findMany({
      where: { workspaceId: ctx.workspace.id, campaignId: campaign.id },
      select: { type: true, variant: true },
    });
    const variants = variantStats(events);
    return NextResponse.json({
      campaignId: campaign.id,
      variants,
      winner: pickWinner(variants, minSample),
      minSample,
    });
  } catch (error) {
    return apiError(error);
  }
}
