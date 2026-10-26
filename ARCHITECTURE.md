# ColdReach Architecture

## Overview

ColdReach is a multi-tenant SaaS built as a single Next.js application with
a Prisma data layer. Phase 1 delivered the foundation: identity, tenancy,
the complete core schema, a tested pure TypeScript domain engine, and the
application shell. Phase 2 built the functional MVP on top: leads,
campaigns, preflight, the sending worker, unsubscribe handling, event
ingestion, and analytics, without changing the tenancy or domain
contracts. Synchronisation and AI arrive in later phases.

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
- API keys, when issued in Phase 4, are stored hashed (`ApiKey.keyHash`)
  with a display prefix, never in plaintext.
- Next steps for Phase 5 hardening: rate limiting on auth endpoints, CSRF
  review for cookie based mutations, security headers, and centralised
  error reporting.

## Domain engine

`src/lib/domain` contains pure functions with no framework or database
imports, each covered by Vitest tests. Keeping the rules pure makes them
testable in milliseconds and reusable by the future sending worker.

- `scheduling.ts` computes the next allowed send instant from a campaign
  timezone (via Intl), a local window, a business day rule, and a delay.
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
   (simulation or SMTP today). On success a SENT EmailEvent is
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
idempotency key); Suppressions; Threads and ThreadMessages for the unified
inbox; AuditLogs; ApiKeys. See `prisma/schema.prisma` for the full model
and `prisma/migrations` for the committed initial migration.

## Known limitations after Phase 2

- SQLite is a development database. Production should run PostgreSQL; the
  schema avoids SQLite specific constructs, with one documented exception:
  JSON fields on Lead carry no database level default, because SQLite
  cannot express a JSON literal default portably. Application code
  supplies the defaults on every lead creation path.
- The workspace switcher shows the active workspace; switching between
  multiple memberships lands in Phase 3.
- SMTP is the only real transport. Gmail and Microsoft 365 accounts are
  stored but cannot send until OAuth lands in Phase 3, and provider
  resolution says so plainly instead of failing silently.
- SMTP credentials are resolved from server environment variables named
  by the account's credentialRef. Encrypted vault storage is Phase 5
  hardening; no credential of any kind is in the database today.
- There is no reply synchronisation yet: replies enter through the
  event ingestion endpoint, which Phase 3 provider webhooks and the
  unified inbox will feed.
- Sent-today accounting uses UTC day boundaries, matching the limits
  engine's day definition. Campaign windows remain timezone aware.
- Tag filtering on leads runs in application code because tags are a
  JSON array; it is exact, and sized for workspace-scale lists.
