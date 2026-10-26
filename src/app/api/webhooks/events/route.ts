import { NextResponse } from "next/server";
import { apiError, readJson } from "@/lib/api";
import { applyProviderEvent, type InboundEventType } from "@/lib/worker/applyEvent";
import { prisma } from "@/lib/prisma";

const EVENT_TYPES: InboundEventType[] = ["DELIVERED", "BOUNCED", "REPLIED", "UNSUBSCRIBED", "COMPLAINED"];

function authorized(request: Request): boolean {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const providedWebhook = request.headers.get("x-webhook-secret");
  if (webhookSecret && providedWebhook && providedWebhook === webhookSecret) {
    return true;
  }
  if (!webhookSecret) {
    const workerSecret = process.env.WORKER_SECRET;
    const providedWorker = request.headers.get("x-worker-secret");
    if (workerSecret && providedWorker && providedWorker === workerSecret) {
      return true;
    }
  }
  return false;
}

/**
 * Provider event ingestion. This is the seam real provider webhooks will
 * call in Phase 3; today it is exercised by operators and tests. Events
 * are applied idempotently: the same logical event never counts twice,
 * and reply, bounce, unsubscribe, and complaint outcomes stop the
 * enrollment's remaining steps.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await readJson<{
    providerMessageId?: unknown;
    enrollmentId?: unknown;
    stepIndex?: unknown;
    type?: unknown;
    classification?: unknown;
    occurredAt?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const type = typeof body.type === "string" ? body.type : "";
  if (!EVENT_TYPES.includes(type as InboundEventType)) {
    return NextResponse.json(
      { error: `type must be one of ${EVENT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  try {
    const result = await applyProviderEvent(prisma, {
      providerMessageId: typeof body.providerMessageId === "string" ? body.providerMessageId : undefined,
      enrollmentId: typeof body.enrollmentId === "string" ? body.enrollmentId : undefined,
      stepIndex: typeof body.stepIndex === "number" ? body.stepIndex : undefined,
      type: type as InboundEventType,
      classification: typeof body.classification === "string" ? body.classification : undefined,
      occurredAt: typeof body.occurredAt === "string" ? new Date(body.occurredAt) : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
