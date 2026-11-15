import { PLAN_ORDER, PLANS, planPriceLabelPkr, type PlanId } from "@/lib/domain/plans";

/**
 * Pricing page data (Phase 6, Stage B).
 *
 * The plan catalog in src/lib/domain/plans.ts is the single source
 * of truth for prices and limits; this module only formats it for
 * the public pricing page, so the page can never drift from what
 * the quota engine enforces and the billing page shows. The test in
 * pricing.test.ts pins that relationship.
 *
 * Prices are monthly, in PKR (v1.32.0). Paid plans are activated
 * with subscription keys sold by the ColdReach team; every surface
 * that shows prices carries PLACEHOLDER_PRICING_NOTE (the export
 * name is historical), exactly as the billing page does.
 */

export const PLACEHOLDER_PRICING_NOTE =
  "Prices are in Pakistani Rupees (PKR) per month. Paid plans are activated with a subscription key from the ColdReach team.";

export interface PricingRow {
  id: PlanId;
  name: string;
  /** "Rs. 499/mo", or "Free" for the FREE plan. */
  priceLabel: string;
  priceMonthlyPkr: number;
  /** "Unlimited" when the catalog carries null. */
  seatsLabel: string;
  seats: number | null;
  sendingAccounts: number;
  monthlySends: number;
  blurb: string;
}

const BLURBS: Record<PlanId, string> = {
  FREE: "The full workflow on a small list: campaigns, preflight, inbox, and analytics.",
  STARTER: "For solo senders getting started with regular campaigns.",
  PRO: "For growing senders who need AI help, webhooks, and more mailboxes.",
  AGENCY: "Every feature included, with the highest limits, for heavy senders and agencies.",
};

export function pricingRows(): PricingRow[] {
  return PLAN_ORDER.map((id) => {
    const plan = PLANS[id];
    return {
      id: plan.id,
      name: plan.name,
      priceLabel: planPriceLabelPkr(plan),
      priceMonthlyPkr: plan.priceMonthlyPkr,
      seatsLabel: plan.seats === null ? "Unlimited" : String(plan.seats),
      seats: plan.seats,
      sendingAccounts: plan.sendingAccounts,
      monthlySends: plan.monthlySends,
      blurb: BLURBS[plan.id],
    };
  });
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}
