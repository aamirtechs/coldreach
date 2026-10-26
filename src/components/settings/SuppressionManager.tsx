"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SuppressionRow {
  id: string;
  scope: string;
  email: string | null;
  domain: string | null;
  reason: string;
  createdAt: string;
}

export function SuppressionManager({ initial, canEdit }: { initial: SuppressionRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    const payload = trimmed.includes("@")
      ? { email: trimmed, reason }
      : { domain: trimmed, reason };
    const response = await fetch("/api/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setNotice(data.error ?? "Could not add the entry");
      return;
    }
    setValue("");
    setReason("");
    setNotice("Suppression added. It applies to imports, enrollment, and every send from now on.");
    router.refresh();
  }

  return (
    <section className="card mt-6 p-6">
      <h2 className="font-display text-lg font-semibold">Suppression list</h2>
      <p className="mt-1 text-sm text-muted">
        Suppressed addresses and domains are refused at import, skipped at enrollment, and
        re-checked before every single send. Unsubscribes, hard bounces, and complaints land
        here automatically.
      </p>
      {canEdit ? (
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="sup-value">Email or domain</label>
            <input id="sup-value" className="input w-64" value={value} onChange={(e) => setValue(e.target.value)} placeholder="person@company.com or company.com" required />
          </div>
          <div>
            <label className="label" htmlFor="sup-reason">Reason</label>
            <input id="sup-reason" className="input w-64" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Asked not to be contacted" />
          </div>
          <button type="submit" className="btn-primary">Add suppression</button>
        </form>
      ) : null}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
      {initial.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No suppression entries in force.</p>
      ) : (
        <div className="mt-4 max-h-80 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Entry</th>
                <th className="py-2 pr-3 font-medium">Scope</th>
                <th className="py-2 pr-3 font-medium">Reason</th>
                <th className="py-2 font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {initial.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-medium">{row.email ?? `@${row.domain ?? ""}`}</td>
                  <td className="py-2 pr-3 text-muted">{row.scope}</td>
                  <td className="py-2 pr-3 text-muted">{row.reason}</td>
                  <td className="py-2 text-muted">{new Date(row.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
