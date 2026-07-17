# Engineering Log

Use this file for chronological implementation notes that future agents should see. Keep entries concrete and auditable. Append new entries at the bottom.

## Entry Template

### YYYY-MM-DD - Short task summary

- Branch:
- Commit:
- Task:
- Files changed:
- Verification:
- Failed/skipped checks:
- Caveats:
- Follow-up:

## Log

### 2026-07-03 - Internal CRM Relationship OS V1

- Branch: feature/internal-crm-v1
- Commit: not committed
- Task: Build an internal CRM/Relationship OS inside the app, reusing existing
  company/contact/RFQ/load truth and adding a generic opportunity layer.
- Files changed: `PRODUCT_CRM_IMPLEMENTATION_PLAN.md`,
  `PRODUCT_CRM_V1_MANUAL_TEST_GUIDE.md`, `PRODUCT_CRM_V1_PR_SUMMARY.md`,
  `prisma/schema.prisma`,
  `prisma/migrations/20260703000100_internal_crm_relationship_os/migration.sql`,
  `src/lib/crm/*`, `src/components/crm/crm-components.tsx`,
  `src/app/dashboard/crm/**`, `src/app/dashboard/rfq/[inquiryId]/page.tsx`,
  `src/app/dashboard/layout.tsx`, `src/app/globals.css`,
  `scripts/crm-relationship-os.test.ts`, `package.json`, and docs.
- Behavior added: `/dashboard/crm` command center, company/person/opportunity
  directories, detail pages with Brain Context, internal-only notes/tasks, RFQ
  linked opportunities, relationship metadata, and a smoke test for CRM
  constants plus owner scoping.
- Verification: `npx prisma validate`, `npm run db:generate`,
  `npm run test:crm`, `npx tsc --noEmit`, `npm run check:docs`,
  `npm run audit:tenant-scope`, and `npm run build` passed.
- Failed/skipped checks: tenant-scope audit is clean for the new CRM files; it
  still reports one pre-existing medium finding in
  `src/lib/rfq-load-review.ts`.
- Caveats: contacts remain company-scoped; live GBrain retrieval is not wired
  into browser/client code; persisted CRM-specific agent proposal review is a
  future slice.
- Follow-up: add live server-side GBrain retrieval into CRM entity pages with
  source citations and a reviewed CRM agent proposal model.

### 2026-06-30 - Production-facing load playbook and agent text cleanup

- Branch: main
- Commit: not committed
- Task: Make the focused load assistant look production-ready by rendering
  assistant formatting cleanly and removing fake-sounding copy from the
  focused load workflow.
- Files changed: `src/components/agent-message-content.tsx`,
  `src/components/job-conversation-panel.tsx`,
  `src/components/agent-chat-widget.tsx`,
  `src/components/agent-tool-trace-list.tsx`,
  `src/app/dashboard/page.tsx`, `src/app/globals.css`,
  `docs/AI_HANDOFF.md`, `docs/DECISIONS.md`, and
  `docs/ENGINEERING_LOG.md`.
- Behavior added: assistant replies render bold text, paragraphs, and simple
  lists without raw markdown; visible evidence controls say checked
  sources/evidence; focused load workflow copy now says `Load playbook` and
  reads like an operator instruction surface.
- Verification: `npx tsc --noEmit`, `npm run check:docs`, and
  `npm run build` passed.
- Failed/skipped checks: browser-authenticated visual QA was not run in this
  session.
- Caveats: this is markdown-lite rendering only, not full Markdown support.
- Follow-up: use the next live walkthrough to tune the assistant answer style
  and decide whether source/evidence details should default collapsed.

### 2026-06-30 - Focused load dashboard scope and route-map fix

- Branch: main
- Commit: not committed
- Task: Fix the focused load page so it shows a sensible route for
  Giresun, Turkey to Ancona, Italy and stops rendering unrelated office-wide
  decision/control-sheet data under the selected load.
- Files changed: `src/app/dashboard/page.tsx`, `src/app/globals.css`,
  `src/lib/workbench-route-map.ts`, `scripts/workbench-route-map.test.ts`,
  `package.json`, `docs/AI_HANDOFF.md`, `docs/DECISIONS.md`, and
  `docs/ENGINEERING_LOG.md`.
- Behavior added: route geography moved into a tested helper; Giresun to
  Ancona sea loads now route through Bosphorus, Dardanelles, and the Adriatic;
  `/dashboard` defaults to a focused load cockpit; `/dashboard?view=overview`
  holds the top-down queue/control-sheet dashboard; focused pages now include a
  load-scoped workflow panel instead of global reference-deal sections.
- Verification: `npm run test:workbench-route-map`, `npm run test:route-map`,
  `npx tsc --noEmit`, `npm run check:docs`, and `npm run build` passed.
- Failed/skipped checks: browser-authenticated visual QA was not run in this
  session.
- Caveats: the route helper still uses deterministic known-location matching,
  not a full geocoder or carrier routing engine.
- Follow-up: add more reviewed route fixtures as real RFQs expose new ports,
  and consider promoting `/dashboard?view=overview` to a dedicated
  `/dashboard/overview` route when navigation stabilizes.

### 2026-06-29 - Walnut/navy palette discipline

- Branch: main
- Commit: not committed
- Task: Revamp app-wide color usage so the UI consistently uses walnut, navy,
  white, and light gray-blue; reserve maroon/dark green only for important
  blocked/ready status accents.
- Files changed: `src/app/globals.css`,
  `src/components/intelligence/world-intelligence-map.tsx`,
  `src/components/intelligence/world-map-base.tsx`,
  `src/components/intelligence/intelligence-hotspot-panel.tsx`,
  `src/components/intelligence/intelligence-visual-icons.tsx`,
  `src/components/pending-quotes-inline.tsx`,
  `src/components/status-badge-toggle.tsx`, `docs/AI_HANDOFF.md`, and
  `docs/ENGINEERING_LOG.md`.
- Behavior added: final palette discipline layer forces pricing, decision,
  strategy, status, setup, active-chip, and opportunity surfaces back to white
  or blue-gray structure with walnut/navy emphasis. Red/green states now use
  calm maroon/dark-green text, borders, or left-edge accents instead of full
  panel fills. Intelligence map colors were rebuilt around blue-gray land,
  navy ocean, walnut reference points, maroon critical hotspots, and muted
  low/medium markers. The map SVG now keeps its 2:1 aspect ratio instead of
  vertically centering inside a giant blank viewport. Duplicate Intelligence
  evidence refs now include the index in React keys, removing the visible dev
  issue badge.
- Verification: `npx tsc --noEmit`, `npm run check:docs`, and
  `npm run build` passed. Source sweep found no targeted bright tokens
  (`#f59e0b`, `#fb7185`, `#34d399`, `#38bdf8`, `#16a34a`, `#22c55e`,
  `#ef4444`, `#eab308`, `#c73535`, `#198754`, etc.) in `src/app`,
  `src/components`, or `src/lib`. Browser smoke login with
  `admin@demo.local / admin1234` passed. Desktop screenshots at 1440x900 passed
  for Pricing, Intelligence, and Email Settings. Strict computed-color audit
  across Dashboard, Inbox, Pricing, Intelligence, CRM, Email, Admin, Jobs,
  Reports, and Activity found no warm tan/orange panels or loud red/green
  semantic fills.
- Failed/skipped checks: production deployment not yet verified in this log
  entry.
- Caveats: `src/app/globals.css` still has older overridden theme layers. The
  current UI is controlled by the final layer, but the stylesheet needs a later
  deletion/refactor pass. Local Next dev cache corrupted during hot-reload QA;
  only generated `.next` output was cleared before restarting the dev server.

### 2026-06-22 - Phase 2B logistics intelligence ingestion

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Add external freight/logistics intelligence ingestion into the company
  brain as `MarketSignal` operational intelligence linked to internal business
  objects.
- Files changed: `prisma/schema.prisma`,
  `prisma/migrations/20260622000100_market_intelligence/migration.sql`,
  `src/lib/market-intelligence/*`, `src/lib/memory/morning-brief.ts`,
  `src/lib/memory/customer-dossier.ts`, `src/lib/agent-tools.ts`,
  `src/lib/agent-chat.ts`, `src/lib/commercial-strategy.ts`,
  `src/lib/commercial-strategy-persistence.ts`, `src/lib/risk.ts`,
  `scripts/ingest-market-intelligence.ts`,
  `scripts/market-intelligence-smoke.test.ts`, and docs.
- Verification: `npx prisma validate`, `npm run db:generate`,
  `npx tsc --noEmit`, `npm run test:strategy`, `npm run test:memory`,
  `npm run test:memory-search`, `npm run test:morning-brief`,
  `npm run test:market-intelligence`, `npm run memory:doctor`, and
  `npm run build`, `npm run ai:handoff` passed.
- Failed/skipped checks: none.
- Caveats: deterministic extractor only; live source parsing is basic; links are
  possible-impact matches and should not mutate operational records.
- Follow-up: normalize lanes/ports and add reviewed fixtures for real sources
  before scheduled live ingestion.

### 2026-06-22 - Phase 2C market impact review and feedback loop

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Add reviewable market impact action items and feedback on top of
  `MarketSignal` and `MarketSignalLink`.
- Files changed: `prisma/schema.prisma`,
  `prisma/migrations/20260622000200_market_impact_review/migration.sql`,
  `src/lib/market-intelligence/market-impact-review.ts`,
  `src/lib/market-intelligence/ingest-market-object.ts`,
  `src/lib/agent-tools.ts`, `src/lib/agent-chat.ts`,
  `src/lib/memory/morning-brief.ts`, `scripts/market-doctor.ts`,
  `scripts/market-impact-review.test.ts`, `package.json`, and docs.
- Verification: `npx prisma validate`, `npm run db:generate`,
  `npx tsc --noEmit`, `npm run test:strategy`, `npm run test:memory`,
  `npm run test:memory-search`, `npm run test:morning-brief`,
  `npm run test:market-intelligence`, `npm run test:market-impact`,
  `npm run memory:doctor`, `npm run market:doctor`, `npm run build`, and
  `npm run ai:handoff` passed.
- Failed/skipped checks: none at this point.
- Caveats: review tools update only review/feedback state. No UI exists yet.
  Feedback is stored but no ranking model consumes it yet.
- Follow-up: add a small operator-facing review surface or make the agent trace
  review state more prominently before any autonomy.

### 2026-06-22 - Unified inbox channel filters

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Make `/dashboard/inbox` work as an explicit multi-channel operator
  surface for existing Gmail and WhatsApp message ingestion.
- Files changed: `src/app/dashboard/inbox/page.tsx`, `src/app/globals.css`,
  `docs/AI_HANDOFF.md`, and `docs/ENGINEERING_LOG.md`.
- Verification: `npx prisma validate`, `npx tsc --noEmit`, and
  `npm run build` passed.
- Failed/skipped checks: none.
- Caveats: no new provider backend was added. Gmail multi-inbox and WhatsApp
  Cloud API plumbing already exist; Outlook/IMAP remain unimplemented despite
  provider labels in the schema/comments.
- Follow-up: confirm whether production needs Gmail-only first, Outlook/IMAP
  ingestion, or WhatsApp hardening/reply UX next.

### 2026-06-22 - Phase 2D Firecrawl connector and Research Inbox

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Add constrained Firecrawl-backed market research ingestion and a small
  `/dashboard/intelligence` review surface.
- Files changed: `.env.example`, `package.json`, `prisma/schema.prisma`,
  `prisma/migrations/20260622000300_firecrawl_market_ingestion/migration.sql`,
  `src/lib/market-intelligence/firecrawl-client.ts`,
  `src/lib/market-intelligence/source-registry.ts`,
  `src/lib/market-intelligence/source-policy.ts`,
  `src/lib/market-intelligence/ingest-firecrawl-source.ts`,
  `src/lib/market-intelligence/ingest-market-source.ts`,
  `src/lib/market-intelligence/market-tools.ts`,
  `src/lib/agent-tools.ts`, `src/lib/agent-chat.ts`,
  `src/lib/memory/morning-brief.ts`,
  `src/app/dashboard/intelligence/page.tsx`,
  `src/app/dashboard/layout.tsx`, `src/app/globals.css`,
  `scripts/ingest-firecrawl-market-intelligence.ts`,
  `scripts/firecrawl-smoke.test.ts`, and docs.
- Verification: `npx prisma validate`, `npm run db:generate`,
  `npx tsc --noEmit`, `npm run test:strategy`, `npm run test:memory`,
  `npm run test:memory-search`, `npm run test:morning-brief`,
  `npm run test:market-intelligence`, `npm run test:market-impact`,
  `npm run test:firecrawl`, `npm run memory:doctor`,
  `npm run market:doctor`, `npm run build`, and `npm run ai:handoff` passed.
- Failed/skipped checks: none.
- Caveats: Firecrawl ingestion requires `FIRECRAWL_API_KEY` for live runs.
  Tests are mocked and do not hit live internet. Research Inbox actions update
  market review/feedback state only.
- Follow-up: add reviewed production source registry entries, schedule
  ingestion only after source quality is proven, and consider a detail route for
  individual research objects if operators need deeper source review.

### 2026-06-22 - Phase 2E source activation, scheduling, and quality ranking

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Turn Firecrawl market intelligence into a controlled daily intelligence
  system with curated source registry entries, scheduled ingestion controls,
  source quality scoring, and ranked operator/agent surfaces.
- Files changed: `.env.example`, `package.json`,
  `src/lib/market-intelligence/source-registry.ts`,
  `src/lib/market-intelligence/source-policy.ts`,
  `src/lib/market-intelligence/source-quality.ts`,
  `src/lib/market-intelligence/scheduled-ingestion.ts`,
  `src/app/api/cron/market-intelligence/route.ts`,
  `src/app/dashboard/intelligence/page.tsx`,
  `src/lib/memory/morning-brief.ts`, `src/lib/agent-tools.ts`,
  `src/lib/agent-chat.ts`, `src/app/globals.css`,
  `scripts/source-quality.test.ts`,
  `scripts/scheduled-market-ingestion.test.ts`,
  `scripts/firecrawl-smoke.test.ts`, `scripts/market-doctor.ts`, and docs.
