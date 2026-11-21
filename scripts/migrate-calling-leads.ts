/**
 * Copy the existing Calling leads into the dedicated system
 * (v1.47.0). The 16 call leads built during November live as email
 * Lead rows in two lists ("WordPress Speed Call Leads" and "Best
 * Call Leads - All Services") in the AamirTechs workspace. This
 * script copies them into CallLeadList and CallLead with all their
 * intel, so Calling stops reading the email Lead model. The
 * original Lead rows are NOT deleted or altered: the email side
 * keeps its data, Calling gets its own.
 *
 * Temperature: HOT only where the evidence is a live breakage or a
 * worst in class metric (Anna Handy's 24 score, and the two dental
 * leads whose money pages return 404s). Everything else is WARM.
 * verifyStatus starts UNVERIFIED for all 16: the user wants to
 * check each lead himself in the new Verify tab.
 *
 * Safety shape, matching the other ops scripts: dry run by
 * default, pass --apply to write. Idempotent: a CallLead with the
 * same phone digits or company in the workspace is skipped.
 *
 * Run against production the way the other production scripts run:
 * generate the production client, then execute with the production
 * DATABASE_URL in the environment.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { CALLING_SERVICES } from "../src/lib/calling/services";
import { stateStatus } from "../src/lib/calling/statePriority";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORKSPACE_NAME = "AamirTechs";

const SERVICE_BY_COMPANY: Record<string, string> = {
  "The Preston Barn at Old Drovers Inn": "wordpress-speed",
  "Dental Arts of Florida": "wordpress-bug-fix",
  "Premier Family Dental Care": "wordpress-bug-fix",
  "Mimi's Cleaning Services": "wordpress-website-development",
  "Looking Glass Beachfront Inn": "wordpress-maintenance",
  "Country Cafe on Main": "wordpress-maintenance",
  "Next Gen Electric Co.": "wordpress-customization",
  "Levine Orthodontics": "wordpress-customization",
  "HealthPro Chiropractic & Acupuncture": "website-redesign",
  "Yellow Dog Eats": "website-redesign",
};

const HOT_COMPANIES = new Set([
  "Anna Handy Law Firm",
  "Dental Arts of Florida",
  "Premier Family Dental Care",
]);

const LISTS: { sourceName: string; serviceSlug: string | null }[] = [
  { sourceName: "WordPress Speed Call Leads", serviceSlug: "wordpress-speed" },
  { sourceName: "Best Call Leads - All Services", serviceSlug: null },
];

function text(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function serviceDefaults(slug: string) {
  return CALLING_SERVICES.find((service) => service.slug === slug);
}

async function main() {
  const workspace = await prisma.workspace.findFirst({
    where: { name: WORKSPACE_NAME },
    select: { id: true, name: true },
  });
  if (!workspace) throw new Error(`Workspace ${WORKSPACE_NAME} not found`);

  const existingCallLeads = await prisma.callLead.findMany({
    where: { workspaceId: workspace.id },
    select: { phone: true, company: true },
  });
  const existingPhones = new Set(
    existingCallLeads.map((lead) => lead.phone.replace(/\D/g, "")),
  );
  const existingCompanies = new Set(
    existingCallLeads.map((lead) => lead.company.trim().toLowerCase()),
  );

  let created = 0;
  let skipped = 0;
  for (const listSpec of LISTS) {
    const sourceList = await prisma.leadList.findFirst({
      where: { workspaceId: workspace.id, name: listSpec.sourceName },
      select: { id: true, name: true },
    });
    if (!sourceList) {
      console.log(`Source list not found, skipping: ${listSpec.sourceName}`);
      continue;
    }
    let targetList = await prisma.callLeadList.findFirst({
      where: { workspaceId: workspace.id, name: listSpec.sourceName },
      select: { id: true },
    });
    if (!targetList && APPLY) {
      targetList = await prisma.callLeadList.create({
        data: {
          workspaceId: workspace.id,
          name: listSpec.sourceName,
          serviceSlug: listSpec.serviceSlug,
        },
        select: { id: true },
      });
    }
    const leads = await prisma.lead.findMany({
      where: { workspaceId: workspace.id, listId: sourceList.id },
    });
    console.log(`\n${listSpec.sourceName}: ${leads.length} source leads`);
    for (const lead of leads) {
      const fields =
        lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
          ? (lead.fields as Record<string, unknown>)
          : {};
      const company = text(fields, "company");
      const phone = text(fields, "phone");
      if (!phone) {
        console.log(`  SKIP (no phone): ${company || lead.email}`);
        skipped += 1;
        continue;
      }
      if (
        existingPhones.has(phone.replace(/\D/g, "")) ||
        (company && existingCompanies.has(company.trim().toLowerCase()))
      ) {
        console.log(`  SKIP (already a call lead): ${company}`);
        skipped += 1;
        continue;
      }
      const serviceSlug =
        SERVICE_BY_COMPANY[company] ?? listSpec.serviceSlug ?? "wordpress-speed";
      const defaults = serviceDefaults(serviceSlug);
      const website = text(fields, "website");
      const hook = text(fields, "hook") || text(fields, "icebreaker");
      const mobileScore = text(fields, "mobileScore");
      const lcp = text(fields, "lcp");
      const evidence: { label: string; url: string; note: string }[] = [];
      if (website) {
        evidence.push({
          label: "Official website",
          url: website,
          note: "The business's own site. Check the claims below against it.",
        });
        evidence.push({
          label: "Phone number source",
          url: website,
          note: "This number was verified on the official website on 2026-11-20.",
        });
      }
      if (mobileScore) {
        evidence.push({
          label: "PageSpeed measurement",
          url: "https://pagespeed.web.dev/",
          note: `Mobile score ${mobileScore} of 100, LCP ${lcp}, measured 2026-11-04. Retest before quoting it, scores move.`,
        });
      }
      const intel: Record<string, unknown> = {};
      for (const key of [
        "mobileScore",
        "lcp",
        "bestStartHour",
        "bestEndHour",
        "bestTimeNote",
        "painPoints",
        "personalScript",
      ]) {
        if (fields[key] !== undefined && fields[key] !== "") intel[key] = fields[key];
      }
      if (hook) intel.hook = hook;
      if (hook) intel.signals = [hook];
      if (defaults) {
        intel.dontSay = defaults.defaultDontSay;
        intel.offerLine = defaults.defaultOfferLine;
      }
      if (evidence.length) intel.evidence = evidence;

      // State rule (2026-11-21, final): calling leads may only
      // exist for the priority states Georgia, Illinois, North
      // Carolina and Ohio. Out of state leads are skipped here and
      // removed from the source lists by the cleanup, never copied.
      const leadState = text(fields, "state").trim().toUpperCase();
      if (stateStatus(leadState) !== "PRIORITY") {
        console.log(`  SKIP (out of state ${leadState || "unknown"}): ${company}`);
        skipped += 1;
        continue;
      }
      const temperature = HOT_COMPANIES.has(company) ? "HOT" : "WARM";
      const verifyStatus = "UNVERIFIED";
      const verifyNote: string | null = null;
      console.log(
        `  ${APPLY ? "CREATE" : "WOULD CREATE"} [${temperature}] [${verifyStatus}] [${serviceSlug}] ${company} ${phone}`,
      );
      if (APPLY && targetList) {
        await prisma.callLead.create({
          data: {
            workspaceId: workspace.id,
            listId: targetList.id,
            serviceSlug,
            temperature,
            firstName: text(fields, "firstName"),
            lastName: text(fields, "lastName"),
            company,
            phone,
            email: lead.email.includes("@calling.invalid") ? null : lead.email,
            website: website || null,
            city: text(fields, "city") || null,
            state: text(fields, "state") || null,
            timezone: text(fields, "timezone") || null,
            decisionMaker: text(fields, "decisionMaker") || null,
            namePronunciation: text(fields, "namePronunciation") || null,
            fields: intel as Prisma.InputJsonValue,
            verifyStatus,
            verifyNote,
          },
        });
      }
      created += 1;
      existingPhones.add(phone.replace(/\D/g, ""));
      if (company) existingCompanies.add(company.trim().toLowerCase());
    }
  }
  console.log(`\n${APPLY ? "Created" : "Would create"}: ${created}, skipped: ${skipped}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
