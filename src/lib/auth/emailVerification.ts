import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  isProductMailConfigured,
  sendProductEmail,
  type ProductMailFetch,
  type ProductMailResult,
} from "@/lib/mail/productMail";

/**
 * Signup email verification (v1.14.0).
 *
 * New accounts must prove they own the email address they signed up
 * with: signup issues a single-use token (24 hour expiry, only its
 * SHA-256 hash is stored) and emails a /verify-email link through
 * the product mail sender. Login is refused until the address is
 * verified.
 *
 * Enforcement is configuration-gated: verification is required only
 * while product mail is configured (RESEND_API_KEY set). Before the
 * key exists, signup keeps the previous instant-access behaviour,
 * so turning verification on is a configuration change, not a
 * deploy risk. Accounts created while enforcement is on carry
 * requiresEmailVerification and are gated at login until verified.
 * Older accounts are never gated; while signed in they see an
 * announcement bar prompting them to verify, and verifying through
 * it simply sets emailVerifiedAt.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function verificationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return isProductMailConfigured(env);
}

/**
 * The login gate: only accounts created under enforcement are ever
 * blocked, and only while enforcement is on and they remain
 * unverified. Everyone else signs in freely (the announcement bar
 * handles prompting pre-enforcement accounts).
 */
export function isLoginBlockedByVerification(
  user: { emailVerifiedAt: Date | null; requiresEmailVerification: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return verificationRequired(env) && user.requiresEmailVerification && !user.emailVerifiedAt;
}

export function hashVerificationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Issues a fresh token for the user, invalidating any earlier one. Returns the raw token. */
export async function issueVerificationToken(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  const rawToken = randomBytes(32).toString("base64url");
  await db.emailVerificationToken.deleteMany({ where: { userId } });
  await db.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hashVerificationToken(rawToken),
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
    },
  });
  return rawToken;
}

export function buildVerificationUrl(rawToken: string, env: NodeJS.ProcessEnv = process.env): string {
  const appUrl = (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${appUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;
}

/** Issues a token and emails the verification link. Never throws. */
export async function sendVerificationEmail(
  db: PrismaClient,
  user: { id: string; email: string; name: string },
  deps: { env?: NodeJS.ProcessEnv; fetchImpl?: ProductMailFetch } = {},
): Promise<ProductMailResult> {
  const rawToken = await issueVerificationToken(db, user.id);
  const url = buildVerificationUrl(rawToken, deps.env);
  return sendProductEmail(
    {
      to: user.email,
      subject: "Verify your ColdReach email address",
      text: [
        `Hi ${user.name},`,
        "",
        "Welcome to ColdReach. Please verify your email address to finish creating your account:",
        "",
        url,
        "",
        "The link works once and expires in 24 hours. If you did not sign up for ColdReach, you can ignore this email.",
      ].join("\n"),
      html: `<p>Hi ${user.name},</p><p>Welcome to ColdReach. Please verify your email address to finish creating your account:</p><p><a href="${url}">Verify my email address</a></p><p>The link works once and expires in 24 hours. If you did not sign up for ColdReach, you can ignore this email.</p>`,
    },
    deps,
  );
}

export type VerifyEmailResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/** Consumes a token: marks the user verified and the token used. */
export async function verifyEmailToken(
  db: PrismaClient,
  rawToken: string,
  now: Date = new Date(),
): Promise<VerifyEmailResult> {
  if (!rawToken) {
    return { ok: false, reason: "invalid" };
  }
  const token = await db.emailVerificationToken.findUnique({
    where: { tokenHash: hashVerificationToken(rawToken) },
  });
  if (!token) {
    return { ok: false, reason: "invalid" };
  }
  if (token.usedAt) {
    return { ok: false, reason: "used" };
  }
  if (token.expiresAt.getTime() < now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: now },
    });
    await tx.emailVerificationToken.update({
      where: { id: token.id },
      data: { usedAt: now },
    });
    await tx.emailVerificationToken.deleteMany({
      where: { userId: token.userId, id: { not: token.id } },
    });
  });
  return { ok: true, userId: token.userId };
}
