"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, PhoneCall, Volume2 } from "lucide-react";
import { CALL_DISPOSITIONS, dispositionLabel } from "@/lib/calling/dispositions";
import { renderScriptTemplate } from "@/lib/calling/renderScript";
import { US_TIMEZONES, callWindowStatus, formatHour } from "@/lib/calling/callWindow";
import {
  NAME_SPEECH_RATE,
  greetingNameForFields,
  greetingUtteranceText,
  pickEnUsVoice,
  spokenNameForFields,
} from "@/lib/calling/pronunciation";

export interface CallingLead {
  id: string;
  email: string;
  listId: string | null;
  fields: Record<string, unknown>;
  phone: string;
  lastCall: { disposition: string; calledAt: string } | null;
}

export interface CallingScript {
  id: string;
  name: string;
  body: string;
  objectionNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CallingLeadRef {
  email: string;
  fields: unknown;
}

export interface CallingHistoryEntry {
  id: string;
  leadId: string | null;
  scriptId: string | null;
  disposition: string;
  notes: string | null;
  durationSeconds: number | null;
  followUpAt: string | null;
  calledAt: string;
  lead: CallingLeadRef | null;
}

export interface CallingCallback {
  logId: string;
  leadId: string | null;
  followUpAt: string;
  due: boolean;
  lead: CallingLeadRef | null;
}

export interface CallingStatsShape {
  callsToday: number;
  totalCalls: number;
  talked: number;
  interested: number;
  callbacksBooked: number;
}

export interface CallingInitialData {
  lists: { id: string; name: string }[];
  leads: CallingLead[];
  scripts: CallingScript[];
  stats: CallingStatsShape;
  callbacks: CallingCallback[];
  history: CallingHistoryEntry[];
}

function fieldText(fields: Record<string, unknown> | unknown, key: string): string {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "";
  const value = (fields as Record<string, unknown>)[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function fieldNumberText(fields: Record<string, unknown> | unknown, key: string): string {
  const text = fieldText(fields, key);
  if (!text) return "";
  const parsed = Number(text);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

/** City, State line for a lead, empty when neither is recorded. */
function leadLocation(fields: Record<string, unknown> | unknown): string {
  const city = fieldText(fields, "city");
  const state = fieldText(fields, "state");
  return [city, state].filter(Boolean).join(", ");
}

/** The lead's hook, falling back to its email icebreaker line. */
function leadHook(fields: Record<string, unknown> | unknown): string {
  return fieldText(fields, "hook") || fieldText(fields, "icebreaker");
}

const EMPTY_CALLING_DETAILS = {
  city: "",
  state: "",
  timezone: "",
  bestTimeNote: "",
  bestStartHour: "",
  bestEndHour: "",
  decisionMaker: "",
  namePronunciation: "",
  mobileScore: "",
  lcp: "",
  painPoints: "",
  hook: "",
  personalScript: "",
};

function callingDetailsFromFields(fields: Record<string, unknown> | unknown) {
  return {
    city: fieldText(fields, "city"),
    state: fieldText(fields, "state"),
    timezone: fieldText(fields, "timezone"),
    bestTimeNote: fieldText(fields, "bestTimeNote"),
    bestStartHour: fieldNumberText(fields, "bestStartHour"),
    bestEndHour: fieldNumberText(fields, "bestEndHour"),
    decisionMaker: fieldText(fields, "decisionMaker"),
    namePronunciation: fieldText(fields, "namePronunciation"),
    mobileScore: fieldText(fields, "mobileScore"),
    lcp: fieldText(fields, "lcp"),
    painPoints: fieldText(fields, "painPoints"),
    hook: leadHook(fields),
    personalScript: fieldText(fields, "personalScript"),
  };
}

function leadDisplayName(lead: { email: string; fields: unknown }): string {
  const first = fieldText(lead.fields, "firstName");
  const last = fieldText(lead.fields, "lastName");
  const name = `${first} ${last}`.trim();
  if (name) return name;
  const company = fieldText(lead.fields, "company");
  return company || lead.email;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

type Tab = "leads" | "scripts" | "tracking";

export function CallingWorkspace({ initial }: { initial: CallingInitialData }) {
  const [tab, setTab] = useState<Tab>("leads");
  const [lists, setLists] = useState(initial.lists);
  const [leads, setLeads] = useState<CallingLead[]>(initial.leads);
  const [scripts, setScripts] = useState<CallingScript[]>(initial.scripts);
  const [stats, setStats] = useState(initial.stats);
  const [callbacks, setCallbacks] = useState(initial.callbacks);
  const [history, setHistory] = useState(initial.history);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Call Leads state
  const [listFilter, setListFilter] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    initial.leads.find((lead) => lead.phone)?.id ?? null,
  );
  const [selectedScriptId, setSelectedScriptId] = useState<string>(initial.scripts[0]?.id ?? "");
  const [disposition, setDisposition] = useState<string>("TALKED");
  const [callNotes, setCallNotes] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [savingCall, setSavingCall] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    company: "",
    phone: "",
    website: "",
    email: "",
    listId: "",
    newListName: "",
    ...EMPTY_CALLING_DETAILS,
  });
  const [addingLead, setAddingLead] = useState(false);
  // Edit lead details (call panel) and which script the panel shows.
  const [showEditLead, setShowEditLead] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    company: "",
    phone: "",
    website: "",
    ...EMPTY_CALLING_DETAILS,
  });
  const [savingLead, setSavingLead] = useState(false);
  const [scriptView, setScriptView] = useState<"personal" | "workspace">("personal");
  // Ticking clock so the lead local times and call-now chips stay live.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  // Name pronunciation audio: the browser's built in speech
  // synthesis, free in Chrome. Null until the client check runs, so
  // nothing flashes during hydration; false hides the buttons and
  // shows a plain note instead.
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setSpeechSupported("speechSynthesis" in window);
  }, []);

  function speakText(text: string) {
    if (!text || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickEnUsVoice(synth.getVoices());
    if (voice) utterance.voice = voice;
    utterance.lang = "en-US";
    utterance.rate = NAME_SPEECH_RATE;
    synth.cancel();
    synth.speak(utterance);
  }

  // Scripts state
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [scriptForm, setScriptForm] = useState({ name: "", body: "", objectionNotes: "" });
  const [savingScript, setSavingScript] = useState(false);

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) ?? null,
    [leads, selectedLeadId],
  );

  // Opening a lead resets the panel: personal script first when the
  // lead has one, edit form closed and prefilled from the lead.
  useEffect(() => {
    setScriptView("personal");
    setShowEditLead(false);
    if (selectedLead) {
      setEditForm({
        name: leadDisplayName(selectedLead),
        company: fieldText(selectedLead.fields, "company"),
        phone: selectedLead.phone,
        website: fieldText(selectedLead.fields, "website"),
        ...callingDetailsFromFields(selectedLead.fields),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeadId]);
  const selectedScript = useMemo(
    () => scripts.find((script) => script.id === selectedScriptId) ?? null,
    [scripts, selectedScriptId],
  );
  const personalScript = selectedLead ? fieldText(selectedLead.fields, "personalScript") : "";
  const renderedScript = useMemo(() => {
    if (!selectedLead) return "";
    if (scriptView === "personal" && personalScript) {
      return renderScriptTemplate(personalScript, {
        fields: selectedLead.fields,
        email: selectedLead.email,
      });
    }
    if (!selectedScript) return "";
    return renderScriptTemplate(selectedScript.body, {
      fields: selectedLead.fields,
      email: selectedLead.email,
    });
  }, [selectedScript, selectedLead, scriptView, personalScript]);
  const renderedObjections = useMemo(() => {
    if (!selectedScript?.objectionNotes || !selectedLead) return "";
    return renderScriptTemplate(selectedScript.objectionNotes, {
      fields: selectedLead.fields,
      email: selectedLead.email,
    });
  }, [selectedScript, selectedLead]);

  async function refreshLeads(nextListFilter: string) {
    const query = nextListFilter ? `?listId=${encodeURIComponent(nextListFilter)}` : "";
    const response = await fetch(`/api/calling/leads${query}`);
    if (!response.ok) return;
    const data = (await response.json()) as { lists: typeof lists; leads: CallingLead[] };
    setLists(data.lists);
    setLeads(data.leads);
  }

  async function refreshTracking() {
    const response = await fetch("/api/calling/logs");
    if (!response.ok) return;
    const data = (await response.json()) as {
      stats: CallingStatsShape;
      callbacks: CallingCallback[];
      history: CallingHistoryEntry[];
    };
    setStats(data.stats);
    setCallbacks(data.callbacks);
    setHistory(data.history);
  }

  async function onListFilterChange(value: string) {
    setListFilter(value);
    setSelectedLeadId(null);
    await refreshLeads(value);
  }

  async function submitAddLead(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setAddingLead(true);
    try {
      const response = await fetch("/api/calling/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = (await response.json()) as { error?: string; lead?: { id: string } };
      if (!response.ok) {
        setError(data.error ?? "Could not add the lead");
        return;
      }
      setAddForm({
        name: "",
        company: "",
        phone: "",
        website: "",
        email: "",
        listId: "",
        newListName: "",
        ...EMPTY_CALLING_DETAILS,
      });
      await refreshLeads(listFilter);
      if (data.lead?.id) setSelectedLeadId(data.lead.id);
      setNotice("Call lead added.");
    } finally {
      setAddingLead(false);
    }
  }

  async function submitEditLead(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLead) return;
    setError("");
    setNotice("");
    setSavingLead(true);
    try {
      const response = await fetch(`/api/calling/leads/${selectedLead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not save the lead details");
        return;
      }
      await refreshLeads(listFilter);
      setShowEditLead(false);
      setNotice("Lead details saved.");
    } finally {
      setSavingLead(false);
    }
  }

  /** The enriched calling fields, shared by the add and edit forms. */
  function callingDetailsFields(
    form: typeof EMPTY_CALLING_DETAILS,
    patch: (values: Partial<typeof EMPTY_CALLING_DETAILS>) => void,
    prefix: string,
  ) {
    const set = (key: keyof typeof EMPTY_CALLING_DETAILS) => (value: string) =>
      patch({ [key]: value });
    return (
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${prefix}-city`}>City</label>
          <input id={`${prefix}-city`} className="input" value={form.city} onChange={(e) => set("city")(e.target.value)} placeholder="Daytona Beach" />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-state`}>State</label>
          <input id={`${prefix}-state`} className="input" value={form.state} onChange={(e) => set("state")(e.target.value)} placeholder="FL" />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-timezone`}>Timezone</label>
          <select id={`${prefix}-timezone`} className="input" value={form.timezone} onChange={(e) => set("timezone")(e.target.value)}>
            <option value="">Not set</option>
            {US_TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace("_", " ")}
              </option>
            ))}
            {form.timezone && !(US_TIMEZONES as readonly string[]).includes(form.timezone) ? (
              <option value={form.timezone}>{form.timezone.replace("_", " ")}</option>
            ) : null}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-decision`}>Decision maker</label>
          <input id={`${prefix}-decision`} className="input" value={form.decisionMaker} onChange={(e) => set("decisionMaker")(e.target.value)} placeholder="Anna Handy, owner" />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-pronunciation`}>Name pronunciation</label>
          <input id={`${prefix}-pronunciation`} className="input" value={form.namePronunciation} onChange={(e) => set("namePronunciation")(e.target.value)} placeholder="LEN-erd duh-ZEER" />
          <p className="mt-1 text-xs text-muted">
            How the decision maker's name sounds, in plain syllables. The call panel shows it
            next to the name, with a listen button that speaks the name aloud.
          </p>
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-start`}>Best window start (their time, 24h)</label>
          <input id={`${prefix}-start`} className="input" type="number" min="0" max="24" step="0.5" value={form.bestStartHour} onChange={(e) => set("bestStartHour")(e.target.value)} placeholder="9" />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-end`}>Best window end (their time, 24h)</label>
          <input id={`${prefix}-end`} className="input" type="number" min="0" max="24" step="0.5" value={form.bestEndHour} onChange={(e) => set("bestEndHour")(e.target.value)} placeholder="11" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${prefix}-bestnote`}>Best time note</label>
          <input id={`${prefix}-bestnote`} className="input" value={form.bestTimeNote} onChange={(e) => set("bestTimeNote")(e.target.value)} placeholder="Mon to Thu, 9 to 11am her time" />
          <p className="mt-1 text-xs text-muted">
            Leave the window empty to use the default best window, 9 to 11am their time.
          </p>
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-score`}>Mobile score</label>
          <input id={`${prefix}-score`} className="input" value={form.mobileScore} onChange={(e) => set("mobileScore")(e.target.value)} placeholder="24" />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-lcp`}>Load time (LCP)</label>
          <input id={`${prefix}-lcp`} className="input" value={form.lcp} onChange={(e) => set("lcp")(e.target.value)} placeholder="15.9s" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${prefix}-pain`}>Pain points</label>
          <textarea id={`${prefix}-pain`} className="input" rows={3} value={form.painPoints} onChange={(e) => set("painPoints")(e.target.value)} placeholder="Why this lead hurts, in plain words." />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${prefix}-hook`}>Hook (one line opener)</label>
          <textarea id={`${prefix}-hook`} className="input" rows={2} value={form.hook} onChange={(e) => set("hook")(e.target.value)} placeholder="The one personal line that opens the call." />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${prefix}-personal`}>Personalized script for this lead (optional)</label>
          <textarea id={`${prefix}-personal`} className="input" rows={8} value={form.personalScript} onChange={(e) => set("personalScript")(e.target.value)} placeholder="A script written for this lead alone. When set, the call panel shows this instead of the shared script." />
        </div>
      </div>
    );
  }

  async function saveCall() {
    if (!selectedLead) return;
    setError("");
    setNotice("");
    setSavingCall(true);
    try {
      const response = await fetch("/api/calling/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: selectedLead.id,
          scriptId: selectedScriptId || null,
          disposition,
          notes: callNotes,
          durationMinutes: durationMinutes === "" ? null : Number(durationMinutes),
          followUpAt: disposition === "CALLBACK" && followUpAt ? new Date(followUpAt).toISOString() : null,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not save the call");
        return;
      }
      setCallNotes("");
      setDurationMinutes("");
      setFollowUpAt("");
      setNotice(`Call logged as ${dispositionLabel(disposition)}.`);
      await Promise.all([refreshLeads(listFilter), refreshTracking()]);
    } finally {
      setSavingCall(false);
    }
  }

  function startNewScript() {
    setEditingScriptId(null);
    setScriptForm({ name: "", body: "", objectionNotes: "" });
  }

  function startEditScript(script: CallingScript) {
    setEditingScriptId(script.id);
    setScriptForm({ name: script.name, body: script.body, objectionNotes: script.objectionNotes ?? "" });
  }

  async function saveScript(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSavingScript(true);
    try {
      const response = await fetch(
        editingScriptId ? `/api/calling/scripts/${editingScriptId}` : "/api/calling/scripts",
        {
          method: editingScriptId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scriptForm),
        },
      );
      const data = (await response.json()) as { error?: string; script?: CallingScript };
      if (!response.ok || !data.script) {
        setError(data.error ?? "Could not save the script");
        return;
      }
      setScripts((current) => {
        const rest = current.filter((script) => script.id !== data.script!.id);
        return [...rest, data.script!].sort((a, b) => a.name.localeCompare(b.name));
      });
      setEditingScriptId(data.script.id);
      if (!selectedScriptId) setSelectedScriptId(data.script.id);
      setNotice("Script saved.");
    } finally {
      setSavingScript(false);
    }
  }

  async function deleteScript(script: CallingScript) {
    if (!window.confirm(`Delete the script "${script.name}"? Call history is kept.`)) return;
    const response = await fetch(`/api/calling/scripts/${script.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Could not delete the script");
      return;
    }
    setScripts((current) => current.filter((item) => item.id !== script.id));
    if (editingScriptId === script.id) startNewScript();
    if (selectedScriptId === script.id) setSelectedScriptId("");
    setNotice("Script deleted.");
  }

  async function insertSampleScript() {
    setError("");
    setNotice("");
    const response = await fetch("/api/calling/scripts/sample", { method: "POST" });
    const data = (await response.json()) as { error?: string; script?: CallingScript; created?: boolean };
    if (!response.ok || !data.script) {
      setError(data.error ?? "Could not insert the sample script");
      return;
    }
    setScripts((current) => {
      const rest = current.filter((script) => script.id !== data.script!.id);
      return [...rest, data.script!].sort((a, b) => a.name.localeCompare(b.name));
    });
    setSelectedScriptId(data.script.id);
    startEditScript(data.script);
    setNotice(data.created ? "Sample script added." : "The sample script is already in your list.");
  }

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      key={value}
      onClick={() => setTab(value)}
      className={tab === value ? "btn-primary" : "btn-secondary"}
      aria-pressed={tab === value}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-2">
        {tabButton("leads", "Call Leads")}
        {tabButton("scripts", "Scripts")}
        {tabButton("tracking", "Tracking")}
      </div>
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="mt-4 text-sm text-emerald-600">{notice}</p> : null}

      {tab === "leads" ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <div className="card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-display text-base font-semibold">Leads with a phone come first</h2>
                <select
                  className="input ml-auto w-auto"
                  value={listFilter}
                  onChange={(event) => void onListFilterChange(event.target.value)}
                  aria-label="Filter by list"
                >
                  <option value="">All lists</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </div>
              <ul className="mt-4 divide-y divide-line">
                {leads.length === 0 ? (
                  <li className="py-4 text-sm text-muted">
                    No leads yet. Add a call lead below, or add phone numbers to existing leads
                    (a phone field) and they will appear here.
                  </li>
                ) : (
                  leads.map((lead) => {
                    const status = callWindowStatus(lead.fields, now);
                    return (
                      <li key={lead.id}>
                        <button
                          type="button"
                          className={`w-full px-2 py-3 text-left ${lead.id === selectedLeadId ? "bg-elevated" : ""}`}
                          onClick={() => setSelectedLeadId(lead.id)}
                        >
                          <span className="block text-sm font-medium">{leadDisplayName(lead)}</span>
                          <span className="block text-xs text-muted">
                            {lead.phone || "No phone"} · {fieldText(lead.fields, "company") || lead.email}
                            {leadLocation(lead.fields) ? ` · ${leadLocation(lead.fields)}` : ""}
                            {lead.lastCall
                              ? ` · Last call: ${dispositionLabel(lead.lastCall.disposition)}`
                              : " · Not called yet"}
                          </span>
                          {status.state !== "unknown" ? (
                            <span
                              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                                status.state === "good"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-surface text-muted"
                              }`}
                            >
                              {status.state === "good"
                                ? `Good time to call, their time ${status.localTimeLabel}`
                                : `Their time ${status.localTimeLabel}, best ${formatHour(status.window!.startHour)} to ${formatHour(status.window!.endHour)}`}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>

            <form onSubmit={submitAddLead} className="card mt-6 p-5">
              <h2 className="font-display text-base font-semibold">Add a call lead</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="call-name">Name</label>
                  <input id="call-name" className="input" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Jane Smith" />
                </div>
                <div>
                  <label className="label" htmlFor="call-company">Company</label>
                  <input id="call-company" className="input" value={addForm.company} onChange={(e) => setAddForm({ ...addForm, company: e.target.value })} placeholder="Acme Inc" />
                </div>
                <div>
                  <label className="label" htmlFor="call-phone">Phone</label>
                  <input id="call-phone" className="input" required value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} placeholder="+1 555 010 2030" />
                </div>
                <div>
                  <label className="label" htmlFor="call-website">Website</label>
                  <input id="call-website" className="input" value={addForm.website} onChange={(e) => setAddForm({ ...addForm, website: e.target.value })} placeholder="https://example.com" />
                </div>
                <div>
                  <label className="label" htmlFor="call-email">Email (optional)</label>
                  <input id="call-email" className="input" type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="jane@company.com" />
                </div>
                <div>
                  <label className="label" htmlFor="call-list">List</label>
                  <select id="call-list" className="input" value={addForm.listId} onChange={(e) => setAddForm({ ...addForm, listId: e.target.value })}>
                    <option value="">New list (name below, or Calling leads)</option>
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </div>
                {!addForm.listId ? (
                  <div>
                    <label className="label" htmlFor="call-new-list">New list name (optional)</label>
                    <input id="call-new-list" className="input" value={addForm.newListName} onChange={(e) => setAddForm({ ...addForm, newListName: e.target.value })} placeholder="Calling leads" />
                  </div>
                ) : null}
              </div>
              <h3 className="mt-5 text-sm font-semibold">Calling details (optional)</h3>
              {callingDetailsFields(addForm, (values) => setAddForm({ ...addForm, ...values }), "add")}
              <button type="submit" className="btn-primary mt-4" disabled={addingLead}>
                {addingLead ? "Adding..." : "Add call lead"}
              </button>
              <p className="mt-3 text-xs text-muted">
                Bulk instead? The CSV import in Leads accepts these columns and stores them on
                the lead: phone, city, state, timezone, bestTimeNote, decisionMaker,
                namePronunciation (or a column named Pronunciation), painPoints,
                mobileScore, lcp and personalScript. A column named hook imports as the lead's
                icebreaker, and Calling uses it as the hook when no hook field is set.
              </p>
            </form>
          </div>

          <div className="card h-fit p-5">
            <h2 className="font-display text-base font-semibold">Call panel</h2>
            {!selectedLead ? (
              <p className="mt-3 text-sm text-muted">Pick a lead on the left to open its call panel.</p>
            ) : (
              <div className="mt-4">
                <p className="text-sm font-medium">{leadDisplayName(selectedLead)}</p>
                <p className="text-xs text-muted">
                  {fieldText(selectedLead.fields, "company")}
                  {fieldText(selectedLead.fields, "website")
                    ? ` · ${fieldText(selectedLead.fields, "website")}`
                    : ""}
                  {` · ${selectedLead.email}`}
                </p>
                {(() => {
                  const pronunciation = fieldText(selectedLead.fields, "namePronunciation");
                  const spokenName = spokenNameForFields(selectedLead.fields);
                  const greeting =
                    greetingUtteranceText(greetingNameForFields(selectedLead.fields)) ||
                    (spokenName ? greetingUtteranceText(spokenName.split(" ")[0]) : "");
                  if (!pronunciation && !spokenName) return null;
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      {pronunciation ? (
                        <span className="text-muted">
                          Say the name: <span className="font-medium">{pronunciation}</span>
                        </span>
                      ) : null}
                      {speechSupported ? (
                        <>
                          {spokenName ? (
                            <button
                              type="button"
                              className="btn-ghost text-xs"
                              onClick={() => speakText(spokenName)}
                            >
                              <Volume2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                              Listen
                            </button>
                          ) : null}
                          {greeting ? (
                            <button
                              type="button"
                              className="btn-ghost text-xs"
                              onClick={() => speakText(greeting)}
                            >
                              <Volume2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                              Hear the greeting
                            </button>
                          ) : null}
                        </>
                      ) : speechSupported === false ? (
                        <span className="text-xs text-muted">
                          Name audio needs a browser with speech built in, like Chrome.
                        </span>
                      ) : null}
                    </div>
                  );
                })()}
                {(() => {
                  const status = callWindowStatus(selectedLead.fields, now);
                  const location = leadLocation(selectedLead.fields);
                  const decisionMaker = fieldText(selectedLead.fields, "decisionMaker");
                  const bestTimeNote = fieldText(selectedLead.fields, "bestTimeNote");
                  if (!location && status.state === "unknown" && !decisionMaker && !bestTimeNote) {
                    return null;
                  }
                  return (
                    <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm">
                      {location ? <p>{location}</p> : null}
                      {decisionMaker ? (
                        <p className="text-muted">
                          Ask for: {decisionMaker}
                          {fieldText(selectedLead.fields, "namePronunciation")
                            ? ` (say: ${fieldText(selectedLead.fields, "namePronunciation")})`
                            : ""}
                        </p>
                      ) : null}
                      {status.state !== "unknown" ? (
                        <p className="mt-1">
                          Their time now: {status.localTimeLabel}.{" "}
                          {status.state === "good" ? (
                            <span className="font-semibold text-emerald-600">
                              Good time to call, inside the best window (
                              {formatHour(status.window!.startHour)} to{" "}
                              {formatHour(status.window!.endHour)}).
                            </span>
                          ) : (
                            <span className="text-muted">
                              Best window {formatHour(status.window!.startHour)} to{" "}
                              {formatHour(status.window!.endHour)} their time.
                            </span>
                          )}
                        </p>
                      ) : null}
                      {bestTimeNote ? <p className="mt-1 text-muted">{bestTimeNote}</p> : null}
                    </div>
                  );
                })()}
                {leadHook(selectedLead.fields) ? (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
                    <p className="text-xs font-semibold uppercase tracking-wide">Hook</p>
                    <p className="mt-1">{leadHook(selectedLead.fields)}</p>
                  </div>
                ) : null}
                {fieldText(selectedLead.fields, "painPoints") ? (
                  <div className="mt-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Pain points
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">
                      {fieldText(selectedLead.fields, "painPoints")}
                    </p>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedLead.phone ? (
                    <a className="btn-primary" href={`tel:${selectedLead.phone.replace(/[^+\d]/g, "")}`}>
                      <PhoneCall className="mr-2 h-4 w-4" aria-hidden="true" />
                      Call {selectedLead.phone}
                    </a>
                  ) : (
                    <span className="text-sm text-muted">This lead has no phone number yet.</span>
                  )}
                  <a className="btn-secondary" href="https://app.krispcall.com" target="_blank" rel="noreferrer">
                    Open KrispCall
                    <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
                  </a>
                </div>

                {personalScript ? (
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">Script</span>
                    <button
                      type="button"
                      className={scriptView === "personal" ? "btn-primary" : "btn-secondary"}
                      aria-pressed={scriptView === "personal"}
                      onClick={() => setScriptView("personal")}
                    >
                      Personalized for this lead
                    </button>
                    <button
                      type="button"
                      className={scriptView === "workspace" ? "btn-primary" : "btn-secondary"}
                      aria-pressed={scriptView === "workspace"}
                      onClick={() => setScriptView("workspace")}
                    >
                      Shared script
                    </button>
                  </div>
                ) : null}
                {scriptView === "personal" && personalScript ? (
                  <div className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-4 text-sm leading-6">
                    {renderedScript}
                  </div>
                ) : (
                  <>
                    <label className="label mt-5" htmlFor="call-script-select">Script</label>
                    <select
                      id="call-script-select"
                      className="input"
                      value={selectedScriptId}
                      onChange={(event) => setSelectedScriptId(event.target.value)}
                    >
                      <option value="">No script</option>
                      {scripts.map((script) => (
                        <option key={script.id} value={script.id}>
                          {script.name}
                        </option>
                      ))}
                    </select>
                    {selectedScript ? (
                      <>
                        <div className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-4 text-sm leading-6">
                          {renderedScript}
                        </div>
                        {renderedObjections ? (
                          <>
                            <h3 className="mt-4 text-sm font-semibold">Objection replies</h3>
                            <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-4 text-sm leading-6">
                              {renderedObjections}
                            </div>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-muted">
                        No script selected. Create one in the Scripts tab, or insert the WordPress
                        speed sample there.
                      </p>
                    )}
                  </>
                )}
                {scriptView === "personal" && personalScript && renderedObjections ? (
                  <>
                    <h3 className="mt-4 text-sm font-semibold">Objection replies (shared script)</h3>
                    <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-4 text-sm leading-6">
                      {renderedObjections}
                    </div>
                  </>
                ) : null}

                <div className="mt-5">
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-expanded={showEditLead}
                    onClick={() => setShowEditLead((value) => !value)}
                  >
                    {showEditLead ? "Close lead details" : "Edit lead details"}
                  </button>
                  {showEditLead ? (
                    <form onSubmit={submitEditLead} className="mt-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label" htmlFor="edit-name">Name</label>
                          <input id="edit-name" className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                        </div>
                        <div>
                          <label className="label" htmlFor="edit-company">Company</label>
                          <input id="edit-company" className="input" value={editForm.company} onChange={(e) => setEditForm({ ...editForm, company: e.target.value })} />
                        </div>
                        <div>
                          <label className="label" htmlFor="edit-phone">Phone</label>
                          <input id="edit-phone" className="input" required value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                        </div>
                        <div>
                          <label className="label" htmlFor="edit-website">Website</label>
                          <input id="edit-website" className="input" value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} />
                        </div>
                      </div>
                      {callingDetailsFields(editForm, (values) => setEditForm({ ...editForm, ...values }), "edit")}
                      <button type="submit" className="btn-primary mt-4" disabled={savingLead}>
                        {savingLead ? "Saving..." : "Save lead details"}
                      </button>
                    </form>
                  ) : null}
                </div>

                <h3 className="mt-5 text-sm font-semibold">Log this call</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CALL_DISPOSITIONS.map((item) => (
                    <button
                      type="button"
                      key={item.value}
                      onClick={() => setDisposition(item.value)}
                      className={disposition === item.value ? "btn-primary" : "btn-secondary"}
                      aria-pressed={disposition === item.value}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="call-duration">Duration (minutes, optional)</label>
                    <input id="call-duration" className="input" type="number" min="0" step="0.5" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} placeholder="3" />
                  </div>
                  {disposition === "CALLBACK" ? (
                    <div>
                      <label className="label" htmlFor="call-followup">Follow up at</label>
                      <input id="call-followup" className="input" type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
                    </div>
                  ) : null}
                </div>
                <label className="label mt-4" htmlFor="call-notes">Notes</label>
                <textarea id="call-notes" className="input" rows={3} value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="What they said, what to send, anything to remember." />
                <button type="button" className="btn-primary mt-4" onClick={() => void saveCall()} disabled={savingCall}>
                  {savingCall ? "Saving..." : "Save call"}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "scripts" ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="card h-fit p-5">
            <h2 className="font-display text-base font-semibold">Your scripts</h2>
            <ul className="mt-4 divide-y divide-line">
              {scripts.length === 0 ? (
                <li className="py-3 text-sm text-muted">No scripts yet. Write one, or insert the sample.</li>
              ) : (
                scripts.map((script) => (
                  <li key={script.id} className="flex items-center gap-2 py-3">
                    <button type="button" className="text-left text-sm font-medium" onClick={() => startEditScript(script)}>
                      {script.name}
                    </button>
                    <button type="button" className="btn-ghost ml-auto text-red-600" onClick={() => void deleteScript(script)}>
                      Delete
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={startNewScript}>
                New script
              </button>
              <button type="button" className="btn-secondary" onClick={() => void insertSampleScript()}>
                Insert WordPress speed sample script
              </button>
            </div>
            <p className="mt-3 text-xs text-muted">
              Placeholders you can use in a script: {"{{firstName}}"}, {"{{lastName}}"},{" "}
              {"{{company}}"}, {"{{phone}}"}, {"{{website}}"}, {"{{mobileScore}}"}, {"{{lcp}}"},{" "}
              {"{{email}}"}, {"{{city}}"}, {"{{state}}"}, {"{{painPoints}}"}, {"{{hook}}"},{" "}
              {"{{decisionMaker}}"}. They fill from the lead when you open the call panel.
            </p>
          </div>
          <form onSubmit={saveScript} className="card h-fit p-5">
            <h2 className="font-display text-base font-semibold">
              {editingScriptId ? "Edit script" : "New script"}
            </h2>
            <label className="label mt-4" htmlFor="script-name">Name</label>
            <input id="script-name" className="input" required value={scriptForm.name} onChange={(e) => setScriptForm({ ...scriptForm, name: e.target.value })} placeholder="WordPress Speed, owner call" />
            <label className="label mt-4" htmlFor="script-body">Script</label>
            <textarea id="script-body" className="input" rows={14} required value={scriptForm.body} onChange={(e) => setScriptForm({ ...scriptForm, body: e.target.value })} placeholder="What you say, word for word." />
            <label className="label mt-4" htmlFor="script-objections">Objection replies (optional)</label>
            <textarea id="script-objections" className="input" rows={8} value={scriptForm.objectionNotes} onChange={(e) => setScriptForm({ ...scriptForm, objectionNotes: e.target.value })} placeholder="Short replies to the pushbacks you hear most." />
            <button type="submit" className="btn-primary mt-4" disabled={savingScript}>
              {savingScript ? "Saving..." : "Save script"}
            </button>
          </form>
        </div>
      ) : null}

      {tab === "tracking" ? (
        <div className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "Calls today", value: stats.callsToday },
              { label: "Total calls", value: stats.totalCalls },
              { label: "Talked", value: stats.talked },
              { label: "Interested", value: stats.interested },
              { label: "Callbacks booked", value: stats.callbacksBooked },
            ].map((card) => (
              <div key={card.label} className="card p-4">
                <p className="text-xs uppercase tracking-wide text-muted">{card.label}</p>
                <p className="mt-1 font-display text-2xl font-semibold">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="card mt-6 p-5">
            <h2 className="font-display text-base font-semibold">Callbacks due</h2>
            {callbacks.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No callbacks booked yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {callbacks.map((callback) => (
                  <li key={callback.logId} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                    <span className="font-medium">
                      {callback.lead ? leadDisplayName(callback.lead) : "Deleted lead"}
                    </span>
                    <span className="text-muted">{formatWhen(callback.followUpAt)}</span>
                    {callback.due ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        Due now
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card mt-6 p-5">
            <h2 className="font-display text-base font-semibold">Recent calls</h2>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No calls logged yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                      <th className="py-2 pr-3">Lead</th>
                      <th className="py-2 pr-3">Outcome</th>
                      <th className="py-2 pr-3">Notes</th>
                      <th className="py-2 pr-3">Duration</th>
                      <th className="py-2">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id} className="border-b border-line align-top">
                        <td className="py-2 pr-3 font-medium">
                          {entry.lead ? leadDisplayName(entry.lead) : "Deleted lead"}
                        </td>
                        <td className="py-2 pr-3">{dispositionLabel(entry.disposition)}</td>
                        <td className="max-w-xs py-2 pr-3 text-muted">{entry.notes ?? ""}</td>
                        <td className="py-2 pr-3">
                          {entry.durationSeconds ? `${Math.round(entry.durationSeconds / 60)} min` : ""}
                        </td>
                        <td className="py-2">{formatWhen(entry.calledAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
