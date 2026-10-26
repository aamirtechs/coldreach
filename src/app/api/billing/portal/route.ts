import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { getOrCreateSubscription } from "@/lib/billing/subscription";
import { createPortalSession, getStripeConfig, stripeMissingEnv } from "@/lib/billing/stripe";

/** Returns a Stripe Customer Portal URL for the workspace owner. */
export async function GET() {
  const session = await requireSession("OWNER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const config = getStripeConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: "Billing is not configured on this server. Set the Stripe variables named in missingEnv (see INTEGRATIONS.md).",
        missingEnv: stripeMissingEnv(),
      },
      { status: 501 },
    );
  }
  try {
    const subscription = await getOrCreateSubscription(prisma, ctx.workspace.id);
    if (!subscription.stripeCustomerId) {
      return NextResponse.json(
        { error: "This workspace has no Stripe customer yet. Complete a checkout first." },
        { status: 400 },
      );
    }
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const portal = await createPortalSession(config, {
      stripeCustomerId: subscription.stripeCustomerId,
      returnUrl: `${appUrl}/app/billing`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    return apiError(error);
  }
}
