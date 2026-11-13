import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
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
    // v1.11.7: with a signature present, the footer drops the repeated
    // sender name but keeps the postal address and unsubscribe link.
    // ("Test Sender" is the seeded workspace senderName; it appears in
    // the full message only if the footer repeats it.)
    expect(ours[0].text).not.toContain("Test Sender");
    expect(ours[0].text).toContain("1 Test Street, Testville");
    expect(ours[0].text).toContain("Unsubscribe: http://localhost:3000/u/");
    // HTML: signature paragraphs appear before the footer rule.
    const html = ours[0].html ?? "";
    expect(html.indexOf("Best regards")).toBeGreaterThan(-1);
    expect(html.indexOf("Best regards")).toBeLessThan(html.indexOf("<hr />"));
    expect(html).not.toContain("Test Sender");
    expect(html).toContain("1 Test Street, Testville");
  });

  it("keeps the sender name in the footer when the campaign has no signature", async () => {
    const account = await makeAccount(100, "nosig");
    const { list, leads } = await makeListWithLeads("nosig", ["nosig@example.com"]);
    const campaign = await makeCampaign({
      suffix: "nosig",
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
        return { providerMessageId: "capture-nosig-1" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
    });
    expect(summary.failed).toBe(0);
    const ours = captured.filter((input) => input.toEmail === "nosig@example.com");
    expect(ours).toHaveLength(1);
    // No signature: the footer is the sign-off, so it keeps the name,
    // then the postal address, then the unsubscribe link.
    expect(ours[0].text).toContain("\n--\nTest Sender\n1 Test Street, Testville\nUnsubscribe: ");
    const html = ours[0].html ?? "";
    expect(html).toContain("Test Sender<br />1 Test Street, Testville<br />");
  });

  it("uses the campaign sender identity for the From name and sign-off when no signature is set", async () => {
    const account = await makeAccount(100, "ident");
    const { list, leads } = await makeListWithLeads("ident", ["ident@example.com"]);
    const campaign = await makeCampaign({
      suffix: "ident",
      accountIds: [account.id],
      listId: list.id,
    });
    await db.campaign.update({
      where: { id: campaign.id },
      data: { senderName: "Chris Blake", companyName: "Dispatch Authority" },
    });
    await enroll(campaign.id, leads[0].id);

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-ident-1" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
    });
    expect(summary.failed).toBe(0);
    const ours = captured.filter((input) => input.toEmail === "ident@example.com");
    expect(ours).toHaveLength(1);
    // From name is the campaign's sender name, not the account's.
    expect(ours[0].fromName).toBe("Chris Blake");
    // Sign-off is composed from the identity: name, then company,
    // then the slim footer (address + unsubscribe, no repeated name).
    expect(ours[0].text).toContain("Body 1 for Acme\n\nChris Blake\nDispatch Authority\n\n--\n1 Test Street, Testville\nUnsubscribe: ");
    expect(ours[0].text).not.toContain("Test Sender");
  });

  it("prefers an explicit signature over the identity sign-off but keeps the identity From name", async () => {
    const account = await makeAccount(100, "ident2");
    const { list, leads } = await makeListWithLeads("ident2", ["ident2@example.com"]);
    const campaign = await makeCampaign({
      suffix: "ident2",
      accountIds: [account.id],
      listId: list.id,
    });
    await db.campaign.update({
      where: { id: campaign.id },
      data: {
        senderName: "Chris Blake",
        companyName: "Dispatch Authority",
        signatureText: "Best regards,\nAmir Hussain\nAamirTechs",
      },
    });
    await enroll(campaign.id, leads[0].id);

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-ident2-1" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
    });
    expect(summary.failed).toBe(0);
    const ours = captured.filter((input) => input.toEmail === "ident2@example.com");
    expect(ours).toHaveLength(1);
    expect(ours[0].fromName).toBe("Chris Blake");
    expect(ours[0].text).toContain("Best regards,\nAmir Hussain\nAamirTechs");
    // The identity sign-off is not composed on top of the signature.
    expect(ours[0].text).not.toContain("Chris Blake\nDispatch Authority");
  });

  it("resolves sender identity tokens in step copy from the campaign identity, then the workspace", async () => {
    // Campaign identity set: tokens render the campaign's values.
    const accountA = await makeAccount(100, "tok1");
    const first = await makeListWithLeads("tok1", ["tok1@example.com"]);
    const campaignA = await makeCampaign({
      suffix: "tok1",
      accountIds: [accountA.id],
      listId: first.list.id,
    });
    await db.sequenceStep.updateMany({
      where: { campaignId: campaignA.id, order: 0 },
      data: { body: "I am {{senderFirstName}} with {{senderCompany}}." },
    });
    await db.campaign.update({
      where: { id: campaignA.id },
      data: { senderName: "Chris Blake", companyName: "Dispatch Authority" },
    });
    await enroll(campaignA.id, first.leads[0].id);

    // No campaign identity: tokens fall back to the workspace
    // (senderName "Test Sender", workspace name "Test Workspace").
    const accountB = await makeAccount(100, "tok2");
    const second = await makeListWithLeads("tok2", ["tok2@example.com"]);
    const campaignB = await makeCampaign({
      suffix: "tok2",
      accountIds: [accountB.id],
      listId: second.list.id,
    });
    await db.sequenceStep.updateMany({
      where: { campaignId: campaignB.id, order: 0 },
      data: { body: "I am {{senderName}} with {{senderCompany}}." },
    });
    await enroll(campaignB.id, second.leads[0].id);

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-tok-1" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
    });
    expect(summary.failed).toBe(0);
    const oursA = captured.filter((input) => input.toEmail === "tok1@example.com");
    expect(oursA).toHaveLength(1);
    expect(oursA[0].text).toContain("I am Chris with Dispatch Authority.");
    const oursB = captured.filter((input) => input.toEmail === "tok2@example.com");
    expect(oursB).toHaveLength(1);
    expect(oursB[0].text).toContain("I am Test Sender with Test Workspace.");
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

