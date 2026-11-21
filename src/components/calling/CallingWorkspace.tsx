"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Maximize2, PhoneCall, Volume2 } from "lucide-react";
import { CallMode, type CallSavePayload } from "./CallMode";
import type { CallingService } from "@/lib/calling/services";
import type { ScoreBlock } from "@/lib/calling/services";
import { scoreBreakdownFromFields } from "@/lib/calling/callLeadFields";
import { stateStatus } from "@/lib/calling/statePriority";
import type { EvidenceEntry } from "@/lib/calling/callLeadFields";

export type CallingServiceShape = CallingService;
import { CALL_DISPOSITIONS, dispositionLabel } from "@/lib/calling/dispositions";
import {
  CALL_FLOW_START_ID,
  flowRoadmap,
  getFlowNode,
  resolveFlowNode,
} from "@/lib/calling/callFlow";
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
  listId: string | null;
  serviceSlug: string;
  temperature: string;
  leadScore: number | null;
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  state: string;
  fields: Record<string, unknown>;
  verifyStatus: string;
  verifyNote: string | null;
  verifiedAt: string | null;
  lastCallAt: string | null;
  evidence: EvidenceEntry[];
  signals: string[];
  dontSay: string[];
  offerLine: string;
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
  disposition: string;
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
  lists: { id: string; name: string; serviceSlug: string | null }[];
  leads: CallingLead[];
  services: CallingServiceShape[];
  cadenceRules: string[];
  scoreBlocks: ScoreBlock[];
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
  signals: "",
  dontSay: "",
  offerLine: "",
  scoreFit: "",
  scoreSignal: "",
  scoreRecency: "",
  scoreReachability: "",
};

function stringListText(fields: Record<string, unknown> | unknown, key: string): string {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "";
  const value = (fields as Record<string, unknown>)[key];
  if (Array.isArray(value)) return value.map((item) => String(item)).join("\n");
  return typeof value === "string" ? value : "";
}

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
    signals: stringListText(fields, "signals"),
    dontSay: stringListText(fields, "dontSay"),
    offerLine: fieldText(fields, "offerLine"),
    scoreFit: fieldNumberText(fields, "scoreFit"),
    scoreSignal: fieldNumberText(fields, "scoreSignal"),
    scoreRecency: fieldNumberText(fields, "scoreRecency"),
    scoreReachability: fieldNumberText(fields, "scoreReachability"),
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

