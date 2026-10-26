import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { isReplyClassification } from "@/lib/domain/classify";

const STATUSES = ["OPEN", "CLOSED", "ARCHIVED"] as const;

async function loadThread(workspaceId: string, id: string) {
  return prisma.thread.findFirst({
    where: { id, workspaceId },
    include: {
      lead: { select: { id: true, email: true, fields: true } },
      campaign: { select: { id: true, name: true } },
      sendingAccount: { select: { id: true, email: true, provider: true, status: true } },
      assignee: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { occurredAt: "asc" } },
      notes: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true, email: true } } },
      },
    },
  });
}

/**
 * Conversation detail. Opening a thread clears its unread flag, which
 * is the single read state the inbox maintains.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    let thread = await loadThread(ctx.workspace.id, id);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    if (thread.unread) {
      await prisma.thread.update({ where: { id }, data: { unread: false } });
      thread = await loadThread(ctx.workspace.id, id);
    }
    return NextResponse.json({ thread, demo: thread?.sendingAccount?.provider === "SIMULATION" });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Thread controls: status, assignee (must be a workspace member), and
 * classification override. Classification set here wins until the next
 * synced reply reclassifies the thread.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{
    status?: unknown;
    assigneeId?: unknown;
    classification?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const thread = await prisma.thread.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    const data: Record<string, unknown> = {};
    if (body.status !== undefined) {
      const status = stringField(body.status);
      if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
        return NextResponse.json({ error: `Unknown status "${status}"` }, { status: 400 });
      }
      data.status = status;
    }
    if (body.assigneeId !== undefined) {
      if (body.assigneeId === null || body.assigneeId === "") {
        data.assigneeId = null;
      } else {
        const assigneeId = stringField(body.assigneeId);
        const member = await prisma.membership.findFirst({
          where: { workspaceId: ctx.workspace.id, userId: assigneeId },
        });
        if (!member) {
          return NextResponse.json(
            { error: "The assignee is not a member of this workspace" },
            { status: 400 },
          );
        }
        data.assigneeId = assigneeId;
      }
    }
    if (body.classification !== undefined) {
      if (body.classification === null || body.classification === "") {
        data.classification = null;
      } else {
        const classification = stringField(body.classification);
        if (!isReplyClassification(classification)) {
          return NextResponse.json(
            { error: `Unknown classification "${classification}"` },
            { status: 400 },
          );
        }
        data.classification = classification;
      }
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const updated = await prisma.thread.update({ where: { id }, data });
    return NextResponse.json({ thread: updated });
  } catch (error) {
    return apiError(error);
  }
}
