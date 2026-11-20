import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import {
  SAMPLE_SCRIPT_BODY,
  SAMPLE_SCRIPT_NAME,
  SAMPLE_SCRIPT_OBJECTIONS,
} from "@/lib/calling/sampleScript";

/**
 * Inserts the WordPress speed sample script into the workspace. If a
 * script with the sample name already exists it is returned as is,
 * so the action is safe to click twice and never duplicates the
 * sample over a version the operator already edited.
 */
export async function POST() {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const existing = await prisma.callScript.findFirst({
      where: { workspaceId: ctx.workspace.id, name: SAMPLE_SCRIPT_NAME },
      select: { id: true, name: true, body: true, objectionNotes: true, createdAt: true, updatedAt: true },
    });
    if (existing) {
      return NextResponse.json({ script: existing, created: false });
    }
    const script = await prisma.callScript.create({
      data: {
        workspaceId: ctx.workspace.id,
        name: SAMPLE_SCRIPT_NAME,
        body: SAMPLE_SCRIPT_BODY,
        objectionNotes: SAMPLE_SCRIPT_OBJECTIONS,
      },
      select: { id: true, name: true, body: true, objectionNotes: true, createdAt: true, updatedAt: true },
    });
    await writeAuditLog({
      action: "call_script.create_sample",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { scriptId: script.id },
    });
    return NextResponse.json({ script, created: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
