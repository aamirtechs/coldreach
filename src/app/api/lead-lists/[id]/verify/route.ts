import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { verifyList } from "@/lib/verify/service";
import { writeAuditLog } from "@/lib/audit";

/**
 * Verifies every lead in a list with the built-in checks (and the
 * provider, when VERIFY_API_KEY is configured), storing each
 * result on the lead. Verification is what feeds the enrollment
 * gate: leads whose stored status is INVALID are skipped at
 * enrollment with the count reported. Tenant scoped through the
 * session workspace, like every other list action.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const summary = await verifyList(prisma, { workspaceId: ctx.workspace.id, listId: id });
    await writeAuditLog({
      action: "leads.verify_list",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { listId: id, summary: { ...summary } },
    });
    return NextResponse.json({ summary });
  } catch (error) {
    return apiError(error);
  }
}
