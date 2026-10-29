import { describe, expect, it, vi } from "vitest";

/**
 * Enroll route: the cross-campaign duplicate guard contract. The
 * enroll library is mocked so the route's own behavior is what is
 * under test: passing force through from the request body, mapping a
 * 409 conflict error to a JSON body carrying the conflicts list, and
 * returning the enrollment result on success.
 */

const mocks = vi.hoisted(() => ({
  enrollCampaign: vi.fn(),
  requireSession: vi.fn(async () => ({
    ctx: {
      user: { id: "user-1" },
      workspace: { id: "ws-1" },
      role: "OWNER",
    },
  })),
  writeAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, requireSession: mocks.requireSession };
});
vi.mock("@/lib/campaigns/enroll", () => ({ enrollCampaign: mocks.enrollCampaign }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { POST } from "./route";

function request(body?: unknown) {
  return new Request("http://localhost/api/campaigns/camp-1/enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "camp-1" }) };

describe("POST /api/campaigns/[id]/enroll", () => {
  it("returns 409 with the conflicts list and enrolls nothing", async () => {
    mocks.enrollCampaign.mockRejectedValueOnce(
      Object.assign(new Error("1 lead is already enrolled in another campaign."), {
        status: 409,
        conflicts: [
          {
            leadId: "lead-1",
            email: "shared@acme.com",
            campaignName: "Other Campaign",
            status: "ACTIVE",
            contacted: true,
          },
        ],
      }),
    );
    const response = await POST(request(), params);
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.conflicts).toHaveLength(1);
    expect(data.conflicts[0]).toMatchObject({ email: "shared@acme.com", contacted: true });
    expect(mocks.enrollCampaign).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ campaignId: "camp-1", force: false }),
    );
  });

  it("passes force through and returns the enrollment on success", async () => {
    mocks.enrollCampaign.mockResolvedValueOnce({
      enrolled: 2,
      skippedSuppressed: 0,
      skippedDuplicate: 0,
      skippedIneligible: 0,
      skippedInvalidVerification: 0,
      enrolledRisky: 0,
      totalInList: 2,
    });
    const response = await POST(request({ force: true }), params);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.enrollment.enrolled).toBe(2);
    expect(mocks.enrollCampaign).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ force: true }),
    );
  });
});
