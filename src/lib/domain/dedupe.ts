/**
 * Lead import normalisation and deduplication.
 *
 * Import rows are keyed by their email address. Normalisation trims and
 * lowercases the address, and can optionally strip "+tag" suffixes from
 * the local part so that jane+news@example.com and jane@example.com are
 * treated as the same contact. Syntactically invalid addresses are
 * separated out instead of being imported.
 */

export interface ImportRow {
  email: string;
  fields?: Record<string, string>;
}

export interface DedupeOptions {
  stripPlusTag?: boolean;
}

export interface DedupeResult<T extends ImportRow> {
  kept: T[];
  duplicates: T[];
  invalid: T[];
  summary: {
    total: number;
    kept: number;
    duplicates: number;
    invalid: number;
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export function normalizeEmail(email: string, options: DedupeOptions = {}): string {
  const cleaned = email.trim().toLowerCase();
  if (!options.stripPlusTag) {
    return cleaned;
  }
  const at = cleaned.indexOf("@");
  if (at < 0) {
    return cleaned;
  }
  const local = cleaned.slice(0, at);
  const domain = cleaned.slice(at);
  const plus = local.indexOf("+");
  return (plus >= 0 ? local.slice(0, plus) : local) + domain;
}

export function dedupeImport<T extends ImportRow>(
  rows: T[],
  options: DedupeOptions = {},
): DedupeResult<T> {
  const seen = new Set<string>();
  const kept: T[] = [];
  const duplicates: T[] = [];
  const invalid: T[] = [];

  for (const row of rows) {
    if (!isValidEmail(row.email)) {
      invalid.push(row);
      continue;
    }
    const key = normalizeEmail(row.email, options);
    if (seen.has(key)) {
      duplicates.push(row);
    } else {
      seen.add(key);
      kept.push(row);
    }
  }

  return {
    kept,
    duplicates,
    invalid,
    summary: {
      total: rows.length,
      kept: kept.length,
      duplicates: duplicates.length,
      invalid: invalid.length,
    },
  };
}
