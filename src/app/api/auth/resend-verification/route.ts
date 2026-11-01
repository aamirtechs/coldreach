import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuthRateLimit, clientIp, rateLimitedResponse } from "@/lib/auth/rateLimit";
import { sendVerificationEmail, verificationRequired } from "@/lib/auth/emailVerification";
import { writeAuditLog } from "@/lib/audit";

/**
 * Resend a signup verification email (v1.14.0).
 *
 * The response is deliberately generic: it confirms the request was
 * accepted whether or not the address has an unverified account, so
 * the endpoint cannot be used to enumerate accounts. A fresh email
 * is sent only when the account exists, is unverified, and product
 * mail is configured. Rate limited like the other auth endpoints.
 */
export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const limit = checkAuthRateLimit(`resend-verification:${clientIp(request)}:${email}`);
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  if (verificationRequired()) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      const mail = await sendVerificationEmail(prisma, user);
      await writeAuditLog({
        action: "auth.verification_resent",
        userId: user.id,
        metadata: { email: user.email, sent: mail.sent },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