- Verification: `npx tsc --noEmit`, `npm run test:source-quality`,
  `npm run test:scheduled-market-ingestion`, `npm run test:morning-brief`,
  `npm run test:market-intelligence`, `npm run test:market-impact`, and
  `npm run test:firecrawl` passed during implementation. Full requested
  verification was run after docs updates and recorded in `docs/AI_HANDOFF.md`.
- Failed/skipped checks: none at this point.
- Caveats: curated external sources are disabled by default; live ingestion
  still requires `FIRECRAWL_API_KEY`; tests mock Firecrawl; source quality is
  deterministic and should not be confused with truth.
- Follow-up: review which curated sources to enable first, add source-specific
  fixtures for production sources, and consider detail pages only if operators
  need deeper source audit workflows.

### 2026-06-22 - H1 pre-hardening checkpoint

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Record the production-hardening baseline before any new product work.
- Files changed: `docs/ENGINEERING_LOG.md`, `docs/AI_HANDOFF.md`.
- Verification: baseline `npx tsc --noEmit` passed before the hardening patch.
- Failed/skipped checks: full verification pending until H1 implementation.
- Caveats: worktree was already heavily dirty from Phase 1 through Phase 2E
  files. Do not blindly stage unrelated changes. Treat external intelligence as
  advisory and do not run live Firecrawl ingestion during hardening.
- Follow-up: harden secrets, portal access, quote PDF escaping, tenant-scope
  audit output, and live Firecrawl controls before Phase 2 product expansion.

### 2026-06-22 - H1 production hardening and live intelligence pilot prep

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Harden OAuth token storage, portal access, quote PDF HTML output,
  Firecrawl live-ingestion controls, market/tenant doctors, and live-pilot
  documentation without changing freight workflows.
- Files changed: `.env.example`, `package.json`,
  `src/lib/security/crypto.ts`, `src/lib/security/html.ts`,
  `src/lib/portal-token.ts`, `src/lib/gmail-oauth.ts`,
  `src/app/api/auth/gmail/callback/route.ts`, `src/lib/portal.ts`,
  `src/app/portal/[token]/page.tsx`, `src/components/copy-portal-link.tsx`,
  `src/lib/customer-notify.ts`, `src/lib/agent-tools.ts`,
  `src/lib/seed-demo-load.ts`, `src/app/api/jobs/[jobId]/quote-pdf/route.ts`,
  `src/lib/market-intelligence/firecrawl-client.ts`,
  `src/lib/market-intelligence/ingest-firecrawl-source.ts`,
  `src/lib/market-intelligence/scheduled-ingestion.ts`,
  `src/app/api/cron/market-intelligence/route.ts`,
  `scripts/security-hardening.test.ts`, `scripts/audit-tenant-scope.ts`,
  `scripts/firecrawl-smoke.test.ts`,
  `scripts/scheduled-market-ingestion.test.ts`, `scripts/market-doctor.ts`,
  `docs/RUNBOOKS/MARKET_INTELLIGENCE_LIVE_PILOT.md`, and docs.
- Verification: `npx prisma validate`, `npm run db:generate`,
  `npx tsc --noEmit`, `npm run test:security`, `npm run test:strategy`,
  `npm run test:memory`, `npm run test:memory-search`,
  `npm run test:morning-brief`, `npm run test:market-intelligence`,
  `npm run test:market-impact`, `npm run test:firecrawl`,
  `npm run test:source-quality`, `npm run test:scheduled-market-ingestion`,
  `npm run memory:doctor`, `npm run market:doctor`,
  `npm run audit:tenant-scope`, `npm run build`, and
  `npm run ai:handoff` passed.
- Failed/skipped checks: no live Firecrawl ingestion was run; production DB
  commands were not run.
- Caveats: existing plaintext Gmail tokens are tolerated for local/dev
  continuity but new/updated OAuth tokens require `TOKEN_ENCRYPTION_KEY` and are
  stored encrypted.
- Follow-up: before live pilot, set secrets, run dry-runs, enable one reviewed
  source at a time, and review `market:doctor` output.

### 2026-06-22 - Dirty worktree checkpoint plan and Gmail token compatibility audit

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Inspect the accumulated Phase 1 through H1 dirty worktree, produce a
  safe checkpoint/commit strategy, and audit Gmail OAuth token encryption
  deployment compatibility.
- Files changed: `src/lib/gmail-oauth.ts`,
  `scripts/security-hardening.test.ts`, `docs/AI_HANDOFF.md`,
  `docs/ENGINEERING_LOG.md`, and
  `docs/RUNBOOKS/GMAIL_OAUTH_TOKEN_ENCRYPTION.md`.
- Verification: `npx tsc --noEmit`, `npm run test:security`,
  `npm run build`, `npm run market:doctor`, `npm run memory:doctor`, and
  `npm run ai:handoff` passed.
- Failed/skipped checks: live Firecrawl ingestion skipped because
  `FIRECRAWL_API_KEY` is not configured and live ingestion is disabled;
  production DB commands intentionally not run.
- Caveats: current tree includes overlapping phase changes. Future commits
  should use patch-level staging for shared files instead of broad `git add`.
- Follow-up: if production needs immediate plaintext-token removal, write a
  separate admin-only encryption migration that never prints token values.

### 2026-06-22 - Controlled live Firecrawl market-intelligence pilot

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Run a one-source live Firecrawl pilot against an official source without
  enabling cron, broad crawling, or operational record mutation.
- Source tested: `port-of-long-beach-news`
  (`https://polb.com/port-info/news-and-press/`), clamped to max results `3`
  and max pages `3`.
- Run mode: dry-run/preview first, then one explicit live scrape with
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` scoped to the single
  command invocation and `--confirm-live`.
- Created records: `MarketIngestionRun cmqpc884m0001rn6hgs2ire2b`, one
  source `KnowledgeObject` (`market_update`), one derived `KnowledgeObject`
  (`market_signal`), two `KnowledgeChunk` rows, one `MarketSignal`, eleven
  `MarketSignalLink` rows, and eleven `MarketImpactReview` rows.
- Feedback recorded: dismissed all eleven reviews; recorded eight `irrelevant`
  feedback entries for customer/job/RFQ impacts and three `wrong_link` feedback
  entries for social-link lanes that were incorrectly extracted as freight
  lanes.
- Verification: preflight `npx tsc --noEmit`, `npm run market:doctor`,
  `npm run memory:doctor`, `npm run test:firecrawl`, and
  `npm run test:scheduled-market-ingestion` passed. Post-run `memory:doctor`
  and `market:doctor` passed and reported cron/live ingestion disabled by
  default.
- Failed/skipped checks: no production database commands were run; no scheduled
  ingestion was enabled; no second source was tested.
- Caveats: the live scrape exposed a real quality problem. Page navigation and
  social links were interpreted as a critical port-disruption signal and bogus
  lanes. Source quality correctly fell to `0/poor`, but Morning Brief still
  surfaced the poor-quality high/critical signal as a recommended action.
- Follow-up: before any second-source pilot, strip nav/footer content, require
  article/advisory/date evidence for signal extraction, block social-link lane
  candidates, and suppress or demote poor-quality/dismissed signals in Morning
  Brief.

### 2026-06-22 - H2 web extraction hygiene and signal suppression

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Prevent page chrome, listing pages, social links, and low-quality web
  scrapes from producing `MarketSignal`, `MarketSignalLink`,
  `MarketImpactReview`, Morning Brief recommendations, or strategy context.
- Context: The live `port-of-long-beach-news` pilot produced one bad critical
  signal from the listing page at `https://polb.com/port-info/news-and-press/`.
  Operators dismissed all eleven impact reviews and recorded eight
  `irrelevant` plus three `wrong_link` feedback entries. Source quality dropped
  to `0/poor`, but Morning Brief still surfaced the raw signal.
- Files changed: `src/lib/market-intelligence/content-hygiene.ts`,
  `src/lib/market-intelligence/signal-suppression.ts`,
  `src/lib/market-intelligence/firecrawl-client.ts`,
  `src/lib/market-intelligence/ingest-firecrawl-source.ts`,
  `src/lib/market-intelligence/ingest-market-object.ts`,
  `src/lib/market-intelligence/extract-market-signals.ts`,
  `src/lib/market-intelligence/link-market-signals.ts`,
  `src/lib/market-intelligence/source-policy.ts`,
  `src/lib/market-intelligence/source-registry.ts`,
  `src/lib/market-intelligence/market-tools.ts`,
  `src/lib/memory/morning-brief.ts`,
  `src/app/dashboard/intelligence/page.tsx`,
  `scripts/fixtures/market-intelligence/port-long-beach-news-index.bad.json`,
  `scripts/market-content-hygiene.test.ts`,
  `scripts/market-signal-suppression.test.ts`,
  `scripts/market-intelligence-smoke.test.ts`,
  `scripts/firecrawl-smoke.test.ts`,
  `scripts/source-quality.test.ts`, `scripts/market-doctor.ts`, `package.json`,
  and docs.
- Behavior: non-article/non-advisory market pages are stored as Research Feed
  items only; extraction skips record `market.update.extraction_skipped`;
  Firecrawl scrapes request cleaner main content; social/utility URLs cannot
  become lane/entity evidence; suppressed signals remain auditable but do not
  appear in Morning Brief, strategy context, or customer/lane exposure tools.
- Verification: implementation smoke checks passed for
  `npm run test:market-content-hygiene`,
  `npm run test:market-signal-suppression`,
  `npm run test:market-intelligence`, `npm run test:firecrawl`,
  `npm run test:source-quality`, `npm run test:morning-brief`,
  `npm run market:doctor`, and `npx tsc --noEmit` during development. Full
  requested verification is recorded in `docs/AI_HANDOFF.md`.
- Failed/skipped checks: live Firecrawl ingestion was not run; cron was not
  enabled; production DB commands were not run.
- Caveats: this is deterministic hygiene, not perfect article understanding.
  Thresholds may need source-specific tuning after more labeled feedback.
- Follow-up: rerun the same Port of Long Beach source with the same `3` result /
  `3` page clamp before testing a second source. Expected result: listing page
  stored as research, no fake signal, no social-link lanes, no Morning Brief
  recommendation.

### 2026-06-22 - H2.1 same-source Firecrawl regression rerun

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Rerun the exact failed `port-of-long-beach-news` Firecrawl source after
  H2 to prove the listing/index page is research-only and no longer produces
  operational intelligence.
- Source tested: `port-of-long-beach-news`
  (`https://polb.com/port-info/news-and-press/`), clamped to max results `3`
  and max pages `3`.
- Safety state: Firecrawl key configured locally, cron disabled, live ingestion
  disabled by default, enabled fetchable source count `0`, risky broad fetch
  configs `0`, allowed-domain issues `0`. `TOKEN_ENCRYPTION_KEY` was not set in
  this shell, but the run did not touch Gmail OAuth.
- Dry-run/preview: one candidate URL, classified `index_page`, signal eligible
  `false`, expected one research item, one extraction skip, zero signals, zero
  signal links, and zero impact reviews.
- Live run: `MarketIngestionRun cmqpkglvy0001rn99xnek5o3i`, status
  `succeeded`, one provider result, one accepted URL, object count `1`, signal
  count `0`, review count `0`, provider errors none.
- Records: existing research `KnowledgeObject cmqpc8c7g0005rn6hhbbr00e2` was
  updated idempotently; no new research object was duplicated; existing chunk
  was updated; no new `MarketSignal`, `MarketSignalLink`, or
  `MarketImpactReview` rows were created from the rerun.
- Extraction state: page type `index_page`, `contentQualityScore` `0`,
  `extractionStatus` `rejected_low_quality`, rejection reason
  `page_type_index_page`, with reasons `page_type_index_page`,
  `content_quality_below_60`, and `insufficient_clean_body_text`. A
  `market.update.extraction_skipped` memory event was recorded.
- Product surfaces: Research Feed keeps the Port of Long Beach item for audit.
  The historical bad signal remains visible only as suppressed/audit data with
  reason `source_quality_poor`; Morning Brief has zero market impact reviews
  and zero market signals for this source.
- Feedback recorded: none during H2.1, because the rerun created no new reviews
  or links. Historical feedback remains eight `irrelevant` and three
  `wrong_link`.
- Verification: `npx tsc --noEmit`,
  `npm run test:market-content-hygiene`,
  `npm run test:market-signal-suppression`, `npm run market:doctor`,
  `npm run memory:doctor`, and the final verification set passed.
- Failed/skipped checks: no second source was tested; cron was not enabled; no
  production DB commands were run; no operational freight records were mutated.
- Follow-up: H2.1 passed. It is reasonable to run one second-source pilot next,
  preferably `maersk-news-advisories`, then `cbp-csms`, then
  `drewry-world-container-index`, then `port-of-los-angeles-latest-news`. Keep
  scheduled ingestion disabled.

### 2026-06-22 - Deployment readiness audit

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Audit the dirty Phase 1 through H2.1 worktree for deployment readiness
  without staging, committing, deploying, live Firecrawl ingestion, production
  database commands, or product-behavior changes.
- Files changed: `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`.
- Verification: `npx prisma validate`, `npm run db:generate`,
  `npx tsc --noEmit`, `npm run test:security`, `npm run test:strategy`,
  `npm run test:memory`, `npm run test:memory-search`,
  `npm run test:morning-brief`, `npm run test:market-intelligence`,
  `npm run test:market-impact`, `npm run test:firecrawl`,
  `npm run test:source-quality`, `npm run test:scheduled-market-ingestion`,
  `npm run test:market-content-hygiene`,
  `npm run test:market-signal-suppression`, `npm run memory:doctor`,
  `npm run market:doctor`, `npm run audit:tenant-scope`, and
  `npm run build`, `npm run ai:handoff`, and final post-doc
  `npx tsc --noEmit` passed.
