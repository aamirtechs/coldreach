"use client";

import { useEffect, useState } from "react";
import { formatExactTime, formatRelativeTime, formatTimeOfDay } from "@/lib/relativeTime";

/**
 * A timestamp shown as relative time (v1.17.0): "5 mins ago".
 *
 * Follows the LocalTime pattern: the server-rendered fallback (an
 * absolute string) shows first, then the client swaps in the
 * relative label and refreshes it every minute, so a page left open
 * keeps honest ages. The exact moment stays available as the
 * element's title and dateTime.
 *
 * With showExact (v1.25.1, the Outbox send records), the exact
 * moment is printed beside the label instead of only on hover:
 * "1 hr ago · 13 Nov 2026, 01:00" in the viewer's timezone. When
 * the relative label has already fallen back to a plain date, only
 * the clock time is appended, so the date is not repeated.
 */
export function RelativeTime({
  iso,
  fallback,
  showExact = false,
}: {
  iso: string;
  fallback: string;
  showExact?: boolean;
}) {
  const [text, setText] = useState(fallback);
  const [title, setTitle] = useState(fallback);

  useEffect(() => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return;
    setTitle(date.toLocaleString());
    const update = () => {
      const relative = formatRelativeTime(date);
      if (!showExact) {
        setText(relative);
      } else if (/\d{4}$/.test(relative)) {
        setText(`${relative}, ${formatTimeOfDay(date)}`);
      } else {
        setText(`${relative} · ${formatExactTime(date)}`);
      }
    };
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [iso, showExact]);

  return (
    <time dateTime={iso} title={title} suppressHydrationWarning>
      {text}
    </time>
  );
}
