/**
 * Deliverability DNS evaluation: SPF, DKIM, and DMARC.
 *
 * Pure evaluation over lookup results, so it is fully testable with
 * fixture records and never touches the network itself. The caller
 * (src/lib/deliverability/dnsService.ts) performs the actual DNS
 * queries and hands the raw records here.
 *
 * Every finding states what was found, how bad it is, and the exact fix
 * in plain language. Grades are a summary of the findings, computed
 * from the weights below; nothing here can promise inbox placement,
 * and the report says so wherever it is rendered.
 */

export interface DnsLookupResult {
  /** All TXT records at the domain root (SPF lives among them). */
  rootTxtRecords: string[];
  /** The TXT record at _dmarc.<domain>, or null when absent. */
  dmarcRecord: string | null;
  /** DKIM TXT record per selector tried; null means no record found. */
  dkimRecords: Record<string, string | null>;
  /** Transport level problems (NXDOMAIN, timeouts). Evaluation still
   *  runs on whatever was retrieved; errors become "unknown" findings. */
  errors: string[];
}

export type FindingStatus = "pass" | "warn" | "fail" | "unknown";
export type FindingSeverity = "info" | "low" | "medium" | "high";

export interface DnsFinding {
  check: "SPF" | "DKIM" | "DMARC";
  status: FindingStatus;
  severity: FindingSeverity;
  message: string;
  fix: string;
}

export interface DnsReport {
  domain: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  findings: DnsFinding[];
  spfRecord: string | null;
  dmarcRecord: string | null;
  dkimSelectorsFound: string[];
}

const GRADE_POINTS: Record<FindingStatus, number> = {
  pass: 0,
  unknown: 8,
  warn: 12,
  fail: 30,
};

function gradeFor(score: number): DnsReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 55) return "C";
  if (score >= 35) return "D";
  return "F";
}

/** Counts DNS lookups an SPF record triggers, per RFC 7208 section 4.6.4. */
export function countSpfLookups(spfRecord: string): number {
  const mechanisms = spfRecord.toLowerCase().split(/\s+/);
  let count = 0;
  for (const token of mechanisms) {
    const bare = token.replace(/^[+\-~?]/, "");
    if (
      bare.startsWith("include:") ||
      bare === "a" ||
      bare.startsWith("a:") ||
      bare.startsWith("a/") ||
      bare === "mx" ||
      bare.startsWith("mx:") ||
      bare.startsWith("mx/") ||
      bare === "ptr" ||
      bare.startsWith("ptr:") ||
      bare.startsWith("exists:") ||
      bare.startsWith("redirect=")
    ) {
      count += 1;
    }
  }
  return count;
}

function evaluateSpf(lookups: DnsLookupResult, findings: DnsFinding[]): string | null {
  const spfRecords = lookups.rootTxtRecords.filter((record) =>
    record.toLowerCase().startsWith("v=spf1"),
  );
  if (lookups.errors.length > 0 && lookups.rootTxtRecords.length === 0) {
    findings.push({
      check: "SPF",
      status: "unknown",
      severity: "medium",
      message: "SPF could not be verified because the DNS lookup failed.",
      fix: "Retry the check. If it keeps failing, confirm the domain resolves in public DNS.",
    });
    return null;
  }
  if (spfRecords.length === 0) {
    findings.push({
      check: "SPF",
      status: "fail",
      severity: "high",
      message: "No SPF record found. Receiving servers cannot verify which mail servers may send for this domain.",
      fix: "Publish one TXT record at the domain root starting with v=spf1 that lists your sending providers, ending with -all, for example: v=spf1 include:_spf.google.com -all",
    });
    return null;
  }
  if (spfRecords.length > 1) {
    findings.push({
      check: "SPF",
      status: "fail",
      severity: "high",
      message: `Found ${spfRecords.length} SPF records. RFC 7208 allows exactly one; multiple records make SPF fail outright.`,
      fix: "Merge the mechanisms from all records into a single v=spf1 TXT record and delete the others.",
    });
    return spfRecords[0];
  }

  const record = spfRecords[0];
  const lookupsUsed = countSpfLookups(record);
  if (lookupsUsed > 10) {
    findings.push({
      check: "SPF",
      status: "fail",
      severity: "high",
      message: `The SPF record triggers about ${lookupsUsed} DNS lookups, over the RFC limit of 10, so SPF evaluation fails at many receivers.`,
      fix: "Remove unused include: mechanisms, or replace them with ip4/ip6 entries for your own servers, until the record needs 10 or fewer lookups.",
    });
  } else if (lookupsUsed >= 8) {
    findings.push({
      check: "SPF",
      status: "warn",
      severity: "medium",
      message: `The SPF record triggers about ${lookupsUsed} DNS lookups, close to the RFC limit of 10.`,
      fix: "Audit the include: list and drop providers you no longer send through, before the count crosses the limit.",
    });
  } else {
    findings.push({
      check: "SPF",
      status: "pass",
      severity: "info",
      message: `SPF record present and within the DNS lookup limit (about ${lookupsUsed} of 10 used).`,
      fix: "No action needed.",
    });
  }

  const tokens = record.toLowerCase().split(/\s+/);
  const allToken = tokens.find((token) => token.endsWith("all") && token.length <= 4);
  if (!allToken) {
    findings.push({
      check: "SPF",
      status: "warn",
      severity: "medium",
      message: "The SPF record has no 'all' mechanism, so it gives receivers no instruction for senders it does not list.",
      fix: "End the record with -all once you are sure every legitimate sender is listed.",
    });
  } else if (allToken.startsWith("-")) {
    findings.push({
      check: "SPF",
      status: "pass",
      severity: "info",
      message: "SPF ends with -all (hard fail), the strongest sender policy.",
      fix: "No action needed.",
    });
  } else if (allToken.startsWith("~")) {
    findings.push({
      check: "SPF",
      status: "warn",
      severity: "low",
      message: "SPF ends with ~all (soft fail). Receivers treat unlisted senders leniently, which weakens spoofing protection.",
      fix: "Move to -all once you have confirmed every legitimate sending service is included in the record.",
    });
  } else {
    findings.push({
      check: "SPF",
      status: "fail",
      severity: "high",
      message: `SPF ends with ${allToken}, which tells receivers to accept or ignore mail from any sender. The record provides almost no protection.`,
      fix: "Change the ending to -all (or ~all while you audit your senders).",
    });
  }
  return record;
}

