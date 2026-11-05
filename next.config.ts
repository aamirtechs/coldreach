import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Every route: app pages, API routes, and static assets.
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "production"),
      },
      {
        // The service worker must never be served stale: an old
        // worker would keep an old release alive on installed apps.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        // PWA icons are stable brand assets; let installed apps and
        // browsers keep them for a year.
        source: "/icons/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
