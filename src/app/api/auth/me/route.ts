import { NextResponse } from "next/server";
import { getSessionWorkspace } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionWorkspace();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    workspace: { id: session.workspace.id, name: session.workspace.name },
    role: session.role,
  });
}
