import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Eye,
  Flame,
  Gauge,
  History,
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
import { LocalTime } from "@/components/LocalTime";

/** "Wed 28 Oct, 09:00" in the given IANA timezone, for schedule rows. */
function formatInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** "in 5h 12m", "in 24m", "in 2d 3h", or "due now" for a future stamp. */
function formatUntil(date: Date, now: Date): string {
  const minutes = Math.floor((date.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "due now";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** "12m ago", "3h ago", "2d ago" for a past stamp. */
function formatAgo(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
  const scheduleNow = new Date();
  // The daily capacity resets at the next UTC midnight; the tile
  // shows that moment in the viewer's own timezone (v1.8.3).
  const nextReset = new Date(
    Date.UTC(scheduleNow.getUTCFullYear(), scheduleNow.getUTCMonth(), scheduleNow.getUTCDate()) +
      86_400_000,
  );
  const capacityPercent =
    schedule.capacity.cap > 0
      ? Math.min(100, Math.round((schedule.capacity.used / schedule.capacity.cap) * 100))
      : 0;
  // When the day's capacity is spent, due enrollments are waiting on
  // the reset, not on the scheduler. The panel says so (v1.8.4)
  // instead of calling them "Due now".
  const capacityFull =
    schedule.capacity.cap > 0 && schedule.capacity.used >= schedule.capacity.cap;

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
      <section className="card mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
          <p className="text-sm text-muted">
            When emails went out, when the next ones are due, and how much of today's
            capacity is left.
          </p>
          {capacityFull ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
              <span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />
              Capacity full today · sending resumes{" "}
              <LocalTime iso={nextReset.toISOString()} fallback="00:00 UTC" format="time" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
              <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden="true" />
              Scheduler live · ticks every few minutes
            </span>
          )}
        </div>

        <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
          <div className="rounded-xl bg-elevated p-4">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
              <History className="h-4 w-4 text-accent" /> Last sent
            </p>
            {schedule.lastSentAt ? (
              <>
                <p className="mt-2 font-display text-xl font-semibold">
                  <LocalTime
                    iso={schedule.lastSentAt.toISOString()}
                    fallback={`${formatInZone(schedule.lastSentAt, "UTC")} UTC`}
                  />
                </p>
                <p className="mt-0.5 text-xs text-muted">{formatAgo(schedule.lastSentAt, scheduleNow)}</p>
              </>
            ) : (
              <>
                <p className="mt-2 font-display text-xl font-semibold">Nothing yet</p>
                <p className="mt-0.5 text-xs text-muted">The first sends appear here as they leave</p>
              </>
            )}
          </div>

          <div className="rounded-xl bg-elevated p-4">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
              <Gauge className="h-4 w-4 text-accent" /> Sent today
            </p>
            <p className="mt-2 font-display text-xl font-semibold">
              {schedule.sentToday}
              <span className="text-sm font-medium text-muted"> of about {schedule.capacity.cap}</span>
            </p>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuenow={schedule.capacity.used}
              aria-valuemax={schedule.capacity.cap}
              aria-label="Today's sending capacity used"
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${capacityPercent}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {capacityPercent}% of today's capacity across {schedule.capacity.accounts}{" "}
              {schedule.capacity.accounts === 1 ? "account" : "accounts"} · resets{" "}
              <LocalTime iso={nextReset.toISOString()} fallback="00:00 UTC" format="time" />
            </p>
          </div>

          <div className="rounded-xl bg-elevated p-4">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
              <Clock className="h-4 w-4 text-accent" /> Next send due
            </p>
            {nextDue ? (
              <>
                <p className="mt-2 font-display text-xl font-semibold">
                  <LocalTime
                    iso={nextDue.at.toISOString()}
                    fallback={`${formatInZone(nextDue.at, "UTC")} UTC`}
                  />
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {formatInZone(nextDue.at, nextDue.timezone)} {nextDue.timezone} ·{" "}
                  {capacityFull ? "waiting for capacity" : formatUntil(nextDue.at, scheduleNow)} ·{" "}
                  {nextDue.campaignName}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 font-display text-xl font-semibold">Nothing scheduled</p>
                <p className="mt-0.5 text-xs text-muted">No active enrollments in running campaigns</p>
              </>
            )}
          </div>
        </div>

        <div className="border-t border-line px-6 py-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold">Upcoming sends</h3>
            {schedule.upcoming.length > 0 && (
              <span className="text-xs text-muted">Next {schedule.upcoming.length}, soonest first</span>
            )}
          </div>
          {schedule.upcoming.length > 0 ? (
            <div className="relative mt-3">
              <div aria-hidden="true" className="absolute bottom-3 left-[5px] top-3 w-px bg-line" />
              <ol>
                {schedule.upcoming.map((send) => (
                  <li
                    key={send.enrollmentId}
                    className="relative flex gap-4 rounded-lg px-1 py-2.5 transition-colors hover:bg-elevated/70"
                  >
                    <span
                      aria-hidden="true"
                      className={`relative z-10 mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 ${
                        send.due && capacityFull
                          ? "border-warning bg-warning"
                          : send.due
                            ? "border-success bg-success"
                            : "border-accent bg-surface"
                      }`}
                    />
                    <div className="w-44 shrink-0">
                      <p className="text-sm font-semibold leading-tight">
                        {formatInZone(send.at, send.timezone)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{send.timezone}</p>
                      <p className="text-xs text-muted">
                        <LocalTime
                          iso={send.at.toISOString()}
                          fallback={`${formatInZone(send.at, "UTC")} UTC`}
                        />{" "}
                        your time
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {send.company ?? send.leadEmail}
                        {send.company && (
                          <span className="font-normal text-muted"> · {send.leadEmail}</span>
                        )}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                          {send.campaignName}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-elevated px-2 py-0.5 text-xs font-medium text-muted">
                          Step {send.stepNumber}
                        </span>
                        {send.due && capacityFull ? (
                          <span className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                            Waiting for capacity
                          </span>
                        ) : send.due ? (
                          <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                            Due now
                          </span>
                        ) : (
                          <span className="text-xs text-muted">{formatUntil(send.at, scheduleNow)}</span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="mt-3 rounded-lg bg-elevated px-4 py-3 text-sm text-muted">
              No sends are scheduled. Enrolled leads in running campaigns will appear here with
              their next send time.
            </p>
          )}
          <p className="mt-4 text-xs text-muted">
            Times are the moment each lead's local sending window opens. A due send leaves on the
            next scheduler tick after its time.
          </p>
        </div>
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
