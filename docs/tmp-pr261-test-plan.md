# PR 261 runtime test plan (Mail Log + procurement deep link)

Scope: runtime UI verification only. No email sends. POST /api/admin/procurement-bulk-rfq is off limits.

Fixtures in local DB (office `office-demo-testing`): 2 procurement rows referencing RFQ `b21f1e6f`
(one SENT, one RECEIVED), 1 procurement row with an unmatched reference `deadbeef`, 1 sales row
(no RFQ token). Workflow order `b21f1e6f-474c-469a-91df-d04595d1b3f6` = "Hydraulic external gear pumps"
for company "Derya Demo Procurement Lab", served by a local SSL Postgres replica through the
`dashboard_api` role (same SQL/join as production).

## T1 It should show a Mail log tab with the required columns
- Steps: open /dashboard/admin, click the "Mail log" tab.
- Pass: tab is visible for the ADMIN session and, after clicking, the table header reads exactly
  When, Direction, Company, Outreach, Line item, Email account, Subject. Rows render newest first.
- Fail: tab missing, any column missing/renamed, or table empty despite seeded ledger rows.

## T2 It should classify procurement vs sales and resolve line item from the workflow DB
- Steps: read the four fixture rows.
- Pass: both `b21f1e6f` rows show Outreach = Procurement, Company = "Derya Demo Procurement Lab",
  Line item = "Hydraulic external gear pumps"; the `deadbeef` row shows Procurement with fallback
  Line item "Sourcing request deadbeef" and Company "Not linked"; the sales row shows
  Outreach = Sales, Line item = "Not applicable", Company = "Kayseri Lojistik AS".
- Fail: any misclassification, or the workflow-backed rows falling back to "Not linked".

## T3 It should expand a subject row natively and show counterparty plus body
- Steps: click the OUTBOUND procurement subject, then the INBOUND procurement subject, then the sales subject.
- Pass: expansion happens via native <details> (no JS error, works on click), outbound rows label the
  counterparty as "To: <recipient>", inbound rows as "From: <sender>", and the message body text is visible.
- Fail: row does not expand, wrong To/From direction label, or empty body where a body was seeded.

## T4 It should offer an "Open in procurement messages" link only on linked procurement rows
- Steps: inspect expanded content of the two `b21f1e6f` rows, the `deadbeef` row and the sales row.
- Pass: link present on both `b21f1e6f` rows with href
  /dashboard/supply-os?panel=materials&procurementOrder=b21f1e6f-474c-469a-91df-d04595d1b3f6;
  no link on the `deadbeef` row or the sales row.
- Fail: link missing on linked rows, wrong URL/order id, or link present on unlinked/sales rows.

## T5 It should deep link into the sourcing request in Supply OS
- Steps: click the link from the mail log.
- Pass: browser lands on /dashboard/supply-os?panel=materials&procurementOrder=b21f1e6f-...,
  materials panel is active, and the sourcing request workspace for "Hydraulic external gear pumps"
  opens automatically without extra clicks.
- Fail: stays on queue list, opens the wrong order, or errors out.

## T6 It should close the deep-linked request on Back and not reopen it (review fix)
- Steps: from the deep-linked request, click "Back to sourcing queue"; wait ~5s; observe.
- Pass: the request view closes, the sourcing queue is shown, and after waiting/re-render the request
  does NOT reopen. Navigating within the panel afterwards keeps the queue visible.
- Fail: request reopens by itself (deep link consumed more than once) or Back does nothing.

## T7 It should raise no hydration or console errors on either page
- Steps: after the flows above, read the browser console log for /dashboard/admin?tab=mail and the
  Supply OS deep-link page.
- Pass: no React hydration mismatch warnings and no page-breaking console errors.
- Fail: any hydration error, or uncaught exception attributable to the changed pages.
