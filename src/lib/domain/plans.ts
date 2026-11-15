/**
 * Plan catalog and quota math.
 *
 * The catalog is configuration, not a database table: plan limits are
 * a product decision that changes by editing this file, and every
 * workspace's Subscription row only records which plan it is on.
 *
 * Paid plans are sold with subscription keys (v1.32.0): the platform
 * owner generates keys in the admin panel, a customer redeems one on
 * the Billing page, and the key grants its plan for a fixed number of
 * days (see src/lib/billing/keys.ts). Prices are monthly, in PKR.
 * A limit of null means unlimited for that dimension.
 *
 * Tier ids are historical (they key the Subscription.plan enum and
 * the Stripe scaffolding), so the display names carry the current
 * product naming: STARTER is "Starter", PRO is "Growth", and AGENCY
 * is "Pro", the top tier with every feature.
 *
 * Quota math is pure. Usage (sends this month, account count, seat
 * count) is measured from real rows by src/lib/billing/usage.ts and
 * passed in here, so the same functions drive the preflight check,
 * the worker hard stop, and the billing page.
 */

export type PlanId = "FREE" | "STARTER" | "PRO" | "AGENCY";

/** Optional capabilities a plan can include on top of the core product. */
export type PlanFeature =
  | "ai"
  | "webhooks"
  | "attachments"
  | "trackingDomain"
  | "api"
  | "crm";

export const PLAN_FEATURES: PlanFeature[] = [
  "ai",
  "webhooks",
  "attachments",
  "trackingDomain",
  "api",
  "crm",
];

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  ai: "AI features (icebreakers, subjects, rewrites)",
  webhooks: "Webhooks",
  attachments: "Campaign attachments",
  trackingDomain: "Custom tracking domain",
  api: "Public API keys",
  crm: "HubSpot CRM sync",
};

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in PKR. 0 for FREE. */
  priceMonthlyPkr: number;
  /** Memberships allowed, including pending invites. Null: unlimited. */
  seats: number | null;
  /** Sending accounts allowed. */
  sendingAccounts: number;
  /** SENT events allowed per calendar month (UTC). */
  monthlySends: number;
  /** Optional capabilities included in this plan. */
  features: Record<PlanFeature, boolean>;
}

const NO_FEATURES: Record<PlanFeature, boolean> = {
  ai: false,
  webhooks: false,
  attachments: false,
  trackingDomain: false,
  api: false,
  crm: false,
};

const GROWTH_FEATURES: Record<PlanFeature, boolean> = {
  ...NO_FEATURES,
  ai: true,
  webhooks: true,
  attachments: true,
  trackingDomain: true,
};

const ALL_FEATURES: Record<PlanFeature, boolean> = {
  ai: true,
  webhooks: true,
  attachments: true,
  trackingDomain: true,
  api: true,
  crm: true,
};

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: "FREE",
    name: "Free",
    priceMonthlyPkr: 0,
    seats: 2,
    sendingAccounts: 2,
    monthlySends: 1000,
    features: NO_FEATURES,
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    priceMonthlyPkr: 299,
    seats: 3,
    sendingAccounts: 3,
    monthlySends: 5000,
    features: NO_FEATURES,
  },
  PRO: {
    id: "PRO",
    name: "Growth",
    priceMonthlyPkr: 499,
    seats: 10,
    sendingAccounts: 10,
    monthlySends: 25000,
    features: GROWTH_FEATURES,
  },
  AGENCY: {
    id: "AGENCY",
    name: "Pro",
    priceMonthlyPkr: 699,
    seats: null,
    sendingAccounts: 40,
    monthlySends: 100000,
    features: ALL_FEATURES,
  },
};

export const PLAN_ORDER: PlanId[] = ["FREE", "STARTER", "PRO", "AGENCY"];

/** Plans a subscription key can grant (everything except FREE). */
export const KEY_PLAN_IDS: PlanId[] = ["STARTER", "PRO", "AGENCY"];

export function isPlanId(value: string): value is PlanId {
  return value === "FREE" || value === "STARTER" || value === "PRO" || value === "AGENCY";
}

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

/** True when the plan includes the given optional feature. */
export function planHasFeature(plan: Plan, feature: PlanFeature): boolean {
  return plan.features[feature] === true;
}

/** Customer-facing message when a plan gate refuses a feature. */
export function featureUpgradeMessage(feature: PlanFeature): string {
  const short: Record<PlanFeature, string> = {
    ai: "AI features",
    webhooks: "webhooks",
    attachments: "campaign attachments",
    trackingDomain: "a custom tracking domain",
    api: "public API keys",
    crm: "HubSpot CRM sync",
  };
  return `Your current plan does not include ${short[feature]}. Redeem a higher subscription key on the Billing page to unlock it.`;
}

/** "Rs. 499/mo" style label, or "Free". */
export function planPriceLabelPkr(plan: Plan): string {
  return plan.priceMonthlyPkr === 0 ? "Free" : `Rs. ${plan.priceMonthlyPkr}/mo`;
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
