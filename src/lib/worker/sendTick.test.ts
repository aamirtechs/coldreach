import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runSendTick } from "./sendTick";
import type { MailProvider, SendInput } from "@/lib/providers/types";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

const DB_NAME = "test-sendtick";
let db: PrismaClient;
let workspaceId: string;

const past = () => new Date(Date.now() - 60_000);

async function makeAccount(dailyLimit: number, suffix: string) {
  return db.sendingAccount.create({
    data: {
      workspaceId,
      email: `sender-${suffix}@example.com`,
      displayName: "Sender",
      provider: "SIMULATION",
      status: "CONNECTED",
      dailyLimit,
      warmupStatus: "SIMULATED",
    },
  });
}

async function makeCampaign(args: {
  suffix: string;
  accountIds: string[];
  listId: string;
  stepDelays?: { days: number; hours: number }[];
}) {
  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      name: `Campaign ${args.suffix}`,
      status: "RUNNING",
      timezone: "UTC",
      windowStart: "00:00",
      windowEnd: "23:59",
      businessDaysOnly: false,
      leadListId: args.listId,
    },
  });
  const delays = args.stepDelays ?? [
    { days: 0, hours: 0 },
    { days: 1, hours: 0 },
  ];
  for (const [index, delay] of delays.entries()) {
    await db.sequenceStep.create({
      data: {
        campaignId: campaign.id,
        order: index,
        delayDays: delay.days,
        delayHours: delay.hours,
        subject: `Subject ${index + 1} for {{firstName|there}}`,
        body: `Body ${index + 1} for {{company}}`,
      },
    });
  }
  for (const accountId of args.accountIds) {
    await db.campaignAccount.create({ data: { campaignId: campaign.id, sendingAccountId: accountId } });
  }
  return campaign;
}

async function makeListWithLeads(suffix: string, emails: string[]) {
  const list = await db.leadList.create({ data: { workspaceId, name: `List ${suffix}` } });
  const leads = [];
  for (const email of emails) {
    leads.push(
      await db.lead.create({
        data: {
          workspaceId,
          listId: list.id,
          email,
          fields: { firstName: "Test", company: "Acme" },
          tags: [],
          status: "NEW",
        },
      }),
    );
  }
  return { list, leads };
}

