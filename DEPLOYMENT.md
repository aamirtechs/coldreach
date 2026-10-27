# ColdReach Production Deployment Runbook

This is the exact procedure for deploying ColdReach to Vercel with a
PostgreSQL database. Local development keeps using SQLite
(`prisma/schema.prisma`); production uses the PostgreSQL schema at
`prisma/prod/schema.prisma` and the PostgreSQL migrations in
`prisma/prod/migrations/`. The two migration folders are different SQL
dialects and are never interchangeable.

**Warning:** never run a Prisma command against the production database
without `--schema prisma/prod/schema.prisma`. The default schema and the
migrations in `prisma/migrations/` are SQLite. Running `prisma migrate
deploy` (or `db push`) with the default schema against production would
try to apply SQLite SQL to PostgreSQL and fail, or worse, confuse the
migration history. Every production command in this runbook passes the
prod schema explicitly.

## 1. Create the PostgreSQL database (Neon)

1. Create a Neon project, either from the Vercel dashboard (Storage tab,
   Create Database, Neon Postgres) or directly at https://neon.tech.
   Pick a region close to the Vercel deployment region.
2. In the Neon console, open Connection Details for the project. Neon
   shows two connection strings:
   - The **pooled** string, whose host contains `-pooler` (for example
     `ep-xxxx-pooler.region.aws.neon.tech`). This is `DATABASE_URL`.
     It goes through Neon's connection pooler and is what the running
     application uses.
   - The **direct** string, whose host has no `-pooler`. This is
     `DIRECT_URL`. Prisma Migrate uses it, because migrations need a
     direct connection rather than a pooled one.
3. Keep both strings secret. They are only ever pasted into Vercel
   environment variables (step 3), never into the repository.

## 2. Import the repository into Vercel

1. In Vercel, Add New, Project, and import the `coldreach` GitHub
   repository.
2. Framework Preset: Next.js (detected automatically).
3. Root Directory: leave at the repository root, do not change it.
4. Build and install settings come from `vercel.json` in the repo:
   install command `npm install`, build command `npm run build:vercel`.
   Do not override them in the dashboard.
5. Do not deploy yet. Set the environment variables first (step 3),
   because the first build runs the database migrations.

## 3. Environment variables in Vercel

Set these for the Production environment (and Preview if preview
deployments should reach a separate preview database; never point
Preview at the production database).

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string from step 1 |
| `DIRECT_URL` | Neon **direct** connection string from step 1 |
| `SESSION_SECRET` | At least 32 random characters. Generate with `openssl rand -hex 32`. Signs session JWTs and unsubscribe tokens; changing it invalidates all sessions. |
| `WORKER_SECRET` | A long random value. Authenticates POST /api/worker/tick via the `x-worker-secret` header. |
| `WEBHOOK_SECRET` | A long random value. Authenticates POST /api/webhooks/events via the `x-webhook-secret` header. |
| `APP_URL` | The production URL, for example `https://coldreach.example.com`. Used in links and email footers. |
| `ENCRYPTION_KEY` | Phase 3. Base64 encoded 32 random bytes. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Encrypts OAuth tokens at rest; without it Gmail and Microsoft 365 accounts cannot be connected. Never rotate casually: tokens encrypted with the old key become unreadable and accounts must reconnect. |
| `CRON_SECRET` | Phase 3. A long random value. Vercel Cron sends it automatically as `Authorization: Bearer` to GET /api/cron/tick when set (see section 6). |

Phase 3 OAuth, set only when connecting real mailboxes (full console
steps in INTEGRATIONS.md):

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From the Google Cloud OAuth client whose redirect URI is `{APP_URL}/api/accounts/oauth/google/callback` |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | From the Microsoft app registration whose redirect URI is `{APP_URL}/api/accounts/oauth/microsoft/callback` |

Phase 4 optional variables. Everything in this group is safe to
leave unset: the affected features report "not configured" with the
missing names, and the rest of Phase 4 (A/B testing, the public API,
outbound webhooks, plan quotas, the agency rollup) works without
any of them. Webhook endpoint secrets do reuse `ENCRYPTION_KEY`
from the required table above.

