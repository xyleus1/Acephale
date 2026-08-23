# Derya Freight OS — Project Context

Automated freight forwarding & procurement platform for forwarding offices. The CRM is now a sub-module supporting the forwarding flow, not the headline product.

## Business Goal

Replace the manual forwarding office workflow end-to-end. A traditional forwarder spends most of their time:
- Reading customer freight RFQs from email and copying details into spreadsheets
- Emailing 5-10 carriers/agents/truckers per RFQ to source rates
- Comparing offers, building a sellside quote with margin
- Sending the quote, chasing replies, booking on acceptance
- Tracking documents (BL, invoice, packing list, COO, customs decl.) and milestones (cargo ready, ETD, ETA, customs clearance, delivery)

Derya automates the parsing, supplier outreach, comparison, and operations tracking so one operator can handle 5-10× the volume.

## Two sides of the platform

### 1. Forwarding & Operations (the shipment)
- **RFQ Inbox** — auto-capture inbound freight requests from connected Gmail/Outlook (or manual entry)
- **AI Parsing:** GPT-5.6 extracts origin, destination, mode, container, incoterms, commodity, weight, volume, and cargo-ready date from unstructured email text.
- **Job Pipeline** — INQUIRY → QUOTED → BOOKED → IN_TRANSIT → CUSTOMS → DELIVERED
- **Documents** — checklist per job (BL, Invoice, Packing List, COO, Customs Declaration, Booking Conf.) with PENDING/UPLOADED/APPROVED states
- **Milestones** — Booking, Cargo Ready, ETD, ETA, Customs Entry, Customs Release, Delivery (planned + actual dates, late detection)
- **Quote Builder** — line-item sellside quote with PDF export, margin calc against carrier costs

### 2. Procurement (the supplier side)
- **Carrier Quote tracking** — capture rates from multiple carriers per inquiry (20'/40'/40HC, transit days, service, validity, transshipments)
- **Supplier outreach automation** (planned) — fan-out RFQ emails to relevant carriers/agents based on lane, parse replies back into `CarrierQuote` records, surface comparison
- **Lane rates** — standard buy/sell rates per origin-destination-mode for instant pricing

### 3. CRM sub-module (the customer side)
- Customer pool (companies), contacts, segmentation
- Outreach loop: status, importance, and category first; daily limits of 20
  Bookface, 30 LinkedIn, and 30 Email contacts; a seven-day weekly pool; manual
  completion reporting; forwarders remain data-only
- Activity tracking (visit/call/email/WhatsApp), tasks, risk alerts
- Sales assignment, ownership history
- Customer profile shows job history alongside activities and quotes

### 4. Customer workspace (the shared state layer)

- Email-first intake for RFQs, changes, and exceptions
- Passwordless, company-scoped customer access separated from internal users
- A customer control tower for active and completed shipments, RFQs, action
  requests, and dedicated milestone-based shipment detail pages
- Quote lines, requested uploads, and approved customer-visible documents
- Quote responses and requested document uploads recorded as operator-review
  actions, with no automatic booking or status change
- Customer-scoped procurement Context for messages, files, and confirmation of
  supplier research only. Supplier contact, selection, and spend remain under
  Derya operator control.
- Existing one-load guest link retained for read-only shipment sharing

## Confirmed Product Decisions

1. **Tenant isolation** — multi-office, fully isolated by `officeId`
2. **Visibility** — own-accounts vs whole-office configurable per user
3. **MVP storage shortcut** — quote line items stored as pipe-delimited strings in `Job.notes` (`description|amount|currency`)
4. **AI provider:** All active reasoning, parsing, classification, drafting,
   document analysis, and agent tool-use paths use OpenAI GPT-5.6 through
   `OPENAI_API_KEY`. Audio transcription remains on `whisper-1`, the
   specialized speech-to-text endpoint.
5. **Email** — Gmail/Outlook OAuth + IMAP fallback; UI complete, OAuth backend pending env keys
6. **PDF generation** — server-rendered HTML at `/api/jobs/[id]/quote-pdf`, browser-printed via `window.print()` (no headless Chromium dependency)

## Build Status (2026-05)

### ✅ Done
- Office-isolated foundation, credentials login, role-based visibility
- Customer pool, segmentation, company detail with contacts/activities/quotes/tasks
- Job pipeline (kanban + 6-tab detail: overview/emails/documents/milestones/procurement/quote)
- RFQ inbox + detail with GPT-5.6 parse button
- Manual New Job + New RFQ forms
- Email connection UI (Gmail/Outlook/IMAP)
- Operations Command (`/dashboard/activity`) — RFQ pipeline, overdue jobs, milestones, procurement queue
- Forwarding Reports — pipeline by status, RFQ funnel, mode mix, top customers, top lanes, carrier performance
- Customer profile shows job history
- Printable PDF quote
- Flow hint banners on RFQ + Job detail pages
- Authenticated customer control tower, dedicated shipment tracking pages,
  portal access administration, quote response queue, requested uploads, and
  explicit document publication

### 🚧 In progress / planned
See `PRODUCTIZATION_ROADMAP.md` for the full path to a production-ready automated forwarding office.

## Current Technical Baseline

- Next.js 15 (App Router) + TypeScript, server components + server actions
- Prisma + SQLite (dev). Drift exists; use `npx prisma db push`, not `migrate dev`
- Cookie-based credentials session
- Shared OpenAI Responses API adapter with GPT-5.6 for parsing, drafting,
  classification, document analysis, and agent function tools
- GPT-5.6 Structured Outputs for China Intel load extraction
- Pallet-inspired airy operating system defined in `DESIGN.md`: neutral canvas,
  white surfaces, navy actions, soft dividers, rounded controls, and compact
  density only inside operational workspaces

## Open Decisions

- Carrier outreach: API integrations (Maersk Spot, MSC INSTANT, CMA Online) vs email automation vs hybrid
- Document OCR for incoming BL/invoice attachments
- Demurrage/detention risk scoring
- Multi-currency consolidation rules
- Siber legacy data bridge (Phase 2)
