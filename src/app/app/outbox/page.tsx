import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { RelativeTime } from "@/components/RelativeTime";
import { leadCompanyOf, leadMatchesSearch, leadNameOf } from "@/lib/leads/search";

export const dynamic = "force-dynamic";

/**
 * Outbox (v1.4.0): every email the workspace has sent, newest first,
 * read from the outbound thread messages the worker and reply sync
 * recorded. Opened and replied badges are derived from the recorded
 * EmailEvents for each message's enrollment (plus inbound thread
 * messages for replies), never estimated. Filters: campaign, sending
 * account, open/reply status, and order, plus a text search by
 * recipient name, email, or company (v1.26.0). Name and company live
 * in the lead's fields JSON, so a search first scans the workspace's
 * leads with the shared lead search helper to find the matching
 * lead ids, then loads those leads' sends alongside a direct
 * recipient email match.
 */

const FETCH_LIMIT = 300;
const PAGE_LIMIT = 100;

type StatusFilter = "all" | "opened" | "replied" | "not-opened";

export default async function OutboxPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; account?: string; status?: string; order?: string; search?: string }>;
}) {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const workspaceId = session.workspace.id;
  const params = await searchParams;
  const search = (params.search ?? "").trim();
  const campaignId = params.campaign ?? "";
  const accountId = params.account ?? "";
  const statusParam = params.status as StatusFilter | undefined;
  const status: StatusFilter =
    statusParam === "opened" || statusParam === "replied" || statusParam === "not-opened"
      ? statusParam
      : "all";
  const order = params.order === "oldest" ? ("asc" as const) : ("desc" as const);

  const [campaigns, accounts] = await Promise.all([
    prisma.campaign.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.sendingAccount.findMany({
      where: { workspaceId },
      select: { id: true, email: true },
      orderBy: { email: "asc" },
    }),
  ]);

  const threadFilter = {
    workspaceId,
    ...(campaignId ? { campaignId } : {}),
    ...(accountId ? { sendingAccountId: accountId } : {}),
  };
  const messageInclude = {
    thread: {
      include: {
        campaign: { select: { id: true, name: true } },
        sendingAccount: { select: { id: true, email: true } },
        lead: { select: { id: true, email: true, fields: true } },
      },
    },
  } as const;
  type OutboxMessage = Prisma.ThreadMessageGetPayload<{ include: typeof messageInclude }>;
  let messages: OutboxMessage[];
  if (!search) {
    messages = await prisma.threadMessage.findMany({
      where: { direction: "OUTBOUND", thread: threadFilter },
      include: messageInclude,
      orderBy: { occurredAt: order },
      take: FETCH_LIMIT,
    });
  } else {
    // Search (v1.26.0): find the workspace leads whose name, email,
    // or company matches, then load their sends; a direct recipient
    // email match is fetched alongside so an address still finds
    // its sends even if the lead row changed. The two sets are
    // merged, de-duplicated, and re-sorted into the chosen order.
    const scannedLeads = await prisma.lead.findMany({
      where: { workspaceId },
      select: { id: true, email: true, fields: true },
      take: 10000,
    });
    const matchedLeadIds = scannedLeads
      .filter((lead) => leadMatchesSearch(lead, search))
      .map((lead) => lead.id);
    const [byRecipient, byLead] = await Promise.all([
      prisma.threadMessage.findMany({
        where: {
          direction: "OUTBOUND",
          toEmail: { contains: search.toLowerCase() },
          thread: threadFilter,
        },
        include: messageInclude,
        orderBy: { occurredAt: order },
        take: FETCH_LIMIT,
      }),
      matchedLeadIds.length
        ? prisma.threadMessage.findMany({
            where: {
              direction: "OUTBOUND",
              thread: { ...threadFilter, leadId: { in: matchedLeadIds } },
            },
            include: messageInclude,
            orderBy: { occurredAt: order },
            take: FETCH_LIMIT,
          })
        : Promise.resolve<OutboxMessage[]>([]),
    ]);
    const merged = new Map<string, OutboxMessage>();
    for (const message of [...byRecipient, ...byLead]) {
      merged.set(message.id, message);
    }
    messages = [...merged.values()]
      .sort((a, b) =>
        order === "asc"
          ? a.occurredAt.getTime() - b.occurredAt.getTime()
          : b.occurredAt.getTime() - a.occurredAt.getTime(),
      )
      .slice(0, FETCH_LIMIT);
  }

  // Resolve each message's enrollment so OPENED and REPLIED events
  // can be matched to it. Enrollment is unique per campaign and lead.
  const pairKeys = new Map<string, { campaignId: string; leadId: string }>();
  for (const message of messages) {
    const { campaignId: cId, leadId: lId } = message.thread;
    if (cId && lId) {
      pairKeys.set(`${cId}:${lId}`, { campaignId: cId, leadId: lId });
    }
  }
  const pairs = [...pairKeys.values()];
  const enrollments = pairs.length
    ? await prisma.enrollment.findMany({
        where: { OR: pairs.map((pair) => ({ campaignId: pair.campaignId, leadId: pair.leadId })) },
        select: { id: true, campaignId: true, leadId: true },
      })
    : [];
  const enrollmentPairById = new Map(
    enrollments.map((enrollment) => [enrollment.id, `${enrollment.campaignId}:${enrollment.leadId}`]),
  );
  const enrollmentIds = enrollments.map((enrollment) => enrollment.id);
  const threadIds = [...new Set(messages.map((message) => message.threadId))];

  const [openedEvents, repliedEvents, inboundMessages] = await Promise.all([
    enrollmentIds.length
      ? prisma.emailEvent.findMany({
          where: { enrollmentId: { in: enrollmentIds }, type: "OPENED" },
          select: { enrollmentId: true, occurredAt: true, classification: true },
          orderBy: { occurredAt: "asc" },
        })
      : Promise.resolve(
          [] as { enrollmentId: string | null; occurredAt: Date; classification: string | null }[],
        ),
    enrollmentIds.length
      ? prisma.emailEvent.findMany({
          where: { enrollmentId: { in: enrollmentIds }, type: "REPLIED" },
          select: { enrollmentId: true },
          distinct: ["enrollmentId"],
        })
      : Promise.resolve([] as { enrollmentId: string | null }[]),
    threadIds.length
      ? prisma.threadMessage.findMany({
          where: { threadId: { in: threadIds }, direction: "INBOUND" },
          select: { threadId: true },
          distinct: ["threadId"],
        })
      : Promise.resolve([] as { threadId: string }[]),
  ]);

  // Per enrollment, the earliest human open and the earliest
  // machine open (v1.20.0). An open classified MACHINE was a mail
  // app or scanner loading the pixel within a minute of the send;
  // it is shown as Auto-open and never counts as Opened.
  const openInfoByPair = new Map<string, { humanAt: Date | null; machineAt: Date | null }>();
  for (const event of openedEvents) {
    if (!event.enrollmentId) {
      continue;
    }
    const pair = enrollmentPairById.get(event.enrollmentId);
    if (!pair) {
      continue;
    }
    const info = openInfoByPair.get(pair) ?? { humanAt: null, machineAt: null };
    if (event.classification === "MACHINE") {
      if (!info.machineAt || event.occurredAt < info.machineAt) {
        info.machineAt = event.occurredAt;
      }
    } else if (!info.humanAt || event.occurredAt < info.humanAt) {
      info.humanAt = event.occurredAt;
    }
    openInfoByPair.set(pair, info);
  }
  const repliedPairs = new Set(
    repliedEvents
      .map((event) => (event.enrollmentId ? enrollmentPairById.get(event.enrollmentId) : undefined))
      .filter(Boolean),
  );
  const repliedThreads = new Set(inboundMessages.map((message) => message.threadId));

  const rows = messages.map((message) => {
    const pairKey =
      message.thread.campaignId && message.thread.leadId
        ? `${message.thread.campaignId}:${message.thread.leadId}`
        : null;
    const openInfo = pairKey ? openInfoByPair.get(pairKey) : undefined;
    const humanAt = openInfo?.humanAt ?? null;
    const machineAt = openInfo && !openInfo.humanAt ? openInfo.machineAt : null;
    // Open matching is per enrollment, so the earliest open can
    // belong to an earlier step than this message. A time is only
    // shown when it falls after this message's own send; an earlier
    // time would describe a different email.
    const sentMs = message.occurredAt.getTime();
    return {
      message,
      opened: Boolean(humanAt),
      openedAt: humanAt && humanAt.getTime() >= sentMs ? humanAt : null,
      autoOpenedAt: machineAt && machineAt.getTime() >= sentMs ? machineAt : null,
      replied: repliedThreads.has(message.threadId) || (pairKey ? repliedPairs.has(pairKey) : false),
    };
  });
  const filtered =
    status === "all"
      ? rows
      : status === "opened"
        ? rows.filter((row) => row.opened)
        : status === "replied"
          ? rows.filter((row) => row.replied)
          : rows.filter((row) => !row.opened);
  const shown = filtered.slice(0, PAGE_LIMIT);

  return (
    <div className="mx-auto max-w-6xl" data-tour="outbox">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Outbox</h1>
      <p className="mt-1 text-sm text-muted">
        Emails sent from {session.workspace.name}, read from recorded sends. Opened and replied
        badges come from tracked events, never estimates. Opens a mail app or security scanner
        triggers automatically within a minute of sending are labelled Auto-open and do not
        count as opened.
      </p>

      <form method="GET" className="card mt-6 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label" htmlFor="ob-search">Search name, email or company</label>
          <input id="ob-search" name="search" className="input w-72" defaultValue={search} placeholder="Jane, jane@company.com or Company Inc" />
        </div>
        <div>
          <label className="label" htmlFor="ob-campaign">Campaign</label>
          <select id="ob-campaign" name="campaign" defaultValue={campaignId} className="input">
            <option value="">All campaigns</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ob-account">Sending account</label>
          <select id="ob-account" name="account" defaultValue={accountId} className="input">
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.email}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ob-status">Status</label>
          <select id="ob-status" name="status" defaultValue={status} className="input">
            <option value="all">All sent</option>
            <option value="opened">Opened</option>
            <option value="replied">Replied</option>
            <option value="not-opened">Not opened</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ob-order">Order</label>
          <select id="ob-order" name="order" defaultValue={order === "asc" ? "oldest" : "newest"} className="input">
            <option value="newest">Latest to oldest</option>
            <option value="oldest">Oldest to latest</option>
          </select>
        </div>
        <button type="submit" className="btn-primary">Apply filters</button>
        <Link href="/app/outbox" className="btn-secondary">Reset</Link>
      </form>

      <p className="mt-4 text-sm text-muted">
        Showing {shown.length} of {filtered.length} matching sends
        {messages.length >= FETCH_LIMIT ? ` (latest ${FETCH_LIMIT} loaded)` : ""}
        {search ? `. Search matches the recipient's name, email, or company, including a name inside the icebreaker line.` : ""}.
      </p>

      <div className="mt-3 space-y-3">
        {shown.length === 0 ? (
          <section className="card p-8 text-center text-sm text-muted">
            No sent emails match these filters yet. Sends appear here as soon as a campaign sends.
          </section>
        ) : (
          shown.map(({ message, opened, openedAt, autoOpenedAt, replied }) => (
            <article key={message.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{message.subject ?? "(no subject)"}</span>
                {opened ? (
                  <span className="badge bg-accent-soft text-accent">Opened</span>
                ) : null}
                {opened && openedAt ? (
                  <span className="text-xs text-muted">
                    opened{" "}
                    <RelativeTime
                      iso={openedAt.toISOString()}
                      fallback={`${openedAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC`}
                      showExact
                    />
                  </span>
                ) : null}
                {!opened && autoOpenedAt ? (
                  <>
                    <span className="badge bg-surface text-muted">Auto-open</span>
                    <span className="text-xs text-muted">
                      auto-opened{" "}
                      <RelativeTime
                        iso={autoOpenedAt.toISOString()}
                        fallback={`${autoOpenedAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC`}
                        showExact
                      />
                    </span>
                  </>
                ) : null}
                {replied ? (
                  <span className="badge bg-accent-soft text-accent">Replied</span>
                ) : null}
                <span className="ml-auto text-xs text-muted">
                  <RelativeTime
                    iso={message.occurredAt.toISOString()}
                    fallback={`${message.occurredAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC`}
                    showExact
                  />
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                To {message.toEmail}
                {message.thread.lead && leadCompanyOf(message.thread.lead.fields)
                  ? ` · ${leadCompanyOf(message.thread.lead.fields)}`
                  : ""}
                {message.thread.lead && leadNameOf(message.thread.lead.fields)
                  ? ` · ${leadNameOf(message.thread.lead.fields)}`
                  : ""}
                {message.thread.campaign ? ` · ${message.thread.campaign.name}` : ""}
                {message.thread.sendingAccount ? ` · from ${message.thread.sendingAccount.email}` : ` · from ${message.fromEmail}`}
              </p>
              <p className="mt-2 line-clamp-2 text-sm">{message.body}</p>
              <Link href={`/app/inbox/${message.threadId}`} className="mt-2 inline-block text-sm font-medium hover:text-accent">
                View thread
              </Link>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
