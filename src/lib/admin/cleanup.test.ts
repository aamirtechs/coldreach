import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import {
  deleteAttachments,
  deleteRepliesByClassification,
  getCleanupStats,
  isCleanupReplyClassification,
  vacuumCleanupTables,
} from "./cleanup";

const DB_NAME = "test-admin-cleanup";
let db: PrismaClient;
let workspaceId: string;

async function makeThread(
  classification: string | null,
  messageCount: number,
): Promise<string> {
  const thread = await db.thread.create({
    data: {
      workspaceId,
      subject: `Thread ${classification ?? "none"}`,
      classification,
    },
  });
  for (let i = 0; i < messageCount; i += 1) {
    await db.threadMessage.create({
      data: {
        threadId: thread.id,
        direction: "INBOUND",
        fromEmail: "sender@example.com",
        toEmail: "me@example.com",
        body: `Message ${i}`,
      },
    });
  }
  return thread.id;
}

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "cleanup");
  workspaceId = seeded.workspace.id;
  const other = await seedWorkspace(db, "cleanup-other");

  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      name: "Cleanup Campaign",
      status: "PAUSED",
      timezone: "UTC",
      windowStart: "00:00",
      windowEnd: "23:59",
      businessDaysOnly: false,
    },
  });
  const otherCampaign = await db.campaign.create({
    data: {
      workspaceId: other.workspace.id,
      name: "Other Campaign",
      status: "PAUSED",
      timezone: "UTC",
      windowStart: "00:00",
      windowEnd: "23:59",
      businessDaysOnly: false,
    },
  });

  const sizes: Array<[string, number, string]> = [
    [campaign.id, 100, "small.pdf"],
    [campaign.id, 300, "large.pdf"],
    [otherCampaign.id, 200, "medium.pdf"],
  ];
  for (const [campaignId, size, filename] of sizes) {
    await db.stepAttachment.create({
      data: {
        workspaceId: campaignId === campaign.id ? workspaceId : other.workspace.id,
        campaignId,
        stepOrder: 0,
        filename,
        contentType: "application/pdf",
        sizeBytes: size,
        data: Buffer.alloc(size, 1),
      },
    });
  }

  await makeThread("AUTOMATED", 2);
  await makeThread("AUTOMATED", 1);
  await makeThread("NOT_FOUND", 1);
  await makeThread("POSITIVE", 1);
  await makeThread(null, 1);
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("storage cleanup", () => {
  it("reports attachments across workspaces, largest first, and machine reply counts", async () => {
    const stats = await getCleanupStats(db);
    expect(stats.databaseBytes).toBeNull();
    expect(stats.attachments.count).toBe(3);
    expect(stats.attachments.totalBytes).toBe(600);
    expect(stats.attachments.truncated).toBe(false);
    expect(stats.attachments.items.map((item) => item.filename)).toEqual([
      "large.pdf",
      "medium.pdf",
      "small.pdf",
    ]);
    expect(stats.attachments.items[0].campaignName).toBe("Cleanup Campaign");
    expect(stats.attachments.items[1].workspaceName).toBe("Test Workspace");
    expect(stats.replies.AUTOMATED).toEqual({ threads: 2, messages: 3 });
    expect(stats.replies.NOT_FOUND).toEqual({ threads: 1, messages: 1 });
  });

  it("deletes selected attachments and reports freed bytes, ignoring unknown ids", async () => {
    const stats = await getCleanupStats(db);
    const large = stats.attachments.items.find((item) => item.filename === "large.pdf");
    expect(large).toBeDefined();
    const result = await deleteAttachments(db, [large!.id, "missing-id"]);
    expect(result).toEqual({ deleted: 1, freedBytes: 300 });
    const after = await getCleanupStats(db);
    expect(after.attachments.count).toBe(2);
    expect(after.attachments.totalBytes).toBe(300);
    expect(await deleteAttachments(db, [])).toEqual({ deleted: 0, freedBytes: 0 });
  });

  it("refuses a delete batch above the cap", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    await expect(deleteAttachments(db, ids)).rejects.toThrow(/at most 500/);
  });

  it("deletes a machine classification with its messages and keeps human threads", async () => {
    const result = await deleteRepliesByClassification(db, "AUTOMATED");
    expect(result).toEqual({ classification: "AUTOMATED", threads: 2, messages: 3 });
    expect(await db.thread.count({ where: { classification: "AUTOMATED" } })).toBe(0);
    expect(await db.thread.count({ where: { classification: "POSITIVE" } })).toBe(1);
    expect(await db.threadMessage.count()).toBe(3);
    const stats = await getCleanupStats(db);
    expect(stats.replies.AUTOMATED).toEqual({ threads: 0, messages: 0 });
    expect(stats.replies.NOT_FOUND).toEqual({ threads: 1, messages: 1 });
  });

  it("refuses to delete human or unlisted classifications", async () => {
    expect(isCleanupReplyClassification("POSITIVE")).toBe(false);
    expect(isCleanupReplyClassification("AUTOMATED")).toBe(true);
    await expect(deleteRepliesByClassification(db, "POSITIVE")).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(deleteRepliesByClassification(db, "TICKET")).rejects.toThrow(
      /cannot be deleted/,
    );
    expect(await db.thread.count({ where: { classification: "POSITIVE" } })).toBe(1);
  });

  it("vacuum is a safe no-op where it cannot run", async () => {
    await expect(vacuumCleanupTables(db)).resolves.toBeUndefined();
  });
});
