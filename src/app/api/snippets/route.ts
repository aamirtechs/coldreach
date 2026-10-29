import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 4000;

/**
 * Reusable reply snippets for the inbox. Snippets live only in the
 * session workspace: listing and creating are always scoped to it, so
 * one tenant can never see or use another tenant's snippets.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const snippets = await prisma.snippet.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        body: true,
        createdById: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ snippets });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ title?: unknown; body?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const title = stringField(body.title);
  if (!title) {
    return NextResponse.json({ error: "A snippet title is required" }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `Snippet title must be ${MAX_TITLE_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }
  const text = stringField(body.body);
  if (!text) {
    return NextResponse.json({ error: "A snippet body is required" }, { status: 400 });
  }
  if (text.length > MAX_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Snippet body must be ${MAX_BODY_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }
  try {
    const snippet = await prisma.snippet.create({
      data: {
        workspaceId: ctx.workspace.id,
        title,
        body: text,
        createdById: ctx.user.id,
      },
      select: {
        id: true,
        title: true,
        body: true,
        createdById: true,
        createdAt: true,
      },
    });
    await writeAuditLog({
      action: "snippet.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { snippetId: snippet.id },
    });
    return NextResponse.json({ snippet }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
