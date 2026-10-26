import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, requireSession } from "@/lib/api";

/**
 * Workspace activity feed: the AuditLog rows Phase 1 started writing,
 * paginated newest first, for the Team page Activity tab.
 */
export async function GET(request: Request) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, intField(Number(params.get("page") ?? 1), 1));
  const pageSize = Math.min(100, Math.max(1, intField(Number(params.get("pageSize") ?? 25), 25)));
  try {
    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where: { workspaceId: ctx.workspace.id } }),
      prisma.auditLog.findMany({
        where: { workspaceId: ctx.workspace.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { name: true, email: true } } },
      }),
    ]);
    return NextResponse.json({
      entries: entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        actor: entry.user ? (entry.user.name ?? entry.user.email) : null,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    return apiError(error);
  }
}
