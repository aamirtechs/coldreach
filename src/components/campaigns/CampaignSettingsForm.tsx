"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AccountOption {
  id: string;
  email: string;
  provider: string;
  status: string;
}

interface CampaignSettingsFormProps {
  campaignId: string;
  initial: {
    name: string;
    leadListId: string | null;
    timezone: string;
    windowStart: string;
    windowEnd: string;
    businessDaysOnly: boolean;
    accountIds: string[];
  };
  lists: { id: string; name: string }[];
  accounts: AccountOption[];
  editable: boolean;
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

export function CampaignSettingsForm({ campaignId, initial, lists, accounts, editable }: CampaignSettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [leadListId, setLeadListId] = useState(initial.leadListId ?? "");
  const [timezone, setTimezone] = useState(initial.timezone);
  const [windowStart, setWindowStart] = useState(initial.windowStart);
  const [windowEnd, setWindowEnd] = useState(initial.windowEnd);
  const [businessDaysOnly, setBusinessDaysOnly] = useState(initial.businessDaysOnly);
  const [accountIds, setAccountIds] = useState<string[]>(initial.accountIds);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleAccount(id: string, checked: boolean) {
    setAccountIds(checked ? [...accountIds, id] : accountIds.filter((a) => a !== id));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const response = await fetch(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        leadListId: leadListId || "",
        timezone,
        windowStart,
        windowEnd,
        businessDaysOnly,
        accountIds,
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setNotice(data.error ?? "Could not save settings");
      return;
    }
    if (data.enrollment) {
      const e = data.enrollment;
      setNotice(
        `Settings saved. Enrollment ran for the attached list: ${e.enrolled} enrolled, ${e.skippedSuppressed} suppressed, ${e.skippedDuplicate} already enrolled, ${e.skippedIneligible} ineligible.`,
      );
    } else {
      setNotice("Settings saved.");
    }
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card mt-6 p-6">
      <h2 className="font-display text-lg font-semibold">Settings</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cs-name">Campaign name</label>
          <input id="cs-name" className="input" value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="cs-list">Lead list</label>
          <select id="cs-list" className="input" value={leadListId} disabled={!editable} onChange={(e) => setLeadListId(e.target.value)}>
            <option value="">Not attached</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>{list.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">Changing the list enrolls its eligible leads immediately.</p>
        </div>
        <div>
          <label className="label" htmlFor="cs-tz">Timezone</label>
          <select id="cs-tz" className="input" value={timezone} disabled={!editable} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="cs-start">Window start</label>
            <input id="cs-start" className="input" type="time" value={windowStart} disabled={!editable} onChange={(e) => setWindowStart(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="cs-end">Window end</label>
            <input id="cs-end" className="input" type="time" value={windowEnd} disabled={!editable} onChange={(e) => setWindowEnd(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={businessDaysOnly} disabled={!editable} onChange={(e) => setBusinessDaysOnly(e.target.checked)} />
          Business days only (skip weekends in the campaign timezone)
        </label>
      </div>

      <h3 className="mt-6 text-sm font-semibold">Sending accounts</h3>
      <p className="mt-1 text-xs text-muted">
        The worker rotates across attached accounts in this order, respecting each account's
        effective daily limit. DEMO accounts never send real email.
      </p>
      {accounts.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No sending accounts exist in this workspace yet. Create one on the Sending Accounts page.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {accounts.map((account) => (
            <label key={account.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={accountIds.includes(account.id)}
                disabled={!editable}
                onChange={(e) => toggleAccount(account.id, e.target.checked)}
              />
              <span className="font-medium">{account.email}</span>
              <span className="text-muted">
                {account.provider}
                {account.provider === "SIMULATION" ? " (DEMO)" : ""} · {account.status}
              </span>
            </label>
          ))}
        </div>
      )}
      {notice ? <p className="mt-4 text-sm text-muted">{notice}</p> : null}
      {editable ? (
        <div className="mt-5">
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving..." : "Save settings"}</button>
        </div>
      ) : null}
    </form>
  );
}
