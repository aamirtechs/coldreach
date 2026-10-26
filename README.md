# ColdReach

ColdReach is a cold email outreach platform for sales teams, lead generation
agencies, founders, and recruiters. It is built around responsible sending:
scheduling controls, suppression enforcement before every send, honest
analytics computed from real events, and a clear line that no tool can
guarantee inbox placement.

This repository currently contains **Phase 1 (foundation) and Phase 2
(functional MVP)**: the design system and application shell, working
authentication with multi-tenant workspaces, the complete core data
model, a tested domain engine, and now the full campaign lifecycle:
lead import, campaign and sequence building, preflight launch checks,
a sending worker behind a provider interface, unsubscribe enforcement,
provider event handling, and analytics computed from recorded events.

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
- Domain engine in `src/lib/domain`, covered by unit tests (79 tests
  passing in total, including integration tests for the worker, the
  import service, event application, and unsubscribe handling).
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

**Demo mode**

- Simulation sending accounts exercise the entire lifecycle without
  touching a mail server. Every result they produce is labelled DEMO.

**Needs credentials and later phases**

- SMTP sending works when the server environment carries the variables
  named by an account's credentialRef (see `.env.example`). No SMTP
  credentials are stored in the database.
- Gmail and Microsoft 365 sending needs OAuth connections, Phase 3.
  Accounts of those types can be saved today but cannot send.
- Reply synchronisation and the unified inbox arrive in Phase 3. The
  event ingestion endpoint is the seam they will feed.
- AI assistance, CRM integrations, the public API, and billing arrive
  in Phase 4. Team and Integrations pages remain described
  placeholders until then.

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
DEPLOYMENT.md            Production deployment runbook (Vercel + Neon PostgreSQL)
src/app                  Routes: landing, auth pages, /app shell, /u unsubscribe,
                         /api for auth, leads, campaigns, accounts, worker, webhooks
src/components           Shell and page components for leads, campaigns,
                         accounts, and settings
src/lib/auth             Session tokens, session/workspace resolution, roles
src/lib/domain           Pure TypeScript engines, each with Vitest tests
src/lib/leads            CSV import service
src/lib/campaigns        Enrollment and preflight assembly services
src/lib/providers        Mail provider interface, simulation and SMTP transports
src/lib/worker           Sending tick, provider event application, unsubscribe
src/lib/prisma.ts        Prisma client singleton
src/lib/audit.ts         Audit log writer
scripts/worker-once.ts   CLI entry for one sending tick
src/middleware.ts        Route protection for /app
```

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
- Phase 3: unified inbox and reply sync, Gmail and Microsoft 365 OAuth,
  sender health and DNS checks, team collaboration, full reporting,
  onboarding.
- Phase 4: AI assistance, A/B testing, agency features, CRM integrations,
  public API and webhooks, billing.
- Phase 5: production hardening, credential vaulting, monitoring,
  deployment automation.
