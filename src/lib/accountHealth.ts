/**
 * Sending account health (v1.11.0).
 *
 * A small rules layer over facts the product already records: the
 * account status, the last reply sync error stored on the account
 * (syncService writes "Reply sync failed: ..." into lastError), and
 * the account's SENT and BOUNCED email events over the last 7 days.
 *
 * States are deliberately conservative. "critical" is reserved for
 * conditions where continuing to send risks the domain: a provider
 * ERROR status, or a bounce rate of 8% or more across at least 30
 * sends in 7 days. Healthy production accounts run far below these
 * lines (a fraction of a percent bounces), so the worker gate that
 * consumes the critical state cannot trip on normal traffic.
 * "attention" surfaces problems a human should look at without
 * stopping sends: a stored reply sync error, a bounce rate of 4% or
 * more across at least 20 sends, or a PAUSED or DISCONNECTED status.
 *
 * The small-sample guards matter: 1 bounce out of 3 sends is 33% and
 * means nothing, so rates only count once the send floor is met.
 */

import type { PrismaClient } from "@prisma/client";

export type AccountHealthState = "healthy" | "attention" | "critical";

export interface AccountHealth {
  state: AccountHealthState;
  reasons: string[];
  /** Bounced divided by sent over the window, 0 when nothing sent. */
  bounceRate: number;
  sent7d: number;
  bounced7d: number;
  /** True when the critical state comes from the bounce rate rule
   *  specifically. The sendTick gate acts only on this rule: an
   *  ERROR status is already excluded by the existing status check,
   *  and this flag keeps the two mechanisms from double-counting. */
  bounceCritical: boolean;
}

export interface AccountHealthInput {
  status: string;
  /** The account's stored lastError; reply sync failures are stored
   *  here with a "Reply sync failed:" prefix by the sync service. */
  lastError?: string | null;
  sent7d: number;
  bounced7d: number;
}

export const BOUNCE_CRITICAL_RATE = 0.08;
export const BOUNCE_CRITICAL_MIN_SENDS = 30;
export const BOUNCE_ATTENTION_RATE = 0.04;
export const BOUNCE_ATTENTION_MIN_SENDS = 20;

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function computeAccountHealth(input: AccountHealthInput): AccountHealth {
  const sent7d = Math.max(0, input.sent7d);
  const bounced7d = Math.max(0, input.bounced7d);
  const bounceRate = sent7d > 0 ? bounced7d / sent7d : 0;
  const reasons: string[] = [];
  let state: AccountHealthState = "healthy";
  let bounceCritical = false;

  const raise = (next: AccountHealthState) => {
    if (next === "critical" || state === "healthy") {
      state = next;
    }
  };

  if (input.status === "ERROR") {
    reasons.push("Account is in an error state at the provider.");
    raise("critical");
  }

  if (sent7d >= BOUNCE_CRITICAL_MIN_SENDS && bounceRate >= BOUNCE_CRITICAL_RATE) {
    reasons.push(
      `Bounce rate is ${percent(bounceRate)} over the last 7 days (${bounced7d} of ${sent7d} sends), above the 8% safety line.`,
    );
    bounceCritical = true;
    raise("critical");
  } else if (sent7d >= BOUNCE_ATTENTION_MIN_SENDS && bounceRate >= BOUNCE_ATTENTION_RATE) {
    reasons.push(
      `Bounce rate is ${percent(bounceRate)} over the last 7 days (${bounced7d} of ${sent7d} sends), above the 4% watch line.`,
    );
    raise("attention");
  }

  if (input.lastError && input.lastError.startsWith("Reply sync failed")) {
    reasons.push("Reply sync is failing for this account, so replies may not be arriving in the inbox.");
    raise("attention");
  }

  if (input.status === "PAUSED") {
    reasons.push("Account is paused and not sending.");
    raise("attention");
  } else if (input.status === "DISCONNECTED") {
    reasons.push("Account is not connected.");
    raise("attention");
  }

  return { state, reasons, bounceRate, sent7d, bounced7d, bounceCritical };
}

interface HealthDb {
  emailEvent: {
    groupBy: (args: unknown) => Promise<Array<{ sendingAccountId: string | null; type: string; _count: { _all: number } }>>;
  };
}
/**
 * Batch-compute health for a set of accounts from their last 7 days
 * of SENT and BOUNCED events. One groupBy serves the whole set, so
 * callers with many accounts (the accounts API, the dashboard, the
 * worker gate) stay at a constant query count.
 */
export async function computeAccountHealthForAccounts(
  db: PrismaClient,
  accounts: Array<{ id: string; status: string; lastError?: string | null }>,
  now: Date = new Date(),
): Promise<Map<string, AccountHealth>> {
  const result = new Map<string, AccountHealth>();
  if (accounts.length === 0) {
    return result;
  }
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const groups = await (db as unknown as HealthDb).emailEvent.groupBy({
    by: ["sendingAccountId", "type"],
    where: {
      sendingAccountId: { in: accounts.map((account) => account.id) },
      type: { in: ["SENT", "BOUNCED"] },
      occurredAt: { gte: since },
    },
    _count: { _all: true },
  });
  const counts = new Map<string, { sent: number; bounced: number }>();
  for (const group of groups) {
    if (!group.sendingAccountId) continue;
    const entry = counts.get(group.sendingAccountId) ?? { sent: 0, bounced: 0 };
    if (group.type === "SENT") entry.sent = group._count._all;
    if (group.type === "BOUNCED") entry.bounced = group._count._all;
    counts.set(group.sendingAccountId, entry);
  }
  for (const account of accounts) {
    const entry = counts.get(account.id) ?? { sent: 0, bounced: 0 };
    result.set(
      account.id,
      computeAccountHealth({
        status: account.status,
        lastError: account.lastError ?? null,
        sent7d: entry.sent,
        bounced7d: entry.bounced,
      }),
    );
  }
  return result;
}
