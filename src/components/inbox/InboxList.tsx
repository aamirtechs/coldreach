"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DemoBadge } from "@/components/ui";

interface ThreadRow {
  id: string;
  subject: string;
  status: string;
  unread: boolean;
  classification: string | null;
  lastMessageAt: string;
  lead: { id: string; email: string; fields: unknown } | null;
  campaign: { id: string; name: string } | null;
  sendingAccount: { id: string; email: string; provider: string } | null;
  assignee: { id: string; name: string | null; email: string } | null;
  _count: { messages: number };
}

interface Option {
  id: string;
  label: string;
}

const CLASSIFICATIONS = ["POSITIVE", "NEGATIVE", "OUT_OF_OFFICE", "REFERRAL", "NEUTRAL"];

/**
 * Unified inbox list. Threads arrive from reply sync (Gmail, Microsoft
 * 365) and from simulated sends in DEMO workspaces; filters map one to
 * one onto the /api/threads query parameters.
 */
export function InboxList() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [classification, setClassification] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [campaigns, setCampaigns] = useState<Option[]>([]);
  const [accounts, setAccounts] = useState<Option[]>([]);
  const [members, setMembers] = useState<Option[]>([]);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => (r.ok ? r.json() : { campaigns: [] }))
      .then((payload: { campaigns?: Array<{ id: string; name: string }> }) =>
        setCampaigns((payload.campaigns ?? []).map((c) => ({ id: c.id, label: c.name }))),
      )
      .catch(() => undefined);
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((payload: { accounts?: Array<{ id: string; email: string }> }) =>
        setAccounts((payload.accounts ?? []).map((a) => ({ id: a.id, label: a.email }))),
      )
      .catch(() => undefined);
    fetch("/api/team/members")
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((payload: { members?: Array<{ userId: string; name: string | null; email: string }> }) =>
        setMembers(
          (payload.members ?? []).map((m) => ({ id: m.userId, label: m.name ?? m.email })),
        ),
      )
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      if (classification) params.set("classification", classification);
      if (campaignId) params.set("campaignId", campaignId);
      if (accountId) params.set("sendingAccountId", accountId);
      if (assigneeId) params.set("assigneeId", assigneeId);
      const response = await fetch(`/api/threads?${params.toString()}`);
      if (!response.ok) throw new Error("Could not load the inbox");
      const payload = (await response.json()) as {
        threads: ThreadRow[];
        total: number;
        unreadTotal: number;
      };
      setThreads(payload.threads);
      setTotal(payload.total);
      setUnreadTotal(payload.unreadTotal);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the inbox");
    } finally {
      setLoading(false);
    }
  }, [page, q, status, classification, campaignId, accountId, assigneeId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 200);
    return () => clearTimeout(timer);
  }, [load]);

  const leadName = (thread: ThreadRow): string => {
    const fields = thread.lead?.fields as { firstName?: string; lastName?: string } | null;
    const name = [fields?.firstName, fields?.lastName].filter(Boolean).join(" ");
    return name || thread.lead?.email || "Unknown sender";
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Search
          <input
            className="input w-56"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
            placeholder="Email, subject, message text"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Status
          <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Classification
          <select className="input" value={classification} onChange={(e) => { setClassification(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {CLASSIFICATIONS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Campaign
          <select className="input" value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setPage(1); }}>
            <option value="">All campaigns</option>
            {campaigns.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Sending account
          <select className="input" value={accountId} onChange={(e) => { setAccountId(e.target.value); setPage(1); }}>
            <option value="">All accounts</option>
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Assignee
          <select className="input" value={assigneeId} onChange={(e) => { setAssigneeId(e.target.value); setPage(1); }}>
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
            {members.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-4 text-sm text-muted">
        {total} conversation{total === 1 ? "" : "s"}
        {unreadTotal > 0 ? ` · ${unreadTotal} unread` : ""}
      </p>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      <div className="card mt-3 overflow-hidden">
        {loading ? (
          <p className="p-5 text-sm text-muted">Loading conversations...</p>
        ) : threads.length === 0 ? (
          <p className="p-5 text-sm text-muted">
            No conversations match. Replies land here when reply sync runs for a connected
            Gmail or Microsoft 365 account, or when a lead replies in DEMO flows recorded as
            threads. Connect an account on the Sending Accounts page to start syncing.
          </p>
        ) : (
          <ul>
            {threads.map((thread) => (
              <li key={thread.id} className="border-b border-line last:border-0 hover:bg-elevated/60">
                <Link href={`/app/inbox/${thread.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${thread.unread ? "bg-accent" : "bg-line"}`}
                    title={thread.unread ? "Unread" : "Read"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${thread.unread ? "font-semibold" : "font-medium"}`}>
                      {thread.subject}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {leadName(thread)}
                      {thread.lead ? ` · ${thread.lead.email}` : ""}
                      {thread.campaign ? ` · ${thread.campaign.name}` : ""}
                      {thread.sendingAccount ? ` · via ${thread.sendingAccount.email}` : ""}
                    </span>
                  </span>
                  {thread.sendingAccount?.provider === "SIMULATION" ? <DemoBadge /> : null}
                  {thread.classification ? (
                    <span className="rounded bg-elevated px-2 py-0.5 text-[11px] font-medium">
                      {thread.classification}
                    </span>
                  ) : null}
                  <span className="rounded bg-elevated px-2 py-0.5 text-[11px] font-medium">
                    {thread.status}
                  </span>
                  <span className="text-xs text-muted">
                    {thread._count.messages} msg · {new Date(thread.lastMessageAt).toLocaleString()}
                  </span>
                  <span className="text-xs text-muted">
                    {thread.assignee ? (thread.assignee.name ?? thread.assignee.email) : "Unassigned"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          disabled={page <= 1}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          Previous
        </button>
        <span className="text-sm text-muted">Page {page}</span>
        <button
          type="button"
          className="btn-secondary"
          disabled={page * 25 >= total}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
