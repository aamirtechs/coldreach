/**
 * Suppression matching.
 *
 * A contact is suppressed when any suppression entry matches their exact
 * email address, or an entry covers their whole domain. Callers pass the
 * combined workspace and global entries that apply; scope is carried on
 * each entry so the matching rule can be reported accurately.
 */

export type SuppressionScopeValue = "WORKSPACE" | "GLOBAL";

export interface SuppressionEntry {
  scope: SuppressionScopeValue;
  email?: string | null;
  domain?: string | null;
  reason?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function domainOfEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) {
    return null;
  }
  return email.slice(at + 1).toLowerCase();
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@+/, "");
}

/**
 * Returns the first matching suppression entry, or null when the address
 * is clear to contact. Matching is case-insensitive.
 */
export function findSuppression(
  email: string,
  suppressions: SuppressionEntry[],
): SuppressionEntry | null {
  const target = normalizeEmail(email);
  const domain = domainOfEmail(target);
  for (const entry of suppressions) {
    if (entry.email && normalizeEmail(entry.email) === target) {
      return entry;
    }
    if (entry.domain && domain && normalizeDomain(entry.domain) === domain) {
      return entry;
    }
  }
  return null;
}

export function isSuppressed(email: string, suppressions: SuppressionEntry[]): boolean {
  return findSuppression(email, suppressions) !== null;
}
