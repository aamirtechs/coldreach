"use client";

import { useEffect, useState } from "react";

/**
 * An absolute timestamp shown in the viewer's own timezone (v1.8.3).
 *
 * Server-rendered pages cannot know the viewer's timezone, so they
 * pass the instant as ISO plus a UTC-labelled fallback string. The
 * fallback is what renders first; on mount the text swaps to the
 * browser's timezone, abbreviation included, so a viewer in Karachi
 * sees PKT and a viewer in New York sees EDT for the same instant.
 * Relative labels ("3h ago") are timezone-free and stay server-side.
 */
export function LocalTime({
  iso,
  fallback,
  format = "datetime",
}: {
  iso: string;
  fallback: string;
  format?: "datetime" | "date" | "time" | "full";
}) {
  const [text, setText] = useState(fallback);

  useEffect(() => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return;
    if (format === "full") {
      setText(date.toLocaleString());
    } else if (format === "date") {
      setText(
        new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(date),
      );
    } else if (format === "time") {
      setText(
        new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZoneName: "short",
        }).format(date),
      );
    } else {
      setText(
        new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZoneName: "short",
        }).format(date),
      );
    }
  }, [iso, format]);

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
