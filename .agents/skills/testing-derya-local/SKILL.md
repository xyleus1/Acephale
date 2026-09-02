---
name: testing-derya-local
description: How to bring up derya-crm locally (app DB, workflow DB, login allow-list, Supply OS fixtures) so admin and Supply OS features can be tested end to end in a browser without touching production or sending email.
---

# Local runtime testing for derya-crm

## App database

- No Postgres is installed on the box by default. Start one in Docker, e.g.
  `docker run -d --name pgtest -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:16`,
  create a database (for example `derya_crm_app`), put the URL in `.env` as `DATABASE_URL`,
  then run `npx prisma migrate deploy && npx prisma generate`.
- `User` has a composite unique key `[officeId, email]`, so upserts must use
  `where: { officeId_email: { officeId, email } }`, and `fullName` is required (`name` does not exist).
- `UserRole` values are `ADMIN`, `MANAGER`, `SALES`, `EMPLOYEE` (there is no `MEMBER`).
- Passwords use scrypt via `src/lib/password.ts` (`hashPassword`), not bcrypt. Seed hashes with that helper.

## Login

- Sign-in is allow-list gated (`src/lib/login-code.ts`): only a few founder addresses work by default.
  For any seeded test user, start the dev server with
  `LOGIN_ALLOWED_EMAILS="mert@usederya.com,manager@usederya.com,sales@usederya.com"`.
- On `/login`, expand "Use password instead" and use the password form. The email-code path needs SMTP.
- There is no `/logout` route. Sign out through the avatar menu in the top-right header
  (present on `/dashboard/admin`, `/dashboard/leads`, and similar pages, but not inside the Supply OS shell).
- Role gating check: `SALES` is redirected away from `/dashboard/admin` to `/dashboard/supply-os`;
  `ADMIN` and `MANAGER` see the admin tabs.

## Workflow (procurement) database

- `src/lib/procurement-workflow.ts` requires `WORKFLOW_DATABASE_URL` to use username `dashboard_api`
  and an SSL `sslmode`. The org secret uses a different role, so procurement joins silently fall back
  (rows show "Not linked") because the loader catches the error. Do not weaken the role check.
- Workaround that works: `pg_dump` the public schema of the workflow DB into a second local Postgres
  container, create a `dashboard_api` role with SELECT on all tables, enable SSL in that container
  (self-signed cert, `alter system set ssl=on`), and point `WORKFLOW_DATABASE_URL` at it with `?sslmode=require`.
  `orders` and `bill_of_materials` are views over Prisma tables, so dump the whole schema, not single relations.
- IMPORTANT: Next.js does NOT override variables already present in the shell environment, so an org
  secret `WORKFLOW_DATABASE_URL` beats the value in `.env`. Start the dev server with the override
  inline: `WORKFLOW_DATABASE_URL="postgresql://dashboard_api:...@localhost:5433/...?sslmode=require" npm run dev`.
- Start the dev server with `setsid nohup ... &` (or a persistent shell) or it can die with the shell.

## Supply OS fixtures and deep links

- The Supply OS materials panel only mounts after a company/workspace is selected AND the workspace has a
  company profile. Without one you get "Company profile unavailable"; client effects such as the
  `?procurementOrder=` deep link never run. Use the "Enter profile" form on that screen to save a manual
  profile (company name plus website etc.), which avoids live research calls.
- Deep-link URL shape: `/dashboard/supply-os?panel=materials&procurementOrder=<full workflow order uuid>`.
  The mail log builds it from the full UUID while the subject only carries the first 8 hex chars.
- A procurement request only shows up in the queue if the workflow order's
  `request_context->source->workspace_id` matches the local `SupplyWorkspace` id (or, without a workspace id,
  campaign `CUSTOM` plus a matching company name).

- The `?procurementOrder=` deep link can land on the sourcing detail view stuck at the Compare stage
  ("0 supplier candidates", "Results are read-only while the shortlist is reviewed"), which has no
  conversation panel. Supplier threads and saved reply drafts live in the queue instead: click
  "Back to sourcing queue", then the "Messages" tab, then the request row, then the vendor in the
  Manufacturers list. Vendors default to the first one, so reselect the vendor you care about.
