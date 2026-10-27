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

  it("updates existing leads in the same list when updateExisting is set", async () => {
    const inList = await db.lead.create({
      data: {
        workspaceId,
        listId,
        email: "update-me@example.com",
        fields: { firstName: "Old", company: "Old Co" },
        tags: [],
        status: "NEW",
      },
    });
    const csv = ["Email,First Name,Icebreaker", "update-me@example.com,New,A personal line"].join("\n");

    const result = await importLeadsFromCsv(db, {
      workspaceId,
      listId,
      csvText: csv,
      mapping: { Email: "email", "First Name": "firstName", Icebreaker: "icebreaker" },
      updateExisting: true,
    });

    expect(result.summary.updated).toBe(1);
    expect(result.summary.kept).toBe(0);
    expect(result.summary.alreadyExisted).toBe(0);
    const after = await db.lead.findUnique({ where: { id: inList.id } });
    expect(after?.fields).toMatchObject({
      firstName: "New",
      company: "Old Co",
      icebreaker: "A personal line",
    });
  });

  it("skips the same existing lead when updateExisting is not set", async () => {
    const csv = ["Email,Icebreaker", "update-me@example.com,Another line"].join("\n");
    const result = await importLeadsFromCsv(db, {
      workspaceId,
      listId,
      csvText: csv,
      mapping: { Email: "email", Icebreaker: "icebreaker" },
    });
    expect(result.summary.updated).toBe(0);
    expect(result.summary.alreadyExisted).toBe(1);
    const lead = await db.lead.findFirst({ where: { workspaceId, email: "update-me@example.com" } });
    expect(lead?.fields).toMatchObject({ icebreaker: "A personal line" });
  });

  it("never updates a lead that exists in a different list", async () => {
    const otherList = await db.leadList.create({ data: { workspaceId, name: "Other list" } });
    await db.lead.create({
      data: {
        workspaceId,
        listId: otherList.id,
        email: "elsewhere@example.com",
        fields: { firstName: "Stay" },
        tags: [],
        status: "NEW",
      },
    });
    const csv = ["Email,First Name", "elsewhere@example.com,Changed"].join("\n");
    const result = await importLeadsFromCsv(db, {
      workspaceId,
      listId,
      csvText: csv,
      mapping: { Email: "email", "First Name": "firstName" },
      updateExisting: true,
    });
    expect(result.summary.updated).toBe(0);
    expect(result.summary.alreadyExisted).toBe(1);
    const lead = await db.lead.findFirst({ where: { workspaceId, email: "elsewhere@example.com" } });
    expect(lead?.fields).toMatchObject({ firstName: "Stay" });
  });
});
