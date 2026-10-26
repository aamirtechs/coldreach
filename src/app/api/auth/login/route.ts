import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        include: { workspace: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  // A single generic error avoids revealing whether the email exists.
  const invalid = NextResponse.json(
    { error: "Invalid email or password" },
    { status: 401 },
  );
  if (!user) {
    return invalid;
  }
  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    return invalid;
  }
  const membership = user.memberships[0];
  if (!membership) {
    return invalid;
  }

  await writeAuditLog({
    action: "auth.login",
    userId: user.id,
    workspaceId: membership.workspace.id,
    metadata: { email: user.email },
  });

  const token = await createSessionToken(user.id, membership.workspace.id);
  await setSessionCookie(token);

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
    workspace: { id: membership.workspace.id, name: membership.workspace.name },
    role: membership.role,
  });
}
