import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Platform admin ticket routes are owner gated exactly like the
 * admin page: signed out is a 401, a signed-in customer is a 404,
 * and only the platform owner can list tickets or change a status.
 * The status set is OPEN, UNDER_PROCESS, and CLOSED; anything else
 * is rejected, and every accepted change writes an audit entry.
 */

const mocks = vi.hoisted(() => ({
  session: { email: null as string | null },
  writeAuditLog: vi.fn(async () => {}),
  prisma: {
    supportTicket: {
      findMany: vi.fn(async () => [
        {
          id: "ticket-1",
          workspaceId: "ws-1",
          userId: "user-9",
          subject: "Sends stopped",
          category: "Sending problem",
          message: "Nothing has gone out since this morning. Full body here.",
          userEmail: "member@example.com",
          status: "OPEN",
          createdAt: new Date("2026-11-10T00:00:00Z"),
          updatedAt: new Date("2026-11-10T01:00:00Z"),
          workspace: { name: "Acme" },
        },
      ]),
      update: vi.fn(async ({ data }: { data: { status: string } }) => ({
        id: "ticket-1",
        workspaceId: "ws-1",
        status: data.status,
      })),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

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
}));

import { GET, PATCH } from "./route";

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/support-tickets", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  process.env.PLATFORM_OWNER_EMAIL = "owner@example.com";
});

beforeEach(() => {
  mocks.session.email = null;
  vi.clearAllMocks();
});

describe("GET /api/admin/support-tickets", () => {
  it("answers 401 when signed out", async () => {
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("answers 404 for a signed-in customer", async () => {
    mocks.session.email = "customer@example.com";
    const response = await GET();
    expect(response.status).toBe(404);
    expect(mocks.prisma.supportTicket.findMany).not.toHaveBeenCalled();
  });

  it("lists tickets for the platform owner with the full message and workspace name", async () => {
    mocks.session.email = "owner@example.com";
    const response = await GET();
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      tickets: Array<{
        id: string;
        message: string;
        workspaceName: string;
        workspaceId: string;
        status: string;
      }>;
    };
    expect(data.tickets).toHaveLength(1);
    expect(data.tickets[0].message).toBe(
      "Nothing has gone out since this morning. Full body here.",
    );
    expect(data.tickets[0].workspaceName).toBe("Acme");
    expect(data.tickets[0].workspaceId).toBe("ws-1");
    expect(data.tickets[0].status).toBe("OPEN");
  });
});

describe("PATCH /api/admin/support-tickets", () => {
  it("answers 401 when signed out and changes nothing", async () => {
    const response = await PATCH(patchRequest({ id: "ticket-1", status: "CLOSED" }));
    expect(response.status).toBe(401);
    expect(mocks.prisma.supportTicket.update).not.toHaveBeenCalled();
  });

  it("answers 404 for a signed-in customer and changes nothing", async () => {
    mocks.session.email = "customer@example.com";
    const response = await PATCH(patchRequest({ id: "ticket-1", status: "CLOSED" }));
    expect(response.status).toBe(404);
    expect(mocks.prisma.supportTicket.update).not.toHaveBeenCalled();
  });

  it("lets the owner close a ticket", async () => {
    mocks.session.email = "owner@example.com";
    const response = await PATCH(patchRequest({ id: "ticket-1", status: "CLOSED" }));
    expect(response.status).toBe(200);
    expect(mocks.prisma.supportTicket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: { status: "CLOSED" },
    });
  });

  it("lets the owner mark a ticket under process", async () => {
    mocks.session.email = "owner@example.com";
    const response = await PATCH(patchRequest({ id: "ticket-1", status: "UNDER_PROCESS" }));
    expect(response.status).toBe(200);
    expect(mocks.prisma.supportTicket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: { status: "UNDER_PROCESS" },
    });
  });

  it("lets the owner reopen a ticket", async () => {
    mocks.session.email = "owner@example.com";
    const response = await PATCH(patchRequest({ id: "ticket-1", status: "OPEN" }));
    expect(response.status).toBe(200);
    expect(mocks.prisma.supportTicket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: { status: "OPEN" },
    });
  });

  it("writes an audit entry for a status change", async () => {
    mocks.session.email = "owner@example.com";
    const response = await PATCH(patchRequest({ id: "ticket-1", status: "UNDER_PROCESS" }));
    expect(response.status).toBe(200);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      action: "support.ticket.status",
      userId: "user-1",
      workspaceId: "ws-1",
      metadata: { ticketId: "ticket-1", status: "UNDER_PROCESS" },
    });
  });

  it("rejects an unknown status and writes no audit entry", async () => {
    mocks.session.email = "owner@example.com";
    const response = await PATCH(patchRequest({ id: "ticket-1", status: "PENDING" }));
    expect(response.status).toBe(400);
    expect(mocks.prisma.supportTicket.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