- Saved file-bearing drafts render inside the vendor thread as "Saved draft, not sent" with an
  "Attached request files" list, a "Files held back" list with reasons, and an editable subject/body.
  "Send reply" only opens a confirm prompt; never click "Confirm send" in a test run.

## Operator-secret admin endpoints (e.g. /api/admin/procurement-file-drafts)

- Auth is `operatorSecretAuthorized`: `x-cron-secret` header, `Authorization: Bearer <secret>`, or
  `?secret=`, compared timing-safe against `PROCUREMENT_BULK_RFQ_SECRET` or `CRON_SECRET`. Secrets
  shorter than 16 characters are ignored entirely, so a short configured secret means every request
  is 401. Start the dev server with the secret inline to test both accept and reject paths.
- These batch endpoints resolve an acting operator from the office (active ADMIN/MANAGER, non-portal),
  so the local office needs such a user or every vendor outcome fails.
- Office to workflow-customer mapping comes from `PROCUREMENT_CUSTOMER_MAP_JSON`; running a second
  server with a rival office mapped to the same customer id is a cheap cross-tenant leak test.
- Malformed (non-UUID) order ids may surface a raw Prisma "invalid input syntax for type uuid" 500
  instead of a 400/404; check whether validation was added before treating a 500 as a new defect.

## Testing a PR while the main checkout is in use

- If someone else is switching branches in `/home/ubuntu/repos/derya-crm`, create an isolated worktree
  (`git worktree add /home/ubuntu/prNNN <sha>`) and run a second dev server on another port
  (`PORT=3010 npm run dev`). Copy `.env` over and keep the inline `WORKFLOW_DATABASE_URL` override.
- After deleting or renaming an exported helper on the branch, restart the dev server and clear
  `.next/cache`, otherwise you get stale "X is not exported from ..." import errors.

## Settings mail log (/dashboard/settings/log)

- Gate is `requireEmailAccountAdminSession`: role must be `ADMIN`, anyone else is redirected to
  `/dashboard/supply-os`, and the Settings nav for that user only shows the tabs they may use.
- Filters are GET params `q`, `direction` (`ALL|INBOUND|OUTBOUND`), `outreach` (`ALL|Procurement|Sales`);
  you can drive every filter case straight from the URL bar.
- The page renders only the newest 150 office rows, but the search runs in the database, so verifying the
  review fix needs a fixture row older than 150 newer filler rows plus a same-subject row in another office
  to prove `officeId` scoping still holds.
- `EmailThread.subject` is non-null in Prisma, so a "no subject" fixture must set only
  `EmailMessage.subject = null`.
- Layout caution: the mail-log panel has `overflow-x: hidden` with a fixed grid wider than the panel, so
  below roughly 1000px the Subject column is clipped with no way to scroll to it. Check this at 900px and
  600px on any change to that table.

## Cold supplier follow ups and reconciliation (procurement-supplier-nudges)

- Endpoint `/api/admin/procurement-supplier-nudges` uses the operator secret. `GET ?orderId=` plans only,
  `POST {orderId, confirm: "SEND SUPPLIER FILES"}` sends, `POST {orderId, action: "reconcile"}` resolves
  uncertain reservations and needs no confirmation phrase. Pass the secret as a header, not `?secret=`,
  because the Next dev access log records the full query string.
- A follow up round is derived from the count of `RESERVED`/`RECORDED` `procurement-rfq-nudge:<order>:<round>:<vendor>`
  reservations, so seeding or deleting those rows is the fastest way to move a vendor between rounds.
  Deleting the recorded `EmailMessage` while leaving the reservation `RECORDED` does not reproduce
  `ALREADY_SENT`; that state is a defensive concurrency branch (an existing RECORDED reservation for the
  round being claimed) and is not reachable from a single sequential run.
- Duplicate protection is easy to prove for real: fire two confirmed POSTs at the same eligible vendor at
  once. One returns `SENT`, the other `BLOCKED` with "This pooled delivery is already in progress...",
  and exactly one message plus one captured `.eml` exists afterwards.
