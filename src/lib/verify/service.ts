import type { PrismaClient } from "@prisma/client";
import {
  runBuiltinChecks,
  type ResolveMx,
  type VerificationStatus,
} from "./builtin";
import {
  gatewayFromMxHosts,
  reacherApiUrl,
  reacherConfigured,
  verifyWithReacher,
  type ReacherVerdict,
} from "./reacher";

/**
 * Verification service (Phase 6).
 *
 * verifyLeadEmail runs the built-in checks for one address and, when
 * the Reacher sidecar is configured (REACHER_API_URL), refines the
 * verdict with its SMTP mailbox check. verifyList applies it to a
 * whole list in bounded batches and stores the outcome on each Lead
 * (verificationStatus, verificationDetail, verifiedAt). Statuses
 * feed campaign enrollment: INVALID leads are skipped (see
 * src/lib/campaigns/enroll.ts).
 */

export interface VerificationDetail {
  syntax: boolean;
  disposable: boolean;
  mx: string;
  provider: { name: string; result: string } | null;
  providerError: string | null;
  reasons: string[];
  checkedAt: string;
  source: "builtin" | "builtin+provider" | "external";
}

export interface VerifyDeps {
  resolveMx?: ResolveMx;
  /** Defaults to process.env.REACHER_API_URL; pass null to force
   *  the built-in checks only. */
  reacherUrl?: string | null;
  fetchImpl?: typeof fetch;
}

export interface LeadVerification {
  status: VerificationStatus;
  detail: VerificationDetail;
}

/**
 * Calls Reacher, retrying a transport or HTTP failure once before
 * giving up. A returned verdict is never retried. The retry exists
 * so a single dropped call under load cannot leave the built-in
 * verdict standing in for a probe that never happened: a Good
 * verdict should mean the probe confirmed the mailbox (v1.35.4).
 * A genuine sidecar outage still falls back after the one retry,
 * exactly as before.
 */
async function verifyWithReacherRetried(
  email: string,
  apiUrl: string,
  fetchImpl?: typeof fetch,
): Promise<ReacherVerdict> {
  try {
    return await verifyWithReacher(email, { apiUrl, fetchImpl });
  } catch {
    return verifyWithReacher(email, { apiUrl, fetchImpl });
  }
}

export async function verifyLeadEmail(
  email: string,
  deps: VerifyDeps = {},
): Promise<LeadVerification> {
  const builtin = await runBuiltinChecks(email, deps.resolveMx);
  const detail: VerificationDetail = {
    syntax: builtin.syntax,
    disposable: builtin.disposable,
    mx: builtin.mx,
    provider: null,
    providerError: null,
    reasons: [...builtin.reasons],
    checkedAt: new Date().toISOString(),
    source: "builtin",
  };
  let status = builtin.status;

  const apiUrl = deps.reacherUrl === null ? null : (deps.reacherUrl ?? reacherApiUrl());
  // A syntactically invalid address never reaches Reacher: the
  // verdict is already certain and the probe would waste time.
  if (apiUrl && builtin.syntax) {
    try {
      const verdict = await verifyWithReacherRetried(email, apiUrl, deps.fetchImpl);
      detail.provider = { name: "reacher", result: verdict.result };
      detail.source = "builtin+provider";
      if (verdict.status) {
        status = verdict.status;
        if (verdict.result === "invalid" && verdict.isDisabled === true) {
          // The receiving server explicitly flagged this account
          // as disabled or nonexistent. That is per-mailbox
          // evidence, so the Bad verdict stands, even behind a
          // probe-blocking gateway (v1.40.0).
          detail.reasons.push(
            'Reacher reports "invalid" and the receiving server flagged the account as disabled, so the verdict stands as Bad.',
          );
        } else if (verdict.result === "invalid") {
          // An "invalid" without the disabled flag is not
          // evidence about the mailbox: servers routinely refuse
          // the probe itself, and Reacher reports the refusal as
          // "invalid". Downgrade it to UNKNOWN so a real lead is
          // never dropped as Bad on the strength of a refused
          // probe (gateways v1.35.3, generalised v1.40.0).
          status = "UNKNOWN";
          const gateway = gatewayFromMxHosts(verdict.mxHosts);
          if (gateway) {
            detail.reasons.push(
              `Reacher reports "invalid", but this domain's mail is handled by ${gateway}, which blocks mailbox probes and rejects real and fake addresses alike. Marked Unknown rather than Bad.`,
            );
          } else {
            detail.reasons.push(
              'Reacher reports "invalid", but the receiving server did not flag the account as disabled, so the rejection is treated as a refused probe. Marked Unknown rather than Bad.',
            );
          }
        } else if (verdict.result === "unknown") {
          detail.reasons.push(
            'Reacher reports "unknown"; the probe could not confirm the mailbox, so the address is marked Unknown rather than Good.',
          );
        } else {
          detail.reasons.push(`Reacher reports "${verdict.result}".`);
        }
      } else {
        detail.reasons.push(`Reacher reports "${verdict.result}"; built-in verdict stands.`);
      }
    } catch (error) {
      detail.providerError = error instanceof Error ? error.message : "Reacher check failed";
      detail.reasons.push("Reacher check failed; built-in verdict stands.");
    }
  }

  return { status, detail };
}

/** Runs fn over items with a bounded number in flight at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export interface VerifyListSummary {
  total: number;
  valid: number;
  risky: number;
  invalid: number;
  unknown: number;
  providerConfigured: boolean;
}

const BATCH_SIZE = 100;

/**
 * Verifies every lead in one list, in batches, storing each result.
 * Tenant scoped by workspaceId on both the list lookup and every
 * lead read and write.
 */
export async function verifyList(
  db: PrismaClient,
  args: { workspaceId: string; listId: string },
  deps: VerifyDeps = {},
): Promise<VerifyListSummary> {
  const list = await db.leadList.findFirst({
    where: { id: args.listId, workspaceId: args.workspaceId },
    select: { id: true },
  });
  if (!list) {
    throw Object.assign(new Error("Lead list not found"), { status: 404 });
  }

  const summary: VerifyListSummary = {
    total: 0,
    valid: 0,
    risky: 0,
    invalid: 0,
    unknown: 0,
    providerConfigured: reacherConfigured(),
  };

  let cursor: string | undefined;
  for (;;) {
    const batch = await db.lead.findMany({
      where: { workspaceId: args.workspaceId, listId: list.id },
      select: { id: true, email: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) {
      break;
    }
    // SMTP probes are slow (seconds each), so a batch verifies with
    // modest concurrency instead of one address at a time.
    const outcomes = await mapWithConcurrency(batch, 5, async (lead) => {
      const { status, detail } = await verifyLeadEmail(lead.email, deps);
      await db.lead.update({
        where: { id: lead.id },
        data: {
          verificationStatus: status,
          verificationDetail: detail as unknown as object,
          verifiedAt: new Date(detail.checkedAt),
        },
      });
      return status;
    });
    for (const status of outcomes) {
      summary.total += 1;
      if (status === "VALID") summary.valid += 1;
      else if (status === "RISKY") summary.risky += 1;
      else if (status === "INVALID") summary.invalid += 1;
      else summary.unknown += 1;
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE) {
      break;
    }
  }
  return summary;
}
