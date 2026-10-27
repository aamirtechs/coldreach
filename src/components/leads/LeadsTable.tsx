"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui";

export interface LeadRow {
  id: string;
  email: string;
  status: string;
  fields: Record<string, unknown>;
  tags: string[];
  suppressed: boolean;
  createdAt: string;
}

interface LeadsTableProps {
  listId: string;
  leads: LeadRow[];
  total: number;
  page: number;
  totalPages: number;
  allTags: string[];
  query: { search: string; status: string; tag: string };
}

function pageHref(listId: string, query: LeadsTableProps["query"], page: number): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status) params.set("status", query.status);
  if (query.tag) params.set("tag", query.tag);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/app/leads/${listId}${qs ? `?${qs}` : ""}`;
}

export function LeadsTable({ listId, leads, total, page, totalPages, allTags, query }: LeadsTableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagValue, setTagValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [icebreakerBusy, setIcebreakerBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setAiConfigured(Boolean(data.configured));
      })
      .catch(() => {
        if (!cancelled) setAiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function generateIcebreaker(leadId: string, email: string) {
    setIcebreakerBusy(leadId);
    setNotice(null);
    const response = await fetch("/api/ai/icebreaker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId }),
    });
    const data = await response.json();
    setIcebreakerBusy(null);
    if (!response.ok) {
      setNotice(data.error ?? `Icebreaker failed for ${email}`);
      return;
    }
    setNotice(`Icebreaker saved for ${email}. It is available as the {{icebreaker}} token.`);
    router.refresh();
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  async function bulk(action: "delete" | "tag") {
    if (selected.size === 0) return;
    if (action === "delete" && !window.confirm(`Delete ${selected.size} lead(s)? This cannot be undone.`)) {
      return;
    }
    if (action === "tag" && !tagValue.trim()) {
      setNotice("Enter a tag name first.");
      return;
    }
    const response = await fetch("/api/leads/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, leadIds: [...selected], tag: tagValue.trim() }),
    });
    const data = await response.json();
    if (!response.ok) {
      setNotice(data.error ?? "Bulk action failed");
      return;
    }
    setNotice(
      action === "delete" ? `Deleted ${data.deleted} lead(s).` : `Tagged ${data.updated} lead(s).`,
    );
    setSelected(new Set());
    setTagValue("");
    router.refresh();
  }

  async function deleteOne(id: string, email: string) {
    if (!window.confirm(`Delete lead ${email}?`)) return;
    const response = await fetch(`/api/leads/${id}`, { method: "DELETE" });
    if (response.ok) {
      router.refresh();
    }
  }

  const allChecked = leads.length > 0 && leads.every((lead) => selected.has(lead.id));

  return (
    <div className="mt-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="flt-search">Search email</label>
          <input id="flt-search" name="search" className="input w-56" defaultValue={query.search} placeholder="jane@company.com" />
        </div>
        <div>
          <label className="label" htmlFor="flt-status">Status</label>
          <select id="flt-status" name="status" className="input w-44" defaultValue={query.status}>
            <option value="">All statuses</option>
            {["NEW", "VALID", "INVALID", "UNSUBSCRIBED", "BOUNCED", "SUPPRESSED"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="flt-tag">Tag</label>
          <select id="flt-tag" name="tag" className="input w-44" defaultValue={query.tag}>
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-secondary">Filter</button>
        <span className="pb-2 text-sm text-muted">{total} lead{total === 1 ? "" : "s"}</span>
      </form>

      {selected.size > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-elevated px-4 py-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <input
            className="input w-40"
            placeholder="Tag name"
            aria-label="Tag name for the selected leads"
            value={tagValue}
            onChange={(e) => setTagValue(e.target.value)}
          />
          <button type="button" className="btn-secondary" onClick={() => bulk("tag")}>Apply tag</button>
          <button type="button" className="btn-secondary" onClick={() => bulk("delete")}>Delete selected</button>
          {notice ? <span className="text-sm text-muted">{notice}</span> : null}
        </div>
      ) : notice ? (
        <p className="mt-3 text-sm text-muted">{notice}</p>
      ) : null}

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() =>
                    setSelected(allChecked ? new Set() : new Set(leads.map((l) => l.id)))
                  }
                  aria-label="Select all on this page"
                />
              </th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Name / Company</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Tags</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const name = [lead.fields.firstName, lead.fields.lastName]
                .filter(Boolean)
                .join(" ");
              return (
                <tr key={lead.id} className="border-b border-line last:border-0 hover:bg-elevated/60">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(lead.id)}
                      onChange={() => toggle(lead.id)}
                      aria-label={`Select ${lead.email}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {lead.email}
                    {lead.suppressed ? (
                      <span className="ml-2 text-xs font-normal text-warning">suppressed</span>
                    ) : null}
                    {lead.fields.icebreaker ? (
                      <p className="mt-1 max-w-md text-xs font-normal text-muted">
                        Icebreaker (AI generated, stored as {"{{icebreaker}}"}): {String(lead.fields.icebreaker)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {name || ""}
                    {name && lead.fields.company ? " · " : ""}
                    {lead.fields.company ? String(lead.fields.company) : ""}
                    {!name && !lead.fields.company ? "-" : ""}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {lead.tags.map((tag) => (
                        <span key={tag} className="rounded bg-elevated px-1.5 py-0.5 text-xs text-muted">{tag}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {aiConfigured ? (
                      <button
                        type="button"
                        className="btn-ghost !px-2 !py-1 text-xs"
                        disabled={icebreakerBusy === lead.id}
                        onClick={() => generateIcebreaker(lead.id, lead.email)}
                        title="Generate an AI icebreaker line and store it as the {{icebreaker}} field"
                      >
                        {icebreakerBusy === lead.id
                          ? "Writing..."
                          : lead.fields.icebreaker
                            ? "Regenerate icebreaker"
                            : "Icebreaker"}
                      </button>
                    ) : aiConfigured === false ? (
                      <span className="text-xs text-muted" title="Set OPENAI_API_KEY in the server environment to enable AI icebreakers">
                        AI not configured
                      </span>
                    ) : null}
                    <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => deleteOne(lead.id, lead.email)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {page > 1 ? (
            <Link className="btn-secondary" href={pageHref(listId, query, page - 1)}>Previous</Link>
          ) : null}
          <span className="text-muted">Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link className="btn-secondary" href={pageHref(listId, query, page + 1)}>Next</Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
