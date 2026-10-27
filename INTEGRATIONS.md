# ColdReach Integrations

This guide is for the workspace owner who deploys ColdReach. Sections
1 to 5 cover the one-time console work that lets users connect real
Gmail and Microsoft 365 mailboxes: creating the OAuth apps, setting
the environment variables, and what switches on when they are in
place. Sections 6 to 8 cover the Phase 4 integration surfaces:
outbound webhooks with Zapier and Make recipes, the CRM note, AI
assistance, and Stripe billing.

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
| Public API (`/api/v1`) and outbound webhooks | Work (keys and endpoints are created in the app; no credentials needed) | Work |
| AI assistance (subject ideas, rewrite, icebreakers) | "AI is not configured" naming `OPENAI_API_KEY` | Live, with the model from `AI_MODEL` (default `gpt-4o-mini`) |
| Stripe checkout and customer portal | Billing page shows plan and usage with a manual owner override | Checkout and portal buttons go live |

## 5. Local development

The same variables work in `.env`. Set `APP_URL=http://localhost:3000`,
register the localhost redirect URIs from the steps above, generate a
local `ENCRYPTION_KEY`, and the connect flow runs end to end against
real mailboxes you own. Never use a production mailbox for testing
sends you would not want delivered.

## 6. Outbound webhooks, Zapier, and Make (Phase 4)

Outbound webhooks push campaign outcomes to any HTTPS endpoint the
moment they are applied. Configure them in the app under
**Integrations, Outbound webhooks**:

- The endpoint URL must be HTTPS (plain HTTP is accepted only for
  `localhost`, for development). Pick any of DELIVERED, REPLIED,
  BOUNCED, UNSUBSCRIBED, COMPLAINED. SENT is never pushed; it is
  high volume and available through the API and analytics instead.
- The endpoint secret is shown exactly once at creation and stored
  encrypted (same AES-256-GCM helper as OAuth tokens, so webhook
  endpoints need `ENCRYPTION_KEY` set).
- Every delivery is a POST with a JSON body
  (`{ event, workspaceId, occurredAt, data: { enrollmentId, leadId,
  campaignId, sendingAccountId, stepIndex, providerMessageId,
  classification } }`) and two headers: `X-ColdReach-Event` and
  `X-ColdReach-Signature`, the hex HMAC-SHA256 of the raw body keyed
  by the endpoint secret. Verify the signature before acting on a
  delivery.
- A 2xx response marks the delivery DELIVERED. Anything else retries
  after 1 minute, 5 minutes, 30 minutes, and 2 hours, then stops at
  5 attempts. The worker tick processes due deliveries, and the
  settings page shows the recent delivery log. The **Send test**
  button pushes a `{ "event": "test", ... }` payload through the
  exact same path so you can verify an endpoint before real events
  flow.

**Zapier recipe (reply alerts and CRM updates).** Create a Zap with
the *Webhooks by Zapier* trigger, "Catch Hook", and paste its URL
into a ColdReach webhook endpoint subscribed to REPLIED. Add a
Filter step on `event` equals `REPLIED` if the endpoint receives
other types too, then attach any action Zapier supports: post to
Slack, create or update a HubSpot or Salesforce contact, append a
row to Google Sheets. To write back into ColdReach (for example,
adding leads captured by a form tool), use a Webhooks by Zapier POST
action against the public API with an `Authorization: Bearer`
header and a key holding `leads:write` (see API.md).

**Make recipe.** Create a scenario starting with a *Webhooks, Custom
webhook* module, paste its URL into a ColdReach endpoint, and route
on the `event` field with Make's router. For outbound calls into
ColdReach, use the *HTTP, Make a request* module with the same
Bearer key header.

## 7. CRM note (HubSpot, Salesforce)

**Updated in Phase 6:** ColdReach now has a native HubSpot sync,
documented in section 10 below. There is still **no native
Salesforce connector**, and ColdReach does not claim one: for
Salesforce, sync runs through the surfaces above, outbound webhooks
into Zapier or Make (which maintain their own Salesforce connector),
or direct calls to the public API from your own integration code.

## 8. AI assistance (Phase 4, credential gated)

Subject ideas in the sequence builder, body rewrites (shorter, more
direct, friendlier presets or a custom instruction), and per-lead
icebreakers run through an `AiProvider` interface. The bundled
provider is OpenAI over plain HTTPS calls:

| Variable | Value |
| --- | --- |
| `OPENAI_API_KEY` | An OpenAI API key with chat completions access |
| `AI_MODEL` | Optional. Defaults to `gpt-4o-mini` |

