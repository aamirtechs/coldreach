import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The storage cleanup route is platform-owner gated like the rest of
 * the admin surface (signed out 401, customer 404), refuses deletes
 * without an explicit confirm flag, and refuses any reply
 * classification outside the AUTOMATED and NOT_FOUND allowlist, so a
 * crafted request can never delete human conversations.
 */

const mocks = vi.hoisted(() => ({
  session: { email: null as string | null },
  writeAuditLog: vi.fn(async () => {}),
  getCleanupStats: vi.fn(async () => ({ databaseBytes: null, attachments: {}, replies: {} })),
  deleteAttachments: vi.fn(async () => ({ deleted: 2, freedBytes: 500 })),
  deleteRepliesByClassification: vi.fn(async () => ({
    classification: "AUTOMATED",
    threads: 3,
    messages: 9,
  })),
  vacuumCleanupTables: vi.fn(async () => {}),
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
}));

vi.mock("@/lib/admin/cleanup", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin/cleanup")>();
  return {
    ...original,
    getCleanupStats: mocks.getCleanupStats,
    deleteAttachments: mocks.deleteAttachments,
    deleteRepliesByClassification: mocks.deleteRepliesByClassification,
    vacuumCleanupTables: mocks.vacuumCleanupTables,
  };
});

import { GET, POST } from "./route";

const OWNER = "owner@example.com";

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.email = null;
  process.env.PLATFORM_OWNER_EMAIL = OWNER;
});

describe("admin cleanup route gating", () => {
  it("returns 401 signed out and 404 for a customer", async () => {
    expect((await GET()).status).toBe(401);
    mocks.session.email = "customer@example.com";
    expect((await GET()).status).toBe(404);
    expect(
      (await POST(post({ action: "replies.delete", classification: "AUTOMATED", confirm: true })))
        .status,
    ).toBe(404);
    expect(mocks.deleteRepliesByClassification).not.toHaveBeenCalled();
  });

  it("serves stats to the platform owner", async () => {
    mocks.session.email = OWNER;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.getCleanupStats).toHaveBeenCalledTimes(1);
  });
});

describe("admin cleanup deletes", () => {
  it("refuses any delete without confirm: true", async () => {
    mocks.session.email = OWNER;
    const response = await POST(post({ action: "attachments.delete", ids: ["a-1"] }));
    expect(response.status).toBe(400);
    expect(mocks.deleteAttachments).not.toHaveBeenCalled();
  });

  it("deletes selected attachments and audits it", async () => {
    mocks.session.email = OWNER;
    const response = await POST(
      post({ action: "attachments.delete", ids: ["a-1", "a-2"], confirm: true }),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result).toEqual({ deleted: 2, freedBytes: 500 });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.cleanup.attachments_delete" }),
    );
  });

  it("refuses human classifications before touching the database", async () => {
    mocks.session.email = OWNER;
    const response = await POST(
      post({ action: "replies.delete", classification: "POSITIVE", confirm: true }),
    );
    expect(response.status).toBe(400);
    expect(mocks.deleteRepliesByClassification).not.toHaveBeenCalled();
  });

  it("deletes a machine classification and audits it", async () => {
    mocks.session.email = OWNER;
    const response = await POST(
      post({ action: "replies.delete", classification: "AUTOMATED", confirm: true }),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result.threads).toBe(3);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.cleanup.replies_delete" }),
    );
  });

  it("rejects unknown actions", async () => {
    mocks.session.email = OWNER;
    const response = await POST(post({ action: "everything.delete", confirm: true }));
    expect(response.status).toBe(400);
  });
});
