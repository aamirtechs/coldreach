/**
 * Guessing which CSV column holds external verdicts (v1.36.0).
 *
 * This helper lives apart from externalVerdicts.ts on purpose:
 * the import wizard is a client component and imports it in the
 * browser, while externalVerdicts.ts pulls in the server-side
 * verification chain (DNS, the Reacher client) that must never
 * land in a client bundle.
 */

const VERDICT_HEADER_CANDIDATES = [
  "result",
  "verificationresult",
  "emailresult",
  "status",
  "verificationstatus",
  "emailstatus",
  "verdict",
  "verificationverdict",
  "quality",
  "emailquality",
  "deliverability",
  "valid",
];

/**
 * Guesses which column holds external verdicts, or returns ""
 * when no header looks like one. MillionVerifier reports carry
 * both "quality" and "result"; "result" wins because it is the
 * more precise of the two.
 */
export function guessExternalVerdictColumn(headers: string[]): string {
  const byCanonical = new Map<string, string>();
  for (const header of headers) {
    const canonical = header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!byCanonical.has(canonical)) {
      byCanonical.set(canonical, header);
    }
  }
  for (const candidate of VERDICT_HEADER_CANDIDATES) {
    const found = byCanonical.get(candidate);
    if (found) {
      return found;
    }
  }
  return "";
}
