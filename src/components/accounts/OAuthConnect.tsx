"use client";

import { useEffect, useState } from "react";
import { Mail, ShieldAlert } from "lucide-react";

interface ProviderStatus {
  id: "google" | "microsoft";
  accountProvider: string;
  label: string;
  configured: boolean;
  missingEnv: string[];
}

interface StatusPayload {
  providers: ProviderStatus[];
  encryptionReady: boolean;
}

/**
 * Gmail and Microsoft 365 connection cards. A provider renders a real
 * connect link only when the server reports it configured (client
 * credentials present and the token encryption key set). Otherwise the
 * card says "Not configured" and names the exact environment variables
 * the owner still has to set, pointing at INTEGRATIONS.md. There is no
 * state in between, and no button that pretends to work.
 */
export function OAuthConnect({ oauthResult }: { oauthResult?: { outcome: string; detail?: string } }) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/accounts/oauth/status")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load provider status");
        return (await response.json()) as StatusPayload;
      })
      .then((payload) => {
        if (!cancelled) setStatus(payload);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card mt-6 p-5">
      <h2 className="font-display text-base font-semibold">Connect a mailbox</h2>
      <p className="mt-1 text-sm text-muted">
        OAuth connections let campaigns send from a real Gmail or Microsoft 365 mailbox and let
        reply sync read its inbox. Tokens are stored encrypted (AES-256-GCM) and refreshed
        automatically.
      </p>
      {oauthResult?.outcome === "connected" ? (
        <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-sm">
          Connected {oauthResult.detail}. Reply sync is available from the account row below.
        </p>
      ) : null}
      {oauthResult && oauthResult.outcome !== "connected" ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-elevated px-3 py-2 text-sm text-warning">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Connection {oauthResult.outcome === "denied" ? "was cancelled at the provider" : "failed"}
            {oauthResult.detail ? `: ${oauthResult.detail}` : ""}.
          </span>
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {(status?.providers ?? []).map((provider) => (
          <div key={provider.id} className="rounded-xl border border-line p-4">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-accent" />
              <h3 className="font-medium">{provider.label}</h3>
            </div>
            {provider.configured ? (
              <>
                <p className="mt-2 text-sm text-muted">
                  Configured on this server. Connecting asks the provider for send and read
                  permission on the mailbox you choose.
                </p>
                <a className="btn-primary mt-3 inline-flex" href={`/api/accounts/oauth/${provider.id}/start`}>
                  Connect {provider.label}
                </a>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm font-medium text-warning">Not configured</p>
                <p className="mt-1 text-sm text-muted">
                  The server is missing: {provider.missingEnv.join(", ")}. The workspace owner
                  sets these in the deployment environment. Exact steps, including creating the
                  OAuth app, are in INTEGRATIONS.md in the project repository.
                </p>
              </>
            )}
          </div>
        ))}
        {status === null && !error ? <p className="text-sm text-muted">Checking provider configuration...</p> : null}
      </div>
    </section>
  );
}
