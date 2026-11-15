import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The redeem route is OWNER gated through requireSession, rejects an
 * empty code, maps the key library's customer-safe errors to 400,
 * and audits the grant (plan and days, never the code).
 */

const mocks = vi.hoisted(() => ({
  sessionError: null as Response | null,
  writeAuditLog: vi.fn(async () => {}),
  redeemSubscriptionKey: vi.fn(async () => ({
    plan: "PRO" as const,
    planName: "Growth",
    durationDays: 30,
    currentPeriodEnd: new Date("2026-12-15T00:00:00.000Z"),
  })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

vi.mock("@/lib/billing/keys", () => ({
  redeemSubscriptionKey: mocks.redeemSubscriptionKey,
}));

vi.mock("@/lib/api", () => ({
  requireSession: vi.fn(async () => {
    if (mocks.sessionError) return { error: mocks.sessionError };
    return {
      ctx: {
        user: { id: "user-1", email: "owner@example.com", name: "Owner" },
        workspace: { id: "ws-1", name: "Acme" },
        role: "OWNER",
      },
    };
  }),
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
}));

import { POST } from "./route";

function post(body: unknown): Request {
  return new Request("http://test.local/api/billing/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.sessionError = null;
  vi.clearAllMocks();
});

describe("redeem route", () => {
  it("passes the session error through", async () => {
    mocks.sessionError = new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const response = await POST(post({ code: "CR-AB23-CD45-EF67-GH89" }));
    expect(response.status).toBe(401);
    expect(mocks.redeemSubscriptionKey).not.toHaveBeenCalled();
  });

  it("rejects an empty code", async () => {
    const response = await POST(post({ code: "  " }));
    expect(response.status).toBe(400);
  });

  it("redeems and audits the grant without the code", async () => {
    const response = await POST(post({ code: "CR-AB23-CD45-EF67-GH89" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.planName).toBe("Growth");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "billing.key_redeem" }),
    );
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("CR-AB23");
  });

  it("maps a used key to a 400 with the library's message", async () => {
    mocks.redeemSubscriptionKey.mockRejectedValueOnce(new Error("That key has already been used."));
    const response = await POST(post({ code: "CR-AB23-CD45-EF67-GH89" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("already been used");
  });
});
