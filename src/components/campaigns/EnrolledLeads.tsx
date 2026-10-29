"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui";

interface EnrollmentRow {
  id: string;
  status: string;
  currentStep: number;
  enrolledAt: string;
  lead: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    fields: Record<string, unknown>;
  };
}

const PAGE_SIZE = 50;

/**
 * Enrolled leads manager for the campaign detail page. Selection
 * works exactly like the inbox bulk actions (per page, cleared on
 * page change) and removal goes through the guarded bulk endpoint:
 * contacted enrollments refuse the whole batch server-side, and the
 * refusal text is shown here verbatim. Removing an enrollment never
 * deletes the lead; it stays in its list.
 */
export function EnrolledLeads({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      const response = await fetch(
        `/api/campaigns/${campaignId}/enrollments?${params.toString()}`,
      );
      if (!response.ok) throw new Error("Could not load enrolled leads");
      const payload = (await response.json()) as {
        enrollments: EnrollmentRow[];
        total: number;
      };
      setEnrollments(payload.enrollments);
      setTotal(payload.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load enrolled leads");
    } finally {
      setLoading(false);
    }
  }, [campaignId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Selection and the remove confirmation only apply to the page on
  // screen, the same rule the inbox bulk actions use.
  useEffect(() => {
    setSelected(new Set());
    setConfirming(false);
  }, [page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allSelected =
    enrollments.length > 0 && enrollments.every((row) => selected.has(row.id));

  function toggleRow(id: string, checked: boolean) {
    setConfirming(false);
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setConfirming(false);
    setSelected(checked ? new Set(enrollments.map((row) => row.id)) : new Set());
  }

  async function removeSelected() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/enrollments/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentIds: [...selected] }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        removed?: number;
        notFound?: number;
        error?: string;
        contacted?: string[];
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Removal failed");
      }
      const removed = payload.removed ?? 0;
      setNotice(
        `Removed ${removed} lead${removed === 1 ? "" : "s"} from this campaign.` +
          (payload.notFound
            ? ` ${payload.notFound} selected ${payload.notFound === 1 ? "id was" : "ids were"} not found and skipped.`
            : ""),
      );
      const emptiedPage = selected.size >= enrollments.length;
      setSelected(new Set());
      setConfirming(false);
      if (emptiedPage && page > 1) {
        // The page change reloads the list on the previous page.
        setPage((value) => value - 1);
      } else {
        await load();
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Removal failed");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const leadName = (row: EnrollmentRow): string =>
    [row.lead.firstName, row.lead.lastName].filter(Boolean).join(" ");

  const segmentOf = (row: EnrollmentRow): string => {
    const segment = row.lead.fields?.segment;
    return typeof segment === "string" && segment.trim() ? segment : "-";
  };

  return (
    <section className="card mt-6 p-6">
      <h2 className="font-display text-lg font-semibold">Enrolled leads</h2>
      <p className="mt-1 text-xs text-muted">
        Removing a lead here only removes it from this campaign. The lead stays in its list.
        Leads that have already been contacted cannot be removed, so their sending history
        stays intact.
      </p>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}

      {selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-xs"
            disabled={busy}
            onClick={() => void removeSelected()}
          >
            {busy
              ? "Removing..."
              : confirming
                ? `Confirm remove ${selected.size}`
                : "Remove from campaign"}
          </button>
          <button
            type="button"
            className="btn-ghost !px-3 !py-1.5 text-xs"
            disabled={busy}
            onClick={() => {
              setSelected(new Set());
              setConfirming(false);
            }}
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        {loading ? (
          <p className="p-5 text-sm text-muted">Loading enrolled leads...</p>
        ) : enrollments.length === 0 ? (
          <p className="p-5 text-sm text-muted">
            No leads are enrolled in this campaign yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) => togglePage(event.target.checked)}
                    aria-label="Select all enrolled leads on this page"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Lead</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Segment</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Step</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-line last:border-0 hover:bg-elevated/60"
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={(event) => toggleRow(row.id, event.target.checked)}
                      aria-label={`Select ${row.lead.email}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{row.lead.email}</span>
                    {leadName(row) ? (
                      <p className="mt-0.5 text-xs text-muted">{leadName(row)}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">{row.lead.company ?? "-"}</td>
                  <td className="px-4 py-3 text-muted">{segmentOf(row)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">{row.currentStep}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          disabled={page <= 1 || loading}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          Previous
        </button>
        <span className="text-sm text-muted">
          Page {page} of {pageCount} · {total} enrolled
        </span>
        <button
          type="button"
          className="btn-secondary"
          disabled={page >= pageCount || loading}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
