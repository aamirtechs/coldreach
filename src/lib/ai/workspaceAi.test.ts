import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import {
  deleteWorkspaceAiKey,
  getWorkspaceAiConfigSummary,
  getWorkspaceAiStatus,
  resolveWorkspaceAi,
  saveWorkspaceAiKey,
} from "./workspaceAi";

const DB_NAME = "test-workspace-ai";
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
let db: PrismaClient;
let workspaceId: string;
let ownerEmail: string;
let otherWorkspaceId: string;

const GROQ_ENV = {
  GROQ_API_KEY: "gsk-test-platform-key",
  PLATFORM_OWNER_EMAIL: "owner-wsai@example.com",
} as unknown as NodeJS.ProcessEnv;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "wsai");
  workspaceId = seeded.workspace.id;
  ownerEmail = seeded.user.email;
  const other = await seedWorkspace(db, "wsai-other");
  otherWorkspaceId = other.workspace.id;
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  }
});

describe("per-workspace AI keys", () => {
  it("starts unconfigured with no key and no platform match", async () => {
    const status = await getWorkspaceAiStatus(db, workspaceId, {} as NodeJS.ProcessEnv);
    expect(status).toEqual({
      configured: false,
      source: null,
      providerId: null,
      model: "gpt-4o-mini",
    });
    expect(await resolveWorkspaceAi(db, workspaceId, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("does not apply the deployment key without PLATFORM_OWNER_EMAIL", async () => {
    const env = { GROQ_API_KEY: "gsk-test-platform-key" } as unknown as NodeJS.ProcessEnv;
    const status = await getWorkspaceAiStatus(db, workspaceId, env);
    expect(status.configured).toBe(false);
  });

  it("applies the platform key only to the platform owner's workspace", async () => {
    const mine = await getWorkspaceAiStatus(db, workspaceId, GROQ_ENV);
    expect(mine).toEqual({
      configured: true,
      source: "platform",
      providerId: "groq",
      model: "llama-3.3-70b-versatile",
    });
    const resolved = await resolveWorkspaceAi(db, workspaceId, GROQ_ENV);
    expect(resolved?.provider.id).toBe("groq");

    const other = await getWorkspaceAiStatus(db, otherWorkspaceId, GROQ_ENV);
    expect(other.configured).toBe(false);
    expect(await resolveWorkspaceAi(db, otherWorkspaceId, GROQ_ENV)).toBeNull();
  });

  it("saves the workspace key encrypted and resolves it ahead of the platform key", async () => {
    await saveWorkspaceAiKey(db, workspaceId, {
      providerId: "groq",
      apiKey: "gsk-workspace-secret-key",
    });
    const row = await db.workspaceAiConfig.findUnique({ where: { workspaceId } });
    expect(row).not.toBeNull();
    expect(row?.encryptedKey).not.toContain("gsk-workspace-secret-key");

    const summary = await getWorkspaceAiConfigSummary(db, workspaceId);
    expect(summary).toEqual({ providerId: "groq", model: null });
    expect(JSON.stringify(summary)).not.toContain("gsk-");

    const status = await getWorkspaceAiStatus(db, workspaceId, GROQ_ENV);
    expect(status.source).toBe("workspace");
    expect(status.providerId).toBe("groq");
    const resolved = await resolveWorkspaceAi(db, workspaceId, GROQ_ENV);
    expect(resolved?.source).toBe("workspace");
    expect(resolved?.provider.id).toBe("groq");
  });

  it("replaces the key and honours a model override", async () => {
    await saveWorkspaceAiKey(db, workspaceId, {
      providerId: "openai",
      apiKey: "sk-workspace-openai-key",
      model: "gpt-4o",
    });
    const status = await getWorkspaceAiStatus(db, workspaceId, {} as NodeJS.ProcessEnv);
    expect(status).toEqual({
      configured: true,
      source: "workspace",
      providerId: "openai",
      model: "gpt-4o",
    });
    const count = await db.workspaceAiConfig.count({ where: { workspaceId } });
    expect(count).toBe(1);
  });

  it("rejects a too-short key and deletes cleanly", async () => {
    await expect(
      saveWorkspaceAiKey(db, workspaceId, { providerId: "groq", apiKey: "short" }),
    ).rejects.toThrow();
    expect(await deleteWorkspaceAiKey(db, workspaceId)).toBe(true);
    expect(await deleteWorkspaceAiKey(db, workspaceId)).toBe(false);
    const status = await getWorkspaceAiStatus(db, workspaceId, {} as NodeJS.ProcessEnv);
    expect(status.configured).toBe(false);
    expect(ownerEmail).toContain("@example.com");
  });
});
