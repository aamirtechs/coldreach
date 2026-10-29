import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Enrollment list for the campaign detail page. Prisma and session
 * collaborators are mocked in the same style as the threads bulk
 * route test. The fixture has two enrollments on the session
 * workspace's campaign and one on another workspace's campaign, so
 * the tests prove the list is scoped through the campaign's tenant.
 */

const mocks = vi.hoisted(() => {
  const campaigns = [
    { id: "camp-1", workspaceId: "ws-1" },
    { id: "camp-2", workspaceId: "ws-2" },
  ];
  const enrollments = [
    {
      id: "e1",
      campaignId: "camp-1",
      status: "ACTIVE",
      currentStep: 0,
      enrolledAt: new Date("2026-10-01T00:00:00Z"),
      lead: {
        id: "lead-1",
        email: "ada@acme.com",
        fields: { firstName: "Ada", lastName: "Lovelace", company: "Acme", segment: "Carrier" },
      },
    },
    {
      id: "e2",
      campaignId: "camp-1",
      status: "ACTIVE",
      currentStep: 1,
      enrolledAt: new Date("2026-10-02T00:00:00Z"),
      lead: {
        id: "lead-2",
        email: "bob@broker.example",
        fields: { firstName: "Bob", company: "Broker Co", segment: "Broker" },
      },
    },
    {
      id: "e3",
      campaignId: "camp-2",
      status: "ACTIVE",
      currentStep: 0,
      enrolledAt: new Date("2026-10-03T00:00:00Z"),
      lead: { id: "lead-3", email: "eve@other.example", fields: {} },
    },
  ];
  const prisma = {
    campaign: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; workspaceId: string } }) =>
          campaigns.find(
            (row) => row.id === where.id && row.workspaceId === where.workspaceId,
          ) ?? null,
      ),
    },
    enrollment: {
      count: vi.fn(
        async ({ where }: { where: { campaignId: string } }) =>
          enrollments.filter((row) => row.campaignId === where.campaignId).length,
      ),
      findMany: vi.fn(
        async ({
          where,
          skip = 0,
          take,
        }: {
          where: { campaignId: string };
          skip?: number;
          take?: number;
        }) =>
          enrollments
            .filter((row) => row.campaignId === where.campaignId)
            .slice(skip, take === undefined ? undefined : skip + take),
      ),
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
  stringField: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
}));

import { GET } from "./route";

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/campaigns/camp-1/enrollments${query}`);
}

const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) });

interface ListPayload {
  total: number;
  enrollments: Array<{
    id: string;
    status: string;
    currentStep: number;
    lead: {
      email: string;
      firstName: string | null;
      company: string | null;
      fields: Record<string, unknown>;
    };
  }>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/campaigns/[id]/enrollments", () => {
  it("returns workspace-scoped enrollments with lead data", async () => {
    const response = await GET(getRequest(), paramsFor("camp-1"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as ListPayload;
    expect(payload.total).toBe(2);
    expect(payload.enrollments.map((row) => row.id)).toEqual(["e1", "e2"]);
    const first = payload.enrollments[0];
    expect(first.lead.email).toBe("ada@acme.com");
    expect(first.lead.firstName).toBe("Ada");
    expect(first.lead.company).toBe("Acme");
    expect(first.lead.fields.segment).toBe("Carrier");
    expect(payload.enrollments[1].currentStep).toBe(1);
  });

  it("paginates with limit and offset while total stays the full count", async () => {
    const response = await GET(getRequest("?limit=1&offset=1"), paramsFor("camp-1"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as ListPayload;
    expect(payload.total).toBe(2);
    expect(payload.enrollments.map((row) => row.id)).toEqual(["e2"]);
  });

  it("returns 404 for another workspace's campaign", async () => {
    const response = await GET(getRequest(), paramsFor("camp-2"));
    expect(response.status).toBe(404);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe("Campaign not found");
  });
});
