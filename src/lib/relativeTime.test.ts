import { describe, expect, it } from "vitest";
import { formatExactTime, formatRelativeTime, formatTimeOfDay, formatTimeUntil } from "./relativeTime";

const NOW = new Date("2026-11-04T18:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("formatRelativeTime", () => {
  it("labels fresh timestamps as just now, then minutes", () => {
    expect(formatRelativeTime(ago(10_000), NOW)).toBe("just now");
    expect(formatRelativeTime(ago(60_000), NOW)).toBe("1 min ago");
    expect(formatRelativeTime(ago(5 * 60_000), NOW)).toBe("5 mins ago");
    expect(formatRelativeTime(ago(59 * 60_000), NOW)).toBe("59 mins ago");
  });

  it("rolls up to hours and days with correct singulars", () => {
    expect(formatRelativeTime(ago(60 * 60_000), NOW)).toBe("1 hr ago");
    expect(formatRelativeTime(ago(3 * 3_600_000), NOW)).toBe("3 hrs ago");
    expect(formatRelativeTime(ago(24 * 3_600_000), NOW)).toBe("1 day ago");
    expect(formatRelativeTime(ago(3 * 86_400_000), NOW)).toBe("3 days ago");
  });

  it("falls back to the absolute date at a week and older", () => {
    expect(formatRelativeTime(ago(7 * 86_400_000), NOW)).toBe("28 Oct 2026");
    expect(formatRelativeTime(ago(40 * 86_400_000), NOW)).toBe("25 Sept 2026");
  });

  it("never claims a future time is in the past", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 30_000), NOW)).toBe("just now");
  });
});

describe("formatExactTime and formatTimeOfDay", () => {
  it("prints the full date and clock time in the named zone", () => {
    expect(formatExactTime(new Date("2026-11-13T01:00:12Z"), "UTC")).toBe("13 Nov 2026, 01:00");
    expect(formatExactTime(new Date("2026-11-13T01:00:12Z"), "America/New_York")).toBe(
      "12 Nov 2026, 20:00",
    );
  });

  it("prints just the clock time in the named zone", () => {
    expect(formatTimeOfDay(new Date("2026-11-13T01:00:12Z"), "UTC")).toBe("01:00");
    expect(formatTimeOfDay(new Date("2026-11-13T01:00:12Z"), "Asia/Karachi")).toBe("06:00");
  });
});

describe("formatTimeUntil (v1.29.1, In Queue countdowns)", () => {
  const ahead = (ms: number) => new Date(NOW.getTime() + ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("reads due now at and past the moment", () => {
    expect(formatTimeUntil(NOW, NOW)).toBe("due now");
    expect(formatTimeUntil(ago(MIN), NOW)).toBe("due now");
  });

  it("labels sub-minute and minute waits", () => {
    expect(formatTimeUntil(ahead(30_000), NOW)).toBe("in under a min");
    expect(formatTimeUntil(ahead(MIN), NOW)).toBe("in 1 min");
    expect(formatTimeUntil(ahead(5 * MIN), NOW)).toBe("in 5 mins");
    expect(formatTimeUntil(ahead(59 * MIN), NOW)).toBe("in 59 mins");
  });

  it("combines hours and minutes with correct singulars", () => {
    expect(formatTimeUntil(ahead(HOUR), NOW)).toBe("in 1 hr");
    expect(formatTimeUntil(ahead(2 * HOUR), NOW)).toBe("in 2 hrs");
    expect(formatTimeUntil(ahead(2 * HOUR + 15 * MIN), NOW)).toBe("in 2 hrs 15 mins");
    expect(formatTimeUntil(ahead(HOUR + MIN), NOW)).toBe("in 1 hr 1 min");
  });

  it("rolls up to days with an hour remainder", () => {
    expect(formatTimeUntil(ahead(DAY), NOW)).toBe("in 1 day");
    expect(formatTimeUntil(ahead(DAY + 2 * HOUR), NOW)).toBe("in 1 day 2 hrs");
    expect(formatTimeUntil(ahead(3 * DAY + HOUR), NOW)).toBe("in 3 days 1 hr");
  });
});
