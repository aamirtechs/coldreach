import { describe, expect, it, vi } from "vitest";

/**
 * Enroll route: the cross-campaign duplicate rule contract
 * (v1.27.0). The enroll library is mocked so the route's own
 * behavior is what is under test: passing force through from the
 * request body, and returning the enrollment result, whose
 * conflicts list names the leads skipped as already enrolled in
 * another campaign.
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
  it("returns the enrollment with cross-campaign skips and their conflicts", async () => {
    mocks.enrollCampaign.mockResolvedValueOnce({
      enrolled: 1,
      skippedSuppressed: 0,
      skippedDuplicate: 0,
      skippedIneligible: 0,
      skippedInvalidVerification: 0,
      enrolledRisky: 0,
      skippedCrossCampaign: 1,
      conflicts: [
        {
          leadId: "lead-1",
          email: "shared@acme.com",
          campaignName: "Other Campaign",
          status: "ACTIVE",
          contacted: true,
        },
      ],
      totalInList: 2,
    });
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.enrollment.enrolled).toBe(1);
    expect(data.enrollment.skippedCrossCampaign).toBe(1);
    expect(data.enrollment.conflicts).toHaveLength(1);
    expect(data.enrollment.conflicts[0]).toMatchObject({ email: "shared@acme.com", contacted: true });
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
      skippedCrossCampaign: 0,
      conflicts: [],
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
