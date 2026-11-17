"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/**
 * Orphan leads cleanup card (v1.41.0).
 *
 * The server page hands over the counts: orphans (in no list and
 * no campaign) and unlisted-but-enrolled leads, which are in use
 * and are never touched. Deleting asks for one confirmation that
 * states the rule, then calls DELETE /api/leads/orphans, which
 * enforces the same rule server-side.
 */
export function OrphanLeadsCard({
  orphanCount,
  unlistedEnrolledCount,
}: {
  orphanCount: number;
  unlistedEnrolledCount: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function deleteOrphans() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/leads/orphans", { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as {
        deletedCount?: number;
        error?: string;
      };
      if (!response.ok || typeof data.deletedCount !== "number") {
        setError(data.error ?? "Could not delete the orphan leads");
        return;
      }
      setMessage(
        `Deleted ${data.deletedCount} orphan ${data.deletedCount === 1 ? "lead" : "leads"}.`,
      );
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Could not delete the orphan leads");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-6 p-4">
      <h2 className="text-sm font-semibold">Orphan leads</h2>
      {message ? (
        <p className="mt-1 text-sm text-muted">{message}</p>
      ) : orphanCount > 0 ? (
        <p className="mt-1 text-sm text-muted">
          {orphanCount} lead{orphanCount === 1 ? "" : "s"} in this workspace{" "}
          {orphanCount === 1 ? "is" : "are"} in no list and no campaign. They are leftovers
          from deleted lists and campaigns, and nothing in the app can reach them.
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">
          {unlistedEnrolledCount > 0
            ? "No orphan leads. Every unlisted lead is enrolled in a campaign."
            : "No orphan leads. Every lead in this workspace is in a list or a campaign."}
        </p>
      )}
      {unlistedEnrolledCount > 0 ? (
        <p className="mt-1 text-xs text-muted">
          {unlistedEnrolledCount} other unlisted lead{unlistedEnrolledCount === 1 ? "" : "s"}{" "}
          {unlistedEnrolledCount === 1 ? "is" : "are"} enrolled in a campaign and{" "}
          {unlistedEnrolledCount === 1 ? "is" : "are"} always kept.
        </p>
      ) : null}
      {orphanCount > 0 && !message ? (
        confirming ? (
          <div role="alertdialog" aria-label="Confirm deleting orphan leads" className="mt-3">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">
              Delete {orphanCount} orphan lead{orphanCount === 1 ? "" : "s"} permanently?
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Only leads in no list and no campaign are deleted. Leads in a list, and unlisted
              leads enrolled in any campaign, are never touched. This cannot be undone.
            </p>
            {error ? (
              <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn-primary !bg-red-600 hover:!bg-red-700 !px-3 !py-1.5 text-xs"
                disabled={busy}
                onClick={() => void deleteOrphans()}
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
          <div className="mt-3">
            <button
              type="button"
              className="btn-primary !bg-red-600 hover:!bg-red-700 !px-3 !py-1.5 text-xs"
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete orphan leads
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
