# ColdReach

ColdReach is a cold email outreach platform for sales teams, lead generation
agencies, founders, and recruiters. It is built around responsible sending:
scheduling controls, suppression enforcement before every send, honest
analytics computed from real events, and a clear line that no tool can
guarantee inbox placement.

This repository contains **Phases 1 to 5**, the complete 1.0.0
product: the design system and application shell, working
authentication with multi-tenant workspaces, the complete core
data model, a tested domain engine, the full campaign lifecycle
(lead import, campaign and sequence building, preflight launch
checks, a sending worker behind a provider interface, unsubscribe
enforcement, provider event handling, and analytics computed from
recorded events), Phase 3 professional workflows (OAuth mailbox
connections, reply sync with a unified inbox, deliverability
diagnostics, team collaboration), Phase 4 competitive capabilities
(A/B testing, AI assistance, a public API with keys, outbound
webhooks, plan quotas with Stripe billing, and an agency command
center), and Phase 5 production readiness (security headers and
rate limiting, structured logging and a health endpoint, a
redacted workspace export with a proven restore path, performance
and accessibility passes, and a final executed QA, see QA.md).

## Status, honestly

**Real and working now**

- Sign up, login, logout, and session resolution, with bcrypt password
  hashing and httpOnly JWT session cookies.
- Multi-tenant workspaces with OWNER, ADMIN, MEMBER, and VIEWER roles,
  created atomically with the owner account at signup.
- Middleware protection of every `/app` route.
- Audit log rows for sensitive actions across auth, leads, campaigns,
  accounts, suppressions, and workspace settings.
- Full Prisma schema for the core product, with committed migrations.
- Domain engine in `src/lib/domain`, covered by unit tests (195 tests
  passing in total, including integration tests for the worker, the
  import service, event application, unsubscribe handling, reply sync,
  invites, the cron route, A/B statistics, API keys, webhooks, the
  agency rollup, the auth rate limiter, the logger, security headers,
  the health check, and the export redaction rules).
- Leads: lists, CSV import wizard with mapping, dedupe, suppression
  checks and a downloadable error report, manual add, filters, bulk
  actions, and CSV export.
- Campaigns: CRUD with guarded status transitions, a sequence builder
  with token picker and live preview against a real lead, enrollment
  with skip accounting, and preflight gating every launch.
- Sending accounts and a sending worker (`npm run worker:once` or
  POST /api/worker/tick) with rotation, per-account effective limits,
  per-send suppression re-checks, idempotent sends, and a compliance
  footer with a signed unsubscribe link on every message.
- Provider event ingestion at POST /api/webhooks/events: delivered,
  bounced, replied, unsubscribed, and complained outcomes apply
  idempotently and stop follow-ups.
- Analytics: per-campaign metrics and a cross-campaign table, computed
  live from recorded events. Opens are reported separately as an
  unreliable signal.
- Dashboard showing real per-workspace counts, with an honest empty state.
- Landing page, light and dark themes. No fake data anywhere.
- Phase 3: OAuth credential security (AES-256-GCM token storage),
  Gmail and Microsoft 365 connect flows with honest "Not configured"
  states, reply sync with a unified inbox (filters, conversation view,
  reply composer, assignment, internal notes, rule based reply
  classification), a deliverability diagnostics center (live SPF,
  DKIM, and DMARC grading plus per account health from real events),
  team collaboration (invites with hashed tokens, roles, last owner
  guards, activity feed), a functional workspace switcher, a
  getting started checklist computed from live state, and a Vercel
  Cron endpoint (GET /api/cron/tick) that runs reply sync and sends.
- Phase 4: A/B testing (up to two extra variants per step with
  weights, deterministic per-enrollment assignment, per-variant
  analytics, and a winner declared only by a two-proportion z-test
  at 95 percent confidence with a minimum sample, never on noise),
  AI assistance behind an AiProvider interface (subject ideas,
  rewrites, and per-lead icebreakers, applied only on an explicit
  click), a public API under /api/v1 with hashed, scoped,
  rate-limited API keys (API.md), outbound webhooks with HMAC
  signatures, retry backoff, and a delivery log, plan quotas
  (Preflight gate, worker hard stop, account and seat limits) with
  Stripe checkout, portal, and webhook sync behind env vars, and an
  Agency Command Center rolling up every workspace the user owns.
- Phase 5: security headers with a CSP on every response, rate
  limiting on the login and signup endpoints, a structured JSON
  logger with an optional Sentry forwarder, `GET /api/health`,
  branded error and 404 pages, an OWNER-only workspace data export
  with structural credential redaction plus a restore script and a
  proven recovery drill, hot-path database indexes, database-level
  aggregation for metrics and stats (no unbounded event loads), and
  an accessibility pass over the main flows.

