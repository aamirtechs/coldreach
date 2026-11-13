import type { PrismaClient, SupportTicket, SupportTicketReply } from "@prisma/client";
import { sendProductEmail, type ProductMailResult } from "@/lib/mail/productMail";
import { logger } from "@/lib/log";

/**
 * Support tickets, v1.22.0.
 *
 * A ticket created on the in-app Support page is persisted first and
 * is the record of truth. A notification email to the platform
 * support inbox is attempted alongside through the product mail path
 * (Resend, see src/lib/mail/productMail.ts). Email is best effort by
 * design: when RESEND_API_KEY is not configured, or the provider
 * fails, the ticket still saves, the failure is logged, and the
 * platform admin panel lists every ticket, so nothing is ever lost.
 *
 * The recipient is a single server-side address: SUPPORT_EMAIL when
 * set, otherwise the default below. It is never taken from the
 * request, and neither is the reporter's identity: the API route
 * passes the session's user and workspace, and this module snapshots
 * them onto the row.
 */

import {
  MAX_TICKET_MESSAGE_LENGTH,
  MAX_TICKET_REPLY_LENGTH,
  MAX_TICKET_SUBJECT_LENGTH,
  SUPPORT_CATEGORIES,
  SUPPORT_TICKET_REPLY_KINDS,
  DEFAULT_SUPPORT_EMAIL,
  type SupportCategory,
  type SupportTicketReplyKind,
  type SupportTicketStatus,
} from "./constants";

export {
  SUPPORT_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_STATUS_LABELS,
  supportTicketStatusLabel,
  SUPPORT_TICKET_REPLY_KINDS,
  SUPPORT_TICKET_REPLY_KIND_LABELS,
  supportTicketReplyKindLabel,
  MAX_TICKET_SUBJECT_LENGTH,
  MAX_TICKET_MESSAGE_LENGTH,
  MAX_TICKET_REPLY_LENGTH,
  DEFAULT_SUPPORT_EMAIL,
  SUPPORT_WHATSAPP_NUMBER,
  SUPPORT_WHATSAPP_DISPLAY,
  supportWhatsAppLink,
  type SupportCategory,
  type SupportTicketReplyKind,
  type SupportTicketStatus,
} from "./constants";

export function supportEmail(env: NodeJS.ProcessEnv = process.env): string {
  return env.SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL;
}

export type TicketValidation =
  | { ok: true; subject: string; category: SupportCategory; message: string }
  | { ok: false; error: string };

/** Server-side validation for ticket creation; the form mirrors it for UX only. */
export function validateTicketInput(input: {
  subject?: unknown;
  category?: unknown;
  message?: unknown;
}): TicketValidation {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  if (!subject) {
    return { ok: false, error: "A subject is required" };
  }
  if (subject.length > MAX_TICKET_SUBJECT_LENGTH) {
    return {
      ok: false,
      error: `Subject must be ${MAX_TICKET_SUBJECT_LENGTH} characters or fewer`,
    };
  }
  const category = typeof input.category === "string" ? input.category : "";
  if (!(SUPPORT_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: "Choose a category from the list" };
  }
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) {
    return { ok: false, error: "A message is required" };
  }
  if (message.length > MAX_TICKET_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Message must be ${MAX_TICKET_MESSAGE_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, subject, category: category as SupportCategory, message };
}

export interface TicketReporter {
  userId: string;
  userEmail: string;
  workspaceId: string;
  workspaceName: string;
}

export type SendTicketMail = (input: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}) => Promise<ProductMailResult>;

export interface CreateTicketDeps {
  env?: NodeJS.ProcessEnv;
  sendMail?: SendTicketMail;
}

/**
 * Persists a ticket, then attempts the support inbox notification.
 * The email attempt never throws and never fails the creation: its
 * outcome is reported on the result and logged when it does not send.
 */
export async function createSupportTicket(
  db: PrismaClient,
  reporter: TicketReporter,
  data: { subject: string; category: SupportCategory; message: string },
  deps: CreateTicketDeps = {},
): Promise<{ ticket: SupportTicket; emailSent: boolean }> {
  const ticket = await db.supportTicket.create({
    data: {
      workspaceId: reporter.workspaceId,
      userId: reporter.userId,
      userEmail: reporter.userEmail,
      subject: data.subject,
      category: data.category,
      message: data.message,
    },
  });

  const env = deps.env ?? process.env;
  const sendMail: SendTicketMail =
    deps.sendMail ??
    ((input) => sendProductEmail(input, { env }));
  let emailSent = false;
  try {
    const result = await sendMail({
      to: supportEmail(env),
      subject: `[ColdReach support] ${data.subject}`,
      replyTo: reporter.userEmail,
      text: [
        `New support ticket from ${reporter.userEmail}`,
        "",
        `Category: ${data.category}`,
        `Workspace: ${reporter.workspaceName} (${reporter.workspaceId})`,
        `User: ${reporter.userEmail} (${reporter.userId})`,
        `Ticket: ${ticket.id}`,
        "",
        data.message,
      ].join("\n"),
    });
    emailSent = result.sent;
    if (!result.sent) {
      logger.warn("Support ticket notification email did not send", {
        ticketId: ticket.id,
        workspaceId: reporter.workspaceId,
        reason: result.reason ?? "unknown",
      });
    }
  } catch (error) {
    logger.error("Support ticket notification email failed", {
      ticketId: ticket.id,
      workspaceId: reporter.workspaceId,
      error,
    });
  }
  return { ticket, emailSent };
}

