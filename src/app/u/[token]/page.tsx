import { prisma } from "@/lib/prisma";
import { applyUnsubscribe, verifyUnsubscribeToken } from "@/lib/worker/unsubscribe";

export const dynamic = "force-dynamic";

/**
 * Public unsubscribe endpoint. No login: the signed HMAC token in the
 * link is the credential. Applying it is immediate and idempotent.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claims = verifyUnsubscribeToken(token);

  let message = "This unsubscribe link is invalid or has expired.";
  let applied = false;
  if (claims) {
    const result = await applyUnsubscribe(prisma, claims);
    if (result.applied) {
      applied = true;
      message = "You have been unsubscribed. You will not receive further emails from this sender through ColdReach.";
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="card max-w-md p-8 text-center">
        <h1 className="font-display text-xl font-semibold">
          {applied ? "Unsubscribed" : "Unsubscribe"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{message}</p>
        {applied ? (
          <p className="mt-4 text-xs text-muted">
            The address has also been added to the sender's suppression list, so it cannot be
            re-imported into future campaigns in that workspace by accident.
          </p>
        ) : null}
      </div>
    </main>
  );
}
