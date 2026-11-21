"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  Check,
  Clock,
  DollarSign,
  ExternalLink,
  Flag,
  Handshake,
  HelpCircle,
  Mail,
  Phone,
  PhoneOff,
  ShieldAlert,
  Timer,
  User,
  Voicemail,
  Volume2,
  X,
} from "lucide-react";
import {
  CALL_FLOW_START_ID,
  getFlowNode,
  resolveFlowNode,
} from "@/lib/calling/callFlow";
import { CALL_DISPOSITIONS, dispositionLabel } from "@/lib/calling/dispositions";
import { callWindowStatus, formatHour } from "@/lib/calling/callWindow";
import { scoreBreakdownFromFields } from "@/lib/calling/callLeadFields";
import { getCallingService } from "@/lib/calling/services";
import { stateStatus } from "@/lib/calling/statePriority";
import type { CallingLead, CallingServiceShape } from "./CallingWorkspace";

/**
 * Full screen call mode (v1.47.0). Opens over the whole app when
 * the caller taps Call on a lead: a giant, high contrast say card
 * driven by the branching flow, one tap response cards colour
 * coded by what they mean (green go ahead, amber objection, red
 * exit), the lead's intel one glance away, and a verify tab where
 * every claim behind the call can be opened and checked by hand.
 */

export interface CallSavePayload {
  disposition: string;
  notes: string;
  durationSeconds: number | null;
  followUpAt: string | null;
}

interface CallModeProps {
  lead: CallingLead;
  services: CallingServiceShape[];
  renderedScript: string;
  renderedObjections: string;
  speechSupported: boolean | null;
  speak: (text: string) => void;
  onClose: () => void;
  onSave: (payload: CallSavePayload, mode: "next" | "exit") => Promise<boolean>;
  onVerify: (status: string, note: string) => Promise<void>;
  hasNext: boolean;
}

