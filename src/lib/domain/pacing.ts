/**
 * Workspace send pacing (v1.11.4).
 *
 * Why this exists: the sending domain's mail host enforces a hard
 * per-domain hourly relay limit (cPanel's "max emails per hour",
 * 100/hour on the current HosterPK plan). The worker's daily ramp
 * averages well under that, but a tick that finds a large due pool
 * at a window opening can submit the whole batch inside a minute.
 * The host then defers the excess ("Domain has exceeded the max
 * emails per hour. Message will be reattempted later"), which delays
 * delivery, pollutes the sending inboxes with deferral notices, and
 * risks queue expiry on a shared host we do not control.
 *
 * Two cooperating limits keep submission smooth and under the host
 * cap, per workspace (all of a workspace's accounts share one
 * sending domain in practice):
 *
 * - A rolling 60 minute cap on real sends, default 90, leaving
 *   headroom under the host's 100 for any non-ColdReach mail the
 *   domain sends.
 * - A per-tick ceiling on real sends, default 20, so a single tick
 *   never dumps its whole budget at once; ticks run every few
 *   minutes, which spreads each hour's sends across the hour.
 *
 * Both are overridable by environment (HOURLY_SEND_CAP,
 * SEND_TICK_MAX_SENDS) so a hosting limit increase can be adopted
 * without a code change. Simulated sends never consume either
 * budget: they never reach an SMTP server.
 */

export const DEFAULT_HOURLY_SEND_CAP = 90;
export const DEFAULT_TICK_SEND_CEILING = 20;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

/** Max real sends per workspace in any rolling 60 minute window. */
export function hourlySendCap(env: Record<string, string | undefined> = process.env): number {
  return parsePositiveInt(env.HOURLY_SEND_CAP, DEFAULT_HOURLY_SEND_CAP);
}

/** Max real sends a single worker tick may perform. */
export function tickSendCeiling(env: Record<string, string | undefined> = process.env): number {
  return parsePositiveInt(env.SEND_TICK_MAX_SENDS, DEFAULT_TICK_SEND_CEILING);
}

/** Sends still allowed in the current rolling hour. */
export function hourlyBudget(sentLastHour: number, cap: number): number {
  return Math.max(0, cap - sentLastHour);
}
