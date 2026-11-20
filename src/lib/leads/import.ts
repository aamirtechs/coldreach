import type { PrismaClient } from "@prisma/client";
import { parseCsv } from "@/lib/csv";
import { dedupeImport, normalizeEmail, type ImportRow } from "@/lib/domain/dedupe";
import { findSuppression } from "@/lib/domain/suppression";
import { loadSuppressions } from "@/lib/suppressions";
import type { VerificationStatus } from "@/lib/verify/builtin";

/**
 * Lead CSV import.
 *
 * Pipeline, in order: parse, map columns, dedupe within the file
 * (dedupe engine), drop rows that already exist in the workspace, drop
 * suppressed rows, insert the rest. Nothing reaches the database before
 * every check has run, and every rejected row is reported with its
 * original 1-based file row number and a reason, which the UI offers as
 * a downloadable error report.
 *
 * When updateExisting is set, a row whose email already exists in this
 * list is not skipped: its mapped fields are merged into the existing
 * lead (new values win per field) and the row is counted as updated.
 * Leads that exist in a different list are never touched by an update
 * import; they keep the usual already-exists skip.
 */

export interface ColumnMapping {
  /** CSV column name to target. Target "email" is the address itself,
   *  "ignore" drops the column, anything else is stored as a lead field
   *  under that name (firstName, lastName, company, or any custom key). */
  [csvColumn: string]: string;
}

/**
 * The standard mapping targets the import wizard offers, beyond
 * "email" and "ignore" (v1.26.0 adds "icebreaker": the campaign
 * copy's {{icebreaker}} token reads the field of that name, and it
 * is a first class import target like firstName or company).
 */
export const STANDARD_FIELD_TARGETS = ["firstName", "lastName", "company", "icebreaker"] as const;

/**
 * Guess the mapping target for one CSV header, used by the import
 * wizard to pre-fill the mapping step. A header that matches no
 * standard target is returned unchanged, so it still imports as a
 * custom field under its own name. Matching ignores case, spaces,
 * and punctuation, so "Ice Breaker", "ice_breaker", and
 * "ICEBREAKER" all resolve to the icebreaker target.
 */
export function guessImportTarget(header: string): string {
  const h = header.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (["email", "emailaddress", "mail"].includes(h)) return "email";
  if (["firstname", "first", "givenname"].includes(h)) return "firstName";
  if (["lastname", "last", "surname", "familyname"].includes(h)) return "lastName";
  if (["company", "organisation", "organization", "employer"].includes(h)) return "company";
  if (
    ["icebreaker", "icebreakers", "icebreakerline", "openingline", "hook", "hooks", "hookline", "hooklines"].includes(h)
  )
    return "icebreaker";
  // Calling columns (v1.44.0): the Calling section reads these lead
  // fields under their canonical keys, so the wizard maps the common
  // header spellings onto them instead of passing the header through
  // with its original casing.
  if (["phone", "phonenumber", "telephone", "mobile", "cell", "cellphone"].includes(h)) return "phone";
  if (["website", "site", "webpage", "homepage"].includes(h)) return "website";
  if (["city", "town"].includes(h)) return "city";
  if (["state", "province", "region"].includes(h)) return "state";
  if (["timezone", "tz"].includes(h)) return "timezone";
  if (["besttimenote", "besttime", "callwindow"].includes(h)) return "bestTimeNote";
  if (["decisionmaker", "decisionmakers"].includes(h)) return "decisionMaker";
  if (["namepronunciation", "pronunciation", "pronounce", "howtopronounce"].includes(h))
    return "namePronunciation";
  if (["painpoints", "painpoint", "pains"].includes(h)) return "painPoints";
  if (["mobilescore", "pagespeedscore", "speedscore"].includes(h)) return "mobileScore";
  if (["lcp", "loadtime", "lcpseconds"].includes(h)) return "lcp";
  if (["personalscript", "callscript"].includes(h)) return "personalScript";
  return header;
}

export interface ImportRowError {
  row: number;
  email: string;
  reason: string;
}

export interface ImportSummary {
  total: number;
  kept: number;
  duplicates: number;
  invalid: number;
  suppressed: number;
  alreadyExisted: number;
  updated: number;
  verificationSkipped: number;
}

/**
 * Verdicts from the wizard's verification step, keyed by normalised
 * email, plus the status groups the user chose to import (the
 * wizard offers Good, Catch-all/risky, Unknown, Invalid, and All,
 * multi-select; "Good emails only" carries the Recommended badge).
 * A row whose verdict status is not in the chosen set is skipped.
 * When statuses is omitted, the default set is VALID, RISKY and
 * UNKNOWN (everything except INVALID). Imported leads store their
 * verdict, so no re-verification is needed before enrollment; note
 * INVALID leads can be imported for record keeping but enrollment
 * still skips them.
 */
export interface ImportVerificationInput {
  verdicts: Record<string, { status: string; detail: unknown }>;
  statuses?: string[];
}

export const DEFAULT_IMPORT_STATUSES = ["VALID", "RISKY", "UNKNOWN"];

export interface ImportResult {
  summary: ImportSummary;
  errors: ImportRowError[];
  listId: string;
}

