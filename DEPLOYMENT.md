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

`migrate deploy` applies `prisma/prod/migrations/0001_init` to the Neon
database, creating all 16 tables, 11 enum types, indexes, and foreign
keys. If a migration fails, the build fails and nothing ships. That is
deliberate: there is no fallback that hides a migration failure.

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

Sending happens in ticks. Something must call the tick on a schedule;
the deployed Next.js app does not run a background loop by itself.

- Endpoint: `POST /api/worker/tick`
- Auth: header `x-worker-secret` set to `WORKER_SECRET`
- Suggested cadence: every 5 minutes. A tick sends everything that is
  due (campaign RUNNING, enrollment ACTIVE, send time reached) under
  the per-account daily limits, so the cadence controls latency, not
  volume.

Use any external scheduler that can send a custom header, for example
cron-job.org, a GitHub Actions scheduled workflow with a `curl` step,
or a small always-on job on any server:

```bash
curl -X POST https://<your-domain>/api/worker/tick \
  -H "x-worker-secret: $WORKER_SECRET"
```

**Vercel Cron cannot be used as-is.** Vercel Cron invokes a route with
an `Authorization: Bearer` header derived from its own `CRON_SECRET`
and does not let you set arbitrary custom headers, so it cannot present
the `x-worker-secret` this route requires. The known future improvement
is a dedicated cron route (for example `/api/cron/tick`) that accepts
Vercel's `CRON_SECRET` bearer token and then runs the same tick. That
route does not exist yet; until it does, use an external scheduler as
above. For local development and one-off runs, `npm run worker:once`
runs a single tick from the CLI.

## 7. Future schema changes

1. Edit models in `prisma/schema.prisma` (dev) and mirror the change in
   `prisma/prod/schema.prisma`. The models in the two files must stay
   identical; only the datasource blocks differ.
2. Develop and test against SQLite with `npx prisma migrate dev`.
3. Generate the production migration against a staging PostgreSQL
   database with `npx prisma migrate dev --schema prisma/prod/schema.prisma`,
   or offline with
   `npx prisma migrate diff --from-migrations prisma/prod/migrations --to-schema-datamodel prisma/prod/schema.prisma --script`
   written into a new numbered folder under `prisma/prod/migrations/`.
4. Commit both migration folders. The next Vercel deploy applies the
   new production migration during the build.
