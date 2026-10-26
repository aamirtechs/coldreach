import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { getCampaignPreflight } from "@/lib/campaigns/preflightService";
import { writeAuditLog } from "@/lib/audit";

/**
 * Launch is the only way a campaign enters RUNNING, and it is gated by a
 * fresh server-side preflight. Any FAIL check refuses the launch with
 * the full preflight result so the UI can show exactly what to fix.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, status: true, name: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (!["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status)) {
      return NextResponse.json(
        { error: `A ${campaign.status} campaign cannot be launched` },
        { status: 409 },
      );
    }
    const preflight = await getCampaignPreflight(prisma, {
      workspaceId: ctx.workspace.id,
      campaignId: id,
    });
    if (!preflight.canLaunch) {
      return NextResponse.json(
        { error: "Preflight failed. Fix the failing checks before launch.", preflight },
        { status: 422 },
      );
    }
    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "RUNNING" },
    });
    await writeAuditLog({
      action: "campaign.launch",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { campaignId: campaign.id, preflightStatus: preflight.status },
    });
    return NextResponse.json({ campaign: updated, preflight });
  } catch (error) {
    return apiError(error);
  }
}