| Variable | Value |
| --- | --- |
| `OPENAI_API_KEY` | Phase 4 AI assistance. An OpenAI API key with chat completions access. Without it, /api/ai/* returns 501 and the builder panels show "AI is not configured". |
| `AI_MODEL` | Optional. Chat model for AI assistance; defaults to `gpt-4o-mini`. |
| `STRIPE_SECRET_KEY` | Phase 4 billing. Stripe secret key; required with the price IDs below for checkout and the customer portal. |
| `STRIPE_WEBHOOK_SECRET` | Phase 4 billing. Signing secret of the Stripe webhook endpoint at `{APP_URL}/api/billing/webhook`; required for subscription sync (see INTEGRATIONS.md section 9 for the dashboard steps and the exact events to subscribe). |
| `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` / `STRIPE_PRICE_AGENCY` | Phase 4 billing. The recurring Price IDs for the three paid plans, created in the Stripe dashboard. |

Phase 5 optional variables:

| Variable | Value |
| --- | --- |
| `SENTRY_DSN` | Optional error tracking. When set, error level entries from the structured logger (src/lib/log.ts) are also forwarded to Sentry's envelope endpoint. Unset means logs go to stdout and stderr only, which Vercel captures as runtime logs. |
| `LOG_LEVEL` | Optional. One of debug, info, warn, error; defaults to info. |

Phase 6 optional variables. Both are credential gates in the usual
pattern: unset means the feature reports "not configured" naming
these variables, and everything else works.

| Variable | Value |
| --- | --- |
| `VERIFY_API_KEY` | Phase 6 email verification provider (NeverBounce). Without it, list verification runs the built-in checks only. Console steps in ACTIVATION.md section 6. |
| `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` | Phase 6 HubSpot CRM sync. From the HubSpot app whose redirect URL is `{APP_URL}/api/crm/hubspot/callback`. Console steps in ACTIVATION.md section 8. |

Optional, per SMTP sending account: an account stores only a
`credentialRef` in the database. For a ref of `ACME_SMTP`, set
`ACME_SMTP_HOST`, `ACME_SMTP_PORT`, `ACME_SMTP_USER`, `ACME_SMTP_PASS`,
and optionally `ACME_SMTP_SECURE`. Passwords never live in the database
or the repository.

## 4. First deploy

Deploy from the Vercel dashboard (or by pushing to the production
branch). The build runs `npm run build:vercel`, which is:

```bash
prisma generate --schema prisma/prod/schema.prisma
prisma migrate deploy --schema prisma/prod/schema.prisma
next build
```

`migrate deploy` applies the folders in `prisma/prod/migrations/` in
order (`0001_init`, then `0002_phase3_professional_workflows`, and so
on) to the Neon database. If a migration fails, the build fails and
nothing ships. That is deliberate: there is no fallback that hides a
migration failure.

## 5. Post-deploy checks

Run these against the production URL before announcing anything:

1. `GET /` returns 200 and the landing page renders.
2. `GET /app` redirects to `/login` when unauthenticated.
3. Sign up with a fresh account: it succeeds, creates a workspace, and
   lands on the empty dashboard. Log out and log back in.
4. Worker endpoint auth: `curl -X POST https://<your-domain>/api/worker/tick`
   with no headers returns **401**. With the header
   `x-worker-secret: <WORKER_SECRET>` it returns 200 and a tick summary.
5. In Settings, save the workspace sender name and postal address (the
   campaign preflight requires the postal address before any launch).

## 6. Running the sending worker in production

Sending and reply sync happen in ticks. Something must call the tick
on a schedule; the deployed Next.js app does not run a background loop
by itself. A tick first syncs replies for connected Gmail and
Microsoft 365 accounts (so a fresh reply stops its follow-up), then
sends everything that is due (campaign RUNNING, enrollment ACTIVE,
send time reached) under the per-account daily limits. The cadence
controls latency, not volume.

**Option A, Vercel Cron (Phase 3).** `vercel.json` declares a cron
for `GET /api/cron/tick` on a daily schedule (`0 5 * * *`, 05:00
UTC). Vercel invokes it with `Authorization: Bearer {CRON_SECRET}`
automatically when the `CRON_SECRET` environment variable is set
(see section 3), and the route answers 401 to anything else. The
daily schedule is what the current Hobby plan allows: Hobby limits
cron jobs to once per day, and Vercel rejects the whole deployment
if the schedule runs more often. For sub-daily cadence, either
upgrade to the Pro plan (restoring a `*/5 * * * *` schedule in
`vercel.json` is a one-line change) or use Option B below for the
frequent ticks and let the daily Vercel cron act as a backstop.

**Option B, external scheduler.** Any scheduler that can send a custom
header can drive the original endpoint, for example cron-job.org, a
GitHub Actions scheduled workflow with a `curl` step, or a small
always-on job on any server:

- Endpoint: `POST /api/worker/tick`
- Auth: header `x-worker-secret` set to `WORKER_SECRET`
- Suggested cadence: every 5 minutes.

The owner provisions the `WORKER_SECRET` value in the scheduler at
setup time. The secret lives only in Vercel's environment variables
and the scheduler's own configuration, never in this repository.

```bash
curl -X POST https://<your-domain>/api/worker/tick \
  -H "x-worker-secret: $WORKER_SECRET"
