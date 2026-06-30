# Derya Freight OS — Idea Backlog

Living document of features, polish, and bigger plays. Items move from here into PRs as we ship them. New ideas go at the bottom of their section. When something ships, move the line to "Shipped" and date it.

Loosely ordered by impact-per-effort. Effort is rough hours; treat as relative.

---

## Quick demo wins (≤4 hours each)

- **AI counter-offer on carrier rates** — Each rate row in the INQUIRY stage gets a `Counter` button. Click → Claude drafts a polite "can you sharpen this to $X" email using rate + lane history context. Logged via existing email pipeline. ✅ shipping this turn.
- **Customer portal magic-link** — `/portal/[token]` route, read-only. Customer sees their job status, milestones, ETA, docs available, contact info. Big trust win and stops "where's my container?" emails. Token = job.id for now; upgrade to signed token later. ✅ shipping this turn.
- **Stage handoff suggestions** — When user changes status (e.g. QUOTED → BOOKED), surface 2 suggested emails side-by-side ("notify carrier", "notify customer") with AI drafts ready to send. One click each.
- **Tracking number → milestone fill** — Paste a container/BL number, Claude generates plausible ETD/ETA/intermediate milestones based on lane and current date. (Stub now; replace with Project44 / Sealogix when real.)
- **Document drag-and-drop classify** — Drop a PDF on the workbench → upload, Claude reads it (vision API), assigns to the correct slot in the doc checklist (BL/Invoice/PL/COO/Customs). 95% of manual doc handling disappears.
- **"Recommended" / "BEST" badge on cheapest carrier rate** — Subtle visual cue. ✅ shipped 2026-05-02.
- **Send PDF quote as email attachment** — Wire the existing quote-pdf endpoint into the QUOTED stage email; attach automatically when sending.
- **Job profitability badge in topbar** — Show focused job's margin% in topbar so it's always visible.
- **Status pipeline strip — clickable** — Clicking a stage label changes the job's status (with confirmation). Faster than the Edit panel.
- **Notes field per stage** — A free-text note tied to current stage. Travels with the job. Like Slack-thread-per-stage.
- **Dismissible decision queue** — On the home (`/dashboard` was Queue), let user "Skip for now" / "Hold until tomorrow" with `dismissedUntil`.
- **Compose-input keyboard shortcut** — Cmd+Enter sends from the agent compose. Enter alone for newline.
- **Right-click context menu on milestones** — Quick "Mark done / Edit date / Add note".
- **Workbench / focus follow-through** — When you Cmd+K-jump to a job, scroll-restore the Stage Workbench section into view.

## Real automation (½–3 days each)

- **Gmail OAuth + sync** — Connect a real Gmail account, poll the inbox, Claude classifies each new email per stage (RFQ / carrier-reply / customer-quote-reply / customs / other) and attaches to the right job. Outlook via Microsoft Graph next.
- **Outbound SMTP send** — When you hit "Send" in the composer, actually transmit via the connected account (Nodemailer or Gmail API). We already log; just wire the send.
- **Automatic carrier reply parsing** — When a carrier replies on a thread we sent, AI reads the body, extracts rate/transit/validity/surcharges, updates the matching `CarrierQuote` from PENDING → RECEIVED with structured fields. Closes the procurement loop.
- **AI-suggested status transitions** — When a carrier "confirmed" email lands, AI proposes "Move to BOOKED?" as a queue card. When customer says "yes proceed", AI proposes WON.
- **Cron-based stale job nudge** — Daily check: any jobs in QUOTED >3 days? Add a "follow up" decision to the queue.
- **Inbound email auto-link to existing thread** — Match `In-Reply-To` / `Subject` to an existing thread on a job, append message instead of creating a new thread.
- **Document OCR / field extraction** — Once a PDF is on a job (e.g. BL), pull BL number / container / vessel / voyage / weights into structured fields. Auto-fill milestones from those fields.
- **Real-time tracking widget** — IN_TRANSIT stage shows vessel/container position via tracking aggregator.
- **Outlook OAuth** — Microsoft Graph integration for Outlook 365 inboxes.
- **Email signature / template per office** — Configurable header/footer wrap on every outbound email.

## Big feature plays (multi-day)

