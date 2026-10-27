import type { PrismaClient } from "@prisma/client";
import {
  runBuiltinChecks,
  type ResolveMx,
  type VerificationStatus,
} from "./builtin";
import { verifyProviderConfigured, verifyWithProvider } from "./provider";

/**
 * Verification service (Phase 6).
 *
 * verifyLeadEmail runs the built-in checks for one address and, when
 * VERIFY_API_KEY is configured, refines the verdict with the
 * provider. verifyList applies it to a whole list in bounded batches
 * and stores the outcome on each Lead (verificationStatus,
 * verificationDetail, verifiedAt). Statuses feed campaign
 * enrollment: INVALID leads are skipped (see
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
  /** Defaults to process.env.VERIFY_API_KEY; pass null to force the
   *  built-in checks only. */
  providerApiKey?: string | null;
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

  const apiKey =
    deps.providerApiKey === null
      ? null
      : (deps.providerApiKey ?? (verifyProviderConfigured() ? process.env.VERIFY_API_KEY : null));
  // A syntactically invalid address never reaches the provider: the
  // verdict is already certain and the call would waste credits.
  if (apiKey && builtin.syntax) {
    try {
      const verdict = await verifyWithProvider(email, { apiKey, fetchImpl: deps.fetchImpl });
      detail.provider = { name: "neverbounce", result: verdict.result };
      detail.source = "builtin+provider";
      if (verdict.status) {
        status = verdict.status;
        detail.reasons.push(`Provider (NeverBounce) reports "${verdict.result}".`);
      } else {
        detail.reasons.push(`Provider (NeverBounce) reports "${verdict.result}"; built-in verdict stands.`);
      }
    } catch (error) {
      detail.providerError = error instanceof Error ? error.message : "Provider check failed";
      detail.reasons.push("Provider check failed; built-in verdict stands.");
    }
  }

  return { status, detail };
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
    providerConfigured: verifyProviderConfigured(),
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
    for (const lead of batch) {
      const { status, detail } = await verifyLeadEmail(lead.email, deps);
      await db.lead.update({
        where: { id: lead.id },
        data: {
          verificationStatus: status,
          verificationDetail: detail as unknown as object,
          verifiedAt: new Date(detail.checkedAt),
        },
      });
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
