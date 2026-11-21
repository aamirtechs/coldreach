import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { getCallingService } from "@/lib/calling/services";

/**
 * Call lead lists (v1.47.0): the Calling section's own lists,
 * separate from the email LeadList model. A list can carry the
 * service it was built for, so the daily two-per-service batches
 * land in a list that names its service.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const lists = await prisma.callLeadList.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        serviceSlug: true,
        createdAt: true,
        _count: { select: { callLeads: true } },
      },
    });
    return NextResponse.json({
      lists: lists.map((list) => ({
        id: list.id,
        name: list.name,
        serviceSlug: list.serviceSlug,
        createdAt: list.createdAt,
        leadCount: list._count.callLeads,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ name?: unknown; serviceSlug?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const name = stringField(body.name);
  if (!name) return NextResponse.json({ error: "A list name is required" }, { status: 400 });
  const serviceSlug = stringField(body.serviceSlug) || null;
  if (serviceSlug && !getCallingService(serviceSlug)) {
    return NextResponse.json({ error: `Unknown service: ${serviceSlug}` }, { status: 400 });
  }
  try {
    const list = await prisma.callLeadList.create({
      data: { workspaceId: ctx.workspace.id, name, serviceSlug },
      select: { id: true, name: true, serviceSlug: true, createdAt: true },
    });
    await writeAuditLog({
      action: "call_list.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { callListId: list.id, serviceSlug },
    });
    return NextResponse.json({ list: { ...list, leadCount: 0 } }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
