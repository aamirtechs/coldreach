# Changelog

## 1.11.1 (2026-10-29)

Display fix for click tracking.

- **Campaigns Progress now shows clicks.** The campaigns list adds
  each campaign's tracked link clicks next to emails sent, and the
  campaigns API returns the same clickedCount. Click events were
  already being recorded in v1.11.0; only the display was missing.

## 1.11.0 (2026-10-29)

Seven outreach upgrades in one release.

- **AI icebreaker generator.** A "Generate icebreakers" button on
  each lead list drafts a personalized opening line for leads that
  lack one, from the lead's website and company details, using the
  workspace's AI provider. Up to 25 leads per run; lines land in the
  lead's icebreaker field for review before enrolling.
- **Automated reply detection.** Replies now classify as AUTOMATED
  when they are machine receipts, ticket confirmations, or support
  routing messages, checked before the positive and referral rules.
  The inbox gains a "Humans only" filter, the dashboard separates
  human from automated replies, and a "Detect automated replies"
  action reclassifies existing referral, neutral, and unlabelled
  threads (never positive, negative, or out-of-office ones).
- **Account health guardrails.** Each sending account gets a health
  state from its bounce rate and reply sync status, shown on the
  Sending Accounts page and as a dashboard alert when an account
  needs attention. An account whose bounce rate turns critical is
  automatically excluded from sending for that day, with an audit
  entry.
- **Click tracking with a custom tracking domain.** Links in
  campaign emails are tracked like opens (the unsubscribe link is
  never rewritten), and a workspace Tracking domain setting lets
  opens and clicks run under your own subdomain.
- **Spintax.** Sequence subjects and bodies support
  {option a|option b} variations, chosen consistently per lead, and
  pass through unchanged when no spintax is present.
- **Inbox snippets.** Save reusable reply texts and insert them
  into any thread reply in one click, managed right from the reply
  box.
- **Cross-campaign contact guard.** Enrolling a lead who is already
  enrolled in another campaign stops with the conflict list and an
  explicit "Enroll anyway" choice instead of double pitching them.

## 1.10.1 (2026-10-29)

Sidebar consistency fix.

- **Compose matches the other sidebar buttons.** The Compose entry
  above Inbox now uses the same nav link styling as every other
  sidebar item (same shape, hover, and text treatment) instead of a
  separate primary button design. Behavior is unchanged: it still
  opens the compose window.

## 1.10.0 (2026-10-29)

Inbox bulk actions, manual compose, campaign progress, live sidebar status.

- **Bulk mark as read.** Inbox rows gain checkboxes with a select page
  control and an action bar (Mark as read, Mark as unread, Clear).
  POST /api/threads/bulk verifies every id against the session
  workspace before a scoped update, and audit logs the count.
- **Compose.** A Compose button sits in the sidebar directly above
  Inbox and opens a Gmail style compose window: a From select of the
  workspace sending accounts (only CONNECTED accounts can send), To,
  Subject, and body. POST /api/threads/compose checks suppression
  before sending, links the thread to the lead when the recipient is
  one (with the usual one-click unsubscribe headers), sends through
  the account provider, and records the thread, the outbound message,
  and a SENT event, so manual emails appear in the inbox and Outbox
  and count toward the account's daily totals.
- **Campaigns Progress column.** The campaigns table shows, per
  campaign, "X of Y contacted" (enrollments that have received at
  least one email), "Z remaining" (enrolled, not yet emailed), and
  the total emails sent, from batched groupBy aggregates on the list
  endpoint and the page query.
- **Sidebar live sending status.** The sidebar footer paragraph is
  replaced by a compact live card: a pulsing status dot (amber at
  full capacity), today's sent count against the capacity cap with a
  progress bar, and one status dot per sending account. It reads
  GET /api/sending-status, built on the same sending schedule
  computation as the dashboard panel, and refreshes every minute.

## 1.4.0 (2026-10-27)

Outbox, campaign signatures, Groq AI fallback, richer dashboard.

- **Outbox.** New /app/outbox page listing every sent email from the
  recorded outbound messages, newest first, with filters for campaign,
  sending account, status (opened, replied, not opened) and order.
  Opened and replied badges derive from recorded EmailEvents and
  inbound thread messages, never estimates.
