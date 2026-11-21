import { isValidTimezone } from "./callWindow";
import { getCallingService } from "./services";

/**
 * Validation and shaping for the dedicated CallLead model (v1.47.0).
 * The columns carry the identity and contact facts; the extended
 * intel (score, pains, hook, signals, script, do not say list,
 * offer line and the evidence array) lives in the fields JSON.
 * These helpers are pure so the API routes share one definition of
 * a valid call lead and the rules are unit testable.
 */

export const CALL_TEMPERATURES = ["HOT", "WARM"] as const;
export type CallTemperature = (typeof CALL_TEMPERATURES)[number];

export const VERIFY_STATUSES = ["UNVERIFIED", "VERIFIED", "FLAGGED"] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];

export interface EvidenceEntry {
  label: string;
  url: string;
  note: string;
}

export interface CallLeadInput {
  listId: string | null;
  serviceSlug: string;
  temperature: CallTemperature;
  leadScore: number | null;
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  email: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  decisionMaker: string | null;
  namePronunciation: string | null;
  fields: Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown): string | null {
  const trimmed = text(value);
  return trimmed ? trimmed : null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => text(item)).filter(Boolean);
  }
  const single = text(value);
  if (!single) return [];
  return single
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Normalises an evidence array from an unknown body value. */
export function evidenceFromBody(value: unknown): EvidenceEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: EvidenceEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const label = text(record.label);
    const url = text(record.url);
    if (!label || !url) continue;
    entries.push({ label, url, note: text(record.note) });
  }
  return entries;
}

function hour(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 ? parsed : null;
}

/**
 * Builds a CallLead create payload from a request body, or the
 * first validation error. Phone is the one hard requirement: a call
 * lead without a number is not a call lead.
 */
export function callLeadFromBody(
  body: Record<string, unknown>,
): { lead: CallLeadInput } | { error: string } {
  const phone = text(body.phone);
  if (!phone) return { error: "A phone number is required" };

  const name = text(body.name);
  const [nameFirst, ...nameRest] = name.split(/\s+/).filter(Boolean);
  const firstName = text(body.firstName) || nameFirst || "";
  const lastName = text(body.lastName) || nameRest.join(" ") || "";
  const company = text(body.company);
  if (!firstName && !company) {
    return { error: "A name or a company is required" };
  }

  const serviceSlug = text(body.serviceSlug) || "wordpress-speed";
  if (!getCallingService(serviceSlug)) {
    return { error: `Unknown service: ${serviceSlug}` };
  }
  const temperatureRaw = text(body.temperature).toUpperCase();
  const temperature: CallTemperature = temperatureRaw === "HOT" ? "HOT" : "WARM";

  let leadScore: number | null = null;
  if (body.leadScore !== undefined && body.leadScore !== null && body.leadScore !== "") {
    const parsed = Number(body.leadScore);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      return { error: "leadScore must be between 0 and 100" };
    }
    leadScore = Math.round(parsed);
  }

  const timezone = nullableText(body.timezone);
  if (timezone && !isValidTimezone(timezone)) {
    return { error: "timezone must be an IANA timezone name, for example America/New_York" };
  }

  const fields: Record<string, unknown> = {};
  const mobileScore = text(body.mobileScore);
  if (mobileScore) fields.mobileScore = mobileScore;
  const lcp = text(body.lcp);
  if (lcp) fields.lcp = lcp;
  const startHour = hour(body.bestStartHour);
  if (startHour !== null) fields.bestStartHour = startHour;
  const endHour = hour(body.bestEndHour);
  if (endHour !== null) fields.bestEndHour = endHour;
  const bestTimeNote = text(body.bestTimeNote);
  if (bestTimeNote) fields.bestTimeNote = bestTimeNote;
  const painPoints = text(body.painPoints);
  if (painPoints) fields.painPoints = painPoints;
  const hook = text(body.hook) || text(body.icebreaker);
  if (hook) fields.hook = hook;
  const signals = stringArray(body.signals);
  if (signals.length) fields.signals = signals;
  const personalScript = text(body.personalScript);
  if (personalScript) fields.personalScript = personalScript;
  const dontSay = stringArray(body.dontSay);
  if (dontSay.length) fields.dontSay = dontSay;
  const offerLine = text(body.offerLine);
  if (offerLine) fields.offerLine = offerLine;
  const evidence = evidenceFromBody(body.evidence);
  if (evidence.length) fields.evidence = evidence;
  const scored = scoreFieldsFromBody(body);
  if ("error" in scored) return scored;
  for (const [key, value] of Object.entries(scored.scores)) {
    fields[key] = value;
  }
  // When all four subscores are present the rubric rules apply:
  // under 40 is a parked lead, not a call lead, and the temperature
  // and stored score are derived from the gates, not the input.
  const breakdown = scoreBreakdownFromFields(fields);
  let finalTemperature = temperature;
  let finalLeadScore = leadScore;
  if (breakdown) {
    if (breakdown.total < 40) {
      return {
        error: `This lead scores ${breakdown.total} of 100, under the 40 minimum for a call lead. Park it and rescore when a fresher signal fires.`,
      };
    }
    finalTemperature = breakdown.suggestedTemperature === "HOT" ? "HOT" : "WARM";
    finalLeadScore = breakdown.total;
  }
  // Carry any extra JSON fields the caller supplied (CSV import
  // lands its mapped columns here), without letting them override
  // the intel keys set above.
  if (body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)) {
    for (const [key, value] of Object.entries(body.fields as Record<string, unknown>)) {
      if (!(key in fields)) fields[key] = value;
    }
  }

  return {
    lead: {
      listId: nullableText(body.listId),
      serviceSlug,
      temperature: finalTemperature,
      leadScore: finalLeadScore,
      firstName,
      lastName,
      company,
      phone,
      email: nullableText(body.email),
      website: nullableText(body.website),
      city: nullableText(body.city),
      state: nullableText(body.state),
      timezone,
      decisionMaker: nullableText(body.decisionMaker),
      namePronunciation: nullableText(body.namePronunciation),
      fields,
    },
  };
}

