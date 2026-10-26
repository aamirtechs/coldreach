import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const lists = await prisma.leadList.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { leads: true } } },
    });
    return NextResponse.json({
      lists: lists.map((list) => ({
        id: list.id,
        name: list.name,
        description: list.description,
        leadCount: list._count.leads,
        createdAt: list.createdAt,
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
  const body = await readJson<{ name?: unknown; description?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const name = stringField(body.name);
  if (!name) return NextResponse.json({ error: "List name is required" }, { status: 400 });
  try {
    const list = await prisma.leadList.create({
      data: {
        workspaceId: ctx.workspace.id,
        name,
        description: stringField(body.description) || null,
      },
    });
    await writeAuditLog({
      action: "leadlist.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { listId: list.id, name: list.name },
    });
    return NextResponse.json({ list }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
