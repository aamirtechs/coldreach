import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { enrollCampaign, type EnrollConflict } from "@/lib/campaigns/enroll";
import { writeAuditLog } from "@/lib/audit";

/**
 * Enroll the campaign's lead list. Cross-campaign duplicate guard
 * (v1.11.0): when leads that would enroll are already enrolled in
 * another campaign of the workspace, the enroll is refused with 409
 * and the conflict list, and nothing is enrolled. The client shows
 * the conflicts and resends with { force: true } only when the
 * operator confirms the double outreach is intended.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{ force?: unknown }>(request);
  const force = body?.force === true;
  try {
    const result = await enrollCampaign(prisma, {
      workspaceId: ctx.workspace.id,
      campaignId: id,
      force,
    });
    await writeAuditLog({
      action: "campaign.enroll",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { campaignId: id, result: { ...result } },
    });
    return NextResponse.json({ enrollment: result });
  } catch (error) {
    const conflicts = (error as { conflicts?: EnrollConflict[] })?.conflicts;
    const status = (error as { status?: number })?.status;
    if (status === 409 && Array.isArray(conflicts)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Enrollment conflicts", conflicts },
        { status: 409 },
      );
    }
    return apiError(error);
  }
}
