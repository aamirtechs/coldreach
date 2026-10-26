import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

interface BulkBody {
  action?: unknown;
  leadIds?: unknown;
  tag?: unknown;
}

/**
 * Bulk lead actions. Every id is verified against the session workspace
 * before anything changes, so a crafted request cannot touch another
 * tenant's leads.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<BulkBody>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const action = stringField(body.action);
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.map(String) : [];
  if (leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds is required" }, { status: 400 });
  }
  try {
    const owned = await prisma.lead.findMany({
      where: { workspaceId: ctx.workspace.id, id: { in: leadIds } },
      select: { id: true, tags: true },
    });
    const ownedIds = owned.map((lead) => lead.id);

    if (action === "delete") {
      const result = await prisma.lead.deleteMany({
        where: { workspaceId: ctx.workspace.id, id: { in: ownedIds } },
      });
      await writeAuditLog({
        action: "lead.bulk_delete",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: { count: result.count },
      });
      return NextResponse.json({ deleted: result.count });
    }

    if (action === "tag") {
      const tag = stringField(body.tag);
      if (!tag) return NextResponse.json({ error: "A tag is required" }, { status: 400 });
      let updated = 0;
      for (const lead of owned) {
        const tags = Array.isArray(lead.tags) ? lead.tags.map(String) : [];
        if (!tags.includes(tag)) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { tags: [...tags, tag] },
          });
          updated += 1;
        }
      }
      await writeAuditLog({
        action: "lead.bulk_tag",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: { tag, updated },
      });
      return NextResponse.json({ updated });
    }

    return NextResponse.json({ error: `Unknown bulk action "${action}"` }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
