"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface BulkAccount {
  id: string;
  email: string;
  status: string;
}

interface BulkResult {
  accountId: string;
  email: string;
  ok: boolean;
  error?: string;
}

/**
 * One password for many mailboxes (v1.28.0). Mailbox owners often use
 * the same password on every account; this panel lets them type it
 * once, pick the accounts, and reconnect them all. The server tests
 * each mailbox live and only saves the ones that pass, reporting the
 * rest with the reason. The password goes to the server once, over
 * the same request as the selection, and is never kept in the page
 * after the results come back.
 */
export function BulkPasswordConnect({ accounts }: { accounts: BulkAccount[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(accounts.map((account) => account.id)),
  );
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (accounts.length < 2) {
    return null;
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function apply() {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch("/api/accounts/bulk-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, accountIds: [...selected] }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        results?: BulkResult[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not apply the password");
      }
      setResults(payload.results ?? []);
      setPassword("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the password");
    } finally {
      setBusy(false);
    }
  }

  const connectedCount = results?.filter((result) => result.ok).length ?? 0;

  return (
    <div className="card mt-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold">Same password on several mailboxes?</h2>
          <p className="mt-0.5 text-sm text-muted">
            Type it once and reconnect all of them together. Each mailbox is tested live and
            only the ones that pass are updated.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Close" : "Use one password"}
        </button>
      </div>

      {open ? (
        <div className="mt-4">
          <label className="label" htmlFor="bulk-password">Shared mailbox password</label>
          <input
            id="bulk-password"
            className="input max-w-md"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="The password these mailboxes share"
          />
          <div className="mt-4 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => (
              <label key={account.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(account.id)}
                  onChange={() => toggle(account.id)}
                />
                <span>{account.email}</span>
                <span className="text-xs text-muted">{account.status.toLowerCase()}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={apply}
              disabled={busy || password.length === 0 || selected.size === 0}
            >
              {busy ? "Testing each mailbox..." : `Test and connect ${selected.size} selected`}
            </button>
            {busy ? (
              <span className="text-xs text-muted">
                One live login test per mailbox, so this can take a minute.
              </span>
            ) : null}
          </div>
          {error ? <p className="mt-3 text-sm text-warning">{error}</p> : null}
          {results ? (
            <div className="mt-4">
              <p className="text-sm font-medium">
                {connectedCount} of {results.length} connected
                {connectedCount < results.length
                  ? ". The rest were left unchanged; check the reason and try again."
                  : "."}
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {results.map((result) => (
                  <li key={result.accountId}>
                    <span className={result.ok ? "text-emerald-600" : "text-warning"}>
                      {result.ok ? "Connected" : "Not connected"}
                    </span>{" "}
                    {result.email}
                    {result.error ? <span className="text-muted">, {result.error}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
