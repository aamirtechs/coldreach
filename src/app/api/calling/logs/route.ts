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
        callLeadId: true,
        scriptId: true,
        disposition: true,
        notes: true,
        durationSeconds: true,
        followUpAt: true,
        calledAt: true,
        lead: { select: { email: true, fields: true } },
        callLead: {
          select: {
            firstName: true,
            lastName: true,
            company: true,
            phone: true,
            email: true,
            fields: true,
          },
        },
      },
    });
    const stats = summarizeCallLogs(logs);
    const due = callbacksDue(logs);
    // Name resolution (v1.47.0): a log linked to a dedicated call
    // lead resolves its display ref from the CallLead; older logs
    // keep resolving from the email Lead as before.
    const refFor = (log: (typeof logs)[number]) => {
      if (log.callLead) {
        return {
          email: log.callLead.email ?? "",
          fields: {
            ...((log.callLead.fields as Record<string, unknown>) ?? {}),
            firstName: log.callLead.firstName,
            lastName: log.callLead.lastName,
            company: log.callLead.company,
            phone: log.callLead.phone,
          },
        };
      }
      return log.lead;
    };
    const refByKey = new Map<string, ReturnType<typeof refFor>>();
    for (const log of logs) {
      const key = log.callLeadId ?? log.leadId;
      if (key && !refByKey.has(key)) refByKey.set(key, refFor(log));
    }
    const callbacks = due.map((entry) => {
      const key = entry.log.callLeadId ?? entry.log.leadId;
      return {
        logId: entry.log.id,
        leadId: key,
        disposition: entry.log.disposition,
        followUpAt: entry.followUpAt,
        due: entry.due,
        lead: key ? (refByKey.get(key) ?? null) : null,
      };
    });
    const history = logs.slice(0, HISTORY_LIMIT).map((log) => ({
      id: log.id,
      leadId: log.callLeadId ?? log.leadId,
      scriptId: log.scriptId,
      disposition: log.disposition,
      notes: log.notes,
      durationSeconds: log.durationSeconds,
      followUpAt: log.followUpAt,
      calledAt: log.calledAt,
      lead: refFor(log),
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
    callLeadId?: unknown;
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
  const callLeadId = stringField(body.callLeadId) || null;
  const scriptId = stringField(body.scriptId) || null;
  try {
    if (callLeadId) {
      const callLead = await prisma.callLead.findFirst({
        where: { id: callLeadId, workspaceId: ctx.workspace.id },
        select: { id: true },
      });
      if (!callLead) return NextResponse.json({ error: "Call lead not found" }, { status: 404 });
    }
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
        callLeadId,
        scriptId,
        disposition: body.disposition,
        notes: notes || null,
        durationSeconds,
        followUpAt,
      },
      select: {
        id: true,
        leadId: true,
        callLeadId: true,
        scriptId: true,
        disposition: true,
        notes: true,
        durationSeconds: true,
        followUpAt: true,
        calledAt: true,
      },
    });
    if (callLeadId) {
      await prisma.callLead.update({
        where: { id: callLeadId },
        data: { lastCallAt: log.calledAt },
      });
    }
    await writeAuditLog({
      action: "call_log.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { callLogId: log.id, leadId, callLeadId, disposition: log.disposition },
    });
    return NextResponse.json({ log }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
