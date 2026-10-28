"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * AI provider key panel (v1.8.0), Integrations page.
 *
 * Each workspace brings its own OpenAI or Groq key. The key is
 * write-only here: the server stores it encrypted and the status
 * endpoint reports only the provider, model, and which source serves
 * the workspace (its own key, the platform owner's key, or none).
 * Saving a new key replaces the old one; removing falls back to
 * unconfigured unless the platform exception applies.
 */

interface AiStatus {
  configured: boolean;
  source: "workspace" | "platform" | null;
  provider: "openai" | "groq" | null;
  model: string;
  hasOwnKey: boolean;
}

const PROVIDER_LABELS: Record<string, string> = { openai: "OpenAI", groq: "Groq" };

export function AiProviderPanel({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [provider, setProvider] = useState<"openai" | "groq">("groq");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/integrations/ai");
    if (!response.ok) {
      setStatus({ configured: false, source: null, provider: null, model: "", hasOwnKey: false });
      return;
    }
    const data = (await response.json()) as AiStatus;
    setStatus(data);
    if (data.hasOwnKey && data.provider) {
      setProvider(data.provider);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey, model: model.trim() || undefined }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? "Could not save the key. Please try again.");
        return;
      }
      setStatus(data as AiStatus);
      setApiKey("");
      setNotice("Key saved. AI features in this workspace now run on your own key.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/ai", { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? "Could not remove the key. Please try again.");
        return;
      }
      setStatus(data as AiStatus);
      setNotice("Key removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mt-6 p-6">
      <h2 className="font-display text-lg font-semibold">AI provider</h2>
      <p className="mt-1 text-sm text-muted">
        Icebreakers, subject ideas, and rewrites run on this workspace's own OpenAI or Groq key,
        billed to that provider account. Keys are stored encrypted and are never shown again after
        saving. Workspaces without a key have AI switched off.
      </p>

      {status === null ? (
        <p className="mt-4 text-sm text-muted">Checking AI configuration...</p>
      ) : (
        <p className="mt-4 text-sm">
          {status.configured ? (
            <>
              <span className="font-medium text-success">Live</span>
              <span className="text-muted">
                {" "}
                with {PROVIDER_LABELS[status.provider ?? ""] ?? status.provider}, model{" "}
                {status.model},{" "}
                {status.source === "workspace"
                  ? "using this workspace's own key."
                  : "using the platform owner's key. Add your own key below to run on your own account instead."}
              </span>
            </>
          ) : (
            <span className="text-muted">
              Not configured. Add a key below and AI features switch on for this workspace.
            </span>
          )}
        </p>
      )}

      {notice && <p className="mt-3 text-sm text-success">{notice}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {canManage ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr_1fr_auto] sm:items-end">
          <div>
            <label className="label" htmlFor="ai-provider">
              Provider
            </label>
            <select
              id="ai-provider"
              className="input"
              value={provider}
              onChange={(event) => setProvider(event.target.value as "openai" | "groq")}
            >
              <option value="groq">Groq</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ai-key">
              API key
            </label>
            <input
              id="ai-key"
              type="password"
              className="input"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={status?.hasOwnKey ? "Paste a new key to replace the saved one" : "Paste your API key"}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label" htmlFor="ai-model">
              Model (optional)
            </label>
            <input
              id="ai-model"
              type="text"
              className="input"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={provider === "groq" ? "llama-3.3-70b-versatile" : "gpt-4o-mini"}
              autoComplete="off"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={save} disabled={busy || apiKey.trim().length < 8}>
              {status?.hasOwnKey ? "Replace key" : "Save key"}
            </button>
            {status?.hasOwnKey && (
              <button type="button" className="btn-secondary" onClick={remove} disabled={busy}>
                Remove
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">
          Only workspace admins can add or change the AI key.
        </p>
      )}
    </section>
  );
}
