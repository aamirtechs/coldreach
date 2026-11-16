import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runSendTick } from "./sendTick";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

/**
 * Per-campaign daily send cap (v1.39.0): a campaign with
 * dailySendCap set sends at most that many emails per UTC day.
 * Enrollments past the cap are deferred untouched, still due with
 * their original stamp, and the cap is counted per campaign from
 * the day's real SENT events, including ones from earlier ticks.
 */
const DB_NAME = "test-sendtick-campaign-cap";
let db: PrismaClient;
let workspaceId: string;

const past = () => new Date(Date.now() - 60_000);

async function makeAccount(suffix: string) {
  return db.sendingAccount.create({
    data: {
      workspaceId,
      email: `cap-${suffix}@example.com`,
      displayName: "Sender",
      provider: "SIMULATION",
      status: "CONNECTED",
      dailyLimit: 100,
      warmupStatus: "SIMULATED",
    },
  });
}

async function makeCampaign(args: {
  suffix: string;
  accountIds: string[];
  dailySendCap: number | null;
  leadCount: number;
}) {
  const list = await db.leadList.create({ data: { workspaceId, name: `List ${args.suffix}` } });
  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      name: `Campaign ${args.suffix}`,
      status: "RUNNING",
      timezone: "UTC",
      windowStart: "00:00",
      windowEnd: "23:59",
      businessDaysOnly: false,
      leadListId: list.id,
      dailySendCap: args.dailySendCap,
    },
  });
  await db.sequenceStep.create({
    data: {
      campaignId: campaign.id,
      order: 0,
      delayDays: 0,
      delayHours: 0,
      subject: "Hello {{firstName|there}}",
      body: "Body for {{company}}",
    },
  });
  for (const accountId of args.accountIds) {
    await db.campaignAccount.create({ data: { campaignId: campaign.id, sendingAccountId: accountId } });
  }
  const enrollments = [];
  for (let i = 0; i < args.leadCount; i += 1) {
    const lead = await db.lead.create({
      data: {
        workspaceId,
        listId: list.id,
        email: `${args.suffix}-${i}@example.com`,
        fields: { firstName: "Test", company: "Acme" },
        tags: [],
        status: "NEW",
      },
    });
    enrollments.push(
      await db.enrollment.create({
        data: { campaignId: campaign.id, leadId: lead.id, status: "ACTIVE", currentStep: 0, nextSendAt: past() },
      }),
    );
  }
  return { campaign, enrollments };
}

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "campaigncap");
  workspaceId = seeded.workspace.id;
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

// The tick is platform-wide and every test in this file shares one
// workspace, so a deferred enrollment from an earlier test would be
// picked up by the next test's tick and pollute its summary counts.
// Close out any still-active enrollments before each test so every
// tick sees only that test's own due pool.
beforeEach(async () => {
  await db.enrollment.updateMany({
    where: { campaign: { workspaceId }, status: "ACTIVE" },
    data: { status: "COMPLETED", nextSendAt: null },
  });
});

describe("per-campaign daily send cap", () => {
  it("sends up to the cap and defers the rest, still due with the original stamp", async () => {
    const account = await makeAccount("basic");
    const { campaign, enrollments } = await makeCampaign({
      suffix: "basic",
      accountIds: [account.id],
      dailySendCap: 2,
      leadCount: 3,
    });

    const summary = await runSendTick({ db, now: new Date() });
    expect(summary.sent).toBe(2);
    expect(summary.deferredCampaignCap).toBe(1);
    expect(await db.emailEvent.count({ where: { campaignId: campaign.id, type: "SENT" } })).toBe(2);

    const states = await Promise.all(
      enrollments.map((enrollment) => db.enrollment.findUnique({ where: { id: enrollment.id } })),
    );
    const stillDue = states.filter((state) => state?.status === "ACTIVE" && state.currentStep === 0);
    expect(stillDue).toHaveLength(1);
    // The deferred enrollment kept its original (past) stamp: the
    // cap never re-stamps or error-marks the lead.
    expect(stillDue[0]?.nextSendAt?.getTime()).toBeLessThan(Date.now());
    expect(stillDue[0]?.lastError).toBeNull();
  });

  it("counts sends already recorded today toward the cap", async () => {
    const account = await makeAccount("seeded");
    const { campaign } = await makeCampaign({
      suffix: "seeded",
      accountIds: [account.id],
      dailySendCap: 2,
      leadCount: 2,
    });
    await db.emailEvent.create({
      data: {
        workspaceId,
        campaignId: campaign.id,
        type: "SENT",
        idempotencyKey: `seed:${campaign.id}:earlier-tick`,
        occurredAt: new Date(),
      },
    });

    const summary = await runSendTick({ db, now: new Date() });
    expect(summary.sent).toBe(1);
    expect(summary.deferredCampaignCap).toBe(1);
  });

  it("a campaign with no cap sends everything due", async () => {
    const account = await makeAccount("uncapped");
    const { campaign } = await makeCampaign({
      suffix: "uncapped",
      accountIds: [account.id],
      dailySendCap: null,
      leadCount: 3,
    });

    const summary = await runSendTick({ db, now: new Date() });
    expect(summary.sent).toBe(3);
    expect(summary.deferredCampaignCap).toBe(0);
    expect(await db.emailEvent.count({ where: { campaignId: campaign.id, type: "SENT" } })).toBe(3);
  });

  it("the cap is per campaign: a capped campaign does not block an uncapped one sharing its account", async () => {
    const account = await makeAccount("shared");
    const capped = await makeCampaign({
      suffix: "shared-capped",
      accountIds: [account.id],
      dailySendCap: 1,
      leadCount: 2,
    });
    const open = await makeCampaign({
      suffix: "shared-open",
      accountIds: [account.id],
      dailySendCap: null,
      leadCount: 1,
    });

    const summary = await runSendTick({ db, now: new Date() });
    expect(summary.sent).toBe(2);
    expect(summary.deferredCampaignCap).toBe(1);
    expect(await db.emailEvent.count({ where: { campaignId: capped.campaign.id, type: "SENT" } })).toBe(1);
    expect(await db.emailEvent.count({ where: { campaignId: open.campaign.id, type: "SENT" } })).toBe(1);
  });
});
