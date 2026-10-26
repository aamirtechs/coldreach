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
    const lead = await prisma.lead.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, email: true },
    });
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    await prisma.lead.delete({ where: { id: lead.id } });
    await writeAuditLog({
      action: "lead.delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { leadId: lead.id, email: lead.email },
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