describe("open-gated follow-ups (v1.17.0)", () => {
  async function seedFollowUp(args: {
    suffix: string;
    currentStep: number;
    prevSentAt: Date;
    openedPrevStep?: boolean;
    openedStepIndexes?: number[];
    openedClassification?: string;
  }) {
    const account = await makeAccount(100, `gate-${args.suffix}`);
    const { list, leads } = await makeListWithLeads(`gate-${args.suffix}`, [
      `gate-${args.suffix}@example.com`,
    ]);
    const campaign = await makeCampaign({
      suffix: `gate-${args.suffix}`,
      accountIds: [account.id],
      listId: list.id,
      stepDelays: [
        { days: 0, hours: 0 },
        { days: 1, hours: 0 },
        { days: 1, hours: 0 },
      ],
    });
    const enrollment = await db.enrollment.create({
      data: {
        campaignId: campaign.id,
        leadId: leads[0].id,
        status: "ACTIVE",
        currentStep: args.currentStep,
        nextSendAt: past(),
      },
    });
    const prevStepIndex = args.currentStep - 1;
    await db.emailEvent.create({
      data: {
        workspaceId,
        campaignId: campaign.id,
        enrollmentId: enrollment.id,
        sendingAccountId: account.id,
        type: "SENT",
        idempotencyKey: `send:${enrollment.id}:${prevStepIndex}`,
        occurredAt: args.prevSentAt,
      },
    });
    const opens = args.openedStepIndexes ?? (args.openedPrevStep ? [prevStepIndex] : []);
    for (const stepIndex of opens) {
      await db.emailEvent.create({
        data: {
          workspaceId,
          campaignId: campaign.id,
          enrollmentId: enrollment.id,
          type: "OPENED",
          idempotencyKey: `evt:${enrollment.id}:${stepIndex}:OPENED`,
          classification: args.openedClassification ?? null,
          occurredAt: new Date(),
        },
      });
    }
    return { campaign, enrollment };
  }

  it("does not send step 2 when the lead never opened step 1, and completes the enrollment", async () => {
    const { enrollment } = await seedFollowUp({
      suffix: "noopen",
      currentStep: 1,
      prevSentAt: new Date("2026-11-01T10:00:00Z"),
    });
    const summary = await runSendTick({ db, now: new Date(), skipSync: true });
    expect(summary.skippedNotOpened).toBeGreaterThanOrEqual(1);
    const after = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(after?.status).toBe("COMPLETED");
    expect(after?.nextSendAt).toBeNull();
    expect(after?.lastError).toContain("did not view the previous email");
    const sentStep2 = await db.emailEvent.findUnique({
      where: { idempotencyKey: `send:${enrollment.id}:1` },
    });
    expect(sentStep2).toBeNull();
  });

  it("does not send step 2 when the only open of step 1 was a machine open", async () => {
    const { enrollment } = await seedFollowUp({
      suffix: "machineopen",
      currentStep: 1,
      prevSentAt: new Date("2026-11-01T10:00:00Z"),
      openedPrevStep: true,
      openedClassification: "MACHINE",
    });
    const summary = await runSendTick({ db, now: new Date(), skipSync: true });
    expect(summary.skippedNotOpened).toBeGreaterThanOrEqual(1);
    const after = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(after?.status).toBe("COMPLETED");
    expect(after?.lastError).toContain("automatic view");
    const sentStep2 = await db.emailEvent.findUnique({
      where: { idempotencyKey: `send:${enrollment.id}:1` },
    });
    expect(sentStep2).toBeNull();
  });

  it("sends step 2 when the lead opened step 1", async () => {
    const { enrollment } = await seedFollowUp({
      suffix: "opened",
      currentStep: 1,
      prevSentAt: new Date("2026-11-01T10:00:00Z"),
      openedPrevStep: true,
    });
    const summary = await runSendTick({ db, now: new Date(), skipSync: true });
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    const sentStep2 = await db.emailEvent.findUnique({
      where: { idempotencyKey: `send:${enrollment.id}:1` },
    });
    expect(sentStep2).not.toBeNull();
    const after = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(after?.status).toBe("ACTIVE");
    expect(after?.currentStep).toBe(2);
  });

  it("sends step 2 without any open when the campaign has the open gate turned off (v1.27.0)", async () => {
    const { campaign, enrollment } = await seedFollowUp({
      suffix: "gateoff",
      currentStep: 1,
      prevSentAt: new Date("2026-11-01T10:00:00Z"),
    });
    await db.campaign.update({
      where: { id: campaign.id },
      data: { requireOpenForFollowUps: false },
    });
    await runSendTick({ db, now: new Date(), skipSync: true });
    const sentStep2 = await db.emailEvent.findUnique({
      where: { idempotencyKey: `send:${enrollment.id}:1` },
    });
    expect(sentStep2).not.toBeNull();
    const after = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(after?.lastError ?? "").not.toContain("Follow-up not sent");
  });

  it("does not send step 3 when only step 1 was opened, not step 2", async () => {
    const { enrollment } = await seedFollowUp({
      suffix: "partial",
      currentStep: 2,
      prevSentAt: new Date("2026-11-02T10:00:00Z"),
      openedStepIndexes: [0],
    });
    const summary = await runSendTick({ db, now: new Date(), skipSync: true });
    expect(summary.skippedNotOpened).toBeGreaterThanOrEqual(1);
    const after = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(after?.status).toBe("COMPLETED");
    const sentStep3 = await db.emailEvent.findUnique({
      where: { idempotencyKey: `send:${enrollment.id}:2` },
    });
    expect(sentStep3).toBeNull();
  });

  it("still sends the follow-up when the previous step was sent before open tracking existed", async () => {
    const { enrollment } = await seedFollowUp({
      suffix: "legacy",
      currentStep: 1,
      prevSentAt: new Date("2026-10-20T10:00:00Z"),
    });
    const summary = await runSendTick({ db, now: new Date(), skipSync: true });
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    const sentStep2 = await db.emailEvent.findUnique({
      where: { idempotencyKey: `send:${enrollment.id}:1` },
    });
    expect(sentStep2).not.toBeNull();
  });

  it("sends a step's attachments with that step only (v1.19.0)", async () => {
    const account = await makeAccount(100, "attach");
    const { list, leads } = await makeListWithLeads("attach", ["attach@example.com"]);
    const campaign = await makeCampaign({
      suffix: "attach",
      accountIds: [account.id],
      listId: list.id,
    });
    await db.stepAttachment.create({
      data: {
        workspaceId,
        campaignId: campaign.id,
        stepOrder: 0,
        filename: "one-pager.pdf",
        contentType: "application/pdf",
        sizeBytes: 5,
        data: Buffer.from("hello"),
      },
    });
    await db.stepAttachment.create({
      data: {
        workspaceId,
        campaignId: campaign.id,
        stepOrder: 1,
        filename: "follow-up.txt",
        contentType: "text/plain",
        sizeBytes: 5,
        data: Buffer.from("world"),
      },
    });
    await enroll(campaign.id, leads[0].id);

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-attach-1" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
    });
    expect(summary.failed).toBe(0);
    const ours = captured.filter((input) => input.toEmail === "attach@example.com");
    expect(ours).toHaveLength(1);
    // Step 1 (order 0) sends now: it carries only its own file, not
    // the follow-up step's file.
    expect(ours[0].attachments).toHaveLength(1);
    expect(ours[0].attachments?.[0].filename).toBe("one-pager.pdf");
    expect(ours[0].attachments?.[0].contentType).toBe("application/pdf");
    expect(ours[0].attachments?.[0].content.toString()).toBe("hello");
  });
});

