/**
 * The calling service catalog (v1.47.0). One entry per service the
 * caller sells, in the priority order he calls in: his AamirTechs
 * services first, truck dispatching last. Each profile says what a
 * perfect prospect looks like, which signals make a lead HOT (a live
 * problem or a buying moment, verified on the business's own site)
 * versus WARM (a real fit with a visible weakness but no live fire),
 * who to walk away from, the pains to open with, the offer line the
 * scripts use, and the phrases that must never be said on the call.
 *
 * Profiles for the WordPress and store services are grounded in the
 * November prospect profiles (nov-2026/skill-*-prospect-profile.md);
 * the support, feed and dispatch entries come from the published
 * AamirTechs service list. This file is data plus integrity helpers
 * only, so the catalog is unit testable and the UI can render it
 * without a database.
 */

export interface CallingService {
  slug: string;
  name: string;
  /** 1 is called first; the order the user works the catalog in. */
  priority: number;
  /** Who the perfect prospect is, in plain words. */
  idealProspect: string;
  hotSignals: string[];
  warmSignals: string[];
  disqualifiers: string[];
  corePains: string[];
  defaultOfferLine: string;
  defaultDontSay: string[];
}

const NEVER_PROMISE_RANKING =
  "Never promise a number 1 Google ranking or any ranking at all. No one can guarantee that.";
const NEVER_FREE_WORK =
  "Never offer free dispatching, a free first week or free work to win the conversation.";

