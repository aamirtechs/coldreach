/**
 * Phase 6 live smoke: launch and growth surfaces.
 *
 * Drives a running `next start` server over HTTP through the Phase 6
 * additions: the health version, the public pricing page rendered
 * from the plan catalog, the landing page pricing links, the
 * Settings Integrations status panel with every integration
 * unconfigured (the state a fresh deployment is in), HubSpot sync
 * gating, lead list verification (built-in checks only; this
 * environment has no VERIFY_API_KEY and outbound DNS is blocked, so
 * MX outcomes degrade to unknown, which the checks assert as the
 * graceful path), enrollment skipping INVALID leads and flagging
 * RISKY ones, and the warm-up cap enforced by a real worker tick
 * (an account on day 3 of warm-up with 25 due enrollments sends
 * exactly 20).
 *
 * Run after `npm run build` against a pristine migrated dev
 * database with no optional integration variables set:
 *   PORT=3100 npm run start, then
 *   SMOKE_BASE_URL=http://localhost:3100 npx tsx scripts/smoke-phase6.ts
 */

import { PrismaClient } from "@prisma/client";
import packageJson from "../package.json";

process.loadEnvFile(".env");

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const WORKER_SECRET = process.env.WORKER_SECRET ?? "";
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, extra?: string) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`FAIL  ${name}${extra ? ` :: ${extra}` : ""}`);
  }
}

/** Minimal per-user cookie jar (same pattern as the earlier smokes). */
class Jar {
  cookie = "";
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("Cookie", this.cookie);
    const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      this.cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
    }
    return response;
  }
  async api(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await this.fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, json };
  }
  async page(path: string): Promise<{ status: number; html: string }> {
    const response = await this.fetch(path);
    return { status: response.status, html: await response.text() };
  }
}

