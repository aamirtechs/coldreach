import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./headers";

function headerMap(isProduction: boolean): Map<string, string> {
  return new Map(securityHeaders(isProduction).map((header) => [header.key, header.value]));
}

describe("security headers", () => {
  it("sets the baseline headers on every response", () => {
    const headers = headerMap(false);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.has("Content-Security-Policy")).toBe(true);
  });

  it("locks the CSP to self with the documented inline allowances", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("https:");
    expect(csp).not.toContain("*");
  });

  it("adds HSTS and upgrade-insecure-requests only in production", () => {
    const dev = headerMap(false);
    expect(dev.has("Strict-Transport-Security")).toBe(false);
    expect(dev.get("Content-Security-Policy")).not.toContain("upgrade-insecure-requests");

    const prod = headerMap(true);
    expect(prod.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(prod.get("Content-Security-Policy")).toContain("upgrade-insecure-requests");
  });
});
