import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifyEmailToken } from "@/lib/auth/emailVerification";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, { title: string; body: string }> = {
  success: {
    title: "Email verified",
    body: "Your email address is verified and your account is ready. Sign in to open your workspace.",
  },
  used: {
    title: "Already verified",
    body: "This link was already used, which means your email address is verified. Sign in to continue.",
  },
  expired: {
    title: "Link expired",
    body: "Verification links work for 24 hours. Sign in with your email and password and use the resend option to get a fresh link.",
  },
  invalid: {
    title: "Link not recognised",
    body: "This verification link is not valid. It may have been replaced by a newer one. Sign in and use the resend option to get a fresh link.",
  },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token ? await verifyEmailToken(prisma, token) : { ok: false, reason: "invalid" as const };
  const message = MESSAGES[result.ok ? "success" : result.reason];

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-display text-sm font-bold text-white">
            CR
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">ColdReach</span>
        </div>
        <div className="card p-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{message.title}</h1>
          <p className="mt-2 text-sm text-muted">{message.body}</p>
          <Link href="/login" className="btn-primary mt-6 inline-block px-5 py-2.5">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
