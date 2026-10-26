import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { getCampaignPreflight } from "@/lib/campaigns/preflightService";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const preflight = await getCampaignPreflight(prisma, {
      workspaceId: ctx.workspace.id,
      campaignId: id,
    });
    return NextResponse.json({ preflight });
  } catch (error) {
    return apiError(error);
  }
}
