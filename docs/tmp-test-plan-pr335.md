# PR #335 runtime test plan (cold supplier follow up, review fixes, reconcile)

Branch `devin/1788312838-nudge-reconcile`, head `1594f07` (contains #332 + #334 + reconcile and
send-time recheck). Everything runs on this box against local data only.

## Environment (setup, not assertions)

- App DB `derya_crm_app` (docker `pgtest`, 5432), workflow replica `workflow_replica`
  (docker `pgwf`, 5433, role `dashboard_api`, sslmode=require). No production connection: the
  inherited production-looking `WORKFLOW_DATABASE_URL` is overridden inline on the server command.
- Dev server on `http://localhost:3013`, operator secret `local-nudge-operator-secret-32chars`
  via `PROCUREMENT_BULK_RFQ_SECRET`, `NODE_EXTRA_CA_CERTS=/home/ubuntu/nudge-smtp/ca.pem`.
- Provider interception: `/etc/hosts` maps `smtp.gmail.com`, `imap.gmail.com`,
  `gmail.googleapis.com`, `oauth2.googleapis.com` to 127.0.0.1.
  - SMTP sink `/home/ubuntu/nudge-smtp/sink.py` on 587 (STARTTLS + AUTH), saves accepted mail as
    `.eml` under `/home/ubuntu/nudge-smtp/messages`. Recipient prefix `unknown-outcome@` returns
    451 (provider UNKNOWN), sender `rfq-reject@usederya.com` returns 535 (provider REJECTED),
    recipient prefix `slowsend@` sleeps 20 s before accepting (used to open a mid run window).
  - Fake IMAP `/home/ubuntu/nudge-smtp/imap_fake.py` on 993 (TLS, local CA) serves a
    `\Sent` mailbox from `/home/ubuntu/nudge-smtp/imap-sent`; `SEARCH HEADER Message-ID` matches
    only planted files, so reconcile returns SENT for a planted RFC id and NOT_FOUND otherwise.
    Verified with imapflow before use.
- Fixtures (local only): PCBA order `11111111-1111-4111-8111-111111111111`, foam order
  `22222222-2222-4222-8222-222222222222`, ordered/closed order
  `33333333-3333-4333-8333-333333333333`; 12 vendors covering cold, fresh, replied, quoted,
  no-RFQ-thread, null `last_email_message_id`, maxed rounds, `rejected` status, UNKNOWN provider,
  REJECTED sender, foam, closed order. Three local `GMAIL_APP_PASSWORD` accounts
  (`rfq@`, `rfq-desk@`, `rfq-reject@usederya.com`) own different threads so a wrong sender is visible.

Baseline before step 1: counts of `EmailMessage`, `EmailThread` (`messageCount`, `lastMessageAt`
per fixture thread), `EmailSenderReservation` by status, workflow
`procurement_communication_messages`, files in `/home/ubuntu/nudge-smtp/messages`, and
`grep -c` of send lines in the dev log.

## 1. Operator auth on every verb
GET and POST (send and `action: "reconcile"`) with (a) no secret, (b) wrong secret, (c) empty
`?secret=`; then GET with each accepted transport (`x-cron-secret`, `Authorization: Bearer`,
`?secret=`).
Pass: (a)-(c) all 401 `{"error":"Unauthorized"}` with every baseline count unchanged; all three
transports 200 with identical payloads.

## 2. GET is draft only and explains every exclusion
GET the PCBA plan.
Pass: 200 with `eligible: 4` (Coldcast, Nullreceipt, Unknownfate, Rejectsender, all `round: 1`),
`blocked: null`, and skip reasons exactly: Freshmail "The supplier has not been quiet long enough
yet.", Replied "The supplier replied, so the reply path owns this thread.", Quoted "A supplier quote
is already recorded.", Nevermailed "The first RFQ send was not recorded against a thread, so a follow
up has nothing to reply to.", Maxedout "This supplier already had every follow up this request
allows."; the `rejected`-status vendor (Rejected Circuits) appears in neither list. After the GET all
baseline counts are unchanged, no `.eml` was written, and the dev log shows no SMTP/IMAP activity.

## 3. GET without `limit` plans the whole run (#334 fix)
Compare GET with no `limit` against `?limit=1` and `?limit=99`.
Pass: no `limit` returns all 4 targets (not 1), `limit=1` returns 1, `limit=99` is clamped to the
eligible set. Fail: no-limit collapsing to a single recipient.

