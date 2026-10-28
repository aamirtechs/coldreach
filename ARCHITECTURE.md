# ColdReach Architecture

## Overview

ColdReach is a multi-tenant SaaS built as a single Next.js application with
a Prisma data layer. Phase 1 delivered the foundation: identity, tenancy,
the complete core schema, a tested pure TypeScript domain engine, and the
application shell. Phase 2 built the functional MVP on top: leads,
campaigns, preflight, the sending worker, unsubscribe handling, event
ingestion, and analytics, without changing the tenancy or domain
contracts. Phase 3 added synchronisation and team workflows, and
Phase 4 the competitive capabilities below, on the same contracts.

```
Browser
  |
Next.js app (App Router)
  |-- Marketing and auth pages
  |-- /app shell (server components, session resolved per request)
  |-- /api routes (auth, leads, campaigns, accounts, suppressions,
  |              workspace, worker tick, provider webhooks)
  |-- /u/[token] public unsubscribe endpoint
  |
src/lib/domain   Pure engines: scheduling, suppression, dedupe,
                 personalisation, metrics, limits, preflight.
                 No framework imports.
src/lib/worker   Sending tick, provider event application, unsubscribe.
src/lib/providers  Simulation and SMTP transports behind one interface.
  |
Prisma           SQLite for local development, PostgreSQL in production.
```

## Tenancy model

- A `User` joins one or more `Workspace` records through `Membership`,
  which carries a role: OWNER, ADMIN, MEMBER, or VIEWER.
- Every tenant-owned record carries a `workspaceId` (campaigns, leads,
  sending accounts, threads, events, API keys, and so on).
- The session cookie is a signed JWT (jose, HS256) holding the user id and
  the active workspace id. `getSessionWorkspace()` in
  `src/lib/auth/session.ts` resolves the cookie to a user, workspace, and
  role. All queries must scope by that workspace id. That scoping, applied
  everywhere without exception, is the tenant isolation boundary.
- `requireRole()` enforces minimum roles for sensitive actions using the
  rank VIEWER < MEMBER < ADMIN < OWNER.
- Signup creates the user, workspace, and OWNER membership in one database
  transaction, so a partial tenant can never exist.
- Suppressions are the one deliberate cross-tenant structure: an entry is
  either workspace scoped or GLOBAL (null workspace), because a global
  do-not-contact list must protect every workspace. Reads combine both.
- `AuditLog` records sensitive actions with optional user and workspace
  references. Signup, login, and logout already write rows.

## Authentication and security

- Passwords are hashed with bcryptjs at cost factor 12. Plaintext
  passwords are never stored or logged.
- Session cookies are httpOnly, SameSite Lax, Secure in production, and
  expire after 7 days.
- Login returns a single generic error so it cannot be used to enumerate
  accounts.
- Secrets come from environment variables only. `.env` is gitignored and
  `.env.example` contains placeholders. Sending account credentials are
  never stored in the database in Phase 1; the schema holds only an opaque
  `credentialRef`, anticipating encrypted or vault storage in Phase 2.
- API keys (Phase 4) are stored only as a SHA-256 hash
  (`ApiKey.keyHash`) with a display prefix; the full key is shown
  exactly once at creation. Webhook endpoint secrets and OAuth
  tokens are stored as AES-256-GCM ciphertext.
- Next steps for Phase 5 hardening: rate limiting on auth endpoints, CSRF
  review for cookie based mutations, security headers, and centralised
  error reporting.

## Domain engine

`src/lib/domain` contains pure functions with no framework or database
imports, each covered by Vitest tests. Keeping the rules pure makes them
testable in milliseconds and reusable by the future sending worker.

- `scheduling.ts` computes the next allowed send instant from a campaign
  timezone (via Intl), a local window, a business day rule, and a delay.
- `leadTimezone.ts` (v1.5.0) resolves a lead's own timezone from its
  imported fields (explicit timezone field, then US state, then country)
  so enrollment stamping and the sending worker observe the campaign
  window in the lead's local time. Unresolved leads fall back to the
  campaign timezone. The worker additionally re-stamps a due enrollment
  to the lead's next window opening rather than sending outside it.
