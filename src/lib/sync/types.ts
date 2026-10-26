import type { SendingAccount } from "@prisma/client";

/**
 * Reply sync contracts.
 *
 * A MessageSource reads new inbound mail for one sending account,
 * resuming from an opaque cursor the account record stores. Sources
 * normalize provider payloads into NormalizedInboundMessage so the
 * sync service never sees Gmail or Graph shapes.
 */

export interface NormalizedInboundMessage {
  /** RFC Message-ID of the inbound message when the provider exposes
   *  one (brackets stripped). Used both for dedupe on re-sync and as
   *  the idempotency anchor for the REPLIED event. */
  providerMessageId: string;
  fromEmail: string;
  toEmail: string;
  subject: string | null;
  bodyText: string;
  receivedAt: Date;
  /** Message-ID this message replies to, brackets stripped. */
  inReplyTo: string | null;
  /** The References chain, brackets stripped, oldest first. */
  references: string[];
}

export interface FetchResult {
  messages: NormalizedInboundMessage[];
  /** Cursor to store on the account for the next sync. */
  cursor: string;
}

export interface MessageSource {
  readonly id: string;
  fetchNewMessages(account: SendingAccount, cursor: string | null): Promise<FetchResult>;
}

/** Strips angle brackets and whitespace from a Message-ID value. */
export function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value.trim().replace(/^<|>$/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Extracts a bare email address from a From header value. */
export function extractEmail(headerValue: string | null | undefined): string | null {
  if (!headerValue) {
    return null;
  }
  const angle = headerValue.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : headerValue).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

export interface AccountSyncSummary {
  accountId: string;
  skipped: boolean;
  reason?: string;
  fetched: number;
  imported: number;
  duplicates: number;
  repliesApplied: number;
  threadsCreated: number;
  error?: string;
}
