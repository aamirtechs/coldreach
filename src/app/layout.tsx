import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "ColdReach, cold email outreach with guardrails",
  description:
    "ColdReach helps sales teams and lead generation agencies run compliant cold email campaigns with scheduling controls, suppression enforcement, and honest analytics.",
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
        {children}
      </body>
    </html>
  );
}
