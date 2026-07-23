# AI Handoff

## Latest Update

## Date

2026-07-22 (later session)

## Branch

us-lead-reply-routing-revival (Conductor workspace yamoussoukro, targets main)

## Commit

see git log

## Task implemented

US lead replies rerouted to rfq@; oguzhan@ removed from the US flow; day-30
revival email for auto-dropped leads.

- **Reply routing**: every US lead email (first touch, follow-ups 2-4, scope
  follow-up, revival) now sets `Reply-To: rfq@usederya.com`
  (`RFQ_LEAD_REPLY_TO_US`, defaults to the sending address); TR lead emails
  keep `oguzhan@`. Send-all desk forwards exclude US leads entirely
  (`pendingDeskForwardWhere`); the per-row Forward button stays for one-off
  use. **DEPLOY DEPENDENCY: connect rfq@usederya.com via OAuth (Settings →
  Email → "RFQ desk mailbox" row → Connect, signed in as rfq@) right after
  deploy - until then, new replies land in an unsynced mailbox and reply
  detection cannot see them.** The settings page has a dedicated row +
  setup gate for this; "connected" means a refresh token, not just the
  SMTP-only account row that already exists.
- **Revival**: auto-dropped leads (the `leadDroppedAt` stamp - manual
  ignores are never revived) get one "still planning to ship?" email 30
  days after the drop (`REVIVAL_AFTER_DAYS`, stamp `revivalSentAt`,
  threaded via `leadLastMsgId`). Reply detection now also covers dropped
  leads, so an answer to the break-up or revival email resurfaces the card
  as "Replied - needs action".
- Sync summary + button now count revivals; card and expanded-panel copy
  show the actual Reply-To instead of hardcoded oguzhan@.

## Files changed

- `src/lib/rfq-mail.ts`, `src/lib/lead-outreach.ts`, `src/lib/lead-auto-reply.ts`
- `src/lib/google-sheets-sync.ts`, `src/components/sync-google-sheet-button.tsx`
- `src/components/us-lead-cards.tsx`, `src/components/rfq-expandable-rows.tsx`
- `src/app/dashboard/settings/email/page.tsx`, `src/app/api/auth/gmail/start/route.ts`
- `scripts/lead-outreach.test.ts`, `docs/*`

## Verification passed

- tsc + build clean; extended `test:lead-outreach` passes.
- Neon branch of prod: US lead replyTo=rfq@ (first touch and follow-ups),
  TR replyTo=oguzhan@, Send-all pool = 57 TR rows / 0 US leads, engine ran
  the new dropped+revival queries safely (fake SMTP: stamps rolled back,
  abort after 3 failures), settings page renders the rfq@ row as "reply
  capture off", replied cards render "waiting in the rfq@usederya.com inbox".

## Caveats

- US emails are still signed "Oğuzhan Karaca" - flagged to Mert as a
  persona decision, not changed here.
- No DB migration.

## Previous Update

## Date

2026-07-22

## Branch

us-lead-outreach-sequence (Conductor workspace yamoussoukro, targets main)

## Commit

see git log

## Task implemented

US lead outreach sequence (Good + Maybe tiers) + lead cards view.

- **Sequence** (`src/lib/lead-outreach.ts`, engine in
  `src/lib/lead-auto-reply.ts`, runs after every hourly lead-sheet sync):
  first email on arrival for GOOD and REVIEW ("Maybe") tiers - Maybe leads
  get qualifier questions prepended (commercial? company?) and never a
  processing promise; WEAK never emailed. Follow-ups 2/3/4 go out 2/3/4
  days after the last outbound (net day 0/+2/+5/+9), only 07:00-19:00
  America/Los_Angeles; 4 silent days after the final email the lead is
  auto-set IGNORED (`leadDroppedAt`). First touches only for leads received
  within `DERYA_LEAD_OUTREACH_BACKLOG_DAYS` (default 30).
  `DERYA_LEAD_AUTO_REPLY=off` kills all sends.
- **Reply detection**: deterministic - newest INBOUND `EmailMessage` from
  the lead's address (case-insensitive) after our first send, across the
  OAuth-synced inboxes (oguzhan@ = Reply-To, mert@ = CC; both verified
  connected in prod). Stamps `leadRepliedAt`, stops the sequence, card goes
  "Replied - needs action" with the reply excerpt. Any desk status change
  (PRICING, custom) freezes automation ("With the desk").
- **Stamps** live in `parsedData` (`followUp2/3/4SentAt`, `leadRepliedAt`,
  `leadDroppedAt`, `sequenceStoppedAt`, `leadLastMsgId` for In-Reply-To
  threading); the sheet-resync preserve list is now the shared
  `RESYNC_PRESERVED_PARSED_KEYS` const in rfq-mail - add any new stamp
  there or the hourly resync erases it.
- **US cards view** (`src/components/us-lead-cards.tsx` replaces the sheet
  under `/dashboard/rfq?view=us`; Türkiye keeps the table): one card per
  lead - quality badge (Review now displays "Maybe"), lane, contact,
  4-step tracker with dates, stage chip, reply panel, send-next /
  pause-resume / WhatsApp actions, expandable form answers + email
  previews. Stage filter chips (Replied / Waiting / Not emailed / Dropped)
  compose with the Good/Maybe/All quality chips and the status tabs.
  New actions: `sendNextOutreachAction`, `toggleLeadSequenceAction`.

## Files changed

- `src/lib/lead-outreach.ts` (new), `src/lib/lead-auto-reply.ts`,
  `src/lib/rfq-mail.ts`, `src/lib/lead-emails.ts`, `src/lib/lead-quality.ts`,
  `src/lib/google-sheets-sync.ts`
- `src/app/dashboard/rfq/page.tsx`, `src/app/dashboard/rfq/actions.ts`
- `src/components/us-lead-cards.tsx` (new),
  `src/components/rfq-expandable-rows.tsx`,
  `src/components/sync-google-sheet-button.tsx`, `src/components/icon.tsx`
- `src/app/globals.css`, `scripts/lead-outreach.test.ts` (new), `package.json`

## Verification passed

- `npx tsc --noEmit` clean; `npm run build` (dummy DATABASE_URL) clean.
- `test:lead-outreach` (new), `test:lead-quality`, `test:lead-emails`,
  `test:rfq-whatsapp` pass; lint error count unchanged vs baseline (101).
- End-to-end on a Neon copy-on-write branch of prod: US view renders 20
  Good cards + Maybe (71) chip + stage chips with live counts; engine
  dry-run (fake SMTP password) detected the 2 real replies (DRY26070146,
  DRY26070127), rolled back claimed stamps on send failure, aborted after
  3 systemic failures.

## Caveats

- No DB migration - all state is parsedData JSON; nothing to run on prod
  before deploy.
- rfq@ stays SMTP-only; reply capture depends on oguzhan@/mert@ staying
  OAuth-connected.
- The ~50 in-window Maybe leads get first touches over the first ticks
  after deploy (cap 25 emails/tick); older Maybe leads stay manual.
- The qualifier prepend also reaches the TR sheet's manual "Ask info"
  email for Maybe-tier TR leads (same builder); the automated sequence
  itself only processes US-marker leads.

## Previous Update

## Date

2026-07-20

## Branch

edmonton (Conductor workspace, targets main)

## Commit

see git log

## Task implemented

Loadboard employee accounts + load assignment + admin activity log.

- **EMPLOYEE role** (`UserRole.EMPLOYEE`): loadboard-only operators. Route
  gating lives in `src/middleware.ts` (verifies the `crm_session` HMAC with
  WebCrypto on the edge runtime, mirrors `decodeSession`); employees may open
  only `/dashboard/loads` and `/dashboard/jobs*` (not `/dashboard/jobs/new`),
  everything else redirects to `/dashboard/loads`. The dashboard layout hides
  all non-loads nav/chrome for employees (CommandPalette, agent chat widget,
  live toast, RFQ/WhatsApp chips, channels/admin links). Sign-in allowlist
  defaults now include atahan@ and merve@usederya.com
  (`src/lib/login-code.ts`).
- **Load assignment**: `Job.assignedToUserId` is now a real relation
  (`Job.assignedTo`, `User.assignedJobs`, FK + index in migration
  `20260720000100_employee_role_assignee_audit_log`). Every load surface has
  a **General board / My board** scope (loads page tabs `?scope=mine`, deal
  pipeline scope tabs preserved across Board/Table). Loads table + jobs table
  show an Assigned column; board cards show an assignee chip. Job detail
  header: admins/managers get an assign dropdown (`assignJobAction`,
  role-gated), everyone else gets **Take this load** (`claimJobAction`,
  atomic claim of unassigned loads only). Creation paths no longer
  auto-assign the creator (jobs/new, queue convert, RFQ load review) — loads
  start unassigned so the personal-board/claim flow works.
- **Activity log**: new `AuditLog` model (officeId, actorUserId/actorEmail,
  action, entityRef, summary, changes JSON) + `src/lib/audit.ts`
  (`recordAuditLog`, `diffAuditChanges`). Hooked into `updateJobStatus`,
  `updateJobAllFields` (field-level diff), `updateJobField`, `updateJobNote`,
  `selectCarrierQuote`, claim/assign, and the three load-creation paths.
  Admin → **Activity log** tab renders the last 200 entries (who, action,
  load link, per-field from → to).
- **Employee provisioning**: `scripts/create-employee-user.ts`
  (`npm run create:employee`, env-driven, guarded by
  `ALLOW_EMPLOYEE_USER_CREATE=1`).

## Files changed

- `prisma/schema.prisma`, `prisma/migrations/20260720000100_employee_role_assignee_audit_log/migration.sql`
- `src/lib/audit.ts` (new), `src/lib/login-code.ts`, `src/middleware.ts`
- `src/app/dashboard/layout.tsx`, `src/app/dashboard/loads/page.tsx`, `src/app/dashboard/jobs/page.tsx`
- `src/app/dashboard/jobs/[jobId]/page.tsx`, `src/app/dashboard/jobs/[jobId]/actions.ts`, `src/app/dashboard/jobs/new/page.tsx`
- `src/app/dashboard/queue-actions.ts`, `src/lib/rfq-load-review.ts`
- `src/components/jobs-board.tsx`, `src/components/jobs-table.tsx`
- `src/app/dashboard/admin/page.tsx`
- `scripts/create-employee-user.ts` (new), `scripts/login-code.test.ts`, `package.json`

## Verification passed

- `npm run build` (dummy DATABASE_URL) — types + build clean.
- `npx tsx scripts/login-code.test.ts` — updated for the new default allowlist.
- `next lint` on changed files — only pre-existing `<a>`-vs-`Link` errors and
  unused-var warnings that predate this change.

## Caveats

- Middleware gating is defense-in-depth for routing; server actions outside
  the loads surfaces are still importable by an authenticated employee who
  crafts requests (internal-trust deployment; assign action is role-gated).
- Employees see full load details incl. revenue/cost and the customer-portal
  button; restrict later if needed.
- Migration must run on prod before deploy (`prisma migrate deploy`) — the
  new FK cleans orphan `assignedToUserId` pointers first, and the enum value
  is additive.

## Previous Update

## Date

2026-07-17

## Branch

cody (Conductor workspace, targets main)

## Commit

see git log

## Task implemented

US section on Incoming RFQs, fed by the new US Meta lead sheet
("DERYA LEAD - USA CALIFORNIA", spreadsheet
`1wSZBm5iNbDWjml5ddMebULb7iLBKjs5vuX3U_5oC_Ic`).

- **Shared lead-sheet config**: new `src/lib/meta-leads.ts` declares both Meta
  Lead Ads sources (TR + US; same Meta export column layout) with env
  overrides `DERYA_META_LEADS_US_SHEET_ID/_TAB/_GID` (defaults: the sheet
  above, tab `ca leads`, gid 86480056 — the spreadsheet's gid-0 tab "Sayfa1"
  is header-only, and the sync now warns when a lead sheet reads zero data
  rows so a wrong tab/gid is never silent). Exports `US_LEAD_PARSED_MARKER`
  (`"market":"US"`) and `metaLeadMarketOf()` — nothing else writes a `market`
  key into inquiry parsedData.
- **Sync**: `syncMetaLeadRows` is parameterized by source and now loops over
  both sheets independently (one failing must not block the other; warnings
  are per-sheet). Rows gain `market` in parsedData, `Market`/`Job title` in
  the lead notes body, and US subjects read `US lead: …` (TR subjects
  unchanged). Sync summary gains `leadsUs`; the sync button reports
  "N TR leads · M US leads". The hourly `/api/google-sheets/sync` cron picks
  the US sheet up with no config change. Resync now also preserves the
  `whatsappSentAt` stamp (pre-existing bug: it preserved only
  deskForwardedAt/confirmationSentAt, so the hourly sync wiped the WA sent
  indicator).
- **/dashboard/rfq US view** (iterated same day per Mert's feedback — a
  chosen tab, not a default on-screen panel): the default view is the
  original single sheet minus US leads; a right-aligned `view-switcher`
  flag toggle ("🇹🇷 Türkiye" | "🇺🇸 US (n)") swaps to `?view=us`, which shows
  only US-market leads plus a "Lead sheet" external link in the page
  actions. Status tabs and ?q= search compose within either view (tab links
  carry `view`; the search bar preserves it by reading the query string at
  fire time). The default view's exclusion filter is null-safe
  (`parsedData: null` OR NOT contains) so manual RFQs with NULL parsedData
  stay visible. RfqSheet gained `emptyHint` (US view's empty-state copy +
  hides the New RFQ button); the interim `hideToolbar` prop was removed
  with the two-panel layout.
- **Lead quality triage** (`src/lib/lead-quality.ts`): deterministic score
  over what the lead form actually gives (contact channel and lane are
  gates; commercial intent, load size, timing, budget, company, commodity
  are points) → GOOD / REVIEW / WEAK with human-readable reasons. The US
  view defaults to Good only, with Good/Review/All chips (`?quality=`)
  showing counts; each lead row carries a colored quality pill (tooltip =
  score + reasons) and the expanded row lists "Lead quality" among the lead
  answers. Thresholds: GOOD ≥ 8, REVIEW ≥ 4 — plus the desk rules (Mert,
  2026-07-18): GOOD means business-significant. An explicitly commercial
  shipment ("yes, commercial…" / "evet, ticari…") is ALWAYS GOOD (only the
  contact/lane gates outrank it); a declared-individual shipment ("no,
  individual…" / "hayır, bireysel…") or a personal-effects move (household
  goods / belongings commodity) caps at REVIEW no matter the container
  size; "not sure"/blank answers rank on points so unlabelled importers can
  still reach GOOD. Dry-run over the real prod leads after both rules:
  71 leads → 16 GOOD / 52 REVIEW / 3 WEAK — the GOOD list is pure business
  freight; junk ("Isk → Idk", "national and international") gates to WEAK.
- **Smart lead email** (`src/lib/lead-emails.ts`, pure/testable; rfq-mail
  wraps it with SMTP config as `buildLeadCustomerEmail`, replacing
  `buildLeadConfirmationEmail`): when the lead's details are complete the
  email is the received-confirmation; when not, it asks for exactly the
  missing details — the question list comes from the same
  `leadMissingQuestions()` the WhatsApp draft uses (extracted from
  `buildWhatsAppInquiry`), EN for US leads / TR for TR leads. Each kind has
  its own send stamp (`confirmationSentAt` / new `infoRequestSentAt`, both
  resync-preserved), so sending the info-request doesn't mark the later
  confirmation as sent — once the lead's data is filled in, the card and
  button flip to the confirmation automatically. The sheet's Send column
  gained a per-row "Confirm" / "Ask info" button for lead rows (send column
  default width 120 → 176); the expanded card's title/hint follow the kind.
- **Market-aware outreach**: `buildLeadConfirmationEmail` sends English
  subject/body to US-market leads (Turkish copy unchanged for TR).
  `buildWhatsAppInquiry` drafts the whole message in English for US leads
  (greeting, missing-detail questions, subject phrase; en-US name casing so
  "igor" ≠ "İgor"). `waPhoneDigits` takes an optional market: US promotes
  bare 10-digit NANP numbers to `1…`; TR behavior is byte-identical.
  `sendWhatsAppInquiryAction` resolves digits with the same market so the
  Cloud API send matches the previewed wa.me link. Source chips read
  "Facebook lead · US" outside the panel.

## Files changed

`src/lib/meta-leads.ts` (new), `src/lib/google-sheets-sync.ts`,
`src/lib/inquiry-source.ts`, `src/lib/rfq-mail.ts`, `src/lib/rfq-whatsapp.ts`,
`src/app/dashboard/rfq/page.tsx`, `src/app/dashboard/rfq/actions.ts`,
`src/components/rfq-expandable-rows.tsx`,
`src/components/sync-google-sheet-button.tsx`,
`scripts/rfq-whatsapp.test.ts`, docs.

## Verification passed

next build clean; `test:rfq-whatsapp` (extended with US cases: English draft,
en-US casing, NANP phone promotion, country-only destination), new
`test:lead-quality` (gates, tier calibration on real-shaped fixtures,
company-fallback handling) and `test:lead-emails` (confirmation vs
info-request, EN/TR copy, email questions === WhatsApp questions),
`test:crm`, `check:docs`, `audit:tenant-scope` (baseline 9 findings, none
new) pass. Lint on touched files shows only the two pre-existing baseline
findings (rfq/new `<a>`, `_removed` unused). Full end-to-end run against a
scratch local Postgres and the REAL sheets (`.context/e2e-us-leads.ts`):
34 US + 63 TR leads created, market tags/subjects/DRY references/budget
bounds correct, spot-checked contact row incl. jobTitle and `+1` phone; the
page's two partition queries split 98 rows with no leakage and keep a
NULL-parsedData manual RFQ visible (confirmed naive NOT-contains DOES drop
NULL rows on Prisma 6 — the OR-null guard is load-bearing); resync created
no duplicates and preserved operator status + whatsappSentAt. The e2e is
also what caught the header-only gid-0 tab (hence the `ca leads`/86480056
default). Quality scorer dry-run against the live prod leads (read-only,
`.context/quality-dry-run.ts`): 42 leads → 18 GOOD / 21 REVIEW / 3 WEAK.

## Caveats

US leads only appear in the panel after the next sync stamps `market` into
parsedData (button or hourly cron; sourceKey dedupe means no duplicates if
rows were ever imported before). TR rows adopt the market tag on their next
resync — until then they are simply not in the US panel (correct either way).
Send-all-to-desk intentionally covers both markets (desk forward is internal
English). The lead sheet must stay link-viewable (or a service account /
`GOOGLE_SHEETS_API_KEY` configured) for the sync to read it.

## Previous Update

## Date

2026-07-07 (second update this date)

## Branch

rfq-bulk-select-status (Conductor workspace walla-walla, targets main)

## Commit

see git log

## Task implemented

Three features: Trash as a closed RFQ status, ⌘K app-wide search, RFQ page
search bar.

