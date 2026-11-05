"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, SquarePen, X } from "lucide-react";
import { ComposeEmail } from "@/components/inbox/ComposeEmail";
import {
  MOBILE_MORE_ITEMS,
  MOBILE_PRIMARY_ITEMS,
  PLATFORM_ADMIN_NAV_ITEM,
} from "@/lib/navigation";

function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

/**
 * Bottom tab bar for phones. The desktop sidebar is hidden below
 * the md breakpoint, so without this the installed app and the
 * mobile website had no navigation at all. Renders only on small
 * screens; the sidebar takes over from md up.
 */
export function MobileNav({ showPlatformAdmin = false }: { showPlatformAdmin?: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const moreItems = showPlatformAdmin
    ? [...MOBILE_MORE_ITEMS, PLATFORM_ADMIN_NAV_ITEM]
    : MOBILE_MORE_ITEMS;
  const moreActive = moreItems.some((item) => isActive(pathname, item.href));

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary mobile"
      >
        <div className="flex items-stretch justify-around">
          {MOBILE_PRIMARY_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-16 flex-col items-center gap-0.5 px-3 py-2 text-[11px] font-medium ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className={`flex min-w-16 flex-col items-center gap-0.5 px-3 py-2 text-[11px] font-medium ${
              moreActive ? "text-accent" : "text-muted"
            }`}
          >
            <Menu className="h-6 w-6" aria-hidden="true" />
            More
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More destinations">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 h-full w-full bg-black/40"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl bg-surface p-4 shadow-pop"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-base font-semibold tracking-tight">Menu</span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-muted hover:bg-elevated hover:text-fg"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="space-y-1" aria-label="More">
              <button
                type="button"
                className="nav-link w-full"
                onClick={() => {
                  setMoreOpen(false);
                  setComposeOpen(true);
                }}
              >
                <SquarePen className="h-5 w-5 shrink-0" aria-hidden="true" />
                Compose
              </button>
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`nav-link ${active ? "nav-link-active" : ""}`}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}

      <ComposeEmail open={composeOpen} onClose={() => setComposeOpen(false)} />
    </>
  );
}
