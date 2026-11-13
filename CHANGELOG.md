# Changelog

## Unreleased

- Operations note (2026-11-10): Resend transactional mail was
  enabled in the production configuration (RESEND_API_KEY and
  PRODUCT_MAIL_FROM saved in Vercel Production, domain
  send.aamirtechs.com verified in Resend). Support ticket
  notifications to the support inbox and signup verification
  emails now send through Resend. No code change in this entry;
  it exists to trigger the redeploy that loads the new
  environment variables.
- Operations note (2026-11-10): the product mail From address
  was corrected to the Resend-verified send subdomain
  (PRODUCT_MAIL_FROM now uses an @send.aamirtechs.com address;
  only send.aamirtechs.com is verified in Resend, so sends from
  the root domain were rejected). No code change in this entry;
  it exists to trigger the redeploy that loads the corrected
  variable.

## 1.27.0 (2026-11-13)

Four operator requests in one release.

1. The follow-up open gate is now a per-campaign switch. Campaign
   Settings gains "Follow-ups only to leads who viewed the previous
   email" (stored as Campaign.requireOpenForFollowUps, default on,
   so every existing campaign behaves exactly as before). Turning
   it off sends step 2 and later to every lead on schedule. The
   gate's stored reason now uses the Viewed wording and points at
   the Settings switch, and the campaign page explains the rule's
   state for that campaign. Prod migration
   0016_campaign_open_gate_toggle.

2. Email opens are labelled Viewed everywhere a person reads them:
   the dashboard card, Outbox badges and filter (Viewed, Not
   viewed, Auto-view), campaign and analytics Views figures, the
   admin summary, and the landing page. The word Open now belongs
   to thread and ticket status only (a conversation that is still
   Open), which removes the mix-up between the two meanings.
   Internal event types are unchanged.

