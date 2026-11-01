import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie, getSessionWorkspace } from "@/lib/auth/session";
import { checkAuthRateLimit, clientIp, rateLimitedResponse } from "@/lib/auth/rateLimit";
import { deleteAccount } from "@/lib/auth/deleteAccount";
import { writeAuditLog } from "@/lib/audit";

/**
 * Delete the signed-in user's account (v1.15.0).
 *
 * Two confirmations are required: the account password, and the
 * exact word DELETE typed by the user. The deletion removes the
 * user and every workspace they solely own, with all campaigns,
 * leads, enrollments, emails, and sending accounts in them.
 * Workspaces shared with other members stay behind for those
 * members. Irreversible.
 */
export async function POST(request: Request) {
  const session = await getSessionWorkspace();
  if (!session) {
    return NextResponse.json({ error: "You need to be signed in." }, { status: 401 });
  }

  let body: { password?: unknown; confirmation?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password : "";
  const confirmation = typeof body.confirmation === "string" ? body.confirmation : "";

  const limit = checkAuthRateLimit(
    `delete-account:${clientIp(request)}:${session.user.email.toLowerCase()}`,
  );
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  if (confirmation !== "DELETE") {
    return NextResponse.json(
      { error: "Type DELETE to confirm account deletion." },
      { status: 400 },
    );
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  const passwordOk = password ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!passwordOk) {
    return NextResponse.json({ error: "Password is incorrect." }, { status: 401 });
  }

  // Tombstone audit row, written before the deletion with no
  // workspace attached, so it survives the cascade (the user
  // reference nulls out when the account goes).
  await writeAuditLog({
    action: "account.deleted",
    userId: user.id,
    workspaceId: null,
    metadata: { email: user.email },
  });

  const summary = await deleteAccount(prisma, user.id);
  await clearSessionCookie();

  return NextResponse.json({
    ok: true,
    deletedWorkspaces: summary.deleteWorkspaces.map((w) => w.name),
    leftWorkspaces: summary.leaveWorkspaces.map((w) => w.name),
  });
}
