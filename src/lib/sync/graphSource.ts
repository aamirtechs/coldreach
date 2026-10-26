import type { PrismaClient, SendingAccount } from "@prisma/client";
import { getValidAccessToken } from "@/lib/oauth/tokens";
import {
  extractEmail,
  normalizeMessageId,
  type FetchResult,
  type MessageSource,
  type NormalizedInboundMessage,
} from "./types";

/**
 * Microsoft Graph reply source.
 *
 * The cursor is the receivedDateTime of the newest message processed:
 * later syncs filter the inbox to messages received after it. Graph
 * does not expose In-Reply-To as a first class property, so the source
 * reads the internetMessageHeaders collection, where the reply chain
 * headers live.
 */

const API = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages";

interface GraphHeader {
  name: string;
  value: string;
}

interface GraphMessage {
  id: string;
  subject?: string | null;
  receivedDateTime?: string;
  internetMessageId?: string;
  internetMessageHeaders?: GraphHeader[];
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  body?: { contentType?: string; content?: string };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function headerValue(headers: GraphHeader[] | undefined, name: string): string | null {
  const found = (headers ?? []).find((header) => header.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

export class GraphSource implements MessageSource {
  readonly id = "graph";

  constructor(
    private readonly db: PrismaClient,
    private readonly account: SendingAccount,
  ) {}

  async fetchNewMessages(_account: SendingAccount, cursor: string | null): Promise<FetchResult> {
    const accessToken = await getValidAccessToken(this.db, this.account);
    const select =
      "id,subject,receivedDateTime,internetMessageId,internetMessageHeaders,from,toRecipients,body";
    const query = cursor
      ? `?$filter=${encodeURIComponent(`receivedDateTime gt ${cursor}`)}&$orderby=receivedDateTime asc&$top=50&$select=${select}`
      : `?$orderby=receivedDateTime desc&$top=25&$select=${select}`;
    const response = await fetch(`${API}${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Microsoft Graph inbox read failed (HTTP ${response.status}): ${detail.slice(0, 200)}`);
    }
    const data = (await response.json()) as { value?: GraphMessage[] };
    const raw = (data.value ?? []).slice();
    if (!cursor) {
      raw.reverse();
    }

    const messages: NormalizedInboundMessage[] = [];
    let maxReceived = cursor ?? "";
    for (const message of raw) {
      const fromEmail = extractEmail(message.from?.emailAddress?.address);
      if (!fromEmail) {
        continue;
      }
      if (message.receivedDateTime && message.receivedDateTime > maxReceived) {
        maxReceived = message.receivedDateTime;
      }
      const referencesRaw = headerValue(message.internetMessageHeaders, "References");
      const references = referencesRaw
        ? referencesRaw
            .split(/\s+/)
            .map((value) => normalizeMessageId(value))
            .filter((value): value is string => value !== null)
        : [];
      const bodyContent = message.body?.content ?? "";
      messages.push({
        providerMessageId:
          normalizeMessageId(message.internetMessageId) ?? message.id,
        fromEmail,
        toEmail:
          extractEmail(message.toRecipients?.[0]?.emailAddress?.address) ?? this.account.email,
        subject: message.subject ?? null,
        bodyText: message.body?.contentType === "html" ? stripHtml(bodyContent) : bodyContent,
        receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
        inReplyTo: normalizeMessageId(headerValue(message.internetMessageHeaders, "In-Reply-To")),
        references,
      });
    }
    return { messages, cursor: maxReceived || cursor || new Date().toISOString() };
  }
}
