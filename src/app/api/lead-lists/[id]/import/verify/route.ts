import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import {
  prepareImportVerification,
  verifyPreparedImportEmails,
  type ImportVerifyResult,
} from "@/lib/leads/importVerify";
import { buildExternalVerdicts } from "@/lib/leads/externalVerdicts";
import { canUseVerification } from "@/lib/admin/featureAccess";
import { writeAuditLog } from "@/lib/audit";

/**
 * Step 2 of the import wizard: verify the uploaded file's unique
 * addresses before anything is imported (v1.34.0). Since v1.35.0
 * the response streams NDJSON progress lines as each address
 * completes ({type:"start"}, {type:"progress", done, total,
 * counts, last}), ending with {type:"done", ...result} or
 * {type:"error"}, so the wizard can show a live progress bar,
 * ticking counts and an estimated time remaining. Validation
 * failures are answered before the stream starts, as plain JSON.
 *
 * Since v1.36.0 there are two modes. With a verdictColumn in the
 * body, the file already carries verdicts from another tool: they
 * are read straight from that column (no probing) and the stream
 * answers start then done immediately. Without one, the probing
 * path runs, and probing is gated: it is owner-only until the
 * platform admin opens verification to all users, so other users
 * get a 403 here (their wizard offers the external path or an
 * unverified import instead).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{
    csvText?: unknown;
    emailColumn?: unknown;
    verdictColumn?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (typeof body.csvText !== "string" || !body.csvText.trim()) {
    return NextResponse.json({ error: "csvText is required" }, { status: 400 });
  }
  if (typeof body.emailColumn !== "string" || !body.emailColumn) {
    return NextResponse.json({ error: "emailColumn is required" }, { status: 400 });
  }
  const verdictColumn =
    typeof body.verdictColumn === "string" && body.verdictColumn ? body.verdictColumn : null;

  let prepared: { totalRows: number; emails: string[] };
  let external: ImportVerifyResult | null = null;
  try {
    const list = await prisma.leadList.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    if (verdictColumn) {
      external = buildExternalVerdicts(body.csvText, body.emailColumn, verdictColumn);
      prepared = { totalRows: external.totalRows, emails: Object.keys(external.verdicts) };
    } else {
      prepared = prepareImportVerification(body.csvText, body.emailColumn);
    }
  } catch (error) {
    return apiError(error);
  }

  if (!external && !(await canUseVerification(prisma, ctx.user.email))) {
    return NextResponse.json({ error: "Email verification is coming soon." }, { status: 403 });
  }

  let stopped = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          // The client went away mid-run; shouldStop ends the work.
          stopped = true;
        }
      };
      send({ type: "start", total: prepared.emails.length, totalRows: prepared.totalRows });
      try {
        if (external) {
          await writeAuditLog({
            action: "lead.import_verify",
            userId: ctx.user.id,
            workspaceId: ctx.workspace.id,
            metadata: {
              listId: id,
              uniqueEmails: external.uniqueEmails,
              counts: { ...external.counts },
              external: true,
              verdictColumn,
            },
          });
          send({
            type: "done",
            totalRows: external.totalRows,
            uniqueEmails: external.uniqueEmails,
            counts: external.counts,
            verdicts: external.verdicts,
          });
        } else {
          const result = await verifyPreparedImportEmails(prepared.emails, {}, {
            shouldStop: () => stopped,
            onProgress: (progress) => send({ type: "progress", ...progress }),
          });
          await writeAuditLog({
            action: "lead.import_verify",
            userId: ctx.user.id,
            workspaceId: ctx.workspace.id,
            metadata: { listId: id, uniqueEmails: prepared.emails.length, counts: { ...result.counts } },
          });
          send({
            type: "done",
            totalRows: prepared.totalRows,
            uniqueEmails: prepared.emails.length,
            counts: result.counts,
            verdicts: result.verdicts,
          });
        }
      } catch (error) {
        if (!stopped) {
          send({
            type: "error",
            error: error instanceof Error ? error.message : "Verification failed",
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the runtime when the client hung up.
        }
      }
    },
    cancel() {
      stopped = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
