import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { assertMembership, listUserWorkspaces } from "./workspaces";

const DB_NAME = "test-workspaces";
let db: PrismaClient;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("workspace switching support", () => {
  it("lists exactly the workspaces the user belongs to", async () => {
    const first = await seedWorkspace(db, "switch-a");
    const secondWorkspace = await db.workspace.create({
      data: { name: "Client Workspace", slug: "test-switch-b" },
    });
    await db.membership.create({
      data: { userId: first.user.id, workspaceId: secondWorkspace.id, role: "ADMIN" },
    });
    await seedWorkspace(db, "switch-other");

    const list = await listUserWorkspaces(first.user.id, db);
    expect(list.map((entry) => entry.id).sort()).toEqual(
      [first.workspace.id, secondWorkspace.id].sort(),
    );
    expect(list.find((entry) => entry.id === secondWorkspace.id)?.role).toBe("ADMIN");
  });

  it("assertMembership returns the workspace for members and refuses others", async () => {
    const seeded = await seedWorkspace(db, "switch-c");
    const ok = await assertMembership(seeded.user.id, seeded.workspace.id, db);
    expect(ok.name).toBe("Test Workspace");
    const outsider = await db.user.create({
      data: { name: "Out", email: "out@example.com", passwordHash: "x" },
    });
    await expect(assertMembership(outsider.id, seeded.workspace.id, db)).rejects.toMatchObject({
      status: 403,
    });
  });
});
