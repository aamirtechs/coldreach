import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { BillingPanel } from "@/components/billing/BillingPanel";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Billing</h1>
      <p className="mt-1 text-sm text-muted">
        The plan this workspace is on, what it has used this month, and how the limits are enforced:
        preflight refuses a campaign whose projected sends exceed the remaining quota, and the
        worker hard-stops at the limit.
      </p>
      <BillingPanel isOwner={session.role === "OWNER"} />
    </div>
  );
}
