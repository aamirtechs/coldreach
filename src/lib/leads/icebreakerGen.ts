/**
 * AI icebreaker generation helpers (v1.11.0).
 *
 * The per-lead work behind POST /api/lead-lists/[id]/generate-icebreakers
 * that does not need the database or the AI provider lives here, pure
 * and unit tested: finding the lead's website among its imported
 * fields, reducing a fetched page to a readable excerpt, shaping the
 * context the AI provider receives, and cleaning what the model
 * returns into the single stored line.
 *
 * The established icebreaker style in this product's lead data is one
 * full, specific sentence: an observation about the lead's own
 * business that flows into the campaign pitch, for example noting
 * that a firm's broker packets are completed by hand between load
 * board searches. The provider prompt (lib/ai) asks for one opening
 * line using only the supplied facts; these helpers make sure the
 * facts include the lead's own site text when a site exists.
 */

export type LeadFieldMap = Record<string, unknown>;

function fieldValue(fields: LeadFieldMap, keys: string[]): string {
  const byLowerKey = new Map<string, unknown>();
  for (const [key, value] of Object.entries(fields)) {
    byLowerKey.set(key.toLowerCase(), value);
  }
  for (const key of keys) {
    const value = byLowerKey.get(key.toLowerCase());
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** The lead's own website URL from its fields, or null. The imported
 *  field is "website"; "source" (usually the page the lead was found
 *  on) is an acceptable fallback for fetching context. */
export function websiteUrlForLead(fields: LeadFieldMap): string | null {
  const raw = fieldValue(fields, ["website", "site", "url", "homepage", "source"]);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Reduce fetched HTML to readable text: drop script and style
 *  blocks and all tags, decode the common entities, collapse
 *  whitespace, and cap the excerpt so prompts stay small. */
export function extractReadableText(html: string, cap = 3000): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const text = withoutBlocks
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > cap ? text.slice(0, cap) : text;
}

export interface IcebreakerLeadContext {
  leadFields: Record<string, string>;
  leadEmail: string;
}

/**
 * Shape the context handed to AiProvider.icebreaker: every string
 * field the lead carries (except a stale icebreaker), plus the
 * fetched site text under "websiteExcerpt" when a fetch produced
 * any. fit_note is renamed to fitNote only in the sense that both
 * keys are passed through as stored; the provider prints keys as-is.
 */
export function buildIcebreakerContext(
  lead: { email: string; fields: LeadFieldMap },
  websiteText: string,
): IcebreakerLeadContext {
  const leadFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(lead.fields)) {
    if (key.toLowerCase() === "icebreaker") continue;
    if (typeof value === "string" && value.trim()) {
      leadFields[key] = value.trim();
    }
  }
  if (websiteText.trim()) {
    leadFields.websiteExcerpt = websiteText.trim();
  }
  return { leadFields, leadEmail: lead.email };
}

/** Clean a model response into the stored icebreaker: one line, no
 *  surrounding quotes, no "Icebreaker:" style labels, capped at 300
 *  characters, preferring a sentence boundary when truncating. */
export function cleanIcebreaker(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  text = text.replace(/^(icebreaker|opening line|opener)\s*:\s*/i, "");
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  if (text.length <= 300) {
    return text;
  }
  const truncated = text.slice(0, 300);
  const lastSentenceEnd = Math.max(truncated.lastIndexOf(". "), truncated.lastIndexOf("! "));
  if (lastSentenceEnd > 120) {
    return truncated.slice(0, lastSentenceEnd + 1);
  }
  return truncated.trimEnd();
}

/** The stored icebreaker for a lead, or "" when it has none yet. */
export function existingIcebreaker(fields: LeadFieldMap): string {
  return fieldValue(fields, ["icebreaker"]);
}
