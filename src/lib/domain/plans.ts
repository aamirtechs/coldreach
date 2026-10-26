/**
 * Plan catalog and quota math.
 *
 * The catalog is configuration, not a database table: plan limits are
 * a product decision that changes by editing this file, and every
 * workspace's Subscription row only records which plan it is on.
 * Prices are placeholder pricing until the owner creates the real
 * Stripe products and prices (see INTEGRATIONS.md); the UI labels
 * them as such. A limit of null means unlimited for that dimension.
 *
 * Quota math is pure. Usage (sends this month, account count, seat
 * count) is measured from real rows by src/lib/billing/usage.ts and
 * passed in here, so the same functions drive the preflight check,
 * the worker hard stop, and the billing page.
 */

export type PlanId = "FREE" | "STARTER" | "PRO" | "AGENCY";

export interface Plan {
  id: PlanId;
  name: string;
  /** Placeholder monthly price in USD. 0 for FREE. */
  priceMonthlyUsd: number;
  /** Memberships allowed, including pending invites. Null: unlimited. */
  seats: number | null;
  /** Sending accounts allowed. */
  sendingAccounts: number;
  /** SENT events allowed per calendar month (UTC). */
  monthlySends: number;
}

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: "FREE",
    name: "Free",
    priceMonthlyUsd: 0,
    seats: 2,
    sendingAccounts: 2,
    monthlySends: 1000,
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    priceMonthlyUsd: 29,
    seats: 5,
    sendingAccounts: 5,
    monthlySends: 10000,
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    priceMonthlyUsd: 79,
    seats: 15,
    sendingAccounts: 15,
    monthlySends: 50000,
  },
  AGENCY: {
    id: "AGENCY",
    name: "Agency",
    priceMonthlyUsd: 199,
    seats: null,
    sendingAccounts: 40,
    monthlySends: 200000,
  },
};

export const PLAN_ORDER: PlanId[] = ["FREE", "STARTER", "PRO", "AGENCY"];

export function isPlanId(value: string): value is PlanId {
  return value === "FREE" || value === "STARTER" || value === "PRO" || value === "AGENCY";
}

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

/** Sends remaining this month under the plan (never negative). */
export function remainingMonthlySends(plan: Plan, sentThisMonth: number): number {
  return Math.max(0, plan.monthlySends - sentThisMonth);
}

/** True when one more send fits inside the monthly quota. */
export function canSend(plan: Plan, sentThisMonth: number): boolean {
  return sentThisMonth < plan.monthlySends;
}

/**
 * True when a campaign whose total projected sends (across its whole
 * sequence, if it runs to completion) would still fit inside this
 * month's remaining quota.
 */
export function projectionWithinQuota(
  plan: Plan,
  sentThisMonth: number,
  projectedSends: number,
): boolean {
  return sentThisMonth + projectedSends <= plan.monthlySends;
}

/** True when current usage is below a seat limit (null is unlimited). */
export function withinSeatLimit(plan: Plan, seatsUsed: number): boolean {
  return plan.seats === null || seatsUsed < plan.seats;
}

/** True when current usage is below the sending account limit. */
export function withinAccountLimit(plan: Plan, accountsUsed: number): boolean {
  return accountsUsed < plan.sendingAccounts;
}

/** Start of the current calendar month in UTC (quota window open). */
export function monthWindowStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Start of the next calendar month in UTC (quota window close). */
export function monthWindowEnd(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