- **Trash status**: promoted from ad-hoc custom status to canonical TRASH in
  `src/lib/inquiry-status.ts` (INQUIRY_STATUSES + badge). Stored case variants
  "Trash"/"trash" alias via LEGACY_TO_CANONICAL (no backfill);
  CLOSED_INQUIRY_STATUSES gained TRASH/Trash/trash, so trashed rows leave the
  Open tab, the topbar pending count, Send-all-to-desk (which previously still
  emailed trashed meta-leads), agent tools, decision queue, merge/dedup and
  stale-RFQ nags — while keeping their own Trash tab. The incoming ?status=
  param is canonicalized on /dashboard/rfq so pre-promotion ?status=Trash links
  still land on the Trash tab. Pricing page STATUS_META + status select gained
  TRASH.
- **⌘K global search**: `src/components/command-palette.tsx` rewritten from
  jobs-only to grouped app-wide search backed by new server action
  `src/lib/global-search.ts` (loads, RFQs, companies, contacts, email threads;
  officeId-scoped; companies/contacts respect the same ownership scoping as
  /dashboard/search; Prisma `mode: "insensitive"`). Picking navigates: loads →
  /dashboard/jobs/[id] (middleware still sets the focus-job cookie, replacing
  the old focusJobAction flow), RFQs → /dashboard/rfq/[id],
  companies/contacts → /dashboard/crm?q= (no detail routes exist), threads →
  /dashboard/inbox?q=. `src/lib/job-search.ts` deleted (dead after the
  rewrite; removing it retires two now-unused live server-action endpoints).
  CRM page keys ContactSheet by q so a same-route ?q= navigation applies.
  The .cmdk-* classnames are load-bearing for later theme layers and were kept.
- **RFQ search bar**: /dashboard/rfq accepts ?q= (server-side insensitive OR
  over reference/subject/fromCompany/fromEmail/origin/destination/commodity,
  composed with the status tab; tabs carry q). Debounced RfqSearchBar in the
  sheet toolbar rewrites the URL, reading the rest of the query string at fire
  time; it re-syncs from the URL on external navigations unless focused. The
  empty state moved into RfqSheet so the bar stays visible at 0 results.
  Repeated ?q= params degrade instead of crashing (.trim on array).

## Files changed

`src/lib/inquiry-status.ts`, `src/lib/global-search.ts` (new),
`src/lib/job-search.ts` (deleted), `src/lib/job-focus.ts` (comment),
`src/components/command-palette.tsx`, `src/components/rfq-expandable-rows.tsx`,
`src/app/dashboard/rfq/page.tsx`, `src/app/dashboard/crm/page.tsx`,
`src/app/dashboard/pricing/page.tsx`, `src/app/dashboard/page.tsx` (⌘K hint),
`src/app/globals.css`.

## Verification passed

tsc clean; next build clean; test:rfq-whatsapp, test:strategy,
test:email-labels, test:rfq-load-draft pass; adversarial multi-agent review
over the diff — 11 confirmed findings all fixed (stale ?status=Trash links,
pricing TRASH label/option, CRM same-route pick no-op, palette reopen flash,
search-bar URL desync incl. back button and stale-status race, duplicate ?q=
crash, stale workbench ⌘K hint, dead job-search endpoints). DB-backed tests
skipped (no local DATABASE_URL).

## Caveats

Company/contact ⌘K picks deep-link into the CRM sheet's filter (no detail
routes exist). Email-thread picks land on inbox search by subject. The
/dashboard/search page itself was not touched (still companies/contacts/
activities only, case-sensitive) — the palette supersedes it. Trash rows on
the kanban: previously auto-created PROPOSED shell loads are not retracted
when an RFQ is trashed (pre-existing behavior, same as Ignored).

## Previous Update

## Date

2026-07-07

## Branch

rfq-bulk-select-status (Conductor workspace walla-walla, targets main)

## Commit

see git log

## Task implemented

RFQ sheet: Gmail-style multi-select + bulk status change, and per-user
column layout (hide / reorder / resize).

Column layout (second change in this set):

- The 10 data columns (Received … Send) can be hidden via a "Columns (N)"
  toolbar picker (same chrome as the Loads table), reordered by dragging a
  header onto another (drop indicator shows the landing edge), and resized by
  dragging a header's right edge (clamped 60–640px). "Reset layout" in the
  picker restores defaults. The select-checkbox and row-actions columns are
  fixed chrome.
- Layout persists to localStorage keyed per account:
  `derya.rfqSheet.layout.<userId>` — per user per browser, no schema change.
  Stored layouts are sanitized on load (unknown keys dropped, new columns
  appended, all-hidden falls back to all-visible, widths clamped).
- `.rfq-sheet` switched to `table-layout: fixed` so user widths are exact;
  cell content truncates with ellipsis instead of stretching columns (cell
  dropdown menus are position:fixed, so clipping cannot hide them);
  `min-width: 0` added to sheet inputs so they shrink in narrowed columns.
- Rows render cells by column key and are memoized (`MemoRowPair`) — header
  drag/resize only re-renders colgroup/thead, not the 200 rows.

Multi-select + bulk status change (first change in this set):

- Every sheet row gets a leading checkbox; the header checkbox selects/clears
  all visible rows (indeterminate when partially selected). Ticked rows are
  tinted (`tr.rfq-row-selected`); clicking the checkbox never toggles the
  row's expand panel.
- Selecting ≥1 row shows a sticky bulk bar (same `.bulk-action-bar` chrome as
  inbox triage): "N selected", one-click **Ignore**, a **Set status ▾**
  dropdown listing the full status vocabulary (canonical + office custom
  statuses), and **Clear**. Errors surface inline in the bar; selection is
  kept on failure, cleared on success.
