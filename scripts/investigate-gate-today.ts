/** READ-ONLY: today's open-gate completions and FAILED events, AamirTechs only. */
export {};
import { PrismaClient } from "@prisma/client";
async function main(): Promise<number> {
  const rawUrl = process.env.DATABASE_URL ?? "";
  if (!rawUrl.startsWith("postgres")) { console.error("Refusing: not postgres"); return 1; }
  const db = new PrismaClient();
  try {
    const ws = await db.workspace.findFirst({ where: { name: "AamirTechs" }, select: { id: true } });
    if (!ws) return 1;
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const gateToday = await db.enrollment.findMany({
      where: { campaign: { workspaceId: ws.id }, lastError: { startsWith: "Follow-up not sent:" }, updatedAt: { gte: dayStart } },
      select: { id: true, updatedAt: true, campaign: { select: { name: true } }, lead: { select: { email: true } } },
      orderBy: { updatedAt: "asc" },
    });
    console.log(`OPEN-GATE COMPLETIONS TODAY (UTC day, since ${dayStart.toISOString()}): ${gateToday.length}`);
    for (const g of gateToday) console.log(`  ${g.updatedAt.toISOString()} ${g.campaign.name} | ${g.lead.email}`);
    const machineToday = await db.enrollment.findMany({
      where: { campaign: { workspaceId: ws.id }, lastError: { contains: "automatic open" }, updatedAt: { gte: dayStart } },
      select: { id: true },
    });
    console.log(`  of which machine-open-only reason: ${machineToday.length}`);
    const failed = await db.emailEvent.findMany({
      where: { workspaceId: ws.id, type: "FAILED", occurredAt: { gte: dayStart } },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true, enrollmentId: true, sendingAccountId: true, idempotencyKey: true },
    });
    console.log(`\nFAILED EVENTS TODAY: ${failed.length}`);
    for (const f of failed) {
      const enr = await db.enrollment.findUnique({ where: { id: f.enrollmentId ?? "" }, select: { lastError: true, status: true, lead: { select: { email: true } }, campaign: { select: { name: true } } } });
      const laterSent = f.enrollmentId ? await db.emailEvent.findFirst({ where: { enrollmentId: f.enrollmentId, type: "SENT" }, select: { occurredAt: true } }) : null;
      console.log(`  ${f.occurredAt.toISOString()} ${enr?.campaign.name ?? "?"} | ${enr?.lead.email ?? "?"} | status now=${enr?.status} | laterSent=${laterSent ? laterSent.occurredAt.toISOString() : "NO"} | lastError=${enr?.lastError ?? "-"}`);
    }
    return 0;
  } finally { await db.$disconnect(); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
