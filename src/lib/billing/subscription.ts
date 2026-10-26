import type { PrismaClient, Subscription } from "@prisma/client";
import { getPlan, monthWindowEnd, monthWindowStart, type Plan } from "@/lib/domain/plans";

/**
 * Subscription and usage service.
 *
 * Every workspace has exactly one Subscription row, created lazily on
 * the FREE plan the first time anything asks. Usage is never stored:
 * monthly sends are counted from real SENT EmailEvent rows inside the
 * current UTC calendar month, seats from memberships plus live
 * pending invites, accounts from the sending account rows. The plan
 * catalog in src/lib/domain/plans.ts turns those counts into verdicts.
 */

export async function getOrCreateSubscription(
  db: PrismaClient,
  workspaceId: string,
): Promise<Subscription> {
  const existing = await db.subscription.findUnique({ where: { workspaceId } });
  if (existing) {
    return existing;
  }
  return db.subscription.create({ data: { workspaceId, plan: "FREE", status: "ACTIVE" } });
}

export async function getPlanForWorkspace(db: PrismaClient, workspaceId: string): Promise<Plan> {
  const subscription = await getOrCreateSubscription(db, workspaceId);
  return getPlan(subscription.plan);
}

export interface WorkspaceUsage {
  sentThisMonth: number;
  sendingAccounts: number;
  /** Members plus pending (unexpired, unaccepted) invites. */
  seatsUsed: number;
  members: number;
  pendingInvites: number;
  monthStart: Date;
  monthEnd: Date;
}

export async function getWorkspaceUsage(
  db: PrismaClient,
  workspaceId: string,
  now: Date = new Date(),
): Promise<WorkspaceUsage> {
  const monthStart = monthWindowStart(now);
  const monthEnd = monthWindowEnd(now);
  const [sentThisMonth, sendingAccounts, members, pendingInvites] = await Promise.all([
    db.emailEvent.count({
      where: { workspaceId, type: "SENT", occurredAt: { gte: monthStart, lt: monthEnd } },
    }),
    db.sendingAccount.count({ where: { workspaceId } }),
    db.membership.count({ where: { workspaceId } }),
    db.invite.count({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: now } },
    }),
  ]);
  return {
    sentThisMonth,
    sendingAccounts,
    seatsUsed: members + pendingInvites,
    members,
    pendingInvites,
    monthStart,
    monthEnd,
  };
}

/** Sends so far in the current UTC calendar month (worker hot path). */
export async function countMonthlySends(
  db: PrismaClient,
  workspaceId: string,
  now: Date = new Date(),
): Promise<number> {
  return db.emailEvent.count({
    where: {
      workspaceId,
      type: "SENT",
      occurredAt: { gte: monthWindowStart(now), lt: monthWindowEnd(now) },
    },
  });
}