3. Reply filters learned from the current inbox. Two new
   classifications split out of the machine bucket: TICKET
   (helpdesk receipts and numbered ticket subjects such as
   "[Ticket #11520]", Freshdesk and Zendesk receipt wording) and
   NOT_FOUND (delivery failure notices: "Undelivered Mail Returned
   to Sender", "Address not found", "user unknown", 5.1.1). Both
   count as non-human in reply metrics alongside AUTOMATED, the
   inbox classification filter and the manual override list carry
   them, Humans only hides all three, and the re-run pass (the
   Re-run reply filters button) now applies TICKET and NOT_FOUND
   even to threads wearing a POSITIVE mislabel, which is how the
   October undelivered notices once posed as interest.

4. Cross-campaign duplicates now skip instead of blocking.
   Enrolling a list no longer refuses the whole enroll with a 409
   when some leads already sit in another campaign: those leads
   are skipped, counted as skippedCrossCampaign, and listed with
   the campaign that holds them, while the rest enroll normally.
   Matching is by lowercased email as well as by lead row, so a
   case-variant duplicate row in another list is caught too.
   Suppressed leads were already skipped at enroll and still are;
   the enroll notices in Campaign actions and Settings now report
   every skip reason including the new one. An Enroll these anyway
   override remains for deliberate double outreach.

## 1.26.1 (2026-11-13)

Lead search also matches the icebreaker text. The live check of
1.26.0 found the one gap in the new search: searching the
Outbox or a lead list for a person by name failed whenever the
lead carried no name fields, which is most inbox style leads
(corporate@, info@, hello@ addresses). For the traced lead
corporate@cacaoandcardamom.com, the person, Annie Rupani, is
named only inside the icebreaker line, so a name search had
nothing stored to match. The shared lead search helper now
includes the icebreaker field in its haystacks, so a name that
appears in the icebreaker finds the lead in both Leads and the
Outbox. One new test covers exactly that case.

## 1.26.0 (2026-11-13)

Search by name, email, or company in Leads and in the Outbox.
Both searches only matched the email address before: the lead
list had a "Search email" box, and the Outbox had no text search
at all, so finding a send meant already knowing the exact
address. A shared lead search helper now matches the query
(case-insensitively) against the email, the first and last name,
the full name, and the company, reading field keys
case-insensitively because CSV imports carry both `company` and
`Company` style headers. Name and company live in the leads'
fields JSON, which cannot be substring searched portably across
SQLite and Postgres with one query, so the lead list page and
the leads API scan a bounded window and filter with the helper,
the same pattern the tag filter has always used. The Outbox
gains a search box on its filter bar: a search scans the
workspace's leads with the helper, loads the matching leads'
sends, and merges in a direct recipient email match; Outbox
cards now also print the recipient's company and name beside
the address, so a match can be confirmed at a glance. The CSV
importer also gains icebreaker as a first class mapping target:
it joins firstName, lastName, and company in the wizard's target
list, and the header guesser now recognises "icebreaker",
"Ice Breaker", "ice_breaker", "Opening Line", and similar
spellings automatically, so an opening line column lands in the
icebreaker field (the one the {{icebreaker}} token reads)
without depending on a custom field workaround. No sending
behaviour changes in this release.

Also documented from a production trace the same day (no code
change): a step 2 send that disappears from Upcoming sends with
no Outbox entry and no change to the sent count was completed
by the open gate, not lost. The worker sends steps 2 and later
only to leads who opened the previous step (v1.17.0); a due
follow-up whose previous step shows no human open is completed
with the reason stored on the enrollment ("Follow-up not sent:
the lead did not open the previous email"). The traced lead
(corporate@cacaoandcardamom.com, VA - Ecommerce Store Support)
had its step 1 sent on 2026-11-10 with no recorded open, and
its enrollment was completed by the gate on 2026-11-13 at
16:16 UTC, exactly when it left Upcoming sends. The same trace
verified the sending pipeline itself is healthy: in the last 24
and 48 hours every SENT event had its Outbox copy (49 of 49 and
50 of 50, gap zero), and 280 enrollments were completed by the
open gate on 2026-11-13 alone, 1,872 in total to date.

## 1.25.1 (2026-11-12)

Exact send times beside the relative labels in the Outbox. A
"Due now" row that left on the next tick appeared in the Outbox
as "1 hr ago" with the precise moment hidden behind a hover,
which read as if the send might not have happened or counted.
The send time, the opened time, and the auto-open time on every
Outbox card now print the exact moment next to the relative
label, in the viewer's timezone (for example "1 hr ago ·
13 Nov 2026, 01:00"). No sending or counting change: a
production check the same evening matched every SENT event of
the last 24 hours to its Outbox copy, 27 of 27, and no send
since 29 Oct 2026 is missing from the Outbox. The only all-time
gap remains the 54 sends of 28 Oct 2026 that predate Outbox
recording (fixed in v1.8.1); their bodies were never stored.

## 1.25.0 (2026-11-12)

Support ticket replies and internal notes. The platform admin
ticket panel could change a ticket's status but had no way to
answer it, so replies had to leave the product (drafted in chat,
sent from a mailbox) and the ticket itself never carried the
answer. A ticket now has a thread:

- New SupportTicketReply model (prod migration 0015): ticket,
  author, kind (REPLY or NOTE), body, an emailedAt stamp, and a
  created timestamp, cascading with its ticket.
- The ticket detail in Platform Admin shows the thread and a
  composer. A REPLY is emailed to the ticket's reporter through
  the product mail path (Resend) and stamped emailedAt, unless
  the author clears the email checkbox; the panel then shows
  "Emailed to the customer" or "Not emailed" on the entry. A
  NOTE is internal and is never emailed.
- The email is best effort, like ticket creation: a failed or
  unconfigured send never blocks the save, it just leaves the
  entry unstamped so the gap is visible.
- New platform-owner-only thread endpoint under the admin
  support tickets API, with an audit row per entry.

## 1.24.0 (2026-11-12)

Per-workspace hourly send cap, requested by a tenant whose mail
host allows 60 sends per hour while the platform default is 90:
bursts inside that gap went out, were accepted, and were then
discarded by the host while counting as sent here.

- New optional Workspace setting, "Max sends per hour"
  (Settings, workspace and sender identity card). When set, the
  send worker measures the workspace's hourly sends against
  that ceiling instead of the platform default; when empty, the
  platform default (90, or the HOURLY_SEND_CAP environment
  override) applies exactly as before. The setting can sit
  below or above the default, so it serves hosts with stricter
  and with higher limits alike.
- The counting does not change: sends are still counted per
  sending domain across every workspace in any rolling 60
  minutes (v1.21.0), so two workspaces sharing one domain
  cannot each stay under a ceiling while their combined volume
  breaches the host's. Only the ceiling becomes per-workspace.
- Stored as a nullable integer on the workspace (migrations
  20261112213000 for SQLite, 0014 for Postgres), validated by
  the workspace API as a whole number from 1 to 10000 or null,
  and re-validated in the worker, which falls back to the
  platform cap for any missing or non-positive stored value.
- Tests: a resolver unit test in the pacing suite, and a worker
  test running one tick across two workspaces, one capped at 2
  with its hour already spent (its send defers) and one capped
  at 500 with 95 sends already in its hour, over the platform
  default (its send goes out).

## 1.23.1 (2026-11-12)

Fixes the second, larger half of the 2026-11-12 sending stall:
an overnight sending window that the scheduler could not
satisfy, whose error then killed every worker tick on the
platform.

- Overnight windows. A campaign window whose end is at or
  before its start (in production: 05:00 to 00:00, America/New
  York, business days only, on one tenant's campaigns) is now
  read as running past midnight, so a 00:00 end means the end
  of the day that started at 05:00. Before this fix the
  scheduler read the end as the start of the same day, closing
  before it opened: no instant could satisfy it, and
  computeNextSendAt threw "could not find a slot within 366
  days" for every one of the tenant's 1,235 due enrollments.
  Early-morning instants are checked against the previous day's
  window tail, and business days still attach to the day the
  window opens. Verified against production data: replaying
  all 1,531 due enrollments through the fixed scheduler throws
  for none of them (was 1,235).
- Tick quarantine. The schedule gate in the send worker now
  catches a computation error per enrollment instead of letting
  it escape and abort the whole tick. The enrollment is parked
  for 24 hours with the reason recorded on it and counted in
  the tick summary as "quarantined"; every other campaign
  proceeds. On 2026-11-12 this missing guard is what turned one
  tenant's window setting into a platform-wide sending outage
  lasting hours, with no sends, no failures, and no log line
  anywhere in the product pointing at the cause.
- Tests. Seven new scheduler cases pin the overnight behaviour
  (inside window, pre-open snap, the Friday-to-midnight close,
  weekend moves, and a true 17:00 to 02:00 overnight), and a
  new worker test proves a tick completes and sends for healthy
  campaigns while quarantining an enrollment whose schedule
  cannot be computed.

## 1.23.0 (2026-11-12)

Fixes a silent sending stall: a workspace with due emails could
be starved indefinitely by another workspace's backlog, with no
sends, no failures, and nothing in any log or dashboard to show
why.

- Fair due pool fetch. The send worker built each tick's batch
  from one global oldest-first window: the 1,000 oldest due
  enrollments across the whole platform. When one workspace
  accumulated a backlog of about 1,235 due enrollments stamped
  over two hours, 1,199 due enrollments platform-wide carried
  older stamps than another workspace's earliest due item, so
  that workspace's campaigns never entered the fetched window
  at all. Its sends stopped for hours while the backlogged
  workspace kept sending, and because the starved enrollments
  were never fetched, nothing about them was recorded anywhere.
  The pool is now fetched per campaign (each running campaign
  contributes its own earliest due enrollments, up to the batch
  size with a floor of 50), and the existing round-robin
  interleave then shares the batch across campaigns as designed
  in v1.8.1. Every campaign with due work is now represented in
  every tick.
- Regression test. A new send worker test parks a backlog of
  older-stamped enrollments in one campaign, larger than the old
  global window could hold at the test's batch size, and proves
  a newer-stamped campaign still sends in the same tick. The
  test fails against the old fetch and passes against the new
  one.
- No schema change, no migration, no setting change. Sending
  windows, pacing caps, per-workspace tick ceilings, and the
  open-gated follow-up rule are all unchanged.

## 1.22.1 (2026-11-10)

Completes the support ticket workflow in the platform admin
panel: tickets can now be opened and worked, not just closed.

- Three ticket statuses. Alongside Open and Closed, a ticket can
  be Under Process. Statuses are stored as OPEN, UNDER_PROCESS,
  and CLOSED on the existing free-text column, so no migration
  was needed and existing tickets are untouched. One shared
  label map renders them as Open, Under Process, and Closed in
  the admin panel and on the customer's Support page alike.
- Admin ticket detail. Clicking View details on a ticket in the
  Platform Admin support section opens it in place, showing the
  complete message body, the reporter's email, the workspace
  name and id, the category, and the created and last updated
  times. The admin list endpoint now includes the full message
  and workspace name for every ticket.
- Status control. A select on each ticket row sets any of the
  three statuses through the admin endpoint, which validates
  against the same status set and writes a support.ticket.status
  audit entry for every change. The owner-only gate is unchanged.

## 1.22.0 (2026-11-10)

In-app support. A Support entry joins the sidebar (and the mobile
More sheet, from the same navigation list), opening a Support page
with contact options and a ticket form, and every ticket is
guaranteed to reach the platform owner even when email is not
configured.

- Support page and ticket form. The form takes a subject, a
  category (Sending problem, Billing, Account and login, Feature
  request, Something else), and a message. The reporter's email,
  workspace name, and workspace id are attached server-side from
  the session, never from the request body, and the page lists the
  workspace's own tickets with their status. The page also shows
  a WhatsApp contact link with a prefilled greeting and the
  support email as a mailto link.
- SupportTicket model and delivery. New SupportTicket table (dev
  migration 20261110120000_support_tickets, prod migration 0013).
  Creation always persists the ticket first, then attempts a
  notification email to the support inbox (SUPPORT_EMAIL, default
  amir@aamirtechs.com) through the product mail path, with
  Reply-To set to the reporter's email so a reply goes straight
  back to them. When Resend is not configured or the send fails,
  the ticket still saves, the failure is logged, and nothing about
  it is surfaced to the user as an error. Creation is rate limited
  to 5 tickets per user per hour and writes an audit log entry.
- Platform admin visibility. The Platform Admin page gains a
  Support tickets section (newest first, with an OPEN and CLOSED
  toggle backed by a platform-owner-only API that answers 404 to
  everyone else), so no ticket is ever lost when the notification
  email cannot send.
- Product mail can set Reply-To. sendProductEmail accepts an
  optional replyTo, passed through to Resend as reply_to.

## 1.21.0 (2026-11-10)

Scheduler fixes, from a customer report with four symptoms: one
campaign never sent at all, sends landed on weekends and at night
despite a business-days setting, sends stopped mid-morning with
the window still open, and a mail host discarded accepted mail
past its hourly limit. Three of the four were product bugs; the
fourth was a pacing scope bug plus a configuration lesson. No
schema change.

- Stranded enrollments recover. Enrolling a campaign before its
  first sequence step existed stamped those enrollments with a
  null send time, and the worker's due filter (nextSendAt at or
  before now) can never match null, so the campaign showed
  correct settings and sent nothing, forever. The due pool now
  includes null stamps, and the schedule gate stamps them under
  the campaign's current schedule on first sight: inside the
  window they send in the same pass, outside it they take the
  next opening. Existing stranded campaigns heal themselves on
  the first tick after this release, no operator action needed.
- Stamps are revalidated against the current schedule. A stamp
  was computed under the settings in force when it was made, and
  later schedule edits never re-stamped it; the only send-time
  check covered leads whose timezone differed from the
  campaign's. A stamp made before business-days-only was switched
  on, or under a wider window, still fired on a Saturday or late
  at night. Every stamp is now checked against the campaign's
  current window and business-days rule, in the lead's timezone
  when one resolves and the campaign's otherwise, and a stamp
  that no longer fits moves to the next valid opening. A stamp
  that does fit still sends when a tick finds it due, even if
  the tick runs late (the v1.5.0 late-delivery rule is kept).
- The per-tick send ceiling is per workspace. It was one global
  counter for the whole tick, so the first workspaces processed
  consumed the entire platform budget (20 real sends per tick
  across every tenant) and later campaigns were deferred tick
  after tick, a starvation that looked like a mid-morning stop.
  Each workspace now gets its own ceiling per tick.
- The rolling hourly cap is counted per sending domain. The
  mail host's hourly limit is per domain, but the cap was
  counted per workspace: two workspaces on one domain (or one
  workspace plus mail sent outside ColdReach) could each stay
  under the cap while the domain total breached the host's, and
  the host discarded the excess after accepting it, so it was
  recorded as sent. The worker now counts the last hour's real
  sends by the domain of the account that would send, across all
  workspaces, and skips capped candidates in favour of accounts
  on quieter domains. Simulated sends (provider message ids
  starting with "demo-") are excluded from the count, as the
  pacing rules always intended. One honest limit stands: mail a
  server accepts and then silently discards cannot be detected
  by any sender, so pacing under the domain cap is the fix, not
  detection.

## 1.20.1 (2026-11-06)

Machine-open filter follow-through, from the live verification of
1.20.0.

- Backfill. Opens recorded before 1.20.0 carried no classification,
  so the filter could not see them (live check: first-step emails
  opened 52 to 56 seconds after sending, still badged Opened). The
  worker tick now stamps a bounded batch of historical opens per
  tick with their verdict (backfillMachineOpens in openTracking.ts:
  MACHINE inside the 60 second window, HUMAN outside it), before
  the follow-up gate reads them. The pass is best effort and can
  never block sending, and once history is stamped it finds
  nothing left to do.
- Outbox honesty. Open matching is per enrollment, so the earliest
  open can belong to an earlier step than the message on screen.
  The opened time is now shown only when it falls after that
  message's own send, so a displayed time always describes the
  email it sits next to.

## 1.20.0 (2026-11-06)

Machine-open filter, built after a day where every sent email showed
as Opened (29 of 29, all machine prefetch).

- Classification. The open tracker (src/lib/worker/openTracking.ts)
  compares each open against its step's send time. An open recorded
  within 60 seconds of the send is classified MACHINE on the OPENED
  event (Apple Mail Privacy Protection and security scanners load
  the pixel on delivery, before any human could read). No schema
  change: the flag rides the event's classification field, the same
  mechanism AUTOMATED replies use.
- Metrics. Machine opens are excluded from every open figure:
  campaign metrics and analytics (src/lib/domain/metrics.ts), the
  dashboard Opened card, and the platform admin totals.
- Follow-up gate. A machine open no longer satisfies the open-gated
  follow-ups rule in the worker; the enrollment completes with a
  reason that says only an automatic open was recorded, so machines
  stop deciding who gets follow-ups.
- Outbox. Human opens keep the Opened badge and now show when the
  open happened next to it. Machine-only opens show a muted
  Auto-open badge with its time, and the Not opened filter treats
  them as not opened, because the lead never opened anything.

## 1.19.0 (2026-11-06)

Per-step file attachments for campaigns, requested by Amir, with his
hard cap of 1 MB per file.

- Attachments per step. The sequence builder gains an Attachments
  panel on every step (src/components/campaigns/
  StepAttachmentsPanel.tsx): upload, download, and remove files
  without leaving the step. Files save immediately and belong to the
  step number, so they survive sequence saves, which replace step
  rows wholesale; the panel warns that reordering steps keeps files
  with the step position. Allowed formats are documents and images
  only (PDF, Word, Excel, PowerPoint, PNG, JPG, GIF, WebP, TXT,
  CSV), at most 3 files per step and 1 MB per file, enforced by
  src/lib/attachments.ts on the server, never trusting the client.
- Storage and API. Bytes live in the database in a new
  StepAttachment table (dev migration 20261106174725, prod migration
  0012), so no external storage service is needed. Routes under
  /api/campaigns/[id]/step-attachments list metadata, accept
  multipart uploads, download bytes, and delete, all scoped to the
  signed in workspace, and edits are refused while a campaign is
  RUNNING or ARCHIVED, matching the sequence rules. Uploads and
  removals are audit logged.
- Sending. The worker loads a step's files once per campaign and
  step per tick and passes them through the provider contract
  (SendInput.attachments): Nodemailer on SMTP, multipart/mixed MIME
  on Gmail, and fileAttachment entries on Microsoft Graph. A worker
  integration test proves step 1 sends carry only step 1 files.
- Preview and preflight. The Upcoming sends preview lists the exact
  attachments that will ride on the send (name and size), and
  preflight warns when step 1 carries attachments (a classic spam
  signal on a first cold email) while passing follow-up attachments
  with a summary.

## 1.18.0 (2026-11-05)

ColdReach is now an installable PWA, with the mobile navigation to
match, requested by Amir.

- Installable app. A web app manifest (src/app/manifest.ts, data in
  src/lib/pwa.ts) gives ColdReach a name, standalone display,
  theme colors, and PNG icons rendered from the existing app
  artwork by generated routes under /icons (src/lib/iconImage.tsx):
  192 and 512, a full bleed maskable 512, and a 180 Apple touch
  icon. The root layout exports a proper
  viewport (device width, viewport fit cover, per scheme theme
  colors) and Apple web app metadata. Chrome and Android offer a
  real install, iPhone users get an install card inside the app
  explaining Share, then Add to Home Screen, and a dismissal is
  honored for 30 days.
- Service worker (public/sw.js, registered in production by
  PwaRegister). It precaches only the public offline page and the
  icons, cache firsts fingerprinted static assets, and answers a
  failed navigation with the offline page. Privacy rule, pinned by
  tests: API traffic is never intercepted and no signed in page is
  ever cached, because a cache hit on a shared device could leak
  one workspace's data to another. next.config.ts serves /sw.js
  with no cache headers so updates land, and the icons immutable.
- Mobile navigation. The desktop sidebar hides below the md
  breakpoint and, until now, nothing replaced it on phones. A
  bottom tab bar (Dashboard, Campaigns, Inbox, Outbox) plus a More
  sheet with the remaining destinations and Compose now covers
  every sidebar destination, with safe area padding and active
  states. Main content carries bottom padding on small screens so
  the bar never covers it.
- Responsive tables. The wide tables that squeezed on phones now
  scroll horizontally inside their cards with sensible minimum
  widths: campaigns, lead lists, sending accounts, enrolled leads,
  suppressions, team members and invitations, and the webhook
  delivery log.

## 1.17.0 (2026-11-04)

Three changes requested by Amir.

- Country flags are real icons now, not emoji. Windows renders
  flag emoji as the two plain letters (a US flag showed as the
  text "US"), so Upcoming sends and the preview modal now use the
  bundled flag-icons SVG set through a CountryFlag component.
  Font Awesome, which Amir suggested, ships no per-country flags,
  only a generic flag icon. The country label also always shows
  the full country name instead of the raw imported value, so a
  lead imported with country "US" reads "United States" next to
  its flag and timezone.
- Follow-ups are open-gated. Step 2 and later now send only to
  leads who opened the previous step, checked in the sending
  worker against the recorded OPENED event for the previous step
  index. A due follow-up with no recorded open completes the
  enrollment instead of sending, with the reason stored on the
  enrollment, and the tick summary counts it as skippedNotOpened.
  Two exemptions: a previous step sent before open tracking existed
  (v1.9.0, 2026-10-28 16:23 UTC) carried no pixel, so no open
  could ever be recorded; those legacy follow-ups still send. And
  a step whose send is already recorded (crash recovery) is never
  gated; it advances as before.
  The campaign page states the rule and the standing caveat that
  opens are approximate (prefetching invents some, image blocking
  hides real ones).
- Inbox and Outbox times are relative: "just now", "5 mins ago",
  "3 hrs ago", "2 days ago", falling back to the absolute date at
  a week old. Shown in the inbox list, in thread messages and
  notes, and on every Outbox card, through a shared RelativeTime
  component (formatRelativeTime in src/lib/relativeTime.ts) that
  refreshes every minute and keeps the exact timestamp as the
  hover title.

## 1.16.0 (2026-11-04)

Five dashboard and campaign fixes requested by Amir.

- Upcoming sends now lists the next 50 sends (was 8), in a
  scrollable panel, soonest first.
- Every Upcoming sends row has a Preview email button. It opens the
  exact email that will be sent to that lead: subject and complete
  plain-text body with signature and compliance footer, rendered by
  renderEmailCopy in src/lib/campaigns/previewEmail.ts, the same
  function the sending worker now uses, with the lead's real fields,
  A/B variant, spintax, campaign identity, and unsubscribe link
  (GET /api/enrollments/[id]/preview). Editing the sequence,
  signature, or lead after previewing changes the send, and the
  preview says so.
- Every Upcoming sends row shows the lead's country flag and country
  (plus state when imported) next to its resolved timezone
  (resolveLeadCountry in leadTimezone.ts; a US state with no country
  counts as the United States).
- Campaigns can be deleted from the UI: a Delete button on every
  campaigns list row and a Danger zone on the campaign detail page,
  both with a two-step confirmation naming what is removed (the
  campaign, its steps, and its enrollments) and what stays (leads,
  and past sent and reply history in workspace totals and the
  inbox). The DELETE API already existed and still refuses RUNNING
  campaigns with 409: pause first, then delete.
- Live sending cards for Emails sent, Opened, and Replied show a
  "+N new since your last check" badge when the count has grown
  since this browser last saw it. The baseline is kept per workspace
  and metric in localStorage, so the badge appears on the next
  refresh or the next sign-in on the same browser, and that visit
  becomes the new baseline. The first visit sets the baseline and
  shows nothing.

## 1.15.2 (2026-11-04)

Fix: dashboard rendering crash (and a sending stall) caused by two
invalid IANA timezone names in the lead timezone map.

- The country map carried GE as "Europe/Tbilisi" and AM as
  "Europe/Yerevan". Neither zone exists; the real zones are
  Asia/Tbilisi and Asia/Yerevan. Mapped zones were returned without
  validation, so once a lead from Georgia entered the running
  campaigns' due queue (the WordPress Bug Fixes & Repair campaign
  was resumed on 2026-11-04), the dashboard's schedule panel threw
  "RangeError: Invalid time zone specified: Europe/Tbilisi" and the
  whole dashboard rendered the error page. The same bad value could
  abort the sending tick's timezone re-stamp for that enrollment.
  While the campaign was paused the record was dormant, which is
  why the crash appeared exactly on resume.
- Map corrected (GE to Asia/Tbilisi, AM to Asia/Yerevan).
- resolveLeadTimezone now validates every mapped zone with
  isValidTimezone before returning it; an invalid entry resolves to
  null (the campaign timezone fallback) instead of a crash.
- The dashboard's formatInZone helper falls back to UTC instead of
  throwing, so a display value can never take down the page.
- Regression tests sweep every value in the country and US state
  maps through Intl validation, and pin Georgia and Armenia to
  their Asia zones.
- The v1.15.1 diagnostic route is retired: it now returns 404.

## 1.15.1 (2026-11-04)

Temporary diagnostic release, no behaviour change.

- Adds an OWNER-only diagnostic route, GET /api/diag/dashboard, that
  re-runs the dashboard page's data steps in isolation and reports
  which one throws. Added to find the root cause of the dashboard
  rendering error (production digest 2624295446) reported on
  2026-11-04 after a campaign resume. This route is removed in the
  fix release that follows.

## 1.15.0 (2026-11-01)

Account deletion with a full, explicit warning.

- Settings gains a Danger zone. Deleting an account requires the
  account password plus typing DELETE, and the confirmation panel
  lists exactly what will be destroyed: each solely owned workspace
  by name with its campaign, lead, and sending account counts, and
  a warning that all campaigns, leads, enrollments, sequences, and
  sent and received emails in them are permanently deleted.
- Shared workspaces are never deleted under their other members:
  the departing user is removed from them and they keep running.
- A tombstone audit row records the deletion before the cascade
  runs; the session is cleared on success. Rate limited like the
  other auth endpoints.

## 1.14.0 (2026-11-01)

Email verification for new signups, via Resend.

- **Product mail.** A transactional sender for ColdReach's own
  email (src/lib/mail/productMail.ts) using the Resend API when
  RESEND_API_KEY is configured; PRODUCT_MAIL_FROM sets the From
  address. Free tier covers signup volume comfortably.
- **Verification flow.** Signup now creates the account unverified
  and emails a single-use verification link (24 hour expiry, only
  the token hash is stored). No session is issued until the address
  is verified; login refuses unverified accounts with a resend
  option, and /verify-email completes the flow. Resends are rate
  limited and answer generically to avoid account enumeration.
- **Safe rollout.** Enforcement is configuration-gated: until
  RESEND_API_KEY is set, signup behaves exactly as before. Accounts
  created under enforcement are flagged and gated at login until
  verified. Earlier accounts are never locked out; instead, while
  signed in they get an announcement bar offering a verification
  link, and verifying simply marks their address verified.

## 1.13.1 (2026-11-01)

Redeploy release, no behavior change. Picks up the
PLATFORM_OWNER_EMAIL environment configuration so the platform
admin panel activates for the owner account.

## 1.13.0 (2026-11-01)

Platform admin (super admin) panel.

- **New /app/admin page**, visible only to the platform owner: the
  account whose email matches the PLATFORM_OWNER_EMAIL environment
  variable. Everyone else gets a 404, and the sidebar gains a
  Platform Admin entry only for the owner. When the variable is
  unset, the panel does not exist for anyone.
- Shows platform-wide aggregates only: user and workspace totals,
  campaigns (with running count), sending accounts, leads,
  enrollments, all-time email event totals, signups and sends per
  day for the last 30 days, the plan mix across workspaces, and the
  10 most recent workspaces with their owner, plan, and counts.
- No other workspace's leads, message content, or campaign details
  are read or shown. Tenant isolation everywhere else is unchanged.

## 1.12.2 (2026-11-01)

First-name identity token, and complete step data in the API.

- **{{senderFirstName}}** joins the identity tokens: the first word
  of the resolved sender name, for copy written in first name terms
  ("I am {{senderFirstName}} with {{senderCompany}}").
- GET /api/campaigns/[id] now returns each step's A/B variants as
  well, so API consumers see the full sequence, matching the
  campaign page.

## 1.12.1 (2026-11-01)

Sender identity tokens for sequence copy.

- **{{senderName}} and {{senderCompany}}** now work in sequence
  subjects, step bodies, A/B variants, and signatures. They resolve
  at send time from the campaign's sender identity, falling back to
  the workspace identity, so an intro line like "I am
  {{senderName}} with {{senderCompany}}" always matches the
  campaign's From name and sign-off. {{company}} still means the
  lead's company.
- Preflight treats both tokens as always resolvable, and the step
  editor offers them in its Insert token row and renders them in the
  live preview.

## 1.12.0 (2026-11-01)

Per-campaign sender identity: name, company, and signature.

- **Each campaign can carry its own identity.** Campaign Settings
  gains Sender name and Company fields next to the existing Email
  signature. A workspace running several brands no longer has to
  send every campaign under one name.
- **From name.** When a campaign sets a sender name, that name is
  the From display name on the campaign's emails, overriding the
  sending account's display name.
- **Sign-off.** The signature text, when filled in, is used exactly
  as written. When it is empty, the sender name and company compose
  the sign-off block (name line, then company line). When neither is
  set, sends behave exactly as before, with the workspace identity
  in the compliance footer.

## 1.11.7 (2026-11-01)

Slimmer compliance footer when a campaign has its own signature.

- **No more double sign-off.** Campaign emails used to stack the
  per-campaign signature (which already signs off with the sender's
  name) on top of a compliance footer that repeated the same name.
  Now, when a campaign carries a signature, the footer keeps only the
  postal address and the unsubscribe link. Campaigns without a
  signature are unchanged: their footer still carries the sender
  name, address, and unsubscribe link.

## 1.11.3 (2026-10-30)

Reply sync reliability fix.

- **Transient IMAP failures are retried, not flagged.** When a
  mailbox connection times out (common on shared mail hosts while
  many accounts on one host are polled), the sync now retries with
  backoff inside the same pass and only records a failure on the
  account if every attempt fails. Connection, greeting, and socket
  timeouts were raised (30s, 15s, 60s), and account syncs are
  spaced slightly apart so back to back logins from one IP stop
  tripping host login rate limits.

## 1.11.2 (2026-10-29)

Enrollment removal for campaigns.

- **Remove leads from a campaign without deleting them.** The
  campaign page gains an Enrolled leads card with bulk selection
  and removal. Removal only affects the campaign: the lead stays in
  its list. As a safeguard, an enrollment that has already been
  contacted (any step sent) cannot be removed, so send history and
  attribution are never wiped by accident.

## 1.11.1 (2026-10-29)

Display fix for click tracking.

- **Campaigns Progress now shows clicks.** The campaigns list adds
  each campaign's tracked link clicks next to emails sent, and the
  campaigns API returns the same clickedCount. Click events were
  already being recorded in v1.11.0; only the display was missing.

## 1.11.0 (2026-10-29)

Seven outreach upgrades in one release.

- **AI icebreaker generator.** A "Generate icebreakers" button on
  each lead list drafts a personalized opening line for leads that
  lack one, from the lead's website and company details, using the
  workspace's AI provider. Up to 25 leads per run; lines land in the
  lead's icebreaker field for review before enrolling.
- **Automated reply detection.** Replies now classify as AUTOMATED
  when they are machine receipts, ticket confirmations, or support
  routing messages, checked before the positive and referral rules.
  The inbox gains a "Humans only" filter, the dashboard separates
  human from automated replies, and a "Detect automated replies"
  action reclassifies existing referral, neutral, and unlabelled
  threads (never positive, negative, or out-of-office ones).
- **Account health guardrails.** Each sending account gets a health
  state from its bounce rate and reply sync status, shown on the
  Sending Accounts page and as a dashboard alert when an account
  needs attention. An account whose bounce rate turns critical is
  automatically excluded from sending for that day, with an audit
  entry.
- **Click tracking with a custom tracking domain.** Links in
  campaign emails are tracked like opens (the unsubscribe link is
  never rewritten), and a workspace Tracking domain setting lets
  opens and clicks run under your own subdomain.
- **Spintax.** Sequence subjects and bodies support
  {option a|option b} variations, chosen consistently per lead, and
  pass through unchanged when no spintax is present.
- **Inbox snippets.** Save reusable reply texts and insert them
  into any thread reply in one click, managed right from the reply
  box.
- **Cross-campaign contact guard.** Enrolling a lead who is already
  enrolled in another campaign stops with the conflict list and an
  explicit "Enroll anyway" choice instead of double pitching them.

## 1.10.1 (2026-10-29)

Sidebar consistency fix.

- **Compose matches the other sidebar buttons.** The Compose entry
  above Inbox now uses the same nav link styling as every other
  sidebar item (same shape, hover, and text treatment) instead of a
  separate primary button design. Behavior is unchanged: it still
  opens the compose window.

## 1.10.0 (2026-10-29)

Inbox bulk actions, manual compose, campaign progress, live sidebar status.

- **Bulk mark as read.** Inbox rows gain checkboxes with a select page
  control and an action bar (Mark as read, Mark as unread, Clear).
  POST /api/threads/bulk verifies every id against the session
  workspace before a scoped update, and audit logs the count.
- **Compose.** A Compose button sits in the sidebar directly above
  Inbox and opens a Gmail style compose window: a From select of the
  workspace sending accounts (only CONNECTED accounts can send), To,
  Subject, and body. POST /api/threads/compose checks suppression
  before sending, links the thread to the lead when the recipient is
  one (with the usual one-click unsubscribe headers), sends through
  the account provider, and records the thread, the outbound message,
  and a SENT event, so manual emails appear in the inbox and Outbox
  and count toward the account's daily totals.
- **Campaigns Progress column.** The campaigns table shows, per
  campaign, "X of Y contacted" (enrollments that have received at
  least one email), "Z remaining" (enrolled, not yet emailed), and
  the total emails sent, from batched groupBy aggregates on the list
  endpoint and the page query.
- **Sidebar live sending status.** The sidebar footer paragraph is
  replaced by a compact live card: a pulsing status dot (amber at
  full capacity), today's sent count against the capacity cap with a
  progress bar, and one status dot per sending account. It reads
  GET /api/sending-status, built on the same sending schedule
  computation as the dashboard panel, and refreshes every minute.

## 1.4.0 (2026-10-27)

Outbox, campaign signatures, Groq AI fallback, richer dashboard.

- **Outbox.** New /app/outbox page listing every sent email from the
  recorded outbound messages, newest first, with filters for campaign,
  sending account, status (opened, replied, not opened) and order.
  Opened and replied badges derive from recorded EmailEvents and
  inbound thread messages, never estimates.
- **Per-campaign email signatures.** Campaigns gain a signatureText
  field (production migration 0006), editable in campaign Settings.
  The worker renders it between the step body and the compliance
  footer on every send, steps and A/B variants alike, so a signature
  change applies from the next send onward without rewriting any
  sequence step. Empty means no signature.
- **Groq AI fallback.** AI assistance now works with either key:
  OPENAI_API_KEY when set (AI_MODEL override), otherwise GROQ_API_KEY
  against Groq's OpenAI-compatible endpoint (GROQ_MODEL override,
  default llama-3.3-70b-versatile). The AI status route and the
  integrations panel report which provider and model are live.