- Reconciliation only picks reservations whose `updatedAt` is older than 10 minutes and orders by
  `updatedAt ASC`. Prisma `@updatedAt` overwrites any value you set through the client, so backdate with
  raw SQL. An uncertain outcome increments `attemptCount`, which refreshes `updatedAt` and rotates the
  reservation to the back of the queue, so an immediate second reconcile call legitimately reports
  `reconciled: 0` while `remaining` still counts the slot.
- Local provider interception that works: map `smtp.gmail.com`/`imap.gmail.com` to 127.0.0.1 in
  `/etc/hosts`, run a STARTTLS SMTP sink on 587 and a fake IMAP server on 993 with a locally issued cert
  (SANs for both host names) and `NODE_EXTRA_CA_CERTS` pointing at the CA. Encode outcomes in addresses:
  a rejecting sender mailbox gives REJECTED, a recipient prefix returning 451 gives UNKNOWN, and a
  recipient prefix that holds DATA for 20 s opens a mid-run window for send-time recheck tests. Reconcile
  returns SENT only when a matching `Message-ID` file exists in the fake `\Sent` store, otherwise NOT_FOUND.
- Workflow fixtures: `order_vendors` is a view and cannot be updated directly (`permission denied for view`);
  update the underlying `"OrderSupplier"` table. `EmailMessage` has no `updatedAt` column, and
  `EmailThread` has no `accountId` (join through `EmailMessage.accountId`).

## Supply OS UI walkthroughs and audits

- Two independent supplier surfaces exist for the same request: the sourcing request detail (Compare) and
  Sales Agent > Messages. They load data differently, so check both. Messages loaded a 164-vendor request
  reliably while the request detail for the same id never fetched at all.
- Requests in `awaiting_shortlist_approval` must load their detail: watch `/tmp/dev.log` for
  `GET /api/procurement/requests/<id>`. Supplier counts stay hidden until that response lands, and a
  failed or aborted first fetch must show "Supplier results did not load" with a retry, never a disabled
  "Refreshing" button with zeros. Approval statuses are part of `PROCUREMENT_POLLING_STATUSES`.
- Chat "Run research" (context prospecting) cannot complete without Firecrawl/OpenAI keys, so use it to
  check the escape paths: Dismiss stays enabled while a run is tracked, the card reports rows saved against
  the target, and a run with no progress past the stale threshold offers a retry after a reload.
- Resize for responsive checks with `wmctrl -r :ACTIVE: -e 0,0,0,<width>,<height>` (remove the maximized
  flags first) and re-maximize with `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`.
- To force the honest detail-failure state, `docker stop pgworkflow`, open the request from the queue, then
  `docker start pgworkflow`, wait for `docker exec pgworkflow pg_isready`, and click "Try again". The
  workflow-backed endpoints answer 503 while the container is down, which is the fastest adversarial setup.
- Prospecting action cards are `CompanyContext` rows with `kind='ACTION'` (there is no ContextProspectingRun
  table). Reset one to PENDING or fake a stale RUNNING run by editing `payload->>'status'` and
  `payload->>'runningStartedAt'` (set it ~20 minutes in the past) plus `"processingState"`, then reload.
- A vendor's workflow `order_vendors.status` (often bulk-set to `contacted`) is not the same as a Gmail
  contact receipt. Compare renders the raw status while Messages renders receipts, so the two surfaces can
  still disagree for the same vendor. Query
  `procurement_communication_messages` joined to `order_vendors` to learn which vendors really have traffic
  before calling a mismatch a bug.
- The queue row's Source state `title` tooltip can still read "0 supplier candidates are ready for review"
  for a request whose detail loads hundreds of candidates: the queue list payload has no supplier counts.
- Do not judge run-on numbers from the DOM dump: JSX whitespace is stripped in the annotated DOM, so
  `100units` in the DOM renders as `100 units`. Zoom on the screenshot before reporting spacing bugs.

## Off limits

- `POST /api/admin/procurement-bulk-rfq` performs a real Gmail send. Never call it during testing;
  use the `?drafts=1` preview and the read-only replies endpoint instead.

## Devin Secrets Needed

- `WORKFLOW_DATABASE_URL` (read-only workflow DB, wrong role for the app's check, still usable for dumps).
- Optional: a real `dashboard_api` connection string would remove the need for the local replica.
