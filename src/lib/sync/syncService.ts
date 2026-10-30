import type { PrismaClient, SendingAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/domain/dedupe";
import { classifyReply } from "@/lib/domain/classify";
import { applyProviderEvent } from "@/lib/worker/applyEvent";
import { GmailSource } from "./gmailSource";
import { GraphSource } from "./graphSource";
import { ImapSource } from "./imapSource";
import { resolveMailboxCredentials } from "@/lib/providers/smtp";
import type { AccountSyncSummary, MessageSource, NormalizedInboundMessage } from "./types";

export { FakeSource } from "./fakeSource";
export type { AccountSyncSummary, MessageSource, NormalizedInboundMessage } from "./types";

/**
 * Reply sync service.
 *
 * For each inbound message a source returns, the service:
 *  1. skips it when a thread message with the same providerMessageId
 *     already exists in the workspace (re-syncs are idempotent);
 *  2. matches it to an enrollment: first by In-Reply-To / References
 *     against the providerMessageIds of SENT events, then by the
 *     sender's email against workspace leads;
 *  3. applies a REPLIED event through applyProviderEvent, the same
 *     single code path webhooks use, so the sequence stops and the
 *     metrics move exactly once (the event dedupe key is derived from
 *     the inbound message id, distinct per message);
 *  4. appends the message to the lead's thread with the sending
 *     account (creating the thread when needed), marks it unread, and
 *     stores the rule based classification on thread and event.
 */

function buildSource(db: PrismaClient, account: SendingAccount): MessageSource | null {
  switch (account.provider) {
    case "GMAIL":
      return new GmailSource(db, account);
    case "MS365":
      return new GraphSource(db, account);
    case "SMTP": {
      // cPanel and other self hosted mailboxes sync replies over
      // IMAP when mailbox credentials resolve (stored encrypted, or
      // the credentialRef environment). Without them there is no
      // mailbox to read and the account keeps the existing skip.
      const mailbox = resolveMailboxCredentials(account);
      return mailbox?.imap ? new ImapSource(mailbox) : null;
    }
    default:
      return null;
  }
}

function referenceCandidates(message: NormalizedInboundMessage): string[] {
  const values = [message.inReplyTo, ...message.references].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const variants = new Set<string>();
  for (const value of values) {
    variants.add(value);
    variants.add(`<${value}>`);
    variants.add(value.toLowerCase());
  }
  return [...variants];
}

interface SyncDeps {
  source?: MessageSource;
  now?: Date;
  /** Delays between retry attempts for transient fetch failures. */
  retryDelaysMs?: number[];
}

/**
 * Connection level failures from shared mail hosts are usually
 * transient: the server is slow to accept or greet while many
 * mailboxes on the same host are being polled. Those errors are
 * worth retrying inside the same sync pass; authentication and
 * configuration errors are not, because a retry cannot fix them.
 */
const TRANSIENT_SYNC_ERROR =
  /timed?\s?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|Failed to establish connection|greeting/i;

function isTransientSyncError(error: unknown): boolean {
  return error instanceof Error && TRANSIENT_SYNC_ERROR.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncAccount(
  db: PrismaClient,
  account: SendingAccount,
  deps: SyncDeps = {},
): Promise<AccountSyncSummary> {
  const summary: AccountSyncSummary = {
    accountId: account.id,
    skipped: false,
    fetched: 0,
    imported: 0,
    duplicates: 0,
    repliesApplied: 0,
    threadsCreated: 0,
  };
  const source = deps.source ?? buildSource(db, account);
  if (!source) {
    return {
      ...summary,
      skipped: true,
      reason: `${account.provider} accounts have no mailbox to sync.`,
    };
  }
  const now = deps.now ?? new Date();

  let fetched;
  try {
    // One initial attempt plus one retry per configured delay, but
    // only while the failure looks transient. lastError is written
    // only when every attempt failed, so a recovered sync never
    // leaves a stale failure flag on the account.
    const delays = deps.retryDelaysMs ?? [2_000, 6_000];
    let attempt = 0;
    for (;;) {
      try {
        fetched = await source.fetchNewMessages(account, account.syncCursor);
        break;
      } catch (error) {
        if (attempt >= delays.length || !isTransientSyncError(error)) {
          throw error;
        }
        await sleep(delays[attempt]);
        attempt += 1;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    await db.sendingAccount.update({
      where: { id: account.id },
      data: { lastError: `Reply sync failed: ${message}` },
    });
    return { ...summary, error: message };
  }
  summary.fetched = fetched.messages.length;

  for (const message of fetched.messages) {
    await importMessage(db, account, message, summary);
  }

  await db.sendingAccount.update({
    where: { id: account.id },
    data: { syncCursor: fetched.cursor, lastSyncAt: now, lastError: null },
  });
  return summary;
}

async function importMessage(
  db: PrismaClient,
  account: SendingAccount,
  message: NormalizedInboundMessage,
  summary: AccountSyncSummary,
): Promise<void> {
  const workspaceId = account.workspaceId;

  // 1. Idempotency: the same inbound message is never imported twice.
  const already = await db.threadMessage.findFirst({
    where: { providerMessageId: message.providerMessageId, thread: { workspaceId } },
    select: { id: true },
  });
  if (already) {
    summary.duplicates += 1;
    return;
  }

  // 2a. Match by reply chain against sent messages.
  const refs = referenceCandidates(message);
  let enrollmentId: string | null = null;
  if (refs.length > 0) {
    const sentEvent = await db.emailEvent.findFirst({
      where: {
        workspaceId,
        type: "SENT",
        enrollmentId: { not: null },
        providerMessageId: { in: refs },
      },
      orderBy: { occurredAt: "desc" },
      select: { enrollmentId: true },
    });
    if (sentEvent) {
      enrollmentId = sentEvent.enrollmentId;
    }
  }

  // 2b. Fall back to the sender's email as a workspace lead.
  const fromEmail = normalizeEmail(message.fromEmail);
  const lead = await db.lead.findFirst({
    where: { workspaceId, email: fromEmail },
    select: { id: true },
  });
  let enrollment: { id: string; leadId: string; campaignId: string; status: string } | null = null;
  if (enrollmentId) {
    enrollment = await db.enrollment.findFirst({
      where: { id: enrollmentId, campaign: { workspaceId } },
      select: { id: true, leadId: true, campaignId: true, status: true },
    });
  }
  if (!enrollment && lead) {
    enrollment = await db.enrollment.findFirst({
      where: { leadId: lead.id, campaign: { workspaceId } },
      orderBy: { enrolledAt: "desc" },
      select: { id: true, leadId: true, campaignId: true, status: true },
    });
  }
  const leadId = enrollment?.leadId ?? lead?.id ?? null;

  // 3. Apply the REPLIED event through the shared path (same status
  // transition webhooks get: the enrollment stops as REPLIED). The
  // sender address feeds the classifier too (v1.11.0): automated
  // senders like noreply and system mailboxes classify AUTOMATED.
  const classification = classifyReply(message.subject, message.bodyText, message.fromEmail);
  if (enrollment) {
    const result = await applyProviderEvent(db, {
      enrollmentId: enrollment.id,
      providerMessageId: message.providerMessageId,
      type: "REPLIED",
      classification,
      occurredAt: message.receivedAt,
    });
    if (result.applied) {
      summary.repliesApplied += 1;
    }
  }

  // 4. Thread the message.
  let thread = leadId
    ? await db.thread.findFirst({
        where: { workspaceId, leadId, sendingAccountId: account.id },
        orderBy: { lastMessageAt: "desc" },
      })
    : await db.thread.findFirst({
        where: {
          workspaceId,
          sendingAccountId: account.id,
          leadId: null,
          subject: message.subject ?? "(no subject)",
        },
        orderBy: { lastMessageAt: "desc" },
      });
  if (!thread) {
    thread = await db.thread.create({
      data: {
        workspaceId,
        leadId,
        campaignId: enrollment?.campaignId ?? null,
        sendingAccountId: account.id,
        subject: message.subject ?? "(no subject)",
        status: "OPEN",
        unread: true,
        classification,
        lastMessageAt: message.receivedAt,
      },
    });
    summary.threadsCreated += 1;
  }
  await db.threadMessage.create({
    data: {
      threadId: thread.id,
      direction: "INBOUND",
      fromEmail: message.fromEmail,
      toEmail: message.toEmail,
      subject: message.subject,
      body: message.bodyText,
      providerMessageId: message.providerMessageId,
      occurredAt: message.receivedAt,
    },
  });
  await db.thread.update({
    where: { id: thread.id },
    data: {
      unread: true,
      classification,
      lastMessageAt:
        thread.lastMessageAt && thread.lastMessageAt > message.receivedAt
          ? thread.lastMessageAt
          : message.receivedAt,
      // A fresh reply reopens a closed thread; archived stays archived.
      status: thread.status === "CLOSED" ? "OPEN" : thread.status,
    },
  });
  summary.imported += 1;
}

/**
 * Syncs every connected mailbox account across all workspaces: the
 * OAuth providers (which must hold stored tokens) and SMTP accounts
 * (whose credentials resolve from the stored encrypted blob or the
 * credentialRef environment; buildSource skips the ones with
 * neither). Used by the worker tick and the cron route. Per account
 * failures are captured in that account's summary (and on its
 * lastError); this function never throws, so a broken mailbox cannot
 * block sending.
 */
export async function syncAllConnectedAccounts(
  db: PrismaClient = prisma,
): Promise<AccountSyncSummary[]> {
  const accounts = await db.sendingAccount.findMany({
    where: {
      status: "CONNECTED",
      OR: [
        {
          provider: { in: ["GMAIL", "MS365"] },
          encryptedCredentials: { not: null },
        },
        { provider: "SMTP" },
      ],
    },
  });
  const summaries: AccountSyncSummary[] = [];
  let first = true;
  for (const account of accounts) {
    // A short pause between accounts: many mailboxes often share one
    // host, and back to back logins from a single IP can trip the
    // host's login rate limits, which surface as connect timeouts.
    if (!first) {
      await sleep(250);
    }
    first = false;
    try {
      summaries.push(await syncAccount(db, account));
    } catch (error) {
      summaries.push({
        accountId: account.id,
        skipped: false,
        fetched: 0,
        imported: 0,
        duplicates: 0,
        repliesApplied: 0,
        threadsCreated: 0,
        error: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }
  return summaries;
}
