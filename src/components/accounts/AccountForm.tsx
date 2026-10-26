"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccountForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [provider, setProvider] = useState("SIMULATION");
  const [dailyLimit, setDailyLimit] = useState(50);
  const [credentialRef, setCredentialRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const response = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        displayName,
        provider,
        dailyLimit,
        credentialRef: provider === "SMTP" ? credentialRef : undefined,
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not create the account");
      return;
    }
    if (data.account.lastError) {
      setNotice(data.account.lastError);
    }
    setEmail("");
    setDisplayName("");
    setCredentialRef("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        Add account
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-md p-5">
      <h2 className="font-display text-base font-semibold">Add sending account</h2>
      <label className="label mt-4" htmlFor="acc-email">Sender email</label>
      <input id="acc-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="outreach@yourcompany.com" />
      <label className="label mt-4" htmlFor="acc-name">Display name</label>
      <input id="acc-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex from YourCompany" />
      <label className="label mt-4" htmlFor="acc-provider">Provider</label>
      <select id="acc-provider" className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
        <option value="SIMULATION">Simulation (DEMO, no real email)</option>
        <option value="SMTP">SMTP (credentialRef to server environment)</option>
        <option value="GMAIL">Gmail (connect via OAuth above)</option>
        <option value="MS365">Microsoft 365 (connect via OAuth above)</option>
      </select>
      {provider === "GMAIL" || provider === "MS365" ? (
        <p className="mt-2 text-xs text-muted">
          Real sending needs the OAuth connection: use the Connect card at the top of this page,
          which stores the tokens encrypted. Adding the account here only creates the record;
          it stays DISCONNECTED and cannot send until the OAuth flow completes.
        </p>
      ) : null}
      {provider === "SIMULATION" ? (
        <p className="mt-2 text-xs text-muted">
          Simulation accounts exercise the whole campaign lifecycle without sending anything.
          Every result they produce is labelled DEMO.
        </p>
      ) : null}
      {provider === "SMTP" ? (
        <>
          <label className="label mt-4" htmlFor="acc-ref">Credential reference</label>
          <input id="acc-ref" className="input" value={credentialRef} onChange={(e) => setCredentialRef(e.target.value)} placeholder="ACME_SMTP" required />
          <p className="mt-2 text-xs text-muted">
            The server reads {"{REF}_HOST, {REF}_PORT, {REF}_USER, {REF}_PASS"} from its
            environment. Passwords are never stored in the database.
          </p>
        </>
      ) : null}
      <label className="label mt-4" htmlFor="acc-limit">Daily limit (hard cap)</label>
      <input id="acc-limit" className="input" type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value) || 50)} />
      <p className="mt-2 text-xs text-muted">
        New accounts ramp up from 20 percent of the cap over 14 days, computed by the limits engine.
      </p>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Adding..." : "Add account"}</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
    </form>
  );
}
