import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import "flag-icons/css/flag-icons.min.css";
import { PwaRegister } from "@/components/PwaRegister";
import { PWA_THEME_COLOR, PWA_THEME_COLOR_DARK } from "@/lib/pwa";

export const metadata: Metadata = {
  title: "ColdReach, cold email outreach with guardrails",
  description:
    "ColdReach helps sales teams and lead generation agencies run compliant cold email campaigns with scheduling controls, suppression enforcement, and honest analytics.",
  applicationName: "ColdReach",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ColdReach",
  },
  icons: {
    // Declaring any icons here replaces the app/icon.svg file
    // convention output entirely (v1.35.1 fix: pages were emitting
    // only the Apple icon, so the tab favicon went missing wherever
    // the browser did not fall back to the manifest icons). List
    // every icon explicitly so every page carries the full set.
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
    shortcut: "/favicon.ico",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PWA_THEME_COLOR },
    { media: "(prefers-color-scheme: dark)", color: PWA_THEME_COLOR_DARK },
  ],
};

// Runs before first paint so the stored theme is applied without a flash.
const themeInitScript = `
try {
  var stored = localStorage.getItem("coldreach-theme");
  var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (stored === "dark" || (!stored && prefersDark)) {
    document.documentElement.classList.add("dark");
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="coldreach-theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
