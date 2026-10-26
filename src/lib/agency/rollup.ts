import type { PrismaClient } from "@prisma/client";
import { monthWindowEnd, monthWindowStart } from "@/lib/domain/plans";

/**
 * Agency Command Center rollup.
 *
 * Aggregates this month's activity across every workspace the user
 * OWNS (memberships with role OWNER only; workspaces the user merely
 * belongs to are someone else's business and never leak into this
 * view). Every number comes from real rows: SENT, REPLIED, and
 * BOUNCED events in the current UTC calendar month, campaigns in
 * RUNNING status, and sending accounts in ERROR status. A workspace
 * is flagged when its bounce rate this month exceeds 5 percent.
 */

export const BOUNCE_RATE_FLAG = 0.05;

export interface WorkspaceRollup {
  workspaceId: string;
  name: string;
  sendsThisMonth: number;
  repliesThisMonth: number;
  bouncesThisMonth: number;
  /** replies / sends this month (0 when nothing sent). */
  replyRate: number;
  /** bounces / sends this month (0 when nothing sent). */
  bounceRate: number;
  activeCampaigns: number;
  /** Sending accounts currently in ERROR status. */
  accountsInError: number;
  /** Health flags needing the owner's attention. */
  flags: string[];
}

export interface AgencyRollup {
  workspaces: WorkspaceRollup[];
  totals: {
    sendsThisMonth: number;
    repliesThisMonth: number;
    bouncesThisMonth: number;
    replyRate: number;
    bounceRate: number;
    activeCampaigns: number;
    accountsInError: number;
  };
}

export async function getAgencyRollup(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<AgencyRollup> {
  const memberships = await db.membership.findMany({
    where: { userId, role: "OWNER" },
    include: { workspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const monthStart = monthWindowStart(now);
  const monthEnd = monthWindowEnd(now);

  const workspaces: WorkspaceRollup[] = [];
  for (const membership of memberships) {
    const workspaceId = membership.workspace.id;
    const inMonth = { workspaceId, occurredAt: { gte: monthStart, lt: monthEnd } };
    const [sends, replies, bounces, activeCampaigns, accountsInError] = await Promise.all([
      db.emailEvent.count({ where: { ...inMonth, type: "SENT" } }),
      db.emailEvent.count({ where: { ...inMonth, type: "REPLIED" } }),
      db.emailEvent.count({ where: { ...inMonth, type: "BOUNCED" } }),
      db.campaign.count({ where: { workspaceId, status: "RUNNING" } }),
      db.sendingAccount.count({ where: { workspaceId, status: "ERROR" } }),
    ]);
    const bounceRate = sends > 0 ? bounces / sends : 0;
    const flags: string[] = [];
    if (accountsInError > 0) {
      flags.push(`${accountsInError} sending account${accountsInError === 1 ? "" : "s"} in ERROR`);
    }
    if (sends > 0 && bounceRate > BOUNCE_RATE_FLAG) {
      flags.push(`Bounce rate ${(bounceRate * 100).toFixed(1)}% this month, above the 5% flag line`);
    }
    workspaces.push({
      workspaceId,
      name: membership.workspace.name,
      sendsThisMonth: sends,
      repliesThisMonth: replies,
      bouncesThisMonth: bounces,
      replyRate: sends > 0 ? replies / sends : 0,
      bounceRate,
      activeCampaigns,
      accountsInError,
      flags,
    });
  }

  const totals = workspaces.reduce(
    (acc, row) => ({
      sendsThisMonth: acc.sendsThisMonth + row.sendsThisMonth,
      repliesThisMonth: acc.repliesThisMonth + row.repliesThisMonth,
      bouncesThisMonth: acc.bouncesThisMonth + row.bouncesThisMonth,
      replyRate: 0,
      bounceRate: 0,
      activeCampaigns: acc.activeCampaigns + row.activeCampaigns,
      accountsInError: acc.accountsInError + row.accountsInError,
    }),
    {
      sendsThisMonth: 0,
      repliesThisMonth: 0,
      bouncesThisMonth: 0,
      replyRate: 0,
      bounceRate: 0,
      activeCampaigns: 0,
      accountsInError: 0,
    },
  );
  totals.replyRate = totals.sendsThisMonth > 0 ? totals.repliesThisMonth / totals.sendsThisMonth : 0;
  totals.bounceRate = totals.sendsThisMonth > 0 ? totals.bouncesThisMonth / totals.sendsThisMonth : 0;

  return { workspaces, totals };
}
