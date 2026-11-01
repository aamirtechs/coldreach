import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { bucketByDay, getPlatformStats, isPlatformOwner } from "./platform";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

describe("isPlatformOwner", () => {
  it("matches the configured email case-insensitively", () => {
    const env = { PLATFORM_OWNER_EMAIL: "Owner@Example.com" } as unknown as NodeJS.ProcessEnv;
    expect(isPlatformOwner("owner@example.com", env)).toBe(true);
    expect(isPlatformOwner("  owner@example.com ", env)).toBe(true);
  });

  it("rejects other emails and any email when the variable is unset", () => {
    const env = { PLATFORM_OWNER_EMAIL: "owner@example.com" } as unknown as NodeJS.ProcessEnv;
    expect(isPlatformOwner("someone@example.com", env)).toBe(false);
    expect(isPlatformOwner("owner@example.com", {} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isPlatformOwner(null, env)).toBe(false);
    expect(isPlatformOwner(undefined, env)).toBe(false);
  });
});

describe("bucketByDay", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("zero-fills the window and counts per UTC day, oldest first", () => {
    const buckets = bucketByDay(
      [
        new Date("2026-11-15T01:00:00Z"),
        new Date("2026-11-15T23:59:00Z"),
        new Date("2026-11-13T10:00:00Z"),
      ],
      3,
      now,
    );
    expect(buckets).toEqual([
      { day: "2026-11-13", count: 1 },
      { day: "2026-11-14", count: 0 },
      { day: "2026-11-15", count: 2 },
    ]);
  });

  it("ignores dates outside the window", () => {
    const buckets = bucketByDay([new Date("2026-10-01T00:00:00Z")], 3, now);
    expect(buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });
});

const DB_NAME = "test-platform-admin";
let db: PrismaClient;

describe("getPlatformStats", () => {
  beforeAll(async () => {
    db = freshTestDb(DB_NAME);
    const first = await seedWorkspace(db, "alpha");
    const second = await seedWorkspace(db, "beta");

    // Second workspace runs a paid plan; the first has no
    // subscription row and must count as FREE.
    await db.subscription.create({
      data: { workspaceId: second.workspace.id, plan: "PRO", status: "ACTIVE" },
    });

    const campaign = await db.campaign.create({
      data: {
        workspaceId: first.workspace.id,
        name: "Stats Campaign",
        status: "RUNNING",
        timezone: "UTC",
        windowStart: "00:00",
        windowEnd: "23:59",
        businessDaysOnly: false,
      },
    });
    await db.emailEvent.createMany({
      data: [
        {
          workspaceId: first.workspace.id,
          campaignId: campaign.id,
          type: "SENT",
          idempotencyKey: "stats-sent-1",
          occurredAt: new Date(),
        },
        {
          workspaceId: first.workspace.id,
          campaignId: campaign.id,
          type: "SENT",
          idempotencyKey: "stats-sent-2",
          occurredAt: new Date(),
        },
        {
          workspaceId: second.workspace.id,
          type: "REPLIED",
          idempotencyKey: "stats-replied-1",
          occurredAt: new Date(),
        },
      ],
    });
  });

  afterAll(async () => {
    await dropTestDb(db, DB_NAME);
  });

  it("aggregates totals, events, and plan mix across workspaces", async () => {
    const stats = await getPlatformStats(db, new Date());
    expect(stats.totals.users).toBe(2);
    expect(stats.totals.workspaces).toBe(2);
    expect(stats.totals.campaigns).toBe(1);
    expect(stats.totals.runningCampaigns).toBe(1);
    expect(stats.events.SENT).toBe(2);
    expect(stats.events.REPLIED).toBe(1);
    expect(stats.events.OPENED).toBe(0);
    expect(stats.planMix).toEqual({ FREE: 1, STARTER: 0, PRO: 1, AGENCY: 0 });
  });

  it("summarises recent workspaces with owner and send counts", async () => {
    const stats = await getPlatformStats(db, new Date());
    expect(stats.recentWorkspaces).toHaveLength(2);
    const withSends = stats.recentWorkspaces.find((entry) => entry.sends === 2);
    expect(withSends?.ownerEmail).toContain("@example.com");
    expect(withSends?.plan).toBe("FREE");
    const paid = stats.recentWorkspaces.find((entry) => entry.plan === "PRO");
    expect(paid?.sends).toBe(0);
    // Today is the last bucket and carries both sends and signups.
    expect(stats.sendsByDay.at(-1)?.count).toBe(2);
    expect(stats.signupsByDay.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);
  });
});
