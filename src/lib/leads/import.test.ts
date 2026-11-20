import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { guessImportTarget, importLeadsFromCsv } from "./import";
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

describe("guessImportTarget", () => {
  it("recognises the icebreaker column under its common header spellings", () => {
    for (const header of ["icebreaker", "Icebreaker", "Ice Breaker", "ice_breaker", "ICEBREAKER", "Opening Line", "Icebreaker Line"]) {
      expect(guessImportTarget(header)).toBe("icebreaker");
    }
  });

  it("recognises the hook column spellings as the icebreaker (v1.30.1)", () => {
    for (const header of ["Hook", "hook", "HOOK", "Hook Line", "hook_line", "Hooks"]) {
      expect(guessImportTarget(header)).toBe("icebreaker");
    }
  });

  it("keeps the existing standard guesses and passes custom headers through", () => {
    expect(guessImportTarget("Email Address")).toBe("email");
    expect(guessImportTarget("First Name")).toBe("firstName");
    expect(guessImportTarget("Surname")).toBe("lastName");
    expect(guessImportTarget("Organization")).toBe("company");
    expect(guessImportTarget("painPoints")).toBe("painPoints");
  });
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

  it("lands the Calling columns in lead fields under their own names (v1.44.0)", async () => {
    const csv = [
      "Email,Phone,City,State,Timezone,PainPoints,MobileScore,LCP,Hook,Pronunciation",
      "callme@example.com,+1 555 010 2030,Daytona Beach,FL,America/New_York,Slow mobile site,24,15.9s,Scored 24 out of 100,AN-uh HAN-dee",
    ].join("\n");

    const result = await importLeadsFromCsv(db, {
      workspaceId,
      listId,
      csvText: csv,
      mapping: {
        Email: "email",
        Phone: guessImportTarget("Phone"),
        City: guessImportTarget("City"),
        State: guessImportTarget("State"),
        Timezone: guessImportTarget("Timezone"),
        PainPoints: guessImportTarget("PainPoints"),
        MobileScore: guessImportTarget("MobileScore"),
        LCP: guessImportTarget("LCP"),
        Hook: guessImportTarget("Hook"),
        Pronunciation: guessImportTarget("Pronunciation"),
      },
    });

    expect(result.summary.kept).toBe(1);
    const lead = await db.lead.findFirst({ where: { workspaceId, email: "callme@example.com" } });
    expect(lead?.fields).toMatchObject({
      namePronunciation: "AN-uh HAN-dee",
      phone: "+1 555 010 2030",
      city: "Daytona Beach",
      state: "FL",
      timezone: "America/New_York",
      painPoints: "Slow mobile site",
      mobileScore: "24",
      lcp: "15.9s",
      // A Hook column is guessed to the icebreaker target (v1.30.1);
      // Calling reads it back as the hook fallback.
      icebreaker: "Scored 24 out of 100",
    });
  });

  it("guesses pronunciation columns onto the namePronunciation field (v1.45.0)", () => {
    expect(guessImportTarget("NamePronunciation")).toBe("namePronunciation");
    expect(guessImportTarget("Pronunciation")).toBe("namePronunciation");
    expect(guessImportTarget("name pronunciation")).toBe("namePronunciation");
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

  it("stores a column mapped to the icebreaker target as the icebreaker field on new leads", async () => {
    const csv = ["Email,Ice Breaker", "fresh-ice@example.com,Saw your new Houston range"].join("\n");
    const result = await importLeadsFromCsv(db, {
      workspaceId,
      listId,
      csvText: csv,
      mapping: { Email: "email", "Ice Breaker": "icebreaker" },
    });
    expect(result.summary.kept).toBe(1);
    const lead = await db.lead.findFirst({ where: { workspaceId, email: "fresh-ice@example.com" } });
    expect(lead?.fields).toMatchObject({ icebreaker: "Saw your new Houston range" });
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

describe("importLeadsFromCsv with wizard verification verdicts (v1.34.0)", () => {
  const verdicts = {
    "vinvalid@example.com": { status: "INVALID", detail: { source: "builtin+provider" } },
    "vrisky@example.com": { status: "RISKY", detail: { source: "builtin+provider" } },
    "vgood@example.com": { status: "VALID", detail: { source: "builtin+provider" } },
  };
  const csv = [
    "Email,First Name",
    "vinvalid@example.com,Bad",
    "vrisky@example.com,Risk",
    "vgood@example.com,Good",
  ].join("\n");
  const mapping = { Email: "email", "First Name": "firstName" };

  it("skips unselected groups and stores verdicts on kept leads", async () => {
    const list = await db.leadList.create({ data: { workspaceId, name: "Verified import" } });
    const result = await importLeadsFromCsv(db, {
      workspaceId,
      listId: list.id,
      csvText: csv,
      mapping,
      verification: { verdicts, statuses: ["VALID", "RISKY", "UNKNOWN"] },
    });
    expect(result.summary.kept).toBe(2);
    expect(result.summary.verificationSkipped).toBe(1);
    expect(result.errors.some((e) => e.email === "vinvalid@example.com")).toBe(true);
    const good = await db.lead.findFirst({ where: { listId: list.id, email: "vgood@example.com" } });
    expect(good?.verificationStatus).toBe("VALID");
    expect(good?.verifiedAt).not.toBeNull();
    const risky = await db.lead.findFirst({ where: { listId: list.id, email: "vrisky@example.com" } });
    expect(risky?.verificationStatus).toBe("RISKY");
  });

  it("excludes RISKY verdicts when the group is not selected", async () => {
    const list = await db.leadList.create({ data: { workspaceId, name: "Verified import strict" } });
    const strictVerdicts = {
      "sinvalid@example.com": { status: "INVALID", detail: { source: "builtin+provider" } },
      "srisky@example.com": { status: "RISKY", detail: { source: "builtin+provider" } },
      "sgood@example.com": { status: "VALID", detail: { source: "builtin+provider" } },
    };
    const strictCsv = [
      "Email,First Name",
      "sinvalid@example.com,Bad",
      "srisky@example.com,Risk",
      "sgood@example.com,Good",
    ].join("\n");
    const result = await importLeadsFromCsv(db, {
      workspaceId,
      listId: list.id,
      csvText: strictCsv,
      mapping,
      verification: { verdicts: strictVerdicts, statuses: ["VALID", "UNKNOWN"] },
    });
    expect(result.summary.kept).toBe(1);
    expect(result.summary.verificationSkipped).toBe(2);
  });

  it("imports INVALID verdicts when the user selects that group, stored as INVALID", async () => {
    const list = await db.leadList.create({ data: { workspaceId, name: "Verified import all" } });
    const allVerdicts = {
      "abad@example.com": { status: "INVALID", detail: { source: "builtin+provider" } },
      "afine@example.com": { status: "VALID", detail: { source: "builtin+provider" } },
    };
    const allCsv = ["Email,First Name", "abad@example.com,Bad", "afine@example.com,Fine"].join("\n");
    const result = await importLeadsFromCsv(db, {
      workspaceId,
      listId: list.id,
      csvText: allCsv,
      mapping,
      verification: { verdicts: allVerdicts, statuses: ["VALID", "RISKY", "UNKNOWN", "INVALID"] },
    });
    expect(result.summary.kept).toBe(2);
    expect(result.summary.verificationSkipped).toBe(0);
    const bad = await db.lead.findFirst({ where: { listId: list.id, email: "abad@example.com" } });
    expect(bad?.verificationStatus).toBe("INVALID");
  });
});
