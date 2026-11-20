import { CONVERSATION_DISPOSITIONS } from "./dispositions";

/**
 * Tracking helpers for the Calling section (v1.43.0). Pure functions
 * over plain log shapes so the stats and the callbacks-due list are
 * unit testable without a database. Dates may arrive as Date objects
 * (Prisma) or ISO strings (JSON), so every comparison normalises
 * through toTime first.
 */

export interface CallLogLike {
  leadId: string | null;
  disposition: string;
  calledAt: Date | string;
  followUpAt: Date | string | null;
}

export interface CallingStats {
  callsToday: number;
  totalCalls: number;
  talked: number;
  interested: number;
  callbacksBooked: number;
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function summarizeCallLogs(logs: CallLogLike[], now: Date = new Date()): CallingStats {
  let callsToday = 0;
  let talked = 0;
  let interested = 0;
  let callbacksBooked = 0;
  for (const log of logs) {
    if (sameLocalDay(new Date(toTime(log.calledAt)), now)) callsToday += 1;
    if (CONVERSATION_DISPOSITIONS.has(log.disposition)) talked += 1;
    if (log.disposition === "INTERESTED") interested += 1;
    if (log.disposition === "CALLBACK" && log.followUpAt) callbacksBooked += 1;
  }
  return { callsToday, totalCalls: logs.length, talked, interested, callbacksBooked };
}

export interface CallbackDue<T extends CallLogLike> {
  log: T;
  followUpAt: Date;
  due: boolean;
}

/**
 * The follow ups still owed to the caller: for each lead, only its
 * latest log carrying a follow up time counts (a lead called again
 * after booking a follow up supersedes the older booking). Any
 * disposition can carry the booking: a plain Callback does, and so
 * does an Interested log whose ending booked the walkthrough, which
 * the guided call flow stores as a follow up date on an INTERESTED
 * log rather than a CALLBACK one. Sorted with the soonest first,
 * overdue entries included and flagged due.
 */
export function callbacksDue<T extends CallLogLike>(logs: T[], now: Date = new Date()): CallbackDue<T>[] {
  const latestByLead = new Map<string, T>();
  for (const log of logs) {
    if (!log.leadId || !log.followUpAt) continue;
    const existing = latestByLead.get(log.leadId);
    if (!existing || toTime(log.calledAt) > toTime(existing.calledAt)) {
      latestByLead.set(log.leadId, log);
    }
  }
  return [...latestByLead.values()]
    .map((log) => {
      const followUpAt = new Date(toTime(log.followUpAt as Date | string));
      return { log, followUpAt, due: followUpAt.getTime() <= now.getTime() };
    })
    .sort((a, b) => a.followUpAt.getTime() - b.followUpAt.getTime());
}
