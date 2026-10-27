/**
 * Warm-up schedules for sending accounts (Phase 6).
 *
 * A brand new mailbox that jumps straight to full volume is the
 * classic way to land in spam folders. Warm-up spreads the ramp over
 * four weeks with a fixed daily ceiling per week, counted from the
 * day warm-up was switched on for the account:
 *
 *   Week 1 (days 0 to 6):    20 sends per day
 *   Week 2 (days 7 to 13):   50 sends per day
 *   Week 3 (days 14 to 20): 100 sends per day
 *   Week 4 (days 21 to 27): 200 sends per day
 *   Day 29 onwards:         no warm-up ceiling; the account's own
 *                           configured dailyLimit applies.
 *
 * This module is pure. It does not replace the age-based ramp in
 * limits.ts (which models mailbox age from account creation); the
 * worker takes the minimum of the two, so enabling warm-up can only
 * ever lower an account's effective limit, never raise it. Warm-up
 * makes no deliverability promise: it is a volume discipline, and
 * inbox placement still depends on the domain, the list, and the
 * content.
 */

/** Daily ceilings for warm-up weeks 1 to 4. */
export const WARMUP_WEEKLY_CAPS: readonly number[] = [20, 50, 100, 200];

/** Total warm-up length in days (4 weeks). */
export const WARMUP_TOTAL_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WarmupAccount {
  /** Hard cap configured on the account, messages per day. */
  dailyLimit: number;
  warmupEnabled: boolean;
  /** When warm-up was switched on. Null means "not started", which
   *  the cap treats as day zero when warm-up is enabled. */
  warmupStartedAt: Date | null;
}

/** Whole days between the warm-up start and `today`, never negative. */
export function warmupAgeInDays(startedAt: Date, today: Date): number {
  const elapsed = today.getTime() - startedAt.getTime();
  return Math.max(0, Math.floor(elapsed / DAY_MS));
}

/**
 * The warm-up ceiling for an account that has been warming up for
 * `ageInDays` days, or null when warm-up imposes no ceiling (the
 * schedule is complete).
 */
export function warmupCap(ageInDays: number): number | null {
  const age = Math.max(0, Math.floor(ageInDays));
  const week = Math.floor(age / 7);
  if (week >= WARMUP_WEEKLY_CAPS.length) {
    return null;
  }
  return WARMUP_WEEKLY_CAPS[week];
}

/** The warm-up ceiling for this account today, or null for none. */
export function warmupCapFor(account: WarmupAccount, today: Date): number | null {
  if (!account.warmupEnabled) {
    return null;
  }
  const age = account.warmupStartedAt ? warmupAgeInDays(account.warmupStartedAt, today) : 0;
  return warmupCap(age);
}

/**
 * The account's daily limit under warm-up alone: the configured
 * dailyLimit when warm-up is off or complete, otherwise the smaller
 * of the dailyLimit and the warm-up ceiling for today.
 */
export function effectiveDailyLimit(account: WarmupAccount, today: Date): number {
  const cap = Math.max(0, Math.floor(account.dailyLimit));
  const warmupCeiling = warmupCapFor(account, today);
  if (warmupCeiling === null) {
    return cap;
  }
  return Math.min(cap, warmupCeiling);
}

export interface WarmupProgress {
  /** 1-based day of the schedule, clamped to the 28 day schedule. */
  day: number;
  totalDays: number;
  /** Days elapsed since the start (0 based), for cap lookups. */
  ageInDays: number;
  complete: boolean;
}

/** Progress hint for the accounts UI: "day N of 28". */
export function warmupProgress(startedAt: Date | null, today: Date): WarmupProgress {
  if (!startedAt) {
    return { day: 1, totalDays: WARMUP_TOTAL_DAYS, ageInDays: 0, complete: false };
  }
  const ageInDays = warmupAgeInDays(startedAt, today);
  return {
    day: Math.min(ageInDays + 1, WARMUP_TOTAL_DAYS),
    totalDays: WARMUP_TOTAL_DAYS,
    ageInDays,
    complete: ageInDays >= WARMUP_TOTAL_DAYS,
  };
}
