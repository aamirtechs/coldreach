import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { verifyImportEmails } from "@/lib/leads/importVerify";
import { writeAuditLog } from "@/lib/audit";

/**
 * Step 2 of the import wizard (v1.34.0): verify the uploaded file's
 * unique addresses before anything is imported. Returns per-address
 * verdicts, which the wizard passes back to the import call so the
 * chosen policy is enforced and imported leads keep their verdicts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{ csvText?: unknown; emailColumn?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (typeof body.csvText !== "string" || !body.csvText.trim()) {
    return NextResponse.json({ error: "csvText is required" }, { status: 400 });
  }
  if (typeof body.emailColumn !== "string" || !body.emailColumn) {
    return NextResponse.json({ error: "emailColumn is required" }, { status: 400 });
  }
  try {
    const list = await prisma.leadList.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

    const result = await verifyImportEmails(body.csvText, body.emailColumn);
    await writeAuditLog({
      action: "lead.import_verify",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { listId: list.id, uniqueEmails: result.uniqueEmails, counts: { ...result.counts } },
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
