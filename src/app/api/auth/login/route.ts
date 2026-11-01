import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { authRateLimitKey, checkAuthRateLimit, rateLimitedResponse } from "@/lib/auth/rateLimit";
import { isLoginBlockedByVerification } from "@/lib/auth/emailVerification";
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

  const limit = checkAuthRateLimit(authRateLimitKey("login", request, email));
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
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

  // Email verification gate (v1.14.0): the password is proven, so it
  // is safe to say plainly that the address is not verified yet and
  // offer a fresh link. Only accounts created under enforcement are
  // gated; pre-enforcement accounts are prompted by the announcement
  // bar instead and never blocked.
  if (isLoginBlockedByVerification(user)) {
    return NextResponse.json(
      {
        error:
          "Your email address is not verified yet. Use the verification link we emailed you, or request a new one below.",
        code: "email_unverified",
        email: user.email,
      },
      { status: 403 },
    );
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
