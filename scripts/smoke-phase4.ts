/**
 * Phase 4 live smoke test.
 *
 * Drives a running `next start` server over HTTP (BASE_URL, default
 * http://localhost:3100), plus a throwaway webhook listener on
 * localhost:3999 and direct Prisma reads for event inspection and
 * quota seeding. Prints a pass/fail line per check and exits non-zero
 * when any check fails. Run after `npm run build` with the dev
 * database reset to a pristine migrated state.
 */

import http from "node:http";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

process.loadEnvFile(".env");

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const WORKER_SECRET = process.env.WORKER_SECRET ?? "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";
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

let cookie = "";

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, json };
}

interface CapturedHook {
  headers: http.IncomingHttpHeaders;
  body: string;
}

const capturedHooks: CapturedHook[] = [];
const listener = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    capturedHooks.push({ headers: request.headers, body });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
});

function verifySignature(secret: string, captured: CapturedHook): boolean {
  const expected = createHmac("sha256", secret).update(captured.body, "utf8").digest("hex");
  return captured.headers["x-coldreach-signature"] === expected;
}

async function main(): Promise<void> {
  await new Promise<void>((resolve) => listener.listen(3999, "127.0.0.1", resolve));

  // --- Signup and workspace identity --------------------------------
  const signup = await api("POST", "/api/auth/signup", {
    name: "Smoke Owner",
    email: "smoke-owner@example.com",
    password: "smoke-password-1",
    workspaceName: "Smoke HQ",
  });
  check("signup returns 201 with a session", signup.status === 201 && Boolean(cookie));
  const workspaceId = (signup.json.workspace as { id: string }).id;

  const identity = await api("PATCH", "/api/workspace", {
    senderName: "Smoke Sender",
    senderAddress: "1 Smoke Street, Testville",
  });
  check("workspace sender identity saves", identity.status === 200);

  const account = await api("POST", "/api/accounts", {
    email: "sender@smoke.example",
    displayName: "Smoke Sender",
    provider: "SIMULATION",
    dailyLimit: 100000,
  });
  check("simulation account created CONNECTED", account.status === 201 && (account.json.account as { status: string }).status === "CONNECTED");
  const accountId = (account.json.account as { id: string }).id;

  // --- API keys -------------------------------------------------------
  const fullKeyRes = await api("POST", "/api/settings/api-keys", {
    name: "smoke full",
    scopes: ["leads:read", "leads:write", "suppressions:write", "stats:read"],
  });
  check("API key creation returns the full key once", fullKeyRes.status === 201 && typeof fullKeyRes.json.fullKey === "string");
  const fullKey = fullKeyRes.json.fullKey as string;

  const readerKeyRes = await api("POST", "/api/settings/api-keys", {
    name: "smoke reader",
    scopes: ["leads:read"],
  });
  const readerKey = readerKeyRes.json.fullKey as string;
  check("second API key created", readerKeyRes.status === 201 && typeof readerKey === "string");

  const noKey = await fetch(`${BASE}/api/v1/leads`);
  check("public API without a key returns 401", noKey.status === 401);

  const readerList = await fetch(`${BASE}/api/v1/leads`, {
    headers: { Authorization: `Bearer ${readerKey}` },
  });
  check("public API with a leads:read key returns 200", readerList.status === 200);

  const wrongScope = await fetch(`${BASE}/api/v1/campaigns/anything/stats`, {
    headers: { Authorization: `Bearer ${readerKey}` },
  });
  check("stats with a leads-only key returns 403 (wrong scope)", wrongScope.status === 403);

  // --- Lead list and leads through the public API ---------------------
  const list = await api("POST", "/api/lead-lists", { name: "Smoke list" });
  const listId = (list.json.list as { id: string } | undefined)?.id ?? (list.json as { id: string }).id;
  check("lead list created", list.status === 201 && Boolean(listId));

  let created = 0;
  for (let i = 0; i < 120; i += 1) {
    const res = await fetch(`${BASE}/api/v1/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${fullKey}` },
      body: JSON.stringify({
        email: `lead-${i}@prospects.example`,
        listId,
        fields: { firstName: `Lead${i}`, company: "Prospect Co" },
      }),
    });
    if (res.status === 201) created += 1;
  }
  check("120 leads created through the public API", created === 120, `created=${created}`);

  // The bulk creates above exhaust the first key's 120-requests-per-
  // minute budget by design, so the remaining public API checks use a
  // fresh key with its own rate-limit bucket.
  const opsKeyRes = await api("POST", "/api/settings/api-keys", {
    name: "smoke ops",
    scopes: ["leads:read", "leads:write", "suppressions:write", "stats:read"],
  });
  const opsKey = opsKeyRes.json.fullKey as string;
  check("fresh ops key created for post-bulk checks", opsKeyRes.status === 201 && typeof opsKey === "string");

  const duplicate = await fetch(`${BASE}/api/v1/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opsKey}` },
    body: JSON.stringify({ email: "lead-0@prospects.example", listId }),
  });
  check("duplicate lead through the public API returns 409", duplicate.status === 409);

  const suppression = await fetch(`${BASE}/api/v1/suppressions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opsKey}` },
    body: JSON.stringify({ email: "blocked@prospects.example", reason: "smoke test" }),
  });
  check("suppression created through the public API", suppression.status === 201);

  const suppressedLead = await fetch(`${BASE}/api/v1/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opsKey}` },
    body: JSON.stringify({ email: "blocked@prospects.example", listId }),
  });
  check("suppressed lead is refused by the public API with 422", suppressedLead.status === 422);

  // --- A/B campaign -----------------------------------------------------
  const campaign = await api("POST", "/api/campaigns", { name: "Smoke AB", leadListId: listId });
  const campaignId = (campaign.json.campaign as { id: string }).id;
  check("campaign created", campaign.status === 201 && Boolean(campaignId));

  const patched = await api("PATCH", `/api/campaigns/${campaignId}`, {
    windowStart: "00:00",
    windowEnd: "23:59",
    businessDaysOnly: false,
    accountIds: [accountId],
  });
  check("campaign settings patched (window + account)", patched.status === 200, JSON.stringify(patched.json).slice(0, 200));

  const steps = await api("POST", `/api/campaigns/${campaignId}/steps`, {
    steps: [
      {
        subject: "Variant A subject for {{firstName}}",
        body: "Hi {{firstName}}, variant A body about {{company}}.",
        delayDays: 0,
        delayHours: 0,
        variants: [
          {
            subject: "Variant B subject for {{firstName}}",
            bodyText: "Hi {{firstName}}, variant B body about {{company}}.",
            weight: 1,
          },
        ],
      },
    ],
  });
  const savedSteps = steps.json.steps as { variants?: unknown[] }[];
  check(
    "steps save with one variant (B)",
    steps.status === 200 && savedSteps.length === 1 && (savedSteps[0].variants?.length ?? 0) === 1,
    JSON.stringify(steps.json).slice(0, 200),
  );

  const enroll = await api("POST", `/api/campaigns/${campaignId}/enroll`);
  check(
    "enrollment creates 120 enrollments",
    enroll.status === 200 && (enroll.json.enrollment as { enrolled?: number } | undefined)?.enrolled === 120,
    JSON.stringify(enroll.json).slice(0, 200),
  );

  const preflightRes = await api("GET", `/api/campaigns/${campaignId}/preflight`);
  const preflight = preflightRes.json.preflight as { canLaunch?: boolean } | undefined;
  check(
    "preflight passes for the A/B campaign",
    preflightRes.status === 200 && preflight?.canLaunch === true,
    JSON.stringify(preflightRes.json).slice(0, 300),
  );

  const launch = await api("POST", `/api/campaigns/${campaignId}/launch`);
  check("campaign launches", launch.status === 200, JSON.stringify(launch.json).slice(0, 200));

  // --- Webhook endpoint + test delivery --------------------------------
  const hook = await api("POST", "/api/settings/webhooks", {
    url: "http://localhost:3999/hook",
    eventTypes: ["REPLIED"],
  });
  check("webhook endpoint created with a one-time secret", hook.status === 201 && typeof hook.json.secret === "string", JSON.stringify(hook.json).slice(0, 200));
  const hookSecret = hook.json.secret as string;
  const hookId = (hook.json.endpoint as { id: string }).id;

  const testDelivery = await api("POST", `/api/settings/webhooks/${hookId}/test`);
  const testCaptured = capturedHooks.find((entry) => (JSON.parse(entry.body) as { event?: string }).event === "test");
  check(
    "test delivery arrives at the local listener with a verifiable signature",
    testDelivery.status === 200 &&
      (testDelivery.json.delivery as { status: string }).status === "DELIVERED" &&
      Boolean(testCaptured) &&
      verifySignature(hookSecret, testCaptured as CapturedHook),
  );

  // --- Worker tick sends with variant labels ---------------------------
  const tick = await fetch(`${BASE}/api/worker/tick`, {
    method: "POST",
    headers: { "x-worker-secret": WORKER_SECRET },
  });
  const tickJson = (await tick.json().catch(() => ({}))) as { summary?: { sent?: number } };
  check("worker tick sends all 120 step sends", tick.status === 200 && tickJson.summary?.sent === 120, JSON.stringify(tickJson).slice(0, 300));

  const sentEvents = await prisma.emailEvent.findMany({
    where: { workspaceId, campaignId, type: "SENT" },
    select: { variant: true, providerMessageId: true },
  });
  const variantALabels = sentEvents.filter((event) => event.variant === "A").length;
  const variantBLabels = sentEvents.filter((event) => event.variant === "B").length;
  check(
    "SENT events carry both variant labels",
    sentEvents.length === 120 && variantALabels >= 30 && variantBLabels >= 30,
    `A=${variantALabels} B=${variantBLabels}`,
  );

  // Deliver everything, then reply unevenly: A at ~10%, B at ~50%.
  let deliveredCount = 0;
  for (const event of sentEvents) {
    const res = await fetch(`${BASE}/api/webhooks/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
      body: JSON.stringify({ providerMessageId: event.providerMessageId, type: "DELIVERED" }),
    });
    if (res.status === 200) deliveredCount += 1;
  }
  check("all 120 DELIVERED events accepted", deliveredCount === 120, `delivered=${deliveredCount}`);

  const aEvents = sentEvents.filter((event) => event.variant === "A");
  const bEvents = sentEvents.filter((event) => event.variant === "B");
  const replyTargets = [
    ...aEvents.slice(0, Math.max(1, Math.round(aEvents.length * 0.1))),
    ...bEvents.slice(0, Math.round(bEvents.length * 0.5)),
  ];
  let repliedCount = 0;
  for (const event of replyTargets) {
    const res = await fetch(`${BASE}/api/webhooks/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
      body: JSON.stringify({ providerMessageId: event.providerMessageId, type: "REPLIED", classification: "POSITIVE" }),
    });
    if (res.status === 200) repliedCount += 1;
  }
  check("reply events accepted", repliedCount === replyTargets.length, `replied=${repliedCount}/${replyTargets.length}`);

  // --- A/B analytics through the public API -----------------------------
  const statsRes = await fetch(`${BASE}/api/v1/campaigns/${campaignId}/stats`, {
    headers: { Authorization: `Bearer ${opsKey}` },
  });
  const stats = (await statsRes.json()) as {
    metrics?: { sent?: number };
    variants?: { label: string; sent: number }[];
    winner?: { label: string } | null;
  };
  check(
    "v1 stats returns both variants and 120 sends",
    statsRes.status === 200 &&
      stats.metrics?.sent === 120 &&
      (stats.variants?.length ?? 0) === 2 &&
      stats.variants?.every((variant) => variant.sent >= 30) === true,
    JSON.stringify(stats).slice(0, 300),
  );
  check("v1 stats declares variant B the winner", stats.winner?.label === "B", JSON.stringify(stats.winner));

  const abStats = await api("GET", `/api/campaigns/${campaignId}/ab-stats`);
  check(
    "session A/B endpoint agrees on the winner",
    abStats.status === 200 && (abStats.json.winner as { label: string } | null)?.label === "B",
  );

  // --- Real reply event delivered to the webhook endpoint ----------------
  const tick2 = await fetch(`${BASE}/api/worker/tick`, {
    method: "POST",
    headers: { "x-worker-secret": WORKER_SECRET },
  });
  const replyDelivery = capturedHooks.find(
    (entry) => (JSON.parse(entry.body) as { event?: string }).event === "REPLIED",
  );
  check(
    "a real REPLIED event is delivered to the webhook endpoint with a verifiable signature",
    tick2.status === 200 && Boolean(replyDelivery) && verifySignature(hookSecret, replyDelivery as CapturedHook),
  );

  // --- AI gating ---------------------------------------------------------
  const aiStatus = await api("GET", "/api/ai/status");
  check(
    "AI status reports not configured without OPENAI_API_KEY",
    aiStatus.status === 200 && aiStatus.json.configured === false,
  );
  const aiSubjects = await api("POST", "/api/ai/subjects", { body: "Hello", count: 3 });
  check(
    "AI subjects endpoint returns the 501 not-configured shape",
    aiSubjects.status === 501 &&
      Array.isArray(aiSubjects.json.missingEnv) &&
      (aiSubjects.json.missingEnv as string[]).includes("OPENAI_API_KEY"),
    `status=${aiSubjects.status}`,
  );
  const aiIcebreaker = await api("POST", "/api/ai/icebreaker", { leadId: "any" });
  check("AI icebreaker endpoint returns 501 as well", aiIcebreaker.status === 501);

  // --- Quota: seed usage near the FREE cap, preflight must FAIL ----------
  const now = new Date();
  const seedRows = Array.from({ length: 850 }, (_, i) => ({
    workspaceId,
    type: "SENT" as const,
    idempotencyKey: `smoke-seed:${i}`,
    occurredAt: now,
  }));
  await prisma.emailEvent.createMany({ data: seedRows });

  const list2 = await api("POST", "/api/lead-lists", { name: "Quota list" });
  const list2Id = (list2.json.list as { id: string } | undefined)?.id ?? (list2.json as { id: string }).id;
  for (let i = 0; i < 40; i += 1) {
    await api("POST", "/api/leads", { email: `quota-${i}@prospects.example`, listId: list2Id });
  }
  const campaign2 = await api("POST", "/api/campaigns", { name: "Quota campaign", leadListId: list2Id });
  const campaign2Id = (campaign2.json.campaign as { id: string }).id;
  await api("PATCH", `/api/campaigns/${campaign2Id}`, {
    windowStart: "00:00",
    windowEnd: "23:59",
    businessDaysOnly: false,
    accountIds: [accountId],
  });
  await api("POST", `/api/campaigns/${campaign2Id}/steps`, {
    steps: [{ subject: "Quota step", body: "Quota body", delayDays: 0, delayHours: 0 }],
  });
  await api("POST", `/api/campaigns/${campaign2Id}/enroll`);
  const quotaPreflightRes = await api("GET", `/api/campaigns/${campaign2Id}/preflight`);
  const quotaPreflight = quotaPreflightRes.json.preflight as
    | { canLaunch?: boolean; checks?: { id: string; status: string }[] }
    | undefined;
  const quotaChecks = quotaPreflight?.checks ?? [];
  check(
    "preflight FAILs on quota near the FREE cap (970 used + 40 projected > 1000)",
    quotaChecks.some((entry) => entry.id === "quota" && entry.status === "fail") &&
      quotaPreflight?.canLaunch === false,
    JSON.stringify(quotaChecks).slice(0, 300),
  );

  // --- Billing override + pages ------------------------------------------
  const billingBefore = await api("GET", "/api/billing");
  check(
    "billing overview shows FREE plan and Stripe not configured",
    billingBefore.status === 200 &&
      (billingBefore.json.subscription as { plan: string }).plan === "FREE" &&
      (billingBefore.json.stripe as { configured: boolean }).configured === false,
  );
  const override = await api("POST", "/api/billing/plan", { plan: "STARTER" });
  check("owner manual plan override applies", override.status === 200 && (override.json.subscription as { plan: string }).plan === "STARTER");

  const billingPage = await fetch(`${BASE}/app/billing`, { headers: { Cookie: cookie } });
  const billingHtml = await billingPage.text();
  check("billing page renders", billingPage.status === 200 && billingHtml.includes("Billing"));

  const integrationsPage = await fetch(`${BASE}/app/integrations`, { headers: { Cookie: cookie } });
  const integrationsHtml = await integrationsPage.text();
  check(
    "integrations page renders the real API and webhook panels",
    integrationsPage.status === 200 && integrationsHtml.includes("Public API keys") && integrationsHtml.includes("Outbound webhooks"),
  );

  const analyticsPage = await fetch(`${BASE}/app/analytics`, { headers: { Cookie: cookie } });
  const analyticsHtml = await analyticsPage.text();
  check(
    "analytics page shows the A/B section with the winner",
    // React SSR splits interpolated text into separate nodes, so the
    // badge arrives as "Winner: variant" + "B" rather than one string.
    analyticsPage.status === 200 &&
      analyticsHtml.includes("A/B test results") &&
      analyticsHtml.includes("Winner: variant") &&
      analyticsHtml.includes("(winner)"),
  );

  // --- Agency --------------------------------------------------------------
  const ws2 = await api("POST", "/api/workspace/create", { name: "Smoke Client B" });
  check("second workspace created with the user as OWNER", ws2.status === 201);

  const agencyPage = await fetch(`${BASE}/app/agency`, { headers: { Cookie: cookie } });
  const agencyHtml = await agencyPage.text();
  check(
    "agency page rolls up both owned workspaces with this month's sends",
    agencyPage.status === 200 &&
      agencyHtml.includes("Agency Command Center") &&
      agencyHtml.includes("Smoke HQ") &&
      agencyHtml.includes("Smoke Client B") &&
      agencyHtml.includes("970"),
    `status=${agencyPage.status}`,
  );

  console.log(`\nSmoke: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failures.length > 0) {
    console.log(`Failures: ${failures.join(" | ")}`);
  }
  listener.close();
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error("Smoke crashed", error);
  listener.close();
  await prisma.$disconnect();
  process.exit(1);
});
