import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LeadStatus, LeadVerificationStatus, PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { enrollCampaign } from "./enroll";

/**
 * Phase 6 enrollment verification rules: leads whose verification
 * status is INVALID are skipped and counted; RISKY leads enroll and
 * are counted as flagged; every other lead behaves exactly as
 * before Phase 6.
 */
const DB_NAME = "test-enroll";
let db: PrismaClient;
let workspaceId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "enroll");
  workspaceId = seeded.workspace.id;
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

async function makeCampaignWithList(
  suffix: string,
  leads: { email: string; verificationStatus?: LeadVerificationStatus; status?: LeadStatus }[],
) {
  const list = await db.leadList.create({ data: { workspaceId, name: `List ${suffix}` } });
  for (const lead of leads) {
    await db.lead.create({
      data: {
        workspaceId,
        listId: list.id,
        email: lead.email,
        fields: { firstName: "Test" },
        tags: [],
        status: lead.status ?? "NEW",
        verificationStatus: lead.verificationStatus ?? "UNKNOWN",
      },
    });
  }
  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      name: `Campaign ${suffix}`,
      status: "DRAFT",
      timezone: "UTC",
      windowStart: "00:00",
      windowEnd: "23:59",
      businessDaysOnly: false,
      leadListId: list.id,
    },
  });
  await db.sequenceStep.create({
    data: {
      campaignId: campaign.id,
      order: 0,
      delayDays: 0,
      delayHours: 0,
      subject: "Hello {{firstName|there}}",
      body: "Body",
    },
  });
  return campaign;
}

describe("enrollCampaign verification handling", () => {
  it("skips INVALID leads with a count, enrolls RISKY leads with a flag count", async () => {
    const campaign = await makeCampaignWithList("verify", [
      { email: "valid@acme.com", verificationStatus: "VALID" },
      { email: "unknown@acme.com", verificationStatus: "UNKNOWN" },
      { email: "risky@acme.com", verificationStatus: "RISKY" },
      { email: "invalid@acme.com", verificationStatus: "INVALID" },
    ]);

    const result = await enrollCampaign(db, { workspaceId, campaignId: campaign.id });
    expect(result.enrolled).toBe(3);
    expect(result.skippedInvalidVerification).toBe(1);
    expect(result.enrolledRisky).toBe(1);
    expect(result.skippedSuppressed).toBe(0);
    expect(result.skippedDuplicate).toBe(0);

    const enrollments = await db.enrollment.findMany({
      where: { campaignId: campaign.id },
      include: { lead: { select: { email: true } } },
    });
    const enrolledEmails = enrollments.map((entry) => entry.lead.email).sort();
    expect(enrolledEmails).toEqual(["risky@acme.com", "unknown@acme.com", "valid@acme.com"]);
  });

  it("leaves campaigns without verification data exactly as before", async () => {
    const campaign = await makeCampaignWithList("plain", [
      { email: "one@acme.com" },
      { email: "two@acme.com" },
    ]);
    const result = await enrollCampaign(db, { workspaceId, campaignId: campaign.id });
    expect(result.enrolled).toBe(2);
    expect(result.skippedInvalidVerification).toBe(0);
    expect(result.enrolledRisky).toBe(0);
  });
});

