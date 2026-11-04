"use client";

import { useEffect, useState } from "react";

/**
 * "+N new since your last check" badge for the Live sending cards
 * (v1.16.0).
 *
 * The baseline is the count this browser last saw for the metric,
 * kept in localStorage per workspace and metric. On each dashboard
 * visit (a refresh, or signing in again on this browser) the current
 * count is compared with that baseline: the difference shows as a
 * badge for this visit, and the baseline then moves to the current
 * count, so the next visit reports only what arrived in between.
 * The first ever visit just sets the baseline and shows nothing.
 * A count that went down (data removed) resets the baseline quietly.
 */
export function NewSinceLastCheck({
  workspaceId,
  metric,
  value,
  label,
}: {
  workspaceId: string;
  /** Stable metric key: "sent", "opened", or "replied". */
  metric: string;
  /** The current all-time count for the metric. */
  value: number;
  /** Plural noun for the badge, for example "new replies". */
  label: string;
}) {
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    const key = `coldreach-lastseen:${workspaceId}:${metric}`;
    try {
      const stored = window.localStorage.getItem(key);
      const previous = stored === null ? null : Number(stored);
      if (previous !== null && Number.isFinite(previous) && value > previous) {
        setDelta(value - previous);
      } else {
        setDelta(0);
      }
      window.localStorage.setItem(key, String(value));
    } catch {
      // Storage unavailable (private mode, blocked): no badge, no error.
      setDelta(0);
    }
  }, [workspaceId, metric, value]);

  if (delta <= 0) return null;
  return (
    <span className="mt-2 inline-flex items-center rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
      +{delta} {label} since your last check
    </span>
  );
}