- **Dashboard live sending row.** Running campaigns, emails sent,
  opened, replied, suspended accounts (paused or error state), and
  warmed accounts (past the 4-week warmup curve), all computed from
  live workspace records.
- **Favicon.** New indigo paper-plane app icon (src/app/icon.svg).

## 1.3.0 (2026-10-27)

Lead import can now update existing leads.

- **Update-existing import mode.** The CSV importer gains an opt-in
  updateExisting flag (import wizard checkbox, API body field). When
  set, a row whose email already exists in the target list merges its
  mapped fields into the existing lead instead of being skipped as a
  duplicate, and the import summary reports an updated count. Leads
  that exist in a different list are never touched and keep the usual
  already-exists skip. Default behavior is unchanged. This makes
  re-importing an enriched file (for example one carrying a new
  personalisation field such as an icebreaker) update the enrolled
  leads in place.

## 1.2.0 (2026-10-27)

cPanel and custom mail server support, plus RFC 8058 one-click
unsubscribe. 275 automated tests (32 added), typecheck and build
green.

- **User entered mailbox credentials.** SMTP accounts now accept
  mailbox fields (SMTP and IMAP host, ports, TLS flags, username,
  password) as an alternative to the legacy credentialRef
  environment path. Credentials are stored as an AES-256-GCM
  encrypted blob in `SendingAccount.encryptedCredentials` (no
  schema change), the password never appears in any API response,
  and resolution everywhere is stored first, environment second.
  The account form labels the provider "SMTP / IMAP (cPanel or any
  mail server)", offers one-click cPanel defaults derived from the
  mailbox address (mail.<domain>, SMTP 465, IMAP 993, username the
  full address), and STARTTLS alternatives on 587 and 143.
