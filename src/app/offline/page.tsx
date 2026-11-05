import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline, ColdReach",
  description: "ColdReach needs a connection to load your workspace.",
};

/**
 * Shown by the service worker when a navigation fails with no
 * network. This page is public on purpose: it carries no workspace
 * data, which is exactly why it is safe for the worker to cache.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-accent font-display text-base font-bold text-white">
          CR
        </span>
        <h1 className="mt-5 font-display text-xl font-semibold tracking-tight">
          You are offline
        </h1>
        <p className="mt-2 text-sm text-muted">
          ColdReach needs a connection to load your campaigns, leads, and inbox.
          Your sending keeps running on the server, nothing is paused or lost.
        </p>
        <a href="/app" className="btn-primary mt-6">
          Try again
        </a>
      </div>
    </main>
  );
}
