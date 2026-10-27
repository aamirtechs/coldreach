import { promises as dns } from "node:dns";
import { isValidEmail } from "@/lib/domain/dedupe";
import { isDisposableDomain } from "./disposable";

/**
 * Built-in email verification checks (Phase 6).
 *
 * These always run, with no external service: a syntax check, a
 * disposable-domain check against the bundled partial list, and an
 * MX existence check over DNS. They answer "can this address
 * plausibly receive mail", not "does this mailbox exist": only the
 * receiving server knows that, and no checker can honestly promise
 * more. Results therefore degrade to UNKNOWN whenever the evidence
 * is inconclusive (notably when DNS cannot be reached), rather than
 * guessing INVALID.
 */

export type VerificationStatus = "UNKNOWN" | "VALID" | "RISKY" | "INVALID";

export type MxOutcome = "found" | "missing" | "unknown" | "skipped";

/** Resolves a domain's MX state. Injectable for tests. */
export type ResolveMx = (domain: string) => Promise<Exclude<MxOutcome, "skipped">>;

/**
 * Default MX lookup over Node DNS. ENODATA and ENOTFOUND mean the
 * domain itself answered and has no MX, which is "missing". Any
 * other failure (timeout, refused, unreachable resolver) is
 * "unknown": the check could not be performed, and callers must not
 * treat that as a bad address.
 */
export const dnsResolveMx: ResolveMx = async (domain) => {
  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0 ? "found" : "missing";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENODATA" || code === "ENOTFOUND") {
      return "missing";
    }
    return "unknown";
  }
};

/**
 * Stricter syntax gate than the import path's pattern: RFC length
 * limits, no leading/trailing or consecutive dots in the local part,
 * and a domain with a real TLD. The import dedupe pattern stays the
 * lenient floor for accepting rows; verification is where strictness
 * belongs.
 */
export function hasValidSyntax(email: string): boolean {
  const cleaned = email.trim();
  if (cleaned.length === 0 || cleaned.length > 254) {
    return false;
  }
  if (!isValidEmail(cleaned)) {
    return false;
  }
  const at = cleaned.lastIndexOf("@");
  const local = cleaned.slice(0, at);
  const domain = cleaned.slice(at + 1);
  if (local.length === 0 || local.length > 64) {
    return false;
  }
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return false;
  }
  if (!domain.includes(".") || domain.split(".").some((label) => label.length === 0)) {
    return false;
  }
  return true;
}

export function domainOf(email: string): string {
  const cleaned = email.trim().toLowerCase();
  const at = cleaned.lastIndexOf("@");
  return at >= 0 ? cleaned.slice(at + 1) : "";
}

export interface BuiltinResult {
  status: VerificationStatus;
  syntax: boolean;
  disposable: boolean;
  mx: MxOutcome;
  reasons: string[];
}

/**
 * Runs the built-in checks for one address. Pure apart from the
 * injected MX resolver, so tests drive every branch without DNS.
 */
export async function runBuiltinChecks(
  email: string,
  resolveMx: ResolveMx = dnsResolveMx,
): Promise<BuiltinResult> {
  const reasons: string[] = [];
  if (!hasValidSyntax(email)) {
    reasons.push("Address fails syntax validation.");
    return { status: "INVALID", syntax: false, disposable: false, mx: "skipped", reasons };
  }
  const domain = domainOf(email);
  const disposable = isDisposableDomain(domain);
  const mx = await resolveMx(domain);
  if (mx === "missing") {
    reasons.push(`Domain ${domain} publishes no MX records, so mail to it cannot be delivered.`);
    return { status: "INVALID", syntax: true, disposable, mx, reasons };
  }
  if (disposable) {
    reasons.push(`Domain ${domain} is a known disposable mailbox service (bundled partial list).`);
    return { status: "RISKY", syntax: true, disposable, mx, reasons };
  }
  if (mx === "unknown") {
    reasons.push("MX records could not be checked (DNS unreachable), so deliverability is unproven.");
    return { status: "UNKNOWN", syntax: true, disposable, mx, reasons };
  }
  reasons.push(`Domain ${domain} publishes MX records.`);
  return { status: "VALID", syntax: true, disposable, mx, reasons };
}
