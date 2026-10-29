import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Generate-icebreakers route: AI gating, skip behavior, and per-lead
 * failure isolation. Prisma, the session, the workspace AI resolver,
 * and fetch are mocked in the repo's route-test style.
 */

const mocks = vi.hoisted(() => ({
  prisma: {
    leadList: { findFirst: vi.fn() },
    lead: { findMany: vi.fn(), update: vi.fn(async (_args: unknown) => ({})) },
  },
  requireSession: vi.fn(async () => ({
    ctx: { user: { id: "user-1" }, workspace: { id: "ws-1" }, role: "OWNER" },
  })),
  resolveWorkspaceAi: vi.fn(),
  writeAuditLog: vi.fn(async () => undefined),
  icebreaker: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, requireSession: mocks.requireSession };
});
vi.mock("@/lib/ai/workspaceAi", () => ({ resolveWorkspaceAi: mocks.resolveWorkspaceAi }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "list-1" }) };
const request = () => new Request("http://localhost/api/lead-lists/list-1/generate-icebreakers", { method: "POST" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function lead(id: string, fields: Record<string, unknown>) {
  return { id, email: `${id}@acme.example`, fields };
}

describe("POST /api/lead-lists/[id]/generate-icebreakers", () => {
  it("returns a clear 400 when AI is not configured for the workspace", async () => {
    mocks.prisma.leadList.findFirst.mockResolvedValue({ id: "list-1" });
    mocks.resolveWorkspaceAi.mockResolvedValue(null);
    const response = await POST(request(), params);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("AI is not configured");
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it("404s for a list outside the workspace", async () => {
    mocks.prisma.leadList.findFirst.mockResolvedValue(null);
    const response = await POST(request(), params);
    expect(response.status).toBe(404);
  });

  it("generates for leads missing an icebreaker and skips the rest", async () => {
    mocks.prisma.leadList.findFirst.mockResolvedValue({ id: "list-1" });
    mocks.resolveWorkspaceAi.mockResolvedValue({
      configured: true,
      provider: { icebreaker: mocks.icebreaker },
    });
    mocks.icebreaker.mockResolvedValue('"Your dispatch notes mention hand-built packets."');
    mocks.prisma.lead.findMany.mockResolvedValue([
      lead("lead-1", { company: "Acme", website: "https://acme.example" }),
      lead("lead-2", { company: "Beta", icebreaker: "Already written." }),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => "<html><body><p>Acme moves freight by hand.</p></body></html>",
      })),
    );
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ generated: 1, skipped: 1, failed: 0, remaining: 0 });
    expect(mocks.prisma.lead.update).toHaveBeenCalledTimes(1);
    const updateArgs = mocks.prisma.lead.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { fields: { icebreaker: string } };
    };
    expect(updateArgs.where).toEqual({ id: "lead-1" });
    expect(updateArgs.data.fields.icebreaker).toBe("Your dispatch notes mention hand-built packets.");
    const context = mocks.icebreaker.mock.calls[0]?.[0] as {
      leadFields: Record<string, string>;
    };
    expect(context.leadFields.websiteExcerpt).toContain("Acme moves freight by hand.");
  });

  it("isolates a provider failure to its lead and counts it as remaining", async () => {
    mocks.prisma.leadList.findFirst.mockResolvedValue({ id: "list-1" });
    mocks.resolveWorkspaceAi.mockResolvedValue({
      configured: true,
      provider: { icebreaker: mocks.icebreaker },
    });
    mocks.icebreaker
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce("A clean specific line.");
    mocks.prisma.lead.findMany.mockResolvedValue([
      lead("lead-1", { company: "Acme" }),
      lead("lead-2", { company: "Beta" }),
    ]);
    const response = await POST(request(), params);
    const data = await response.json();
    expect(data).toEqual({ generated: 1, skipped: 0, failed: 1, remaining: 1 });
    expect(mocks.prisma.lead.update).toHaveBeenCalledTimes(1);
  });

  it("processes at most 25 leads per call", async () => {
    mocks.prisma.leadList.findFirst.mockResolvedValue({ id: "list-1" });
    mocks.resolveWorkspaceAi.mockResolvedValue({
      configured: true,
      provider: { icebreaker: mocks.icebreaker },
    });
    mocks.icebreaker.mockResolvedValue("One line.");
    mocks.prisma.lead.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => lead(`lead-${i}`, { company: `C${i}` })),
    );
    const response = await POST(request(), params);
    const data = await response.json();
    expect(data.generated).toBe(25);
    expect(data.remaining).toBe(5);
  });
});
