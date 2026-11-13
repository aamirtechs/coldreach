import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOURLY_SEND_CAP,
  DEFAULT_TICK_SEND_CEILING,
  hourlyBudget,
  hourlySendCap,
  resolveHourlyCap,
  tickSendCeiling,
} from "./pacing";

describe("send pacing", () => {
  it("defaults to 90 per rolling hour and 20 per tick", () => {
    expect(hourlySendCap({})).toBe(DEFAULT_HOURLY_SEND_CAP);
    expect(tickSendCeiling({})).toBe(DEFAULT_TICK_SEND_CEILING);
    expect(DEFAULT_HOURLY_SEND_CAP).toBeLessThan(100);
  });

  it("honours environment overrides", () => {
    expect(hourlySendCap({ HOURLY_SEND_CAP: "250" })).toBe(250);
    expect(tickSendCeiling({ SEND_TICK_MAX_SENDS: "40" })).toBe(40);
  });

  it("falls back on unparsable or non-positive overrides", () => {
    expect(hourlySendCap({ HOURLY_SEND_CAP: "abc" })).toBe(DEFAULT_HOURLY_SEND_CAP);
    expect(hourlySendCap({ HOURLY_SEND_CAP: "0" })).toBe(DEFAULT_HOURLY_SEND_CAP);
    expect(tickSendCeiling({ SEND_TICK_MAX_SENDS: "-5" })).toBe(DEFAULT_TICK_SEND_CEILING);
  });

  it("computes the remaining hourly budget, floored at zero", () => {
    expect(hourlyBudget(0, 90)).toBe(90);
    expect(hourlyBudget(37, 90)).toBe(53);
    expect(hourlyBudget(90, 90)).toBe(0);
    expect(hourlyBudget(140, 90)).toBe(0);
  });

  it("resolves a workspace hourly cap over the platform cap (v1.24.0)", () => {
    expect(resolveHourlyCap(50, 90)).toBe(50);
    expect(resolveHourlyCap(200, 90)).toBe(200);
    expect(resolveHourlyCap(null, 90)).toBe(90);
    expect(resolveHourlyCap(undefined, 90)).toBe(90);
    expect(resolveHourlyCap(0, 90)).toBe(90);
    expect(resolveHourlyCap(-5, 90)).toBe(90);
  });
});
