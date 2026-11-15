import type { PrismaClient } from "@prisma/client";
import type { AiProvider } from "./provider";
import {
  buildAiProvider,
  defaultAiModel,
  type AiProviderId,
} from "./openai";
import { decryptSecret, encryptSecret, hasEncryptionKey } from "@/lib/security/crypto";

/**
 * Per-workspace AI keys (v1.8.0).
 *
 * Every workspace brings its own OpenAI or Groq key, saved on the
 * Integrations page and stored AES-256-GCM encrypted. AI features in
 * a workspace run on that workspace's key and its owner's bill, never
 * on a shared deployment key.
 *
 * The one exception is the platform owner's own workspace: when
 * PLATFORM_OWNER_EMAIL is set in the environment and names the
 * workspace owner's email, the deployment keys (OPENAI_API_KEY /
 * GROQ_API_KEY) act as that workspace's key. That is how the
 * operator's own workspace keeps working without storing a key, and
 * it can never apply to a customer's workspace.
 */

export type AiKeySource = "workspace" | "platform";

export interface WorkspaceAiStatus {
  configured: boolean;
  source: AiKeySource | null;
  providerId: AiProviderId | null;
  /** Effective model when configured, else the OpenAI default. */
  model: string;
  /**
   * True when a key is saved but this server cannot decrypt it, which
   * happens when the deployment's ENCRYPTION_KEY changes (for example
   * a hosting move). The saved key is unrecoverable by design; the
   * workspace admin must paste the key again on the Integrations page.
   */
  keyUnreadable: boolean;
}

export interface ResolvedWorkspaceAi extends WorkspaceAiStatus {
  configured: true;
  source: AiKeySource;
  providerId: AiProviderId;
  provider: AiProvider;
}

function asProviderId(value: string): AiProviderId | null {
  return value === "openai" || value === "groq" ? value : null;
}

/** The workspace row's summary. Never includes any part of the key. */
export async function getWorkspaceAiConfigSummary(
  db: PrismaClient,
  workspaceId: string,
): Promise<{ providerId: AiProviderId; model: string | null } | null> {
  const row = await db.workspaceAiConfig.findUnique({
    where: { workspaceId },
    select: { provider: true, model: true },
  });
  if (!row) return null;
  const providerId = asProviderId(row.provider);
  return providerId ? { providerId, model: row.model } : null;
}

/** Save (create or replace) the workspace's own AI key, encrypted. */
export async function saveWorkspaceAiKey(
  db: PrismaClient,
  workspaceId: string,
  input: { providerId: AiProviderId; apiKey: string; model?: string | null },
): Promise<void> {
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 8) {
    throw new Error("API key looks too short to be real.");
  }
  if (!hasEncryptionKey()) {
    throw new Error("Credential encryption is not configured on this server.");
  }
  const encryptedKey = encryptSecret(apiKey);
  const model = input.model?.trim() ? input.model.trim() : null;
  await db.workspaceAiConfig.upsert({
    where: { workspaceId },
    create: { workspaceId, provider: input.providerId, encryptedKey, model },
    update: { provider: input.providerId, encryptedKey, model },
  });
}

/** Remove the workspace's own AI key, if one exists. */
export async function deleteWorkspaceAiKey(
  db: PrismaClient,
  workspaceId: string,
): Promise<boolean> {
  const result = await db.workspaceAiConfig.deleteMany({ where: { workspaceId } });
  return result.count > 0;
}

/**
 * True when the deployment keys may serve this workspace: the
 * platform owner exception. Requires PLATFORM_OWNER_EMAIL to be set
 * and to match the email of the workspace's OWNER member.
 */
async function platformFallbackApplies(
  db: PrismaClient,
  workspaceId: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const ownerEmail = env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) return false;
  if (!env.OPENAI_API_KEY && !env.GROQ_API_KEY) return false;
  const owner = await db.membership.findFirst({
    where: { workspaceId, role: "OWNER" },
    select: { user: { select: { email: true } } },
  });
  return owner?.user.email.toLowerCase() === ownerEmail;
}

type StoredAiKey =
  | { state: "none" }
  | { state: "unreadable"; providerId: AiProviderId; model: string | null }
  | { state: "ok"; providerId: AiProviderId; model: string | null; apiKey: string };

/**
 * Reads the workspace's stored key. A stored key whose ciphertext no
 * longer decrypts (the deployment's ENCRYPTION_KEY changed) reports
 * "unreadable" instead of throwing: callers treat the workspace as
 * not configured and the UI asks the admin to paste the key again.
 */
async function readStoredAiKey(db: PrismaClient, workspaceId: string): Promise<StoredAiKey> {
  const row = await db.workspaceAiConfig.findUnique({ where: { workspaceId } });
  if (!row) return { state: "none" };
  const providerId = asProviderId(row.provider);
  if (!providerId) return { state: "none" };
  try {
    return { state: "ok", providerId, model: row.model, apiKey: decryptSecret(row.encryptedKey) };
  } catch {
    return { state: "unreadable", providerId, model: row.model };
  }
}

/** Status for status surfaces (settings panel, /api/ai/status). */
export async function getWorkspaceAiStatus(
  db: PrismaClient,
  workspaceId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkspaceAiStatus> {
  const stored = await readStoredAiKey(db, workspaceId);
  if (stored.state === "ok") {
    return {
      configured: true,
      source: "workspace",
      providerId: stored.providerId,
      model: stored.model || defaultAiModel(stored.providerId),
      keyUnreadable: false,
    };
  }
  const keyUnreadable = stored.state === "unreadable";
  if (await platformFallbackApplies(db, workspaceId, env)) {
    const providerId: AiProviderId = env.OPENAI_API_KEY ? "openai" : "groq";
    return {
      configured: true,
      source: "platform",
      providerId,
      model:
        (providerId === "openai" ? env.AI_MODEL : env.GROQ_MODEL) || defaultAiModel(providerId),
      keyUnreadable,
    };
  }
  return {
    configured: false,
    source: null,
    providerId: null,
    model: defaultAiModel("openai"),
    keyUnreadable,
  };
}

/** The provider AI features in this workspace should run on. */
export async function resolveWorkspaceAi(
  db: PrismaClient,
  workspaceId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedWorkspaceAi | null> {
  const stored = await readStoredAiKey(db, workspaceId);
  if (stored.state === "ok") {
    return {
      configured: true,
      source: "workspace",
      providerId: stored.providerId,
      model: stored.model || defaultAiModel(stored.providerId),
      keyUnreadable: false,
      provider: buildAiProvider(stored.providerId, stored.apiKey, stored.model),
    };
  }
  if (await platformFallbackApplies(db, workspaceId, env)) {
    const providerId: AiProviderId = env.OPENAI_API_KEY ? "openai" : "groq";
    const apiKey = (providerId === "openai" ? env.OPENAI_API_KEY : env.GROQ_API_KEY) as string;
    const model =
      (providerId === "openai" ? env.AI_MODEL : env.GROQ_MODEL) || defaultAiModel(providerId);
    return {
      configured: true,
      source: "platform",
      providerId,
      model,
      keyUnreadable: stored.state === "unreadable",
      provider: buildAiProvider(providerId, apiKey, model),
    };
  }
  return null;
}
