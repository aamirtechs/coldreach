import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  Flame,
  ListChecks,
  Mail,
  Play,
  Reply,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getOnboardingState } from "@/lib/onboarding";
import { getSendingSchedule } from "@/lib/sendingSchedule";

/** "28 Oct, 09:00" in the given IANA timezone, for schedule rows. */
function formatInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

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

  const [runningCampaignCount, sentCount, openedCount, repliedCount, suspendedAccountCount, warmupAccounts] =
    await Promise.all([
      prisma.campaign.count({ where: { workspaceId, status: "RUNNING" } }),
      prisma.emailEvent.count({ where: { workspaceId, type: "SENT" } }),
      prisma.emailEvent.count({ where: { workspaceId, type: "OPENED" } }),
      prisma.emailEvent.count({ where: { workspaceId, type: "REPLIED" } }),
      prisma.sendingAccount.count({ where: { workspaceId, status: { in: ["PAUSED", "ERROR"] } } }),
      prisma.sendingAccount.findMany({
        where: { workspaceId, warmupEnabled: true },
        select: { warmupStartedAt: true },
      }),
    ]);
  // An account counts as warmed once its 4-week warmup curve (see
  // src/lib/domain/warmup.ts) has fully elapsed since warmupStartedAt.
  const warmedAccountCount = warmupAccounts.filter(
    (account) =>
      account.warmupStartedAt !== null &&
      account.warmupStartedAt.getTime() <= Date.now() - 28 * 24 * 60 * 60 * 1000,
  ).length;

  const liveStats: Stat[] = [
    {
      label: "Running campaigns",
      value: runningCampaignCount,
      icon: Play,
      note: "Campaigns currently sending",
    },
    {
      label: "Emails sent",
      value: sentCount,
      icon: Send,
      note: "Recorded SENT events, all time",
    },
    {
      label: "Opened",
      value: openedCount,
      icon: Eye,
      note: "Recorded OPENED events, all time",
    },
    {
      label: "Replied",
      value: repliedCount,
      icon: Reply,
      note: "Recorded REPLIED events, all time",
    },
    {
      label: "Suspended accounts",
      value: suspendedAccountCount,
      icon: AlertTriangle,
      note: "Mailboxes paused or in error state",
    },
    {
      label: "Warmed accounts",
      value: warmedAccountCount,
      icon: Flame,
      note: "Mailboxes past the 4-week warmup curve",
    },
  ];

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
  const schedule = await getSendingSchedule(prisma, workspaceId);
  const nextDue = schedule.upcoming[0] ?? null;

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

      <h2 className="mt-8 font-display text-lg font-semibold">Live sending</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {liveStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <section key={stat.label} className="card p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted">{stat.label}</h3>
                <Icon className="h-5 w-5 text-accent" />
              </div>
              <p className="mt-2 font-display text-3xl font-semibold">{stat.value}</p>
              <p className="mt-1 text-xs text-muted">{stat.note}</p>
            </section>
          );
        })}
      </div>

      <h2 className="mt-8 font-display text-lg font-semibold">Sending schedule</h2>
      <section className="card mt-4 p-6">
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <p>
            <span className="text-muted">Last sent:</span>{" "}
            <span className="font-medium">
              {schedule.lastSentAt
                ? `${formatInZone(schedule.lastSentAt, "UTC")} UTC`
                : "Nothing sent yet"}
            </span>
          </p>
          <p>
            <span className="text-muted">Sent today:</span>{" "}
            <span className="font-medium">
              {schedule.sentToday} of about {schedule.capacity.cap} capacity across{" "}
              {schedule.capacity.accounts}{" "}
              {schedule.capacity.accounts === 1 ? "account" : "accounts"}
            </span>
          </p>
          <p>
            <span className="text-muted">Next send due:</span>{" "}
            <span className="font-medium">
              {nextDue
                ? `${formatInZone(nextDue.at, nextDue.timezone)} (${nextDue.timezone})`
                : "Nothing scheduled"}
            </span>
          </p>
        </div>
        {schedule.upcoming.length > 0 ? (
          <ol className="mt-4 divide-y divide-line border-t border-line">
            {schedule.upcoming.map((send) => (
              <li key={send.enrollmentId} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="font-medium">
                  {formatInZone(send.at, send.timezone)}
                  <span className="text-muted"> {send.timezone}</span>
                  {send.timezone !== "UTC" && (
                    <span className="text-muted"> · {formatInZone(send.at, "UTC")} UTC</span>
                  )}
                </span>
                <span>{send.campaignName}</span>
                <span className="text-muted">
                  {send.company ? `${send.company} · ` : ""}
                  {send.leadEmail} · Step {send.stepNumber}
                </span>
                {send.due && <span className="text-xs font-medium text-accent">Due now</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted">
            No sends are scheduled. Enrolled leads in running campaigns will appear here with
            their next send time.
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          Times are the moment each lead's local sending window opens. The scheduler ticks every
          few minutes, so a due send leaves on the next tick after its time.
        </p>
      </section>

      {onboarding.complete ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted" data-tour="checklist">
          <ListChecks className="h-4 w-4 text-accent" />
          Getting started: all set. Every setup step is complete for this workspace.
          <Link href="/app?tour=welcome" className="font-medium text-accent hover:underline">
            Take the product tour
          </Link>
        </p>
      ) : (
        <section className="card mt-6 p-6" data-tour="checklist">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-lg font-semibold">Getting started</h2>
            <span className="flex items-center gap-3 text-xs font-medium text-muted">
              <Link href="/app?tour=welcome" className="text-accent hover:underline">
                Take the tour
              </Link>
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
                  <>
                    <Link href={item.href} className="font-medium hover:text-accent">
                      {item.label}
                    </Link>
                    <Link
                      href={`/app?tour=${item.tourStep}`}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      Show me
                    </Link>
                  </>
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
