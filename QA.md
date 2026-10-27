# ColdReach Final QA, 1.0.0

Every line below was executed for real against `next start`
(production build) on a pristine migrated dev database, by
`scripts/smoke-phase5.ts` (54 checks), plus the Phase 4 regression
smoke (`scripts/smoke-phase4.ts`, 41 checks), the recovery drill
(`scripts/drill-recovery.ts`), and the load smoke
(`scripts/load-smoke.ts`). Results recorded 2026-10-26. Nothing
here is carried over from earlier phases without being re-run.

## Journey checklist

| # | Journey | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Signup | PASS | 201 with workspace; a password under 10 characters is rejected with a clear error |
| 2 | Onboarding checklist | PASS | Dashboard shows "Getting started" before setup and the "all set" state after the full journey below |
| 3 | Import leads (CSV) | PASS | 6-row CSV imported with column mapping, summary kept 6 of 6 |
| 4 | Create a sending account (simulation) | PASS | Created CONNECTED, labelled DEMO by the provider design |
| 5 | Build a sequence with a variant | PASS | Step saves with variant B alongside the step's own variant A |
| 6 | Preflight pass | PASS | canLaunch true for the valid campaign |
| 7 | Preflight quota failure | PASS | With 970 sends seeded against the FREE cap of 1000 and 40 projected, the quota check FAILs and canLaunch is false |
| 8 | Launch | PASS | Campaign transitions to RUNNING |
| 9 | Worker tick send | PASS | One tick sends all 6 due step emails; SENT events recorded |
| 10 | Reply sync into the inbox | PASS | Sync service with the FakeSource seam imports 1 reply; the thread appears in the inbox list; the enrollment flips to REPLIED and the sequence stops |
| 11 | Thread note and assignment | PASS | Note created; thread assigned to the owner via PATCH |
| 12 | Deliverability check, graceful path | PASS | GET check for example.com returns 200 with a graded report (grade C, 3 findings). This VM's outbound DNS is blocked, so findings take the "unable to verify" path by design; grading logic itself is covered by the dnsCheck unit fixtures |
| 13 | Team invite and accept | PASS | Invite created (accept link returned, no SMTP account), invitee signs up, accepts, joins as MEMBER, appears in the member list |
| 14 | API key and public API call | PASS | Key created and shown once; GET /api/v1/leads is 401 without a key and 200 with it |
| 15 | Webhook test delivery | PASS | Test delivery arrives at a local listener; the HMAC signature verifies against the one-time secret |
| 16 | Billing page and plan override | PASS | Billing reports FREE with Stripe not configured; the owner override moves the workspace to STARTER |
| 17 | Agency rollup | PASS | After creating a second workspace, the Agency page lists both owned workspaces |
| 18 | Workspace export download | PASS | OWNER downloads the JSON attachment (leads, campaigns, threads, all data classes present); the payload contains no password hashes, key hashes, credential references, encrypted blobs, or the webhook secret; a MEMBER gets 403 and an anonymous caller 401 |
| 19 | Health endpoint | PASS | GET /api/health returns 200 with exactly { status, db, version, time }; version reads 1.0.0 |

## Platform and auth checks (same smoke run)

| Check | Result | Note |
| --- | --- | --- |
| Security headers on pages and API | PASS | CSP locked to self with frame-ancestors 'none', nosniff, strict-origin-when-cross-origin, Permissions-Policy denying camera/microphone/geolocation, X-Frame-Options DENY |
| HSTS under production mode | PASS | max-age=31536000 present under `next start` |
| Branded 404 | PASS | Unknown route returns 404 with the branded "Page not found" |
| Session cookie flags | FIXED | The cookie itself was already correct; the smoke's first assertion expected the serializer's exact casing (`SameSite=Lax`) while Next serializes `SameSite=lax`. Verified the raw header directly (httpOnly, SameSite=lax, Secure, Path=/ all present), corrected the assertion, re-ran green |
| Login failure behavior | PASS | Wrong password returns the generic 401, correct password succeeds |
| Login rate limit | PASS | 10 bad attempts return 401; the 11th returns 429 with Retry-After, even with the correct password |
| Signup rate limit | PASS | 11th signup attempt for one email returns 429 |
| Aggregated metrics routes | PASS | Campaign metrics route reports the 6 sends; A/B stats route returns both variants (these routes were refactored to database aggregation in Phase 5) |

## Regression smoke

`scripts/smoke-phase4.ts` re-run in full after the Phase 5
refactors: 41 passed, 0 failed. It re-proves bulk API lead
creation, variant-labelled sends at volume, DELIVERED and REPLIED
event ingestion, the A/B winner declaration through the public
API (which now reads aggregated counts), signed webhook delivery
of a real reply event, and the agency rollup totals.

## Recovery drill

`scripts/drill-recovery.ts`, run against a throwaway database:
seed, export, wipe, restore with `scripts/restore-workspace.ts`,
compare. Result: PASS on all 19 drill checks.

Exported and restored counts, identical on both sides: members 2,
lead lists 2, leads 5, campaigns 1, steps 2, variants 1,
suppressions 1, sending accounts 1, threads 1, thread messages 2,
thread notes 1, subscription present. Safety invariants verified
in the restored database: the campaign came back as DRAFT (never
RUNNING) and the sending account came back DISCONNECTED with no
credential reference and no encrypted credentials.

## Load smoke (indicative only)

`scripts/load-smoke.ts` against `next start` on this VM: 300
requests, concurrency 10, mix of landing, login page, health, the
API 401 path, and a static asset. Errors: 0. Latency overall:
p50 47ms, p95 190ms, max 402ms. Per target p95: health 160ms,
API 401 path 116ms, landing 179ms, login 194ms, static asset
369ms. These are single-VM figures with the app, database, and
load generator sharing one small machine; they show the app does
not fall over under light load and are not production benchmarks.

## Automated tests

`npm test`: 195 tests in 31 files, all passing (172 at the Phase 4
baseline, 23 added in Phase 5: auth rate limiter, structured
logger and Sentry envelope, security header definitions, health
check, counts-based aggregation equivalence, export redaction).
One real defect was found and fixed during this pass: full-suite
runs intermittently failed one database-backed suite in setup
(`Hook timed out in 10000ms` in a `beforeAll` that runs
`prisma migrate deploy`; which suite lost the race varied by run),
because 8 of the 13 database-backed suites still used vitest's
default 10 second hook timeout while sibling suites already
passed explicit 60 to 120 second timeouts. `vitest.config.ts`
now sets `hookTimeout` to 120 seconds and `testTimeout` to 60
seconds globally, and the full suite was re-run green afterwards.
`npm run typecheck`: clean. `npm run build`: green. The
production-schema generate step of `build:vercel` runs; the local
client was restored to the dev schema afterwards, per the README
troubleshooting note.

## Known limitations recorded, not hidden

- Outbound DNS is blocked from this VM, so the live deliverability
  lookup is only exercised on its graceful path here (item 12).
- `npm audit` cannot run in this environment (the managed
  registry refuses the audit endpoint); see SECURITY.md for the
  required CI follow-up.
- No real mailbox, Stripe, or OpenAI credentials exist in this
  environment; those integrations are verified to their
  not-configured boundaries and by unit tests, as in Phases 3
  and 4.
