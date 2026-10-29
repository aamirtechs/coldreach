"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CreditCard,
  Inbox,
  LayoutDashboard,
  MailCheck,
  ListChecks,
  Mail,
  Plug,
  Send,
  Settings,
  SquarePen,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ComposeEmail } from "@/components/inbox/ComposeEmail";
import { SidebarStatus } from "@/components/SidebarStatus";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/campaigns", label: "Campaigns", icon: Send },
  { href: "/app/leads", label: "Leads", icon: ListChecks },
  { href: "/app/inbox", label: "Inbox", icon: Inbox },
  { href: "/app/outbox", label: "Outbox", icon: MailCheck },
  { href: "/app/accounts", label: "Sending Accounts", icon: Mail },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/app/team", label: "Team", icon: Users },
  { href: "/app/agency", label: "Agency", icon: Building2 },
  { href: "/app/integrations", label: "Integrations", icon: Plug },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [composeOpen, setComposeOpen] = useState(false);

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-display text-sm font-bold text-white">
          CR
        </span>
        <span className="font-display text-lg font-semibold tracking-tight">ColdReach</span>
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Fragment key={item.href}>
              {item.href === "/app/inbox" ? (
                <button
                  type="button"
                  className="btn-primary w-full"
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
