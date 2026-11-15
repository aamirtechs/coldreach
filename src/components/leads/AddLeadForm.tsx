"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buildManualLeadBody, type ManualCustomField } from "@/lib/leads/manualAdd";

export function AddLeadForm({ listId }: { listId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [icebreaker, setIcebreaker] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [customFields, setCustomFields] = useState<ManualCustomField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateCustom(index: number, patch: Partial<ManualCustomField>) {
    setCustomFields((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        buildManualLeadBody(
          { email, firstName, lastName, company, icebreaker, customFields, tagsText },
          listId,
        ),
      ),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not add the lead");
      return;
    }
    setEmail("");
    setFirstName("");
    setLastName("");
    setCompany("");
    setIcebreaker("");
    setTagsText("");
    setCustomFields([]);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        Add lead
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card mt-6 p-5">
      <h2 className="font-display text-base font-semibold">Add a lead</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="lead-email">Email</label>
          <input id="lead-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
        </div>
        <div>
          <label className="label" htmlFor="lead-company">Company</label>
          <input id="lead-company" className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Inc" />
        </div>
        <div>
          <label className="label" htmlFor="lead-first">First name</label>
          <input id="lead-first" className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
        </div>
        <div>
          <label className="label" htmlFor="lead-last">Last name</label>
          <input id="lead-last" className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Shah" />
        </div>
      </div>
      <div className="mt-4">
        <label className="label" htmlFor="lead-icebreaker">Hook line</label>
        <textarea id="lead-icebreaker" className="input" rows={2} value={icebreaker} onChange={(e) => setIcebreaker(e.target.value)} placeholder="Saw you just launched your new program, congrats." />
        <p className="mt-1 text-xs text-muted">The personalised opening line. Campaign emails use it through the {"{{icebreaker}}"} token, the same field the CSV import fills.</p>
      </div>
      <div className="mt-4">
        <label className="label" htmlFor="lead-tags">Tags</label>
        <input id="lead-tags" className="input" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="vip, saas, founder" />
        <p className="mt-1 text-xs text-muted">Comma separated.</p>
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="label mb-0">More fields</span>
          <button type="button" className="btn-secondary" onClick={() => setCustomFields((rows) => [...rows, { key: "", value: "" }])}>
            Add field
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">Any extra field an import could store, for example website, title, or city. The name becomes a {"{{token}}"} you can use in campaign emails.</p>
        {customFields.length > 0 ? (
          <div className="mt-3 grid gap-3">
            {customFields.map((row, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <input className="input" value={row.key} onChange={(e) => updateCustom(index, { key: e.target.value })} placeholder="Field name, e.g. website" aria-label="Field name" />
                <input className="input" value={row.value} onChange={(e) => updateCustom(index, { value: e.target.value })} placeholder="Value" aria-label="Field value" />
                <button type="button" className="btn-secondary" onClick={() => setCustomFields((rows) => rows.filter((_, i) => i !== index))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Adding..." : "Add lead"}</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
