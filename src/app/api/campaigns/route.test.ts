import { describe, expect, it, vi } from "vitest";

/**
 * Campaigns list progress aggregates. Session, Prisma, and audit
 * collaborators are mocked in the same style as the accounts route
 * test. One campaign has contacted enrollments and SENT events, the
 * other has none, so the defaults are covered too.
 */

const mocks = vi.hoisted(() => {
  const prisma = {
    campaign: {
      findMany: vi.fn(async () => [
        {
          id: "camp-1",
          name: "First",
          status: "RUNNING",
          timezone: "UTC",
          leadList: { id: "list-1", name: "List" },
          _count: { steps: 3, enrollments: 10 },
          createdAt: new Date("2026-10-27T00:00:00Z"),
        },
        {
          id: "camp-2",
          name: "Second",
          status: "DRAFT",
          timezone: "UTC",
          leadList: null,
          _count: { steps: 1, enrollments: 0 },
          createdAt: new Date("2026-10-27T00:00:00Z"),
        },
      ]),
    },
    enrollment: {
      groupBy: vi.fn(
        async (_args: { where: { currentStep: { gte: number }; campaignId: { in: string[] } } }) => [
          { campaignId: "camp-1", _count: { _all: 4 } },
        ],
      ),
    },
    emailEvent: {
      groupBy: vi.fn(async (_args: { where: { type: string } }) => [
        { campaignId: "camp-1", _count: { _all: 9 } },
      ]),
    },
  };
  return {
    prisma,
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

vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn(async () => undefined) }));

import { GET } from "./route";

describe("GET /api/campaigns progress fields", () => {
  it("adds contacted, remaining, and sent counts per campaign", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      campaigns: Array<{
        id: string;
        enrollmentCount: number;
        contactedCount: number;
        notContactedCount: number;
        sentCount: number;
      }>;
    };
    const first = payload.campaigns.find((c) => c.id === "camp-1");
    expect(first).toMatchObject({
      enrollmentCount: 10,
      contactedCount: 4,
      notContactedCount: 6,
      sentCount: 9,
    });
    const second = payload.campaigns.find((c) => c.id === "camp-2");
    expect(second).toMatchObject({ contactedCount: 0, notContactedCount: 0, sentCount: 0 });

    const enrollmentCall = mocks.prisma.enrollment.groupBy.mock.calls[0][0];
    expect(enrollmentCall.where.currentStep).toEqual({ gte: 1 });
    expect(enrollmentCall.where.campaignId.in).toEqual(["camp-1", "camp-2"]);
    const eventCall = mocks.prisma.emailEvent.groupBy.mock.calls[0][0];
    expect(eventCall.where.type).toBe("SENT");
  });
});
