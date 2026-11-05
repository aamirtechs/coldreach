"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SquarePen } from "lucide-react";
import { ComposeEmail } from "@/components/inbox/ComposeEmail";
import { SidebarStatus } from "@/components/SidebarStatus";
import { APP_NAV_ITEMS, PLATFORM_ADMIN_NAV_ITEM } from "@/lib/navigation";

const NAV_ITEMS = APP_NAV_ITEMS;
const ADMIN_ITEM = PLATFORM_ADMIN_NAV_ITEM;

export function Sidebar({ showPlatformAdmin = false }: { showPlatformAdmin?: boolean }) {
  const pathname = usePathname();
  const [composeOpen, setComposeOpen] = useState(false);
  const navItems = showPlatformAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-display text-sm font-bold text-white">
          CR
        </span>
        <span className="font-display text-lg font-semibold tracking-tight">ColdReach</span>
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Primary">
        {navItems.map((item) => {
          const active =
            item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Fragment key={item.href}>
              {item.href === "/app/inbox" ? (
                <button
                  type="button"
                  className="nav-link w-full"
                  onClick={() => setComposeOpen(true)}
                >
                  <SquarePen className="h-5 w-5 shrink-0" aria-hidden="true" />
                  Compose
                </button>
              ) : null}
              <Link
                href={item.href}
                className={`nav-link ${active ? "nav-link-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            </Fragment>
          );
        })}
      </nav>
      <ComposeEmail open={composeOpen} onClose={() => setComposeOpen(false)} />
      <SidebarStatus />
    </aside>
  );
}
