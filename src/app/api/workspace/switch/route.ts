import { NextResponse } from "next/server";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { assertMembership, listUserWorkspaces } from "@/lib/auth/workspaces";

/**
 * Workspace switching for the topbar. The session JWT carries one
 * active workspace claim; switching verifies membership and re-issues
 * the token with the new claim, so every tenant scoped query follows
 * automatically. No parallel cookie state to fall out of sync.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const workspaces = await listUserWorkspaces(session.ctx.user.id);
  return NextResponse.json({ workspaces, activeId: session.ctx.workspace.id });
}

export async function POST(request: Request) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ workspaceId?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const workspaceId = stringField(body.workspaceId);
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  try {
    const target = await assertMembership(ctx.user.id, workspaceId);
    const token = await createSessionToken(ctx.user.id, target.id);
    await setSessionCookie(token);
    return NextResponse.json({ workspace: target });
  } catch (error) {
    return apiError(error);
  }
}
