import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { authenticateApiKey, createApiKey, hashApiKey } from "./keys";
import { checkRateLimit, resetRateLimits } from "./rateLimit";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

const DB_NAME = "test-apikeys";
let db: PrismaClient;
let workspaceId: string;

function requestWith(key: string | null): Request {
  return new Request("http://localhost/api/v1/leads", {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
}

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "apikeys");
  workspaceId = seeded.workspace.id;
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("createApiKey", () => {
  it("stores only the hash and the 10 character prefix", async () => {
    const { record, fullKey } = await createApiKey(db, {
      workspaceId,
      name: "Test key",
      scopes: ["leads:read"],
    });
    expect(record.keyHash).toBe(hashApiKey(fullKey));
    expect(record.keyHash).not.toBe(fullKey);
    expect(record.prefix).toBe(fullKey.slice(0, 10));
    expect(record.prefix).toHaveLength(10);
    const stored = await db.apiKey.findUnique({ where: { id: record.id } });
    expect(JSON.stringify(stored)).not.toContain(fullKey);
  });
});

describe("authenticateApiKey", () => {
  it("accepts a valid key with the required scope and stamps lastUsedAt", async () => {
    const { fullKey, record } = await createApiKey(db, {
      workspaceId,
      name: "Reader",
      scopes: ["leads:read"],
    });
    const ctx = await authenticateApiKey(db, requestWith(fullKey), "leads:read");
    expect(ctx.workspaceId).toBe(workspaceId);
    expect(ctx.scopes).toEqual(["leads:read"]);
    const after = await db.apiKey.findUnique({ where: { id: record.id } });
    expect(after?.lastUsedAt).not.toBeNull();
  });

  it("rejects a missing or unknown key with 401", async () => {
    await expect(authenticateApiKey(db, requestWith(null), "leads:read")).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateApiKey(db, requestWith("cr_not-a-real-key"), "leads:read"),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a revoked key with 401", async () => {
    const { fullKey, record } = await createApiKey(db, {
      workspaceId,
      name: "Soon revoked",
      scopes: ["leads:read"],
    });
    await db.apiKey.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    await expect(authenticateApiKey(db, requestWith(fullKey), "leads:read")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects a key without the required scope with 403", async () => {
    const { fullKey } = await createApiKey(db, {
      workspaceId,
      name: "Read only",
      scopes: ["leads:read"],
    });
    await expect(authenticateApiKey(db, requestWith(fullKey), "leads:write")).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("checkRateLimit", () => {
  it("allows up to the limit, then blocks with a retry delay", () => {
    resetRateLimits();
    const now = 1_000_000;
    for (let i = 0; i < 120; i += 1) {
      expect(checkRateLimit("key-a", now).allowed).toBe(true);
    }
    const blocked = checkRateLimit("key-a", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("tracks keys independently and resets after the window", () => {
    resetRateLimits();
    const now = 2_000_000;
    for (let i = 0; i < 120; i += 1) {
      checkRateLimit("key-b", now);
    }
    expect(checkRateLimit("key-b", now).allowed).toBe(false);
    expect(checkRateLimit("key-c", now).allowed).toBe(true);
    expect(checkRateLimit("key-b", now + 60_000).allowed).toBe(true);
  });
});
