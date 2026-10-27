import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/log";

interface AuditEntry {
  action: string;
  userId?: string | null;
  workspaceId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Writes an audit log row. Audit failures never break the main request. */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId ?? null,
        workspaceId: entry.workspaceId ?? null,
        metadata: entry.metadata ?? undefined,
      },
    });
  } catch (error) {
    logger.error("Failed to write audit log", { error, action: entry.action });
  }
}
