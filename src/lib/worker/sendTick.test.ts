import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runSendTick } from "./sendTick";
import { verifyOpenToken } from "./openTracking";
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

  it("embeds a signed open-tracking pixel in the HTML part only", async () => {
    const account = await makeAccount(100, "pixel");
    const { list, leads } = await makeListWithLeads("pixel", ["pixel@example.com"]);
    const campaign = await makeCampaign({
      suffix: "pixel",
      accountIds: [account.id],
      listId: list.id,
    });
    const enrollment = await enroll(campaign.id, leads[0].id);

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-pixel-1" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
    });
    expect(summary.failed).toBe(0);
    const ours = captured.filter((input) => input.toEmail === "pixel@example.com");
    expect(ours).toHaveLength(1);
    const html = ours[0].html ?? "";
    const match = html.match(/<img src="http:\/\/localhost:3000\/o\/([^"]+)"/);
    expect(match).not.toBeNull();
    expect(verifyOpenToken(match![1])).toEqual({
      workspaceId,
      enrollmentId: enrollment.id,
      stepIndex: 0,
    });
    expect(ours[0].text).not.toContain("/o/");
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

describe("runSendTick per-lead timezone window (v1.5.0)", () => {
  async function makeWindowedCampaign(suffix: string, accountId: string, listId: string) {
    const campaign = await db.campaign.create({
      data: {
        workspaceId,
        name: `Campaign ${suffix}`,
        status: "RUNNING",
        timezone: "UTC",
        windowStart: "09:00",
        windowEnd: "17:00",
        businessDaysOnly: false,
        leadListId: listId,
      },
    });
    await db.sequenceStep.create({
      data: {
        campaignId: campaign.id,
        order: 0,
        delayDays: 0,
        delayHours: 0,
        subject: "Hi {{firstName|there}}",
        body: "Body",
      },
    });
    await db.campaignAccount.create({ data: { campaignId: campaign.id, sendingAccountId: accountId } });
    return campaign;
  }

  async function makeLeadWithCountry(suffix: string, listId: string, country: string) {
    return db.lead.create({
      data: {
        workspaceId,
        listId,
        email: `${suffix}@example.com`,
        fields: { firstName: "Test", company: "Acme", country },
        tags: [],
        status: "NEW",
      },
    });
  }

  /** Enrollment already due before this block's fixed tick times. */
  async function enrollDue(campaignId: string, leadId: string, nextSendAt = "2026-10-26T00:00:00Z") {
    return db.enrollment.create({
      data: {
        campaignId,
        leadId,
        status: "ACTIVE",
        currentStep: 0,
        nextSendAt: new Date(nextSendAt),
      },
    });
  }

  it("defers a US lead outside its local window and sends once the window opens", async () => {
    const account = await makeAccount(100, "tz-us");
    const list = await db.leadList.create({ data: { workspaceId, name: "List tz-us" } });
    const lead = await makeLeadWithCountry("tz-us", list.id, "United States");
    const campaign = await makeWindowedCampaign("tz-us", account.id, list.id);
    const enrollment = await enrollDue(campaign.id, lead.id);

    // Monday 2026-10-26 10:00 UTC is 05:00 in Chicago, before the
    // 09:00 window opening there: nothing sends, and the enrollment
    // is re-stamped to 09:00 Chicago time (14:00 UTC).
    const early = await runSendTick({ db, now: new Date("2026-10-26T10:00:00Z"), skipSync: true });
    expect(early.sent).toBe(0);
    expect(early.deferredOutsideWindow).toBe(1);
    const deferred = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(deferred?.nextSendAt?.toISOString()).toBe("2026-10-26T14:00:00.000Z");

    // 16:00 UTC is 11:00 in Chicago: inside the window, the send goes.
    const later = await runSendTick({ db, now: new Date("2026-10-26T16:00:00Z"), skipSync: true });
    expect(later.sent).toBe(1);
    expect(later.deferredOutsideWindow).toBe(0);
  });

  it("sends a German lead whose local window is already open", async () => {
    const account = await makeAccount(100, "tz-de");
    const list = await db.leadList.create({ data: { workspaceId, name: "List tz-de" } });
    const lead = await makeLeadWithCountry("tz-de", list.id, "Germany");
    const campaign = await makeWindowedCampaign("tz-de", account.id, list.id);
    // Stamped 08:00 UTC, which is 09:00 in Berlin: a valid local time.
    await enrollDue(campaign.id, lead.id, "2026-10-26T08:00:00Z");

    // Monday 2026-10-26 08:30 UTC is 09:30 in Berlin: inside the window.
    const summary = await runSendTick({ db, now: new Date("2026-10-26T08:30:00Z"), skipSync: true });
    expect(summary.sent).toBe(1);
    expect(summary.deferredOutsideWindow).toBe(0);
  });

  it("still sends a validly stamped US lead when the only tick runs late", async () => {
    const account = await makeAccount(100, "tz-late");
    const list = await db.leadList.create({ data: { workspaceId, name: "List tz-late" } });
    const lead = await makeLeadWithCountry("tz-late", list.id, "United States");
    const campaign = await makeWindowedCampaign("tz-late", account.id, list.id);
    // Stamped 2026-10-26 14:00 UTC, which is 09:00 in Chicago: valid.
    await enrollDue(campaign.id, lead.id, "2026-10-26T14:00:00Z");

    // The next tick runs at 05:00 UTC, midnight in Chicago. A sparse
    // cadence must degrade to late delivery, never starve the lead.
    const summary = await runSendTick({ db, now: new Date("2026-10-27T05:00:00Z"), skipSync: true });
    expect(summary.sent).toBe(1);
    expect(summary.deferredOutsideWindow).toBe(0);
  });
});

