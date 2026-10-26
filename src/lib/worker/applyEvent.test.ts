import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { applyProviderEvent } from "./applyEvent";
import { runSendTick } from "./sendTick";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

const DB_NAME = "test-events";
let db: PrismaClient;
let workspaceId: string;
let enrollmentId: string;
let campaignId: string;
let providerMessageId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "events");
  workspaceId = seeded.workspace.id;

  const account = await db.sendingAccount.create({
    data: {
      workspaceId,
      email: "events-sender@example.com",
      provider: "SIMULATION",
      status: "CONNECTED",
      dailyLimit: 100,
      warmupStatus: "SIMULATED",
    },
  });
  const list = await db.leadList.create({ data: { workspaceId, name: "Events list" } });
  const lead = await db.lead.create({
    data: {
      workspaceId,
      listId: list.id,
      email: "prospect@example.com",
      fields: { firstName: "Pat" },
      tags: [],
      status: "NEW",
    },
  });
  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      name: "Events campaign",
      status: "RUNNING",
      timezone: "UTC",
      windowStart: "00:00",
      windowEnd: "23:59",
      businessDaysOnly: false,
      leadListId: list.id,
    },
  });
  campaignId = campaign.id;
  await db.sequenceStep.create({
    data: { campaignId: campaign.id, order: 0, subject: "One", body: "First" },
  });
  await db.sequenceStep.create({
    data: { campaignId: campaign.id, order: 1, delayDays: 1, subject: "Two", body: "Second" },
  });
  await db.campaignAccount.create({
    data: { campaignId: campaign.id, sendingAccountId: account.id },
  });
  const enrollment = await db.enrollment.create({
    data: {
      campaignId: campaign.id,
      leadId: lead.id,
      status: "ACTIVE",
      currentStep: 0,
      nextSendAt: new Date(Date.now() - 60_000),
    },
  });
  enrollmentId = enrollment.id;

  const summary = await runSendTick({ db, now: new Date() });
  expect(summary.sent).toBe(1);
  const sent = await db.emailEvent.findFirst({
    where: { campaignId: campaign.id, type: "SENT" },
  });
  providerMessageId = sent?.providerMessageId ?? "";
  expect(providerMessageId).not.toBe("");
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("applyProviderEvent", () => {
  it("stops the sequence when a REPLIED event arrives via providerMessageId", async () => {
    const result = await applyProviderEvent(db, {
      providerMessageId,
      type: "REPLIED",
      classification: "POSITIVE",
    });
    expect(result.applied).toBe(true);
    const enrollment = await db.enrollment.findUnique({ where: { id: enrollmentId } });
    expect(enrollment?.status).toBe("REPLIED");
    expect(enrollment?.nextSendAt).toBeNull();

    // Even with the enrollment forced due, the worker must not send:
    // the enrollment is no longer ACTIVE.
    await db.enrollment.update({
      where: { id: enrollmentId },
      data: { nextSendAt: new Date(Date.now() - 1000) },
    });
    const tick = await runSendTick({ db, now: new Date() });
    expect(tick.sent).toBe(0);
    expect(await db.emailEvent.count({ where: { campaignId, type: "SENT" } })).toBe(1);
  });

  it("is idempotent: the same event never applies twice", async () => {
    const result = await applyProviderEvent(db, {
      providerMessageId,
      type: "REPLIED",
      classification: "POSITIVE",
    });
    expect(result.applied).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(
      await db.emailEvent.count({
        where: { campaignId, type: "REPLIED", idempotencyKey: `evt:pmid:${providerMessageId}:REPLIED` },
      }),
    ).toBe(1);
  });

  it("applies enrollmentId plus stepIndex events and deduplicates them", async () => {
    const first = await applyProviderEvent(db, {
      enrollmentId,
      stepIndex: 0,
      type: "DELIVERED",
    });
    expect(first.applied).toBe(true);
    const second = await applyProviderEvent(db, {
      enrollmentId,
      stepIndex: 0,
      type: "DELIVERED",
    });
    expect(second.duplicate).toBe(true);
    expect(await db.emailEvent.count({ where: { campaignId, type: "DELIVERED" } })).toBe(1);
  });

  it("suppresses the address and stops everything on a hard bounce", async () => {
    const lead = await db.lead.create({
      data: {
        workspaceId,
        email: "bounce@example.com",
        fields: {},
        tags: [],
        status: "NEW",
      },
    });
    const enrollment = await db.enrollment.create({
      data: { campaignId, leadId: lead.id, status: "ACTIVE", currentStep: 0 },
    });
    const result = await applyProviderEvent(db, {
      enrollmentId: enrollment.id,
      stepIndex: 0,
      type: "BOUNCED",
    });
    expect(result.applied).toBe(true);
    const afterEnrollment = await db.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(afterEnrollment?.status).toBe("BOUNCED");
    const afterLead = await db.lead.findUnique({ where: { id: lead.id } });
    expect(afterLead?.status).toBe("BOUNCED");
    const suppression = await db.suppression.findFirst({
      where: { workspaceId, email: "bounce@example.com" },
    });
    expect(suppression).not.toBeNull();
  });

  it("rejects events that resolve to nothing", async () => {
    await expect(
      applyProviderEvent(db, { providerMessageId: "does-not-exist", type: "DELIVERED" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("applyProviderEvent variant attribution", () => {
  it("copies the SENT event's variant onto downstream events", async () => {
    await db.emailEvent.updateMany({
      where: { campaignId, type: "SENT" },
      data: { variant: "B" },
    });
    const result = await applyProviderEvent(db, {
      providerMessageId,
      type: "DELIVERED",
    });
    expect(result.applied).toBe(true);
    const delivered = await db.emailEvent.findFirst({
      where: { idempotencyKey: `evt:pmid:${providerMessageId}:DELIVERED` },
    });
    expect(delivered?.variant).toBe("B");
  });

  it("leaves the variant null when the send had none", async () => {
    await db.emailEvent.updateMany({
      where: { campaignId, type: "DELIVERED" },
      data: { variant: null },
    });
    await db.emailEvent.deleteMany({ where: { campaignId, type: "BOUNCED" } });
    await db.emailEvent.updateMany({
      where: { campaignId, type: "SENT" },
      data: { variant: null },
    });
    const result = await applyProviderEvent(db, {
      providerMessageId,
      type: "BOUNCED",
    });
    expect(result.applied).toBe(true);
    const bounced = await db.emailEvent.findFirst({
      where: { idempotencyKey: `evt:pmid:${providerMessageId}:BOUNCED` },
    });
    expect(bounced?.variant).toBeNull();
  });
});
