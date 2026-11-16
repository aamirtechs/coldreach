import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CampaignStatus, PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { bulkDeleteCampaigns } from "./bulkDelete";

const DB_NAME = "bulk-delete-campaigns-test.db";

let db: PrismaClient;
let workspaceId: string;
let otherWorkspaceId: string;
let draftId: string;
let pausedId: string;
let runningId: string;
let scheduledId: string;
let otherRunningId: string;
let leadId: string;

async function makeCampaign(wsId: string, name: string, status: CampaignStatus) {
  return db.campaign.create({
    data: {
      workspaceId: wsId,
      name,
      status,
      timezone: "UTC",
      windowStart: "00:00",
      windowEnd: "23:59",
      businessDaysOnly: false,
    },
  });
}

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seed = await seedWorkspace(db, "bulkdel");
  workspaceId = seed.workspace.id;
  const other = await seedWorkspace(db, "bulkdel-other");
  otherWorkspaceId = other.workspace.id;

  draftId = (await makeCampaign(workspaceId, "draft-one", "DRAFT")).id;
  pausedId = (await makeCampaign(workspaceId, "paused-one", "PAUSED")).id;
  runningId = (await makeCampaign(workspaceId, "running-one", "RUNNING")).id;
  scheduledId = (await makeCampaign(workspaceId, "scheduled-one", "SCHEDULED")).id;
  otherRunningId = (await makeCampaign(otherWorkspaceId, "other-draft", "DRAFT")).id;

  const lead = await db.lead.create({
    data: { workspaceId, email: "person@example.com", fields: {}, tags: [] },
  });
  leadId = lead.id;
  await db.enrollment.create({ data: { campaignId: draftId, leadId } });
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("bulkDeleteCampaigns", () => {
  it("deletes the selected non-running campaigns and reports the rest", async () => {
    const result = await bulkDeleteCampaigns(db, workspaceId, [
      draftId,
      pausedId,
      runningId,
      otherRunningId,
      "missing-id",
      draftId,
    ]);
    expect(result.deletedCount).toBe(2);
    expect(result.deletedIds.sort()).toEqual([draftId, pausedId].sort());
    expect(result.skippedRunning).toEqual([{ id: runningId, name: "running-one" }]);
    // The other workspace's campaign and the unknown id both count as
    // not found; neither is deleted.
    expect(result.notFoundCount).toBe(2);

    const remaining = await db.campaign.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    expect(remaining.map((row) => row.id).sort()).toEqual([runningId, scheduledId].sort());
    await expect(
      db.campaign.findUnique({ where: { id: otherRunningId } }),
    ).resolves.not.toBeNull();
  });

  it("cascades enrollments but never deletes leads", async () => {
    await expect(db.enrollment.count({ where: { campaignId: draftId } })).resolves.toBe(0);
    await expect(db.lead.findUnique({ where: { id: leadId } })).resolves.not.toBeNull();
  });

  it("is a no-op for an empty selection", async () => {
    await expect(bulkDeleteCampaigns(db, workspaceId, [])).resolves.toEqual({
      deletedCount: 0,
      deletedIds: [],
      skippedRunning: [],
      notFoundCount: 0,
    });
  });
});