## 4. Closed request is blocked (#334 fix)
GET and confirmed POST on order `3333...` (status `ordered`).
Pass: both return `eligible`/`candidates` 0, empty `targets`, and top-level
`blocked: "This request is finished, so its suppliers are not contacted again."`, with no reservation
and no `.eml`.

## 5. POST refusals
POST with no `confirm`, with `confirm: "send supplier files"` (wrong case) and
`"SEND SUPPLIER FILES "`-style wrong phrase, with `orderId: "not-a-uuid"`, and with a valid but
unknown UUID.
Pass: 400 `{"error":"This send needs an explicit confirmation."}` for the confirmation cases, 400
`orderId must be a sourcing request id.` for the malformed id, 404 `The sourcing request was not
found.` for the unknown UUID; no response contains Prisma/driver text (`invalid input syntax`,
`prisma`, `pg`, stack frames); all baseline counts unchanged and no `.eml`.

## 6. Confirmed send rides the original thread
POST `{orderId: PCBA, limit: 1, confirm: "SEND SUPPLIER FILES"}` (target Coldcast).
Pass: `sent: 1`, `failed: 0`; the new `EmailMessage` is OUTBOUND on the SAME `EmailThread.id` as the
seeded RFQ (no new thread), `rfcMessageId` equals
`<procurement-rfq-nudge-11111111-1-aa000001-...@derya.ai>`, `fromEmail` is the account that owns
that thread (`rfq@usederya.com`, not `rfq-desk@`), the thread `messageCount` incremented by 1 and
`lastMessageAt` moved; the reservation `procurement-rfq-nudge:<order>:1:<vendor>` is `RECORDED` and
linked to the thread and message. The captured `.eml` has `In-Reply-To` and `References` equal to the
seeded original RFQ RFC id, `To:` the supplier, `From:` the owning mailbox, and no U+2014.
Fail: new thread, substitute sender, missing/incorrect `In-Reply-To`, counts not updated.

## 7. Category correct attachments
Inspect the PCBA `.eml` from step 6, then POST `limit: 1` on the foam order (Coldfoam).
Pass: the PCBA message carries only the PCBA scoped file(s) (BOM csv) and never the foam STL; the
foam message carries only the foam file(s) (STL) and never the PCBA csv; each run result lists the
matching `attachments` and the withheld file with a readable reason; no sensitive fixture string
(`api_key`, `local-fixture-value-not-real`) appears in any body.

## 8. Idempotency and the two round cap
POST the same PCBA `limit: 1` again immediately, then force round 2 by backdating the recorded
follow up beyond the quiet threshold and POST again twice, then check round 3.
Pass: the immediate rerun reports `ALREADY_SENT` for Coldcast with no new `EmailMessage`, no new
`.eml`, unchanged `messageCount`; round 2 sends once and then reports `ALREADY_SENT`; after two
recorded rounds the vendor is skipped with "This supplier already had every follow up this request
allows." and never appears as a round 3 target.

