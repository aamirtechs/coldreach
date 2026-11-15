import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getQueuedSends } from "@/lib/sendingSchedule";
import { LocalTime } from "@/components/LocalTime";
import { CountryFlag } from "@/components/CountryFlag";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * In Queue (v1.29.0): every email waiting to send in the workspace,
 * soonest first. The companion to Sent: Sent shows what already went
 * out, this shows what is still lined up. Rows are the worker's own
 * due pool (ACTIVE enrollments with a send stamp on RUNNING
 * campaigns, read through getQueuedSends), so the page can disagree
 * with the worker only if the records do. A row marked Due leaves on
 * the next tick; the worker ticks every few minutes.
 */

const PAGE_SIZE = 100;

/** "Wed 28 Oct, 09:00" in the given IANA timezone, for queue rows. */
function formatInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; page?: string }>;
}) {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const workspaceId = session.workspace.id;
  const params = await searchParams;
  const campaignId = params.campaign ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [campaigns, queue] = await Promise.all([
    prisma.campaign.findMany({
      where: { workspaceId, status: "RUNNING" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    getQueuedSends(prisma, workspaceId, {
      campaignId: campaignId || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(queue.total / PAGE_SIZE));
  const pageHref = (target: number) =>
    `/app/queue?page=${target}${campaignId ? `&campaign=${campaignId}` : ""}`;

  return (
    <div className="mx-auto max-w-6xl" data-tour="queue">
      <h1 className="font-display text-2xl font-semibold tracking-tight">In Queue</h1>
      <p className="mt-1 text-sm text-muted">
        Emails waiting to send from {session.workspace.name}, soonest first. Due emails leave
        on the next worker tick; scheduled emails leave at their time, in the lead's own
        timezone and inside the campaign's sending window.
      </p>

      <form method="GET" className="card mt-6 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label" htmlFor="q-campaign">Campaign</label>
          <select id="q-campaign" name="campaign" defaultValue={campaignId} className="input">
            <option value="">All running campaigns</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">Apply filter</button>
        {campaignId ? (
          <Link href="/app/queue" className="btn-secondary">Reset</Link>
        ) : null}
      </form>

      <p className="mt-4 text-sm text-muted">
        {queue.total} email{queue.total === 1 ? "" : "s"} in queue
        {queue.dueNow > 0 ? `, ${queue.dueNow} due now` : ""}
        {queue.total > PAGE_SIZE ? `. Page ${page} of ${pageCount}` : ""}.
      </p>

      {queue.sends.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="Nothing in queue"
            body="No emails are waiting to send. When a running campaign has enrolled leads with a scheduled step, they line up here until the worker sends them."
          />
        </div>
      ) : (
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Scheduled</th>
                <th className="px-4 py-3 font-medium">To</th>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Step</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {queue.sends.map((send) => (
                <tr key={send.enrollmentId} className="border-b border-line last:border-0 hover:bg-elevated/60">
                  <td className="px-4 py-3">
                    <span className="font-medium">{formatInZone(send.at, send.timezone)}</span>
                    <p className="mt-0.5 text-xs text-muted">
                      {send.timezone} ·{" "}
                      <LocalTime
                        iso={send.at.toISOString()}
                        fallback={`${formatInZone(send.at, "UTC")} UTC`}
                      />{" "}
                      your time
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      <CountryFlag code={send.countryCode} className="shrink-0" />
                      <span className="font-medium">{send.company ?? send.leadEmail}</span>
                    </span>
                    {send.company ? (
                      <p className="mt-0.5 text-xs text-muted">{send.leadEmail}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/campaigns/${send.campaignId}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {send.campaignName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">Step {send.stepNumber}</td>
                  <td className="px-4 py-3">
                    {send.due ? (
                      <span className="badge bg-accent-soft text-accent">Due now</span>
                    ) : (
                      <span className="badge bg-surface text-muted">Scheduled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <div className="mt-4 flex items-center gap-3">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn-secondary">Previous</Link>
          ) : null}
          <span className="text-sm text-muted">Page {page} of {pageCount}</span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className="btn-secondary">Next</Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
