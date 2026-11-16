import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bulk password route (v1.28.0) with the session, database, and the
 * bulk apply module mocked: the tests prove an admin session is
 * required, the body is validated, the account lookup is scoped to
 * the caller's workspace and to SMTP accounts, results are reported
 * per account, and the password never appears in any response.
 */

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  findMany: vi.fn(),
  applyPasswordToAccounts: vi.fn(),
  writeAuditLog: vi.fn(),
}));

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
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { sendingAccount: { findMany: mocks.findMany } },
}));

vi.mock("@/lib/accounts/bulkPassword", () => ({
  applyPasswordToAccounts: mocks.applyPasswordToAccounts,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

import { POST } from "./route";

const PASSWORD = "fake-shared-password-for-tests";
const SESSION = {
  ctx: { user: { id: "user-1" }, workspace: { id: "ws-1", name: "AamirTechs" } },
};

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/accounts/bulk-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(SESSION);
  mocks.writeAuditLog.mockResolvedValue(undefined);
  mocks.findMany.mockResolvedValue([
    { id: "a1", email: "one@example.com", encryptedCredentials: "blob-1" },
    { id: "a2", email: "two@example.com", encryptedCredentials: "blob-2" },
  ]);
  mocks.applyPasswordToAccounts.mockResolvedValue([
    { accountId: "a1", email: "one@example.com", ok: true },
    {
      accountId: "a2",
      email: "two@example.com",
      ok: false,
      error: "Authentication failed. Check the username and password.",
    },
  ]);
});

describe("POST /api/accounts/bulk-password", () => {
  it("requires an admin session", async () => {
    mocks.requireSession.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Sign in required" }), { status: 401 }),
    });
    const response = await POST(postRequest({ password: PASSWORD, accountIds: ["a1"] }));
    expect(response.status).toBe(401);
    expect(mocks.applyPasswordToAccounts).not.toHaveBeenCalled();
  });

  it("rejects a missing password and an empty selection", async () => {
    const noPassword = await POST(postRequest({ accountIds: ["a1"] }));
    expect(noPassword.status).toBe(400);
    const noAccounts = await POST(postRequest({ password: PASSWORD, accountIds: [] }));
    expect(noAccounts.status).toBe(400);
    expect(mocks.applyPasswordToAccounts).not.toHaveBeenCalled();
  });

  it("rejects the request when a selected account is not in the workspace", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "a1", email: "one@example.com", encryptedCredentials: "blob-1" },
    ]);
    const response = await POST(postRequest({ password: PASSWORD, accountIds: ["a1", "a2"] }));
    expect(response.status).toBe(400);
    expect(mocks.applyPasswordToAccounts).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the workspace and SMTP, applies, and reports per account without echoing the password", async () => {
    const response = await POST(postRequest({ password: PASSWORD, accountIds: ["a1", "a2"] }));
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-1", provider: "SMTP" }),
      }),
    );
    expect(mocks.applyPasswordToAccounts).toHaveBeenCalledWith(
      expect.anything(),
      [
        { id: "a1", email: "one@example.com", encryptedCredentials: "blob-1" },
        { id: "a2", email: "two@example.com", encryptedCredentials: "blob-2" },
      ],
      PASSWORD,
      undefined,
      undefined,
    );
    const text = await response.text();
    expect(text).not.toContain(PASSWORD);
    const payload = JSON.parse(text) as { connected: number; failed: number; results: unknown[] };
    expect(payload.connected).toBe(1);
    expect(payload.failed).toBe(1);
    expect(payload.results).toHaveLength(2);
  });

  it("passes a valid dailyLimit through as an option (v1.39.0)", async () => {
    const response = await POST(
      postRequest({ password: PASSWORD, accountIds: ["a1", "a2"], dailyLimit: 15 }),
    );
    expect(response.status).toBe(200);
    expect(mocks.applyPasswordToAccounts).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      PASSWORD,
      undefined,
      { dailyLimit: 15 },
    );
  });

  it("rejects an invalid dailyLimit without applying anything (v1.39.0)", async () => {
    for (const dailyLimit of [0, -3, 2.5, "15", 10001]) {
      const response = await POST(
        postRequest({ password: PASSWORD, accountIds: ["a1"], dailyLimit }),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.applyPasswordToAccounts).not.toHaveBeenCalled();
  });
});
