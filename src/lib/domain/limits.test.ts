import { describe, expect, it } from "vitest";
import { effectiveDailyLimit } from "./limits";

describe("effectiveDailyLimit", () => {
  it("returns the cap when the ramp is disabled", () => {
    expect(effectiveDailyLimit({ dailyLimit: 200, ageInDays: 0 }, { enabled: false })).toBe(200);
  });

  it("returns the cap once the account is older than the ramp", () => {
    expect(effectiveDailyLimit({ dailyLimit: 200, ageInDays: 14 }, { rampDays: 14 })).toBe(200);
    expect(effectiveDailyLimit({ dailyLimit: 200, ageInDays: 90 }, { rampDays: 14 })).toBe(200);
  });

  it("starts at the configured percentage of the cap", () => {
    expect(
      effectiveDailyLimit({ dailyLimit: 100, ageInDays: 0 }, { rampDays: 14, startPercent: 20 }),
    ).toBe(20);
  });

  it("interpolates linearly through the ramp", () => {
    expect(
      effectiveDailyLimit({ dailyLimit: 100, ageInDays: 7 }, { rampDays: 14, startPercent: 20 }),
    ).toBe(60);
  });

  it("applies the default ramp of 14 days starting at 20 percent", () => {
    expect(effectiveDailyLimit({ dailyLimit: 50, ageInDays: 0 })).toBe(10);
  });

  it("never exceeds the cap, even with a start percent above 100", () => {
    expect(
      effectiveDailyLimit({ dailyLimit: 80, ageInDays: 0 }, { rampDays: 14, startPercent: 150 }),
    ).toBe(80);
  });

  it("returns zero when the cap is zero", () => {
    expect(effectiveDailyLimit({ dailyLimit: 0, ageInDays: 30 })).toBe(0);
  });

  it("guarantees at least one message for a positive cap", () => {
    expect(
      effectiveDailyLimit({ dailyLimit: 3, ageInDays: 0 }, { rampDays: 14, startPercent: 20 }),
    ).toBe(1);
  });
});
