import { describe, expect, it, vi } from "vitest";

/**
 * Connection test route with the verifier module mocked: the tests
 * prove the response shapes for success and for an authentication
 * failure, that a session is required, and that the password never
 * appears in any response.
 */

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  testMailboxConnection: vi.fn(),
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
  stringField: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
  intField: (value: unknown, fallback: number) => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  },
}));

vi.mock("@/lib/accounts/testConnection", () => ({
  testMailboxConnection: mocks.testMailboxConnection,
}));

import { POST } from "./route";

const PASSWORD = "fake-password-for-connection-tests";

function postRequest(): Request {
  return new Request("http://localhost/api/accounts/test-connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "owner@example.com",
      smtpHost: "mail.example.com",
      smtpPort: 465,
      smtpSecure: true,
      imapHost: "mail.example.com",
      imapPort: 993,
      imapSecure: true,
      password: PASSWORD,
    }),
  });
}

function signedIn() {
  mocks.requireSession.mockResolvedValue({
    ctx: { user: { id: "user-1" }, workspace: { id: "ws-1" }, role: "ADMIN" },
  });
}

describe("POST /api/accounts/test-connection", () => {
  it("answers 401 without a session and never calls the verifier", async () => {
    mocks.requireSession.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const response = await POST(postRequest());
    expect(response.status).toBe(401);
    expect(mocks.testMailboxConnection).not.toHaveBeenCalled();
  });

  it("returns the per protocol success shape", async () => {
    signedIn();
    mocks.testMailboxConnection.mockResolvedValue({
      smtp: { ok: true },
      imap: { ok: true },
    });
    const response = await POST(postRequest());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ smtp: { ok: true }, imap: { ok: true } });
    expect(JSON.stringify(payload)).not.toContain(PASSWORD);
    // The route parsed the posted fields into mailbox credentials.
    const credentials = mocks.testMailboxConnection.mock.calls[0][0] as {
      smtp: { host: string };
      user: string;
    };
    expect(credentials.smtp.host).toBe("mail.example.com");
    expect(credentials.user).toBe("owner@example.com");
  });

  it("returns the per protocol failure shape for an authentication failure", async () => {
    signedIn();
    mocks.testMailboxConnection.mockResolvedValue({
      smtp: { ok: false, error: "Authentication failed. Check the username and password." },
      imap: { ok: false, error: "Authentication failed. Check the username and password." },
    });
    const response = await POST(postRequest());
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      smtp: { ok: boolean; error?: string };
      imap: { ok: boolean; error?: string };
    };
    expect(payload.smtp.ok).toBe(false);
    expect(payload.smtp.error).toMatch(/Authentication failed/);
    expect(payload.imap.ok).toBe(false);
    expect(JSON.stringify(payload)).not.toContain(PASSWORD);
  });
});
