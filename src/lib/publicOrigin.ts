/**
 * The public origin of the app as visitors see it (v1.32.0).
 *
 * Behind a reverse proxy (Caddy in production), Next.js builds
 * request.nextUrl from the address it listens on, which is
 * localhost:3000, so any redirect built from nextUrl sends visitors
 * to localhost. The proxy already tells the truth in its forwarded
 * headers; this helper prefers them, then a non-local Host header,
 * then the configured APP_URL, and only as a last resort the
 * request's own origin (correct in local development, where there
 * is no proxy).
 */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function firstHeaderValue(value: string | null | undefined): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

export function publicOrigin(args: {
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  host?: string | null;
  appUrl?: string | null;
  fallback: string;
}): string {
  const proto = firstHeaderValue(args.forwardedProto) ?? "https";
  const forwardedHost = firstHeaderValue(args.forwardedHost);
  if (forwardedHost) {
    return `${proto}://${forwardedHost}`;
  }
  const host = args.host?.trim();
  if (host && !LOCAL_HOST.test(host)) {
    return `${proto}://${host}`;
  }
  const appUrl = args.appUrl?.trim().replace(/\/$/, "");
  if (appUrl) {
    return appUrl;
  }
  return args.fallback;
}
