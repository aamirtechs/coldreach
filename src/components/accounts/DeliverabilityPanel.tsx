"use client";

import { useEffect, useState } from "react";
import { formatPercent } from "@/components/ui";

interface Finding {
  check: string;
  status: "pass" | "warn" | "fail" | "unknown";
  severity: string;
  message: string;
  fix: string;
}

interface DnsReport {
  domain: string;
  grade: string;
  score: number;
  findings: Finding[];
  spfRecord: string | null;
  dmarcRecord: string | null;
  dkimSelectorsFound: string[];
}

interface AccountHealthCard {
  id: string;
  email: string;
  provider: string;
  status: string;
  lastError: string | null;
  lastSyncAt: string | null;
  lastFailureAt: string | null;
  counts: { sent: number; delivered: number; bounced: number; complained: number; failed: number };
  health: {
    score: number | null;
    grade: string | null;
    bounceRate: number;
    complaintRate: number;
    failedRate: number;
  };
}

const STATUS_STYLES: Record<Finding["status"], string> = {
  pass: "text-accent",
  warn: "text-warning",
  fail: "text-danger",
  unknown: "text-muted",
};

/**
 * Deliverability diagnostics: a live DNS authentication check for any
 * domain plus per account health cards computed from recorded events.
 * The health formula is printed on the panel, next to the numbers it
 * produces, so a score can always be traced to the events behind it.
 */
export function DeliverabilityPanel() {
  const [domain, setDomain] = useState("");
  const [report, setReport] = useState<DnsReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<AccountHealthCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/deliverability/accounts")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load account health");
        return (await response.json()) as { accounts: AccountHealthCard[] };
      })
      .then((payload) => {
        if (!cancelled) setCards(payload.accounts);
      })
      .catch(() => {
        if (!cancelled) setCards([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runCheck(event: React.FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/deliverability/check?domain=${encodeURIComponent(domain)}`,
      );
      const payload = (await response.json().catch(() => ({}))) as {
        report?: DnsReport;
        error?: string;
      };
      if (!response.ok || !payload.report) {
        throw new Error(payload.error ?? "Check failed");
      }
      setReport(payload.report);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="card mt-6 p-5">
      <h2 className="font-display text-base font-semibold">Deliverability diagnostics</h2>
      <p className="mt-1 text-sm text-muted">
        Check the DNS authentication of any sending domain, and see each account's health from
        its recorded sending events. A good grade means the configuration is right; no tool can
        guarantee inbox placement.
      </p>

      <form onSubmit={runCheck} className="mt-4 flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="yourcompany.com"
          aria-label="Domain to check"
          required
        />
        <button type="submit" className="btn-primary" disabled={checking}>
          {checking ? "Checking..." : "Check domain"}
        </button>
      </form>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      {report ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display text-3xl font-semibold">
              {report.findings.every((finding) => finding.status === "unknown")
                ? "Unable to verify"
                : report.grade}
            </span>
            <span className="text-sm text-muted">
              {report.findings.every((finding) => finding.status === "unknown")
                ? `${report.domain} could not be checked: its DNS did not answer. The findings below say what to retry.`
                : `${report.domain} scores ${report.score} of 100. DKIM selectors found: ${
                    report.dkimSelectorsFound.length > 0
                      ? report.dkimSelectorsFound.join(", ")
                      : "none of the common ones"
                  }.`}
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {report.findings.map((finding, index) => (
              <li key={index} className="rounded-lg border border-line p-3">
                <p className="text-sm">
                  <span className={`font-semibold ${STATUS_STYLES[finding.status]}`}>
                    {finding.check}: {finding.status.toUpperCase()}
                  </span>{" "}
                  {finding.message}
                </p>
                <p className="mt-1 text-xs text-muted">Fix: {finding.fix}</p>
              </li>
            ))}
          </ul>
          {report.spfRecord ? (
            <p className="mt-3 break-all text-xs text-muted">SPF: {report.spfRecord}</p>
          ) : null}
          {report.dmarcRecord ? (
            <p className="mt-1 break-all text-xs text-muted">DMARC: {report.dmarcRecord}</p>
          ) : null}
        </div>
      ) : null}

      <h3 className="mt-8 font-display text-sm font-semibold">Account health</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Score = 100 minus min(60, bounce rate x 300) minus min(30, complaint rate x 3000) minus
        min(20, failed rate x 100), using recorded SENT events as the denominator. Accounts with
        no sends yet show no score rather than an invented one. Orientation: providers start
        restricting senders around a 2 percent bounce rate or a 0.1 percent complaint rate.
      </p>
      {cards.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No sending accounts to report on yet.</p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {cards.map((card) => (
            <article key={card.id} className="rounded-xl border border-line p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-medium">{card.email}</h4>
                  <p className="text-xs text-muted">
                    {card.provider} · {card.status}
                    {card.provider === "SIMULATION" ? " · DEMO data" : ""}
                  </p>
                </div>
                <span className="font-display text-2xl font-semibold">
                  {card.health.grade ?? "No data"}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <dt className="text-muted">Bounce rate</dt>
                  <dd className="mt-0.5 font-medium">{formatPercent(card.health.bounceRate)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Complaint rate</dt>
                  <dd className="mt-0.5 font-medium">{formatPercent(card.health.complaintRate)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Failures</dt>
                  <dd className="mt-0.5 font-medium">
                    {card.counts.failed} of {card.counts.sent} sent
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted">
                Sent {card.counts.sent} · delivered {card.counts.delivered} · bounced{" "}
                {card.counts.bounced} · complained {card.counts.complained}
                {card.lastFailureAt
                  ? ` · last failure ${new Date(card.lastFailureAt).toLocaleString()}`
                  : ""}
              </p>
              {card.lastError ? (
                <p className="mt-1 text-xs text-warning">Last error: {card.lastError}</p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
