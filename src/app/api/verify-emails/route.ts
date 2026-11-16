import { NextResponse } from "next/server";
import { apiError, readJson, requireSession } from "@/lib/api";
import {
  MAX_IMPORT_VERIFY_EMAILS,
  verifyPreparedImportEmails,
} from "@/lib/leads/importVerify";
import { normalizeEmail } from "@/lib/domain/dedupe";
import { writeAuditLog } from "@/lib/audit";

/**
 * Standalone email verification (v1.35.0): the Verify Emails tool in
 * the sidebar. The client sends a plain list of addresses (pasted
 * or extracted from a CSV); the response streams NDJSON progress
 * lines and ends with the verdicts, exactly like the import
 * wizard's verify step, but nothing is stored anywhere: the tool
 * exists to check addresses and download the results as CSV.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ emails?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (!Array.isArray(body.emails)) {
    return NextResponse.json({ error: "emails must be an array of addresses" }, { status: 400 });
  }

  const unique = new Map<string, string>();
  for (const entry of body.emails) {
    if (typeof entry !== "string") continue;
    const raw = entry.trim();
    if (!raw) continue;
    const normalized = normalizeEmail(raw);
    if (!unique.has(normalized)) {
      unique.set(normalized, raw);
    }
  }
  const emails = [...unique.keys()];
  if (emails.length === 0) {
    return NextResponse.json({ error: "No addresses to verify" }, { status: 400 });
  }
  if (emails.length > MAX_IMPORT_VERIFY_EMAILS) {
    return NextResponse.json(
      {
        error: `That is ${emails.length} unique addresses; verification supports up to ${MAX_IMPORT_VERIFY_EMAILS} at a time. Split the list and run it in parts.`,
      },
      { status: 400 },
    );
  }

  let stopped = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          stopped = true;
        }
      };
      send({ type: "start", total: emails.length, totalRows: emails.length });
      try {
        const result = await verifyPreparedImportEmails(emails, {}, {
          shouldStop: () => stopped,
          onProgress: (progress) => send({ type: "progress", ...progress }),
        });
        await writeAuditLog({
          action: "verify.standalone",
          userId: ctx.user.id,
          workspaceId: ctx.workspace.id,
          metadata: { uniqueEmails: emails.length, counts: { ...result.counts } },
        });
        send({
          type: "done",
          totalRows: emails.length,
          uniqueEmails: emails.length,
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
