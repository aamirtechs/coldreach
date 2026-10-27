import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptMailboxCredentials } from "@/lib/providers/smtp";

/**
 * Account create route with mailbox fields. Session, Prisma, plan,
 * and audit collaborators are mocked; the encryption is real, so the
 * test proves the stored blob decrypts back to what was entered and
 * that neither the blob nor the password appears in the response.
 */

const mocks = vi.hoisted(() => {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    sendingAccount: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const account = {
          id: "acct-mailbox-1",
          createdAt: new Date("2026-10-27T00:00:00Z"),
          updatedAt: new Date("2026-10-27T00:00:00Z"),
          warmupEnabled: false,
          warmupStartedAt: null,
          tokenExpiresAt: null,
          lastSyncAt: null,
          syncCursor: null,
          providerAccountId: null,
          ...data,
        };
        created.push(account);
        return account;
      }),
    },
  };
  return {
    created,
    prisma,
    requireSession: vi.fn(async () => ({
      ctx: {
        user: { id: "user-1" },
        workspace: { id: "ws-1" },
        role: "OWNER",
      },
    })),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

vi.mock("@/lib/api", () => ({
  requireSession: mocks.requireSession,
  apiError: (error: unknown) =>
    new Response(JSON.stringify({ error: error instanceof Error ? error.message : "error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }),
  readJson: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  },
  stringField: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
  intField: (value: unknown, fallback: number) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  },
}));

vi.mock("@/lib/billing/subscription", () => ({
  getPlanForWorkspace: async () => ({
    id: "PRO",
    name: "Pro",
    priceMonthlyUsd: 79,
    seats: 15,
    sendingAccounts: 15,
    monthlySends: 50000,
  }),
  getWorkspaceUsage: async () => ({ sendingAccounts: 0 }),
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn(async () => undefined) }));

import { POST } from "./route";

const PASSWORD = "fake-cpanel-password-for-tests";
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  }
});

function postRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/accounts with mailbox fields", () => {
  it("stores encrypted mailbox credentials and returns no secret material", async () => {
    const response = await POST(
      postRequest({
        email: "Owner@Example.com",
        displayName: "Owner",
        provider: "SMTP",
        dailyLimit: 40,
        smtpHost: "mail.example.com",
        smtpPort: 465,
        smtpSecure: true,
        password: PASSWORD,
      }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      account: Record<string, unknown>;
    };
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain("encryptedCredentials");
    expect(payload.account.status).toBe("CONNECTED");
    expect(payload.account.credentialRef).toBeNull();
    expect(payload.account.hasStoredCredentials).toBe(true);
    expect(payload.account.email).toBe("owner@example.com");

    expect(mocks.created).toHaveLength(1);
    const stored = mocks.created[0];
    expect(stored.credentialRef).toBeNull();
    expect(typeof stored.encryptedCredentials).toBe("string");
    expect(stored.encryptedCredentials).not.toContain(PASSWORD);
    const decrypted = decryptMailboxCredentials(stored.encryptedCredentials as string);
    expect(decrypted).toEqual({
      smtp: { host: "mail.example.com", port: 465, secure: true },
      // IMAP defaults: the SMTP host, port 993, implicit TLS.
      imap: { host: "mail.example.com", port: 993, secure: true },
      // The username defaults to the account email (the cPanel rule).
      user: "owner@example.com",
      pass: PASSWORD,
    });
  });

  it("rejects a mailbox account that also carries a credentialRef", async () => {
    const response = await POST(
      postRequest({
        email: "second@example.com",
        provider: "SMTP",
        credentialRef: "LEGACY_SMTP",
        smtpHost: "mail.example.com",
        password: PASSWORD,
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.created).toHaveLength(1);
  });

  it("rejects invalid mailbox fields before storing anything", async () => {
    const response = await POST(
      postRequest({
        email: "third@example.com",
        provider: "SMTP",
        smtpHost: "mail.example.com",
        smtpPort: 70000,
        password: PASSWORD,
      }),
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/SMTP port/);
    expect(JSON.stringify(payload)).not.toContain(PASSWORD);
    expect(mocks.created).toHaveLength(1);
  });
});
