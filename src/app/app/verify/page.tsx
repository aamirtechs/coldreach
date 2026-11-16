import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canUseVerification } from "@/lib/admin/featureAccess";
import { VerifyTool } from "@/components/verify/VerifyTool";

export const dynamic = "force-dynamic";

/**
 * Verify Emails (v1.35.0): standalone verification from the sidebar.
 * Paste addresses or upload a CSV, watch the checks run live, and
 * download the results as CSV. Nothing is written to any lead list;
 * the import wizard remains the path for verified imports.
 */
export default async function VerifyPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  // Verification is owner-only until the platform admin opens it
  // to everyone (v1.36.0); other users get the Coming soon panel.
  if (!(await canUseVerification(prisma, session.user.email))) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Verify Emails</h1>
        <section className="card mt-6 p-6">
          <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Coming soon
          </span>
          <p className="mt-3 max-w-xl text-sm text-muted">
            Email verification is not open yet. When it launches, this tool will check whether
            addresses can really receive mail before you send to them: syntax, domain mail
            records, and a live mailbox probe. Watch this space.
          </p>
        </section>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Verify Emails</h1>
      <p className="mt-1 text-sm text-muted">
        Check whether addresses can really receive mail before you send to them: syntax, domain
        mail records, and a live mailbox probe, the same engine the import wizard uses.
      </p>
      <VerifyTool />
    </div>
  );
}
