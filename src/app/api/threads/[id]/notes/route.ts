import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";

/**
 * Internal thread notes. Notes live only in the workspace: they are
 * never sent to the contact, never leave through a provider, and are
 * shown in the conversation view alongside the message history.
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
    const thread = await prisma.thread.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    const notes = await prisma.threadNote.findMany({
      where: { threadId: id, workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
    return NextResponse.json({ notes });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{ body?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const text = stringField(body.body);
  if (!text) {
    return NextResponse.json({ error: "A note body is required" }, { status: 400 });
  }
  try {
    const thread = await prisma.thread.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    const note = await prisma.threadNote.create({
      data: {
        workspaceId: ctx.workspace.id,
        threadId: id,
        authorId: ctx.user.id,
        body: text,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
