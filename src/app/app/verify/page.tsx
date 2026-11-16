import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
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
