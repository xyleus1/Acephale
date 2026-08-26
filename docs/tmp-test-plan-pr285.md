# PR #285 runtime test plan (operator file-draft batch command)

Environment already up (setup, not part of the plan): repo checkout at `abb68f7` (main, PR #285),
dev server A on `http://localhost:3013` started with inline
`PROCUREMENT_BULK_RFQ_SECRET="local-file-draft-operator-secret-32"` (35 chars) and the local
`WORKFLOW_DATABASE_URL` (dashboard_api, sslmode=require). App DB `derya_crm_app` on pgtest,
workflow replica `workflow_replica` on pgwf. Order under test
`b21f1e6f-474c-469a-91df-d04595d1b3f6` (REQ-C0D4E523, Hydraulic external gear pumps, 100 pumps,
needed by 2027-01-11), 3 cited documents (bom.csv safe, bracket.stl safe, portal-notes.csv sensitive).
Seeded vendor states: Kawasaki/Hydac/Parker QUESTION pending, Bosch QUESTION already drafted,
Marzocchi WRONG_RECIPIENT, Casappa AUTO_REPLY, Danfoss BOUNCE, Eaton newest message OUTBOUND.
Rival office `office-rival` with an active ADMIN operator exists in the app DB for the
cross-tenant step. No email may be sent; the bulk RFQ send endpoint is never called.

Baseline capture before step 1: row counts of `SupplyExecutionTask`,
`SupplyExecutionEvent`(or supplier communication events), `EmailMessage`, `EmailSenderReservation`,
and `procurement_communication_messages`.

## 1. Auth rejection (no writes)
Actions: against :3013 `GET /api/admin/procurement-file-drafts?orderId=<order>` with (a) no secret,
(b) `x-cron-secret: wrong-value-not-the-secret`, (c) `?secret=` empty; and
`POST` with no secret. Then start server B on :3014 with `PROCUREMENT_BULK_RFQ_SECRET="short8"`
(8 chars, below the 16 minimum) and no CRON_SECRET, and call GET/POST supplying exactly `short8`.
Pass: every call returns 401 `{"error":"Unauthorized"}`; after all of them the baseline row counts
are unchanged (no new tasks, events, email rows, or workflow messages).
Fail: any 200/500, or any row count increases.

## 2. Auth acceptance through all three transports
Actions: GET the preview three times with (a) `x-cron-secret` header, (b)
`Authorization: Bearer <secret>`, (c) `?secret=<secret>`.
Pass: all three return 200 with identical payloads.
Fail: any non-200 or divergent payload.

## 3. GET preview matches the seeded conversations
Actions: read the 200 payload from step 2.
Pass: `replied=7`, `pending=3`, `drafted=1`, `skipped=3`; Marzocchi `WRONG_RECIPIENT`,
Casappa `AUTO_REPLY`, Danfoss `BOUNCE` each carry a non-null `skipReason`; Bosch has
`hasDraft: true` and is counted in `drafted` not `pending`; Kawasaki, Hydac, Parker have
`skipReason: null` and `hasDraft: false`; Eaton (vendor `1111...`) is absent from `targets`
because its newest message is OUTBOUND.
Fail: any count off, any skip reason missing/incorrect, Eaton present, Bosch counted as pending.

## 4. POST respects limit and drafts only eligible vendors
Actions: `POST {orderId, limit: 2}`.
Pass: 200 with `drafted=2`, `failed=0`, `candidates=3`, `skipped=3`, `remaining=1`; the two
outcomes are two of Kawasaki/Hydac/Parker with `state DRAFTED`, attachments
`pump-controller-bom.csv` + `pump-bracket.stl`, and `withheld` containing
`pump-line-portal-notes.csv` with a credential reason. DB: exactly 2 new
`PROCUREMENT_SUPPLIER_REPLY_DRAFT` rows, no draft for Marzocchi/Casappa/Danfoss/Eaton.
Fail: more than 2 drafted, any skipped/ineligible vendor drafted, any FAILED outcome.

## 5. POST completes the remainder, then is idempotent
Actions: `POST {orderId}` (no limit), then `POST {orderId}` again.
Pass: first call `drafted=1` (the last pending vendor), `remaining=0`; second call `drafted=0`,
`candidates=0`, `outcomes` empty, and no new task rows between the two calls (total draft task
rows unchanged after the second POST).
Fail: second call creates any row or reports drafted > 0.

## 6. redraft: true supersedes existing drafts
Actions: `POST {orderId, redraft: true}`.
Pass: 200 with `drafted=4` (Kawasaki, Hydac, Parker, Bosch), `failed=0`; DB shows for each of
those vendors a new highest-versioned `...:<n>` task in `PLANNED` and every earlier version of
the same scope key `CANCELLED`; exactly one PLANNED row per vendor scope; skipped vendors still
have no rows.
Fail: any trigger/approval error, duplicate PLANNED rows per vendor, or a skipped vendor drafted.

## 7. Persistence shape
Actions: query `SupplyExecutionTask` for the new rows and their events.
Pass: every draft row `status=PLANNED`, `requiresApproval=true`, `taskType`
`PROCUREMENT_SUPPLIER_REPLY_DRAFT`, `officeId=office-demo-testing`,
`capabilityKey=draft.procurement_supplier_files`; input attachments are exactly the two safe
CompanyContext documents of this request with their real byte sizes; `withheld` lists
`pump-line-portal-notes.csv` with a human-readable reason; no row is `READY`; events are
`PROCUREMENT_SUPPLIER_FILE_REPLY_DRAFTED`; no sensitive strings (`api_key`,
`local-fixture-value-not-real`) appear in any saved subject/body.
Fail: any READY row, missing requiresApproval, attachments from outside the request, leaked secret.

## 8. UI review of a batch-created draft (screenshots)
Actions: in the browser on :3013, open
`/dashboard/supply-os?panel=materials&procurementOrder=b21f1e6f-474c-469a-91df-d04595d1b3f6`,
Messages tab, select a vendor the batch drafted (Hydac or Parker, i.e. NOT the one drafted
manually in earlier runs) without clicking `Draft with request files`.
Pass: the conversation shows the persisted draft labeled `Saved draft, not sent` addressed to that
vendor's supplier address, listing `pump-controller-bom.csv` and `pump-bracket.stl` with sizes and
`pump-line-portal-notes.csv` as withheld with its reason; the body states Item / Quantity 100 pumps /
Needed by 2027-01-11 plus file-derived facts; subject and body are editable; `Send reply` only opens
the confirm gate (Cancel it, never confirm). Also open a skipped vendor (Danfoss or Casappa) and
confirm no saved draft is shown there.
Fail: no draft visible, draft attributed to the wrong vendor, missing withheld reason, or a draft
appearing on a skipped vendor.

## 9. Adversarial: bogus order and cross-tenant order
Actions: (a) `GET`/`POST` with `orderId=00000000-0000-4000-8000-000000000000`.
(b) Restart server B on :3014 with the valid secret but
`PROCUREMENT_CUSTOMER_MAP_JSON='{"office-rival":"bf52d129-124a-4d41-a55b-a7fdb90d06d7"}'` so the
same order resolves to the rival office, then `POST {orderId, redraft: true}` there.
Pass: (a) both return 404 `The sourcing request was not found.`; (b) no draft is created for
`office-rival` and no new/changed rows for `office-demo-testing`: the run either fails per vendor or
errors out, and a DB check shows zero `SupplyExecutionTask` rows with `officeId='office-rival'` and
an unchanged set of PLANNED rows for `office-demo-testing`, with no rival-office access to this
office's documents.
Fail: any draft row created under the rival office, any office-demo-testing row created/modified by
the rival-mapped server, or the rival run attaching this office's documents.

## 10. No provider / no send side effects for the whole run
Actions: grep both dev logs for `procurement-bulk-rfq`, `nodemailer`, `smtp`, `sendMail`,
`googleapis`; re-count `EmailMessage`, `EmailSenderReservation`, and workflow
`procurement_communication_messages`.
Pass: zero provider/send log lines, zero bulk-rfq requests, `EmailMessage` and
`EmailSenderReservation` counts unchanged, and the workflow message table unchanged from baseline
(no new OUTBOUND supplier message).
Fail: any provider line, any new email/delivery/outbound row.
