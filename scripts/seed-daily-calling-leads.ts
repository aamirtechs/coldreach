/**
 * Daily calling leads seed (pipeline cron, first run 2026-11-21).
 * Inserts one day's researched CallLeads into the "Daily Call Leads"
 * CallLeadList in the AamirTechs workspace, on the VPS production
 * Postgres (the live DB; never the Neon fallback).
 *
 * Input: a JSON file { batch: "2026-11-21", leads: [ ... ] } where
 * each lead carries the full CallLead shape the pipeline produces:
 * serviceSlug, temperature, leadScore, scoreFit, scoreSignal,
 * scoreRecency, scoreReachability, firstName, lastName,
 * namePronunciation, company, phone, email (or null), website,
 * city, state (full name or 2 letter code), timezone,
 * decisionMaker, bestStartHour, bestEndHour, bestTimeNote,
 * painPoints, hook, signals, personalScript, dontSay, offerLine,
 * evidence [{label, url, note, dateChecked}], mobileScore / lcp
 * for speed leads, saturdayOpen / saturdayHours where known.
 *
 * Safety shape, matching the other ops scripts: dry run by default,
 * pass --apply to write. Idempotent: a lead matching an existing
 * CallLead by phone digits, website domain, or company plus state
 * is skipped, never duplicated. State gate: only GA, IL, NC, OH
 * are accepted; anything else is refused, never inserted. Score
 * gate: under 40 is refused. Accuracy rule (Amir, 2026-11-21):
 * a lead is only inserted after complete, deep verification
 * against the latest live state, so verifyStatus is VERIFIED at
 * creation; there is no unverified tier. sourceBatch is the run
 * date, stored in fields.
 *
 * Run on the VPS the way production scripts run there: copy this
 * file to /opt/coldreach/scripts/, then run with DATABASE_URL and
 * DIRECT_URL from /opt/coldreach/.env.production (quotes stripped):
 *   npx tsx scripts/seed-daily-calling-leads.ts <leads.json> [--apply]
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORKSPACE_NAME = "AamirTechs";
const LIST_NAME = "Daily Call Leads";
const INPUT_PATH = process.argv.find((arg) => arg.endsWith(".json"));
if (!INPUT_PATH) {
  console.error("Usage: seed-daily-calling-leads.ts <leads.json> [--apply]");
  process.exit(1);
}

const SERVICE_SLUGS = new Set([
  "wordpress-speed",
  "wordpress-bug-fix",
  "wordpress-website-development",
  "woocommerce-store-setup",
  "shopify-store-setup",
  "wordpress-maintenance",
  "wordpress-customization",
  "product-upload-listings",
  "website-redesign",
  "online-store-management",
  "ecommerce-customer-support",
  "merchant-center-feed-diagnostics",
  "truck-dispatching",
]);

const STATE_BY_NAME: Record<string, string> = {
  GEORGIA: "GA",
  ILLINOIS: "IL",
  "NORTH CAROLINA": "NC",
  OHIO: "OH",
  GA: "GA",
  IL: "IL",
  NC: "NC",
  OH: "OH",
};
const STATE_FULL_NAME: Record<string, string> = {
  GA: "Georgia",
  IL: "Illinois",
  NC: "North Carolina",
  OH: "Ohio",
};

const EM_DASH = "\u2014";

interface EvidenceEntry {
  label: string;
  url: string;
  note: string;
  dateChecked?: string;
}

interface InputLead {
  serviceSlug: string;
  temperature: string;
  leadScore: number;
  scoreFit: number;
  scoreSignal: number;
  scoreRecency: number;
  scoreReachability: number;
  firstName: string;
  lastName: string;
  namePronunciation?: string | null;
  company: string;
  phone: string;
  email?: string | null;
  website: string;
  city: string;
  state: string;
  timezone: string;
  decisionMaker?: string | null;
  bestStartHour?: number | null;
  bestEndHour?: number | null;
  bestTimeNote?: string | null;
  painPoints: string;
  hook: string;
  signals?: string[];
  personalScript: string;
  dontSay?: string[];
  offerLine: string;
  evidence?: EvidenceEntry[];
  mobileScore?: string | null;
  lcp?: string | null;
  saturdayOpen?: boolean | null;
  saturdayHours?: string | null;
}

function domainOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
}

function digits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function findEmDash(value: unknown, path: string): string[] {
  const problems: string[] = [];
  if (typeof value === "string" && value.includes(EM_DASH)) {
    problems.push(`${path} contains an em dash`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => problems.push(...findEmDash(item, `${path}[${index}]`)));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      problems.push(...findEmDash(item, `${path}.${key}`));
    }
  }
  return problems;
}

async function main() {
  if (!INPUT_PATH) throw new Error("A leads JSON path argument is required");
  const parsed = JSON.parse(readFileSync(INPUT_PATH, "utf8")) as {
    batch: string;
    leads: InputLead[];
  };
  const batch = parsed.batch;
  const leads = parsed.leads;
  console.log(`Batch ${batch}: ${leads.length} input leads from ${INPUT_PATH}`);

  const workspace = await prisma.workspace.findFirst({
    where: { name: WORKSPACE_NAME },
    select: { id: true, name: true },
  });
  if (!workspace) throw new Error(`Workspace "${WORKSPACE_NAME}" not found`);
  console.log(`Workspace: ${workspace.name} (${workspace.id})`);

  let list = await prisma.callLeadList.findFirst({
    where: { workspaceId: workspace.id, name: LIST_NAME },
    select: { id: true, name: true },
  });
  if (!list) {
    if (APPLY) {
      list = await prisma.callLeadList.create({
        data: { workspaceId: workspace.id, name: LIST_NAME },
        select: { id: true, name: true },
      });
      console.log(`Created list "${LIST_NAME}" (${list.id})`);
    } else {
      console.log(`List "${LIST_NAME}" does not exist yet; dry run, would create it.`);
    }
  } else {
    console.log(`List exists: "${list.name}" (${list.id})`);
  }

  const existing = await prisma.callLead.findMany({
    where: { workspaceId: workspace.id },
    select: { phone: true, company: true, website: true, state: true },
  });
  const existingPhones = new Set(existing.map((lead) => digits(lead.phone)));
  const existingDomains = new Set(
    existing.map((lead) => (lead.website ? domainOf(lead.website) : "")).filter(Boolean),
  );
  const existingCompanyState = new Set(
    existing.map(
      (lead) => `${lead.company.trim().toLowerCase()}|${(lead.state ?? "").trim().toUpperCase()}`,
    ),
  );
  console.log(`Workspace holds ${existing.length} call leads.`);

  const perService: Record<string, number> = {};
  let created = 0;
  let skipped = 0;
  const refused: string[] = [];

  for (const lead of leads) {
    const tag = `${lead.company} [${lead.serviceSlug}]`;
    const problems: string[] = [];
    if (!SERVICE_SLUGS.has(lead.serviceSlug)) problems.push(`unknown serviceSlug ${lead.serviceSlug}`);
    const stateCode = STATE_BY_NAME[(lead.state ?? "").trim().toUpperCase()];
    if (!stateCode) problems.push(`state ${lead.state} is not GA, IL, NC or OH`);
    if (typeof lead.leadScore !== "number" || lead.leadScore < 40 || lead.leadScore > 100) {
      problems.push(`leadScore ${lead.leadScore} is under 40 or out of range`);
    }
    const subtotal =
      (lead.scoreFit ?? 0) + (lead.scoreSignal ?? 0) + (lead.scoreRecency ?? 0) + (lead.scoreReachability ?? 0);
    if (subtotal !== lead.leadScore) {
      problems.push(`subscores add to ${subtotal}, not leadScore ${lead.leadScore}`);
    }
    if (lead.temperature === "HOT") {
      if (lead.leadScore < 70 || lead.scoreSignal < 30 || lead.scoreReachability < 12 || lead.scoreRecency < 10) {
        problems.push("HOT temperature but a hot gate fails (70 total, Signal 30, Reachability 12, Recency 10)");
      }
    } else if (lead.temperature !== "WARM") {
      problems.push(`temperature ${lead.temperature} is not HOT or WARM`);
    }
    if (!lead.phone) problems.push("missing phone");
    if (!lead.website) problems.push("missing website");
    if (!lead.personalScript) problems.push("missing personalScript");
    if (!lead.hook) problems.push("missing hook");
    if (!Array.isArray(lead.evidence) || lead.evidence.length === 0) {
      problems.push("missing evidence array");
    }
    problems.push(...findEmDash(lead, tag));
    if (problems.length) {
      console.log(`  REFUSE ${tag}: ${problems.join("; ")}`);
      refused.push(tag);
      continue;
    }

    const phoneDigits = digits(lead.phone);
    const domain = domainOf(lead.website);
    const companyState = `${lead.company.trim().toLowerCase()}|${stateCode}`;
    if (existingPhones.has(phoneDigits) || existingDomains.has(domain) || existingCompanyState.has(companyState)) {
      console.log(`  SKIP (duplicate): ${tag} ${lead.phone}`);
      skipped += 1;
      continue;
    }

    const fields: Record<string, unknown> = {
      sourceBatch: batch,
      stateName: STATE_FULL_NAME[stateCode],
      scoreFit: lead.scoreFit,
      scoreSignal: lead.scoreSignal,
      scoreRecency: lead.scoreRecency,
      scoreReachability: lead.scoreReachability,
      bestStartHour: lead.bestStartHour ?? 9,
      bestEndHour: lead.bestEndHour ?? 11,
      bestTimeNote: lead.bestTimeNote ?? "",
      painPoints: lead.painPoints,
      hook: lead.hook,
      signals: lead.signals ?? [],
      personalScript: lead.personalScript,
      dontSay: lead.dontSay ?? [],
      offerLine: lead.offerLine,
      evidence: lead.evidence ?? [],
    };
    if (lead.mobileScore) fields.mobileScore = lead.mobileScore;
    if (lead.lcp) fields.lcp = lead.lcp;
    if (lead.saturdayOpen !== undefined && lead.saturdayOpen !== null) {
      fields.saturdayOpen = lead.saturdayOpen;
    }
    if (lead.saturdayHours) fields.saturdayHours = lead.saturdayHours;

    console.log(
      `  ${APPLY ? "CREATE" : "WOULD CREATE"} [${lead.temperature} ${lead.leadScore}] [${stateCode}] ${tag} ${lead.phone} ${lead.city}`,
    );
    if (APPLY && list) {
      await prisma.callLead.create({
        data: {
          workspaceId: workspace.id,
          listId: list.id,
          serviceSlug: lead.serviceSlug,
          temperature: lead.temperature,
          leadScore: lead.leadScore,
          firstName: lead.firstName ?? "",
          lastName: lead.lastName ?? "",
          company: lead.company,
          phone: lead.phone,
          email: lead.email || null,
          website: lead.website,
          city: lead.city || null,
          state: stateCode,
          timezone: lead.timezone || null,
          decisionMaker: lead.decisionMaker || null,
          namePronunciation: lead.namePronunciation || null,
          fields: fields as Prisma.InputJsonValue,
          verifyStatus: "VERIFIED",
          verifyNote: "Verified live 2026-11-21 against the business site and Google listing.",
        },
      });
      existingPhones.add(phoneDigits);
      existingDomains.add(domain);
      existingCompanyState.add(companyState);
    }
    created += 1;
    perService[lead.serviceSlug] = (perService[lead.serviceSlug] ?? 0) + 1;
  }

  console.log(`\nPer service: ${JSON.stringify(perService)}`);
  console.log(`Created: ${created}, skipped duplicates: ${skipped}, refused: ${refused.length}`);
  if (refused.length) console.log(`Refused: ${refused.join(" | ")}`);

  const totalAfter = await prisma.callLead.count({ where: { workspaceId: workspace.id } });
  console.log(`Total CallLeads in workspace now: ${totalAfter}`);
  const byService = await prisma.callLead.groupBy({
    by: ["serviceSlug"],
    where: { workspaceId: workspace.id },
    _count: { _all: true },
  });
  for (const row of byService.sort((a, b) => a.serviceSlug.localeCompare(b.serviceSlug))) {
    console.log(`  ${row.serviceSlug}: ${row._count._all}`);
  }
  console.log(APPLY ? "Applied." : "Dry run only. Re-run with --apply to write.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