interface MappedRow extends ImportRow {
  rowNumber: number;
  fields: Record<string, string>;
  verdict?: { status: string; detail: unknown };
}

export async function importLeadsFromCsv(
  db: PrismaClient,
  args: {
    workspaceId: string;
    listId: string;
    csvText: string;
    mapping: ColumnMapping;
    stripPlusTag?: boolean;
    updateExisting?: boolean;
    verification?: ImportVerificationInput;
  },
): Promise<ImportResult> {
  const { workspaceId, listId } = args;
  const parsed = parseCsv(args.csvText);
  if (parsed.headers.length === 0) {
    throw Object.assign(new Error("The CSV file is empty or has no header row"), { status: 400 });
  }
  const emailColumn = Object.keys(args.mapping).find((col) => args.mapping[col] === "email");
  if (!emailColumn || !parsed.headers.includes(emailColumn)) {
    throw Object.assign(new Error("Map one CSV column to the email target before importing"), {
      status: 400,
    });
  }

  const mapped: MappedRow[] = parsed.rows.map((row, index) => {
    const fields: Record<string, string> = {};
    for (const [csvColumn, target] of Object.entries(args.mapping)) {
      if (target === "email" || target === "ignore" || !target) {
        continue;
      }
      const value = (row[csvColumn] ?? "").trim();
      if (value) {
        fields[target] = value;
      }
    }
    return {
      // Data rows start at file line 2; the header is line 1.
      rowNumber: index + 2,
      email: row[emailColumn] ?? "",
      fields,
    };
  });

  const deduped = dedupeImport(mapped, { stripPlusTag: args.stripPlusTag ?? false });
  const errors: ImportRowError[] = [];
  for (const row of deduped.invalid) {
    errors.push({ row: row.rowNumber, email: row.email, reason: "Invalid email address" });
  }
  for (const row of deduped.duplicates) {
    errors.push({ row: row.rowNumber, email: row.email, reason: "Duplicate within the file" });
  }

  const suppressions = await loadSuppressions(db, workspaceId);
  const keptEmails = deduped.kept.map((row) => normalizeEmail(row.email));
  const existing = keptEmails.length
    ? await db.lead.findMany({
        where: { workspaceId, email: { in: keptEmails } },
        select: { id: true, email: true, listId: true, fields: true },
      })
    : [];
  const existingByEmail = new Map(existing.map((lead) => [lead.email.toLowerCase(), lead]));

  let suppressedCount = 0;
  let alreadyExisted = 0;
  let updatedCount = 0;
  let verificationSkipped = 0;
  const toInsert: MappedRow[] = [];
  for (const row of deduped.kept) {
    const normalized = normalizeEmail(row.email);
    const suppression = findSuppression(normalized, suppressions);
    if (suppression) {
      suppressedCount += 1;
      errors.push({
        row: row.rowNumber,
        email: row.email,
        reason: `Suppressed: ${suppression.reason ?? "on the suppression list"}`,
      });
      continue;
    }
    const existingLead = existingByEmail.get(normalized);
    if (existingLead) {
      if (args.updateExisting && existingLead.listId === listId) {
        const currentFields: Record<string, string> = {};
        if (
          existingLead.fields &&
          typeof existingLead.fields === "object" &&
          !Array.isArray(existingLead.fields)
        ) {
          for (const [key, value] of Object.entries(existingLead.fields as Record<string, unknown>)) {
            if (typeof value === "string") {
              currentFields[key] = value;
            }
          }
        }
        await db.lead.update({
          where: { id: existingLead.id },
          data: { fields: { ...currentFields, ...row.fields } },
        });
        updatedCount += 1;
        continue;
      }
      alreadyExisted += 1;
      errors.push({
        row: row.rowNumber,
        email: row.email,
        reason: "Already exists in this workspace",
      });
      continue;
    }
    const verdict = args.verification?.verdicts[normalized];
    if (verdict) {
      const chosen = args.verification?.statuses ?? DEFAULT_IMPORT_STATUSES;
      if (!chosen.includes(verdict.status)) {
        verificationSkipped += 1;
        errors.push({
          row: row.rowNumber,
          email: row.email,
          reason: `Skipped by your import choice: ${verdict.status.toLowerCase()} addresses not selected`,
        });
        continue;
      }
    }
    toInsert.push({ ...row, email: normalized, verdict });
  }

  if (toInsert.length > 0) {
    await db.lead.createMany({
      data: toInsert.map((row) => ({
        workspaceId,
        listId,
        email: row.email,
        fields: row.fields,
        tags: [],
        status: "NEW" as const,
        ...(row.verdict
          ? {
              verificationStatus: row.verdict.status as VerificationStatus,
              verificationDetail: row.verdict.detail as object,
              verifiedAt: new Date(),
            }
          : {}),
      })),
    });
  }

  errors.sort((a, b) => a.row - b.row);
  return {
    listId,
    summary: {
      total: mapped.length,
      kept: toInsert.length,
      duplicates: deduped.summary.duplicates + alreadyExisted,
      invalid: deduped.summary.invalid,
      suppressed: suppressedCount,
      alreadyExisted,
      updated: updatedCount,
      verificationSkipped,
    },
    errors,
  };
}
