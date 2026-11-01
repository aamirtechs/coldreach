import type { PrismaClient } from "@prisma/client";

/**
 * Account deletion (v1.15.0).
 *
 * Deleting an account removes the user and every workspace they are
 * the sole member of, with all of that workspace's data: campaigns,
 * sequences, leads, enrollments, sent and received emails, sending
 * accounts, API keys, webhooks, and settings. The schema cascades
 * cover every workspace child, so deleting the workspace row takes
 * everything with it.
 *
 * Workspaces shared with other members are NOT deleted: the
 * departing user's membership is removed with their account and the
 * workspace keeps running for the remaining members. The summary
 * spells out both lists so the confirmation screen can warn
 * precisely.
 */

export interface DeletableWorkspace {
  id: string;
  name: string;
  campaigns: number;
  leads: number;
  sendingAccounts: number;
}

export interface AccountDeletionSummary {
  /** Sole-member owned workspaces that will be deleted entirely. */
  deleteWorkspaces: DeletableWorkspace[];
  /** Shared workspaces that stay behind for their other members. */
  leaveWorkspaces: { id: string; name: string }[];
}

export async function getAccountDeletionSummary(
  db: PrismaClient,
  userId: string,
): Promise<AccountDeletionSummary> {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  const summary: AccountDeletionSummary = { deleteWorkspaces: [], leaveWorkspaces: [] };
  for (const membership of memberships) {
    const memberCount = await db.membership.count({
      where: { workspaceId: membership.workspaceId },
    });
    if (membership.role === "OWNER" && memberCount === 1) {
      const [campaigns, leads, sendingAccounts] = await Promise.all([
        db.campaign.count({ where: { workspaceId: membership.workspaceId } }),
        db.lead.count({ where: { workspaceId: membership.workspaceId } }),
        db.sendingAccount.count({ where: { workspaceId: membership.workspaceId } }),
      ]);
      summary.deleteWorkspaces.push({
        id: membership.workspaceId,
        name: membership.workspace.name,
        campaigns,
        leads,
        sendingAccounts,
      });
    } else {
      summary.leaveWorkspaces.push({
        id: membership.workspaceId,
        name: membership.workspace.name,
      });
    }
  }
  return summary;
}

/** Performs the deletion described by the summary. Irreversible. */
export async function deleteAccount(
  db: PrismaClient,
  userId: string,
): Promise<AccountDeletionSummary> {
  const summary = await getAccountDeletionSummary(db, userId);
  await db.$transaction(async (tx) => {
    for (const workspace of summary.deleteWorkspaces) {
      await tx.workspace.delete({ where: { id: workspace.id } });
    }
    await tx.user.delete({ where: { id: userId } });
  });
  return summary;
}
