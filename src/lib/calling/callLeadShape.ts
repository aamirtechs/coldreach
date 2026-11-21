import {
  callLeadRenderFields,
  evidenceFromFields,
  stringListFromFields,
  type EvidenceEntry,
} from "./callLeadFields";

/**
 * The client shape for a CallLead row (v1.47.0), shared by the
 * Calling page loader and the /api/calling/call-leads routes so the
 * UI always sees one form. The columns are folded into `fields`
 * (the render context the script renderer, pronunciation and call
 * window helpers read), while the verification state, evidence,
 * signals and do not say list ride as first class properties the
 * call mode UI binds to directly.
 */

export interface CallLeadRowLike {
  id: string;
  listId: string | null;
  serviceSlug: string;
  temperature: string;
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
  fields: unknown;
  verifyStatus: string;
  verifyNote: string | null;
  verifiedAt: Date | string | null;
  lastCallAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ShapedCallLead {
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

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fieldText(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function shapeCallLead(
  row: CallLeadRowLike,
  lastCall: { disposition: string; calledAt: Date | string } | null = null,
): ShapedCallLead {
  const fields = callLeadRenderFields(row);
  return {
    id: row.id,
    listId: row.listId,
    serviceSlug: row.serviceSlug,
    temperature: row.temperature,
    leadScore: row.leadScore,
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    phone: row.phone,
    email: row.email ?? "",
    website: row.website ?? "",
    state: row.state ?? "",
    fields,
    verifyStatus: row.verifyStatus,
    verifyNote: row.verifyNote,
    verifiedAt: iso(row.verifiedAt),
    lastCallAt: iso(row.lastCallAt),
    evidence: evidenceFromFields(row.fields),
    signals: stringListFromFields(row.fields, "signals"),
    dontSay: stringListFromFields(row.fields, "dontSay"),
    offerLine: fieldText(fields, "offerLine"),
    lastCall: lastCall
      ? { disposition: lastCall.disposition, calledAt: iso(lastCall.calledAt) ?? "" }
      : null,
  };
}
