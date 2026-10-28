import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { markTourCompleted } from "@/lib/tour";

/**
 * POST /api/tour/complete (v1.6.0): the tour component calls this
 * when the user finishes or skips the first-run tour, so it is not
 * offered again. Replays from the dashboard do not call it.
 */
export async function POST() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;

  await markTourCompleted(prisma, ctx.user.id);
  await writeAuditLog({
    action: "tour.complete",
    userId: ctx.user.id,
    workspaceId: ctx.workspace.id,
    metadata: {},
  });
  return NextResponse.json({ ok: true });
}
