# ColdReach activation runbook

ColdReach ships with every integration built and tested, but the
external services behind them need credentials that only the account
owner can create. This runbook is the exact click-by-click path for
each one. Nothing here requires a code change: you create the
credential in the provider's console, paste it into the deployment's
environment variables, redeploy, and verify.

The Settings page inside the app (Settings, Integrations status)
shows the live state of every integration on this list: Configured,
or Not configured with the exact variable names still missing.
Work through this document top to bottom and watch those rows turn
Configured.

Two rules that apply everywhere below:

- **Never paste a secret into chat, email, or a file in this
  repository.** Secrets go only into the host's environment variable
  settings (Vercel: Project, Settings, Environment Variables,
  Production).
- **Every variable change needs a redeploy before it takes
  effect.** In Vercel: Deployments tab, open the menu on the latest
  production deployment, choose Redeploy. Wait for it to finish
  before verifying.

Working name note: ColdReach is a working name. See TRADEMARK.md
before spending money on branding or a domain.

## 1. Before you start: encryption key and app URL

Two variables underpin everything else and are already set in the
current production deployment; this section is how to check them and
what they do.

1. In Vercel, open the ColdReach project, then Settings,
   Environment Variables. Confirm these names exist for the
   Production environment (values stay hidden; that is correct):
   `ENCRYPTION_KEY` and `APP_URL`.
2. `APP_URL` must be the exact public origin of the deployment, for
   example `https://coldreach-blue.vercel.app`, with no trailing
   slash. Every OAuth redirect URI in this runbook is built from it,
   so if you later add a custom domain you must update `APP_URL`
   first (see the custom domain checklist in DEPLOYMENT.md).
3. `ENCRYPTION_KEY` encrypts stored OAuth tokens at rest. If it is
   ever regenerated, every connected mailbox and CRM connection must
   be reconnected, because the old tokens can no longer be
   decrypted. Treat it as permanent.

Verify: open the app, go to Settings, and find the Integrations
status panel. The "Encryption key" row reads Configured.

## 2. Google OAuth (Gmail)

Goal: owners can connect Gmail accounts for sending and reply sync.
Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

1. Go to console.cloud.google.com and sign in with the Google
   account that will own the app.
2. Create a project: project picker at the top, New Project, name
   it `ColdReach`, Create, then select it.
3. Enable the Gmail API: APIs and Services, Library, search
   `Gmail API`, open it, Enable.
4. Configure the consent screen: APIs and Services, OAuth consent
   screen. Choose External, then fill in: App name `ColdReach`,
   User support email (your address), App logo (optional), App
   domain (your APP_URL origin), Developer contact information
   (your address). Save and continue.
5. On the Scopes step, add exactly the scopes the app requests:
   `openid`, `email`,
   `https://www.googleapis.com/auth/gmail.send`, and
   `https://www.googleapis.com/auth/gmail.readonly`. Save and
   continue through the remaining steps.
6. **Restricted scope caveat, read before going further.** The
   Gmail send and readonly scopes are restricted scopes. While the
   app is in Testing mode, only Google accounts listed as test
   users on the consent screen can connect (add your own address
   under Test users; up to 100). To let arbitrary customers
   connect, Google requires a verification review for restricted
   scopes, which includes a security assessment (CASA) and can
   take weeks. Plan for that before a public launch; nothing in
   the code changes when verification completes.
7. Create the client: APIs and Services, Credentials, Create
   Credentials, OAuth client ID. Application type: Web
   application. Name: `ColdReach web`.
8. Under Authorized redirect URIs, add exactly:
   `{APP_URL}/api/accounts/oauth/google/callback`
   (with your real APP_URL, for example
   `https://coldreach-blue.vercel.app/api/accounts/oauth/google/callback`).
9. Create. Copy the Client ID and Client secret from the dialog.
10. In Vercel, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
    with those values (Production), then redeploy.

Verify: Settings, Integrations status, "Google OAuth (Gmail)" reads
Configured. Then Settings, Sending accounts, Connect Google: the
Google consent screen opens, and after approving, the account
appears as CONNECTED. Complete the production checklist in
section 7 (send yourself a test campaign) before calling this done.

## 3. Microsoft OAuth (Microsoft 365)

