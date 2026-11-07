import type { PrismaClient } from "@prisma/client";

/**
 * Platform owner (super admin) support, v1.13.0.
 *
 * ColdReach is workspace-scoped everywhere else: no account can see
 * another workspace's data. The single exception is the platform
 * owner, identified by the PLATFORM_OWNER_EMAIL environment variable
 * matching the signed-in user's email (the same identity the AI key
 * fallback uses). When the variable is unset, nobody is the platform
 * owner and the admin surface simply does not exist.
 *
 * The stats here are deliberately aggregates only: counts, daily
 * totals, plan mix, and a recent-workspaces summary (name, owner,
 * plan, counts). No lead data, no message content, and no other
 * workspace's campaign details are ever read.
 */

export function isPlatformOwner(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const owner = env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || !email) {
    return false;
  }
  return email.trim().toLowerCase() === owner;
}

export interface DayBucket {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  count: number;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Zero-filled per-day counts over the last `days` UTC days, oldest first. */
export function bucketByDay(dates: Date[], days: number, now: Date): DayBucket[] {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = dayKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const buckets: DayBucket[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    const key = dayKey(day);
    buckets.push({ day: key, count: counts.get(key) ?? 0 });
  }
  return buckets;
}

export interface RecentWorkspace {
  id: string;
  name: string;
  createdAt: string;
  plan: string;
  ownerName: string | null;
  ownerEmail: string | null;
  members: number;
  campaigns: number;
  sends: number;
}

export interface PlatformStats {
  totals: {
    users: number;
    workspaces: number;
    campaigns: number;
    runningCampaigns: number;
    sendingAccounts: number;
    connectedAccounts: number;
    leads: number;
    enrollments: number;
  };
  /** All-time email event counts by type; every type present, zero-filled. */
  events: Record<string, number>;
  signupsByDay: DayBucket[];
  sendsByDay: DayBucket[];
  planMix: Record<string, number>;
  recentWorkspaces: RecentWorkspace[];
}

const EVENT_TYPES = [
  "SENT",
  "FAILED",
  "DELIVERED",
  "OPENED",
  "CLICKED",
  "REPLIED",
  "BOUNCED",
  "UNSUBSCRIBED",
  "COMPLAINED",
] as const;

const PLAN_TIERS = ["FREE", "STARTER", "PRO", "AGENCY"] as const;
const SERIES_DAYS = 30;

export async function getPlatformStats(db: PrismaClient, now: Date): Promise<PlatformStats> {
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (SERIES_DAYS - 1)),
  );

  const [
    users,
    workspaces,
    campaignGroups,
    sendingAccounts,
    connectedAccounts,
    leads,
    enrollments,
    eventGroups,
    signupRows,
    sendRows,
    subscriptionGroups,
    subscriptionTotal,
    recent,
    machineOpenedCount,
  ] = await Promise.all([
    db.user.count(),
    db.workspace.count(),
    db.campaign.groupBy({ by: ["status"], _count: { _all: true } }),
    db.sendingAccount.count(),
    db.sendingAccount.count({ where: { status: "CONNECTED" } }),
    db.lead.count(),
    db.enrollment.count(),
    db.emailEvent.groupBy({ by: ["type"], _count: { _all: true } }),
    db.user.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { createdAt: true },
    }),
    db.emailEvent.findMany({
      where: { type: "SENT", occurredAt: { gte: windowStart } },
      select: { occurredAt: true },
    }),
    db.subscription.groupBy({ by: ["plan"], _count: { _all: true } }),
    db.subscription.count(),
    db.workspace.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        subscription: { select: { plan: true } },
        memberships: {
          where: { role: "OWNER" },
          take: 1,
          include: { user: { select: { name: true, email: true } } },
        },
        _count: { select: { memberships: true, campaigns: true } },
      },
    }),
    db.emailEvent.count({ where: { type: "OPENED", classification: "MACHINE" } }),
  ]);

  const campaigns = campaignGroups.reduce((sum, group) => sum + group._count._all, 0);
  const runningCampaigns =
    campaignGroups.find((group) => group.status === "RUNNING")?._count._all ?? 0;

  const events: Record<string, number> = {};
  for (const type of EVENT_TYPES) {
    events[type] = eventGroups.find((group) => group.type === type)?._count._all ?? 0;
  }
  // Machine opens (v1.20.0) stay out of the platform OPENED total,
  // matching every other open figure in the product.
  events.OPENED = Math.max(0, (events.OPENED ?? 0) - machineOpenedCount);

  // A workspace with no Subscription row runs on the FREE tier (the
  // plan engine's default), so the unsubscribed remainder is FREE.
  const planMix: Record<string, number> = {};
  for (const tier of PLAN_TIERS) {
    planMix[tier] = subscriptionGroups.find((group) => group.plan === tier)?._count._all ?? 0;
  }
  planMix.FREE += Math.max(0, workspaces - subscriptionTotal);

  const recentIds = recent.map((workspace) => workspace.id);
  const sendGroups = recentIds.length
    ? await db.emailEvent.groupBy({
        by: ["workspaceId"],
        where: { type: "SENT", workspaceId: { in: recentIds } },
        _count: { _all: true },
      })
    : [];
  const sendsByWorkspace = new Map(sendGroups.map((group) => [group.workspaceId, group._count._all]));

  return {
    totals: {
      users,
      workspaces,
      campaigns,
      runningCampaigns,
      sendingAccounts,
      connectedAccounts,
      leads,
      enrollments,
    },
    events,
    signupsByDay: bucketByDay(
      signupRows.map((row) => row.createdAt),
      SERIES_DAYS,
      now,
    ),
    sendsByDay: bucketByDay(
      sendRows.map((row) => row.occurredAt),
      SERIES_DAYS,
      now,
    ),
    planMix,
    recentWorkspaces: recent.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      createdAt: workspace.createdAt.toISOString(),
      plan: workspace.subscription?.plan ?? "FREE",
      ownerName: workspace.memberships[0]?.user.name ?? null,
      ownerEmail: workspace.memberships[0]?.user.email ?? null,
      members: workspace._count.memberships,
      campaigns: workspace._count.campaigns,
      sends: sendsByWorkspace.get(workspace.id) ?? 0,
    })),
  };
}