function fieldText(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

type Tone = "go" | "objection" | "exit" | "neutral";

const EXIT_NODES = new Set(["closeFile", "doNotCall", "notInterestedLate"]);
const OBJECTION_NODES = new Set([
  "emailObjection",
  "webGuy",
  "priceAnswer",
  "priceAnswerGeneric",
  "thinkAboutIt",
  "moneyAnswer",
  "proofAnswer",
  "notInterestedEarly",
  "badTime",
  "gatekeeperExplain",
  "openerShort",
]);
const GO_NODES = new Set([
  "reason",
  "painQuestion",
  "proof",
  "offer",
  "closeReport",
  "closeWarm",
  "opener",
  "painCost",
  "painInvisible",
  "reasonOneLine",
  "gatekeeperAsk",
]);

function responseTone(next: string, label: string): Tone {
  if (EXIT_NODES.has(next) || /no means no|brush off|still no/i.test(label)) return "exit";
  if (OBJECTION_NODES.has(next)) return "objection";
  if (GO_NODES.has(next) || /go ahead|sounds good|putting you through|continue/i.test(label)) {
    return "go";
  }
  return "neutral";
}

function responseIcon(next: string, label: string) {
  const cls = "h-6 w-6 shrink-0";
  if (next === "voicemailScript") return <Voicemail className={cls} aria-hidden="true" />;
  if (next === "badTime") return <Clock className={cls} aria-hidden="true" />;
  if (next === "emailObjection" || /send.*email/i.test(label)) {
    return <Mail className={cls} aria-hidden="true" />;
  }
  if (next === "priceAnswer" || next === "priceAnswerGeneric" || /how much|cost/i.test(label)) {
    return <DollarSign className={cls} aria-hidden="true" />;
  }
  if (next.startsWith("gatekeeper")) return <User className={cls} aria-hidden="true" />;
  if (next === "closeReport" || next === "gatekeeperBestTime") {
    return <CalendarClock className={cls} aria-hidden="true" />;
  }
  if (next === "closeWarm") return <Handshake className={cls} aria-hidden="true" />;
  if (next === "doNotCall") return <PhoneOff className={cls} aria-hidden="true" />;
  const tone = responseTone(next, label);
  if (tone === "go") return <Check className={cls} aria-hidden="true" />;
  if (tone === "exit") return <X className={cls} aria-hidden="true" />;
  if (tone === "objection") return <HelpCircle className={cls} aria-hidden="true" />;
  return <Phone className={cls} aria-hidden="true" />;
}

const TONE_CLASSES: Record<Tone, string> = {
  go: "border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20 text-fg",
  objection: "border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20 text-fg",
  exit: "border-red-500/60 bg-red-500/10 hover:bg-red-500/20 text-fg",
  neutral: "border-line bg-elevated hover:bg-surface text-fg",
};

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

type RailTab = "intel" | "say" | "verify";

export function CallMode({
  lead,
  services,
  renderedScript,
  renderedObjections,
  speechSupported,
  speak,
  onClose,
  onSave,
  onVerify,
  hasNext,
}: CallModeProps) {
  const [flowPath, setFlowPath] = useState<string[]>([CALL_FLOW_START_ID]);
  const [railTab, setRailTab] = useState<RailTab>("intel");
  const [disposition, setDisposition] = useState("TALKED");
  const [notes, setNotes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [durationOverride, setDurationOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifyNote, setVerifyNote] = useState(lead.verifyNote ?? "");
  const [verifying, setVerifying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  // The call timer starts the moment call mode opens.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Esc exits, and the page behind must not scroll while calling.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const currentNode = getFlowNode(flowPath[flowPath.length - 1]) ?? getFlowNode(CALL_FLOW_START_ID);
  const resolved = useMemo(
    () =>
      currentNode
        ? resolveFlowNode(currentNode, { fields: lead.fields, email: lead.email })
        : null,
    [currentNode, lead],
  );

  useEffect(() => {
    if (currentNode?.terminal && currentNode.suggestedDisposition) {
      setDisposition(currentNode.suggestedDisposition);
    }
  }, [currentNode]);

  const now = new Date();
  const status = callWindowStatus(lead.fields, now);
  const service = services.find((item) => item.slug === lead.serviceSlug) ?? getCallingService(lead.serviceSlug);
  const breakdown = scoreBreakdownFromFields(lead.fields);
  const pronunciation = fieldText(lead.fields, "namePronunciation");
  const spokenName =
    fieldText(lead.fields, "decisionMaker").replace(/\s*\([^)]*\)\s*/g, " ").trim() ||
    `${lead.firstName} ${lead.lastName}`.trim();
  const dontSayItems = lead.dontSay.length
    ? lead.dontSay
    : (service?.defaultDontSay ?? []);
  const needsFollowUp = Boolean(
    (currentNode?.terminal && currentNode.followUp) || disposition === "CALLBACK",
  );

  async function save(mode: "next" | "exit") {
    setSaving(true);
    try {
      const durationSeconds =
        durationOverride.trim() !== ""
          ? Math.round(Number(durationOverride) * 60)
          : elapsed;
      const ok = await onSave(
        {
          disposition,
          notes,
          durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : elapsed,
          followUpAt:
            followUpAt && (disposition === "CALLBACK" || needsFollowUp)
              ? new Date(followUpAt).toISOString()
              : null,
        },
        mode,
      );
      if (ok && mode === "exit") onClose();
      if (ok && mode === "next") {
        // Parent swaps the lead; this component remounts per lead id.
      }
    } finally {
      setSaving(false);
    }
  }

  async function verify(statusValue: string) {
    setVerifying(true);
    try {
      await onVerify(statusValue, verifyNote);
    } finally {
      setVerifying(false);
    }
  }

  const scoreChips = [
    fieldText(lead.fields, "mobileScore")
      ? `Mobile score ${fieldText(lead.fields, "mobileScore")}/100`
      : null,
    fieldText(lead.fields, "lcp") ? `LCP ${fieldText(lead.fields, "lcp")}` : null,
    lead.leadScore !== null ? `Lead score ${lead.leadScore}/100` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg text-fg" role="dialog" aria-modal="true" aria-label={`Call mode for ${lead.company || lead.firstName}`}>
      {/* Lead header, always visible */}
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="truncate font-display text-xl font-bold">
              {lead.company || `${lead.firstName} ${lead.lastName}`.trim()}
            </p>
            <p className="text-sm text-muted">
              {fieldText(lead.fields, "decisionMaker") || `${lead.firstName} ${lead.lastName}`.trim()}
              {pronunciation ? (
                <span className="font-medium text-fg"> · say: {pronunciation}</span>
              ) : null}
              {fieldText(lead.fields, "city") || lead.state ? (
                <span className="font-medium text-fg">
                  {" "}· {fieldText(lead.fields, "city") ? `${fieldText(lead.fields, "city")}, ` : ""}State: {lead.state}
                </span>
              ) : null}
            </p>
          </div>
          {speechSupported ? (
            <div className="flex gap-1">
              {spokenName ? (
                <button type="button" className="btn-ghost text-xs" onClick={() => speak(spokenName)}>
                  <Volume2 className="mr-1 h-4 w-4" aria-hidden="true" /> Listen
                </button>
              ) : null}
              {lead.firstName ? (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => speak(`Hi, is that ${lead.firstName}?`)}
                >
                  <Volume2 className="mr-1 h-4 w-4" aria-hidden="true" /> Hear the greeting
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-3 py-1 text-sm font-semibold">
              <Timer className="h-4 w-4" aria-hidden="true" /> {formatClock(elapsed)}
            </span>
            {status.state !== "unknown" ? (
              <span
                className={`rounded-full px-3 py-1 text-sm font-semibold ${
                  status.state === "good"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-elevated text-muted"
                }`}
              >
                Their time {status.localTimeLabel}
                {status.state === "good" ? " · good time to call" : ""}
              </span>
            ) : null}
            {lead.phone ? (
              <a className="btn-primary" href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}>
                <Phone className="mr-2 h-4 w-4" aria-hidden="true" /> {lead.phone}
              </a>
            ) : null}
            <a className="btn-secondary" href="https://app.krispcall.com" target="_blank" rel="noreferrer">
              KrispCall
            </a>
            <button type="button" className="btn-secondary" onClick={onClose} aria-label="Exit call mode">
              <X className="mr-1 h-4 w-4" aria-hidden="true" /> Exit
            </button>
          </div>
        </div>
      </header>

      {stateStatus(lead.state) === "HELD" || stateStatus(lead.state) === "BLOCKED" ? (
        <div className="border-b border-red-300 bg-red-600 px-4 py-3 text-white sm:px-6" role="alert">
          <p className="text-lg font-bold">HELD: do not call this lead yet.</p>
          <p className="text-sm">
            {lead.verifyNote ||
              (stateStatus(lead.state) === "HELD"
                ? "Texas is held until telemarketer registration there is done."
                : "This state is on the blocked list from the 2026-11-21 state research.")}
          </p>
        </div>
      ) : null}

      <div className="grid flex-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[1fr_400px]">
        {/* Centre: the branching flow */}
        <section aria-label="Guided call script">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="font-semibold uppercase tracking-wide">
              {resolved?.node.stage ?? "Call"}
            </span>
            <span>· Step {flowPath.length}</span>
            <span className="truncate">
              {flowPath
                .map((id) => getFlowNode(id)?.title ?? id)
                .join(" › ")}
            </span>
            <span className="ml-auto flex gap-1">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setFlowPath((path) => (path.length > 1 ? path.slice(0, -1) : path))}
                disabled={flowPath.length <= 1}
              >
                Back
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setFlowPath([CALL_FLOW_START_ID])}
                disabled={flowPath.length <= 1}
              >
                Restart
              </button>
            </span>
          </div>

          <div className="mt-3 rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
            <h2 className="font-display text-2xl font-bold">{resolved?.node.title}</h2>
            {resolved?.say ? (
              <p className="mt-4 whitespace-pre-wrap text-2xl font-medium leading-relaxed sm:text-[28px] sm:leading-[1.5]">
                {resolved.say}
              </p>
            ) : null}
            {resolved?.hint ? (
              <p className="mt-4 text-base text-muted">Hint: {resolved.hint}</p>
            ) : null}
            {resolved?.terminal ? (
              <p className="mt-5 rounded-lg bg-elevated p-4 text-lg">
                This path ends the call. Suggested outcome:{" "}
                <strong>{currentNode?.suggestedDisposition ? dispositionLabel(currentNode.suggestedDisposition) : ""}</strong>
                {currentNode?.followUp ? ". Set the follow up date in the bar below." : ""}
              </p>
            ) : null}
          </div>

          {!resolved?.terminal ? (
            <div className="mt-4">
              <p className="text-sm font-semibold uppercase tracking-wide text-muted">
                They say (tap their answer)
              </p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {resolved?.responses.map((response) => {
                  const tone = responseTone(response.next, response.label);
                  return (
                    <button
                      type="button"
                      key={response.label}
                      onClick={() => setFlowPath((path) => [...path, response.next])}
                      className={`flex items-center gap-3 rounded-xl border-2 p-4 text-left text-lg font-semibold transition-colors ${TONE_CLASSES[tone]}`}
                    >
                      {responseIcon(response.next, response.label)}
                      <span>{response.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        {/* Right rail: intel, say and dont say, verify */}
        <aside className="rounded-2xl border border-line bg-surface p-4" aria-label="Lead intel">
          <div className="flex gap-2">
            {(
              [
                ["intel", "Intel"],
                ["say", "Say / Don't say"],
                ["verify", "Verify"],
              ] as [RailTab, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={railTab === value ? "btn-primary" : "btn-secondary"}
                aria-pressed={railTab === value}
                onClick={() => setRailTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {railTab === "intel" ? (
            <div className="mt-4 space-y-4 text-base">
              <p>
                {[fieldText(lead.fields, "city"), fieldText(lead.fields, "state")].filter(Boolean).join(", ") || "Location not recorded"}
                {service ? ` · ${service.name}` : ""}
                {" · "}
                <span
                  className={`rounded-full px-2 py-0.5 text-sm font-bold ${
                    lead.temperature === "HOT"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {lead.temperature}
                </span>
              </p>
              {scoreChips.length ? (
                <div className="flex flex-wrap gap-2">
                  {scoreChips.map((chip) => (
                    <span key={chip} className="rounded-full bg-elevated px-3 py-1 text-sm font-semibold">
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}
              {lead.offerLine ? (
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted">Offer</p>
                  <p className="mt-1">{lead.offerLine}</p>
                </div>
              ) : null}
              {fieldText(lead.fields, "hook") ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
                  <p className="text-sm font-semibold uppercase tracking-wide">Hook</p>
                  <p className="mt-1">{fieldText(lead.fields, "hook")}</p>
                </div>
              ) : null}
              {fieldText(lead.fields, "painPoints") ? (
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted">Pain points</p>
                  <p className="mt-1 whitespace-pre-wrap">{fieldText(lead.fields, "painPoints")}</p>
                </div>
              ) : null}
              {lead.signals.length ? (
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted">Why now (signals)</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {lead.signals.map((signal) => (
                      <li key={signal}>{signal}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {fieldText(lead.fields, "bestTimeNote") ? (
                <p className="text-muted">
                  Best time: {fieldText(lead.fields, "bestTimeNote")}
                  {status.window
                    ? ` (${formatHour(status.window.startHour)} to ${formatHour(status.window.endHour)} their time)`
                    : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          {railTab === "say" ? (
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted">
                  Personal script for this lead
                </p>
                <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-elevated p-3 text-base leading-7">
                  {renderedScript || "No personal script recorded for this lead. The guided flow in the centre carries the call."}
                </div>
                {renderedObjections ? (
                  <div className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-elevated p-3 text-sm leading-6">
                    {renderedObjections}
                  </div>
                ) : null}
              </div>
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-red-700 dark:text-red-300">
                  <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Do not say
                </p>
                {dontSayItems.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
                    {dontSayItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-base">Nothing recorded for this lead.</p>
                )}
              </div>
            </div>
          ) : null}

          {railTab === "verify" ? (
            <div className="mt-4 space-y-4 text-base">
              <p className="flex items-center gap-2">
                Status:{" "}
                <span
                  className={`rounded-full px-2 py-0.5 text-sm font-bold ${
                    lead.verifyStatus === "VERIFIED"
                      ? "bg-emerald-100 text-emerald-700"
                      : lead.verifyStatus === "FLAGGED"
                        ? "bg-red-100 text-red-700"
                        : "bg-elevated text-muted"
                  }`}
                >
                  {lead.verifyStatus}
                </span>
                {lead.verifiedAt ? (
                  <span className="text-sm text-muted">
                    checked {new Date(lead.verifiedAt).toLocaleDateString()}
                  </span>
                ) : null}
              </p>
              {breakdown ? (
                <div className="rounded-lg bg-elevated p-3">
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted">
                    Score breakdown, {breakdown.total} of 100
                  </p>
                  <ul className="mt-2 space-y-1">
                    <li>Fit: {breakdown.fit} / 25</li>
                    <li>Signal: {breakdown.signal} / 40</li>
                    <li>Recency: {breakdown.recency} / 15</li>
                    <li>Reachability: {breakdown.reachability} / 20</li>
                  </ul>
                  {breakdown.hotGateFailures.length ? (
                    <p className="mt-2 text-sm text-muted">
                      Not HOT: {breakdown.hotGateFailures.join("; ")}.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm font-semibold text-red-600">
                      Passes every HOT gate. Call today inside the window.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted">No score breakdown recorded for this lead yet.</p>
              )}
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted">
                  Evidence, open each source and check the claim yourself
                </p>
                {lead.evidence.length ? (
                  <ul className="mt-2 space-y-3">
                    {lead.evidence.map((entry, index) => (
                      <li key={`${entry.url}-${index}`} className="rounded-lg border border-line p-3">
                        <p className="font-semibold">{entry.label}</p>
                        {entry.note ? <p className="text-sm text-muted">{entry.note}</p> : null}
                        <a
                          className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-accent"
                          href={entry.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open source <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted">
                    No evidence links recorded. Treat every claim about this lead as unchecked
                    until you have seen it yourself.
                  </p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="callmode-verify-note">Verification note</label>
                <textarea
                  id="callmode-verify-note"
                  className="input"
                  rows={2}
                  value={verifyNote}
                  onChange={(event) => setVerifyNote(event.target.value)}
                  placeholder="What you checked, or what is wrong"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={verifying}
                    onClick={() => void verify("VERIFIED")}
                  >
                    <BadgeCheck className="mr-1 h-4 w-4" aria-hidden="true" /> Mark verified
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={verifying}
                    onClick={() => void verify("FLAGGED")}
                  >
                    <Flag className="mr-1 h-4 w-4" aria-hidden="true" /> Flag a problem
                  </button>
                  {lead.verifyStatus !== "UNVERIFIED" ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={verifying}
                      onClick={() => void verify("UNVERIFIED")}
                    >
                      Reset
                    </button>
                  ) : null}
                </div>
                {lead.verifyNote ? (
                  <p className="mt-2 flex items-start gap-1 text-sm text-muted">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    Last note: {lead.verifyNote}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {/* Bottom bar: log the call without leaving call mode */}
      <footer className="sticky bottom-0 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="callmode-disposition">Outcome</label>
            <select
              id="callmode-disposition"
              className="input w-auto"
              value={disposition}
              onChange={(event) => setDisposition(event.target.value)}
            >
              {CALL_DISPOSITIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="callmode-notes">Notes</label>
            <input
              id="callmode-notes"
              className="input"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What happened, in one line"
            />
          </div>
          <div>
            <label className="label" htmlFor="callmode-duration">Minutes (timer: {formatClock(elapsed)})</label>
            <input
              id="callmode-duration"
              className="input w-24"
              type="number"
              min="0"
              step="0.5"
              value={durationOverride}
              onChange={(event) => setDurationOverride(event.target.value)}
              placeholder={String(Math.max(1, Math.round(elapsed / 60)))}
            />
          </div>
          {needsFollowUp ? (
            <div>
              <label className="label" htmlFor="callmode-followup">Follow up</label>
              <input
                id="callmode-followup"
                className="input w-auto"
                type="datetime-local"
                value={followUpAt}
                onChange={(event) => setFollowUpAt(event.target.value)}
              />
            </div>
          ) : null}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={saving}
              onClick={() => void save("exit")}
            >
              Save and exit
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving || !hasNext}
              onClick={() => void save("next")}
            >
              {saving ? "Saving..." : hasNext ? "Save and next lead" : "No next lead"}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
