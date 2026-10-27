"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Branded error boundary for route segments. Shows a stable support
 * reference (the error digest) instead of any internal detail, and
 * offers the two useful actions: retry the segment, or go home.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client errors are not forwarded anywhere by default; the
    // server logger (src/lib/log.ts) covers server-side failures.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="card w-full max-w-md p-8 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-accent">
          ColdReach
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted">
          This page hit an unexpected error. Your data is not affected; the failure happened
          while rendering this screen.
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-muted">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
          <Link href="/app" className="btn-secondary">
            Go to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
