import { parseCsv } from "@/lib/csv";
import { normalizeEmail } from "@/lib/domain/dedupe";
import type { VerificationStatus } from "@/lib/verify/builtin";
import {
  mapWithConcurrency,
  verifyLeadEmail,
  type VerificationDetail,
  type VerifyDeps,
} from "@/lib/verify/service";

/**
 * Pre-import verification (v1.34.0): step 2 of the import wizard.
 *
 * The wizard uploads a CSV, the user confirms which column holds
 * the email, and this runs the verifier (built-in checks plus the
 * Reacher SMTP probe when configured) over the file's unique
 * addresses BEFORE anything is saved. The wizard shows the counts,
 * the user chooses whether risky and unknown addresses come along,
 * and the final import step receives these verdicts: INVALID
 * addresses are never imported, and imported leads carry their
 * verdicts so they do not need verifying again.
 */

export interface ImportVerdict {
  status: VerificationStatus;
  detail: VerificationDetail;
}

export interface ImportVerifyResult {
  totalRows: number;
  uniqueEmails: number;
  counts: { valid: number; risky: number; invalid: number; unknown: number };
  verdicts: Record<string, ImportVerdict>;
}

/** SMTP probes take seconds each; a single wizard verification is
 *  capped so one import cannot occupy the verifier for an hour. */
export const MAX_IMPORT_VERIFY_EMAILS = 1000;

export async function verifyImportEmails(
  csvText: string,
  emailColumn: string,
  deps: VerifyDeps = {},
): Promise<ImportVerifyResult> {
  const parsed = parseCsv(csvText);
  if (parsed.headers.length === 0) {
    throw Object.assign(new Error("The CSV file is empty or has no header row"), { status: 400 });
  }
  if (!parsed.headers.includes(emailColumn)) {
    throw Object.assign(new Error("The email column was not found in the file"), { status: 400 });
  }

  const unique = new Map<string, string>();
  for (const row of parsed.rows) {
    const raw = (row[emailColumn] ?? "").trim();
    if (!raw) {
      continue;
    }
    const normalized = normalizeEmail(raw);
    if (!unique.has(normalized)) {
      unique.set(normalized, raw);
    }
  }
  const emails = [...unique.keys()];
  if (emails.length > MAX_IMPORT_VERIFY_EMAILS) {
    throw Object.assign(
      new Error(
        `This file has ${emails.length} unique addresses; verification supports up to ${MAX_IMPORT_VERIFY_EMAILS} per import. Split the file and import in parts.`,
      ),
      { status: 400 },
    );
  }

  const outcomes = await mapWithConcurrency(emails, 8, async (email) => ({
    email,
    ...(await verifyLeadEmail(email, deps)),
  }));

  const counts = { valid: 0, risky: 0, invalid: 0, unknown: 0 };
  const verdicts: Record<string, ImportVerdict> = {};
  for (const outcome of outcomes) {
    verdicts[outcome.email] = { status: outcome.status, detail: outcome.detail };
    if (outcome.status === "VALID") counts.valid += 1;
    else if (outcome.status === "RISKY") counts.risky += 1;
    else if (outcome.status === "INVALID") counts.invalid += 1;
    else counts.unknown += 1;
  }

  return { totalRows: parsed.rows.length, uniqueEmails: emails.length, counts, verdicts };
}
