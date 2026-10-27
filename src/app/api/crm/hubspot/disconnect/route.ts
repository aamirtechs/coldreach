import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { HUBSPOT_PROVIDER } from "@/lib/crm/hubspot";
import { writeAuditLog } from "@/lib/audit";

/**
 * Disconnects HubSpot for the active workspace: the connection row
 * stays as a record, but the stored tokens are deleted and the
 * status returns to DISCONNECTED, so no further sync can run until
 * the owner reconnects. Contacts already pushed stay in HubSpot.
 */
export async function POST() {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    await prisma.crmConnection.updateMany({
      where: { workspaceId: ctx.workspace.id, provider: HUBSPOT_PROVIDER },
      data: { status: "DISCONNECTED", encryptedCredentials: null },
    });
    await writeAuditLog({
      action: "crm.hubspot_disconnect",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { provider: HUBSPOT_PROVIDER },
    });
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    return apiError(error);
  }
}
