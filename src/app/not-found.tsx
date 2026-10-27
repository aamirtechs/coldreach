import Link from "next/link";

/** Branded 404 for unknown routes, in the app design system. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="card w-full max-w-md p-8 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-accent">
          ColdReach
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted">
          The page you are looking for does not exist, or the link has moved.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link href="/app" className="btn-primary">
            Go to dashboard
          </Link>
          <Link href="/" className="btn-secondary">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