- **IMAP reply sync.** A new ImapSource (imapflow plus mailparser)
  reads cPanel and other self hosted inboxes: UID cursor with
  UIDVALIDITY checking and re-baselining, a first sync limited to
  the last 7 days and the newest 100 messages, and normalization
  into the same reply pipeline as Gmail and Microsoft 365, so
  replies reach the unified inbox and stop sequences. The sync
  pass and the per account Sync replies button now cover SMTP
  accounts, and the legacy environment path gained optional
  `<PREFIX>_IMAP_HOST`, `<PREFIX>_IMAP_PORT`, and
  `<PREFIX>_IMAP_SECURE` variables.
- **Connection test.** POST /api/accounts/test-connection verifies
  unsaved mailbox settings live (SMTP transport verify, IMAP login
  plus INBOX open) and reports each protocol separately with plain
  language errors; the form runs it before saving.
- **One-click unsubscribe (RFC 8058).** Campaign sends and inbox
  replies now carry the List-Unsubscribe-Post header alongside
  List-Unsubscribe, and POST /u/[token] applies the unsubscribe
  with JSON responses (200 on success, idempotent; 400 on an
  invalid token). The GET confirmation page moved into the same
  route handler, because Next.js does not allow a page and a route
  handler in one segment.
- **Docs.** INTEGRATIONS.md section 12 and ACTIVATION.md section 9
  cover cPanel setup end to end (Connect Devices settings,
  Email Deliverability SPF, DKIM, and DMARC first), including an
  honest deliverability note: placement also depends on the
  sending server's IP reputation and list quality, which no app
  can guarantee.

