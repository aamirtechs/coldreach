# ColdReach Security Review

Scope and state as of the 1.0.0 release (Phase 5). This document
records what was reviewed, what changed, and what risk remains. It
describes the code in this repository; it is not a penetration test
and does not claim one happened.

## What was reviewed

- Authentication and session handling (signup, login, logout,
  session JWT, cookie attributes).
- The credential endpoints' resistance to online guessing.
- Response headers and content security policy.
- Tenant isolation patterns across the session API, the public API,
  webhooks, and the new workspace export.
- Credential storage: passwords, API keys, invite tokens, webhook
  secrets, OAuth tokens, SMTP credential references.
- The dependency set and the repository itself for leaked secrets.

## Changes made in Phase 5

### Security headers on every response

`next.config.ts` now sets headers for all routes (pages, API, and
static assets) from `src/lib/security/headers.ts`:

- `Content-Security-Policy`: `default-src 'self'`, scripts and
  styles from 'self', `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-ancestors 'none'`.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Frame-Options: DENY` (belt and braces with frame-ancestors)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  in production only, together with `upgrade-insecure-requests`.

CSP tradeoff, stated plainly: `script-src` and `style-src` include
`'unsafe-inline'`. The app ships an inline theme-init script (it
must run before first paint to avoid a theme flash) and components
use inline style attributes; Next.js here does not run a nonce
pipeline. Removing `'unsafe-inline'` without that pipeline would
break theming and layout. The residual XSS posture therefore rests
on React's output escaping, and the codebase helps: there is no
`dangerouslySetInnerHTML` anywhere in `src`. A future hardening
step is a nonce-based CSP, which needs the theme script moved into
the nonce flow.

### Rate limiting on credential endpoints

`POST /api/auth/login` and `POST /api/auth/signup` are limited to
10 attempts per 15 minutes per (IP, email) pair by
`src/lib/auth/rateLimit.ts`. Blocked attempts get HTTP 429 with a
`Retry-After` header. Verified live: the first 10 bad logins return
401, the 11th returns 429 even with the correct password.

The limiter is in-memory and per instance, the same documented
tradeoff as the public API limiter: counters reset on restart and
do not coordinate across instances. It raises the cost of online
guessing and signup spam; at real scale it should move to a shared
store or an edge rule.

### Session and cookie audit

Reviewed `src/lib/auth/session.ts`. No change was needed; the
existing settings were already correct and are now verified live
under `next start` by the Phase 5 smoke:

| Attribute | Value |
| --- | --- |
| httpOnly | yes (JavaScript cannot read the session cookie) |
| SameSite | lax (serialized as `SameSite=lax`) |
| Secure | yes when NODE_ENV is production |
| Path | `/` |
| Max-Age | 7 days, matching the JWT expiry |

Sessions are HS256 JWTs signed with `SESSION_SECRET` (the code
refuses secrets shorter than 16 characters; DEPLOYMENT.md asks for
32 or more). Login errors are generic: the response never reveals
whether the email exists.

### Password policy

Signup enforces a minimum of 10 characters server-side (and the
form mirrors it with `minLength`). Passwords are hashed with
bcrypt at cost factor 12. There is no password-change or
password-reset route in the product today; when one is added it
must enforce the same minimum. That gap is a product limitation,
recorded here rather than papered over.

### Workspace export redaction

The Phase 5 export (`src/lib/settings/export.ts`, OWNER only)
selects fields structurally: credential-bearing columns are never
read into the payload. Sending accounts export provider, email,
and status only (no credential references, no encrypted token
blobs, no provider account ids); API keys export their display
prefix (never the hash); webhook endpoints export no secret;
members export email and role (never password hashes); invites
export no token hash; Stripe customer and subscription ids are
excluded. The one free-form JSON in the payload, audit metadata,
passes through a recursive forbidden-key strip. Unit tests seed
every credential type and assert none of the values or key names
appear anywhere in the export.

## Dependency audit: could not run here

`npm audit` cannot run in this development environment: the
managed npm registry used here answers the audit endpoint with
403 `policy_denied`, so no advisory counts exist for this review,
before or after. Nothing was upgraded blind on the strength of a
tool that never ran.

What is true and checkable from the lockfile: dependencies are
pinned by `package-lock.json`; the versions built for 1.0.0 are
Next.js 15.5.28, Prisma 6.19.3, React 19.3.1, jose 6.x, bcryptjs
2.4.3, nodemailer 10.x. Required follow-up, owned by whoever runs
the deployment pipeline: run `npm audit` from an unrestricted
network (or in CI) before launch and on a recurring schedule, and
treat high and critical advisories as release blockers.

## Repository secrets scan

Scanned the full repository (excluding node_modules and build
output) with patterns for private keys, cloud and GitHub tokens,
Google API keys, and literal credential assignments in source,
scripts, and schemas. Result: clean. Test fixtures use obviously
fake values (for example `sk-test`, `whsec_test_secret`), and
`.env.example` carries placeholders only. The real `.env` is
gitignored and never leaves the machine.

## Standing credential design (pre-Phase 5, re-verified)

- API keys: SHA-256 hashed at rest, shown once, scoped, revocable.
- Invite tokens: SHA-256 hashed at rest; the plaintext lives only
  in the accept link.
- Webhook signing secrets and OAuth tokens: AES-256-GCM encrypted
  at rest under `ENCRYPTION_KEY`.
- SMTP passwords: never in the database; accounts store a
  credential reference resolved from server environment variables.
- Webhook event ingestion and the worker endpoints authenticate
  with shared secrets; the cron endpoint with a bearer secret.

## Residual risks, plainly

- In-memory rate limiters (auth and public API) are per instance
  and reset on restart. Fine for a single instance; insufficient
  as the only control at scale.
- No WAF or edge bot protection is configured. Vercel's platform
  protections are whatever the plan includes; nothing in this
  repo adds more.
- CSP allows inline scripts and styles (see the tradeoff above).
- Session JWTs are bearer tokens with a 7-day life and no
  server-side revocation list. Logout clears the cookie; a stolen
  token stays valid until expiry or a `SESSION_SECRET` rotation.
- No password reset flow exists (see Password policy).
- The optional Sentry forwarder (src/lib/log.ts) is a minimal
  envelope client: no breadcrumbs, no grouping controls, no
  sampling. It is a seam, not a full error-tracking integration.
- Backups are the platform's (Neon point-in-time restore, plan
  dependent) plus the tenant export. There is no cross-region or
  off-platform backup in this repo.

## Secret rotation procedure

Rotate on suspicion of exposure, on team changes, and on a
schedule you choose. All values live in the deployment's
environment variables (Vercel), never in the repo.

1. `SESSION_SECRET`: set a new value and redeploy. Every existing
   session is invalidated immediately; all users sign in again.
2. `WORKER_SECRET`, `WEBHOOK_SECRET`, `CRON_SECRET`: set new
   values, redeploy, and update every scheduler or sender that
   presents them in the same window, or ticks and event ingestion
   will 401 until they match.
3. `ENCRYPTION_KEY`: do not rotate casually. OAuth tokens and
   webhook secrets encrypted under the old key become unreadable.
   If rotation is forced: plan a window, disconnect Gmail and
   Microsoft accounts and delete webhook endpoints first, rotate,
   redeploy, then reconnect and recreate. Accounts that are not
   disconnected first come back in an error state and must be
   reconnected anyway.
4. Database credentials: rotate the password in the Neon console,
   update `DATABASE_URL` and `DIRECT_URL` in Vercel, redeploy.
5. API keys: revoke and recreate per key in Integrations. Revoked
   keys fail immediately.
6. Stripe keys: roll the secret key in the Stripe dashboard,
   update `STRIPE_SECRET_KEY`, and recreate the webhook endpoint
   to get a new `STRIPE_WEBHOOK_SECRET`; update both and redeploy.
7. SMTP account passwords: change at the mail provider, then
   update the account's environment variable prefix values and
   restart or redeploy.

## Reporting a vulnerability

This is a single-operator product today. Report issues to the
repository owner through the GitHub repository's private
vulnerability reporting if enabled, or by direct contact. There
is no bug bounty.
