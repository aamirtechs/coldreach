import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { isAutomatedReply } from "@/lib/domain/classify";
import { writeAuditLog } from "@/lib/audit";

/**
 * Automated reply backfill (v1.11.0).
 *
 * Threads classified before AUTOMATED existed can sit in the inbox
 * as REFERRAL or NEUTRAL even though the reply was a machine notice
 * (the Wati support routing reply was exactly that case). This scans
 * the workspace's REFERRAL, NEUTRAL, and unclassified threads, runs
 * the automated detector over each thread's latest inbound message,
 * and updates matches to AUTOMATED, thread and matching REPLIED
 * events alike, so inbox filters and reply metrics agree.
 *
 * Threads classified POSITIVE, NEGATIVE, or OUT_OF_OFFICE are never
 * touched: those carry genuine human signal (or a deliberate manual
 * override) and a heuristic must not rewrite them.
 */
export async function POST() {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const threads = await prisma.thread.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        OR: [{ classification: "REFERRAL" }, { classification: "NEUTRAL" }, { classification: null }],
      },
      select: {
        id: true,
        leadId: true,
        messages: {
          where: { direction: "INBOUND" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { fromEmail: true, subject: true, body: true },
        },
      },
    });

    let reclassified = 0;
    for (const thread of threads) {
      const latest = thread.messages[0];
      if (!latest) continue;
      if (!isAutomatedReply(latest.fromEmail, latest.subject, latest.body)) continue;
      await prisma.thread.update({
        where: { id: thread.id },
        data: { classification: "AUTOMATED" },
      });
      if (thread.leadId) {
        await prisma.emailEvent.updateMany({
          where: {
            workspaceId: ctx.workspace.id,
            type: "REPLIED",
            enrollment: { leadId: thread.leadId },
            OR: [{ classification: "REFERRAL" }, { classification: "NEUTRAL" }, { classification: null }],
          },
          data: { classification: "AUTOMATED" },
        });
      }
      reclassified += 1;
    }

    await writeAuditLog({
      action: "threads.reclassify_automated",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { scanned: threads.length, reclassified },
    });
    return NextResponse.json({ scanned: threads.length, reclassified });
  } catch (error) {
    return apiError(error);
  }
}
