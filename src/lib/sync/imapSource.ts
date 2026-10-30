import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type { SendingAccount } from "@prisma/client";
import type { MailboxCredentials } from "@/lib/providers/smtp";
import {
  extractEmail,
  normalizeMessageId,
  type FetchResult,
  type MessageSource,
  type NormalizedInboundMessage,
} from "./types";

/**
 * IMAP reply source for SMTP mailboxes (cPanel and any other self
 * hosted mail server).
 *
 * The cursor is a JSON document holding the mailbox UIDVALIDITY and
 * the highest UID processed. UIDVALIDITY guards the UID space: when
 * the server reports a different value the old cursor is meaningless,
 * so the source re-baselines exactly like a first sync. A first sync
 * imports only the last 7 days of mail, capped at the newest 100
 * messages, and sets the cursor to the highest UID in the mailbox so
 * older mail is never imported later. Later syncs fetch every UID
 * above the cursor.
 *
 * The IMAP client is injectable through a factory so tests run
 * against a fake; production builds a real ImapFlow client from the
 * resolved mailbox credentials.
 */

export interface ImapFetchedMessage {
  uid: number;
  internalDate?: Date;
  source?: Buffer | string;
}

export interface ImapClientLike {
  mailbox?: { uidValidity?: bigint | number | string; uidNext?: number } | false;
  connect(): Promise<void>;
  logout?: () => Promise<void>;
  close?: () => void;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(
    query: { since?: Date; all?: boolean; uid?: string },
    options?: { uid: true },
  ): Promise<number[] | false | undefined>;
  fetchOne(
    seq: string,
    query: { uid: true; source: true; internalDate: true },
    options: { uid: true },
  ): Promise<ImapFetchedMessage | false | undefined>;
}

export type ImapClientFactory = (
  credentials: MailboxCredentials,
) => ImapClientLike | Promise<ImapClientLike>;

export interface ImapSourceDeps {
  clientFactory?: ImapClientFactory;
  now?: () => Date;
}

const FIRST_SYNC_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_SYNC_CAP = 100;

function defaultClientFactory(credentials: MailboxCredentials): ImapClientLike {
  if (!credentials.imap) {
    throw new Error("IMAP is not configured for this mailbox.");
  }
  const client = new ImapFlow({
    host: credentials.imap.host,
    port: credentials.imap.port,
    secure: credentials.imap.secure,
    auth: { user: credentials.user, pass: credentials.pass },
    logger: false,
    disableAutoIdle: true,
    // Shared hosting mail servers can be slow to accept and greet
    // under load; generous timeouts keep a slow server from failing
    // the whole sync (transient failures are also retried upstream).
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    ...(credentials.imap.secure ? {} : { doSTARTTLS: true as const }),
  });
  return client as unknown as ImapClientLike;
}

interface ImapCursor {
  uidValidity: string;
  lastUid: number;
}

function parseCursor(cursor: string | null): ImapCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(cursor) as Partial<ImapCursor>;
    if (typeof parsed.uidValidity === "string" && typeof parsed.lastUid === "number") {
      return { uidValidity: parsed.uidValidity, lastUid: parsed.lastUid };
    }
  } catch {
    // Not an IMAP cursor (for example a legacy value): re-baseline.
  }
  return null;
}

function encodeCursor(cursor: ImapCursor): string {
  return JSON.stringify(cursor);
}

function uidList(result: number[] | false | undefined): number[] {
  if (!Array.isArray(result)) {
    return [];
  }
  return result.filter((uid) => Number.isInteger(uid) && uid > 0);
}

function maxUid(uids: number[], floor: number): number {
  return uids.reduce((max, uid) => (uid > max ? uid : max), floor);
}

function addressText(value: ParsedMail["from"] | ParsedMail["to"]): string | null {
  if (!value) {
    return null;
  }
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) {
    return null;
  }
  return first.text ?? first.value?.[0]?.address ?? null;
}

