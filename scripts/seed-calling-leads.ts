/**
 * Seed the enriched Calling leads (v1.44.0): the six verified
 * WordPress speed prospects go into a "WordPress Speed Call Leads"
 * list in the AamirTechs workspace, with phone, location, timezone,
 * best window, decision maker, pain points, hook and a personalized
 * script on each lead's fields.
 *
 * Safety shape, matching the other ops scripts: dry run by default,
 * pass --apply to write. A lead that already exists in the
 * workspace (matched by email first, then by website domain) is
 * updated in place and moved onto the list; nothing is duplicated.
 * Existing field values the calling data does not mention are kept.
 *
 * Run it the way the other production scripts run: generate the
 * production client, then execute with the production DATABASE_URL
 * in the environment (the run-*.py wrappers hold the connection
 * string in memory and never print it).
 */
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORKSPACE_NAME = "AamirTechs";
const LIST_NAME = "WordPress Speed Call Leads";

interface SeedLead {
  company: string;
  firstName: string;
  lastName: string;
  greetingName: string;
  website: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  timezone: string;
  bestTimeNote: string;
  bestStartHour: number;
  bestEndHour: number;
  decisionMaker: string;
  mobileScore: string;
  lcp: string;
  lcpSeconds: string;
  timesText: string;
  painPoints: string;
  hook: string;
  staffNote?: string;
}

