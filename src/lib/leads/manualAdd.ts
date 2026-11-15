/**
 * Manual add-lead payload shaping (v1.33.0).
 *
 * The single-lead form used to expose only first name, last name,
 * and company, while the CSV importer could also store the hook
 * line (the `icebreaker` field the campaign copy's {{icebreaker}}
 * token reads) and any custom field. These helpers build the POST
 * /api/leads body so the form offers exactly what an import can
 * store: the standard fields, the hook line, arbitrary custom
 * fields, and tags. Empty values are dropped here as well as in the
 * server-side sanitizer, so what the form shows is what gets saved.
 */

export interface ManualCustomField {
  key: string;
  value: string;
}

export interface ManualLeadInput {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  icebreaker: string;
  customFields: ManualCustomField[];
  tagsText: string;
}

const STANDARD_KEYS = ["firstName", "lastName", "company", "icebreaker"] as const;

/**
 * Build the fields map for a manually added lead. Standard fields
 * come first; a custom row whose key matches a standard field (any
 * casing) never overrides the dedicated input, and among duplicate
 * custom keys the last non-empty row wins, matching how the import
 * merge behaves.
 */
export function buildManualLeadFields(input: ManualLeadInput): Record<string, string> {
  const fields: Record<string, string> = {};
  const standard: Record<string, string> = {
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company,
    icebreaker: input.icebreaker,
  };
  for (const key of STANDARD_KEYS) {
    const value = (standard[key] ?? "").trim();
    if (value) fields[key] = value;
  }
  for (const row of input.customFields) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key || !value) continue;
    if (STANDARD_KEYS.some((standard) => standard.toLowerCase() === key.toLowerCase())) continue;
    if (key.toLowerCase() === "email") continue;
    fields[key] = value;
  }
  return fields;
}

/** Split a comma separated tags input into a clean tag list. */
export function parseManualTags(tagsText: string): string[] {
  return tagsText
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function buildManualLeadBody(input: ManualLeadInput, listId: string) {
  return {
    email: input.email.trim(),
    listId,
    fields: buildManualLeadFields(input),
    tags: parseManualTags(input.tagsText),
  };
}
