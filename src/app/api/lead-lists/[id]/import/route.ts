import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { importLeadsFromCsv, type ColumnMapping } from "@/lib/leads/import";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{ csvText?: unknown; mapping?: unknown; stripPlusTag?: unknown; updateExisting?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (typeof body.csvText !== "string" || !body.csvText.trim()) {
    return NextResponse.json({ error: "csvText is required" }, { status: 400 });
  }
  if (!body.mapping || typeof body.mapping !== "object" || Array.isArray(body.mapping)) {
    return NextResponse.json({ error: "A column mapping is required" }, { status: 400 });
  }
  try {
    const list = await prisma.leadList.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

    const result = await importLeadsFromCsv(prisma, {
      workspaceId: ctx.workspace.id,
      listId: list.id,
      csvText: body.csvText,
      mapping: body.mapping as ColumnMapping,
      stripPlusTag: body.stripPlusTag === true,
      updateExisting: body.updateExisting === true,
    });
    await writeAuditLog({
      action: "lead.import",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { listId: list.id, summary: { ...result.summary } },
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
