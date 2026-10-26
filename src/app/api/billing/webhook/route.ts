import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { isPlanId, type PlanId } from "@/lib/domain/plans";
import { getOrCreateSubscription } from "@/lib/billing/subscription";
import { getStripeConfig, planForPriceId, verifyStripeSignature } from "@/lib/billing/stripe";
import { writeAuditLog } from "@/lib/audit";

/**
 * Stripe webhook receiver.
 *
 * The signature is verified over the RAW body with
 * STRIPE_WEBHOOK_SECRET before anything is parsed or trusted.
 * Handled events keep the Subscription row in sync:
 * checkout.session.completed links the customer and subscription
 * and applies the purchased plan; customer.subscription.updated
 * re-derives the plan from the price id and refreshes the period;
 * customer.subscription.deleted returns the workspace to FREE.
 * Everything else is acknowledged and ignored.
 */

interface StripeObject {
  id?: string;
  customer?: string;
  subscription?: string;
  client_reference_id?: string;
  status?: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
  items?: { data?: { price?: { id?: string } }[] };
}

interface StripeEvent {
  type?: string;
  data?: { object?: StripeObject };
}

async function findByStripeSubscription(stripeSubscriptionId: string) {
  return prisma.subscription.findFirst({ where: { stripeSubscriptionId } });
}

async function handleCheckoutCompleted(object: StripeObject): Promise<void> {
  const workspaceId = object.metadata?.workspaceId ?? object.client_reference_id ?? null;
  if (!workspaceId) {
    return;
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return;
  }
  await getOrCreateSubscription(prisma, workspaceId);
  const plan = object.metadata?.plan;
  await prisma.subscription.update({
    where: { workspaceId },
    data: {
      stripeCustomerId: typeof object.customer === "string" ? object.customer : undefined,
      stripeSubscriptionId: typeof object.subscription === "string" ? object.subscription : undefined,
      ...(plan && isPlanId(plan) ? { plan: plan as PlanId } : {}),
      status: "ACTIVE",
    },
  });
  await writeAuditLog({
    action: "billing.checkout_completed",
    workspaceId,
    metadata: { plan: plan ?? null, stripeSubscriptionId: object.subscription ?? null },
  });
}

async function handleSubscriptionUpdated(object: StripeObject): Promise<void> {
  if (!object.id) {
    return;
  }
  const row = await findByStripeSubscription(object.id);
  if (!row) {
    return;
  }
  const config = getStripeConfig();
  const priceId = object.items?.data?.[0]?.price?.id;
  const plan = config && priceId ? planForPriceId(config, priceId) : null;
  const statusMap: Record<string, string> = {
    active: "ACTIVE",
    trialing: "TRIALING",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    unpaid: "UNPAID",
    incomplete: "INCOMPLETE",
  };
  await prisma.subscription.update({
    where: { id: row.id },
    data: {
      ...(plan ? { plan } : {}),
      ...(object.status ? { status: statusMap[object.status] ?? object.status.toUpperCase() } : {}),
      ...(typeof object.current_period_end === "number"
        ? { currentPeriodEnd: new Date(object.current_period_end * 1000) }
        : {}),
      ...(typeof object.cancel_at_period_end === "boolean"
        ? { cancelAtPeriodEnd: object.cancel_at_period_end }
        : {}),
      ...(typeof object.customer === "string" ? { stripeCustomerId: object.customer } : {}),
    },
  });
}

async function handleSubscriptionDeleted(object: StripeObject): Promise<void> {
  if (!object.id) {
    return;
  }
  const row = await findByStripeSubscription(object.id);
  if (!row) {
    return;
  }
  await prisma.subscription.update({
    where: { id: row.id },
    data: {
      plan: "FREE",
      status: "CANCELED",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
  });
  await writeAuditLog({
    action: "billing.subscription_deleted",
    workspaceId: row.workspaceId,
    metadata: { stripeSubscriptionId: object.id },
  });
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!process.env.STRIPE_SECRET_KEY || !secret) {
    return NextResponse.json(
      {
        error: "Billing webhooks are not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
        missingEnv: [
          ...(!process.env.STRIPE_SECRET_KEY ? ["STRIPE_SECRET_KEY"] : []),
          ...(!secret ? ["STRIPE_WEBHOOK_SECRET"] : []),
        ],
      },
      { status: 501 },
    );
  }
  const rawBody = await request.text();
  if (!verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const object = event.data?.object ?? {};
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(object);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(object);
        break;
      default:
        break;
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    return apiError(error);
  }
}
