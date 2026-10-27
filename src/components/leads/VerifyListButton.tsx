"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface VerifySummary {
  total: number;
  valid: number;
  risky: number;
  invalid: number;
  unknown: number;
  providerConfigured: boolean;
}

/**
 * "Verify list" action on the lead list detail page (Phase 6).
 * Runs the server-side verifier for the whole list and reports the
 * real summary it returns; INVALID leads are then skipped at
 * campaign enrollment and RISKY leads are flagged in the enrollment
 * summary. The built-in checks always run; a provider only refines
 * them when VERIFY_API_KEY is configured on the server.
 */
export function VerifyListButton({ listId }: { listId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<VerifySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/lead-lists/${listId}/verify`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as {
        summary?: VerifySummary;
        error?: string;
      };
      if (!response.ok || !data.summary) {
        setError(data.error ?? "Verification failed");
        return;
      }
      setSummary(data.summary);
      router.refresh();
    } catch {
      setError("Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn-secondary" disabled={busy} onClick={verify}>
        {busy ? "Verifying..." : "Verify list"}
      </button>
      {summary ? (
        <p className="text-xs text-muted" role="status">
          Verified {summary.total}: {summary.valid} valid, {summary.risky} risky, {summary.invalid}{" "}
          invalid, {summary.unknown} unknown.
          {summary.providerConfigured ? " Provider checks included." : " Built-in checks only."}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-warning" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
