import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { changeMemberRole, removeMember } from "@/lib/team/invites";
import { writeAuditLog } from "@/lib/audit";

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

/**
 * Role change and member removal. Both go through the team service,
 * which enforces the last owner guards; removing yourself is refused
 * here so an admin cannot lock themselves out by accident.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { userId } = await params;
  const body = await readJson<{ role?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const role = stringField(body.role);
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    return NextResponse.json({ error: `Unknown role "${role}"` }, { status: 400 });
  }
  try {
    await changeMemberRole(prisma, {
      workspaceId: ctx.workspace.id,
      userId,
      role: role as (typeof ROLES)[number],
    });
    await writeAuditLog({
      action: "team.role_change",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { memberUserId: userId, role },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { userId } = await params;
  if (userId === ctx.user.id) {
    return NextResponse.json(
      { error: "You cannot remove yourself. Ask another admin, or transfer ownership first." },
      { status: 400 },
    );
  }
  try {
    await removeMember(prisma, { workspaceId: ctx.workspace.id, userId });
    await writeAuditLog({
      action: "team.member_remove",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { memberUserId: userId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
