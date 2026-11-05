import {
  BarChart3,
  Building2,
  CreditCard,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Mail,
  MailCheck,
  Plug,
  Send,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface AppNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Single source of truth for the app destinations. The desktop
 * sidebar, the mobile bottom bar, and the mobile More sheet all
 * render from this list, so a destination can never exist in one
 * shell and silently go missing in another.
 */
export const APP_NAV_ITEMS: AppNavItem[] = [
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

export const PLATFORM_ADMIN_NAV_ITEM: AppNavItem = {
  href: "/app/admin",
  label: "Platform Admin",
  icon: ShieldCheck,
};

/** The four destinations with a permanent slot in the mobile bottom bar. */
export const MOBILE_PRIMARY_HREFS = ["/app", "/app/campaigns", "/app/inbox", "/app/outbox"];

export const MOBILE_PRIMARY_ITEMS: AppNavItem[] = APP_NAV_ITEMS.filter((item) =>
  MOBILE_PRIMARY_HREFS.includes(item.href),
);

/** Every remaining destination, reached through the mobile More sheet. */
export const MOBILE_MORE_ITEMS: AppNavItem[] = APP_NAV_ITEMS.filter(
  (item) => !MOBILE_PRIMARY_HREFS.includes(item.href),
);
