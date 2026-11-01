import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { deleteAccount, getAccountDeletionSummary } from "./deleteAccount";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

const DB_NAME = "test-delete-account";
let db: PrismaClient;

beforeAll(() => {
  db = freshTestDb(DB_NAME);
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("sole-owner account deletion", () => {
  it("summarises and then deletes the user, workspace, and its campaigns", async () => {
    const seeded = await seedWorkspace(db, "solo");
    await db.campaign.create({
      data: { workspaceId: seeded.workspace.id, name: "Solo campaign", status: "DRAFT" },
    });
    await db.lead.create({
      data: {
        workspaceId: seeded.workspace.id,
        email: "gone@example.com",
        status: "VALID",
        fields: {},
        tags: [],
      },
    });

    const summary = await getAccountDeletionSummary(db, seeded.user.id);
    expect(summary.leaveWorkspaces).toHaveLength(0);
    expect(summary.deleteWorkspaces).toHaveLength(1);
    expect(summary.deleteWorkspaces[0].name).toBe(seeded.workspace.name);
    expect(summary.deleteWorkspaces[0].campaigns).toBe(1);
    expect(summary.deleteWorkspaces[0].leads).toBe(1);

    await deleteAccount(db, seeded.user.id);
    expect(await db.user.findUnique({ where: { id: seeded.user.id } })).toBeNull();
    expect(await db.workspace.findUnique({ where: { id: seeded.workspace.id } })).toBeNull();
    expect(await db.campaign.count({ where: { workspaceId: seeded.workspace.id } })).toBe(0);
    expect(await db.lead.count({ where: { workspaceId: seeded.workspace.id } })).toBe(0);
  });
});

describe("shared workspace account deletion", () => {
  it("removes only the departing user and leaves the workspace for other members", async () => {
    const seeded = await seedWorkspace(db, "shared");
    const colleague = await db.user.create({
      data: { name: "Colleague", email: "colleague@example.com", passwordHash: "x" },
    });
    await db.membership.create({
      data: { userId: colleague.id, workspaceId: seeded.workspace.id, role: "MEMBER" },
    });

    const summary = await getAccountDeletionSummary(db, seeded.user.id);
    expect(summary.deleteWorkspaces).toHaveLength(0);
    expect(summary.leaveWorkspaces).toEqual([
      { id: seeded.workspace.id, name: seeded.workspace.name },
    ]);

    await deleteAccount(db, seeded.user.id);
    expect(await db.user.findUnique({ where: { id: seeded.user.id } })).toBeNull();
    expect(await db.workspace.findUnique({ where: { id: seeded.workspace.id } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { id: colleague.id } })).not.toBeNull();
    expect(
      await db.membership.count({ where: { workspaceId: seeded.workspace.id } }),
    ).toBe(1);
  });
});
