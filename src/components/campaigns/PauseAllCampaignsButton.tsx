"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Pause all campaigns" for the Campaigns page header (v1.37.0).
 *
 * One click arms an inline confirmation naming how many campaigns
 * will pause (RUNNING and SCHEDULED); confirming posts to
 * /api/campaigns/pause-all and refreshes the list. Renders nothing
 * when nothing in the workspace can send.
 */
export function PauseAllCampaignsButton({ activeCount }: { activeCount: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (activeCount === 0 && !message) {
    return null;
  }

  async function pauseAll() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/campaigns/pause-all", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as {
        pausedCount?: number;
        error?: string;
      };
      if (!response.ok || typeof data.pausedCount !== "number") {
        setError(data.error ?? "Could not pause the campaigns");
        return;
      }
      setConfirming(false);
      setMessage(
        data.pausedCount === 1
          ? "Paused 1 campaign. Sending is stopped."
          : `Paused ${data.pausedCount} campaigns. Sending is stopped.`,
      );
      router.refresh();
    } catch {
      setError("Could not pause the campaigns");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">
            Pause {activeCount} {activeCount === 1 ? "campaign" : "campaigns"}?
          </span>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void pauseAll()}>
            {busy ? "Pausing..." : "Yes, pause all"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>
          Pause all campaigns
        </button>
      )}
      {message ? (
        <p className="text-xs text-muted" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-warning" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