export const CALLING_SERVICES: CallingService[] = [
  {
    slug: "wordpress-speed",
    name: "WordPress Speed Optimization",
    priority: 1,
    idealProspect:
      "Owner operated or small team (roughly 1 to 30 people) whose WordPress or WooCommerce site earns money and provably loads slowly on mobile, where most visitors arrive. The owner or manager is still the person who would approve a small fixed price fix.",
    hotSignals: [
      "Ads running to a page with mobile LCP over 4 seconds or a PageSpeed mobile score in the red on that exact page",
      "Measured Google PageSpeed mobile score under 40, or LCP over 10 seconds, on their live site",
      "A WooCommerce store with heavy product or checkout pages that crawl",
      "They run ads or local search campaigns that land on the slow page",
    ],
    warmSignals: [
      "Measured mobile score between 40 and 65, or LCP between 2.5 and 4 seconds with active reviews showing demand",
      "Image heavy homepage, sliders or page builder bloat visible in the source",
      "Site slow only on media heavy pages like a gallery or menu",
      "A recent review mentioning the slow website",
      "Business depends on mobile bookings or calls but has no web team",
    ],
    disqualifiers: [
      "Site is not WordPress",
      "Measured mobile score already above 80",
      "National chain or franchise location with a central marketing team",
    ],
    corePains: [
      "Mobile visitors leave before the page finishes loading",
      "Ad and search clicks are paid for, then wasted on a slow landing page",
      "Nobody has ever measured or owned the speed problem",
    ],
    defaultOfferLine:
      "A one time fixed price speed fix, $45 to $195 depending on the site, with a before and after Google report so you can see the score move yourself. No contract.",
    defaultDontSay: [
      "Never promise a 100 out of 100 score. The score is a lab measurement and not fully in anyone's control.",
      NEVER_PROMISE_RANKING,
      "Never claim their slow site is costing a specific amount of money. You can cite Google's published research, never invent their losses.",
    ],
  },
  {
    slug: "wordpress-bug-fix",
    name: "WordPress Bug Fixes and Errors",
    priority: 2,
    idealProspect:
      "A business with a live WordPress or WooCommerce site showing a real, observable problem right now: a broken page, a dead form, a checkout fault. The owner feels the problem because enquiries or sales pass through that page.",
    hotSignals: [
      "A money page (booking, first visit, product, checkout or contact) returns a 404 or 500 error today",
      "Contact, booking or checkout form broken: the test submit path fails or the form errors",
      "Expired SSL or a Not secure warning on a page that takes details or payment",
      "Site intermittently down",
      "Owner publicly asked for WordPress help or complained about the site",
    ],
    warmSignals: [
      "Plugin or theme conflict warnings visible on the site",
      "Mixed content or SSL warnings in the browser",
      "Site works but a secondary page or feature is broken",
    ],
    disqualifiers: [
      "Site is not WordPress",
      "The problem is actually hosting or domain billing, not the site",
      "They already have a developer actively fixing it",
    ],
    corePains: [
      "Customers hit the broken page and quietly go to a competitor",
      "Every day the fault stays live, enquiries are lost invisibly",
      "The last developer disappeared or never finished",
    ],
    defaultOfferLine:
      "I fix the exact fault for a fixed price agreed in writing before I start, and I show you the page working before you pay the balance.",
    defaultDontSay: [
      "Never guess the cause or the fix time before you have seen the problem.",
      "Never bad mouth their previous developer. Wedge alongside, never against.",
      NEVER_PROMISE_RANKING,
    ],
  },
  {
    slug: "wordpress-website-development",
    name: "WordPress Website Development",
    priority: 3,
    idealProspect:
      "A trading business with buyers and revenue but no proper website of its own: selling from a free site builder page, a Facebook page or word of mouth, in a trade where buyers check credibility online before calling.",
    hotSignals: [
      "Opened, launched, rebranded or added a location in the last 90 days",
      "Actively advertising or posting offers with only a free builder page to send people to",
      "Taking bookings by phone or text with no website at all",
    ],
    warmSignals: [
      "Free builder subdomain (GoDaddy, Wix or Weebly free tier) as the only web presence",
      "Google Business Profile active and reviewed, website link missing or weak",
      "Announced expansion, new services or hiring",
    ],
    disqualifiers: [
      "Already has a proper, working website (that is redesign or maintenance, not this)",
      "Pre revenue idea with no trading history",
      "Wants a complex custom platform, not a business website",
    ],
    corePains: [
      "Buyers compare them against a competitor who has a real site and they lose before the phone rings",
      "Every booking depends on the owner personally answering",
      "No place to send ad clicks, referrals or Google searchers",
    ],
    defaultOfferLine:
      "A proper WordPress website of your own: your services, your area, your phone number on every page, built for a fixed price agreed up front.",
    defaultDontSay: [
      "Never promise the website alone will flood them with customers.",
      NEVER_PROMISE_RANKING,
      "Never mock the free page they started on. It got them this far.",
    ],
  },
  {
    slug: "woocommerce-store-setup",
    name: "WooCommerce Store Setup",
    priority: 4,
    idealProspect:
      "A seller with real products and real buyers who sells only through marketplaces or social DMs and does not own the place they sell from. Every sale pays a marketplace fee and the customer list belongs to the platform.",
    hotSignals: [
      "Selling actively on eBay, Etsy or Amazon with no store of their own",
      "Announced a product launch or restock with nowhere to sell it directly",
      "Complained publicly about marketplace fees or account limits",
    ],
    warmSignals: [
      "Strong social following driving DM orders",
      "Wholesale or repeat buyers who would reorder directly",
      "Has a WordPress site but no shop on it",
    ],
    disqualifiers: [
      "Already runs a working online store",
      "No products or no sales yet",
      "Needs a marketplace managed, not a store built (that is store management)",
    ],
    corePains: [
      "Marketplace fees come out of every single sale",
      "The customer list and repeat business belong to the platform",
      "One account problem can switch off their whole income",
    ],
    defaultOfferLine:
      "Your own WooCommerce store: your products, your checkout, your customer list, and no marketplace fee taken out of every sale.",
    defaultDontSay: [
      "Never promise store sales or traffic numbers.",
      "Never tell them to abandon the marketplace. The store sits alongside it first.",
    ],
  },
  {
    slug: "shopify-store-setup",
    name: "Shopify Store Setup",
    priority: 5,
    idealProspect:
      "A product brand or boutique ready for a permanent store of its own and without one yet, including funded crowdfunding creators whose campaign is ending and who need backers to become repeat buyers.",
    hotSignals: [
      "Kickstarter or Indiegogo campaign funded or live, ending soon",
      "Taking pre orders through DMs or a link page",
      "Announced a launch date with no store live",
    ],
    warmSignals: [
      "Selling at markets, pop ups or through Instagram only",
      "Has branding, photos and a product range ready",
      "Waitlist or email list already collecting names",
    ],
    disqualifiers: [
      "Already runs a working Shopify or WooCommerce store",
      "Wants custom Liquid development (this offer is theme based setup only)",
      "No product ready to sell",
    ],
    corePains: [
      "Launch attention has nowhere to convert",
      "Backers and followers cannot become repeat buyers",
      "Every order is manual, through messages",
    ],
    defaultOfferLine:
      "A Shopify store built on a proven theme: set up, products loaded, payments and shipping configured, ready to take orders.",
    defaultDontSay: [
      "Never offer or imply custom Liquid development in this pitch.",
      "Never promise launch sales figures.",
    ],
  },
  {
    slug: "wordpress-maintenance",
    name: "WordPress Maintenance and Management",
    priority: 6,
    idealProspect:
      "A business whose WordPress or WooCommerce site matters and still works, but has visibly been left alone: nobody updates it, backs it up or checks it, while the business behind it keeps trading.",
    hotSignals: [
      "Footer copyright or last blog post is two or more years old while the business is active on social media",
      "Visible outdated plugin or theme notices, or an old PHP warning",
      "Seasonal business heading into its busy period with a neglected site",
    ],
    warmSignals: [
      "Site content stale but the business is clearly trading",
      "No sign of a web person anywhere on the site",
      "Owner mentioned the site is on their list to sort out",
    ],
    disqualifiers: [
      "Site is hard broken (that is bug fix first)",
      "Has an agency or in house team actively maintaining it",
      "Site is not WordPress",
    ],
    corePains: [
      "One bad update or hack away from the site going down with no backup",
      "Stale content tells new customers the business may have closed",
      "Nobody is watching, so problems are found by customers first",
    ],
    defaultOfferLine:
      "A monthly care plan: updates, backups, security checks, uptime monitoring and small fixes handled for you, with a short report each month so you can see it is done.",
    defaultDontSay: [
      "Never use scare tactics about hacking as the main pitch. Sell the calm, not the fear.",
      "Never promise the site can never go down.",
    ],
  },
  {
    slug: "wordpress-customization",
    name: "WordPress Customization",
    priority: 7,
    idealProspect:
      "A business whose site works but is visibly unfinished: the owner or a first developer started the customization and stopped, and the evidence of where they stopped is still live on the page.",
    hotSignals: [
      "Default theme text still live, like the WordPress default tagline shown by Google",
      "Announced new services, locations or offers that the site does not show",
      "Half built pages, placeholder text or an empty shop section",
    ],
    warmSignals: [
      "Theme installed but left at its defaults",
      "New branding on social media that the site does not match",
      "A feature they advertise offline is missing online",
    ],
    disqualifiers: [
      "Professional build clearly in progress by an active agency",
      "Wants a full redesign (that is the redesign service)",
      "Site is broken rather than unfinished (bug fix first)",
    ],
    corePains: [
      "The site undersells what the business actually does now",
      "Customers cannot book, buy or find the new thing they announced",
      "The owner knows it is unfinished and it nags at every referral",
    ],
    defaultOfferLine:
      "The specific change you already want, finished properly for a fixed price: the section, the pages and the setup, done and checked on mobile.",
    defaultDontSay: [
      "Never rubbish the work that is already there. Someone may have done it themselves.",
      "Never expand the scope mid call into a redesign pitch.",
    ],
  },
  {
    slug: "product-upload-listings",
    name: "Product Listing and Upload",
    priority: 8,
    idealProspect:
      "A seller with a live, working WooCommerce or Shopify store whose catalog is visibly behind what they actually sell: products live in a spreadsheet, a supplier feed, a PDF price list or a marketplace catalog, but not in their own store.",
    hotSignals: [
      "New products announced on socials or their Google profile that are still not on the store days later",
      "Live listings with missing or broken images, placeholder titles or wrong prices on selling products",
      "Store running ads or Shopping to products whose listings are thin or mismatched",
      "Marketplace catalog is much larger than the store catalog",
      "Seasonal range change coming and the store still shows last season",
    ],
    warmSignals: [
      "Store products missing images, variants or prices",
      "Selling new lines on social media that the store does not carry",
      "PDF or printed catalog newer than the store",
    ],
    disqualifiers: [
      "No store yet (that is store setup)",
      "Store catalog already complete and current",
      "Wants ongoing management rather than a one off upload job (that is store management)",
    ],
    corePains: [
      "Customers cannot buy what the business actually sells",
      "Uploading products one by one eats the owner's evenings",
      "Messy listings with missing variants lose the sales that do arrive",
    ],
    defaultOfferLine:
      "A one off bulk upload: your products loaded properly into your own store, clean titles, prices, variants, images, categories and tags.",
    defaultDontSay: [
      "Never promise an upload count per hour you have not tested with their data.",
      "Never offer to scrape a competitor's catalog.",
    ],
  },
  {
    slug: "website-redesign",
    name: "Website Redesign",
    priority: 9,
    idealProspect:
      "Owner operated or small team (roughly 1 to 50 people) with a finished, working site that simply belongs to another decade: the business moved on, the website did not, and every new customer meets the old version of them first.",
    hotSignals: [
      "Business rebranded, moved or expanded while the site still shows the old identity",
      "Homepage imagery or content five or more years old",
      "Competitors in the same town launched visibly modern sites",
    ],
    warmSignals: [
      "Design predates mobile first browsing and it shows on a phone",
      "New services exist that the homepage never mentions",
      "Reviews and social presence are strong, the site is the weak link",
    ],
    disqualifiers: [
      "Site was redesigned in the last two years",
      "Site is broken or unfinished (bug fix or customization first)",
      "Decision sits with a corporate marketing department",
    ],
    corePains: [
      "The first impression contradicts the quality of the real business",
      "Mobile visitors get the worst version of the site",
      "New services and proof are invisible to new customers",
    ],
    defaultOfferLine:
      "A full redesign: modern layout, your current branding, a proper mobile experience, with your content, pages and search equity carried over.",
    defaultDontSay: [
      NEVER_PROMISE_RANKING,
      "Never tell them their site is ugly. Say the business outgrew it.",
    ],
  },
  {
    slug: "online-store-management",
    name: "Online Store Management",
    priority: 10,
    idealProspect:
      "An owner run WooCommerce or Shopify store that is trading, where the owner is also the store manager: catalog upkeep, price and stock updates, order and inventory admin are eating the hours they should spend growing the business.",
    hotSignals: [
      "Store visibly behind on stock, prices or seasons while social media is active",
      "Owner publicly said they are overwhelmed or hiring admin help",
      "Growing order volume mentioned in posts or reviews",
    ],
    warmSignals: [
      "Products out of stock still listed, or new stock unlisted",
      "Irregular posting and updating rhythm that suggests no spare time",
      "Multi channel seller juggling marketplaces plus a store",
    ],
    disqualifiers: [
      "Store not yet trading",
      "Wants ads management or marketing (operations only in this offer)",
      "Already has a store manager or agency",
    ],
    corePains: [
      "Admin hours crowd out selling and buying hours",
      "Stale stock and prices create refunds and angry messages",
      "Nobody owns the daily tidy, so it never gets done",
    ],
    defaultOfferLine:
      "A named pair of hands running your store's daily admin month after month: catalog, prices, stock and order admin kept tidy for a flat monthly fee.",
    defaultDontSay: [
      "Never offer ads management, SEO writing or marketing as part of this pitch. Operations only.",
      "Never promise sales growth. Promise the admin is handled.",
    ],
  },
  {
    slug: "ecommerce-customer-support",
    name: "Ecommerce Customer Support",
    priority: 11,
    idealProspect:
      "An online store with real order volume where the owner or a tiny team answers every customer message themselves, response times are slipping, and support quality is starting to show in reviews.",
    hotSignals: [
      "Actively hiring for support or customer service help, live post under 30 days old",
      "Recent reviews (under 60 days) complaining about unanswered phones, messages or slow replies, verbatim and dated",
      "Expanding hours, a new location or a new channel with the same small team",
      "Store advertising a sale or peak season with support visibly stretched",
    ],
    warmSignals: [
      "FAQ page thin while the same questions recur in reviews",
      "Social comments with customer questions left unanswered",
      "Founder doing support late at night, visible in reply timestamps",
    ],
    disqualifiers: [
      "Very low order volume, support is not yet a pain",
      "Needs support in a language or channel that is not offered",
      "Wants a call centre contract, not a small dedicated team",
    ],
    corePains: [
      "Slow replies cost sales and turn small problems into bad reviews",
      "The owner is the support desk, so support stops when they do",
      "Peak periods break the informal system completely",
    ],
    defaultOfferLine:
      "A small dedicated support team for your store: chat and email answered fast in your brand voice, with a free support audit and a trial week so you can judge the quality first.",
    defaultDontSay: [
      "Never promise response times the team has not agreed it can hold.",
      "Never criticise how they have handled customers so far.",
    ],
  },
  {
    slug: "merchant-center-feed-diagnostics",
    name: "Google Merchant Center and Feed Diagnostics",
    priority: 12,
    idealProspect:
      "A store running or trying to run Google Shopping whose Merchant Center account has disapprovals, limited performance or a suspension risk, and nobody who understands feed rules is looking at it.",
    hotSignals: [
      "Public proxy only: a product still visible in Shopping whose landing page returns a 404 or was deleted",
      "Public proxy only: visible price or availability mismatch between the Shopping listing and the landing page for the same variant",
      "Public proxy only: a sale started on the site while Shopping still shows the old price (stale feed pattern, dated evidence of both)",
    ],
    warmSignals: [
      "Store sells products Google Shopping clearly serves, but has no Shopping presence",
      "Feed data visibly thin: missing GTINs, weak titles, wrong categories",
      "Price or availability on the site often differs from the ads",
    ],
    disqualifiers: [
      "Store sells services, not products",
      "Account is permanently banned for policy fraud (not a diagnostics case)",
      "No live store or no product data to diagnose",
    ],
    corePains: [
      "Disapproved products are invisible to Shopping buyers",
      "Google's error messages do not say what to fix first",
      "Every week limited is a week of lost high intent traffic",
    ],
    defaultOfferLine:
      "A feed diagnostic: I go through your Merchant Center disapprovals and your feed data, and give you the fix list in priority order, then fix it with you.",
    defaultDontSay: [
      "HARD RULE: a prospect's actual Merchant Center disapproval status is private to the owner and can never be known from outside. Never claim on a call that their products are disapproved, limited or suspended. Only public proxies may be cited: a price or availability mismatch between a feed visible listing and the landing page, or a landing page error.",
      "Never guarantee reinstatement or approval. Google decides, not us.",
      "Never advise policy workarounds that misrepresent the products.",
    ],
  },
  {
    slug: "truck-dispatching",
    name: "Truck Dispatching",
    priority: 13,
    idealProspect:
      "A US owner operator or small fleet running dry van or reefer who is losing driving hours to load boards and broker calls, or paying a dispatcher who forces loads and communicates badly.",
    hotSignals: [
      "Owner operator posting in trucking groups about finding loads or hating load boards",
      "Truck seated and ready, recently got authority or added a truck",
      "Complained publicly about a dispatcher or about deadhead miles",
    ],
    warmSignals: [
      "One to five trucks, dry van or reefer, running interstate",
      "Active in owner operator communities online",
      "Mentioned paperwork, rate confirmations or factoring as a headache",
    ],
    disqualifiers: [
      "Company driver, not an owner operator",
      "Equipment other than dry van or reefer for the standard offer",
      "Expects a first load guarantee or free trial dispatching",
    ],
    corePains: [
      "Load searching eats the hours that should be driving",
      "Bad brokers and forced dispatch hurt the weekly gross",
      "Paperwork and check calls pile up on the road",
    ],
    defaultOfferLine:
      "Dispatch for a flat $300 per truck per week, only in weeks the truck is dispatched, no forced dispatch. The first week is a paid trial at the same $300.",
    defaultDontSay: [
      NEVER_FREE_WORK,
      "Never guarantee a first load or a weekly gross figure.",
      "Never bad mouth their current dispatcher by name.",
    ],
  },
];


