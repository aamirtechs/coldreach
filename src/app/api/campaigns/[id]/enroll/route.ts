import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { enrollCampaign } from "@/lib/campaigns/enroll";
import { writeAuditLog } from "@/lib/audit";

/**
 * Enroll the campaign's lead list. Cross-campaign duplicate rule
 * (v1.27.0, replacing the v1.11.0 block-all 409 guard): leads whose
 * email already sits in another campaign of the workspace are
 * skipped, counted in skippedCrossCampaign, and listed in the
 * result's conflicts; the rest enroll normally. A caller may still
 * resend with { force: true } to enroll the skipped leads anyway
 * when double outreach is genuinely intended.
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
    const { conflicts: _conflicts, ...resultCounts } = result;
    await writeAuditLog({
      action: "campaign.enroll",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { campaignId: id, result: { ...resultCounts, conflictCount: result.conflicts.length } },
    });
    return NextResponse.json({ enrollment: result });
  } catch (error) {
    return apiError(error);
  }
}
