import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { WorkspaceSettingsForm } from "@/components/settings/WorkspaceSettingsForm";
import { SuppressionManager } from "@/components/settings/SuppressionManager";
import { ExportPanel } from "@/components/settings/ExportPanel";
import { IntegrationsStatusPanel } from "@/components/settings/IntegrationsStatusPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ crm?: string; detail?: string }>;
}) {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const { crm, detail } = await searchParams;
  const canEdit = session.role === "ADMIN" || session.role === "OWNER";
  const suppressions = await prisma.suppression.findMany({
    where: { OR: [{ workspaceId: session.workspace.id }, { scope: "GLOBAL" }] },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted">
        Workspace identity and the suppression list. Plans and usage live on the Billing page;
        API keys and webhooks live on the Integrations page.
      </p>
      {crm ? (
        <div
          className={`mt-4 rounded-lg border p-4 text-sm ${
            crm === "connected" ? "border-emerald-500/40" : "border-amber-500/40"
          }`}
          role="status"
        >
          {crm === "connected"
            ? `HubSpot connected${detail ? `: ${detail}` : ""}. Use Sync now on the HubSpot card below to push leads.`
            : `HubSpot connection did not complete${detail ? `: ${detail}` : ""}. Check the HubSpot card below and try again.`}
        </div>
      ) : null}
      <div className="mt-6">
        <WorkspaceSettingsForm
          canEdit={canEdit}
          initial={{
            name: session.workspace.name,
            senderName: session.workspace.senderName ?? "",
            senderAddress: session.workspace.senderAddress ?? "",
          }}
        />
      </div>
      <IntegrationsStatusPanel workspaceId={session.workspace.id} role={session.role} />
      {session.role === "OWNER" ? <ExportPanel /> : null}
      <SuppressionManager
        canEdit={canEdit || session.role === "MEMBER"}
        initial={suppressions.map((row) => ({
          id: row.id,
          scope: row.scope,
          email: row.email,
          domain: row.domain,
          reason: row.reason,
          createdAt: row.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
