import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_RATE_LIMIT,
  AUTH_RATE_WINDOW_MS,
  authRateLimitKey,
  checkAuthRateLimit,
  clientIp,
  resetAuthRateLimits,
} from "./rateLimit";

describe("auth rate limiter", () => {
  beforeEach(() => {
    resetAuthRateLimits();
  });

  it("allows up to the limit, then blocks with a retry delay", () => {
    const key = "login:1.2.3.4:a@example.com";
    const start = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT; i += 1) {
      const result = checkAuthRateLimit(key, start + i * 1000);
      expect(result.allowed).toBe(true);
    }
    const blocked = checkAuthRateLimit(key, start + AUTH_RATE_LIMIT * 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(AUTH_RATE_WINDOW_MS / 1000);
  });

  it("opens a fresh window after the window elapses", () => {
    const key = "login:1.2.3.4:b@example.com";
    const start = 5_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT; i += 1) {
      checkAuthRateLimit(key, start);
    }
    expect(checkAuthRateLimit(key, start + 1000).allowed).toBe(false);
    const after = checkAuthRateLimit(key, start + AUTH_RATE_WINDOW_MS + 1);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(AUTH_RATE_LIMIT - 1);
  });

  it("tracks different keys independently", () => {
    const start = 9_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT; i += 1) {
      checkAuthRateLimit("login:1.1.1.1:c@example.com", start);
    }
    expect(checkAuthRateLimit("login:1.1.1.1:c@example.com", start).allowed).toBe(false);
    expect(checkAuthRateLimit("login:2.2.2.2:c@example.com", start).allowed).toBe(true);
    expect(checkAuthRateLimit("signup:1.1.1.1:c@example.com", start).allowed).toBe(true);
  });

  it("honours custom limits for small windows", () => {
    expect(checkAuthRateLimit("k", 0, 2, 1000).allowed).toBe(true);
    expect(checkAuthRateLimit("k", 1, 2, 1000).allowed).toBe(true);
    const blocked = checkAuthRateLimit("k", 2, 2, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
  });

  it("derives keys from scope, forwarded IP, and lowercased email", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(request)).toBe("203.0.113.7");
    expect(authRateLimitKey("login", request, "Person@Example.com")).toBe(
      "login:203.0.113.7:person@example.com",
    );
    const bare = new Request("http://localhost/api/auth/login");
    expect(clientIp(bare)).toBe("unknown");
  });
});
