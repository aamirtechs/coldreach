/**
 * Best-time-to-call helpers for the Calling section (v1.44.0). A
 * call lead can carry a timezone (IANA name) plus a best window in
 * lead-local hours (bestStartHour, bestEndHour, fractional values
 * like 7.5 allowed). These pure helpers turn that into the lead's
 * current local time and a simple "inside the window or not"
 * verdict, so the call panel and the list chips agree. When a lead
 * has a timezone but no window, the house default is 9 to 11 in
 * the morning, lead local, which is the window the researched
 * script pack recommends.
 */

export const US_TIMEZONES = [
  "America/New_York",
  "America/Detroit",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

export const DEFAULT_BEST_START_HOUR = 9;
export const DEFAULT_BEST_END_HOUR = 11;

export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function fieldNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export interface CallWindow {
  startHour: number;
  endHour: number;
  /** True when the window came from the 9 to 11 default, not the lead. */
  defaulted: boolean;
}

/** The effective best window for a lead's fields, or null without a timezone. */
export function callWindowForFields(fields: Record<string, unknown> | null | undefined): CallWindow | null {
  if (!fields || !isValidTimezone(fields.timezone)) return null;
  const start = fieldNumber(fields.bestStartHour);
  const end = fieldNumber(fields.bestEndHour);
  if (start !== null && end !== null && end > start) {
    return { startHour: start, endHour: end, defaulted: false };
  }
  return {
    startHour: DEFAULT_BEST_START_HOUR,
    endHour: DEFAULT_BEST_END_HOUR,
    defaulted: true,
  };
}

/** Lead-local time parts for an instant, or null for a bad timezone. */
export function leadLocalTime(
  timezone: string,
  now: Date = new Date(),
): { label: string; hourFloat: number } | null {
  if (!isValidTimezone(timezone)) return null;
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return { label, hourFloat: hour + minute / 60 };
}

export type CallWindowState = "good" | "outside" | "unknown";

export interface CallWindowStatus {
  state: CallWindowState;
  /** Formatted lead-local time, empty when the timezone is unknown. */
  localTimeLabel: string;
  window: CallWindow | null;
}

/**
 * The call-now verdict for one lead: "good" inside its best window,
 * "outside" when the local time is known but outside the window,
 * "unknown" when the lead carries no usable timezone.
 */
export function callWindowStatus(
  fields: Record<string, unknown> | null | undefined,
  now: Date = new Date(),
): CallWindowStatus {
  const timezone = fields && typeof fields.timezone === "string" ? fields.timezone : "";
  const local = timezone ? leadLocalTime(timezone, now) : null;
  const window = callWindowForFields(fields);
  if (!local || !window) {
    return { state: "unknown", localTimeLabel: "", window: null };
  }
  const inside = local.hourFloat >= window.startHour && local.hourFloat < window.endHour;
  return { state: inside ? "good" : "outside", localTimeLabel: local.label, window };
}

/** Short human label for an hour value: 9 -> "9am", 7.5 -> "7:30am". */
export function formatHour(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  const suffix = whole >= 12 && whole < 24 ? "pm" : "am";
  const twelve = whole % 12 === 0 ? 12 : whole % 12;
  return minutes ? `${twelve}:${String(minutes).padStart(2, "0")}${suffix}` : `${twelve}${suffix}`;
}
