import { NextResponse } from "next/server";
import { clearSessionCookie, getSessionWorkspace } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";

export async function POST() {
  const session = await getSessionWorkspace();
  if (session) {
    await writeAuditLog({
      action: "auth.logout",
      userId: session.user.id,
      workspaceId: session.workspace.id,
    });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
