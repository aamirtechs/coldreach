"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/**
 * Delete campaign control (v1.16.0), used in the campaigns list and
 * on the campaign detail page. The API (DELETE /api/campaigns/[id])
 * already existed; this is its missing UI.
 *
 * Deleting is permanent and two-step: the button opens an inline
 * confirmation that names the campaign and states exactly what goes
 * and what stays. A RUNNING campaign cannot be deleted (the API
 * refuses with 409); the confirmation says to pause it first, and
 * the server message is shown if it still refuses.
 *
 * What deletion removes: the campaign, its sequence steps, its
 * enrollments, and its sending-account links (all cascade in the
 * schema). Leads are never deleted. Sent and reply history survives
 * as workspace-level events and inbox threads with the campaign
 * link cleared, so dashboard totals do not change.
 */
export function DeleteCampaignButton({
  campaignId,
  campaignName,
  status,
  variant = "list",
}: {
  campaignId: string;
  campaignName: string;
  status: string;
  /** "list" is the compact row button; "detail" is the danger-zone button. */
  variant?: "list" | "detail";
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Delete failed");
        setBusy(false);
        return;
      }
      if (variant === "detail") {
        router.push("/app/campaigns");
      } else {
        setConfirming(false);
        router.refresh();
      }
    } catch {
      setError("Delete failed");
      setBusy(false);
    }
  }

  if (!confirming) {
    return variant === "detail" ? (
      <button
        type="button"
        className="btn-secondary !border-red-300 !text-red-700 hover:!bg-red-50 dark:!border-red-800 dark:!text-red-300 dark:hover:!bg-red-950/40"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="h-4 w-4" /> Delete campaign
      </button>
    ) : (
      <button
        type="button"
        className="btn-ghost !px-2.5 !py-1.5 text-xs !text-red-600 hover:!bg-red-50 dark:!text-red-400 dark:hover:!bg-red-950/40"
        onClick={() => setConfirming(true)}
        aria-label={`Delete campaign ${campaignName}`}
        title="Delete campaign"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    );
  }

  return (
    <div
      className={
        variant === "detail"
          ? "w-full rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30"
          : "absolute right-2 top-2 z-10 w-72 rounded-lg border border-red-300 bg-surface p-3 text-left shadow-lg dark:border-red-800"
      }
      role="alertdialog"
      aria-label={`Confirm deleting ${campaignName}`}
    >
      <p className="text-sm font-semibold text-red-700 dark:text-red-300">Delete “{campaignName}” permanently?</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        This removes the campaign, its sequence steps, and its enrollments. Leads are not deleted,
        and past sent and reply history stays in your workspace totals and inbox.
        {status === "RUNNING" ? " This campaign is running: pause it first, then delete." : ""}
      </p>
      {error ? <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn-primary !bg-red-600 hover:!bg-red-700 !px-3 !py-1.5 text-xs"
          disabled={busy || status === "RUNNING"}
          onClick={remove}
        >
          {busy ? "Deleting..." : "Delete permanently"}
        </button>
        <button
          type="button"
          className="btn-secondary !px-3 !py-1.5 text-xs"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