## 9. Null `last_email_message_id` falls back to the local thread
POST `limit` covering Nullreceipt Boards.
Pass: `sent` includes it and the `.eml` `In-Reply-To` equals the first OUTBOUND `rfcMessageId` of its
local thread (not empty, not the nudge's own id).

## 10. REJECTED provider result frees the slot
POST for Rejectsender Circuits (its thread is owned by `rfq-reject@usederya.com`, which the sink
rejects with 535).
Pass: outcome `REJECTED` with a readable error, `failed: 1`, no `EmailMessage` recorded, no `.eml`
saved, the reservation is released (`RELEASED`/absent, not `RESERVED`), and a following GET lists the
vendor as an eligible round 1 target again.

## 11. UNKNOWN provider result keeps the slot and blocks the next round (#334 fix)
POST for Unknownfate Circuits (recipient `unknown-outcome@`, sink 451).
Pass: outcome `UNKNOWN`, `failed: 1`, no `EmailMessage`, no `.eml`, reservation stays `RESERVED`, and
the following GET skips the vendor with exactly "The last follow up to this supplier is still
unconfirmed, so it waits for reconciliation." and plans no round 2. A second confirmed POST does not
produce a second copy.

## 12. Reconcile ignores young reservations (#335 fix)
Immediately after step 11, `POST {action: "reconcile"}` (no `confirm`).
Pass: 200, `reconciled: 0`, `outcomes: []`, the fresh reservation is untouched and still `RESERVED`,
and nothing was sent. Fail: a reservation younger than 10 minutes being released or recorded.

## 12b. Reconcile queue fairness and reporting (commit 3a53f4c)
With one RESERVED nudge slot present: (a) call reconcile while the slot is fresh and confirm
`remaining` still counts it (not 0) even though nothing was eligible; (b) backdate `updatedAt` by 30
minutes with raw SQL, plant nothing, call reconcile and confirm the UNKNOWN outcome leaves the slot
RESERVED with `attemptCount` incremented and `updatedAt` refreshed; (c) call reconcile again straight
away and confirm the just-touched slot is not re-checked (`reconciled: 0`, `remaining: 1`).

## 13. Reconcile returning SENT records the message, then the next round opens (#335)
Backdate that reservation's `updatedAt` by 30 minutes, plant an `.eml` in the fake IMAP Sent store
carrying the round 1 nudge RFC id, then `POST {action: "reconcile"}`.
Pass: 200 with an outcome `state: "SENT"` for that vendor, the reservation becomes `RECORDED`, a new
OUTBOUND `EmailMessage` with that RFC id appears on the ORIGINAL RFQ thread (thread `messageCount`
+1), the sink captured no new mail (reconcile mails nobody: `.eml` count in
`/home/ubuntu/nudge-smtp/messages` unchanged and no new SMTP line in the sink log), and a following
GET now plans round 2 for that vendor instead of the unconfirmed skip.

## 14. Reconcile returning NOT_FOUND makes the round retryable (#335)
Send round 2 for the same vendor so it goes UNKNOWN again, backdate the round 2 reservation, do NOT
plant its RFC id, then `POST {action: "reconcile"}`.
Pass: outcome `state: "NOT_FOUND"`, the reservation is released, no `EmailMessage` recorded for that
round, nothing mailed, and the following GET plans that same round again (retryable, not skipped as
unconfirmed).

## 15. Send time recheck: vendor ruled out mid run (#335)
Point one target's recipient at `slowsend@...` so the sink holds the connection 20 s. Start a
confirmed POST covering that target plus a second eligible target, and while the first send is in
flight flip the second vendor's `order_vendors.status` to `rejected` in the workflow DB.
Pass: the run result skips the second vendor with exactly "This supplier stopped being eligible while
the run was in progress.", no `.eml` and no `EmailMessage` for it, and no reservation created for it,
while the first target sends normally.

## 16. Send time recheck: supplier replies mid run (#335)
Repeat the slow window, this time inserting an INBOUND `EmailMessage` on the second target's RFQ
thread mid run.
Pass: the second vendor is skipped with the same in-progress reason and is not mailed; a following
GET reports it under "The supplier replied, so the reply path owns this thread."

## 17. Send time recheck: request cancelled mid run (#335)
Repeat the slow window and flip the ORDER status to `cancelled` mid run.
Pass: the remaining target is skipped with the in-progress reason and not mailed; a following GET
returns the `blocked` closed-request string. Restore the status afterwards.

## 18. Autopilot draft only and failure counting (#334)
`POST /api/admin/procurement-autopilot` with the operator secret and no confirmation on the PCBA
order; then a confirmed autopilot run while a target is guaranteed to fail (REJECTED sender vendor).
Pass: draft only run reports `nudgeCandidates > 0` with `nudged: 0`, creates no reservation, no
`EmailMessage` and no `.eml`; the confirmed run's `failed` count includes the nudge failure (greater
than the send-path failures alone), still with no message recorded for the failed vendor.

## 19. UI review of the recorded follow up (recorded, screenshots)
Log in as `mert@usederya.com`, open Supply OS > Messages > the PCBA request > Coldcast Circuits.
Pass: the conversation shows the original RFQ plus the new follow up as an outbound message from the
owning mailbox with the follow up body (request facts, file facts, attachment list), no withheld file
content, and no em dash; a vendor that was skipped (Freshmail or Replied) shows no follow up. Also
open the foam request's vendor and confirm only foam files are named there.

## 20. No production and no real mail for the whole run
Grep both dev log and sink log; check the workflow DB for any write the app should not make.
Pass: zero connections to any non-local host (`neon`, `app.derya.ai`, real `gmail.googleapis.com`
egress), every SMTP transaction in the sink log is local, the number of `.eml` files equals exactly
the number of asserted SENT sends, `procurement_communication_messages` for the fixture orders is
unchanged from baseline except where the feature is expected to write, and no secret/token/app
password appears in any response or log line inspected.
