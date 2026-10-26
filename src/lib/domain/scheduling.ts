/**
 * Campaign send scheduling.
 *
 * Computes the next moment an email may be sent, given a campaign timezone,
 * a local sending window, an optional business days only rule, and a delay.
 * Timezone handling uses Intl so no external date library is required.
 * Business days are Monday to Friday in the campaign timezone.
 */

export interface ScheduleOptions {
  /** IANA timezone name, for example "America/New_York". */
  timezone: string;
  /** Local window start, "HH:MM" 24 hour. */
  windowStart: string;
  /** Local window end, "HH:MM" 24 hour. */
  windowEnd: string;
  /** When true, Saturdays and Sundays are skipped. */
  businessDaysOnly: boolean;
  /** Delay in hours applied to the starting instant before window rules. */
  delayHours: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = formatter(timezone).formatToParts(date);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset between the zoned wall clock and UTC, in milliseconds, at an instant. */
function offsetMs(date: Date, timezone: string): number {
  const p = zonedParts(date, timezone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const instantSeconds = Math.floor(date.getTime() / 1000) * 1000;
  return wallAsUtc - instantSeconds;
}

/** Convert a wall clock time in a timezone into the matching UTC instant. */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = guess - offsetMs(new Date(guess), timezone);
  // A second pass handles instants close to a daylight saving transition.
  utc = guess - offsetMs(new Date(utc), timezone);
  return new Date(utc);
}

function parseWindowTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid window time "${value}", expected "HH:MM"`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid window time "${value}", expected "HH:MM"`);
  }
  return { hour, minute };
}

/** Day of week for a calendar date, 0 for Sunday through 6 for Saturday. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isBusinessDay(year: number, month: number, day: number): boolean {
  const weekday = weekdayOf(year, month, day);
  return weekday >= 1 && weekday <= 5;
}

function nextCalendarDay(year: number, month: number, day: number) {
  const next = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

/**
 * Returns the earliest instant at or after `from + delayHours` that falls
 * inside the sending window on an allowed day. The search is bounded to
 * 366 days so a pathological configuration cannot loop forever.
 */
export function computeNextSendAt(from: Date, options: ScheduleOptions): Date {
  const start = parseWindowTime(options.windowStart);
  const end = parseWindowTime(options.windowEnd);
  let cursor = new Date(from.getTime() + options.delayHours * 60 * 60 * 1000);

  for (let i = 0; i < 366; i += 1) {
    const p = zonedParts(cursor, options.timezone);
    const dayStart = zonedTimeToUtc(p.year, p.month, p.day, start.hour, start.minute, options.timezone);
    const dayEnd = zonedTimeToUtc(p.year, p.month, p.day, end.hour, end.minute, options.timezone);
    const allowedDay = !options.businessDaysOnly || isBusinessDay(p.year, p.month, p.day);

    if (allowedDay) {
      if (cursor.getTime() < dayStart.getTime()) {
        return dayStart;
      }
      if (cursor.getTime() <= dayEnd.getTime()) {
        return cursor;
      }
    }

    const next = nextCalendarDay(p.year, p.month, p.day);
    cursor = zonedTimeToUtc(next.year, next.month, next.day, start.hour, start.minute, options.timezone);
  }

  throw new Error("computeNextSendAt could not find a slot within 366 days");
}