- **Per-campaign email signatures.** Campaigns gain a signatureText
  field (production migration 0006), editable in campaign Settings.
  The worker renders it between the step body and the compliance
  footer on every send, steps and A/B variants alike, so a signature
  change applies from the next send onward without rewriting any
  sequence step. Empty means no signature.
- **Groq AI fallback.** AI assistance now works with either key:
  OPENAI_API_KEY when set (AI_MODEL override), otherwise GROQ_API_KEY
  against Groq's OpenAI-compatible endpoint (GROQ_MODEL override,
  default llama-3.3-70b-versatile). The AI status route and the
  integrations panel report which provider and model are live.
- **Dashboard live sending row.** Running campaigns, emails sent,
  opened, replied, suspended accounts (paused or error state), and
  warmed accounts (past the 4-week warmup curve), all computed from
  live workspace records.
- **Favicon.** New indigo paper-plane app icon (src/app/icon.svg).

## 1.3.0 (2026-10-27)

Lead import can now update existing leads.

- **Update-existing import mode.** The CSV importer gains an opt-in
  updateExisting flag (import wizard checkbox, API body field). When
  set, a row whose email already exists in the target list merges its
  mapped fields into the existing lead instead of being skipped as a
  duplicate, and the import summary reports an updated count. Leads
  that exist in a different list are never touched and keep the usual
  already-exists skip. Default behavior is unchanged. This makes
  re-importing an enriched file (for example one carrying a new
  personalisation field such as an icebreaker) update the enrolled
  leads in place.

## 1.2.0 (2026-10-27)

cPanel and custom mail server support, plus RFC 8058 one-click
unsubscribe. 275 automated tests (32 added), typecheck and build
green.

- **User entered mailbox credentials.** SMTP accounts now accept
  mailbox fields (SMTP and IMAP host, ports, TLS flags, username,
  password) as an alternative to the legacy credentialRef
  environment path. Credentials are stored as an AES-256-GCM
  encrypted blob in `SendingAccount.encryptedCredentials` (no
  schema change), the password never appears in any API response,
  and resolution everywhere is stored first, environment second.
  The account form labels the provider "SMTP / IMAP (cPanel or any
  mail server)", offers one-click cPanel defaults derived from the
  mailbox address (mail.<domain>, SMTP 465, IMAP 993, username the
  full address), and STARTTLS alternatives on 587 and 143.
- **IMAP reply sync.** A new ImapSource (imapflow plus mailparser)
  reads cPanel and other self hosted inboxes: UID cursor with
  UIDVALIDITY checking and re-baselining, a first sync limited to
  the last 7 days and the newest 100 messages, and normalization
  into the same reply pipeline as Gmail and Microsoft 365, so
  replies reach the unified inbox and stop sequences. The sync
  pass and the per account Sync replies button now cover SMTP
  accounts, and the legacy environment path gained optional
  `<PREFIX>_IMAP_HOST`, `<PREFIX>_IMAP_PORT`, and
  `<PREFIX>_IMAP_SECURE` variables.
- **Connection test.** POST /api/accounts/test-connection verifies
  unsaved mailbox settings live (SMTP transport verify, IMAP login
  plus INBOX open) and reports each protocol separately with plain
  language errors; the form runs it before saving.
- **One-click unsubscribe (RFC 8058).** Campaign sends and inbox
  replies now carry the List-Unsubscribe-Post header alongside
  List-Unsubscribe, and POST /u/[token] applies the unsubscribe
  with JSON responses (200 on success, idempotent; 400 on an
  invalid token). The GET confirmation page moved into the same
  route handler, because Next.js does not allow a page and a route
  handler in one segment.
- **Docs.** INTEGRATIONS.md section 12 and ACTIVATION.md section 9
  cover cPanel setup end to end (Connect Devices settings,
  Email Deliverability SPF, DKIM, and DMARC first), including an
  honest deliverability note: placement also depends on the
  sending server's IP reputation and list quality, which no app
  can guarantee.

## 1.1.0 (2026-10-27)