Goal: owners can connect Microsoft 365 mailboxes.
Variables: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`.

1. Go to portal.azure.com, App registrations, New registration.
2. Name: `ColdReach`. Supported account types: the app signs users
   in through the `common` endpoint, so choose "Accounts in any
   organizational directory and personal Microsoft accounts" if
   customers will connect their own tenants. Register.
3. On the Overview page, copy the Application (client) ID. That is
   `MS_CLIENT_ID`.
4. Redirect URI: Authentication, Add a platform, Web. Redirect
   URI: `{APP_URL}/api/accounts/oauth/microsoft/callback`.
   Tick ID tokens if prompted, Save.
5. API permissions: API permissions, Add a permission, Microsoft
   Graph, Delegated permissions, and add `Mail.Send`, `Mail.Read`,
   and `offline_access` (plus `openid`, `profile`, `email`, which
   the app also requests). If you administer the tenant, Grant
   admin consent so users are not blocked by a consent prompt.
6. Client secret: Certificates and secrets, Client secrets, New
   client secret, pick an expiry, Add. **Copy the secret Value
   immediately**; it is shown only once. That value is
   `MS_CLIENT_SECRET` (not the Secret ID).
7. In Vercel, add both variables (Production), then redeploy.

Verify: Settings, Integrations status, "Microsoft OAuth (Microsoft
365)" reads Configured. Then Settings, Sending accounts, Connect
Microsoft 365: consent opens and the account lands as CONNECTED.
Complete the checklist in section 7 before calling this done.

## 4. OpenAI API key (or Groq)

Goal: AI subject lines, sequence drafts, icebreakers, and reply
suggestions. Variable: `OPENAI_API_KEY` (required), `AI_MODEL`
(optional, defaults to `gpt-4o-mini`).

Groq alternative (v1.4.0): if you would rather use Groq, skip the
OpenAI steps below and instead create a key at console.groq.com,
then add `GROQ_API_KEY` in Vercel (Production) and redeploy.
Optionally add `GROQ_MODEL` (defaults to `llama-3.3-70b-versatile`).
When both keys exist, OpenAI wins; the Integrations status row
names the provider and model actually in effect.

1. Go to platform.openai.com and sign in. Confirm the account has
   billing set up (Settings, Billing); API usage is billed
   separately from any ChatGPT subscription.
2. Open API keys (left menu, or Settings, API keys), Create new
   secret key. Name it `ColdReach production`. Create.
3. Copy the key immediately; it starts with `sk-` and is shown only
   once. If you lose it, delete it and create another.
4. In Vercel, add `OPENAI_API_KEY` with that value (Production).
   Optionally add `AI_MODEL` with a model name you have access to;
   leave it unset to use the default. Redeploy.

Verify: Settings, Integrations status, "OpenAI" reads Configured
and names the model in effect. Then open any campaign's AI panel
(or a lead's icebreaker action) and generate subject lines: real
suggestions come back instead of the "not configured" notice. The
activation smoke script in section 7 also makes one real subjects
call to prove the key works end to end.

Per-workspace keys (v1.8.0): since v1.8.0, the environment keys
above serve ONLY the platform owner's own workspace, and only when
`PLATFORM_OWNER_EMAIL` is also set (Production) to the workspace
owner's login email. Every other workspace adds its own key in the
product instead: Integrations, AI provider, choose OpenAI or Groq,
paste the key, Save. The key is stored encrypted, is never shown
again, and bills to that workspace's own provider account. A
workspace can replace or remove its key in the same panel at any
time. If `PLATFORM_OWNER_EMAIL` is not set, the environment keys
serve no workspace at all and every workspace, including the
operator's, uses its own saved key.

## 5. Stripe billing

Goal: paid plans with checkout and self-serve plan changes.
Variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_AGENCY`.

Do this in **test mode first** (the Test mode toggle in the Stripe
Dashboard), prove the whole flow, then repeat the product, key, and
webhook steps in live mode and replace the five values.

1. Products: Products, Add product. Create three products whose
   names match the plan catalog in `src/lib/domain/plans.ts`:
   `Starter`, `Pro`, and `Agency`.
