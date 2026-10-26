"use client";

import { useCallback, useEffect, useState } from "react";

interface DeliveryRow {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}

interface EndpointRow {
  id: string;
  url: string;
  eventTypes: string[];
  active: boolean;
  createdAt: string;
  deliveryCount: number;
  recentDeliveries: DeliveryRow[];
}

export function WebhooksPanel({ canManage }: { canManage: boolean }) {
  const [endpoints, setEndpoints] = useState<EndpointRow[] | null>(null);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [encryptionReady, setEncryptionReady] = useState(true);
  const [url, setUrl] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(["REPLIED"]));
  const [secret, setSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [fullLog, setFullLog] = useState<DeliveryRow[] | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/webhooks");
    if (!response.ok) {
      setEndpoints([]);
      return;
    }
    const data = await response.json();
    setEndpoints(data.endpoints ?? []);
    setAvailableTypes(data.availableEventTypes ?? []);
    setEncryptionReady(Boolean(data.encryptionReady));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleType(type: string) {
    const next = new Set(selectedTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    setSelectedTypes(next);
  }

  async function create() {
    setBusy("create");
    setNotice(null);
    setSecret(null);
    const response = await fetch("/api/settings/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, eventTypes: [...selectedTypes] }),
    });
    const data = await response.json();
    setBusy(null);
    if (!response.ok) {
      setNotice(data.error ?? "Could not create the endpoint");
      return;
    }
    setSecret(data.secret);
    setUrl("");
    load();
  }

  async function patch(id: string, patchBody: Record<string, unknown>, message: string) {
    setBusy(id);
    const response = await fetch(`/api/settings/webhooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });
    setBusy(null);
    if (response.ok) {
      setNotice(message);
      load();
    } else {
      const data = await response.json().catch(() => ({}));
      setNotice(data.error ?? "Update failed");
    }
  }

  async function remove(id: string, endpointUrl: string) {
    if (!window.confirm(`Delete the webhook endpoint ${endpointUrl}? Its delivery log is deleted too.`)) {
      return;
    }
    const response = await fetch(`/api/settings/webhooks/${id}`, { method: "DELETE" });
    if (response.ok) {
      setNotice("Endpoint deleted.");
      load();
    }
  }

  async function test(id: string) {
    setBusy(`test:${id}`);
    setNotice(null);
    const response = await fetch(`/api/settings/webhooks/${id}/test`, { method: "POST" });
    const data = await response.json();
    setBusy(null);
    if (!response.ok) {
      setNotice(data.error ?? "Test delivery failed");
      return;
    }
    setNotice(
      data.delivery.status === "DELIVERED"
        ? `Test delivery succeeded (HTTP ${data.delivery.lastStatusCode}).`
        : `Test delivery did not succeed: ${data.delivery.lastError ?? "unknown error"}. It is in the delivery log and will retry on the backoff schedule.`,
    );
    load();
  }

  async function toggleLog(id: string) {
    if (expandedLog === id) {
      setExpandedLog(null);
      setFullLog(null);
      return;
    }
    setExpandedLog(id);
    setFullLog(null);
    const response = await fetch(`/api/settings/webhooks/${id}/deliveries?pageSize=25`);
    if (response.ok) {
      const data = await response.json();
      setFullLog(data.deliveries ?? []);
    }
  }

  return (
    <section className="card mt-6 p-6">
      <h2 className="font-display text-lg font-semibold">Outbound webhooks</h2>
      <p className="mt-1 text-sm text-muted">
        ColdReach posts signed JSON to your endpoints when provider events land (replies, bounces,
        unsubscribes, complaints, deliveries). Verify the <span className="font-mono text-xs">X-ColdReach-Signature</span>{" "}
        header (HMAC-SHA256 of the raw body with your endpoint secret) before trusting a payload.
        Failed deliveries retry after 1 minute, 5 minutes, 30 minutes, and 2 hours, then stop.
      </p>

      {endpoints === null ? (
        <p className="mt-4 text-sm text-muted">Loading endpoints...</p>
      ) : endpoints.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No webhook endpoints yet.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {endpoints.map((endpoint) => (
            <div key={endpoint.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-sm">{endpoint.url}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {endpoint.active ? "Active" : "Paused"} · subscribes to {endpoint.eventTypes.join(", ")} ·{" "}
                    {endpoint.deliveryCount} deliveries
                  </p>
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => test(endpoint.id)} disabled={busy !== null}>
                      {busy === `test:${endpoint.id}` ? "Sending..." : "Send test"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary !py-1.5 text-xs"
                      onClick={() => patch(endpoint.id, { active: !endpoint.active }, endpoint.active ? "Endpoint paused." : "Endpoint resumed.")}
                      disabled={busy !== null}
                    >
                      {endpoint.active ? "Pause" : "Resume"}
                    </button>
                    <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => remove(endpoint.id, endpoint.url)}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
              {endpoint.recentDeliveries.length > 0 ? (
                <>
                  <table className="mt-3 w-full text-left text-xs">
                    <thead className="text-muted">
                      <tr>
                        <th className="py-1 font-medium">Event</th>
                        <th className="py-1 font-medium">Status</th>
                        <th className="py-1 font-medium">Attempts</th>
                        <th className="py-1 font-medium">HTTP</th>
                        <th className="py-1 font-medium">When</th>
                        <th className="py-1 font-medium">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(expandedLog === endpoint.id && fullLog ? fullLog : endpoint.recentDeliveries).map((delivery) => (
                        <tr key={delivery.id} className="border-t border-line">
                          <td className="py-1 font-mono">{delivery.eventType}</td>
                          <td className="py-1">{delivery.status}</td>
                          <td className="py-1">{delivery.attempts}</td>
                          <td className="py-1">{delivery.lastStatusCode ?? "-"}</td>
                          <td className="py-1 text-muted">{new Date(delivery.createdAt).toLocaleString()}</td>
                          <td className="py-1 text-muted">{delivery.lastError ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="button" className="btn-ghost mt-1 !px-2 !py-1 text-xs" onClick={() => toggleLog(endpoint.id)}>
                    {expandedLog === endpoint.id ? "Show recent only" : "Full delivery log"}
                  </button>
                </>
              ) : (
                <p className="mt-2 text-xs text-muted">No deliveries yet. Use Send test to verify the receiver.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <div className="mt-5 rounded-lg border border-line p-4">
          <h3 className="text-sm font-semibold">Add an endpoint</h3>
          {!encryptionReady ? (
            <p className="mt-2 text-sm text-warning">
              Webhook secrets are stored encrypted, which requires ENCRYPTION_KEY in the server
              environment. Set it before creating endpoints.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="webhook-url">Endpoint URL</label>
              <input
                id="webhook-url"
                className="input w-96"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/coldreach-webhook"
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={create}
              disabled={busy !== null || !url.trim() || selectedTypes.size === 0}
            >
              {busy === "create" ? "Creating..." : "Create endpoint"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {availableTypes.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedTypes.has(type)} onChange={() => toggleType(type)} />
                <span className="font-mono text-xs">{type}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">URLs must use https (http is accepted for localhost while developing).</p>
          {secret ? (
            <div className="mt-4 rounded-lg border border-dashed border-line bg-elevated p-3">
              <p className="text-xs font-semibold">Signing secret (shown once, copy it now):</p>
              <p className="mt-1 break-all font-mono text-sm">{secret}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">Only workspace admins and owners can manage webhook endpoints.</p>
      )}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
    </section>
  );
}
