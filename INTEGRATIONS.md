# ColdReach Integrations: Gmail and Microsoft 365

This guide is for the workspace owner who deploys ColdReach. It covers
the one-time console work that lets users connect real Gmail and
Microsoft 365 mailboxes: creating the OAuth apps, setting the
environment variables, and what switches on when they are in place.

Nothing here is needed to run everything else. Until these credentials
exist, the Sending Accounts page shows each provider as "Not
configured" with the exact missing variables named. It never shows a
connect button that cannot work.

## What the connection does

- Sending: campaign sends and inbox replies go out through the
  connected mailbox (Gmail API `users.messages.send`, Microsoft Graph
  create + send), using OAuth tokens the app stores encrypted.
- Reply sync: the worker reads the mailbox inbox, matches replies to
  enrollments by Message-ID headers (falling back to the sender's
  email), stops the sequence through the same event path as webhooks,
  classifies the reply with documented keyword rules, and files it in
  the unified inbox.
- Token storage: access and refresh tokens live only in
  `SendingAccount.encryptedCredentials`, an AES-256-GCM encrypted blob
  keyed by `ENCRYPTION_KEY`. Plaintext tokens are never written to the
  database or logs. Providers refresh expired access tokens
  transparently; a failed refresh marks the account ERROR with the
  provider's message on the account row.

## 1. Set the encryption key and app URL (required for any OAuth)

In the deployment environment (Vercel project settings for
production), set:

| Variable | Value |
| --- | --- |
| `ENCRYPTION_KEY` | Base64 encoded 32 random bytes. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Losing or rotating it makes stored tokens unreadable; affected accounts simply reconnect. |
| `APP_URL` | The public base URL of this deployment, for example `https://coldreach-blue.vercel.app`. OAuth redirect URIs are built from it, and the providers require an exact match with the URIs registered below. |
| `CRON_SECRET` | A long random value. Vercel Cron presents it to `/api/cron/tick`; see DEPLOYMENT.md section 6. |

## 2. Google Cloud OAuth app (Gmail)

1. In the Google Cloud Console, create (or pick) a project.
2. Enable the **Gmail API** for the project. The app also calls the
   OpenID Connect userinfo endpoint to learn the mailbox address,
   which needs no separate API enablement.
3. Configure the OAuth consent screen (APIs & Services, OAuth consent
   screen): user type External for real user mailboxes, app name
   ColdReach, your support email, and the scopes listed in step 5.
4. Create credentials: APIs & Services, Credentials, Create
   Credentials, OAuth client ID, type **Web application**.
5. Scopes the app requests (set at runtime, and they should match the
   consent screen): `openid`, `email`,
   `https://www.googleapis.com/auth/gmail.send`,
   `https://www.googleapis.com/auth/gmail.readonly`.
6. Authorized redirect URI, exactly:
   `{APP_URL}/api/accounts/oauth/google/callback`
   For local development add a second client or URI for
   `http://localhost:3000/api/accounts/oauth/google/callback` (the
   `APP_URL` in your local `.env` decides which one the flow uses).
7. Copy the client ID and secret into the deployment environment as
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then redeploy.

**Verification caveat, stated plainly.** `gmail.send` and
`gmail.readonly` are *restricted* scopes. While the app is unverified,
Google shows an "unverified app" warning and caps usage at 100 test
users added on the consent screen. Production use beyond that needs
Google's OAuth verification, and restricted scopes additionally
require a third-party security assessment (CASA) in most cases. That
process is the owner's to run with Google; ColdReach cannot shortcut
it, and for a single workspace deployment the test-user mode is often
sufficient.

## 3. Microsoft app registration (Microsoft 365)

1. In the Azure portal, go to App registrations and create a **New
   registration**. Name: ColdReach.
2. Supported account types: "Accounts in any organizational directory
   and personal Microsoft accounts" (the app authorizes against the
   `common` endpoint). A single-tenant registration also works if you
   only ever connect mailboxes from your own tenant.
3. Redirect URI: platform **Web**, value exactly
   `{APP_URL}/api/accounts/oauth/microsoft/callback`
4. Under API permissions, add Microsoft Graph **delegated**
   permissions: `Mail.Send`, `Mail.Read`, `openid`, `profile`,
   `email`, `offline_access`. Admin consent is only required if your
   tenant's policies demand it for these scopes.
5. Under Certificates & secrets, create a client secret and copy its
   **value** (shown once).
6. Set the deployment environment: `MS_CLIENT_ID` (the Application
   (client) ID from the registration overview) and
   `MS_CLIENT_SECRET` (the secret value), then redeploy.

## 4. Status: what works when

| Capability | Without OAuth credentials | With credentials set |
| --- | --- | --- |
| Auth, workspaces, roles, invites, workspace switching | Works | Works |
| Lead lists, CSV import, campaigns, sequences, preflight | Works | Works |
| Simulation accounts and campaigns (DEMO labelled) | Works | Works |
| SMTP sending via credentialRef environment variables | Works | Works |
| Webhook event ingestion, unsubscribe enforcement, analytics | Works | Works |
| Deliverability DNS checker and account health cards | Works | Works |
| Gmail / Microsoft 365 connect buttons | Shown as "Not configured" with the missing env vars named | Live connect flow |
| Gmail / Graph sending | Accounts resolve to a plain "not connected" error | Real sends with automatic token refresh |
| Reply sync (automatic in the tick, or per account button) | Nothing to sync | Runs for every connected OAuth account |
| Unified inbox | Shows threads created from recorded events and DEMO flows | Fills with synced replies |

## 5. Local development

The same variables work in `.env`. Set `APP_URL=http://localhost:3000`,
register the localhost redirect URIs from the steps above, generate a
local `ENCRYPTION_KEY`, and the connect flow runs end to end against
real mailboxes you own. Never use a production mailbox for testing
sends you would not want delivered.
