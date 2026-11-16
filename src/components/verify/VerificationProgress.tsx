"use client";

/**
 * Live verification progress (v1.35.0), shared by the import
 * wizard's step 2 and the standalone Verify Emails tool: a progress
 * bar, checked count with percentage, elapsed time, estimated time
 * remaining from the running rate, speed, ticking verdict counts,
 * and the most recent results as they land.
 */

export interface ProgressState {
  done: number;
  total: number;
  counts: { valid: number; risky: number; invalid: number; unknown: number };
  recent: { email: string; status: string }[];
  startedAt: number;
  finishedMs: number | null;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

const CATEGORIES = [
  {
    key: "valid",
    label: "Good",
    color: "#10b981",
    note: "Valid, existing emails. It is safe to send to them.",
  },
  {
    key: "risky",
    label: "Risky",
    color: "#f59e0b",
    note: "May exist or not. The domain accepts every address, so the mailbox cannot be proven.",
  },
  {
    key: "invalid",
    label: "Bad",
    color: "#ef4444",
    note: "These emails do not exist. Do not email them.",
  },
  {
    key: "unknown",
    label: "Unknown",
    color: "#94a3b8",
    note: "The check was inconclusive. The mail server did not give a clear answer.",
  },
] as const;

/**
 * The four verdict cards from the MillionVerifier style results
 * view: a percentage ring, the count, and a plain language line
 * per category. Used live while checks run and again with the
 * final numbers once verification completes.
 */
export function VerificationSummaryCards({
  counts,
  total,
}: {
  counts: ProgressState["counts"];
  total: number;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {CATEGORIES.map((category) => {
        const count = counts[category.key];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={category.key} className="rounded-lg border border-line p-4">
            <div className="flex items-center gap-3">
              <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
                <circle cx="32" cy="32" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="6" />
                <circle
                  cx="32"
                  cy="32"
                  r={radius}
                  fill="none"
                  stroke={category.color}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference - (circumference * pct) / 100}
                  transform="rotate(-90 32 32)"
                />
                <text x="32" y="36" textAnchor="middle" fontSize="13" fontWeight="700" fill={category.color}>
                  {pct}%
                </text>
              </svg>
              <div>
                <div className="text-sm font-semibold">{category.label}</div>
                <div className="text-2xl font-bold leading-tight">{count}</div>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted">{category.note}</p>
          </div>
        );
      })}
    </div>
  );
}

/** The highlighted bar shown at the top once a run completes. */
export function VerificationCompletedBar({
  total,
  durationSec,
}: {
  total: number;
  durationSec: number | null;
}) {
  return (
    <div className="rounded-lg bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
      Verification complete. {total} addresses checked
      {durationSec !== null ? ` in ${formatDuration(durationSec)}` : ""}.
    </div>
  );
}

export function VerificationProgress({
  progress,
  nowMs,
  onCancel,
}: {
  progress: ProgressState;
  nowMs: number;
  onCancel?: () => void;
}) {
  const elapsedMs = progress.finishedMs ?? nowMs - progress.startedAt;
  const elapsedSec = Math.max(elapsedMs / 1000, 0.1);
  const pct =
    progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  const perMin = (progress.done / elapsedSec) * 60;
  const etaSec =
    progress.done >= 3 && perMin > 0 ? ((progress.total - progress.done) / perMin) * 60 : null;

  return (
    <div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-elevated">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="font-semibold">
          {progress.total > 0
            ? `Checked ${progress.done} of ${progress.total} (${pct}%)`
            : "Starting verification..."}
        </span>
        <span className="text-muted">Elapsed {formatDuration(elapsedSec)}</span>
        {etaSec !== null && progress.done < progress.total ? (
          <span className="text-muted">About {formatDuration(etaSec)} remaining</span>
        ) : null}
        {progress.done > 0 ? (
          <span className="text-muted">{perMin.toFixed(0)} per minute</span>
        ) : null}
      </div>
      <div className="mt-4">
        <VerificationSummaryCards counts={progress.counts} total={progress.total} />
      </div>
      {progress.recent.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {progress.recent.map((item, i) => (
            <li key={`${item.email}-${i}`}>
              {item.email} - {item.status.toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}
      {onCancel ? (
        <div className="mt-3">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel verification
          </button>
        </div>
      ) : null}
    </div>
  );
}
