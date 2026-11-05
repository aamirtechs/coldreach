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
    apple: "/icons/apple-touch-icon.png",
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