/**
 * The 100 point lead scoring rubric (2026 research synthesis, built
 * on Clay style scoring inputs: fit, signal strength, recency and
 * reachability). HOT is gated, not just a total: a lead is only HOT
 * at 70 or more WITH Signal 30 or more, Reachability 12 or more and
 * Recency 10 or more, and the hot signal must have been verified
 * within the last 14 days. WARM is 40 to 69 (or a lead failing
 * exactly one hot gate). Below 40 a lead is parked, not called, and
 * below 20 or any disqualifier it is dropped. Hard disqualifiers run
 * first: any disqualifier means do not add the lead at all.
 */
export interface ScoreBlock {
  key: "fit" | "signal" | "recency" | "reachability";
  label: string;
  max: number;
  guide: string;
}

export const SCORE_BLOCKS: ScoreBlock[] = [
  {
    key: "fit",
    label: "Fit",
    max: 25,
    guide:
      "Correct stack or platform for the service (10). Depends on the website or store for revenue, a booking, calls or sales function is present (10). Size sweet spot: owner operated or small team who can say yes on one call (5).",
  },
  {
    key: "signal",
    label: "Signal",
    max: 40,
    guide:
      "Tier 1 signal on a money page (30 to 40; 40 when revenue is blocked today: checkout or booking down, store closed, ads running to a dead page). Two stacked Tier 2 signals (20 to 29). One Tier 2 signal (12 to 19). Tier 3 context only (0 to 8).",
  },
  {
    key: "recency",
    label: "Recency",
    max: 15,
    guide:
      "Signal 7 days old or re-verified within 7 days (15). 8 to 30 days (10). 31 to 90 days (5). Over 90 days or undated (0, and undated can never be HOT).",
  },
  {
    key: "reachability",
    label: "Reachability",
    max: 20,
    guide:
      "Named owner or manager with a direct or mobile number, or a business number plausibly answered by them, verified in 2 sources (20). Named owner, shop number only (12). No name, shop number or gatekeeper only (6). Contact form or social DM only (2).",
  },
];

