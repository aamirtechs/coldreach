import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { isPlanId } from "@/lib/domain/plans";
import { getOrCreateSubscription } from "@/lib/billing/subscription";
import { createCheckoutSession, getStripeConfig, stripeMissingEnv } from "@/lib/billing/stripe";
import { writeAuditLog } from "@/lib/audit";

/**
 * Creates a Stripe Checkout Session for a paid plan and returns its
 * URL. Until Stripe is configured this answers 501 naming the
 * missing variables; it never fabricates a checkout.
 */
export async function POST(request: Request) {
  const session = await requireSession("OWNER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const config = getStripeConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: "Billing is not configured on this server. Set the Stripe variables named in missingEnv (see INTEGRATIONS.md) to enable checkout.",
        missingEnv: stripeMissingEnv(),
      },
      { status: 501 },
    );
  }
  const body = await readJson<{ plan?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const plan = stringField(body.plan);
  if (!isPlanId(plan) || plan === "FREE") {
    return NextResponse.json(
      { error: "plan must be one of STARTER, PRO, AGENCY" },
      { status: 400 },
    );
  }
  try {
    const subscription = await getOrCreateSubscription(prisma, ctx.workspace.id);
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const checkout = await createCheckoutSession(config, {
      workspaceId: ctx.workspace.id,
      plan,
      successUrl: `${appUrl}/app/billing?checkout=success`,
      cancelUrl: `${appUrl}/app/billing?checkout=cancelled`,
      stripeCustomerId: subscription.stripeCustomerId,
      customerEmail: ctx.user.email,
    });
    await writeAuditLog({
      action: "billing.checkout_start",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { plan, sessionId: checkout.id },
    });
    return NextResponse.json({ url: checkout.url, sessionId: checkout.id });
  } catch (error) {
    return apiError(error);
  }
}
