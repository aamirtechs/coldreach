import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CampaignStatus, PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { pauseAllCampaigns } from "./pauseAll";

const DB_NAME = "pause-all-test.db";

let db: PrismaClient;
let workspaceId: string;
let otherWorkspaceId: string;

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

async function statuses(wsId: string): Promise<Record<string, string>> {
  const rows = await db.campaign.findMany({
    where: { workspaceId: wsId },
    select: { name: true, status: true },
  });
  return Object.fromEntries(rows.map((row) => [row.name, row.status]));
}

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seed = await seedWorkspace(db, "pauseall");
  workspaceId = seed.workspace.id;
  const other = await seedWorkspace(db, "pauseall-other");
  otherWorkspaceId = other.workspace.id;

  await makeCampaign(workspaceId, "running-one", "RUNNING");
  await makeCampaign(workspaceId, "running-two", "RUNNING");
  await makeCampaign(workspaceId, "scheduled-one", "SCHEDULED");
  await makeCampaign(workspaceId, "draft-one", "DRAFT");
  await makeCampaign(workspaceId, "paused-one", "PAUSED");
  await makeCampaign(workspaceId, "archived-one", "ARCHIVED");
  await makeCampaign(otherWorkspaceId, "other-running", "RUNNING");
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("pauseAllCampaigns", () => {
  it("pauses RUNNING and SCHEDULED campaigns and reports the count", async () => {
    await expect(pauseAllCampaigns(db, workspaceId)).resolves.toBe(3);
    await expect(statuses(workspaceId)).resolves.toEqual({
      "running-one": "PAUSED",
      "running-two": "PAUSED",
      "scheduled-one": "PAUSED",
      "draft-one": "DRAFT",
      "paused-one": "PAUSED",
      "archived-one": "ARCHIVED",
    });
  });

  it("leaves other workspaces untouched", async () => {
    await expect(statuses(otherWorkspaceId)).resolves.toEqual({
      "other-running": "RUNNING",
    });
  });

  it("is a no-op when nothing is left to pause", async () => {
    await expect(pauseAllCampaigns(db, workspaceId)).resolves.toBe(0);
  });
});
