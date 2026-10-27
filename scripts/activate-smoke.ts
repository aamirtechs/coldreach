/**
 * scripts/activate-smoke.ts
 *
 * Activation smoke check for Phase 6 (see ACTIVATION.md). Run it
 * against any running ColdReach instance, local or production,
 * after setting credentials, to see per integration whether the
 * server reports it configured, and to prove the two paid paths
 * with one real call each when you opt in.
 *
 * Credentials come ONLY from the environment, never from code:
 *
 *   ACTIVATE_BASE_URL        Base URL of the running app
 *                            (default http://localhost:3000).
 *   ACTIVATE_SESSION_COOKIE  Value of the coldreach_session cookie
 *                            from a signed-in browser session.
 *   ACTIVATE_API_KEY         Or a workspace API key (crk_...) with
 *                            the plans:read scope. One of the two
 *                            is required; health is checked either
 *                            way.
 *
 * Opt-in proofs (both default off):
 *
 *   ACTIVATE_AI_PROOF=1        When AI reports configured, makes
 *                              ONE real POST /api/ai/subjects call
 *                              (a small OpenAI charge) to prove the
 *                              key works end to end.
 *   ACTIVATE_STRIPE_PROOF=test When billing reports configured,
 *                              creates ONE Stripe Checkout session
 *                              for the Starter plan and prints that
 *                              a checkout URL came back. The value
 *                              must be the literal word "test": it
 *                              is the operator's declaration that
 *                              the configured Stripe key is a
 *                              test-mode (sk_test_) key, so this
 *                              script can never create a live-mode
 *                              session by accident. The session is
 *                              never completed and charges nothing.
 *
 * The script never sends email. Exit code is 0 when the health
 * endpoint reports ok, 1 when it does not; integrations reporting
 * NOT CONFIGURED are printed as information, not failures, because
 * activation is incremental by design.
 */

export {};

const BASE = (process.env.ACTIVATE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const COOKIE = process.env.ACTIVATE_SESSION_COOKIE;
const API_KEY = process.env.ACTIVATE_API_KEY;
const AI_PROOF = process.env.ACTIVATE_AI_PROOF === "1";
const STRIPE_PROOF = process.env.ACTIVATE_STRIPE_PROOF;

function authHeaders(): Record<string, string> {
  if (COOKIE) return { Cookie: `coldreach_session=${COOKIE}` };
  if (API_KEY) return { Authorization: `Bearer ${API_KEY}` };
  return {};
}

async function getJson(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

async function postJson(
  path: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

function report(label: string, configured: boolean, detail: string, missingEnv?: string[]) {
  const state = configured ? "CONFIGURED" : "NOT CONFIGURED";
  const missing = !configured && missingEnv && missingEnv.length > 0
    ? ` (missing: ${missingEnv.join(", ")})`
    : "";
  console.log(`${label}: ${state}${missing}${detail ? `, ${detail}` : ""}`);
}

async function main() {
  console.log(`Activation smoke against ${BASE}`);
  if (!COOKIE && !API_KEY) {
    console.error(
      "Set ACTIVATE_SESSION_COOKIE (value of the coldreach_session cookie) or ACTIVATE_API_KEY (a crk_ key with plans:read). Nothing was checked beyond health.",
    );
  }

  const health = await getJson("/api/health");
  const healthOk = health.body.status === "ok" && health.body.db === "ok";
  console.log(
    `Health: ${healthOk ? "OK" : "FAIL"} (status ${String(health.body.status)}, db ${String(health.body.db)}, version ${String(health.body.version ?? "unknown")})`,
  );
  if (!healthOk) {
    process.exitCode = 1;
    return;
  }
  if (!COOKIE && !API_KEY) return;

  // OAuth providers + encryption readiness.
  const oauth = await getJson("/api/accounts/oauth/status");
  if (oauth.status === 200) {
    const providers = Array.isArray(oauth.body.providers) ? oauth.body.providers : [];
    for (const entry of providers) {
      const provider = entry as { id?: string; label?: string; configured?: boolean; missingEnv?: string[] };
      report(
        `OAuth ${provider.label ?? provider.id ?? "provider"}`,
        provider.configured === true,
        "",
        provider.missingEnv,
      );
    }
    report("Encryption key (token storage)", oauth.body.encryptionReady === true, "");
  } else {
    console.log(`OAuth status: UNAVAILABLE (HTTP ${oauth.status}; sign-in required for this check)`);
  }

  // AI.
  const ai = await getJson("/api/ai/status");
  let aiConfigured = false;
  if (ai.status === 200) {
    aiConfigured = ai.body.configured === true;
    report("OpenAI", aiConfigured, `model ${String(ai.body.model ?? "unknown")}`, ai.body.missingEnv as string[] | undefined);
  } else {
    console.log(`OpenAI: UNAVAILABLE (HTTP ${ai.status})`);
  }
  if (AI_PROOF && aiConfigured) {
    const subjects = await postJson("/api/ai/subjects", { count: 2 });
    const list = Array.isArray(subjects.body.subjects) ? subjects.body.subjects : [];
    console.log(
      subjects.status === 200 && list.length > 0
        ? `OpenAI proof: OK, one real subjects call returned ${list.length} subject lines.`
        : `OpenAI proof: FAIL (HTTP ${subjects.status}, ${String(subjects.body.error ?? "no subjects returned")})`,
    );
  } else if (AI_PROOF) {
    console.log("OpenAI proof: SKIPPED (AI is not configured).");
  }

  // Billing.
  const billing = await getJson("/api/billing");
  let stripeConfigured = false;
  if (billing.status === 200) {
    const stripe = (billing.body.stripe ?? {}) as { configured?: boolean; missingEnv?: string[] };
    const subscription = (billing.body.subscription ?? {}) as { plan?: string };
    stripeConfigured = stripe.configured === true;
    report("Stripe", stripeConfigured, `current plan ${String(subscription.plan ?? billing.body.plan ?? "unknown")}`, stripe.missingEnv);
  } else {
    console.log(`Stripe: UNAVAILABLE (HTTP ${billing.status})`);
  }
  if (STRIPE_PROOF !== undefined) {
    if (STRIPE_PROOF !== "test") {
      console.log(
        "Stripe proof: SKIPPED. ACTIVATE_STRIPE_PROOF must be the literal value \"test\", your declaration that a test-mode (sk_test_) key is configured.",
      );
    } else if (!stripeConfigured) {
      console.log("Stripe proof: SKIPPED (Stripe is not configured).");
    } else {
      const checkout = await postJson("/api/billing/checkout", { planId: "STARTER" });
      console.log(
        checkout.status === 200 && typeof checkout.body.url === "string"
          ? "Stripe proof: OK, one test-mode checkout session was created (not completed, nothing charged)."
          : `Stripe proof: FAIL (HTTP ${checkout.status}, ${String(checkout.body.error ?? "no checkout URL returned")})`,
      );
    }
  }

  console.log(
    "Reminder: SMTP accounts, outbound webhooks, email verification, and HubSpot status live in Settings, Integrations status inside the app; this script covers health, OAuth, AI, and billing.",
  );
}

main().catch((error) => {
  console.error("Activation smoke failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
