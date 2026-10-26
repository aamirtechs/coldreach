"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ListOption {
  id: string;
  name: string;
}

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
];

export function CreateCampaignForm({ lists }: { lists: ListOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [leadListId, setLeadListId] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, leadListId: leadListId || undefined, timezone }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not create the campaign");
      return;
    }
    router.push(`/app/campaigns/${data.campaign.id}`);
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        New campaign
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-md p-5">
      <h2 className="font-display text-base font-semibold">New campaign</h2>
      <label className="label mt-4" htmlFor="camp-name">Name</label>
      <input id="camp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Founders outreach, October" required />
      <label className="label mt-4" htmlFor="camp-list">Lead list</label>
      <select id="camp-list" className="input" value={leadListId} onChange={(e) => setLeadListId(e.target.value)}>
        <option value="">Attach later</option>
        {lists.map((list) => (
          <option key={list.id} value={list.id}>{list.name}</option>
        ))}
      </select>
      <label className="label mt-4" htmlFor="camp-tz">Timezone</label>
      <select id="camp-tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
        {TIMEZONES.map((tz) => (
          <option key={tz} value={tz}>{tz}</option>
        ))}
      </select>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Creating..." : "Create campaign"}</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
