import type { VerificationStatus } from "./builtin";

/**
 * Optional verification provider: NeverBounce (Phase 6).
 *
 * The built-in checks in builtin.ts always run and are the floor.
 * When the owner sets VERIFY_API_KEY, single-address results are
 * additionally refined by NeverBounce's single check API
 * (GET https://api.neverbounce.com/v4/single/check), which maintains
 * a far larger disposable list and mailbox level data. Without the
 * key this module reports "not configured" and the built-in verdict
 * stands unchanged; nothing here pretends a provider check happened.
 *
 * Result mapping (NeverBounce "result" values):
 *   valid      -> VALID
 *   invalid    -> INVALID
 *   disposable -> RISKY (a real inbox today, a bounce risk tomorrow)
 *   catchall   -> RISKY (the domain accepts everything; unprovable)
 *   unknown    -> no change to the built-in verdict
 */

export const VERIFY_PROVIDER_NAME = "neverbounce";
export const VERIFY_API_KEY_ENV = "VERIFY_API_KEY";

export function verifyProviderMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return env[VERIFY_API_KEY_ENV] ? [] : [VERIFY_API_KEY_ENV];
}

export function verifyProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return verifyProviderMissingEnv(env).length === 0;
}

export interface ProviderVerdict {
  /** The provider's raw result string, for example "valid". */
  result: string;
  /** The status it maps to, or null when it changes nothing. */
  status: VerificationStatus | null;
}

const RESULT_MAP: Record<string, VerificationStatus | null> = {
  valid: "VALID",
  invalid: "INVALID",
  disposable: "RISKY",
  catchall: "RISKY",
  unknown: null,
};

type FetchImpl = typeof fetch;

/**
 * Calls the NeverBounce single check endpoint. Throws on transport
 * or API errors; the caller records the failure in the verification
 * detail and keeps the built-in verdict rather than failing the
 * whole verification run over a provider outage.
 */
export async function verifyWithProvider(
  email: string,
  options: { apiKey: string; fetchImpl?: FetchImpl },
): Promise<ProviderVerdict> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL("https://api.neverbounce.com/v4/single/check");
  url.searchParams.set("key", options.apiKey);
  url.searchParams.set("email", email);
  url.searchParams.set("address_info", "0");
  url.searchParams.set("credits_info", "0");
  url.searchParams.set("timeout", "10");
  const response = await fetchImpl(url.toString(), { method: "GET" });
  const data = (await response.json().catch(() => null)) as {
    status?: string;
    result?: string;
    message?: string;
  } | null;
  if (!response.ok || !data || data.status !== "success" || typeof data.result !== "string") {
    throw new Error(
      `NeverBounce check failed: ${data?.message ?? `HTTP ${response.status}`}`,
    );
  }
  return { result: data.result, status: RESULT_MAP[data.result] ?? null };
}
