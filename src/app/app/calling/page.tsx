import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { callbacksDue, summarizeCallLogs } from "@/lib/calling/stats";
import { CallingWorkspace, type CallingInitialData } from "@/components/calling/CallingWorkspace";

export const dynamic = "force-dynamic";

const SCAN_LIMIT = 5000;
const HISTORY_LIMIT = 100;

/**
 * Calling section (v1.43.0): call leads with a script in front of the
 * caller, and the tracking that follows from each logged call. The
 * page loads the workspace's lists, leads, scripts and recent logs
 * server side; every mutation goes through the /api/calling routes.
 */
export default async function CallingPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const workspaceId = session.workspace.id;

  const [lists, leads, scripts, logs] = await Promise.all([
    prisma.leadList.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lead.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: SCAN_LIMIT,
      select: { id: true, email: true, listId: true, fields: true },
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
        scriptId: true,
        disposition: true,
        notes: true,
        durationSeconds: true,
        followUpAt: true,
        calledAt: true,
        lead: { select: { email: true, fields: true } },
      },
    }),
  ]);

  const lastCallByLead = new Map<string, { disposition: string; calledAt: string }>();
  for (const log of logs) {
    if (log.leadId && !lastCallByLead.has(log.leadId)) {
      lastCallByLead.set(log.leadId, {
        disposition: log.disposition,
        calledAt: log.calledAt.toISOString(),
      });
    }
  }

  const shapedLeads = leads.map((lead) => {
    const fields =
      lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
        ? (lead.fields as Record<string, unknown>)
        : {};
    const phoneKey = Object.keys(fields).find((key) => key.toLowerCase() === "phone");
    const phone =
      phoneKey && typeof fields[phoneKey] === "string" ? (fields[phoneKey] as string) : "";
    return {
      id: lead.id,
      email: lead.email,
      listId: lead.listId,
      fields,
      phone,
      lastCall: lastCallByLead.get(lead.id) ?? null,
    };
  });
  const orderedLeads = [
    ...shapedLeads.filter((lead) => lead.phone),
    ...shapedLeads.filter((lead) => !lead.phone),
  ];

  const leadById = new Map(logs.filter((l) => l.leadId).map((l) => [l.leadId as string, l.lead]));
  const initial: CallingInitialData = {
    lists,
    leads: orderedLeads,
    scripts: scripts.map((script) => ({
      ...script,
      createdAt: script.createdAt.toISOString(),
      updatedAt: script.updatedAt.toISOString(),
    })),
    stats: summarizeCallLogs(logs),
    callbacks: callbacksDue(logs).map((entry) => ({
      logId: entry.log.id,
      leadId: entry.log.leadId,
      disposition: entry.log.disposition,
      followUpAt: entry.followUpAt.toISOString(),
      due: entry.due,
      lead: entry.log.leadId ? (leadById.get(entry.log.leadId) ?? null) : null,
    })),
    history: logs.slice(0, HISTORY_LIMIT).map((log) => ({
      id: log.id,
      leadId: log.leadId,
      scriptId: log.scriptId,
      disposition: log.disposition,
      notes: log.notes,
      durationSeconds: log.durationSeconds,
      followUpAt: log.followUpAt ? log.followUpAt.toISOString() : null,
      calledAt: log.calledAt.toISOString(),
      lead: log.lead,
    })),
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Calling</h1>
      <p className="mt-1 text-sm text-muted">
        Call your leads with the script in front of you, log every outcome, and keep callbacks
        from slipping. Phone numbers live on the lead, next to the email history.
      </p>
      <CallingWorkspace initial={initial} />
    </div>
  );
}