/** Rough RSA key size estimate from a DKIM p= value (base64 DER). */
export function estimateDkimKeyBits(base64Key: string): number | null {
  const cleaned = base64Key.replace(/\s+/g, "");
  if (!cleaned || cleaned.length < 40) {
    return null;
  }
  const derBytes = Math.floor((cleaned.length * 3) / 4);
  // A DER encoded RSA public key is roughly modulus bytes + 30 bytes of
  // structure. Map the size back to the familiar key lengths.
  if (derBytes >= 270) return 2048;
  if (derBytes >= 200) return 1536;
  if (derBytes >= 140) return 1024;
  return 512;
}

function evaluateDkim(
  lookups: DnsLookupResult,
  findings: DnsFinding[],
): string[] {
  const found: string[] = [];
  for (const [selector, record] of Object.entries(lookups.dkimRecords)) {
    if (record && /p=[^;\s]+/.test(record) && !/p=\s*(;|$)/.test(record)) {
      found.push(selector);
      const keyMatch = record.match(/p=([^;]+)/);
      const bits = keyMatch ? estimateDkimKeyBits(keyMatch[1]) : null;
      if (bits !== null && bits < 2048) {
        findings.push({
          check: "DKIM",
          status: "warn",
          severity: "medium",
          message: `DKIM selector "${selector}" uses an estimated ${bits} bit key. Keys under 2048 bits are considered weak and some receivers distrust them.`,
          fix: `Rotate the "${selector}" signing key to 2048 bits in your mail provider, then update the DNS record.`,
        });
      } else {
        findings.push({
          check: "DKIM",
          status: "pass",
          severity: "info",
          message: `DKIM record found for selector "${selector}"${bits ? ` with an estimated ${bits} bit key` : ""}.`,
          fix: "No action needed.",
        });
      }
    } else if (record) {
      findings.push({
        check: "DKIM",
        status: "warn",
        severity: "medium",
        message: `DKIM selector "${selector}" has a record but its public key (p=) is empty, which usually means the key was revoked.`,
        fix: "Either publish the current public key for this selector or remove the record if the selector is retired.",
      });
    }
  }
  if (found.length === 0) {
    findings.push({
      check: "DKIM",
      status: "unknown",
      severity: "medium",
      message:
        "No DKIM record found for the common selectors checked (google, selector1, selector2, default). DKIM may exist under a different selector, or may not be set up at all.",
      fix: "Check your sending provider for the exact selector it signs with, and publish its DKIM TXT record at <selector>._domainkey.<domain>. Unsigned mail is far more likely to be filtered.",
    });
  }
  return found;
}

