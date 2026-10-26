import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { syncAccount } from "@/lib/sync/syncService";

/**
 * Manual reply sync for one sending account. Runs the same sync the
 * worker tick performs automatically; useful right after connecting an
 * account or while triaging the inbox.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const account = await prisma.sendingAccount.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
    });
    if (!account) {
      return NextResponse.json({ error: "Sending account not found" }, { status: 404 });
    }
    const summary = await syncAccount(prisma, account);
    return NextResponse.json({ summary });
  } catch (error) {
    return apiError(error);
  }
}
