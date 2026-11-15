import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, readJson, stringField } from "@/lib/api";
import { getSessionWorkspace, type SessionContext } from "@/lib/auth/session";
import { isPlatformOwner } from "@/lib/admin/platform";
import { isPlanId } from "@/lib/domain/plans";
import {
  generateSubscriptionKeys,
  listSubscriptionKeys,
  revokeSubscriptionKey,
} from "@/lib/billing/keys";
import { writeAuditLog } from "@/lib/audit";

/**
 * Platform admin subscription keys (v1.32.0).
 *
 * Gated exactly like the rest of the admin surface: signed-in
 * platform owner only, everyone else gets a 404.
 *
 * GET lists keys (hashes never leave the server; rows carry only the
 * display hint). POST action "generate" creates a batch and returns
 * the full codes exactly once, in this response; action "revoke"
 * retires an UNUSED key and requires confirm: true. Codes are never
 * written to the audit log, only counts and hints.
 */

async function requirePlatformOwner(): Promise<
  { ctx: SessionContext } | { error: NextResponse }
> {
  const ctx = await getSessionWorkspace();
  if (!ctx) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isPlatformOwner(ctx.user.email)) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ctx };
}

export async function GET(request: Request) {
  const session = await requirePlatformOwner();
  if ("error" in session) return session.error;
  try {
    const status = new URL(request.url).searchParams.get("status");
    return NextResponse.json(await listSubscriptionKeys(prisma, { status }));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requirePlatformOwner();
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{
    action?: unknown;
    plan?: unknown;
    count?: unknown;
    durationDays?: unknown;
    note?: unknown;
    id?: unknown;
    confirm?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const action = stringField(body.action);
  try {
    if (action === "generate") {
      const plan = stringField(body.plan);
      if (!isPlanId(plan) || plan === "FREE") {
        return NextResponse.json(
          { error: "plan must be one of STARTER, PRO, AGENCY" },
          { status: 400 },
        );
      }
      const count = intField(body.count, 1);
      const durationDays = intField(body.durationDays, 30);
      const note = stringField(body.note);
      const generated = await generateSubscriptionKeys(prisma, {
        plan,
        count,
        durationDays,
        createdByUserId: ctx.user.id,
        note: note || null,
      });
      await writeAuditLog({
        action: "admin.keys.generate",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: { plan, count: generated.length, durationDays },
      });
      const list = await listSubscriptionKeys(prisma, {});
      return NextResponse.json({ generated, keys: list.keys, counts: list.counts });
    }
    if (action === "revoke") {
      if (body.confirm !== true) {
        return NextResponse.json(
          { error: "Revoking needs confirm: true in the request body." },
          { status: 400 },
        );
      }
      const id = stringField(body.id);
      if (!id) return NextResponse.json({ error: "A key id is required." }, { status: 400 });
      const revoked = await revokeSubscriptionKey(prisma, id);
      await writeAuditLog({
        action: "admin.keys.revoke",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: { keyId: revoked.id, codeHint: revoked.codeHint, plan: revoked.plan },
      });
      const list = await listSubscriptionKeys(prisma, {});
      return NextResponse.json({ revoked, keys: list.keys, counts: list.counts });
    }
    return NextResponse.json({ error: "Unknown keys action." }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && /not found|already|redeemed/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiError(error);
  }
}
