/**
 * Phase 5 live QA smoke.
 *
 * Drives a running `next start` server over HTTP through the final
 * QA checklist journeys (QA.md): platform surfaces (health, security
 * headers, branded 404), auth hardening (password policy, login,
 * rate limits), the full campaign journey, reply sync into the
 * inbox, deliverability, team invites, the public API, webhooks,
 * quota and billing, the agency rollup, and the workspace export
 * with its redaction rules. Reply sync is driven in-process through
 * the real sync service with the FakeSource, the same seam the
 * Phase 3 tests use, because no real mailbox exists in this
 * environment.
 *
 * Run after `npm run build` against a pristine migrated dev
 * database:  npm run start (port 3100), then
 * SMOKE_BASE_URL=http://localhost:3100 npx tsx scripts/smoke-phase5.ts
 */

import http from "node:http";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import packageJson from "../package.json";
import { FakeSource, syncAccount } from "../src/lib/sync/syncService";

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

/** Minimal per-user cookie jar. */
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
  ): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
    const response = await this.fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, json, headers: response.headers };
  }
  async page(path: string): Promise<{ status: number; html: string }> {
    const response = await this.fetch(path);
    return { status: response.status, html: await response.text() };
  }
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
  const owner = new Jar();

  // --- A. Platform surfaces -------------------------------------------
  const healthRes = await fetch(`${BASE}/api/health`);
  const health = (await healthRes.json()) as Record<string, unknown>;
  check(
    "health endpoint: 200 with ok status, db ok, version, time, and nothing else",
    healthRes.status === 200 &&
      health.status === "ok" &&
      health.db === "ok" &&
      health.version === packageJson.version &&
      typeof health.time === "string" &&
      Object.keys(health).sort().join(",") === "db,status,time,version",
    JSON.stringify(health),
  );

  const landing = await fetch(`${BASE}/`);
  const landingHtml = await landing.text();
  const csp = landing.headers.get("content-security-policy") ?? "";
  check(
    "security headers on the landing page (CSP locked to self, nosniff, referrer, permissions, frame deny)",
    landing.status === 200 &&
      csp.includes("default-src 'self'") &&
      csp.includes("frame-ancestors 'none'") &&
      landing.headers.get("x-content-type-options") === "nosniff" &&
      landing.headers.get("referrer-policy") === "strict-origin-when-cross-origin" &&
      (landing.headers.get("permissions-policy") ?? "").includes("camera=()") &&
      landing.headers.get("x-frame-options") === "DENY",
  );
  check(
    "HSTS is present under next start (production mode)",
    (landing.headers.get("strict-transport-security") ?? "").includes("max-age=31536000"),
  );
  const healthHeaders = await fetch(`${BASE}/api/health`);
  check(
    "security headers also cover API routes",
    (healthHeaders.headers.get("content-security-policy") ?? "").includes("default-src 'self'"),
  );
  check("landing page renders the product headline", landingHtml.includes("ColdReach"));

  const notFound = await fetch(`${BASE}/definitely-not-a-page`);
  const notFoundHtml = await notFound.text();
  check(
    "unknown route renders the branded 404",
    notFound.status === 404 && notFoundHtml.includes("Page not found"),
  );

  // --- B. Auth hardening ------------------------------------------------
  const shortPassword = await owner.api("POST", "/api/auth/signup", {
    name: "Short",
    email: "short@example.com",
    password: "short",
  });
  check(
    "signup rejects a password under 10 characters",
    shortPassword.status === 400 &&
      String(shortPassword.json.error ?? "").includes("at least 10 characters"),
    `status=${shortPassword.status}`,
  );

  const signupRes = await owner.fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "QA Owner",
      email: "qa-owner@example.com",
      password: "qa-owner-password-1",
      workspaceName: "QA HQ",
    }),
  });
  const signup = (await signupRes.json()) as {
    workspace?: { id: string };
    user?: { id: string };
  };
  const setCookieHeader = (signupRes.headers.getSetCookie?.() ?? []).join(" ");
  check("signup succeeds with a workspace", signupRes.status === 201 && Boolean(signup.workspace?.id));
  check(
    "session cookie is httpOnly, SameSite=lax, Secure in production, path scoped",
    setCookieHeader.includes("HttpOnly") &&
      /SameSite=lax/i.test(setCookieHeader) &&
      setCookieHeader.includes("Secure") &&
      setCookieHeader.includes("Path=/"),
    setCookieHeader.slice(0, 200),
  );
  const workspaceId = signup.workspace?.id as string;
  const ownerUserId = signup.user?.id as string;

  const wrongLogin = await new Jar().api("POST", "/api/auth/login", {
    email: "qa-owner@example.com",
    password: "not-the-password",
  });
  check(
    "login with a wrong password returns the generic 401",
    wrongLogin.status === 401 && wrongLogin.json.error === "Invalid email or password",
  );
  const goodLogin = await new Jar().api("POST", "/api/auth/login", {
    email: "qa-owner@example.com",
    password: "qa-owner-password-1",
  });
  check("login with the correct password succeeds", goodLogin.status === 200);

  // Rate limit: a dedicated account, 10 bad attempts, then even the
  // correct password is refused with 429 + Retry-After.
  const rl = new Jar();
  await rl.api("POST", "/api/auth/signup", {
    name: "Rate Limited",
    email: "rl@example.com",
    password: "rl-password-123",
  });
  let lastBadStatus = 0;
  for (let i = 0; i < 10; i += 1) {
    const attempt = await new Jar().api("POST", "/api/auth/login", {
      email: "rl@example.com",
      password: "wrong-password",
    });
    lastBadStatus = attempt.status;
  }
  const eleventh = await new Jar().api("POST", "/api/auth/login", {
    email: "rl@example.com",
    password: "rl-password-123",
  });
  check(
    "login rate limit: first 10 attempts are 401, the 11th is 429 with Retry-After",
    lastBadStatus === 401 &&
      eleventh.status === 429 &&
      Number(eleventh.headers.get("retry-after") ?? 0) > 0,
    `lastBad=${lastBadStatus} eleventh=${eleventh.status}`,
  );

  // Signup rate limit on one email: 1 success + 9 conflicts, then 429.
  let signupStatuses: number[] = [];
  for (let i = 0; i < 11; i += 1) {
    const attempt = await new Jar().api("POST", "/api/auth/signup", {
      name: "Dup",
      email: "dup@example.com",
      password: "dup-password-1",
    });
    signupStatuses.push(attempt.status);
  }
  check(
    "signup rate limit: the 11th signup attempt for one email is 429",
    signupStatuses[0] === 201 && signupStatuses[10] === 429,
    signupStatuses.join(","),
  );

  // --- C. Core journey ---------------------------------------------------
  const dashBefore = await owner.page("/app");
  check(
    "dashboard shows the getting started checklist before setup",
    dashBefore.status === 200 && dashBefore.html.includes("Getting started"),
  );

  const identity = await owner.api("PATCH", "/api/workspace", {
    senderName: "QA Sender",
    senderAddress: "1 QA Street, Testville",
  });
  check("workspace sender identity saves", identity.status === 200);

  const list = await owner.api("POST", "/api/lead-lists", { name: "QA list" });
  const listId = (list.json.list as { id: string } | undefined)?.id ?? (list.json as { id: string }).id;
  check("lead list created", list.status === 201 && Boolean(listId));

  const csv = [
    "Email,First,Company",
    ...Array.from({ length: 6 }, (_, i) => `qa-lead-${i}@prospects.example,Lead${i},Prospect Co`),
  ].join("\n");
  const imported = await owner.api("POST", `/api/lead-lists/${listId}/import`, {
    csvText: csv,
    mapping: { Email: "email", First: "firstName", Company: "company" },
  });
  const importSummary = (imported.json.summary ?? {}) as { kept?: number; total?: number };
  check(
    "CSV import keeps all 6 rows",
    imported.status === 200 && importSummary.kept === 6,
    JSON.stringify(imported.json).slice(0, 200),
  );

  const account = await owner.api("POST", "/api/accounts", {
    email: "sender@qa.example",
    displayName: "QA Sender",
    provider: "SIMULATION",
    dailyLimit: 100000,
  });
  const accountId = (account.json.account as { id: string }).id;
  check(
    "simulation account created CONNECTED",
    account.status === 201 && (account.json.account as { status: string }).status === "CONNECTED",
  );

  const campaign = await owner.api("POST", "/api/campaigns", { name: "QA Campaign", leadListId: listId });
  const campaignId = (campaign.json.campaign as { id: string }).id;
  await owner.api("PATCH", `/api/campaigns/${campaignId}`, {
    windowStart: "00:00",
    windowEnd: "23:59",
    businessDaysOnly: false,
    accountIds: [accountId],
  });
  const steps = await owner.api("POST", `/api/campaigns/${campaignId}/steps`, {
    steps: [
      {
        subject: "Hello {{firstName}}",
        body: "Hi {{firstName}} at {{company}}, variant A.",
        delayDays: 0,
        delayHours: 0,
        variants: [{ subject: "Quick hello {{firstName}}", bodyText: "Hi {{firstName}}, variant B.", weight: 1 }],
      },
    ],
  });
  check(
    "sequence saves with a B variant",
    steps.status === 200 &&
      ((steps.json.steps as { variants?: unknown[] }[])[0]?.variants?.length ?? 0) === 1,
  );

  const enroll = await owner.api("POST", `/api/campaigns/${campaignId}/enroll`);
  check(
    "enrollment creates 6 enrollments",
    enroll.status === 200 &&
      (enroll.json.enrollment as { enrolled?: number } | undefined)?.enrolled === 6,
    JSON.stringify(enroll.json).slice(0, 200),
  );

  const preflightRes = await owner.api("GET", `/api/campaigns/${campaignId}/preflight`);
  check(
    "preflight passes",
    preflightRes.status === 200 &&
      (preflightRes.json.preflight as { canLaunch?: boolean } | undefined)?.canLaunch === true,
    JSON.stringify(preflightRes.json).slice(0, 300),
  );

  const launch = await owner.api("POST", `/api/campaigns/${campaignId}/launch`);
  check("campaign launches", launch.status === 200);

  const tick = await fetch(`${BASE}/api/worker/tick`, {
    method: "POST",
    headers: { "x-worker-secret": WORKER_SECRET },
  });
  const tickJson = (await tick.json().catch(() => ({}))) as { summary?: { sent?: number } };
  check(
    "worker tick sends the 6 step emails",
    tick.status === 200 && tickJson.summary?.sent === 6,
    JSON.stringify(tickJson).slice(0, 200),
  );

  const dashAfter = await owner.page("/app");
  check(
    "dashboard checklist reaches the all set state after the journey",
    dashAfter.html.includes("all set"),
  );

  // --- D. Inbox via reply sync -------------------------------------------
  const sentEvent = await prisma.emailEvent.findFirst({
    where: { workspaceId, campaignId, type: "SENT" },
    select: { providerMessageId: true, enrollmentId: true },
  });
  const enrollment = sentEvent?.enrollmentId
    ? await prisma.enrollment.findUnique({
        where: { id: sentEvent.enrollmentId },
        include: { lead: true },
      })
    : null;
  check("a SENT event with a lead exists for the reply", Boolean(sentEvent && enrollment));

  const accountRow = await prisma.sendingAccount.findUnique({ where: { id: accountId } });
  const replyMessage = {
    providerMessageId: "qa-reply-1",
    fromEmail: enrollment?.lead.email ?? "qa-lead-0@prospects.example",
    toEmail: "sender@qa.example",
    subject: "Re: Hello",
    bodyText: "Thanks, this looks interesting. Can we talk this week?",
    receivedAt: new Date(),
    inReplyTo: sentEvent?.providerMessageId ?? null,
    references: [],
  };
  const syncSummary = accountRow
    ? await syncAccount(prisma, accountRow, { source: new FakeSource([replyMessage]) })
    : null;
  check(
    "reply sync imports the reply",
    Boolean(syncSummary) && syncSummary?.imported === 1,
    JSON.stringify(syncSummary),
  );

  const threadsRes = await owner.api("GET", "/api/threads");
  const threads = (threadsRes.json.threads ?? []) as { id: string; subject: string }[];
  check(
    "the reply appears in the inbox thread list",
    threadsRes.status === 200 && threads.length >= 1,
    `total=${threads.length}`,
  );
  const threadId = threads[0]?.id as string;

  const enrollmentAfter = enrollment
    ? await prisma.enrollment.findUnique({ where: { id: enrollment.id } })
    : null;
  check(
    "the enrollment is REPLIED after sync (sequence stopped)",
    enrollmentAfter?.status === "REPLIED",
    enrollmentAfter?.status,
  );

  const note = await owner.api("POST", `/api/threads/${threadId}/notes`, {
    body: "QA note: call this lead on Tuesday",
  });
  check("an internal note can be added", note.status === 201 || note.status === 200, `status=${note.status}`);

  const assign = await owner.api("PATCH", `/api/threads/${threadId}`, { assigneeId: ownerUserId });
  check(
    "the thread can be assigned to the owner",
    assign.status === 200 &&
      (assign.json.thread as { assigneeId?: string } | undefined)?.assigneeId === ownerUserId,
    JSON.stringify(assign.json).slice(0, 200),
  );

  const inboxPage = await owner.page("/app/inbox");
  check(
    "inbox page renders",
    inboxPage.status === 200 && inboxPage.html.includes("Inbox"),
  );

  // --- E. Deliverability ---------------------------------------------------
  const dnsRes = await owner.api("GET", "/api/deliverability/check?domain=example.com");
  const report = dnsRes.json.report as { domain?: string; grade?: string; findings?: unknown[] } | undefined;
  check(
    "deliverability check returns a graded report (graceful path included)",
    dnsRes.status === 200 && report?.domain === "example.com" && Array.isArray(report?.findings),
    JSON.stringify(dnsRes.json).slice(0, 200),
  );
  console.log(`      deliverability example.com: grade=${report?.grade} findings=${report?.findings?.length}`);

  const accountsPage = await owner.page("/app/accounts");
  check(
    "accounts page renders the deliverability panel",
    accountsPage.status === 200 && accountsPage.html.includes("Deliverability diagnostics"),
  );

  // --- F. Team invite and accept -------------------------------------------
  const invite = await owner.api("POST", "/api/team/invites", {
    email: "member5@example.com",
    role: "MEMBER",
  });
  const acceptUrl = String(invite.json.acceptUrl ?? "");
  const inviteToken = acceptUrl.split("/invite/")[1] ?? "";
  check(
    "invite is created with an accept link (no SMTP account, link returned)",
    invite.status === 201 && inviteToken.length > 10,
    JSON.stringify(invite.json).slice(0, 200),
  );

  const member = new Jar();
  const memberSignup = await member.api("POST", "/api/auth/signup", {
    name: "Member Five",
    email: "member5@example.com",
    password: "member-password-1",
  });
  check("invitee signs up", memberSignup.status === 201);
  const accept = await member.api("POST", "/api/invites/accept", { token: inviteToken });
  check(
    "invitee accepts and joins with the MEMBER role",
    accept.status === 200 && accept.json.role === "MEMBER",
    JSON.stringify(accept.json).slice(0, 200),
  );
  const members = await owner.api("GET", "/api/team/members");
  const memberEmails = ((members.json.members ?? []) as { email: string }[]).map((m) => m.email);
  check("the member list now includes the invitee", memberEmails.includes("member5@example.com"));

  const memberExport = await member.api("GET", "/api/settings/export");
  check(
    "a MEMBER cannot download the workspace export (OWNER only)",
    memberExport.status === 403,
    `status=${memberExport.status}`,
  );

  // --- G. Public API, webhooks, aggregation routes ---------------------------
  const keyRes = await owner.api("POST", "/api/settings/api-keys", {
    name: "qa key",
    scopes: ["leads:read", "leads:write", "suppressions:write", "stats:read"],
  });
  const fullKey = keyRes.json.fullKey as string;
  check("API key created and shown once", keyRes.status === 201 && typeof fullKey === "string");

  const noKey = await fetch(`${BASE}/api/v1/leads`);
  check("public API without a key returns 401", noKey.status === 401);
  const withKey = await fetch(`${BASE}/api/v1/leads`, {
    headers: { Authorization: `Bearer ${fullKey}` },
  });
  check("public API with the key returns 200", withKey.status === 200);

  const hook = await owner.api("POST", "/api/settings/webhooks", {
    url: "http://localhost:3999/hook",
    eventTypes: ["REPLIED"],
  });
  const hookSecret = hook.json.secret as string;
  const hookId = (hook.json.endpoint as { id: string }).id;
  check("webhook endpoint created with a one-time secret", hook.status === 201 && typeof hookSecret === "string");
  const testDelivery = await owner.api("POST", `/api/settings/webhooks/${hookId}/test`);
  const captured = capturedHooks.find(
    (entry) => (JSON.parse(entry.body) as { event?: string }).event === "test",
  );
  check(
    "webhook test delivery arrives with a verifiable HMAC signature",
    testDelivery.status === 200 && Boolean(captured) && verifySignature(hookSecret, captured as CapturedHook),
  );

  const metricsRes = await owner.api("GET", `/api/campaigns/${campaignId}/metrics`);
  check(
    "campaign metrics route (aggregated) reports the 6 sends",
    metricsRes.status === 200 &&
      (metricsRes.json.metrics as { sent?: number } | undefined)?.sent === 6,
    JSON.stringify(metricsRes.json).slice(0, 200),
  );
  const abRes = await owner.api("GET", `/api/campaigns/${campaignId}/ab-stats`);
  const abVariants = (abRes.json.variants ?? []) as { label: string }[];
  check(
    "A/B stats route returns both variants",
    abRes.status === 200 && abVariants.some((v) => v.label === "A") && abVariants.some((v) => v.label === "B"),
    JSON.stringify(abRes.json).slice(0, 200),
  );

  // --- H. Quota failure, then billing ---------------------------------------
  const now = new Date();
  await prisma.emailEvent.createMany({
    data: Array.from({ length: 970 }, (_, i) => ({
      workspaceId,
      type: "SENT" as const,
      idempotencyKey: `qa-seed:${i}`,
      occurredAt: now,
    })),
  });
  const list2 = await owner.api("POST", "/api/lead-lists", { name: "Quota list" });
  const list2Id = (list2.json.list as { id: string } | undefined)?.id ?? (list2.json as { id: string }).id;
  for (let i = 0; i < 40; i += 1) {
    await owner.api("POST", "/api/leads", { email: `quota-${i}@prospects.example`, listId: list2Id });
  }
  const campaign2 = await owner.api("POST", "/api/campaigns", { name: "Quota campaign", leadListId: list2Id });
  const campaign2Id = (campaign2.json.campaign as { id: string }).id;
  await owner.api("PATCH", `/api/campaigns/${campaign2Id}`, {
    windowStart: "00:00",
    windowEnd: "23:59",
    businessDaysOnly: false,
    accountIds: [accountId],
  });
  await owner.api("POST", `/api/campaigns/${campaign2Id}/steps`, {
    steps: [{ subject: "Quota", body: "Quota body", delayDays: 0, delayHours: 0 }],
  });
  await owner.api("POST", `/api/campaigns/${campaign2Id}/enroll`);
  const quotaPreflight = await owner.api("GET", `/api/campaigns/${campaign2Id}/preflight`);
  const quotaChecks =
    (quotaPreflight.json.preflight as { checks?: { id: string; status: string }[] } | undefined)?.checks ?? [];
  check(
    "preflight FAILs on quota near the FREE cap (970 used + 40 projected over 1000)",
    quotaChecks.some((entry) => entry.id === "quota" && entry.status === "fail") &&
      (quotaPreflight.json.preflight as { canLaunch?: boolean } | undefined)?.canLaunch === false,
    JSON.stringify(quotaChecks).slice(0, 300),
  );

  const billing = await owner.api("GET", "/api/billing");
  check(
    "billing shows the FREE plan with Stripe not configured",
    billing.status === 200 &&
      (billing.json.subscription as { plan: string }).plan === "FREE" &&
      (billing.json.stripe as { configured: boolean }).configured === false,
  );
  const override = await owner.api("POST", "/api/billing/plan", { plan: "STARTER" });
  check(
    "owner manual plan override applies",
    override.status === 200 && (override.json.subscription as { plan: string }).plan === "STARTER",
  );
  const billingPage = await owner.page("/app/billing");
  check("billing page renders", billingPage.status === 200 && billingPage.html.includes("Billing"));

  // --- I. Agency rollup and export -------------------------------------------
  const ws2 = await owner.api("POST", "/api/workspace/create", { name: "QA Client B" });
  check("second workspace created with the user as OWNER", ws2.status === 201);
  const agencyPage = await owner.page("/app/agency");
  check(
    "agency page rolls up both owned workspaces",
    agencyPage.status === 200 &&
      agencyPage.html.includes("Agency Command Center") &&
      agencyPage.html.includes("QA HQ") &&
      agencyPage.html.includes("QA Client B"),
    `status=${agencyPage.status}`,
  );

  // Switch back to the original workspace for the export.
  await owner.api("POST", "/api/workspace/switch", { workspaceId });
  const exportRes = await owner.fetch("/api/settings/export");
  const exportText = await exportRes.text();
  const exportJson = JSON.parse(exportText) as {
    format?: string;
    workspace?: { id: string };
    leads?: unknown[];
  };
  check(
    "workspace export downloads as an attachment with the full data set",
    exportRes.status === 200 &&
      (exportRes.headers.get("content-disposition") ?? "").includes("attachment") &&
      exportJson.format === "coldreach-workspace-export" &&
      exportJson.workspace?.id === workspaceId &&
      (exportJson.leads?.length ?? 0) >= 46,
    `status=${exportRes.status}`,
  );
  check(
    "export payload contains no credential material",
    !exportText.includes("passwordHash") &&
      !exportText.includes("keyHash") &&
      !exportText.includes("credentialRef") &&
      !exportText.includes("encryptedCredentials") &&
      !exportText.includes(hookSecret),
  );
  const anonExport = await fetch(`${BASE}/api/settings/export`);
  check("export without a session returns 401", anonExport.status === 401);

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
