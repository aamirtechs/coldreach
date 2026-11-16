import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  decryptMailboxCredentials,
  encryptMailboxCredentials,
  type MailboxCredentials,
} from "@/lib/providers/smtp";
import type { MailboxConnectionVerifier } from "./testConnection";
import { applyPasswordToAccounts, candidateCredentials } from "./bulkPassword";

/**
 * One password for many mailboxes (v1.28.0): the stored settings are
 * reused when the blob still decrypts, the standard cPanel layout is
 * derived when it does not, and an account is only written after the
 * live connection test passes with the new password.
 */

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const OLD_PASSWORD = "old-password-value";
const NEW_PASSWORD = "new-shared-password-value";

const STORED: MailboxCredentials = {
  smtp: { host: "smtp.custom.example", port: 587, secure: false },
  imap: { host: "imap.custom.example", port: 993, secure: true },
  user: "owner@example.com",
  pass: OLD_PASSWORD,
};

function setKey() {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
}

afterAll(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  }
});

beforeEach(() => {
  setKey();
});

interface UpdateCall {
  where: { id: string };
  data: Record<string, unknown>;
}

function fakePrisma() {
  const updates: UpdateCall[] = [];
  const prisma = {
    sendingAccount: {
      update: vi.fn(async (args: UpdateCall) => {
        updates.push(args);
        return {};
      }),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, updates };
}

function capturingVerifier(fail: "smtp" | "imap" | null = null) {
  const seen: MailboxCredentials[] = [];
  const verifier: MailboxConnectionVerifier = {
    verifySmtp: async (credentials) => {
      seen.push(credentials);
      if (fail === "smtp") throw new Error("Invalid credentials given");
    },
    verifyImap: async () => {
      if (fail === "imap") throw new Error("Invalid credentials given");
    },
  };
  return { verifier, seen };
}

describe("candidateCredentials", () => {
  it("reuses the stored hosts and username, swapping only the password", () => {
    const blob = encryptMailboxCredentials(STORED);
    const candidate = candidateCredentials(
      { id: "a1", email: "owner@example.com", encryptedCredentials: blob },
      NEW_PASSWORD,
    );
    expect(candidate).toEqual({ ...STORED, pass: NEW_PASSWORD });
  });

  it("derives the standard cPanel layout when the blob cannot be decrypted", () => {
    const blob = encryptMailboxCredentials(STORED);
    setKey(); // rotate: the stored blob is now unreadable
    const candidate = candidateCredentials(
      { id: "a1", email: "owner@example.com", encryptedCredentials: blob },
      NEW_PASSWORD,
    );
    expect(candidate).toEqual({
      smtp: { host: "mail.example.com", port: 465, secure: true },
      imap: { host: "mail.example.com", port: 993, secure: true },
      user: "owner@example.com",
      pass: NEW_PASSWORD,
    });
  });

  it("derives the same layout when the account has no stored blob", () => {
    const candidate = candidateCredentials(
      { id: "a1", email: "owner@shop.example.org", encryptedCredentials: null },
      NEW_PASSWORD,
    );
    expect(candidate?.smtp.host).toBe("mail.shop.example.org");
    expect(candidate?.user).toBe("owner@shop.example.org");
    expect(candidate?.pass).toBe(NEW_PASSWORD);
  });
});

describe("applyPasswordToAccounts", () => {
  it("stores the new encrypted credentials and marks the account connected after a passing test", async () => {
    const { prisma, updates } = fakePrisma();
    const { verifier, seen } = capturingVerifier();
    const blob = encryptMailboxCredentials(STORED);
    const results = await applyPasswordToAccounts(
      prisma,
      [{ id: "a1", email: "owner@example.com", encryptedCredentials: blob }],
      NEW_PASSWORD,
      verifier,
    );
    expect(results).toEqual([{ accountId: "a1", email: "owner@example.com", ok: true }]);
    expect(seen[0].pass).toBe(NEW_PASSWORD);
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ id: "a1" });
    expect(updates[0].data.status).toBe("CONNECTED");
    expect(updates[0].data.lastError).toBeNull();
    expect(updates[0].data.credentialRef).toBeNull();
    const stored = decryptMailboxCredentials(updates[0].data.encryptedCredentials as string);
    expect(stored).toEqual({ ...STORED, pass: NEW_PASSWORD });
  });

  it("leaves the account untouched when SMTP authentication fails", async () => {
    const { prisma, updates } = fakePrisma();
    const { verifier } = capturingVerifier("smtp");
    const results = await applyPasswordToAccounts(
      prisma,
      [{ id: "a1", email: "owner@example.com", encryptedCredentials: null }],
      NEW_PASSWORD,
      verifier,
    );
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/Authentication failed/);
    expect(updates).toHaveLength(0);
  });

  it("leaves the account untouched when only IMAP fails", async () => {
    const { prisma, updates } = fakePrisma();
    const { verifier } = capturingVerifier("imap");
    const results = await applyPasswordToAccounts(
      prisma,
      [{ id: "a1", email: "owner@example.com", encryptedCredentials: null }],
      NEW_PASSWORD,
      verifier,
    );
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/Authentication failed/);
    expect(updates).toHaveLength(0);
  });

  it("processes accounts independently: one failure does not stop the rest", async () => {
    const { prisma, updates } = fakePrisma();
    const verifier: MailboxConnectionVerifier = {
      verifySmtp: async (credentials) => {
        if (credentials.user === "bad@example.com") {
          throw new Error("Invalid credentials given");
        }
      },
      verifyImap: async () => undefined,
    };
    const results = await applyPasswordToAccounts(
      prisma,
      [
        { id: "a1", email: "bad@example.com", encryptedCredentials: null },
        { id: "a2", email: "good@example.com", encryptedCredentials: null },
      ],
      NEW_PASSWORD,
      verifier,
    );
    expect(results.map((result) => result.ok)).toEqual([false, true]);
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ id: "a2" });
  });

  it("sets the daily limit on an account that connects when one is given (v1.39.0)", async () => {
    const { prisma, updates } = fakePrisma();
    const { verifier } = capturingVerifier();
    const results = await applyPasswordToAccounts(
      prisma,
      [{ id: "a1", email: "owner@example.com", encryptedCredentials: null }],
      NEW_PASSWORD,
      verifier,
      { dailyLimit: 15 },
    );
    expect(results[0].ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.dailyLimit).toBe(15);
  });

  it("leaves the daily limit alone when none is given (v1.39.0)", async () => {
    const { prisma, updates } = fakePrisma();
    const { verifier } = capturingVerifier();
    const results = await applyPasswordToAccounts(
      prisma,
      [{ id: "a1", email: "owner@example.com", encryptedCredentials: null }],
      NEW_PASSWORD,
      verifier,
    );
    expect(results[0].ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].data).not.toHaveProperty("dailyLimit");
  });

  it("never sets the daily limit on an account whose test fails (v1.39.0)", async () => {
    const { prisma, updates } = fakePrisma();
    const { verifier } = capturingVerifier("smtp");
    const results = await applyPasswordToAccounts(
      prisma,
      [{ id: "a1", email: "owner@example.com", encryptedCredentials: null }],
      NEW_PASSWORD,
      verifier,
      { dailyLimit: 15 },
    );
    expect(results[0].ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
