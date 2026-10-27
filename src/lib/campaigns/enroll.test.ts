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
