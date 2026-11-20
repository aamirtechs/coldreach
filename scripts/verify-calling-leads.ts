/**
 * Read-back verification for the Calling seed (v1.44.0): lists the
 * members of the "WordPress Speed Call Leads" list in AamirTechs
 * and reports, per lead, whether phone, location, timezone, best
 * window, pain points, hook and personalScript are populated.
 * Read only.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const workspace = await prisma.workspace.findFirst({
    where: { name: "AamirTechs" },
    select: { id: true },
  });
  if (!workspace) throw new Error("AamirTechs workspace not found");
  const list = await prisma.leadList.findFirst({
    where: { workspaceId: workspace.id, name: "WordPress Speed Call Leads" },
    select: { id: true },
  });
  if (!list) throw new Error("List not found");
  const leads = await prisma.lead.findMany({
    where: { workspaceId: workspace.id, listId: list.id },
    select: { email: true, fields: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`List members: ${leads.length}`);
  for (const lead of leads) {
    const f = (lead.fields ?? {}) as Record<string, unknown>;
    const script = typeof f.personalScript === "string" ? f.personalScript : "";
    console.log(
      [
        String(f.company ?? lead.email),
        `phone=${f.phone ? "yes" : "MISSING"}`,
        `loc=${f.city ?? "?"}/${f.state ?? "?"}`,
        `tz=${f.timezone ?? "MISSING"}`,
        `window=${f.bestStartHour ?? "?"}-${f.bestEndHour ?? "?"}`,
        `dm=${f.decisionMaker ? "yes" : "MISSING"}`,
        `score=${f.mobileScore ?? "?"}`,
        `lcp=${f.lcp ?? "?"}`,
        `pain=${typeof f.painPoints === "string" && f.painPoints.length > 20 ? "yes" : "MISSING"}`,
        `hook=${typeof f.hook === "string" && f.hook.length > 20 ? "yes" : "MISSING"}`,
        `script=${script.length} chars, names Amir: ${script.includes("my name is Amir")}`,
      ].join(" | "),
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
