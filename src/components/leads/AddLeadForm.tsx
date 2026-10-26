"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddLeadForm({ listId }: { listId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, listId, fields: { firstName, lastName, company } }),
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
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Adding..." : "Add lead"}</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
