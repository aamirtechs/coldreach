import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { buildWorkspaceExport } from "@/lib/settings/export";
import { writeAuditLog } from "@/lib/audit";

/**
 * Full workspace data export (OWNER only), as a JSON download.
 * The payload is built by src/lib/settings/export.ts, which selects
 * fields structurally so credential material (password hashes, API
 * key hashes, webhook secrets, OAuth tokens, SMTP credential
 * references) can never appear in it.
 */
export async function GET() {
  const session = await requireSession("OWNER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const payload = await buildWorkspaceExport(prisma, ctx.workspace.id);
    if (!payload) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    await writeAuditLog({
      action: "settings.export",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { leads: payload.leads.length, campaigns: payload.campaigns.length },
    });
    const filename = `coldreach-workspace-export-${ctx.workspace.slug}.json`;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
