import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { syncHubSpot } from "@/lib/crm/hubspot";
import { writeAuditLog } from "@/lib/audit";

/**
 * Runs one HubSpot sync for the active workspace: pushes its leads
 * to HubSpot as contacts and records the run summary on the
 * connection. Errors from the service carry their HTTP status
 * (501 when the app credentials are missing, 400 when the workspace
 * is not connected), so the UI reports the real blocker.
 */
export async function POST() {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const summary = await syncHubSpot(prisma, ctx.workspace.id);
    await writeAuditLog({
      action: "crm.hubspot_sync",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { ...summary },
    });
    return NextResponse.json({ summary });
  } catch (error) {
    return apiError(error);
  }
}
