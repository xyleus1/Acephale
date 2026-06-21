# Blocker List

Last updated: 2026-06-21

## P0 - Needed Before Real Forwarder Send Can Be Used

1. Sender inbox
   - Decision made: allowed senders are `mert@usederya.com` and `oguzhan@usederya.com`.
   - Current blocker: connect/reconnect both accounts in Email Settings with the `gmail.send` scope.
   - Product requirement: UI must continue saying draft/setup required until one of these two senders is connected and selected.

2. Signature
   - Deferred for now. The current send path does not append a signature.

3. Forwarder directory seed
   - Names and quote emails for DSV and the first 5-10 forwarders.
   - Mode coverage per forwarder: `SEA-FCL`, `SEA-LCL`, `AIR`, `ROAD`, `COURIER`.
   - Any forwarder-specific required fields or preferred email format.
   - If API handoff is wanted later, provide API docs, auth type, sandbox endpoint, production endpoint, and sample RFQ payload for each forwarder.

4. Send policy
   - Decision made: safer policy, one reviewed draft sent per forwarder.
   - Implemented: pending quote rows are created only after Gmail accepts the send.

## P0 - Google Sheets Production Sync

1. Service account or API key
   - Provide either a Google Sheets API key or a service account email/private key.
   - Share the target sheet with the service account if using service account auth.
   - Current target sheet: `1CFmfSdFJKOCThss5xzglHb5GihPRlK3pRxLCmpuFUHg`.

2. Source-of-truth rules
   - If a Google Sheet row conflicts with an edited RFQ/job in the app, who wins?
   - Which columns are stable IDs versus mutable labels?

3. Sync cadence
   - Manual only until trusted.
   - Then decide scheduled interval and who gets failure alerts.

## P1 - WhatsApp Production

1. Meta credentials
   - App ID / secret.
   - `WHATSAPP_VERIFY_TOKEN`.
   - `WHATSAPP_APP_SECRET`.
   - `WHATSAPP_PHONE_NUMBER_ID`.
   - Access token.

2. Public webhook URL
   - Production domain or tunnel URL.
   - Callback path expected by the app: `/api/webhooks/whatsapp`.
   - Decision on where webhook logs/errors should be visible.

3. Review policy
   - Can WhatsApp replies be sent directly from the inbox, or should all be saved as drafts first?

## P1 - Document Upload Production

1. Storage target
   - Local private upload works for dev.
   - Production still needs S3, Google Drive, R2, or another durable provider.
   - Access policy for customer portal links.
   - For S3/R2, provide bucket, region, endpoint if R2-compatible, access key ID, and secret access key.

2. Required document set
   - Confirm which document types stay for lead-to-quote.
   - Current ops-heavy customs docs should stay secondary until operations returns.

## P1 - Agent Evidence Depth

1. Source precision
   - Field-level Job-page review and office-wide Admin audit exist now.
   - Still needed: exact source message references for proposals created from linked emails, not only pasted text excerpts or source previews.
   - Still needed: a required rejection reason if the business wants rejected proposals to be training/evaluation data instead of simple workflow history.

2. Audit policy
   - Decide how long to keep agent proposals and drafts.
   - Decide whether rejected proposals need a reason.

## P2 - Inbox Tuning

1. Approved contacts
   - Seed known approved people, starting with Oguzcan and any other operators/customers.

2. Criticality scoring
   - After a real mailbox sync, review which threads appear too high or too low.
   - Tune using real examples, not guesses.
