import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson } from "@/lib/api";
import { getSessionWorkspace, type SessionContext } from "@/lib/auth/session";
import { isPlatformOwner } from "@/lib/admin/platform";
import { writeAuditLog } from "@/lib/audit";
import {
  addTicketReply,
  listTicketReplies,
  validateTicketReplyInput,
} from "@/lib/support/tickets";

/**
 * One ticket's thread for the platform admin panel (v1.25.0).
 *
 * Gated exactly like the ticket list: a signed-in platform owner
 * only, everyone else gets a 404. GET returns the thread (replies
 * and internal notes, oldest first); POST appends an entry. A
 * REPLY is emailed to the ticket's reporter unless the request
 * passes emailCustomer false; a NOTE is never emailed.
 */

async function requirePlatformOwner(): Promise<
  { ctx: SessionContext } | { error: NextResponse }
> {
  const ctx = await getSessionWorkspace();
  if (!ctx) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isPlatformOwner(ctx.user.email)) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ctx };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePlatformOwner();
  if ("error" in session) return session.error;
  const { id } = await params;
  try {
    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    const replies = await listTicketReplies(prisma, id);
    return NextResponse.json({ replies });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePlatformOwner();
  if ("error" in session) return session.error;
  const { id } = await params;
  const body = await readJson<{ kind?: unknown; body?: unknown; emailCustomer?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const validation = validateTicketReplyInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  try {
    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    const { reply, emailSent } = await addTicketReply(
      prisma,
      ticket,
      { userId: session.ctx.user.id, userEmail: session.ctx.user.email },
      { kind: validation.kind, body: validation.body },
      { emailCustomer: body.emailCustomer !== false },
    );
    await writeAuditLog({
      action: "support.ticket.reply",
      userId: session.ctx.user.id,
      workspaceId: ticket.workspaceId,
      metadata: { ticketId: ticket.id, replyId: reply.id, kind: reply.kind, emailSent },
    });
    return NextResponse.json({
      reply: { ...reply, authorEmail: session.ctx.user.email },
      emailSent,
    });
  } catch (error) {
    return apiError(error);
  }
}
