"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, toCsv } from "@/lib/csv";

interface ImportSummary {
  total: number;
  kept: number;
  duplicates: number;
  invalid: number;
  suppressed: number;
  alreadyExisted: number;
  updated: number;
}
interface ImportErrorRow {
  row: number;
  email: string;
  reason: string;
}

const STANDARD_TARGETS = ["email", "firstName", "lastName", "company", "ignore"] as const;

function guessTarget(header: string): string {
  const h = header.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (["email", "emailaddress", "mail"].includes(h)) return "email";
  if (["firstname", "first", "givenname"].includes(h)) return "firstName";
  if (["lastname", "last", "surname", "familyname"].includes(h)) return "lastName";
  if (["company", "organisation", "organization", "employer"].includes(h)) return "company";
  return header;
}

export function ImportWizard({ listId }: { listId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [updateExisting, setUpdateExisting] = useState(false);
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
      initial[header] = guessTarget(header);
    }
    setMapping(initial);
    setResult(null);
    setError(null);
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/lead-lists/${listId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText, mapping, updateExisting }),
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

  return (
    <section className="card mt-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Import leads from CSV</h2>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
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

      {headers.length > 0 && !result ? (
        <>
          <h3 className="mt-6 text-sm font-semibold">Map columns</h3>
          <p className="mt-1 text-xs text-muted">
            One column must map to email. Any other column name becomes a lead field usable as a
            personalisation token, for example {"{{company}}"}.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {headers.map((header) => (
              <label key={header} className="block">
                <span className="label">{header}</span>
                <select
                  className="input"
                  value={mapping[header] ?? "ignore"}
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
          <div className="mt-5">
            <button type="button" className="btn-primary" disabled={busy || !emailMapped} onClick={runImport}>
              {busy ? "Importing..." : "Run import"}
            </button>
            {!emailMapped ? (
              <span className="ml-3 text-xs text-warning">Map one column to email first.</span>
            ) : null}
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
