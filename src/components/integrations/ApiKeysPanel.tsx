"use client";

import { useCallback, useEffect, useState } from "react";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { name: string; email: string } | null;
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "leads:read": "List and read leads",
  "leads:write": "Create leads (dedupe and suppression enforced)",
  "suppressions:write": "Add suppressions",
  "stats:read": "Read campaign statistics",
};

export function ApiKeysPanel({ canManage }: { canManage: boolean }) {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set(["leads:read"]));
  const [fullKey, setFullKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/api-keys");
    if (!response.ok) {
      setKeys([]);
      return;
    }
    const data = await response.json();
    setKeys(data.keys ?? []);
    setAvailableScopes(data.availableScopes ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleScope(scope: string) {
    const next = new Set(selectedScopes);
    if (next.has(scope)) {
      next.delete(scope);
    } else {
      next.add(scope);
    }
    setSelectedScopes(next);
  }

  async function create() {
    setBusy(true);
    setNotice(null);
    setFullKey(null);
    const response = await fetch("/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scopes: [...selectedScopes] }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setNotice(data.error ?? "Could not create the key");
      return;
    }
    setFullKey(data.fullKey);
    setName("");
    load();
  }

  async function revoke(id: string, keyName: string) {
    if (!window.confirm(`Revoke the key "${keyName}"? Integrations using it stop working immediately.`)) {
      return;
    }
    const response = await fetch(`/api/settings/api-keys/${id}`, { method: "DELETE" });
    if (response.ok) {
      setNotice(`Key "${keyName}" revoked.`);
      load();
    }
  }

  return (
    <section className="card mt-6 p-6">
      <h2 className="font-display text-lg font-semibold">Public API keys</h2>
      <p className="mt-1 text-sm text-muted">
        Keys authenticate the REST API documented in API.md (in the repository). Only a hash of each
        key is stored; the full key is shown once, at creation. Keys are scoped and rate limited to
        120 requests per minute per key.
      </p>

      {keys === null ? (
        <p className="mt-4 text-sm text-muted">Loading keys...</p>
      ) : keys.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No API keys yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Prefix</th>
                <th className="px-3 py-2 font-medium">Scopes</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-medium">{key.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{key.prefix}...</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map((scope) => (
                        <span key={scope} className="rounded bg-elevated px-1.5 py-0.5 text-xs text-muted">
                          {scope}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}
                  </td>
                  <td className="px-3 py-2">{key.revokedAt ? "Revoked" : "Active"}</td>
                  <td className="px-3 py-2 text-right">
                    {canManage && !key.revokedAt ? (
                      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => revoke(key.id, key.name)}>
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <div className="mt-5 rounded-lg border border-line p-4">
          <h3 className="text-sm font-semibold">Create a key</h3>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="apikey-name">Name</label>
              <input
                id="apikey-name"
                className="input w-64"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Zapier production"
              />
            </div>
            <button type="button" className="btn-primary" onClick={create} disabled={busy || !name.trim() || selectedScopes.size === 0}>
              {busy ? "Creating..." : "Create key"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {availableScopes.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedScopes.has(scope)}
                  onChange={() => toggleScope(scope)}
                />
                <span>
                  <span className="font-mono text-xs">{scope}</span>
                  <span className="text-muted"> · {SCOPE_DESCRIPTIONS[scope] ?? ""}</span>
                </span>
              </label>
            ))}
          </div>
          {fullKey ? (
            <div className="mt-4 rounded-lg border border-dashed border-line bg-elevated p-3">
              <p className="text-xs font-semibold">Your new API key (shown once, copy it now):</p>
              <p className="mt-1 break-all font-mono text-sm">{fullKey}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">Only workspace admins and owners can manage API keys.</p>
      )}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
    </section>
  );
}
