import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { authRateLimitKey, checkAuthRateLimit, rateLimitedResponse } from "@/lib/auth/rateLimit";
import { writeAuditLog } from "@/lib/audit";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "workspace";
}

export async function POST(request: Request) {
  let body: { name?: unknown; email?: unknown; password?: unknown; workspaceName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const workspaceName =
    typeof body.workspaceName === "string" && body.workspaceName.trim()
      ? body.workspaceName.trim()
      : `${name || "My"} workspace`;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }
  const limit = checkAuthRateLimit(authRateLimitKey("signup", request, email));
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }
  if (password.length < 10) {
    return NextResponse.json(
      { error: "Password must be at least 10 characters" },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const slug = `${slugify(workspaceName)}-${Math.random().toString(36).slice(2, 8)}`;

  const { user, workspace } = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: { name, email, passwordHash },
    });
    const createdWorkspace = await tx.workspace.create({
      data: { name: workspaceName, slug },
    });
    await tx.membership.create({
      data: { userId: createdUser.id, workspaceId: createdWorkspace.id, role: "OWNER" },
    });
    return { user: createdUser, workspace: createdWorkspace };
  });

  await writeAuditLog({
    action: "auth.signup",
    userId: user.id,
    workspaceId: workspace.id,
    metadata: { email: user.email },
  });

  const token = await createSessionToken(user.id, workspace.id);
  await setSessionCookie(token);

  return NextResponse.json(
    {
      user: { id: user.id, name: user.name, email: user.email },
      workspace: { id: workspace.id, name: workspace.name },
      role: "OWNER",
    },
    { status: 201 },
  );
}
