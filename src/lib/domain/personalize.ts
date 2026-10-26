/**
 * Template personalisation.
 *
 * Templates use double brace tokens, for example {{firstName}} or
 * {{firstName|there}} where the part after the pipe is a fallback used
 * when the lead has no value for that field. Rendering never throws:
 * known fields are substituted, fallbacks are applied, and unknown tokens
 * without a fallback are left untouched so preflight validation can flag
 * them with findUnknownTokens before a campaign is allowed to send.
 */

export type LeadFields = Record<string, string | number | null | undefined>;

const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*(?:\|([^{}]*))?\}\}/g;

function lookup(fields: LeadFields, key: string): string | null {
  const value = fields[key];
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function renderTemplate(template: string, fields: LeadFields): string {
  return template.replace(TOKEN_PATTERN, (match, key: string, fallback?: string) => {
    const value = lookup(fields, key);
    if (value !== null) {
      return value;
    }
    if (fallback !== undefined) {
      return fallback.trim();
    }
    return match;
  });
}

/**
 * Lists token names that have neither a lead field value nor a fallback.
 * Send preflight uses this to block campaigns with unresolved tokens.
 */
export function findUnknownTokens(template: string, fields: LeadFields): string[] {
  const unknown = new Set<string>();
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const key = match[1];
    const fallback = match[2];
    if (lookup(fields, key) === null && fallback === undefined) {
      unknown.add(key);
    }
  }
  return [...unknown];
}

/** Lists every distinct token name used in a template, fallback or not. */
export function listTokens(template: string): string[] {
  const tokens = new Set<string>();
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    tokens.add(match[1]);
  }
  return [...tokens];
}