function referencesList(parsed: ParsedMail): string[] {
  const raw = parsed.references;
  const values = Array.isArray(raw) ? raw : raw ? raw.split(/\s+/) : [];
  return values
    .map((value) => normalizeMessageId(value))
    .filter((value): value is string => value !== null);
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Normalizes one raw RFC 822 message into the sync contract. */
export async function normalizeImapMessage(
  source: Buffer | string,
  uid: number,
  accountEmail: string,
  internalDate?: Date,
): Promise<NormalizedInboundMessage | null> {
  const parsed = await simpleParser(source);
  const fromEmail = extractEmail(addressText(parsed.from));
  if (!fromEmail) {
    return null;
  }
  const bodyText =
    parsed.text && parsed.text.trim().length > 0
      ? parsed.text
      : typeof parsed.html === "string"
        ? htmlToText(parsed.html)
        : "";
  return {
    providerMessageId: normalizeMessageId(parsed.messageId) ?? `imap-uid-${uid}`,
    fromEmail,
    toEmail: extractEmail(addressText(parsed.to)) ?? accountEmail,
    subject: parsed.subject ?? null,
    bodyText,
    receivedAt: parsed.date ?? internalDate ?? new Date(),
    inReplyTo: normalizeMessageId(parsed.inReplyTo),
    references: referencesList(parsed),
  };
}

export class ImapSource implements MessageSource {
  readonly id = "imap";

  constructor(
    private readonly credentials: MailboxCredentials,
    private readonly deps: ImapSourceDeps = {},
  ) {}

  async fetchNewMessages(account: SendingAccount, cursor: string | null): Promise<FetchResult> {
    if (!this.credentials.imap) {
      throw new Error(
        "IMAP is not configured for this SMTP account, so replies cannot be synced. Add the IMAP settings for the mailbox.",
      );
    }
    const factory = this.deps.clientFactory ?? defaultClientFactory;
    const client = await factory(this.credentials);
    await client.connect();
    let lock: { release(): void } | null = null;
    try {
      lock = await client.getMailboxLock("INBOX");
      const mailbox = client.mailbox;
      if (!mailbox || mailbox.uidValidity === undefined) {
        throw new Error("The IMAP server did not report a mailbox UIDVALIDITY.");
      }
      const uidValidity = String(mailbox.uidValidity);
      const stored = parseCursor(cursor);
      const baselineValid = stored !== null && stored.uidValidity === uidValidity;
      const now = this.deps.now ? this.deps.now() : new Date();

      const allUids = uidList(await client.search({ all: true }, { uid: true }));
      let highestUid = maxUid(allUids, baselineValid ? stored.lastUid : 0);
      if (typeof mailbox.uidNext === "number" && mailbox.uidNext > 0) {
        highestUid = Math.max(highestUid, mailbox.uidNext - 1);
      }

      let selected: number[];
      if (baselineValid) {
        selected = allUids.filter((uid) => uid > stored.lastUid).sort((a, b) => a - b);
      } else {
        const since = new Date(now.getTime() - FIRST_SYNC_WINDOW_MS);
        const recent = uidList(await client.search({ since }, { uid: true }));
        selected = recent.sort((a, b) => a - b).slice(-FIRST_SYNC_CAP);
      }
      highestUid = maxUid(selected, highestUid);

      const messages: NormalizedInboundMessage[] = [];
      for (const uid of selected) {
        const fetched = await client.fetchOne(
          String(uid),
          { uid: true, source: true, internalDate: true },
          { uid: true },
        );
        if (!fetched || fetched.source === undefined) {
          continue;
        }
        const normalized = await normalizeImapMessage(
          fetched.source,
          uid,
          account.email,
          fetched.internalDate,
        );
        if (normalized) {
          messages.push(normalized);
        }
      }
      messages.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
      return { messages, cursor: encodeCursor({ uidValidity, lastUid: highestUid }) };
    } finally {
      if (lock) {
        lock.release();
      }
      if (client.logout) {
        await client.logout().catch(() => undefined);
      } else if (client.close) {
        client.close();
      }
    }
  }
}
