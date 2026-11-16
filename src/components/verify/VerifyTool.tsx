"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseCsv, toCsv } from "@/lib/csv";
import { guessImportTarget } from "@/lib/leads/import";
import { streamVerification, type VerifyStreamResult } from "@/lib/verify/streamClient";
import { verificationExportFileName } from "@/lib/verify/exportNames";
import {
  VerificationCompletedBar,
  VerificationProgress,
  VerificationSummaryCards,
  type ProgressState,
} from "@/components/verify/VerificationProgress";

/**
 * Standalone Verify Emails tool (v1.35.0): paste addresses or upload
 * a CSV, watch them verify live, and download the results as CSV.
 * Nothing is saved to any lead list; the tool is verification only.
 */

interface ResultRow {
  email: string;
  status: string;
  providerResult: string;
  reason: string;
  checkedAt: string;
}

const MAX_RENDERED_ROWS = 200;

export function VerifyTool() {
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvEmails, setCsvEmails] = useState<string[]>([]);
  const [emailColumn, setEmailColumn] = useState("");
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyStreamResult | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const pastedEmails = useMemo(
    () =>
      pasted
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter(Boolean),
    [pasted],
  );
  const emails = useMemo(() => {
    const seen = new Map<string, string>();
    for (const email of [...pastedEmails, ...csvEmails]) {
      const key = email.toLowerCase();
      if (!seen.has(key)) seen.set(key, email);
    }
    return [...seen.values()];
  }, [pastedEmails, csvEmails]);

  const rows: ResultRow[] = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.verdicts)
      .map(([email, verdict]) => ({
        email,
        status: verdict.status,
        providerResult: verdict.detail.provider?.result ?? "",
        reason: verdict.detail.reasons.join(" "),
        checkedAt: verdict.detail.checkedAt,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }, [result]);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    setFileName(file.name);
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    const guessed = parsed.headers.find((h) => guessImportTarget(h) === "email") ?? "";
    setEmailColumn(guessed);
    setCsvEmails(
      guessed ? parsed.rows.map((row) => (row[guessed] ?? "").trim()).filter(Boolean) : [],
    );
    setResult(null);
    setError(null);
  }

  function chooseColumn(column: string) {
    setEmailColumn(column);
    setCsvEmails(
      column ? csvRows.map((row) => (row[column] ?? "").trim()).filter(Boolean) : [],
    );
  }

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
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
      const done = await streamVerification({
        url: "/api/verify-emails",
        body: { emails },
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
      setResult(done);
      setProgress((p) => (p ? { ...p, finishedMs: Date.now() - p.startedAt } : p));
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Verification failed");
      }
    } finally {
      setRunning(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setRunning(false);
    setProgress(null);
    setError("Verification cancelled.");
  }

  /** Clears inputs and results so a fresh batch can be verified. */
  function startOver() {
    setPasted("");
    setFileName("");
    setCsvHeaders([]);
    setCsvEmails([]);
    setCsvRows([]);
    setEmailColumn("");
    setResult(null);
    setProgress(null);
    setError(null);
    setDownloadOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function downloadCsv(filterStatus: string | null, fileName: string) {
    const selected = filterStatus ? rows.filter((row) => row.status === filterStatus) : rows;
    const csv = toCsv(
      ["email", "status", "provider_result", "reason", "checked_at"],
      selected.map((row) => ({
        email: row.email,
        status: row.status.toLowerCase(),
        provider_result: row.providerResult,
        reason: row.reason,
        checked_at: row.checkedAt,
      })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    setDownloadOpen(false);
  }

  const downloadOptions = [
    { label: "Good Emails Only", status: "VALID", file: verificationExportFileName("good", fileName) },
    { label: "Risky Emails Only", status: "RISKY", file: verificationExportFileName("risky", fileName) },
    { label: "Bad Emails Only", status: "INVALID", file: verificationExportFileName("bad", fileName) },
    { label: "Unknown Emails Only", status: "UNKNOWN", file: verificationExportFileName("unknown", fileName) },
    { label: "Full Report", status: null, file: verificationExportFileName("full", fileName) },
  ] as const;

  return (
    <section className="card mt-6 p-6">
      <h2 className="font-display text-lg font-semibold">Check addresses</h2>
      <p className="mt-1 text-sm text-muted">
        Paste addresses, upload a CSV, or both. Every address gets the built-in checks plus a live
        mailbox probe. Results are not saved to any list; download the CSV to keep them.
      </p>

      <div className="mt-4">
        <label className="label" htmlFor="verify-paste">
          Paste email addresses
        </label>
        <textarea
          id="verify-paste"
          className="input min-h-28"
          placeholder={"one@example.com\ntwo@example.com"}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted">One per line, or separated by commas.</p>
      </div>

      <div className="mt-4">
        <label className="label" htmlFor="verify-file">
          Or upload a CSV file
        </label>
        <input id="verify-file" ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
        {fileName ? <p className="mt-2 text-xs text-muted">Selected: {fileName}</p> : null}
        {csvHeaders.length > 0 && !emailColumn ? (
          <div className="mt-3 max-w-sm">
            <label className="label" htmlFor="verify-email-column">
              Which column holds the email address?
            </label>
            <select
              id="verify-email-column"
              className="input"
              value={emailColumn}
              onChange={(e) => chooseColumn(e.target.value)}
            >
              <option value="">Choose a column</option>
              {csvHeaders.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}

      <div className="mt-5">
        <button type="button" className="btn-primary" disabled={running || emails.length === 0} onClick={run}>
          {running ? "Verifying..." : `Verify ${emails.length > 0 ? `${emails.length} ` : ""}addresses`}
        </button>
        {emails.length === 0 ? (
          <span className="ml-3 text-xs text-warning">Add at least one address first.</span>
        ) : null}
      </div>

      {progress && !result ? (
        <div className="mt-6">
          <VerificationProgress progress={progress} nowMs={nowMs} onCancel={cancel} />
        </div>
      ) : null}

      {result ? (
        <div className="mt-6">
          <VerificationCompletedBar
            total={result.uniqueEmails}
            durationSec={progress?.finishedMs ? progress.finishedMs / 1000 : null}
          />
          <div className="mt-4">
            <VerificationSummaryCards counts={result.counts} total={result.uniqueEmails} />
          </div>
          <div className="relative mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setDownloadOpen((open) => !open)}
            >
              Download Reports
            </button>
            <button type="button" className="btn-secondary" onClick={startOver}>
              Verify new emails
            </button>
            {downloadOpen ? (
              <div className="absolute left-0 top-full z-10 mt-2 w-56 rounded-lg border border-line bg-elevated p-1 shadow-lg">
                {downloadOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => downloadCsv(option.status, option.file)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-elevated text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Mailbox probe</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, MAX_RENDERED_ROWS).map((row) => (
                  <tr key={row.email} className="border-t border-line">
                    <td className="px-3 py-2">{row.email}</td>
                    <td className="px-3 py-2 font-medium">{row.status.toLowerCase()}</td>
                    <td className="px-3 py-2">{row.providerResult || "not run"}</td>
                    <td className="px-3 py-2 text-muted">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > MAX_RENDERED_ROWS ? (
            <p className="mt-2 text-xs text-muted">
              Showing the first {MAX_RENDERED_ROWS} of {rows.length} results; the CSV download
              contains all of them.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
