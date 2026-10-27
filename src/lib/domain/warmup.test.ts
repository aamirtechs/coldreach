import { describe, expect, it } from "vitest";
import {
  WARMUP_TOTAL_DAYS,
  WARMUP_WEEKLY_CAPS,
  effectiveDailyLimit,
  warmupAgeInDays,
  warmupCap,
  warmupCapFor,
  warmupProgress,
} from "./warmup";

const START = new Date("2026-01-05T12:00:00.000Z");
const daysAfter = (start: Date, days: number) => new Date(start.getTime() + days * 86_400_000);

describe("warmupCap: the weekly curve", () => {
  it("caps week 1 at 20 per day, boundaries included", () => {
    expect(warmupCap(0)).toBe(20);
    expect(warmupCap(3)).toBe(20);
    expect(warmupCap(6)).toBe(20);
  });

  it("caps week 2 at 50 per day starting on day 7", () => {
    expect(warmupCap(7)).toBe(50);
    expect(warmupCap(13)).toBe(50);
  });

  it("caps week 3 at 100 per day starting on day 14", () => {
    expect(warmupCap(14)).toBe(100);
    expect(warmupCap(20)).toBe(100);
  });

  it("caps week 4 at 200 per day starting on day 21", () => {
    expect(warmupCap(21)).toBe(200);
    expect(warmupCap(27)).toBe(200);
  });

  it("imposes no ceiling from day 28 on", () => {
    expect(warmupCap(28)).toBeNull();
    expect(warmupCap(90)).toBeNull();
    expect(WARMUP_WEEKLY_CAPS).toEqual([20, 50, 100, 200]);
    expect(WARMUP_TOTAL_DAYS).toBe(28);
  });

  it("treats a nonsensical negative age as day 0", () => {
    expect(warmupCap(-5)).toBe(20);
  });
});

describe("effectiveDailyLimit: warm-up layered on the account limit", () => {
  const account = { dailyLimit: 300, warmupEnabled: true, warmupStartedAt: START };

  it("returns the configured dailyLimit untouched when warm-up is disabled", () => {
    const off = { dailyLimit: 300, warmupEnabled: false, warmupStartedAt: START };
    expect(effectiveDailyLimit(off, daysAfter(START, 0))).toBe(300);
    expect(effectiveDailyLimit(off, daysAfter(START, 10))).toBe(300);
  });

  it("treats an enabled warm-up with no start date as day zero", () => {
    // Defensive case: the accounts API always stamps a start date
    // when warm-up is enabled, but the domain treats a missing one
    // as the first day of the schedule rather than no warm-up.
    const noStart = { dailyLimit: 300, warmupEnabled: true, warmupStartedAt: null };
    expect(effectiveDailyLimit(noStart, daysAfter(START, 1))).toBe(20);
  });

  it("applies the weekly cap while it is below the account limit", () => {
    expect(effectiveDailyLimit(account, daysAfter(START, 0))).toBe(20);
    expect(effectiveDailyLimit(account, daysAfter(START, 8))).toBe(50);
    expect(effectiveDailyLimit(account, daysAfter(START, 15))).toBe(100);
    expect(effectiveDailyLimit(account, daysAfter(START, 22))).toBe(200);
  });

  it("never raises a limit that is already below the warm-up cap", () => {
    const small = { dailyLimit: 10, warmupEnabled: true, warmupStartedAt: START };
    expect(effectiveDailyLimit(small, daysAfter(START, 0))).toBe(10);
    expect(effectiveDailyLimit(small, daysAfter(START, 22))).toBe(10);
  });

  it("returns the full account limit once the schedule completes", () => {
    expect(effectiveDailyLimit(account, daysAfter(START, 28))).toBe(300);
    expect(effectiveDailyLimit(account, daysAfter(START, 60))).toBe(300);
  });
});

describe("warmup helpers", () => {
  it("computes age in whole days and never negative", () => {
    expect(warmupAgeInDays(START, daysAfter(START, 2.9))).toBe(2);
    expect(warmupAgeInDays(START, daysAfter(START, -1))).toBe(0);
  });

  it("warmupCapFor is null when disabled or complete, and day zero when unstarted", () => {
    expect(warmupCapFor({ dailyLimit: 300, warmupEnabled: false, warmupStartedAt: START }, START)).toBeNull();
    expect(
      warmupCapFor({ dailyLimit: 300, warmupEnabled: true, warmupStartedAt: START }, daysAfter(START, 40)),
    ).toBeNull();
    expect(warmupCapFor({ dailyLimit: 300, warmupEnabled: true, warmupStartedAt: START }, START)).toBe(20);
    expect(warmupCapFor({ dailyLimit: 300, warmupEnabled: true, warmupStartedAt: null }, START)).toBe(20);
  });

  it("reports progress as a 1-based day inside the 28 day schedule", () => {
    expect(warmupProgress(START, START)).toMatchObject({ day: 1, totalDays: 28, complete: false });
    expect(warmupProgress(START, daysAfter(START, 27))).toMatchObject({
      day: 28,
      totalDays: 28,
      complete: false,
    });
    expect(warmupProgress(START, daysAfter(START, 28)).complete).toBe(true);
    expect(warmupProgress(null, START)).toMatchObject({ day: 1, complete: false });
  });
});
