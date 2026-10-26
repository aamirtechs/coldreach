/**
 * Effective daily sending limits.
 *
 * A sending account has a hard daily cap. New accounts ramp towards that
 * cap over a number of days, starting from a percentage of the cap, so a
 * fresh mailbox does not jump straight to full volume. The effective
 * limit never exceeds the configured cap, and never drops below one
 * message when the cap is positive.
 */

export interface RampAccount {
  /** Hard cap configured on the account, messages per day. */
  dailyLimit: number;
  /** Age of the account in whole days. */
  ageInDays: number;
}

export interface RampConfig {
  /** Turn the ramp on or off. Defaults to on. */
  enabled?: boolean;
  /** Days over which the ramp runs. Defaults to 14. */
  rampDays?: number;
  /** Percentage of the cap available on day zero. Defaults to 20. */
  startPercent?: number;
}

const DEFAULT_RAMP_DAYS = 14;
const DEFAULT_START_PERCENT = 20;

export function effectiveDailyLimit(account: RampAccount, ramp: RampConfig = {}): number {
  const cap = Math.max(0, Math.floor(account.dailyLimit));
  if (cap === 0) {
    return 0;
  }

  const enabled = ramp.enabled ?? true;
  if (!enabled) {
    return cap;
  }

  const rampDays = Math.max(1, ramp.rampDays ?? DEFAULT_RAMP_DAYS);
  const startPercent = Math.min(100, Math.max(0, ramp.startPercent ?? DEFAULT_START_PERCENT));
  const age = Math.max(0, Math.floor(account.ageInDays));

  if (age >= rampDays) {
    return cap;
  }

  const percent = startPercent + ((100 - startPercent) * age) / rampDays;
  const limit = Math.floor((cap * percent) / 100);
  return Math.min(cap, Math.max(1, limit));
}
