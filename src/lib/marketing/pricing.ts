import { PLAN_ORDER, PLANS, type PlanId } from "@/lib/domain/plans";

/**
 * Pricing page data (Phase 6, Stage B).
 *
 * The plan catalog in src/lib/domain/plans.ts is the single source
 * of truth for prices and limits; this module only formats it for
 * the public pricing page, so the page can never drift from what
 * the quota engine enforces and the billing page shows. The test in
 * pricing.test.ts pins that relationship.
 *
 * Prices in the catalog are placeholder pricing until the owner
 * creates the real Stripe products and prices; every surface that
 * shows them carries PLACEHOLDER_PRICING_NOTE, exactly as the
 * billing page does.
 */

export const PLACEHOLDER_PRICING_NOTE =
  "Prices shown are placeholder pricing until the owner creates the real Stripe prices.";

export interface PricingRow {
  id: PlanId;
  name: string;
  /** "$29/mo", or "Free" for the FREE plan. */
  priceLabel: string;
  priceMonthlyUsd: number;
  /** "Unlimited" when the catalog carries null. */
  seatsLabel: string;
  seats: number | null;
  sendingAccounts: number;
  monthlySends: number;
  blurb: string;
}

const BLURBS: Record<PlanId, string> = {
  FREE: "The full workflow on a small list: campaigns, preflight, inbox, and analytics.",
  STARTER: "For founders and solo senders running campaigns every week.",
  PRO: "For sales teams sending from several mailboxes with room to grow.",
  AGENCY: "For lead generation agencies running many client workspaces.",
};

export function pricingRows(): PricingRow[] {
  return PLAN_ORDER.map((id) => {
    const plan = PLANS[id];
    return {
      id: plan.id,
      name: plan.name,
      priceLabel: plan.priceMonthlyUsd === 0 ? "Free" : `$${plan.priceMonthlyUsd}/mo`,
      priceMonthlyUsd: plan.priceMonthlyUsd,
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
