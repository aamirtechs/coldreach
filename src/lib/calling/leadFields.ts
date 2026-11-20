import { isValidTimezone } from "./callWindow";

/**
 * The enriched calling fields a call lead can carry in its Lead
 * fields JSON (v1.44.0). Strings are trimmed; the two best-window
 * hours are stored as numbers so the call-now indicator can compare
 * them without parsing at render time. This extractor is shared by
 * the add-lead and edit-lead API routes so both accept exactly the
 * same shape. A key present with an empty string means "clear it";
 * the merge helper honours that by deleting the stored key.
 */

export const CALLING_STRING_FIELDS = [
  "city",
  "state",
  "timezone",
  "bestTimeNote",
  "decisionMaker",
  "namePronunciation",
  "painPoints",
  "hook",
  "mobileScore",
  "lcp",
  "personalScript",
] as const;

export const CALLING_NUMBER_FIELDS = ["bestStartHour", "bestEndHour"] as const;

export type CallingLeadFields = Record<string, string | number>;

export function callingFieldsFromBody(
  body: Record<string, unknown>,
): { fields: CallingLeadFields } | { error: string } {
  const fields: CallingLeadFields = {};
  for (const key of CALLING_STRING_FIELDS) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return { error: `${key} must be text` };
    fields[key] = value.trim();
  }
  if (fields.timezone && !isValidTimezone(fields.timezone)) {
    return { error: "timezone must be an IANA timezone name, for example America/New_York" };
  }
  for (const key of CALLING_NUMBER_FIELDS) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (value === "") {
      // Present but empty: the merge reads this as "clear the hour".
      fields[key] = "";
      continue;
    }
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) {
      return { error: `${key} must be an hour between 0 and 24` };
    }
    fields[key] = parsed;
  }
  return { fields };
}

/**
 * Merges extracted calling fields into a lead's stored fields: a
 * non-empty value overwrites, an empty string or an explicit null
 * number clears the stored key, and absent keys are left alone.
 */
export function mergeCallingFields(
  existing: Record<string, unknown>,
  updates: CallingLeadFields,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (value === "" || value === null || value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}
