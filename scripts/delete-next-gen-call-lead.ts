/**
 * Delete the Next Gen Electric Co. CallLead (2026-11-21).
 *
 * The owner checked this lead by hand and its hook failed: the
 * hook claimed the business's site still showed the default
 * "Just another WordPress site" tagline, but the live site at
 * https://nextgenelectricco.com/ is a finished, current site
 * (title "Electrician Monroe GA: Best Licensed Pros 2026 | Next
 * Gen", 5.0 Google reviews, copyright 2026, press coverage dated
 * Nov 2026) and Google shows it correctly. Per the owner's
 * instruction the record is deleted outright, not scrubbed and
 * kept. That leaves zero CallLeads in the new system, which is
 * expected: new leads enter only after complete live
 * verification at research time.
 *
 * Before deleting, the script prints the stored hook VERBATIM
 * (between the HOOK-START and HOOK-END markers, plus a JSON
 * escaped copy) so the exact original wording is on record.
 *
 * Safety shape, matching the other ops scripts: dry run by
 * default, pass --apply to delete. The lead is matched by
 * company inside the "Best Call Leads - All Services" list in
 * the AamirTechs workspace. CallLogs linked to the lead keep
 * their history (the relation sets callLeadId to null). After
 * applying, the script reads back the workspace CallLead count.
 *
 * Run it on the app server, where the production DATABASE_URL
 * lives in /opt/coldreach/.env.production: copy the script over,
 * generate the production client, then execute with the
 * production environment.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORKSPACE_NAME = "AamirTechs";
const LIST_NAME = "Best Call Leads - All Services";
const COMPANY = "Next Gen Electric Co.";

async function main() {
  const workspace = await prisma.workspace.findFirst({
    where: { name: WORKSPACE_NAME },
    select: { id: true, name: true },
  });
  if (!workspace) throw new Error(`Workspace "${WORKSPACE_NAME}" not found`);
  const list = await prisma.callLeadList.findFirst({
    where: { workspaceId: workspace.id, name: LIST_NAME },
    select: { id: true },
  });
  if (!list) throw new Error(`Call lead list "${LIST_NAME}" not found`);
  const totalBefore = await prisma.callLead.count({
    where: { workspaceId: workspace.id },
  });
  const lead = await prisma.callLead.findFirst({
    where: { workspaceId: workspace.id, listId: list.id, company: COMPANY },
  });
  if (!lead) throw new Error(`${COMPANY}: NOT FOUND in the list`);
  const fields = (lead.fields ?? {}) as Record<string, unknown>;
  const hook = typeof fields.hook === "string" ? fields.hook : "";
  console.log(`Workspace CallLeads before: ${totalBefore}`);
  console.log(
    `Target: ${lead.company} id=${lead.id} service=${lead.serviceSlug} temperature=${lead.temperature} score=${lead.leadScore} verifyStatus=${lead.verifyStatus}`,
  );
  console.log("HOOK-START");
  console.log(hook);
  console.log("HOOK-END");
  console.log(`HOOK-JSON: ${JSON.stringify(hook)}`);
  const linkedLogs = await prisma.callLog.count({
    where: { workspaceId: workspace.id, callLeadId: lead.id },
  });
  console.log(`Linked call logs: ${linkedLogs} (kept, callLeadId set to null on delete)`);
  if (!APPLY) {
    console.log("Dry run only. Pass --apply to delete.");
    return;
  }
  await prisma.callLead.delete({ where: { id: lead.id } });
  const totalAfter = await prisma.callLead.count({
    where: { workspaceId: workspace.id },
  });
  console.log(`Deleted. Workspace CallLeads after: ${totalAfter}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
