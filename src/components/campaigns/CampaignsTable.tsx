"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import { DeleteCampaignButton } from "@/components/campaigns/DeleteCampaignButton";

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  timezone: string;
  listName: string | null;
  steps: number;
  enrolled: number;
  contacted: number;
  sent: number;
  clicked: number;
}

/**
 * Campaigns table with multi-select bulk delete (v1.38.0).
 *
 * The page hands over plain rows; selection lives here. The bulk
 * bar appears once anything is ticked, and deleting asks for one
 * confirmation that names the count and the rules: RUNNING
 * campaigns in the selection are skipped (pause them first), leads
 * are never deleted, and sent and reply history stays. The delete
 * itself posts to /api/campaigns/bulk-delete, which enforces the
 * same rules server-side.
 */
export function CampaignsTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleIds = new Set(campaigns.map((campaign) => campaign.id));
  const chosen = selected.filter((id) => visibleIds.has(id));
  const allChosen = campaigns.length > 0 && chosen.length === campaigns.length;
  const runningChosen = campaigns.filter(
    (campaign) => chosen.includes(campaign.id) && campaign.status === "RUNNING",
  );

  function toggleOne(id: string) {
    setConfirming(false);
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleAll() {
    setConfirming(false);
    setSelected(allChosen ? [] : campaigns.map((campaign) => campaign.id));
  }

  async function deleteSelected() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/campaigns/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chosen }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        deletedCount?: number;
        skippedRunning?: { id: string; name: string }[];
        error?: string;
      };
      if (!response.ok || typeof data.deletedCount !== "number") {
        setError(data.error ?? "Could not delete the selected campaigns");
        return;
      }
      const skipped = data.skippedRunning?.length ?? 0;
      setMessage(
        `Deleted ${data.deletedCount} ${data.deletedCount === 1 ? "campaign" : "campaigns"}.` +
          (skipped > 0
            ? ` ${skipped} running ${skipped === 1 ? "campaign was" : "campaigns were"} skipped, pause ${skipped === 1 ? "it" : "them"} first to delete.`
            : ""),
      );
      setSelected([]);
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Could not delete the selected campaigns");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-6 overflow-x-auto" data-tour="campaigns-table">
      {chosen.length > 0 ? (
        <div className="border-b border-line bg-elevated/60 px-4 py-3">
          {confirming ? (
            <div role="alertdialog" aria-label="Confirm deleting the selected campaigns">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                Delete {chosen.length} {chosen.length === 1 ? "campaign" : "campaigns"} permanently?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                This removes the campaigns, their sequence steps, and their enrollments. Leads are
                not deleted, and past sent and reply history stays in your workspace.
                {runningChosen.length > 0
                  ? ` ${runningChosen.length} of the selected campaigns ${runningChosen.length === 1 ? "is" : "are"} running and will be skipped.`
                  : ""}
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
                {chosen.length} {chosen.length === 1 ? "campaign" : "campaigns"} selected
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
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">
              <input
                type="checkbox"
                aria-label="Select all campaigns"
                checked={allChosen}
                onChange={toggleAll}
              />
            </th>
            <th className="px-4 py-3 font-medium">Campaign</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">List</th>
            <th className="px-4 py-3 font-medium">Steps</th>
            <th className="px-4 py-3 font-medium">Enrolled</th>
            <th className="px-4 py-3 font-medium">Progress</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="border-b border-line last:border-0 hover:bg-elevated/60">
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  aria-label={`Select campaign ${campaign.name}`}
                  checked={chosen.includes(campaign.id)}
                  onChange={() => toggleOne(campaign.id)}
                />
              </td>
              <td className="px-4 py-3">
                <Link href={`/app/campaigns/${campaign.id}`} className="font-medium text-accent hover:underline">
                  {campaign.name}
                </Link>
                <p className="mt-0.5 text-xs text-muted">{campaign.timezone}</p>
              </td>
              <td className="px-4 py-3"><StatusBadge status={campaign.status} /></td>
              <td className="px-4 py-3 text-muted">{campaign.listName ?? "Not attached"}</td>
              <td className="px-4 py-3">{campaign.steps}</td>
              <td className="px-4 py-3">{campaign.enrolled}</td>
              <td className="px-4 py-3">
                {campaign.enrolled === 0 ? (
                  <span className="text-muted">No leads yet</span>
                ) : (
                  <>
                    <span>
                      {campaign.contacted} of {campaign.enrolled} contacted
                    </span>
                    <p className="mt-0.5 text-xs text-muted">
                      {campaign.enrolled - campaign.contacted} remaining · {campaign.sent} emails sent · {campaign.clicked} clicks
                    </p>
                  </>
                )}
              </td>
              <td className="relative px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <DeleteCampaignButton
                    campaignId={campaign.id}
                    campaignName={campaign.name}
                    status={campaign.status}
                  />
                  <Link href={`/app/campaigns/${campaign.id}`} className="btn-secondary !px-3 !py-1.5 text-xs">
                    Open
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
