import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { getSendingSchedule } from "./sendingSchedule";

const DB_NAME = "test-sending-schedule";
const NOW = new Date("2026-10-28T12:00:00Z");
let db: PrismaClient;
let workspaceId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "sched");
  workspaceId = seeded.workspace.id;

  const account = await db.sendingAccount.create({
    data: {
      workspaceId,
      email: "sender@example.test",
      provider: "SMTP",
      status: "CONNECTED",
      dailyLimit: 50,
      createdAt: new Date("2026-10-27T12:00:00Z"),
    },
  });
  await db.sendingAccount.create({
    data: {
      workspaceId,
      email: "paused@example.test",
      provider: "SMTP",
      status: "PAUSED",
      dailyLimit: 50,
      createdAt: new Date("2026-10-27T12:00:00Z"),
    },
  });

  const campaign = await db.campaign.create({
    data: { workspaceId, name: "Operations Management", status: "RUNNING", timezone: "UTC" },
  });
  const pausedCampaign = await db.campaign.create({
    data: { workspaceId, name: "Paused Campaign", status: "PAUSED", timezone: "UTC" },
  });

  const leadTx = await db.lead.create({
    data: {
      workspaceId,
      email: "tx@example.test",
      fields: { company: "Acme Hauling", country: "United States", state: "TX" },
      tags: [],
    },
  });
  const leadPlain = await db.lead.create({
    data: { workspaceId, email: "plain@example.test", fields: {}, tags: [] },
  });

  // Due already (11:00, before NOW), step 2, Texas lead.
  await db.enrollment.create({
    data: {
      campaignId: campaign.id,
      leadId: leadTx.id,
      status: "ACTIVE",
      currentStep: 1,
      nextSendAt: new Date("2026-10-28T11:00:00Z"),
    },
  });
  // Due later today (13:00), step 1, no fields: campaign timezone.
  await db.enrollment.create({
    data: {
      campaignId: campaign.id,
      leadId: leadPlain.id,
      status: "ACTIVE",
      currentStep: 0,
      nextSendAt: new Date("2026-10-28T13:00:00Z"),
    },
  });
  // Earliest of all but on a paused campaign: never listed.
  await db.enrollment.create({
    data: {
      campaignId: pausedCampaign.id,
      leadId: leadPlain.id,
      status: "ACTIVE",
      currentStep: 0,
      nextSendAt: new Date("2026-10-28T09:00:00Z"),
    },
  });
  // No stamp: never listed. (A lead enrolls in a campaign only once,
  // so this needs its own lead.)
  const leadUnstamped = await db.lead.create({
    data: { workspaceId, email: "unstamped@example.test", fields: {}, tags: [] },
  });
  await db.enrollment.create({
    data: { campaignId: campaign.id, leadId: leadUnstamped.id, status: "ACTIVE", nextSendAt: null },
  });

  const sent = (occurredAt: string, key: string, type: "SENT" | "FAILED" = "SENT") =>
    db.emailEvent.create({
      data: {
        workspaceId,
        campaignId: campaign.id,
        sendingAccountId: account.id,
        type,
        idempotencyKey: key,
        occurredAt: new Date(occurredAt),
      },
    });
  await sent("2026-10-27T10:00:00Z", "sched-yesterday");
  await sent("2026-10-28T08:00:00Z", "sched-today");
  await sent("2026-10-28T09:00:00Z", "sched-failed", "FAILED");
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("getSendingSchedule", () => {
  it("reports the last send and today's count from SENT events only", async () => {
    const schedule = await getSendingSchedule(db, workspaceId, NOW);
    expect(schedule.lastSentAt?.toISOString()).toBe("2026-10-28T08:00:00.000Z");
    expect(schedule.sentToday).toBe(1);
  });

  it("sums effective capacity over eligible accounts with the worker's limit math", async () => {
    const schedule = await getSendingSchedule(db, workspaceId, NOW);
    // One connected account, age 1 day: ramp floor(50 * (20 + 80/14) / 100) = 12.
    // The paused account is excluded entirely.
    expect(schedule.capacity).toEqual({ used: 1, cap: 12, accounts: 1 });
  });

  it("lists upcoming sends soonest first, running campaigns only, with lead timezones", async () => {
    const schedule = await getSendingSchedule(db, workspaceId, NOW);
    expect(schedule.upcoming).toHaveLength(2);
    const [first, second] = schedule.upcoming;
    expect(first.leadEmail).toBe("tx@example.test");
    expect(first.company).toBe("Acme Hauling");
    expect(first.stepNumber).toBe(2);
    expect(first.timezone).toBe("America/Chicago");
    expect(first.due).toBe(true);
    expect(second.leadEmail).toBe("plain@example.test");
    expect(second.stepNumber).toBe(1);
    expect(second.timezone).toBe("UTC");
    expect(second.due).toBe(false);
  });

  it("returns an empty schedule for a fresh workspace", async () => {
    const other = await seedWorkspace(db, "sched-empty");
    const schedule = await getSendingSchedule(db, other.workspace.id, NOW);
    expect(schedule.lastSentAt).toBeNull();
    expect(schedule.sentToday).toBe(0);
    expect(schedule.capacity).toEqual({ used: 0, cap: 0, accounts: 0 });
    expect(schedule.upcoming).toEqual([]);
  });
});
