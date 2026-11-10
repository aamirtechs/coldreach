import { notFound, redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getPlatformStats, isPlatformOwner, type DayBucket } from "@/lib/admin/platform";
import { listPlatformTickets } from "@/lib/support/tickets";
import { SupportTicketsAdmin } from "@/components/support/SupportTicketsAdmin";

export const dynamic = "force-dynamic";

function Bar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="inline-block h-2 w-24 overflow-hidden rounded bg-elevated align-middle">
      <span className="block h-full bg-accent" style={{ width: `${width}%` }} />
    </span>
  );
}

function DaySeries({ title, buckets }: { title: string; buckets: DayBucket[] }) {
  const shown = buckets.slice(-14);
  const max = Math.max(0, ...shown.map((bucket) => bucket.count));
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return (
    <section className="card p-5">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      <p className="mt-1 text-xs text-muted">{total} in the last 30 days</p>
      <table className="mt-4 w-full text-sm">
        <tbody>
          {shown.map((bucket) => (
            <tr key={bucket.day} className="border-t border-line first:border-t-0">
              <td className="py-1.5 pr-3 text-muted">{bucket.day}</td>
              <td className="py-1.5 pr-3">
                <Bar value={bucket.count} max={max} />
              </td>
              <td className="py-1.5 text-right font-medium">{bucket.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function PlatformAdminPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  // Platform owner only. Everyone else gets a 404, so the panel's
  // existence is not advertised to customer accounts.
  if (!isPlatformOwner(session.user.email)) {
    notFound();
  }

  const stats = await getPlatformStats(prisma, new Date());
  const supportTickets = await listPlatformTickets(prisma, 50);

  const cards = [
    { label: "Users", value: stats.totals.users, note: "Registered accounts, all workspaces" },
    { label: "Workspaces", value: stats.totals.workspaces, note: "Tenants on the platform" },
    {
      label: "Campaigns",
      value: stats.totals.campaigns,
      note: `${stats.totals.runningCampaigns} running right now`,
    },
    {
      label: "Emails sent",
      value: stats.events.SENT,
      note: `${stats.events.REPLIED} replies, ${stats.events.BOUNCED} bounces, all time`,
    },
    {
      label: "Sending accounts",
      value: stats.totals.sendingAccounts,
      note: `${stats.totals.connectedAccounts} connected`,
    },
    { label: "Leads", value: stats.totals.leads, note: "Across every workspace" },
    { label: "Enrollments", value: stats.totals.enrollments, note: "Leads in sequences, all time" },
    {
      label: "Opens / clicks",
      value: `${stats.events.OPENED} / ${stats.events.CLICKED}`,
      note: "Tracked events, all time",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Platform admin</h1>
      <p className="mt-1 text-sm text-muted">
        Platform-wide totals for ColdReach. Aggregates only: this page never shows another
        workspace's leads, emails, or campaign content.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <section key={card.label} className="card p-5">
            <h2 className="text-sm font-medium text-muted">{card.label}</h2>
            <p className="mt-2 font-display text-3xl font-semibold">{card.value}</p>
            <p className="mt-1 text-xs text-muted">{card.note}</p>
          </section>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <DaySeries title="Signups per day" buckets={stats.signupsByDay} />
        <DaySeries title="Emails sent per day" buckets={stats.sendsByDay} />
      </div>

      <section className="card mt-6 p-5">
        <h2 className="text-sm font-medium text-muted">Plan mix</h2>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {Object.entries(stats.planMix).map(([plan, count]) => (
            <p key={plan}>
              <span className="font-medium">{plan}</span>{" "}
              <span className="text-muted">
                {count} workspace{count === 1 ? "" : "s"}
              </span>
            </p>
          ))}
        </div>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="text-sm font-medium text-muted">Support tickets</h2>
        <p className="mt-1 text-xs text-muted">
          Every ticket from the in-app Support page, newest first. Tickets live here even when
          the notification email is not configured, so nothing is lost. Open a ticket to read
          the full message and set its status.
        </p>
        <SupportTicketsAdmin
          tickets={supportTickets.map((ticket) => ({
            id: ticket.id,
            subject: ticket.subject,
            category: ticket.category,
            message: ticket.message,
            userEmail: ticket.userEmail,
            workspaceId: ticket.workspaceId,
            workspaceName: ticket.workspaceName,
            status: ticket.status,
            createdAt: ticket.createdAt.toISOString(),
            updatedAt: ticket.updatedAt.toISOString(),
          }))}
        />
      </section>

      <section className="card mt-6 p-5">
        <h2 className="text-sm font-medium text-muted">Most recent workspaces</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2 pr-3 font-medium">Workspace</th>
                <th className="py-2 pr-3 font-medium">Owner</th>
                <th className="py-2 pr-3 font-medium">Plan</th>
                <th className="py-2 pr-3 font-medium">Joined</th>
                <th className="py-2 pr-3 text-right font-medium">Members</th>
                <th className="py-2 pr-3 text-right font-medium">Campaigns</th>
                <th className="py-2 text-right font-medium">Sends</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentWorkspaces.map((workspace) => (
                <tr key={workspace.id} className="border-t border-line">
                  <td className="py-2 pr-3 font-medium">{workspace.name}</td>
                  <td className="py-2 pr-3 text-muted">
                    {workspace.ownerName ?? "Unknown"}
                    {workspace.ownerEmail ? ` (${workspace.ownerEmail})` : ""}
                  </td>
                  <td className="py-2 pr-3">{workspace.plan}</td>
                  <td className="py-2 pr-3 text-muted">{workspace.createdAt.slice(0, 10)}</td>
                  <td className="py-2 pr-3 text-right">{workspace.members}</td>
                  <td className="py-2 pr-3 text-right">{workspace.campaigns}</td>
                  <td className="py-2 text-right">{workspace.sends}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
