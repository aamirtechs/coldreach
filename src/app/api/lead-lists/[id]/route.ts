import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const list = await prisma.leadList.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, name: true },
    });
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    // Leads keep existing; only their list membership is cleared, which
    // matches the schema's SetNull behaviour. State that in the response.
    await prisma.leadList.delete({ where: { id: list.id } });
    await writeAuditLog({
      action: "leadlist.delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { listId: list.id, name: list.name },
    });
    return NextResponse.json({ deleted: true, leadsKept: true });
  } catch (error) {
    return apiError(error);
  }
}
