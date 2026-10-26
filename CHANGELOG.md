# Changelog

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
