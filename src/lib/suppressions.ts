import type { PrismaClient } from "@prisma/client";
import type { SuppressionEntry } from "@/lib/domain/suppression";

/**
 * Loads every suppression entry that applies to a workspace: its own
 * entries plus the global do-not-contact list. This combined set is the
 * only set any send or import path may check against.
 */
export async function loadSuppressions(
  db: PrismaClient,
  workspaceId: string,
): Promise<SuppressionEntry[]> {
  const rows = await db.suppression.findMany({
    where: { OR: [{ workspaceId }, { scope: "GLOBAL" }] },
    select: { scope: true, email: true, domain: true, reason: true },
  });
  return rows.map((row) => ({
    scope: row.scope,
    email: row.email,
    domain: row.domain,
    reason: row.reason,
  }));
}

/**
 * Creates a workspace suppression for an email address when one does not
 * already exist (exact address match, workspace scope). Returns true when
 * a row was created.
 */
export async function ensureSuppression(
  db: PrismaClient,
  workspaceId: string,
  email: string,
  reason: string,
): Promise<boolean> {
  const existing = await db.suppression.findFirst({
    where: { workspaceId, scope: "WORKSPACE", email: email.trim().toLowerCase() },
    select: { id: true },
  });
  if (existing) {
    return false;
  }
  await db.suppression.create({
    data: {
      workspaceId,
      scope: "WORKSPACE",
      email: email.trim().toLowerCase(),
      reason,
    },
  });
  return true;
}
