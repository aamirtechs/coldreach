import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, stringField } from "@/lib/api";
import { getSessionWorkspace, type SessionContext } from "@/lib/auth/session";
import { isPlatformOwner } from "@/lib/admin/platform";
import { writeAuditLog } from "@/lib/audit";
import {
  SUPPORT_TICKET_STATUSES,
  listPlatformTickets,
  setSupportTicketStatus,
  type SupportTicketStatus,
} from "@/lib/support/tickets";

/**
 * Platform admin support tickets.
 *
 * Gated exactly like the admin page: a signed-in platform owner
 * (PLATFORM_OWNER_EMAIL) only, and everyone else gets a 404 so the
 * surface is not advertised to customer accounts. This is the
 * delivery safety net for tickets: the notification email is best
 * effort, so every ticket lands here regardless.
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

export async function GET() {
  const session = await requirePlatformOwner();
  if ("error" in session) return session.error;
  try {
    const tickets = await listPlatformTickets(prisma);
    return NextResponse.json({ tickets });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  const session = await requirePlatformOwner();
  if ("error" in session) return session.error;
  const body = await readJson<{ id?: unknown; status?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const id = stringField(body.id);
  const status = stringField(body.status);
  if (!id) {
    return NextResponse.json({ error: "A ticket id is required" }, { status: 400 });
  }
  if (!(SUPPORT_TICKET_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: "Status must be OPEN, UNDER_PROCESS, or CLOSED" },
      { status: 400 },
    );
  }
  try {
    const ticket = await setSupportTicketStatus(prisma, id, status as SupportTicketStatus);
    await writeAuditLog({
      action: "support.ticket.status",
      userId: session.ctx.user.id,
      workspaceId: ticket.workspaceId,
      metadata: { ticketId: ticket.id, status: ticket.status },
    });
    return NextResponse.json({ ticket });
  } catch (error) {
    return apiError(error);
  }
}
