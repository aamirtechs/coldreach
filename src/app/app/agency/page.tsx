import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getAgencyRollup } from "@/lib/agency/rollup";
import { CreateWorkspaceForm, SwitchWorkspaceButton } from "@/components/agency/AgencyActions";
import { formatPercent } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Agency Command Center: one rollup across every workspace the
 * signed-in user OWNS. With a single owned workspace there is
 * nothing to roll up, so the page explains the feature and offers
 * workspace creation instead of an empty dashboard.
 */
export default async function AgencyPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const rollup = await getAgencyRollup(prisma, session.user.id);
  const ownedCount = rollup.workspaces.length;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Agency Command Center</h1>
      <p className="mt-1 text-sm text-muted">
        Every workspace you own, in one view. Numbers are this month's real events; workspaces you
        are only a member of are never included, because they belong to someone else's rollup.
      </p>

      {ownedCount <= 1 ? (
        <section className="card mt-6 p-6">
          <h2 className="font-display text-lg font-semibold">You own {ownedCount} workspace</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            The Command Center rolls up sending, replies, bounces, active campaigns, and health
            flags across all the workspaces you own, which is what an agency running one workspace
            per client needs. Create a second workspace (for a client, a brand, or a separate
            sending operation) and this page becomes the rollup. Each workspace keeps its own
            leads, campaigns, suppressions, plan, and billing; nothing is shared between them
            except this view and the global suppression list.
          </p>
          <CreateWorkspaceForm />
        </section>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Sends this month", value: String(rollup.totals.sendsThisMonth) },
              { label: "Replies this month", value: String(rollup.totals.repliesThisMonth) },
              { label: "Reply rate", value: formatPercent(rollup.totals.replyRate) },
              { label: "Bounce rate", value: formatPercent(rollup.totals.bounceRate) },
              { label: "Active campaigns", value: String(rollup.totals.activeCampaigns) },
              { label: "Accounts in ERROR", value: String(rollup.totals.accountsInError) },
              { label: "Bounces this month", value: String(rollup.totals.bouncesThisMonth) },
              { label: "Workspaces owned", value: String(ownedCount) },
            ].map((card) => (
              <div key={card.label} className="card p-4">
                <p className="text-xs text-muted">{card.label}</p>
                <p className="mt-1 font-display text-2xl font-semibold">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="card mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Workspace</th>
                  <th className="px-4 py-3 font-medium">Active campaigns</th>
                  <th className="px-4 py-3 font-medium">Sends</th>
                  <th className="px-4 py-3 font-medium">Reply rate</th>
                  <th className="px-4 py-3 font-medium">Bounce rate</th>
                  <th className="px-4 py-3 font-medium">Health</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rollup.workspaces.map((row) => (
                  <tr key={row.workspaceId} className="border-b border-line last:border-0 hover:bg-elevated/60">
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3">{row.activeCampaigns}</td>
                    <td className="px-4 py-3">{row.sendsThisMonth}</td>
                    <td className="px-4 py-3">{formatPercent(row.replyRate)}</td>
                    <td className="px-4 py-3">{formatPercent(row.bounceRate)}</td>
                    <td className="px-4 py-3">
                      {row.flags.length === 0 ? (
                        <span className="text-muted">No flags</span>
                      ) : (
                        <ul className="space-y-0.5 text-warning">
                          {row.flags.map((flag) => (
                            <li key={flag}>{flag}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SwitchWorkspaceButton
                        workspaceId={row.workspaceId}
                        current={row.workspaceId === session.workspace.id}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="card mt-6 p-6">
            <h2 className="font-display text-lg font-semibold">Add another workspace</h2>
            <CreateWorkspaceForm />
          </section>
        </>
      )}
    </div>
  );
}
