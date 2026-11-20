/**
 * Fill the namePronunciation field on the six seeded Calling
 * leads (v1.45.0): a phonetic respelling of each decision maker's
 * name in simple American English syllables, shown in the call
 * panel next to the name with a listen button.
 *
 * Safety shape, matching the other ops scripts: dry run by
 * default, pass --apply to write. Leads are matched inside the
 * "WordPress Speed Call Leads" list in the AamirTechs workspace
 * by their company field, updated in place, never duplicated,
 * and every other field is kept. After applying, the script
 * reads the list back and prints each lead's stored value.
 *
 * Run it on the app server, where the production DATABASE_URL
 * lives in /opt/coldreach/.env.production, the same way the
 * v1.44.0 seed ran: copy the script over, generate the production
 * client, then execute with the production environment.
 */
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORKSPACE_NAME = "AamirTechs";
const LIST_NAME = "WordPress Speed Call Leads";

const PRONUNCIATIONS: { company: string; namePronunciation: string }[] = [
  { company: "Anna Handy Law Firm", namePronunciation: "AN-uh HAN-dee" },
  { company: "Dazzle Cleaning Service", namePronunciation: "AY-mee SMITH" },
  { company: "The Desir Law Firm", namePronunciation: "LEN-erd duh-ZEER" },
  { company: "Starr Cleaning Services", namePronunciation: "AW-stin AR-now" },
  { company: "Elk Cove Vineyards", namePronunciation: "AD-um KAM-bul" },
  { company: "House of Aesthetix", namePronunciation: "MY-kul PEE-ter-sun" },
];

async function main() {
  const workspace = await prisma.workspace.findFirst({
    where: { name: WORKSPACE_NAME },
    select: { id: true, name: true },
  });
  if (!workspace) throw new Error(`Workspace "${WORKSPACE_NAME}" not found`);
  const list = await prisma.leadList.findFirst({
    where: { workspaceId: workspace.id, name: LIST_NAME },
    select: { id: true },
  });
  if (!list) throw new Error(`List "${LIST_NAME}" not found`);
  const leads = await prisma.lead.findMany({
    where: { workspaceId: workspace.id, listId: list.id },
    select: { id: true, email: true, fields: true },
  });
  console.log(`List "${LIST_NAME}" holds ${leads.length} leads.`);

  for (const target of PRONUNCIATIONS) {
    const lead = leads.find((item) => {
      const fields = item.fields as Record<string, unknown> | null;
      return fields && typeof fields.company === "string" && fields.company === target.company;
    });
    if (!lead) {
      console.log(`${target.company}: NOT FOUND in the list, skipped`);
      continue;
    }
    const fields = {
      ...((lead.fields ?? {}) as Record<string, unknown>),
      namePronunciation: target.namePronunciation,
    };
    console.log(
      `${target.company}: ${APPLY ? "setting" : "would set"} namePronunciation to "${target.namePronunciation}" on lead ${lead.id}`,
    );
    if (APPLY) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { fields: fields as Prisma.InputJsonValue },
      });
    }
  }

  if (APPLY) {
    const after = await prisma.lead.findMany({
      where: { workspaceId: workspace.id, listId: list.id },
      select: { fields: true },
      orderBy: { createdAt: "asc" },
    });
    console.log("Read back:");
    for (const lead of after) {
      const f = (lead.fields ?? {}) as Record<string, unknown>;
      console.log(`  ${String(f.company ?? "?")}: namePronunciation=${String(f.namePronunciation ?? "MISSING")}`);
    }
  }
  console.log(APPLY ? "Applied." : "Dry run only. Re-run with --apply to write.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
