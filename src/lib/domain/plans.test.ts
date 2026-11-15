import { describe, expect, it } from "vitest";
import {
  PLAN_FEATURES,
  PLANS,
  canSend,
  getPlan,
  monthWindowEnd,
  monthWindowStart,
  planHasFeature,
  planPriceLabelPkr,
  projectionWithinQuota,
  remainingMonthlySends,
  withinAccountLimit,
  withinSeatLimit,
} from "./plans";
import { runPreflight, type PreflightInput } from "./preflight";

describe("plan catalog", () => {
  it("matches the published catalog", () => {
    expect(getPlan("FREE")).toMatchObject({ name: "Free", seats: 2, sendingAccounts: 2, monthlySends: 1000, priceMonthlyPkr: 0 });
    expect(getPlan("STARTER")).toMatchObject({ name: "Starter", seats: 3, sendingAccounts: 3, monthlySends: 5000, priceMonthlyPkr: 299 });
    expect(getPlan("PRO")).toMatchObject({ name: "Growth", seats: 10, sendingAccounts: 10, monthlySends: 25000, priceMonthlyPkr: 499 });
    expect(getPlan("AGENCY")).toMatchObject({ name: "Pro", seats: null, sendingAccounts: 40, monthlySends: 100000, priceMonthlyPkr: 699 });
    expect(Object.keys(PLANS)).toHaveLength(4);
  });

  it("gates optional features by tier, with the top tier holding all of them", () => {
    for (const feature of PLAN_FEATURES) {
      expect(planHasFeature(PLANS.FREE, feature)).toBe(false);
      expect(planHasFeature(PLANS.STARTER, feature)).toBe(false);
      expect(planHasFeature(PLANS.AGENCY, feature)).toBe(true);
    }
    expect(planHasFeature(PLANS.PRO, "ai")).toBe(true);
    expect(planHasFeature(PLANS.PRO, "webhooks")).toBe(true);
    expect(planHasFeature(PLANS.PRO, "attachments")).toBe(true);
    expect(planHasFeature(PLANS.PRO, "trackingDomain")).toBe(true);
    expect(planHasFeature(PLANS.PRO, "api")).toBe(false);
    expect(planHasFeature(PLANS.PRO, "crm")).toBe(false);
  });

  it("formats PKR price labels", () => {
    expect(planPriceLabelPkr(PLANS.FREE)).toBe("Free");
    expect(planPriceLabelPkr(PLANS.STARTER)).toBe("Rs. 299/mo");
    expect(planPriceLabelPkr(PLANS.AGENCY)).toBe("Rs. 699/mo");
  });
});

describe("quota math", () => {
  it("computes remaining sends and never goes negative", () => {
    expect(remainingMonthlySends(PLANS.FREE, 250)).toBe(750);
    expect(remainingMonthlySends(PLANS.FREE, 1000)).toBe(0);
    expect(remainingMonthlySends(PLANS.FREE, 1400)).toBe(0);
  });

  it("canSend stops exactly at the limit", () => {
    expect(canSend(PLANS.FREE, 999)).toBe(true);
    expect(canSend(PLANS.FREE, 1000)).toBe(false);
  });

  it("projection check includes this month's usage", () => {
    expect(projectionWithinQuota(PLANS.FREE, 900, 100)).toBe(true);
    expect(projectionWithinQuota(PLANS.FREE, 900, 101)).toBe(false);
    expect(projectionWithinQuota(PLANS.PRO, 0, 25000)).toBe(true);
  });

  it("seat limits treat null as unlimited", () => {
    expect(withinSeatLimit(PLANS.FREE, 1)).toBe(true);
    expect(withinSeatLimit(PLANS.FREE, 2)).toBe(false);
    expect(withinSeatLimit(PLANS.AGENCY, 10000)).toBe(true);
  });

  it("account limits are hard caps", () => {
    expect(withinAccountLimit(PLANS.FREE, 1)).toBe(true);
    expect(withinAccountLimit(PLANS.FREE, 2)).toBe(false);
    expect(withinAccountLimit(PLANS.AGENCY, 39)).toBe(true);
    expect(withinAccountLimit(PLANS.AGENCY, 40)).toBe(false);
  });

  it("month windows are UTC calendar months", () => {
    const now = new Date("2026-10-26T17:55:00.000Z");
    expect(monthWindowStart(now).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(monthWindowEnd(now).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const december = new Date("2026-12-15T00:00:00.000Z");
    expect(monthWindowEnd(december).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

function basePreflightInput(quota: PreflightInput["quota"]): PreflightInput {
  return {
    steps: [{ subject: "Hello", body: "Body text" }],
    enrolledCount: 10,
    suppressedEnrolledCount: 0,
    accounts: [{ id: "a1", email: "sender@example.com", status: "CONNECTED", effectiveDailyLimit: 50 }],
    availableFields: ["email", "firstName"],
    unsubscribeConfigured: true,
    senderIdentity: { displayName: "Sender", postalAddress: "1 Street" },
    projectedDailyVolume: 10,
    quota,
  };
}

describe("preflight quota check", () => {
  it("fails when the projection exceeds the remaining quota", () => {
    const result = runPreflight(
      basePreflightInput({ planName: "Free", monthlyLimit: 1000, sentThisMonth: 950, projectedTotalSends: 100 }),
    );
    const quotaCheck = result.checks.find((check) => check.id === "quota");
    expect(quotaCheck?.status).toBe("fail");
    expect(result.canLaunch).toBe(false);
  });

  it("passes when the projection fits", () => {
    const result = runPreflight(
      basePreflightInput({ planName: "Free", monthlyLimit: 1000, sentThisMonth: 100, projectedTotalSends: 100 }),
    );
    const quotaCheck = result.checks.find((check) => check.id === "quota");
    expect(quotaCheck?.status).toBe("pass");
    expect(result.canLaunch).toBe(true);
  });

  it("adds no quota check when no quota context is supplied", () => {
    const result = runPreflight(basePreflightInput(undefined));
    expect(result.checks.find((check) => check.id === "quota")).toBeUndefined();
  });
});
