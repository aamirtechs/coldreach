/**
 * Placeholder rendering for call scripts (v1.43.0). A script body can
 * carry {{token}} placeholders that the call panel fills from the
 * selected lead at call time, so one script serves every lead. Values
 * come from the lead's fields JSON (phone, company, firstName,
 * lastName, website, mobileScore, lcp) plus the lead's email column.
 *
 * Lookup is case-insensitive on the token name, matching how lead
 * fields arrive from CSV imports with mixed casing. A token with no
 * value on the lead renders as an empty string, so the caller never
 * reads a raw {{token}} aloud; a token the renderer does not know at
 * all is left untouched, so free text that happens to use braces is
 * never eaten.
 */

export const SCRIPT_PLACEHOLDER_KEYS = [
  "firstName",
  "lastName",
  "company",
  "phone",
  "website",
  "mobileScore",
  "lcp",
  "email",
] as const;

const KNOWN_KEYS = new Set<string>(SCRIPT_PLACEHOLDER_KEYS.map((k) => k.toLowerCase()));

export interface ScriptLeadContext {
  fields?: Record<string, unknown> | null;
  email?: string | null;
}

function fieldString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Builds the lowercase-keyed lookup the renderer reads from. */
export function scriptValuesForLead(context: ScriptLeadContext): Record<string, string> {
  const values: Record<string, string> = {};
  const fields = context.fields;
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    for (const [key, value] of Object.entries(fields)) {
      const text = fieldString(value);
      if (text) values[key.toLowerCase()] = text;
    }
  }
  const email = fieldString(context.email);
  if (email && !values.email) values.email = email;
  return values;
}

export function renderScriptTemplate(template: string, context: ScriptLeadContext): string {
  const values = scriptValuesForLead(context);
  return template.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (!KNOWN_KEYS.has(key)) return match;
    return values[key] ?? "";
  });
}