const LEADS: SeedLead[] = [
  {
    company: "Anna Handy Law Firm",
    firstName: "Anna",
    lastName: "Handy",
    greetingName: "Anna",
    website: "https://annahandylaw.com/",
    email: "annahandylaw@gmail.com",
    phone: "(386) 248-3000",
    city: "Daytona Beach",
    state: "FL",
    timezone: "America/New_York",
    bestTimeNote: "Mon to Thu 9 to 11am ET, she closes 12:30pm on Fridays",
    bestStartHour: 9,
    bestEndHour: 11,
    decisionMaker: "Anna Handy (founder, sole practitioner)",
    mobileScore: "24",
    lcp: "15.9s",
    lcpSeconds: "15.9",
    timesText: "more than six times that",
    painPoints:
      "Slowest scoring site in the set at 24 out of 100 on mobile; main content takes 15.9 seconds on a phone while Google calls under 2.5 seconds good; solo practice, so every mobile searcher who gives up is a client intake lost with no marketing team to catch it.",
    hook: "I ran your site through Google's own PageSpeed test and it scored 24 out of 100 on mobile, with the main content taking nearly 16 seconds to appear.",
  },
  {
    company: "Dazzle Cleaning Service",
    firstName: "Amy",
    lastName: "Smith",
    greetingName: "Amy",
    website: "https://dazzlecleaningservice.com/",
    email: "info@dazzlecleaning.com",
    phone: "(231) 920-9000",
    city: "DeWitt / Lansing",
    state: "MI",
    timezone: "America/Detroit",
    bestTimeNote: "Mon to Fri 9 to 11am ET, it is a free estimate booking line",
    bestStartHour: 9,
    bestEndHour: 11,
    decisionMaker: "Amy Smith (owner)",
    mobileScore: "33",
    lcp: "9.0s",
    lcpSeconds: "9",
    timesText: "more than three times that",
    painPoints:
      "Mobile score 33 with a 9 second load; the business sells free estimates booked from mobile search, so slow mobile pages cost bookings directly; owner run since 1990, no in house web team.",
    hook: "Your site scored 33 out of 100 on Google's mobile speed test, and took 9 seconds to load, on the same phones your customers use to book a free estimate.",
  },
  {
    company: "The Desir Law Firm",
    firstName: "Leonard",
    lastName: "Desir",
    greetingName: "Leonard",
    website: "https://www.thedesirlawfirm.com/",
    email: "ldesir@thedesirlawfirm.com",
    phone: "954-848-2912",
    city: "Sunrise",
    state: "FL",
    timezone: "America/New_York",
    bestTimeNote: "Mon to Fri 9 to 11am ET, ask for Leonard Desir by name, free consultation line",
    bestStartHour: 9,
    bestEndHour: 11,
    decisionMaker: "Leonard Desir",
    mobileScore: "35",
    lcp: "22.1s",
    lcpSeconds: "22.1",
    timesText: "nearly nine times that",
    painPoints:
      "22.1 second main content load is the second worst in the set; a property law firm whose consultations start on mobile search; appointments only, so the website has to do the persuading before any call.",
    hook: "Your homepage took 22 seconds to load on a phone in Google's test, and scored 35 out of 100, before a potential client reads a single word.",
  },
  {
    company: "Starr Cleaning Services",
    firstName: "Austin",
    lastName: "Arnow",
    greetingName: "Austin",
    website: "https://starrcleaningaz.com/",
    email: "austin@starrcleaningaz.com",
    phone: "(480) 694-3971",
    city: "Mesa",
    state: "AZ",
    timezone: "America/Phoenix",
    bestTimeNote: "Early morning 7:30 to 9am Arizona time, before the crews head out",
    bestStartHour: 7.5,
    bestEndHour: 9,
    decisionMaker: "Austin Arnow (owner)",
    mobileScore: "41",
    lcp: "30.5s",
    lcpSeconds: "30.5",
    timesText: "more than twelve times that",
    painPoints:
      "Worst load time in the set, 30.5 seconds for main content despite a 41 score; the site promises instant free quotes, which a 30 second mobile load contradicts; owners work the jobs themselves, so missed mobile bookings are missed crew work.",
    hook: "Your site promises instant quotes, but on a phone it took 30 seconds to load in Google's test, so most people never reach the quote form.",
  },
  {
    company: "Elk Cove Vineyards",
    firstName: "Adam",
    lastName: "Campbell",
    greetingName: "Adam",
    website: "https://elkcove.com",
    email: "info@elkcove.com",
    phone: "(503) 985-7760",
    city: "Gaston",
    state: "OR",
    timezone: "America/Los_Angeles",
    bestTimeNote:
      "8:30 to 9:30am PT, before the tasting room opens at 10am, expect tasting room staff first",
    bestStartHour: 9,
    bestEndHour: 10,
    decisionMaker: "Adam Campbell (owner and winemaker)",
    mobileScore: "28",
    lcp: "18.7s",
    lcpSeconds: "18.7",
    timesText: "more than seven times that",
    painPoints:
      "Mobile score 28 with 18.7 second load; wine is sold online and tastings booked from phones, so the shop and booking pages carry revenue; family owned, the person answering is tasting room staff, not the owner.",
    hook: "Your site scored 28 out of 100 on mobile and took nearly 19 seconds to load, including the pages where people buy wine and book tastings.",
    staffNote:
      "You will probably reach tasting room staff first. Open with: \"Hi, my name is Amir. Could you put me through to Adam if he is around? It is about the website. I ran a Google speed test on it and found something he would probably want to know about. It will take two minutes of his time.\" If Adam is unavailable, ask when he is usually in before the tasting room opens, and use the script below when you reach him.",
  },
  {
    company: "House of Aesthetix",
    firstName: "Michael",
    lastName: "Peterson",
    greetingName: "Michael",
    website: "https://houseofaesthetix.com/",
    email: "info@houseofaesthetix.com",
    phone: "(858) 263-6002",
    city: "San Diego",
    state: "CA",
    timezone: "America/Los_Angeles",
    bestTimeNote: "9 to 11am PT, one central booking line covers both locations",
    bestStartHour: 9,
    bestEndHour: 11,
    decisionMaker: "Dr. Michael Peterson (medical director, founding partner)",
    mobileScore: "37",
    lcp: "11.3s",
    lcpSeconds: "11.3",
    timesText: "more than four times that",
    painPoints:
      "Mobile score 37 with 11.3 second load; a med spa lives on mobile bookings and before and after galleries, which are image heavy and slow; two locations share one booking number, so the website is the front door for both.",
    hook: "Your site scored 37 out of 100 on Google's mobile test and took over 11 seconds to load, on the phones your patients book from.",
    staffNote:
      "This is a central booking line for two locations, so you will reach front desk staff first. Open with: \"Hi, my name is Amir. Could you put me through to Dr. Peterson, or whoever looks after the website? It is about the site's speed on phones. I ran a Google test on it and found something they would probably want to see. It will take two minutes.\" If they cannot transfer you, ask for the best email for the website person and use the script below when you reach the decision maker.",
  },
];