```

The same external scheduler can also call `GET /api/cron/tick` with
the bearer secret instead; both routes run the identical tick. For
local development and one-off runs, `npm run worker:once` runs a
single tick from the CLI.

## 7. Future schema changes

1. Edit models in `prisma/schema.prisma` (dev) and mirror the change in
   `prisma/prod/schema.prisma`. The models in the two files must stay
   identical; only the datasource blocks differ.
2. Develop and test against SQLite with `npx prisma migrate dev`.
   Note: `prisma generate` writes one shared client, so generating
   from the production schema locally (to verify `build:vercel`)
   swaps the client to PostgreSQL and SQLite tests then fail
   validation until a plain `npx prisma generate` (dev schema)
   restores it. On Vercel this never matters: the build generates
   from the production schema in its own environment.
3. Generate the production migration against a staging PostgreSQL
   database with `npx prisma migrate dev --schema prisma/prod/schema.prisma`,
   or offline with
   `npx prisma migrate diff --from-migrations prisma/prod/migrations --to-schema-datamodel prisma/prod/schema.prisma --script`
   written into a new numbered folder under `prisma/prod/migrations/`.
4. Commit both migration folders. The next Vercel deploy applies the
   new production migration during the build.

## 8. Monitoring and health checks

`GET /api/health` is public and returns 200 with
`{ status: "ok", db: "ok", version, time }` when the app and the
database respond, and 503 with `db: "error"` when the database
check fails. It exposes nothing else. Point an external uptime
monitor (UptimeRobot, Better Uptime, a cron job with curl, or
similar) at `https://<your-domain>/api/health` on a one to five
minute interval and alert on non-200 responses. Application logs
are structured JSON lines on stdout and stderr (worker ticks,
webhook deliveries, cron runs, API errors), visible in Vercel's
runtime logs; set `SENTRY_DSN` (section 3) to also forward errors
to Sentry.

**Built-in uptime check (Phase 6).** The repository ships
`.github/workflows/uptime.yml`, which curls
`{APP_URL}/api/health` every 30 minutes and on manual dispatch,
and fails the run unless the response reports status ok and db ok.
A failed run notifies the repository owner through GitHub's normal
workflow notifications, so no third-party monitor is required for
basic coverage (an external monitor on a shorter interval is still
fine to add). The target URL is the `APP_URL` repository variable
(Settings, Secrets and variables, Actions, Variables) when set,
and the literal production URL
`https://coldreach-blue.vercel.app` otherwise. Update the variable
when the production domain changes (see section 12).

**Continuous integration (Phase 6).** `.github/workflows/ci.yml`
runs on every push to main and on every pull request: checkout,
Node 20, `npm ci`, Prisma client generation,
`npm run typecheck`, the full test suite, `npm run build`, and
`npm audit --audit-level=high` as its own step, which fails the
job on high or critical dependency findings. That audit step is
the standing answer to the Phase 5 note that `npm audit` could not
run from the development VM (the package registry proxy returned
403 there): dependency findings are now checked on every change
from CI, where the registry is reachable. Treat a red audit step
as a launch blocker, as SECURITY.md records.

## 9. Backups and recovery

Three layers, in the order you would reach for them:

1. **Neon point-in-time restore.** Neon retains a restore window
   for the project and can branch or restore the database to an
   earlier point in time from the console. The retention window
   and the restore mechanics are plan dependent: confirm what
   your Neon plan includes in the console before you rely on a
   specific window, and rehearse a restore to a branch once so
   the steps are familiar before an incident.
