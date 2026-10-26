import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiKey, PrismaClient } from "@prisma/client";
import { checkRateLimit } from "./rateLimit";

/**
 * Public API keys.
 *
 * A key is shown to its creator exactly once. What persists is the
 * SHA-256 hash of the full key plus a display prefix (the first 10
 * characters), the same discipline as invite tokens. Authentication
 * is a bearer header lookup by hash, a scope check, and a per-key
 * rate limit; every successful authentication stamps lastUsedAt.
 * Keys are tenant bound: the workspace comes from the key row, never
 * from the request, so a key can only ever see its own workspace.
 */

export const API_SCOPES = ["leads:read", "leads:write", "suppressions:write", "stats:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

export function hashApiKey(fullKey: string): string {
  return createHash("sha256").update(fullKey).digest("hex");
}

export function generateApiKey(): string {
  return `cr_${randomBytes(24).toString("base64url")}`;
}

/** Display prefix: the first 10 characters of the full key. */
export function keyPrefix(fullKey: string): string {
  return fullKey.slice(0, 10);
}

export interface CreatedApiKey {
  record: ApiKey;
  /** The full key. This is the only time it exists outside the caller. */
  fullKey: string;
}

export async function createApiKey(
  db: PrismaClient,
  input: { workspaceId: string; name: string; scopes: ApiScope[]; createdById?: string | null },
): Promise<CreatedApiKey> {
  const fullKey = generateApiKey();
  const record = await db.apiKey.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      keyHash: hashApiKey(fullKey),
      prefix: keyPrefix(fullKey),
      scopes: input.scopes,
      createdById: input.createdById ?? null,
    },
  });
  return { record, fullKey };
}

export function scopesOf(record: ApiKey): ApiScope[] {
  if (!Array.isArray(record.scopes)) {
    return [];
  }
  return record.scopes.map(String).filter(isApiScope);
}

export interface ApiKeyContext {
  apiKey: ApiKey;
  workspaceId: string;
  scopes: ApiScope[];
}

function authError(message: string, status: number, extra?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, ...extra });
}

/**
 * Authenticates a public API request. Throws an error carrying an
 * HTTP status (and retryAfterSeconds on a 429) for every failure
 * mode; returns the key context on success.
 */
export async function authenticateApiKey(
  db: PrismaClient,
  request: Request,
  requiredScope: ApiScope,
  now: Date = new Date(),
): Promise<ApiKeyContext> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw authError("Missing API key. Send it as: Authorization: Bearer <key>", 401);
  }
  const presented = match[1].trim();
  const presentedHashHex = hashApiKey(presented);
  const record = await db.apiKey.findUnique({ where: { keyHash: presentedHashHex } });
  if (!record) {
    throw authError("Invalid API key", 401);
  }
  // Constant-time confirmation on top of the unique hash lookup.
  const presentedHash = Buffer.from(presentedHashHex, "hex");
  const storedHash = Buffer.from(record.keyHash, "hex");
  if (storedHash.length !== presentedHash.length || !timingSafeEqual(storedHash, presentedHash)) {
    throw authError("Invalid API key", 401);
  }
  if (record.revokedAt) {
    throw authError("This API key has been revoked", 401);
  }
  const scopes = scopesOf(record);
  if (!scopes.includes(requiredScope)) {
    throw authError(`This API key lacks the required scope: ${requiredScope}`, 403);
  }
  const rate = checkRateLimit(record.id, now.getTime());
  if (!rate.allowed) {
    throw authError("Rate limit exceeded for this API key", 429, {
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }
  await db.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: now } });
  return { apiKey: record, workspaceId: record.workspaceId, scopes };
}
