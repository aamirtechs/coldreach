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
});
