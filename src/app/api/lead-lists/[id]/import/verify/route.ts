import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { prepareImportVerification, verifyPreparedImportEmails } from "@/lib/leads/importVerify";
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
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{ csvText?: unknown; emailColumn?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (typeof body.csvText !== "string" || !body.csvText.trim()) {
    return NextResponse.json({ error: "csvText is required" }, { status: 400 });
  }
  if (typeof body.emailColumn !== "string" || !body.emailColumn) {
    return NextResponse.json({ error: "emailColumn is required" }, { status: 400 });
  }

  let prepared;
  try {
    const list = await prisma.leadList.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    prepared = prepareImportVerification(body.csvText, body.emailColumn);
  } catch (error) {
    return apiError(error);
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
