import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Credential encryption at rest.
 *
 * OAuth tokens for Gmail and Microsoft 365 accounts are stored in
 * SendingAccount.encryptedCredentials, encrypted with AES-256-GCM under
 * a key that lives only in the server environment (ENCRYPTION_KEY, the
 * base64 encoding of 32 random bytes). The database never holds a
 * plaintext token, and decrypting anywhere else is impossible without
 * the deployment's key.
 *
 * Serialised form: "v1." + base64url(iv || authTag || ciphertext), with
 * a 12 byte random IV and the 16 byte GCM tag, so any tampering with
 * the stored value fails authentication instead of decrypting garbage.
 */

const FORMAT_PREFIX = "v1.";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32, then set it in the server environment.",
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("ENCRYPTION_KEY is not valid base64. It must be the base64 encoding of 32 random bytes.");
  }
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

/** True when a usable ENCRYPTION_KEY is configured. Never throws. */
export function hasEncryptionKey(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return FORMAT_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptSecret(payload: string): string {
  const key = getEncryptionKey();
  if (!payload.startsWith(FORMAT_PREFIX)) {
    throw new Error("Encrypted value has an unknown format version.");
  }
  let packed: Buffer;
  try {
    packed = Buffer.from(payload.slice(FORMAT_PREFIX.length), "base64url");
  } catch {
    throw new Error("Encrypted value is not valid base64url.");
  }
  if (packed.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Encrypted value is truncated.");
  }
  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Encrypted value failed authentication (tampered, or encrypted under a different key).");
  }
}

// ---------------------------------------------------------------------
// OAuth token blob helpers
// ---------------------------------------------------------------------

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
  scope?: string;
  tokenType?: string;
}

export function encryptOAuthTokens(tokens: OAuthTokens): string {
  return encryptSecret(JSON.stringify(tokens));
}

export function decryptOAuthTokens(payload: string): OAuthTokens {
  const parsed = JSON.parse(decryptSecret(payload)) as Partial<OAuthTokens>;
  if (typeof parsed.accessToken !== "string" || typeof parsed.expiresAt !== "string") {
    throw new Error("Stored OAuth credentials are malformed. Reconnect the account.");
  }
  return {
    accessToken: parsed.accessToken,
    refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
    expiresAt: parsed.expiresAt,
    scope: parsed.scope,
    tokenType: parsed.tokenType,
  };
}
