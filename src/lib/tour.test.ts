import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { getTourCompletedAt, markTourCompleted } from "./tour";
import { TOUR_STEPS, tourStepIndex } from "./tourSteps";

const DB_NAME = "test-tour";
let db: PrismaClient;
let userId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "tour");
  userId = seeded.user.id;
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("product tour persistence", () => {
  it("starts incomplete, completes once, and keeps the first completion time", async () => {
    expect(await getTourCompletedAt(db, userId)).toBeNull();

    const first = new Date("2026-10-28T07:00:00Z");
    await markTourCompleted(db, userId, first);
    expect((await getTourCompletedAt(db, userId))?.toISOString()).toBe(first.toISOString());

    const later = new Date("2026-10-29T07:00:00Z");
    await markTourCompleted(db, userId, later);
    expect((await getTourCompletedAt(db, userId))?.toISOString()).toBe(first.toISOString());
  });

  it("returns null for an unknown user", async () => {
    expect(await getTourCompletedAt(db, "no-such-user")).toBeNull();
  });
});

describe("tour step definitions", () => {
  it("covers the setup path in order, from welcome to outbox", () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual([
      "welcome",
      "identity",
      "accounts",
      "leads",
      "campaigns",
      "sequence",
      "preflight",
      "inbox",
      "outbox",
    ]);
    for (const step of TOUR_STEPS) {
      expect(step.route.startsWith("/app")).toBe(true);
      expect(step.target).toContain("data-tour");
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });

  it("resolves step ids, the start alias, and unknown ids", () => {
    expect(tourStepIndex("welcome")).toBe(0);
    expect(tourStepIndex("start")).toBe(0);
    expect(tourStepIndex("preflight")).toBe(6);
    expect(tourStepIndex("nope")).toBe(-1);
  });
});
