import { describe, expect, it } from "vitest";
import {
  callWindowForFields,
  callWindowStatus,
  formatHour,
  isLeadLocalSaturday,
  isValidTimezone,
  leadLocalTime,
  leadLocalWeekday,
} from "./callWindow";

// 2026-11-20 15:00 UTC is 10:00 in New York (EST, UTC-5) and
// 08:00 in Phoenix (MST, UTC-7, no daylight saving).
const TEN_AM_NEW_YORK = new Date("2026-11-20T15:00:00Z");

describe("isValidTimezone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("America/Phoenix")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(42)).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
  });
});

describe("callWindowForFields", () => {
  it("returns null without a usable timezone", () => {
    expect(callWindowForFields({})).toBeNull();
    expect(callWindowForFields({ timezone: "Mars/Olympus" })).toBeNull();
    expect(callWindowForFields(null)).toBeNull();
  });

  it("defaults to 9 to 11 when a timezone is set and the hours are empty", () => {
    expect(callWindowForFields({ timezone: "America/New_York" })).toEqual({
      startHour: 9,
      endHour: 11,
      defaulted: true,
    });
  });

  it("uses the lead's own hours, including fractional and string values", () => {
    expect(
      callWindowForFields({ timezone: "America/Phoenix", bestStartHour: 7.5, bestEndHour: 9 }),
    ).toEqual({ startHour: 7.5, endHour: 9, defaulted: false });
    expect(
      callWindowForFields({ timezone: "America/Phoenix", bestStartHour: "8", bestEndHour: "10" }),
    ).toEqual({ startHour: 8, endHour: 10, defaulted: false });
  });

  it("falls back to the default when the stored window is backwards", () => {
    expect(
      callWindowForFields({ timezone: "America/New_York", bestStartHour: 11, bestEndHour: 9 }),
    ).toEqual({ startHour: 9, endHour: 11, defaulted: true });
  });
});

describe("leadLocalTime", () => {
  it("formats the lead's local time and hour", () => {
    const local = leadLocalTime("America/New_York", TEN_AM_NEW_YORK);
    expect(local?.hourFloat).toBe(10);
    expect(local?.label).toContain("10:00 AM");
  });

  it("returns null for a bad timezone", () => {
    expect(leadLocalTime("Nowhere/Special", TEN_AM_NEW_YORK)).toBeNull();
  });
});

describe("callWindowStatus", () => {
  it("is good inside the default 9 to 11 window", () => {
    const status = callWindowStatus({ timezone: "America/New_York" }, TEN_AM_NEW_YORK);
    expect(status.state).toBe("good");
    expect(status.localTimeLabel).toContain("10:00 AM");
  });

  it("is outside when the local time misses the window", () => {
    // 08:00 in Phoenix, default window 9 to 11.
    const status = callWindowStatus({ timezone: "America/Phoenix" }, TEN_AM_NEW_YORK);
    expect(status.state).toBe("outside");
  });

  it("honours a fractional early window", () => {
    // 14:00 UTC is 07:00 in Phoenix, before a 7.5 start.
    const atSeven = callWindowStatus(
      { timezone: "America/Phoenix", bestStartHour: 7.5, bestEndHour: 9 },
      new Date("2026-11-20T14:00:00Z"),
    );
    expect(atSeven.state).toBe("outside");
    const atEightThirty = callWindowStatus(
      { timezone: "America/Phoenix", bestStartHour: 7.5, bestEndHour: 9 },
      new Date("2026-11-20T15:30:00Z"),
    );
    // 15:30 UTC is 08:30 in Phoenix, inside 7.5 to 9.
    expect(atEightThirty.state).toBe("good");
  });

  it("is unknown without a timezone", () => {
    expect(callWindowStatus({}).state).toBe("unknown");
    expect(callWindowStatus(null).state).toBe("unknown");
  });
});

describe("Saturday detection (v1.48.0)", () => {
  // 2026-11-21 is a Saturday; 15:00 UTC is 10:00 in New York and
  // already Sunday 04:00 in Auckland, so one instant can be both.
  const SATURDAY_UTC = new Date("2026-11-21T15:00:00Z");
  const FRIDAY_UTC = new Date("2026-11-20T15:00:00Z");

  it("reads the weekday in the lead's own timezone", () => {
    expect(leadLocalWeekday("America/New_York", SATURDAY_UTC)).toBe("Sat");
    expect(leadLocalWeekday("America/New_York", FRIDAY_UTC)).toBe("Fri");
    expect(leadLocalWeekday("Pacific/Auckland", SATURDAY_UTC)).toBe("Sun");
    expect(leadLocalWeekday("Mars/Olympus", SATURDAY_UTC)).toBeNull();
  });

  it("flags Saturday only in the lead's timezone", () => {
    expect(isLeadLocalSaturday("America/New_York", SATURDAY_UTC)).toBe(true);
    expect(isLeadLocalSaturday("America/New_York", FRIDAY_UTC)).toBe(false);
    expect(isLeadLocalSaturday("Pacific/Auckland", SATURDAY_UTC)).toBe(false);
    expect(isLeadLocalSaturday("", SATURDAY_UTC)).toBe(false);
    expect(isLeadLocalSaturday(null, SATURDAY_UTC)).toBe(false);
  });
});

describe("formatHour", () => {
  it("renders whole and fractional hours", () => {
    expect(formatHour(9)).toBe("9am");
    expect(formatHour(11)).toBe("11am");
    expect(formatHour(7.5)).toBe("7:30am");
    expect(formatHour(13)).toBe("1pm");
    expect(formatHour(12)).toBe("12pm");
    expect(formatHour(0)).toBe("12am");
  });
});