## 1.1.0 (2026-10-27)

Phase 6: launch and growth, in three stages. 243 automated tests
(48 added), a 20-check live smoke, typecheck and build green; see
the Phase 6 addendum in QA.md for the executed evidence.

- **Stage A, activation sprint.** A Settings Integrations status
  panel reporting every integration's live state from real config
  checks (Configured, or Not configured with the exact missing
  environment variable names and a link into ACTIVATION.md), with
  counts for SMTP accounts and webhook endpoints. ACTIVATION.md, a
  click-by-click owner runbook for the encryption prerequisites,
  Google OAuth, Microsoft OAuth, the OpenAI key, Stripe (test mode
  first, with the three webhook events the handler consumes), the
  optional verification provider, and HubSpot, ending in a
  production verification checklist. `scripts/activate-smoke.ts`
  reports per-integration status against any running instance and
  makes one real AI call and one test-mode Stripe checkout only on
  explicit opt-in; it never sends email.
- **Stage B, launch readiness.** GitHub Actions CI
  (`.github/workflows/ci.yml`: install, Prisma generate, typecheck,
  tests, build, and `npm audit --audit-level=high` as a failing
  step) and a 30-minute uptime workflow
  (`.github/workflows/uptime.yml`) against `/api/health`. A public
  `/pricing` page rendered from the plan catalog, linked from the
  landing nav, pricing section, and footer, with a test pinning
  the page data to the catalog; the landing page's stale
  pre-Phase 4 pricing copy was replaced with the same catalog
  data. TRADEMARK.md records that the ColdReach name is a working
  name with no clearance performed, and what a real check
  requires. DEPLOYMENT.md gains the CI and uptime sections and a
  custom domain checklist.
