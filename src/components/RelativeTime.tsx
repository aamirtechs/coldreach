"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/lib/relativeTime";

/**
 * A timestamp shown as relative time (v1.17.0): "5 mins ago".
 *
 * Follows the LocalTime pattern: the server-rendered fallback (an
 * absolute string) shows first, then the client swaps in the
 * relative label and refreshes it every minute, so a page left open
 * keeps honest ages. The exact moment stays available as the
 * element's title and dateTime.
 */
export function RelativeTime({ iso, fallback }: { iso: string; fallback: string }) {
  const [text, setText] = useState(fallback);
  const [title, setTitle] = useState(fallback);

  useEffect(() => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return;
    setTitle(date.toLocaleString());
    const update = () => setText(formatRelativeTime(date));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [iso]);

  return (
    <time dateTime={iso} title={title} suppressHydrationWarning>
      {text}
    </time>
  );
}
