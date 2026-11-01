"use client";

import { useState } from "react";

/**
 * Announcement bar prompting an unverified signed-in user to verify
 * their email address (v1.14.0). Shown by the app layout whenever
 * verification is enforced and the account has no emailVerifiedAt.
 * The button emails a fresh verification link through the generic
 * resend endpoint; the link itself completes verification on the
 * /verify-email page.
 */
export function VerificationBar({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  async function send() {
    setState("sending");
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setState("sent");
    } catch {
      setState("idle");
    }
  }

  return (
    <div className="border-b border-line bg-accent/10 px-4 py-2.5 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <p>Your email address is not verified yet. Verify it to keep your account secure.</p>
        {state === "sent" ? (
          <p className="font-medium text-accent">
            Verification email sent to {email}. Check your inbox.
          </p>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={state === "sending"}
            className="font-medium text-accent hover:underline"
          >
            {state === "sending" ? "Sending..." : "Send verification email"}
          </button>
        )}
      </div>
    </div>
  );
}