- `suppression.ts` matches exact emails and whole domains across workspace
  and global entries.
- `dedupe.ts` normalises addresses (trim, lowercase, optional plus-tag
  stripping), validates syntax, and splits an import into kept, duplicate,
  and invalid rows with a summary.
- `personalize.ts` renders `{{token}}` and `{{token|fallback}}` templates
  and lists unresolved tokens for send preflight.
- `metrics.ts` computes campaign metrics from events only, with defined
  denominators, and flags opens as unreliable by construction.
- `limits.ts` computes an account's effective daily limit under a warm-up
  ramp, never exceeding the configured cap.

## Sending engine (Phase 2, implemented)

The sending worker lives in `src/lib/worker/sendTick.ts` and runs one
tick at a time, either from the CLI (`npm run worker:once`, intended
for an external scheduler such as cron) or from POST /api/worker/tick
(authenticated by the WORKER_SECRET header). There is no separate
queue infrastructure yet: the Enrollment table is the queue, with due
defined as status ACTIVE, nextSendAt in the past, and the campaign
RUNNING. That is a deliberate simplification for current volumes; a
dedicated queue can sit behind the same tick function later.

One tick, per due enrollment, in order:

1. Terminal lead states and suppression are re-checked against the
   combined workspace and global lists. A match closes the enrollment
   as SUPPRESSED instead of sending.
2. An account is chosen by rotating across the campaign's
   CampaignAccount rows in order, skipping PAUSED and ERROR accounts,
   and honouring each account's effective daily limit from `limits.ts`
   against today's recorded SENT events (UTC day boundary). When no
   account has capacity, the enrollment stays due for the next tick.
3. Subject and body are rendered with the personalisation engine, and
   the compliance footer is appended: sender name, postal address,
   and a signed unsubscribe link, mirrored in a List-Unsubscribe
   header.
4. The send goes through the provider interface in `src/lib/providers`
   (simulation, SMTP, and, once connected through OAuth, Gmail and
   Microsoft Graph). Before sends, the tick runs a reply sync pass for
   connected OAuth accounts, so a reply that just landed stops its
   follow-up in the same run; sync failures are recorded per account
   and never block sending. On success a SENT EmailEvent is
   recorded with the idempotency key send:{enrollmentId}:{stepIndex},
   and the enrollment advances: the next step is scheduled through
   `scheduling.ts`, or the enrollment completes after the last step.
   On failure a FAILED event plus the provider message on the
   enrollment's lastError is recorded, and the enrollment stays due
   for retry. Retries are therefore bounded by the operator (pause the
   campaign or account) rather than by an internal backoff clock; that
   is the main divergence from the original plan, chosen so a failing
   provider is visible immediately instead of silently retried.

Idempotency is structural. A tick that finds a SENT event already
recorded for the current step (the crash window between the provider
call and the state advance) advances state without resending, and all
inbound provider events carry deterministic keys for the same reason.

Provider events enter through POST /api/webhooks/events (WEBHOOK_SECRET
header) and `applyProviderEvent`: DELIVERED is recorded, REPLIED,
BOUNCED, UNSUBSCRIBED, and COMPLAINED stop the enrollment, and bounce
and complaint outcomes also write a suppression and update the lead
status. Unsubscribe link clicks at /u/[token] run the same stop logic
through `applyUnsubscribe` and attribute the event to the campaign
whose email carried the link.

## Compliance rules

- Suppression before send is a hard gate, not a warning.
- Unsubscribe links are mandatory in campaign email, and unsubscribe
  requests are enforced immediately and permanently for the workspace.
- Bounces and complaints suppress the address and stop its sequences.
- Sender identification stays accurate and visible. The product contains
  no feature designed to evade spam filters, conceal identity, or bypass
  provider limits.
- CAN-SPAM and GDPR oriented data handling: lawful basis and consent are
  the customer's responsibility in their jurisdiction; the product supports
  them with suppression, deletion workflows (planned), retention controls
  (planned), and an audit trail.
- No deliverability, warm-up, or inbox placement guarantee appears anywhere
  in product copy, because outcomes depend on the sender's domains, lists,
  and content.

## Data model summary

