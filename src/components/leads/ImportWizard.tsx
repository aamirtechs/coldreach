"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, toCsv } from "@/lib/csv";
import { guessImportTarget, STANDARD_FIELD_TARGETS } from "@/lib/leads/import";
import { streamVerification } from "@/lib/verify/streamClient";
import {
  VerificationCompletedBar,
  VerificationProgress,
  VerificationSummaryCards,
  type ProgressState,
} from "@/components/verify/VerificationProgress";

interface ImportSummary {
  total: number;
  kept: number;
  duplicates: number;
  invalid: number;
  suppressed: number;
  alreadyExisted: number;
  updated: number;
  verificationSkipped: number;
}
interface ImportErrorRow {
  row: number;
  email: string;
  reason: string;
}
interface ImportVerdict {
  status: string;
  detail: unknown;
}
interface VerifyResult {
  totalRows: number;
  uniqueEmails: number;
  counts: { valid: number; risky: number; invalid: number; unknown: number };
  verdicts: Record<string, ImportVerdict>;
}

const STANDARD_TARGETS = ["email", ...STANDARD_FIELD_TARGETS, "ignore"] as const;

type Step = 1 | 2 | 3;

/**
 * Lead CSV import as a three step wizard (v1.34.0):
 * 1. Upload the file and confirm which column holds the email.
 * 2. Verify: every unique address is checked (built-in checks plus
 *    the Reacher SMTP probe) before anything is saved; the results
 *    are shown by group and the user picks which groups to import
 *    (Good emails only carries the Recommended badge; All selects
 *    every group).
 * 3. Map the remaining columns and run the import; imported leads
 *    keep the verdicts from step 2.
 */
