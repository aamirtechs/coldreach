import type { PrismaClient } from "@prisma/client";
import {
  runBuiltinChecks,
  type ResolveMx,
  type VerificationStatus,
} from "./builtin";
import { reacherApiUrl, reacherConfigured, verifyWithReacher } from "./reacher";

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
  source: "builtin" | "builtin+provider";
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
      const verdict = await verifyWithReacher(email, { apiUrl, fetchImpl: deps.fetchImpl });
      detail.provider = { name: "reacher", result: verdict.result };
      detail.source = "builtin+provider";
      if (verdict.status) {
        status = verdict.status;
        detail.reasons.push(
          verdict.result === "unknown"
            ? 'Reacher reports "unknown"; the probe could not confirm the mailbox, so the address is marked Unknown rather than Good.'
            : `Reacher reports "${verdict.result}".`,
        );
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
