import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createOpenToken, isMachineOpen, recordOpen, verifyOpenToken } from "./openTracking";
import { createUnsubscribeToken } from "./unsubscribe";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

const DB_NAME = "test-open-tracking";
let db: PrismaClient;
let workspaceId: string;
let campaignId: string;
let enrollmentId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "open");
  workspaceId = seeded.workspace.id;

  const list = await db.leadList.create({ data: { workspaceId, name: "Open list" } });
  const lead = await db.lead.create({
    data: {
      workspaceId,
      listId: list.id,
      email: "reader@example.com",
      fields: {},
      tags: [],
      status: "NEW",
    },
  });
  const campaign = await db.campaign.create({
    data: { workspaceId, name: "Open campaign", status: "RUNNING", leadListId: list.id },
  });
  campaignId = campaign.id;
  const enrollment = await db.enrollment.create({
    data: {
      campaignId: campaign.id,
      leadId: lead.id,
      status: "ACTIVE",
      currentStep: 1,
      nextSendAt: null,
    },
  });
  enrollmentId = enrollment.id;
  await db.emailEvent.create({
    data: {
      workspaceId,
      campaignId: campaign.id,
      enrollmentId: enrollment.id,
      type: "SENT",
      idempotencyKey: `sent:${enrollment.id}:0`,
      variant: "A",
      occurredAt: new Date(),
    },
  });
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

/** Creates a fresh enrollment in the seeded campaign with one SENT
 *  event for step 0 keyed the way the worker keys it, at the given
 *  send time. Returns the enrollment id. */
async function seedEnrollmentWithSend(sentAt: Date): Promise<string> {
  const lead = await db.lead.create({
    data: {
      workspaceId,
      listId: (await db.leadList.findFirstOrThrow({ where: { workspaceId } })).id,
      email: `reader-${Math.random().toString(36).slice(2)}@example.com`,
      fields: {},
      tags: [],
      status: "NEW",
    },
  });
  const enrollment = await db.enrollment.create({
    data: { campaignId, leadId: lead.id, status: "ACTIVE", currentStep: 1, nextSendAt: null },
  });
  await db.emailEvent.create({
    data: {
      workspaceId,
      campaignId,
      enrollmentId: enrollment.id,
      type: "SENT",
      idempotencyKey: `send:${enrollment.id}:0`,
      occurredAt: sentAt,
    },
  });
  return enrollment.id;
}

describe("isMachineOpen", () => {
  const sentAt = new Date("2026-11-06T10:00:00.000Z");
  it("treats opens inside the 60 second window as machine", () => {
    expect(isMachineOpen(sentAt, new Date(sentAt.getTime()))).toBe(true);
    expect(isMachineOpen(sentAt, new Date(sentAt.getTime() + 30_000))).toBe(true);
    expect(isMachineOpen(sentAt, new Date(sentAt.getTime() + 60_000))).toBe(true);
  });
  it("treats later opens, and opens before the send, as human", () => {
    expect(isMachineOpen(sentAt, new Date(sentAt.getTime() + 60_001))).toBe(false);
    expect(isMachineOpen(sentAt, new Date(sentAt.getTime() + 10 * 60_000))).toBe(false);
    expect(isMachineOpen(sentAt, new Date(sentAt.getTime() - 1_000))).toBe(false);
  });
});

describe("open tokens", () => {
  it("round-trips workspace, enrollment and step", () => {
    const token = createOpenToken(workspaceId, enrollmentId, 0);
    expect(verifyOpenToken(token)).toEqual({ workspaceId, enrollmentId, stepIndex: 0 });
  });

  it("rejects a tampered token", () => {
    const token = createOpenToken(workspaceId, enrollmentId, 0);
    const [payload, signature] = token.split(".");
    const flipped = `${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    expect(verifyOpenToken(flipped)).toBeNull();
    expect(verifyOpenToken("not-a-token")).toBeNull();
    expect(verifyOpenToken("")).toBeNull();
  });

  it("never accepts an unsubscribe token as an open token", () => {
    const unsub = createUnsubscribeToken(workspaceId, enrollmentId);
    expect(verifyOpenToken(unsub)).toBeNull();
  });
});

describe("recordOpen", () => {
  it("records one OPENED event with the send's attribution, then dedupes", async () => {
    const claims = { workspaceId, enrollmentId, stepIndex: 0 };
    const first = await recordOpen(db, claims);
    expect(first).toEqual({ recorded: true, duplicate: false });

    const event = await db.emailEvent.findFirst({
      where: { enrollmentId, type: "OPENED" },
    });
    expect(event?.workspaceId).toBe(workspaceId);
    expect(event?.campaignId).toBe(campaignId);
    expect(event?.variant).toBe("A");
    expect(event?.idempotencyKey).toBe(`evt:${enrollmentId}:0:OPENED`);

    const second = await recordOpen(db, claims);
    expect(second).toEqual({ recorded: false, duplicate: true });
    const count = await db.emailEvent.count({ where: { enrollmentId, type: "OPENED" } });
    expect(count).toBe(1);
  });

  it("tracks different steps separately", async () => {
    const result = await recordOpen(db, { workspaceId, enrollmentId, stepIndex: 1 });
    expect(result.recorded).toBe(true);
    const count = await db.emailEvent.count({ where: { enrollmentId, type: "OPENED" } });
    expect(count).toBe(2);
  });

  it("classifies an open within a minute of the step's send as MACHINE", async () => {
    const enrollment = await seedEnrollmentWithSend(new Date());
    const result = await recordOpen(db, { workspaceId, enrollmentId: enrollment, stepIndex: 0 });
    expect(result.recorded).toBe(true);
    const event = await db.emailEvent.findFirst({
      where: { enrollmentId: enrollment, type: "OPENED" },
    });
    expect(event?.classification).toBe("MACHINE");
  });

  it("leaves an open well after the send unclassified (human)", async () => {
    const enrollment = await seedEnrollmentWithSend(new Date(Date.now() - 10 * 60_000));
    const result = await recordOpen(db, { workspaceId, enrollmentId: enrollment, stepIndex: 0 });
    expect(result.recorded).toBe(true);
    const event = await db.emailEvent.findFirst({
      where: { enrollmentId: enrollment, type: "OPENED" },
    });
    expect(event?.classification).toBeNull();
  });

  it("records nothing for an unknown enrollment or a foreign workspace", async () => {
    const unknown = await recordOpen(db, {
      workspaceId,
      enrollmentId: "no-such-enrollment",
      stepIndex: 0,
    });
    expect(unknown.recorded).toBe(false);
    const foreign = await recordOpen(db, {
      workspaceId: "another-workspace",
      enrollmentId,
      stepIndex: 5,
    });
    expect(foreign.recorded).toBe(false);
  });
});
