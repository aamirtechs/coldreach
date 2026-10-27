"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ProtocolResult {
  ok: boolean;
  error?: string;
}

interface TestResults {
  smtp: ProtocolResult;
  imap: ProtocolResult;
}

export function AccountForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [provider, setProvider] = useState("SIMULATION");
  const [dailyLimit, setDailyLimit] = useState(50);
  const [credentialRef, setCredentialRef] = useState("");
  const [smtpMode, setSmtpMode] = useState<"MAILBOX" | "ENV">("MAILBOX");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [imapSecure, setImapSecure] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [testResults, setTestResults] = useState<TestResults | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** cPanel layout derived from the mailbox address itself. */
  function applyCpanelDefaults() {
    const domain = email.split("@")[1]?.trim();
    if (!domain) {
      setError("Enter the sender email first, then use the cPanel defaults.");
      return;
    }
    setError(null);
    setSmtpHost(`mail.${domain}`);
    setSmtpPort(465);
    setSmtpSecure(true);
    setImapHost(`mail.${domain}`);
    setImapPort(993);
    setImapSecure(true);
    setUsername(email.trim());
    setTestResults(null);
  }

  function mailboxFields() {
    return {
      smtpHost,
      smtpPort,
      smtpSecure,
      imapHost: imapHost || undefined,
      imapPort,
      imapSecure,
      username: username || undefined,
      password,
    };
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setTestResults(null);
    try {
      const response = await fetch("/api/accounts/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...mailboxFields() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not test the connection");
        return;
      }
      setTestResults(data as TestResults);
    } catch {
      setError("Could not reach the server to run the connection test");
    } finally {
      setTesting(false);
    }
  }

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
        ...(provider === "SMTP"
          ? smtpMode === "MAILBOX"
            ? mailboxFields()
            : { credentialRef }
          : {}),
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
    setPassword("");
    setTestResults(null);
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
        <option value="SMTP">SMTP / IMAP (cPanel or any mail server)</option>
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
          <label className="label mt-4" htmlFor="acc-smtp-mode">Credential style</label>
          <select
            id="acc-smtp-mode"
            className="input"
            value={smtpMode}
            onChange={(e) => setSmtpMode(e.target.value as "MAILBOX" | "ENV")}
          >
            <option value="MAILBOX">Enter mailbox password (stored encrypted)</option>
            <option value="ENV">Server environment reference</option>
          </select>
          {smtpMode === "MAILBOX" ? (
            <>
              <button type="button" className="btn-secondary mt-4" onClick={applyCpanelDefaults}>
                Fill cPanel defaults from email
              </button>
              <p className="mt-2 text-xs text-muted">
                cPanel layout: server mail.your-domain, SMTP 465 and IMAP 993 with TLS on,
                username is the full email address. Everything stays editable, and STARTTLS
                uses ports 587 (SMTP) and 143 (IMAP) with the TLS boxes off.
              </p>
              <label className="label mt-4" htmlFor="acc-smtp-host">SMTP host</label>
              <input id="acc-smtp-host" className="input" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="mail.yourcompany.com" required />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="acc-smtp-port">SMTP port</label>
                  <input
                    id="acc-smtp-port"
                    className="input"
                    type="number"
                    min={1}
                    max={65535}
                    value={smtpPort}
                    onChange={(e) => {
                      const port = Number(e.target.value) || 465;
                      setSmtpPort(port);
                      if (port === 465) setSmtpSecure(true);
                      if (port === 587 || port === 25) setSmtpSecure(false);
                    }}
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm" htmlFor="acc-smtp-secure">
                    <input id="acc-smtp-secure" type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
                    SMTP TLS (implicit)
                  </label>
                </div>
              </div>
              <label className="label mt-4" htmlFor="acc-imap-host">IMAP host (for reply sync)</label>
              <input id="acc-imap-host" className="input" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="Same as SMTP host when empty" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="acc-imap-port">IMAP port</label>
                  <input
                    id="acc-imap-port"
                    className="input"
                    type="number"
                    min={1}
                    max={65535}
                    value={imapPort}
                    onChange={(e) => {
                      const port = Number(e.target.value) || 993;
                      setImapPort(port);
                      if (port === 993) setImapSecure(true);
                      if (port === 143) setImapSecure(false);
                    }}
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm" htmlFor="acc-imap-secure">
                    <input id="acc-imap-secure" type="checkbox" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} />
                    IMAP TLS (implicit)
                  </label>
                </div>
              </div>
              <label className="label mt-4" htmlFor="acc-username">Mailbox username</label>
              <input id="acc-username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Defaults to the full email address" />
              <label className="label mt-4" htmlFor="acc-password">Mailbox password</label>
              <input id="acc-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <p className="mt-2 text-xs text-muted">
                The password is stored only as an AES-256-GCM encrypted blob and is never
                shown again. Test the connection before saving.
              </p>
              <button
                type="button"
                className="btn-secondary mt-4"
                onClick={testConnection}
                disabled={testing || !smtpHost || !password}
              >
                {testing ? "Testing..." : "Test connection"}
              </button>
              {testResults ? (
                <div className="mt-3 space-y-1 text-sm" role="status">
                  <p className={testResults.smtp.ok ? "text-success" : "text-danger"}>
                    SMTP: {testResults.smtp.ok ? "connected" : testResults.smtp.error ?? "failed"}
                  </p>
                  <p className={testResults.imap.ok ? "text-success" : "text-danger"}>
                    IMAP: {testResults.imap.ok ? "connected" : testResults.imap.error ?? "failed"}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <label className="label mt-4" htmlFor="acc-ref">Credential reference</label>
              <input id="acc-ref" className="input" value={credentialRef} onChange={(e) => setCredentialRef(e.target.value)} placeholder="ACME_SMTP" required />
              <p className="mt-2 text-xs text-muted">
                The server reads {"{REF}_HOST, {REF}_PORT, {REF}_USER, {REF}_PASS"} from its
                environment, plus optional {"{REF}_IMAP_HOST, {REF}_IMAP_PORT, {REF}_IMAP_SECURE"}
                for reply sync. Passwords are never stored in the database on this path.
              </p>
            </>
          )}
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
