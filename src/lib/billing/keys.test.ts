import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import {
  canonicalKeyCode,
  generateKeyCode,
  generateSubscriptionKeys,
  hashKeyCode,
  keyHintOf,
  listSubscriptionKeys,
  redeemSubscriptionKey,
  revokeSubscriptionKey,
} from "./keys";
import {
  getOrCreateSubscription,
  getPlanForWorkspace,
  hasWorkspaceFeature,
  subscriptionExpired,
} from "./subscription";

const DB_NAME = "test-billing-keys";
let db: PrismaClient;
let workspaceId: string;
let otherWorkspaceId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "keys");
  workspaceId = seeded.workspace.id;
  const other = await seedWorkspace(db, "keys-other");
  otherWorkspaceId = other.workspace.id;
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("key codes", () => {
  it("generates CR- grouped codes without confusing characters", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateKeyCode();
      expect(code).toMatch(/^CR(-[A-Z2-9]{4}){4}$/);
      expect(code).not.toMatch(/[ILO01]/);
    }
  });

  it("hashes the canonical form, so dashes and case do not matter", () => {
    const code = generateKeyCode();
    expect(hashKeyCode(code)).toBe(hashKeyCode(code.toLowerCase().replace(/-/g, " ")));
    expect(canonicalKeyCode(code)).toHaveLength(18); // CR + 16 chars
    expect(hashKeyCode(code)).not.toContain(code.slice(3, 7));
  });

  it("hints show only the first and last group", () => {
    expect(keyHintOf("CR-AB23-CD45-EF67-GH89")).toBe("CR-AB23-****-****-GH89");
  });
});

describe("generateSubscriptionKeys", () => {
  it("stores hashes and hints, never the code", async () => {
    const [generated] = await generateSubscriptionKeys(db, {
      plan: "PRO",
      count: 1,
      durationDays: 30,
      note: "test batch",
    });
    const row = await db.subscriptionKey.findUnique({ where: { id: generated.id } });
    expect(row?.status).toBe("UNUSED");
    expect(row?.codeHash).toBe(hashKeyCode(generated.code));
    expect(row?.codeHint).toBe(keyHintOf(generated.code));
    expect(JSON.stringify(row)).not.toContain(generated.code);
  });

  it("refuses FREE keys and out-of-range batches", async () => {
    await expect(
      generateSubscriptionKeys(db, { plan: "FREE", count: 1, durationDays: 30 }),
    ).rejects.toThrow(/paid plan/);
    await expect(
      generateSubscriptionKeys(db, { plan: "PRO", count: 0, durationDays: 30 }),
    ).rejects.toThrow(/between 1 and 100/);
    await expect(
      generateSubscriptionKeys(db, { plan: "PRO", count: 1, durationDays: 0 }),
    ).rejects.toThrow(/between 1 and 366/);
  });
});

