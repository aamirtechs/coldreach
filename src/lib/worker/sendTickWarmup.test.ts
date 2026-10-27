import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runSendTick } from "./sendTick";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

/**
 * Phase 6 warm-up integration: the worker's capacity gate applies
 * min(age ramp, warm-up cap). Both accounts here are backdated 30
 * days so the age ramp is fully lifted; only the warm-up-enabled
 * account may be throttled, to the week 1 cap of 20 sends, even
 * with 25 due enrollments and a configured daily limit of 500.
 */
const DB_NAME = "test-sendtick-warmup";
let db: PrismaClient;
let workspaceId: string;

const past = () => new Date(Date.now() - 60_000);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

async function makeAccount(suffix: string, warmup: boolean) {
  return db.sendingAccount.create({
    data: {
      workspaceId,
      email: `warm-${suffix}@example.com`,
      displayName: "Sender",
      provider: "SIMULATION",
      status: "CONNECTED",
      dailyLimit: 500,
      warmupStatus: "SIMULATED",
      warmupEnabled: warmup,
      warmupStartedAt: warmup ? daysAgo(2) : null,
      createdAt: daysAgo(30),
    },
  });
}

async function makeCampaignWithEnrollments(suffix: string, accountId: string, count: number) {
  const list = await db.leadList.create({ data: { workspaceId, name: `List ${suffix}` } });
  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      name: `Campaign ${suffix}`,
      status: "RUNNING",
      timezone: "UTC",
      windowStart: "00:00",
      windowEnd: "23:59",
      businessDaysOnly: false,
      leadListId: list.id,
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
  await db.campaignAccount.create({ data: { campaignId: campaign.id, sendingAccountId: accountId } });
  for (let i = 0; i < count; i += 1) {
    const lead = await db.lead.create({
      data: {
        workspaceId,
        listId: list.id,
        email: `${suffix}-${i}@example.com`,
        fields: { firstName: "Test", company: "Acme" },
        tags: [],
        status: "NEW",
      },
    });
    await db.enrollment.create({
      data: { campaignId: campaign.id, leadId: lead.id, status: "ACTIVE", currentStep: 0, nextSendAt: past() },
    });
  }
  return campaign;
}

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "warmup");
  workspaceId = seeded.workspace.id;
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("runSendTick with warm-up enabled", () => {
  it("caps a day-3 warm-up account at 20 sends while an identical account without warm-up sends all 25", async () => {
    const warmed = await makeAccount("on", true);
    const plain = await makeAccount("off", false);
    const warmedCampaign = await makeCampaignWithEnrollments("warmed", warmed.id, 25);
    const plainCampaign = await makeCampaignWithEnrollments("plain", plain.id, 25);

    const summary = await runSendTick({ db, now: new Date() });
    expect(summary.failed).toBe(0);
    expect(summary.sent).toBe(45);

    const warmedSent = await db.emailEvent.count({
      where: { campaignId: warmedCampaign.id, type: "SENT" },
    });
    const plainSent = await db.emailEvent.count({
      where: { campaignId: plainCampaign.id, type: "SENT" },
    });
    expect(warmedSent).toBe(20);
    expect(plainSent).toBe(25);

    // The 5 throttled enrollments stay ACTIVE and due for a later tick.
    const remaining = await db.enrollment.count({
      where: { campaignId: warmedCampaign.id, status: "ACTIVE" },
    });
    expect(remaining).toBe(5);
  });
});
