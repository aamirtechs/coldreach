"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface WarmupControlProps {
  accountId: string;
  warmupEnabled: boolean;
  /** ISO start date, or null when warm-up has never been enabled. */
  warmupStartedAt: string | null;
  /** Warm-up ceiling for today, or null when there is no ceiling. */
  capToday: number | null;
  /** 1-based schedule day for the progress hint, or null when off. */
  progressDay: number | null;
  progressTotal: number;
  progressComplete: boolean;
}

/**
 * Warm-up schedule control on the accounts table (Phase 6).
 * Toggling on starts the 28 day schedule (20, 50, 100, then 200
 * sends per day by week); the server keeps the start date when
 * toggled off so re-enabling resumes the schedule, and Restart
 * begins a fresh ramp. The worker enforces the cap; this control
 * only records the operator's choice.
 */
export function WarmupControl(props: WarmupControlProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${props.accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Update failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Update failed");
    } finally {
      setBusy(false);
    }
  }

  if (!props.warmupEnabled) {
    return (
      <div>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={busy}
          onClick={() => patch({ warmupEnabled: true })}
        >
          Enable warm-up
        </button>
        {error ? <p className="mt-1 text-xs text-warning">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="text-xs">
      <p>
        Cap today: <span className="font-medium">{props.capToday ?? "none (complete)"}</span>
      </p>
      <p className="mt-0.5 text-muted">
        {props.progressComplete
          ? "Schedule complete"
          : `Day ${props.progressDay ?? 1} of ${props.progressTotal}`}
        {props.warmupStartedAt
          ? `, started ${new Date(props.warmupStartedAt).toLocaleDateString()}`
          : ""}
      </p>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={busy}
          onClick={() => patch({ warmupRestart: true })}
        >
          Restart
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={busy}
          onClick={() => patch({ warmupEnabled: false })}
        >
          Disable
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-warning">{error}</p> : null}
    </div>
  );
}
