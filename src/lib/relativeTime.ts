/**
 * Relative time labels (v1.17.0), for the inbox and outbox.
 *
 * "just now", "5 mins ago", "2 hrs ago", "3 days ago"; anything a
 * week or older falls back to the absolute date, because "23 days
 * ago" tells the reader less than the date does. Pure and
 * clock-injected so it is unit-testable and identical on the server
 * and the client.
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return "";
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "1 min ago";
  if (minutes < 60) return minutes === 1 ? "1 min ago" : `${minutes} mins ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * The exact moment, "13 Nov 2026, 01:00", in the viewer's timezone
 * unless one is named. Shown beside the relative label on send
 * records (v1.25.1) so "1 hr ago" never has to be taken on trust:
 * the reader can see the precise send time the label describes.
 */
export function formatExactTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Just the clock time, "01:00", for pairing with a date already shown. */
export function formatTimeOfDay(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