function callLeadDisplayName(lead: CallingLead): string {
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  return name || lead.company || lead.phone;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

type Tab = "leads" | "scripts" | "services" | "tracking";

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
  const [serviceFilter, setServiceFilter] = useState("");
  const [temperatureFilter, setTemperatureFilter] = useState("");
  const [callModeOpen, setCallModeOpen] = useState(false);
  const [importCsv, setImportCsv] = useState("");
  const [importing, setImporting] = useState(false);
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
    serviceSlug: "wordpress-speed",
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
    serviceSlug: "wordpress-speed",
    ...EMPTY_CALLING_DETAILS,
  });
  const [savingLead, setSavingLead] = useState(false);
  const [scriptView, setScriptView] = useState<"personal" | "workspace">("personal");
  // Guided call mode: the branching flow from lib/calling/callFlow,
  // shown one card at a time. flowPath is the trail of visited node
  // ids for the selected lead; the last entry is the current card.
  const [panelMode, setPanelMode] = useState<"guided" | "script">("guided");
  const [flowPath, setFlowPath] = useState<string[]>([CALL_FLOW_START_ID]);
  const [showRoadmap, setShowRoadmap] = useState(false);
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
    setFlowPath([CALL_FLOW_START_ID]);
    setShowRoadmap(false);
    if (selectedLead) {
      setEditForm({
        name: callLeadDisplayName(selectedLead),
        company: selectedLead.company,
        phone: selectedLead.phone,
        website: selectedLead.website,
        serviceSlug: selectedLead.serviceSlug,
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

  // Guided flow: the current card, resolved for the selected lead
  // (speed or generic variant, placeholders filled).
  const currentFlowNode =
    getFlowNode(flowPath[flowPath.length - 1] ?? CALL_FLOW_START_ID) ??
    getFlowNode(CALL_FLOW_START_ID) ??
    null;
  const resolvedFlow = useMemo(() => {
    if (!currentFlowNode) return null;
    return resolveFlowNode(currentFlowNode, {
      fields: selectedLead?.fields ?? null,
      email: selectedLead?.email ?? null,
    });
  }, [currentFlowNode, selectedLead]);
  const guidedFollowUp = Boolean(
    panelMode === "guided" && currentFlowNode?.terminal && currentFlowNode.followUp,
  );

  // Landing on a terminal card preselects its suggested outcome in
  // the log form. The caller can still override it before saving.
  useEffect(() => {
    if (panelMode === "guided" && currentFlowNode?.terminal && currentFlowNode.suggestedDisposition) {
      setDisposition(currentFlowNode.suggestedDisposition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowPath, panelMode]);

  function goFlow(next: string) {
    setFlowPath((path) => [...path, next]);
  }

  function flowBack() {
    setFlowPath((path) => (path.length > 1 ? path.slice(0, -1) : path));
  }

  function flowRestart() {
    setFlowPath([CALL_FLOW_START_ID]);
  }

  async function refreshLeads(
    filters: { listId: string; serviceSlug: string; temperature: string } = {
      listId: listFilter,
      serviceSlug: serviceFilter,
      temperature: temperatureFilter,
    },
  ) {
    const params = new URLSearchParams();
    if (filters.listId) params.set("listId", filters.listId);
    if (filters.serviceSlug) params.set("serviceSlug", filters.serviceSlug);
    if (filters.temperature) params.set("temperature", filters.temperature);
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await fetch(`/api/calling/call-leads${query}`);
    if (!response.ok) return;
    const data = (await response.json()) as { lists: typeof lists; leads: CallingLead[] };
    setLists(data.lists);
    setLeads(data.leads);
  }

  async function refreshLists() {
    const response = await fetch("/api/calling/call-lists");
    if (!response.ok) return;
    const data = (await response.json()) as { lists: typeof lists };
    setLists(data.lists);
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
    await refreshLeads({ listId: value, serviceSlug: serviceFilter, temperature: temperatureFilter });
  }

  async function onServiceFilterChange(value: string) {
    setServiceFilter(value);
    setSelectedLeadId(null);
    await refreshLeads({ listId: listFilter, serviceSlug: value, temperature: temperatureFilter });
  }

  async function onTemperatureFilterChange(value: string) {
    setTemperatureFilter(value);
    setSelectedLeadId(null);
    await refreshLeads({ listId: listFilter, serviceSlug: serviceFilter, temperature: value });
  }

  async function submitAddLead(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setAddingLead(true);
    try {
      const response = await fetch("/api/calling/call-leads", {
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
        serviceSlug: "wordpress-speed",
        ...EMPTY_CALLING_DETAILS,
      });
      await refreshLeads();
      if (data.lead?.id) setSelectedLeadId(data.lead.id);
      setNotice("Call lead added.");
    } finally {
      setAddingLead(false);
    }
  }

  async function submitImportCsv() {
    setError("");
    setNotice("");
    setImporting(true);
    try {
      const response = await fetch("/api/calling/call-leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: importCsv,
          listId: addForm.listId || undefined,
          newListName: addForm.newListName || undefined,
          serviceSlug: addForm.serviceSlug,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        created?: number;
        skipped?: { row: number; reason: string }[];
      };
      if (!response.ok) {
        setError(data.error ?? "Could not import the CSV");
        return;
      }
      setImportCsv("");
      await Promise.all([refreshLeads(), refreshLists()]);
      setNotice(
        `Imported ${data.created ?? 0} call leads.${data.skipped?.length ? ` Skipped ${data.skipped.length}: ${data.skipped.map((item) => `row ${item.row} (${item.reason})`).join(", ")}.` : ""}`,
      );
    } finally {
      setImporting(false);
    }
  }

  async function submitEditLead(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLead) return;
    setError("");
    setNotice("");
    setSavingLead(true);
    try {
      const response = await fetch(`/api/calling/call-leads/${selectedLead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editForm, evidence: selectedLead.evidence }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not save the lead details");
        return;
      }
      await refreshLeads();
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
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${prefix}-signals`}>Signals, why now (one per line)</label>
          <textarea id={`${prefix}-signals`} className="input" rows={2} value={form.signals} onChange={(e) => set("signals")(e.target.value)} placeholder="The dated, verified triggers that make this lead hot or warm." />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${prefix}-offer`}>Offer line for this lead</label>
          <input id={`${prefix}-offer`} className="input" value={form.offerLine} onChange={(e) => set("offerLine")(e.target.value)} placeholder="The exact offer sentence for this lead's service." />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${prefix}-dontsay`}>Do not say (one per line)</label>
          <textarea id={`${prefix}-dontsay`} className="input" rows={2} value={form.dontSay} onChange={(e) => set("dontSay")(e.target.value)} placeholder="Claims and phrases that must never be said to this lead." />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-scorefit`}>Score: Fit (of 25)</label>
          <input id={`${prefix}-scorefit`} className="input" type="number" min="0" max="25" value={form.scoreFit} onChange={(e) => set("scoreFit")(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-scoresignal`}>Score: Signal (of 40)</label>
          <input id={`${prefix}-scoresignal`} className="input" type="number" min="0" max="40" value={form.scoreSignal} onChange={(e) => set("scoreSignal")(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-scorerecency`}>Score: Recency (of 15)</label>
          <input id={`${prefix}-scorerecency`} className="input" type="number" min="0" max="15" value={form.scoreRecency} onChange={(e) => set("scoreRecency")(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-scorereach`}>Score: Reachability (of 20)</label>
          <input id={`${prefix}-scorereach`} className="input" type="number" min="0" max="20" value={form.scoreReachability} onChange={(e) => set("scoreReachability")(e.target.value)} />
          <p className="mt-1 text-xs text-muted">
            With all four scores set, the total and the HOT or WARM temperature are worked out
            from the rubric gates, and a lead under 40 is refused: park it instead.
          </p>
        </div>
      </div>
    );
  }

  async function postCallLogFor(
    leadId: string,
    payload: {
      disposition: string;
      notes: string;
      durationSeconds: number | null;
      followUpAt: string | null;
    },
  ): Promise<boolean> {
    setError("");
    const response = await fetch("/api/calling/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callLeadId: leadId,
        scriptId: selectedScriptId || null,
        disposition: payload.disposition,
        notes: payload.notes,
        durationSeconds: payload.durationSeconds,
        followUpAt: payload.followUpAt,
      }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not save the call");
      return false;
    }
    await Promise.all([refreshLeads(), refreshTracking()]);
    return true;
  }

  async function postCallLog(): Promise<boolean> {
    if (!selectedLead) return false;
    setNotice("");
    setSavingCall(true);
    try {
      const ok = await postCallLogFor(selectedLead.id, {
        disposition,
        notes: callNotes,
        durationSeconds:
          durationMinutes === "" ? null : Math.round(Number(durationMinutes) * 60),
        followUpAt:
          followUpAt && (disposition === "CALLBACK" || guidedFollowUp)
            ? new Date(followUpAt).toISOString()
            : null,
      });
      if (ok) {
        setCallNotes("");
        setDurationMinutes("");
        setFollowUpAt("");
      }
      return ok;
    } finally {
      setSavingCall(false);
    }
  }

  /** Full screen call mode: save through the same log path. */
  async function callModeSave(payload: CallSavePayload, mode: "next" | "exit"): Promise<boolean> {
    if (!selectedLead) return false;
    const ok = await postCallLogFor(selectedLead.id, payload);
    if (!ok) return false;
    setNotice(`Call logged as ${dispositionLabel(payload.disposition)}.`);
    if (mode === "next") {
      const index = leads.findIndex((lead) => lead.id === selectedLead.id);
      const next = leads.slice(index + 1).find((lead) => lead.phone) ?? null;
      if (next) {
        setSelectedLeadId(next.id);
      } else {
        setCallModeOpen(false);
        setNotice("Call logged. That was the last lead in this view.");
      }
    }
    return true;
  }

  async function callModeVerify(status: string, note: string): Promise<void> {
    if (!selectedLead) return;
    const response = await fetch(`/api/calling/call-leads/${selectedLead.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verifyStatus: status, verifyNote: note }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not save the verification");
      return;
    }
    await refreshLeads();
    setNotice(
      status === "VERIFIED"
        ? "Lead marked verified."
        : status === "FLAGGED"
          ? "Lead flagged. Do not trust the flagged claim until it is fixed."
          : "Verification reset.",
    );
  }

  async function deleteSelectedLead() {
    if (!selectedLead) return;
    if (
      !window.confirm(
        `Delete the call lead ${callLeadDisplayName(selectedLead)}? Its call history is kept.`,
      )
    ) {
      return;
    }
    const response = await fetch(`/api/calling/call-leads/${selectedLead.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Could not delete the call lead");
      return;
    }
    setSelectedLeadId(null);
    await refreshLeads();
    setNotice("Call lead deleted.");
  }

  const nextLeadAfterSelected = useMemo(() => {
    if (!selectedLead) return null;
    const index = leads.findIndex((lead) => lead.id === selectedLead.id);
    return leads.slice(index + 1).find((lead) => lead.phone) ?? null;
  }, [leads, selectedLead]);

  async function saveCall() {
    if (await postCallLog()) {
      setNotice(`Call logged as ${dispositionLabel(disposition)}.`);
    }
  }

  /** Guided flow finish: save this call, then open the next lead. */
  async function saveAndNextLead() {
    if (!selectedLead) return;
    const index = leads.findIndex((lead) => lead.id === selectedLead.id);
    const next = leads.slice(index + 1).find((lead) => lead.phone) ?? null;
    const saved = await postCallLog();
    if (!saved) return;
    if (next) {
      setSelectedLeadId(next.id);
      setNotice(
        `Call logged as ${dispositionLabel(disposition)}. Next lead: ${callLeadDisplayName(next)}.`,
      );
    } else {
      setNotice(
        `Call logged as ${dispositionLabel(disposition)}. That was the last lead with a phone in this list.`,
      );
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
        {tabButton("services", "Services")}
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
                <select
                  className="input w-auto"
                  value={serviceFilter}
                  onChange={(event) => void onServiceFilterChange(event.target.value)}
                  aria-label="Filter by service"
                >
                  <option value="">All services</option>
                  {initial.services.map((service) => (
                    <option key={service.slug} value={service.slug}>
                      {service.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input w-auto"
                  value={temperatureFilter}
                  onChange={(event) => void onTemperatureFilterChange(event.target.value)}
                  aria-label="Filter by temperature"
                >
                  <option value="">Hot and warm</option>
                  <option value="HOT">Hot only</option>
                  <option value="WARM">Warm only</option>
                </select>
              </div>
              <ul className="mt-4 divide-y divide-line">
                {leads.length === 0 ? (
                  <li className="py-4 text-sm text-muted">
                    No call leads in this view yet. Add one below, or import a CSV of call
                    leads. Call leads live in their own system here, separate from email leads.
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
                          <span className="block text-sm font-medium">{callLeadDisplayName(lead)}</span>
                          <span className="block text-xs text-muted">
                            {lead.phone || "No phone"} · {lead.company || lead.email}
                            {leadLocation(lead.fields) ? ` · ${leadLocation(lead.fields)}` : ""}
                            {lead.lastCall
                              ? ` · Last call: ${dispositionLabel(lead.lastCall.disposition)}`
                              : " · Not called yet"}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                                lead.temperature === "HOT"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {lead.temperature}
                              {lead.leadScore !== null ? ` · ${lead.leadScore}` : ""}
                            </span>
                            <span className="inline-block rounded-full bg-elevated px-2 py-0.5 text-xs font-semibold">
                              {initial.services.find((item) => item.slug === lead.serviceSlug)?.name ?? lead.serviceSlug}
                            </span>
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                                lead.verifyStatus === "VERIFIED"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : lead.verifyStatus === "FLAGGED"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-surface text-muted"
                              }`}
                            >
                              {lead.verifyStatus === "VERIFIED"
                                ? "Verified"
                                : lead.verifyStatus === "FLAGGED"
                                  ? "Flagged"
                                  : "Unverified"}
                            </span>
                            {lead.state ? (
                              <span className="inline-block rounded-full bg-surface px-2 py-0.5 text-xs font-semibold">
                                State: {lead.state}
                              </span>
                            ) : null}
                            {stateStatus(lead.state) === "HELD" || stateStatus(lead.state) === "BLOCKED" ? (
                              <span className="inline-block rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                                HELD, do not call
                              </span>
                            ) : null}
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
              <div className="mt-4">
                <label className="label" htmlFor="call-service">Service this lead is for</label>
                <select id="call-service" className="input" value={addForm.serviceSlug} onChange={(e) => setAddForm({ ...addForm, serviceSlug: e.target.value })}>
                  {initial.services.map((service) => (
                    <option key={service.slug} value={service.slug}>
                      {service.priority}. {service.name}
                    </option>
                  ))}
                </select>
              </div>
              <h3 className="mt-5 text-sm font-semibold">Calling details (optional)</h3>
              {callingDetailsFields(addForm, (values) => setAddForm({ ...addForm, ...values }), "add")}
              <button type="submit" className="btn-primary mt-4" disabled={addingLead}>
                {addingLead ? "Adding..." : "Add call lead"}
              </button>
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">Import call leads from CSV</h3>
                <p className="mt-1 text-xs text-muted">
                  Paste CSV with a header row. Recognised columns include name, company, phone,
                  website, email, city, state, timezone, bestTimeNote, decisionMaker,
                  namePronunciation (or Pronunciation), painPoints, mobileScore, lcp,
                  personalScript, signals, hook and the four score columns. Rows go into the
                  selected list and service above, as CallLeads in this dedicated system only.
                </p>
                <textarea
                  className="input mt-2"
                  rows={4}
                  value={importCsv}
                  onChange={(event) => setImportCsv(event.target.value)}
                  placeholder="name,company,phone,city,state,timezone,hook"
                  aria-label="Call leads CSV"
                />
                <button
                  type="button"
                  className="btn-secondary mt-2"
                  disabled={importing || !importCsv.trim()}
                  onClick={() => void submitImportCsv()}
                >
                  {importing ? "Importing..." : "Import CSV"}
                </button>
              </div>
            </form>
          </div>

          <div className="card h-fit p-5">
            <h2 className="font-display text-base font-semibold">Call panel</h2>
            {!selectedLead ? (
              <p className="mt-3 text-sm text-muted">Pick a lead on the left to open its call panel.</p>
            ) : (
              <div className="mt-4">
                <p className="text-sm font-medium">{callLeadDisplayName(selectedLead)}</p>
                <p className="text-xs text-muted">
                  {selectedLead.company}
                  {selectedLead.website ? ` · ${selectedLead.website}` : ""}
                  {selectedLead.email ? ` · ${selectedLead.email}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                      selectedLead.temperature === "HOT"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {selectedLead.temperature}
                    {selectedLead.leadScore !== null ? ` · score ${selectedLead.leadScore}/100` : ""}
                  </span>
                  <span className="inline-block rounded-full bg-elevated px-2 py-0.5 text-xs font-semibold">
                    {initial.services.find((item) => item.slug === selectedLead.serviceSlug)?.name ?? selectedLead.serviceSlug}
                  </span>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                      selectedLead.verifyStatus === "VERIFIED"
                        ? "bg-emerald-100 text-emerald-700"
                        : selectedLead.verifyStatus === "FLAGGED"
                          ? "bg-red-100 text-red-700"
                          : "bg-surface text-muted"
                    }`}
                  >
                    {selectedLead.verifyStatus === "VERIFIED"
                      ? "Verified by you"
                      : selectedLead.verifyStatus === "FLAGGED"
                        ? "Flagged, check before calling"
                        : "Not verified yet"}
                  </span>
                  {selectedLead.state ? (
                    <span className="inline-block rounded-full bg-surface px-2 py-0.5 text-xs font-semibold">
                      State: {selectedLead.state}
                    </span>
                  ) : null}
                  {stateStatus(selectedLead.state) === "HELD" ||
                  stateStatus(selectedLead.state) === "BLOCKED" ? (
                    <span className="inline-block rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                      HELD, do not call
                    </span>
                  ) : null}
                </div>
                {stateStatus(selectedLead.state) === "HELD" ||
                stateStatus(selectedLead.state) === "BLOCKED" ? (
                  <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                    This lead is held by the state rule and must not be called yet.
                    {selectedLead.verifyNote ? ` ${selectedLead.verifyNote}` : ""}
                  </p>
                ) : null}
                {(() => {
                  const breakdown = scoreBreakdownFromFields(selectedLead.fields);
                  if (!breakdown) return null;
                  return (
                    <p className="mt-2 text-xs text-muted">
                      Score breakdown: Fit {breakdown.fit}/25 · Signal {breakdown.signal}/40 ·
                      Recency {breakdown.recency}/15 · Reachability {breakdown.reachability}/20
                      {breakdown.hotGateFailures.length
                        ? ` · Not HOT: ${breakdown.hotGateFailures.join("; ")}`
                        : " · Passes every HOT gate"}
                    </p>
                  );
                })()}
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
                    <>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => setCallModeOpen(true)}
                      >
                        <Maximize2 className="mr-2 h-4 w-4" aria-hidden="true" />
                        Call in full screen
                      </button>
                      <a className="btn-secondary" href={`tel:${selectedLead.phone.replace(/[^+\d]/g, "")}`}>
                        <PhoneCall className="mr-2 h-4 w-4" aria-hidden="true" />
                        {selectedLead.phone}
                      </a>
                    </>
                  ) : (
                    <span className="text-sm text-muted">This lead has no phone number yet.</span>
                  )}
                  <a className="btn-secondary" href="https://app.krispcall.com" target="_blank" rel="noreferrer">
                    Open KrispCall
                    <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
                  </a>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Call mode</span>
                  <button
                    type="button"
                    className={panelMode === "guided" ? "btn-primary" : "btn-secondary"}
                    aria-pressed={panelMode === "guided"}
                    onClick={() => setPanelMode("guided")}
                  >
                    Guided call
                  </button>
                  <button
                    type="button"
                    className={panelMode === "script" ? "btn-primary" : "btn-secondary"}
                    aria-pressed={panelMode === "script"}
                    onClick={() => setPanelMode("script")}
                  >
                    Full script
                  </button>
                </div>

                {panelMode === "guided" && resolvedFlow ? (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted" aria-label="Call steps so far">
                      {flowPath.map((id, index) => {
                        const trailNode = getFlowNode(id);
                        if (!trailNode) return null;
                        return (
                          <span key={`${id}-${index}`} className={index === flowPath.length - 1 ? "font-semibold text-body" : ""}>
                            {index > 0 ? "› " : ""}
                            {trailNode.title}
                          </span>
                        );
                      })}
                    </div>
                    <div className="mt-3 rounded-lg border border-line bg-surface p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {resolvedFlow.node.stage}
                      </p>
                      <h3 className="mt-1 font-display text-base font-semibold">
                        {resolvedFlow.node.title}
                      </h3>
                      {resolvedFlow.say ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{resolvedFlow.say}</p>
                      ) : null}
                      {resolvedFlow.hint ? (
                        <p className="mt-3 text-xs text-muted">Hint: {resolvedFlow.hint}</p>
                      ) : null}
                      {resolvedFlow.terminal && resolvedFlow.node.suggestedDisposition ? (
                        <p className="mt-3 text-sm">
                          Suggested outcome:{" "}
                          <span className="font-semibold">
                            {dispositionLabel(resolvedFlow.node.suggestedDisposition)}
                          </span>
                          {resolvedFlow.node.followUp
                            ? ". Set the follow up date in the log form below, then save."
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    {resolvedFlow.terminal ? (
                      <button
                        type="button"
                        className="btn-primary mt-3"
                        onClick={() => void saveAndNextLead()}
                        disabled={savingCall}
                      >
                        {savingCall ? "Saving..." : "Save and next lead"}
                      </button>
                    ) : (
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                          They say
                        </p>
                        <div className="mt-2 grid gap-2">
                          {resolvedFlow.responses.map((response) => (
                            <button
                              type="button"
                              key={response.label}
                              className="btn-secondary text-left"
                              onClick={() => goFlow(response.next)}
                            >
                              {response.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={flowBack}
                        disabled={flowPath.length <= 1}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={flowRestart}
                        disabled={flowPath.length <= 1}
                      >
                        Restart call
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        aria-expanded={showRoadmap}
                        onClick={() => setShowRoadmap((value) => !value)}
                      >
                        {showRoadmap ? "Hide roadmap" : "Show roadmap"}
                      </button>
                    </div>
                    {showRoadmap ? (
                      <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-line bg-surface p-4 text-sm">
                        <p className="text-xs text-muted">
                          Every stage of the call and where each answer leads. The card you are
                          on is in bold.
                        </p>
                        {flowRoadmap().map((group) => (
                          <div key={group.stage} className="mt-3">
                            <p className="text-xs font-semibold uppercase tracking-wide">
                              {group.stage}
                            </p>
                            <ul className="mt-1 space-y-1">
                              {group.nodes.map((roadNode) => (
                                <li key={roadNode.id}>
                                  <span className={roadNode.id === currentFlowNode?.id ? "font-semibold" : ""}>
                                    {roadNode.title}
                                  </span>
                                  {roadNode.terminal ? (
                                    <span className="text-muted">
                                      {" "}
                                      (ends the call
                                      {roadNode.suggestedDisposition
                                        ? `: ${dispositionLabel(roadNode.suggestedDisposition)}`
                                        : ""}
                                      )
                                    </span>
                                  ) : (
                                    <span className="text-muted">
                                      {" "}
                                      leads to:{" "}
                                      {(roadNode.responses ?? [])
                                        .map((response) => getFlowNode(response.next)?.title ?? response.next)
                                        .join(", ")}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {panelMode === "script" ? (
                  <>
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
                  <button
                    type="button"
                    className="btn-ghost ml-2 text-red-600"
                    onClick={() => void deleteSelectedLead()}
                  >
                    Delete this call lead
                  </button>
                  {showEditLead ? (
                    <form onSubmit={submitEditLead} className="mt-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label className="label" htmlFor="edit-service">Service</label>
                          <select id="edit-service" className="input" value={editForm.serviceSlug} onChange={(e) => setEditForm({ ...editForm, serviceSlug: e.target.value })}>
                            {initial.services.map((service) => (
                              <option key={service.slug} value={service.slug}>
                                {service.priority}. {service.name}
                              </option>
                            ))}
                          </select>
                        </div>
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
                  {disposition === "CALLBACK" || guidedFollowUp ? (
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

      {tab === "services" ? (
        <div className="mt-6 space-y-6">
          <div className="card p-5">
            <h2 className="font-display text-base font-semibold">How leads are scored, the 100 point rubric</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {initial.scoreBlocks.map((block) => (
                <div key={block.key} className="rounded-lg bg-elevated p-3">
                  <p className="text-sm font-semibold">
                    {block.label}, up to {block.max} points
                  </p>
                  <p className="mt-1 text-sm text-muted">{block.guide}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm">
              <strong>HOT</strong> is 70 or more AND Signal 30 or more AND Reachability 12 or
              more AND Recency 10 or more, with the hot signal verified within the last 14 days.
              <strong> WARM</strong> is 40 to 69, or a lead failing exactly one HOT gate.
              Under 40 is parked, not called, and any disqualifier means do not add the lead at all.
            </p>
          </div>
          <div className="card p-5">
            <h2 className="font-display text-base font-semibold">Calling cadence</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {initial.cadenceRules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
          <div className="card p-5">
            <h2 className="font-display text-base font-semibold">State priority for calling leads</h2>
            <p className="mt-2 text-sm">
              Calling leads are only sourced from <strong>Georgia</strong>, <strong>Illinois</strong>,{" "}
              <strong>North Carolina</strong> and <strong>Ohio</strong>, in that order. Lead lists
              sort in this order automatically, hottest first inside each state.
            </p>
            <p className="mt-2 text-sm">
              Texas joins after telemarketer registration there is done. Florida, Oklahoma,
              Maryland, Washington and Connecticut are excluded.
            </p>
            <p className="mt-2 text-sm">
              Leads outside the four states are not added to the calling system at all.
            </p>
          </div>
          {initial.services.map((service) => (
            <div key={service.slug} className="card p-5">
              <h2 className="font-display text-base font-semibold">
                {service.priority}. {service.name}
              </h2>
              <p className="mt-2 text-sm">{service.idealProspect}</p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Hot signals</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {service.hotSignals.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Warm signals</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {service.warmSignals.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Core pains</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {service.corePains.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Disqualifiers, walk away</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {service.disqualifiers.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="mt-3 text-sm">
                <span className="font-semibold">Offer line:</span> {service.defaultOfferLine}
              </p>
              <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                  Never say for this service
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {service.defaultDontSay.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
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
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {dispositionLabel(callback.disposition)}
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
      {callModeOpen && selectedLead ? (
        <CallMode
          key={selectedLead.id}
          lead={selectedLead}
          services={initial.services}
          renderedScript={renderedScript}
          renderedObjections={renderedObjections}
          speechSupported={speechSupported}
          speak={speakText}
          onClose={() => setCallModeOpen(false)}
          onSave={callModeSave}
          onVerify={callModeVerify}
          hasNext={Boolean(nextLeadAfterSelected)}
        />
      ) : null}
    </div>
  );
}
