import type { PrismaClient } from "@prisma/client";

/**
 * Dashboard getting started checklist, computed from real workspace
 * state. Every item is a fact about the database, not a stored flag:
 * complete the action anywhere in the product and the item checks
 * itself. The card hides when all six are done.
 */

export interface OnboardingItem {
  key: string;
  label: string;
  done: boolean;
  href: string;
}

export interface OnboardingState {
  items: OnboardingItem[];
  doneCount: number;
  total: number;
  complete: boolean;
}

export async function getOnboardingState(
  db: PrismaClient,
  workspaceId: string,
): Promise<OnboardingState> {
  const [workspace, listCount, leadCount, connectedAccounts, campaignCount, launchedCount] =
    await Promise.all([
      db.workspace.findUnique({
        where: { id: workspaceId },
        select: { senderName: true, senderAddress: true },
      }),
      db.leadList.count({ where: { workspaceId } }),
      db.lead.count({ where: { workspaceId } }),
      db.sendingAccount.count({ where: { workspaceId, status: "CONNECTED" } }),
      db.campaign.count({ where: { workspaceId } }),
      db.campaign.count({
        where: { workspaceId, status: { in: ["RUNNING", "PAUSED"] } },
      }),
    ]);
  const items: OnboardingItem[] = [
    {
      key: "identity",
      label: "Set your sender identity (name and postal address, required by CAN-SPAM)",
      done: Boolean(workspace?.senderName && workspace?.senderAddress),
      href: "/app/settings",
    },
    {
      key: "list",
      label: "Create your first lead list",
      done: listCount > 0,
      href: "/app/leads",
    },
    {
      key: "leads",
      label: "Import leads into a list",
      done: leadCount > 0,
      href: "/app/leads",
    },
    {
      key: "account",
      label: "Connect a sending account",
      done: connectedAccounts > 0,
      href: "/app/accounts",
    },
    {
      key: "campaign",
      label: "Create your first campaign",
      done: campaignCount > 0,
      href: "/app/campaigns",
    },
    {
      key: "launch",
      label: "Launch a campaign (preflight checks run first)",
      done: launchedCount > 0,
      href: "/app/campaigns",
    },
  ];
  const doneCount = items.filter((item) => item.done).length;
  return { items, doneCount, total: items.length, complete: doneCount === items.length };
}
