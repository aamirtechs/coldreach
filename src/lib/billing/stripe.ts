import { createHmac, timingSafeEqual } from "node:crypto";
import { PLANS, isPlanId, type PlanId } from "@/lib/domain/plans";

/**
 * Stripe access over the plain HTTPS API (no SDK dependency).
 *
 * Billing is credential gated, like OAuth and AI: until the owner
 * creates the Stripe products and sets the environment variables
 * listed in INTEGRATIONS.md, every billing route answers 501 naming
 * the missing variables and the Billing page says "Billing is not
 * configured", while plan quotas keep working through the manual
 * plan override. Nothing here pretends a payment happened.
 *
 * Prices in src/lib/domain/plans.ts are placeholders. The real amount
 * charged is whatever the Stripe price objects say; the env vars map
 * each paid plan to its price id.
 */

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string | null;
  prices: Partial<Record<Exclude<PlanId, "FREE">, string>>;
}

const PRICE_ENVS: Record<Exclude<PlanId, "FREE">, string> = {
  STARTER: "STRIPE_PRICE_STARTER",
  PRO: "STRIPE_PRICE_PRO",
  AGENCY: "STRIPE_PRICE_AGENCY",
};

export function stripeMissingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.STRIPE_SECRET_KEY) {
    missing.push("STRIPE_SECRET_KEY");
  }
  for (const envName of Object.values(PRICE_ENVS)) {
    if (!process.env[envName]) {
      missing.push(envName);
    }
  }
  return missing;
}

export function getStripeConfig(): StripeConfig | null {
  if (stripeMissingEnv().length > 0) {
    return null;
  }
  return {
    secretKey: process.env.STRIPE_SECRET_KEY as string,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
    prices: {
      STARTER: process.env.STRIPE_PRICE_STARTER,
      PRO: process.env.STRIPE_PRICE_PRO,
      AGENCY: process.env.STRIPE_PRICE_AGENCY,
    },
  };
}

export function priceIdForPlan(config: StripeConfig, plan: PlanId): string | null {
  if (plan === "FREE") {
    return null;
  }
  return config.prices[plan] ?? null;
}

export function planForPriceId(config: StripeConfig, priceId: string): PlanId | null {
  for (const plan of Object.keys(PRICE_ENVS) as Exclude<PlanId, "FREE">[]) {
    if (config.prices[plan] === priceId) {
      return plan;
    }
  }
  return null;
}

type FetchImpl = typeof fetch;

async function stripePost(
  config: StripeConfig,
  path: string,
  params: Record<string, string>,
  fetchImpl: FetchImpl = fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = data.error as { message?: string } | undefined;
    throw Object.assign(
      new Error(`Stripe request failed: ${error?.message ?? response.statusText}`),
      { status: 502 },
    );
  }
  return data;
}

export interface CheckoutSessionInput {
  workspaceId: string;
  plan: PlanId;
  successUrl: string;
  cancelUrl: string;
  stripeCustomerId?: string | null;
  customerEmail?: string;
}

export async function createCheckoutSession(
  config: StripeConfig,
  input: CheckoutSessionInput,
  fetchImpl: FetchImpl = fetch,
): Promise<{ id: string; url: string }> {
  const priceId = priceIdForPlan(config, input.plan);
  if (!priceId) {
    throw Object.assign(new Error(`No Stripe price is configured for the ${input.plan} plan.`), {
      status: 501,
    });
  }
  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.workspaceId,
    "metadata[workspaceId]": input.workspaceId,
    "metadata[plan]": input.plan,
    "subscription_data[metadata][workspaceId]": input.workspaceId,
    "subscription_data[metadata][plan]": input.plan,
  };
  if (input.stripeCustomerId) {
    params.customer = input.stripeCustomerId;
  } else if (input.customerEmail) {
    params.customer_email = input.customerEmail;
  }
  const session = await stripePost(config, "/v1/checkout/sessions", params, fetchImpl);
  return { id: String(session.id), url: String(session.url) };
}

export async function createPortalSession(
  config: StripeConfig,
  input: { stripeCustomerId: string; returnUrl: string },
  fetchImpl: FetchImpl = fetch,
): Promise<{ url: string }> {
  const session = await stripePost(
    config,
    "/v1/billing_portal/sessions",
    { customer: input.stripeCustomerId, return_url: input.returnUrl },
    fetchImpl,
  );
  return { url: String(session.url) };
}

/**
 * Verifies a Stripe webhook signature header ("t=...,v1=...") against
 * the raw request body. The signed payload is "{timestamp}.{body}"
 * under HMAC-SHA256 with the webhook secret. Timestamps older than
 * the tolerance are rejected to blunt replay.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = 300,
): boolean {
  if (!signatureHeader) {
    return false;
  }
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") {
      timestamp = value;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }
  if (!timestamp || signatures.length === 0) {
    return false;
  }
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(nowSeconds - timestampNumber) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  return signatures.some((signature) => {
    const candidate = Buffer.from(signature);
    return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
  });
}

/** Placeholder-price sanity note used by the billing UI copy. */
export function planPriceLabel(plan: PlanId): string {
  const entry = PLANS[plan];
  return entry.priceMonthlyUsd === 0 ? "Free" : `$${entry.priceMonthlyUsd}/mo`;
}

export { isPlanId };
