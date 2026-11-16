import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { MAX_BULK_DELETE_IDS } from "@/lib/campaigns/bulkDelete";
import { bulkDeleteLeadLists } from "@/lib/leads/bulkDeleteLists";
import { writeAuditLog } from "@/lib/audit";

/**
 * Bulk delete lead lists (v1.38.0).
 *
 * The Leads page's multi-select posts the chosen list ids here.
 * The rules match the single delete exactly: only the list grouping
 * is removed, leads stay in the workspace with no list, and
 * campaigns attached to a deleted list keep existing, detached.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "ids must be an array of lead list ids" }, { status: 400 });
    }
    if (body.ids.length === 0) {
      return NextResponse.json({ error: "Select at least one list to delete" }, { status: 400 });
    }
    if (body.ids.length > MAX_BULK_DELETE_IDS) {
      return NextResponse.json(
        { error: `Select at most ${MAX_BULK_DELETE_IDS} lists at a time` },
        { status: 400 },
      );
    }
    const result = await bulkDeleteLeadLists(prisma, ctx.workspace.id, body.ids);
    await writeAuditLog({
      action: "leadlist.bulk_delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { deletedCount: result.deletedCount, listIds: result.deletedIds },
    });
    return NextResponse.json({ ...result, leadsKept: true });
  } catch (error) {
    return apiError(error);
  }
}
