import type { PrismaClient } from "@prisma/client";
import { parseCsv } from "@/lib/csv";
import { dedupeImport, normalizeEmail, type ImportRow } from "@/lib/domain/dedupe";
import { findSuppression } from "@/lib/domain/suppression";
import { loadSuppressions } from "@/lib/suppressions";

/**
 * Lead CSV import.
 *
 * Pipeline, in order: parse, map columns, dedupe within the file
 * (dedupe engine), drop rows that already exist in the workspace, drop
 * suppressed rows, insert the rest. Nothing reaches the database before
 * every check has run, and every rejected row is reported with its
 * original 1-based file row number and a reason, which the UI offers as
 * a downloadable error report.
 */

export interface ColumnMapping {
  /** CSV column name to target. Target "email" is the address itself,
   *  "ignore" drops the column, anything else is stored as a lead field
   *  under that name (firstName, lastName, company, or any custom key). */
  [csvColumn: string]: string;
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
}

export interface ImportResult {
  summary: ImportSummary;
  errors: ImportRowError[];
  listId: string;
}

interface MappedRow extends ImportRow {
  rowNumber: number;
  fields: Record<string, string>;
}

export async function importLeadsFromCsv(
  db: PrismaClient,
  args: {
    workspaceId: string;
    listId: string;
    csvText: string;
    mapping: ColumnMapping;
    stripPlusTag?: boolean;
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
        select: { email: true },
      })
    : [];
  const existingSet = new Set(existing.map((lead) => lead.email.toLowerCase()));

  let suppressedCount = 0;
  let alreadyExisted = 0;
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
    if (existingSet.has(normalized)) {
      alreadyExisted += 1;
      errors.push({
        row: row.rowNumber,
        email: row.email,
        reason: "Already exists in this workspace",
      });
      continue;
    }
    toInsert.push({ ...row, email: normalized });
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
    },
    errors,
  };
}