function personalScriptFor(lead: SeedLead): string {
  const opener = lead.staffNote ? `${lead.staffNote}\n\n` : "";
  return `${opener}Hi, is that ${lead.greetingName}? ${lead.greetingName}, my name is Amir. I will be honest, this is a cold call, but it is a researched one. Can I take 30 seconds to tell you why I called, and then you can tell me if it is worth carrying on or not?

Thank you. The reason I called is, before I rang, I ran your website through Google's own PageSpeed test, the mobile one, how most people find you. ${lead.company} scored ${lead.mobileScore} out of 100, and the main content took ${lead.lcpSeconds} seconds to show up on a phone. Google calls under two and a half seconds good, so you are at ${lead.timesText}. You can run the exact same test yourself and you will see the exact same number.

Can I ask, when someone finds you on their phone, maybe from Google Maps or an ad, and the page takes ${lead.lcpSeconds} seconds, what do you reckon most of them do?
(If they say "leave" or "go elsewhere":) That is what Google's own research says happens too, most mobile visits are given up on after about three seconds. Has anyone, you or whoever looks after the site, ever looked at the speed side of it before?
(Mirror their last few words if they expand, then stay quiet.)

Reason I ask is, that is literally all I do. Since 2018 I have just made WordPress sites load faster. I have 121 reviews on Fiverr at 4.9 stars and 25 rated jobs on Upwork. I am happy to send you the links so you can check I am real before you pay me a penny.

Here is what it looks like. It is a one-off fixed price, between $45 and $195 depending on the size of the site, not an hourly rate and there is no monthly contract. I optimise the images, the caching, the code that is blocking the page, all the stuff that test flags, and you get a before and after report with the same Google test, so you can see the score move with your own eyes. Most sites I do are turned around in two to three days, and you do not have to do anything except give me access. I do the work.

I am not asking you to decide all that on a cold call. Would it be a bad idea if I sent you the free one-page report today, your score, what is causing it, what I would fix, and we had ten minutes later this week for me to walk you through it? If you look at it and think it is not worth it, you just tell me that on the call and that is the end of it. Fair?
(If yes:) Perfect. Let me make sure I send it to the right place, what is the best email? That is (spell it back). You will have the report by the end of the day, and I will send a calendar invite for the walkthrough now, could you just tap accept while we are on, so I know it landed?`;
}

function domainOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
}

async function main() {
  const workspace = await prisma.workspace.findFirst({
    where: { name: WORKSPACE_NAME },
    select: { id: true, name: true },
  });
  if (!workspace) throw new Error(`Workspace "${WORKSPACE_NAME}" not found`);
  console.log(`Workspace: ${workspace.name} (${workspace.id})`);

  let list = await prisma.leadList.findFirst({
    where: { workspaceId: workspace.id, name: LIST_NAME },
    select: { id: true, name: true },
  });
  if (!list) {
    if (APPLY) {
      list = await prisma.leadList.create({
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

  const allLeads = await prisma.lead.findMany({
    where: { workspaceId: workspace.id },
    select: { id: true, email: true, listId: true, fields: true },
  });
  console.log(`Workspace holds ${allLeads.length} leads.`);

  for (const seed of LEADS) {
    const byEmail = allLeads.find((lead) => lead.email.toLowerCase() === seed.email.toLowerCase());
    const bySite = allLeads.find((lead) => {
      const fields = lead.fields as Record<string, unknown> | null;
      const website = typeof fields?.website === "string" ? fields.website : "";
      return website && domainOf(website) === domainOf(seed.website);
    });
    const existing = byEmail ?? bySite;
    const existingFields =
      existing && existing.fields && typeof existing.fields === "object" && !Array.isArray(existing.fields)
        ? (existing.fields as Record<string, unknown>)
        : {};
    const fields: Record<string, unknown> = {
      ...existingFields,
      firstName: seed.firstName,
      lastName: seed.lastName,
      company: seed.company,
      website: seed.website,
      phone: seed.phone,
      city: seed.city,
      state: seed.state,
      timezone: seed.timezone,
      bestTimeNote: seed.bestTimeNote,
      bestStartHour: seed.bestStartHour,
      bestEndHour: seed.bestEndHour,
      decisionMaker: seed.decisionMaker,
      mobileScore: seed.mobileScore,
      lcp: seed.lcp,
      painPoints: seed.painPoints,
      hook: seed.hook,
      personalScript: personalScriptFor(seed),
    };
    if (existing) {
      console.log(
        `${seed.company}: ${APPLY ? "updating" : "would update"} lead ${existing.id} (${existing.email})`,
      );
      if (APPLY) {
        await prisma.lead.update({
          where: { id: existing.id },
          data: {
            fields: fields as Prisma.InputJsonValue,
            ...(list ? { listId: list.id } : {}),
          },
        });
      }
    } else {
      console.log(`${seed.company}: ${APPLY ? "creating" : "would create"} lead (${seed.email})`);
      if (APPLY && list) {
        const created = await prisma.lead.create({
          data: {
            workspaceId: workspace.id,
            listId: list.id,
            email: seed.email,
            fields: fields as Prisma.InputJsonValue,
            tags: [],
            status: "NEW",
          },
          select: { id: true },
        });
        console.log(`  created ${created.id}`);
      }
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