- **Stage C, growth features.** Email verification
  (`src/lib/verify/`): built-in syntax, bundled partial
  disposable-domain, and MX checks that degrade to UNKNOWN when
  DNS cannot answer, optionally refined by NeverBounce behind
  `VERIFY_API_KEY`. `Lead` gains verificationStatus,
  verificationDetail, and verifiedAt (dev migration
  `20261027011023_phase6_launch_and_growth`, prod migration
  `0005_phase6_launch_and_growth`). A Verify list action verifies
  in batches of 100 and stores per-lead results; enrollment skips
  INVALID leads (counted as skippedInvalidVerification) and flags
  RISKY ones (enrolledRisky). Warm-up schedules: `SendingAccount`
  gains warmupEnabled and warmupStartedAt; the pure cap curve in
  `src/lib/domain/warmup.ts` (20, 50, 100, 200 per day by week)
  layers under the existing age ramp in the worker's capacity
  gate, the accounts page gains a warm-up control, and preflight
  warns when projected volume exceeds a warm-up cap. HubSpot CRM
  sync (`src/lib/crm/`, new `CrmConnection` model): OAuth connect
  mirroring the mailbox providers, tokens encrypted at rest, sync
  pushing workspace leads as contacts in batches of 100 with the
  run summary stored on the connection; the contacts scopes
  expose no unsubscribe or deletion pull, and that limitation is
  recorded in the summary and INTEGRATIONS.md rather than worked
  around.

