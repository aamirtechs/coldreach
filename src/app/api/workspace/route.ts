import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  return NextResponse.json({
    workspace: {
      id: ctx.workspace.id,
      name: ctx.workspace.name,
      senderName: ctx.workspace.senderName,
      senderAddress: ctx.workspace.senderAddress,
    },
    role: ctx.role,
  });
}

export async function PATCH(request: Request) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ name?: unknown; senderName?: unknown; senderAddress?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = stringField(body.name);
    if (!name) return NextResponse.json({ error: "Workspace name cannot be empty" }, { status: 400 });
    data.name = name;
  }
  if (body.senderName !== undefined) data.senderName = stringField(body.senderName) || null;
  if (body.senderAddress !== undefined) data.senderAddress = stringField(body.senderAddress) || null;
  try {
    const workspace = await prisma.workspace.update({ where: { id: ctx.workspace.id }, data });
    await writeAuditLog({
      action: "workspace.update",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { fields: Object.keys(data) },
    });
    return NextResponse.json({ workspace });
  } catch (error) {
    return apiError(error);
  }
}
