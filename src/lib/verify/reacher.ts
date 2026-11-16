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
 *   unknown -> UNKNOWN (the probe ran but could not confirm the
 *              mailbox; since v1.35.2 the address is marked
 *              Unknown rather than letting the built-in checks
 *              call it VALID on syntax and MX alone, which is how
 *              a fake outlook.com address once read as Good)
 *
 * A transport or HTTP failure is different from an inconclusive
 * answer: verifyWithReacher throws for those, and the caller keeps
 * the built-in verdict, so a sidecar outage never reclassifies a
 * whole run as Unknown.
 *
 * Gateway caveat (v1.35.3): some domains sit behind enterprise
 * mail gateways (Microsoft 365, Sophos, Proofpoint, Mimecast,
 * Barracuda) that refuse mailbox probes from untrusted sources,
 * rejecting real and fake recipients alike. An "invalid" from
 * such a domain carries no per-mailbox information, so the
 * service layer downgrades it to UNKNOWN using gatewayFromMxHosts
 * below and the MX hosts parsed from the same probe response.
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
  /** The status it maps to, or null for an unrecognized result. */
  status: VerificationStatus | null;
  /** MX hostnames from the same probe response (may be empty). */
  mxHosts: string[];
}

/**
 * Enterprise mail gateways that refuse mailbox probes from
 * untrusted sources. An "invalid" verdict for a domain whose MX
 * points at one of these says nothing about the mailbox: the
 * gateway rejects every recipient it is asked about. Matched by
 * hostname suffix, case-insensitively.
 */
const GATEWAY_MX_SUFFIXES: { suffix: string; name: string }[] = [
  { suffix: "mail.protection.outlook.com", name: "Microsoft 365" },
  { suffix: "hydra.sophos.com", name: "Sophos" },
  { suffix: "pphosted.com", name: "Proofpoint" },
  { suffix: "ppe-hosted.com", name: "Proofpoint Essentials" },
  { suffix: "mimecast.com", name: "Mimecast" },
  { suffix: "barracudanetworks.com", name: "Barracuda" },
];

/**
 * Returns the gateway's display name when any MX host belongs to
 * a known probe-blocking gateway, or null when the domain's mail
 * is served by a host that answers probes normally.
 */
export function gatewayFromMxHosts(mxHosts: string[]): string | null {
  for (const host of mxHosts) {
    const normalized = host.trim().toLowerCase().replace(/\.+$/, "");
    for (const gateway of GATEWAY_MX_SUFFIXES) {
      if (normalized === gateway.suffix || normalized.endsWith(`.${gateway.suffix}`)) {
        return gateway.name;
      }
    }
  }
  return null;
}

const RESULT_MAP: Record<string, VerificationStatus | null> = {
  safe: "VALID",
  invalid: "INVALID",
  risky: "RISKY",
  unknown: "UNKNOWN",
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
  const data = (await response.json()) as {
    is_reachable?: unknown;
    mx?: { records?: unknown };
  };
  const result = typeof data.is_reachable === "string" ? data.is_reachable : "unknown";
  const records = Array.isArray(data.mx?.records) ? data.mx.records : [];
  const mxHosts = records.filter((r): r is string => typeof r === "string");
  return { result, status: RESULT_MAP[result] ?? null, mxHosts };
}