**Demo mode**

- Simulation sending accounts exercise the entire lifecycle without
  touching a mail server. Every result they produce is labelled DEMO.

**Needs credentials and later phases**

- SMTP sending works when the server environment carries the variables
  named by an account's credentialRef (see `.env.example`). No SMTP
  credentials are stored in the database.
- Gmail and Microsoft 365 sending and reply sync activate the moment
  the owner sets the OAuth client credentials and ENCRYPTION_KEY (see
  INTEGRATIONS.md). Until then those providers report "Not
  configured" by name. Google additionally gates the restricted Gmail
  scopes behind its verification process; INTEGRATIONS.md states
  exactly what that means.
- AI assistance activates when the owner sets `OPENAI_API_KEY`
  (optionally `AI_MODEL`); until then the AI endpoints return 501
  naming the variable and the panels say "AI is not configured".
  Stripe checkout and the customer portal activate with
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the three price
  ID variables (INTEGRATIONS.md section 9); until then the Billing
  page shows the real plan and usage with an owner-only manual plan
  override, clearly labelled as the pre-Stripe path. Plan prices in
  the catalog are placeholders until the owner sets real Stripe
  prices.
- CRM sync (HubSpot, Salesforce) runs through outbound webhooks into
  Zapier or Make, or through the public API. There is no native CRM
  connector, and the Integrations page says so plainly.

## Stack

- Next.js 15 (App Router) and React 19, TypeScript throughout.
- Tailwind CSS 3 with CSS variable design tokens and class based dark mode.
- Prisma ORM. Local development uses SQLite; production uses PostgreSQL
  through the mirrored schema at `prisma/prod/schema.prisma` and the
  PostgreSQL migrations in `prisma/prod/migrations`. The schema avoids
  provider specific features to stay portable.
- bcryptjs for password hashing, jose for JWT session cookies.
- Vitest for unit tests.

## Local setup

Prerequisites: Node.js 20 or newer (developed on Node 24) and npm.

```bash
npm install
cp .env.example .env
# Edit .env and set a long random SESSION_SECRET.
npx prisma migrate dev
npm run dev
```

Then open http://localhost:3000, create an account, and you land in an empty
workspace dashboard. That emptiness is correct: ColdReach ships no sample
data.

For production deployment to Vercel with Neon PostgreSQL, follow
DEPLOYMENT.md. The production build (`npm run build:vercel`) generates
the client from the PostgreSQL schema, applies the production migrations,
and then builds; it is already wired up in `vercel.json`.

Useful commands:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run, domain and integration tests
npm run build       # production build
npm run worker:once # run one sending worker tick (needs a RUNNING campaign)
npx prisma validate # schema validation
npx prisma studio   # browse the local database
```

Set `WORKER_SECRET` and `WEBHOOK_SECRET` in `.env` before running the
worker or the event endpoint; both reject unauthenticated calls.

A first walkthrough that needs no mail credentials: sign up, add the
sender postal address in Settings, create a simulation (DEMO) sending
account, import a CSV into a list, build a campaign with two steps,
enroll, run preflight, launch, then run `npm run worker:once` and watch
the campaign results fill in.

### Troubleshooting: Prisma engine downloads

Prisma downloads its engine binaries on install and on `prisma generate`.
On networks that interrupt those downloads, install with
`npm install --ignore-scripts`, download `schema-engine` and
`libquery_engine` for your platform from
https://binaries.prisma.sh/all_commits/ (version hash is in
`node_modules/@prisma/engines-version`) into `node_modules/@prisma/engines`,
and point Prisma at them:

```bash
export PRISMA_SCHEMA_ENGINE_BINARY="$PWD/node_modules/@prisma/engines/schema-engine-<platform>"
export PRISMA_QUERY_ENGINE_LIBRARY="$PWD/node_modules/@prisma/engines/libquery_engine-<platform>.so.node"
```

This is exactly how this development environment was set up.

## Project layout

```
prisma/schema.prisma     Core data model (SQLite dev) and the migrations in prisma/migrations
prisma/prod/             Production PostgreSQL schema and its own migrations folder
vercel.json              Vercel build settings (npm run build:vercel)
API.md                   Public API reference: auth, scopes, endpoints, error shapes
DEPLOYMENT.md            Production deployment runbook (Vercel + Neon PostgreSQL)
src/app                  Routes: landing, auth pages, /app shell, /u unsubscribe,
                         /api for auth, leads, campaigns, accounts, worker, webhooks
src/components           Shell and page components for leads, campaigns,
                         accounts, and settings
