/**
 * Simple in-memory per-key rate limiter for the public API.
 *
 * Fixed window: at most `limit` requests per `windowMs` per key. The
 * state lives in this process's memory only, which means the limit
 * is per instance: on a multi-instance deployment each instance
 * allows its own window, and a restart resets the counters. That is
 * documented in API.md; it is a guardrail against accidents and
 * runaway scripts, not a billing-grade metering system.
 */

export const API_RATE_LIMIT = 120;
export const API_RATE_WINDOW_MS = 60_000;

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets; only meaningful when blocked. */
  retryAfterSeconds: number;
}

export function checkRateLimit(
  keyId: string,
  now: number = Date.now(),
  limit: number = API_RATE_LIMIT,
  windowMs: number = API_RATE_WINDOW_MS,
): RateLimitResult {
  const existing = buckets.get(keyId);
  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(keyId, { windowStart: now, count: 1 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.windowStart + windowMs - now) / 1000)),
    };
  }
  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** Test hook: clears all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
