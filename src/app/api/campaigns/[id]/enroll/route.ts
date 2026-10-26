import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { enrollCampaign } from "@/lib/campaigns/enroll";
import { writeAuditLog } from "@/lib/audit";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const result = await enrollCampaign(prisma, { workspaceId: ctx.workspace.id, campaignId: id });
    await writeAuditLog({
      action: "campaign.enroll",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { campaignId: id, result: { ...result } },
    });
    return NextResponse.json({ enrollment: result });
  } catch (error) {
    return apiError(error);
  }
}
