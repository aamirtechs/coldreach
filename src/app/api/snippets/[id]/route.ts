import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

/**
 * Delete one snippet. The lookup is scoped to the session workspace, so
 * a snippet id from another workspace reads as not found and is never
 * deleted.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const snippet = await prisma.snippet.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!snippet) {
      return NextResponse.json({ error: "Snippet not found" }, { status: 404 });
    }
    await prisma.snippet.delete({ where: { id: snippet.id } });
    await writeAuditLog({
      action: "snippet.delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { snippetId: snippet.id },
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