Phase 6: launch and growth, in three stages. 243 automated tests
(48 added), a 20-check live smoke, typecheck and build green; see
the Phase 6 addendum in QA.md for the executed evidence.

- **Stage A, activation sprint.** A Settings Integrations status
  panel reporting every integration's live state from real config
  checks (Configured, or Not configured with the exact missing
  environment variable names and a link into ACTIVATION.md), with
  counts for SMTP accounts and webhook endpoints. ACTIVATION.md, a
  click-by-click owner runbook for the encryption prerequisites,
  Google OAuth, Microsoft OAuth, the OpenAI key, Stripe (test mode
  first, with the three webhook events the handler consumes), the
  optional verification provider, and HubSpot, ending in a
  production verification checklist. `scripts/activate-smoke.ts`
  reports per-integration status against any running instance and
  makes one real AI call and one test-mode Stripe checkout only on
  explicit opt-in; it never sends email.
- **Stage B, launch readiness.** GitHub Actions CI
  (`.github/workflows/ci.yml`: install, Prisma generate, typecheck,
  tests, build, and `npm audit --audit-level=high` as a failing
  step) and a 30-minute uptime workflow
  (`.github/workflows/uptime.yml`) against `/api/health`. A public
  `/pricing` page rendered from the plan catalog, linked from the
  landing nav, pricing section, and footer, with a test pinning
  the page data to the catalog; the landing page's stale
  pre-Phase 4 pricing copy was replaced with the same catalog
  data. TRADEMARK.md records that the ColdReach name is a working
  name with no clearance performed, and what a real check
  requires. DEPLOYMENT.md gains the CI and uptime sections and a
  custom domain checklist.
- **Stage C, growth features.** Email verification
  (`src/lib/verify/`): built-in syntax, bundled partial
  disposable-domain, and MX checks that degrade to UNKNOWN when
  DNS cannot answer, optionally refined by NeverBounce behind
  `VERIFY_API_KEY`. `Lead` gains verificationStatus,
  verificationDetail, and verifiedAt (dev migration
  `20261027011023_phase6_launch_and_growth`, prod migration
  `0005_phase6_launch_and_growth`). A Verify list action verifies
  in batches of 100 and stores per-lead results; enrollment skips
  INVALID leads (counted as skippedInvalidVerification) and flags
  RISKY ones (enrolledRisky). Warm-up schedules: `SendingAccount`
  gains warmupEnabled and warmupStartedAt; the pure cap curve in
  `src/lib/domain/warmup.ts` (20, 50, 100, 200 per day by week)
  layers under the existing age ramp in the worker's capacity
  gate, the accounts page gains a warm-up control, and preflight
  warns when projected volume exceeds a warm-up cap. HubSpot CRM
  sync (`src/lib/crm/`, new `CrmConnection` model): OAuth connect
  mirroring the mailbox providers, tokens encrypted at rest, sync
  pushing workspace leads as contacts in batches of 100 with the
  run summary stored on the connection; the contacts scopes
  expose no unsubscribe or deletion pull, and that limitation is
  recorded in the summary and INTEGRATIONS.md rather than worked
  around.

## 1.0.0 (2026-10-26)

First production-ready release: Phases 1 to 5 complete, verified
end to end by the final QA pass in QA.md (195 automated tests, a
54-check live smoke, a recovery drill, and a load smoke).

- **Phase 1, Foundation.** Design system and app shell, bcrypt and
  JWT cookie auth, multi-tenant workspaces with roles, audit log,
  the full core data model, and the tested domain engine
  (scheduling, suppression, dedupe, personalization, metrics,
  limits).
- **Phase 2, Functional MVP.** Lead lists and CSV import, campaign
  and sequence builder, preflight launch gating, a sending worker
  behind a provider interface (simulation and SMTP), signed
  unsubscribe flow, idempotent provider event ingestion, and
  analytics from real events.
- **Phase 3, Professional Workflows.** Gmail and Microsoft 365
  OAuth with AES-256-GCM token storage, reply sync with a unified
  inbox, deliverability diagnostics (SPF, DKIM, DMARC grading and
  per-account health), team invites and roles, onboarding
  checklist, and the production cron endpoint.