describe("interleaveByCampaign (v1.8.1 fairness)", () => {
  it("round-robins across campaigns instead of draining the first one", async () => {
    const { interleaveByCampaign } = await import("./sendTick");
    const pool = [
      ...[1, 2, 3, 4].map((n) => ({ campaignId: "a", n })),
      ...[1, 2, 3, 4].map((n) => ({ campaignId: "b", n })),
    ];
    const picked = interleaveByCampaign(pool, 4);
    expect(picked.map((item) => item.campaignId)).toEqual(["a", "b", "a", "b"]);
    expect(picked.map((item) => item.n)).toEqual([1, 1, 2, 2]);
  });

  it("keeps a single campaign in its own order and returns everything under the limit", async () => {
    const { interleaveByCampaign } = await import("./sendTick");
    const pool = [1, 2, 3].map((n) => ({ campaignId: "a", n }));
    expect(interleaveByCampaign(pool, 10).map((item) => item.n)).toEqual([1, 2, 3]);
  });
});

describe("runSendTick outbound thread recording (v1.8.1)", () => {
  it("writes the send as an outbound thread message so the Outbox lists it", async () => {
    const account = await makeAccount(100, "outbox");
    const { list, leads } = await makeListWithLeads("outbox", ["outbox@example.com"]);
    const campaign = await makeCampaign({
      suffix: "outbox",
      accountIds: [account.id],
      listId: list.id,
    });
    await enroll(campaign.id, leads[0].id);

    const summary = await runSendTick({ db, now: new Date(), skipSync: true });
    expect(summary.failed).toBe(0);

    const messages = await db.threadMessage.findMany({
      where: { direction: "OUTBOUND", toEmail: "outbox@example.com" },
      include: { thread: true },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].thread.campaignId).toBe(campaign.id);
    expect(messages[0].thread.leadId).toBe(leads[0].id);
    expect(messages[0].thread.sendingAccountId).toBe(account.id);
    expect(messages[0].subject).toContain("Subject 1");
    expect(messages[0].body).toContain("Body 1 for Acme");
    expect(messages[0].fromEmail).toBe(account.email);
  });
});

