"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AccountOption {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
}

/**
 * Gmail style manual compose. Sends one email from a chosen connected
 * sending account through POST /api/threads/compose, which opens a
 * thread in the inbox for the conversation. Disconnected accounts are
 * listed but cannot be picked, and the form stays open on errors so the
 * draft text is never lost to a failed send.
 */
export function ComposeEmail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [fromId, setFromId] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentThreadId, setSentThreadId] = useState<string | null>(null);
  const [sentDemo, setSentDemo] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAccountsLoaded(false);
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((payload: { accounts?: AccountOption[] }) => {
        const list = payload.accounts ?? [];
        setAccounts(list);
        const firstConnected = list.find((account) => account.status === "CONNECTED");
        setFromId((current) =>
          list.some((account) => account.id === current && account.status === "CONNECTED")
            ? current
            : (firstConnected?.id ?? ""),
        );
      })
      .catch(() => setAccounts([]))
      .finally(() => setAccountsLoaded(true));
  }, [open ]);

  if (!open) return null;

  const hasConnected = accounts.some((account) => account.status === "CONNECTED");

  function reset() {
    setTo("");
    setSubject("");
    setBody("");
    setError(null);
    setSentThreadId(null);
    setSentDemo(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/threads/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendingAccountId: fromId, to, subject, body }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        thread?: { id: string };
        demo?: boolean;
      };
      if (!response.ok || !payload.thread) {
        throw new Error(payload.error ?? "Could not send the email");
      }
      setSentThreadId(payload.thread.id);
      setSentDemo(Boolean(payload.demo));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the email");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
      <section
        className="card w-full max-w-2xl p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Compose email"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold">New email</h2>
          <button type="button" className="btn-ghost !px-2 !py-1 text-sm" onClick={close}>
            Close
          </button>
        </div>

        {sentThreadId ? (
          <div className="mt-4">
            <p className="text-sm">
              Email sent{sentDemo ? " (DEMO: simulated send, nothing left the server)" : ""}.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href={`/app/inbox/${sentThreadId}`} className="btn-primary" onClick={close}>
                View conversation
              </Link>
              <button type="button" className="btn-secondary" onClick={close}>
                Done
              </button>
            </div>
          </div>
        ) : !accountsLoaded ? (
          <p className="mt-4 text-sm text-muted">Loading sending accounts...</p>
        ) : !hasConnected ? (
          <div className="mt-4">
            <p className="text-sm text-muted">
              A connected sending account is required to send email.{" "}
              <Link href="/app/accounts" className="text-accent hover:underline">
                Connect one on the Sending Accounts page
              </Link>
              .
            </p>
            <button type="button" className="btn-secondary mt-4" onClick={close}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={send} className="mt-4 space-y-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              From
              <select
                className="input"
                value={fromId}
                onChange={(event) => setFromId(event.target.value)}
                disabled={sending}
                required
              >
                {accounts.map((account) => (
                  <option
                    key={account.id}
                    value={account.id}
                    disabled={account.status !== "CONNECTED"}
                  >
                    {account.displayName ? `${account.displayName} <${account.email}>` : account.email}
                    {account.status !== "CONNECTED" ? ` (${account.status})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              To
              <input
                className="input"
                type="email"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="recipient@example.com"
                disabled={sending}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Subject
              <input
                className="input"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={sending}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Body
              <textarea
                className="input min-h-48"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={sending}
                required
              />
            </label>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex gap-3">
              <button type="submit" className="btn-primary" disabled={sending}>
                {sending ? "Sending..." : "Send"}
              </button>
              <button type="button" className="btn-secondary" onClick={close} disabled={sending}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
