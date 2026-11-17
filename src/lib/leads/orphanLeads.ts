import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Orphan leads (v1.41.0).
 *
 * An orphan lead belongs to a workspace but is attached to
 * nothing: it sits in no lead list (listId is null) and has no
 * campaign enrollment in any state. Orphans pile up because list
 * deletes and campaign deletes deliberately keep leads, so after
 * a cleanup the workspace can hold thousands of leads that no
 * screen shows and no campaign can ever reach.
 *
 * Leads that are unlisted but enrolled somewhere are in use and
 * are never counted or deleted here; the summary reports them
 * separately so the operator can see they were kept on purpose.
 *
 * Deleting an orphan removes just the lead row. An orphan by
 * definition has no enrollments to cascade, and the schema keeps
 * any thread that referenced the lead, with its lead link
 * cleared.
 */
export interface OrphanLeadSummary {
  orphanCount: number;
  unlistedEnrolledCount: number;
}

export function orphanLeadWhere(workspaceId: string): Prisma.LeadWhereInput {
  return {
    workspaceId,
    listId: null,
    enrollments: { none: {} },
  };
}

export async function summarizeOrphanLeads(
  db: PrismaClient,
  workspaceId: string,
): Promise<OrphanLeadSummary> {
  const [orphanCount, unlistedCount] = await Promise.all([
    db.lead.count({ where: orphanLeadWhere(workspaceId) }),
    db.lead.count({ where: { workspaceId, listId: null } }),
  ]);
  return { orphanCount, unlistedEnrolledCount: unlistedCount - orphanCount };
}

export async function deleteOrphanLeads(
  db: PrismaClient,
  workspaceId: string,
): Promise<{ deletedCount: number }> {
  const result = await db.lead.deleteMany({ where: orphanLeadWhere(workspaceId) });
  return { deletedCount: result.count };
}
