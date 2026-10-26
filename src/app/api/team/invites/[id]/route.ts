import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

/** Revokes a pending invite by expiring it immediately. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const invite = await prisma.invite.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
    });
    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (invite.acceptedAt) {
      return NextResponse.json({ error: "This invite was already accepted." }, { status: 409 });
    }
    await prisma.invite.delete({ where: { id } });
    await writeAuditLog({
      action: "team.invite_revoke",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { inviteId: id, email: invite.email },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
