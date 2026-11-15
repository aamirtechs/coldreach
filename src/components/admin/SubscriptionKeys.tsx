"use client";

import { useCallback, useEffect, useState } from "react";

interface ListedKey {
  id: string;
  codeHint: string;
  plan: string;
  planName: string;
  durationDays: number;
  status: string;
  note: string | null;
  createdAt: string;
  redeemedAt: string | null;
  redeemedByWorkspaceName: string | null;
}

interface KeysData {
  keys: ListedKey[];
  counts: Record<string, number>;
}

interface GeneratedKey {
  id: string;
  code: string;
  plan: string;
  durationDays: number;
}

const PLAN_OPTIONS = [
  { id: "STARTER", label: "Starter, Rs. 299/mo" },
  { id: "PRO", label: "Growth, Rs. 499/mo" },
  { id: "AGENCY", label: "Pro, Rs. 699/mo (all features)" },
];

function StatusChip({ status }: { status: string }) {
  const styles =
    status === "UNUSED"
      ? "bg-accent/15 text-accent"
      : status === "REDEEMED"
        ? "bg-elevated text-muted"
        : "bg-warning/15 text-warning";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles}`}>
      {status}
    </span>
  );
}

export function SubscriptionKeys() {
  const [data, setData] = useState<KeysData | null>(null);
  const [generated, setGenerated] = useState<GeneratedKey[]>([]);
  const [plan, setPlan] = useState("STARTER");
  const [count, setCount] = useState(1);
  const [durationDays, setDurationDays] = useState(30);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/keys");
    if (response.ok) {
      setData(await response.json());
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setBusy("generate");
    setNotice(null);
    try {
      const response = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", plan, count, durationDays, note }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(result.error ?? "Keys could not be generated.");
        return;
      }
      setGenerated(result.generated ?? []);
      setData({ keys: result.keys ?? [], counts: result.counts ?? {} });
      setNote("");
    } catch {
      setNotice("Keys could not be generated. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(key: ListedKey) {
    if (
      !window.confirm(
        `Revoke key ${key.codeHint} (${key.planName})? It can never be redeemed after this.`,
      )
    ) {
      return;
    }
    setBusy(`revoke:${key.id}`);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", id: key.id, confirm: true }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(result.error ?? "The key could not be revoked.");
        return;
      }
      setData({ keys: result.keys ?? [], counts: result.counts ?? {} });
      setNotice(`Revoked ${key.codeHint}.`);
    } catch {
      setNotice("The key could not be revoked. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function copyCode(key: GeneratedKey) {
    try {
      await navigator.clipboard.writeText(key.code);
      setCopiedId(key.id);
    } catch {
      setNotice("Copy failed. Select the code and copy it manually.");
    }
  }

  if (!data) {
    return <p className="mt-4 text-sm text-muted">Loading keys...</p>;
  }

  return (
    <div className="mt-4">
      <p className="text-xs text-muted">
        {data.counts.UNUSED ?? 0} unused, {data.counts.REDEEMED ?? 0} redeemed,{" "}
        {data.counts.REVOKED ?? 0} revoked. A key grants its plan for its number of days when a
        workspace owner redeems it on their Billing page. Codes are shown in full only once, at
        generation; afterwards only the hint below remains.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Plan</span>
          <select
            className="input"
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
          >
            {PLAN_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">How many keys</span>
          <input
            className="input w-24"
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(event) => setCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Days per key</span>
          <input
            className="input w-24"
            type="number"
            min={1}
            max={366}
            value={durationDays}
            onChange={(event) =>
              setDurationDays(Math.max(1, Math.min(366, Number(event.target.value) || 30)))
            }
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Note (optional)</span>
          <input
            className="input w-52"
            type="text"
            placeholder="Buyer or batch name"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn-primary"
          onClick={generate}
          disabled={busy !== null}
        >
          {busy === "generate" ? "Generating..." : "Generate keys"}
        </button>
      </div>

      {generated.length > 0 ? (
        <div className="mt-4 rounded border border-accent/40 bg-accent/5 p-4">
          <p className="text-sm font-medium">
            New keys, copy them now. They will not be shown in full again.
          </p>
          <ul className="mt-2 space-y-2">
            {generated.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3">
                <code className="rounded bg-elevated px-2 py-1 font-mono text-sm">{key.code}</code>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => copyCode(key)}
                >
                  {copiedId === key.id ? "Copied" : "Copy"}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-ghost mt-3"
            onClick={() => setGenerated([])}
          >
            Done, hide the codes
          </button>
        </div>
      ) : null}

      {notice ? <p className="mt-3 text-sm text-warning">{notice}</p> : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2 pr-3 font-medium">Key</th>
              <th className="py-2 pr-3 font-medium">Plan</th>
              <th className="py-2 pr-3 font-medium">Days</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Created</th>
              <th className="py-2 pr-3 font-medium">Redeemed by</th>
              <th className="py-2 pr-3 font-medium">Note</th>
              <th className="py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.keys.map((key) => (
              <tr key={key.id} className="border-t border-line align-top">
                <td className="py-2 pr-3 font-mono text-xs">{key.codeHint}</td>
                <td className="py-2 pr-3">{key.planName}</td>
                <td className="py-2 pr-3">{key.durationDays}</td>
                <td className="py-2 pr-3">
                  <StatusChip status={key.status} />
                </td>
                <td className="py-2 pr-3 text-muted">
                  {new Date(key.createdAt).toLocaleDateString()}
                </td>
                <td className="py-2 pr-3 text-muted">
                  {key.redeemedByWorkspaceName
                    ? `${key.redeemedByWorkspaceName} · ${
                        key.redeemedAt ? new Date(key.redeemedAt).toLocaleDateString() : ""
                      }`
                    : "—"}
                </td>
                <td className="py-2 pr-3 text-muted">{key.note ?? "—"}</td>
                <td className="py-2">
                  {key.status === "UNUSED" ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => revoke(key)}
                      disabled={busy !== null}
                    >
                      {busy === `revoke:${key.id}` ? "Revoking..." : "Revoke"}
                    </button>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {data.keys.length === 0 ? (
              <tr className="border-t border-line">
                <td className="py-3 text-muted" colSpan={8}>
                  No keys yet. Generate the first batch above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
