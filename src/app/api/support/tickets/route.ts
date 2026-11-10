import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { checkAuthRateLimit, rateLimitedResponse } from "@/lib/auth/rateLimit";
import { writeAuditLog } from "@/lib/audit";
import {
  createSupportTicket,
  listWorkspaceTickets,
  validateTicketInput,
} from "@/lib/support/tickets";

/**
 * Support tickets for the signed-in workspace.
 *
 * Identity always comes from the session: the client sends only a
 * subject, category, and message, so a request can never file a
 * ticket as another user or into another workspace. Any workspace
 * role may create and list; listing is scoped to the session
 * workspace, so one tenant never sees another's tickets.
 *
 * Creation is rate limited per user (5 an hour) on top of the
 * shared credential limiter's window pattern; support is a human
 * channel, and a handful of tickets an hour is generous headroom.
 */

const TICKET_RATE_LIMIT = 5;
const TICKET_RATE_WINDOW_MS = 60 * 60 * 1000;

export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const tickets = await listWorkspaceTickets(prisma, ctx.workspace.id);
    return NextResponse.json({ tickets });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;

  const limit = checkAuthRateLimit(
    `support:${ctx.user.id}`,
    Date.now(),
    TICKET_RATE_LIMIT,
    TICKET_RATE_WINDOW_MS,
  );
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  const body = await readJson<{
    subject?: unknown;
    category?: unknown;
    message?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const validated = validateTicketInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const { ticket } = await createSupportTicket(
      prisma,
      {
        userId: ctx.user.id,
        userEmail: ctx.user.email,
        workspaceId: ctx.workspace.id,
        workspaceName: ctx.workspace.name,
      },
      {
        subject: validated.subject,
        category: validated.category,
        message: validated.message,
      },
    );
    await writeAuditLog({
      action: "support.ticket.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { ticketId: ticket.id, category: ticket.category },
    });
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