describe("redeemSubscriptionKey", () => {
  it("grants the plan for the key's days and burns the key", async () => {
    const [generated] = await generateSubscriptionKeys(db, {
      plan: "AGENCY",
      count: 1,
      durationDays: 30,
    });
    const before = Date.now();
    const result = await redeemSubscriptionKey(db, { workspaceId, code: generated.code });
    expect(result.plan).toBe("AGENCY");
    const grantMs = result.currentPeriodEnd.getTime() - before;
    expect(grantMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(grantMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);

    const key = await db.subscriptionKey.findUnique({ where: { id: generated.id } });
    expect(key?.status).toBe("REDEEMED");
    expect(key?.redeemedByWorkspaceId).toBe(workspaceId);
    const subscription = await getOrCreateSubscription(db, workspaceId);
    expect(subscription.plan).toBe("AGENCY");
    expect((await getPlanForWorkspace(db, workspaceId)).id).toBe("AGENCY");
  });

  it("accepts the code typed without dashes or in lower case", async () => {
    const [generated] = await generateSubscriptionKeys(db, {
      plan: "STARTER",
      count: 1,
      durationDays: 10,
    });
    const typed = generated.code.toLowerCase().replace(/-/g, "");
    const result = await redeemSubscriptionKey(db, { workspaceId: otherWorkspaceId, code: typed });
    expect(result.plan).toBe("STARTER");
  });

  it("stacks days on top of remaining paid time", async () => {
    // otherWorkspaceId is on STARTER with about 10 days left.
    const current = await getOrCreateSubscription(db, otherWorkspaceId);
    const endBefore = current.currentPeriodEnd as Date;
    const [generated] = await generateSubscriptionKeys(db, {
      plan: "PRO",
      count: 1,
      durationDays: 30,
    });
    const result = await redeemSubscriptionKey(db, { workspaceId: otherWorkspaceId, code: generated.code });
    expect(result.plan).toBe("PRO");
    const addedMs = result.currentPeriodEnd.getTime() - endBefore.getTime();
    expect(Math.abs(addedMs - 30 * 24 * 60 * 60 * 1000)).toBeLessThan(1000);
  });

  it("rejects unknown, revoked, and already used keys", async () => {
    await expect(
      redeemSubscriptionKey(db, { workspaceId, code: "CR-AAAA-BBBB-CCCC-DDDD" }),
    ).rejects.toThrow(/not recognized/);

    const [revoked] = await generateSubscriptionKeys(db, {
      plan: "PRO",
      count: 1,
      durationDays: 30,
    });
    await revokeSubscriptionKey(db, revoked.id);
    await expect(
      redeemSubscriptionKey(db, { workspaceId, code: revoked.code }),
    ).rejects.toThrow(/revoked/);

    const [used] = await generateSubscriptionKeys(db, {
      plan: "PRO",
      count: 1,
      durationDays: 30,
    });
    await redeemSubscriptionKey(db, { workspaceId: otherWorkspaceId, code: used.code });
    await expect(
      redeemSubscriptionKey(db, { workspaceId, code: used.code }),
    ).rejects.toThrow(/already been used/);
  });
});

describe("revokeSubscriptionKey", () => {
  it("refuses to revoke a redeemed key", async () => {
    const [generated] = await generateSubscriptionKeys(db, {
      plan: "PRO",
      count: 1,
      durationDays: 30,
    });
    await redeemSubscriptionKey(db, { workspaceId: otherWorkspaceId, code: generated.code });
    await expect(revokeSubscriptionKey(db, generated.id)).rejects.toThrow(/already redeemed/);
    await expect(revokeSubscriptionKey(db, "missing-id")).rejects.toThrow(/not found/);
  });
});

describe("plan expiry and feature gates", () => {
  it("falls back to FREE once key time runs out", async () => {
    await db.subscription.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        plan: "AGENCY",
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() - 60_000),
      },
      update: { plan: "AGENCY", currentPeriodEnd: new Date(Date.now() - 60_000) },
    });
    const subscription = await getOrCreateSubscription(db, workspaceId);
    expect(subscriptionExpired(subscription)).toBe(true);
    expect((await getPlanForWorkspace(db, workspaceId)).id).toBe("FREE");
    expect(await hasWorkspaceFeature(db, workspaceId, "api")).toBe(false);
  });

  it("keeps hand-granted paid plans (no period end) active", async () => {
    await db.subscription.update({
      where: { workspaceId },
      data: { plan: "AGENCY", currentPeriodEnd: null },
    });
    expect((await getPlanForWorkspace(db, workspaceId)).id).toBe("AGENCY");
    expect(await hasWorkspaceFeature(db, workspaceId, "api")).toBe(true);
    expect(await hasWorkspaceFeature(db, workspaceId, "crm")).toBe(true);
  });

  it("gives the platform owner's workspace every feature on any plan", async () => {
    const owner = await db.user.findFirst({ where: { email: "owner-keys@example.com" } });
    expect(owner).not.toBeNull();
    const previous = process.env.PLATFORM_OWNER_EMAIL;
    process.env.PLATFORM_OWNER_EMAIL = "owner-keys@example.com";
    try {
      await db.subscription.update({
        where: { workspaceId },
        data: { plan: "FREE", currentPeriodEnd: null },
      });
      expect(await hasWorkspaceFeature(db, workspaceId, "ai")).toBe(true);
      // The other workspace is on Growth, which has no API access, and
      // its owner is not the platform owner, so no bypass applies.
      expect(await hasWorkspaceFeature(db, otherWorkspaceId, "api")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.PLATFORM_OWNER_EMAIL;
      else process.env.PLATFORM_OWNER_EMAIL = previous;
    }
  });
});

describe("listSubscriptionKeys", () => {
  it("reports counts by status and the redeeming workspace name", async () => {
    const { keys, counts } = await listSubscriptionKeys(db, {});
    expect(counts.UNUSED + counts.REDEEMED + counts.REVOKED).toBeGreaterThanOrEqual(6);
    const redeemed = keys.find((key) => key.status === "REDEEMED");
    expect(redeemed?.redeemedByWorkspaceName).toBe("Test Workspace");
  });
});
