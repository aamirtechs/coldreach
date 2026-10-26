import { promises as dns } from "node:dns";
import {
  evaluateDns,
  type DnsLookupResult,
  type DnsReport,
} from "@/lib/domain/dnsCheck";

/** Common DKIM selectors probed when checking a domain. Providers use
 *  many others; the evaluator reports "unknown" (not failure) when
 *  none of these answer, since DKIM may live under another selector. */
const DKIM_SELECTORS = ["google", "selector1", "selector2", "default"] as const;

/**
 * Live DNS lookups behind the pure evaluator in domain/dnsCheck.ts.
 *
 * TXT records come back from resolvers as arrays of string chunks
 * (long records are split at 255 characters); they are joined before
 * matching. Every lookup failure is captured into the errors list so
 * the evaluator can report "unable to verify" instead of the API
 * crashing on a domain that simply has no record.
 */

async function resolveTxtSafe(hostname: string, errors: string[]): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(hostname);
    return records.map((chunks) => chunks.join(""));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code !== "ENODATA" && code !== "ENOTFOUND") {
      errors.push(`${hostname}: ${code}`);
    }
    return [];
  }
}

export function normalizeDomain(input: string): string | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^@/, "");
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

export async function checkDomain(rawDomain: string): Promise<DnsReport> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    throw Object.assign(new Error("Enter a valid domain, for example example.com"), {
      status: 400,
    });
  }
  const errors: string[] = [];
  const [rootTxtRecords, dmarcTxtRecords] = await Promise.all([
    resolveTxtSafe(domain, errors),
    resolveTxtSafe(`_dmarc.${domain}`, errors),
  ]);
  const dkimRecords: Record<string, string | null> = {};
  for (const selector of DKIM_SELECTORS) {
    const records = await resolveTxtSafe(`${selector}._domainkey.${domain}`, errors);
    const dkim = records.find((record) => /v=DKIM1/i.test(record) || /(^|\s|;)p=/.test(record));
    dkimRecords[selector] = dkim ?? null;
  }
  const lookups: DnsLookupResult = {
    rootTxtRecords,
    dmarcRecord: dmarcTxtRecords.find((record) => record.toLowerCase().startsWith("v=dmarc1")) ?? null,
    dkimRecords,
    errors,
  };
  return evaluateDns(domain, lookups);
}
