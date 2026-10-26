import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, stringField } from "@/lib/api";
import { getSessionWorkspace, createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { acceptInvite } from "@/lib/team/invites";
import { writeAuditLog } from "@/lib/audit";

/**
 * Accepts an invitation for the signed-in user. The invite email must
 * match the account email. On success the session switches to the
 * joined workspace so the new member lands inside it.
 */
export async function POST(request: Request) {
  const session = await getSessionWorkspace();
  if (!session) {
    return NextResponse.json(
      { error: "Sign in or create an account with the invited email first." },
      { status: 401 },
    );
  }
  const body = await readJson<{ token?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const token = stringField(body.token);
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }
  try {
    const result = await acceptInvite(prisma, {
      token,
      userId: session.user.id,
      userEmail: session.user.email,
    });
    await writeAuditLog({
      action: "team.invite_accept",
      userId: session.user.id,
      workspaceId: result.workspaceId,
      metadata: { role: result.role, alreadyMember: result.alreadyMember },
    });
    const freshToken = await createSessionToken(session.user.id, result.workspaceId);
    await setSessionCookie(freshToken);
    return NextResponse.json({ workspaceId: result.workspaceId, role: result.role });
  } catch (error) {
    return apiError(error);
  }
}
