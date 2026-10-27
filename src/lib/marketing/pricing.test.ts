import { describe, expect, it } from "vitest";
import { PLAN_ORDER, PLANS } from "@/lib/domain/plans";
import { PLACEHOLDER_PRICING_NOTE, pricingRows } from "./pricing";

/**
 * No-drift guarantee for the public pricing page (Phase 6, Stage
 * B): the page is rendered from pricingRows(), and pricingRows()
 * must equal the plan catalog exactly, in catalog order, so the
 * marketing surface can never disagree with the quota engine or
 * the billing page.
 */
describe("pricingRows equals the plan catalog", () => {
  it("covers every plan in catalog order with identical values", () => {
    const rows = pricingRows();
    expect(rows.map((row) => row.id)).toEqual([...PLAN_ORDER]);
    for (const row of rows) {
      const plan = PLANS[row.id];
      expect(row.name).toBe(plan.name);
      expect(row.priceMonthlyUsd).toBe(plan.priceMonthlyUsd);
      expect(row.seats).toBe(plan.seats);
      expect(row.sendingAccounts).toBe(plan.sendingAccounts);
      expect(row.monthlySends).toBe(plan.monthlySends);
    }
  });

  it("formats prices and unlimited seats for display", () => {
    const rows = pricingRows();
    const free = rows.find((row) => row.id === "FREE");
    const agency = rows.find((row) => row.id === "AGENCY");
    expect(free?.priceLabel).toBe("Free");
    expect(agency?.priceLabel).toBe(`$${PLANS.AGENCY.priceMonthlyUsd}/mo`);
    expect(agency?.seatsLabel).toBe("Unlimited");
    expect(free?.seatsLabel).toBe(String(PLANS.FREE.seats));
  });

  it("carries the same placeholder pricing label as the billing page", () => {
    expect(PLACEHOLDER_PRICING_NOTE).toBe(
      "Prices shown are placeholder pricing until the owner creates the real Stripe prices.",
    );
  });
});
