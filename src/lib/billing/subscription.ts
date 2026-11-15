import type { PrismaClient, Subscription } from "@prisma/client";
import {
  getPlan,
  monthWindowEnd,
  monthWindowStart,
  planHasFeature,
  type Plan,
  type PlanFeature,
} from "@/lib/domain/plans";
import { isPlatformOwner } from "@/lib/admin/platform";

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

/**
 * The plan a workspace effectively runs on right now (v1.32.0).
 *
 * A paid plan granted by a subscription key carries a
 * currentPeriodEnd; once that moment passes without a renewal, the
 * workspace falls back to FREE limits. The Subscription row itself
 * is left untouched (it records what was last granted), so this
 * function is the single place expiry is applied, and every quota
 * or feature check goes through it. A paid plan with no period end
 * (granted by hand) never expires.
 */
export function effectivePlan(subscription: Subscription, now: Date = new Date()): Plan {
  if (
    subscription.plan !== "FREE" &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd <= now
  ) {
    return getPlan("FREE");
  }
  return getPlan(subscription.plan);
}

/** True when the workspace's paid time has run out (see effectivePlan). */
export function subscriptionExpired(subscription: Subscription, now: Date = new Date()): boolean {
  return effectivePlan(subscription, now).id === "FREE" && subscription.plan !== "FREE";
}

export async function getPlanForWorkspace(db: PrismaClient, workspaceId: string): Promise<Plan> {
  const subscription = await getOrCreateSubscription(db, workspaceId);
  return effectivePlan(subscription);
}

/**
 * Feature gate (v1.32.0): true when the workspace's effective plan
 * includes the feature. The platform owner's own workspace always
 * passes, matching the platform-key fallback the AI resolver has
 * used since v1.8.0: the owner runs the product, not a paid tier.
 */
export async function hasWorkspaceFeature(
  db: PrismaClient,
  workspaceId: string,
  feature: PlanFeature,
): Promise<boolean> {
  const plan = await getPlanForWorkspace(db, workspaceId);
  if (planHasFeature(plan, feature)) return true;
  const owner = await db.membership.findFirst({
    where: { workspaceId, role: "OWNER" },
    include: { user: { select: { email: true } } },
  });
  return isPlatformOwner(owner?.user.email);
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
