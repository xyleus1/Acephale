# PR 270 runtime test plan (Settings mail log, in-query filters)

Commit under test: 4580219 (working tree == origin/devin/1787645750-settings-mail-log).
Code read: `src/app/dashboard/settings/log/page.tsx` (summary counts lines 47-53, filter form 54-66,
header row 76-84, empty state 85-91, `<details>` row 92-124), `src/lib/admin-mail-log.ts`
(`mailLogMessageWhere` lines 41-70, `workflowReferencesMatchingSearch` 95-112, `loadMailLog` 136-150),
`src/app/dashboard/settings/settings-header.tsx` (nav lines 34-56, `Log` entry 50-52),
`src/app/dashboard/admin/page.tsx` (`if (tab === "mail") redirect("/dashboard/settings/log")` line 130),
`src/lib/email-account-access.ts` + `src/lib/email-account-policy.ts` (gate: role must be ADMIN,
otherwise redirect to `/dashboard/supply-os`).

No email is sent at any point. `POST /api/admin/procurement-bulk-rfq` is never called.

Local fixture in office `office-demo-testing` (6 rows, newest first):

| when (UTC) | direction | company | outreach | line item | subject |
|---|---|---|---|---|---|
| 2026-08-24 11:00 | Sent | Anadolu Kalip Ltd | Procurement | Sourcing request 12345678 | Quotation request: CNC machined brackets [RFQ 12345678] |
| 2026-08-24 10:20 | Received | Derya Demo Procurement Lab | Procurement | Hydraulic external gear pumps | RE: Quotation request: Hydraulic external gear pumps [RFQ b21f1e6f] |
| 2026-08-24 10:00 | Sent | Derya Demo Procurement Lab | Procurement | Hydraulic external gear pumps | Quotation request: Hydraulic external gear pumps [RFQ b21f1e6f] |
| 2026-08-24 09:00 | Sent | Not linked | Procurement | Sourcing request deadbeef | Quotation request: mystery item [RFQ deadbeef] |
| 2026-08-24 08:30 | Received | Kayseri Lojistik AS | Sales | Not applicable | RE: Istanbul to Hamburg FCL rate confirmation |
| 2026-08-24 08:00 | Sent | Kayseri Lojistik AS | Sales | Not applicable | Istanbul to Hamburg FCL rate confirmation |

A second office `office-other-testing` holds one row with subject
"Archive check ZEPPELINWIDGET rate sheet" that must never appear in this office's log.
Workflow order `b21f1e6f-474c-469a-91df-d04595d1b3f6` = "Hydraulic external gear pumps" for company
"Derya Demo Procurement Lab" (local SSL replica, `dashboard_api` role). `12345678` and `deadbeef`
have no workflow order on purpose.

## T1 It should show a `Log` tab in Settings and no `Channels` tab
- Steps: on `/dashboard/settings/log` read the Settings nav; click `Integrations`, read the nav again.
- Pass: nav reads exactly Customers, Integrations, Connected emails, Log on both pages, `Log` is the
  current tab on the log page, and the string "Channels" appears nowhere in the nav or page.
- Fail: `Channels` still present, or `Log` missing on any settings page.

## T2 It should render the header row and correctly mapped seeded rows
- Steps: read the table on `/dashboard/settings/log`.
- Pass: header reads When, Direction, Company, Outreach, Line item, Email account, Subject; exactly 6
  rows in the order of the table above, values matching every cell of that table (in particular the
  `b21f1e6f` rows resolve Company "Derya Demo Procurement Lab" and Line item
  "Hydraulic external gear pumps" from the workflow DB, `12345678`/`deadbeef` fall back to
  "Sourcing request 12345678"/"Sourcing request deadbeef"); summary reads Logged 6, Sent 4,
  Received 2, Procurement 4; the other office's ZEPPELINWIDGET row is NOT listed.
- Fail: any column missing, wrong Sent/Received tag, workflow rows falling back to "Not linked",
  wrong counts, or a foreign-office row present.

## T3 It should expand a row and expose body plus deep link only when the reference resolves
- Steps: click the subject cell of the 2026-08-24 10:00 outbound `b21f1e6f` row, then of the
  `[RFQ 12345678]` row.
- Pass: `b21f1e6f` row expands natively and shows To `sales@ningbo-hydraulics.example`, Account
  `rfq@usederya.com`, the subject, body text containing "hydraulic external gear pumps for a European
  buyer", and a link "Open in procurement messages" whose href is
  `/dashboard/supply-os?panel=materials&procurementOrder=b21f1e6f-474c-469a-91df-d04595d1b3f6`.
  The `[RFQ 12345678]` row expands and shows To `quotes@anadolukalip.example` plus body
  "Please quote 500 CNC machined brackets", with NO deep link (no matching workflow order).
- Fail: row does not expand, wrong To/From label, empty body, missing link on the linked row, or a
  link present on the unmatched row.