describe("scheduler fixes (v1.21.0)", () => {
  async function accountFor(wsId: string, email: string, dailyLimit = 100) {
    return db.sendingAccount.create({
      data: {
        workspaceId: wsId,
        email,
        displayName: "Sender",
        provider: "SIMULATION",
        status: "CONNECTED",
        dailyLimit,
        warmupStatus: "SIMULATED",
      },
    });
  }

  async function campaignFor(
    wsId: string,
    args: {
      name: string;
      accountId: string;
      windowStart?: string;
      windowEnd?: string;
      businessDaysOnly?: boolean;
    },
  ) {
    const list = await db.leadList.create({ data: { workspaceId: wsId, name: `List ${args.name}` } });
    const campaign = await db.campaign.create({
      data: {
        workspaceId: wsId,
        name: args.name,
        status: "RUNNING",
        timezone: "UTC",
        windowStart: args.windowStart ?? "00:00",
        windowEnd: args.windowEnd ?? "23:59",
        businessDaysOnly: args.businessDaysOnly ?? false,
        leadListId: list.id,
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
    await db.campaignAccount.create({
      data: { campaignId: campaign.id, sendingAccountId: args.accountId },
    });
    return { campaign, list };
  }

  async function leadFor(wsId: string, listId: string, email: string) {
    return db.lead.create({
      data: {
        workspaceId: wsId,
        listId,
        email,
        fields: { firstName: "Test", company: "Acme" },
        tags: [],
        status: "NEW",
      },
    });
  }

  it("sends an enrollment whose stamp is null (enrolled before the sequence existed)", async () => {
    const account = await accountFor(workspaceId, "sender-nullstamp@example.com");
    const { campaign, list } = await campaignFor(workspaceId, {
      name: "null-stamp",
      accountId: account.id,
    });
    const lead = await leadFor(workspaceId, list.id, "nullstamp@example.com");
    // The stranded state enrollCampaign produced before v1.21.0 when
    // a campaign was enrolled before its first step existed: ACTIVE
    // with a null stamp, which the due query could never match.
    const enrollment = await db.enrollment.create({
      data: { campaignId: campaign.id, leadId: lead.id, status: "ACTIVE", currentStep: 0, nextSendAt: null },
    });

    const summary = await runSendTick({ db, now: new Date(), skipSync: true });
    expect(summary.failed).toBe(0);
    expect(
      await db.emailEvent.count({ where: { campaignId: campaign.id, type: "SENT" } }),
    ).toBe(1);
    const after = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(after?.status).toBe("COMPLETED");
  });

  it("stamps a null-stamp enrollment to the next window opening instead of sending outside the window", async () => {
    const account = await accountFor(workspaceId, "sender-nullwin@example.com");
    const { campaign, list } = await campaignFor(workspaceId, {
      name: "null-window",
      accountId: account.id,
      windowStart: "09:00",
      windowEnd: "17:00",
    });
    const lead = await leadFor(workspaceId, list.id, "nullwin@example.com");
    const enrollment = await db.enrollment.create({
      data: { campaignId: campaign.id, leadId: lead.id, status: "ACTIVE", currentStep: 0, nextSendAt: null },
    });

    // Monday 2026-10-26 20:00 UTC is after the window closed: the
    // recovery must stamp the next opening (Tuesday 09:00), not send.
    const evening = await runSendTick({ db, now: new Date("2026-10-26T20:00:00Z"), skipSync: true });
    expect(evening.sent).toBe(0);
    expect(
      await db.emailEvent.count({ where: { campaignId: campaign.id, type: "SENT" } }),
    ).toBe(0);
    const deferred = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(deferred?.nextSendAt?.toISOString()).toBe("2026-10-27T09:00:00.000Z");

    // Inside the window the recovered enrollment sends normally.
    const morning = await runSendTick({ db, now: new Date("2026-10-27T10:00:00Z"), skipSync: true });
    expect(morning.failed).toBe(0);
    expect(
      await db.emailEvent.count({ where: { campaignId: campaign.id, type: "SENT" } }),
    ).toBe(1);
  });

  it("revalidates a stale weekend or night stamp against the current business-days schedule", async () => {
    const account = await accountFor(workspaceId, "sender-stale@example.com");
    const { campaign, list } = await campaignFor(workspaceId, {
      name: "stale-stamp",
      accountId: account.id,
      windowStart: "09:00",
      windowEnd: "17:00",
      businessDaysOnly: true,
    });
    // Leads carry no country, so no per-lead timezone resolves: the
    // case the v1.5.0 gate never checked. Both stamps predate the
    // business-days setting (or an equivalent schedule edit): one
    // sits on a Saturday, one late on Friday night.
    const saturdayLead = await leadFor(workspaceId, list.id, "stale-sat@example.com");
    const nightLead = await leadFor(workspaceId, list.id, "stale-night@example.com");
    const saturday = await db.enrollment.create({
      data: {
        campaignId: campaign.id,
        leadId: saturdayLead.id,
        status: "ACTIVE",
        currentStep: 0,
        nextSendAt: new Date("2026-10-24T10:00:00Z"),
      },
    });
    const night = await db.enrollment.create({
      data: {
        campaignId: campaign.id,
        leadId: nightLead.id,
        status: "ACTIVE",
        currentStep: 0,
        nextSendAt: new Date("2026-10-23T23:30:00Z"),
      },
    });

    // A tick on Saturday morning must not send either one: both are
    // re-stamped to the next valid slot, Monday 09:00.
    const weekend = await runSendTick({ db, now: new Date("2026-10-24T10:05:00Z"), skipSync: true });
    expect(weekend.failed).toBe(0);
    expect(
      await db.emailEvent.count({ where: { campaignId: campaign.id, type: "SENT" } }),
    ).toBe(0);
    expect(weekend.deferredOutsideWindow).toBeGreaterThanOrEqual(2);
    for (const stale of [saturday, night]) {
      const after = await db.enrollment.findUnique({ where: { id: stale.id } });
      expect(after?.nextSendAt?.toISOString()).toBe("2026-10-26T09:00:00.000Z");
    }

    // Monday inside the window, both send.
    const monday = await runSendTick({ db, now: new Date("2026-10-26T09:05:00Z"), skipSync: true });
    expect(monday.failed).toBe(0);
    expect(
      await db.emailEvent.count({ where: { campaignId: campaign.id, type: "SENT" } }),
    ).toBe(2);
  });

  it("applies the per-tick send ceiling per workspace, not across the whole platform", async () => {
    const other = await seedWorkspace(db, "ceiling-b");
    const accountA = await accountFor(workspaceId, "ceil-a@ceila.test");
    const a = await campaignFor(workspaceId, { name: "ceiling-a", accountId: accountA.id });
    const leadA = await leadFor(workspaceId, a.list.id, "ceil-a-lead@recipient.test");
    const accountB = await accountFor(other.workspace.id, "ceil-b@ceilb.test");
    const b = await campaignFor(other.workspace.id, { name: "ceiling-b", accountId: accountB.id });
    const leadB = await leadFor(other.workspace.id, b.list.id, "ceil-b-lead@recipient.test");
    // The oldest stamps in the pool, so this test's campaigns are
    // the first ones the tick reaches in each workspace.
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.enrollment.create({
      data: { campaignId: a.campaign.id, leadId: leadA.id, status: "ACTIVE", currentStep: 0, nextSendAt: longAgo },
    });
    await db.enrollment.create({
      data: { campaignId: b.campaign.id, leadId: leadB.id, status: "ACTIVE", currentStep: 0, nextSendAt: longAgo },
    });

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-ceiling" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
      tickSendCeiling: 1,
      hourlyCap: 100000,
    });
    expect(summary.failed).toBe(0);
    const recipients = captured.map((input) => input.toEmail);
    // A ceiling of 1 must still let EACH workspace send its one
    // email in the same tick; the pre-fix global counter let the
    // first workspace consume the whole platform's ceiling.
    expect(recipients).toContain("ceil-a-lead@recipient.test");
    expect(recipients).toContain("ceil-b-lead@recipient.test");
  });

  it("paces the rolling hourly cap per sending domain across workspaces", async () => {
    const wsSender = await seedWorkspace(db, "domain-c");
    const wsOther = await seedWorkspace(db, "domain-d");
    // Workspace C already sent 3 emails this hour from the shared
    // domain, through its own account.
    const accountC = await accountFor(wsSender.workspace.id, "one@sharedmail.test");
    const c = await campaignFor(wsSender.workspace.id, { name: "domain-c", accountId: accountC.id });
    const leadC = await leadFor(wsSender.workspace.id, c.list.id, "domain-c-lead@recipient.test");
    const enrollmentC = await db.enrollment.create({
      data: {
        campaignId: c.campaign.id,
        leadId: leadC.id,
        status: "ACTIVE",
        currentStep: 0,
        nextSendAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    for (let i = 0; i < 3; i += 1) {
      await db.emailEvent.create({
        data: {
          workspaceId: wsSender.workspace.id,
          campaignId: c.campaign.id,
          enrollmentId: enrollmentC.id,
          sendingAccountId: accountC.id,
          type: "SENT",
          providerMessageId: `smtp-seed-${i}`,
          idempotencyKey: `domain-seed-${i}`,
          occurredAt: new Date(Date.now() - 5 * 60_000),
        },
      });
    }
    // Workspace D sends from the SAME domain (its own account) and
    // from a second domain that has sent nothing.
    const accountDShared = await accountFor(wsOther.workspace.id, "two@sharedmail.test");
    const dShared = await campaignFor(wsOther.workspace.id, {
      name: "domain-d-shared",
      accountId: accountDShared.id,
    });
    const leadDShared = await leadFor(wsOther.workspace.id, dShared.list.id, "shared-lead@recipient.test");
    const enrollmentDShared = await db.enrollment.create({
      data: {
        campaignId: dShared.campaign.id,
        leadId: leadDShared.id,
        status: "ACTIVE",
        currentStep: 0,
        nextSendAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    const accountDOther = await accountFor(wsOther.workspace.id, "two@othermail.test");
    const dOther = await campaignFor(wsOther.workspace.id, {
      name: "domain-d-other",
      accountId: accountDOther.id,
    });
    const leadDOther = await leadFor(wsOther.workspace.id, dOther.list.id, "other-lead@recipient.test");
    await db.enrollment.create({
      data: {
        campaignId: dOther.campaign.id,
        leadId: leadDOther.id,
        status: "ACTIVE",
        currentStep: 0,
        nextSendAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-domain" };
      },
    };
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
      tickSendCeiling: 100,
      hourlyCap: 3,
    });
    expect(summary.failed).toBe(0);
    const recipients = captured.map((input) => input.toEmail);
    // The shared domain is at its cap of 3 for the hour across BOTH
    // workspaces, so workspace D's shared-domain send defers even
    // though workspace D itself has sent nothing: the mail host's
    // limit is per domain, not per workspace.
    expect(recipients).not.toContain("shared-lead@recipient.test");
    expect(summary.deferredHourlyCap).toBeGreaterThanOrEqual(1);
    const deferredShared = await db.enrollment.findUnique({ where: { id: enrollmentDShared.id } });
    expect(deferredShared?.status).toBe("ACTIVE");
    // The other domain has its full budget, so its send goes out in
    // the same tick.
    expect(recipients).toContain("other-lead@recipient.test");
  });

  it("honours a workspace's own hourly cap over the platform default (v1.24.0)", async () => {
    // One workspace sets its cap BELOW the platform default
    // because its mail host allows less; another sets it ABOVE
    // because its host allows more. The per-domain hourly count
    // (v1.21.0) is measured against each workspace's own ceiling.
    const wsLow = await seedWorkspace(db, "cap-low");
    await db.workspace.update({ where: { id: wsLow.workspace.id }, data: { hourlySendCap: 2 } });
    const accountLow = await accountFor(wsLow.workspace.id, "one@caplow.test", 100000);
    const low = await campaignFor(wsLow.workspace.id, { name: "cap-low", accountId: accountLow.id });
    const leadLow = await leadFor(wsLow.workspace.id, low.list.id, "low-lead@recipient.test");
    const enrollmentLow = await db.enrollment.create({
      data: {
        campaignId: low.campaign.id,
        leadId: leadLow.id,
        status: "ACTIVE",
        currentStep: 0,
        nextSendAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    for (let i = 0; i < 2; i += 1) {
      await db.emailEvent.create({
        data: {
          workspaceId: wsLow.workspace.id,
          campaignId: low.campaign.id,
          enrollmentId: enrollmentLow.id,
          sendingAccountId: accountLow.id,
          type: "SENT",
          providerMessageId: `cap-low-seed-${i}`,
          idempotencyKey: `cap-low-seed-${i}`,
          occurredAt: new Date(Date.now() - 5 * 60_000),
        },
      });
    }

    const wsHigh = await seedWorkspace(db, "cap-high");
    await db.workspace.update({ where: { id: wsHigh.workspace.id }, data: { hourlySendCap: 500 } });
    const accountHigh = await accountFor(wsHigh.workspace.id, "one@caphigh.test", 100000);
    const high = await campaignFor(wsHigh.workspace.id, { name: "cap-high", accountId: accountHigh.id });
    const leadHigh = await leadFor(wsHigh.workspace.id, high.list.id, "high-lead@recipient.test");
    const enrollmentHigh = await db.enrollment.create({
      data: {
        campaignId: high.campaign.id,
        leadId: leadHigh.id,
        status: "ACTIVE",
        currentStep: 0,
        nextSendAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    // 95 sends in the last hour from this domain: over the
    // platform default of 90, under the workspace's own 500.
    for (let i = 0; i < 95; i += 1) {
      await db.emailEvent.create({
        data: {
          workspaceId: wsHigh.workspace.id,
          campaignId: high.campaign.id,
          enrollmentId: enrollmentHigh.id,
          sendingAccountId: accountHigh.id,
          type: "SENT",
          providerMessageId: `cap-high-seed-${i}`,
          idempotencyKey: `cap-high-seed-${i}`,
          occurredAt: new Date(Date.now() - 5 * 60_000),
        },
      });
    }

    const captured: SendInput[] = [];
    const capturingProvider: MailProvider = {
      id: "capture",
      isSimulation: false,
      send: async (input) => {
        captured.push(input);
        return { providerMessageId: "capture-cap" };
      },
    };
    // No deps.hourlyCap: the platform default (90) applies where a
    // workspace has not set its own.
    const summary = await runSendTick({
      db,
      now: new Date(),
      skipSync: true,
      resolveProvider: async () => capturingProvider,
      tickSendCeiling: 100,
    });
    const recipients = captured.map((input) => input.toEmail);
    // The low workspace is at its own cap of 2 for the hour, so
    // its send defers even though the platform default is 90.
    expect(recipients).not.toContain("low-lead@recipient.test");
    expect(summary.deferredHourlyCap).toBeGreaterThanOrEqual(1);
    const deferredLow = await db.enrollment.findUnique({ where: { id: enrollmentLow.id } });
    expect(deferredLow?.status).toBe("ACTIVE");
    // The high workspace's own cap of 500 covers the 95 already
    // sent, so its send goes out in the same tick.
    expect(recipients).toContain("high-lead@recipient.test");

    // Leave no due enrollments behind for other tests.
    await db.enrollment.updateMany({
      where: { campaignId: { in: [low.campaign.id, high.campaign.id] } },
      data: { status: "COMPLETED", nextSendAt: null },
    });
  });

  it("does not starve a campaign behind another campaign's older-stamped backlog", async () => {
    // Regression (v1.23.0): the due pool used to be fetched as one
    // global oldest-first window of batchLimit * 5 rows. A campaign
    // whose backlog filled that window kept every newer-stamped
    // campaign out of the pool entirely: no sends, no errors, just
    // silence. Production hit this on 2026-11-12, when 1,199
    // older-stamped enrollments from one workspace's backlog sat
    // ahead of another workspace's earliest due item.
    const backlogAccount = await makeAccount(100000, "fair-backlog");
    const starvedAccount = await makeAccount(100, "fair-starved");
    const backlogList = await db.leadList.create({
      data: { workspaceId, name: "List fair-backlog" },
    });
    const backlogCampaign = await makeCampaign({
      suffix: "fair-backlog",
      accountIds: [backlogAccount.id],
      listId: backlogList.id,
    });
    // 101 enrollments stamped two hours ago: more than the old
    // window at this test's batchLimit (20 * 5 = 100), so under the
    // old fetch the starved campaign below never entered the pool.
    // The small batchLimit also keeps this test fast: the tick only
    // processes a 20 item batch instead of hundreds.
    const backlogLeadData: Prisma.LeadCreateManyInput[] = [];
    for (let i = 0; i < 101; i += 1) {
      backlogLeadData.push({
        workspaceId,
        listId: backlogList.id,
        email: `backlog-${i}@example.com`,
        fields: { firstName: "Test", company: "Acme" },
        tags: [],
      });
    }
    await db.lead.createMany({ data: backlogLeadData });
    const backlogLeadRows = await db.lead.findMany({
      where: { listId: backlogList.id },
      select: { id: true },
    });
    expect(backlogLeadRows).toHaveLength(101);
    const oldStamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.enrollment.createMany({
      data: backlogLeadRows.map((lead) => ({
        campaignId: backlogCampaign.id,
        leadId: lead.id,
        status: "ACTIVE" as const,
        currentStep: 0,
        nextSendAt: oldStamp,
      })),
    });

    const { list: starvedList, leads: starvedLeads } = await makeListWithLeads("fair-starved", [
      "starved-1@example.com",
    ]);
    const starvedCampaign = await makeCampaign({
      suffix: "fair-starved",
      accountIds: [starvedAccount.id],
      listId: starvedList.id,
    });
    const starvedEnrollment = await enroll(starvedCampaign.id, starvedLeads[0].id);

    const summary = await runSendTick({ db, now: new Date(), skipSync: true, batchLimit: 20 });
    expect(summary.failed).toBe(0);
    const starvedEvents = await db.emailEvent.findMany({
      where: { campaignId: starvedCampaign.id, type: "SENT" },
    });
    expect(starvedEvents.map((e) => e.idempotencyKey)).toContain(`send:${starvedEnrollment.id}:0`);

    // Leave no due enrollments behind for other tests.
    await db.enrollment.updateMany({
      where: { campaignId: { in: [backlogCampaign.id, starvedCampaign.id] } },
      data: { status: "COMPLETED", nextSendAt: null },
    });
  }, 60_000);

  it("quarantines an enrollment whose schedule cannot be computed instead of failing the tick", async () => {
    // Regression (v1.23.1): the schedule gate let a computation
    // error escape runSendTick, so one bad enrollment killed every
    // tick for the whole platform. In production the trigger was
    // an overnight window the scheduler could not satisfy; here a
    // campaign timezone Intl does not recognise makes the gate
    // throw just as reliably.
    const poisonAccount = await makeAccount(100, "quarantine-poison");
    const healthyAccount = await makeAccount(100, "quarantine-healthy");
    const { list: poisonList, leads: poisonLeads } = await makeListWithLeads("quarantine-poison", [
      "poison-1@example.com",
    ]);
    const poisonCampaign = await makeCampaign({
      suffix: "quarantine-poison",
      accountIds: [poisonAccount.id],
      listId: poisonList.id,
    });
    await db.campaign.update({
      where: { id: poisonCampaign.id },
      data: { timezone: "Not/AZone" },
    });
    const poisonEnrollment = await enroll(poisonCampaign.id, poisonLeads[0].id);

    const { list: healthyList, leads: healthyLeads } = await makeListWithLeads(
      "quarantine-healthy",
      ["healthy-1@example.com"],
    );
    const healthyCampaign = await makeCampaign({
      suffix: "quarantine-healthy",
      accountIds: [healthyAccount.id],
      listId: healthyList.id,
    });
    const healthyEnrollment = await enroll(healthyCampaign.id, healthyLeads[0].id);

    // The tick itself must complete: before the fix this call threw.
    const summary = await runSendTick({ db, now: new Date(), skipSync: true });
    expect(summary.quarantined).toBeGreaterThanOrEqual(1);

    const healthyEvents = await db.emailEvent.findMany({
      where: { campaignId: healthyCampaign.id, type: "SENT" },
    });
    expect(healthyEvents.map((e) => e.idempotencyKey)).toContain(`send:${healthyEnrollment.id}:0`);

    const poisonAfter = await db.enrollment.findUnique({ where: { id: poisonEnrollment.id } });
    expect(poisonAfter?.status).toBe("ACTIVE");
    expect(poisonAfter?.lastError).toContain("Schedule check failed");
    expect(poisonAfter?.nextSendAt).not.toBeNull();
    expect(poisonAfter!.nextSendAt!.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);

    // Leave no due enrollments behind for other tests.
    await db.enrollment.updateMany({
      where: { campaignId: { in: [poisonCampaign.id, healthyCampaign.id] } },
      data: { status: "COMPLETED", nextSendAt: null },
    });
  }, 60_000);
});