/** The verify action payload: a status, and a note that can clear. */
export function verifyFromBody(
  body: Record<string, unknown>,
): { verifyStatus: VerifyStatus; verifyNote: string | null } | { error: string } {
  const status = text(body.verifyStatus).toUpperCase();
  if (!(VERIFY_STATUSES as readonly string[]).includes(status)) {
    return { error: "verifyStatus must be UNVERIFIED, VERIFIED or FLAGGED" };
  }
  return {
    verifyStatus: status as VerifyStatus,
    verifyNote: nullableText(body.verifyNote),
  };
}

/**
 * The render context the script renderer and the call window
 * helpers read: the lead's columns folded into the fields shape
 * they already understand, so a CallLead renders exactly like the
 * old field based leads did.
 */
export function callLeadRenderFields(lead: {
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  website: string | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  decisionMaker: string | null;
  namePronunciation: string | null;
  fields: unknown;
}): Record<string, unknown> {
  const base =
    lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
      ? { ...(lead.fields as Record<string, unknown>) }
      : {};
  if (lead.firstName) base.firstName = lead.firstName;
  if (lead.lastName) base.lastName = lead.lastName;
  if (lead.company) base.company = lead.company;
  base.phone = lead.phone;
  if (lead.website) base.website = lead.website;
  if (lead.city) base.city = lead.city;
  if (lead.state) base.state = lead.state;
  if (lead.timezone) base.timezone = lead.timezone;
  if (lead.decisionMaker) base.decisionMaker = lead.decisionMaker;
  if (lead.namePronunciation) base.namePronunciation = lead.namePronunciation;
  return base;
}

/** Evidence entries off a stored fields JSON, defensively shaped. */
export function evidenceFromFields(fields: unknown): EvidenceEntry[] {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  return evidenceFromBody((fields as Record<string, unknown>).evidence);
}

/** String list off a stored fields JSON (signals, dontSay). */
export function stringListFromFields(fields: unknown, key: string): string[] {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  return stringArray((fields as Record<string, unknown>)[key]);
}

/**
 * The four scoring subscores (research rubric, v1.47.0): fit of 25,
 * signal of 40, recency of 15, reachability of 20, stored in the
 * fields JSON as scoreFit, scoreSignal, scoreRecency and
 * scoreReachability. The total and the temperature are DERIVED,
 * never trusted from input: HOT needs the total and every gate,
 * WARM is 40 to 69 or a gated near miss, and under 40 the lead
 * should not exist as a call lead at all.
 */
export interface LeadScoreBreakdown {
  fit: number;
  signal: number;
  recency: number;
  reachability: number;
  total: number;
  suggestedTemperature: "HOT" | "WARM" | "PARK";
  hotGateFailures: string[];
}

const SCORE_CAPS = { fit: 25, signal: 40, recency: 15, reachability: 20 } as const;

function scoreValue(value: unknown, cap: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(cap, Math.round(parsed)));
}

export function scoreBreakdownFromFields(fields: unknown): LeadScoreBreakdown | null {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const record = fields as Record<string, unknown>;
  const fit = scoreValue(record.scoreFit, SCORE_CAPS.fit);
  const signal = scoreValue(record.scoreSignal, SCORE_CAPS.signal);
  const recency = scoreValue(record.scoreRecency, SCORE_CAPS.recency);
  const reachability = scoreValue(record.scoreReachability, SCORE_CAPS.reachability);
  if (fit === null || signal === null || recency === null || reachability === null) {
    return null;
  }
  const total = fit + signal + recency + reachability;
  const hotGateFailures: string[] = [];
  if (total < 70) hotGateFailures.push(`Total ${total} is under the HOT minimum of 70`);
  if (signal < 30) hotGateFailures.push(`Signal ${signal} is under the HOT minimum of 30`);
  if (reachability < 12) {
    hotGateFailures.push(`Reachability ${reachability} is under the HOT minimum of 12`);
  }
  if (recency < 10) hotGateFailures.push(`Recency ${recency} is under the HOT minimum of 10`);
  const suggestedTemperature =
    total < 40 ? "PARK" : hotGateFailures.length === 0 ? "HOT" : "WARM";
  return { fit, signal, recency, reachability, total, suggestedTemperature, hotGateFailures };
}

/** Copies the four subscores out of a request body into fields. */
export function scoreFieldsFromBody(
  body: Record<string, unknown>,
): { scores: Record<string, number> } | { error: string } {
  const scores: Record<string, number> = {};
  const keys = [
    ["scoreFit", SCORE_CAPS.fit],
    ["scoreSignal", SCORE_CAPS.signal],
    ["scoreRecency", SCORE_CAPS.recency],
    ["scoreReachability", SCORE_CAPS.reachability],
  ] as const;
  for (const [key, cap] of keys) {
    const raw = body[key];
    if (raw === undefined) continue;
    const parsed = scoreValue(raw, cap);
    if (parsed === null) return { error: `${key} must be a number between 0 and ${cap}` };
    scores[key] = parsed;
  }
  return { scores };
}
