import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { classifyReply } from "@/lib/domain/classify";
import { writeAuditLog } from "@/lib/audit";

/**
 * Machine reply backfill (v1.11.0; extended v1.27.0).
 *
 * Threads classified before a machine label existed can sit in the
 * inbox wearing the wrong one: the Wati support routing reply sat
 * as REFERRAL before AUTOMATED existed, ticket receipts sat inside
 * AUTOMATED before TICKET was split out, and the October 2026
 * undelivered notices were labelled POSITIVE because nothing had a
 * NOT_FOUND bucket. This scans the workspace's AUTOMATED, POSITIVE,
 * REFERRAL, NEUTRAL, and unclassified threads, runs the full rules
 * engine over each thread's latest inbound message, and applies
 * the machine outcomes:
 *
 *   - NOT_FOUND and TICKET apply from any scanned label: a delivery
 *     failure or a ticket receipt is a fact about the message, not
 *     a reading of its tone, so even a POSITIVE mislabel is fixed.
 *   - AUTOMATED applies only from REFERRAL, NEUTRAL, or
 *     unclassified threads, exactly as the v1.11.0 pass behaved.
 *
 * NEGATIVE and OUT_OF_OFFICE threads are never touched: those
 * carry genuine human signal (or a deliberate manual override) and
 * a heuristic must not rewrite them. Thread and matching REPLIED
 * events are updated together, so inbox filters and reply metrics
 * agree.
 */
export async function POST() {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const threads = await prisma.thread.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        OR: [
          { classification: "AUTOMATED" },
          { classification: "POSITIVE" },
          { classification: "REFERRAL" },
          { classification: "NEUTRAL" },
          { classification: null },
        ],
      },
      select: {
        id: true,
        leadId: true,
        classification: true,
        messages: {
          where: { direction: "INBOUND" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { fromEmail: true, subject: true, body: true },
        },
      },
    });

    const byTarget = { AUTOMATED: 0, TICKET: 0, NOT_FOUND: 0 };
    let reclassified = 0;
    for (const thread of threads) {
      const latest = thread.messages[0];
      if (!latest) continue;
      const next = classifyReply(latest.subject, latest.body, latest.fromEmail);
      if (next !== "AUTOMATED" && next !== "TICKET" && next !== "NOT_FOUND") continue;
      if (next === thread.classification) continue;
      if (
        next === "AUTOMATED" &&
        thread.classification !== "REFERRAL" &&
        thread.classification !== "NEUTRAL" &&
        thread.classification !== null
      ) {
        continue;
      }
      await prisma.thread.update({
        where: { id: thread.id },
        data: { classification: next },
      });
      if (thread.leadId) {
        await prisma.emailEvent.updateMany({
          where: {
            workspaceId: ctx.workspace.id,
            type: "REPLIED",
            enrollment: { leadId: thread.leadId },
            classification: thread.classification,
          },
          data: { classification: next },
        });
      }
      byTarget[next] += 1;
      reclassified += 1;
    }

    await writeAuditLog({
      action: "threads.reclassify_automated",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { scanned: threads.length, reclassified, byTarget },
    });
    return NextResponse.json({ scanned: threads.length, reclassified, byTarget });
  } catch (error) {
    return apiError(error);
  }
}
