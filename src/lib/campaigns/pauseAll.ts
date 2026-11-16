import type { PrismaClient } from "@prisma/client";

/**
 * Pause-all for the Campaigns page (v1.37.0).
 *
 * Pauses every campaign in the workspace that could still send:
 * RUNNING and SCHEDULED, the same from-states the single campaign
 * pause allows. DRAFT campaigns are not sending, PAUSED ones are
 * already paused, and ARCHIVED ones are closed. Enrollments are
 * untouched, so resuming a campaign later picks its queue back up
 * exactly where it stopped. Returns how many campaigns paused.
 */
export async function pauseAllCampaigns(
  db: PrismaClient,
  workspaceId: string,
): Promise<number> {
  const result = await db.campaign.updateMany({
    where: { workspaceId, status: { in: ["RUNNING", "SCHEDULED"] } },
    data: { status: "PAUSED" },
  });
  return result.count;
}
