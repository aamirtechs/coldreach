import type { PrismaClient } from "@prisma/client";

/**
 * Product tour persistence (v1.6.0).
 *
 * Completion lives on the user, not the workspace: the tour teaches
 * the product, so it is offered once per person and never again
 * after they finish or skip it, whichever workspace they open. The
 * tour stays replayable from the dashboard at any time; replaying
 * does not change this timestamp.
 */

export async function getTourCompletedAt(db: PrismaClient, userId: string): Promise<Date | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { tourCompletedAt: true },
  });
  return user?.tourCompletedAt ?? null;
}

/** Record completion, keeping the first completion time. */
export async function markTourCompleted(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.user.updateMany({
    where: { id: userId, tourCompletedAt: null },
    data: { tourCompletedAt: now },
  });
}