2. **Tenant export (in the product).** Any workspace OWNER can
   download a full JSON export in Settings. It contains the
   tenant's data with credential material structurally excluded
   (see SECURITY.md). `scripts/restore-workspace.ts` rebuilds a
   workspace from that file: accounts come back DISCONNECTED and
   campaigns come back as DRAFT, so a restore can never start
   sending on its own. The path is proven by
   `scripts/drill-recovery.ts`; run it after any change to the
   export shape. The export is the per-tenant safety net, not a
   full database backup: enrollments are counts only, and API
   keys, webhook endpoints, and mailbox connections must be
   recreated.
3. **Source control.** The application is fully described by the
   git repository plus the environment variables in section 3.
   Keep the env values in a password manager; the repo alone
   cannot rebuild production without them.

## 10. Rollback

- **Code and deployment:** in the Vercel dashboard, Deployments,
  pick the last known-good deployment and choose Promote to
  Production (instant rollback). The same effect from git: revert
  the offending commit and push; the build redeploys the previous
  code.
- **Database:** migrations are forward-only in this project.
  Rolling the code back does not undo a migration. Additive
  migrations (new tables, new columns, new indexes, like every
  migration so far) are safe to leave in place under older code.
  If a migration itself is the problem, restore the database with
  Neon's point-in-time restore (section 9) to just before the
  deploy, accepting the data written in between as lost, or write
  a corrective forward migration. Decide deliberately; do not
  hand-edit the `_prisma_migrations` table.
- **After any rollback:** re-run the post-deploy checks in
  section 5 and confirm `GET /api/health` is 200.

## 11. Secret rotation

The full procedure, including the `ENCRYPTION_KEY` caveats and
the per-secret steps, lives in SECURITY.md under "Secret rotation
procedure". The short version: `SESSION_SECRET` rotation logs
everyone out; worker, webhook, and cron secrets must be rotated
together with the schedulers that present them; database
credentials rotate in the Neon console and then in Vercel;
`ENCRYPTION_KEY` rotation forces mailbox reconnections and
webhook recreation, so plan it as maintenance, not a quick env
edit.

## 12. Custom domain (when the owner buys one)

Nothing in the app is domain specific except configuration. When a
custom domain is purchased (see TRADEMARK.md before branding
anything), attach it in this order:

- [ ] Buy the domain at a registrar of your choice.
- [ ] In Vercel, open the ColdReach project, Settings, Domains, and
      add the domain (and the `www` subdomain if you want it, with
      a redirect to the apex).
- [ ] At the registrar (or wherever DNS is hosted), add the records
      Vercel shows for that domain: typically an A record for the
      apex and a CNAME for `www`. Wait until Vercel reports the
      domain as valid and the certificate as issued.
- [ ] Update `APP_URL` in Vercel (Production) to the new origin,
      for example `https://coldreach.example.com`, with no trailing
      slash. Every redirect URI and link in the app derives from
      it.
- [ ] Update the OAuth redirect URIs to the new origin: Google
      Cloud console (APIs and Services, Credentials, the OAuth
      client), Microsoft app registration (Authentication), and the
      HubSpot app (Auth tab). The paths do not change:
      `/api/accounts/oauth/google/callback`,
      `/api/accounts/oauth/microsoft/callback`,
      `/api/crm/hubspot/callback`.
- [ ] Update the Stripe webhook endpoint URL to
      `https://<domain>/api/billing/webhook` (Developers, Webhooks).
      The events stay the same three; the signing secret does not
      change when only the URL changes on the same endpoint, but
      verify `STRIPE_WEBHOOK_SECRET` still matches afterwards.
- [ ] If you use an external scheduler for the worker tick or the
      uptime workflow's `APP_URL` repository variable, update them
      too.
- [ ] Redeploy production so the new `APP_URL` takes effect.
- [ ] Verify: `GET https://<domain>/api/health` returns ok; the
      Integrations status panel in Settings shows the same
      Configured rows as before; reconnect one mailbox end to end;
      run one test-mode Stripe checkout. Keep the old
      vercel.app URL live during the transition: it stays assigned
      to the project, and the redirect URIs for it can stay in the
      provider consoles as additional entries until you retire it.
