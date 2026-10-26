import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, requireSession } from "@/lib/api";

/**
 * Unified inbox thread list. Filters: campaignId, sendingAccountId,
 * status, classification, assigneeId ("me" for the caller, "none" for
 * unassigned), q (matches lead email, lead name, subject, and message
 * bodies). All queries are scoped to the session workspace.
 */
export async function GET(request: Request) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, intField(Number(params.get("page") ?? 1), 1));
  const pageSize = Math.min(100, Math.max(1, intField(Number(params.get("pageSize") ?? 25), 25)));
  try {
    const where: Record<string, unknown> = { workspaceId: ctx.workspace.id };
    const campaignId = params.get("campaignId");
    if (campaignId) where.campaignId = campaignId;
    const sendingAccountId = params.get("sendingAccountId");
    if (sendingAccountId) where.sendingAccountId = sendingAccountId;
    const status = params.get("status");
    if (status) where.status = status;
    const classification = params.get("classification");
    if (classification) where.classification = classification;
    const assigneeId = params.get("assigneeId");
    if (assigneeId === "me") where.assigneeId = ctx.user.id;
    else if (assigneeId === "none") where.assigneeId = null;
    else if (assigneeId) where.assigneeId = assigneeId;
    const q = (params.get("q") ?? "").trim();
    if (q) {
      where.OR = [
        { subject: { contains: q } },
        { lead: { email: { contains: q.toLowerCase() } } },
        { messages: { some: { body: { contains: q } } } },
      ];
    }
    const [total, threads] = await Promise.all([
      prisma.thread.count({ where: where as never }),
      prisma.thread.findMany({
        where: where as never,
        orderBy: [{ unread: "desc" }, { lastMessageAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          lead: { select: { id: true, email: true, fields: true } },
          campaign: { select: { id: true, name: true } },
          sendingAccount: { select: { id: true, email: true, provider: true } },
          assignee: { select: { id: true, name: true, email: true } },
          _count: { select: { messages: true } },
        },
      }),
    ]);
    const unreadTotal = await prisma.thread.count({
      where: { workspaceId: ctx.workspace.id, unread: true },
    });
    return NextResponse.json({ threads, total, page, pageSize, unreadTotal });
  } catch (error) {
    return apiError(error);
  }
}
