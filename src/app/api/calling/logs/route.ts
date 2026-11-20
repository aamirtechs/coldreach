import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { isCallDisposition } from "@/lib/calling/dispositions";
import { callbacksDue, summarizeCallLogs } from "@/lib/calling/stats";

const MAX_NOTES_LENGTH = 4000;
const HISTORY_LIMIT = 100;
const STATS_SCAN_LIMIT = 10000;

/**
 * Call history, tracking stats and the callbacks-due list for the
 * Calling section, all scoped to the session workspace. Stats and
 * callbacks are computed by the pure helpers in lib/calling/stats
 * over a bounded scan of the workspace's logs.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const logs = await prisma.callLog.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { calledAt: "desc" },
      take: STATS_SCAN_LIMIT,
      select: {
        id: true,
        leadId: true,
        scriptId: true,
        disposition: true,
        notes: true,
        durationSeconds: true,
        followUpAt: true,
        calledAt: true,
        lead: { select: { email: true, fields: true } },
      },
    });
    const stats = summarizeCallLogs(logs);
    const due = callbacksDue(logs);
    const leadById = new Map(logs.filter((l) => l.leadId).map((l) => [l.leadId as string, l.lead]));
    const callbacks = due.map((entry) => ({
      logId: entry.log.id,
      leadId: entry.log.leadId,
      disposition: entry.log.disposition,
      followUpAt: entry.followUpAt,
      due: entry.due,
      lead: entry.log.leadId ? (leadById.get(entry.log.leadId) ?? null) : null,
    }));
    const history = logs.slice(0, HISTORY_LIMIT).map((log) => ({
      id: log.id,
      leadId: log.leadId,
      scriptId: log.scriptId,
      disposition: log.disposition,
      notes: log.notes,
      durationSeconds: log.durationSeconds,
      followUpAt: log.followUpAt,
      calledAt: log.calledAt,
      lead: log.lead,
    }));
    return NextResponse.json({ stats, callbacks, history });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Log one call. The lead and script ids, when given, must belong to
 * the session workspace; a foreign id reads as not found rather than
 * linking another tenant's data into this workspace's history.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{
    leadId?: unknown;
    scriptId?: unknown;
    disposition?: unknown;
    notes?: unknown;
    durationMinutes?: unknown;
    durationSeconds?: unknown;
    followUpAt?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (!isCallDisposition(body.disposition)) {
    return NextResponse.json({ error: "A valid disposition is required" }, { status: 400 });
  }
  const notes = stringField(body.notes);
  if (notes.length > MAX_NOTES_LENGTH) {
    return NextResponse.json(
      { error: `Notes must be ${MAX_NOTES_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }
  let durationSeconds: number | null = null;
  if (body.durationSeconds !== undefined && body.durationSeconds !== null) {
    durationSeconds = intField(body.durationSeconds, 0);
  } else if (body.durationMinutes !== undefined && body.durationMinutes !== null) {
    durationSeconds = Math.round(intField(body.durationMinutes, 0) * 60);
  }
  if (durationSeconds !== null && durationSeconds < 0) {
    return NextResponse.json({ error: "Duration cannot be negative" }, { status: 400 });
  }
  let followUpAt: Date | null = null;
  const followUpRaw = stringField(body.followUpAt);
  if (followUpRaw) {
    const parsed = new Date(followUpRaw);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Follow up date is not a valid date" }, { status: 400 });
    }
    followUpAt = parsed;
  }
  const leadId = stringField(body.leadId) || null;
  const scriptId = stringField(body.scriptId) || null;
  try {
    if (leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: leadId, workspaceId: ctx.workspace.id },
        select: { id: true },
      });
      if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (scriptId) {
      const script = await prisma.callScript.findFirst({
        where: { id: scriptId, workspaceId: ctx.workspace.id },
        select: { id: true },
      });
      if (!script) return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }
    const log = await prisma.callLog.create({
      data: {
        workspaceId: ctx.workspace.id,
        leadId,
        scriptId,
        disposition: body.disposition,
        notes: notes || null,
        durationSeconds,
        followUpAt,
      },
      select: {
        id: true,
        leadId: true,
        scriptId: true,
        disposition: true,
        notes: true,
        durationSeconds: true,
        followUpAt: true,
        calledAt: true,
      },
    });
    await writeAuditLog({
      action: "call_log.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { callLogId: log.id, leadId, disposition: log.disposition },
    });
    return NextResponse.json({ log }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
