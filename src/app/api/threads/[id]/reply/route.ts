import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { resolveProvider } from "@/lib/providers";
import { createUnsubscribeToken } from "@/lib/worker/unsubscribe";

/**
 * Sends a human reply inside a thread through the thread's sending
 * account provider. Simulation accounts simulate the send and the
 * message is stored with a DEMO marker in its body (the same honesty
 * rule as campaign sends). The send is recorded as a SENT or FAILED
 * email event against the account, so deliverability health reflects
 * real traffic, and the outbound message joins the thread history.
 */
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
    return NextResponse.json({ error: "A reply body is required" }, { status: 400 });
  }
  try {
    const thread = await prisma.thread.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      include: {
        lead: { select: { id: true, email: true } },
        sendingAccount: true,
        messages: { orderBy: { occurredAt: "desc" }, take: 1 },
      },
    });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    if (!thread.sendingAccount) {
      return NextResponse.json(
        { error: "This thread has no sending account to reply from." },
        { status: 400 },
      );
    }
    const toEmail = thread.lead?.email ?? thread.messages[0]?.fromEmail;
    if (!toEmail) {
      return NextResponse.json({ error: "This thread has no recipient to reply to." }, { status: 400 });
    }
    const account = thread.sendingAccount;
    const subject = thread.subject.toLowerCase().startsWith("re:")
      ? thread.subject
      : `Re: ${thread.subject}`;
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const headers: Record<string, string> = {};
    if (thread.lead) {
      const token = createUnsubscribeToken(ctx.workspace.id, thread.lead.id);
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
          campaignId: thread.campaignId,
          sendingAccountId: account.id,
          type: "FAILED",
          idempotencyKey: `manual-fail:${thread.id}:${now.getTime()}`,
          occurredAt: now,
        },
      });
      throw error;
    }

    const storedBody = provider.isSimulation ? `${text}\n\n[DEMO: simulated send, no email left the server]` : text;
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
        campaignId: thread.campaignId,
        sendingAccountId: account.id,
        type: "SENT",
        providerMessageId: providerMessageId ?? null,
        idempotencyKey: `manual:${providerMessageId ?? message.id}`,
        occurredAt: now,
      },
    });
    await prisma.thread.update({
      where: { id: thread.id },
      data: { lastMessageAt: now, status: thread.status === "ARCHIVED" ? "OPEN" : thread.status },
    });
    return NextResponse.json({ message, demo: provider.isSimulation }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
