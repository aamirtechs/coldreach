"use client";

import { useEffect, useState } from "react";

interface SendingStatus {
  sentToday: number;
  capacityCap: number;
  capacityUsed: number;
  lastSentAt: string | null;
  accounts: Array<{ email: string; status: string }>;
}

const MAX_DOTS = 24;

/**
 * Compact live sending status for the sidebar footer. Polls
 * /api/sending-status every minute; renders nothing until data arrives
 * and nothing at all when the fetch fails, so the sidebar never shows
 * an error state for a decorative card.
 */
export function SidebarStatus() {
  const [status, setStatus] = useState<SendingStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/sending-status");
        if (!response.ok) return;
        const payload = (await response.json()) as SendingStatus;
        if (!cancelled) setStatus(payload);
      } catch {
        // Silent by design: the card simply does not render.
      }
    }
    void load();
    const timer = setInterval(() => {
      void load();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!status) return null;

  const capacityFull = status.capacityCap > 0 && status.capacityUsed >= status.capacityCap;
  const percent =
    status.capacityCap > 0
      ? Math.min(100, Math.round((status.capacityUsed / status.capacityCap) * 100))
      : 0;
  const connected = status.accounts.filter((account) => account.status === "CONNECTED").length;
  const visibleAccounts = status.accounts.slice(0, MAX_DOTS);
  const overflow = status.accounts.length - visibleAccounts.length;

  return (
    <div className="px-3 pb-4">
      <div className="rounded-xl bg-elevated p-3">
        <p className="flex items-center gap-2 text-xs font-medium">
          <span
            className={`h-2 w-2 rounded-full ${capacityFull ? "bg-warning" : "animate-pulse bg-success"}`}
            aria-hidden="true"
          />
          {capacityFull ? "Capacity full" : "Sending live"}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={status.capacityUsed}
            aria-valuemax={status.capacityCap}
            aria-label="Today's sending capacity used"
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-xs font-medium tabular-nums">
            {status.capacityUsed} / {status.capacityCap} today
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="flex flex-wrap items-center gap-1">
            {visibleAccounts.map((account) => (
              <span
                key={account.email}
                className={`h-2 w-2 rounded-full ${
                  account.status === "CONNECTED"
                    ? "bg-success"
                    : account.status === "DISCONNECTED"
                      ? "bg-line"
                      : "bg-danger"
                }`}
                title={account.email}
              />
            ))}
            {overflow > 0 ? <span className="text-[11px] text-muted">+{overflow}</span> : null}
          </span>
          <span className="ml-auto text-[11px] tabular-nums text-muted">
            {connected}/{status.accounts.length} accounts
          </span>
        </div>
      </div>
    </div>
  );
}
