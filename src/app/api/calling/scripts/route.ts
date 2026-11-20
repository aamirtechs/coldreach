import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const MAX_NAME_LENGTH = 120;
const MAX_BODY_LENGTH = 20000;
const MAX_OBJECTIONS_LENGTH = 20000;

const SCRIPT_SELECT = {
  id: true,
  name: true,
  body: true,
  objectionNotes: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Call scripts for the Calling section. Like snippets, scripts live
 * only in the session workspace: every read and write is scoped to
 * it, so one tenant can never see or edit another tenant's scripts.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const scripts = await prisma.callScript.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { name: "asc" },
      select: SCRIPT_SELECT,
    });
    return NextResponse.json({ scripts });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
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
    const script = await prisma.callScript.create({
      data: {
        workspaceId: ctx.workspace.id,
        name,
        body: text,
        objectionNotes: objectionNotes || null,
      },
      select: SCRIPT_SELECT,
    });
    await writeAuditLog({
      action: "call_script.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { scriptId: script.id },
    });
    return NextResponse.json({ script }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
