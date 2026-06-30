# Derya Freight OS — Roadmap to Automated Forwarding Office

This is the path from "RFQ-aware CRM" to a production-ready automated freight forwarding & procurement platform. Updated 2026-05.

## Current status

The platform now does the **core forwarding loop end-to-end** at MVP quality:
- Capture RFQ → AI parse → manually source carrier rates → convert to job → track milestones/docs → printable quote PDF
- Operations Command + Reports give the dispatcher/manager a single-screen view of everything that needs attention

The pieces still missing for "automated" (vs "tracked") are:
1. **Outbound supplier outreach** — the system parses inbound RFQs but doesn't yet automate the carrier RFQ fan-out
2. **Reply ingestion** — incoming carrier rate emails aren't auto-parsed back into CarrierQuote records
3. **Customer-side automation** — quote send, follow-ups, win/lost detection from email replies
4. **Document AI** — uploaded BLs/invoices aren't OCR'd into structured data
5. **Real OAuth + scheduled sync** — Gmail/Outlook UI is in, the backend isn't wired

The roadmap below is ordered so each step delivers visible value to a forwarder, not just internal plumbing.

---

## Phase A — Close the procurement loop (highest leverage)

This is where most of the operator's time disappears today.

### A1 — Supplier (carrier/agent) directory
Add a `Supplier` model: name, type (CARRIER / AGENT / TRUCKER / CUSTOMS_BROKER), email, lanes_served (array), modes_served, contact persons, response-time SLA.
- New page: `/dashboard/suppliers` (similar to customers list)
- Relate to `CarrierQuote` (replace the current free-text `carrier` field with a `supplierId`)

### A2 — Outbound carrier RFQ fan-out
On a job/inquiry, click "Request rates" → select 3-N matching suppliers (by lane/mode), system drafts an RFQ email per supplier (Claude), shows previews, sends via connected Gmail/Outlook account on confirmation.
- Status pill on the job: "RFQs sent: 5 · Replied: 2 · Pending: 3"
- Each sent RFQ creates a `CarrierQuote` row in PENDING status

### A3 — Inbound reply parsing
When a carrier replies (matched by email thread `In-Reply-To`), Claude extracts rate, transit days, validity, surcharges → updates the corresponding `CarrierQuote` from PENDING → RECEIVED with structured fields. Notify the operator in-app.

### A4 — Comparison + selection
Side-by-side table on the job (already exists for manual quotes) — sort by total, transit, validity. One-click "Select carrier" copies the cost into `Job.cost`, marks others as "not selected". The Quote tab auto-fills line items.

**Why this phase first:** This is the single biggest time-sink in a forwarding office. Removing it changes the unit economics.

---

## Phase B — Customer-facing automation

### B1 — Quote send + tracking
"Send Quote" button on Quote tab: builds branded HTML email with PDF attached, sends from connected inbox, marks Job → QUOTED, starts a "follow-up if no reply in 3 days" task.
- Email sent → logged as `EmailMessage` on the job's thread
- Customer reply detected → in-app notification + auto-suggest WON/LOST classification

### B2 — Booking confirmation flow
When a customer accepts: Job → BOOKED, send booking confirmation to selected carrier, generate booking reference, kick off milestone schedule (cargo ready date drives ETD/ETA estimates from carrier transit).

### B3 — Customer portal (read-only first)
Magic-link URL: `/portal/[token]` — customer sees their job's status, current milestone, ETA, documents. Reduces "where is my container?" emails.

---

## Phase C — Document intelligence

### C1 — Upload + auto-classify
When user drops a PDF on the job → Claude reads the text, infers doc type (BL/Invoice/PL/COO/Customs), pre-fills the document slot in the checklist.

### C2 — Field extraction
Pull BL number, container numbers, vessel/voyage, gross weight, chargeable weight from the parsed PDF — auto-fill milestone fields, validate against the booking.

### C3 — Document compliance
Per-job required docs depend on mode + incoterms + destination country. System computes the required set, blocks DELIVERED transition until APPROVED.

---

## Phase D — Operations intelligence

### D1 — Carrier-tracking integration
Connect to a tracking aggregator (e.g., Project44, Sealogix, Marine Traffic) by container/BL number → automatic milestone actuals (gate-out, vessel departure, transshipment, vessel arrival, gate-in). No more manual milestone updates.

### D2 — Demurrage & detention risk
For containers approaching free-time expiry at port: compute risk score, surface on Operations Command, draft a release-instruction email to the customer.

### D3 — Profitability per job (closed-loop)
After delivery, compute final margin (revenue − all carrier costs − customs fees − trucking − incidentals). Feed back into lane rate suggestions and customer scoring.

---

## Phase E — Foundations & scale

### E1 — Real OAuth
Implement Google OAuth 2.0 + Microsoft Graph for `EmailAccount`. Per-account refresh, error handling, sync queue (Bull/BullMQ on Redis or simple cron-based puller).

### E2 — Migrate to Postgres
SQLite is fine for demo. Production needs Postgres (Neon/Supabase/RDS) with proper migrations (drop the current drift, regenerate baseline).

### E3 — Multi-tenancy hardening
Audit every Prisma query for `officeId` filter. Add a Prisma middleware that enforces it automatically. Add row-level security in Postgres as a defense-in-depth layer.

### E4 — Background jobs
Email sync, AI parsing, supplier outreach should be queued, not run synchronously inside server actions. Pick one of: BullMQ + Redis, Inngest, or a pg_cron-based runner.

### E5 — Observability
Sentry for errors, PostHog or Plausible for product analytics, Logflare/Axiom for logs. Track: RFQ→quote latency, supplier response rate, on-time delivery, AI parse accuracy.

---

## Phase F — CRM enrichment (depth on the customer side)

These are useful but lower priority than closing the procurement loop.

- WhatsApp Business integration for activity logging
- Voice memo upload + transcription
- Customer health scoring (frequency, recency, profitability)
- Salesperson commission calculation
- Pipeline forecasting

---

## How to update this file

When a phase ships:
1. Move the items into a "Done" section dated by month
2. Add learnings under each (what changed in scope, what we cut, what we discovered)
3. Re-prioritize remaining phases based on user feedback

When user feedback shifts priority:
1. Don't reorder silently — add a "Re-prioritized 2026-MM" note explaining why
2. The README / project_context.md memory pointer must always agree with the top of this file
