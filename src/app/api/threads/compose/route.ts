import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { isValidEmail, normalizeEmail } from "@/lib/domain/dedupe";
import { findSuppression } from "@/lib/domain/suppression";
import { loadSuppressions } from "@/lib/suppressions";
import { resolveProvider } from "@/lib/providers";
import { createUnsubscribeToken } from "@/lib/worker/unsubscribe";

interface ComposeBody {
  sendingAccountId?: unknown;
  to?: unknown;
  subject?: unknown;
  body?: unknown;
}

/**
 * Manual compose: sends a one-off email from a workspace sending account
 * and opens a thread for it in the inbox, so the conversation can be
 * followed and replied to like any synced thread. Suppression is checked
 * before the send, matching every other send path in the product.
 * Simulation accounts simulate the send and the stored message carries
 * the DEMO marker, the same honesty rule as campaign and reply sends.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<ComposeBody>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const sendingAccountId = stringField(body.sendingAccountId);
  const rawTo = stringField(body.to);
  const subject = stringField(body.subject);
  const text = stringField(body.body);
  if (!sendingAccountId) {
    return NextResponse.json({ error: "A sending account is required" }, { status: 400 });
  }
  if (!isValidEmail(rawTo)) {
    return NextResponse.json(
      { error: "A single valid recipient email is required" },
      { status: 400 },
    );
  }
  if (!subject) {
    return NextResponse.json({ error: "A subject is required" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "An email body is required" }, { status: 400 });
  }
  const toEmail = normalizeEmail(rawTo);
  try {
    const account = await prisma.sendingAccount.findFirst({
      where: { id: sendingAccountId, workspaceId: ctx.workspace.id },
    });
    if (!account) {
      return NextResponse.json({ error: "Sending account not found" }, { status: 404 });
    }
    if (account.status !== "CONNECTED") {
      return NextResponse.json(
        {
          error: `The account ${account.email} is not connected (status: ${account.status}). Connect it on the Sending Accounts page before sending.`,
        },
        { status: 400 },
      );
    }

    const suppressions = await loadSuppressions(prisma, ctx.workspace.id);
    if (findSuppression(toEmail, suppressions)) {
      return NextResponse.json(
        {
          error: `${toEmail} is on the suppression list, so the email was not sent.`,
        },
        { status: 400 },
      );
    }

    const lead = await prisma.lead.findFirst({
      where: { workspaceId: ctx.workspace.id, email: toEmail },
      select: { id: true },
    });
    const headers: Record<string, string> = {};
    if (lead) {
      const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
      const token = createUnsubscribeToken(ctx.workspace.id, lead.id);
      headers["List-Unsubscribe"] = `<${appUrl}/u/${token}>`;
      // RFC 8058 one-click unsubscribe, matching campaign sends.
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }

    const provider = await resolveProvider(account, prisma);
    const now = new Date();
    let providerMessageId: string | undefined;
    try {
      const result = await provider.send({
        toEmail,
        fromEmail: account.email,
        fromName: account.displayName ?? ctx.workspace.senderName ?? undefined,
        subject,
        text,
        html: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`,
        headers,
      });
      providerMessageId = result.providerMessageId;
    } catch (error) {
      await prisma.emailEvent.create({
        data: {
          workspaceId: ctx.workspace.id,
          campaignId: null,
          sendingAccountId: account.id,
          type: "FAILED",
          idempotencyKey: `compose-fail:${account.id}:${now.getTime()}`,
          occurredAt: now,
        },
      });
      throw error;
    }

    const thread = await prisma.thread.create({
      data: {
        workspaceId: ctx.workspace.id,
        campaignId: null,
        leadId: lead?.id ?? null,
        sendingAccountId: account.id,
        subject,
        status: "OPEN",
        unread: false,
        lastMessageAt: now,
      },
    });
    const storedBody = provider.isSimulation
      ? `${text}\n\n[DEMO: simulated send, no email left the server]`
      : text;
    const message = await prisma.threadMessage.create({
      data: {
        threadId: thread.id,
        direction: "OUTBOUND",
        fromEmail: account.email,
        toEmail,
        subject,
        body: storedBody,
        providerMessageId: providerMessageId ?? null,
        occurredAt: now,
      },
    });
    await prisma.emailEvent.create({
      data: {
        workspaceId: ctx.workspace.id,
        campaignId: null,
        sendingAccountId: account.id,
        type: "SENT",
        providerMessageId: providerMessageId ?? null,
        idempotencyKey: `compose:${providerMessageId ?? message.id}`,
        occurredAt: now,
      },
    });
    await writeAuditLog({
      action: "thread.compose_send",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { threadId: thread.id, sendingAccountId: account.id, to: toEmail },
    });
    return NextResponse.json(
      { thread, message, demo: provider.isSimulation },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