export const HOT_TOTAL_MIN = 70;
export const HOT_SIGNAL_MIN = 30;
export const HOT_REACHABILITY_MIN = 12;
export const HOT_RECENCY_MIN = 10;
export const HOT_SIGNAL_VERIFIED_WITHIN_DAYS = 14;
export const WARM_TOTAL_MIN = 40;

/**
 * The calling cadence the pipeline runs on (2025 to 2026 research:
 * Gong and 30MPC opener and duration data, Cognism 2025 timing).
 * Shown as a reference block in the Calling UI so the rules sit
 * next to the leads they govern.
 */
export const CALLING_CADENCE_RULES: string[] = [
  "Best call windows: 9 to 11am and 2 to 3pm in the prospect's local time. Tuesday is the best day (Cognism 2025); midweek generally beats Monday and Friday.",
  "HOT leads: call today, inside the window, with the tailored permission opener built on the verified trigger.",
  "Maximum 5 dials per lead, then park it for 60 to 90 days. Chasing beyond that burns minutes and caller ID reputation.",
  "Voicemail: maximum 2 per lead, about 15 seconds, no pitch, and always paired with a same day email carrying the report. The voicemail exists to lift the email reply, not to win a callback.",
  "Every fact spoken on a call must be verified, sourced and recent. If the evidence is stale, re-verify before dialling or do not say it.",
  "Hand dial only, identify yourself and that it is a sales call up front, keep to 8am to 9pm prospect local at the outside, and honour every stop calling request the same day.",
];

