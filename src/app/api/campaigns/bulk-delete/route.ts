import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { MAX_BULK_DELETE_IDS, bulkDeleteCampaigns } from "@/lib/campaigns/bulkDelete";
import { writeAuditLog } from "@/lib/audit";

/**
 * Bulk delete campaigns (v1.38.0).
 *
 * The Campaigns page's multi-select posts the chosen campaign ids
 * here. The rules match the single delete exactly, including the
 * ADMIN role and the RUNNING guard: running campaigns in the
 * selection are skipped and reported, never deleted. Leads are
 * never deleted.
 */
export async function POST(request: Request) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "ids must be an array of campaign ids" }, { status: 400 });
    }
    if (body.ids.length === 0) {
      return NextResponse.json({ error: "Select at least one campaign to delete" }, { status: 400 });
    }
    if (body.ids.length > MAX_BULK_DELETE_IDS) {
      return NextResponse.json(
        { error: `Select at most ${MAX_BULK_DELETE_IDS} campaigns at a time` },
        { status: 400 },
      );
    }
    const result = await bulkDeleteCampaigns(prisma, ctx.workspace.id, body.ids);
    await writeAuditLog({
      action: "campaign.bulk_delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: {
        deletedCount: result.deletedCount,
        campaignIds: result.deletedIds,
        skippedRunningCount: result.skippedRunning.length,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
