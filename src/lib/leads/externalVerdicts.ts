import { parseCsv } from "@/lib/csv";
import { normalizeEmail } from "@/lib/domain/dedupe";
import type { VerificationStatus } from "@/lib/verify/builtin";
import type { VerificationDetail } from "@/lib/verify/service";
import {
  MAX_IMPORT_VERIFY_EMAILS,
  type ImportVerifyCounts,
  type ImportVerifyResult,
  type ImportVerdict,
} from "./importVerify";

/**
 * External verdicts (v1.36.0): the import wizard's skip option.
 *
 * When a file was already verified by another tool (a
 * MillionVerifier report, for example), the wizard can read the
 * verdicts straight out of a column in the file instead of
 * probing every address again. Values are mapped onto ColdReach
 * statuses with a deliberately conservative vocabulary: a value
 * is only Good when the other tool clearly said the mailbox is
 * fine, and anything unrecognized becomes UNKNOWN, never Good.
 * Imported leads store the verdict with source "external" and
 * the raw value, so it is always visible that ColdReach did not
 * verify the address itself.
 */

const VALID_VALUES = new Set([
  "ok",
  "valid",
  "valid email",
  "good",
  "safe",
  "deliverable",
  "verified",
  "exists",
  "exist",
  "clean",
  "pass",
  "passed",
  "true",
  "1",
  "yes",
]);

const RISKY_VALUES = new Set([
  "catch all",
  "accept all",
  "risky",
  "risk",
]);

const INVALID_VALUES = new Set([
  "invalid",
  "invalid email",
  "bad",
  "bad email",
  "undeliverable",
  "disposable",
  "bounce",
  "bounced",
  "hard bounce",
  "not found",
  "no such user",
  "mailbox not found",
  "does not exist",
  "syntax error",
  "fail",
  "failed",
  "dead",
  "false",
  "0",
  "no",
]);

/** Canonical form for comparison: lowercase, with runs of
 *  spaces, underscores and hyphens collapsed to one space, so
 *  "catch_all", "Catch-All" and "catch all" are the same value. */
function canonicalVerdictValue(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/**
 * Maps one external verdict value onto a ColdReach status.
 * MillionVerifier's result column (ok, catch_all, invalid,
 * disposable) and quality column (good, risky, bad) are covered,
 * along with the common generic vocabularies. Anything else,
 * including an empty cell, is UNKNOWN.
 */
export function mapExternalVerdict(raw: string): VerificationStatus {
  const value = canonicalVerdictValue(raw);
  if (VALID_VALUES.has(value)) return "VALID";
  if (RISKY_VALUES.has(value)) return "RISKY";
  if (INVALID_VALUES.has(value)) return "INVALID";
  return "UNKNOWN";
}

export { guessExternalVerdictColumn } from "./verdictColumn";

/**
 * Builds import verdicts from a verdict column already present
 * in the file, with no probing at all. Mirrors
 * prepareImportVerification's contract: the same 400s for an
 * unusable file, first occurrence wins on duplicate addresses,
 * and the same per-import cap.
 */
export function buildExternalVerdicts(
  csvText: string,
  emailColumn: string,
  verdictColumn: string,
): ImportVerifyResult {
  const parsed = parseCsv(csvText);
  if (parsed.headers.length === 0) {
    throw Object.assign(new Error("The CSV file is empty or has no header row"), { status: 400 });
  }
  if (!parsed.headers.includes(emailColumn)) {
    throw Object.assign(new Error("The email column was not found in the file"), { status: 400 });
  }
  if (!parsed.headers.includes(verdictColumn)) {
    throw Object.assign(new Error("The verdict column was not found in the file"), { status: 400 });
  }

  const rawByEmail = new Map<string, string>();
  for (const row of parsed.rows) {
    const raw = (row[emailColumn] ?? "").trim();
    if (!raw) {
      continue;
    }
    const normalized = normalizeEmail(raw);
    if (!rawByEmail.has(normalized)) {
      rawByEmail.set(normalized, (row[verdictColumn] ?? "").trim());
    }
  }
  if (rawByEmail.size > MAX_IMPORT_VERIFY_EMAILS) {
    throw Object.assign(
      new Error(
        `This file has ${rawByEmail.size} unique addresses; an import supports up to ${MAX_IMPORT_VERIFY_EMAILS} per import. Split the file and import in parts.`,
      ),
      { status: 400 },
    );
  }

  const counts: ImportVerifyCounts = { valid: 0, risky: 0, invalid: 0, unknown: 0 };
  const verdicts: Record<string, ImportVerdict> = {};
  const checkedAt = new Date().toISOString();
  for (const [email, rawVerdict] of rawByEmail) {
    const status = mapExternalVerdict(rawVerdict);
    if (status === "VALID") counts.valid += 1;
    else if (status === "RISKY") counts.risky += 1;
    else if (status === "INVALID") counts.invalid += 1;
    else counts.unknown += 1;
    const detail: VerificationDetail = {
      syntax: true,
      disposable: false,
      mx: "external",
      provider: { name: "external", result: rawVerdict },
      providerError: null,
      reasons: [
        `External verification result ${rawVerdict ? `"${rawVerdict}"` : "(empty cell)"} imported from column "${verdictColumn}"; ColdReach verification was skipped for this import.`,
      ],
      checkedAt,
      source: "external",
    };
    verdicts[email] = { status, detail };
  }
  return { totalRows: parsed.rows.length, uniqueEmails: rawByEmail.size, counts, verdicts };
}