async function main(): Promise<void> {
  const owner = new Jar();
  const stamp = Date.now();

  // --- Platform and marketing surfaces --------------------------------
  const healthRes = await fetch(`${BASE}/api/health`);
  const health = (await healthRes.json()) as Record<string, unknown>;
  check(
    "health endpoint: ok, db ok, version is the package version",
    healthRes.status === 200 &&
      health.status === "ok" &&
      health.db === "ok" &&
      health.version === packageJson.version,
    JSON.stringify(health),
  );

  const pricing = await owner.page("/pricing");
  check(
    "pricing page renders the catalog values with the placeholder label",
    pricing.status === 200 &&
      pricing.html.includes("$29/mo") &&
      pricing.html.includes("$79/mo") &&
      pricing.html.includes("$199/mo") &&
      pricing.html.includes("placeholder pricing") &&
      pricing.html.includes("1,000") &&
      pricing.html.includes("Unlimited"),
  );

  const landing = await owner.page("/");
  check(
    "landing page links to /pricing from nav, section, and footer",
    landing.status === 200 && (landing.html.match(/href="\/pricing"/g) ?? []).length >= 2,
  );

  // --- Auth -------------------------------------------------------------
  const signupRes = await owner.fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Phase 6 Smoke Owner",
      email: `phase6-smoke-${stamp}@example.com`,
      password: "phase6-smoke-password",
      workspaceName: "Phase 6 Smoke Workspace",
    }),
  });
  const signup = (await signupRes.json().catch(() => ({}))) as {
    workspace?: { id: string };
  };
  const workspaceId = signup.workspace?.id ?? "";
  check("signup succeeds with a workspace", signupRes.status === 201 && Boolean(workspaceId));

  // Sender identity, required by the compliance footer check in
  // preflight before any campaign can launch (same setup the Phase 5
  // smoke performs).
  const identity = await owner.api("PATCH", "/api/workspace", {
    senderName: "Phase 6 Smoke Sender",
    senderAddress: "1 Smoke Street, Testville",
  });
  check("workspace sender identity saves", identity.status === 200);

  // --- Integrations status panel (nothing configured) -------------------
  const settings = await owner.page("/app/settings");
  check(
    "settings renders the Integrations status panel",
    settings.status === 200 && settings.html.includes("Integrations status"),
  );
  check(
    "panel rows report Not configured with exact missing variable names",
    settings.html.includes("Not configured") &&
      settings.html.includes("GOOGLE_CLIENT_ID") &&
      settings.html.includes("GOOGLE_CLIENT_SECRET") &&
      settings.html.includes("MS_CLIENT_ID") &&
      settings.html.includes("OPENAI_API_KEY") &&
      settings.html.includes("STRIPE_SECRET_KEY") &&
      settings.html.includes("STRIPE_PRICE_STARTER") &&
      settings.html.includes("VERIFY_API_KEY"),
  );
  check(
    "panel rows link to the ACTIVATION.md sections",
    settings.html.includes("ACTIVATION.md#2-google-oauth-gmail") &&
      settings.html.includes("ACTIVATION.md#5-stripe-billing"),
  );
  check(
    "HubSpot card reports Not configured naming its variables",
    settings.html.includes("HubSpot") && settings.html.includes("HUBSPOT_CLIENT_ID"),
  );

  const hubspotSync = await owner.api("POST", "/api/crm/hubspot/sync");
  check(
    "HubSpot sync endpoint refuses with 501 naming the missing variables",
    hubspotSync.status === 501 &&
      JSON.stringify(hubspotSync.json).includes("HUBSPOT_CLIENT_ID"),
    JSON.stringify(hubspotSync.json).slice(0, 200),
  );

  // --- Warm-up enforcement through a real tick ---------------------------
  const warmAccount = await owner.api("POST", "/api/accounts", {
    email: "warm@phase6.example",
    displayName: "Warm-up Sender",
    provider: "SIMULATION",
    dailyLimit: 500,
  });
  const warmAccountId = (warmAccount.json.account as { id: string }).id;
  check("warm-up account created", warmAccount.status === 201 && Boolean(warmAccountId));
  // Day 3 of warm-up (week 1 cap 20), account created 30 days ago so
  // the age ramp is fully lifted and only warm-up can throttle.
  await prisma.sendingAccount.update({
    where: { id: warmAccountId },
    data: {
      warmupEnabled: true,
      warmupStartedAt: new Date(Date.now() - 2 * 86_400_000),
      createdAt: new Date(Date.now() - 30 * 86_400_000),
    },
  });

  const warmList = await prisma.leadList.create({
    data: { workspaceId, name: "Warm-up list" },
  });
  for (let i = 0; i < 25; i += 1) {
    await prisma.lead.create({
      data: {
        workspaceId,
        listId: warmList.id,
        email: `warm-lead-${i}@prospects.example`,
        fields: { firstName: "Warm", company: "Prospect Co" },
        tags: [],
        status: "NEW",
      },
    });
  }
  const warmCampaign = await owner.api("POST", "/api/campaigns", {
    name: "Warm-up Campaign",
    leadListId: warmList.id,
  });
  const warmCampaignId = (warmCampaign.json.campaign as { id: string }).id;
  await owner.api("PATCH", `/api/campaigns/${warmCampaignId}`, {
    windowStart: "00:00",
    windowEnd: "23:59",
    businessDaysOnly: false,
    accountIds: [warmAccountId],
  });
  await owner.api("POST", `/api/campaigns/${warmCampaignId}/steps`, {
    steps: [{ subject: "Hello {{firstName}}", body: "Hi {{firstName}} at {{company}}.", delayDays: 0, delayHours: 0 }],
  });
  const warmEnroll = await owner.api("POST", `/api/campaigns/${warmCampaignId}/enroll`);
  check(
    "warm-up campaign enrolls all 25 leads",
    warmEnroll.status === 200 &&
      (warmEnroll.json.enrollment as { enrolled?: number } | undefined)?.enrolled === 25,
    JSON.stringify(warmEnroll.json).slice(0, 200),
  );
  const warmLaunch = await owner.api("POST", `/api/campaigns/${warmCampaignId}/launch`);
  check("warm-up campaign launches", warmLaunch.status === 200);

  const tick = await fetch(`${BASE}/api/worker/tick`, {
    method: "POST",
    headers: { "x-worker-secret": WORKER_SECRET },
  });
  const tickJson = (await tick.json().catch(() => ({}))) as { summary?: { sent?: number } };
  const warmSent = await prisma.emailEvent.count({
    where: { campaignId: warmCampaignId, type: "SENT" },
  });
  check(
    "worker tick caps the day-3 warm-up account at exactly 20 sends",
    tick.status === 200 && warmSent === 20,
    `tick sent=${tickJson.summary?.sent}, campaign SENT events=${warmSent}`,
  );

  // --- Lead verification (built-in checks only) ---------------------------
  const list = await owner.api("POST", "/api/lead-lists", { name: "Verify list" });
  const listId = (list.json.list as { id: string } | undefined)?.id ?? "";
  check("lead list created", list.status === 201 && Boolean(listId));
  for (const email of ["good-one@prospects.example", "broken-address", "temp@mailinator.com"]) {
    await prisma.lead.create({
      data: {
        workspaceId,
        listId,
        email,
        fields: { firstName: "Verify" },
        tags: [],
        status: "NEW",
      },
    });
  }
  const verify = await owner.api("POST", `/api/lead-lists/${listId}/verify`);
  const summary = (verify.json.summary ?? {}) as {
    total?: number;
    invalid?: number;
    providerConfigured?: boolean;
  };
  check(
    "verify list runs built-in checks for all 3 leads with no provider configured",
    verify.status === 200 && summary.total === 3 && summary.providerConfigured === false,
    JSON.stringify(verify.json).slice(0, 200),
  );
  const stored = await prisma.lead.findMany({ where: { listId } });
  const byEmail = new Map(stored.map((lead) => [lead.email, lead]));
  const broken = byEmail.get("broken-address");
  const temp = byEmail.get("temp@mailinator.com");
  const good = byEmail.get("good-one@prospects.example");
  check(
    "syntactically invalid lead is stored INVALID",
    broken?.verificationStatus === "INVALID",
    broken?.verificationStatus,
  );
  check(
    "disposable lead is flagged in its verification detail",
    (temp?.verificationDetail as { disposable?: boolean } | null)?.disposable === true,
    JSON.stringify(temp?.verificationDetail).slice(0, 200),
  );
  check(
    "MX check degrades gracefully to UNKNOWN when DNS cannot answer",
    good?.verificationStatus === "UNKNOWN" &&
      (good?.verificationDetail as { mx?: string } | null)?.mx === "unknown",
    `${good?.verificationStatus} ${JSON.stringify(good?.verificationDetail).slice(0, 200)}`,
  );

  // --- Enrollment verification rules over HTTP ----------------------------
  const plainAccount = await owner.api("POST", "/api/accounts", {
    email: "plain@phase6.example",
    displayName: "Plain Sender",
    provider: "SIMULATION",
    dailyLimit: 500,
  });
  const plainAccountId = (plainAccount.json.account as { id: string }).id;
  const campaign = await owner.api("POST", "/api/campaigns", {
    name: "Verification Campaign",
    leadListId: listId,
  });
  const campaignId = (campaign.json.campaign as { id: string }).id;
  await owner.api("PATCH", `/api/campaigns/${campaignId}`, {
    windowStart: "00:00",
    windowEnd: "23:59",
    businessDaysOnly: false,
    accountIds: [plainAccountId],
  });
  await owner.api("POST", `/api/campaigns/${campaignId}/steps`, {
    steps: [{ subject: "Hello {{firstName}}", body: "Hi {{firstName}}.", delayDays: 0, delayHours: 0 }],
  });
  const enroll = await owner.api("POST", `/api/campaigns/${campaignId}/enroll`);
  const enrollment = (enroll.json.enrollment ?? {}) as {
    enrolled?: number;
    skippedInvalidVerification?: number;
    enrolledRisky?: number;
  };
  check(
    "enrollment skips the INVALID lead and flags the RISKY one in its summary",
    enroll.status === 200 &&
      enrollment.enrolled === 2 &&
      enrollment.skippedInvalidVerification === 1 &&
      enrollment.enrolledRisky === 1,
    JSON.stringify(enroll.json).slice(0, 300),
  );

  console.log(`\nSmoke: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failures.length > 0) {
    console.log(`Failures: ${failures.join(" | ")}`);
  }
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error("Smoke crashed", error);
  await prisma.$disconnect();
  process.exit(1);
});
