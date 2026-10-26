import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { computeCampaignMetrics, type MetricEvent } from "@/lib/domain/metrics";
import { EmptyState, StatusBadge, formatPercent } from "@/components/ui";

export const dynamic = "force-dynamic";

function Bar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="inline-block h-2 w-20 overflow-hidden rounded bg-elevated align-middle">
      <span className="block h-full bg-accent" style={{ width: `${width}%` }} />
    </span>
  );
}

export default async function AnalyticsPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const workspaceId = session.workspace.id;

  const campaigns = await prisma.campaign.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true },
  });

  const rows: { id: string; name: string; status: string; metrics: ReturnType<typeof computeCampaignMetrics> }[] = [];
  let anyEvents = false;
  for (const campaign of campaigns) {
    const events = await prisma.emailEvent.findMany({
      where: { workspaceId, campaignId: campaign.id },
      select: { type: true, classification: true },
    });
    if (events.length > 0) anyEvents = true;
    rows.push({ ...campaign, metrics: computeCampaignMetrics(events as MetricEvent[]) });
  }

  const maxSent = Math.max(0, ...rows.map((r) => r.metrics.sent));
  const simulatedCampaignIds = new Set(
    (
      await prisma.emailEvent.findMany({
        where: { workspaceId, type: "SENT", sendingAccount: { provider: "SIMULATION" } },
        select: { campaignId: true },
        distinct: ["campaignId"],
      })
    )
      .map((row) => row.campaignId)
      .filter((id): id is string => Boolean(id)),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
      <p className="mt-1 text-sm text-muted">
        Every number below is computed live from recorded email events by the metrics engine.
        Rates use delivered volume as the denominator, except delivery and bounce rates, which
        use sent volume. Nothing is estimated.
      </p>

      {campaigns.length === 0 || !anyEvents ? (
        <EmptyState
          title="No campaign events yet"
          body="Analytics fill in when campaigns send and provider events (delivered, bounced, replied) are recorded. Until then there is honestly nothing to chart."
        />
      ) : (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">Delivered</th>
                <th className="px-4 py-3 font-medium">Bounce rate</th>
                <th className="px-4 py-3 font-medium">Reply rate</th>
                <th className="px-4 py-3 font-medium">Positive</th>
                <th className="px-4 py-3 font-medium">Unsub rate</th>
                <th className="px-4 py-3 font-medium">Opens (unreliable)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0 hover:bg-elevated/60">
                  <td className="px-4 py-3">
                    <Link href={`/app/campaigns/${row.id}`} className="font-medium text-accent hover:underline">
                      {row.name}
                    </Link>
                    <span className="ml-2 align-middle"><StatusBadge status={row.status} /></span>
                    {simulatedCampaignIds.has(row.id) ? (
                      <p className="mt-0.5 text-xs text-muted">Includes DEMO sends from simulation accounts.</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="mr-2">{row.metrics.sent}</span>
                    <Bar value={row.metrics.sent} max={maxSent} />
                  </td>
                  <td className="px-4 py-3">{row.metrics.delivered}</td>
                  <td className="px-4 py-3">{formatPercent(row.metrics.rates.bounceRate)}</td>
                  <td className="px-4 py-3">{formatPercent(row.metrics.rates.replyRate)}</td>
                  <td className="px-4 py-3">{row.metrics.positiveReplies}</td>
                  <td className="px-4 py-3">{formatPercent(row.metrics.rates.unsubscribeRate)}</td>
                  <td className="px-4 py-3 text-muted">{row.metrics.opens.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-muted">
        Opens are reported as a raw count in their own column because mail privacy features make
        them unreliable: some clients prefetch tracking pixels and invent opens, others block them
        entirely. They are never used as a denominator.
      </p>
    </div>
  );
}
