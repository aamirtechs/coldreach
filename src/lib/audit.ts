import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
    console.error("Failed to write audit log", entry.action, error);
  }
}
