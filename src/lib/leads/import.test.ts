import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { importLeadsFromCsv } from "./import";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

const DB_NAME = "test-import";
let db: PrismaClient;
let workspaceId: string;
let listId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "import");
  workspaceId = seeded.workspace.id;
  const list = await db.leadList.create({ data: { workspaceId, name: "Import list" } });
  listId = list.id;
  await db.suppression.create({
    data: {
      workspaceId,
      scope: "WORKSPACE",
      email: "blocked@example.com",
      reason: "Do not contact",
    },
  });
  // One lead already in the workspace, to exercise the exists check.
  await db.lead.create({
    data: { workspaceId, email: "existing@example.com", fields: {}, tags: [], status: "NEW" },
  });
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("importLeadsFromCsv", () => {
  it("keeps, deduplicates, rejects invalid and suppressed rows with a full report", async () => {
    const csv = [
      "Email,First Name,Company",
      "new1@example.com,Ada,Acme",
      "new2@example.com,Grace,Globex",
      "NEW1@example.com,Ada,Acme",
      "not-an-email,Nope,Nowhere",
      "blocked@example.com,Block,Blocked Inc",
      "existing@example.com,Ed,Existing Co",
    ].join("\n");

    const result = await importLeadsFromCsv(db, {
      workspaceId,
      listId,
      csvText: csv,
      mapping: { Email: "email", "First Name": "firstName", Company: "company" },
    });

    expect(result.summary.total).toBe(6);
    expect(result.summary.kept).toBe(2);
    expect(result.summary.duplicates).toBe(2);
    expect(result.summary.invalid).toBe(1);
    expect(result.summary.suppressed).toBe(1);
    expect(result.summary.alreadyExisted).toBe(1);

    const reasons = result.errors.map((e) => `${e.row}:${e.reason}`);
    expect(reasons.some((r) => r.startsWith("4:") && r.includes("Duplicate"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("5:") && r.includes("Invalid"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("6:") && r.includes("Suppressed"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("7:") && r.includes("Already exists"))).toBe(true);

    const kept = await db.lead.findMany({ where: { workspaceId, listId }, orderBy: { email: "asc" } });
    expect(kept.map((l) => l.email)).toEqual(["new1@example.com", "new2@example.com"]);
    expect(kept[0].fields).toMatchObject({ firstName: "Ada", company: "Acme" });
  });

  it("refuses an import with no email mapping", async () => {
    await expect(
      importLeadsFromCsv(db, {
        workspaceId,
        listId,
        csvText: "Name\nAda",
        mapping: { Name: "firstName" },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