## T4 It should deep link into the Supply OS sourcing request
- Steps: click "Open in procurement messages" in the expanded `b21f1e6f` row.
- Pass: URL becomes `/dashboard/supply-os?panel=materials&procurementOrder=b21f1e6f-474c-469a-91df-d04595d1b3f6`,
  no error screen, and the sourcing request "Hydraulic external gear pumps" (REQ-C0D4E523) is open
  automatically without further clicks.
- Fail: error page, queue list only, or a different request opened.

## T5 It should filter server side and keep the summary counts in step
Each case: type/select in the filter bar, click `Filter`, then read the URL, row list and counts.
- 5a search `Kayseri` (matches only the CRM company name): 2 rows, both Istanbul to Hamburg rows;
  counts Logged 2, Sent 1, Received 1, Procurement 0; URL contains `q=Kayseri`.
- 5b direction `Received` with search cleared: 2 rows (RE: gear pumps, RE: Istanbul to Hamburg);
  counts Logged 2, Sent 0, Received 2, Procurement 1; URL contains `direction=INBOUND`.
- 5c outreach `Procurement` (direction back to Sent and received): 4 rows, all with Outreach
  Procurement; counts Logged 4, Sent 3, Received 1, Procurement 4; URL contains `outreach=Procurement`.
- 5d outreach `Sales`: 2 rows, both Sales; counts Logged 2, Sent 1, Received 1, Procurement 0.
- 5e search `Derya Demo Procurement Lab` with both selects back to ALL. This string exists ONLY in the
  workflow database (no subject and no CRM Company row contains it), so it can only match through
  `workflowReferencesMatchingSearch`: expect exactly the 2 `b21f1e6f` rows, counts Logged 2, Sent 1,
  Received 1, Procurement 2.
- 5f search `zzzznope`: 0 rows and the copy "No mail matches this filter." (not the
  "No mail recorded yet." copy).
- Fail: any row count or summary number differing from the above, filtering happening only client
  side (URL without the query params), or the wrong empty-state sentence.

## T6 It should find a match that is older than the newest 150 rows (Review fix)
- Steps: 160 filler messages plus one archive row dated 2025-01-02 08:00 with subject "Archive check
  ZEPPELINWIDGET rate sheet" are inserted into the office ledger (shell, announced in the recording),
  so the archive row sits ~166 rows deep. Reload the log unfiltered, then search `ZEPPELINWIDGET`.
- Pass: unfiltered page shows only Filler traffic rows (archive row far outside the first page), and
  the search returns exactly 1 row: 2025-01-02 08:00, Sent, subject "Archive check ZEPPELINWIDGET
  rate sheet"; counts Logged 1, Sent 1, Received 0, Procurement 0. The identically named row in
  `office-other-testing` does NOT appear (office scoping holds under a filter).
- Fail: 0 rows returned (old behaviour: filtering only the newest 150), or 2 rows returned
  (office scoping broken).

## T7 It should remove the admin mail tab and redirect `?tab=mail`
- Steps: open `/dashboard/admin`, read the tab buttons; then open `/dashboard/admin?tab=mail`.
- Pass: no "Mail log" tab button on `/dashboard/admin`; `?tab=mail` ends on URL
  `/dashboard/settings/log` showing the Settings mail log page.
- Fail: mail tab still rendered, or `?tab=mail` renders an admin page / errors.

## T8 It should block a non-admin session
- Steps: sign out, sign in as `sales@usederya.com` (role SALES), navigate to `/dashboard/settings/log`.
- Pass: the mail log is never rendered; the browser ends on `/dashboard/supply-os` (redirect from
  `requireEmailAccountAdminSession`) and no mail rows or Log nav tab are visible.
- Fail: any mail row or the log page visible to SALES.

## T9 It should stay usable at 900px and 600px width and log no console errors
- Steps: with the admin session on `/dashboard/settings/log`, resize the browser window to about
  900px wide, then about 600px wide, and expand one row at the narrow size. Then read the browser
  console for the log page and the Supply OS deep-link page.
- Pass: at both widths the summary counts, filter controls and subject column stay readable and
  reachable (no content cut off with no way to reach it, no overlapping text), an expanded row still
  shows To/Account/Subject/body; console shows no React hydration mismatch and no uncaught errors.
- Fail: controls unreachable, table overlapping or clipped with no scroll, hydration warning, or an
  uncaught console error.

## Revision update: 7f29c56 (final commit under test)

Tested in an isolated `git worktree` at /home/ubuntu/pr270 (dev server on port 3010) because the main
checkout moved to an unrelated branch. Delta vs 4580219: the Sales outreach filter now keeps mail with
a NULL subject (`where.AND = [{ OR: [{ subject: null }, { NOT: { subject: { contains: "[RFQ " } } }] }]`).

Extra fixture: one INBOUND message with `subject = NULL` at 2026-08-24 07:00 (thread "(no subject)").
Office ledger is now 7 rows, so expected unfiltered summary is Logged 7, Sent 4, Received 3,
Procurement 4, and the Sales filter must return 3 rows (Logged 3, Sent 1, Received 2, Procurement 0)
including the subjectless row. T6 filler rows are re-inserted only for the T6 step.
