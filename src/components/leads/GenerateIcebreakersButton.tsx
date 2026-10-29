"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface GenerateSummary {
  generated: number;
  skipped: number;
  failed: number;
  remaining: number;
}

/**
 * "Generate icebreakers" action on the lead list detail page
 * (v1.11.0). Runs the server-side AI generation for leads in the
 * list that have no icebreaker yet (at most 25 per run) and reports
 * the real counts it returns, including how many still remain so the
 * operator knows whether another run is needed. AI must be
 * configured for the workspace; the server says so plainly when it
 * is not, and that message is shown as-is.
 */
export function GenerateIcebreakersButton({ listId }: { listId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<GenerateSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/lead-lists/${listId}/generate-icebreakers`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        generated?: number;
        skipped?: number;
        failed?: number;
        remaining?: number;
        error?: string;
      };
      if (!response.ok || typeof data.generated !== "number") {
        setError(data.error ?? "Icebreaker generation failed");
        return;
      }
      setSummary({
        generated: data.generated,
        skipped: data.skipped ?? 0,
        failed: data.failed ?? 0,
        remaining: data.remaining ?? 0,
      });
      router.refresh();
    } catch {
      setError("Icebreaker generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn-secondary" disabled={busy} onClick={generate}>
        {busy ? "Generating..." : "Generate icebreakers"}
      </button>
      {summary ? (
        <p className="text-xs text-muted" role="status">
          Generated {summary.generated}, skipped {summary.skipped} already written, {summary.failed}{" "}
          failed, {summary.remaining} still remaining.
          {summary.remaining > 0 ? " Run it again to continue." : ""}
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