- **Phase 4, Competitive Capabilities.** A/B testing with a
  z-test winner rule, AI assistance behind an interface, a public
  API with scoped hashed keys, signed outbound webhooks with
  retries, plan quotas with Stripe billing, and the Agency
  Command Center.
- **Phase 5, Production Readiness.** Security headers and a CSP on
  every response, rate limiting on the credential endpoints, a
  structured JSON logger with an optional Sentry forwarder, a
  public health endpoint, branded error and 404 surfaces, a
  redacted OWNER-only workspace export with a restore script and
  a proven recovery drill, database indexes for the hot query
  shapes, database-level aggregation for metrics (no more
  unbounded event loads), an accessibility pass, and the final
  QA in QA.md. SECURITY.md records the review, the tradeoffs, and
  the residual risks.

## Phase 4, Competitive Capabilities (2026-10-26)

A/B testing, AI assistance, a public API, outbound webhooks,
billing with quotas, and an agency view.

- **A/B testing.** StepVariant model (dev migration
  `20261026180056_phase4_competitive`, production migration
  `prisma/prod/migrations/0003_phase4_competitive`): up to two extra
  variants per step with weights, edited in the sequence builder
  with per-variant live preview. Pure engine in
  `src/lib/domain/abtest.ts`: deterministic FNV-1a hash assignment,
  per-variant stats, and a winner only via a two-proportion z-test
  at 95 percent confidence with a 30 delivered minimum per variant.
  EmailEvent gains a nullable `variant` label; the worker renders
  and records the assigned variant, and downstream events inherit
  it. Analytics gains a per-campaign A/B section with the winner
  badge or the exact "not enough data" numbers.
- **AI assistance.** AiProvider interface with an OpenAI
  implementation (`OPENAI_API_KEY`, `AI_MODEL` default
  `gpt-4o-mini`): subject ideas and body rewrites in the builder,
  applied only on click, and per-lead icebreakers stored on the
  lead as the `icebreaker` field for use as a token. Without the
  key, endpoints return 501 naming the variable and panels show "AI
  is not configured". Prompts forbid invented facts and
  spam-filter evasion content.
- **Public API and keys.** ApiKey gains scopes and a creator
  relation; keys are `cr_` prefixed, SHA-256 hashed, shown once,
  revocable, with a 120 request per minute per-instance limiter.
  `/api/v1` offers paginated lead listing and creation (reusing the
  in-app create service, with dedupe 409 and suppression 422),
  idempotent suppression creation, and campaign stats from the real
  metrics engine including the A/B breakdown. API.md documents
  auth, scopes, endpoints, examples, and error shapes.
- **Outbound webhooks.** WebhookEndpoint (secret stored AES-256-GCM
  encrypted) and WebhookDelivery models. Provider events applied
  through applyProviderEvent (DELIVERED, REPLIED, BOUNCED,
  UNSUBSCRIBED, COMPLAINED; SENT excluded) enqueue deliveries,
  which the worker tick sends with an HMAC-SHA256
  `X-ColdReach-Signature` header; retries back off 1m, 5m, 30m, 2h
  and stop at 5 attempts. Settings UI with event type picker, test
  delivery through the same path, delivery log, pause and delete.
  INTEGRATIONS.md gains Zapier and Make recipes and the plain CRM
  note: no native HubSpot or Salesforce connector exists or is
  claimed.
- **Billing and quotas.** Plan catalog in `src/lib/domain/plans.ts`
  (FREE 2 seats, 2 accounts, 1,000 sends per month; STARTER $29;
  PRO $79; AGENCY $199; prices labelled placeholders). Subscription
  model, one per workspace; usage derived from real SENT events in
  the current UTC month. Preflight FAILs when projected sends exceed
  the remaining quota, the worker hard-stops at the cap and records
  why, and account and seat limits are enforced at creation and
  invite time. Stripe behind env vars: checkout sessions, customer
  portal, and a signature-verified webhook syncing the Subscription
  row; without the vars, 501s name them and an audited OWNER manual
  override keeps quotas usable. Billing page with plan cards and
  real usage bars.
