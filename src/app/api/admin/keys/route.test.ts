import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The admin subscription keys route is platform-owner gated like the
 * rest of the admin surface (signed out 401, customer 404), returns
 * generated codes exactly once in the generate response, and refuses
 * a revoke without an explicit confirm flag.
 */

const mocks = vi.hoisted(() => ({
  session: { email: null as string | null },
  writeAuditLog: vi.fn(async () => {}),
  generateSubscriptionKeys: vi.fn(async () => [
    { id: "key-1", code: "CR-AB23-CD45-EF67-GH89", plan: "PRO", durationDays: 30 },
  ]),
  listSubscriptionKeys: vi.fn(async () => ({ keys: [], counts: { UNUSED: 1, REDEEMED: 0, REVOKED: 0 } })),
  revokeSubscriptionKey: vi.fn(async () => ({ id: "key-1", codeHint: "CR-AB23-****-****-GH89", plan: "PRO" })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

vi.mock("@/lib/auth/session", () => ({
  getSessionWorkspace: vi.fn(async () => {
    if (!mocks.session.email) return null;
    return {
      user: { id: "user-1", email: mocks.session.email, name: "User" },
      workspace: { id: "ws-1", name: "Acme" },
      role: "OWNER",
    };
  }),
}));

vi.mock("@/lib/api", () => ({
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

vi.mock("@/lib/billing/keys", () => ({
  generateSubscriptionKeys: mocks.generateSubscriptionKeys,
  listSubscriptionKeys: mocks.listSubscriptionKeys,
  revokeSubscriptionKey: mocks.revokeSubscriptionKey,
}));

import { GET, POST } from "./route";

const OWNER = "owner@example.com";
process.env.PLATFORM_OWNER_EMAIL = OWNER;

function post(body: unknown): Request {
  return new Request("http://test.local/api/admin/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.session.email = null;
  vi.clearAllMocks();
});

describe("admin keys route gating", () => {
  it("answers 401 when signed out", async () => {
    const response = await GET(new Request("http://test.local/api/admin/keys"));
    expect(response.status).toBe(401);
  });

  it("answers 404 for a signed-in customer", async () => {
    mocks.session.email = "customer@example.com";
    const response = await GET(new Request("http://test.local/api/admin/keys"));
    expect(response.status).toBe(404);
  });
});

describe("admin keys actions", () => {
  it("generates keys for the owner and audits counts only", async () => {
    mocks.session.email = OWNER;
    const response = await POST(post({ action: "generate", plan: "PRO", count: 1, durationDays: 30 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generated[0].code).toBe("CR-AB23-CD45-EF67-GH89");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.keys.generate" }),
    );
    const auditJson = JSON.stringify(mocks.writeAuditLog.mock.calls);
    expect(auditJson).not.toContain("CR-AB23-CD45-EF67-GH89");
  });

  it("refuses to generate FREE keys", async () => {
    mocks.session.email = OWNER;
    const response = await POST(post({ action: "generate", plan: "FREE", count: 1 }));
    expect(response.status).toBe(400);
    expect(mocks.generateSubscriptionKeys).not.toHaveBeenCalled();
  });

  it("refuses a revoke without confirm", async () => {
    mocks.session.email = OWNER;
    const response = await POST(post({ action: "revoke", id: "key-1" }));
    expect(response.status).toBe(400);
    expect(mocks.revokeSubscriptionKey).not.toHaveBeenCalled();
  });

  it("revokes with confirm and audits the hint", async () => {
    mocks.session.email = OWNER;
    const response = await POST(post({ action: "revoke", id: "key-1", confirm: true }));
    expect(response.status).toBe(200);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.keys.revoke" }),
    );
  });
});
