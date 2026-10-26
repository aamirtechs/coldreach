# Changelog

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