2. Prices: on each product, add a recurring monthly price matching
   the catalog: Starter 29 USD per month, Pro 79 USD per month,
   Agency 199 USD per month. Note: these catalog prices are
   placeholder pricing that ships with the app. If you intend
   different real prices, decide them now, create the Stripe prices
   with the real amounts, and update the catalog in
   `src/lib/domain/plans.ts` in the same change, so the pricing
   page, billing page, and Stripe never disagree.
3. Copy each price ID (they look like `price_...`) from the
   product's pricing section.
4. Secret key: Developers, API keys. Copy the Secret key (test
   mode keys start with `sk_test_`; live keys with `sk_live_`).
5. Webhook: Developers, Webhooks, Add endpoint. Endpoint URL:
   `{APP_URL}/api/billing/webhook`. Under events, select exactly
   the three events the webhook handler consumes:
   `checkout.session.completed`, `customer.subscription.updated`,
   and `customer.subscription.deleted`. Add endpoint, then open it
   and reveal the Signing secret (`whsec_...`).
6. In Vercel, add all five variables (Production):
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`,
   `STRIPE_PRICE_AGENCY`. Redeploy.

Verify: Settings, Integrations status, "Stripe" reads Configured.
Open Settings, Billing: the plan cards show Subscribe buttons
instead of the "billing is not configured" notice. Run the test
checkout from section 7.

## 6. Email verification provider (optional)

Goal: stronger list verification verdicts. The built-in checks
(syntax, disposable domains, MX lookup) always run; a provider only
refines them when configured. Variable: `VERIFY_API_KEY`. The
provider implemented in this phase is NeverBounce.

1. Create an account at neverbounce.com and confirm the email.
2. In the NeverBounce dashboard, open Apps or API settings and
   create an API key for server-side use. Copy it.
3. In Vercel, add `VERIFY_API_KEY` (Production). Redeploy.

Verify: open a lead list and click Verify list. The summary line
ends with "Provider checks included." Without the key it reads
"Built-in checks only.", which is the honest unconfigured state,
not an error.

## 7. Production verification checklist

Run this after each activation above, and once end to end before
inviting anyone else in. Every item is something you do in the real
product, not in a console.

- [ ] **Health.** Open `{APP_URL}/api/health` in a browser: it
      returns status `ok` and db `ok`.
- [ ] **Integrations panel.** Settings, Integrations status: every
      integration you activated reads Configured, with no missing
      variable names.
- [ ] **Gmail.** Connect a Gmail account you own (Sending
      accounts). Build a one-lead list containing only your own
      address, a one-step campaign, run preflight, launch, and send
      a worker tick (Campaigns, or wait for the daily cron). The
      email arrives in your inbox; reply to it and confirm the
      reply appears in the Inbox after a sync.
- [ ] **Microsoft 365.** Same flow with a Microsoft mailbox you
      own.
- [ ] **AI.** In a campaign, open AI subjects and generate: real
      suggestions appear. Generate one icebreaker on your own lead
      row.
- [ ] **Stripe (test mode).** From Settings, Billing, subscribe to
      Starter using Stripe's test card `4242 4242 4242 4242`, any
      future expiry, any CVC. Checkout completes, you return to the
      billing page, and the current plan reads Starter once the
      webhook lands (seconds). Then cancel from the billing page
      and confirm the plan returns to Free at period end. Only
      after this passes, repeat section 5 in live mode.
- [ ] **Verification.** Verify list on your test list: your real
      address reads VALID; add a deliberately malformed address to
      see INVALID, which is then skipped if you try to enroll it.
- [ ] **HubSpot (if activated).** Section 8: connect, Sync now, and
      find your test leads as contacts in HubSpot.

### Activation smoke script

With the app running anywhere (production counts), this script
checks the same status endpoints the UI uses and proves the two
paid integrations with one real call each, only when they are
configured. It never sends email.

```bash
# Cookie mode: sign in in a browser, copy the coldreach_session
# cookie value from devtools, then:
ACTIVATE_BASE_URL=https://coldreach-blue.vercel.app \
ACTIVATE_SESSION_COOKIE=<paste the cookie value> \
npx tsx scripts/activate-smoke.ts

