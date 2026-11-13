import { describe, expect, it } from "vitest";
import { formatExactTime, formatRelativeTime, formatTimeOfDay } from "./relativeTime";

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