src/lib/auth             Session tokens, session/workspace resolution, roles
src/lib/domain           Pure TypeScript engines, each with Vitest tests
src/lib/leads            CSV import service
src/lib/campaigns        Enrollment and preflight assembly services
src/lib/providers        Mail provider interface, simulation, SMTP, Gmail, and Graph transports
src/lib/oauth            OAuth provider config, signed state tokens, token storage and refresh
src/lib/security         AES-256-GCM encryption for provider tokens at rest
src/lib/sync             Reply sync engine: Gmail, Graph, and fake sources feeding the inbox
src/lib/deliverability   Live DNS lookups behind the deliverability diagnostics
src/lib/team             Invitation service and the last owner guards
src/lib/worker           Sending tick, reply sync pass, cron tick, provider event application, unsubscribe
src/lib/ai               AiProvider interface and the OpenAI provider (Phase 4)
src/lib/apiKeys          API key hashing, scope checks, per-key rate limit (Phase 4)
src/lib/webhooks         Outbound webhook endpoints, signing, delivery retries (Phase 4)
src/lib/billing          Subscriptions, usage accounting, Stripe client (Phase 4)
src/lib/agency           Cross-workspace rollup for owners (Phase 4)
src/lib/prisma.ts        Prisma client singleton
src/lib/audit.ts         Audit log writer
src/lib/log.ts           Structured JSON logger with optional Sentry forwarding (Phase 5)
src/lib/health.ts        Database ping behind GET /api/health (Phase 5)
src/lib/security/        AES-256-GCM crypto, and the response header definitions (Phase 5)
src/lib/settings/        Workspace export builder with credential redaction (Phase 5)
scripts/worker-once.ts   CLI entry for one sending tick
scripts/smoke-phase4.ts  Live HTTP smoke test for the Phase 4 surfaces
scripts/smoke-phase5.ts  Live HTTP smoke for the final QA checklist (QA.md)
scripts/drill-recovery.ts  Export, wipe, restore, compare recovery drill
scripts/restore-workspace.ts  Restores a workspace from an export file
scripts/load-smoke.ts    Local load smoke with latency percentiles
src/middleware.ts        Route protection for /app
```

## Production readiness

Phase 5 hardened the product for real operation:

- **Security.** Response headers and a content security policy on
  every route, rate limiting on the credential endpoints, and a
  reviewed session and password posture. SECURITY.md records the
  full review, the CSP tradeoff, the residual risks, and the
  secret rotation procedure.
- **Observability.** Structured JSON logging (`src/lib/log.ts`)
  across the worker, webhook delivery, cron, and API error paths,
  with an optional Sentry forwarder behind `SENTRY_DSN`, and a
  public health endpoint at `GET /api/health` for uptime monitors.
- **Backup and recovery.** Neon point-in-time restore at the
  platform layer, and in the product an OWNER-only workspace
  export (`scripts/restore-workspace.ts` restores it; campaigns
  return as DRAFT and accounts DISCONNECTED). DEPLOYMENT.md
  sections 8 to 11 are the runbook: monitoring, backups, rollback,
  and rotation.
- **Final QA.** QA.md is the executed checklist for 1.0.0: every
  top journey run against the production build, with the recovery
  drill counts and the load smoke numbers recorded, and the known
  limitations stated rather than hidden.

## Compliance stance

- Suppression is checked before every send, at workspace level and globally.
- Unsubscribes, bounces, and complaints stop follow-up sequences.
- Sender identity is never concealed, and no feature exists to evade spam
  filters or provider limits.
- Warm-up, where offered in later phases, will only be a legitimate external
  integration or a clearly labelled simulation. No deliverability or inbox
  placement guarantees are made anywhere in the product, because none can
  honestly be made.
- Opens are reported as an unreliable signal, because mail privacy features
  distort them.

See ARCHITECTURE.md for the tenancy model, the Phase 2 sending engine plan,
and security notes.

## Roadmap

- Phase 2 (done): lead import, campaign creation, sequence builder,
  preflight, provider connections (simulation and SMTP), the sending
  worker, unsubscribe handling, event ingestion, basic analytics.
- Phase 3 (done): unified inbox and reply sync, Gmail and Microsoft 365
  OAuth with encrypted token storage, sender health and DNS checks,
  team collaboration, onboarding checklist, production cron.
- Phase 4 (done): AI assistance, A/B testing, agency command center,
  CRM integration through Zapier and Make, public API and outbound
  webhooks, plan quotas and billing.
- Phase 5 (done): security headers and credential rate limiting,
  structured logging with a health endpoint, workspace export and
  restore, performance indexes and aggregation, accessibility,
  and the final QA in QA.md.