- **Agency Command Center.** New Agency page and rollup service:
  owners of multiple workspaces see this month's sends, replies,
  and bounces in total and per workspace, with active campaigns,
  ERROR account flags, and bounce rates above 5 percent flagged,
  plus click-through workspace switching. Owners of one workspace
  get an explainer and a create-workspace action (new endpoint;
  the creator becomes OWNER).
- Tests: 172 passing (47 new across A/B statistics, plan and quota
  math, API key auth, webhook signing and retries, AI gating and
  provider shape, variant attribution on applied events, and the
  agency rollup). Typecheck and production build pass. A 41-check
  live smoke (scripts/smoke-phase4.ts) passes end to end, including
  a signed webhook delivery to a local listener and a declared A/B
  winner from real reply skew.

## Phase 3, Professional Workflows (2026-10-26)

Real sending identities, a working inbox, and team workflows.

- **Credential security and OAuth.** AES-256-GCM encryption for
  provider tokens (`src/lib/security/crypto.ts`, key from
  `ENCRYPTION_KEY`), with tamper detection tests. SendingAccount gains
  encryptedCredentials, tokenExpiresAt, lastSyncAt, syncCursor, and
  providerAccountId (dev migration
  `20261026165125_phase3_professional_workflows`, production migration
  `prisma/prod/migrations/0002_phase3_professional_workflows`).
  Google and Microsoft connect flows (signed state token bound to the
  session, profile lookup, encrypted token storage, transparent
  refresh) with Gmail and Microsoft Graph transports implementing the
  existing MailProvider interface. Unconfigured providers report "Not
  configured" with the missing environment variables named, in the API
  and the UI. INTEGRATIONS.md documents the owner console steps and
  the honest activation table.
- **Reply sync and unified inbox.** MessageSource interface with
  Gmail (history feed), Graph (receivedDateTime filter), and fake
  implementations. Sync matches replies by Message-ID headers, applies
  REPLIED through the existing applyProviderEvent path, classifies
  with documented keyword rules (`src/lib/domain/classify.ts`), and
  threads messages with Message-ID dedupe. The Inbox page replaces
  the placeholder: filters, conversation view, reply composer through
  the account provider, assignment, status controls, classification
  override, internal ThreadNotes, and sync maintained unread state.
- **Deliverability diagnostics.** Pure SPF, DKIM, and DMARC evaluator
  with plain-language fixes and fixture tests, a live DNS checker
  service that degrades to "unable to verify", and per account health
  cards computed from real events with the formula printed in the UI.
- **Team collaboration.** Invite model (SHA-256 token hashes, 7 day
  expiry), accept page that works logged out and logged in, SMTP
  invite email when a connected SMTP account exists (link returned
  otherwise), resend and revoke, role changes and member removal with
  last OWNER guards, a Team page with members, invites, and an
  Activity tab over the AuditLog, and a functional workspace switcher
  in the topbar (session re-issue after membership check).
- **Onboarding and production cron.** Dashboard getting started
  checklist computed from live workspace state. GET /api/cron/tick
  accepts the Vercel Cron CRON_SECRET bearer token, runs reply sync
  plus the send tick, and returns a JSON summary; `vercel.json`
  schedules it every 5 minutes, with the plan caveat documented in
  DEPLOYMENT.md. The worker tick itself now syncs replies before
  sending as well.
- Tests: 125 passing (46 new across crypto, classification, DNS
  fixtures, sync with FakeSource, invites and owner guards, workspace
  switching, and cron route auth). Typecheck and production build pass.

## Deployment preparation (2026-10-26)

The repository is ready to deploy to Vercel with PostgreSQL.

