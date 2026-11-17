import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { deleteOrphanLeads, summarizeOrphanLeads } from "@/lib/leads/orphanLeads";
import { writeAuditLog } from "@/lib/audit";

/**
 * Orphan leads (v1.41.0).
 *
 * GET reports how many leads in this workspace sit in no list
 * and no campaign (orphans), and how many are unlisted but
 * enrolled (in use, never deleted). DELETE removes the orphans
 * only. Both are scoped to the caller's workspace.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  try {
    const summary = await summarizeOrphanLeads(prisma, session.ctx.workspace.id);
    return NextResponse.json(summary);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const result = await deleteOrphanLeads(prisma, ctx.workspace.id);
    await writeAuditLog({
      action: "lead.orphans_delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { deletedCount: result.deletedCount },
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
