/**
 * READ-ONLY lead trace for a sending investigation, 2026-11-13.
 * Usage: DATABASE_URL=<prod> npx tsx scripts/investigate-lead-trace.ts <email>
 * Prints: workspace, lead, enrollments (status, currentStep, nextSendAt,
 * lastError, timestamps), all EmailEvents for those enrollments, thread
 * messages, plus workspace-wide health aggregates for today and the
 * last 48 hours: SENT events per day, outbound ThreadMessages per day,
 * enrollments completed by the open gate today (lastError like
 * "Follow-up not sent%"), suppressed completions today, FAILED events
 * today, and the gap between SENT events and outbound messages.
 * Zero writes.
 */
export {};
import { PrismaClient } from "@prisma/client";

async function main(): Promise<number> {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) { console.error("email argument required"); return 2; }
  const rawUrl = process.env.DATABASE_URL ?? "";
  let host = "(unknown)"; try { host = new URL(rawUrl).hostname; } catch {}
  console.log(`Target host: ${host}`);
  if (!rawUrl.startsWith("postgres")) { console.error("Refusing: not a postgres URL"); return 1; }
  const db = new PrismaClient();
  try {
    const workspaces = await db.workspace.findMany({ where: { name: "AamirTechs" }, select: { id: true, name: true } });
    if (workspaces.length !== 1) { console.error(`AamirTechs workspaces found: ${workspaces.length}`); return 1; }
    const ws = workspaces[0];
    console.log(`Workspace: ${ws.name} ${ws.id}`);

    const leads = await db.lead.findMany({
      where: { workspaceId: ws.id, email: { equals: email } },
    });
    console.log(`\nLEADS MATCHING ${email}: ${leads.length}`);
    for (const lead of leads) {
      console.log(JSON.stringify({ id: lead.id, email: lead.email, status: lead.status, createdAt: lead.createdAt, updatedAt: (lead as any).updatedAt ?? null, fields: lead.fields }, null, 2));
      const enrollments = await db.enrollment.findMany({ where: { leadId: lead.id }, include: { campaign: { select: { name: true, status: true } } } });
      for (const enr of enrollments) {
        console.log(`\nENROLLMENT ${enr.id} campaign="${enr.campaign.name}" campaignStatus=${enr.campaign.status}`);
        console.log(JSON.stringify({ status: enr.status, currentStep: enr.currentStep, nextSendAt: enr.nextSendAt, lastError: enr.lastError, enrolledAt: enr.enrolledAt, updatedAt: (enr as any).updatedAt ?? null }, null, 2));
        const events = await db.emailEvent.findMany({ where: { enrollmentId: enr.id }, orderBy: { occurredAt: "asc" } });
        console.log(`EVENTS (${events.length}):`);
        for (const ev of events) console.log(`  ${ev.occurredAt.toISOString()} type=${ev.type} key=${ev.idempotencyKey} class=${ev.classification ?? "-"} account=${ev.sendingAccountId ?? "-"} variant=${ev.variant ?? "-"}`);
      }
      const threads = await db.thread.findMany({ where: { workspaceId: ws.id, leadId: lead.id }, orderBy: { lastMessageAt: "desc" } });
      for (const th of threads) {
        const msgs = await db.threadMessage.findMany({ where: { threadId: th.id }, orderBy: { occurredAt: "asc" } });
        console.log(`\nTHREAD ${th.id} campaign=${th.campaignId} account=${th.sendingAccountId} subject="${th.subject}" lastMessageAt=${th.lastMessageAt.toISOString()} messages=${msgs.length}`);
        for (const m of msgs) console.log(`  ${m.occurredAt.toISOString()} dir=${m.direction} from=${m.fromEmail} to=${m.toEmail} subject="${m.subject}"`);
      }
    }

    // Workspace-wide health aggregates
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const h48 = new Date(now.getTime() - 48 * 3600 * 1000);
    const h24 = new Date(now.getTime() - 24 * 3600 * 1000);
    const sentToday = await db.emailEvent.count({ where: { workspaceId: ws.id, type: "SENT", occurredAt: { gte: dayStart } } });
    const sent48 = await db.emailEvent.count({ where: { workspaceId: ws.id, type: "SENT", occurredAt: { gte: h48 } } });
    const failedToday = await db.emailEvent.count({ where: { workspaceId: ws.id, type: "FAILED", occurredAt: { gte: dayStart } } });
    const failed48 = await db.emailEvent.count({ where: { workspaceId: ws.id, type: "FAILED", occurredAt: { gte: h48 } } });
    // Outbound thread messages joined through threads of this workspace
    const outboundToday = await db.threadMessage.count({ where: { direction: "OUTBOUND", occurredAt: { gte: dayStart }, thread: { workspaceId: ws.id } } });
    const outbound48 = await db.threadMessage.count({ where: { direction: "OUTBOUND", occurredAt: { gte: h48 }, thread: { workspaceId: ws.id } } });
    const sent24 = await db.emailEvent.count({ where: { workspaceId: ws.id, type: "SENT", occurredAt: { gte: h24 } } });
    const outbound24 = await db.threadMessage.count({ where: { direction: "OUTBOUND", occurredAt: { gte: h24 }, thread: { workspaceId: ws.id } } });
    console.log(`\nAGGREGATES now=${now.toISOString()} dayStartUTC=${dayStart.toISOString()}`);
    console.log(`SENT today(UTC)=${sentToday} FAILED today=${failedToday} OUTBOUND msgs today=${outboundToday}`);
    console.log(`SENT last24h=${sent24} OUTBOUND last24h=${outbound24} gap24h=${sent24 - outbound24}`);
    console.log(`SENT last48h=${sent48} FAILED last48h=${failed48} OUTBOUND last48h=${outbound48} gap48h=${sent48 - outbound48}`);

    // Open-gate completions: enrollments whose lastError carries the gate reason.
    // Enrollment has no updatedAt in some schemas, so count by pattern across all, and list recent examples with events.
    const gateAll = await db.enrollment.findMany({
      where: { campaign: { workspaceId: ws.id }, lastError: { startsWith: "Follow-up not sent:" } },
      select: { id: true, status: true, currentStep: true, campaign: { select: { name: true } }, lead: { select: { email: true } } },
    });
    console.log(`\nOPEN-GATE COMPLETED (all time, lastError pattern): ${gateAll.length}`);
    const byCampaign = new Map<string, number>();
    for (const g of gateAll) byCampaign.set(g.campaign.name, (byCampaign.get(g.campaign.name) ?? 0) + 1);
    for (const [k, v] of byCampaign) console.log(`  ${k}: ${v}`);

    // Enrollments still ACTIVE and due in the past (backlog check)
    const dueNow = await db.enrollment.count({ where: { status: "ACTIVE", nextSendAt: { lte: now }, campaign: { workspaceId: ws.id, status: "RUNNING" } } });
    const activeTotal = await db.enrollment.count({ where: { status: "ACTIVE", campaign: { workspaceId: ws.id } } });
    console.log(`\nACTIVE total=${activeTotal} ACTIVE due now=${dueNow}`);
    const lastSent = await db.emailEvent.findFirst({ where: { workspaceId: ws.id, type: "SENT" }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
    console.log(`LAST SENT: ${lastSent?.occurredAt.toISOString() ?? "none"}`);
    return 0;
  } finally { await db.$disconnect(); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("trace failed", e); process.exit(1); });
