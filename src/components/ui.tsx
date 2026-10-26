import type { ReactNode } from "react";

const STATUS_STYLES: Record<string, string> = {
  RUNNING: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  CONNECTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  VALID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  DRAFT: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  SCHEDULED: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  ACTIVE: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  NEW: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  PAUSED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  ARCHIVED: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  DISCONNECTED: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  ERROR: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  BOUNCED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  INVALID: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  UNSUBSCRIBED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  SUPPRESSED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  REPLIED: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status}
    </span>
  );
}

export function DemoBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-semibold text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300">
      DEMO
    </span>
  );
}

export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <section className="card mt-6 p-8 text-center">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">{body}</p>
      {children ? <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{children}</div> : null}
    </section>
  );
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}