# Or API key mode (create a key with billing:read under
# Settings, API keys):
ACTIVATE_BASE_URL=https://coldreach-blue.vercel.app \
ACTIVATE_API_KEY=crk_... \
npx tsx scripts/activate-smoke.ts
```

Two extra proofs are opt-in because they create real provider
objects: set `ACTIVATE_AI_PROOF=1` to make one real AI subjects
call (small OpenAI charge), and set
`ACTIVATE_STRIPE_PROOF=test` to create one Stripe checkout session.
`ACTIVATE_STRIPE_PROOF` is an operator declaration: set it to
`test` only while a test-mode (`sk_test_`) key is configured, so
the script can never create a live-mode session by accident.

## 8. HubSpot CRM sync

Goal: workspace leads pushed to HubSpot as contacts.
Variables: `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`.

1. Go to developers.hubspot.com and sign in (a free developer
   account is enough). Create a developer account if prompted.
2. Create an app: Apps, Create app. Name: `ColdReach`.
3. On the Auth tab: Redirect URLs, add exactly:
   `{APP_URL}/api/crm/hubspot/callback`.
4. Scopes: under Required scopes, add
   `crm.objects.contacts.read` and `crm.objects.contacts.write`.
   Those are the only scopes the app requests.
5. Save. On the Auth tab, copy the Client ID and Client secret.
6. In Vercel, add `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET`
   (Production). Redeploy.

Honest scope of the sync, so you know what you are turning on:
sync pushes this workspace's leads to HubSpot as contacts, creating
or updating by email address, in bounded batches. It does **not**
pull unsubscribes or deletions back from HubSpot, because the
contacts scopes do not expose subscription status changes; the
limitation is recorded on every sync summary and in
INTEGRATIONS.md. ColdReach suppressions remain managed inside
ColdReach.

Verify: Settings, Integrations status, the HubSpot card reads Not
connected (env present) instead of Not configured. Click Connect,
approve in HubSpot, and the card shows the portal ID. Click Sync
now: the summary reports pushed, created, updated, and failed
counts. Open HubSpot, Contacts, and find your leads there.

## 9. cPanel mailbox (your own domain)

Goal: send and sync replies from a mailbox hosted on cPanel (or
any SMTP / IMAP mail server). No environment variables are needed
for the mailbox itself; the one prerequisite is `ENCRYPTION_KEY`
from section 1, because the mailbox password is stored encrypted.

1. In cPanel, create the mailbox under **Email Accounts** if it
   does not exist yet, and set a strong password.
2. Still in cPanel, open **Email Accounts**, pick the mailbox, and
   open **Connect Devices**. Note the exact mail server name and
   ports it lists; use those values in step 4 whenever they differ
   from the defaults below.
3. In the same cPanel session, open **Email Deliverability** and
   confirm SPF, DKIM, and DMARC all read valid for the domain. Fix
   anything it flags before sending a single campaign; sending from
   an unauthenticated domain is the fastest route to the spam
   folder.
4. In ColdReach, open Sending Accounts, Add account: sender email
   is the mailbox address, provider **SMTP / IMAP (cPanel or any
   mail server)**, credential style "Enter mailbox password
   (stored encrypted)". Click **Fill cPanel defaults from email**:
   server `mail.<your-domain>`, SMTP port 465 with TLS on, IMAP
   port 993 with TLS on, username the full email address. The
   STARTTLS alternatives are SMTP 587 and IMAP 143 with the TLS
   boxes off. Replace the server name with the Connect Devices
   value from step 2 if it differs.
5. Enter the mailbox password and click **Test connection**. Both
   SMTP and IMAP should report connected; the messages name the
   failure plainly (authentication failed, host unreachable or
   timed out, TLS or certificate problem, port closed). Do not
   save until both pass: SMTP alone sends but never sees replies,
   and without replies the sequences cannot stop.
6. Save the account. It lands as CONNECTED, and replies sync over
   IMAP inside the worker tick. On the current Vercel Hobby plan
   the tick is the daily 05:00 UTC cron, so replies appear on that
   cadence; the account's "Sync replies" button runs one on
   demand.

Verify: build a one-lead list containing only your own address, a
one-step campaign on the cPanel account, run preflight, launch,
and send a worker tick. The email arrives; reply to it, run Sync
replies on the account, and confirm the reply is in the Inbox and
the enrollment stopped. Then check the Deliverability panel: the
domain's SPF, DKIM, and DMARC grades should all pass.
