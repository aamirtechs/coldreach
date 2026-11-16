import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson } from "@/lib/api";
import { getSessionWorkspace, type SessionContext } from "@/lib/auth/session";
import { isPlatformOwner } from "@/lib/admin/platform";
import {
  isVerificationPublicEnabled,
  setVerificationPublicEnabled,
} from "@/lib/admin/featureAccess";
import { writeAuditLog } from "@/lib/audit";

/**
 * Platform admin feature switches (v1.36.0).
 *
 * Gated exactly like the rest of the admin surface: signed-in
 * platform owner only, everyone else gets a 404. GET returns the
 * current switches; POST updates them. Today there is one switch:
 * whether email verification is open to every user or stays
 * owner-only (its default).
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

export async function GET() {
  const session = await requirePlatformOwner();
  if ("error" in session) return session.error;
  try {
    return NextResponse.json({
      verificationPublicEnabled: await isVerificationPublicEnabled(prisma),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requirePlatformOwner();
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ verificationPublicEnabled?: unknown }>(request);
  if (!body || typeof body.verificationPublicEnabled !== "boolean") {
    return NextResponse.json(
      { error: "verificationPublicEnabled must be true or false" },
      { status: 400 },
    );
  }
  try {
    await setVerificationPublicEnabled(prisma, body.verificationPublicEnabled);
    await writeAuditLog({
      action: "admin.feature_access_update",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { verificationPublicEnabled: body.verificationPublicEnabled },
    });
    return NextResponse.json({
      verificationPublicEnabled: await isVerificationPublicEnabled(prisma),
    });
  } catch (error) {
    return apiError(error);
  }
}