- **Workflow templates** — Save "Standard FCL Asia→Europe" with default mode/incoterms/preferred carriers/expected milestones. New jobs spawn with sensible defaults.
- **Margin guardrails** — Rules engine: "Don't auto-send a quote with margin <12%", "Flag any deal with >40% margin for human review". Decisions block on guardrail violations.
- **Rate negotiation memory** — System tracks every accepted/rejected rate per carrier per lane. AI uses this to suggest counter-offers and shows "Maersk accepts ~5% off list 73% of the time on this lane."
- **Customer health scorecard** — Profitability, avg margin, conversion rate, payment timeliness. Surface in the customer popover and customer profile.
- **Carrier reliability ledger** — Response time, rate competitiveness, on-time delivery %, claims rate. Inline next to each carrier row.
- **Multi-language email** — Auto-detect inbound language, draft replies in same language, store both sides.
- **Mobile companion** — Stripped-down view focused on milestones + quick mark-done for ops staff in the field. Push notifications.
- **Voice notes / transcription** — Hold-to-record a voice note (we have OpenAI Whisper key already). Transcribed and posted as manual event in feed.
- **Compliance autocheck** — Origin/destination/commodity → highlight required docs (e.g., EU import needs T1 transit) and suggest HS codes.
- **Customer SMS notifications** — At each milestone, optional SMS to customer via Twilio.
- **Multi-job tile view** — Toggle dashboard from "focus 1 job" to "watch 4-6 jobs side-by-side" for ops managers.
- **Replay mode** — Step through every event of a delivered job in chronological order with a slider. Great for training.
- **Team mode** — Multiple operators, each with their own focused job + a "team activity" stream showing what others are doing.

## Polish / fit-and-finish

- **Worktable section icons** — Tiny SVGs next to "Carrier" / "Documents" / "Financials" labels.
- **Empty-state illustrations** — A clean monochrome line-icon for each empty state instead of bare text.
- **Keyboard shortcut overlay** — Press `?` to see all keyboard shortcuts.
- **Light/dark theme** — Currently light only.
- **Animations on stage transitions** — When a stage advances, the pipeline strip animates the new active state. Subtle but reinforces "live engine."
- **Workbench tab persistence** — When user collapses Carrier card, remember it across visits via localStorage.
- **Skeleton loaders** — Show grey skeletons while async data loads instead of flicker.
- **Sticky stage workbench header** — When you scroll the workbench, the stage label sticks at the top of the viewport.
- **Print-friendly view** — Clean stylesheet for printing the job summary.

## Ops & infra

- **Postgres migration** — SQLite is fine for demo; production needs Postgres. Drop the migration drift, regenerate baseline.
- **Background job runner** — Email sync, AI parsing, document OCR should be queued (BullMQ / Inngest), not running synchronously inside server actions.
- **Multi-tenancy hardening** — Audit every Prisma query for `officeId` filter. Add Prisma middleware that enforces it.
- **Observability** — Sentry + PostHog + Logflare. Track AI parse accuracy, carrier response rate, RFQ→quote latency.
- **Audit log** — Every change to a job (status, fields, milestones) is logged with user + timestamp. Surface in the activity feed.
- **Soft delete + restore** — `deletedAt` on Job/Inquiry; trash bin in Records.
- **Rate limiting on agent chat** — Cap per-user requests per minute on `chatWithAgent` to avoid runaway costs.
- **API key rotation** — UI for rotating the Anthropic key without restart.
- **Role-based permissions** — SALES sees only own jobs unless `canViewWholeOffice`; MANAGER sees all in office; ADMIN can edit office settings.

## Nice-to-have / wild

- **Customer portal write-back** — Customer can confirm/decline the quote directly in the portal (and we get a webhook).
- **Auto-rate-card generation** — From historical wins, generate a public rate card per lane + season + carrier.
- **Forecast widget** — "You'll likely have $X in revenue settled this month based on jobs in transit and historical conversion."
- **Carrier negotiation coach** — When you're typing a counter-offer, AI suggests "Try 4% below their offer; on this lane they accept that 71% of the time."
- **Embedded chat with the customer** — Inline chat thread per job with a customer-facing widget on the portal. Their messages land directly in the job's email thread.
- **Mass quote generation** — Select 10 jobs in INQUIRY → batch "send all rate requests, build all quotes when replies arrive."
- **AI risk scoring** — Each job gets a transit-risk + payment-risk + customs-risk score. Highlight high-risk jobs at the top.

---

## Shipped

- 2026-05-02 — Recommended/BEST badge on cheapest carrier rate
- 2026-05-02 — Layout reorder: stage workbench right under stages; carrier/docs/financials collapsible underneath
- 2026-05-02 — Stage email panel with AI draft + outbound logging
- 2026-05-02 — Milestone edit popover that actually closes
- 2026-05-02 — Topbar declutter; agent on full right side; Lane Rates back in sidebar
- 2026-05-02 — Floating agent chat widget; agent server actions powered by Claude Haiku
- 2026-05-02 — Command palette (⌘K) for job switching
- 2026-05-02 — Live event toast (15s polling)
- 2026-05-02 — Customer popover from workbench header
- 2026-05-02 — Manual edit slide-out panel for all job fields + status
- 2026-05-02 — Sidebar auto-collapse on /dashboard
