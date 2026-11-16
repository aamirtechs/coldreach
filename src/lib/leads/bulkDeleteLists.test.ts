import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { bulkDeleteLeadLists } from "./bulkDeleteLists";

const DB_NAME = "bulk-delete-lists-test.db";

let db: PrismaClient;
let workspaceId: string;
let otherWorkspaceId: string;
let listAId: string;
let listBId: string;
let otherListId: string;
let campaignId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seed = await seedWorkspace(db, "bulkdel-lists");
  workspaceId = seed.workspace.id;
  const other = await seedWorkspace(db, "bulkdel-lists-other");
  otherWorkspaceId = other.workspace.id;

  listAId = (await db.leadList.create({ data: { workspaceId, name: "List A" } })).id;
  listBId = (await db.leadList.create({ data: { workspaceId, name: "List B" } })).id;
  otherListId = (
    await db.leadList.create({ data: { workspaceId: otherWorkspaceId, name: "Other list" } })
  ).id;

  await db.lead.create({
    data: { workspaceId, listId: listAId, email: "one@example.com", fields: {}, tags: [] },
  });
  await db.lead.create({
    data: { workspaceId, listId: listAId, email: "two@example.com", fields: {}, tags: [] },
  });
  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      name: "attached-campaign",
      status: "DRAFT",
      timezone: "UTC",
      windowStart: "00:00",
      windowEnd: "23:59",
      businessDaysOnly: false,
      leadListId: listAId,
    },
  });
  campaignId = campaign.id;
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("bulkDeleteLeadLists", () => {
  it("deletes the selected lists of this workspace only", async () => {
    const result = await bulkDeleteLeadLists(db, workspaceId, [
      listAId,
      otherListId,
      "missing-id",
      listAId,
    ]);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedIds).toEqual([listAId]);
    expect(result.notFoundCount).toBe(2);

    await expect(db.leadList.findUnique({ where: { id: listAId } })).resolves.toBeNull();
    await expect(db.leadList.findUnique({ where: { id: listBId } })).resolves.not.toBeNull();
    await expect(db.leadList.findUnique({ where: { id: otherListId } })).resolves.not.toBeNull();
  });

  it("keeps the leads, unlisted, and detaches campaigns", async () => {
    const leads = await db.lead.findMany({ where: { workspaceId }, select: { listId: true } });
    expect(leads).toHaveLength(2);
    expect(leads.every((lead) => lead.listId === null)).toBe(true);
    const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.leadListId).toBeNull();
  });

  it("is a no-op for an empty selection", async () => {
    await expect(bulkDeleteLeadLists(db, workspaceId, [])).resolves.toEqual({
      deletedCount: 0,
      deletedIds: [],
      notFoundCount: 0,
    });
  });
});
