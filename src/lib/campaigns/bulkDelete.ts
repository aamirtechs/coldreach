import type { PrismaClient } from "@prisma/client";

/**
 * Bulk campaign delete (v1.38.0).
 *
 * Deletes several campaigns of one workspace in a single call, with
 * exactly the single-delete rules (DELETE /api/campaigns/[id]):
 * a RUNNING campaign is never deleted, it is reported back as
 * skipped so the caller can tell the user to pause it first.
 * Deletion cascades in the schema: sequence steps, enrollments,
 * step attachments and sending-account links go with the campaign.
 * Leads are never deleted, and sent and reply history survives as
 * workspace-level events and inbox threads.
 *
 * Ids are deduplicated and capped; ids that do not belong to the
 * workspace (or do not exist) are counted as not found, never
 * deleted, so a stale or foreign selection cannot cross tenants.
 */
export const MAX_BULK_DELETE_IDS = 200;

export interface BulkDeleteCampaignsResult {
  deletedCount: number;
  deletedIds: string[];
  skippedRunning: { id: string; name: string }[];
  notFoundCount: number;
}

export async function bulkDeleteCampaigns(
  db: PrismaClient,
  workspaceId: string,
  ids: string[],
): Promise<BulkDeleteCampaignsResult> {
  const uniqueIds = [
    ...new Set(ids.filter((id) => typeof id === "string" && id.length > 0)),
  ].slice(0, MAX_BULK_DELETE_IDS);
  if (uniqueIds.length === 0) {
    return { deletedCount: 0, deletedIds: [], skippedRunning: [], notFoundCount: 0 };
  }

  const found = await db.campaign.findMany({
    where: { workspaceId, id: { in: uniqueIds } },
    select: { id: true, name: true, status: true },
  });
  const skippedRunning = found
    .filter((campaign) => campaign.status === "RUNNING")
    .map((campaign) => ({ id: campaign.id, name: campaign.name }));
  const deletableIds = found
    .filter((campaign) => campaign.status !== "RUNNING")
    .map((campaign) => campaign.id);

  let deletedCount = 0;
  if (deletableIds.length > 0) {
    // The status guard is repeated in the delete itself so a campaign
    // launched between the read and the delete is still never removed
    // while running.
    const result = await db.campaign.deleteMany({
      where: { workspaceId, id: { in: deletableIds }, status: { not: "RUNNING" } },
    });
    deletedCount = result.count;
  }

  return {
    deletedCount,
    deletedIds: deletableIds,
    skippedRunning,
    notFoundCount: uniqueIds.length - found.length,
  };
}
