import type { MetadataRoute } from "next";

/**
 * PWA identity for ColdReach. The manifest is served by Next from
 * src/app/manifest.ts using exactly this object, so what the tests
 * assert here is what browsers receive.
 *
 * start_url is /app: an installed ColdReach opens the signed in app,
 * and the middleware sends anyone without a session to /login first.
 * Scope is the whole origin so deep links (a campaign, an inbox
 * thread shared into the app) stay inside the installed window.
 */
export const PWA_THEME_COLOR = "#4f46e5";
export const PWA_THEME_COLOR_DARK = "#020617";
export const PWA_BACKGROUND_COLOR = "#f8fafc";

export const pwaManifest: MetadataRoute.Manifest = {
  name: "ColdReach",
  short_name: "ColdReach",
  description:
    "Cold email outreach with guardrails: campaigns, leads, inbox, and honest analytics.",
  start_url: "/app",
  scope: "/",
  display: "standalone",
  background_color: PWA_BACKGROUND_COLOR,
  theme_color: PWA_THEME_COLOR,
  categories: ["business", "productivity"],
  icons: [
    {
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};