Users, Workspaces, Memberships; SendingAccounts; LeadLists and Leads;
Campaigns, SequenceSteps, Enrollments (unique on campaign and lead, the
structural guarantee against duplicate enrollment); EmailEvents (unique
idempotency key); Suppressions; Threads, ThreadMessages, and ThreadNotes
for the unified inbox; Invites (token hashes only); AuditLogs; ApiKeys
(scopes, revocation, creator). Phase 4 adds StepVariants (per-step A/B
copy), WebhookEndpoints and WebhookDeliveries, and Subscriptions (one
per workspace), and a nullable `variant` label on EmailEvent. See
`prisma/schema.prisma` for the full model and `prisma/migrations` for
the committed migrations.

## Professional workflows (Phase 3, implemented)

- **Credential security.** OAuth tokens for Gmail and Microsoft 365 are
  stored only as AES-256-GCM ciphertext (`src/lib/security/crypto.ts`,
  key from `ENCRYPTION_KEY`). The OAuth connect flow
  (`src/lib/oauth/`) uses signed, short-lived state tokens bound to the
  session's user and workspace; providers refresh access tokens
  transparently and mark the account ERROR with the provider's message
  when a refresh fails. A provider whose client credentials are not
  configured reports "Not configured" with the missing variable names
  in the API and the UI, never a dead connect button. SMTP keeps the
  Phase 2 credentialRef discipline: no plaintext secrets anywhere.
- **Reply sync and the unified inbox.** `src/lib/sync/` defines a
  MessageSource interface with Gmail (history feed), Microsoft Graph
  (receivedDateTime filter), and an in-memory fake for tests. The sync
  service matches inbound mail to enrollments by In-Reply-To and
  References against SENT events' providerMessageIds, falls back to
  the sender's lead record, applies REPLIED through the same
  `applyProviderEvent` path webhooks use, classifies with the rule
  based heuristics in `src/lib/domain/classify.ts` (documented rules,
  not AI), and files messages into Threads and ThreadMessages with
  dedupe on the inbound Message-ID. Thread.unread is set by sync and
  cleared when a member opens the conversation. The inbox UI adds
  filters, assignment, status controls, classification override,
  internal ThreadNotes (never sent anywhere), and a reply composer
  that sends through the thread's account provider.
- **Deliverability diagnostics.** A pure evaluator
  (`src/lib/domain/dnsCheck.ts`) grades SPF, DKIM, and DMARC from
  lookup results with plain-language fixes; a service
  (`src/lib/deliverability/dnsService.ts`) performs live DNS TXT
  lookups and converts failures into "unable to verify" findings.
  Per account health cards aggregate real EmailEvents with the
  formula published in `src/lib/domain/health.ts` and quoted in the
  UI. Nothing is estimated or invented: no sends, no score.
- **Team.** Invites are random tokens stored as SHA-256 hashes with a
  7 day expiry; accepting requires signing in with the invited email
  and joins with the invited role. Role changes and removals enforce
  the last OWNER guards in `src/lib/team/invites.ts`. The Team page
  reads the AuditLog for its Activity tab, and invite, role, removal,
  account connect, and campaign launch actions all write audit rows.
- **Workspace switching.** The session JWT carries one active
  workspace claim. The topbar switcher lists the user's memberships
  and re-issues the token after a membership check
  (`src/lib/auth/workspaces.ts`), so tenant scoping follows the claim
  everywhere with no parallel state.
