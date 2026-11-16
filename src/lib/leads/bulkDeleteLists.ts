import type { PrismaClient } from "@prisma/client";
import { MAX_BULK_DELETE_IDS } from "@/lib/campaigns/bulkDelete";

/**
 * Bulk lead list delete (v1.38.0).
 *
 * Deletes several lead lists of one workspace in a single call, with
 * exactly the single-delete rules (DELETE /api/lead-lists/[id]):
 * only the list grouping is removed. Leads are never deleted; the
 * schema sets their listId to null, and campaigns attached to a
 * deleted list keep existing with no list attached.
 *
 * Ids are deduplicated and capped; ids that do not belong to the
 * workspace (or do not exist) are counted as not found, never
 * deleted, so a stale or foreign selection cannot cross tenants.
 */
export interface BulkDeleteLeadListsResult {
  deletedCount: number;
  deletedIds: string[];
  notFoundCount: number;
}

export async function bulkDeleteLeadLists(
  db: PrismaClient,
  workspaceId: string,
  ids: string[],
): Promise<BulkDeleteLeadListsResult> {
  const uniqueIds = [
    ...new Set(ids.filter((id) => typeof id === "string" && id.length > 0)),
  ].slice(0, MAX_BULK_DELETE_IDS);
  if (uniqueIds.length === 0) {
    return { deletedCount: 0, deletedIds: [], notFoundCount: 0 };
  }

  const found = await db.leadList.findMany({
    where: { workspaceId, id: { in: uniqueIds } },
    select: { id: true },
  });
  const foundIds = found.map((list) => list.id);

  let deletedCount = 0;
  if (foundIds.length > 0) {
    const result = await db.leadList.deleteMany({
      where: { workspaceId, id: { in: foundIds } },
    });
    deletedCount = result.count;
  }

  return {
    deletedCount,
    deletedIds: foundIds,
    notFoundCount: uniqueIds.length - found.length,
  };
}