- Failed/skipped checks: no live Firecrawl ingestion was run; no production DB
  commands were run; no deployment was run; no files were staged or committed.
- Caveats: code/build/test readiness is better than deployment readiness. The
  current Prisma migrations are additive but not a full baseline for a fresh
  database, and local migration history shows the four new migrations are not
  applied locally. Fix the baseline/stamping strategy before a real staging or
  production deploy.
- Follow-up: create a release checkpoint with patch-level staging by phase,
  exclude local/generated files, configure Vercel env vars explicitly, run
  `prisma migrate deploy` only against a correctly baselined staging database,
  and keep market cron/live ingestion disabled.

### 2026-06-22 - D0 Prisma migration baseline and release packaging prep

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Add a pre-company-brain Prisma baseline migration so fresh staging
  databases can run `prisma migrate deploy`, while existing production
  databases with the pre-brain schema can mark the baseline as applied and then
  apply additive company-brain migrations.
- Files changed:
  `prisma/migrations/00000000000000_baseline_pre_brain/migration.sql`,
  `prisma/migrations/migration_lock.toml`,
  `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`,
  `docs/DECISIONS.md`, `docs/AI_HANDOFF.md`, and
  `docs/ENGINEERING_LOG.md`.
- Verification: baseline generated from `9727e55:prisma/schema.prisma`;
  baseline contains pre-brain tables only; migration order verified; disposable
  local Postgres database successfully ran `npx prisma migrate deploy` across
  all five migrations; `npx prisma migrate diff --from-url <throwaway-url>
  --to-schema-datamodel prisma/schema.prisma --exit-code` returned
  `No difference detected.`
- Failed/skipped checks: no production database commands were run; no live
  Firecrawl ingestion was run; cron was not enabled; no files were staged or
  committed.
- Caveats: existing production must be checked against the baseline before
  running `migrate resolve --applied
  00000000000000_baseline_pre_brain`. If production has schema drift, stop
  instead of stamping a lie into migration history.
- Follow-up: D1 should create clean release commits from the dirty worktree.

### 2026-06-22 - D1 release commit plan

- Branch: codex/lead-to-quote-batch
- Commit: not committed at planning time
- Task: Package the dirty Phase 1-H2.1 worktree into explicit release commits
  without staging secrets, local artifacts, generated files, live ingestion
  output, or unrelated junk.
- Planned commits:
  1. `chore(db): add pre-brain prisma baseline`
  2. `feat(memory): add company brain memory foundation`
  3. `feat(memory): add dossiers, morning brief, retrieval, and evidence`
  4. `feat(market): add market intelligence signal pipeline`
  5. `feat(market): add impact reviews and feedback loop`
  6. `feat(market): add firecrawl ingestion and research inbox`
  7. `feat(market): add source quality and scheduled ingestion controls`
  8. `chore(security): harden tokens portal pdf and ingestion guards`
  9. `fix(market): add extraction hygiene and signal suppression`
  10. `docs: add ai collaboration handoff and deployment runbooks`
- Staging rules: use explicit `git add -- <paths>` only; avoid `git add .`;
  use patch staging for truly mixed files where practical; leave suspicious
  files unstaged and report them.
- Verification planned: full D1 suite after the final release commit, including
  Prisma validation/generate, typecheck, all memory/market/security tests,
  doctors, tenant audit, build, and `npm run ai:handoff`.
- Caveats: several files are cross-phase (`package.json`, `prisma/schema.prisma`,
  `src/lib/agent-tools.ts`, `src/lib/agent-chat.ts`,
  `src/lib/memory/morning-brief.ts`, `scripts/market-doctor.ts`, and
  `src/app/globals.css`). Some intermediate commits may not build alone; the
  final release commit must pass.

### 2026-06-22 - D2 push release branch and prepare Vercel Preview

- Branch: codex/lead-to-quote-batch
- Commit: e9aa328
- Task: Push the clean D1 release branch and prepare safe Preview/Staging
  deployment guidance without production deploys, production DB commands, live
  Firecrawl ingestion, cron enablement, or operational data mutation.
- Files changed: `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`.
- Verification: pre-push `git status --short` was clean, branch was
  `codex/lead-to-quote-batch`, release commit stack was present,
  `npx tsc --noEmit` passed, and `git push origin
  codex/lead-to-quote-batch` succeeded. Remote branch head verified at
  `e9aa328`.
- Failed/skipped checks: Vercel Preview status and Preview env vars could not
  be checked because Vercel CLI is not installed and the repo has no
  `.vercel/project.json` link. Staging migrations were skipped because no
  explicit staging database URL was available locally.
- Caveats: local env points to a local Postgres database, not staging. Do not
  run `migrate deploy` until the staging database is explicitly confirmed.
- Follow-up: check the Vercel dashboard for the Preview deployment, configure
  Preview env vars, keep market cron disabled, run staging migrations only
  against a confirmed staging DB, then run D3 staging smoke tests.

### 2026-06-22 - D3A-FIX Vercel Hobby cron compatibility

- Branch: codex/lead-to-quote-batch
- Commit: 3ab82df
- Task: Fix a Vercel Preview deployment blocker on Hobby where
  `/api/cron/background-jobs` used `*/10 * * * *`, which runs more than once per
  day and is rejected before build.
- Files changed: `vercel.json`, `docs/AI_HANDOFF.md`,
  `docs/ENGINEERING_LOG.md`.
- Change: kept daily `risk-scan` and `gmail-sync` schedules, changed
  `/api/cron/background-jobs` to `0 9 * * *`, and documented that frequent sync
  needs Vercel Pro, an external scheduler, or manual/operator-triggered sync
  later.
- Verification: `npx tsc --noEmit`, `npm run build`, and
  `npm run ai:handoff` passed.
- Failed/skipped checks: no production deploy, no production DB command, no live
  Firecrawl ingestion, and no market cron enablement.
- Caveats: Vercel Hobby cron timing has hourly precision, not minute-level
  precision. This fix unblocks deployment; it is not a substitute for a real
  sub-daily job runner.

### 2026-06-22 - D3B Preview runtime, env, staging DB, and smoke test

- Branch: codex/lead-to-quote-batch
- Commit: 3ab82df
- Task: Verify the Ready Vercel Preview runtime, env readiness, staging DB
  migration safety, and smoke-test path without merging, deploying production,
  running production DB commands, enabling market cron, or running live
  Firecrawl.
- Files changed: `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`.
- Preview URL:
  `https://derya-crm-git-codex-lead-to-quote-batch-merts-projects-b132014b.vercel.app`
- Verification: local `git status --short` was clean before docs updates,
  branch/head were correct, and `npx tsc --noEmit` passed. Preview HTTP probes
  for `/`, `/login`, `/dashboard`, `/dashboard/intelligence`, `/api/health`,
  and cron routes all returned Vercel `401 Authentication Required`, so the
  deployment is Ready but deployment-protected from this shell.
- Failed/skipped checks: Preview env status could not be checked because Vercel
  CLI is unavailable, the repo is not linked with `.vercel/project.json`, and
  `/api/health` is behind deployment protection. Staging migrations were skipped
  because provider/separation/founder confirmation are unknown.
- Caveats: do not confuse Vercel Ready with app runtime verified. The build is
  deployed, but app shell, auth, dashboard, intelligence page, DB health, and
  cron auth still need testing with Preview access.
- Follow-up: get Preview access or a bypass token, confirm Preview env vars,
  confirm staging DB is separate from production, run migrations only against
  confirmed staging, then run D3 smoke tests before any H2.2 Firecrawl pilot.

### 2026-06-22 - D3C-DB Preview runtime schema mismatch triage

- Branch: codex/lead-to-quote-batch
- Commit: 3ab82df
- Task: Move Preview to a confirmed staging database and apply migrations after
  runtime logs showed schema mismatch errors.
- Files changed: `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`.
- Root cause: Preview runtime logs show Prisma `P2022` for missing
  `Inquiry.containerCount` and `P2021` for missing table
  `public.AgentProposal`, which means the Preview app is connected to an older
  database schema.
- Verification: `git status --short`, branch, recent log, and
  `npx tsc --noEmit` were checked. Local `DATABASE_URL` and
  `DATABASE_URL_UNPOOLED` point to local Postgres database `derya_crm_app`, not
  a confirmed staging/preview DB. Preview HTTP probes still return Vercel
  `401 Authentication Required`.
- Failed/skipped checks: migrations were skipped because staging provider,
  production separation, and founder confirmation were not provided. Vercel
  Preview env vars could not be inspected because Vercel CLI is not installed,
  there is no `.vercel/project.json`, and `/api/health` is protected.
- Caveats: this remains blocked until Vercel Preview points at a confirmed
  staging database and the migration path is run against that staging DB only.
  Do not use `db push`, `migrate dev`, or `migrate reset`.
- Follow-up: configure Preview `DATABASE_URL`/`DATABASE_URL_UNPOOLED` for a
  confirmed staging DB, run `prisma migrate deploy`, confirm `No difference
  detected`, redeploy Preview, then rerun runtime smoke tests.

### 2026-06-23 - P0 production cutover prep with fresh office and cherry-pick import

- Branch: codex/lead-to-quote-batch
- Commit: not committed
- Task: Add safe scripts and a runbook for cutting production over to a fresh
  current-schema Neon database, creating a real Office/Admin, and importing only
  selected old business data.
- Files changed: `package.json`, `scripts/create-production-office.ts`,
  `scripts/export-office-cherry-pick.ts`,
  `scripts/import-office-cherry-pick.ts`,
  `scripts/validate-office-import.ts`,
  `docs/RUNBOOKS/PRODUCTION_CUTOVER_CHERRY_PICK.md`,
  `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`, and
  `docs/DECISIONS.md`.
- Verification: refusal-path smoke checks for all four new scripts returned
  expected guard errors with no writes; `npx prisma validate`,
  `npm run db:generate`, `npx tsc --noEmit`, `npm run build`, and
  `npm run ai:handoff` passed.
- Failed/skipped checks: no production DB command was run, no production deploy
  was run, no merge to main was performed, no live Firecrawl ingestion was run,
  and market cron was not enabled.
- Caveats: import idempotency uses natural keys where the current schema has no
  source-id field. Company documents use a `metadata-only://...` URL sentinel
  because the schema requires a URL. Email import is off by default and
  sanitized if explicitly enabled.
- Follow-up: run the cutover only after a fresh production Neon DB is confirmed,
  use `prisma migrate deploy`, run import dry-run, review counts, import with
  explicit allow flag, validate, set Vercel Production env vars, then merge.

### 2026-06-23 - Production go-live merge

- Branch: main
- Merge commit: debe8182d99f928793c0ba076cbe6d6d7c51346c
- PR: #1, `codex/lead-to-quote-batch` -> `main`
- Task: merge the release branch after Preview validation and production env
  readiness, triggering Vercel Production from `main`.
- Release commit included:
  `073cd434bff8358a3d660147094273ada5307014`
  (`chore(cutover): add production office and cherry-pick import tooling`).
- Verification before merge: clean worktree, release branch at `073cd43`,
  remote `main` at old production commit `49d7154`, PR mergeable, Vercel
  preview status green, and `npx tsc --noEmit` passed.
- Merge method: GitHub CLI merge commit via `gh pr merge 1 --merge
  --delete-branch=false`.
- Failed/skipped checks: no database migrations were run, no `prisma db push`,
  `migrate dev`, or `migrate reset` command was run, no live Firecrawl
  ingestion was run, and market cron was not enabled.
- Vercel: watch Deployments -> Production for source branch `main`; the latest
  production deployment should not point at `49d7154`.
- Follow-up: run the production smoke checklist immediately: login as
  `mert@usederya.com`, confirm dashboard/intelligence/customer/job pages,
  quote PDF, portal-token behavior, Gmail OAuth redirect, cron auth rejection,
  and `MARKET_INTELLIGENCE_CRON_ENABLED=false`.

### 2026-06-23 - Production smoke test after go-live

- Branch: main
- Production URL: `https://www.derya.ai`
- Production commit from `/api/health`: `408261c`
- Deployment status: GitHub/Vercel status API reports success / deployment
  completed for the production deployment.
- Route checks: `/login` returned `200`; `/`, `/dashboard`,
  `/dashboard/intelligence`, `/dashboard/jobs`, `/dashboard/customers`,
  `/dashboard/inbox`, `/dashboard/pricing`, and `/dashboard/settings/email`
  returned `307` redirects to `/login`; `/api/health` returned `200` with
  `ok=true`.
- Health checks: DB ping passed, recent Prisma field checks passed, and
  background job backlog passed with `queued=0`, `failed=0`,
  `staleRunning=0`.
- Auth smoke: demo login with `admin@demo.local / admin1234` failed and
  redirected to `/login?error=1`, as expected. Real admin login for
  `mert@usederya.com` was not tested because the password/session was not
  available to this shell.
- Cron smoke: unauthenticated `/api/cron/market-intelligence` and
  `/api/cron/background-jobs` returned `401`.
- Runtime logs: Vercel CLI is not installed locally, so runtime logs were not
  directly available. No Prisma `P2021`/`P2022` or env errors surfaced through
  `/api/health`.
- Failed/skipped checks: no database migrations, `db push`, `migrate dev`,
  `migrate reset`, old-data import, live Firecrawl ingestion, or market cron
  enablement was run.
- Follow-up: manually log in as `mert@usederya.com` in production and verify
  authenticated dashboard/intelligence/customer/job surfaces plus quote PDF and
  portal-token behavior.

### 2026-06-23 - Derya Brain Ops documentation and controlled proposal path

- Branch: main-era dirty worktree
- Task: implement a Codex-native Derya Brain Ops layer from the attached prompt
  without duplicating the existing company-brain schema.
