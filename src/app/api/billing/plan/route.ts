import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { isPlanId } from "@/lib/domain/plans";
import { getOrCreateSubscription } from "@/lib/billing/subscription";
import { writeAuditLog } from "@/lib/audit";

/**
 * Manual plan override (OWNER only).
 *
 * This is the pre-Stripe switch: while billing is not configured, an
 * owner sets the workspace's plan directly so quotas can be used and
 * evaluated today. It is labelled as an override in the UI, every
 * change is audited, and once Stripe is configured the webhook keeps
 * the row in sync with the paid subscription.
 */
export async function POST(request: Request) {
  const session = await requireSession("OWNER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ plan?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const plan = stringField(body.plan);
  if (!isPlanId(plan)) {
    return NextResponse.json(
      { error: "plan must be one of FREE, STARTER, PRO, AGENCY" },
      { status: 400 },
    );
  }
  try {
    const before = await getOrCreateSubscription(prisma, ctx.workspace.id);
    const updated = await prisma.subscription.update({
      where: { workspaceId: ctx.workspace.id },
      data: { plan, status: "ACTIVE" },
    });
    await writeAuditLog({
      action: "billing.plan_override",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { from: before.plan, to: plan },
    });
    return NextResponse.json({ subscription: updated });
  } catch (error) {
    return apiError(error);
  }
}
