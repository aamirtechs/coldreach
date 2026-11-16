import type { VerificationStatus } from "./builtin";

/**
 * Verification provider: a self-hosted Reacher sidecar
 * (check-if-email-exists), the only provider since v1.34.0;
 * NeverBounce was removed at Amir's direction so verification has
 * no per-check cost and no outside dependency. Configured by
 * REACHER_API_URL pointing at the sidecar, for example
 * http://127.0.0.1:8080 on the production server, where it runs as
 * a Docker container bound to localhost.
 *
 * Reacher performs the SMTP level mailbox check the built-in checks
 * cannot: it connects to the receiving server and asks whether the
 * mailbox exists, without sending any mail. That needs outbound
 * port 25 on the host, which RackNerd allows (probed 2026-11-15).
 *
 * Result mapping (Reacher "is_reachable"):
 *   safe    -> VALID
 *   invalid -> INVALID
 *   risky   -> RISKY (catch-all domain, full inbox, disabled or
 *              role mailbox: deliverability unproven either way)
 *   unknown -> null (the probe was inconclusive; the built-in
 *              verdict stands rather than guessing)
 */

export const REACHER_API_URL_ENV = "REACHER_API_URL";
export const REACHER_PROVIDER_NAME = "reacher";

export function reacherApiUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[REACHER_API_URL_ENV]?.trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/\/+$/, "");
}

export function reacherConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return reacherApiUrl(env) !== null;
}

export function reacherMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return reacherConfigured(env) ? [] : [REACHER_API_URL_ENV];
}

export interface ReacherVerdict {
  /** The provider's raw is_reachable string, for example "safe". */
  result: string;
  /** The status it maps to, or null when it changes nothing. */
  status: VerificationStatus | null;
}

const RESULT_MAP: Record<string, VerificationStatus | null> = {
  safe: "VALID",
  invalid: "INVALID",
  risky: "RISKY",
  unknown: null,
};

type FetchImpl = typeof fetch;

/**
 * Calls the sidecar's POST /v0/check_email. Throws on transport or
 * HTTP errors; the caller records the failure in the verification
 * detail and keeps the built-in verdict rather than failing the
 * whole verification run over a sidecar outage.
 */
export async function verifyWithReacher(
  email: string,
  options: {
    apiUrl: string;
    fetchImpl?: FetchImpl;
    timeoutMs?: number;
    helloName?: string;
  },
): Promise<ReacherVerdict> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const signal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  const response = await fetchImpl(`${options.apiUrl}/v0/check_email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to_email: email,
      ...(options.helloName ? { hello_name: options.helloName } : {}),
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Reacher check failed (HTTP ${response.status})`);
  }
  const data = (await response.json()) as { is_reachable?: unknown };
  const result = typeof data.is_reachable === "string" ? data.is_reachable : "unknown";
  return { result, status: RESULT_MAP[result] ?? null };
}