Without `OPENAI_API_KEY`, every AI endpoint returns `501` naming the
missing variable and the UI panels show "AI is not configured",
exactly like the OAuth pattern above. AI output is never applied
automatically: subject ideas and rewrites land only when the user
clicks Apply, and icebreakers are stored on the lead visibly marked
as AI generated for review. The prompts forbid invented facts about
the recipient, fake familiarity, and any spam-filter evasion content.

## 9. Stripe billing (Phase 4, credential gated)

Plans and quotas work without Stripe: every workspace starts on the
FREE plan, usage is counted from real send events, and the workspace
OWNER can set a manual plan override on the Billing page (labelled
as the pre-Stripe override and written to the audit log). Stripe
turns on self-serve checkout and the customer portal:

1. In the Stripe dashboard, create one **Product** per paid plan
   (Starter, Pro, Agency) each with a recurring monthly **Price**.
   The amounts are yours to set; the prices in the app's plan catalog
   are placeholders until you do.
2. Copy the three price IDs into the deployment environment as
   `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, and
   `STRIPE_PRICE_AGENCY`, and the secret key as `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint in Stripe (Developers, Webhooks) pointing
   at `{APP_URL}/api/billing/webhook`, subscribed to exactly:
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Copy its signing secret into
   `STRIPE_WEBHOOK_SECRET`.
4. Redeploy. The Billing page now shows checkout buttons per plan
   and a "Manage subscription" portal button for paying workspaces.
   Checkout completion applies the purchased plan, subscription
   updates sync status, period end, and `cancel_at_period_end`, and
   a deleted subscription returns the workspace to FREE, all on the
   workspace's Subscription row from the webhook.

Without these variables the billing endpoints return `501` naming
what is missing, and the Billing page says so plainly while still
showing the current plan and real usage.

## 10. HubSpot CRM sync (Phase 6, credential gated)

ColdReach can push each workspace's leads to HubSpot as contacts,
through the workspace's own HubSpot connection. The full owner
runbook (creating the HubSpot app, scopes, redirect URL) is
ACTIVATION.md section 8; the short version:

1. In a HubSpot developer account, create an app named ColdReach.
2. On the app's Auth tab, add the redirect URL
   `{APP_URL}/api/crm/hubspot/callback` and exactly two required
   scopes: `crm.objects.contacts.read` and
   `crm.objects.contacts.write`.
3. Copy the client ID and client secret into the deployment
   environment as `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET`,
   and redeploy.
4. In the app, Settings shows a HubSpot card in the Integrations
   panel. An admin clicks Connect, approves in HubSpot, and the
   connection is stored on the CRM Connections row for the
   workspace: tokens encrypted at rest with the same AES-256-GCM
   helper as mailbox OAuth, plus the HubSpot portal ID.

**What sync does.** Sync now (Settings, HubSpot card) walks the
workspace's leads in batches of 100 and upserts each one as a
HubSpot contact by email address: search by email, update when a
contact exists, create when it does not. Mapped properties are
email, first name, last name, company, phone, and job title (from
the lead's fields, including the `first_name`, `organization`, and
`role` import aliases). The result counts (pushed, created,
updated, failed, with the first error kept) are stored on the
connection as the last sync summary and shown on the card.

**What sync does not do, stated plainly.** It does not pull
unsubscribes, bounces, or contact deletions back from HubSpot into
ColdReach suppressions. The two contacts scopes granted above do
not expose subscription status changes, so rather than inventing a
pull, the limitation is recorded in every sync summary and here.
Manage suppressions inside ColdReach (they are enforced on every
send), or in both systems by hand.

Without the two environment variables the HubSpot card and the CRM
endpoints name them as missing (501), exactly like the mailbox
providers. There is no Salesforce sync; see section 7.

## 11. Email verification provider (Phase 6, optional)

Lead list verification (Leads, a list, Verify list) always runs the
built-in checks server side: strict syntax validation, a bundled
partial disposable-domain list, and an MX lookup over DNS that
degrades to UNKNOWN when DNS cannot answer. Setting
`VERIFY_API_KEY` adds the NeverBounce single check API on top: each
syntactically valid address is refined by the provider's verdict
(valid, invalid, disposable, catchall, unknown), stored in the
lead's verification detail alongside the built-in evidence. Without
the key, verification still works and the summary says "Built-in
checks only." Provider outages never fail a verification run; the
error is recorded in the detail and the built-in verdict stands.
See ACTIVATION.md section 6 for signup steps.
