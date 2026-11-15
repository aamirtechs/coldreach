import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { redeemSubscriptionKey } from "@/lib/billing/keys";
import { writeAuditLog } from "@/lib/audit";

/**
 * Redeem a subscription key (v1.32.0), OWNER only, matching the
 * manual plan override's gate: the person who pays for the
 * workspace is the person who activates it.
 *
 * The key grants its plan for its fixed number of days; redeeming
 * while paid time remains stacks the days on top (see
 * src/lib/billing/keys.ts). The code itself is never logged; the
 * audit entry records only the plan and the days granted.
 */
export async function POST(request: Request) {
  const session = await requireSession("OWNER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ code?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const code = stringField(body.code);
  if (!code) return NextResponse.json({ error: "Paste your subscription key." }, { status: 400 });
  try {
    const result = await redeemSubscriptionKey(prisma, {
      workspaceId: ctx.workspace.id,
      code,
    });
    await writeAuditLog({
      action: "billing.key_redeem",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: {
        plan: result.plan,
        durationDays: result.durationDays,
        currentPeriodEnd: result.currentPeriodEnd.toISOString(),
      },
    });
    return NextResponse.json({
      plan: result.plan,
      planName: result.planName,
      durationDays: result.durationDays,
      currentPeriodEnd: result.currentPeriodEnd,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /not recognized|revoked|already been used/i.test(error.message)
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiError(error);
  }
}
