import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { callbacksDue, logLeadKey, summarizeCallLogs } from "@/lib/calling/stats";
import { shapeCallLead } from "@/lib/calling/callLeadShape";
import { sortCallLeads } from "@/lib/calling/statePriority";
import { CALLING_SERVICES, CALLING_CADENCE_RULES, SCORE_BLOCKS } from "@/lib/calling/services";
import { CallingWorkspace, type CallingInitialData } from "@/components/calling/CallingWorkspace";

export const dynamic = "force-dynamic";

const SCAN_LIMIT = 5000;
const HISTORY_LIMIT = 100;

/**
 * Calling section (v1.47.0): a dedicated call lead system, fully
 * separate from the email Leads. The page loads the workspace's
 * call lists, call leads, scripts, the service catalog and recent
 * logs server side; every mutation goes through /api/calling.
 * Older logs linked to email leads still resolve their names for
 * history, but nothing here writes to the email side.
 */
export default async function CallingPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const workspaceId = session.workspace.id;

  const [lists, leads, scripts, logs] = await Promise.all([
    prisma.callLeadList.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, serviceSlug: true },
    }),
    prisma.callLead.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: SCAN_LIMIT,
    }),
    prisma.callScript.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, body: true, objectionNotes: true, createdAt: true, updatedAt: true },
    }),
    prisma.callLog.findMany({
      where: { workspaceId },
      orderBy: { calledAt: "desc" },
      take: SCAN_LIMIT,
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
    }),
  ]);

  const lastCallByLead = new Map<string, { disposition: string; calledAt: string }>();
  for (const log of logs) {
    const key = logLeadKey(log);
    if (key && !lastCallByLead.has(key)) {
      lastCallByLead.set(key, {
        disposition: log.disposition,
        calledAt: log.calledAt.toISOString(),
      });
    }
  }

  const shapedLeads = sortCallLeads(
    leads.map((lead) => shapeCallLead(lead, lastCallByLead.get(lead.id) ?? null)),
  );

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
    const key = logLeadKey(log);
    if (key && !refByKey.has(key)) refByKey.set(key, refFor(log));
  }

  const initial: CallingInitialData = {
    lists,
    leads: shapedLeads,
    scripts: scripts.map((script) => ({
      ...script,
      createdAt: script.createdAt.toISOString(),
      updatedAt: script.updatedAt.toISOString(),
    })),
    services: CALLING_SERVICES,
    cadenceRules: CALLING_CADENCE_RULES,
    scoreBlocks: SCORE_BLOCKS,
    stats: summarizeCallLogs(logs),
    callbacks: callbacksDue(logs).map((entry) => {
      const key = logLeadKey(entry.log);
      return {
        logId: entry.log.id,
        leadId: key,
        disposition: entry.log.disposition,
        followUpAt: entry.followUpAt.toISOString(),
        due: entry.due,
        lead: key ? (refByKey.get(key) ?? null) : null,
      };
    }),
    history: logs.slice(0, HISTORY_LIMIT).map((log) => ({
      id: log.id,
      leadId: logLeadKey(log),
      scriptId: log.scriptId,
      disposition: log.disposition,
      notes: log.notes,
      durationSeconds: log.durationSeconds,
      followUpAt: log.followUpAt ? log.followUpAt.toISOString() : null,
      calledAt: log.calledAt.toISOString(),
      lead: refFor(log),
    })),
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Calling</h1>
      <p className="mt-1 text-sm text-muted">
        A dedicated calling pipeline, separate from your email leads: scored prospects per
        service, a full screen call mode with the branching script, and manual verification
        for every claim before you dial.
      </p>
      <CallingWorkspace initial={initial} />
    </div>
  );
}