export function ImportWizard({ listId }: { listId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [emailColumn, setEmailColumn] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [updateExisting, setUpdateExisting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!verifying) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [verifying]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["VALID"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: ImportSummary; errors: ImportErrorRow[] } | null>(null);

  const emailMapped = useMemo(() => Object.values(mapping).includes("email"), [mapping]);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    setFileName(file.name);
    setCsvText(text);
    setHeaders(parsed.headers);
    setPreviewRows(parsed.rows.slice(0, 5));
    const initial: Record<string, string> = {};
    for (const header of parsed.headers) {
      initial[header] = guessImportTarget(header);
    }
    setMapping(initial);
    const guessedEmail = parsed.headers.find((h) => guessImportTarget(h) === "email") ?? "";
    setEmailColumn(guessedEmail);
    setStep(1);
    setVerifyResult(null);
    setResult(null);
    setError(null);
  }

  async function runVerification() {
    setStep(2);
    setVerifying(true);
    setError(null);
    setVerifyResult(null);
    setProgress({
      done: 0,
      total: 0,
      counts: { valid: 0, risky: 0, invalid: 0, unknown: 0 },
      recent: [],
      startedAt: Date.now(),
      finishedMs: null,
    });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await streamVerification({
        url: `/api/lead-lists/${listId}/import/verify`,
        body: { csvText, emailColumn },
        signal: controller.signal,
        onStart: (total) => setProgress((p) => (p ? { ...p, total } : p)),
        onProgress: (event) =>
          setProgress((p) =>
            p
              ? {
                  ...p,
                  done: event.done,
                  total: event.total,
                  counts: event.counts,
                  recent: [event.last, ...p.recent].slice(0, 8),
                }
              : p,
          ),
      });
      setVerifyResult({
        totalRows: result.totalRows,
        uniqueEmails: result.uniqueEmails,
        counts: result.counts,
        verdicts: result.verdicts as Record<string, ImportVerdict>,
      });
      setProgress((p) => (p ? { ...p, finishedMs: Date.now() - p.startedAt } : p));
      setMapping((current) => ({ ...current, [emailColumn]: "email" }));
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : "Verification failed");
      }
    } finally {
      setVerifying(false);
    }
  }

  function cancelVerification() {
    abortRef.current?.abort();
    setVerifying(false);
    setProgress(null);
    setError("Verification cancelled. Nothing was imported.");
    setStep(1);
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/lead-lists/${listId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        csvText,
        mapping,
        updateExisting,
        verification: verifyResult
          ? { verdicts: verifyResult.verdicts, statuses: selectedStatuses }
          : undefined,
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Import failed");
      return;
    }
    setResult({ summary: data.summary, errors: data.errors });
    router.refresh();
  }

  function downloadErrors() {
    if (!result || result.errors.length === 0) return;
    const csv = toCsv(
      ["row", "email", "reason"],
      result.errors.map((e) => ({ row: String(e.row), email: e.email, reason: e.reason })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "import-errors.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        Import CSV
      </button>
    );
  }

  const stepLabel = (n: Step, label: string) => (
    <span className={step === n ? "font-semibold" : "text-muted"}>
      Step {n}: {label}
    </span>
  );

  return (
    <section className="card mt-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Import leads from CSV</h2>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {stepLabel(1, "Upload")}
        {stepLabel(2, "Verify")}
        {stepLabel(3, "Map and import")}
      </div>

      {step === 1 ? (
        <>
          <p className="mt-3 text-sm text-muted">
            Rows are deduplicated inside the file, checked against leads already in the workspace,
            and checked against the suppression list before anything is saved.
          </p>
          <div className="mt-4">
            <label className="label" htmlFor="import-csv-file">
              Choose a CSV file
            </label>
            <input
              id="import-csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="text-sm"
            />
            {fileName ? <p className="mt-2 text-xs text-muted">Selected: {fileName}</p> : null}
          </div>
          {headers.length > 0 ? (
            <>
              <div className="mt-5 max-w-sm">
                <label className="label" htmlFor="import-email-column">
                  Which column holds the email address?
                </label>
                <select
                  id="import-email-column"
                  className="input"
                  value={emailColumn}
                  onChange={(e) => setEmailColumn(e.target.value)}
                >
                  <option value="">Choose a column</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              {previewRows.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-elevated text-muted">
                      <tr>
                        {headers.map((h) => (
                          <th key={h} className="px-3 py-2 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-t border-line">
                          {headers.map((h) => (
                            <td key={h} className="px-3 py-2">{row[h]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
              <div className="mt-5">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!emailColumn}
                  onClick={runVerification}
                >
                  Continue to verification
                </button>
                {!emailColumn ? (
                  <span className="ml-3 text-xs text-warning">Choose the email column first.</span>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          {progress && !verifyResult ? (
            <div className="mt-4">
              <VerificationProgress progress={progress} nowMs={nowMs} onCancel={cancelVerification} />
              <p className="mt-3 text-xs text-muted">
                Each address gets the built-in checks plus a live mailbox probe. Nothing is
                imported yet.
              </p>
            </div>
          ) : null}
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          {verifyResult ? (
            <>
              <div className="mt-4">
                <VerificationCompletedBar
                  total={verifyResult.uniqueEmails}
                  durationSec={
                    progress?.finishedMs ? Math.max(1, Math.round(progress.finishedMs / 1000)) : null
                  }
                />
              </div>
              <div className="mt-4">
                <VerificationSummaryCards
                  counts={verifyResult.counts}
                  total={verifyResult.uniqueEmails}
                />
              </div>
              <p className="mt-3 text-sm text-muted">
                Choose which groups to import. You can select more than one.
              </p>
              {(
                [
                  {
                    status: "VALID",
                    label: "Good emails only",
                    count: verifyResult.counts.valid,
                    note: "Verified mailboxes. The safe choice.",
                    badge: "Recommended",
                  },
                  {
                    status: "RISKY",
                    label: "Catch-all (risky)",
                    count: verifyResult.counts.risky,
                    note: "The domain accepts mail for every address, so the mailbox could not be proven.",
                    badge: null,
                  },
                  {
                    status: "UNKNOWN",
                    label: "Unknown",
                    count: verifyResult.counts.unknown,
                    note: "The check itself was inconclusive, for example the mail server did not answer.",
                    badge: null,
                  },
                  {
                    status: "INVALID",
                    label: "Invalid",
                    count: verifyResult.counts.invalid,
                    note: "These cannot receive mail. Importing keeps them on record, but they cannot join a campaign.",
                    badge: null,
                  },
                ] as const
              ).map((group) => (
                <label key={group.status} className="mt-3 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedStatuses.includes(group.status)}
                    onChange={(e) =>
                      setSelectedStatuses((current) =>
                        e.target.checked
                          ? [...current, group.status]
                          : current.filter((s) => s !== group.status),
                      )
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{group.label}</span> ({group.count})
                    {group.badge ? (
                      <span className="ml-2 rounded-full bg-elevated px-2 py-0.5 text-xs font-semibold">
                        {group.badge}
                      </span>
                    ) : null}
                    <span className="block text-xs text-muted">{group.note}</span>
                  </span>
                </label>
              ))}
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedStatuses.length === 4}
                  onChange={(e) =>
                    setSelectedStatuses(
                      e.target.checked ? ["VALID", "RISKY", "UNKNOWN", "INVALID"] : ["VALID"],
                    )
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">All</span> ({verifyResult.uniqueEmails})
                  <span className="block text-xs text-muted">Import every group above.</span>
                </span>
              </label>
              <p className="mt-4 text-sm">
                {selectedStatuses.reduce(
                  (sum, s) =>
                    sum +
                    (s === "VALID"
                      ? verifyResult.counts.valid
                      : s === "RISKY"
                        ? verifyResult.counts.risky
                        : s === "INVALID"
                          ? verifyResult.counts.invalid
                          : verifyResult.counts.unknown),
                  0,
                )}{" "}
                of {verifyResult.uniqueEmails} addresses will be imported
                {selectedStatuses.length === 0 ? ". Select at least one group to continue" : ""}.
              </p>
            </>
          ) : null}
          <div className="mt-5 flex gap-3">
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={verifying || !verifyResult || selectedStatuses.length === 0}
              onClick={() => setStep(3)}
            >
              Continue to mapping
            </button>
          </div>
        </>
      ) : null}

      {step === 3 && !result ? (
        <>
          <h3 className="mt-2 text-sm font-semibold">Map columns</h3>
          <p className="mt-1 text-xs text-muted">
            The email column is already set from step 1. Any other column name becomes a lead field
            usable as a personalisation token, for example {"{{company}}"} or {"{{icebreaker}}"}.
            Map your opening line column to the icebreaker target so it lands in the icebreaker
            field.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {headers.map((header) => (
              <label key={header} className="block">
                <span className="label">{header}</span>
                <select
                  className="input"
                  value={mapping[header] ?? "ignore"}
                  disabled={header === emailColumn}
                  onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
                >
                  {STANDARD_TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {target === "ignore" ? "Do not import" : target}
                    </option>
                  ))}
                  {!STANDARD_TARGETS.includes(mapping[header] as (typeof STANDARD_TARGETS)[number]) ? (
                    <option value={mapping[header]}>Field: {mapping[header]}</option>
                  ) : null}
                  <option value={header}>Field: {header}</option>
                </select>
              </label>
            ))}
          </div>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          <label className="mt-5 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={updateExisting}
              onChange={(e) => setUpdateExisting(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Update existing leads in this list with the file&apos;s values instead of skipping
              them. Use this when re-importing an enriched file, for example one carrying a new
              personalisation field.
            </span>
          </label>
          <div className="mt-5 flex gap-3">
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>
              Back
            </button>
            <button type="button" className="btn-primary" disabled={busy || !emailMapped} onClick={runImport}>
              {busy ? "Importing..." : "Run import"}
            </button>
          </div>
        </>
      ) : null}

      {result ? (
        <div className="mt-5 rounded-lg border border-line bg-elevated p-4">
          <h3 className="text-sm font-semibold">Import complete</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <div><dt className="text-muted">Rows</dt><dd className="font-semibold">{result.summary.total}</dd></div>
            <div><dt className="text-muted">Imported</dt><dd className="font-semibold">{result.summary.kept}</dd></div>
            <div><dt className="text-muted">Duplicates</dt><dd className="font-semibold">{result.summary.duplicates}</dd></div>
            <div><dt className="text-muted">Invalid</dt><dd className="font-semibold">{result.summary.invalid}</dd></div>
            <div><dt className="text-muted">Suppressed</dt><dd className="font-semibold">{result.summary.suppressed}</dd></div>
          </dl>
          {result.summary.verificationSkipped > 0 ? (
            <p className="mt-2 text-xs text-muted">
              {result.summary.verificationSkipped} rows were skipped by the verification step:
              they belong to groups you did not select for import.
            </p>
          ) : null}
          {result.summary.alreadyExisted > 0 ? (
            <p className="mt-2 text-xs text-muted">
              {result.summary.alreadyExisted} of the duplicates already existed in this workspace.
            </p>
          ) : null}
          {result.summary.updated > 0 ? (
            <p className="mt-2 text-xs text-muted">
              {result.summary.updated} existing leads in this list were updated with the
              file&apos;s values.
            </p>
          ) : null}
          {result.errors.length > 0 ? (
            <div className="mt-4">
              <button type="button" className="btn-secondary" onClick={downloadErrors}>
                Download error report ({result.errors.length} rows)
              </button>
              <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs text-muted">
                {result.errors.slice(0, 20).map((e) => (
                  <li key={`${e.row}-${e.email}`}>Row {e.row}: {e.email || "(no email)"} - {e.reason}</li>
                ))}
                {result.errors.length > 20 ? <li>...and {result.errors.length - 20} more in the report.</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
