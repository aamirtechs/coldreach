import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { PLAN_ORDER, PLANS } from "@/lib/domain/plans";
import { getOrCreateSubscription, getWorkspaceUsage } from "@/lib/billing/subscription";
import { stripeMissingEnv } from "@/lib/billing/stripe";

/**
 * Billing overview for the active workspace: the subscription, the
 * full plan catalog, real usage, and whether Stripe is configured.
 * When Stripe is not configured the response says so by name, and
 * the page falls back to the manual plan override.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const [subscription, usage] = await Promise.all([
      getOrCreateSubscription(prisma, ctx.workspace.id),
      getWorkspaceUsage(prisma, ctx.workspace.id),
    ]);
    const missingEnv = stripeMissingEnv();
    const webhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
    return NextResponse.json({
      subscription: {
        plan: subscription.plan,
        status: subscription.status,
        stripeCustomerId: subscription.stripeCustomerId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      plans: PLAN_ORDER.map((id) => PLANS[id]),
      usage: {
        sentThisMonth: usage.sentThisMonth,
        sendingAccounts: usage.sendingAccounts,
        seatsUsed: usage.seatsUsed,
        members: usage.members,
        pendingInvites: usage.pendingInvites,
        monthStart: usage.monthStart,
        monthEnd: usage.monthEnd,
      },
      stripe: {
        configured: missingEnv.length === 0,
        missingEnv,
        // Checkout works without this, but plan changes only flow
        // back once the webhook secret exists; reported separately.
        webhookConfigured,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
