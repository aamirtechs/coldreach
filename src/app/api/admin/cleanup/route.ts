import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, stringField } from "@/lib/api";
import { getSessionWorkspace, type SessionContext } from "@/lib/auth/session";
import { isPlatformOwner } from "@/lib/admin/platform";
import {
  deleteAttachments,
  deleteRepliesByClassification,
  getCleanupStats,
  isCleanupReplyClassification,
  vacuumCleanupTables,
} from "@/lib/admin/cleanup";
import { writeAuditLog } from "@/lib/audit";

/**
 * Platform admin storage cleanup (v1.31.0).
 *
 * Gated exactly like the rest of the admin surface: signed-in
 * platform owner (PLATFORM_OWNER_EMAIL) only, everyone else gets a
 * 404 so the surface is not advertised to customer accounts.
 *
 * GET reports what can be cleaned (attachment list with sizes, and
 * machine reply counts). POST performs one delete action and returns
 * fresh stats with the result. Every delete requires an explicit
 * confirm flag in the body, on top of the confirmation dialog in the
 * UI, and is written to the audit log under the owner's workspace.
 */

async function requirePlatformOwner(): Promise<
  { ctx: SessionContext } | { error: NextResponse }
> {
  const ctx = await getSessionWorkspace();
  if (!ctx) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isPlatformOwner(ctx.user.email)) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ctx };
}

export async function GET() {
  const session = await requirePlatformOwner();
  if ("error" in session) return session.error;
  try {
    return NextResponse.json(await getCleanupStats(prisma));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requirePlatformOwner();
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{
    action?: unknown;
    ids?: unknown;
    classification?: unknown;
    confirm?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (body.confirm !== true) {
    return NextResponse.json(
      { error: "Deletes need confirm: true in the request body." },
      { status: 400 },
    );
  }
  const action = stringField(body.action);
  try {
    if (action === "attachments.delete") {
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id): id is string => typeof id === "string")
        : [];
      if (ids.length === 0) {
        return NextResponse.json({ error: "No attachments selected." }, { status: 400 });
      }
      const result = await deleteAttachments(prisma, ids);
      await vacuumCleanupTables(prisma);
      await writeAuditLog({
        action: "admin.cleanup.attachments_delete",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: { deleted: result.deleted, freedBytes: result.freedBytes },
      });
      return NextResponse.json({ result, stats: await getCleanupStats(prisma) });
    }
    if (action === "replies.delete") {
      const classification = stringField(body.classification);
      if (!isCleanupReplyClassification(classification)) {
        return NextResponse.json(
          {
            error:
              "Only AUTOMATED and NOT_FOUND machine replies can be deleted here.",
          },
          { status: 400 },
        );
      }
      const result = await deleteRepliesByClassification(prisma, classification);
      await vacuumCleanupTables(prisma);
      await writeAuditLog({
        action: "admin.cleanup.replies_delete",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: {
          classification: result.classification,
          threads: result.threads,
          messages: result.messages,
        },
      });
      return NextResponse.json({ result, stats: await getCleanupStats(prisma) });
    }
    return NextResponse.json({ error: "Unknown cleanup action." }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