function evaluateDmarc(lookups: DnsLookupResult, findings: DnsFinding[]): void {
  const record = lookups.dmarcRecord;
  if (!record) {
    if (lookups.errors.length > 0) {
      findings.push({
        check: "DMARC",
        status: "unknown",
        severity: "medium",
        message: "DMARC could not be verified because the DNS lookup failed.",
        fix: "Retry the check. If it keeps failing, confirm the domain resolves in public DNS.",
      });
      return;
    }
    findings.push({
      check: "DMARC",
      status: "fail",
      severity: "high",
      message: "No DMARC record found. Anyone can spoof this domain and you get no reports about it.",
      fix: "Publish a TXT record at _dmarc.<domain>, starting with: v=DMARC1; p=none; rua=mailto:dmarc@<domain> and move to p=quarantine or p=reject once reports look clean.",
    });
    return;
  }
  const tags = new Map<string, string>();
  for (const part of record.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length > 0) {
      tags.set(key.trim().toLowerCase(), rest.join("=").trim().toLowerCase());
    }
  }
  const policy = tags.get("p");
  if (policy === "reject") {
    findings.push({
      check: "DMARC",
      status: "pass",
      severity: "info",
      message: "DMARC policy is p=reject, the strongest setting: spoofed mail is refused.",
      fix: "No action needed.",
    });
  } else if (policy === "quarantine") {
    findings.push({
      check: "DMARC",
      status: "pass",
      severity: "low",
      message: "DMARC policy is p=quarantine: spoofed mail is sent to spam rather than refused.",
      fix: "Consider moving to p=reject once your legitimate senders all pass alignment.",
    });
  } else if (policy === "none") {
    findings.push({
      check: "DMARC",
      status: "warn",
      severity: "medium",
      message: "DMARC policy is p=none: the domain is monitored but spoofed mail is still delivered.",
      fix: "After reviewing a few weeks of aggregate reports, move to p=quarantine, then p=reject.",
    });
  } else {
    findings.push({
      check: "DMARC",
      status: "fail",
      severity: "high",
      message: "A DMARC record exists but has no valid p= policy tag, so receivers ignore it.",
      fix: "Fix the record so it reads, for example: v=DMARC1; p=none; rua=mailto:dmarc@<domain>",
    });
  }

  const pct = tags.get("pct");
  if (pct && pct !== "100") {
    findings.push({
      check: "DMARC",
      status: "warn",
      severity: "low",
      message: `DMARC pct is ${pct}, so the policy only applies to that percentage of failing mail.`,
      fix: "Raise pct to 100 once you are confident in the policy.",
    });
  }
  if (!tags.get("rua")) {
    findings.push({
      check: "DMARC",
      status: "warn",
      severity: "low",
      message: "DMARC has no rua tag, so you receive no aggregate reports about who sends as this domain.",
      fix: "Add rua=mailto:an-inbox-you-read@<domain> to the DMARC record to start receiving reports.",
    });
  }
  const aspf = tags.get("aspf");
  const adkim = tags.get("adkim");
  if (aspf === "s" || adkim === "s") {
    findings.push({
      check: "DMARC",
      status: "warn",
      severity: "low",
      message: "DMARC uses strict alignment (aspf/adkim = s). Legitimate sub-domain senders can fail alignment.",
      fix: "Keep strict alignment only if every sender uses the exact organisational domain; otherwise relax to r (the default).",
    });
  }
}

export function evaluateDns(domain: string, lookups: DnsLookupResult): DnsReport {
  const findings: DnsFinding[] = [];
  const spfRecord = evaluateSpf(lookups, findings);
  const dkimSelectorsFound = evaluateDkim(lookups, findings);
  evaluateDmarc(lookups, findings);
  const penalty = findings.reduce((sum, finding) => sum + GRADE_POINTS[finding.status], 0);
  let score = Math.max(0, 100 - penalty);
  // When every lookup failed at transport level and nothing at all was
  // retrieved, the domain is unverifiable rather than healthy: three
  // "unknown" findings alone would leave a misleading 76, so the score
  // is capped in the C band and the UI presents it as unable to verify.
  const nothingRetrieved =
    lookups.errors.length > 0 &&
    lookups.rootTxtRecords.length === 0 &&
    lookups.dmarcRecord === null &&
    Object.values(lookups.dkimRecords).every((record) => record === null);
  if (nothingRetrieved) {
    score = Math.min(score, 55);
  }
  return {
    domain: domain.trim().toLowerCase(),
    grade: gradeFor(score),
    score,
    findings,
    spfRecord,
    dmarcRecord: lookups.dmarcRecord,
    dkimSelectorsFound,
  };
}