describe("runSendTick account balancing (v1.8.2)", () => {
  it("spreads two campaigns sharing the same accounts across different accounts", async () => {
    const accountA = await makeAccount(100, "bal-a");
    const accountB = await makeAccount(100, "bal-b");
    const { list: listA, leads: leadsA } = await makeListWithLeads("bal-a", ["bal-a@example.com"]);
    const { list: listB, leads: leadsB } = await makeListWithLeads("bal-b", ["bal-b@example.com"]);
    const campaignA = await makeCampaign({
      suffix: "bal-a",
      accountIds: [accountA.id, accountB.id],
      listId: listA.id,
    });
    const campaignB = await makeCampaign({
      suffix: "bal-b",
      accountIds: [accountA.id, accountB.id],
      listId: listB.id,
    });
    await enroll(campaignA.id, leadsA[0].id);
    await enroll(campaignB.id, leadsB[0].id);

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-bal-1" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
    });
    expect(summary.failed).toBe(0);
    const ours = captured.filter(
      (input) => input.toEmail === "bal-a@example.com" || input.toEmail === "bal-b@example.com",
    );
    expect(ours).toHaveLength(2);
    // The old rotation restarted at the first account for every
    // campaign, so both sends would have left from account A. The
    // least-used rule sends the second one from account B.
    expect(ours[0].fromEmail).not.toBe(ours[1].fromEmail);
    expect(new Set(ours.map((input) => input.fromEmail))).toEqual(
      new Set([accountA.email, accountB.email]),
    );
  });

  it("defers sends past the per-tick pacing ceiling and sends them on a later tick", async () => {
    const account = await makeAccount(100, "pace-tick");
    const { list, leads } = await makeListWithLeads("pace-tick", [
      "pace1@example.com",
      "pace2@example.com",
      "pace3@example.com",
      "pace4@example.com",
      "pace5@example.com",
    ]);
    const campaign = await makeCampaign({
      suffix: "pace-tick",
      accountIds: [account.id],
      listId: list.id,
    });
    for (const lead of leads) {
      await enroll(campaign.id, lead.id);
    }
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async () => ({ providerMessageId: "capture-pace-tick" }),
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
      tickSendCeiling: 2,
      hourlyCap: 500,
    });
    expect(summary.sent).toBe(2);
    expect(summary.deferredTickPacing).toBe(3);
    expect(summary.deferredHourlyCap).toBe(0);
    // The deferred enrollments stayed due: a later tick with a fresh
    // ceiling sends the rest.
    const second = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
      tickSendCeiling: 20,
      hourlyCap: 500,
    });
    expect(second.sent).toBe(3);
  });

  it("defers every send when the workspace already hit its rolling hourly cap", async () => {
    const account = await makeAccount(100, "pace-hour");
    const { list, leads } = await makeListWithLeads("pace-hour", [
      "paceh1@example.com",
      "paceh2@example.com",
    ]);
    const campaign = await makeCampaign({
      suffix: "pace-hour",
      accountIds: [account.id],
      listId: list.id,
    });
    const enrollments = [];
    for (const lead of leads) {
      enrollments.push(await enroll(campaign.id, lead.id));
    }
    // Three sends already recorded inside the last hour.
    for (let i = 0; i < 3; i += 1) {
      await db.emailEvent.create({
        data: {
          workspaceId,
          campaignId: campaign.id,
          enrollmentId: enrollments[0].id,
          sendingAccountId: account.id,
          type: "SENT",
          idempotencyKey: `pace-hour-seed-${i}`,
          occurredAt: new Date(Date.now() - 5 * 60_000),
        },
      });
    }
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async () => ({ providerMessageId: "capture-pace-hour" }),
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
      tickSendCeiling: 100,
      hourlyCap: 3,
    });
    expect(summary.sent).toBe(0);
    // At least this test's two enrollments deferred on the hourly
    // cap; the shared suite database can hold other due enrollments
    // from earlier tests, which defer on the same gate.
    expect(summary.deferredHourlyCap).toBeGreaterThanOrEqual(2);
    expect(summary.deferredTickPacing).toBe(0);
  });
});
