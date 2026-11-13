/**
 * Lead search (v1.26.0): match a free text query against a lead's
 * email, name, and company, not just the email.
 *
 * Name and company live in the lead's free-form `fields` JSON
 * (imported from CSV columns such as firstName, lastName, name,
 * company), and a JSON column cannot be substring searched
 * portably across the SQLite dev database and the Postgres
 * production database with one Prisma query. Callers therefore
 * scan a bounded window of leads and filter with this helper,
 * the same pattern the tag filter has always used. The helper is
 * pure and unit tested, so every search surface (the lead list
 * page, the leads API, and the Outbox, which searches through
 * its threads' leads) matches in exactly the same way.
 *
 * Field keys are matched case-insensitively, because CSV imports
 * in the wild carry both `company` and `Company` style headers.
 */

function fieldRecord(fields: unknown): Record<string, unknown> {
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    return fields as Record<string, unknown>;
  }
  return {};
}

/** One field's text value by case-insensitive key, or null. */
export function leadFieldValue(fields: unknown, ...keys: string[]): string | null {
  const record = fieldRecord(fields);
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(record)) {
    if (!wanted.has(key.toLowerCase())) {
      continue;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

/** The lead's display name: a `name` field, else first plus last. */
export function leadNameOf(fields: unknown): string | null {
  const combined = [
    leadFieldValue(fields, "firstName", "first_name", "firstname"),
    leadFieldValue(fields, "lastName", "last_name", "lastname"),
  ]
    .filter(Boolean)
    .join(" ");
  return combined || leadFieldValue(fields, "name", "fullName", "full_name");
}

/** The lead's company, when one is recorded. */
export function leadCompanyOf(fields: unknown): string | null {
  return leadFieldValue(fields, "company", "organization", "organisation", "business");
}

/**
 * True when the query appears (case-insensitively) in the lead's
 * email, first name, last name, full name, or company. An empty
 * query matches everything, so callers can apply it uniformly.
 */
export function leadMatchesSearch(
  lead: { email: string; fields: unknown },
  rawQuery: string,
): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }
  const haystacks = [
    lead.email,
    leadNameOf(lead.fields),
    leadCompanyOf(lead.fields),
    leadFieldValue(lead.fields, "firstName", "first_name", "firstname"),
    leadFieldValue(lead.fields, "lastName", "last_name", "lastname"),
  ];
  return haystacks.some(
    (value) => typeof value === "string" && value.toLowerCase().includes(query),
  );
}
