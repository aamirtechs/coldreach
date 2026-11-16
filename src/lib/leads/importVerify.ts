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
 * addresses BEFORE anything is saved. Since v1.35.0 the route
 * streams progress as each address completes, so the wizard shows
 * a live progress bar, ticking counts, the latest results and an
 * estimated time remaining, the way hosted verifiers do. The final
 * import step receives the verdicts: rows in groups the user did
 * not select are skipped, and imported leads carry their verdicts
 * so they do not need verifying again.
 */

export interface ImportVerdict {
  status: VerificationStatus;
  detail: VerificationDetail;
}

export interface ImportVerifyCounts {
  valid: number;
  risky: number;
  invalid: number;
  unknown: number;
}

export interface ImportVerifyResult {
  totalRows: number;
  uniqueEmails: number;
  counts: ImportVerifyCounts;
  verdicts: Record<string, ImportVerdict>;
}

export interface ImportVerifyProgress {
  done: number;
  total: number;
  counts: ImportVerifyCounts;
  last: { email: string; status: VerificationStatus };
}

export interface PreparedImport {
  totalRows: number;
  emails: string[];
}

/** SMTP probes take seconds each; a single wizard verification is
 *  capped so one import cannot occupy the verifier for an hour. */
export const MAX_IMPORT_VERIFY_EMAILS = 1000;

/** Parses the file and collects its unique addresses. Throws a
 *  400 before any verification starts when the file is unusable. */
export function prepareImportVerification(csvText: string, emailColumn: string): PreparedImport {
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
  return { totalRows: parsed.rows.length, emails };
}

/**
 * Verifies prepared addresses with bounded concurrency, reporting
 * progress after every completed address. When shouldStop reports
 * true (the wizard user cancelled), no new probes start and the
 * run ends by throwing an "Import verification cancelled" error;
 * nothing is stored by this step, so a cancelled run leaves no
 * partial state behind.
 */
export async function verifyPreparedImportEmails(
  emails: string[],
  deps: VerifyDeps = {},
  options: {
    onProgress?: (progress: ImportVerifyProgress) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<{ counts: ImportVerifyCounts; verdicts: Record<string, ImportVerdict> }> {
  const counts: ImportVerifyCounts = { valid: 0, risky: 0, invalid: 0, unknown: 0 };
  const verdicts: Record<string, ImportVerdict> = {};
  let done = 0;

  const outcomes = await mapWithConcurrency(emails, 8, async (email) => {
    if (options.shouldStop?.()) {
      return null;
    }
    const outcome = { email, ...(await verifyLeadEmail(email, deps)) };
    done += 1;
    if (outcome.status === "VALID") counts.valid += 1;
    else if (outcome.status === "RISKY") counts.risky += 1;
    else if (outcome.status === "INVALID") counts.invalid += 1;
    else counts.unknown += 1;
    options.onProgress?.({
      done,
      total: emails.length,
      counts: { ...counts },
      last: { email: outcome.email, status: outcome.status },
    });
    return outcome;
  });

  if (options.shouldStop?.()) {
    throw Object.assign(new Error("Import verification cancelled"), { status: 499 });
  }
  for (const outcome of outcomes) {
    if (outcome) {
      verdicts[outcome.email] = { status: outcome.status, detail: outcome.detail };
    }
  }
  return { counts, verdicts };
}

export async function verifyImportEmails(
  csvText: string,
  emailColumn: string,
  deps: VerifyDeps = {},
  options: {
    onProgress?: (progress: ImportVerifyProgress) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<ImportVerifyResult> {
  const prepared = prepareImportVerification(csvText, emailColumn);
  const { counts, verdicts } = await verifyPreparedImportEmails(prepared.emails, deps, options);
  return { totalRows: prepared.totalRows, uniqueEmails: prepared.emails.length, counts, verdicts };
}
