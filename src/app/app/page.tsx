import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ListChecks, Mail, Send, ShieldCheck, type LucideIcon } from "lucide-react";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getOnboardingState } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

interface Stat {
  label: string;
  value: number;
  icon: LucideIcon;
  note: string;
}

export default async function DashboardPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const workspaceId = session.workspace.id;

  const [campaignCount, leadCount, accountCount, suppressionCount] = await Promise.all([
    prisma.campaign.count({ where: { workspaceId } }),
    prisma.lead.count({ where: { workspaceId } }),
    prisma.sendingAccount.count({ where: { workspaceId } }),
    prisma.suppression.count({ where: { OR: [{ workspaceId }, { scope: "GLOBAL" }] } }),
  ]);

  const stats: Stat[] = [
    {
      label: "Campaigns",
      value: campaignCount,
      icon: Send,
      note: "Across all statuses in this workspace",
    },
    {
      label: "Leads",
      value: leadCount,
      icon: ListChecks,
      note: "Contacts stored in this workspace",
    },
    {
      label: "Sending accounts",
      value: accountCount,
      icon: Mail,
      note: "Connected mailboxes in this workspace",
    },
    {
      label: "Suppressions in force",
      value: suppressionCount,
      icon: ShieldCheck,
      note: "Workspace entries plus global entries",
    },
  ];

  const isEmpty = campaignCount + leadCount + accountCount === 0;
  const onboarding = await getOnboardingState(prisma, workspaceId);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">
        Live counts from {session.workspace.name}. Nothing here is estimated or sampled.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <section key={stat.label} className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted">{stat.label}</h2>
                <Icon className="h-5 w-5 text-accent" />
              </div>
              <p className="mt-2 font-display text-3xl font-semibold">{stat.value}</p>
              <p className="mt-1 text-xs text-muted">{stat.note}</p>
            </section>
          );
        })}
      </div>

      {onboarding.complete ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted">
          <ListChecks className="h-4 w-4 text-accent" />
          Getting started: all set. Every setup step is complete for this workspace.
        </p>
      ) : (
        <section className="card mt-6 p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-lg font-semibold">Getting started</h2>
            <span className="text-xs font-medium text-muted">
              {onboarding.doneCount} of {onboarding.total} done
            </span>
          </div>
          <ul className="mt-4 space-y-2">
            {onboarding.items.map((item) => (
              <li key={item.key} className="flex items-center gap-3 text-sm">
                <span
                  className={
                    item.done
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white"
                      : "flex h-5 w-5 items-center justify-center rounded-full border border-line text-[11px] text-muted"
                  }
                >
                  {item.done ? "✓" : ""}
                </span>
                {item.done ? (
                  <span className="text-muted line-through">{item.label}</span>
                ) : (
                  <Link href={item.href} className="font-medium hover:text-accent">
                    {item.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            The checklist reads live workspace state, so completing a step anywhere checks it off here.
          </p>
        </section>
      )}

      {isEmpty ? (
        <section className="card mt-6 p-8 text-center">
          <h2 className="font-display text-xl font-semibold">Your workspace is empty, on purpose</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">
            ColdReach ships with no sample campaigns, no demo leads, and no invented charts.
            When you import leads and launch campaigns, this dashboard fills with numbers
            computed from your real sending events.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/app/campaigns" className="btn-primary">
              Create your first campaign
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/app/leads" className="btn-secondary">
              Import leads
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted">
            Start by importing leads and adding a sending account, then create a campaign.
          </p>
        </section>
      ) : (
        <section className="card mt-6 p-6">
          <h2 className="font-display text-lg font-semibold">Activity</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Per-campaign results computed from recorded email events live on the Analytics
            page. ColdReach never backfills a chart with plausible looking invented data.
          </p>
        </section>
      )}
    </div>
  );
}
