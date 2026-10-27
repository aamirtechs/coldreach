import { prisma } from "@/lib/prisma";
import { activationUrl, getIntegrationStatuses } from "@/lib/integrations/status";
import { hubspotConfigured, hubspotMissingEnv, HUBSPOT_PROVIDER } from "@/lib/crm/hubspot";
import { HubSpotCard, type HubSpotCardProps } from "./HubSpotCard";

/**
 * Integrations status panel (Settings, Phase 6 Stage A).
 *
 * Server rendered from env presence checks and database counts via
 * getIntegrationStatuses. A row only ever names the environment
 * variables that are missing; no value or fragment of one is shown.
 * The HubSpot row renders as its own card because it carries
 * connection state and actions.
 */
export async function IntegrationsStatusPanel({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: string;
}) {
  const canManage = role === "ADMIN" || role === "OWNER";
  const [rows, connection] = await Promise.all([
    getIntegrationStatuses(prisma, workspaceId),
    prisma.crmConnection.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: HUBSPOT_PROVIDER } },
      select: { status: true, externalAccountId: true, lastSyncAt: true, lastSyncSummary: true },
    }),
  ]);
  const listRows = rows.filter((row) => row.id !== "hubspot");
  type HubSpotSummary = NonNullable<HubSpotCardProps["connection"]>["lastSyncSummary"];
  const rawSummary = connection?.lastSyncSummary;
  const hubspotConnection: HubSpotCardProps["connection"] = connection
    ? {
        status: connection.status,
        externalAccountId: connection.externalAccountId,
        lastSyncAt: connection.lastSyncAt ? connection.lastSyncAt.toISOString() : null,
        lastSyncSummary:
          rawSummary && typeof rawSummary === "object" && !Array.isArray(rawSummary)
            ? (rawSummary as Exclude<HubSpotSummary, null>)
            : null,
      }
    : null;

  return (
    <section className="card mt-6 p-6">
      <h2 className="font-display text-lg font-semibold">Integrations status</h2>
      <p className="mt-1 text-sm text-muted">
        Live from this server's configuration and this workspace's data. A "Not configured" row
        names the exact environment variables the owner still has to set; nothing here shows a
        secret value. Setup steps for every row are in ACTIVATION.md.
      </p>
      <div className="mt-4 divide-y divide-line">
        {listRows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 max-w-xl">
              <p className="text-sm font-medium">{row.label}</p>
              <p className="mt-0.5 text-sm text-muted">{row.detail}</p>
              {row.missingEnv.length > 0 ? (
                <p className="mt-1 font-mono text-xs text-warning">
                  Missing: {row.missingEnv.join(", ")}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  row.configured
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                }`}
              >
                {row.configured ? "Configured" : "Not configured"}
              </span>
              <a
                className="text-sm text-accent hover:underline"
                href={activationUrl(row.activationAnchor)}
                target="_blank"
                rel="noreferrer"
              >
                Setup steps
              </a>
            </div>
          </div>
        ))}
      </div>
      <HubSpotCard
        configured={hubspotConfigured()}
        missingEnv={hubspotMissingEnv()}
        canManage={canManage}
        connection={hubspotConnection}
      />
    </section>
  );
}
