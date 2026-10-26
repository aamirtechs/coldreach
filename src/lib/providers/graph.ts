import type { PrismaClient, SendingAccount } from "@prisma/client";
import { getValidAccessToken } from "@/lib/oauth/tokens";
import type { MailProvider, SendInput, SendResult } from "./types";

/**
 * Microsoft Graph transport for Microsoft 365 accounts.
 *
 * The message is first created as a draft (POST /me/messages), which
 * returns the message with its internetMessageId, and then sent
 * (POST /me/messages/{id}/send). Two calls, but the internetMessageId
 * is what replies quote in In-Reply-To, so recording it as the
 * providerMessageId is what lets reply sync match the conversation.
 */

interface GraphMessage {
  id?: string;
  internetMessageId?: string;
}

export class GraphProvider implements MailProvider {
  readonly id = "graph";
  readonly isSimulation = false;

  constructor(
    private readonly db: PrismaClient,
    private readonly account: SendingAccount,
  ) {}

  async send(input: SendInput): Promise<SendResult> {
    const accessToken = await getValidAccessToken(this.db, this.account);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const createResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        subject: input.subject,
        body: { contentType: "HTML", content: input.html },
        toRecipients: [{ emailAddress: { address: input.toEmail } }],
        from: { emailAddress: { address: input.fromEmail } },
        internetMessageHeaders: input.headers
          ? Object.entries(input.headers).map(([name, value]) => ({ name, value }))
          : undefined,
      }),
    });
    if (!createResponse.ok) {
      const detail = await createResponse.text().catch(() => "");
      throw new Error(`Microsoft Graph draft creation failed (HTTP ${createResponse.status}): ${detail.slice(0, 300)}`);
    }
    const message = (await createResponse.json()) as GraphMessage;
    if (!message.id) {
      throw new Error("Microsoft Graph did not return a message id for the draft.");
    }

    const sendResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.id)}/send`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!sendResponse.ok) {
      const detail = await sendResponse.text().catch(() => "");
      throw new Error(`Microsoft Graph send failed (HTTP ${sendResponse.status}): ${detail.slice(0, 300)}`);
    }

    const providerMessageId = (message.internetMessageId ?? message.id).replace(/^<|>$/g, "");
    return { providerMessageId };
  }
}
