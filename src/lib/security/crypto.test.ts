import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptOAuthTokens,
  decryptSecret,
  encryptOAuthTokens,
  encryptSecret,
} from "./crypto";

const ORIGINAL = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = ORIGINAL;
  }
});

describe("AES-256-GCM credential encryption", () => {
  it("round-trips a secret", () => {
    const secret = "ya29.a0AfH6SMBx-example-access-token";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-value");
    expect(decryptSecret(b)).toBe("same-value");
  });

  it("detects tampering with the ciphertext", () => {
    const encrypted = encryptSecret("refresh-token-value");
    const raw = Buffer.from(encrypted.slice(3), "base64url");
    raw[raw.length - 1] = raw[raw.length - 1] ^ 0xff;
    const tampered = "v1." + raw.toString("base64url");
    expect(() => decryptSecret(tampered)).toThrow(/authentication/);
  });

  it("detects tampering with the auth tag", () => {
    const encrypted = encryptSecret("refresh-token-value");
    const raw = Buffer.from(encrypted.slice(3), "base64url");
    raw[12] = raw[12] ^ 0x01;
    const tampered = "v1." + raw.toString("base64url");
    expect(() => decryptSecret(tampered)).toThrow(/authentication/);
  });

  it("fails to decrypt under a different key", () => {
    const encrypted = encryptSecret("some-token");
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptSecret(encrypted)).toThrow(/authentication/);
  });

  it("rejects values without the format prefix", () => {
    expect(() => decryptSecret("plaintext-token")).toThrow(/format/);
  });

  it("throws a clear error when ENCRYPTION_KEY is unset", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it("throws a clear error when ENCRYPTION_KEY is the wrong length", () => {
    process.env.ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });

  it("round-trips an OAuth token blob", () => {
    const blob = encryptOAuthTokens({
      accessToken: "access-123",
      refreshToken: "refresh-456",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scope: "https://www.googleapis.com/auth/gmail.send",
      tokenType: "Bearer",
    });
    const tokens = decryptOAuthTokens(blob);
    expect(tokens.accessToken).toBe("access-123");
    expect(tokens.refreshToken).toBe("refresh-456");
    expect(tokens.scope).toContain("gmail.send");
  });
});