describe("enrollCampaign per-lead timezone stamping (v1.5.0)", () => {
  it("stamps each lead's first send in its own timezone", async () => {
    const list = await db.leadList.create({ data: { workspaceId, name: "List tz-stamp" } });
    for (const lead of [
      { email: "us@acme.com", fields: { firstName: "Test", country: "United States" } },
      { email: "plain@acme.com", fields: { firstName: "Test" } },
    ]) {
      await db.lead.create({
        data: {
          workspaceId,
          listId: list.id,
          email: lead.email,
          fields: lead.fields,
          tags: [],
          status: "NEW",
          verificationStatus: "UNKNOWN",
        },
      });
    }
    const campaign = await db.campaign.create({
      data: {
        workspaceId,
        name: "Campaign tz-stamp",
        status: "DRAFT",
        timezone: "UTC",
        windowStart: "09:00",
        windowEnd: "17:00",
        businessDaysOnly: false,
        leadListId: list.id,
      },
    });
    await db.sequenceStep.create({
      data: {
        campaignId: campaign.id,
        order: 0,
        delayDays: 0,
        delayHours: 0,
        subject: "Hello",
        body: "Body",
      },
    });

    // Monday 2026-10-26 18:00 UTC is after the UTC window closes, but
    // 13:00 in Chicago, inside the US lead's local window.
    const now = new Date("2026-10-26T18:00:00Z");
    const result = await enrollCampaign(db, { workspaceId, campaignId: campaign.id, now });
    expect(result.enrolled).toBe(2);

    const enrollments = await db.enrollment.findMany({
      where: { campaignId: campaign.id },
      include: { lead: { select: { email: true } } },
    });
    const byEmail = new Map(enrollments.map((entry) => [entry.lead.email, entry.nextSendAt]));
    // US lead: due immediately, its local window is open right now.
    expect(byEmail.get("us@acme.com")?.toISOString()).toBe("2026-10-26T18:00:00.000Z");
    // No country on the lead: campaign zone rules, next UTC opening.
    expect(byEmail.get("plain@acme.com")?.toISOString()).toBe("2026-10-27T09:00:00.000Z");
  });
});

describe("enrollCampaign cross-campaign duplicate guard (v1.11.0)", () => {
  // A lead belongs to exactly one list, so two campaigns conflict
  // when they draw on the same list (the guard's production case:
  // one list feeding a second campaign while the first is live).
  async function makeSecondCampaignOnList(listId: string, suffix: string) {
    const campaign = await db.campaign.create({
      data: {
        workspaceId,
        name: `Campaign ${suffix}`,
        status: "DRAFT",
        timezone: "UTC",
        windowStart: "00:00",
        windowEnd: "23:59",
        businessDaysOnly: false,
        leadListId: listId,
      },
    });
    await db.sequenceStep.create({
      data: {
        campaignId: campaign.id,
        order: 0,
        delayDays: 0,
        delayHours: 0,
        subject: "Hello",
        body: "Body",
      },
    });
    return campaign;
  }

  it("refuses with 409 conflicts and enrolls nothing when a lead is in another campaign", async () => {
    const first = await makeCampaignWithList("guard-a", [{ email: "shared@acme.com" }]);
    const firstResult = await enrollCampaign(db, { workspaceId, campaignId: first.id });
    expect(firstResult.enrolled).toBe(1);
    // Mark the first enrollment as already contacted.
    await db.enrollment.updateMany({
      where: { campaignId: first.id },
      data: { currentStep: 1 },
    });

    const second = await makeSecondCampaignOnList(first.leadListId!, "guard-b");
    let thrown: unknown = null;
    try {
      await enrollCampaign(db, { workspaceId, campaignId: second.id });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error & { status?: number; conflicts?: Array<Record<string, unknown>> };
    expect(err.status).toBe(409);
    expect(err.conflicts).toHaveLength(1);
    expect(err.conflicts?.[0]).toMatchObject({
      email: "shared@acme.com",
      campaignName: first.name,
      contacted: true,
    });
    const secondEnrollments = await db.enrollment.findMany({
      where: { campaignId: second.id },
    });
    expect(secondEnrollments).toHaveLength(0);
  });

  it("enrolls with force despite the conflict", async () => {
    const first = await makeCampaignWithList("guard-c", [{ email: "forced@acme.com" }]);
    await enrollCampaign(db, { workspaceId, campaignId: first.id });
    const second = await makeSecondCampaignOnList(first.leadListId!, "guard-d");
    const result = await enrollCampaign(db, { workspaceId, campaignId: second.id, force: true });
    expect(result.enrolled).toBe(1);
  });

  it("does not treat enrollment in the same campaign as a conflict", async () => {
    const campaign = await makeCampaignWithList("guard-e", [{ email: "again@acme.com" }]);
    await enrollCampaign(db, { workspaceId, campaignId: campaign.id });
    const result = await enrollCampaign(db, { workspaceId, campaignId: campaign.id });
    expect(result.enrolled).toBe(0);
    expect(result.skippedDuplicate).toBe(1);
  });
});
