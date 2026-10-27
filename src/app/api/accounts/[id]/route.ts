import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{
    displayName?: unknown;
    dailyLimit?: unknown;
    status?: unknown;
    warmupEnabled?: unknown;
    warmupRestart?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const account = await prisma.sendingAccount.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, status: true, warmupStartedAt: true },
    });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    const data: Record<string, unknown> = {};
    if (body.displayName !== undefined) data.displayName = stringField(body.displayName) || null;
    if (body.dailyLimit !== undefined) data.dailyLimit = Math.max(1, intField(body.dailyLimit, 50));
    const status = stringField(body.status);
    if (status) {
      if (!["CONNECTED", "PAUSED", "DISCONNECTED"].includes(status)) {
        return NextResponse.json({ error: `Invalid account status "${status}"` }, { status: 400 });
      }
      data.status = status;
    }
    // Warm-up schedule (Phase 6). Enabling starts the schedule when
    // it has never run; disabling keeps the start date so re-enabling
    // resumes where the schedule left off. warmupRestart explicitly
    // resets the start to now (a fresh 28 day ramp).
    if (body.warmupEnabled !== undefined) {
      if (typeof body.warmupEnabled !== "boolean") {
        return NextResponse.json({ error: "warmupEnabled must be a boolean" }, { status: 400 });
      }
      data.warmupEnabled = body.warmupEnabled;
      if (body.warmupEnabled && !account.warmupStartedAt) {
        data.warmupStartedAt = new Date();
      }
    }
    if (body.warmupRestart === true) {
      data.warmupEnabled = true;
      data.warmupStartedAt = new Date();
    }
    const updated = await prisma.sendingAccount.update({ where: { id: account.id }, data });
    return NextResponse.json({ account: updated });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const account = await prisma.sendingAccount.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, email: true },
    });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    await prisma.sendingAccount.delete({ where: { id: account.id } });
    await writeAuditLog({
      action: "account.delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { accountId: account.id, email: account.email },
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
