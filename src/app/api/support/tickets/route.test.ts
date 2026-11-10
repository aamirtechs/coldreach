import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Support ticket routes: session identity is the only identity.
 * Prisma, the session helper, audit, and product mail are mocked;
 * the real ticket module runs, so persistence shape, validation,
 * and the notification attempt are exercised end to end.
 */

const mocks = vi.hoisted(() => {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    supportTicket: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const ticket = {
          id: "ticket-1",
          status: "OPEN",
          createdAt: new Date("2026-11-10T00:00:00Z"),
          updatedAt: new Date("2026-11-10T00:00:00Z"),
          ...data,
        };
        created.push(data);
        return ticket;
      }),
      findMany: vi.fn(async () => []),
    },
  };
  return {
    prisma,
    created,
    session: { mode: "ok" as "ok" | "unauthorized", userId: "user-1" },
    sendProductEmail: vi.fn(
      async (_input: { to: string; subject: string; text: string; replyTo?: string }) => ({
        sent: false,
        reason: "not_configured",
      }),
    ),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

vi.mock("@/lib/mail/productMail", () => ({
  sendProductEmail: mocks.sendProductEmail,
  isProductMailConfigured: () => false,
  productMailFrom: () => "ColdReach <no-reply@aamirtechs.com>",
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));

vi.mock("@/lib/api", () => ({
  requireSession: vi.fn(async () => {
    if (mocks.session.mode === "unauthorized") {
      return {
        error: new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }
    return {
      ctx: {
        user: { id: mocks.session.userId, email: "member@example.com", name: "Member" },
        workspace: { id: "ws-1", name: "Acme" },
        role: "VIEWER",
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
}));

import { GET, POST } from "./route";
import { resetAuthRateLimits } from "@/lib/auth/rateLimit";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/support/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.created.length = 0;
  mocks.session.mode = "ok";
  mocks.session.userId = "user-1";
  resetAuthRateLimits();
  vi.clearAllMocks();
});

describe("POST /api/support/tickets", () => {
  it("requires a session", async () => {
    mocks.session.mode = "unauthorized";
    const response = await POST(
      postRequest({ subject: "Hi", category: "Billing", message: "Body" }),
    );
    expect(response.status).toBe(401);
    expect(mocks.created).toHaveLength(0);
  });

  it("creates a ticket stamped with the session identity, ignoring spoofed fields", async () => {
    const response = await POST(
      postRequest({
        subject: "Sends stopped",
        category: "Sending problem",
        message: "Nothing since 9am",
        userEmail: "spoof@example.com",
        workspaceId: "ws-other",
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.created).toHaveLength(1);
    expect(mocks.created[0]).toMatchObject({
      workspaceId: "ws-1",
      userId: "user-1",
      userEmail: "member@example.com",
      subject: "Sends stopped",
      category: "Sending problem",
    });
    // The notification attempt happened against the real mail seam
    // and its not-configured result did not fail the creation.
    expect(mocks.sendProductEmail).toHaveBeenCalledTimes(1);
    const mailInput = mocks.sendProductEmail.mock.calls[0][0];
    expect(mailInput.to).toBe("amir@aamirtechs.com");
    expect(mailInput.replyTo).toBe("member@example.com");
  });

  it("rejects an invalid category with a 400 and creates nothing", async () => {
    const response = await POST(
      postRequest({ subject: "Hi", category: "Nonsense", message: "Body" }),
    );
    expect(response.status).toBe(400);
    expect(mocks.created).toHaveLength(0);
  });

  it("rate limits repeated creation by the same user", async () => {
    mocks.session.userId = "user-flood";
    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const response = await POST(
        postRequest({ subject: `Ticket ${i}`, category: "Billing", message: "Body" }),
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
    expect(mocks.created).toHaveLength(5);
  });
});

describe("GET /api/support/tickets", () => {
  it("requires a session", async () => {
    mocks.session.mode = "unauthorized";
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
