/**
 * Security response headers, applied to every route (pages, API,
 * static) through the headers() hook in next.config.ts.
 *
 * The CSP tradeoffs are deliberate and recorded in SECURITY.md:
 * script-src and style-src include 'unsafe-inline' because the app
 * ships an inline theme-init script (next/script beforeInteractive,
 * src/app/layout.tsx) and inline style attributes from components,
 * and Next.js is not running a nonce pipeline here. Everything else
 * is locked to 'self': no third-party scripts, styles, fonts, frames,
 * or form targets can be pulled in. frame-ancestors 'none' plus
 * X-Frame-Options DENY block embedding outright.
 *
 * HSTS and upgrade-insecure-requests are production only: locally the
 * app is served over plain HTTP and both would break it.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

export function contentSecurityPolicy(isProduction: boolean): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (isProduction) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

export function securityHeaders(isProduction: boolean): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isProduction) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "X-Frame-Options", value: "DENY" },
  ];
  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }
  return headers;
}
