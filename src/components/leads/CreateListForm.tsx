"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateListForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/lead-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not create the list");
      return;
    }
    setOpen(false);
    setName("");
    setDescription("");
    router.push(`/app/leads/${data.list.id}`);
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        New list
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-md p-5">
      <h2 className="font-display text-base font-semibold">New lead list</h2>
      <label className="label mt-4" htmlFor="list-name">Name</label>
      <input
        id="list-name"
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="SaaS founders, Q3 outreach"
        required
      />
      <label className="label mt-4" htmlFor="list-description">Description (optional)</label>
      <input
        id="list-description"
        className="input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Where these leads came from"
      />
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Creating..." : "Create list"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