- Files changed: `AGENTS.md`, `CONTEXT.md`, `package.json`,
  `.agents/skills/*/SKILL.md`, `.codex/hooks/*`,
  `src/lib/brain-ops/ingest.ts`, `src/lib/brain-ops/query.ts`,
  `src/lib/brain-ops/types.ts`, `scripts/check-docs-fresh.ts`,
  `scripts/check-docs-fresh.test.ts`, `scripts/brain-ops.test.ts`,
  `docs/current-state/*`, `docs/brain/README.md`, `docs/sops/*`,
  `docs/templates/*`, `docs/decisions/DR-0001-derya-brain-ops.md`,
  `docs/gotchas.md`, `docs/DECISIONS.md`, `docs/ENGINEERING_LOG.md`, and
  `docs/AI_HANDOFF.md`.
- Behavior added: Brain Ops ingest validation, calibration source/proposal
  writes through existing `KnowledgeObject` and `AgentProposal`, exact-match
  organization linking, source-quote enforcement for commitments/decisions/
  risks/open questions, read-only brain query helpers, docs status checker,
  repo-scoped Codex skills, and advisory local Codex hook policy.
- Verification passed: `npm run test:docs`, `npm run test:brain`,
  `npm run check:docs`, and `npx tsc --noEmit`.
- Failed/skipped checks: no Prisma schema change was made, so no migration was
  generated. No production database command, live Firecrawl ingestion, or
  deployment command was run.
- Caveat: Brain Ops proposal review/apply UI and API routes are intentionally
  deferred. The first version is the service layer and operating discipline,
  because duplicating schemas or slapping on UI before review semantics are
  clear would make the brain less trustworthy, not more.

### 2026-06-23 - Live intelligence map and manual market ingestion controls

- Branch: main
- Task: make `/dashboard/intelligence` visually useful and add a production
  admin-only button for one-source market ingestion using deployed Vercel env
  vars.
- Files changed: `src/lib/market-intelligence/intelligence-map.ts`,
  `src/lib/market-intelligence/manual-ingestion.ts`,
  `src/app/dashboard/intelligence/actions.ts`,
  `src/app/dashboard/intelligence/manual-action-types.ts`,
  `src/app/dashboard/intelligence/page.tsx`,
  `src/components/intelligence/*`,
  `scripts/intelligence-map.test.ts`,
  `scripts/manual-market-ingestion-action.test.ts`, `package.json`,
  `docs/MARKET_INTELLIGENCE.md`, `docs/COMPANY_BRAIN.md`,
  `docs/AI_HANDOFF.md`, and `docs/ENGINEERING_LOG.md`.
- Behavior added: deterministic SVG world map, source-aware hotspots and lane
  arcs, first-ingestion empty state, runtime readiness badges, source health
  cards, admin-only preview/live manual ingestion controls, safe bundle pull,
  and safe result summaries.