- New server action `bulkUpdateInquiryStatusAction(ids, status)` in
  `src/app/dashboard/rfq/actions.ts`: office-scoped `updateMany`, same status
  normalization + reserved-name ("all"/"open") guard as the single-row edit,
  capped at 200 ids (the sheet's page size), records the same
  `inquiry.updated` memory event per row (operation `sheet_bulk_status`).
- Structural: the table markup (colgroup/thead) moved from
  `rfq/page.tsx` into the client component; `RfqExpandableRows` (tbody-only)
  became `RfqSheet` (full table + bulk bar). Selection is plain React state
  local to the sheet — deliberately NOT the shared `bulk-select-store`
  singleton, which would leak selections across inbox ⇄ RFQ pages. Stale ids
  (row left the filter after refresh) are pruned against visible rows before
  any action.

## Files changed

`src/app/dashboard/rfq/actions.ts` (new bulk action),
`src/app/dashboard/rfq/page.tsx` (renders RfqSheet with userId, table markup
removed), `src/components/rfq-expandable-rows.tsx` (column model + layout
persistence + header DnD/resize + Columns picker + RfqSheet + RfqBulkBar +
checkbox cells + memoized rows), `src/app/globals.css` (select column,
selected-row tint, fixed table layout + truncation, th drag/resize
affordances, picker reset row).

## Verification passed

tsc clean; next build clean; eslint — no new findings in touched files (the
two `<a href="/dashboard/rfq/new">` errors in rfq/page.tsx pre-exist on the
base commit, verified via stash). DB-backed tests skipped (no local
DATABASE_URL in this workspace).

## Caveats

Column layout is per user per browser (localStorage) — it does not roam
across devices; a DB-backed preference store would need a schema migration
(deliberately avoided). Header drag uses HTML5 DnD — mouse only, no touch or
keyboard reorder (hide/show via picker works everywhere). First paint uses
the default layout until the stored one loads (same flash the Loads table
has). Select-all covers the visible page only (query takes 200 newest). No
shift-click range selection. Bulk bar only changes status — bulk delete/send
deliberately out of scope.

## Previous Update

## Date

2026-07-06

## Branch

berlin (Conductor workspace, targets main)

## Commit

see git log

## Task implemented

RFQ page rebuilt as an inline-editable sheet + new status vocabulary + focused-load strip removed:

- The focused-load context strip ("FOCUSED DRY… · customer · route · status")
  no longer renders on any page; removed from `src/app/dashboard/layout.tsx`.
  The focus-cookie mechanism stays (dashboard workbench + ⌘K still use it);
  `src/components/hide-on-routes.tsx` deleted (strip was its only consumer).
- `/dashboard/rfq` cells now edit in place like the CRM sheet: subject,
  from company/email, origin → destination, mode, status, target price.
  Blur/Enter saves via `updateInquiryRowAction`; failed saves revert the cell
  and flash an inline error row. Per-row ✕ deletes (confirm dialog;
  status Ignored is the archive path). The chevron button expands load
  details as before.
- New RFQ status set (control-sheet lingo): BOOKED / PRICING / MISSED ($) /
  RECEIVED / IGNORED — `src/lib/inquiry-status.ts`. Legacy values alias onto
  it (INGESTED,PARSED→RECEIVED; PRICED,QUOTED→PRICING; WON→BOOKED;
  LOST→MISSED) so NO data backfill was needed; automations that still write
  legacy values keep working. "Open" = notIn {BOOKED,MISSED,IGNORED,WON,LOST};
  every open-inquiry predicate in the app now shares
  `openInquiryStatusFilter()`.
- Status and mode dropdowns support "Add option…" — a brand-new value typed
  in the cell becomes an option and a filter tab for the office (options and
  tabs are derived from values in use; Inquiry.status/mode are free strings,
  no migration).
- RFQ detail: field edits and AI parse no longer demote an operator-set
  status; "Mark Lost" is now "Mark Missed" (writes MISSED).

## Files changed

`src/lib/inquiry-status.ts` (new), `src/components/sheet-cells.tsx` (new —
CellInput/CellSelect extracted from contact-sheet, plus allowCreate),
`src/components/contact-sheet.tsx`, `src/components/rfq-expandable-rows.tsx`,
`src/app/dashboard/rfq/{page,actions}.tsx`,
`src/app/dashboard/rfq/[inquiryId]/{page,actions}.tsx`,
`src/app/dashboard/layout.tsx`, `src/app/globals.css`, open-filter swaps in
inbox/activity/domestic-pricing/pricing pages and
agent-chat/agent-tools/decision-queue/email-classifier/thread-actions/
merge-actions/setup-demo-actions/job-actions/rfq-mail/prewarm-summary/
morning-brief/market-tools/link-market-signals libs, plus
`scripts/market-doctor.ts`, `scripts/validate-office-import.ts`.

## Verification passed

tsc clean; next build clean; eslint no new errors; test:strategy,
test:rfq-load-draft, test:email-labels pass; adversarial multi-agent diff
review, confirmed findings fixed. No schema changes — safe to deploy without
migrations.

## Caveats

Legacy status values remain in the DB (aliases handle display/filtering).
Custom statuses/modes persist only while ≥1 row uses them. Dead job-focus-*
CSS left in globals.css. DB-backed tests skipped (no local DATABASE_URL).

## Previous Update

## Date

2026-07-04 (later same day)

## Branch

sidebar-rfq-crm-company-brain (not merged to main)

## Commit

see git log

## Task implemented

Sidebar IA rework + Company Brain page:

- Sidebar: Commercial Workflow is now Deal Desk, Incoming RFQs
  (`/dashboard/rfq`), Loads (`/dashboard/loads`), Pricing, CRM (renamed from
  Relationships, same route), Company Brain (`/dashboard/brain`). Domestic
  Rates and Intelligence are archived from the nav (routes stay reachable
  directly). Inbox moved to the bottom of the Setup section. Topbar chips:
  "active" now lands on /dashboard/loads, "RFQs" on /dashboard/rfq with a
  count matching that page's default Open tab (notIn WON/LOST).
- `/dashboard/rfq` is no longer a redirect to the inbox: it is a real
  Incoming RFQs list (Inquiry table, status filter tabs, links to detail,
  "Inbox triage" button keeps the thread view reachable).
- `/dashboard/loads` (new): dense spreadsheet-style list of all Jobs.
- `/dashboard/brain` (new): Company Brain. Default view is a full-page
  ChatGPT-style chat (`CompanyBrainChat`) on the existing `chatWithAgent`
  server action (same tools/memory as the Desk Assistant dock; dock hides
  itself only on this chat view). Quiet header switcher reveals secondary
  sections: To-dos (open Tasks via TaskListInline), Daily news (research
  feed + high-severity hotspots from `getIntelligenceMapData`, the 11:00 UTC
  cron output), Intelligence map (external logistics `WorldIntelligenceMap`;
  internal company map is a placeholder with memory-substrate counts).
- Merged local branch `intelligence-map-polish` (map geography polish);
  conflicts resolved keeping main's walnut-navy palette over the branch's
  teal/cyan colors while taking all structural changes.
- New shared `LinkRow` client component gives the two new server-rendered
  tables the full-row click navigation the `.data-row` styling promises.

## Files changed

- `src/app/dashboard/layout.tsx`, `src/app/dashboard/rfq/page.tsx`,
  `src/app/dashboard/loads/page.tsx` (new), `src/app/dashboard/brain/page.tsx`
  (new), `src/components/company-brain-chat.tsx` (new),
  `src/components/link-row.tsx` (new), `src/components/agent-chat-widget.tsx`,
  `src/app/globals.css`, label fixes in `src/app/dashboard/activity/page.tsx`,
  `src/app/dashboard/rfq/[inquiryId]/page.tsx`, `src/app/dashboard/rfq/new/page.tsx`,
  plus the intelligence-map-polish merge
  (`src/components/intelligence/*`, `src/lib/market-intelligence/intelligence-map.ts`,
  `src/app/dashboard/intelligence/page.tsx`, `scripts/intelligence-map.test.ts`).

## Verification passed

- `npx tsc --noEmit` clean, `npm run build` clean. No schema changes, no
  migrations, no new dependencies. Multi-agent adversarial review run; all
  confirmed findings fixed (chip/page count mismatch, brain-section dock
  suppression, dead evidence cues, job-focus-strip height, stale labels,
  truncation wording, table affordances).

## Caveats

- `npm run test:intelligence-map` not run locally (needs DATABASE_URL); its
  static source assertions were verified by grep after the merge.
- Company Brain chat is session-only (no persistence), like the dock.
- Internal company map is an explicit placeholder — configured later.

## Previous Update

## Date

2026-07-04

## Branch

crm-v1-review-and-push (pushed to main)

## Commit

see git log

## Task implemented

Email-code sign-in with founder allowlist:

- Sign-in now emails a 6-digit single-use code (10 min TTL, 5 verify
  attempts, 3 requests per 15 min) via the office's connected Gmail.
- Every sign-in path (code, collapsed password fallback, unused signup
  helper) rejects emails outside the allowlist: mert@usederya.com and
  oguzhan@usederya.com by default, LOGIN_ALLOWED_EMAILS to override.
- New LoginCode table (additive migration 20260704000100_login_email_codes,
  applied to production before deploy). Codes stored HMAC-hashed with
  AUTH_SECRET; the code email bypasses inbox persistence and CRM touches.
- Also this session: created the oguzhan@usederya.com ADMIN user in the
  Derya office (his Gmail account was already connected and syncing).

## Files changed

- `prisma/schema.prisma`, `prisma/migrations/20260704000100_login_email_codes/`
- `src/lib/login-code.ts` (new), `src/lib/auth.ts`, `src/app/login/page.tsx`
- `scripts/login-code.test.ts` (new), `package.json`

## Verification passed

- `npx tsc --noEmit`, `npm run test:crm` (3 suites), `npm run check:docs`,
  `npm run build`, migration applied to production before merge.

## Caveats

- Pentest sandbox and demo-office logins are intentionally dead (allowlist).
- If Gmail send breaks, use the "Use password instead" disclosure on /login.
- No change-password UI yet.

## Previous Update

## Date

2026-07-03 (later same day)

## Branch

crm-v1-review-and-push

## Commit

committed on crm-v1-review-and-push, stacked on 6dcd65c (see git log)

## Task implemented

CRM V1.1 — post-review hardening plus founder direction decisions:

- Fix pack: rank-correct priority/leverage sorting everywhere (string enums
  sort alphabetically in Postgres), contact + opportunity edit forms, working
  Follow-ups status filter with Done view and reopen, per-entity filter
  options, success/error notices on all CRM forms, active tab state, create
  flows on People/Opportunities/Follow-ups list pages, `nextActionAt` only
  moves earlier, removed the Relationships tab.
- Purged legacy `/dashboard/customers` and `/dashboard/pipeline` UI (code
  only; data stays), repointed 23 links across 13 files, added redirects,
  ported documents/owners/inbox-approval into the CRM pages. `crmStage` is
  the canonical lifecycle.
- Office book vs Network layer views derived from `crmCategory`.
- Inbox → CRM touch integration: `EmailThread.companyId/contactId`
  (migration `20260703010000_email_crm_touch`), resolver + EMAIL Activity
  logging hooked into gmail-sync, gmail-send, and thread linking; forward-only
  `lastTouchAt` bumps; `npm run backfill:crm-email` for history.
- RFQ-created opportunities populate `sourceRefs`; agent suggestion
  dismissals persist as `AgentProposal` audit rows (kind `CRM_SUGGESTION`).

## Files changed

- `src/lib/crm/*`, `src/components/crm/*`, `src/app/dashboard/crm/**`
- `src/lib/crm/email-touch.ts` (new), `src/lib/gmail-sync.ts`,
  `src/lib/gmail-send.ts`, `src/lib/thread-actions.ts`
- `prisma/schema.prisma`,
  `prisma/migrations/20260703010000_email_crm_touch/migration.sql`
- deleted `src/app/dashboard/customers/**`, `src/app/dashboard/pipeline/**`,
  `src/components/unified-crm-workspace.tsx`,
  `src/components/pipeline-board.tsx`
- link repoints: `layout.tsx`, jobs/admin/reports/search pages,
  activity-feed, customer-popover, notification-bell, task-list-inline,
  pending-quotes-inline, decision-queue, agent-actions
- `next.config.ts` (redirects), `src/app/globals.css`, `package.json`
- `scripts/backfill-crm-email-touch.ts`, `scripts/crm-email-touch.test.ts`

## Verification passed

- `npx prisma validate`, `npm run db:generate`
- `npx tsc --noEmit` clean
- `npm run test:crm` (both suites)
- `npm run audit:tenant-scope` — only the pre-existing medium finding at
  `src/lib/rfq-load-review.ts:265`
- Full migration chain replayed on a scratch Postgres;
  `prisma migrate diff` reported no drift
- `npm run build`

## Caveats

- Deploy ordering is mandatory: run `npx prisma migrate deploy` against the
  production database BEFORE the code deploys (two pending migrations:
  `20260703000100_internal_crm_relationship_os`,
  `20260703010000_email_crm_touch`). The Vercel build does not run
  migrations.
- After deploy, run `npm run backfill:crm-email` once against production.
- Legacy `Company.status` has no editing surface anymore; reports/search
  still read legacy fields.

## Previous Update

## Date

2026-07-03

## Branch

feature/internal-crm-v1

## Commit

not committed

## Task implemented

Internal CRM / Relationship OS V1:

- Added `PRODUCT_CRM_IMPLEMENTATION_PLAN.md` before implementation.
- Reused `Company` and `Contact` as canonical CRM account/person truth.
- Added additive relationship metadata to `Company`, `Contact`, `Activity`,
  and `Task`.
- Added `CrmOpportunity` for non-load/RFQ relationship opportunities.
- Added `/dashboard/crm` command center plus companies, people,
  opportunities, tasks, relationships, and detail pages.
- Added server-side CRM data helpers/actions with explicit `officeId` and
  owner scoping.
- Added CRM Brain Context panels backed by existing customer dossier and
  operational brain search.
- Added RFQ detail CRM context and RFQ-linked opportunity creation.
- Kept V1 internal-only: no email sending, Slack posting, Gmail mutation,
  booking, tendering, payment, provider API call, or quote commitment.

## Files changed

- `PRODUCT_CRM_IMPLEMENTATION_PLAN.md`
- `PRODUCT_CRM_V1_MANUAL_TEST_GUIDE.md`
- `PRODUCT_CRM_V1_PR_SUMMARY.md`
- `prisma/schema.prisma`
- `prisma/migrations/20260703000100_internal_crm_relationship_os/migration.sql`
- `src/lib/crm/*`
- `src/components/crm/crm-components.tsx`
- `src/app/dashboard/crm/**`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `src/app/dashboard/layout.tsx`
- `src/app/globals.css`
- `scripts/crm-relationship-os.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`

## Verification passed

- `npx prisma validate`
- `npm run db:generate`
- `npm run test:crm`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run audit:tenant-scope` passed in non-strict mode with only one
  pre-existing medium finding in `src/lib/rfq-load-review.ts`.
- `npm run build`

## Caveats

- Contacts remain company-scoped in V1.
- Live GBrain retrieval is not called from browser/client code.
- CRM-specific persisted agent proposals are not implemented yet; suggestions
  are derived from stale tasks/RFQs/relationships.
- Brain workspace root `/Users/mert/derya-ai-brain-setup` is not a git repo,
  so those docs were updated in place and not committed there.

## Previous Update

## Date

2026-07-01

## Branch

main

## Commit

not committed

## Task implemented

Production pentest account repair:

- Reproduced the production login failure against
  `https://derya-crm.vercel.app/login`: posting
  `pentest@derya-pentest.invalid / PentestDemo!2026` returned `303` to
  `/login?error=1`.
- Confirmed production `/api/health` was already on commit `3ecdd12`, so the
  root cause was production database state, not stale deployed code.
- Made `scripts/create-pentest-demo-account.ts` import-safe and exported an
  idempotent `ensurePentestDemoSeed` helper for server routes.
- Added `GET/POST /api/cron/pentest-demo`, protected by the existing
  `CRON_SECRET` pattern, to verify or repair the pentest sandbox and remove
  legacy `admin@demo.local` rows in the target database.
- Added the route to Vercel cron every 5 minutes so production can repair the
  sandbox with its own configured database and cron secret.

## Files changed

- `scripts/create-pentest-demo-account.ts`
- `src/app/api/cron/pentest-demo/route.ts`
- `vercel.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`

## Verification passed

- Production health check showed `VERCEL_GIT_COMMIT_SHA=3ecdd12` and DB ping
  healthy before this fix.
- Production login POST reproduced the invalid-credentials redirect before this
  fix.
- `npm run test:pentest-demo`
- `npm run test:demo-admin-removed`
- `npx tsc --noEmit`
- `node -e 'JSON.parse(require("fs").readFileSync("vercel.json","utf8"))'`
- `npx tsx -e '...'` import smoke for `ensurePentestDemoSeed`
- `npx tsx -e '...'` route smoke: missing cron secret returns `401`
- `npx tsx -e '...'` route smoke: valid cron bearer verifies the sandbox
- `npm run check:docs`
- `npm run build`
- Deployed commit `12a6243` reached production.
- After the Vercel cron ran, production login with
  `pentest@derya-pentest.invalid / PentestDemo!2026` returned `303` to
  `/dashboard`, and authenticated `/dashboard` returned `200`.
- Production login with `admin@demo.local / admin1234` still returned `303` to
  `/login?error=1`.
- Production `/signup` returned `404`.

## Caveats

- If the production DB is reset or the sandbox is damaged later, the cron route
  should repair it on the next 5-minute run.
- The route intentionally returns whether the password source is the default or
  `PENTEST_DEMO_PASSWORD`, but never returns a secret env password value.

## Previous Update

## Date

2026-07-01

## Branch

main

## Commit

not committed

## Task implemented

Login hardening for internal pentest access:

- Removed the public login footer that linked to `Create your office` and
  advertised `admin@demo.local / admin1234` sample access.
- Removed the public `/signup` page so testers cannot create arbitrary offices
  by guessing the route.
- Updated `seed:pentest-demo` so each `--apply` resets the pentest password to
  `PENTEST_DEMO_PASSWORD` when set, otherwise the documented default
  `PentestDemo!2026`.
- Added `cleanup:demo-admin` and `test:demo-admin-removed` for deleting and
  verifying removal of the legacy `admin@demo.local` account.
- Updated older demo seed scripts so they do not depend on
  `admin@demo.local`, and changed `prisma/seed.ts` so it no longer recreates
  that legacy account.
- Applied both local database operations: reset the pentest account password and
  deleted one `admin@demo.local` user from `Istanbul Office`.

## Files changed

- `src/app/login/page.tsx`
- `src/app/signup/page.tsx`
- `scripts/create-pentest-demo-account.ts`
- `scripts/remove-demo-admin-account.ts`
- `scripts/reset-video-demo-loads.ts`
- `scripts/seed-giresun-workflow-load.ts`
- `scripts/seed-map-example-loads.ts`
- `prisma/seed.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`

## Verification passed

- `npm run seed:pentest-demo -- --apply`
- `npm run cleanup:demo-admin`
- `npm run cleanup:demo-admin -- --apply`
- `npm run test:pentest-demo`
- `npm run test:demo-admin-removed`
- `npm run check:docs`
- `npm run build`
- `npx tsc --noEmit`

## Caveats

- These database operations were applied only to the configured local
  `DATABASE_URL`. Apply the same commands against any preview/staging database
  that pentesters actually use.
- The first `npx tsc --noEmit` run after deleting `/signup` hit stale
  generated `.next/types/app/signup` files. `npm run build` regenerated Next
  types and the rerun passed.

## Previous Update

## Date

2026-07-01

## Branch

main

## Commit

not committed

## Task implemented

Pentest demo sandbox account:

- Added `npm run seed:pentest-demo`, a dry-run-by-default seed command for a
  separate `Pentest Sandbox Office` tenant.
- The seed creates one ADMIN sandbox user, one synthetic customer/contact, one
  active RFQ/load, carrier quotes, email threads/messages, target-price
  history, documents, milestones, lane/margin reference data, memory objects,
  memory events, and a persisted commercial strategy assessment.
- The seed intentionally creates no OAuth tokens, provider credentials, live
  email send state, imported production data, or real customer/supplier facts.
- Default login is `pentest@derya-pentest.invalid` with password
  `PentestDemo!2026`, unless `PENTEST_DEMO_PASSWORD` is set.
- Added `npm run test:pentest-demo` to verify the account, tenant isolation,
  no OAuth tokens, seeded job graph, memory search, customer dossier, and
  strategy guardrail.

## Files changed

- `scripts/create-pentest-demo-account.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run seed:pentest-demo`
- `npx tsc --noEmit`
- `npm run seed:pentest-demo -- --apply`
- `npm run seed:pentest-demo -- --apply` idempotent rerun
- `npm run test:pentest-demo`

## Caveats

- Local seed was applied to the configured local database only.
- The smoke test verifies the deterministic data, memory, and commercial
  strategy surfaces the agent relies on. Browser chat with the LLM still
  requires a runtime `ANTHROPIC_API_KEY` and was not browser-clicked here.

## Previous Update

## Date

2026-06-30

## Branch

main

## Commit

not committed

## Task implemented

Giresun to Ancona workflow load seed:

- Added an idempotent seed command for a real-looking, near-complete Avlia Home
  Giresun, Turkey to Ancona, Italy sea-FCL load.
- The seed creates the approved customer/contact, RFQ inquiry, booked job,
  inbox-linked email threads, three forwarder rate replies, customer acceptance,
  quote lines, target-price history, milestones, and six document records with
  generated PDF data URLs and AI extraction summaries.
- The command is dry-run by default. Use `npm run seed:giresun-workflow -- --apply
  --create-seed-inbox` for a first local write, and add `--reset` to replace the
  existing seeded copy.
- Added `POST /api/admin/seed-giresun-workflow`, ADMIN-only and office-scoped,
  so production can create/find the same completed copy after deployment.
- Fixed the focused dashboard quote display to read `Job.quoteLines` through
  `parseQuoteLines`, matching the job page and quote PDF behavior.

## Files changed

- `src/app/dashboard/page.tsx`
- `src/app/api/admin/seed-giresun-workflow/route.ts`
- `scripts/seed-giresun-workflow-load.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run seed:giresun-workflow`
- `npm run seed:giresun-workflow -- --apply --create-seed-inbox`
- Prisma verification of the seeded job, threads/messages, quotes, documents,
  milestones, and target-price history
- `npm run test:workbench-route-map`
- `npm run test:route-map`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`

## Caveats

- The seed creates generated PDFs for walkthrough data; they are not legal
  shipment documents.
- Browser-authenticated visual QA was not run in this session.

## Previous Update

## Date

2026-06-30

## Branch

main

## Commit

not committed

## Task implemented

Focused load cockpit and route-map correction:

- Moved route lookup and route-leg construction into
  `src/lib/workbench-route-map.ts`.
- Added explicit Giresun, Ancona, Shenzhen, Berlin, and Guadalajara geography,
  plus Black Sea to Adriatic sea waypoints through Bosphorus, Dardanelles, and
  Adriatic approach.
- Removed the global control-sheet decision queue and reference-deal snapshot
  from the focused `/dashboard` load view.
- Added `/dashboard?view=overview` as the explicit top-down dashboard for
  global queue/control-sheet work, with a link back to the focused load view.
- Added a load-specific workflow panel so the focused page explains the
  RFQ -> qualification -> forwarder pricing -> quote/documents walkthrough
  for the selected load rather than leaking unrelated office-wide work.

## Files changed

- `src/app/dashboard/page.tsx`
- `src/app/globals.css`
- `src/lib/workbench-route-map.ts`
- `scripts/workbench-route-map.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:workbench-route-map`
- `npm run test:route-map`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`

## Caveats

- Browser-authenticated visual QA was not run before this handoff.

## Previous Update

## Date

2026-06-30

## Branch

main

## Commit

not committed

## Task implemented

Inbox RFQ-to-load pipeline, video-demo inbox records, and Today fast lane:

- Added a `Today RFQs` path: `/dashboard/inbox?filter=_TODAY&view=rfqs`
  now filters the RFQ table, not just the thread list.
- Added `rfq@usederya.com` as the default deterministic RFQ source sender via
  `DERYA_RFQ_SOURCE_EMAILS`. Inbound mail from that address is classified as
  RFQ before LLM classification and counts as load/RFQ work in Inbox filters.
- Added a reviewed RFQ-to-load creation modal from Inbox RFQs and RFQ detail.
  Operators can edit fields before creating a load, and carried-forward
  customer history is marked as prior-load context rather than email truth.
- Added deterministic prior-load autofill for missing route, cargo, and service
  fields while intentionally excluding prior target price carry-forward.
- Created a reproducible video-demo reset script and disabled the old visible
  fake demo seed paths.
- Added an Inbox `Today` filter and default Today section using
  `lastMessageAt`, plus a `Sync Derya inboxes` button in the Inbox header.

## Files changed

- `src/lib/rfq-load-draft-core.ts`
- `src/lib/rfq-load-review.ts`
- `src/lib/rfq-promote.ts`
- `src/components/rfq-load-review-button.tsx`
- `src/components/rfq-row-actions.tsx`
- `src/components/create-inquiry-button.tsx`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `src/app/dashboard/rfq/[inquiryId]/actions.ts`
- `src/app/dashboard/inbox/page.tsx`
- `src/app/globals.css`
- `src/lib/derya-inboxes.ts`
- `src/lib/email-classifier.ts`
- `src/lib/thread-actions.ts`
- `scripts/email-classifier.test.ts`
- `scripts/email-workflow-labels.test.ts`
- `scripts/rfq-load-draft.test.ts`
- `scripts/reset-video-demo-loads.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:rfq-load-draft`
- `npm run test:email-classifier`
- `npm run test:email-labels`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`

## Caveats

- Browser-authenticated click-through was not run from this session.
- Production Gmail cron could not be manually triggered from local because the
  local `CRON_SECRET` did not match production; Vercel cron remains the
  production scheduler after deploy.

## Previous Update

## Date

2026-06-30

## Branch

codex/domestic-pricing-us-loadboard-20260630

## Commit

not committed

## Task implemented

US-only domestic loadboard correction:

- Tightened domestic trucking eligibility so V1 is US pickup to US delivery
  only. Road moves outside the United States are now suppressed instead of
  labeled domestic.
- Added explicit market scope (`US_DOMESTIC`, `NON_US`, `UNKNOWN`) and US
  location checks for city/state/ZIP, known US cities, state names/codes, and
  generic `USA` blockers.
- Reworked `/dashboard/domestic-pricing` into a loadboard-style first screen
  with status, lane, equipment, pickup, weight, spot estimate, blockers, and
  selected-RFQ navigation.
- Added a selected-lane map panel using OpenStreetMap route tiles when both
  endpoints resolve to US locations.
- Added an in-product `Blocking real data` panel explaining that live data is
  blocked by US lane quality, provider contracts/credentials, missing shipment
  facts, and approval/audit persistence.

## Files changed

- `src/lib/domestic-trucking-pricing.ts`
- `src/app/dashboard/domestic-pricing/page.tsx`
- `src/app/globals.css`
- `scripts/domestic-trucking-pricing.test.ts`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsx scripts/domestic-trucking-pricing.test.ts`
- `npx tsc --noEmit`
- `npm run check:docs`
- `DATABASE_URL='postgresql://local:local@127.0.0.1:5432/derya_crm_dummy' npm run build`

## Caveats

- The map uses deterministic known-city/state/ZIP matching, not a geocoder.
  Ambiguous city-only locations outside the small known-city table stay blocked
  until a US state or ZIP is present.
- Live loadboard/provider data is still not connected. V1 remains mock/manual
  and draft-only.

## Previous Update

## Date

2026-06-30

## Branch

codex/domestic-pricing-live-20260630

## Commit

not committed

## Task implemented

Domestic trucking instant pricing V1:

- Added `/dashboard/domestic-pricing` and linked it from the dashboard sidebar
  as `Domestic Rates`.
- Added a compact RFQ detail panel with required-field blockers, provider
  readiness, simulated rate options, draft quote economics, and approval
  warnings.
- Added deterministic domestic pricing domain logic for normalized truck rate
  requests, mock/manual providers, quote drafts, and brain-context placeholders.
- Kept V1 quote-only: no live provider calls, credential reads, customer sends,
  bookings, tenders, database schema changes, or canonical brain writes.

## Files changed

- `src/lib/domestic-trucking-pricing.ts`
- `src/components/domestic-trucking-rate-panel.tsx`
- `src/app/dashboard/domestic-pricing/page.tsx`
- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `src/app/globals.css`
- `scripts/domestic-trucking-pricing.test.ts`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsx scripts/domestic-trucking-pricing.test.ts`
- `npx tsc --noEmit`
- `npm run check:docs`
- `DATABASE_URL='postgresql://local:local@127.0.0.1:5432/derya_crm_dummy' npm run build`

## Caveats

- Provider and GBrain integrations are intentionally stubs. This branch makes
  the wedge visible on the app, not a live carrier-rating system.

## Previous Update

## Date

2026-06-29

## Branch

main

## Commit

not committed

## Task implemented

Vercel Pro hourly Gmail scheduling:

- Switched `/api/cron/gmail-sync` to Vercel hourly cron now that the project is
  on Vercel Pro.
- Switched `/api/cron/background-jobs` to run hourly five minutes after Gmail
  sync, so queued historical Gmail backfill windows drain without waiting for
  the old daily fallback.
- Removed the GitHub Actions hourly Gmail scheduler. Vercel is now the single
  scheduler for production Gmail refresh, which avoids duplicate sync runs.

## Files changed

- `vercel.json`
- `.github/workflows/hourly-gmail-sync.yml`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run check:docs`
- `npx tsc --noEmit`
- `npm run build`

## Caveats

- No live cron run was manually triggered from this agent session. Vercel will
  run the hourly schedules after deployment.

## Previous Update

## Date

2026-06-29

## Branch

main

## Commit

not committed

## Task implemented

App-wide palette discipline and Intelligence map visual cleanup:

- Revamped the active visual system around walnut, navy, white, and light
  gray-blue surfaces.
- Added a final palette discipline layer so pricing, decision, status, setup,
  and strategy widgets stop falling back to amber/tan/pink/bright-green fills.
- Restricted red/green usage to calm maroon/dark-green text, borders, and
  narrow left-edge accents for genuinely blocked/ready states.
- Updated active sidebar/page controls so selected chips and mode buttons use
  navy with white text instead of beige/brown active fills.
- Recolored the Intelligence world map, hotspots, legend, reference ports, and
  entity badges away from bright teal/orange/red/green.
- Fixed the Intelligence map SVG sizing bug that made the map appear as a
  mostly blank dark panel by forcing the Natural Earth map to render at its
  2:1 aspect ratio.
- Fixed the Intelligence hotspot duplicate evidence-key warning that surfaced
  as a visible dev overlay issue badge.
- Replaced loud success fallbacks in small inline components with the dark
  green/white semantic palette.

## Files changed

- `src/app/globals.css`
- `src/components/intelligence/world-intelligence-map.tsx`
- `src/components/intelligence/world-map-base.tsx`
- `src/components/intelligence/intelligence-hotspot-panel.tsx`
- `src/components/intelligence/intelligence-visual-icons.tsx`
- `src/components/pending-quotes-inline.tsx`
- `src/components/status-badge-toggle.tsx`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`
- Source sweep for disallowed bright palette tokens in `src/app`,
  `src/components`, and `src/lib`
- Browser smoke login with `admin@demo.local / admin1234`
- Desktop screenshots at 1440x900 for Pricing, Intelligence, and Email
  Settings
- Strict computed-color audit across `/dashboard`, `/dashboard/inbox`,
  `/dashboard/pricing`, `/dashboard/intelligence`, `/dashboard/customers`,
  `/dashboard/settings/email`, `/dashboard/admin`, `/dashboard/jobs`,
  `/dashboard/reports`, and `/dashboard/activity`: no warm tan/orange panels or
  loud red/green semantic fills detected.

## Caveats

- The CSS file still contains older overridden theme layers. This change adds a
  final discipline layer and patches high-risk inline/component colors. A later
  cleanup pass should delete the obsolete layers instead of continuing to stack
  overrides.
- During visual QA, the local Next dev cache corrupted under repeated hot reload
  and browser passes. Only generated `.next` output was cleared before starting
  a fresh dev server.

## Previous Update

## Date

2026-06-29

## Branch

main

## Commit

not committed

## Task implemented

Gmail historical sync and hourly refresh hardening:

- Changed Gmail sync from one newest-page yearly scan to a two-lane flow:
  recent sync runs immediately, while historical sync is queued as monthly
  backfill windows for the last five years.
- Added `GMAIL_SYNC_WINDOW` background jobs so older Gmail threads are pulled
  progressively instead of depending on one large web request.
- Manual per-account sync and combined Derya inbox sync now enqueue historical
  backfill windows and report how many windows were queued.
- Hourly production refresh is configured through a GitHub Actions scheduler
  that calls the protected Gmail sync and background drain endpoints with
  `CRON_SECRET`. Vercel cron remains daily as a fallback because the current
  Vercel Hobby plan rejects hourly cron expressions.
- Post-sync AI automation is scoped to touched threads for recent/windowed
  syncs, so old backfill jobs do not repeatedly run AI over every unlinked
  thread in the office.

## Files changed

- `src/lib/gmail-sync.ts`
- `src/lib/gmail-sync-windows.ts`
- `src/lib/background-jobs.ts`
- `src/app/api/cron/background-jobs/route.ts`
- `src/app/dashboard/settings/email/page.tsx`
- `src/components/sync-account-button.tsx`
- `src/components/sync-derya-inboxes-button.tsx`
- `scripts/gmail-sync-windows.test.ts`
- `.github/workflows/hourly-gmail-sync.yml`
- `package.json`
- `vercel.json`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:gmail-sync-windows`
- `npm run test:gmail-oauth`
- `npm run test:email-labels`
- `npx tsc --noEmit`
- `npm run build`

## Caveats

- No live Gmail sync was run from this agent session. The next manual sync will
  enqueue historical window jobs; the hourly background cron then drains them.
- The GitHub Actions scheduler requires a repository secret named
  `CRON_SECRET` with the same value as production. If that secret is absent,
  the workflow will fail closed instead of running unauthenticated.

## Previous Update

## Date

2026-06-29

## Branch

main

## Commit

not committed

## Task implemented

Follow-up layout correction after visual QA:

- Fixed the dashboard agent suppression bug. `/dashboard` now suppresses the
  global agent only when an embedded workbench agent actually exists; empty or
  queue-only dashboard states fall back to the full-height global right dock.
- Tightened the collapsed-agent layout contract across sidebar routes. When the
  global agent is inactive, page content and cards fill the available width
  instead of leaving a reserved right-side gap.
- Fixed dashboard workbench padding so the embedded agent only reserves width
  while expanded; its collapsed state returns workbench padding to `0px`.
- Reworked the assistant header copy to the requested simple stack: `Agent`,
  `Desk Assistant`, `RFQs, target price, forwarder replies`.
- Replaced the text-heavy hide control with a visible `x` icon and made send
  arrows/close icons visibly white inside their buttons.
- Forced sidebar navigation icons to white in collapsed, hover, and active
  states.
- Calmed the decision queue surfaces: blocked proof/contract/action sections
  now stay white and use maroon only for the left warning edge and small labels,
  rather than filling whole panels with red/pink.
- Removed inline pink/green/beige fills from email setup gate rows; the rows are
  now white with status carried by the left edge and status text.

## Files changed

- `src/app/dashboard/settings/email/page.tsx`
- `src/app/globals.css`
- `src/components/agent-chat-widget.tsx`
- `src/components/job-conversation-panel.tsx`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`
- Local dev server at `http://localhost:3001`
- Browser smoke login with `admin@demo.local / admin1234`
- Desktop email settings at 1440x900: global agent open measured full viewport
  height with right dock width `461px`; after collapse, content margin-right was
  `0px`, page container width was `1382px`, and visible cards expanded to
  `1322px`.
- Desktop dashboard at 1440x900: embedded workbench agent open reserved
  `478.8px`; after clicking the `x`, workbench padding-right returned to `0px`
  and visible workbench cards expanded from `843px` to `1322px`.
- Dashboard fallback check: after removing the embedded workbench agent in the
  browser, the global agent appeared on `/dashboard`, set `agent-dock-open`, and
  measured full viewport height.
- Collapsed sidebar-route sweep for Inbox, Pricing, Intelligence, CRM, Email,
  and Admin: content margin-right stayed `0px`, page containers measured
  `1382px`, launcher overlay was present, and horizontal overflow stayed `0`.
- Color checks: sidebar icon computed color was white; blocked decision queue
  surface computed white with maroon inset edge; email setup gate computed white
  with maroon left edge.

## Caveats

- The current dev data has a focused workbench job, so the real dashboard empty
  state was verified by DOM-removing the embedded workbench agent and letting
  the new fallback observer take over. That is enough for this UI regression,
  but a seeded no-job fixture would be cleaner.
- This was a layout/color pass only. No schema migration, dependency change,
  live Gmail sync, or external ingestion was run.

## Previous Update

## Date

2026-06-29

## Branch

main

## Commit

not committed

## Task implemented

Workbench and global shell layout cleanup:

- Removed the manual sidebar toggle button. The desktop sidebar is now a narrow
  rail that expands on hover/focus and collapses back automatically.
- Reworked the global agent into a full-height right-side dock on non-workbench
  pages. It reserves width only while open; when collapsed, the page expands
  back into the available space and the launcher overlays the page.
- Reworked the dashboard workbench agent into a full-height right-side panel
  from the top of the viewport to the bottom. Its collapsed state returns the
  right-side width to the workbench and leaves only a compact overlay launcher.
- Added an authoritative walnut/navy/light blue/white visual layer with calm
  maroon and dark green semantic colors. This tones down the old bright red,
  bright green, tan, orange, and mixed-brown surfaces.
- Recolored the Gmail connect mark away from Google red and moved setup/status
  gate colors onto the shared app tokens.
- Toned down hard-coded Intelligence page source/control/map colors so they no
  longer fight the primary Derya palette.
- Fixed mobile overflow in the email settings WhatsApp environment grid.

## Files changed

- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/settings/email/page.tsx`
- `src/app/globals.css`
- `src/components/agent-chat-widget.tsx`
- `src/components/intelligence/intelligence-source-card.tsx`
- `src/components/intelligence/manual-market-ingestion-controls.tsx`
- `src/components/intelligence/world-intelligence-map.tsx`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsc --noEmit`
- Local dev server at `http://localhost:3001`
- Browser smoke login with `admin@demo.local / admin1234`
- Desktop dashboard check at 1440x900: sidebar rail measured 58px collapsed and
  236px on hover; embedded workbench agent measured full viewport height; after
  collapsing the agent, workbench padding-right returned to `0px`.
- Desktop email settings check at 1440x900: global agent measured full viewport
  height on the right; after collapsing it, page content expanded to the full
  available width with no reserved right gap.
- Mobile email settings check at 390x844: global agent fit the viewport and the
  page had no horizontal overflow after the environment-grid fix.

## Caveats

- The stylesheet still contains older legacy color layers below the app history.
  The new final layer is authoritative for the current UI, but a later cleanup
  pass should delete dead overridden CSS instead of letting the file keep
  accumulating sediment.
- Local Gmail OAuth env was not configured, so the real Gmail OAuth button did
  not render in the smoke session. The source no longer uses the red Google
  mark.
- No schema migration, dependency change, production build, live Gmail sync, or
  live external ingestion was run.

## Previous Update

## Date

2026-06-28

## Branch

main

## Commit

not committed

## Task implemented

Production Gmail OAuth redirect hardening:

- Added redirect URI normalization so a malformed env value pasted as
  `GOOGLE_REDIRECT_URI=https://...` is stripped before constructing the Google
  OAuth URL.
- Gmail OAuth start now prefers the current request origin for the callback
  URI, and the callback token exchange uses the callback request origin. This
  keeps `https://www.derya.ai` flows on `www` instead of losing the session on
  the apex domain.
- Added a public health diagnostic that reports the sanitized redirect URI plus
  whether the raw env still has the accidental `GOOGLE_REDIRECT_URI=` prefix.
- Added a focused config test covering the env-key prefix and quoted URL cases.

## Files changed

- `src/lib/gmail-oauth.ts`
- `src/app/api/auth/gmail/start/route.ts`
- `src/app/api/auth/gmail/callback/route.ts`
- `src/app/api/health/route.ts`
- `scripts/gmail-oauth-config.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:gmail-oauth`
- `npm run test:email-labels`
- `npx tsc --noEmit`
- `npm run build`

## Caveats

- This is a defensive app-side guard. Production should still fix the Vercel
  value for `GOOGLE_REDIRECT_URI` so the value is only the callback URL, not
  `GOOGLE_REDIRECT_URI=<url>`.
- The Google Cloud OAuth Web Client must contain the exact callback URL for
  each host operators use, especially
  `https://www.derya.ai/api/auth/gmail/callback`.

## Previous Update

## Date

2026-06-28

## Branch

main

## Commit

not committed

## Task implemented

Native Derya load/RFQ inbox setup for `mert@usederya.com` and
`oguzhan@usederya.com`:

- Added a shared Derya inbox manifest for the two expected Gmail accounts.
- The expected native inbox list defaults to `mert@usederya.com` and
  `oguzhan@usederya.com`, and can be extended in prod with
  `DERYA_LOAD_RFQ_INBOXES=addr1,addr2,addr3` without changing code.
- Added deterministic `load/*` workflow labels for synced mail:
  `load/rfq`, `load/customer`, `load/forwarder`, `load/note`,
  `load/linked`, and `load/related`.
- Gmail OAuth start now supports account-selection plus a `login_hint` for the
  targeted Derya inbox rows, so connecting the second Google account is less
  error-prone.
- Gmail sync still sweeps the last year and now excludes spam/trash explicitly.
  It stores safe workflow labels and Derya inbox metadata in the Company Brain
  email message payload/provenance without changing schema or writing secrets.
- `/dashboard/settings/email` now shows Mert and Oguzhan as first-class
  load/RFQ inboxes with connected/paused/missing status, per-account sync, and
  a combined `Sync Derya inboxes` action.
- `/dashboard/inbox` now warns when either Derya inbox is missing, adds a
  `Load/RFQ` filter, and shows `load/*` labels on thread rows and expanded
  messages.

## Files changed

- `src/lib/derya-inboxes.ts`
- `src/lib/email-workflow-labels.ts`
- `src/lib/gmail-oauth.ts`
- `src/lib/gmail-sync.ts`
- `src/app/api/auth/gmail/start/route.ts`
- `src/app/dashboard/settings/email/page.tsx`
- `src/app/dashboard/inbox/page.tsx`
- `src/components/sync-derya-inboxes-button.tsx`
- `src/components/thread-accordion.tsx`
- `src/app/globals.css`
- `scripts/email-workflow-labels.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:email-labels`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run test:brain`
- Local dev smoke at `http://localhost:3000`: `/dashboard/inbox` and
  `/dashboard/settings/email` redirect unauthenticated users to `/login`;
  `/api/auth/gmail/start?email=mert@usederya.com` now also redirects to
  `/login` instead of catching the auth redirect as a 500.

## Caveats

- I did not and cannot silently connect real Gmail accounts. Each account must
  complete Google OAuth consent from `/dashboard/settings/email`.
- Production should set `DERYA_LOAD_RFQ_INBOXES` before onboarding extra
  required inboxes beyond Mert/Oguzhan.
- No Gmail labels are modified in Google. The `load/*` labels are native Derya
  workflow labels derived from classifier/link state and stored in Derya memory
  payloads.
- No schema migration was added.

## Previous Update

## Date

2026-06-28

## Branch

main

## Commit

not committed

## Task implemented

Workbench visual refresh follow-up requested by founder:

- Reworked the dashboard topbar brand lockup to show `Derya Deal Desk` with
  `Freight Control Tower` subtitle.
- Added a route summary strip above the focused deal map with origin,
  destination, country flags, ETD/ETA, mode, and transit timing.
- Added a real map-backed route panel to the focused deal brief using full-world
  OpenStreetMap raster tiles, dynamic origin/destination markers, country flags
  for recognized ports/cities, sea-route waypoints, mode chip, attribution, and
  three zoomed route sections for long lanes.
- Replaced the static overview map with `src/lib/route-map-viewport.ts`, a
  shared Web Mercator viewport builder. Overview tiles, route line, markers,
  and zoom panels now come from the same fitted route coordinate system.
- Removed origin/destination cards from inside the map; those details stay in
  the compact route summary above the map.
- Added a final navy/white notebook visual layer over the older warm notebook
  palette, including gridline background, white panels, navy controls, and
  responsive mobile workbench ordering.
- Recolored the logo/app icon and the remaining sheet/focus/status surfaces
  away from the old tan/brown token set into navy/blue/white.
- Removed the desktop workbench max-width/fixed-agent gap so the main workbench
  expands to the agent rail instead of leaving a dead center strip.
- Added idempotent local demo map loads:
  `DEMO-MAP-001` Port Klang, MY to Istanbul, TR and
  `DEMO-MAP-002` Shanghai, CN to Mersin, TR.

## Files changed

- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/globals.css`
- `src/app/icon.tsx`
- `src/components/logo-mark.tsx`
- `src/lib/route-map-viewport.ts`
- `scripts/route-map-viewport.test.ts`
- `scripts/seed-map-example-loads.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run test:route-map`
- `npx tsx scripts/seed-map-example-loads.ts`
- Local dev server at `http://localhost:3000`
- Browser smoke login with `admin@demo.local / admin1234`
- Desktop browser checks for `DEMO-MAP-001` and `DEMO-MAP-002`: route summary
  includes expected origin/destination, map no longer renders origin/destination
  cards, overview and zoom route paths render with sea waypoints, all fitted
  OpenStreetMap overview/zoom tiles loaded, no broken map images, no console
  errors, and old brown/tan target-color scan returned zero hits in the
  requested sheet/focus/logo surfaces.
- Mobile screenshot check at 390px width for `DEMO-MAP-001`: route strip and
  map labels present, 8/8 tiles loaded, no route-strip/map overflow.

## Caveats

- The map panel uses public OpenStreetMap tile URLs directly. This is acceptable
  for local/product visual iteration, but production should use a proper map
  provider/account or cached tile strategy before serious traffic.
- Route geocoding is deterministic lookup-based for common demo lanes. Unknown
  locations fall back to a generic marker instead of calling a geocoder.

## Date

2026-06-22

## Branch

codex/lead-to-quote-batch

## Commit

not committed

## Task implemented

H1: Production Hardening and Live Intelligence Pilot Prep.

This sprint intentionally did not add a new product surface. It hardened the
company brain and market-intelligence plumbing before any live pilot or broader
agent autonomy.

Pre-hardening checkpoint:

- Phase 1 through Phase 2E were already present in the worktree.
- The worktree was heavily dirty before H1. Do not blindly stage unrelated
  files.
- Baseline `npx tsc --noEmit` passed before H1 edits.
- External intelligence remains advisory. It cannot mutate jobs, RFQs, quotes,
  prices, milestones, customer records, documents, or outbound messages.
- Do not run live Firecrawl ingestion during verification.

## Files changed

- `.env.example`
- `package.json`
- `src/lib/security/crypto.ts`
- `src/lib/security/html.ts`
- `src/lib/portal-token.ts`
- `src/lib/gmail-oauth.ts`
- `src/app/api/auth/gmail/callback/route.ts`
- `src/lib/portal.ts`
- `src/app/portal/[token]/page.tsx`
- `src/components/copy-portal-link.tsx`
- `src/lib/customer-notify.ts`
- `src/lib/agent-tools.ts`
- `src/lib/seed-demo-load.ts`
- `src/app/api/jobs/[jobId]/quote-pdf/route.ts`
- `src/lib/market-intelligence/firecrawl-client.ts`
- `src/lib/market-intelligence/ingest-firecrawl-source.ts`
- `src/lib/market-intelligence/scheduled-ingestion.ts`
- `src/app/api/cron/market-intelligence/route.ts`
- `scripts/security-hardening.test.ts`
- `scripts/audit-tenant-scope.ts`
- `scripts/firecrawl-smoke.test.ts`
- `scripts/scheduled-market-ingestion.test.ts`
- `scripts/market-doctor.ts`
- `docs/RUNBOOKS/MARKET_INTELLIGENCE_LIVE_PILOT.md`
- `docs/COMPANY_BRAIN.md`
- `docs/MARKET_INTELLIGENCE.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`
- `docs/AI_HANDOFF.md`

## Behavior added

- Gmail OAuth access/refresh token writes now use AES-256-GCM encryption in the
  existing `EmailAccount` token columns.
- `TOKEN_ENCRYPTION_KEY` is required for new encrypted OAuth token writes.
- Legacy plaintext OAuth token reads remain supported so local/dev databases do
  not immediately break; reconnecting or a successful refresh rewrites tokens
  encrypted.
- Public portal access no longer falls back from `portalToken` to `job.id`.
- New portal tokens use 32 random bytes encoded as 64 hex chars; legacy 32-hex
  real portal tokens still resolve.
- Quote PDF HTML escapes dynamic job, customer, route, and line-item values.
- Firecrawl search now requires `includeDomains`; broad web search is blocked
  at the client boundary.
- Firecrawl provider errors are sanitized before being thrown or stored in
  `MarketIngestionRun.error`.
- Scheduled market ingestion now requires
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` for live runs unless a
  mocked test fetch client is supplied.
- Firecrawl cron route fails closed when `CRON_SECRET` is unset.
- Direct live Firecrawl CLI requires both
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` and `--confirm-live`.
- Tenant-scope audit now supports `--strict`, `--json`, severity labels, and
  actionable hints.
- Market doctor reports hardening controls, source-domain gaps, risky broad
  fetch configs, sources exceeding limits, live toggle state, and key configured
  yes/no only.
- Added live-pilot runbook.

## New scripts

- `npm run test:security`

## Verification passed

- `npx prisma validate`
- `npm run db:generate`
- `npx tsc --noEmit`
- `npm run test:security`
- `npm run test:strategy`
- `npm run test:memory`
- `npm run test:memory-search`
- `npm run test:morning-brief`
- `npm run test:market-intelligence`
- `npm run test:market-impact`
- `npm run test:firecrawl`
- `npm run test:source-quality`
- `npm run test:scheduled-market-ingestion`
- `npm run memory:doctor`
- `npm run market:doctor`
- `npm run audit:tenant-scope`
- `npm run build`
- `npm run ai:handoff`

## Verification failed/skipped

- No live Firecrawl ingestion was run.
- No production database commands were run.

## Caveats

- No Prisma schema change was required for token encryption; encrypted blobs are
  stored in the existing token columns.
- Existing plaintext Gmail tokens are compatible. A successful refresh
  re-encrypts a legacy plaintext refresh token; reconnecting also stores
  encrypted values.
- `TOKEN_ENCRYPTION_KEY` must be backed up like any production secret. Losing it
  makes encrypted OAuth tokens unrecoverable.
- Live Firecrawl ingestion remains disabled by default and must start with
  dry-run plus one reviewed source.

## Recommended next step

Run the full H1 verification list, then pilot one official or carrier source in
dry-run mode before enabling any live scheduled ingestion.

## Checkpoint Plan For Dirty Worktree

Generated after inspecting:

- `git status --short`
- `git diff --stat`
- `git diff --name-only`
- `git branch --show-current`
- `git log -1 --oneline`

Current branch: `codex/lead-to-quote-batch`.

Current HEAD: `9727e55 feat: add integration setup gates`.

Tracked diff at inspection time: 37 files, roughly 6k insertions and 2.5k
deletions. Many Phase 1 through H1 files are still untracked. Do not make one
giant "company brain" commit unless you enjoy making future debugging worse.

### Logical File Buckets

Phase 1 memory plumbing:

- `prisma/schema.prisma`
- `prisma/migrations/20260621000100_company_brain_memory/migration.sql`
- `src/lib/memory/record-event.ts`
- `src/lib/memory/ingest-object.ts`
- `src/lib/memory/backfill.ts`
- `src/lib/memory/search-memory.ts`
- `scripts/backfill-company-brain.ts`
- memory write hooks in `src/lib/gmail-sync.ts`, `src/lib/whatsapp.ts`,
  `src/lib/google-sheets-sync.ts`, `src/lib/thread-actions.ts`,
  `src/lib/forwarder-drafts.ts`, `src/lib/customer-quote-drafts.ts`,
  `src/lib/agent-proposals.ts`, and
  `src/lib/commercial-strategy-persistence.ts`
- `scripts/memory-write-smoke.test.ts`

Phase 1.5 memory usefulness, doctor, and morning brief:

- `src/lib/memory/customer-dossier.ts`
- `src/lib/memory/morning-brief.ts`
- `scripts/memory-doctor.ts`
- `scripts/morning-brief.test.ts`
- memory sections in `src/lib/agent-chat.ts` and `src/lib/agent-tools.ts`

Phase 2A hybrid retrieval and evidence:

- `src/lib/memory/canonical-types.ts`
- `src/lib/memory/evidence.ts`
- `src/lib/memory/hybrid-search.ts`
- `src/lib/memory/relevance.ts`
- `scripts/memory-search.test.ts`

Phase 2B market intelligence:

- `prisma/migrations/20260622000100_market_intelligence/migration.sql`
- `src/lib/market-intelligence/source-registry.ts`
- `src/lib/market-intelligence/ingest-market-source.ts`
- `src/lib/market-intelligence/ingest-market-object.ts`
- `src/lib/market-intelligence/extract-market-signals.ts`
- `src/lib/market-intelligence/link-market-signals.ts`
- `src/lib/market-intelligence/market-tools.ts`
- `scripts/ingest-market-intelligence.ts`
- `scripts/market-intelligence-smoke.test.ts`

Phase 2C market impact review and feedback:

- `prisma/migrations/20260622000200_market_impact_review/migration.sql`
- `src/lib/market-intelligence/market-impact-review.ts`
- market review/feedback additions in `src/lib/market-intelligence/*`
- agent tool additions in `src/lib/agent-tools.ts`
- morning brief additions in `src/lib/memory/morning-brief.ts`
- `scripts/market-impact-review.test.ts`

Phase 2D Firecrawl connector and Research Inbox:

- `prisma/migrations/20260622000300_firecrawl_market_ingestion/migration.sql`
- `src/lib/market-intelligence/firecrawl-client.ts`
- `src/lib/market-intelligence/source-policy.ts`
- `src/lib/market-intelligence/ingest-firecrawl-source.ts`
- `src/app/dashboard/intelligence/page.tsx`
- `scripts/ingest-firecrawl-market-intelligence.ts`
- `scripts/firecrawl-smoke.test.ts`
- related CSS in `src/app/globals.css`

Phase 2E source quality and scheduled ingestion:

- `src/lib/market-intelligence/source-quality.ts`
- `src/lib/market-intelligence/scheduled-ingestion.ts`
- `src/app/api/cron/market-intelligence/route.ts`
- Research Inbox ranking changes in `src/app/dashboard/intelligence/page.tsx`
- agent/source-quality changes in `src/lib/agent-tools.ts` and
  `src/lib/agent-chat.ts`
- `scripts/source-quality.test.ts`
- `scripts/scheduled-market-ingestion.test.ts`

H1 hardening:

- `.env.example`
- `src/lib/security/crypto.ts`
- `src/lib/security/html.ts`
- `src/lib/portal-token.ts`
- `src/lib/gmail-oauth.ts`
- `src/app/api/auth/gmail/callback/route.ts`
- `src/lib/portal.ts`
- `src/app/portal/[token]/page.tsx`
- `src/components/copy-portal-link.tsx`
- `src/lib/customer-notify.ts`
- `src/lib/seed-demo-load.ts`
- `src/app/api/jobs/[jobId]/quote-pdf/route.ts`
- hardening changes in `src/lib/market-intelligence/firecrawl-client.ts`,
  `src/lib/market-intelligence/ingest-firecrawl-source.ts`,
  `src/lib/market-intelligence/scheduled-ingestion.ts`, and
  `src/app/api/cron/market-intelligence/route.ts`
- `scripts/security-hardening.test.ts`
- `scripts/audit-tenant-scope.ts`
- hardening additions in `scripts/firecrawl-smoke.test.ts`,
  `scripts/scheduled-market-ingestion.test.ts`, and `scripts/market-doctor.ts`
- `docs/RUNBOOKS/MARKET_INTELLIGENCE_LIVE_PILOT.md`

AI collaboration, docs, and handoff:

- `AGENTS.md`
- `docs/AGENTS.md`
- `docs/AI_COLLABORATION_PROTOCOL.md`
- `docs/AI_HANDOFF.md`
- `docs/CODEBASE_DEEP_DISCOVERY_REPORT.md`
- `docs/COMPANY_BRAIN.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`
- `docs/MARKET_INTELLIGENCE.md`
- `docs/NEXT_AGENT_TASK.md`
- `src/lib/AGENTS.md`
- `src/lib/memory/AGENTS.md`
- `src/lib/market-intelligence/AGENTS.md`
- `src/app/api/AGENTS.md`
- `prisma/AGENTS.md`
- `scripts/generate-ai-handoff.ts`

Pre-existing or cross-cutting app/UI changes needing careful review:

- `src/app/dashboard/admin/page.tsx`
- `src/app/dashboard/inbox/page.tsx`
- `src/app/dashboard/jobs/[jobId]/actions.ts`
- `src/app/dashboard/jobs/[jobId]/page.tsx`
- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/pricing/page.tsx`
- `src/app/dashboard/rfq/[inquiryId]/actions.ts`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `src/app/dashboard/rfq/new/page.tsx`
- `src/app/globals.css`
- `src/components/agent-chat-widget.tsx`
- `src/components/commercial-brain-engine-schematic.tsx`
- `src/components/commercial-decision-cockpit.tsx`
- `src/lib/commercial-strategy.ts`
- `src/lib/risk.ts`

Generated/build artifacts:

- No `.next`, `node_modules`, logs, local DB files, or build output appeared in
  `git status --short`.
- `.codex/rules/*.rules` are local agent rules. Commit them only if the team
  wants repo-local Codex rules.

### Risky Files

- Schema/migrations: `prisma/schema.prisma`, all
  `prisma/migrations/202606*.sql`.
- Env/script surface: `.env.example`, `package.json`.
- Auth/security: `src/lib/security/crypto.ts`, `src/lib/gmail-oauth.ts`,
  `src/app/api/auth/gmail/callback/route.ts`.
- Public portal: `src/lib/portal-token.ts`, `src/lib/portal.ts`,
  `src/app/portal/[token]/page.tsx`, `src/components/copy-portal-link.tsx`,
  `src/lib/customer-notify.ts`.
- Quote output: `src/app/api/jobs/[jobId]/quote-pdf/route.ts`.
- Firecrawl/live ingestion: `src/lib/market-intelligence/firecrawl-client.ts`,
  `src/lib/market-intelligence/ingest-firecrawl-source.ts`,
  `src/lib/market-intelligence/scheduled-ingestion.ts`,
  `scripts/ingest-firecrawl-market-intelligence.ts`.
- Cron: `src/app/api/cron/market-intelligence/route.ts`.
- Package scripts: `package.json`.

### Recommended Commit Sequence

Commit 1: `company brain memory foundation`

- Include: memory Prisma models/migration, `record-event`, `ingest-object`,
  `backfill`, initial memory write hooks, backfill script, memory smoke test.
- Reason: establishes canonical additive memory/event layer.
- Verify before/after: `npx prisma validate`, `npm run db:generate`,
  `npm run test:memory`, `npx tsc --noEmit`.
- Caveat: several write-hook files also contain later phase changes. Use
  patch-level staging, not blind file-level staging.

Commit 2: `memory retrieval evidence and morning brief`

- Include: canonical taxonomy, hybrid search, evidence helpers, customer
  dossier, morning brief, memory doctor, memory search test, agent memory tools.
- Reason: makes memory useful and auditable without vector search.
- Verify: `npm run test:memory-search`, `npm run test:morning-brief`,
  `npm run memory:doctor`, `npx tsc --noEmit`.
- Caveat: `src/lib/agent-tools.ts`, `src/lib/agent-chat.ts`, and
  `src/lib/memory/morning-brief.ts` are shared with market phases.

Commit 3: `market intelligence core pipeline`

- Include: `MarketSignal` migration/model, market source registry, ingest
  market source/object, signal extraction, signal linking, market agent tools,
  market smoke test.
- Reason: separates raw articles from operational intelligence.
- Verify: `npx prisma validate`, `npm run db:generate`,
  `npm run test:market-intelligence`, `npx tsc --noEmit`.
- Caveat: keep external intelligence advisory language in docs with this
  commit.

Commit 4: `market impact reviews and feedback`

- Include: market impact review migration, review/feedback service, agent
  review tools, morning brief review surfacing, market impact test.
- Reason: adds the human-review bridge between possible links and action.
- Verify: `npm run test:market-impact`, `npm run test:morning-brief`,
  `npx tsc --noEmit`.
- Caveat: do not mark any review `actioned` from automation.

Commit 5: `firecrawl research inbox and source quality controls`

- Include: Firecrawl client, source policy, ingestion runs, scheduled ingestion,
  market cron route, Research Inbox, source quality ranking, Firecrawl/source
  quality/scheduled tests, market doctor additions.
- Reason: controlled external intelligence pilot infrastructure.
- Verify: `npm run test:firecrawl`, `npm run test:source-quality`,
  `npm run test:scheduled-market-ingestion`, `npm run market:doctor`,
  `npx tsc --noEmit`.
- Caveat: do not run live ingestion as part of committing. Tests must stay
  mocked.

Commit 6: `harden secrets portal pdf and live ingestion gates`

- Include: token encryption, Gmail OAuth compatibility, portal token hardening,
  quote PDF escaping, Firecrawl broad-search/live gates, cron fail-closed,
  tenant audit improvements, security test, hardening runbook.
- Reason: production safety before live pilot or new autonomy.
- Verify: `npm run test:security`, `npm run test:firecrawl`,
  `npm run test:scheduled-market-ingestion`, `npm run audit:tenant-scope`,
  `npm run build`.
- Caveat: `TOKEN_ENCRYPTION_KEY` must be configured before Gmail reconnects or
  token refresh writes.

Commit 7: `AI collaboration docs and handoff`

- Include: collaboration protocol, discovery report, company brain docs,
  decisions, engineering log, handoff, AGENTS files, Codex rules only if
  intentionally repo-scoped.
- Reason: documents operating contract and next-agent context.
- Verify: `npm run ai:handoff`, `npx tsc --noEmit`.
- Caveat: docs should reference the actual commit hashes after commits exist.

### Files To Exclude Unless Explicitly Intended

- Any `.env`, real secrets, token dumps, logs, local DB files, `.next`,
  `node_modules`, and generated build output.
- `.codex/rules/*.rules` unless the team wants Codex rules in the repo.
- Dashboard/CSS/report/UI changes that cannot be tied to the phase they are
  staged with. The `globals.css` diff is huge; review it manually.
- Any live-ingestion output or local one-off script output.

## Gmail OAuth Token Encryption Compatibility Audit

Current behavior:

- `src/lib/security/crypto.ts` treats values starting with `enc:v1:` as
  encrypted AES-256-GCM payloads.
- Values without that prefix are treated as legacy plaintext and returned as-is
  by `decryptOAuthTokenFromStorage`.
- `getValidAccessToken` reads a legacy plaintext refresh token successfully.
- After a successful refresh, both the new access token and any legacy
  plaintext refresh token are stored encrypted.
- A Gmail account with no refresh token fails with:
  `Account has no refresh token (re-connect needed)`.
- Missing `TOKEN_ENCRYPTION_KEY` fails on encrypted writes/decrypts with:
  `TOKEN_ENCRYPTION_KEY is required to encrypt or decrypt OAuth tokens. Generate one with: openssl rand -base64 32`.

Production risk:

- Legacy plaintext rows are compatible, but they remain sensitive until a
  successful refresh or reconnect encrypts them.
- `TOKEN_ENCRYPTION_KEY` must be present and backed up before deployment. Lose
  it and encrypted OAuth tokens are unrecoverable.
- There is no standalone database migration/backfill script for existing
  plaintext tokens. The chosen approach is compatibility plus re-encryption on
  next refresh, because it avoids printing or bulk-touching secrets.

Recommendation:

- Use option B: compatibility path plus re-encryption on next successful
  refresh.
- Do not require all Gmail accounts to reconnect immediately unless production
  policy demands rapid removal of plaintext-at-rest rows.
- If production already has many Gmail accounts and strict compliance pressure,
  add an admin-only one-time migration script later. It must not log token
  values and must require `TOKEN_ENCRYPTION_KEY`.

## Controlled Live Firecrawl Pilot Result

Pilot source:

- `port-of-long-beach-news`
- Name: Port of Long Beach News and Press
- Trust: `OFFICIAL`
- Fetch type: `firecrawl_scrape`
- URL tested: `https://polb.com/port-info/news-and-press/`
- Allowed domains: `polb.com`
- Clamp: max results `3`, max pages `3`
- Office: `cmqlgbg1u0000rnztu66omsr0` / Istanbul Office

Environment/safety state:

- `FIRECRAWL_API_KEY` configured: yes
- `MARKET_INTELLIGENCE_PROVIDER` configured: yes (`firecrawl`)
- `MARKET_INTELLIGENCE_CRON_ENABLED`: disabled
- `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED`: disabled by default
- enabled fetchable source count: `0`
- risky broad fetch configs: `0`
- allowed-domain issues: `0`
- max results/pages configured: yes / yes
- daily budget configured: yes (`25`)
- database URL classification: local

Dry run:

- policy passed
- estimated pages/results: `3` / `3`
- candidate URL: `https://polb.com/port-info/news-and-press/`
- duplicate preview before live run: no existing candidate object
- expected write upper bound for this scrape source: one market update object,
  with derived signals/reviews depending on fetched content

Live run:

- Command used one explicit URL and temporary one-command live flag:
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true npm run market:ingest:firecrawl -- --office cmqlgbg1u0000rnztu66omsr0 --source port-of-long-beach-news --url https://polb.com/port-info/news-and-press/ --limit 3 --confirm-live`
- `MarketIngestionRun`: `cmqpc884m0001rn6hgs2ire2b`
- Status: succeeded
- Provider results consumed: `1`
- Source URLs accepted: `https://polb.com/port-info/news-and-press/`
- Source `KnowledgeObject`: `cmqpc8c7g0005rn6hhbbr00e2`
  (`market_update`)
- Derived signal `KnowledgeObject`: `cmqpc8c8k000irn6htd6si82i`
  (`market_signal`)
- `KnowledgeChunk` rows created: `2`
- `MarketSignal` rows created: `1`
- `MarketSignalLink` rows created: `11`
- `MarketImpactReview` rows created: `11`
- Provider errors: none

Feedback recorded:

- The scraped source page produced a bad operational interpretation from page
  navigation/social-link text. This is exactly the kind of thing the pilot was
  meant to catch.
- Dismissed `11` impact reviews.
- Recorded `8` `irrelevant` feedback entries for customer/job/RFQ impacts.
- Recorded `3` `wrong_link` feedback entries for bogus social-link lanes:
  `FlickrLinks -> Port of Long Beach Flickr`,
  `InstagramLinks -> Port of Long Beach`, and
  `Twitterlinks -> Port of Long Beach`.
- No review was marked `actioned`.
- No operational job, RFQ, quote, customer, milestone, message, or price record
  was mutated.

Doctor summaries after feedback:

- `memory:doctor`: unknown canonical rows `0`, legacy canonical rows `0`,
  events missing provenance `0`, duplicate source ids `0`, duplicate content
  hashes `0`.
- `market:doctor`: cron enabled `false`, live ingestion enabled `false`,
  enabled fetchable source count `0`, allowed-domain issues `0`, risky broad
  fetch configs `0`.
- `market:doctor`: pending `MarketImpactReview` rows `0`, dismissed `11`.
- `market:doctor`: signals with zero links `0`, high/critical signals with
  zero links `0`.
- Source quality for `port-of-long-beach-news` moved from `86/excellent` to
  `0/poor` because the pilot recorded `3` wrong links, `8` irrelevant impacts,
  and `11` dismissed reviews.

Product-surface observations:

- `/dashboard/intelligence` Research Feed has one Port of Long Beach research
  item, one signal, zero pending reviews, and eleven dismissed reviews.
- `/dashboard/intelligence` Market Signals still lists the derived critical
  port-disruption signal, but the source quality is `0/poor`.
- `/dashboard/intelligence` Impact Reviews default pending view should be empty.
- Morning Brief currently suppresses pending market impact reviews, but still
  includes the poor-quality high/critical signal in `market_intelligence` and
  as the top recommended market action. That is a real product defect: dismissed
  or poor-quality signals should be demoted or suppressed before they drive
  recommended actions.

Recommendation:

- Do not test a second source yet.
- Keep scheduled ingestion disabled.
- Before the next live source, fix extraction hygiene: strip navigation/footer
  text, require source pages to contain an article/advisory/date-like signal,
  block social-link-derived lanes, and make Morning Brief ignore or heavily
  demote signals whose source quality is poor or whose linked reviews were all
  dismissed.

## H2 Web Extraction Hygiene And Signal Suppression

Status:

- Implemented in the dirty worktree.
- Not committed.
- Live Firecrawl ingestion was not run during H2.
- Cron remains disabled.

What changed:

- Added deterministic content hygiene in
  `src/lib/market-intelligence/content-hygiene.ts`.
- Added signal suppression helpers in
  `src/lib/market-intelligence/signal-suppression.ts`.
- Preserved the failed Port of Long Beach pilot as
  `scripts/fixtures/market-intelligence/port-long-beach-news-index.bad.json`.
- Updated Firecrawl scrape requests to ask for cleaner main content:
  `onlyMainContent`, `removeBase64Images`, `blockAds`, and chrome
  `excludeTags`.
- Updated market ingestion so low-quality/index/navigation pages can be stored
  as Research Feed `KnowledgeObject` rows but cannot create `MarketSignal`,
  `MarketSignalLink`, or `MarketImpactReview` rows.
- Updated extraction and linking to ignore social/utility/footer/navigation URL
  text as lane/entity evidence.
- Updated Morning Brief, strategy context, lane/customer exposure tools, and
  agent market search so suppressed/poor-quality signals do not become
  recommended action.
- Updated `/dashboard/intelligence` so suppressed signals, dismissed reviews,
  and extraction-skipped research items remain visible for audit.
- Updated `market:doctor` to report low-quality skips, index/navigation
  classifications, suppressed signals, majority wrong-link/irrelevant signals,
  social-link lane candidates, and suppressed signals still appearing in Morning
  Brief.

Current H2 contract:

- Firecrawl cleanup helps, but Derya hygiene decides.
- Signal-eligible page types are `article`, `advisory`, `press_release`,
  `rate_update`, and `regulatory_update`.
- `index_page`, `navigation_page`, and `unknown` are research-only unless a
  future source-specific parser proves otherwise.
- Default signal extraction threshold is `contentQualityScore >= 60`.
- Rejected extraction stores `pageType`, `contentQualityScore`,
  `extractionStatus`, and rejection reasons on `KnowledgeObject.payload`.
- Rejected extraction records a `market.update.extraction_skipped` memory event.
- Morning Brief and strategy ignore signals from poor sources, rejected pages,
  low-quality content, closed-only review sets, majority wrong-link/irrelevant
  feedback, and signals without active pending/acknowledged impact work.

Important local evidence:

- Failed live source object: `cmqpc8c7g0005rn6hhbbr00e2`.
- Failed derived signal object: `cmqpc8c8k000irn6htd6si82i`.
- Failed run id: `cmqpc884m0001rn6hgs2ire2b`.
- The old bad signal is now suppressed from Morning Brief by source quality and
  review/feedback state.

Do next:

1. Do not test a second source yet.
2. Rerun the same `port-of-long-beach-news` source with the same `3` result /
   `3` page clamp.
3. Expected result: listing page stored as Research Feed, no fake
   `MarketSignal`, no social-link lanes, no impact reviews, no Morning Brief
   recommendation.
4. Only after that passes, test one official/regulatory/carrier/rate source.

Verification snapshot for H2 will be refreshed by `npm run ai:handoff` after
the final verification run.

## H2.1 Same-Source Firecrawl Regression Rerun

Status:

- Passed.
- Source tested: `port-of-long-beach-news`.
- Office: `cmqlgbg1u0000rnztu66omsr0` / Istanbul Office.
- URL tested: `https://polb.com/port-info/news-and-press/`.
- Clamp: max results `3`, max pages `3`.
- Live Firecrawl was run once for this exact source and URL.
- Cron remains disabled.
- No second source was tested.
- No operational job, RFQ, quote, customer, milestone, message, or price record
  was mutated.
- Historical bad pilot data was not deleted.

Safety state:

- `FIRECRAWL_API_KEY` configured: yes.
- `MARKET_INTELLIGENCE_PROVIDER` configured: yes.
- `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN` configured: yes.
- `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN` configured: yes.
- `MARKET_INTELLIGENCE_CRON_ENABLED` configured: yes, disabled.
- `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET` configured: yes.
- `TOKEN_ENCRYPTION_KEY` configured in this shell: no.
- `CRON_SECRET` configured: yes.
- Enabled fetchable sources: `0`.
- Risky broad fetch configs: `0`.
- Allowed-domain issues: `0`.

Dry-run / preview result:

- Candidate URL: `https://polb.com/port-info/news-and-press/`.
- Title: `News & Press - Port of Long Beach`.
- Published date: none.
- Page type: `index_page`.
- Signal eligible: false.
- Eligibility reason: `page_type_index_page`.
- Clean body length from preview wrapper: `0`.
- Expected research items: `1`.
- Expected extraction skipped: `1`.
- Expected `MarketSignal`: `0`.
- Expected `MarketSignalLink`: `0`.
- Expected `MarketImpactReview`: `0`.
- Duplicate check: existing research URL count `1`, matching the original bad
  pilot object.

Live run result:

- `MarketIngestionRun`: `cmqpkglvy0001rn99xnek5o3i`.
- Status: succeeded.
- Provider results consumed: `1`.
- Accepted URL: `https://polb.com/port-info/news-and-press/`.
- Research `KnowledgeObject`: `cmqpc8c7g0005rn6hhbbr00e2`; the existing object
  was updated idempotently rather than duplicated.
- `KnowledgeChunk` rows newly created: `0`; existing chunk updated.
- New `MarketSignal` rows from this run: `0`.
- New `MarketSignalLink` rows from this run: `0`.
- New `MarketImpactReview` rows from this run: `0`.
- Provider errors: none.
- Run metadata: `skippedExtractionCount: 1`.

Extraction state after rerun:

- Source object page type: `index_page`.
- `contentQualityScore`: `0`.
- `extractionStatus`: `rejected_low_quality`.
- `extractionRejectionReason`: `page_type_index_page`.
- Rejection reasons:
  - `page_type_index_page`
  - `content_quality_below_60`
  - `insufficient_clean_body_text`
- A new `market.update.extraction_skipped` memory event was recorded.

Doctor summaries:

- `memory:doctor`: unknown canonical rows `0`, legacy canonical rows `0`,
  events missing provenance `0`, duplicate source ids `0`, duplicate content
  hashes `0`.
- `market:doctor`: cron enabled `false`, live ingestion enabled `false`,
  provider configured `true`, enabled fetchable source count `0`, allowed-domain
  issues `0`, risky broad fetch configs `0`.
- `market:doctor`: market updates skipped for low quality includes
  `cmqpc8c7g0005rn6hhbbr00e2`.
- `market:doctor`: market updates classified as index/navigation includes
  `cmqpc8c7g0005rn6hhbbr00e2`.
- `market:doctor`: suppressed signals still appearing in Morning Brief: none.
- `market:doctor`: pending `MarketImpactReview` rows `0`, dismissed `11`.
- Source quality for `port-of-long-beach-news` remains `0/poor`, which is
  expected because the historical bad run still has wrong-link/irrelevant
  feedback.

Product-surface observations:

- Research Feed shows the Port of Long Beach research item for audit.
- The historical bad signal remains attached to that old research object, but
  it is suppressed with reason `source_quality_poor`.
- Agent market search returns no active Port of Long Beach signals and lists the
  historical signal only under suppressed signals.
- Impact Reviews have no pending work for Port of Long Beach; the eleven old
  reviews remain dismissed.
- Morning Brief market section has `0` market impact reviews and `0` market
  signals for this source.

H2.1 verdict:

- Passed. The same listing/index page is now research-only and did not create
  fake operational intelligence.
- Safe to run one second-source pilot next, preferably
  `maersk-news-advisories`, then `cbp-csms`, then
  `drewry-world-container-index`, then `port-of-los-angeles-latest-news`.
- Keep scheduled ingestion disabled. Do not enable cron until several sources
  and enough review feedback have been observed.

## Deployment Readiness Audit

Status:

- Audit completed on 2026-06-22.
- No files were staged or committed.
- No deployment was run.
- No live Firecrawl ingestion was run.
- No production database command was run.
- Product behavior was not intentionally changed; this entry is documentation
  only.

Repo state inspected:

- Branch: `codex/lead-to-quote-batch`.
- HEAD: `9727e55 feat: add integration setup gates`.
- Tracked diff at inspection time: 37 files, roughly 6k insertions and 2.5k
  deletions.
- The worktree is still heavily dirty. It contains tracked edits plus many
  untracked Phase 1 through H2.1 files. Do not use `git add .`.

Release buckets:

- Phase 1 memory foundation: Prisma memory models, memory ingest/event/search,
  backfill, memory write hooks, and memory smoke scripts.
- Phase 1.5 usefulness: memory doctor, customer dossier, morning brief, and
  agent memory context.
- Phase 2A retrieval/evidence: canonical taxonomy, hybrid search, relevance,
  and evidence helpers.
- Phase 2B market intelligence: `MarketSignal`, source registry, market object
  ingestion, signal extraction/linking, agent tools, and docs.
- Phase 2C review loop: `MarketImpactReview`, `MarketSignalFeedback`, review
  generation, feedback tools, and morning brief integration.
- Phase 2D Firecrawl/Research Inbox: Firecrawl client, source policy,
  `/dashboard/intelligence`, ingestion run tracking, and smoke tests.
- Phase 2E scheduling/source quality: scheduled ingestion controls, source
  quality scoring, ranked market sections, and doctor checks.
- H1 hardening: OAuth token encryption, portal token hardening, quote PDF HTML
  escaping, Firecrawl safety gates, tenant audit, and runbooks.
- H2/H2.1 extraction hygiene: page classification, content quality gates,
  social/footer stripping, suppression, failed-pilot fixture, and same-source
  regression evidence.
- Docs/handoff: `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`,
  `docs/COMPANY_BRAIN.md`, `docs/MARKET_INTELLIGENCE.md`,
  `docs/DECISIONS.md`, runbooks, and protocol docs.
- Generated/local exclude: `.env`, `.env.local`, `.next/`, `node_modules/`,
  `prisma/dev.db`, logs, and local `.codex/` state must not be committed.

Migration inventory:

- `20260621000100_company_brain_memory`: creates memory/source/object/chunk/
  mention/event/agent-memory tables.
- `20260622000100_market_intelligence`: creates market signal/link tables.
- `20260622000200_market_impact_review`: creates impact review and feedback
  tables.
- `20260622000300_firecrawl_market_ingestion`: creates ingestion run tracking
  and Firecrawl metadata support.
- The migration SQL is additive. No destructive `DROP` or column-removal
  statements were found.
- Critical deployment blocker: these migrations are not a full baseline for a
  fresh database. They reference existing tables such as `Office` and assume
  the pre-brain schema already exists. `prisma migrate deploy` is sufficient
  only against a database that already has the old application schema or a
  properly marked baseline. A clean staging database will fail without a
  baseline/stamping plan.
- Local `prisma migrate status` reported the four new migrations as not yet
  applied locally, while the local schema appears to exist through prior
  `db push` usage. That drift needs to be resolved before pretending the
  migration path is production-ready.

Package/deploy script notes:

- `build` runs `prisma generate && next build`.
- `postinstall` runs `prisma generate`, which is correct for Vercel-style
  dependency caching.
- `db:migrate` is `prisma migrate dev` and must not be used in production.
- `db:push` is guarded but remains a development command, not a production
  migration path.
- Market ingestion scripts exist but live ingestion stays gated behind explicit
  env flags and CLI confirmation.

Environment inventory:

- Required for preview/prod: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
  `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`,
  `NEXT_PUBLIC_APP_URL`, `ANTHROPIC_API_KEY`.
- Required if Gmail is enabled: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`.
- Required if transcription is enabled: `OPENAI_API_KEY`.
- Required if live market ingestion is enabled: `FIRECRAWL_API_KEY`,
  `MARKET_INTELLIGENCE_PROVIDER`, `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN`,
  `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN`,
  `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET`.
- Safe production defaults before broader rollout:
  `MARKET_INTELLIGENCE_CRON_ENABLED=false` and
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=false`.
- `.env.example` still needs cleanup before a polished release because several
  deployment-critical vars are referenced by code but not documented there:
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `CRON_SECRET`,
  `NEXT_PUBLIC_APP_URL`, and optional Firecrawl tuning vars.

Deployment blockers and risks:

- Blocker: migration baseline/history is not deployment-ready for fresh staging
  or production unless the target DB already has the pre-brain schema and the
  baseline is handled deliberately.
- Blocker: Vercel/project env vars need to be configured explicitly. Local
  build success does not prove preview/prod secrets exist.
- High risk: Gmail OAuth redirects must match Google Cloud OAuth exactly.
  Relying on preview URL fallbacks is asking for callback failures.
- Medium risk: `/api/cron/risk-scan` uses `x-cron-secret` or `?secret=`, while
  other cron routes accept Vercel-style `Authorization: Bearer`. It is gated,
  but the scheduled Vercel request may 401 unless adjusted or routed through the
  expected auth style.
- Medium risk: `/api/health` reports env presence and exposes the configured
  Gmail redirect URI. That is not a token, but it is more deployment detail
  than a public endpoint should ideally leak.
- Controlled risk: historical bad Port of Long Beach market data remains in the
  local DB for audit. It is suppressed from Morning Brief and strategy context.
- Controlled risk: existing plaintext Gmail tokens are supported and
  re-encrypted on refresh, but production must set and back up
  `TOKEN_ENCRYPTION_KEY`.

Verification run during this audit:

- Passed: `npx prisma validate`
- Passed: `npm run db:generate`
- Passed: `npx tsc --noEmit`
- Passed: `npm run test:security`
- Passed: `npm run test:strategy`
- Passed: `npm run test:memory`
- Passed: `npm run test:memory-search`
- Passed: `npm run test:morning-brief`
- Passed: `npm run test:market-intelligence`
- Passed: `npm run test:market-impact`
- Passed: `npm run test:firecrawl`
- Passed: `npm run test:source-quality`
- Passed: `npm run test:scheduled-market-ingestion`
- Passed: `npm run test:market-content-hygiene`
- Passed: `npm run test:market-signal-suppression`
- Passed: `npm run memory:doctor`
- Passed: `npm run market:doctor`
- Passed: `npm run audit:tenant-scope`
- Passed: `npm run build`
- Passed: `npm run ai:handoff`
- Passed after docs update: `npx tsc --noEmit`

Recommended deployment plan:

1. Create a release branch/checkpoint with patch-level staging by bucket. Do not
   stage local env files, generated output, local DBs, or `.codex/`.
2. Fix or formally document the Prisma baseline path. For a fresh staging DB,
   create/apply the pre-brain baseline or use Prisma's baseline/stamp workflow
   before these additive migrations.
3. Provision a staging database and run `prisma migrate deploy` there, not
   `migrate dev`, `db push`, or reset commands.
4. Configure Vercel preview env vars explicitly. Keep market cron/live
   ingestion disabled.
5. Deploy preview, run health checks, login/signup, dashboard load, Gmail OAuth
   callback smoke, portal token smoke, quote PDF smoke, memory/market doctor
   scripts against the intended DB, and cron auth smoke.
6. Only after preview passes, promote the same commit to production.
7. Keep scheduled market ingestion disabled until at least 3-4 sources and a
   meaningful review-feedback sample have been observed.

Rollback plan:

- If preview deploy fails before migrations: revert the deployment to the last
  known-good Vercel build and fix env/build issues locally.
- If migrations fail in staging: stop. Do not run `db push` or reset. Restore
  from DB snapshot if needed, fix the baseline/migration history, then retry
  `migrate deploy`.
- If app runtime fails after deploy: roll back Vercel to the previous
  deployment and keep the DB snapshot. The new memory/market tables are
  additive, so rollback mostly means old code ignores them.
- If Gmail encryption fails: ensure `TOKEN_ENCRYPTION_KEY` is present and
  unchanged. If encrypted tokens were written with the wrong key, affected
  accounts need reconnect.
- If market intelligence behaves badly: leave
  `MARKET_INTELLIGENCE_CRON_ENABLED=false` and
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=false`; use feedback/suppression
  instead of mutating operations.

Hard recommendation:

- Do not deploy this as-is to a fresh staging or production database. The code
  passes, but the database migration story is not clean enough yet. That is the
  boring part of shipping, and skipping it is how you buy yourself a stupid
  outage.

## D0 Prisma Migration Baseline And Release Packaging Prep

Status:

- Implemented on 2026-06-22.
- No files were staged or committed.
- No production database command was run.
- No live Firecrawl ingestion was run.
- Cron was not enabled.
- Runtime product behavior was not changed.

Files added or updated:

- `prisma/migrations/00000000000000_baseline_pre_brain/migration.sql`
- `prisma/migrations/migration_lock.toml`
- `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`
- `docs/DECISIONS.md`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

Baseline source:

- The baseline was generated from `9727e55:prisma/schema.prisma`, accessed as
  `git show HEAD:prisma/schema.prisma` before this D0 work was committed.
- HEAD at generation time was `9727e55 feat: add integration setup gates`.
- That schema contains the pre-company-brain freight CRM tables and does not
  contain `Knowledge*`, `MemoryEvent`, `AgentMemory`, `MarketSignal`,
  `MarketSignalLink`, `MarketImpactReview`, `MarketSignalFeedback`, or
  `MarketIngestionRun`.
- Current working-tree `prisma/schema.prisma` adds those memory and
  market-intelligence models. Later migrations continue to own those tables.

Migration order now verified:

1. `00000000000000_baseline_pre_brain`
2. `20260621000100_company_brain_memory`
3. `20260622000100_market_intelligence`
4. `20260622000200_market_impact_review`
5. `20260622000300_firecrawl_market_ingestion`

Disposable DB verification:

- A throwaway local Postgres database was created.
- `npx prisma migrate deploy` applied all five migrations in order.
- `npx prisma migrate diff --from-url <throwaway-url>
  --to-schema-datamodel prisma/schema.prisma --exit-code` returned
  `No difference detected.`
- The throwaway database was dropped.
- No production DB commands were run.

Deployment blocker status:

- The fresh-staging blocker is cleared, assuming deployment uses
  `prisma migrate deploy` with this migration history.
- Existing production still requires the baseline runbook. If production has
  the pre-brain schema but no Prisma migration history, first verify that it
  matches the baseline, then mark only
  `00000000000000_baseline_pre_brain` as applied with
  `npx prisma migrate resolve --applied
  00000000000000_baseline_pre_brain`, then run `npx prisma migrate deploy`.
- Do not run `db push`, `migrate dev`, or `migrate reset` in staging or
  production.

Exact staging path:

```bash
export DATABASE_URL="postgresql://..."
export DATABASE_URL_UNPOOLED="postgresql://..."
npx prisma validate
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

Exact existing-production baseline path:

```bash
export DATABASE_URL="postgresql://..."
export DATABASE_URL_UNPOOLED="postgresql://..."
git show 9727e55:prisma/schema.prisma > /tmp/derya-pre-brain-schema.prisma
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel /tmp/derya-pre-brain-schema.prisma --exit-code
npx prisma migrate resolve --applied 00000000000000_baseline_pre_brain
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

Caveats:

- The production baseline path assumes the existing production database really
  matches the pre-brain schema from `9727e55`. If the diff reports drift, stop.
- Code rollback does not roll back database schema.
- The next step is D1: create clean release commits from the dirty worktree.

## D1 Proposed Release Commit Plan

Status before staging:

- Branch: `codex/lead-to-quote-batch`.
- HEAD before D1: `9727e55 feat: add integration setup gates`.
- No push, deploy, production DB command, live Firecrawl run, or cron enablement
  is allowed during D1.
- Use explicit `git add -- <paths>` only. Do not use `git add .`.
- The first broad secret scan reported env var names and placeholder examples
  in docs/tests, not live-looking secrets. Continue with stricter real-secret
  scanning before staging.

Manifest buckets:

- A. Prisma baseline: `prisma/migrations/00000000000000_baseline_pre_brain`,
  `prisma/migrations/migration_lock.toml`,
  `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`.
- B. Memory foundation: memory Prisma migration, core memory ingest/event/
  backfill/search modules, backfill script, memory write hooks in existing
  Gmail/WhatsApp/Sheets/inquiry/job/quote/strategy flows, and memory smoke test.
- C. Memory usefulness/retrieval: customer dossier, morning brief, memory
  doctor, canonical taxonomy, hybrid search, relevance/evidence helpers,
  memory search/morning brief tests, and agent memory context/tool updates.
- D. Market intelligence core: `MarketSignal`, `MarketSignalLink`, market
  registry/policy, market source/object ingestion, extraction/linking, market
  tools, strategy/risk context hooks, and market intelligence smoke test.
- E. Impact review/feedback: `MarketImpactReview`,
  `MarketSignalFeedback`, review service, review/feedback tools, market impact
  tests, and doctor/reporting support.
- F. Firecrawl/Research Inbox: Firecrawl client, Firecrawl ingestion path,
  `MarketIngestionRun`, `/dashboard/intelligence`, Firecrawl smoke test, and
  live-pilot runbook.
- G. Source quality/scheduling: source quality ranking, scheduled ingestion,
  market cron route, source quality and scheduled ingestion tests, and ranked
  Research Inbox/Morning Brief behavior.
- H. Security/hardening: OAuth token encryption compatibility, portal token
  hardening, quote PDF escaping, Firecrawl/live-ingestion guards, tenant audit
  improvements, security tests, and Gmail token runbook.
- I. H2 hygiene/suppression: failed POLB fixture, content hygiene, signal
  suppression, extraction gates, social-link blocking, suppression labels, and
  H2 tests.
- J. Docs/protocol: AGENTS files, collaboration protocol, handoff/log,
  company-brain and market docs, decisions, deep discovery, next task, and
  intentionally repo-scoped `.codex/rules`.
- K. Excluded unless explicitly intended: `.env`, `.env.local`, `.next/`,
  `node_modules/`, local DB files, logs, raw secrets, and generated artifacts.

Commit plan:

1. `chore(db): add pre-brain prisma baseline`
   - Include baseline migration, migration lock, and baseline deployment runbook.
   - Why: clears fresh staging migration history.
   - Caveat: docs/log references are finalized in the docs commit to avoid
     patch-staging huge untracked handoff files.
2. `feat(memory): add company brain memory foundation`
   - Include memory models/migration, core memory write modules, backfill, and
     memory emitters across existing freight flows.
   - Caveat: some mixed files also contain later agent/market hooks; use the
     smallest coherent full-file staging where patch-staging is not practical.
3. `feat(memory): add dossiers, morning brief, retrieval, and evidence`
   - Include dossier, morning brief, memory doctor, canonical taxonomy, hybrid
     retrieval, evidence/relevance, memory tests, and agent memory usage.
4. `feat(market): add market intelligence signal pipeline`
   - Include market source/object ingestion, source registry/policy, signal
     extraction/linking, market tools, strategy/risk market context, and market
     tests.
5. `feat(market): add impact reviews and feedback loop`
   - Include review/feedback schema, review service, feedback tools, impact
     tests, and doctor support.
6. `feat(market): add firecrawl ingestion and research inbox`
   - Include Firecrawl client/ingestion, `MarketIngestionRun`, Research Inbox
     page/nav/styles, Firecrawl tests, and live-pilot docs.
7. `feat(market): add source quality and scheduled ingestion controls`
   - Include source quality, scheduled ingestion, market cron route, ranking
     behavior, and scheduling/source-quality tests.
8. `chore(security): harden tokens portal pdf and ingestion guards`
   - Include token encryption, portal token access, quote PDF escaping, live
     ingestion gates, tenant audit, `.env.example`, and security tests.
9. `fix(market): add extraction hygiene and signal suppression`
   - Include H2 content hygiene, suppression helpers, failed pilot fixture,
     extraction/link hygiene, suppression behavior, and H2 tests.
10. `docs: add ai collaboration handoff and deployment runbooks`
    - Include protocol docs, handoff/log/decisions, AGENTS files, runbooks, and
      repo-scoped Codex rules.

Verification after commits:

- Run the full D1 suite: `npx prisma validate`, `npm run db:generate`,
  `npx tsc --noEmit`, all memory/market/security tests, doctors, tenant audit,
  `npm run build`, and `npm run ai:handoff`.

## D2 Preview/Staging Deployment Prep

Status:

- Completed on 2026-06-22.
- Branch pushed: yes.
- Branch: `codex/lead-to-quote-batch`.
- Pushed head: `e9aa328 docs: add ai collaboration handoff and deployment runbooks`.
- Remote branch verified at `origin/codex/lead-to-quote-batch`.
- No production deploy was run.
- No production database command was run.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.
- Operational records were not mutated.

Repository checks:

- `git status --short`: clean before push.
- `git branch --show-current`: `codex/lead-to-quote-batch`.
- `git log --oneline -n 12`: release commit stack from
  `a9c48d9` through `e9aa328` is present.
- `npx tsc --noEmit`: passed before push.

Remote and Vercel status:

- Git remote: `origin` is the GitHub SSH remote for `mmturna/derya-crm`.
- Push succeeded with a fast-forward branch update from `9727e55` to
  `e9aa328`.
- Vercel CLI is not installed in this shell.
- No `.vercel/project.json` link file is present.
- Vercel Git integration could not be detected locally. If the Vercel project
  is connected to this GitHub repo, the branch push should create a Preview
  deployment. Check the Vercel dashboard under the Derya project deployments
  for branch `codex/lead-to-quote-batch`.
- Preview URL: not available from local tooling during D2.

Preview/staging environment status:

Local env presence was checked without printing values. This is not proof that
Vercel Preview env vars are configured, because Vercel CLI was unavailable.

| Variable | Local presence | Vercel Preview status |
| --- | --- | --- |
| `DATABASE_URL` | yes | unknown |
| `DATABASE_URL_UNPOOLED` | yes | unknown |
| `DIRECT_URL` | no | unknown |
| `TOKEN_ENCRYPTION_KEY` | no | unknown |
| `CRON_SECRET` | yes | unknown |
| `ANTHROPIC_API_KEY` | yes | unknown |
| `OPENAI_API_KEY` | yes | unknown |
| `GOOGLE_CLIENT_ID` | no | unknown |
| `GOOGLE_CLIENT_SECRET` | no | unknown |
| `GOOGLE_REDIRECT_URI` | no | unknown |
| `FIRECRAWL_API_KEY` | yes | unknown |
| `MARKET_INTELLIGENCE_PROVIDER` | yes | unknown |
| `MARKET_INTELLIGENCE_CRON_ENABLED` | yes, disabled | unknown |
| `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN` | yes | unknown |
| `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN` | yes | unknown |
| `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN` | yes | unknown |
| `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET` | yes | unknown |
| `DOCUMENT_STORAGE_DRIVER` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_BUCKET` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_REGION` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_ENDPOINT` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_ACCESS_KEY_ID` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_SESSION_TOKEN` | documented in `.env.example` | unknown |

Safe Preview market-intelligence values:

- `MARKET_INTELLIGENCE_CRON_ENABLED=false`
- `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN=3`
- `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN=3`
- `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN=1`
- `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET=25`

Database status:

- Local `DATABASE_URL` and `DATABASE_URL_UNPOOLED` point to a local Postgres
  database named `derya_crm_app`.
- No staging `DATABASE_URL` was explicitly available locally.
- Staging migration was therefore skipped. That is intentional. Do not run
  `migrate deploy` against an unknown database.
- For a fresh staging database, run:

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

- For an existing staging database with the pre-brain schema but no migration
  history, follow `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`. Do not stamp
  the baseline unless a diff proves the database matches the pre-brain schema.
- Do not use `db push`, `migrate dev`, or `migrate reset` for staging or
  production.

Build/deploy requirements:

- `postinstall` runs `prisma generate`.
- `build` runs `prisma generate && next build`.
- No live Firecrawl ingestion runs during install or build.
- No database migration runs during install or build.
- `vercel.json` contains cron entries for risk scan, Gmail sync, and
  background jobs. Market intelligence cron is not listed there and remains
  gated in code by env flags.

Preview smoke-test checklist once the Preview URL exists:

- App loads.
- Login works.
- `/dashboard` loads.
- `/dashboard/intelligence` loads.
- Research Feed, Market Signals, and Impact Reviews render.
- Customer and job pages load.
- Morning Brief renders without recommending suppressed market signals.
- Quote PDF route works.
- A valid portal token works.
- `job.id` as a portal token fails.
- Gmail OAuth callback URI matches the Preview URL or Gmail is intentionally
  production-only for this Preview.
- Cron routes reject unauthenticated calls.
- Market cron remains disabled.
- `npm run memory:doctor` and `npm run market:doctor` pass against staging if
  run from an environment configured for the staging database.

Blockers:

- Vercel Preview deployment status could not be verified locally because the
  Vercel CLI is unavailable and the repo is not locally linked with
  `.vercel/project.json`.
- Vercel Preview env var presence could not be checked locally.
- Staging migrations were not run because no explicit staging database URL was
  available locally.
- `TOKEN_ENCRYPTION_KEY`, Gmail OAuth vars, and Preview document-storage vars
  must be confirmed in Vercel before realistic Preview testing.

Recommended next step:

- Confirm Vercel Git integration created a Preview for
  `codex/lead-to-quote-batch`.
- Configure/verify Preview env vars with safe market-intelligence defaults.
- Run staging migrations only against a confirmed staging database.
- Then run D3 staging smoke tests.

## D3A-FIX Vercel Hobby Cron Compatibility

Status:

- Completed on 2026-06-22.
- Goal: unblock Vercel Preview deployment on a Hobby account after Vercel
  rejected a sub-daily cron expression before build.
- Production deploy was not run.
- Production database commands were not run.
- Live Firecrawl ingestion was not run.
- Market intelligence cron was not enabled.

Problem:

- Vercel rejected the project because Hobby accounts only allow cron schedules
  that run at most once per day.
- The invalid schedule was `/api/cron/background-jobs` with
  `*/10 * * * *`, which runs every ten minutes.

Change:

- Updated `vercel.json` so every configured cron runs no more than once per
  day.
- Kept existing cron auth behavior intact; routes still require `CRON_SECRET`
  checks in code.
- Market intelligence scheduled ingestion remains disabled by env and is not
  configured in `vercel.json`.

Cron schedules after the fix:

- `/api/cron/risk-scan`: `0 6 * * *`
- `/api/cron/gmail-sync`: `0 7 * * *`
- `/api/cron/background-jobs`: `0 9 * * *`

Operational note:

- Frequent background processing should move to Vercel Pro, an external
  scheduler, or a manual/operator-triggered sync path later. Do not sneak
  sub-daily schedules back into `vercel.json` while deploying on Hobby.

Verification:

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `npm run ai:handoff`: passed.

## D3B Preview Runtime, Env, Staging DB, And Smoke Test

Status:

- Run on 2026-06-22.
- Preview deployment status from founder input: Ready.
- Preview URL:
  `https://derya-crm-git-codex-lead-to-quote-batch-merts-projects-b132014b.vercel.app`
- Branch: `codex/lead-to-quote-batch`.
- Preview commit: `3ab82df`.
- Production remains old at `main @ 49d7154`.
- No merge to main was performed.
- No production deploy was run.
- No production database command was run.
- No live Firecrawl ingestion was run.
- Market intelligence cron was not enabled.
- No customer/supplier messages were sent.

Local release state:

- Worktree was clean before D3B docs were updated.
- Branch: `codex/lead-to-quote-batch`.
- Head commit: `3ab82df fix(deploy): make vercel crons hobby-compatible`.
- `npx tsc --noEmit`: passed.

Preview HTTP checks:

- `/`: `401 Authentication Required`.
- `/login`: `401 Authentication Required`.
- `/dashboard`: `401 Authentication Required`.
- `/dashboard/intelligence`: `401 Authentication Required`.
- `/api/health`: `401 Authentication Required`.
- Cron routes checked without secret also returned the Vercel deployment
  protection page before app-level cron auth could run.

Conclusion:

- Vercel has the deployment Ready, but the Preview is protected by Vercel
  deployment authentication. The app shell, login page, dashboard, intelligence
  page, health endpoint, and app-level cron behavior could not be verified from
  this unauthenticated shell.

Preview env readiness:

- Vercel CLI is not installed locally.
- The repo has no `.vercel/project.json` link.
- `/api/health` could not be reached because Preview deployment protection
  returns `401`.
- Therefore Preview env vars are `unknown` from this environment. Do not infer
  they are configured just because the deployment built.

| Variable | Preview status |
| --- | --- |
| `DATABASE_URL` | unknown |
| `DATABASE_URL_UNPOOLED` or `DIRECT_URL` | unknown |
| `TOKEN_ENCRYPTION_KEY` | unknown |
| `CRON_SECRET` | unknown |
| `ANTHROPIC_API_KEY` | unknown |
| `OPENAI_API_KEY` | unknown |
| `GOOGLE_CLIENT_ID` | unknown |
| `GOOGLE_CLIENT_SECRET` | unknown |
| `GOOGLE_REDIRECT_URI` | unknown |
| `FIRECRAWL_API_KEY` | unknown |
| `MARKET_INTELLIGENCE_PROVIDER` | unknown |
| `MARKET_INTELLIGENCE_CRON_ENABLED` | unknown |
| `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN` | unknown |
| `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN` | unknown |
| `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN` | unknown |
| `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET` | unknown |

Staging database migration status:

- Staging DB provider input: unknown.
- Confirmed staging DB separate from production: unknown.
- Founder confirmation that it is safe to migrate: not available in this run.
- Migrations were skipped intentionally.
- Do not run `migrate deploy` until `DATABASE_URL` is confirmed to point to a
  staging/preview database that is separate from production.
- Do not use `prisma db push`, `migrate dev`, or `migrate reset`.

Build/deploy assumptions verified from repo:

- `postinstall` runs `prisma generate`.
- `build` runs `prisma generate && next build`.
- No database migration runs during Vercel build.
- No live Firecrawl ingestion runs during build.
- `vercel.json` schedules all configured crons daily for Hobby compatibility.
- App cron routes require `CRON_SECRET` checks in code, although Vercel
  deployment protection prevented external unauthenticated route testing from
  reaching the app.
- Market intelligence cron remains env-gated and is not listed in
  `vercel.json`.

Manual smoke-test checklist once Preview protection access is available:

- App shell loads.
- Login page loads or dashboard redirects correctly.
- Login works with staging credentials only.
- `/dashboard` loads.
- `/dashboard/intelligence` loads.
- Research Feed section loads.
- Market Signals section loads.
- Impact Reviews section loads.
- Customer page loads.
- Job page loads.
- Morning Brief loads.
- Quote PDF route works.
- A valid portal token works.
- `job.id` as portal token fails.
- Gmail OAuth link/callback uses the expected Preview redirect URI, or Gmail is
  intentionally production-only for Preview.
- Cron routes reject unauthenticated calls after bypassing Vercel deployment
  protection.
- Market cron remains disabled.

Blockers:

- Preview deployment protection blocks unauthenticated smoke tests.
- Preview env var status is unknown without Vercel CLI/dashboard access or an
  accessible `/api/health`.
- Staging DB provider and production separation are unknown, so migrations were
  correctly skipped.

Recommended next step:

- Provide Vercel Preview access or a Vercel bypass token for smoke testing, or
  run the manual checklist in the Vercel-authenticated browser.
- Confirm Preview env vars in the Vercel dashboard without exposing values.
- Confirm staging DB provider and separation from production.
- Run `prisma migrate deploy` only after staging DB safety is confirmed.
- Proceed to H2.2 staging Firecrawl pilot only after Preview app boots,
  staging DB is migrated, `/dashboard/intelligence` loads, and smoke checks are
  clean.

## D3C-DB Preview Runtime Database Fix Attempt

Status:

- Run on 2026-06-22.
- Preview deployment is Ready, but runtime logs show the Preview app is
  connected to a database whose schema is older than the release branch.
- No merge to main was performed.
- No production deploy was run.
- No production database command was run.
- No migration was run.
- No `prisma db push`, `migrate dev`, or `migrate reset` command was run.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.

Root cause from Preview runtime logs:

- `PrismaClientKnownRequestError P2022`: `Inquiry.containerCount` does not
  exist in the current database.
- `PrismaClientKnownRequestError P2021`: table `public.AgentProposal` does not
  exist in the current database.
- This is a runtime database schema mismatch, not a Vercel build problem.

Local release state:

- Branch: `codex/lead-to-quote-batch`.
- Head commit: `3ab82df fix(deploy): make vercel crons hobby-compatible`.
- `npx tsc --noEmit`: passed.
- Worktree already had uncommitted D3B docs changes before D3C docs were
  appended.

Database target check:

- Local `DATABASE_URL`: configured, but points to local Postgres database
  `derya_crm_app`.
- Local `DATABASE_URL_UNPOOLED`: configured, but points to the same local
  database.
- Local `DIRECT_URL`: not configured.
- Local target appears staging/preview: no.
- Staging database provider input: not provided.
- Confirmed staging database separate from production: not provided.
- Founder confirmation it is safe to migrate: not available in this run.

Decision:

- Migrations were intentionally skipped. Running `prisma migrate deploy`
  without a confirmed staging database would be a blind database operation.

Preview env readiness:

- Vercel CLI is not installed locally.
- No `.vercel/project.json` link exists.
- Preview `/api/health` is still protected by Vercel deployment authentication.
- Preview env var status remains unknown from this shell.
- Local env status is not equivalent to Vercel Preview env status.

Preview HTTP check:

- `/`: `401 Authentication Required`.
- `/login`: `401 Authentication Required`.
- `/dashboard`: `401 Authentication Required`.
- `/dashboard/intelligence`: `401 Authentication Required`.
- `/api/health`: `401 Authentication Required`.

Required next step:

1. Create or identify a staging database that is explicitly separate from
   production.
2. Configure Vercel Preview `DATABASE_URL` and `DATABASE_URL_UNPOOLED` or
   `DIRECT_URL` to that staging database.
3. Confirm safe Preview env values without exposing secrets:
   `MARKET_INTELLIGENCE_CRON_ENABLED=false`,
   `MARKET_INTELLIGENCE_PROVIDER=firecrawl`, and conservative market limits.
4. Apply migrations only against the confirmed staging database:

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

5. Expected final diff: `No difference detected`.
6. Redeploy the Preview after env and migrations are correct.
7. Re-run smoke tests with Vercel Preview access or a bypass token.

If the staging database is existing/pre-brain with no migration history:

- Follow `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`.
- Generate the pre-brain schema from `9727e55`.
- Diff the existing DB against that schema.
- If drift appears, stop.
- Only if it matches, mark
  `00000000000000_baseline_pre_brain` as applied, then run
  `prisma migrate deploy`.

Current blockers:

- Staging DB provider/separation are not confirmed.
- Preview env vars cannot be inspected locally.
- Preview deployment protection blocks external smoke tests.
- Runtime schema mismatch remains until the Preview database is corrected and
  migrated.

Safe-to-proceed status:

- Safe to H2.2 staging Firecrawl pilot: no.
- Safe to production checklist: no.
- Safe next action: configure confirmed staging DB and Preview envs, then run
  migrations against staging only.

## P0 Production Cutover Prep With Fresh Office And Cherry-Pick Import

Status:

- Implemented on 2026-06-23.
- No production database commands were run.
- No production deploy was run.
- No merge to main was performed.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.
- No secrets were printed.

Files added:

- `scripts/create-production-office.ts`
- `scripts/export-office-cherry-pick.ts`
- `scripts/import-office-cherry-pick.ts`
- `scripts/validate-office-import.ts`
- `docs/RUNBOOKS/PRODUCTION_CUTOVER_CHERRY_PICK.md`

Files updated:

- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`

New package scripts:

- `npm run seed:production-office`
- `npm run export:office-cherry-pick`
- `npm run import:office-cherry-pick`
- `npm run validate:office-import`

Cutover model:

- Create a fresh Neon production database on the current schema with
  `prisma migrate deploy`.
- Create a new real Office/Admin with `npm run seed:production-office`.
- Export selected safe business data from the old database to JSON.
- Import that JSON into the new Office after a dry run.
- Validate the import before setting Vercel Production env vars and merging to
  main.

Safety model:

- Production office creation requires `ALLOW_PRODUCTION_OFFICE_SEED=1`.
- Cherry-pick import defaults to dry run and requires
  `ALLOW_CHERRY_PICK_IMPORT=1` plus `DRY_RUN=false` for writes.
- Export uses `OLD_DATABASE_URL`; import uses `DATABASE_URL`.
- Old Gmail OAuth tokens are never exported or imported.
- Sessions and password hashes are not exported.
- Old portal tokens are not exported. Jobs that had old portal tokens get new
  64-hex random tokens during import.
- Background jobs are not copied.
- Company-brain memory rows and market-intelligence rows are not copied.
- Agent proposals and forwarder draft send artifacts are not copied.
- Documents are metadata-only. Job document URLs are null; company document
  URLs use a `metadata-only://...` sentinel because the schema requires a URL.

Safe imported data:

- companies
- contacts
- company owner references by safe user email only
- activities
- quotes
- shipment records
- inquiries
- active jobs by default
- milestones
- document metadata
- carrier quotes
- forwarders
- lane rates
- margin profiles
- target price history

Email import:

- Off by default with `INCLUDE_EMAILS=false`.
- If enabled, email threads/messages are sanitized and imported without
  accounts, OAuth tokens, provider external IDs, Gmail message IDs, HTML bodies,
  or attachment URLs.

Verification:

- Refusal-path smoke checks for the new scripts: passed with expected guard
  errors and no writes.
- `npx prisma validate`: passed.
- `npm run db:generate`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `npm run ai:handoff`: passed.

## Go-Live Merge To Main

Status:

- Completed on 2026-06-23.
- PR #1, `codex/lead-to-quote-batch` -> `main`, was merged with a GitHub merge
  commit.
- Main moved from the old production commit `49d7154` to merge commit
  `debe8182d99f928793c0ba076cbe6d6d7c51346c`.
- The merge commit includes release commit
  `073cd434bff8358a3d660147094273ada5307014`
  (`chore(cutover): add production office and cherry-pick import tooling`).
- The release branch was not deleted.

Production safety:

- No database migrations were run during go-live.
- No `prisma db push`, `migrate dev`, or `migrate reset` command was run.
- Market intelligence cron remained disabled by environment configuration.
- No live Firecrawl ingestion was run.
- No secrets were printed.

Vercel:

- Production deployment should trigger from the `main` branch push/merge.
- Watch Vercel -> Deployments -> Production for source branch `main`.
- The latest production deployment should no longer point at `49d7154`.

Immediate smoke-test checklist:

- Production app loads.
- Login works for `mert@usederya.com`.
- Demo users remain disabled.
- `/dashboard` loads.
- `/dashboard/intelligence` loads without enabling market cron.
- Customer and job pages load.
- Quote PDF route works.
- A valid portal token works; `job.id` as portal token fails.
- Gmail OAuth uses the production redirect URI.
- Cron routes reject unauthenticated calls.
- Market intelligence cron remains disabled.

## Production Smoke Test After Go-Live

Status:

- Run on 2026-06-23 against `https://www.derya.ai`.
- Production deployment status from GitHub/Vercel status API: success /
  deployment completed.
- Production deployment commit from `/api/health`: `408261c`.
- This is newer than old production commit `49d7154` and includes the release
  merge plus the go-live docs commit.

Route smoke results:

- `/`: `307` redirect to `/login`.
- `/login`: `200`.
- `/dashboard`: `307` redirect to `/login`.
- `/dashboard/intelligence`: `307` redirect to `/login`.
- `/dashboard/jobs`: `307` redirect to `/login`.
- `/dashboard/customers`: `307` redirect to `/login`.
- `/dashboard/inbox`: `307` redirect to `/login`.
- `/dashboard/pricing`: `307` redirect to `/login`.
- `/dashboard/settings/email`: `307` redirect to `/login`.
- `/api/health`: `200`, `ok=true`.

Health check:

- `NODE_ENV=production`.
- `VERCEL_ENV=production`.
- `AUTH_SECRET`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, Gmail OAuth envs, and
  `CRON_SECRET` were reported configured by presence only.
- DB ping passed.
- Recent Prisma field checks passed for email threads, jobs, job documents,
  email messages, and background jobs.
- Background job backlog passed with `queued=0`, `failed=0`,
  `staleRunning=0`.

Auth and cron smoke:

- Demo login with `admin@demo.local / admin1234` failed and redirected to
  `/login?error=1`, as expected.
- Real admin login for `mert@usederya.com` was not tested because the password
  was not available in this shell.
- `/api/cron/market-intelligence` without `CRON_SECRET`: `401`.
- `/api/cron/background-jobs` without `CRON_SECRET`: `401`.

Runtime logs:

- Vercel CLI is not installed locally, so runtime logs were not directly
  available from this shell.
- No Prisma `P2021`/`P2022` or env errors appeared through `/api/health`; all
  health checks passed.

Safety:

- No database migrations were run.
- No `prisma db push`, `migrate dev`, or `migrate reset` command was run.
- No old-data import was run.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.

## Derya Brain Ops First Version

Status:

- Implemented on 2026-06-23 in the dirty worktree.
- This task adapted the attached Merlon-style prompt to Codex-native Derya
  conventions.
- No new Prisma schema was added because the repo already has the
  `Knowledge*`/`MemoryEvent`/`AgentProposal` company-brain substrate.

What changed:

- Updated root `AGENTS.md` with Brain Ops rules, prompt-injection handling,
  source citation expectations, and docs/test commands.
- Added `CONTEXT.md` canonical glossary.
- Added status-governed docs under `docs/current-state/`, `docs/brain/`,
  `docs/sops/`, `docs/agent-journal/`, `docs/templates/`, `docs/decisions/`,
  and `docs/gotchas.md`.
- Added `scripts/check-docs-fresh.ts` plus `npm run check:docs` and
  `npm run test:docs`.
- Added Brain Ops controlled service files:
  `src/lib/brain-ops/ingest.ts`, `src/lib/brain-ops/query.ts`, and
  `src/lib/brain-ops/types.ts`.
- Added `npm run test:brain` with `scripts/brain-ops.test.ts`.
- Added repo-scoped Codex skills in `.agents/skills/`.
- Added advisory local Codex hook files in `.codex/hooks/`.

Behavior:

- `applyBrainIngest` validates source payloads and creates a source
  `KnowledgeObject` plus reviewable `AgentProposal` rows.
- Calibration mode does not create final business records.
- Organization linking is exact normalized company-name matching only.
- Similar non-exact organization names stay unresolved.
- Commitments, decisions, risks, and open questions require source quotes
  unless explicitly manually entered.
- `query.ts` exposes read-only helper functions that return source metadata.

Verification passed:

- `npm run test:docs`
- `npm run test:brain`
- `npm run check:docs`
- `npx tsc --noEmit`

Skipped:

- No Prisma migration was generated.
- No production database command was run.
- No live Firecrawl ingestion was run.
- No UI/API routes were added yet.

Follow-up:

- Add an admin-only Brain Ops review surface or API routes that consume the
  existing `AgentProposal` rows.
- If first-class review state outgrows `AgentProposal`, add dedicated proposal
  tables then, with migration and UI semantics decided up front.

## Granola Meeting Notes In Brain Ops

Status:

- Implemented on 2026-06-23 in the dirty worktree.
- Goal: make pasted/exported Granola notes usable as source-backed context for
  company, RFQ, and job workflows without mutating operational records.

What changed:

- Added `granola_meeting_note` as a Brain Ops source type.
- Added `operational_refs` to Brain Ops payloads.
- Exact refs now resolve:
  - `company` by scoped id or exact name
  - `job` by scoped id or exact reference
  - `inquiry` by scoped id or exact subject
  - `contact` by exact email or full name within the office
- Resolved refs are stored on the source `KnowledgeObject` where applicable and
  as `EntityMention` rows.
- Added `getOperationalBrainContext` for customer/job/RFQ workflows to retrieve
  related Granola notes and other source-backed memory.
- Added CLI:

```bash
npm run brain:ingest:granola -- --office=<officeId> --file=<payload.json>
```

Behavior:

- Granola notes default to calibration mode.
- Notes can store full text in `source.raw_text` and a Granola/internal URL in
  `source.source_uri`.
- Bad or typoed operational refs remain unresolved instead of fuzzy-linking.
- Extracted commitments, decisions, risks, and open questions still require
  source quotes and become reviewable `AgentProposal` rows.

Verification passed:

- `npx tsc --noEmit`
- `npm run test:brain`

Skipped:

- No Prisma migration was generated.
- No production database command was run.
- No live external ingestion was run.

## Granola Brain Ops Hardening Pass

Status:

- Implemented on 2026-06-23 in the dirty worktree.
- Goal: make the existing Granola Brain Ops extension safer and more
  repeatable without redesigning the schema.

What changed:

- Exact duplicate payloads are now idempotent. Re-running the same Granola
  payload returns the existing source object and proposal rows.
- Granola notes now require either `source.raw_text` or `source.source_uri`.
- If `userId` is supplied to ingest, it must belong to the same `officeId`.
- Ambiguous exact matches for non-unique records, such as duplicate contact
  emails or duplicate RFQ subjects, remain unresolved instead of using
  first-row behavior.
- Added conservative support for id-only operational refs to email threads,
  email messages, job documents, and strategy assessments.
- Expanded `scripts/brain-ops.test.ts` around duplicate ingest, ambiguous refs,
  cross-office actor rejection, evidence-less Granola rejection, and scoped
  job-document refs.

Verification passed:

- `npm run test:brain`
- `npm run check:docs`
- `npm run test:docs`
- `npx tsc --noEmit`
- `npm run build`

Skipped:

- No Prisma migration was generated.
- No production database command was run.
- No live external ingestion or Firecrawl run was performed.
- No `.env` values were inspected or printed.

## Live Intelligence Map And Manual Ingestion UI

Status:

- Implemented on 2026-06-23 in the main-branch dirty worktree.
- Goal: make `/dashboard/intelligence` operationally usable in production
  without enabling scheduled ingestion or running local live Firecrawl from
  Codex.

What changed:

- Added `getIntelligenceMapData(officeId)` for deterministic world-map data.
- Added a local SVG world map, clickable hotspot panel, source cards, visual
  icons, and admin manual ingestion controls.
- Added a visible first-ingestion empty state so production does not look like a
  decorative empty dashboard when Research Feed / Market Signals / Impact
  Reviews are all empty.
- Added runtime readiness badges for Firecrawl, manual-live enablement, cron
  disabled state, provider, safe source count, and result/page clamps.
- Replaced the old permissive inline "Run one" action with an admin-only manual
  ingestion action.
- Manual live ingestion requires
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` and refuses to run while
  `MARKET_INTELLIGENCE_CRON_ENABLED=true`.
- Manual source allowlist is restricted to Maersk, Drewry WCI, CBP CSMS, and
  Port of Los Angeles. FreightWaves/JOC/media are not available by default.
- Manual pulls clamp to one source and three results/pages.
- Added a safe bundle action for Maersk + Drewry WCI + CBP CSMS only.

Safety:

- No Prisma migration was needed.
- No live Firecrawl ingestion was run locally.
- No scheduled market cron was enabled.
- External intelligence remains advisory and does not mutate jobs, RFQs, quotes,
  customers, milestones, prices, or messages.

Verification to run before deploy:

```bash
npx tsc --noEmit
npm run test:intelligence-map
npm run test:manual-market-ingestion-action
npm run test:intelligence-page-empty-state
npm run test:market-content-hygiene
npm run test:market-signal-suppression
npm run test:source-quality
npm run test:market-intelligence
npm run test:market-impact
npm run build
npm run ai:handoff
```

Production use:

- Ensure Vercel Production has
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` before using the live button.
- Keep `MARKET_INTELLIGENCE_CRON_ENABLED=false`.
- First manual source should be `maersk-news-advisories`.
- Review Research Feed, Market Signals, and Impact Reviews before acting.

## Intelligence Page Visibility Fix

Status:

- Implemented on 2026-06-23 after production screenshot review.
- Goal: make the live intelligence map and detail panels readable under the
  beige Derya production theme.

What changed:

- Added solid dark fallback backgrounds to the map shell, hotspot panel, metric
  cards, and source cards so global `background-image: none !important` theme
  rules cannot leave white text on beige panels.
- Increased foreground contrast for headings, summaries, recommended actions,
  affected work pills, source metadata, and metric labels.
- Added dark SVG text strokes behind map labels so hotspot text remains readable
  over route arcs and glowing pins.
- Brightened latitude/longitude labels and map grid contrast.

Verification:

- `npx tsc --noEmit`
- `npm run test:intelligence-map`
- `npm run test:intelligence-page-empty-state`
- `npm run build`

## Intelligence Map Accuracy And CBP Lane Validation

Status:

- Implemented on 2026-06-23 after production showed fake geography and CBP
  pseudo-lanes on `/dashboard/intelligence`.

What changed:

- Replaced the hand-drawn blob map with a local Natural Earth 1:110m land asset
  (`src/lib/market-intelligence/world-map-asset.ts`). This is an existing
  public-domain map dataset rendered offline; no external tile provider or live
  map API is used.
- Added deterministic freight geography in
  `src/lib/market-intelligence/lane-validation.ts` for known ports, regions,
  countries, and chokepoints.
- Valid lanes must normalize to known freight locations. Boilerplate phrases
  such as `Countdown`, `Welcome`, `Messaging Service`, `Updates`, `Search`, and
  `Archive` are rejected.
- CBP/regulatory extraction now models clean items as U.S. customs/compliance
  context unless clean article body evidence contains a validated freight lane.
- Map data, Morning Brief, strategy/agent market tools, and signal suppression
  now filter invalid lane links. Bad historical links remain visible as
  suppressed/audit data, not recommended affected work.
- Added guarded cleanup script:
  `ALLOW_MARKET_REVIEW_CLEANUP=1 npm run cleanup:bad-cbp-market-reviews`.
  It dismisses pending CBP pseudo-lane reviews and records `wrong_link`
  feedback; it does not delete records or mutate operational freight data.
- Added daily market cron entry in `vercel.json`:
  `/api/cron/market-intelligence` at `0 11 * * *`. Live execution still requires
  `CRON_SECRET` and `MARKET_INTELLIGENCE_CRON_ENABLED=true`.
- Daily automation defaults to one safe source/day, three pages/results, and a
  safe source rotation of Maersk, Drewry WCI, CBP CSMS, and Port of Los Angeles.
  FreightWaves/JOC/media are excluded.

Verification passed:

```bash
npx tsc --noEmit
npm run test:market-lane-validation
npm run test:market-signal-suppression
npm run test:intelligence-map
npm run test:scheduled-market-ingestion
npm run test:market-content-hygiene
npm run test:market-intelligence
npm run test:manual-market-ingestion-action
npm run test:source-quality
npm run test:market-impact
npm run test:firecrawl
npm run test:morning-brief
npm run market:doctor
npm run memory:doctor
npm run build
npm run ai:handoff
```

Safety:

- No live Firecrawl ingestion was run.
- No Prisma migration was needed.
- No cleanup was run against production.
- Keep `MARKET_INTELLIGENCE_CRON_ENABLED=false` until operators explicitly want
  the daily cron active.

## V2 Intelligence Map Visual QA

Status:

- Implemented on 2026-06-23 for the production Intelligence page readability
  and trust issue.

What changed:

- The Intelligence map now renders Natural Earth public-domain land geometry
  plus visible reference labels for continents, key freight ports, and
  chokepoints. This prevents the map from degrading into a dark decorative
  canvas when few market signals are present.
- The map base was brightened with stronger coastline contrast and a darker
  ocean background so white and cyan labels remain readable.
- Empty map copy now says: `Pull trusted market data to light up the map.`
- Hotspot evidence refs are collapsed behind a details control so operator
  actions and affected work remain the dominant text.
- The map regression test now asserts that the component uses the Natural Earth
  asset and includes port/chokepoint reference layers.

Cleanup:

- Production CBP cleanup was not run from the local shell because
  `DATABASE_URL` was not configured and therefore could not be confirmed as the
  production Neon database. Use this only after explicitly exporting the
  confirmed production URL:

```bash
ALLOW_MARKET_REVIEW_CLEANUP=1 npm run cleanup:bad-cbp-market-reviews
```

Verification:

- `npx tsc --noEmit`
- `npm run test:intelligence-map`
- `npm run test:market-lane-validation`
- `npm run test:market-signal-suppression`
- `npm run test:market-content-hygiene`
- `npm run test:source-quality`
- `npm run test:market-intelligence`
- `npm run test:market-impact`
