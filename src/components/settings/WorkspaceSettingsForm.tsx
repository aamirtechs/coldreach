"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface WorkspaceSettingsFormProps {
  initial: {
    name: string;
    senderName: string;
    senderAddress: string;
    trackingDomain: string;
    hourlySendCap: string;
  };
  canEdit: boolean;
}

export function WorkspaceSettingsForm({ initial, canEdit }: WorkspaceSettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [senderName, setSenderName] = useState(initial.senderName);
  const [senderAddress, setSenderAddress] = useState(initial.senderAddress);
  const [trackingDomain, setTrackingDomain] = useState(initial.trackingDomain);
  const [hourlySendCap, setHourlySendCap] = useState(initial.hourlySendCap);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const capText = hourlySendCap.trim();
    const response = await fetch("/api/workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        senderName,
        senderAddress,
        trackingDomain,
        hourlySendCap: capText === "" ? null : Number(capText),
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setNotice(data.error ?? "Could not save settings");
      return;
    }
    setNotice("Workspace settings saved.");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card p-6">
      <h2 className="font-display text-lg font-semibold">Workspace and sender identity</h2>
      <p className="mt-1 text-sm text-muted">
        The sender name and postal address appear in the footer of every campaign email, next to
        the unsubscribe link. Campaign preflight refuses to launch while the postal address is
        missing, because anti-spam rules in most jurisdictions require it.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="ws-name">Workspace name</label>
          <input id="ws-name" className="input" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="ws-sender">Sender display name</label>
          <input id="ws-sender" className="input" value={senderName} disabled={!canEdit} onChange={(e) => setSenderName(e.target.value)} placeholder="YourCompany Outreach" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ws-address">Postal address</label>
          <input id="ws-address" className="input" value={senderAddress} disabled={!canEdit} onChange={(e) => setSenderAddress(e.target.value)} placeholder="123 Market Street, Suite 400, San Francisco, CA 94103" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ws-tracking">Tracking domain</label>
          <input id="ws-tracking" className="input" value={trackingDomain} disabled={!canEdit} onChange={(e) => setTrackingDomain(e.target.value)} placeholder="track.example.com" />
          <p className="mt-1 text-xs text-muted">
            Optional. Add a DNS CNAME record from this host to the app domain (the domain this app
            is served on), then save the bare host here, with no https:// prefix. Once saved, open
            tracking pixels and click tracking links in campaign emails use this domain instead of
            the app domain. Leave it empty to track on the app domain.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ws-hourly-cap">Max sends per hour</label>
          <input id="ws-hourly-cap" className="input" type="number" min={1} max={10000} step={1} value={hourlySendCap} disabled={!canEdit} onChange={(e) => setHourlySendCap(e.target.value)} placeholder="90 (platform default)" />
          <p className="mt-1 text-xs text-muted">
            Optional. The most emails your sending domains may send in any rolling hour. Mail
            hosts enforce their own hourly limit and discard whatever arrives above it, so set
            this just under your host's limit (for example 50 if your host allows 60 per hour)
            and the worker spreads sends under it instead of bursting. Leave it empty to use
            the platform default of 90.
          </p>
        </div>
      </div>
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
      {canEdit ? (
        <div className="mt-5">
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving..." : "Save settings"}</button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">Changing these settings requires the ADMIN role.</p>
      )}
    </form>
  );
}
