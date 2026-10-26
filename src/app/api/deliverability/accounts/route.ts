import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { computeAccountHealth, type AccountEventCounts } from "@/lib/domain/health";

/**
 * Per account health cards for the Deliverability section. Every
 * number is aggregated from this workspace's real EmailEvents; an
 * account with no sends reports a null score rather than an invented
 * one. The formula lives in domain/health.ts and is quoted in the UI.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const accounts = await prisma.sendingAccount.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        provider: true,
        status: true,
        lastError: true,
        lastSyncAt: true,
      },
    });
    const grouped = await prisma.emailEvent.groupBy({
      by: ["sendingAccountId", "type"],
      where: {
        workspaceId: ctx.workspace.id,
        sendingAccountId: { in: accounts.map((account) => account.id) },
        type: { in: ["SENT", "DELIVERED", "BOUNCED", "COMPLAINED", "FAILED"] },
      },
      _count: { _all: true },
    });
    const counts = new Map<string, AccountEventCounts>();
    for (const account of accounts) {
      counts.set(account.id, { sent: 0, bounced: 0, complained: 0, failed: 0, delivered: 0 });
    }
    for (const row of grouped) {
      if (!row.sendingAccountId) continue;
      const entry = counts.get(row.sendingAccountId);
      if (!entry) continue;
      if (row.type === "SENT") entry.sent = row._count._all;
      if (row.type === "BOUNCED") entry.bounced = row._count._all;
      if (row.type === "COMPLAINED") entry.complained = row._count._all;
      if (row.type === "FAILED") entry.failed = row._count._all;
      if (row.type === "DELIVERED") entry.delivered = row._count._all;
    }
    const lastFailed = await prisma.emailEvent.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        type: "FAILED",
        sendingAccountId: { in: accounts.map((account) => account.id) },
      },
      orderBy: { occurredAt: "desc" },
      select: { sendingAccountId: true, occurredAt: true },
      distinct: ["sendingAccountId"],
    });
    const lastFailedAt = new Map(
      lastFailed.map((row) => [row.sendingAccountId, row.occurredAt]),
    );
    return NextResponse.json({
      accounts: accounts.map((account) => {
        const accountCounts = counts.get(account.id) as AccountEventCounts;
        return {
          ...account,
          counts: accountCounts,
          health: computeAccountHealth(accountCounts),
          lastFailureAt: lastFailedAt.get(account.id) ?? null,
        };
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