async function enroll(campaignId: string, leadId: string) {
  return db.enrollment.create({
    data: { campaignId, leadId, status: "ACTIVE", currentStep: 0, nextSendAt: past() },
  });
}

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "sendtick");
  workspaceId = seeded.workspace.id;
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("runSendTick", () => {
  it("sends due enrollments, rotates across two accounts, and advances the sequence", async () => {
    const accountA = await makeAccount(100, "rot-a");
    const accountB = await makeAccount(100, "rot-b");
    const { list, leads } = await makeListWithLeads("rot", ["rot1@example.com", "rot2@example.com"]);
    const campaign = await makeCampaign({
      suffix: "rot",
      accountIds: [accountA.id, accountB.id],
      listId: list.id,
    });
    const e1 = await enroll(campaign.id, leads[0].id);
    const e2 = await enroll(campaign.id, leads[1].id);

    const summary = await runSendTick({ db, now: new Date() });
    expect(summary.sent).toBe(2);
    expect(summary.simulated).toBe(2);
    expect(summary.failed).toBe(0);

    const events = await db.emailEvent.findMany({ where: { campaignId: campaign.id, type: "SENT" } });
    expect(events).toHaveLength(2);
    const accountIdsUsed = new Set(events.map((e) => e.sendingAccountId));
    expect(accountIdsUsed.size).toBe(2);
    expect(events.map((e) => e.idempotencyKey).sort()).toEqual(
      [`send:${e1.id}:0`, `send:${e2.id}:0`].sort(),
    );

    const after1 = await db.enrollment.findUnique({ where: { id: e1.id } });
    expect(after1?.status).toBe("ACTIVE");
    expect(after1?.currentStep).toBe(1);
    expect(after1?.nextSendAt && after1.nextSendAt.getTime()).toBeGreaterThan(Date.now());

    // An immediate second tick sends nothing: nothing is due any more.
    const second = await runSendTick({ db, now: new Date() });
    expect(second.sent).toBe(0);
    expect(await db.emailEvent.count({ where: { campaignId: campaign.id, type: "SENT" } })).toBe(2);
  });

  it("recovers from a crash after the send was recorded without resending", async () => {
    const account = await makeAccount(100, "crash");
    const { list, leads } = await makeListWithLeads("crash", ["crash@example.com"]);
    const campaign = await makeCampaign({ suffix: "crash", accountIds: [account.id], listId: list.id });
    const enrollment = await enroll(campaign.id, leads[0].id);

    const first = await runSendTick({ db, now: new Date() });
    expect(first.sent).toBe(1);

    // Simulate the crash window: step 1 was recorded as sent, but the
    // enrollment still sits at step 1 and is due again.
    const stepOneKey = `send:${enrollment.id}:1`;
    await db.emailEvent.create({
      data: {
        workspaceId,
        campaignId: campaign.id,
        enrollmentId: enrollment.id,
        sendingAccountId: account.id,
        type: "SENT",
        providerMessageId: "demo-crash-recovery",
        idempotencyKey: stepOneKey,
        occurredAt: new Date(),
      },
    });
    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { nextSendAt: past() },
    });

    const recovered = await runSendTick({ db, now: new Date() });
    expect(recovered.sent).toBe(0);
    expect(recovered.completed).toBe(1);
    const after = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(after?.status).toBe("COMPLETED");
    expect(
      await db.emailEvent.count({ where: { campaignId: campaign.id, type: "SENT" } }),
    ).toBe(2);
  });

  it("respects the effective daily limit and defers the rest", async () => {
    // A brand new account with a cap of 5 has an effective limit of 1
    // on day zero under the default ramp.
    const account = await makeAccount(5, "limit");
    const { list, leads } = await makeListWithLeads("limit", ["lim1@example.com", "lim2@example.com"]);
    const campaign = await makeCampaign({ suffix: "limit", accountIds: [account.id], listId: list.id });
    await enroll(campaign.id, leads[0].id);
    const e2 = await enroll(campaign.id, leads[1].id);

    const summary = await runSendTick({ db, now: new Date() });
    expect(summary.sent).toBe(1);
    expect(summary.deferredNoCapacity).toBe(1);
    const deferred = await db.enrollment.findUnique({ where: { id: e2.id } });
    expect(deferred?.status).toBe("ACTIVE");
    expect(deferred?.currentStep).toBe(0);
  });

  it("skips and closes enrollments whose lead became suppressed after enrollment", async () => {
    const account = await makeAccount(100, "supp");
    const { list, leads } = await makeListWithLeads("supp", ["supp@example.com"]);
    const campaign = await makeCampaign({ suffix: "supp", accountIds: [account.id], listId: list.id });
    const enrollment = await enroll(campaign.id, leads[0].id);
    await db.suppression.create({
      data: {
        workspaceId,
        scope: "WORKSPACE",
        email: "supp@example.com",
        reason: "Manual suppression",
      },
    });

    const summary = await runSendTick({ db, now: new Date() });
    expect(summary.sent).toBe(0);
    expect(summary.skippedSuppressed).toBe(1);
    const after = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(after?.status).toBe("SUPPRESSED");
    expect(after?.nextSendAt).toBeNull();
  });

  it("sets both List-Unsubscribe and the RFC 8058 one-click post header on sends", async () => {
    const account = await makeAccount(100, "headers");
    const { list, leads } = await makeListWithLeads("headers", ["headers@example.com"]);
    const campaign = await makeCampaign({
      suffix: "headers",
      accountIds: [account.id],
      listId: list.id,
    });
    await enroll(campaign.id, leads[0].id);

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-headers-1" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
    });
    expect(summary.failed).toBe(0);
    const ours = captured.filter((input) => input.toEmail === "headers@example.com");
    expect(ours).toHaveLength(1);
    expect(ours[0].headers?.["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:3000\/u\/.+>$/);
    expect(ours[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("renders the campaign signature between the body and the compliance footer", async () => {
    const account = await makeAccount(100, "sig");
    const { list, leads } = await makeListWithLeads("sig", ["sig@example.com"]);
    const campaign = await makeCampaign({
      suffix: "sig",
      accountIds: [account.id],
      listId: list.id,
    });
    await db.campaign.update({
      where: { id: campaign.id },
      data: { signatureText: "Best regards,\nAmir Hussain\nAamirTechs" },
    });
    await enroll(campaign.id, leads[0].id);

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-sig-1" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
    });
    expect(summary.failed).toBe(0);
    const ours = captured.filter((input) => input.toEmail === "sig@example.com");
    expect(ours).toHaveLength(1);
    // Text: body, then signature, then the "--" compliance footer.
    expect(ours[0].text).toContain("Body 1 for Acme\n\nBest regards,\nAmir Hussain\nAamirTechs\n\n--");
    // HTML: signature paragraphs appear before the footer rule.
    const html = ours[0].html ?? "";
    expect(html.indexOf("Best regards")).toBeGreaterThan(-1);
    expect(html.indexOf("Best regards")).toBeLessThan(html.indexOf("<hr />"));
  });
});
