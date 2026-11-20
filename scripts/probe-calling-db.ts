/**
 * Read-only probe for the Calling seed (v1.44.0): confirms which
 * database the production connection string reaches before any
 * seed write happens. Prints workspace names, the AamirTechs lead
 * count, the newest applied migrations, and whether the Calling
 * tables from v1.43.0 answer. Never writes.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });
  for (const ws of workspaces) {
    const leads = await prisma.lead.count({ where: { workspaceId: ws.id } });
    console.log(`Workspace "${ws.name}" (${ws.id}): ${leads} leads`);
  }
  const migrations = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
    SELECT migration_name, finished_at FROM _prisma_migrations
    WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 5`;
  console.log("Newest applied migrations:");
  for (const m of migrations) console.log(`  ${m.migration_name} @ ${m.finished_at}`);
  const scripts = await prisma.callScript.count();
  const logs = await prisma.callLog.count();
  console.log(`CallScript rows: ${scripts}, CallLog rows: ${logs}`);
  const aamir = workspaces.find((w) => w.name === "AamirTechs");
  if (aamir) {
    const lists = await prisma.leadList.findMany({
      where: { workspaceId: aamir.id },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    console.log(`AamirTechs lists (${lists.length}): ${lists.map((l) => l.name).join(" | ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