## 1.0.0 (2026-10-26)

First production-ready release: Phases 1 to 5 complete, verified
end to end by the final QA pass in QA.md (195 automated tests, a
54-check live smoke, a recovery drill, and a load smoke).

- **Phase 1, Foundation.** Design system and app shell, bcrypt and
  JWT cookie auth, multi-tenant workspaces with roles, audit log,
  the full core data model, and the tested domain engine
  (scheduling, suppression, dedupe, personalization, metrics,
  limits).
- **Phase 2, Functional MVP.** Lead lists and CSV import, campaign
  and sequence builder, preflight launch gating, a sending worker
  behind a provider interface (simulation and SMTP), signed
  unsubscribe flow, idempotent provider event ingestion, and
  analytics from real events.
- **Phase 3, Professional Workflows.** Gmail and Microsoft 365
  OAuth with AES-256-GCM token storage, reply sync with a unified
  inbox, deliverability diagnostics (SPF, DKIM, DMARC grading and
  per-account health), team invites and roles, onboarding
  checklist, and the production cron endpoint.
- **Phase 4, Competitive Capabilities.** A/B testing with a
  z-test winner rule, AI assistance behind an interface, a public
  API with scoped hashed keys, signed outbound webhooks with
  retries, plan quotas with Stripe billing, and the Agency
  Command Center.
- **Phase 5, Production Readiness.** Security headers and a CSP on
  every response, rate limiting on the credential endpoints, a
  structured JSON logger with an optional Sentry forwarder, a
  public health endpoint, branded error and 404 surfaces, a
  redacted OWNER-only workspace export with a restore script and
  a proven recovery drill, database indexes for the hot query
  shapes, database-level aggregation for metrics (no more
  unbounded event loads), an accessibility pass, and the final
  QA in QA.md. SECURITY.md records the review, the tradeoffs, and
  the residual risks.

## Phase 4, Competitive Capabilities (2026-10-26)

A/B testing, AI assistance, a public API, outbound webhooks,
billing with quotas, and an agency view.

