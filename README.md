# ColdReach

ColdReach is a cold email outreach platform for sales teams, lead generation
agencies, founders, and recruiters. It is built around responsible sending:
scheduling controls, suppression enforcement before every send, honest
analytics computed from real events, and a clear line that no tool can
guarantee inbox placement.

This repository currently contains **Phase 1, the foundation**: the design
system and application shell, working authentication with multi-tenant
workspaces, the complete core data model, a tested domain engine for
scheduling, suppression, deduplication, personalisation, metrics, and
sending limits, and a dashboard that reads real counts from the database.

## Status, honestly

**Real and working now**

- Sign up, login, logout, and session resolution, with bcrypt password
  hashing and httpOnly JWT session cookies.
- Multi-tenant workspaces with OWNER, ADMIN, MEMBER, and VIEWER roles,
  created atomically with the owner account at signup.
- Middleware protection of every `/app` route.
- Audit log rows for signup, login, and logout.
- Full Prisma schema for the core product, with a committed migration.
- Domain engine in `src/lib/domain`, covered by 44 passing unit tests.
- Dashboard showing real per-workspace counts, with an honest empty state.
- Landing page, light and dark themes, and described placeholder pages for
  the areas that land in later phases. No fake data anywhere.

**Stubbed as described placeholders**

- Campaigns, Leads, Inbox, Sending Accounts, Analytics, Team, Integrations,
  and Settings pages describe exactly what each phase will build. They hold
  no invented data and no dead buttons.

**Needs credentials and later phases**

- Sending email (Gmail, Microsoft 365, SMTP) arrives in Phase 2 and needs
  real provider accounts and OAuth credentials.
- Reply synchronisation and the unified inbox arrive in Phase 3.
- AI assistance, CRM integrations, the public API, and billing arrive in
  Phase 4.

## Stack

- Next.js 15 (App Router) and React 19, TypeScript throughout.
- Tailwind CSS 3 with CSS variable design tokens and class based dark mode.
- Prisma ORM. Local development uses SQLite; the production target is
  PostgreSQL. The schema avoids provider specific features to stay portable.
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

Useful commands:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run, domain engine tests
npm run build       # production build
npx prisma validate # schema validation
npx prisma studio   # browse the local database
```

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
prisma/schema.prisma     Core data model and the migration in prisma/migrations
src/app                  Routes: landing, auth pages, /app shell, /api/auth
src/components           Shell, sidebar, user menu, theme toggle, auth form
src/lib/auth             Session tokens, session/workspace resolution, roles
src/lib/domain           Pure TypeScript engines, each with Vitest tests
src/lib/prisma.ts        Prisma client singleton
src/lib/audit.ts         Audit log writer
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

- Phase 2: lead import UI, campaign creation, sequence builder, provider
  connections, the sending worker, unsubscribe handling, basic analytics.
- Phase 3: unified inbox and reply sync, sender health and DNS checks, team
  collaboration, full reporting, onboarding.
- Phase 4: AI assistance, A/B testing, agency features, CRM integrations,
  public API and webhooks, billing.
- Phase 5: production hardening, monitoring, deployment automation.
