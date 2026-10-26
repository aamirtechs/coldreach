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
 * Gmail reply source.
 *
 * The cursor is the Gmail history id. A first sync lists the most
 * recent inbox messages and records the profile history id; later
 * syncs read the history feed from that id, falling back to a fresh
 * list when the history has expired (Gmail keeps it about a week).
 */

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
}

function decodeBody(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function extractPlainText(part: GmailPart | undefined): string | null {
  if (!part) {
    return null;
  }
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBody(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = extractPlainText(child);
    if (found) {
      return found;
    }
  }
  return null;
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const found = (headers ?? []).find((header) => header.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

function normalizeMessage(message: GmailMessage, accountEmail: string): NormalizedInboundMessage | null {
  const headers = message.payload?.headers;
  const fromEmail = extractEmail(headerValue(headers, "From"));
  if (!fromEmail) {
    return null;
  }
  const referencesRaw = headerValue(headers, "References");
  const references = referencesRaw
    ? referencesRaw
        .split(/\s+/)
        .map((value) => normalizeMessageId(value))
        .filter((value): value is string => value !== null)
    : [];
  const bodyText = extractPlainText(message.payload) ?? message.snippet ?? "";
  return {
    providerMessageId: normalizeMessageId(headerValue(headers, "Message-ID")) ?? message.id,
    fromEmail,
    toEmail: extractEmail(headerValue(headers, "To")) ?? accountEmail,
    subject: headerValue(headers, "Subject"),
    bodyText,
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(),
    inReplyTo: normalizeMessageId(headerValue(headers, "In-Reply-To")),
    references,
  };
}

export class GmailSource implements MessageSource {
  readonly id = "gmail";

  constructor(
    private readonly db: PrismaClient,
    private readonly account: SendingAccount,
  ) {}

  private async fetchJson<T>(accessToken: string, path: string): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gmail API ${path.split("?")[0]} failed (HTTP ${response.status}): ${detail.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  async fetchNewMessages(_account: SendingAccount, cursor: string | null): Promise<FetchResult> {
    const accessToken = await getValidAccessToken(this.db, this.account);
    const profile = await this.fetchJson<{ historyId?: string }>(accessToken, "/profile");
    const nextCursor = profile.historyId ?? cursor ?? "";

    let ids: string[] = [];
    if (cursor) {
      try {
        const history = await this.fetchJson<{
          history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
        }>(
          accessToken,
          `/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&labelId=INBOX`,
        );
        for (const entry of history.history ?? []) {
          for (const added of entry.messagesAdded ?? []) {
            if (added.message?.id) {
              ids.push(added.message.id);
            }
          }
        }
      } catch {
        // History expired or invalid: fall back to a fresh inbox list.
        ids = [];
      }
    }
    if (!cursor || ids.length === 0) {
      const list = await this.fetchJson<{ messages?: Array<{ id: string }> }>(
        accessToken,
        "/messages?labelIds=INBOX&maxResults=25",
      );
      ids = (list.messages ?? []).map((message) => message.id);
    }

    const messages: NormalizedInboundMessage[] = [];
    for (const id of [...new Set(ids)].slice(0, 50)) {
      const message = await this.fetchJson<GmailMessage>(
        accessToken,
        `/messages/${encodeURIComponent(id)}?format=full`,
      );
      const normalized = normalizeMessage(message, this.account.email);
      if (normalized) {
        messages.push(normalized);
      }
    }
    messages.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    return { messages, cursor: nextCursor };
  }
}
