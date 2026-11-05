import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards for public/sw.js. The service worker is a static file, so
 * these tests read it as text and pin the privacy rules in place:
 * API traffic and signed in pages must never be cached, because
 * ColdReach is multi tenant and a cache hit could leak one
 * workspace's data to another user of the same device.
 */
const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

describe("service worker privacy guards", () => {
  it("never intercepts API traffic", () => {
    expect(sw).toContain('url.pathname.startsWith("/api/")');
  });

  it("only handles GET requests", () => {
    expect(sw).toContain('request.method !== "GET"');
  });

  it("answers failed navigations with the offline page, not a cached page", () => {
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain('OFFLINE_URL = "/offline"');
    expect(sw).toContain("cache.match(OFFLINE_URL)");
  });

  it("caches only fingerprinted static assets and the PWA icons", () => {
    expect(sw).toContain('url.pathname.startsWith("/_next/static/")');
    expect(sw).toContain('url.pathname.startsWith("/icons/")');
  });

  it("precaches no signed in route", () => {
    const precacheBlock = sw.slice(sw.indexOf("PRECACHE_URLS"), sw.indexOf("];"));
    // Quoted route prefixes only: "/icons/apple-touch-icon.png"
    // contains the letters /app but is a public icon, not a route.
    expect(precacheBlock).not.toMatch(/"\/(app|api)(\/|")/);
  });
});
