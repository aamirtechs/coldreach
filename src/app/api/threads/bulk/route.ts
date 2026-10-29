import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

interface BulkBody {
  action?: unknown;
  threadIds?: unknown;
}

const MAX_THREAD_IDS = 200;

/**
 * Bulk inbox actions. Every id is verified against the session workspace
 * before anything changes, so a crafted request cannot touch another
 * tenant's threads.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<BulkBody>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const action = stringField(body.action);
  const threadIds = Array.isArray(body.threadIds)
    ? [...new Set(body.threadIds.map(String))].slice(0, MAX_THREAD_IDS)
    : [];
  if (threadIds.length === 0) {
    return NextResponse.json({ error: "threadIds is required" }, { status: 400 });
  }
  try {
    const owned = await prisma.thread.findMany({
      where: { workspaceId: ctx.workspace.id, id: { in: threadIds } },
      select: { id: true },
    });
    const ownedIds = owned.map((thread) => thread.id);

    if (action === "mark_read" || action === "mark_unread") {
      const unread = action === "mark_unread";
      const result = await prisma.thread.updateMany({
        where: { workspaceId: ctx.workspace.id, id: { in: ownedIds } },
        data: { unread },
      });
      await writeAuditLog({
        action: unread ? "thread.bulk_mark_unread" : "thread.bulk_mark_read",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: { count: result.count },
      });
      return NextResponse.json({ updated: result.count });
    }

    return NextResponse.json({ error: `Unknown bulk action "${action}"` }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