const SERVICE_BY_SLUG = new Map(CALLING_SERVICES.map((service) => [service.slug, service]));

/**
 * State priority is shared with the UI, the API sort and the
 * daily lead pipeline. The data lives in statePriority.ts as the
 * single source of truth and is re-exported here for convenience.
 */
export {
  BLOCKED_STATE_NOTE,
  BLOCKED_STATES,
  HELD_STATES,
  STATE_PRIORITY,
} from "./statePriority";

export function getCallingService(slug: string | null | undefined): CallingService | null {
  if (!slug) return null;
  return SERVICE_BY_SLUG.get(slug) ?? null;
}

/** Services in call priority order, first call first. */
export function callingServicesByPriority(): CallingService[] {
  return [...CALLING_SERVICES].sort((a, b) => a.priority - b.priority);
}

/**
 * Catalog integrity problems, empty when the catalog is sound:
 * unique slugs and priorities, every service carries signals,
 * disqualifiers, pains, an offer line and a do not say list.
 */
export function validateServiceCatalog(services: CallingService[] = CALLING_SERVICES): string[] {
  const problems: string[] = [];
  const slugs = new Set<string>();
  const priorities = new Set<number>();
  for (const service of services) {
    if (slugs.has(service.slug)) problems.push(`Duplicate service slug: ${service.slug}`);
    slugs.add(service.slug);
    if (priorities.has(service.priority)) {
      problems.push(`Duplicate service priority: ${service.priority}`);
    }
    priorities.add(service.priority);
    if (!service.name.trim()) problems.push(`${service.slug}: missing name`);
    if (!service.idealProspect.trim()) problems.push(`${service.slug}: missing ideal prospect`);
    if (service.hotSignals.length === 0) problems.push(`${service.slug}: no hot signals`);
    if (service.warmSignals.length === 0) problems.push(`${service.slug}: no warm signals`);
    if (service.disqualifiers.length === 0) problems.push(`${service.slug}: no disqualifiers`);
    if (service.corePains.length === 0) problems.push(`${service.slug}: no core pains`);
    if (!service.defaultOfferLine.trim()) problems.push(`${service.slug}: missing offer line`);
    if (service.defaultDontSay.length === 0) problems.push(`${service.slug}: no do not say list`);
  }
  return problems;
}
