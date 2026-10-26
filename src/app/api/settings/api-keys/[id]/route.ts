import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

/** Revokes an API key. Revocation is immediate and permanent. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const key = await prisma.apiKey.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, name: true, revokedAt: true },
    });
    if (!key) return NextResponse.json({ error: "API key not found" }, { status: 404 });
    if (!key.revokedAt) {
      await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
      await writeAuditLog({
        action: "apikey.revoke",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: { apiKeyId: key.id, name: key.name },
      });
    }
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return apiError(error);
  }
}
