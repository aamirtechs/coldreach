import type { PrismaClient } from "@prisma/client";

/**
 * Platform admin storage cleanup (v1.31.0).
 *
 * Two kinds of data grow the database (and now the app server's disk)
 * without adding value:
 *
 *   1. Step attachments. Their bytes live in the StepAttachment table,
 *      so a workspace that deletes a campaign's files only from the
 *      sequence builder UI copy may still hold old files. The platform
 *      owner can list every attachment (file name and size only, never
 *      the content) and delete selected ones.
 *   2. Machine reply threads. Inbound threads classified AUTOMATED
 *      (receipts, system notices) or NOT_FOUND (delivery failure
 *      notices) are kept for metrics, but their message bodies pile
 *      up. The owner can delete a whole classification at once.
 *
 * Everything here is platform-owner surface, like the rest of
 * src/lib/admin: it runs across workspaces by design, because the
 * disk being cleaned belongs to the platform, not to one workspace.
 * Human and other classifications (POSITIVE, NEGATIVE, NEUTRAL,
 * OUT_OF_OFFICE, REFERRAL, TICKET) can never be deleted through this
 * tool; the classification allowlist is enforced in the library, not
 * just in the UI.
 */

export const CLEANUP_REPLY_CLASSIFICATIONS = ["AUTOMATED", "NOT_FOUND"] as const;
export type CleanupReplyClassification = (typeof CLEANUP_REPLY_CLASSIFICATIONS)[number];

export function isCleanupReplyClassification(
  value: unknown,
): value is CleanupReplyClassification {
  return (
    typeof value === "string" &&
    (CLEANUP_REPLY_CLASSIFICATIONS as readonly string[]).includes(value)
  );
}

export interface CleanupAttachmentItem {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  stepOrder: number;
  createdAt: string;
  campaignId: string;
  campaignName: string;
  workspaceName: string;
}

export interface CleanupStats {
  /** Total database size on Postgres; null where it cannot be read. */
  databaseBytes: number | null;
  attachments: {
    count: number;
    totalBytes: number;
    /** Largest first, capped so the page stays light. */
    items: CleanupAttachmentItem[];
    /** True when more attachments exist than items lists. */
    truncated: boolean;
  };
  replies: Record<CleanupReplyClassification, { threads: number; messages: number }>;
}

const ATTACHMENT_LIST_LIMIT = 200;
export const MAX_ATTACHMENTS_PER_DELETE = 500;

async function databaseBytes(db: PrismaClient): Promise<number | null> {
  try {
    const rows = await db.$queryRaw<Array<{ bytes: bigint }>>`
      SELECT pg_database_size(current_database()) AS bytes`;
    return rows[0] ? Number(rows[0].bytes) : null;
  } catch {
    // Not Postgres (local dev and tests run on SQLite), or the role
    // cannot read the size. The cleanup actions do not depend on it.
    return null;
  }
}

export async function getCleanupStats(db: PrismaClient): Promise<CleanupStats> {
  const [aggregate, items, dbBytes] = await Promise.all([
    db.stepAttachment.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
    db.stepAttachment.findMany({
      orderBy: [{ sizeBytes: "desc" }, { createdAt: "asc" }],
      take: ATTACHMENT_LIST_LIMIT,
      select: {
        id: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        stepOrder: true,
        createdAt: true,
        campaignId: true,
        campaign: { select: { name: true, workspace: { select: { name: true } } } },
      },
    }),
    databaseBytes(db),
  ]);

  const replies = {} as CleanupStats["replies"];
  for (const classification of CLEANUP_REPLY_CLASSIFICATIONS) {
    const [threads, messages] = await Promise.all([
      db.thread.count({ where: { classification } }),
      db.threadMessage.count({ where: { thread: { classification } } }),
    ]);
    replies[classification] = { threads, messages };
  }

  const count = aggregate._count._all;
  return {
    databaseBytes: dbBytes,
    attachments: {
      count,
      totalBytes: aggregate._sum.sizeBytes ?? 0,
      truncated: count > items.length,
      items: items.map((item) => ({
        id: item.id,
        filename: item.filename,
        contentType: item.contentType,
        sizeBytes: item.sizeBytes,
        stepOrder: item.stepOrder,
        createdAt: item.createdAt.toISOString(),
        campaignId: item.campaignId,
        campaignName: item.campaign.name,
        workspaceName: item.campaign.workspace.name,
      })),
    },
    replies,
  };
}

export interface DeleteAttachmentsResult {
  deleted: number;
  freedBytes: number;
}

/**
 * Deletes the given StepAttachment rows. Unknown ids are ignored, so
 * a stale selection from an already-cleaned list is harmless. The
 * caller is responsible for the platform-owner gate and the audit
 * log; this function enforces only the batch cap.
 */
export async function deleteAttachments(
  db: PrismaClient,
  ids: string[],
): Promise<DeleteAttachmentsResult> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length > MAX_ATTACHMENTS_PER_DELETE) {
    throw new Error(
      `Too many attachments in one delete (${unique.length}). Delete at most ${MAX_ATTACHMENTS_PER_DELETE} at a time.`,
    );
  }
  if (unique.length === 0) return { deleted: 0, freedBytes: 0 };
  const rows = await db.stepAttachment.findMany({
    where: { id: { in: unique } },
    select: { id: true, sizeBytes: true },
  });
  if (rows.length === 0) return { deleted: 0, freedBytes: 0 };
  const result = await db.stepAttachment.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  return {
    deleted: result.count,
    freedBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
  };
}

export interface DeleteRepliesResult {
  classification: CleanupReplyClassification;
  threads: number;
  messages: number;
}

/**
 * Deletes every thread carrying one of the machine classifications,
 * platform-wide. Messages and notes go with their thread through the
 * schema's cascade. Throws for any classification outside the
 * allowlist, so a crafted request can never delete human replies.
 */
export async function deleteRepliesByClassification(
  db: PrismaClient,
  classification: string,
): Promise<DeleteRepliesResult> {
  if (!isCleanupReplyClassification(classification)) {
    throw new Error(
      `Classification ${classification} cannot be deleted here. Only ${CLEANUP_REPLY_CLASSIFICATIONS.join(" and ")} machine replies can.`,
    );
  }
  const [threads, messages] = await Promise.all([
    db.thread.count({ where: { classification } }),
    db.threadMessage.count({ where: { thread: { classification } } }),
  ]);
  if (threads > 0) {
    await db.thread.deleteMany({ where: { classification } });
  }
  return { classification, threads, messages };
}

/**
 * Best-effort VACUUM of the tables a cleanup just shrank, so Postgres
 * reuses the freed pages instead of growing the file. Plain VACUUM
 * never locks reads or writes for long and the space stays inside the
 * database file; it is not returned to the OS. Failures (SQLite in
 * dev, permissions) are ignored on purpose.
 */
export async function vacuumCleanupTables(db: PrismaClient): Promise<void> {
  for (const table of ["StepAttachment", "Thread", "ThreadMessage", "ThreadNote"]) {
    try {
      await db.$executeRawUnsafe(`VACUUM "${table}"`);
    } catch {
      // Best effort only; the delete already succeeded.
    }
  }
}
