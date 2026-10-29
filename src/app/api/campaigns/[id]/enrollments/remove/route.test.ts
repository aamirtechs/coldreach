import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Enrollment removal. Prisma, session, and audit collaborators are
 * mocked in the same style as the threads bulk route test, against a
 * mutable fixture the deleteMany mock actually edits, so the tests
 * prove what survives each call. The fixture covers the guard's three
 * shapes: an uncontacted enrollment, one contacted by sequence step,
 * one contacted only by a SENT event, and one on another campaign.
 */

interface EnrollmentRow {
  id: string;
  campaignId: string;
  currentStep: number;
  lead: { email: string };
}

const mocks = vi.hoisted(() => {
  const campaigns = [
    { id: "camp-1", workspaceId: "ws-1" },
    { id: "camp-2", workspaceId: "ws-2" },
  ];
  const state: { enrollments: EnrollmentRow[]; sentEvents: Array<{ enrollmentId: string; type: string }> } = {
    enrollments: [],
    sentEvents: [],
  };
  function seed() {
    state.enrollments = [
      { id: "e1", campaignId: "camp-1", currentStep: 0, lead: { email: "ada@acme.com" } },
      { id: "e2", campaignId: "camp-1", currentStep: 0, lead: { email: "bob@acme.com" } },
      { id: "e3", campaignId: "camp-1", currentStep: 2, lead: { email: "carol@acme.com" } },
      { id: "e4", campaignId: "camp-2", currentStep: 0, lead: { email: "dan@other.example" } },
      { id: "e5", campaignId: "camp-1", currentStep: 0, lead: { email: "erin@acme.com" } },
    ];
    state.sentEvents = [{ enrollmentId: "e5", type: "SENT" }];
  }
  seed();
  const deleteMany = vi.fn(
    async ({ where }: { where: { campaignId: string; id: { in: string[] } } }) => {
      const before = state.enrollments.length;
      state.enrollments = state.enrollments.filter(
        (row) => !(row.campaignId === where.campaignId && where.id.in.includes(row.id)),
      );
      return { count: before - state.enrollments.length };
    },
  );
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
      findMany: vi.fn(
        async ({ where }: { where: { campaignId: string; id: { in: string[] } } }) =>
          state.enrollments.filter(
            (row) => row.campaignId === where.campaignId && where.id.in.includes(row.id),
          ),
      ),
      deleteMany,
    },
    emailEvent: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { enrollmentId: { in: Array<string | null> }; type: string };
        }) =>
          state.sentEvents.filter(
            (row) => row.type === where.type && where.enrollmentId.in.includes(row.enrollmentId),
          ),
      ),
    },
  };
  return {
    prisma,
    state,
    seed,
    deleteMany,
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
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { POST } from "./route";

function postRequest(body: Record<string, unknown>, campaignId = "camp-1"): Request {
  return new Request(`http://localhost/api/campaigns/${campaignId}/enrollments/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) });

const remainingIds = () => mocks.state.enrollments.map((row) => row.id);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.seed();
});

describe("POST /api/campaigns/[id]/enrollments/remove", () => {
  it("removes uncontacted enrollments and returns the removed count", async () => {
    const response = await POST(postRequest({ enrollmentIds: ["e1", "e2"] }), paramsFor("camp-1"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { removed: number; notFound: number };
    expect(payload).toEqual({ removed: 2, notFound: 0 });
    expect(remainingIds()).toEqual(["e3", "e4", "e5"]);
    expect(mocks.deleteMany).toHaveBeenCalledTimes(1);
    const call = mocks.deleteMany.mock.calls[0][0];
    expect(call.where.campaignId).toBe("camp-1");
    expect(call.where.id.in).toEqual(["e1", "e2"]);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "campaign.enrollments_removed",
        metadata: expect.objectContaining({
          campaignId: "camp-1",
          count: 2,
          emails: ["ada@acme.com", "bob@acme.com"],
        }),
      }),
    );
  });

  it("refuses the whole batch when one enrollment was contacted by step", async () => {
    const response = await POST(postRequest({ enrollmentIds: ["e1", "e3"] }), paramsFor("camp-1"));
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error: string; contacted: string[] };
    expect(payload.contacted).toEqual(["carol@acme.com"]);
    expect(payload.error).toContain("carol@acme.com");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(remainingIds()).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  it("refuses removal when a SENT event exists even at step zero", async () => {
    const response = await POST(postRequest({ enrollmentIds: ["e5"] }), paramsFor("camp-1"));
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { contacted: string[] };
    expect(payload.contacted).toEqual(["erin@acme.com"]);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(remainingIds()).toContain("e5");
  });

  it("reports ids from another campaign as notFound and deletes nothing", async () => {
    const response = await POST(postRequest({ enrollmentIds: ["e4"] }), paramsFor("camp-1"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { removed: number; notFound: number };
    expect(payload).toEqual({ removed: 0, notFound: 1 });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(remainingIds()).toContain("e4");
  });

  it("rejects an empty enrollment id list before changing anything", async () => {
    const response = await POST(postRequest({ enrollmentIds: [] }), paramsFor("camp-1"));
    expect(response.status).toBe(400);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("dedupes repeated ids so one enrollment is removed once", async () => {
    const response = await POST(postRequest({ enrollmentIds: ["e1", "e1"] }), paramsFor("camp-1"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { removed: number; notFound: number };
    expect(payload).toEqual({ removed: 1, notFound: 0 });
    expect(remainingIds()).not.toContain("e1");
  });
});
