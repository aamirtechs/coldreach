"use client";

import { useState } from "react";

/**
 * Workspace export download (OWNER only; the page renders this only
 * for owners and the API enforces it again). The warning copy is
 * deliberate: the file contains every lead address and message body
 * in the workspace, even though it contains no credentials.
 */
export function ExportPanel() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDownload() {
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/export");
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "The export failed. Please try again.");
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = match?.[1] ?? "coldreach-workspace-export.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="card mt-6 p-6" aria-labelledby="export-heading">
      <h2 id="export-heading" className="font-display text-lg font-semibold tracking-tight">
        Export workspace data
      </h2>
      <p className="mt-1 text-sm text-muted">
        Download one JSON file with this workspace&apos;s leads, campaigns, sequences, inbox
        threads and notes, suppressions, settings, and audit log. Treat the file as sensitive:
        it contains every contact email address and message body in the workspace. It never
        contains passwords, API keys, webhook secrets, or mailbox credentials, and sending
        accounts must be reconnected after a restore.
      </p>
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        className="btn-secondary mt-4"
      >
        {downloading ? "Preparing export" : "Download workspace export"}
      </button>
    </section>
  );
}
