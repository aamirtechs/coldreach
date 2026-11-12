import { describe, expect, it } from "vitest";
import { computeNextSendAt, type ScheduleOptions } from "./scheduling";

// January 2026 reference points: Thu 1st, Fri 2nd, Sat 3rd, Sun 4th, Mon 5th, Tue 6th.
const base: ScheduleOptions = {
  timezone: "UTC",
  windowStart: "09:00",
  windowEnd: "17:00",
  businessDaysOnly: true,
  delayHours: 0,
};

describe("computeNextSendAt", () => {
  it("returns the instant unchanged when inside the window on a business day", () => {
    const result = computeNextSendAt(new Date("2026-01-05T15:00:00Z"), base);
    expect(result.toISOString()).toBe("2026-01-05T15:00:00.000Z");
  });

  it("snaps a pre-window time to the window start on the same day", () => {
    const result = computeNextSendAt(new Date("2026-01-05T07:30:00Z"), base);
    expect(result.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("moves a post-window time to the next business day window start", () => {
    const result = computeNextSendAt(new Date("2026-01-05T17:30:00Z"), base);
    expect(result.toISOString()).toBe("2026-01-06T09:00:00.000Z");
  });

  it("applies the delay before window rules", () => {
    const result = computeNextSendAt(new Date("2026-01-05T09:00:00Z"), {
      ...base,
      delayHours: 3,
    });
    expect(result.toISOString()).toBe("2026-01-05T12:00:00.000Z");
  });

  it("rolls to the next day when the delay pushes past the window end", () => {
    const result = computeNextSendAt(new Date("2026-01-05T16:30:00Z"), {
      ...base,
      delayHours: 2,
    });
    expect(result.toISOString()).toBe("2026-01-06T09:00:00.000Z");
  });

  it("skips the weekend when business days only is set", () => {
    const result = computeNextSendAt(new Date("2026-01-02T18:00:00Z"), base);
    expect(result.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("skips a Saturday start to Monday when business days only is set", () => {
    const result = computeNextSendAt(new Date("2026-01-03T10:00:00Z"), base);
    expect(result.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("allows weekend sending when business days only is off", () => {
    const result = computeNextSendAt(new Date("2026-01-03T10:00:00Z"), {
      ...base,
      businessDaysOnly: false,
    });
    expect(result.toISOString()).toBe("2026-01-03T10:00:00.000Z");
  });

  it("evaluates the window in the campaign timezone, not UTC", () => {
    // 13:30 UTC is 08:30 in New York in January, before the 09:00 window.
    const result = computeNextSendAt(new Date("2026-01-05T13:30:00Z"), {
      ...base,
      timezone: "America/New_York",
    });
    expect(result.toISOString()).toBe("2026-01-05T14:00:00.000Z");
  });

  it("keeps a time that is inside the window in the campaign timezone", () => {
    // 16:00 UTC is 11:00 in New York, comfortably inside the window.
    const result = computeNextSendAt(new Date("2026-01-05T16:00:00Z"), {
      ...base,
      timezone: "America/New_York",
    });
    expect(result.toISOString()).toBe("2026-01-05T16:00:00.000Z");
  });

  it("throws on a malformed window time", () => {
    expect(() =>
      computeNextSendAt(new Date("2026-01-05T10:00:00Z"), { ...base, windowStart: "9am" }),
    ).toThrow();
  });

  // Overnight windows (v1.23.1): an end at or before the start
  // means the window closes after midnight. The production case
  // was 05:00 to 00:00 in America/New_York with business days
  // only, which previously threw "could not find a slot within
  // 366 days" for every instant. November 2026 reference points:
  // Thu 12th, Fri 13th, Sat 14th, Sun 15th, Mon 16th; New York is
  // on EST (UTC-5).
  describe("overnight windows", () => {
    const overnight: ScheduleOptions = {
      timezone: "America/New_York",
      windowStart: "05:00",
      windowEnd: "00:00",
      businessDaysOnly: true,
      delayHours: 0,
    };

    it("keeps a morning time inside a 05:00 to 00:00 window", () => {
      // 12:00 UTC is 07:00 EST on Thursday, inside the window.
      const result = computeNextSendAt(new Date("2026-11-12T12:00:00Z"), overnight);
      expect(result.toISOString()).toBe("2026-11-12T12:00:00.000Z");
    });

    it("snaps a pre-open time to the 05:00 opening the same day", () => {
      // 08:30 UTC is 03:30 EST, before the window opens.
      const result = computeNextSendAt(new Date("2026-11-12T08:30:00Z"), overnight);
      expect(result.toISOString()).toBe("2026-11-12T10:00:00.000Z");
    });

    it("keeps a late evening time inside the window that closes at midnight", () => {
      // 03:00 UTC Saturday is 22:00 EST on Friday; Friday's window
      // runs until midnight, so the instant is inside it.
      const result = computeNextSendAt(new Date("2026-11-14T03:00:00Z"), overnight);
      expect(result.toISOString()).toBe("2026-11-14T03:00:00.000Z");
    });

    it("moves a Saturday small-hours time to Monday's opening", () => {
      // 06:00 UTC Saturday is 01:00 EST. Friday's window closed at
      // midnight, and Saturday has no window of its own.
      const result = computeNextSendAt(new Date("2026-11-14T06:00:00Z"), overnight);
      expect(result.toISOString()).toBe("2026-11-16T10:00:00.000Z");
    });

    it("moves a Sunday time to Monday's opening", () => {
      // 15:00 UTC Sunday is 10:00 EST; the next opening is Monday.
      const result = computeNextSendAt(new Date("2026-11-15T15:00:00Z"), overnight);
      expect(result.toISOString()).toBe("2026-11-16T10:00:00.000Z");
    });

    it("honours the after-midnight tail of a true overnight window", () => {
      // 01:00 UTC with a 17:00 to 02:00 window belongs to the
      // previous day's window, still open for another hour.
      const result = computeNextSendAt(new Date("2026-01-05T01:00:00Z"), {
        timezone: "UTC",
        windowStart: "17:00",
        windowEnd: "02:00",
        businessDaysOnly: false,
        delayHours: 0,
      });
      expect(result.toISOString()).toBe("2026-01-05T01:00:00.000Z");
    });

    it("snaps a time after the tail closes to the next opening", () => {
      // 03:00 UTC is past the 02:00 close and before 17:00.
      const result = computeNextSendAt(new Date("2026-01-05T03:00:00Z"), {
        timezone: "UTC",
        windowStart: "17:00",
        windowEnd: "02:00",
        businessDaysOnly: false,
        delayHours: 0,
      });
      expect(result.toISOString()).toBe("2026-01-05T17:00:00.000Z");
    });
  });
});
