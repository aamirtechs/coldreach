import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bulk thread actions. Session, Prisma, and audit collaborators are
 * mocked in the same style as the accounts route test. The fixture has
 * two threads in the session workspace and one in another workspace, so
 * the tests prove a crafted id list cannot touch another tenant.
 */

const mocks = vi.hoisted(() => {
  const fixture = [
    { id: "t1", workspaceId: "ws-1" },
    { id: "t2", workspaceId: "ws-1" },
    { id: "t3", workspaceId: "ws-2" },
  ];
  const updateMany = vi.fn(
    async ({ where, data }: { where: { workspaceId: string; id: { in: string[] } }; data: { unread: boolean } }) => {
      const matched = fixture.filter(
        (row) => row.workspaceId === where.workspaceId && where.id.in.includes(row.id),
      );
      return { count: matched.length };
    },
  );
  const prisma = {
    thread: {
      findMany: vi.fn(async ({ where }: { where: { workspaceId: string; id: { in: string[] } } }) =>
        fixture
          .filter((row) => row.workspaceId === where.workspaceId && where.id.in.includes(row.id))
          .map((row) => ({ id: row.id })),
      ),
      updateMany,
    },
  };
  return {
    prisma,
    updateMany,
    writeAuditLog: vi.fn(async () => undefined),
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
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { POST } from "./route";

function postRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/threads/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/threads/bulk", () => {
  it("mark_read updates only workspace-owned threads", async () => {
    const response = await POST(postRequest({ action: "mark_read", threadIds: ["t1", "t2", "t3"] }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { updated: number };
    expect(payload.updated).toBe(2);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    const call = mocks.updateMany.mock.calls[0][0];
    expect(call.where.workspaceId).toBe("ws-1");
    expect(call.where.id.in).toEqual(["t1", "t2"]);
    expect(call.data).toEqual({ unread: false });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "thread.bulk_mark_read" }),
    );
  });

  it("mark_unread sets unread back on owned threads", async () => {
    const response = await POST(postRequest({ action: "mark_unread", threadIds: ["t1"] }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { updated: number };
    expect(payload.updated).toBe(1);
    expect(mocks.updateMany.mock.calls[0][0].data).toEqual({ unread: true });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "thread.bulk_mark_unread" }),
    );
  });

  it("rejects an empty thread id list before changing anything", async () => {
    const response = await POST(postRequest({ action: "mark_read", threadIds: [] }));
    expect(response.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown action", async () => {
    const response = await POST(postRequest({ action: "delete", threadIds: ["t1"] }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/Unknown bulk action/);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