- **A/B testing.** StepVariant model (dev migration
  `20261026180056_phase4_competitive`, production migration
  `prisma/prod/migrations/0003_phase4_competitive`): up to two extra
  variants per step with weights, edited in the sequence builder
  with per-variant live preview. Pure engine in
  `src/lib/domain/abtest.ts`: deterministic FNV-1a hash assignment,
  per-variant stats, and a winner only via a two-proportion z-test
  at 95 percent confidence with a 30 delivered minimum per variant.
  EmailEvent gains a nullable `variant` label; the worker renders
  and records the assigned variant, and downstream events inherit
  it. Analytics gains a per-campaign A/B section with the winner
  badge or the exact "not enough data" numbers.
- **AI assistance.** AiProvider interface with an OpenAI
  implementation (`OPENAI_API_KEY`, `AI_MODEL` default
  `gpt-4o-mini`): subject ideas and body rewrites in the builder,
  applied only on click, and per-lead icebreakers stored on the
  lead as the `icebreaker` field for use as a token. Without the
  key, endpoints return 501 naming the variable and panels show "AI
  is not configured". Prompts forbid invented facts and
  spam-filter evasion content.
- **Public API and keys.** ApiKey gains scopes and a creator
  relation; keys are `cr_` prefixed, SHA-256 hashed, shown once,
  revocable, with a 120 request per minute per-instance limiter.
  `/api/v1` offers paginated lead listing and creation (reusing the
  in-app create service, with dedupe 409 and suppression 422),
  idempotent suppression creation, and campaign stats from the real
  metrics engine including the A/B breakdown. API.md documents
  auth, scopes, endpoints, examples, and error shapes.
- **Outbound webhooks.** WebhookEndpoint (secret stored AES-256-GCM
  encrypted) and WebhookDelivery models. Provider events applied
  through applyProviderEvent (DELIVERED, REPLIED, BOUNCED,
  UNSUBSCRIBED, COMPLAINED; SENT excluded) enqueue deliveries,
  which the worker tick sends with an HMAC-SHA256
  `X-ColdReach-Signature` header; retries back off 1m, 5m, 30m, 2h
  and stop at 5 attempts. Settings UI with event type picker, test
  delivery through the same path, delivery log, pause and delete.
  INTEGRATIONS.md gains Zapier and Make recipes and the plain CRM
  note: no native HubSpot or Salesforce connector exists or is
  claimed.
- **Billing and quotas.** Plan catalog in `src/lib/domain/plans.ts`
  (FREE 2 seats, 2 accounts, 1,000 sends per month; STARTER $29;
  PRO $79; AGENCY $199; prices labelled placeholders). Subscription
  model, one per workspace; usage derived from real SENT events in
  the current UTC month. Preflight FAILs when projected sends exceed
  the remaining quota, the worker hard-stops at the cap and records
  why, and account and seat limits are enforced at creation and
  invite time. Stripe behind env vars: checkout sessions, customer
  portal, and a signature-verified webhook syncing the Subscription
  row; without the vars, 501s name them and an audited OWNER manual
  override keeps quotas usable. Billing page with plan cards and
  real usage bars.
- **Agency Command Center.** New Agency page and rollup service:
  owners of multiple workspaces see this month's sends, replies,
  and bounces in total and per workspace, with active campaigns,
  ERROR account flags, and bounce rates above 5 percent flagged,
  plus click-through workspace switching. Owners of one workspace
  get an explainer and a create-workspace action (new endpoint;
  the creator becomes OWNER).
- Tests: 172 passing (47 new across A/B statistics, plan and quota
  math, API key auth, webhook signing and retries, AI gating and
  provider shape, variant attribution on applied events, and the
  agency rollup). Typecheck and production build pass. A 41-check
  live smoke (scripts/smoke-phase4.ts) passes end to end, including
  a signed webhook delivery to a local listener and a declared A/B
  winner from real reply skew.

## Phase 3, Professional Workflows (2026-10-26)

Real sending identities, a working inbox, and team workflows.

- **Credential security and OAuth.** AES-256-GCM encryption for
  provider tokens (`src/lib/security/crypto.ts`, key from
  `ENCRYPTION_KEY`), with tamper detection tests. SendingAccount gains
  encryptedCredentials, tokenExpiresAt, lastSyncAt, syncCursor, and
  providerAccountId (dev migration
  `20261026165125_phase3_professional_workflows`, production migration
  `prisma/prod/migrations/0002_phase3_professional_workflows`).
  Google and Microsoft connect flows (signed state token bound to the
  session, profile lookup, encrypted token storage, transparent
  refresh) with Gmail and Microsoft Graph transports implementing the
  existing MailProvider interface. Unconfigured providers report "Not
  configured" with the missing environment variables named, in the API
  and the UI. INTEGRATIONS.md documents the owner console steps and
  the honest activation table.
- **Reply sync and unified inbox.** MessageSource interface with
  Gmail (history feed), Graph (receivedDateTime filter), and fake
  implementations. Sync matches replies by Message-ID headers, applies
  REPLIED through the existing applyProviderEvent path, classifies
  with documented keyword rules (`src/lib/domain/classify.ts`), and
  threads messages with Message-ID dedupe. The Inbox page replaces
  the placeholder: filters, conversation view, reply composer through
  the account provider, assignment, status controls, classification
  override, internal ThreadNotes, and sync maintained unread state.
- **Deliverability diagnostics.** Pure SPF, DKIM, and DMARC evaluator
  with plain-language fixes and fixture tests, a live DNS checker
  service that degrades to "unable to verify", and per account health
  cards computed from real events with the formula printed in the UI.
- **Team collaboration.** Invite model (SHA-256 token hashes, 7 day
  expiry), accept page that works logged out and logged in, SMTP
  invite email when a connected SMTP account exists (link returned
  otherwise), resend and revoke, role changes and member removal with
  last OWNER guards, a Team page with members, invites, and an
  Activity tab over the AuditLog, and a functional workspace switcher
  in the topbar (session re-issue after membership check).
- **Onboarding and production cron.** Dashboard getting started
  checklist computed from live workspace state. GET /api/cron/tick
  accepts the Vercel Cron CRON_SECRET bearer token, runs reply sync
  plus the send tick, and returns a JSON summary; `vercel.json`
  schedules it every 5 minutes, with the plan caveat documented in
  DEPLOYMENT.md. The worker tick itself now syncs replies before
  sending as well.
- Tests: 125 passing (46 new across crypto, classification, DNS
  fixtures, sync with FakeSource, invites and owner guards, workspace
  switching, and cron route auth). Typecheck and production build pass.

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
