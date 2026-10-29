import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Inbox snippets. Session, Prisma, and audit collaborators are mocked
 * in the same style as the bulk threads route test. The fixture has two
 * snippets in the session workspace and one in another workspace, so
 * the tests prove listing, creating, and deleting cannot cross tenants.
 */

const mocks = vi.hoisted(() => {
  const fixture = [
    {
      id: "sn-1",
      workspaceId: "ws-1",
      title: "Pricing follow up",
      body: "Sharing our pricing details here.",
      createdById: "user-1",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    },
    {
      id: "sn-2",
      workspaceId: "ws-1",
      title: "Intro thanks",
      body: "Thanks for getting back to us.",
      createdById: "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: "sn-3",
      workspaceId: "ws-2",
      title: "Another workspace snippet",
      body: "This belongs to a different workspace.",
      createdById: "user-9",
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    },
  ];
  const findMany = vi.fn(
    async ({
      where,
    }: {
      where: { workspaceId: string };
      orderBy?: { title: string };
      select?: Record<string, boolean>;
    }) =>
      fixture
        .filter((row) => row.workspaceId === where.workspaceId)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((row) => ({
          id: row.id,
          title: row.title,
          body: row.body,
          createdById: row.createdById,
          createdAt: row.createdAt,
        })),
  );
  const findFirst = vi.fn(
    async ({ where }: { where: { id: string; workspaceId: string } }) =>
      fixture.find((row) => row.id === where.id && row.workspaceId === where.workspaceId) ?? null,
  );
  const create = vi.fn(
    async ({
      data,
    }: {
      data: { workspaceId: string; title: string; body: string; createdById: string };
    }) => ({
      id: "sn-new",
      title: data.title,
      body: data.body,
      createdById: data.createdById,
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
    }),
  );
  const deleteSnippet = vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
  const prisma = {
    snippet: {
      findMany,
      findFirst,
      create,
      delete: deleteSnippet,
    },
  };
  return {
    prisma,
    findMany,
    findFirst,
    create,
    deleteSnippet,
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

import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";

function postRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/snippets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/snippets", () => {
  it("lists only the session workspace snippets, ordered by title", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      snippets: Array<{ id: string; title: string; body: string; createdById: string }>;
    };
    expect(payload.snippets.map((snippet) => snippet.id)).toEqual(["sn-2", "sn-1"]);
    expect(payload.snippets[0]).toMatchObject({
      title: "Intro thanks",
      body: "Thanks for getting back to us.",
      createdById: "user-1",
    });
    expect(mocks.requireSession).toHaveBeenCalledWith("VIEWER");
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    const call = mocks.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ workspaceId: "ws-1" });
    expect(call.orderBy).toEqual({ title: "asc" });
  });
});

describe("POST /api/snippets", () => {
  it("rejects a missing title before creating anything", async () => {
    const response = await POST(postRequest({ body: "Some reusable text." }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/title is required/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a missing body before creating anything", async () => {
    const response = await POST(postRequest({ title: "Greeting" }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/body is required/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a title longer than 120 characters", async () => {
    const response = await POST(
      postRequest({ title: "t".repeat(121), body: "Some reusable text." }),
    );
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a body longer than 4000 characters", async () => {
    const response = await POST(postRequest({ title: "Greeting", body: "b".repeat(4001) }));
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates a snippet in the session workspace and audits it", async () => {
    const response = await POST(
      postRequest({ title: "Greeting", body: "Thanks for getting back to us." }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      snippet: { id: string; title: string; body: string; createdById: string };
    };
    expect(payload.snippet).toMatchObject({
      id: "sn-new",
      title: "Greeting",
      body: "Thanks for getting back to us.",
      createdById: "user-1",
    });
    expect(mocks.requireSession).toHaveBeenCalledWith("MEMBER");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].data).toEqual({
      workspaceId: "ws-1",
      title: "Greeting",
      body: "Thanks for getting back to us.",
      createdById: "user-1",
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "snippet.create",
        userId: "user-1",
        workspaceId: "ws-1",
        metadata: { snippetId: "sn-new" },
      }),
    );
  });
});

describe("DELETE /api/snippets/[id]", () => {
  it("returns 404 for a snippet from another workspace and deletes nothing", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/snippets/sn-3", { method: "DELETE" }),
      deleteParams("sn-3"),
    );
    expect(response.status).toBe(404);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/Snippet not found/);
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "sn-3", workspaceId: "ws-1" });
    expect(mocks.deleteSnippet).not.toHaveBeenCalled();
  });

  it("deletes a snippet owned by the session workspace and audits it", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/snippets/sn-1", { method: "DELETE" }),
      deleteParams("sn-1"),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { deleted: boolean };
    expect(payload.deleted).toBe(true);
    expect(mocks.deleteSnippet).toHaveBeenCalledWith({ where: { id: "sn-1" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "snippet.delete",
        userId: "user-1",
        workspaceId: "ws-1",
        metadata: { snippetId: "sn-1" },
      }),
    );
  });
});
