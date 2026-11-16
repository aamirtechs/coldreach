/**
 * Download file names for verification exports (v1.35.1).
 *
 * Exports are named after the file the addresses came from, so a
 * run on "back-office-emails.csv" downloads as
 * "verified-good-back-office-emails.csv" for the good addresses,
 * "verified-risky-back-office-emails.csv" for the risky ones, and
 * so on. Pasted addresses (no source file) fall back to "emails".
 */

export type VerificationExportKind = "good" | "risky" | "bad" | "unknown" | "full";

/** Turns a source file name into a safe base name for exports. */
export function exportBaseName(sourceFileName?: string | null): string {
  if (!sourceFileName) return "emails";
  const withoutExtension = sourceFileName.replace(/\.[^.]+$/, "");
  const slug = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "emails";
}

export function verificationExportFileName(
  kind: VerificationExportKind,
  sourceFileName?: string | null,
): string {
  return `verified-${kind}-${exportBaseName(sourceFileName)}.csv`;
}
