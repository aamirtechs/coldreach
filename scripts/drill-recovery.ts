/**
 * Recovery drill, Phase 5.
 *
 * Proves the tenant-level recovery path end to end against a
 * throwaway database (prisma/drill-recovery.db, created and deleted
 * by this script):
 *
 *   1. Seed a rich workspace (members, lists, leads, a campaign with
 *      a variant, a suppression, a sending account, a thread with
 *      messages and a note, a subscription, an API key, a webhook
 *      endpoint, an invite, audit rows).
 *   2. Export it with the real export builder.
 *   3. Wipe the database completely.
 *   4. Restore with the real scripts/restore-workspace.ts as a
 *      child process.
 *   5. Compare the export's counts with the restore report and with
 *      fresh database counts, and check the safety invariants
 *      (campaign back as DRAFT, account back as DISCONNECTED).
 *
 * Run with: npx tsx scripts/drill-recovery.ts
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dropTestDb, freshTestDb, seedWorkspace } from "../src/lib/testing/testDb";
import { buildWorkspaceExport } from "../src/lib/settings/export";

const DB_NAME = "drill-recovery";
const EXPORT_PATH = "/tmp/coldreach-drill-export.json";

let failures = 0;
function check(name: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${extra ? ` :: ${extra}` : ""}`);
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const db = freshTestDb(DB_NAME);
  try {
    // 1. Seed.
    const { user, workspace } = await seedWorkspace(db, "drill");
    const member = await db.user.create({
      data: { name: "Drill Member", email: "member-drill@example.com", passwordHash: "x" },
    });
    await db.membership.create({
      data: { userId: member.id, workspaceId: workspace.id, role: "MEMBER" },
    });
    const listA = await db.leadList.create({ data: { workspaceId: workspace.id, name: "List A" } });
    const listB = await db.leadList.create({ data: { workspaceId: workspace.id, name: "List B" } });
    const leadIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const lead = await db.lead.create({
        data: {
          workspaceId: workspace.id,
          listId: i < 3 ? listA.id : listB.id,
          email: `drill-lead-${i}@example.com`,
          fields: { firstName: `Lead${i}` },
          tags: i % 2 === 0 ? ["drill"] : [],
          status: "VALID",
        },
      });
      leadIds.push(lead.id);
    }
    const account = await db.sendingAccount.create({
      data: {
        workspaceId: workspace.id,
        email: "drill-sender@example.com",
        provider: "SIMULATION",
        status: "CONNECTED",
      },
    });
    const campaign = await db.campaign.create({
      data: {
        workspaceId: workspace.id,
        name: "Drill Campaign",
        status: "RUNNING",
        leadListId: listA.id,
      },
    });
    await db.campaignAccount.create({
      data: { campaignId: campaign.id, sendingAccountId: account.id },
    });
    const step1 = await db.sequenceStep.create({
      data: { campaignId: campaign.id, order: 0, subject: "One", body: "First" },
    });
    await db.sequenceStep.create({
      data: { campaignId: campaign.id, order: 1, delayDays: 2, subject: "Two", body: "Second" },
    });
    await db.stepVariant.create({
      data: { stepId: step1.id, label: "B", bodyText: "First, variant B" },
    });
    await db.enrollment.create({
      data: { campaignId: campaign.id, leadId: leadIds[0], status: "ACTIVE" },
    });
    await db.suppression.create({
      data: { workspaceId: workspace.id, scope: "WORKSPACE", email: "out@example.com", reason: "Unsubscribed" },
    });
    const thread = await db.thread.create({
      data: {
        workspaceId: workspace.id,
        campaignId: campaign.id,
        leadId: leadIds[1],
        sendingAccountId: account.id,
        subject: "Re: One",
        status: "OPEN",
      },
    });
    await db.threadMessage.create({
      data: {
        threadId: thread.id,
        direction: "OUTBOUND",
        fromEmail: account.email,
        toEmail: "drill-lead-1@example.com",
        body: "First",
      },
    });
    await db.threadMessage.create({
      data: {
        threadId: thread.id,
        direction: "INBOUND",
        fromEmail: "drill-lead-1@example.com",
        toEmail: account.email,
        body: "Tell me more",
      },
    });
    await db.threadNote.create({
      data: { workspaceId: workspace.id, threadId: thread.id, authorId: user.id, body: "Drill note" },
    });
    await db.subscription.create({ data: { workspaceId: workspace.id, plan: "PRO" } });
    await db.apiKey.create({
      data: {
        workspaceId: workspace.id,
        name: "Drill key",
        keyHash: "drill-key-hash",
        prefix: "cr_live_dr",
        scopes: ["leads:read"],
      },
    });
    await db.webhookEndpoint.create({
      data: {
        workspaceId: workspace.id,
        url: "https://hooks.example.com/drill",
        secret: "encrypted-placeholder",
        eventTypes: ["REPLIED"],
      },
    });
    await db.invite.create({
      data: {
        workspaceId: workspace.id,
        email: "invitee@example.com",
        role: "MEMBER",
        tokenHash: "drill-token-hash",
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: user.id,
      },
    });
    await db.auditLog.create({
      data: { workspaceId: workspace.id, userId: user.id, action: "drill.seed" },
    });

    // 2. Export.
    const payload = await buildWorkspaceExport(db, workspace.id);
    if (!payload) throw new Error("Export returned null for the seeded workspace");
    fs.writeFileSync(EXPORT_PATH, JSON.stringify(payload, null, 2));
    const expected = {
      members: payload.members.length,
      leadLists: payload.leadLists.length,
      leads: payload.leads.length,
      campaigns: payload.campaigns.length,
      steps: payload.steps.length,
      variants: payload.variants.length,
      suppressions: payload.suppressions.length,
      sendingAccounts: payload.sendingAccounts.length,
      threads: payload.threads.length,
      threadMessages: payload.threads.reduce((n, t) => n + t.messages.length, 0),
      threadNotes: payload.threads.reduce((n, t) => n + t.notes.length, 0),
    };
    console.log(`Export counts: ${JSON.stringify(expected)}`);

    // 3. Wipe everything.
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
    await db.suppression.deleteMany({});
    const remaining =
      (await db.workspace.count()) +
      (await db.user.count()) +
      (await db.lead.count()) +
      (await db.campaign.count());
    check("database is empty after wipe", remaining === 0, `remaining=${remaining}`);
    await db.$disconnect();

    // 4. Restore through the real CLI script.
    const output = execFileSync(
      "npx",
      ["tsx", "scripts/restore-workspace.ts", EXPORT_PATH, "--owner-password", "drill-owner-pass-1"],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: `file:./${DB_NAME}.db` },
        encoding: "utf8",
      },
    );
    console.log(output.trim());
    const reportLine = output.split("\n").find((line) => line.startsWith("RESTORE_REPORT "));
    check("restore script emitted a report", Boolean(reportLine));
    const report = JSON.parse((reportLine as string).replace("RESTORE_REPORT ", "")) as Record<
      string,
      number | boolean
    >;

    // 5. Compare.
    check("members restored", report.memberships === expected.members, `${report.memberships} vs ${expected.members}`);
    check("lead lists restored", report.leadLists === expected.leadLists);
    check("leads restored", report.leads === expected.leads);
    check("campaigns restored", report.campaigns === expected.campaigns);
    check("steps restored", report.steps === expected.steps);
    check("variants restored", report.variants === expected.variants);
    check("suppressions restored", report.suppressions === expected.suppressions);
    check("sending accounts restored", report.sendingAccounts === expected.sendingAccounts);
    check("threads restored", report.threads === expected.threads);
    check("thread messages restored", report.threadMessages === expected.threadMessages);
    check("thread notes restored", report.threadNotes === expected.threadNotes);
    check("subscription restored", report.subscription === true);
    check("users created for all members", report.users === expected.members);

    // Cross-check against the database itself, plus safety invariants.
    const { PrismaClient } = await import("@prisma/client");
    const verify = new PrismaClient({
      datasources: { db: { url: `file:./${DB_NAME}.db` } },
    });
    try {
      check("db lead count matches export", (await verify.lead.count()) === expected.leads);
      check("db thread count matches export", (await verify.thread.count()) === expected.threads);
      const restoredCampaign = await verify.campaign.findFirst();
      check("restored campaign is DRAFT, never RUNNING", restoredCampaign?.status === "DRAFT", restoredCampaign?.status);
      const restoredAccount = await verify.sendingAccount.findFirst();
      check(
        "restored account is DISCONNECTED with no credentials",
        restoredAccount?.status === "DISCONNECTED" &&
          restoredAccount.credentialRef === null &&
          restoredAccount.encryptedCredentials === null,
      );
    } finally {
      await verify.$disconnect();
    }
  } finally {
    await dropTestDb(db, DB_NAME).catch(() => undefined);
  }

  console.log(failures === 0 ? "\nDRILL RESULT: PASS" : `\nDRILL RESULT: FAIL (${failures} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Drill crashed", error);
  process.exit(1);
});
