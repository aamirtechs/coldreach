import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { deleteOrphanLeads, summarizeOrphanLeads } from "./orphanLeads";

const DB_NAME = "orphan-leads-test.db";

let db: PrismaClient;
let workspaceId: string;
let otherWorkspaceId: string;
let orphanId: string;
let unlistedEnrolledId: string;
let listedId: string;
let listedEnrolledId: string;
let otherOrphanId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seed = await seedWorkspace(db, "orphans");
  workspaceId = seed.workspace.id;
  const other = await seedWorkspace(db, "orphans-other");
  otherWorkspaceId = other.workspace.id;

  const list = await db.leadList.create({ data: { workspaceId, name: "Kept list" } });
  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      name: "orphan-test-campaign",
      status: "PAUSED",
      timezone: "UTC",
      windowStart: "00:00",
      windowEnd: "23:59",
      businessDaysOnly: false,
    },
  });

  const lead = (data: { listId?: string | null; email: string; ws?: string }) =>
    db.lead.create({
      data: {
        workspaceId: data.ws ?? workspaceId,
        listId: data.listId ?? null,
        email: data.email,
        fields: {},
        tags: [],
      },
    });

  orphanId = (await lead({ email: "orphan@example.com" })).id;
  unlistedEnrolledId = (await lead({ email: "unlisted-enrolled@example.com" })).id;
  listedId = (await lead({ listId: list.id, email: "listed@example.com" })).id;
  listedEnrolledId = (await lead({ listId: list.id, email: "listed-enrolled@example.com" })).id;
  otherOrphanId = (await lead({ email: "other-orphan@example.com", ws: otherWorkspaceId })).id;

  await db.enrollment.create({ data: { campaignId: campaign.id, leadId: unlistedEnrolledId } });
  await db.enrollment.create({ data: { campaignId: campaign.id, leadId: listedEnrolledId } });
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("orphanLeads", () => {
  it("counts only unlisted, unenrolled leads as orphans", async () => {
    const summary = await summarizeOrphanLeads(db, workspaceId);
    expect(summary.orphanCount).toBe(1);
    expect(summary.unlistedEnrolledCount).toBe(1);
  });

  it("deletes only this workspace's orphans", async () => {
    const result = await deleteOrphanLeads(db, workspaceId);
    expect(result.deletedCount).toBe(1);

    const remainingIds = (
      await db.lead.findMany({ where: { workspaceId }, select: { id: true } })
    ).map((row) => row.id);
    expect(remainingIds).not.toContain(orphanId);
    expect(remainingIds).toContain(unlistedEnrolledId);
    expect(remainingIds).toContain(listedId);
    expect(remainingIds).toContain(listedEnrolledId);

    const otherLead = await db.lead.findUnique({ where: { id: otherOrphanId } });
    expect(otherLead).not.toBeNull();
  });

  it("is a no-op once the orphans are gone", async () => {
    const summary = await summarizeOrphanLeads(db, workspaceId);
    expect(summary.orphanCount).toBe(0);
    expect(summary.unlistedEnrolledCount).toBe(1);
    const result = await deleteOrphanLeads(db, workspaceId);
    expect(result.deletedCount).toBe(0);
  });
});
