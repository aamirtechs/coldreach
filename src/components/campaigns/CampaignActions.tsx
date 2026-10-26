"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PreflightCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
}
interface PreflightResult {
  status: "pass" | "warn" | "fail";
  canLaunch: boolean;
  checks: PreflightCheck[];
}

const STATUS_ICON: Record<string, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
const STATUS_CLASS: Record<string, string> = {
  pass: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-red-600 dark:text-red-400",
};

function PreflightView({ preflight }: { preflight: PreflightResult }) {
  return (
    <div className="mt-4 space-y-2">
      {preflight.checks.map((check) => (
        <div key={check.id} className="flex gap-3 rounded-lg border border-line px-3 py-2 text-sm">
          <span className={`font-mono text-xs font-bold leading-5 ${STATUS_CLASS[check.status]}`}>
            {STATUS_ICON[check.status]}
          </span>
          <div>
            <span className="font-medium">{check.label}. </span>
            <span className="text-muted">{check.message}</span>
          </div>
        </div>
      ))}
      <p className="text-sm font-medium">
        {preflight.canLaunch
          ? preflight.status === "warn"
            ? "Preflight passes with warnings. Launch is allowed."
            : "Preflight passes. The campaign can launch."
          : "Preflight failed. Launch is blocked until the FAIL checks are fixed."}
      </p>
    </div>
  );
}

export function CampaignActions({ campaignId, status }: { campaignId: string; status: string }) {
  const router = useRouter();
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function call(label: string, url: string, method: string, body?: unknown) {
    setBusy(label);
    setNotice(null);
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    setBusy(null);
    return { response, data };
  }

  async function runPreflight() {
    const { response, data } = await call("preflight", `/api/campaigns/${campaignId}/preflight`, "GET");
    if (!response.ok) {
      setNotice(data.error ?? "Preflight could not run");
      return;
    }
    setPreflight(data.preflight);
  }

  async function enroll() {
    const { response, data } = await call("enroll", `/api/campaigns/${campaignId}/enroll`, "POST");
    if (!response.ok) {
      setNotice(data.error ?? "Enrollment failed");
      return;
    }
    const e = data.enrollment;
    setNotice(
      `Enrollment complete: ${e.enrolled} enrolled, ${e.skippedSuppressed} suppressed, ${e.skippedDuplicate} already enrolled, ${e.skippedIneligible} ineligible, of ${e.totalInList} in the list.`,
    );
    router.refresh();
  }

  async function launch() {
    const { response, data } = await call("launch", `/api/campaigns/${campaignId}/launch`, "POST");
    if (!response.ok) {
      if (data.preflight) setPreflight(data.preflight);
      setNotice(data.error ?? "Launch failed");
      return;
    }
    setPreflight(data.preflight);
    setNotice("Campaign launched. The sending worker will pick up due enrollments.");
    router.refresh();
  }

  async function transition(label: string, target: string) {
    const { response, data } = await call(label, `/api/campaigns/${campaignId}`, "PATCH", { status: target });
    if (!response.ok) {
      setNotice(data.error ?? "Action failed");
      return;
    }
    setNotice(`Campaign is now ${target}.`);
    router.refresh();
  }

  const canEdit = status !== "ARCHIVED";

  return (
    <section className="card mt-6 p-6">
      <h2 className="font-display text-lg font-semibold">Launch controls</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" disabled={busy !== null} onClick={runPreflight}>
          Run preflight
        </button>
        {canEdit ? (
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={enroll}>
            Enroll list leads
          </button>
        ) : null}
        {(status === "DRAFT" || status === "SCHEDULED" || status === "PAUSED") && (
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={launch}>
            {status === "PAUSED" ? "Resume campaign" : "Launch campaign"}
          </button>
        )}
        {status === "RUNNING" && (
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => transition("pause", "PAUSED")}>
            Pause
          </button>
        )}
        {(status === "DRAFT" || status === "PAUSED") && (
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => transition("schedule", "SCHEDULED")}>
            Mark scheduled
          </button>
        )}
        {canEdit && status !== "RUNNING" && (
          <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => transition("archive", "ARCHIVED")}>
            Archive
          </button>
        )}
      </div>
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
      {preflight ? <PreflightView preflight={preflight} /> : null}
    </section>
  );
}
