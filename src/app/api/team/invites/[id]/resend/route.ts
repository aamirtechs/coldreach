import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { resendInvite } from "@/lib/team/invites";
import { writeAuditLog } from "@/lib/audit";

/**
 * Issues a fresh token and expiry for a pending invite and returns
 * the new accept link (the old link stops working immediately).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const invite = await resendInvite(prisma, { workspaceId: ctx.workspace.id, inviteId: id });
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    await writeAuditLog({
      action: "team.invite_resend",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { inviteId: invite.id, email: invite.email },
    });
    return NextResponse.json({
      invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt },
      acceptUrl: `${appUrl}${invite.acceptPath}`,
    });
  } catch (error) {
    return apiError(error);
  }
}
