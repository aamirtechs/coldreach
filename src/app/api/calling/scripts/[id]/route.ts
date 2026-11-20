import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const MAX_NAME_LENGTH = 120;
const MAX_BODY_LENGTH = 20000;
const MAX_OBJECTIONS_LENGTH = 20000;

/**
 * Edit or delete one call script. The lookup is scoped to the
 * session workspace, so a script id from another workspace reads as
 * not found and is never touched. Deleting a script keeps its call
 * history: CallLog.scriptId is set null by the schema relation.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{ name?: unknown; body?: unknown; objectionNotes?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const name = stringField(body.name);
  if (!name) {
    return NextResponse.json({ error: "A script name is required" }, { status: 400 });
  }
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Script name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }
  const text = stringField(body.body);
  if (!text) {
    return NextResponse.json({ error: "A script body is required" }, { status: 400 });
  }
  if (text.length > MAX_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Script body must be ${MAX_BODY_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }
  const objectionNotes = stringField(body.objectionNotes);
  if (objectionNotes.length > MAX_OBJECTIONS_LENGTH) {
    return NextResponse.json(
      { error: `Objection notes must be ${MAX_OBJECTIONS_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }
  try {
    const existing = await prisma.callScript.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }
    const script = await prisma.callScript.update({
      where: { id: existing.id },
      data: { name, body: text, objectionNotes: objectionNotes || null },
      select: {
        id: true,
        name: true,
        body: true,
        objectionNotes: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await writeAuditLog({
      action: "call_script.update",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { scriptId: script.id },
    });
    return NextResponse.json({ script });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const script = await prisma.callScript.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!script) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }
    await prisma.callScript.delete({ where: { id: script.id } });
    await writeAuditLog({
      action: "call_script.delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { scriptId: script.id },
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
