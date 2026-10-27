"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface HubSpotCardProps {
  configured: boolean;
  missingEnv: string[];
  canManage: boolean;
  connection: {
    status: string;
    externalAccountId: string | null;
    lastSyncAt: string | null;
    lastSyncSummary: {
      pushed?: number;
      created?: number;
      updated?: number;
      failed?: number;
      error?: string | null;
    } | null;
  } | null;
}

/**
 * HubSpot connection card inside the Settings integrations panel.
 * Mirrors the mailbox OAuth honesty pattern: unconfigured means the
 * missing environment variables are named and no connect control is
 * offered; connected shows the real last sync state from the
 * connection row.
 */
export function HubSpotCard({ configured, missingEnv, canManage, connection }: HubSpotCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const connected = connection?.status === "CONNECTED";

  async function syncNow() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/crm/hubspot/sync", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as {
        summary?: { pushed?: number; created?: number; updated?: number; failed?: number; error?: string | null };
        error?: string;
      };
      if (!response.ok) {
        setNotice(data.error ?? "Sync failed.");
      } else if (data.summary) {
        const s = data.summary;
        setNotice(
          `Sync complete: ${s.pushed ?? 0} pushed (${s.created ?? 0} created, ${s.updated ?? 0} updated, ${s.failed ?? 0} failed).${s.error ? ` First error: ${s.error}` : ""}`,
        );
      }
      router.refresh();
    } catch {
      setNotice("Sync request failed. Check the server logs.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect HubSpot? The stored tokens are deleted. Synced contacts stay in HubSpot.")) {
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/crm/hubspot/disconnect", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold">HubSpot CRM sync</h3>
          <p className="mt-0.5 text-sm text-muted">
            Pushes this workspace's leads to HubSpot as contacts, creating or updating by email.
            It does not pull HubSpot unsubscribes back; see INTEGRATIONS.md for why and for the
            webhook path that covers it.
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            connected
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          }`}
        >
          {connected ? "Connected" : "Not configured"}
        </span>
      </div>

      {!configured ? (
        <p className="mt-3 text-sm text-muted">
          HubSpot is not configured on this server. Set{" "}
          <span className="font-mono text-xs">{missingEnv.join(", ")}</span> in the environment,
          then redeploy. The owner steps are in ACTIVATION.md section 8.
        </p>
      ) : connected ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-muted">
            Portal {connection?.externalAccountId ?? "unknown"}.
            {connection?.lastSyncAt
              ? ` Last sync ${new Date(connection.lastSyncAt).toLocaleString()}: ${connection.lastSyncSummary?.pushed ?? 0} pushed, ${connection.lastSyncSummary?.created ?? 0} created, ${connection.lastSyncSummary?.updated ?? 0} updated, ${connection.lastSyncSummary?.failed ?? 0} failed.`
              : " No sync run yet."}
          </p>
          {canManage ? (
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" disabled={busy} onClick={syncNow}>
                {busy ? "Working..." : "Sync now"}
              </button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={disconnect}>
                Disconnect
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-muted">App credentials are set. Connect this workspace to start syncing.</p>
          {canManage ? (
            <a className="btn-secondary mt-2 inline-flex" href="/api/crm/hubspot/start">
              Connect HubSpot
            </a>
          ) : null}
        </div>
      )}
      {notice ? <p className="mt-2 text-sm text-muted">{notice}</p> : null}
    </div>
  );
}
