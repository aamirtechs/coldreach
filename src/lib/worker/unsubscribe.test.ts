import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { applyUnsubscribe, createUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

const DB_NAME = "test-unsubscribe";
let db: PrismaClient;
let workspaceId: string;
let leadId: string;
let enrollmentId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "unsub");
  workspaceId = seeded.workspace.id;

  const list = await db.leadList.create({ data: { workspaceId, name: "Unsub list" } });
  const lead = await db.lead.create({
    data: {
      workspaceId,
      listId: list.id,
      email: "optout@example.com",
      fields: {},
      tags: [],
      status: "NEW",
    },
  });
  leadId = lead.id;
  const campaign = await db.campaign.create({
    data: { workspaceId, name: "Unsub campaign", status: "RUNNING", leadListId: list.id },
  });
  const enrollment = await db.enrollment.create({
    data: {
      campaignId: campaign.id,
      leadId: lead.id,
      status: "ACTIVE",
      nextSendAt: new Date(Date.now() + 3600_000),
    },
  });
  enrollmentId = enrollment.id;
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("unsubscribe tokens", () => {
  it("round-trips a token for the right workspace and lead", () => {
    const token = createUnsubscribeToken(workspaceId, leadId);
    expect(verifyUnsubscribeToken(token)).toEqual({ workspaceId, leadId });
  });

  it("round-trips the source campaign id when the token carries one", () => {
    const token = createUnsubscribeToken(workspaceId, leadId, "campaign-123");
    expect(verifyUnsubscribeToken(token)).toEqual({
      workspaceId,
      leadId,
      campaignId: "campaign-123",
    });
  });

  it("rejects tampered and malformed tokens", () => {
    const token = createUnsubscribeToken(workspaceId, leadId);
    const tampered = `${token.slice(0, -2)}xx`;
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    // A token minted for one lead must not verify as another lead.
    const other = createUnsubscribeToken(workspaceId, "someone-else");
    expect(verifyUnsubscribeToken(other)?.leadId).toBe("someone-else");
    expect(verifyUnsubscribeToken(other)?.leadId).not.toBe(leadId);
  });
});

describe("applyUnsubscribe", () => {
  it("marks the lead, writes a suppression, and stops active enrollments", async () => {
    const result = await applyUnsubscribe(db, { workspaceId, leadId });
    expect(result.applied).toBe(true);
    expect(result.stoppedEnrollments).toBe(1);

    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.status).toBe("UNSUBSCRIBED");
    const enrollment = await db.enrollment.findUnique({ where: { id: enrollmentId } });
    expect(enrollment?.status).toBe("UNSUBSCRIBED");
    expect(enrollment?.nextSendAt).toBeNull();
    const suppression = await db.suppression.findFirst({
      where: { workspaceId, email: "optout@example.com" },
    });
    expect(suppression).not.toBeNull();
    expect(
      await db.emailEvent.count({ where: { workspaceId, type: "UNSUBSCRIBED" } }),
    ).toBe(1);
  });

  it("is idempotent on a second application", async () => {
    const result = await applyUnsubscribe(db, { workspaceId, leadId });
    expect(result.applied).toBe(true);
    expect(result.stoppedEnrollments).toBe(0);
    expect(
      await db.suppression.count({ where: { workspaceId, email: "optout@example.com" } }),
    ).toBe(1);
    expect(
      await db.emailEvent.count({ where: { workspaceId, type: "UNSUBSCRIBED" } }),
    ).toBe(1);
  });

  it("does nothing for an unknown lead", async () => {
    const result = await applyUnsubscribe(db, { workspaceId, leadId: "missing" });
    expect(result.applied).toBe(false);
  });
});