- **Production cron.** GET /api/cron/tick authorizes the
  `CRON_SECRET` bearer token (Vercel Cron's native mechanism), runs
  the reply sync pass plus the send tick, and returns a JSON summary;
  `vercel.json` schedules it once daily at 05:00 UTC on the current
  Vercel Hobby plan, with sub-daily options documented in
  DEPLOYMENT.md section 6.

## Competitive capabilities (Phase 4, implemented)

- **A/B testing.** A step's own subject and body are variant A; up to
  two StepVariant rows add B and C, each with an optional subject, a
  body, and a weight. `src/lib/domain/abtest.ts` assigns variants by
  a stable FNV-1a hash of enrollment id and step index weighted by
  the configured weights, so assignment is deterministic without any
  stored state. The worker renders the assigned variant and records
  its label on the SENT and FAILED events; downstream events applied
  through `applyProviderEvent` inherit the label from the send they
  reference, which is what makes per-variant delivery and reply
  rates real. `variantStats` aggregates per label (a null label reads
  as A, covering pre-Phase 4 sends), and `pickWinner` runs a
  two-proportion z-test on reply rate with a pooled standard error:
  the leader must beat every other variant at 95 percent confidence
  with at least 30 delivered emails per variant (configurable),
  otherwise the result is "not enough data", never a coin-flip win.
- **AI assistance.** `src/lib/ai/` defines an AiProvider interface
  (subject suggestions, body rewrite, lead icebreaker) with an
  OpenAI implementation over plain fetch. All three endpoints are
  session and role checked and workspace scoped; without
  `OPENAI_API_KEY` they return 501 naming the variable, following
  the OAuth honesty pattern. Output is inserted only on an explicit
  Apply click, and icebreakers persist onto `Lead.fields.icebreaker`
  marked `aiGenerated`, usable as the `{{icebreaker}}` token. The
  system prompt forbids invented facts, fake familiarity, and any
  spam-filter evasion content.
- **Public API.** `/api/v1` authenticates with Bearer API keys
  (SHA-256 hash lookup, per-key scopes leads:read, leads:write,
  suppressions:write, stats:read, revocation, lastUsedAt tracking,
  and a 120 request per minute in-memory fixed-window limiter that
  is explicitly per instance). Lead creation reuses the in-app
  `createLead` service with stricter suppression refusal (422);
  stats come from the real metrics engine plus the A/B breakdown.
  API.md is the reference.
- **Outbound webhooks.** Provider events applied through
  `applyProviderEvent` (SENT excluded) enqueue WebhookDelivery rows
  for subscribed, active endpoints in the event's workspace. The
  worker tick drains due deliveries: POST JSON with
  `X-ColdReach-Signature` (HMAC-SHA256 hex of the body, keyed by the
  endpoint secret, which is stored AES-256-GCM encrypted) and
  `X-ColdReach-Event` headers; 2xx marks DELIVERED, failures retry
  after 1 minute, 5 minutes, 30 minutes, and 2 hours, then FAILED at
  5 attempts. Test deliveries travel the same path. CRM sync is
  deliberately not native: Zapier and Make recipes in
  INTEGRATIONS.md bridge to HubSpot and Salesforce.
- **Plans, quotas, and billing.** `src/lib/domain/plans.ts` is the
  plan catalog (FREE, STARTER, PRO, AGENCY) with seat, account, and
  monthly send limits; prices there are placeholders until the owner
  sets real Stripe prices. Usage is derived from EmailEvent SENT
  rows in the current UTC calendar month, never a counter table.
  Preflight FAILs when projected sends exceed the remaining quota,
  the worker hard-stops sends at the cap and records the reason on
  the enrollment, and account and seat limits are enforced at
  account creation and invite creation. Stripe sits behind env vars
  with plain fetch calls (no SDK): checkout sessions, the customer
  portal, and a webhook that verifies the signature over the raw
  body with `STRIPE_WEBHOOK_SECRET` before parsing, then syncs the
  Subscription row. Without the env vars the billing endpoints
  return 501 naming them, and an OWNER-only manual plan override
  (audited) keeps quotas usable.
- **Agency Command Center.** `src/lib/agency/rollup.ts` aggregates
  only workspaces where the user holds an OWNER membership: this
  month's sends, replies, and bounces, active campaigns, accounts in
  ERROR, and a bounce-rate flag above 5 percent, per workspace and
  in total. Users who own one workspace see an explainer plus a
  create-workspace action instead; workspace creation makes the
  creator OWNER, and switching reuses the Phase 3 switcher.

## Known limitations after Phase 4

- The API rate limiter and the webhook retry queue are per instance
  and database backed respectively: the limiter resets on restart
  and does not coordinate across instances (documented in API.md),
  while deliveries persist in the database and survive restarts.
- The A/B winner test compares reply rates only, one campaign at a
  time, with no multiple-comparison correction across steps; the UI
  copy states the method and the sample floor so a "winner" is
  never oversold.
- AI assistance has exactly one provider implementation (OpenAI).
  The interface is the seam for others; none is claimed.
- Stripe subscription state is eventually consistent through the
  webhook; a checkout that completes while the webhook endpoint is
  misconfigured leaves the plan unchanged until the subscription
  events arrive, which the Billing page surfaces as the stored plan,
  never an assumed one.

- SQLite is a development database. Production should run PostgreSQL; the
  schema avoids SQLite specific constructs, with one documented exception:
  JSON fields on Lead carry no database level default, because SQLite
  cannot express a JSON literal default portably. Application code
  supplies the defaults on every lead creation path.
- Gmail and Microsoft 365 transports are implemented against the
  providers' documented APIs but activate only when the owner creates
  the OAuth apps and sets the client credentials (INTEGRATIONS.md);
  they have not been exercised against live provider accounts here.
  Google additionally requires verification for the restricted Gmail
  scopes before production use beyond test users.
- Reply classification is keyword rules by design; it will misread
  sarcasm, mixed sentiment, and terse replies. The thread UI makes
  overriding it one click, and the copy says what it is.
- DKIM checking probes four common selectors. A domain signing with a
  different selector reports "unknown", not a failure, with copy that
  explains how to check the real selector.
- Sent-today accounting uses UTC day boundaries, matching the limits
  engine's day definition. Campaign windows remain timezone aware.
- Tag filtering on leads runs in application code because tags are a
  JSON array; it is exact, and sized for workspace-scale lists.

## Launch and growth (Phase 6, implemented)

- **Integrations status.** `src/lib/integrations/status.ts` derives
  one row per integration from environment presence and database
  counts at request time; it returns only variable names, never
  values. Settings renders the rows server side
  (`IntegrationsStatusPanel`) and each row links to the matching
  ACTIVATION.md section. The HubSpot row is a live card with
  connection state because it carries per-workspace data the other
  rows do not.
- **Email verification.** `src/lib/verify/` separates the built-in
  checks (builtin.ts: syntax, disposable, MX through an injectable
  resolver that degrades to unknown), the optional provider
  (provider.ts: NeverBounce, mapped onto the same enum; unknown
  leaves the built-in verdict; failures are recorded, never fatal),
  and the list service (service.ts: batches of 100 with cursor
  pagination, workspace-scoped throughout). Verdicts live on the
  Lead (`verificationStatus`, `verificationDetail`,
  `verifiedAt`) and feed enrollment: INVALID is skipped and
  counted, RISKY enrolls and is counted, in the same result object
  as suppressions and duplicates.
- **Warm-up schedules.** `src/lib/domain/warmup.ts` is a pure cap
  function (20, 50, 100, 200 by week, then no ceiling). The
  worker's capacity gate takes the minimum of the existing age
  ramp (`src/lib/domain/limits.ts`, untouched) and the warm-up
  cap, so warm-up can only ever lower a limit. Preflight receives
  the caps from `preflightService` and warns when projected first
  day volume exceeds one; it never blocks a launch on warm-up.
- **HubSpot sync.** `src/lib/crm/` mirrors the mailbox OAuth
  structure: signed state tokens with a distinct purpose claim
  (state.ts), code exchange and refresh against HubSpot's token
  endpoint, tokens encrypted with the security/crypto.ts helpers
  used for mailboxes, and connections on the `CrmConnection` model
  keyed by (workspaceId, provider). The sync service upserts
  contacts by email in batches of 100 and stores a run summary on
  the connection. The contacts scopes expose no subscription or
  deletion feed, so there is deliberately no pull path; the
  limitation is written into every summary and INTEGRATIONS.md.
- **Pricing surface.** `src/lib/marketing/pricing.ts` formats the
  plan catalog (`src/lib/domain/plans.ts`) and nothing else; the
  `/pricing` page and the landing pricing section render from it,
  and pricing.test.ts pins the rows to the catalog so the
  marketing surface cannot drift from the quota engine.
- **CI and uptime.** `.github/workflows/ci.yml` runs typecheck,
  tests, build, and a failing high-severity `npm audit` step on
  pushes to main and pull requests. `.github/workflows/uptime.yml`
  polls the production health endpoint every 30 minutes and fails
  loudly (GitHub notification) when it does not report ok.
