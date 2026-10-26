# ColdReach Architecture

## Overview

ColdReach is a multi-tenant SaaS built as a single Next.js application with
a Prisma data layer. Phase 1 delivers the foundation: identity, tenancy, the
complete core schema, a tested pure TypeScript domain engine, and the
application shell. Sending, synchronisation, and AI arrive in later phases
on top of these pieces, without changing the tenancy or domain contracts.

```
Browser
  |
Next.js app (App Router)
  |-- Marketing and auth pages
  |-- /app shell (server components, session resolved per request)
  |-- /api routes (auth today, product APIs from Phase 2)
  |
src/lib/domain   Pure engines: scheduling, suppression, dedupe,
                 personalisation, metrics, limits. No framework imports.
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

## Sending engine plan (Phase 2)

The schema already anticipates the sending worker:

- A background job queue (database backed at first, moving to a dedicated
  queue if volume demands) picks up `Enrollment` rows whose `nextSendAt`
  is due and whose campaign is RUNNING.
- Before any send, the worker re-checks, in order: enrollment still ACTIVE,
  lead not suppressed (workspace and global), account under its effective
  daily limit from `limits.ts`, and next instant inside the campaign window
  from `scheduling.ts`. Any failed check skips or reschedules, never sends.
- Sends are idempotent. Every outbound message and every provider event
  carries an idempotency key; `EmailEvent.idempotencyKey` is unique, so
  webhook retries and provider redeliveries cannot double count or double
  send. The send itself uses a per-enrollment, per-step key claimed before
  the provider call.
- Inbox rotation spreads due enrollments across the campaign's connected
  accounts, respecting each account's limit and connection health, and only
  where provider policies allow it.
- Reply, unsubscribe, bounce, and complaint events transition the
  enrollment to REPLIED, UNSUBSCRIBED, BOUNCED, or SUPPRESSED and cancel
  all future steps. Unsubscribes also write a suppression entry.
- Provider failures use bounded retries with backoff; repeated failures
  mark the account ERROR with the provider message stored for the user.

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

## Known limitations of Phase 1

- SQLite is a development database. Production should run PostgreSQL; the
  schema avoids SQLite specific constructs, with one documented exception:
  JSON fields on Lead carry no database level default, because SQLite
  cannot express a JSON literal default portably. Application code will
  supply defaults when lead creation lands in Phase 2.
- The workspace switcher shows the active workspace; switching between
  multiple memberships lands in Phase 3.
- There is no email sending, syncing, or AI yet. Pages for those areas are
  honest placeholders describing the phase that builds them.
