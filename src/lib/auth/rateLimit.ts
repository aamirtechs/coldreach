/**
 * In-memory rate limiter for the credential endpoints (login and
 * signup). Mirrors the public API limiter in src/lib/apiKeys: a
 * fixed window per key, state in this process's memory only.
 *
 * The limit is per instance: a multi-instance deployment allows one
 * window per instance and a restart resets counters. It raises the
 * cost of online password guessing and signup spam; it is not a
 * substitute for a WAF or a shared store at real scale. That tradeoff
 * is recorded in SECURITY.md.
 *
 * Keys are `${scope}:${ip}:${email}` so a flood against one account
 * from one address never locks out other users, and the same address
 * trying many accounts still burns one bucket per account tried.
 */

export const AUTH_RATE_LIMIT = 10;
export const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export interface AuthRateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets; only meaningful when blocked. */
  retryAfterSeconds: number;
}

/** Best-effort client IP: the first hop of x-forwarded-for, if any. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function authRateLimitKey(scope: "login" | "signup", request: Request, email: string): string {
  return `${scope}:${clientIp(request)}:${email.toLowerCase()}`;
}

export function checkAuthRateLimit(
  key: string,
  now: number = Date.now(),
  limit: number = AUTH_RATE_LIMIT,
  windowMs: number = AUTH_RATE_WINDOW_MS,
): AuthRateLimitResult {
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
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

/** The 429 response both credential routes return when limited. */
export function rateLimitedResponse(result: AuthRateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: "Too many attempts. Please wait a few minutes and try again." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSeconds),
      },
    },
  );
}

/** Test hook: clears all buckets. */
export function resetAuthRateLimits(): void {
  buckets.clear();
}
