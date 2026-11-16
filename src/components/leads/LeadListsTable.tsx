"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { LocalTime } from "@/components/LocalTime";

export interface LeadListRow {
  id: string;
  name: string;
  description: string | null;
  leadCount: number;
  createdIso: string;
  createdFallback: string;
}

/**
 * Lead lists table with multi-select bulk delete (v1.38.0).
 *
 * The page hands over plain rows; selection lives here. The bulk
 * bar appears once anything is ticked, and deleting asks for one
 * confirmation that states the rules: the lists are removed, their
 * leads stay in the workspace with no list, and campaigns attached
 * to a deleted list are left with no list attached. The delete
 * itself posts to /api/lead-lists/bulk-delete, which enforces the
 * same rules server-side.
 */
export function LeadListsTable({ lists }: { lists: LeadListRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleIds = new Set(lists.map((list) => list.id));
  const chosen = selected.filter((id) => visibleIds.has(id));
  const allChosen = lists.length > 0 && chosen.length === lists.length;

  function toggleOne(id: string) {
    setConfirming(false);
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleAll() {
    setConfirming(false);
    setSelected(allChosen ? [] : lists.map((list) => list.id));
  }

  async function deleteSelected() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/lead-lists/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chosen }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        deletedCount?: number;
        error?: string;
      };
      if (!response.ok || typeof data.deletedCount !== "number") {
        setError(data.error ?? "Could not delete the selected lists");
        return;
      }
      setMessage(
        `Deleted ${data.deletedCount} ${data.deletedCount === 1 ? "list" : "lists"}. The leads stay in this workspace with no list.`,
      );
      setSelected([]);
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Could not delete the selected lists");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-6 overflow-x-auto">
      {chosen.length > 0 ? (
        <div className="border-b border-line bg-elevated/60 px-4 py-3">
          {confirming ? (
            <div role="alertdialog" aria-label="Confirm deleting the selected lead lists">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                Delete {chosen.length} {chosen.length === 1 ? "list" : "lists"} permanently?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                The lists are removed. Their leads are not deleted, they stay in this workspace
                with no list, and any campaign attached to a deleted list is left with no list
                attached.
              </p>
              {error ? (
                <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="btn-primary !bg-red-600 hover:!bg-red-700 !px-3 !py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => void deleteSelected()}
                >
                  {busy ? "Deleting..." : "Delete permanently"}
                </button>
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">
                {chosen.length} {chosen.length === 1 ? "list" : "lists"} selected
              </span>
              <button
                type="button"
                className="btn-primary !bg-red-600 hover:!bg-red-700 !px-3 !py-1.5 text-xs"
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete selected
              </button>
              <button
                type="button"
                className="btn-secondary !px-3 !py-1.5 text-xs"
                onClick={() => setSelected([])}
              >
                Clear selection
              </button>
              {error ? (
                <span className="text-xs font-medium text-red-600 dark:text-red-400">{error}</span>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {message ? (
        <p className="border-b border-line px-4 py-2 text-xs text-muted" role="status">
          {message}
        </p>
      ) : null}
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">
              <input
                type="checkbox"
                aria-label="Select all lead lists"
                checked={allChosen}
                onChange={toggleAll}
              />
            </th>
            <th className="px-4 py-3 font-medium">List</th>
            <th className="px-4 py-3 font-medium">Leads</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {lists.map((list) => (
            <tr key={list.id} className="border-b border-line last:border-0 hover:bg-elevated/60">
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  aria-label={`Select list ${list.name}`}
                  checked={chosen.includes(list.id)}
                  onChange={() => toggleOne(list.id)}
                />
              </td>
              <td className="px-4 py-3">
                <Link href={`/app/leads/${list.id}`} className="font-medium text-accent hover:underline">
                  {list.name}
                </Link>
                {list.description ? (
                  <p className="mt-0.5 text-xs text-muted">{list.description}</p>
                ) : null}
              </td>
              <td className="px-4 py-3">{list.leadCount}</td>
              <td className="px-4 py-3 text-muted">
                <LocalTime iso={list.createdIso} fallback={list.createdFallback} format="date" />
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`/app/leads/${list.id}`} className="btn-secondary !px-3 !py-1.5 text-xs">
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