- Production schema at `prisma/prod/schema.prisma`: models identical to
  the SQLite development schema, datasource switched to PostgreSQL with
  `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) environment variables.
- Production migrations generated at `prisma/prod/migrations/0001_init`
  (16 tables, 11 enum types, JSONB columns, app-supplied cuid text keys),
  kept in their own folder so `migrate deploy` with the production schema
  can never pick up the SQLite migrations by mistake.
- `vercel.json` at the repo root: Next.js framework, install command
  `npm install`, build command `npm run build:vercel`, which runs
  `prisma generate`, `prisma migrate deploy` against the production
  schema, then `next build`. A migration failure fails the build; there
  is no silent fallback.
- DEPLOYMENT.md: the full production runbook covering Neon database
  creation, the required Vercel environment variables, the first deploy,
  post-deploy checks, and how the sending worker is triggered in
  production (an external scheduler calling POST /api/worker/tick with
  the worker secret, since Vercel Cron cannot set that custom header).
- Verified locally: production schema validates, development typecheck,
  all 79 tests, and the development build all pass unchanged.

## Phase 2, Functional MVP (2026-10-26)

The product now runs a complete campaign lifecycle end to end.

- Leads: list management, manual add, search, status and tag filters,
  pagination, bulk delete and bulk tag, CSV export, and a CSV import
  wizard with column mapping. Imports run through the dedupe engine,
  then the workspace-exists check, then the suppression check, and
  produce a summary (kept, duplicates, invalid, suppressed) plus a
  downloadable per-row error report.
- Campaigns: create, edit, delete with guarded status transitions, a
  sequence builder with per-step delays, a token picker, and a live
  preview rendered against a real lead from the attached list.
- Enrollment: attaching a lead list enrolls its eligible leads, skipping
  suppressed, ineligible, and already enrolled leads, with counts
  reported. The unique (campaign, lead) constraint remains the hard
  guarantee against duplicate enrollment.
- Preflight: a pure domain engine plus a panel and a launch gate.
  Launch refuses on any FAIL: no steps, an empty step body, zero
  enrolled leads, no connected account, unknown personalisation tokens,
  or an incomplete unsubscribe footer (missing workspace postal
  address). Volume above combined effective limits, suppressed
  enrollees, empty subjects, and incomplete sender identity warn.
- Sending worker: one tick sends due enrollments for RUNNING campaigns,
  re-checking suppression and lead status per enrollment, rotating
  across the campaign's accounts under the limits engine, appending
  the compliance footer and unsubscribe link, and advancing the
  sequence through the scheduling engine. Sends are idempotent per
  enrollment and step. Runs as `npm run worker:once` or
  POST /api/worker/tick with the worker secret.
- Providers behind one interface: Simulation (DEMO, no network) and
  SMTP via nodemailer with credentials resolved from server
  environment variables named by the account's credentialRef. Gmail
  and Microsoft 365 accounts can be recorded but cannot send until
  OAuth lands in Phase 3.
- Unsubscribe: signed HMAC token links at /u/[token] that mark the
  lead, write a suppression, stop all active enrollments, and record
  an UNSUBSCRIBED event attributed to the source campaign.
- Event ingestion: POST /api/webhooks/events applies DELIVERED,
  BOUNCED, REPLIED, UNSUBSCRIBED, and COMPLAINED outcomes
  idempotently; replies, bounces, unsubscribes, and complaints stop
  follow-ups, and bounces and complaints suppress the address.
- Analytics: per-campaign metrics from recorded events on the campaign
  page and a cross-campaign comparison table, with opens reported
  separately as an unreliable signal.
- Settings: workspace sender identity (name and postal address) and
  suppression list management are now real pages.
- Schema: CampaignAccount join, Campaign.leadListId, Workspace
  senderName and senderAddress, Enrollment.lastError, a FAILED event
  type, and a SIMULATION provider value (migration
  20261026155417_phase2_foundation).
- Tests: 79 passing, up from 44. New coverage for preflight rules,
  the CSV module, the import service, the sending tick (rotation,
  limits, suppression skip, crash recovery idempotency), event
  application (reply stop, bounce suppression, duplicate delivery),
  and unsubscribe tokens and effects.

## Phase 1, Foundation (2026-10-26)

- Design system and application shell with light and dark themes.
- Authentication with bcrypt password hashing and httpOnly JWT session
  cookies; multi-tenant workspaces with OWNER, ADMIN, MEMBER, and
  VIEWER roles, created atomically at signup.
- Complete core Prisma schema with a committed migration.
- Pure TypeScript domain engine: scheduling, suppression, dedupe,
  personalisation, metrics, and sending limits, with 44 unit tests.
- Dashboard with real per-workspace counts and honest empty states.
- Honest placeholder pages for later-phase areas, with no fake data.