- Safety gates: manual live ingestion requires
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true`, refuses when
  `MARKET_INTELLIGENCE_CRON_ENABLED=true`, uses an explicit safe source
  allowlist, clamps to three results/pages, blocks media/FreightWaves/JOC by
  default, and does not mutate operational freight records.
- Safe bundle: `maersk-news-advisories`, `drewry-world-container-index`, and
  `cbp-csms` only.
- Verification passed so far: `npx tsc --noEmit`,
  `npm run test:intelligence-map`,
  `npm run test:manual-market-ingestion-action`,
  `npm run test:intelligence-page-empty-state`,
  `npm run test:market-content-hygiene`,
  `npm run test:market-signal-suppression`,
  `npm run test:source-quality`, `npm run test:market-intelligence`, and
  `npm run test:market-impact`.
- Failed/skipped checks: no local live Firecrawl ingestion was run, no market
  cron was enabled, and no Prisma migration was required.

### 2026-06-23 - Granola meeting notes for Brain Ops operational context

- Branch: main dirty worktree
- Task: extend the Brain Ops implementation so Granola meeting notes can be
  added for customer, RFQ, and job workflows and later retrieved as
  source-backed operational context.
- Files changed: `src/lib/brain-ops/types.ts`,
  `src/lib/brain-ops/ingest.ts`, `src/lib/brain-ops/query.ts`,
  `scripts/ingest-granola-note.ts`, `scripts/brain-ops.test.ts`,
  `package.json`, `docs/brain/README.md`, `docs/sops/brain-ingest.md`,
  `docs/current-state/brain-ops.md`, `docs/COMPANY_BRAIN.md`,
  `docs/ENGINEERING_LOG.md`, and `docs/AI_HANDOFF.md`.
- Behavior added: `granola_meeting_note` source type, exact
  `operational_refs` for company/job/inquiry/contact linkage, source
  `KnowledgeObject` job/RFQ/customer context fields, `EntityMention` rows for
  exact refs, `getOperationalBrainContext`, and
  `npm run brain:ingest:granola`.
- Verification passed: `npx tsc --noEmit`, `npm run test:brain`.
- Failed/skipped checks: no Prisma schema change, migration, production
  database command, or live external ingestion was run.
- Caveat: extraction from raw Granola text is still an upstream agent/skill
  task. The controlled service accepts structured proposals and stores source
  text/provenance; it does not silently convert every sentence into trusted
  business truth.

### 2026-06-23 - Granola Brain Ops hardening pass

- Branch: main dirty worktree
- Task: second-pass hardening of Granola meeting-note ingest without adding a
  duplicate brain schema or Prisma migration.
- Files changed: `src/lib/brain-ops/types.ts`,
  `src/lib/brain-ops/ingest.ts`, `scripts/brain-ops.test.ts`,
  `docs/brain/README.md`, `docs/sops/brain-ingest.md`,
  `docs/current-state/brain-ops.md`, `docs/COMPANY_BRAIN.md`,
  `docs/ENGINEERING_LOG.md`, and `docs/AI_HANDOFF.md`.
- Behavior added: exact duplicate payloads now return existing source/proposal
  rows instead of throwing or writing duplicate proposals; Granola notes require
  `source.raw_text` or `source.source_uri`; supplied `userId` must belong to the
  same office; ambiguous exact contact/RFQ refs remain unresolved; id-only refs
  for email threads/messages, job documents, and strategy assessments are
  supported conservatively.
- Verification passed: `npm run test:brain`, `npm run check:docs`,
  `npm run test:docs`, `npx tsc --noEmit`, and `npm run build`.
- Failed/skipped checks: no Prisma schema change, migration, production
  database command, live external ingestion, or Firecrawl run was performed.
  No `.env` values were inspected or printed.

### 2026-06-23 - Intelligence page contrast and visibility hardening

- Branch: main dirty worktree
- Task: fix production `/dashboard/intelligence` readability after screenshot
  showed white/pale text on beige panels and weak right-panel contrast.
- Files changed: `src/components/intelligence/world-intelligence-map.tsx`,
  `src/components/intelligence/intelligence-hotspot-panel.tsx`,
  `src/components/intelligence/intelligence-source-card.tsx`,
  `src/components/intelligence/world-map-base.tsx`, `docs/AI_HANDOFF.md`, and
  `docs/ENGINEERING_LOG.md`.
- Behavior added: solid dark fallback surfaces for the map shell, hotspot
  panel, metric cards, and source cards; higher-contrast text colors; map label
  strokes for SVG readability; brighter grid labels.
- Verification passed: `npx tsc --noEmit`, `npm run test:intelligence-map`,
  `npm run test:intelligence-page-empty-state`, and `npm run build`.
- Failed/skipped checks: no live Firecrawl ingestion, database migration, or
  operational data mutation was run.

### 2026-06-23 - Intelligence map accuracy, CBP lane validation, and daily cron guard

- Branch: main dirty worktree
- Task: replace fake handmade geography with a real existing world map asset,
  prevent CBP/navigation boilerplate from becoming freight lanes, and add a
  safe daily market-intelligence automation path.
- Files changed: `src/lib/market-intelligence/world-map-asset.ts`,
  `src/components/intelligence/world-map-base.tsx`,
  `src/components/intelligence/world-intelligence-map.tsx`,
  `src/components/intelligence/intelligence-hotspot-panel.tsx`,
  `src/lib/market-intelligence/lane-validation.ts`,
  `src/lib/market-intelligence/extract-market-signals.ts`,
  `src/lib/market-intelligence/link-market-signals.ts`,
  `src/lib/market-intelligence/intelligence-map.ts`,
  `src/lib/market-intelligence/signal-suppression.ts`,
  `src/lib/market-intelligence/market-tools.ts`,
  `src/lib/memory/morning-brief.ts`,
  `src/lib/market-intelligence/scheduled-ingestion.ts`,
  `src/app/api/cron/market-intelligence/route.ts`,
  `src/app/dashboard/intelligence/page.tsx`,
  `scripts/cleanup-bad-cbp-market-reviews.ts`,
  `scripts/market-lane-validation.test.ts`,
  `scripts/intelligence-map.test.ts`,
  `scripts/market-signal-suppression.test.ts`, `scripts/market-doctor.ts`,
  `vercel.json`, `package.json`, and docs.
- Behavior added: Natural Earth 1:110m land data is now the offline map base;
  freight map coordinates include explicit ports, regions, countries, and
  chokepoints; lane validation rejects pseudo-lanes such as
  `Countdown -> America` and `Welcome -> U.S. Customs and Border`; CBP/regulatory
  content becomes U.S. customs/compliance context unless clean article body
  evidence contains a validated lane; invalid historical lane links are shown as
  suppressed audit data, not affected work.
- Automation added: `/api/cron/market-intelligence` is scheduled daily at
  `0 11 * * *`, requires `CRON_SECRET`, requires
  `MARKET_INTELLIGENCE_CRON_ENABLED=true` for live runs, clamps to one safe
  source/day by default, and excludes broad media/FreightWaves/JOC.
- Cleanup added: `npm run cleanup:bad-cbp-market-reviews` dismisses only pending
  CBP lane reviews whose lane labels match boilerplate/pseudo-lane rules. It is
  guarded by `ALLOW_MARKET_REVIEW_CLEANUP=1` and does not delete records.
- Verification passed so far: `npx tsc --noEmit`,
  `npm run test:market-lane-validation`,
  `npm run test:market-signal-suppression`,
  `npm run test:intelligence-map`,
  `npm run test:scheduled-market-ingestion`,
  `npm run test:market-content-hygiene`, and
  `npm run test:market-intelligence`,
  `npm run test:manual-market-ingestion-action`,
  `npm run test:source-quality`, `npm run test:market-impact`,
  `npm run test:firecrawl`, `npm run test:morning-brief`,
  `npm run market:doctor`, `npm run memory:doctor`, `npm run build`, and
  `npm run ai:handoff`.
- Failed/skipped checks: no live Firecrawl ingestion, Prisma migration,
  production DB cleanup, or operational data mutation was run.

### 2026-06-28 - Workbench navy map visual refresh

- Branch: main
- Commit: not committed
- Task: Refresh the focused workbench first viewport to match the requested
  navy/white control-tower direction with notebook gridlines, topbar subtitle,
  real route map, country flags, route ETD/ETA strip, remaining brown-surface
  cleanup, and no dead desktop gap before the agent rail.
- Files changed: `src/app/dashboard/layout.tsx`,
  `src/app/dashboard/page.tsx`, `src/app/globals.css`,
  `src/app/icon.tsx`, `src/components/logo-mark.tsx`,
  `src/lib/route-map-viewport.ts`, `scripts/route-map-viewport.test.ts`,
  `scripts/seed-map-example-loads.ts`, `package.json`, `docs/AI_HANDOFF.md`,
  `docs/DECISIONS.md`, and `docs/ENGINEERING_LOG.md`.
- Behavior added: dashboard topbar now shows `Derya Deal Desk` plus
  `Freight Control Tower`; focused deal brief uses OpenStreetMap tiles, a
  route summary strip, sea-waypoint route paths, deterministic city/port lookup,
  dynamic country flags, fitted Web Mercator overview tiles, three route-linked
  zoom sections for long lanes, and responsive mobile map layout. Origin and
  destination details are kept in the compact route summary above the map, not
  duplicated as cards inside the map. Final CSS layer replaces the older warm
  notebook palette with navy/white panels and gridline background; logo, app
  icon, focus/status pills, and reference-deal sheet surfaces use the new
  navy/blue token set; desktop workbench now expands to the agent rail.
- Seed data added: `npx tsx scripts/seed-map-example-loads.ts` creates or
  updates `DEMO-MAP-001` Port Klang, MY to Istanbul, TR and `DEMO-MAP-002`
  Shanghai, CN to Mersin, TR in the local demo office.
- Verification: `npx tsc --noEmit`, `npm run check:docs`,
  `npm run test:route-map`, and the map seed script passed. Browser smoke
  passed on local dev server after logging in as
  `admin@demo.local / admin1234`; desktop checks for both seeded map jobs found
  expected origin/destination text in the route strip, zero map endpoint cards,
  fitted overview tiles, route-linked zoom panel overlays, no broken map images,
  sea waypoints in the rendered route paths, no console errors, and zero old
  brown/tan hits in the requested sheet/focus/logo color scan. Mobile 390px
  check for `DEMO-MAP-001` found route strip/map labels present, 8/8 tiles
  loaded, and no overflow.
- Failed/skipped checks: no production build, database migration, or live
  external ingestion was run.
- Caveats: map tiles are direct public OpenStreetMap URLs and should become a
  proper production map-provider/caching setup before real traffic. Location
  placement is deterministic lookup-based, not geocoder-backed.

### 2026-06-23 - V2 Intelligence map visual QA and production cleanup guard

- Branch: main dirty worktree
- Task: make the Intelligence map visibly read as a real world map, preserve the
  Natural Earth map asset, reduce text noise, and prepare safe CBP cleanup
  without running it against an unconfirmed database.
- Files changed: `src/components/intelligence/world-intelligence-map.tsx`,
  `src/components/intelligence/world-map-base.tsx`,
  `src/components/intelligence/intelligence-hotspot-panel.tsx`,
  `scripts/intelligence-map.test.ts`, `docs/AI_HANDOFF.md`, and
  `docs/ENGINEERING_LOG.md`.
- Behavior added: fixed reference labels for continents, freight ports, and
  chokepoints; stronger land/ocean/coastline contrast; empty-state copy
  `Pull trusted market data to light up the map.`; collapsed hotspot evidence
  refs; regression coverage that fails if the map stops using the Natural Earth
  asset or loses the reference layers.
- Cleanup status: skipped locally because `DATABASE_URL` was not configured in
  the shell, so the target could not be confirmed as production Neon. The
  guarded command remains
  `ALLOW_MARKET_REVIEW_CLEANUP=1 npm run cleanup:bad-cbp-market-reviews`.
- Verification passed so far: `npx tsc --noEmit`,
  `npm run test:intelligence-map`,
  `npm run test:market-lane-validation`,
  `npm run test:market-signal-suppression`,
  `npm run test:market-content-hygiene`, `npm run test:source-quality`,
  `npm run test:market-intelligence`, and `npm run test:market-impact`.
- Failed/skipped checks: no live Firecrawl ingestion, Prisma migration,
  production DB cleanup, or operational data mutation was run.

### 2026-06-28 - Native Derya load/RFQ inboxes

- Branch: main
- Commit: not committed
- Task: Make `mert@usederya.com` and `oguzhan@usederya.com` first-class
  native Gmail sources for load/RFQ mail, with Company Brain-style workflow
  labels focused on load/RFQ relevance.
- Files changed: `src/lib/derya-inboxes.ts`,
  `src/lib/email-workflow-labels.ts`, `src/lib/gmail-oauth.ts`,
  `src/lib/gmail-sync.ts`, `src/app/api/auth/gmail/start/route.ts`,
  `src/app/dashboard/settings/email/page.tsx`,
  `src/app/dashboard/inbox/page.tsx`,
  `src/components/sync-derya-inboxes-button.tsx`,
  `src/components/thread-accordion.tsx`, `src/app/globals.css`,
  `scripts/email-workflow-labels.test.ts`, `package.json`, and docs.
- Behavior added: settings now shows the two expected Derya inboxes with
  connected/paused/missing status, targeted OAuth connect links, per-account
  sync, and a combined sync action. Inbox now warns if either expected inbox is
  missing, adds a `Load/RFQ` filter, and shows derived `load/*` labels on
  threads/messages. Gmail OAuth uses account selection plus `login_hint`.
  Gmail sync stores safe workflow-label metadata in memory payloads and keeps
  sweeping the last year while excluding spam/trash.
- Follow-up adjustment: the required Derya inbox list now defaults to
  Mert/Oguzhan but can be extended with comma-separated
  `DERYA_LOAD_RFQ_INBOXES` in production.
- Verification: `npm run test:email-labels`, `npx tsc --noEmit`,
  `npm run check:docs`, and `npm run test:brain` passed. Local dev smoke on
  `http://localhost:3000` confirmed `/dashboard/inbox` and
  `/dashboard/settings/email` redirect unauthenticated users to `/login`; the
  targeted Gmail start route now does the same instead of turning the auth
  redirect into a 500.
- Failed/skipped checks: no real Gmail OAuth consent or live Gmail sync was run
  from this agent session; real accounts still require user consent.
- Caveats: labels are Derya workflow labels derived from app state, not Gmail
  label mutations. No schema migration was added.

### 2026-06-28 - Gmail OAuth redirect env guard

- Branch: main
- Commit: not committed
- Task: Stop production Gmail OAuth from sending Google a malformed
  `redirect_uri` when `GOOGLE_REDIRECT_URI` is accidentally pasted into Vercel
  as `GOOGLE_REDIRECT_URI=https://...` instead of only the URL value.
- Files changed: `src/lib/gmail-oauth.ts`,
  `src/app/api/auth/gmail/start/route.ts`,
  `src/app/api/auth/gmail/callback/route.ts`,
  `src/app/api/health/route.ts`, `scripts/gmail-oauth-config.test.ts`,
  `package.json`, `docs/AI_HANDOFF.md`, and `docs/ENGINEERING_LOG.md`.
- Behavior added: Gmail OAuth now normalizes the configured redirect URI before
  building the Google auth URL. `/api/health` reports the sanitized redirect
  URI and a boolean diagnostic for the env-key prefix so bad Vercel config is
  visible without leaking secrets. OAuth start prefers the current request
  origin for the callback URI, and callback token exchange uses the callback
  request origin so `www` sessions do not bounce through the apex domain.
- Verification: `npm run test:gmail-oauth`, `npm run test:email-labels`,
  `npx tsc --noEmit`, and `npm run build` passed.
- Failed/skipped checks: no real Gmail OAuth consent was completed from this
  agent session.
- Caveats: production should still correct the Vercel env value and keep the
  Google Cloud OAuth Web Client authorized redirect URIs exactly matched to the
  callback URLs operators use.

### 2026-06-29 - Sidebar hover rail, full-height agent dock, and walnut/navy palette cleanup

- Branch: main
- Commit: not committed
- Task: Replace the button-driven sidebar with hover/focus expansion, make the
  agent a full-height right-side dock across the app, reclaim page width when
  the agent is collapsed, and bring the visible UI back into the requested
  walnut, navy, light blue-gray, and white palette.
- Files changed: `src/app/dashboard/layout.tsx`,
  `src/app/dashboard/settings/email/page.tsx`, `src/app/globals.css`,
  `src/components/agent-chat-widget.tsx`,
  `src/components/intelligence/intelligence-source-card.tsx`,
  `src/components/intelligence/manual-market-ingestion-controls.tsx`,
  `src/components/intelligence/world-intelligence-map.tsx`,
  `docs/AI_HANDOFF.md`, and `docs/ENGINEERING_LOG.md`.
- Behavior added: desktop sidebar now collapses to a narrow rail and expands on
  hover/focus with no visible toggle button. The global agent is a full-height
  right dock on non-workbench pages and only reserves layout width while open;
  collapsed state restores the page width and shows a compact overlay launcher.
  The dashboard workbench agent is full viewport height and its collapsed state
  returns the right-side width to the workbench. A final authoritative CSS layer
  normalizes app colors to walnut/navy/light blue-gray/white, with calm maroon
  and dark green reserved for semantic warnings/success states. The Gmail mark,
  setup gates, and Intelligence controls/source/map surfaces were toned down to
  the same token set.
- Verification: `npx tsc --noEmit` passed. Browser smoke on local dev server
  at `http://localhost:3001` passed after logging in as
  `admin@demo.local / admin1234`. Desktop dashboard measurements at 1440x900
  found the sidebar at 58px collapsed and 236px on hover, the embedded agent at
  full viewport height, and workbench right padding returning to `0px` after
  agent collapse. Desktop email settings measurements found the global agent at
  full viewport height and content expanding to the full available width after
  collapse. Mobile 390x844 email settings check found no horizontal overflow.
- Failed/skipped checks: no schema migration, dependency change, production
  build, live Gmail sync, live external ingestion, or production deployment was
  run.
- Caveats: `src/app/globals.css` still contains older overridden color layers.
  The final layer controls the current UI, but the file needs a later deletion
  pass; otherwise every visual fix just adds more CSS archaeology.

### 2026-06-29 - Follow-up shell/agent layout correction

- Branch: main
- Commit: not committed
- Task: Fix the remaining layout regressions from the shell redesign: dashboard
  agent missing in some states, collapsed-agent blank right space on sidebar
  pages, brown sidebar icons, weak assistant button affordances, and loud
  decision/setup status colors.
- Files changed: `src/components/agent-chat-widget.tsx`,
  `src/components/job-conversation-panel.tsx`,
  `src/app/dashboard/settings/email/page.tsx`, `src/app/globals.css`,
  `docs/AI_HANDOFF.md`, and `docs/ENGINEERING_LOG.md`.
- Behavior added: `/dashboard` now suppresses the global dock only when an
  embedded workbench agent is actually present; otherwise the global full-height
  right dock appears. Collapsed global-agent pages reclaim the full content
  width. Collapsed embedded workbench agent returns right padding to `0px`.
  Assistant headers now read `Agent`, `Desk Assistant`, and `RFQs, target price,
  forwarder replies`; close/send buttons have visible white icons. Sidebar nav
  icons stay white. Decision queue and setup gate warning states use white
  surfaces with calm maroon/dark-green status accents instead of panel-wide
  red/green/tan fills.
- Verification: `npx tsc --noEmit`, `npm run check:docs`, and `npm run build`
  passed. Browser smoke on local dev server at `http://localhost:3001` passed
  after logging in as `admin@demo.local / admin1234`. Desktop measurements at
  1440x900 confirmed
  email settings global dock full height, collapsed content/cards expanding to
  `1382px`/`1322px`, dashboard embedded-agent padding returning from `478.8px`
  to `0px` after collapse, dashboard fallback global agent appearing when no
  embedded workbench agent exists, white sidebar icons, white blocked decision
  surfaces with maroon edge, white setup gates with maroon edge, and no
  horizontal overflow across Inbox, Pricing, Intelligence, CRM, Email, and
  Admin with the agent collapsed.
- Failed/skipped checks: no schema migration, live Gmail sync, or external
  ingestion was run.
- Caveat: the local database currently has a focused workbench job, so the
  no-embedded dashboard fallback was verified by removing the embedded agent in
  the browser and observing the global dock mount through the new observer.

### 2026-06-29 - Gmail hourly sync and historical backfill windows

- Branch: main
- Commit: not committed
- Task: Fix missing older Gmail messages and make production mail refresh at
  least hourly.
- Files changed: `src/lib/gmail-sync.ts`, `src/lib/gmail-sync-windows.ts`,
  `src/lib/background-jobs.ts`,
  `src/app/api/cron/background-jobs/route.ts`,
  `src/app/dashboard/settings/email/page.tsx`,
  `src/components/sync-account-button.tsx`,
  `src/components/sync-derya-inboxes-button.tsx`,
  `scripts/gmail-sync-windows.test.ts`,
  `.github/workflows/hourly-gmail-sync.yml`, `package.json`, `vercel.json`,
  and docs.
- Behavior added: manual Gmail sync now performs an immediate recent sync and
  queues monthly historical backfill windows for the last five years.
  Background jobs can execute `GMAIL_SYNC_WINDOW` payloads against a specific
  Gmail search window, and the background drain defaults to 25 jobs per run.
  A GitHub Actions scheduler calls Gmail sync and background-job drain hourly
  with `CRON_SECRET`; Vercel cron remains daily because Hobby deployments
  reject hourly cron expressions. Post-sync AI automation is scoped to threads
  touched by the run, avoiding repeated office-wide auto-link passes during
  historical backfill.
- Verification: `npm run test:gmail-sync-windows`, `npm run test:gmail-oauth`,
  `npm run test:email-labels`, `npx tsc --noEmit`, and `npm run build`
  passed.
- Failed/skipped checks: no live Gmail sync or production cron run was executed
  from this agent session.
- Caveats: the hourly GitHub Actions workflow requires repository secret
  `CRON_SECRET` to match production. Historical counts will rise progressively
  as queued window jobs drain; it is not a single synchronous import.

### 2026-06-29 - Move Gmail hourly schedule to Vercel Pro cron

- Branch: main
- Commit: not committed
- Task: After the project was upgraded to Vercel Pro, remove the external
  hourly scheduler workaround and make Vercel cron the production scheduler.
- Files changed: `vercel.json`, `.github/workflows/hourly-gmail-sync.yml`,
  `docs/AI_HANDOFF.md`, `docs/DECISIONS.md`, and
  `docs/ENGINEERING_LOG.md`.
- Behavior added: `/api/cron/gmail-sync` now runs hourly via Vercel cron, and
  `/api/cron/background-jobs` runs hourly five minutes later. The GitHub
  Actions workflow was removed so production does not double-run Gmail sync.
- Verification: `npm run check:docs`, `npx tsc --noEmit`, and
  `npm run build` passed.
- Failed/skipped checks: no live production cron run was triggered manually.
- Caveats: Vercel is now the only expected hourly scheduler. Re-adding an
  external scheduler would duplicate sync unless Vercel cron is disabled first.

### 2026-06-30 - Domestic trucking instant pricing V1

- Branch: codex/domestic-pricing-live-20260630
- Commit: not committed
- Task: Make the approved domestic trucking instant pricing slice visible in
  the app and sidebar.
- Files changed: `src/lib/domestic-trucking-pricing.ts`,
  `src/components/domestic-trucking-rate-panel.tsx`,
  `src/app/dashboard/domestic-pricing/page.tsx`,
  `src/app/dashboard/layout.tsx`,
  `src/app/dashboard/rfq/[inquiryId]/page.tsx`, `src/app/globals.css`,
  `scripts/domestic-trucking-pricing.test.ts`, and docs.
- Behavior added: `/dashboard/domestic-pricing` lists recent office-scoped RFQs
  and evaluates domestic trucking eligibility, missing provider fields,
  mock/manual provider readiness, simulated rate options, draft quote
  economics, approval warnings, and brain-context placeholders. RFQ detail gets
  a compact `Check domestic trucking rates` panel before conversion.
- Verification: `npx tsx scripts/domestic-trucking-pricing.test.ts`,
  `npx tsc --noEmit`, `npm run check:docs`, and
  `DATABASE_URL='postgresql://local:local@127.0.0.1:5432/derya_crm_dummy' npm run build`
  passed.
- Failed/skipped checks: no live provider API, GBrain retrieval, booking,
  tendering, customer send, DB migration, or credential check was run. Those
  paths intentionally do not exist in V1.

### 2026-06-30 - Make domestic trucking page US-only and loadboard-like

- Branch: codex/domestic-pricing-us-loadboard-20260630
- Commit: not committed
- Task: Correct the domestic pricing wedge after live review showed Turkey and
  international lanes being labeled as domestic, and make the page feel more
  like a loadboard with a map.
- Files changed: `src/lib/domestic-trucking-pricing.ts`,
  `src/app/dashboard/domestic-pricing/page.tsx`, `src/app/globals.css`,
  `scripts/domestic-trucking-pricing.test.ts`, and docs.
- Behavior added: domestic pricing now classifies lane scope as `US_DOMESTIC`,
  `NON_US`, or `UNKNOWN`. Only US pickup to US delivery lanes can produce mock
  rate options. The page now opens with a loadboard table, selected-lane OSM
  map, and a `Blocking real data` panel explaining provider/data blockers.
- Verification: `npx tsx scripts/domestic-trucking-pricing.test.ts`,
  `npx tsc --noEmit`, `npm run check:docs`, and
  `DATABASE_URL='postgresql://local:local@127.0.0.1:5432/derya_crm_dummy' npm run build`
  passed.
- Failed/skipped checks: no live provider API, geocoding service, DAT/Truckstop
  account, booking, tendering, customer send, DB migration, or credential read
  was run. Map locations are deterministic city/state/ZIP matches, not
  external geocoding.

### 2026-06-30 - Reviewed RFQ-to-load creation from Inbox

- Branch: main
- Commit: not committed
- Task: Add a reviewed one-click path from detected email RFQs to active loads,
  with customer-history autofill for unspecified details.
- Files changed: `src/lib/rfq-load-draft-core.ts`,
  `src/lib/rfq-load-review.ts`, `src/lib/rfq-promote.ts`,
  `src/components/rfq-load-review-button.tsx`,
  `src/components/rfq-row-actions.tsx`,
  `src/components/create-inquiry-button.tsx`,
  `src/app/dashboard/rfq/[inquiryId]/page.tsx`,
  `src/app/dashboard/rfq/[inquiryId]/actions.ts`, `src/app/globals.css`,
  `scripts/rfq-load-draft.test.ts`, `package.json`, and docs.
- Behavior added: Inbox RFQs now open a review modal before becoming active
  loads. The draft builder uses current RFQ fields first, then proposed-load
  edits, then recent same-customer prior loads for carry-forward fields. Prior
  target price is intentionally excluded from carry-forward. Created loads are
  `INQUIRY` stage, email threads are linked to the load, and memory records
  include field-source provenance.
- Verification: `npm run test:rfq-load-draft`, `npx tsc --noEmit`,
  `npm run check:docs`, and `npm run build` passed.
- Failed/skipped checks: interactive browser click-through of the modal was not
  run from this session.
- Caveats: the thread-card action still creates an RFQ first. The reviewed
  load-creation modal is exposed from Inbox RFQs and RFQ detail.

### 2026-06-30 - Reset video demo loads into Inbox

- Branch: main
- Commit: not committed
- Task: Remove old demo/fake loads and create two reproducible demo loads that
  appear from the Inbox like normal load/RFQ records.
- Files changed: `scripts/reset-video-demo-loads.ts`,
  `src/app/dashboard/inbox/page.tsx`, `src/app/dashboard/jobs/page.tsx`,
  `src/app/api/admin/run-demo-setup/route.ts`, `src/lib/agent-tools.ts`,
  `src/lib/seed-demo-load-action.ts`, `src/components/seed-demo-button.tsx`,
  `package.json`, and docs.
- Behavior added: `npm run demo:video-loads` dry-runs demo cleanup, and
  `npm run demo:video-loads -- --apply` deletes demo-marked
  loads/RFQs/threads before seeding exactly two video-demo loads. The Inbox now
  has a `Demo` filter at `/dashboard/inbox?filter=_DEMO`, and the visible
  legacy `Setup data` button was removed from Inbox and Jobs headers. The old
  admin route, server-action wrapper, and agent tool now refuse the legacy demo
  seed path and point to the explicit reset command instead.
- Verification: local Prisma verification confirmed the two seeded demo loads
  have linked inbox threads, inquiries, approved contacts, carrier quotes,
  target price history, milestones, and job documents. `npx tsc --noEmit`,
  `npm run check:docs`, and `npm run build` passed.
- Failed/skipped checks: browser-authenticated visual review of the Inbox demo
  filter was not run from this session.

### 2026-06-30 - Inbox Today fast lane and manual sync access

- Branch: main
- Commit: not committed
- Task: Make same-day RFQs easy to see in Inbox and expose a faster manual
  pull path for newly arrived Derya RFQ mail.
- Files changed: `src/app/dashboard/inbox/page.tsx`, `src/app/globals.css`,
  `docs/AI_HANDOFF.md`, and `docs/ENGINEERING_LOG.md`.
- Behavior added: Inbox now has a `Today` filter chip and a compact default
  Today section showing same-day thread activity by `lastMessageAt`. The Inbox
  header now includes `Sync Derya inboxes`, reusing the existing combined Gmail
  sync server action for configured load/RFQ inboxes.
- Timezone behavior: Today uses `DERYA_INBOX_TIME_ZONE` when set, otherwise
  `America/Los_Angeles`, to avoid production UTC slicing same-day operator
  work incorrectly.
- Production sync attempt: local DB only contained `demo-inbox@usederya.com`,
  so no real local Gmail pull was possible. A production cron trigger was
  attempted for `/api/cron/gmail-sync` and `/api/cron/background-jobs`, but
  production returned `401 Unauthorized` because the local `CRON_SECRET` did
  not match production. No production sync was run from this shell.
- Verification: `npx tsc --noEmit`, `npm run check:docs`, and `npm run build`
  passed.

### 2026-06-30 - Today RFQ filter and rfq@ source routing

- Branch: main
- Commit: not committed
- Task: Let the Today inbox fast lane jump directly to same-day RFQs, and use
  `rfq@usederya.com` as a deterministic RFQ source signal.
- Files changed: `src/app/dashboard/inbox/page.tsx`,
  `src/lib/derya-inboxes.ts`, `src/lib/email-classifier.ts`,
  `src/lib/thread-actions.ts`, `src/app/globals.css`,
  `scripts/email-classifier.test.ts`, `scripts/email-workflow-labels.test.ts`,
  `package.json`, and docs.
- Behavior added: `/dashboard/inbox?filter=_TODAY&view=rfqs` now filters the
  RFQ table by same-day inquiry receipt or same-day linked thread activity.
  The Today panel has separate `Threads` and `RFQs` buttons. Inbound messages
  from configured RFQ source senders defaulting to `rfq@usederya.com` classify
  as `RFQ` before LLM classification, count as load/RFQ-related in filters, and
  add a source-signal hint to the auto-link/create prompt.
- Verification: `npm run test:email-classifier`, `npm run test:email-labels`,
  `npm run test:rfq-load-draft`, `npx tsc --noEmit`, `npm run check:docs`,
  and `npm run build` passed.
- Caveats: if the RFQ source alias starts receiving non-RFQ mail, it will
  intentionally surface in RFQ workflows until removed from
  `DERYA_RFQ_SOURCE_EMAILS` or routed elsewhere.

### 2026-06-30 - Giresun to Ancona workflow load seed

- Branch: main
- Commit: not committed
- Task: Create a reproducible, real-looking copy of the Giresun, Turkey to
  Ancona, Italy load that is complete enough for an end-to-end RFQ to booked
  load walkthrough.
- Files changed: `scripts/seed-giresun-workflow-load.ts`,
  `src/app/api/admin/seed-giresun-workflow/route.ts`, `package.json`,
  `src/app/dashboard/page.tsx`, `docs/AI_HANDOFF.md`, and
  `docs/ENGINEERING_LOG.md`.
- Behavior added: `npm run seed:giresun-workflow` dry-runs the seed; `npm run
  seed:giresun-workflow -- --apply --create-seed-inbox` creates the Avlia Home
  customer/contact, RFQ, booked job, inbox threads, forwarder rates, accepted
  customer quote, quote lines, target-price history, milestones, and generated
  PDF document records. Add `--reset` to replace the existing seeded copy.
  `POST /api/admin/seed-giresun-workflow` exposes the same operation in
  production, scoped to the logged-in ADMIN user's office.
- Bug fixed: the focused dashboard now reads quote lines through
  `parseQuoteLines(job)`, so clean `Job.quoteLines` records render the same way
  on the dashboard as they do on the job page and quote PDF.
- Verification: `npm run seed:giresun-workflow`, `npm run
  seed:giresun-workflow -- --apply --create-seed-inbox`, Prisma verification of
  the seeded job graph, `npm run test:workbench-route-map`, `npm run
  test:route-map`, `npx tsc --noEmit`, `npm run check:docs`, and `npm run
  build` passed.
- Failed/skipped checks: browser-authenticated visual QA was not run in this
  session.
- Caveats: generated PDFs are walkthrough artifacts, not legal shipment
  documents.

### 2026-07-01 - Pentest demo sandbox account

- Branch: main
- Commit: not committed
- Task: Create a disposable demo account and synthetic tenant for pentesters
  without exposing real or real-looking operational data, while keeping the
  agent's commercial/memory surfaces usable.
- Files changed: `scripts/create-pentest-demo-account.ts`, `package.json`,
  `docs/AI_HANDOFF.md`, and `docs/ENGINEERING_LOG.md`.
- Behavior added: `npm run seed:pentest-demo` dry-runs the seed, and `npm run
  seed:pentest-demo -- --apply` creates `Pentest Sandbox Office` with
  `pentest@derya-pentest.invalid`, one synthetic RFQ/load, carrier quote
  comparisons, email threads/messages, documents, milestones, target-price
  history, lane/margin reference data, memory objects/events, and an active
  commercial strategy assessment. `npm run test:pentest-demo` verifies the
  account, seeded graph, memory search, customer dossier, no OAuth tokens,
  tenant-local job reference, and strategy guardrail.
- Security posture: the seed writes no OAuth tokens, provider credentials,
  live-send records, imported production facts, or real customer data. The
  pentest password is `PENTEST_DEMO_PASSWORD` when set, otherwise the default
  `PentestDemo!2026`.
- Verification: `npm run seed:pentest-demo`, `npx tsc --noEmit`,
  `npm run seed:pentest-demo -- --apply`, an idempotent rerun of
  `npm run seed:pentest-demo -- --apply`, and `npm run test:pentest-demo`
  passed before this log entry.
- Failed/skipped checks: browser-authenticated LLM chat was not clicked in this
  session; runtime chat still depends on `ANTHROPIC_API_KEY`.
- Caveats: the local account was created in the configured local database only.

### 2026-07-01 - Remove public sample/admin login paths

- Branch: main
- Commit: not committed
- Task: Remove the visible legacy sample-admin login path, disable public
  office creation from the login surface, remove the legacy admin account from
  the local DB, and fix the pentest seed so the documented password works.
- Files changed: `src/app/login/page.tsx`, `src/app/signup/page.tsx`,
  `scripts/create-pentest-demo-account.ts`,
  `scripts/remove-demo-admin-account.ts`,
  `scripts/reset-video-demo-loads.ts`,
  `scripts/seed-giresun-workflow-load.ts`,
  `scripts/seed-map-example-loads.ts`, `prisma/seed.ts`, `package.json`,
  `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`, and `docs/DECISIONS.md`.
- Behavior added: login now renders only the sign-in form; `?demo=1` no longer
  prefills `admin@demo.local`; the public `/signup` route is removed; each
  `seed:pentest-demo -- --apply` resets the pentest password to
  `PENTEST_DEMO_PASSWORD` when set or `PentestDemo!2026` otherwise; and
  `cleanup:demo-admin` deletes legacy `admin@demo.local` users from the target
  database. The older demo seed scripts now choose the first active admin
  instead of hard-coding `admin@demo.local`, and `prisma/seed.ts` no longer
  recreates that legacy account.
- Local data change: ran `npm run seed:pentest-demo -- --apply` to reset the
  local pentest account password, then ran
  `npm run cleanup:demo-admin -- --apply` and deleted one `admin@demo.local`
  user from `Istanbul Office`.
- Verification: `npm run seed:pentest-demo -- --apply`,
  `npm run cleanup:demo-admin`, `npm run cleanup:demo-admin -- --apply`,
  `npm run test:pentest-demo`, `npm run test:demo-admin-removed`,
  `npm run check:docs`, `npm run build`, and `npx tsc --noEmit` passed before
  this log entry.
- Failed/skipped checks: the first `npx tsc --noEmit` run after deleting
  `/signup` failed on stale generated `.next/types/app/signup` files. The build
  regenerated Next types and the rerun passed.
- Caveats: database cleanup applies only to whichever database `DATABASE_URL`
  targets when the command is run.

### 2026-07-01 - Production pentest account auto-provisioning

- Branch: main
- Commit: not committed
- Task: Fix the real hosted login failure for
  `pentest@derya-pentest.invalid` after local verification passed but
  production still returned invalid credentials.
- Root cause: production `/api/health` reported commit `3ecdd12` with healthy
  DB connectivity, and an actual hosted login POST redirected to
  `/login?error=1`. The code was deployed; the production database did not have
  a usable pentest sandbox account/password.
- Files changed: `scripts/create-pentest-demo-account.ts`,
  `src/app/api/cron/pentest-demo/route.ts`, `vercel.json`,
  `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`, and `docs/DECISIONS.md`.
- Behavior added: the pentest seed script is now import-safe and exposes
  `ensurePentestDemoSeed`; `/api/cron/pentest-demo` uses the existing
  `CRON_SECRET` auth convention to verify or repair the sandbox account and
  delete legacy `admin@demo.local` rows; Vercel runs that route every 5 minutes.
- Verification: production health and hosted login failure were reproduced
  before the fix; `npm run test:pentest-demo`, `npm run
  test:demo-admin-removed`, `npx tsc --noEmit`, `vercel.json` JSON parsing,
  import smoke for `ensurePentestDemoSeed`, route smoke for unauthorized and
  authorized cron requests, `npm run check:docs`, and `npm run build` passed
  locally.
- Post-deploy verification: commit `12a6243` reached production, the Vercel
  cron repaired the target DB by `20:40:52 UTC`, pentest login returned `303`
  to `/dashboard`, authenticated `/dashboard` returned `200`, legacy
  `admin@demo.local / admin1234` still returned `303` to `/login?error=1`, and
  `/signup` returned `404`.
- Caveats: if the production DB is reset or the sandbox is damaged later, the
  cron should repair it on the next 5-minute run.

### 2026-07-01 - RFQ Brain Context V1 safety hardening

- Branch: main
- Commit: not committed
- Task: Harden the existing RFQ Brain Context / Domestic Trucking Rates V1 so
  operators can see domestic eligibility, missing fields, source-tagged
  mock/manual rate options, draft quote economics, and read-only brain-context
  placeholders without confusing any of it for live freight execution.
- Files changed: `PRODUCT_IMPLEMENTATION_PLAN_RFQ_BRAIN_CONTEXT_V1.md`,
  `src/lib/domestic-trucking-pricing.ts`,
  `src/components/domestic-trucking-rate-panel.tsx`, `src/app/globals.css`,
  `scripts/domestic-trucking-pricing.test.ts`, `docs/AI_HANDOFF.md`,
  `docs/ENGINEERING_LOG.md`, and `docs/DECISIONS.md`.
- Behavior added: provider-neutral adapters now expose required-field,
  normalization, and sandbox methods; rate options carry mock/manual/live
  source labels, provenance, selected-draft-basis state, terms, and notes; the
  assessment exposes eligibility status, operator next questions, V1 safety
  labels, and a non-persisted audit preview; the panel shows draft/send/approval
  state directly.
- Verification:
  `DATABASE_URL='postgresql://local:local@127.0.0.1:5432/derya_crm_dummy' npx prisma validate`,
  `DATABASE_URL='postgresql://local:local@127.0.0.1:5432/derya_crm_dummy' npm run db:generate`,
  `npx tsx scripts/domestic-trucking-pricing.test.ts`, `npx tsc --noEmit`,
  `npm run check:docs`,
  `npm run lint -- --file src/lib/domestic-trucking-pricing.ts --file src/components/domestic-trucking-rate-panel.tsx`,
  and
  `DATABASE_URL='postgresql://local:local@127.0.0.1:5432/derya_crm_dummy' npm run build`
  passed before this log entry.
- Failed/skipped checks: full `npm run lint` still fails on existing repo-wide
  lint debt outside this change, mostly old `<a>` navigation rules and `any`
  usage. The touched TS/TSX files lint clean. An initial targeted lint command
  incorrectly included `src/app/globals.css`, which Next lint tried to parse as
  source; rerunning against only touched TS/TSX files passed.
- Caveats: no live provider API, GBrain retrieval, customer send, booking,
  tendering, provider credential read, schema migration, or persisted approval
  record was added.
- Follow-up: add persisted quote approval/audit records only after the approval
  queue design is explicit.

### 2026-07-03 - CRM V1.1: fix pack, legacy purge, inbox touches, layers

- Branch: crm-v1-review-and-push
- Commit: see git log (stacked on 6dcd65c Internal CRM Relationship OS V1)
- Task: Post-review hardening of CRM V1 plus direction decisions from the
  founder: (1) fix pack — rank-correct priority/leverage sorting (string enums
  sorted alphabetically in Postgres), contact and opportunity edit forms,
  working Follow-ups status filter with Done view and reopen, per-entity
  filter options, form success/error notices via returnTo redirects, active
  tab state, `nextActionAt` only moves earlier on task create, fixed inbox
  link filter key, create flows on People/Opportunities/Follow-ups list pages,
  removed the Relationships tab (subset list, not a map); (2) purged legacy
  `/dashboard/customers` + `/dashboard/pipeline` UI, repointed 23 links across
  13 files, added redirects, ported documents/owners/inbox-approval into CRM
  pages; (3) Office book vs Network layer views from `crmCategory`;
  (4) inbox→CRM touch integration: EmailThread.companyId/contactId columns
  (migration 20260703010000_email_crm_touch), resolver + EMAIL Activity
  logging hooked into gmail-sync/gmail-send/thread-actions, backfill script;
  (5) RFQ-created opportunities populate sourceRefs; agent suggestion
  dismissals persist as AgentProposal audit rows.
- Files changed: src/lib/crm/*, src/components/crm/*, src/app/dashboard/crm/**,
  src/app/globals.css, prisma/schema.prisma, prisma/migrations/20260703010000_*,
  src/lib/gmail-sync.ts, src/lib/gmail-send.ts, src/lib/thread-actions.ts,
  scripts/backfill-crm-email-touch.ts, scripts/crm-email-touch.test.ts,
  next.config.ts, package.json, deleted src/app/dashboard/customers/**,
  src/app/dashboard/pipeline/**, unified-crm-workspace.tsx, pipeline-board.tsx,
  plus link repoints in layout/jobs/admin/reports/search/components.
- Verification: npx prisma validate; npx tsc --noEmit clean; npm run test:crm
  (both suites); npm run audit:tenant-scope (only the pre-existing medium
  finding at src/lib/rfq-load-review.ts:265); migration chain replayed against
  a scratch Postgres with prisma migrate diff showing no drift; npm run build.
- Failed/skipped checks: none.
- Caveats: production deploy requires `npx prisma migrate deploy` (two pending
  migrations) BEFORE the code deploys — Vercel build does not run migrations.
  Legacy `Company.status` no longer has an editing surface.
- Follow-up: run `npm run backfill:crm-email` against production after deploy;
  agent-generated CRM mutation proposals via the AgentProposal dispatcher;
  live GBrain retrieval.

### 2026-07-03 - CRM V1.1 adversarial review fixes

- Branch: crm-v1-review-and-push (pushed to main)
- Task: Fixes from the pre-push adversarial review: (1) listCrmCompanies
  ownerId filter now ANDs with the ownership scope instead of replacing it
  (restricted users could enumerate colleagues' companies); (2) gmail-sync
  dedupes messages by externalId OR gmailMessageId and gmail-send stores
  externalId, so app-sent emails no longer re-ingest as duplicate rows and
  duplicate CRM EMAIL activities; (3) CRM company page gained a Quotes panel
  with won/lost resolution (decision-queue pending-quote items had dead-ended
  after the legacy purge); (4) date comparators use a finite no-date sentinel
  (Infinity-Infinity=NaN broke tiebreakers); (5) tags can be cleared via edit
  forms; (6) owner management gated to ADMIN/MANAGER; (7) agent chat widget
  route context matches /dashboard/crm/companies/:id.
- Verification: tsc clean, test:crm passes, tenant audit unchanged, build ok.

### 2026-07-04 - Email-code sign-in with founder allowlist

- Branch: crm-v1-review-and-push (pushed to main)
- Task: Replaced primary password login with emailed one-time codes and
  locked all sign-in paths to an allowlist (mert@usederya.com,
  oguzhan@usederya.com; LOGIN_ALLOWED_EMAILS override). New LoginCode model +
  additive migration; codes sent via connected Gmail accounts through a bare
  send that creates no inbox rows; password login kept as collapsed
  break-glass fallback, also allowlisted; unused signup helper gated too.
- Files changed: prisma/schema.prisma, prisma/migrations/20260704000100_login_email_codes/,
  src/lib/login-code.ts (new), src/lib/auth.ts, src/app/login/page.tsx,
  scripts/login-code.test.ts (new), package.json.
- Verification: tsc clean; test:crm (3 suites) passes; migration applied to
  production before deploy; build ok.
- Caveats: pentest sandbox and demo-office logins are intentionally dead.
- Follow-up: change-password / rotate flow if the fallback ever gets used.

### 2026-07-04 - Persistent sessions until explicit logout

- Branch: crm-v1-review-and-push (pushed to main)
- Task: Session cookie maxAge raised from 7 days to 400 days (SESSION_MAX_AGE
  in src/lib/auth.ts), the longest lifetime browsers honor per the cookie
  spec, so sign-in persists across restarts until the user hits Log out.
  Session is a stateless HMAC cookie with no server-side expiry, so maxAge is
  the sole lifetime control.
- Files changed: src/lib/auth.ts.
- Verification: tsc clean, build ok. No migration.
- Caveats: takes effect on next sign-in; existing 7-day cookies keep their
  old expiry until re-login. No server-side revocation (logout clears the
  cookie locally, as before).

### 2026-07-04 - Sidebar IA rework + Company Brain page

- Branch: sidebar-rfq-crm-company-brain (not merged)
- Commit: see git log
- Task: Rework sidebar (Incoming RFQs, Loads, CRM rename, Company Brain;
  Domestic Rates + Intelligence archived from nav; Inbox moved to Setup
  bottom), un-redirect /dashboard/rfq into a real Inquiry list, add
  /dashboard/loads spreadsheet view, add /dashboard/brain full-page chat on
  chatWithAgent with click-away To-dos / Daily news / Intelligence map
  sections, merge intelligence-map-polish (kept walnut-navy palette).
- Files changed: src/app/dashboard/layout.tsx, src/app/dashboard/rfq/page.tsx,
  src/app/dashboard/loads/page.tsx (new), src/app/dashboard/brain/page.tsx
  (new), src/components/company-brain-chat.tsx (new),
  src/components/link-row.tsx (new), src/components/agent-chat-widget.tsx,
  src/app/globals.css, src/app/dashboard/activity/page.tsx,
  src/app/dashboard/rfq/[inquiryId]/page.tsx,
  src/app/dashboard/rfq/new/page.tsx, src/components/intelligence/*,
  src/lib/market-intelligence/intelligence-map.ts,
  src/app/dashboard/intelligence/page.tsx, scripts/intelligence-map.test.ts.
- Verification: tsc clean; next build clean; no migrations; adversarial
  multi-agent review, all confirmed findings fixed.
- Failed/skipped checks: test:intelligence-map skipped (no local
  DATABASE_URL); its static assertions verified by grep post-merge.
- Caveats: brain chat is session-only; internal company map is a placeholder;
  dock suppressed only on the brain chat view (sections keep the dock).
- Follow-up: wire brain sections deeper (user: "we'll configure that bit
  later"); consider persistence for brain chat threads.

### 2026-07-06 - RFQ inline-editable sheet, new status vocabulary, focused-load strip removed

- Branch: berlin (Conductor workspace)
- Commit: see git log
- Task: (1) Remove the focused-load context strip from the dashboard layout
  on all pages (focus cookie mechanism kept — the workbench still uses it;
  unused hide-on-routes.tsx deleted). (2) Make /dashboard/rfq an inline-
  editable sheet like the CRM: subject, from company/email, lane, mode,
  status and target price edit in place; per-row delete with confirm
  (status Ignored doubles as archive). (3) New RFQ status vocabulary
  BOOKED / PRICING / MISSED ($) / RECEIVED / IGNORED with legacy aliases
  (INGESTED,PARSED→RECEIVED; PRICED,QUOTED→PRICING; WON→BOOKED;
  LOST→MISSED) in src/lib/inquiry-status.ts — no data backfill needed; all
  "open inquiry" predicates now share openInquiryStatusFilter(). New status
  and mode options can be added on the fly from the cell dropdowns
  ("Add option…"); options and filter tabs derive from values in use.
- Files changed: src/lib/inquiry-status.ts (new),
  src/components/sheet-cells.tsx (new, extracted from contact-sheet with
  allowCreate), src/components/contact-sheet.tsx,
  src/components/rfq-expandable-rows.tsx, src/app/dashboard/rfq/page.tsx,
  src/app/dashboard/rfq/actions.ts (updateInquiryRowAction /
  deleteInquiryRowAction), src/app/dashboard/rfq/[inquiryId]/{page,actions}.tsx
  (status guards: field edits / AI parse no longer demote operator-set
  statuses), src/app/dashboard/layout.tsx (strip removed),
  src/components/hide-on-routes.tsx (deleted), src/app/globals.css,
  open-filter swaps in inbox, activity, domestic-pricing, pricing page
  (canonical status select), agent-chat, agent-tools, decision-queue,
  email-classifier, thread-actions, merge-actions, setup-demo-actions,
  job-actions, rfq-mail, prewarm-summary, morning-brief, market-tools,
  link-market-signals, scripts/market-doctor.ts,
  scripts/validate-office-import.ts.
- Verification: tsc clean; next build clean; eslint no new errors (102
  pre-existing before and after); test:strategy, test:rfq-load-draft,
  test:email-labels pass; adversarial multi-agent review over the diff —
  confirmed findings fixed: status-demotion guards added to
  rfq-load-review.ts and job-actions.ts confirmProposedJob; merge-actions +
  agent-proposals open-status checks unified; reports funnel canonicalized;
  target parser handles Turkish/European separators ("1.200" = 1200);
  delete refuses RFQs linked to a real load (deletes PROPOSED shells);
  reserved status names "all"/"open" rejected; parseRFQWithAI update
  officeId-scoped; select-menu padding clicks no longer toggle the row;
  job-focus.ts trimmed to getFocusedJobId.
- Failed/skipped checks: DB-backed tests (test:security, test:crm) skipped —
  no local DATABASE_URL in this workspace.
- Caveats: no schema change, no data backfill — legacy status values stay in
  the DB and alias onto the canonical set for display/filtering. Custom
  statuses/modes persist only while at least one row uses them (options are
  derived from data, not a config table). Old job-focus-* CSS is now dead
  but left in globals.css.
- Follow-up: optional one-off backfill of legacy status values to canonical;
  consider a CategoryOption-backed store if custom options should survive
  having zero rows.

### 2026-07-07 - RFQ sheet: Gmail-style multi-select + bulk status change

- Branch: rfq-bulk-select-status (Conductor workspace walla-walla)
- Commit: not committed
- Task: Add row checkboxes + select-all to /dashboard/rfq and a sticky bulk
  bar to change status of the selected RFQs (one-click Ignore, or any status
  from the vocabulary incl. office custom statuses).
- Files changed: src/app/dashboard/rfq/actions.ts
  (bulkUpdateInquiryStatusAction: office-scoped updateMany, status
  normalization + reserved-name guard shared with single-row path, 200-id
  cap, per-row inquiry.updated memory events, operation sheet_bulk_status),
  src/app/dashboard/rfq/page.tsx (table markup moved out; renders RfqSheet),
  src/components/rfq-expandable-rows.tsx (RfqSheet owns table + selection
  state + RfqBulkBar; RowPair gets checkbox cell; expand-row colSpan now 12),
  src/app/globals.css (rfq-select-cell/box, tr.rfq-row-selected tint).
- Verification: tsc clean; next build clean; eslint no new findings in
  touched files (2 pre-existing no-html-link-for-pages errors in
  rfq/page.tsx confirmed on base commit via stash).
- Failed/skipped checks: DB-backed tests skipped — no local DATABASE_URL.
- Caveats: selection state is component-local (not bulk-select-store — the
  module singleton would leak selection between inbox and RFQ pages);
  select-all covers the 200 visible rows only; stale selected ids are pruned
  against visible rows before acting.
- Follow-up: shift-click range selection; bulk desk-forward could reuse the
  same bar.

### 2026-07-07 - RFQ sheet: per-user column layout (hide / reorder / resize)

- Branch: rfq-bulk-select-status (Conductor workspace walla-walla)
- Commit: not committed (same change set as the multi-select entry above)
- Task: Column headers on /dashboard/rfq can be hidden (Columns picker in a
  table-toolbar, jobs-table chrome), reordered (HTML5 drag-and-drop between
  headers with a landing-edge indicator), and resized (pointer drag on the
  header's right edge, clamped 60-640px); "Reset layout" restores defaults.
  Layout saved per user.
- Files changed: src/components/rfq-expandable-rows.tsx (SHEET_COLUMNS model,
  SheetLayout sanitize/persist to localStorage `derya.rfqSheet.layout.<userId>`,
  header DnD + resize handlers, Columns picker, cells rendered by key,
  MemoRowPair so drag/resize re-renders only colgroup/thead),
  src/app/dashboard/rfq/page.tsx (userId prop, subtitle hint),
  src/app/globals.css (.rfq-sheet table-layout: fixed + td/div truncation,
  min-width: 0 on sheet inputs, rfq-th drag/drop/resize affordances,
  rfq-layout-reset picker row).
- Verification: tsc clean; next build clean; eslint no new findings in
  touched files.
- Failed/skipped checks: DB-backed tests skipped — no local DATABASE_URL.
- Caveats: persistence is per user per browser (localStorage, no schema
  change; DB roaming would need a migration). HTML5 DnD = mouse only.
  Default layout flashes briefly before the stored layout loads (same as
  jobs-table). Select/actions columns are fixed chrome.
- Follow-up: DB-backed user preference store if layouts should roam devices;
  keyboard-accessible reorder.

### 2026-07-07 - RFQ sheet: column resize follows the pointer

- Branch: rfq-bulk-select-status → main
- Task: Fix inverted-feeling resize: with the table pinned to 100% width the
  freed space flowed back into the flex Subject column, shifting columns the
  opposite way of the drag.
- Fix: first resize snapshots every visible column's rendered width into the
  saved layout; from then on the table's inline width/min-width is exactly
  the sum of its columns (no slack to redistribute), so the dragged edge
  tracks the pointer and the table grows/shrinks with horizontal scroll.
  Untouched layouts keep the flex-Subject fill; Reset layout returns to it.
  MAX_COL_WIDTH raised 640→1200 so a wide flexed Subject isn't clamped at
  snapshot time.
- Files changed: src/components/rfq-expandable-rows.tsx.
- Verification: tsc clean; next build clean.

### 2026-07-07 - Trash closed status, ⌘K global search, RFQ search bar

- Branch: rfq-bulk-select-status → main
- Task: (1) Trash promoted to canonical closed RFQ status TRASH — case
  variants alias like legacy values, CLOSED_INQUIRY_STATUSES covers
  TRASH/Trash/trash, ?status= param canonicalized for old links; trashed rows
  leave Open, topbar count, Send-all-to-desk, agent surfaces. (2) ⌘K palette
  rewritten to app-wide grouped search (loads/RFQs/companies/contacts/email
  threads) via new src/lib/global-search.ts; picks navigate (loads → detail
  page; middleware keeps the focus-job cookie flow); src/lib/job-search.ts
  deleted. (3) /dashboard/rfq gained server-side ?q= search composed with
  status tabs; debounced toolbar search bar; empty state moved into RfqSheet.
- Verification: tsc clean; next build clean; test:rfq-whatsapp/strategy/
  email-labels/rfq-load-draft pass; adversarial review workflow (4 dimensions,
  refute-style verify) — 11 confirmed findings fixed before commit, including
  ContactSheet remount key for same-route ?q= picks, RfqSearchBar URL resync,
  duplicate-?q= crash guard, pricing STATUS_META TRASH entry.
- Failed/skipped checks: DB-backed tests skipped — no local DATABASE_URL.
- Caveats: /dashboard/search page untouched (palette supersedes it); no
  company/contact detail routes so picks land on the CRM sheet filter.
- Follow-up: consider retiring /dashboard/search or upgrading it to reuse
  globalSearch; keyboard-accessible column reorder still open.

### 2026-07-08 - Runbook for moving production Neon billing onto YC credits

- Branch: neon-credits-migration
- Task: $100k Neon YC credits were granted into a new Neon organization,
  separate from the org holding the live production project. Documented how
  to move production billing onto the credits.
- Docs-only change: added `docs/RUNBOOKS/NEON_CREDITS_MIGRATION.md`.
- Confirmed state (console screenshots): credits are in Neon org `Derya`
  (Launch plan, empty). Production is project `neon-champagne-cable`
  (AWS US East 1, ~191 MB, 4 branches, no project integrations) in org
  `Vercel: mert's projects` — Vercel-managed, Free plan. Neon's self-serve
  transfer does not support Vercel-managed orgs, so the zero-downtime
  console transfer is expected to be blocked.
- Urgency: the console warns the project is over 80% of the monthly
  Free-plan compute limit, with database downtime at 100%; July burn rate
  points at suspension before month end. Cutover promoted to primary path.
- Runbook paths, in order: 30-second check for a Transfer button anyway;
  full `pg_dump`/`pg_restore` into a new same-region project in `Derya`
  plus Vercel env-var swap and redeploy in a short quiet window (primary);
  Neon support ticket in parallel; emergency paid upgrade of the old org
  as a stopgap. Decommissioning the old Vercel Marketplace resource is
  gated behind a >= 1 week rollback window because deleting the resource
  deletes the database.
- EXECUTED 2026-07-08 ~11:40-11:50 Europe/Istanbul, driven by agent via Neon
  API + Vercel CLI (user authed `vercel login`/`link` locally):
  - Console/API transfer confirmed hard-blocked: API returned
    `action restricted; reason:"organization is managed by Vercel"`.
  - Live production located: project `hidden-heart-85646173`, branch
    `preview-company-brain` (`br-ancient-leaf-amr0er44`), database
    `derya_preview_staging` (NOT the `production-company-brain` name the
    cutover runbook planned; `main`/`neondb` are stale/empty pre-cutover).
  - New project `derya-production` (`broad-cloud-67682012`) created in org
    `Derya` (`org-broad-boat-22503588`): PG17, aws-us-east-1, autoscaling
    0.25-2 CU, suspend disabled, 7-day history retention, database
    `derya_production`.
  - Fresh `pg_dump -Fc` at 11:41:57 restored by 11:44:01; all 49 tables
    identical row counts, all 11 migrations applied and in sync with
    `prisma/migrations`.
  - Vercel env vars `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` and
    `DIRECT_URL` (direct) replaced for Production and Preview via CLI;
    production redeployed and aliased to `www.derya.ai` (Ready in 2m).
  - Verification: `/login` 200, `/dashboard` 307, unauth cron 401; new Neon
    endpoint went active at the exact second of the health request (app is
    on the new DB). `/api/health` returns `ok:false` on BOTH old and new
    databases for the same pre-existing reason: 1 FAILED
    `ANALYZE_JOB_DOCUMENT` job (3/3 attempts, `NEXT_REDIRECT`) and 4 stale
    RUNNING background jobs — copied state, not a migration regression.
  - Writes to the old DB between 11:41:57 and go-live (~11:50) were not
    carried over (announced; quiet window).
- Independent verification (~09:50-10:00Z, 5 read-only verifier agents +
  critic): all hourly crons (09:00 gmail, 09:05 background, 09:25 sheets)
  wrote to the NEW db and nothing to the old; a 20-request health burst
  moved the new db's commit counter +167 while the old stayed flat; the
  serving deployment was built 08:46:18Z, 30-50s after the env vars were
  set; 49-table parity holds (33 equal, 14 grew live on new). Exactly 2
  orphaned rows exist only on the old db from the dump-to-flip gap
  (AgentProposal cmrbtz0cr..., Event cmrbtz3ub..., both ~08:43Z) — decide
  before decommission. Old-endpoint wake at 09:23-09:56Z was attributed to
  the verification's own psql traffic plus one transient write-free
  connection burst; old db data-frozen throughout. Neon console usage tiles
  read 0 because billing counters aggregate with lag (cpu_used_sec=0 in API
  while compute demonstrably ran 2.4h) — recheck within 24h, escalate to
  Neon if still 0. Legacy integration vars (POSTGRES_*, PGHOST,
  NEON_PROJECT_ID) still point at the old project in all Vercel scopes:
  unused by code, clean up at decommission. Pre-08:46Z Vercel deployments
  (prod and preview URLs) still carry the old DATABASE_URL baked in.
- Follow-ups: old project untouched as rollback — decommission the Vercel
  Marketplace Neon resource no earlier than 2026-07-15 after a clean week
  (that deletion destroys the old database); clean up the 5 stuck
  BackgroundJob rows so health returns ok=true; rotate the two Neon API
  keys pasted into chat during the migration; Neon startup credits expire
  ~2027-07 — see runbook section G for deliberate spend-down.

### 2026-07-17 - US lead sheet panel on Incoming RFQs

- Branch: cody (Conductor workspace, targets main)
- Commit: not committed at time of writing
- Task: Add a US section to /dashboard/rfq and connect the US Meta lead sheet
  ("DERYA LEAD - USA CALIFORNIA", `1wSZBm5iNbDWjml5ddMebULb7iLBKjs5vuX3U_5oC_Ic`)
  as a separate panel.
- Files changed: `src/lib/meta-leads.ts` (new), `src/lib/google-sheets-sync.ts`,
  `src/lib/inquiry-source.ts`, `src/lib/rfq-mail.ts`, `src/lib/rfq-whatsapp.ts`,
  `src/app/dashboard/rfq/page.tsx`, `src/app/dashboard/rfq/actions.ts`,
  `src/components/rfq-expandable-rows.tsx`,
  `src/components/sync-google-sheet-button.tsx`, `scripts/rfq-whatsapp.test.ts`,
  `docs/AI_HANDOFF.md`.
- Behavior added: Meta-lead sync loops over TR + US sheets (env overrides
  `DERYA_META_LEADS_US_SHEET_ID/_TAB/_GID`), stamping `market` into parsedData;
  the RFQ page splits US-market leads into their own panel above the main
  sheet (shared status tabs/search, `hideToolbar` on the secondary RfqSheet);
  US leads get English confirmation email and English WhatsApp draft with
  NANP phone promotion; source chips show "· US"; sync summary/button gained
  US counts; resync now preserves `whatsappSentAt` (bug fix).
- Verification: `npm run build`, `npm run test:rfq-whatsapp` (extended),
  `npm run test:crm`, `npm run check:docs`, `npm run audit:tenant-scope`
  (baseline 9, none new) pass; lint on touched files only shows the two
  pre-existing baseline findings. End-to-end against a scratch local Postgres
  + the real sheets (`.context/e2e-us-leads.ts`): 34 US / 63 TR leads,
  correct tags/subjects/references, partition queries split 98 rows with no
  leakage and keep NULL-parsedData rows visible (naive NOT-contains drops
  them on Prisma 6 — the OR-null guard is required), resync idempotent and
  preserves operator status + whatsappSentAt. The e2e caught that the US
  spreadsheet's gid-0 "Sayfa1" tab is header-only; real data is tab
  "ca leads" gid 86480056 (now the default, plus a zero-rows warning).
- Failed/skipped checks: none beyond the report-only tenant-scope baseline.
- Caveats: leads appear in the US panel after the next sheet sync writes the
  market tag; the sheet must remain link-viewable (or configure a Google
  service account / API key).
- Follow-up: none required; optional — English variants for other
  customer-facing copy if US leads start flowing through portal/pricing flows.

### 2026-07-17 - US leads: panel -> chosen tab (view switcher)

- Branch: us-rfq-sheet-panel (follow-up to PR #16, merged earlier today)
- Task: Per Mert's feedback, the US section must be a tab you choose, not a
  default on-screen panel.
- Files changed: `src/app/dashboard/rfq/page.tsx`,
  `src/components/rfq-expandable-rows.tsx`, docs.
- Behavior: default /dashboard/rfq view = original sheet excluding US leads;
  right-aligned view-switcher ("All RFQs" | "US leads (n)") toggles ?view=us
  showing only US leads + a "Lead sheet" link in page actions. Status tabs
  and search compose within the view. RfqSheet: `hideToolbar` removed,
  `emptyHint` added (US empty-state copy, hides New RFQ button).
- Verification: `npm run build`, `test:rfq-whatsapp`, `check:docs`,
  `audit:tenant-scope` (baseline 9) pass. Partition semantics unchanged from
  the e2e-proven filters; prod confirmed post-cron at 19:25Z: 34 US leads
  tagged, 63 TR re-tagged, 97 meta-leads total.
- Caveats: prod cron populated the data already, so the tab shows leads
  immediately after this deploys.