/** The signed-in workspace's own tickets, newest first. */
export async function listWorkspaceTickets(
  db: PrismaClient,
  workspaceId: string,
  take = 50,
): Promise<SupportTicket[]> {
  return db.supportTicket.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * A ticket as the platform admin sees it: the full row, including
 * the complete message body, plus the workspace's name alongside
 * its id so the detail view can show where the ticket came from.
 */
export interface PlatformTicket extends SupportTicket {
  workspaceName: string;
}

/** Every ticket across the platform, newest first. Platform owner only. */
export async function listPlatformTickets(
  db: PrismaClient,
  take = 100,
): Promise<PlatformTicket[]> {
  const rows = await db.supportTicket.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { workspace: { select: { name: true } } },
  });
  return rows.map(({ workspace, ...ticket }) => ({
    ...ticket,
    workspaceName: workspace.name,
  }));
}

export async function setSupportTicketStatus(
  db: PrismaClient,
  id: string,
  status: SupportTicketStatus,
): Promise<SupportTicket> {
  return db.supportTicket.update({ where: { id }, data: { status } });
}

export type ReplyValidation =
  | { ok: true; kind: SupportTicketReplyKind; body: string }
  | { ok: false; error: string };

/** Server-side validation for a thread entry written from the admin panel. */
export function validateTicketReplyInput(input: {
  kind?: unknown;
  body?: unknown;
}): ReplyValidation {
  const kind = typeof input.kind === "string" ? input.kind : "";
  if (!(SUPPORT_TICKET_REPLY_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "Kind must be REPLY or NOTE" };
  }
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) {
    return { ok: false, error: "A reply body is required" };
  }
  if (body.length > MAX_TICKET_REPLY_LENGTH) {
    return {
      ok: false,
      error: `Reply must be ${MAX_TICKET_REPLY_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, kind: kind as SupportTicketReplyKind, body };
}

/** A thread entry as the admin panel renders it, with its author's email. */
export interface TicketReplyView extends SupportTicketReply {
  authorEmail: string;
}

/** The ticket's whole thread, oldest first, internal notes included. */
export async function listTicketReplies(
  db: PrismaClient,
  ticketId: string,
): Promise<TicketReplyView[]> {
  const rows = await db.supportTicketReply.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { email: true } } },
  });
  return rows.map(({ author, ...reply }) => ({ ...reply, authorEmail: author.email }));
}

export interface AddReplyDeps {
  env?: NodeJS.ProcessEnv;
  sendMail?: SendTicketMail;
  /** Set false to store a REPLY without emailing it. Notes never email. */
  emailCustomer?: boolean;
}

/**
 * Persists a thread entry on a ticket, then, for a REPLY the
 * author chose to email, sends it to the ticket's reporter
 * through the product mail path and stamps emailedAt on the row.
 * Like ticket creation, the email is best effort: a failed or
 * unconfigured send never fails the save, it just leaves
 * emailedAt null so the panel can show the reply was not emailed.
 */
export async function addTicketReply(
  db: PrismaClient,
  ticket: SupportTicket,
  author: { userId: string; userEmail: string },
  data: { kind: SupportTicketReplyKind; body: string },
  deps: AddReplyDeps = {},
): Promise<{ reply: SupportTicketReply; emailSent: boolean }> {
  let reply = await db.supportTicketReply.create({
    data: {
      ticketId: ticket.id,
      authorId: author.userId,
      kind: data.kind,
      body: data.body,
    },
  });

  let emailSent = false;
  if (data.kind === "REPLY" && deps.emailCustomer !== false) {
    const env = deps.env ?? process.env;
    const sendMail: SendTicketMail =
      deps.sendMail ??
      ((input) => sendProductEmail(input, { env }));
    try {
      const result = await sendMail({
        to: ticket.userEmail,
        subject: `[ColdReach support] Re: ${ticket.subject}`,
        replyTo: supportEmail(env),
        text: [
          data.body,
          "",
          "---",
          `Ticket: ${ticket.subject} (${ticket.id})`,
          "Reply to this email and it reaches the support inbox.",
        ].join("\n"),
      });
      emailSent = result.sent;
      if (result.sent) {
        reply = await db.supportTicketReply.update({
          where: { id: reply.id },
          data: { emailedAt: new Date() },
        });
      } else {
        logger.warn("Support ticket reply email did not send", {
          ticketId: ticket.id,
          replyId: reply.id,
          reason: result.reason ?? "unknown",
        });
      }
    } catch (error) {
      logger.error("Support ticket reply email failed", {
        ticketId: ticket.id,
        replyId: reply.id,
        error,
      });
    }
  }
  return { reply, emailSent };
}
