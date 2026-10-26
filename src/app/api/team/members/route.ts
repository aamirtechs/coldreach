import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";

/** Workspace member list for the Team page and inbox assignment. */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const members = await prisma.membership.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
    });
    return NextResponse.json({
      members: members.map((member) => ({
        userId: member.user.id,
        name: member.user.name,
        email: member.user.email,
        role: member.role,
        joinedAt: member.createdAt,
        isYou: member.user.id === ctx.user.id,
      })),
      yourRole: ctx.role,
    });
  } catch (error) {
    return apiError(error);
  }
}
