"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Manual reply sync for one mailbox account (OAuth or SMTP / IMAP):
 * runs the same sync the worker tick runs automatically and reports
 * what it found.
 */
export function SyncButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`/api/accounts/${accountId}/sync`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        summary?: { imported: number; fetched: number; skipped: boolean; reason?: string; error?: string };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Sync failed");
      }
      const summary = payload.summary;
      if (summary?.skipped) {
        setNote(summary.reason ?? "Nothing to sync");
      } else if (summary?.error) {
        setNote(`Sync error: ${summary.error}`);
      } else {
        setNote(`Synced: ${summary?.imported ?? 0} new of ${summary?.fetched ?? 0} fetched`);
      }
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={sync} disabled={busy}>
        {busy ? "Syncing..." : "Sync replies"}
      </button>
      {note ? <span className="max-w-48 text-right text-[11px] text-muted">{note}</span> : null}
    </span>
  );
}
