import { randomBytes } from "node:crypto";
import type { SendingAccount } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";
import {
  decryptMailboxCredentials,
  encryptMailboxCredentials,
  resolveMailboxCredentials,
  type MailboxCredentials,
} from "./smtp";
import { resolveProvider } from "./index";

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const ENV_KEYS = [
  "UNIT_SMTP_HOST",
  "UNIT_SMTP_PORT",
  "UNIT_SMTP_USER",
  "UNIT_SMTP_PASS",
  "UNIT_SMTP_SECURE",
  "UNIT_SMTP_IMAP_HOST",
  "UNIT_SMTP_IMAP_PORT",
  "UNIT_SMTP_IMAP_SECURE",
];
const savedEnv = new Map<string, string | undefined>();

const STORED: MailboxCredentials = {
  smtp: { host: "mail.stored.example", port: 465, secure: true },
  imap: { host: "mail.stored.example", port: 993, secure: true },
  user: "owner@stored.example",
  pass: "stored-mailbox-password",
};

function account(partial: Partial<SendingAccount>): SendingAccount {
  return {
    id: "acct-1",
    workspaceId: "ws-1",
    email: "owner@example.com",
    displayName: null,
    provider: "SMTP",
    status: "CONNECTED",
    dailyLimit: 50,
    warmupStatus: "OFF",
    warmupEnabled: false,
    warmupStartedAt: null,
    credentialRef: null,
    encryptedCredentials: null,
    tokenExpiresAt: null,
    lastSyncAt: null,
    syncCursor: null,
    providerAccountId: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as SendingAccount;
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  }
  for (const key of ENV_KEYS) {
    const saved = savedEnv.get(key);
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
  savedEnv.clear();
});

function setEnvMailbox() {
  process.env.UNIT_SMTP_HOST = "mail.env.example";
  process.env.UNIT_SMTP_PORT = "587";
  process.env.UNIT_SMTP_USER = "owner@env.example";
  process.env.UNIT_SMTP_PASS = "env-mailbox-password";
  process.env.UNIT_SMTP_SECURE = "false";
}

describe("mailbox credentials codec", () => {
  it("round-trips credentials without the password appearing in the blob", () => {
    const encrypted = encryptMailboxCredentials(STORED);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(encrypted).not.toContain(STORED.pass);
    expect(decryptMailboxCredentials(encrypted)).toEqual(STORED);
  });

  it("round-trips a mailbox with IMAP disabled", () => {
    const noImap: MailboxCredentials = { ...STORED, imap: null };
    expect(decryptMailboxCredentials(encryptMailboxCredentials(noImap))).toEqual(noImap);
  });

  it("rejects a tampered blob", () => {
    const encrypted = encryptMailboxCredentials(STORED);
    const raw = Buffer.from(encrypted.slice(3), "base64url");
    raw[raw.length - 1] = raw[raw.length - 1] ^ 0xff;
    const tampered = "v1." + raw.toString("base64url");
    expect(() => decryptMailboxCredentials(tampered)).toThrow(/authentication/);
  });

  it("rejects an encrypted blob whose JSON is not a mailbox shape", () => {
    const notMailbox = encryptSecret(JSON.stringify({ accessToken: "tok", expiresAt: "soon" }));
    expect(() => decryptMailboxCredentials(notMailbox)).toThrow(/malformed/);
    const badPort = encryptSecret(
      JSON.stringify({
        smtp: { host: "mail.example.com", port: 70000, secure: true },
        imap: null,
        user: "u",
        pass: "p",
      }),
    );
    expect(() => decryptMailboxCredentials(badPort)).toThrow(/malformed/);
  });
});

describe("mailbox credential resolution", () => {
  it("resolves stored credentials ahead of the environment", () => {
    setEnvMailbox();
    const resolved = resolveMailboxCredentials(
      account({
        credentialRef: "UNIT_SMTP",
        encryptedCredentials: encryptMailboxCredentials(STORED),
      }),
    );
    expect(resolved).toEqual(STORED);
  });

  it("falls back to the environment, with IMAP defaulting to the SMTP host on 993", () => {
    setEnvMailbox();
    const resolved = resolveMailboxCredentials(account({ credentialRef: "UNIT_SMTP" }));
    expect(resolved).toEqual({
      smtp: { host: "mail.env.example", port: 587, secure: false },
      imap: { host: "mail.env.example", port: 993, secure: true },
      user: "owner@env.example",
      pass: "env-mailbox-password",
    });
  });

  it("honours explicit IMAP environment overrides", () => {
    setEnvMailbox();
    process.env.UNIT_SMTP_IMAP_HOST = "imap.env.example";
    process.env.UNIT_SMTP_IMAP_PORT = "143";
    process.env.UNIT_SMTP_IMAP_SECURE = "false";
    const resolved = resolveMailboxCredentials(account({ credentialRef: "UNIT_SMTP" }));
    expect(resolved?.imap).toEqual({ host: "imap.env.example", port: 143, secure: false });
  });

  it("returns null when neither stored nor environment credentials exist", () => {
    expect(resolveMailboxCredentials(account({}))).toBeNull();
    expect(resolveMailboxCredentials(account({ credentialRef: "UNIT_SMTP" }))).toBeNull();
  });

  it("ignores a stored blob that is not a mailbox blob and uses the environment", () => {
    setEnvMailbox();
    const resolved = resolveMailboxCredentials(
      account({
        credentialRef: "UNIT_SMTP",
        encryptedCredentials: encryptSecret(
          JSON.stringify({ accessToken: "tok", expiresAt: "soon" }),
        ),
      }),
    );
    expect(resolved?.smtp.host).toBe("mail.env.example");
  });
});

describe("resolveProvider for SMTP accounts", () => {
  it("builds an SMTP provider from stored credentials", async () => {
    const provider = await resolveProvider(
      account({ encryptedCredentials: encryptMailboxCredentials(STORED) }),
    );
    expect(provider.id).toBe("smtp");
    expect(provider.isSimulation).toBe(false);
  });

  it("throws the clear not configured error when no credentials exist", async () => {
    await expect(resolveProvider(account({}))).rejects.toThrow(/SMTP is not configured/);
  });
});
