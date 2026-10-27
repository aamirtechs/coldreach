/**
 * Restores a workspace from a ColdReach export file (Settings,
 * Export workspace data; shape defined in src/lib/settings/export.ts).
 *
 * Usage:
 *   npx tsx scripts/restore-workspace.ts <export.json> [--owner-password <password>]
 *
 * What is restored: the owner and member accounts, the workspace
 * with its sender identity, lead lists and leads, campaigns with
 * steps and variants (forced back to DRAFT so nothing can send
 * until a human reviews and relaunches), suppressions, sending
 * accounts as DISCONNECTED placeholders (credentials are never in
 * the export; every account must be reconnected), inbox threads
 * with messages and notes, and the subscription plan row.
 *
 * What is deliberately NOT restored, because the export does not
 * carry it: enrollments (exported as counts only), API keys (only
 * prefixes are exported; create fresh keys), webhook endpoints
 * (their secrets are not exported; recreate them), pending invites
 * (tokens are not exported; re-invite), the audit log (it stays in
 * the export file as the historical record), and non-owner member
 * passwords (those members get an unguessable placeholder password
 * and must be re-invited or have access arranged out of band).
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import type { WorkspaceExport } from "../src/lib/settings/export";

interface RestoreReport {
  users: number;
  memberships: number;
  leadLists: number;
  leads: number;
  campaigns: number;
  steps: number;
  variants: number;
  suppressions: number;
  sendingAccounts: number;
  threads: number;
  threadMessages: number;
  threadNotes: number;
  subscription: boolean;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Ambient environment it is.
  }
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith("--"));
  if (!file) {
    throw new Error("Usage: restore-workspace.ts <export.json> [--owner-password <password>]");
  }
  const passwordFlagAt = args.indexOf("--owner-password");
  const ownerPassword =
    passwordFlagAt >= 0 ? args[passwordFlagAt + 1] : randomBytes(12).toString("base64url");
  if (!ownerPassword || ownerPassword.length < 10) {
    throw new Error("--owner-password must be at least 10 characters");
  }

  const payload = JSON.parse(fs.readFileSync(file, "utf8")) as WorkspaceExport;
  if (payload.format !== "coldreach-workspace-export") {
    throw new Error("That file is not a ColdReach workspace export");
  }

  const db = new PrismaClient();
  const report: RestoreReport = {
    users: 0,
    memberships: 0,
    leadLists: 0,
    leads: 0,
    campaigns: 0,
    steps: 0,
    variants: 0,
    suppressions: 0,
    sendingAccounts: 0,
    threads: 0,
    threadMessages: 0,
    threadNotes: 0,
    subscription: false,
  };

  try {
    const ownerEntry =
      payload.members.find((member) => member.role === "OWNER") ?? payload.members[0];
    if (!ownerEntry) {
      throw new Error("The export has no members; nothing to restore");
    }

    // Users first: reuse an existing account with the same email,
    // otherwise create one. Only the owner gets the chosen password.
    const userIdByEmail = new Map<string, string>();
    for (const member of payload.members) {
      const existing = await db.user.findUnique({ where: { email: member.email } });
      if (existing) {
        userIdByEmail.set(member.email, existing.id);
        continue;
      }
      const isOwner = member.email === ownerEntry.email;
      const passwordHash = await bcrypt.hash(
        isOwner ? ownerPassword : randomBytes(24).toString("base64url"),
        12,
      );
      const user = await db.user.create({
        data: { name: member.name, email: member.email, passwordHash },
      });
      userIdByEmail.set(member.email, user.id);
      report.users += 1;
    }
    const ownerId = userIdByEmail.get(ownerEntry.email) as string;

    // Workspace: keep the original slug when free, suffix on clash.
    let slug = payload.workspace.slug;
    if (await db.workspace.findUnique({ where: { slug } })) {
      slug = `${slug}-restored-${randomBytes(3).toString("hex")}`;
    }
    const workspace = await db.workspace.create({
      data: {
        name: payload.workspace.name,
        slug,
        senderName: payload.workspace.senderName,
        senderAddress: payload.workspace.senderAddress,
      },
    });
    const workspaceId = workspace.id;

    for (const member of payload.members) {
      const userId = userIdByEmail.get(member.email) as string;
      const existing = await db.membership.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
      });
      if (!existing) {
        await db.membership.create({
          data: { userId, workspaceId, role: member.role },
        });
        report.memberships += 1;
      }
    }

    const listIdMap = new Map<string, string>();
    for (const list of payload.leadLists) {
      const created = await db.leadList.create({
        data: { workspaceId, name: list.name, description: list.description },
      });
      listIdMap.set(list.id, created.id);
      report.leadLists += 1;
    }

    const leadIdMap = new Map<string, string>();
    for (const lead of payload.leads) {
      const created = await db.lead.create({
        data: {
          workspaceId,
          listId: lead.listId ? (listIdMap.get(lead.listId) ?? null) : null,
          email: lead.email,
          fields: (lead.fields ?? {}) as Prisma.InputJsonValue,
          tags: (lead.tags ?? []) as Prisma.InputJsonValue,
          status: lead.status,
        },
      });
      leadIdMap.set(lead.id, created.id);
      report.leads += 1;
    }

    for (const suppression of payload.suppressions) {
      await db.suppression.create({
        data: {
          workspaceId,
          scope: "WORKSPACE",
          email: suppression.email,
          domain: suppression.domain,
          reason: suppression.reason,
        },
      });
      report.suppressions += 1;
    }

    const accountIdMap = new Map<string, string>();
    for (const account of payload.sendingAccounts) {
      const created = await db.sendingAccount.create({
        data: {
          workspaceId,
          provider: account.provider,
          email: account.email,
          displayName: account.displayName,
          status: "DISCONNECTED",
          dailyLimit: account.dailyLimit,
          warmupStatus: account.warmupStatus,
          lastError: "Restored from export: reconnect this account before sending.",
        },
      });
      accountIdMap.set(account.id, created.id);
      report.sendingAccounts += 1;
    }

    const campaignIdMap = new Map<string, string>();
    for (const campaign of payload.campaigns) {
      const created = await db.campaign.create({
        data: {
          workspaceId,
          name: campaign.name,
          // Nothing restored ever sends on its own: campaigns come
          // back as DRAFT (ARCHIVED stays ARCHIVED) for human review.
          status: campaign.status === "ARCHIVED" ? "ARCHIVED" : "DRAFT",
          leadListId: campaign.leadListId ? (listIdMap.get(campaign.leadListId) ?? null) : null,
          timezone: campaign.timezone,
          windowStart: campaign.windowStart,
          windowEnd: campaign.windowEnd,
          businessDaysOnly: campaign.businessDaysOnly,
        },
      });
      campaignIdMap.set(campaign.id, created.id);
      report.campaigns += 1;
      for (const accountId of campaign.sendingAccountIds) {
        const mapped = accountIdMap.get(accountId);
        if (mapped) {
          await db.campaignAccount.create({
            data: { campaignId: created.id, sendingAccountId: mapped },
          });
        }
      }
    }

    const stepIdMap = new Map<string, string>();
    for (const step of payload.steps) {
      const campaignId = campaignIdMap.get(step.campaignId);
      if (!campaignId) continue;
      const created = await db.sequenceStep.create({
        data: {
          campaignId,
          order: step.order,
          delayDays: step.delayDays,
          delayHours: step.delayHours,
          subject: step.subject,
          body: step.body,
        },
      });
      stepIdMap.set(step.id, created.id);
      report.steps += 1;
    }
    for (const variant of payload.variants) {
      const stepId = stepIdMap.get(variant.stepId);
      if (!stepId) continue;
      await db.stepVariant.create({
        data: {
          stepId,
          label: variant.label,
          subject: variant.subject,
          bodyText: variant.bodyText,
          bodyHtml: variant.bodyHtml,
          weight: variant.weight,
        },
      });
      report.variants += 1;
    }

    for (const thread of payload.threads) {
      const created = await db.thread.create({
        data: {
          workspaceId,
          campaignId: thread.campaignId ? (campaignIdMap.get(thread.campaignId) ?? null) : null,
          leadId: thread.leadId ? (leadIdMap.get(thread.leadId) ?? null) : null,
          sendingAccountId: thread.sendingAccountId
            ? (accountIdMap.get(thread.sendingAccountId) ?? null)
            : null,
          subject: thread.subject,
          status: thread.status,
          classification: thread.classification,
          unread: thread.unread,
          lastMessageAt: thread.lastMessageAt ? new Date(thread.lastMessageAt) : new Date(),
        },
      });
      report.threads += 1;
      for (const message of thread.messages) {
        await db.threadMessage.create({
          data: {
            threadId: created.id,
            direction: message.direction,
            fromEmail: message.fromEmail,
            toEmail: message.toEmail,
            subject: message.subject,
            body: message.body,
            occurredAt: message.occurredAt ? new Date(message.occurredAt) : new Date(),
          },
        });
        report.threadMessages += 1;
      }
      for (const note of thread.notes) {
        await db.threadNote.create({
          data: {
            workspaceId,
            threadId: created.id,
            authorId: userIdByEmail.get(note.authorEmail) ?? ownerId,
            body: note.body,
          },
        });
        report.threadNotes += 1;
      }
    }

    if (payload.subscription) {
      await db.subscription.create({
        data: {
          workspaceId,
          plan: payload.subscription.plan,
          status: payload.subscription.status,
          currentPeriodEnd: payload.subscription.currentPeriodEnd
            ? new Date(payload.subscription.currentPeriodEnd)
            : null,
          cancelAtPeriodEnd: payload.subscription.cancelAtPeriodEnd,
        },
      });
      report.subscription = true;
    }

    console.log(`Restored workspace "${workspace.name}" (${workspaceId}) as slug "${slug}".`);
    console.log(`Owner login: ${ownerEntry.email} with the supplied or generated password.`);
    if (passwordFlagAt < 0) {
      console.log(`Generated owner password (shown once): ${ownerPassword}`);
    }
    console.log(
      "Not restored (by design): enrollments, API keys, webhook endpoints, pending invites, audit history, account credentials. Campaigns are DRAFT and sending accounts are DISCONNECTED until reconnected.",
    );
    console.log(`RESTORE_REPORT ${JSON.stringify(report)}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("Restore failed", error);
  process.exit(1);
});
