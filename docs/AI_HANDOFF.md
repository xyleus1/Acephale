# AI Handoff

## Date

2026-06-22

## Branch

codex/lead-to-quote-batch

## Commit

not committed

## Task implemented

H1: Production Hardening and Live Intelligence Pilot Prep.

This sprint intentionally did not add a new product surface. It hardened the
company brain and market-intelligence plumbing before any live pilot or broader
agent autonomy.

Pre-hardening checkpoint:

- Phase 1 through Phase 2E were already present in the worktree.
- The worktree was heavily dirty before H1. Do not blindly stage unrelated
  files.
- Baseline `npx tsc --noEmit` passed before H1 edits.
- External intelligence remains advisory. It cannot mutate jobs, RFQs, quotes,
  prices, milestones, customer records, documents, or outbound messages.
- Do not run live Firecrawl ingestion during verification.

## Files changed

- `.env.example`
- `package.json`
- `src/lib/security/crypto.ts`
- `src/lib/security/html.ts`
- `src/lib/portal-token.ts`
- `src/lib/gmail-oauth.ts`
- `src/app/api/auth/gmail/callback/route.ts`
- `src/lib/portal.ts`
- `src/app/portal/[token]/page.tsx`
- `src/components/copy-portal-link.tsx`
- `src/lib/customer-notify.ts`
- `src/lib/agent-tools.ts`
- `src/lib/seed-demo-load.ts`
- `src/app/api/jobs/[jobId]/quote-pdf/route.ts`
- `src/lib/market-intelligence/firecrawl-client.ts`
- `src/lib/market-intelligence/ingest-firecrawl-source.ts`
- `src/lib/market-intelligence/scheduled-ingestion.ts`
- `src/app/api/cron/market-intelligence/route.ts`
- `scripts/security-hardening.test.ts`
- `scripts/audit-tenant-scope.ts`
- `scripts/firecrawl-smoke.test.ts`
- `scripts/scheduled-market-ingestion.test.ts`
- `scripts/market-doctor.ts`
- `docs/RUNBOOKS/MARKET_INTELLIGENCE_LIVE_PILOT.md`
- `docs/COMPANY_BRAIN.md`
- `docs/MARKET_INTELLIGENCE.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`
- `docs/AI_HANDOFF.md`

## Behavior added

- Gmail OAuth access/refresh token writes now use AES-256-GCM encryption in the
  existing `EmailAccount` token columns.
- `TOKEN_ENCRYPTION_KEY` is required for new encrypted OAuth token writes.
- Legacy plaintext OAuth token reads remain supported so local/dev databases do
  not immediately break; reconnecting or a successful refresh rewrites tokens
  encrypted.
- Public portal access no longer falls back from `portalToken` to `job.id`.
- New portal tokens use 32 random bytes encoded as 64 hex chars; legacy 32-hex
  real portal tokens still resolve.
- Quote PDF HTML escapes dynamic job, customer, route, and line-item values.
- Firecrawl search now requires `includeDomains`; broad web search is blocked
  at the client boundary.
- Firecrawl provider errors are sanitized before being thrown or stored in
  `MarketIngestionRun.error`.
- Scheduled market ingestion now requires
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` for live runs unless a
  mocked test fetch client is supplied.
- Firecrawl cron route fails closed when `CRON_SECRET` is unset.
- Direct live Firecrawl CLI requires both
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` and `--confirm-live`.
- Tenant-scope audit now supports `--strict`, `--json`, severity labels, and
  actionable hints.
- Market doctor reports hardening controls, source-domain gaps, risky broad
  fetch configs, sources exceeding limits, live toggle state, and key configured
  yes/no only.
- Added live-pilot runbook.

## New scripts

- `npm run test:security`

## Verification passed

- `npx prisma validate`
- `npm run db:generate`
- `npx tsc --noEmit`
- `npm run test:security`
- `npm run test:strategy`
- `npm run test:memory`
- `npm run test:memory-search`
- `npm run test:morning-brief`
- `npm run test:market-intelligence`
- `npm run test:market-impact`
- `npm run test:firecrawl`
- `npm run test:source-quality`
- `npm run test:scheduled-market-ingestion`
- `npm run memory:doctor`
- `npm run market:doctor`
- `npm run audit:tenant-scope`
- `npm run build`
- `npm run ai:handoff`

## Verification failed/skipped

- No live Firecrawl ingestion was run.
- No production database commands were run.

## Caveats

- No Prisma schema change was required for token encryption; encrypted blobs are
  stored in the existing token columns.
- Existing plaintext Gmail tokens are compatible. A successful refresh
  re-encrypts a legacy plaintext refresh token; reconnecting also stores
  encrypted values.
- `TOKEN_ENCRYPTION_KEY` must be backed up like any production secret. Losing it
  makes encrypted OAuth tokens unrecoverable.
- Live Firecrawl ingestion remains disabled by default and must start with
  dry-run plus one reviewed source.

## Recommended next step

Run the full H1 verification list, then pilot one official or carrier source in
dry-run mode before enabling any live scheduled ingestion.

## Checkpoint Plan For Dirty Worktree

Generated after inspecting:

- `git status --short`
- `git diff --stat`
- `git diff --name-only`
- `git branch --show-current`
- `git log -1 --oneline`

Current branch: `codex/lead-to-quote-batch`.

Current HEAD: `9727e55 feat: add integration setup gates`.

Tracked diff at inspection time: 37 files, roughly 6k insertions and 2.5k
deletions. Many Phase 1 through H1 files are still untracked. Do not make one
giant "company brain" commit unless you enjoy making future debugging worse.

### Logical File Buckets

Phase 1 memory plumbing:

- `prisma/schema.prisma`
- `prisma/migrations/20260621000100_company_brain_memory/migration.sql`
- `src/lib/memory/record-event.ts`
- `src/lib/memory/ingest-object.ts`
- `src/lib/memory/backfill.ts`
- `src/lib/memory/search-memory.ts`
- `scripts/backfill-company-brain.ts`
- memory write hooks in `src/lib/gmail-sync.ts`, `src/lib/whatsapp.ts`,
  `src/lib/google-sheets-sync.ts`, `src/lib/thread-actions.ts`,
  `src/lib/forwarder-drafts.ts`, `src/lib/customer-quote-drafts.ts`,
  `src/lib/agent-proposals.ts`, and
  `src/lib/commercial-strategy-persistence.ts`
- `scripts/memory-write-smoke.test.ts`

Phase 1.5 memory usefulness, doctor, and morning brief:

- `src/lib/memory/customer-dossier.ts`
- `src/lib/memory/morning-brief.ts`
- `scripts/memory-doctor.ts`
- `scripts/morning-brief.test.ts`
- memory sections in `src/lib/agent-chat.ts` and `src/lib/agent-tools.ts`

Phase 2A hybrid retrieval and evidence:

- `src/lib/memory/canonical-types.ts`
- `src/lib/memory/evidence.ts`
- `src/lib/memory/hybrid-search.ts`
- `src/lib/memory/relevance.ts`
- `scripts/memory-search.test.ts`

Phase 2B market intelligence:

- `prisma/migrations/20260622000100_market_intelligence/migration.sql`
- `src/lib/market-intelligence/source-registry.ts`
- `src/lib/market-intelligence/ingest-market-source.ts`
- `src/lib/market-intelligence/ingest-market-object.ts`
- `src/lib/market-intelligence/extract-market-signals.ts`
- `src/lib/market-intelligence/link-market-signals.ts`
- `src/lib/market-intelligence/market-tools.ts`
- `scripts/ingest-market-intelligence.ts`
- `scripts/market-intelligence-smoke.test.ts`

Phase 2C market impact review and feedback:

- `prisma/migrations/20260622000200_market_impact_review/migration.sql`
- `src/lib/market-intelligence/market-impact-review.ts`
- market review/feedback additions in `src/lib/market-intelligence/*`
- agent tool additions in `src/lib/agent-tools.ts`
- morning brief additions in `src/lib/memory/morning-brief.ts`
- `scripts/market-impact-review.test.ts`

Phase 2D Firecrawl connector and Research Inbox:

- `prisma/migrations/20260622000300_firecrawl_market_ingestion/migration.sql`
- `src/lib/market-intelligence/firecrawl-client.ts`
- `src/lib/market-intelligence/source-policy.ts`
- `src/lib/market-intelligence/ingest-firecrawl-source.ts`
- `src/app/dashboard/intelligence/page.tsx`
- `scripts/ingest-firecrawl-market-intelligence.ts`
- `scripts/firecrawl-smoke.test.ts`
- related CSS in `src/app/globals.css`

Phase 2E source quality and scheduled ingestion:

- `src/lib/market-intelligence/source-quality.ts`
- `src/lib/market-intelligence/scheduled-ingestion.ts`
- `src/app/api/cron/market-intelligence/route.ts`
- Research Inbox ranking changes in `src/app/dashboard/intelligence/page.tsx`
- agent/source-quality changes in `src/lib/agent-tools.ts` and
  `src/lib/agent-chat.ts`
- `scripts/source-quality.test.ts`
- `scripts/scheduled-market-ingestion.test.ts`

H1 hardening:

- `.env.example`
- `src/lib/security/crypto.ts`
- `src/lib/security/html.ts`
- `src/lib/portal-token.ts`
- `src/lib/gmail-oauth.ts`
- `src/app/api/auth/gmail/callback/route.ts`
- `src/lib/portal.ts`
- `src/app/portal/[token]/page.tsx`
- `src/components/copy-portal-link.tsx`
- `src/lib/customer-notify.ts`
- `src/lib/seed-demo-load.ts`
- `src/app/api/jobs/[jobId]/quote-pdf/route.ts`
- hardening changes in `src/lib/market-intelligence/firecrawl-client.ts`,
  `src/lib/market-intelligence/ingest-firecrawl-source.ts`,
  `src/lib/market-intelligence/scheduled-ingestion.ts`, and
  `src/app/api/cron/market-intelligence/route.ts`
- `scripts/security-hardening.test.ts`
- `scripts/audit-tenant-scope.ts`
- hardening additions in `scripts/firecrawl-smoke.test.ts`,
  `scripts/scheduled-market-ingestion.test.ts`, and `scripts/market-doctor.ts`
- `docs/RUNBOOKS/MARKET_INTELLIGENCE_LIVE_PILOT.md`

AI collaboration, docs, and handoff:

- `AGENTS.md`
- `docs/AGENTS.md`
- `docs/AI_COLLABORATION_PROTOCOL.md`
- `docs/AI_HANDOFF.md`
- `docs/CODEBASE_DEEP_DISCOVERY_REPORT.md`
- `docs/COMPANY_BRAIN.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`
- `docs/MARKET_INTELLIGENCE.md`
- `docs/NEXT_AGENT_TASK.md`
- `src/lib/AGENTS.md`
- `src/lib/memory/AGENTS.md`
- `src/lib/market-intelligence/AGENTS.md`
- `src/app/api/AGENTS.md`
- `prisma/AGENTS.md`
- `scripts/generate-ai-handoff.ts`

Pre-existing or cross-cutting app/UI changes needing careful review:

- `src/app/dashboard/admin/page.tsx`
- `src/app/dashboard/inbox/page.tsx`
- `src/app/dashboard/jobs/[jobId]/actions.ts`
- `src/app/dashboard/jobs/[jobId]/page.tsx`
- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/pricing/page.tsx`
- `src/app/dashboard/rfq/[inquiryId]/actions.ts`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `src/app/dashboard/rfq/new/page.tsx`
- `src/app/globals.css`
- `src/components/agent-chat-widget.tsx`
- `src/components/commercial-brain-engine-schematic.tsx`
- `src/components/commercial-decision-cockpit.tsx`
- `src/lib/commercial-strategy.ts`
- `src/lib/risk.ts`

Generated/build artifacts:

- No `.next`, `node_modules`, logs, local DB files, or build output appeared in
  `git status --short`.
- `.codex/rules/*.rules` are local agent rules. Commit them only if the team
  wants repo-local Codex rules.

### Risky Files

- Schema/migrations: `prisma/schema.prisma`, all
  `prisma/migrations/202606*.sql`.
- Env/script surface: `.env.example`, `package.json`.
- Auth/security: `src/lib/security/crypto.ts`, `src/lib/gmail-oauth.ts`,
  `src/app/api/auth/gmail/callback/route.ts`.
- Public portal: `src/lib/portal-token.ts`, `src/lib/portal.ts`,
  `src/app/portal/[token]/page.tsx`, `src/components/copy-portal-link.tsx`,
  `src/lib/customer-notify.ts`.
- Quote output: `src/app/api/jobs/[jobId]/quote-pdf/route.ts`.
- Firecrawl/live ingestion: `src/lib/market-intelligence/firecrawl-client.ts`,
  `src/lib/market-intelligence/ingest-firecrawl-source.ts`,
  `src/lib/market-intelligence/scheduled-ingestion.ts`,
  `scripts/ingest-firecrawl-market-intelligence.ts`.
- Cron: `src/app/api/cron/market-intelligence/route.ts`.
- Package scripts: `package.json`.

### Recommended Commit Sequence

Commit 1: `company brain memory foundation`

- Include: memory Prisma models/migration, `record-event`, `ingest-object`,
  `backfill`, initial memory write hooks, backfill script, memory smoke test.
- Reason: establishes canonical additive memory/event layer.
- Verify before/after: `npx prisma validate`, `npm run db:generate`,
  `npm run test:memory`, `npx tsc --noEmit`.
- Caveat: several write-hook files also contain later phase changes. Use
  patch-level staging, not blind file-level staging.

Commit 2: `memory retrieval evidence and morning brief`

- Include: canonical taxonomy, hybrid search, evidence helpers, customer
  dossier, morning brief, memory doctor, memory search test, agent memory tools.
- Reason: makes memory useful and auditable without vector search.
- Verify: `npm run test:memory-search`, `npm run test:morning-brief`,
  `npm run memory:doctor`, `npx tsc --noEmit`.
- Caveat: `src/lib/agent-tools.ts`, `src/lib/agent-chat.ts`, and
  `src/lib/memory/morning-brief.ts` are shared with market phases.

Commit 3: `market intelligence core pipeline`

- Include: `MarketSignal` migration/model, market source registry, ingest
  market source/object, signal extraction, signal linking, market agent tools,
  market smoke test.
- Reason: separates raw articles from operational intelligence.
- Verify: `npx prisma validate`, `npm run db:generate`,
  `npm run test:market-intelligence`, `npx tsc --noEmit`.
- Caveat: keep external intelligence advisory language in docs with this
  commit.

Commit 4: `market impact reviews and feedback`

- Include: market impact review migration, review/feedback service, agent
  review tools, morning brief review surfacing, market impact test.
- Reason: adds the human-review bridge between possible links and action.
- Verify: `npm run test:market-impact`, `npm run test:morning-brief`,
  `npx tsc --noEmit`.
- Caveat: do not mark any review `actioned` from automation.

Commit 5: `firecrawl research inbox and source quality controls`

- Include: Firecrawl client, source policy, ingestion runs, scheduled ingestion,
  market cron route, Research Inbox, source quality ranking, Firecrawl/source
  quality/scheduled tests, market doctor additions.
- Reason: controlled external intelligence pilot infrastructure.
- Verify: `npm run test:firecrawl`, `npm run test:source-quality`,
  `npm run test:scheduled-market-ingestion`, `npm run market:doctor`,
  `npx tsc --noEmit`.
- Caveat: do not run live ingestion as part of committing. Tests must stay
  mocked.

Commit 6: `harden secrets portal pdf and live ingestion gates`

- Include: token encryption, Gmail OAuth compatibility, portal token hardening,
  quote PDF escaping, Firecrawl broad-search/live gates, cron fail-closed,
  tenant audit improvements, security test, hardening runbook.
- Reason: production safety before live pilot or new autonomy.
- Verify: `npm run test:security`, `npm run test:firecrawl`,
  `npm run test:scheduled-market-ingestion`, `npm run audit:tenant-scope`,
  `npm run build`.
- Caveat: `TOKEN_ENCRYPTION_KEY` must be configured before Gmail reconnects or
  token refresh writes.

Commit 7: `AI collaboration docs and handoff`

- Include: collaboration protocol, discovery report, company brain docs,
  decisions, engineering log, handoff, AGENTS files, Codex rules only if
  intentionally repo-scoped.
- Reason: documents operating contract and next-agent context.
- Verify: `npm run ai:handoff`, `npx tsc --noEmit`.
- Caveat: docs should reference the actual commit hashes after commits exist.

### Files To Exclude Unless Explicitly Intended

- Any `.env`, real secrets, token dumps, logs, local DB files, `.next`,
  `node_modules`, and generated build output.
- `.codex/rules/*.rules` unless the team wants Codex rules in the repo.
- Dashboard/CSS/report/UI changes that cannot be tied to the phase they are
  staged with. The `globals.css` diff is huge; review it manually.
- Any live-ingestion output or local one-off script output.

## Gmail OAuth Token Encryption Compatibility Audit

Current behavior:

- `src/lib/security/crypto.ts` treats values starting with `enc:v1:` as
  encrypted AES-256-GCM payloads.
- Values without that prefix are treated as legacy plaintext and returned as-is
  by `decryptOAuthTokenFromStorage`.
- `getValidAccessToken` reads a legacy plaintext refresh token successfully.
- After a successful refresh, both the new access token and any legacy
  plaintext refresh token are stored encrypted.
- A Gmail account with no refresh token fails with:
  `Account has no refresh token (re-connect needed)`.
- Missing `TOKEN_ENCRYPTION_KEY` fails on encrypted writes/decrypts with:
  `TOKEN_ENCRYPTION_KEY is required to encrypt or decrypt OAuth tokens. Generate one with: openssl rand -base64 32`.

Production risk:

- Legacy plaintext rows are compatible, but they remain sensitive until a
  successful refresh or reconnect encrypts them.
- `TOKEN_ENCRYPTION_KEY` must be present and backed up before deployment. Lose
  it and encrypted OAuth tokens are unrecoverable.
- There is no standalone database migration/backfill script for existing
  plaintext tokens. The chosen approach is compatibility plus re-encryption on
  next refresh, because it avoids printing or bulk-touching secrets.

Recommendation:

- Use option B: compatibility path plus re-encryption on next successful
  refresh.
- Do not require all Gmail accounts to reconnect immediately unless production
  policy demands rapid removal of plaintext-at-rest rows.
- If production already has many Gmail accounts and strict compliance pressure,
  add an admin-only one-time migration script later. It must not log token
  values and must require `TOKEN_ENCRYPTION_KEY`.

## Controlled Live Firecrawl Pilot Result

Pilot source:

- `port-of-long-beach-news`
- Name: Port of Long Beach News and Press
- Trust: `OFFICIAL`
- Fetch type: `firecrawl_scrape`
- URL tested: `https://polb.com/port-info/news-and-press/`
- Allowed domains: `polb.com`
- Clamp: max results `3`, max pages `3`
- Office: `cmqlgbg1u0000rnztu66omsr0` / Istanbul Office

Environment/safety state:

- `FIRECRAWL_API_KEY` configured: yes
- `MARKET_INTELLIGENCE_PROVIDER` configured: yes (`firecrawl`)
- `MARKET_INTELLIGENCE_CRON_ENABLED`: disabled
- `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED`: disabled by default
- enabled fetchable source count: `0`
- risky broad fetch configs: `0`
- allowed-domain issues: `0`
- max results/pages configured: yes / yes
- daily budget configured: yes (`25`)
- database URL classification: local

Dry run:

- policy passed
- estimated pages/results: `3` / `3`
- candidate URL: `https://polb.com/port-info/news-and-press/`
- duplicate preview before live run: no existing candidate object
- expected write upper bound for this scrape source: one market update object,
  with derived signals/reviews depending on fetched content

Live run:

- Command used one explicit URL and temporary one-command live flag:
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true npm run market:ingest:firecrawl -- --office cmqlgbg1u0000rnztu66omsr0 --source port-of-long-beach-news --url https://polb.com/port-info/news-and-press/ --limit 3 --confirm-live`
- `MarketIngestionRun`: `cmqpc884m0001rn6hgs2ire2b`
- Status: succeeded
- Provider results consumed: `1`
- Source URLs accepted: `https://polb.com/port-info/news-and-press/`
- Source `KnowledgeObject`: `cmqpc8c7g0005rn6hhbbr00e2`
  (`market_update`)
- Derived signal `KnowledgeObject`: `cmqpc8c8k000irn6htd6si82i`
  (`market_signal`)
- `KnowledgeChunk` rows created: `2`
- `MarketSignal` rows created: `1`
- `MarketSignalLink` rows created: `11`
- `MarketImpactReview` rows created: `11`
- Provider errors: none

Feedback recorded:

- The scraped source page produced a bad operational interpretation from page
  navigation/social-link text. This is exactly the kind of thing the pilot was
  meant to catch.
- Dismissed `11` impact reviews.
- Recorded `8` `irrelevant` feedback entries for customer/job/RFQ impacts.
- Recorded `3` `wrong_link` feedback entries for bogus social-link lanes:
  `FlickrLinks -> Port of Long Beach Flickr`,
  `InstagramLinks -> Port of Long Beach`, and
  `Twitterlinks -> Port of Long Beach`.
- No review was marked `actioned`.
- No operational job, RFQ, quote, customer, milestone, message, or price record
  was mutated.

Doctor summaries after feedback:

- `memory:doctor`: unknown canonical rows `0`, legacy canonical rows `0`,
  events missing provenance `0`, duplicate source ids `0`, duplicate content
  hashes `0`.
- `market:doctor`: cron enabled `false`, live ingestion enabled `false`,
  enabled fetchable source count `0`, allowed-domain issues `0`, risky broad
  fetch configs `0`.
- `market:doctor`: pending `MarketImpactReview` rows `0`, dismissed `11`.
- `market:doctor`: signals with zero links `0`, high/critical signals with
  zero links `0`.
- Source quality for `port-of-long-beach-news` moved from `86/excellent` to
  `0/poor` because the pilot recorded `3` wrong links, `8` irrelevant impacts,
  and `11` dismissed reviews.

Product-surface observations:

- `/dashboard/intelligence` Research Feed has one Port of Long Beach research
  item, one signal, zero pending reviews, and eleven dismissed reviews.
- `/dashboard/intelligence` Market Signals still lists the derived critical
  port-disruption signal, but the source quality is `0/poor`.
- `/dashboard/intelligence` Impact Reviews default pending view should be empty.
- Morning Brief currently suppresses pending market impact reviews, but still
  includes the poor-quality high/critical signal in `market_intelligence` and
  as the top recommended market action. That is a real product defect: dismissed
  or poor-quality signals should be demoted or suppressed before they drive
  recommended actions.

Recommendation:

- Do not test a second source yet.
- Keep scheduled ingestion disabled.
- Before the next live source, fix extraction hygiene: strip navigation/footer
  text, require source pages to contain an article/advisory/date-like signal,
  block social-link-derived lanes, and make Morning Brief ignore or heavily
  demote signals whose source quality is poor or whose linked reviews were all
  dismissed.

## H2 Web Extraction Hygiene And Signal Suppression

Status:

- Implemented in the dirty worktree.
- Not committed.
- Live Firecrawl ingestion was not run during H2.
- Cron remains disabled.

What changed:

- Added deterministic content hygiene in
  `src/lib/market-intelligence/content-hygiene.ts`.
- Added signal suppression helpers in
  `src/lib/market-intelligence/signal-suppression.ts`.
- Preserved the failed Port of Long Beach pilot as
  `scripts/fixtures/market-intelligence/port-long-beach-news-index.bad.json`.
- Updated Firecrawl scrape requests to ask for cleaner main content:
  `onlyMainContent`, `removeBase64Images`, `blockAds`, and chrome
  `excludeTags`.
- Updated market ingestion so low-quality/index/navigation pages can be stored
  as Research Feed `KnowledgeObject` rows but cannot create `MarketSignal`,
  `MarketSignalLink`, or `MarketImpactReview` rows.
- Updated extraction and linking to ignore social/utility/footer/navigation URL
  text as lane/entity evidence.
- Updated Morning Brief, strategy context, lane/customer exposure tools, and
  agent market search so suppressed/poor-quality signals do not become
  recommended action.
- Updated `/dashboard/intelligence` so suppressed signals, dismissed reviews,
  and extraction-skipped research items remain visible for audit.
- Updated `market:doctor` to report low-quality skips, index/navigation
  classifications, suppressed signals, majority wrong-link/irrelevant signals,
  social-link lane candidates, and suppressed signals still appearing in Morning
  Brief.

Current H2 contract:

- Firecrawl cleanup helps, but Derya hygiene decides.
- Signal-eligible page types are `article`, `advisory`, `press_release`,
  `rate_update`, and `regulatory_update`.
- `index_page`, `navigation_page`, and `unknown` are research-only unless a
  future source-specific parser proves otherwise.
- Default signal extraction threshold is `contentQualityScore >= 60`.
- Rejected extraction stores `pageType`, `contentQualityScore`,
  `extractionStatus`, and rejection reasons on `KnowledgeObject.payload`.
- Rejected extraction records a `market.update.extraction_skipped` memory event.
- Morning Brief and strategy ignore signals from poor sources, rejected pages,
  low-quality content, closed-only review sets, majority wrong-link/irrelevant
  feedback, and signals without active pending/acknowledged impact work.

Important local evidence:

- Failed live source object: `cmqpc8c7g0005rn6hhbbr00e2`.
- Failed derived signal object: `cmqpc8c8k000irn6htd6si82i`.
- Failed run id: `cmqpc884m0001rn6hgs2ire2b`.
- The old bad signal is now suppressed from Morning Brief by source quality and
  review/feedback state.

Do next:

1. Do not test a second source yet.
2. Rerun the same `port-of-long-beach-news` source with the same `3` result /
   `3` page clamp.
3. Expected result: listing page stored as Research Feed, no fake
   `MarketSignal`, no social-link lanes, no impact reviews, no Morning Brief
   recommendation.
4. Only after that passes, test one official/regulatory/carrier/rate source.

Verification snapshot for H2 will be refreshed by `npm run ai:handoff` after
the final verification run.

## H2.1 Same-Source Firecrawl Regression Rerun

Status:

- Passed.
- Source tested: `port-of-long-beach-news`.
- Office: `cmqlgbg1u0000rnztu66omsr0` / Istanbul Office.
- URL tested: `https://polb.com/port-info/news-and-press/`.
- Clamp: max results `3`, max pages `3`.
- Live Firecrawl was run once for this exact source and URL.
- Cron remains disabled.
- No second source was tested.
- No operational job, RFQ, quote, customer, milestone, message, or price record
  was mutated.
- Historical bad pilot data was not deleted.

Safety state:

- `FIRECRAWL_API_KEY` configured: yes.
- `MARKET_INTELLIGENCE_PROVIDER` configured: yes.
- `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN` configured: yes.
- `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN` configured: yes.
- `MARKET_INTELLIGENCE_CRON_ENABLED` configured: yes, disabled.
- `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET` configured: yes.
- `TOKEN_ENCRYPTION_KEY` configured in this shell: no.
- `CRON_SECRET` configured: yes.
- Enabled fetchable sources: `0`.
- Risky broad fetch configs: `0`.
- Allowed-domain issues: `0`.

Dry-run / preview result:

- Candidate URL: `https://polb.com/port-info/news-and-press/`.
- Title: `News & Press - Port of Long Beach`.
- Published date: none.
- Page type: `index_page`.
- Signal eligible: false.
- Eligibility reason: `page_type_index_page`.
- Clean body length from preview wrapper: `0`.
- Expected research items: `1`.
- Expected extraction skipped: `1`.
- Expected `MarketSignal`: `0`.
- Expected `MarketSignalLink`: `0`.
- Expected `MarketImpactReview`: `0`.
- Duplicate check: existing research URL count `1`, matching the original bad
  pilot object.

Live run result:

- `MarketIngestionRun`: `cmqpkglvy0001rn99xnek5o3i`.
- Status: succeeded.
- Provider results consumed: `1`.
- Accepted URL: `https://polb.com/port-info/news-and-press/`.
- Research `KnowledgeObject`: `cmqpc8c7g0005rn6hhbbr00e2`; the existing object
  was updated idempotently rather than duplicated.
- `KnowledgeChunk` rows newly created: `0`; existing chunk updated.
- New `MarketSignal` rows from this run: `0`.
- New `MarketSignalLink` rows from this run: `0`.
- New `MarketImpactReview` rows from this run: `0`.
- Provider errors: none.
- Run metadata: `skippedExtractionCount: 1`.

Extraction state after rerun:

- Source object page type: `index_page`.
- `contentQualityScore`: `0`.
- `extractionStatus`: `rejected_low_quality`.
- `extractionRejectionReason`: `page_type_index_page`.
- Rejection reasons:
  - `page_type_index_page`
  - `content_quality_below_60`
  - `insufficient_clean_body_text`
- A new `market.update.extraction_skipped` memory event was recorded.

Doctor summaries:

- `memory:doctor`: unknown canonical rows `0`, legacy canonical rows `0`,
  events missing provenance `0`, duplicate source ids `0`, duplicate content
  hashes `0`.
- `market:doctor`: cron enabled `false`, live ingestion enabled `false`,
  provider configured `true`, enabled fetchable source count `0`, allowed-domain
  issues `0`, risky broad fetch configs `0`.
- `market:doctor`: market updates skipped for low quality includes
  `cmqpc8c7g0005rn6hhbbr00e2`.
- `market:doctor`: market updates classified as index/navigation includes
  `cmqpc8c7g0005rn6hhbbr00e2`.
- `market:doctor`: suppressed signals still appearing in Morning Brief: none.
- `market:doctor`: pending `MarketImpactReview` rows `0`, dismissed `11`.
- Source quality for `port-of-long-beach-news` remains `0/poor`, which is
  expected because the historical bad run still has wrong-link/irrelevant
  feedback.

Product-surface observations:

- Research Feed shows the Port of Long Beach research item for audit.
- The historical bad signal remains attached to that old research object, but
  it is suppressed with reason `source_quality_poor`.
- Agent market search returns no active Port of Long Beach signals and lists the
  historical signal only under suppressed signals.
- Impact Reviews have no pending work for Port of Long Beach; the eleven old
  reviews remain dismissed.
- Morning Brief market section has `0` market impact reviews and `0` market
  signals for this source.

H2.1 verdict:

- Passed. The same listing/index page is now research-only and did not create
  fake operational intelligence.
- Safe to run one second-source pilot next, preferably
  `maersk-news-advisories`, then `cbp-csms`, then
  `drewry-world-container-index`, then `port-of-los-angeles-latest-news`.
- Keep scheduled ingestion disabled. Do not enable cron until several sources
  and enough review feedback have been observed.

## Deployment Readiness Audit

Status:

- Audit completed on 2026-06-22.
- No files were staged or committed.
- No deployment was run.
- No live Firecrawl ingestion was run.
- No production database command was run.
- Product behavior was not intentionally changed; this entry is documentation
  only.

Repo state inspected:

- Branch: `codex/lead-to-quote-batch`.
- HEAD: `9727e55 feat: add integration setup gates`.
- Tracked diff at inspection time: 37 files, roughly 6k insertions and 2.5k
  deletions.
- The worktree is still heavily dirty. It contains tracked edits plus many
  untracked Phase 1 through H2.1 files. Do not use `git add .`.

Release buckets:

- Phase 1 memory foundation: Prisma memory models, memory ingest/event/search,
  backfill, memory write hooks, and memory smoke scripts.
- Phase 1.5 usefulness: memory doctor, customer dossier, morning brief, and
  agent memory context.
- Phase 2A retrieval/evidence: canonical taxonomy, hybrid search, relevance,
  and evidence helpers.
- Phase 2B market intelligence: `MarketSignal`, source registry, market object
  ingestion, signal extraction/linking, agent tools, and docs.
- Phase 2C review loop: `MarketImpactReview`, `MarketSignalFeedback`, review
  generation, feedback tools, and morning brief integration.
- Phase 2D Firecrawl/Research Inbox: Firecrawl client, source policy,
  `/dashboard/intelligence`, ingestion run tracking, and smoke tests.
- Phase 2E scheduling/source quality: scheduled ingestion controls, source
  quality scoring, ranked market sections, and doctor checks.
- H1 hardening: OAuth token encryption, portal token hardening, quote PDF HTML
  escaping, Firecrawl safety gates, tenant audit, and runbooks.
- H2/H2.1 extraction hygiene: page classification, content quality gates,
  social/footer stripping, suppression, failed-pilot fixture, and same-source
  regression evidence.
- Docs/handoff: `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`,
  `docs/COMPANY_BRAIN.md`, `docs/MARKET_INTELLIGENCE.md`,
  `docs/DECISIONS.md`, runbooks, and protocol docs.
- Generated/local exclude: `.env`, `.env.local`, `.next/`, `node_modules/`,
  `prisma/dev.db`, logs, and local `.codex/` state must not be committed.

Migration inventory:

- `20260621000100_company_brain_memory`: creates memory/source/object/chunk/
  mention/event/agent-memory tables.
- `20260622000100_market_intelligence`: creates market signal/link tables.
- `20260622000200_market_impact_review`: creates impact review and feedback
  tables.
- `20260622000300_firecrawl_market_ingestion`: creates ingestion run tracking
  and Firecrawl metadata support.
- The migration SQL is additive. No destructive `DROP` or column-removal
  statements were found.
- Critical deployment blocker: these migrations are not a full baseline for a
  fresh database. They reference existing tables such as `Office` and assume
  the pre-brain schema already exists. `prisma migrate deploy` is sufficient
  only against a database that already has the old application schema or a
  properly marked baseline. A clean staging database will fail without a
  baseline/stamping plan.
- Local `prisma migrate status` reported the four new migrations as not yet
  applied locally, while the local schema appears to exist through prior
  `db push` usage. That drift needs to be resolved before pretending the
  migration path is production-ready.

Package/deploy script notes:

- `build` runs `prisma generate && next build`.
- `postinstall` runs `prisma generate`, which is correct for Vercel-style
  dependency caching.
- `db:migrate` is `prisma migrate dev` and must not be used in production.
- `db:push` is guarded but remains a development command, not a production
  migration path.
- Market ingestion scripts exist but live ingestion stays gated behind explicit
  env flags and CLI confirmation.

Environment inventory:

- Required for preview/prod: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
  `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`,
  `NEXT_PUBLIC_APP_URL`, `ANTHROPIC_API_KEY`.
- Required if Gmail is enabled: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`.
- Required if transcription is enabled: `OPENAI_API_KEY`.
- Required if live market ingestion is enabled: `FIRECRAWL_API_KEY`,
  `MARKET_INTELLIGENCE_PROVIDER`, `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN`,
  `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN`,
  `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET`.
- Safe production defaults before broader rollout:
  `MARKET_INTELLIGENCE_CRON_ENABLED=false` and
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=false`.
- `.env.example` still needs cleanup before a polished release because several
  deployment-critical vars are referenced by code but not documented there:
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `CRON_SECRET`,
  `NEXT_PUBLIC_APP_URL`, and optional Firecrawl tuning vars.

Deployment blockers and risks:

- Blocker: migration baseline/history is not deployment-ready for fresh staging
  or production unless the target DB already has the pre-brain schema and the
  baseline is handled deliberately.
- Blocker: Vercel/project env vars need to be configured explicitly. Local
  build success does not prove preview/prod secrets exist.
- High risk: Gmail OAuth redirects must match Google Cloud OAuth exactly.
  Relying on preview URL fallbacks is asking for callback failures.
- Medium risk: `/api/cron/risk-scan` uses `x-cron-secret` or `?secret=`, while
  other cron routes accept Vercel-style `Authorization: Bearer`. It is gated,
  but the scheduled Vercel request may 401 unless adjusted or routed through the
  expected auth style.
- Medium risk: `/api/health` reports env presence and exposes the configured
  Gmail redirect URI. That is not a token, but it is more deployment detail
  than a public endpoint should ideally leak.
- Controlled risk: historical bad Port of Long Beach market data remains in the
  local DB for audit. It is suppressed from Morning Brief and strategy context.
- Controlled risk: existing plaintext Gmail tokens are supported and
  re-encrypted on refresh, but production must set and back up
  `TOKEN_ENCRYPTION_KEY`.

Verification run during this audit:

- Passed: `npx prisma validate`
- Passed: `npm run db:generate`
- Passed: `npx tsc --noEmit`
- Passed: `npm run test:security`
- Passed: `npm run test:strategy`
- Passed: `npm run test:memory`
- Passed: `npm run test:memory-search`
- Passed: `npm run test:morning-brief`
- Passed: `npm run test:market-intelligence`
- Passed: `npm run test:market-impact`
- Passed: `npm run test:firecrawl`
- Passed: `npm run test:source-quality`
- Passed: `npm run test:scheduled-market-ingestion`
- Passed: `npm run test:market-content-hygiene`
- Passed: `npm run test:market-signal-suppression`
- Passed: `npm run memory:doctor`
- Passed: `npm run market:doctor`
- Passed: `npm run audit:tenant-scope`
- Passed: `npm run build`
- Passed: `npm run ai:handoff`
- Passed after docs update: `npx tsc --noEmit`

Recommended deployment plan:

1. Create a release branch/checkpoint with patch-level staging by bucket. Do not
   stage local env files, generated output, local DBs, or `.codex/`.
2. Fix or formally document the Prisma baseline path. For a fresh staging DB,
   create/apply the pre-brain baseline or use Prisma's baseline/stamp workflow
   before these additive migrations.
3. Provision a staging database and run `prisma migrate deploy` there, not
   `migrate dev`, `db push`, or reset commands.
4. Configure Vercel preview env vars explicitly. Keep market cron/live
   ingestion disabled.
5. Deploy preview, run health checks, login/signup, dashboard load, Gmail OAuth
   callback smoke, portal token smoke, quote PDF smoke, memory/market doctor
   scripts against the intended DB, and cron auth smoke.
6. Only after preview passes, promote the same commit to production.
7. Keep scheduled market ingestion disabled until at least 3-4 sources and a
   meaningful review-feedback sample have been observed.

Rollback plan:

- If preview deploy fails before migrations: revert the deployment to the last
  known-good Vercel build and fix env/build issues locally.
- If migrations fail in staging: stop. Do not run `db push` or reset. Restore
  from DB snapshot if needed, fix the baseline/migration history, then retry
  `migrate deploy`.
- If app runtime fails after deploy: roll back Vercel to the previous
  deployment and keep the DB snapshot. The new memory/market tables are
  additive, so rollback mostly means old code ignores them.
- If Gmail encryption fails: ensure `TOKEN_ENCRYPTION_KEY` is present and
  unchanged. If encrypted tokens were written with the wrong key, affected
  accounts need reconnect.
- If market intelligence behaves badly: leave
  `MARKET_INTELLIGENCE_CRON_ENABLED=false` and
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=false`; use feedback/suppression
  instead of mutating operations.

Hard recommendation:

- Do not deploy this as-is to a fresh staging or production database. The code
  passes, but the database migration story is not clean enough yet. That is the
  boring part of shipping, and skipping it is how you buy yourself a stupid
  outage.

## D0 Prisma Migration Baseline And Release Packaging Prep

Status:

- Implemented on 2026-06-22.
- No files were staged or committed.
- No production database command was run.
- No live Firecrawl ingestion was run.
- Cron was not enabled.
- Runtime product behavior was not changed.

Files added or updated:

- `prisma/migrations/00000000000000_baseline_pre_brain/migration.sql`
- `prisma/migrations/migration_lock.toml`
- `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`
- `docs/DECISIONS.md`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

Baseline source:

- The baseline was generated from `9727e55:prisma/schema.prisma`, accessed as
  `git show HEAD:prisma/schema.prisma` before this D0 work was committed.
- HEAD at generation time was `9727e55 feat: add integration setup gates`.
- That schema contains the pre-company-brain freight CRM tables and does not
  contain `Knowledge*`, `MemoryEvent`, `AgentMemory`, `MarketSignal`,
  `MarketSignalLink`, `MarketImpactReview`, `MarketSignalFeedback`, or
  `MarketIngestionRun`.
- Current working-tree `prisma/schema.prisma` adds those memory and
  market-intelligence models. Later migrations continue to own those tables.

Migration order now verified:

1. `00000000000000_baseline_pre_brain`
2. `20260621000100_company_brain_memory`
3. `20260622000100_market_intelligence`
4. `20260622000200_market_impact_review`
5. `20260622000300_firecrawl_market_ingestion`

Disposable DB verification:

- A throwaway local Postgres database was created.
- `npx prisma migrate deploy` applied all five migrations in order.
- `npx prisma migrate diff --from-url <throwaway-url>
  --to-schema-datamodel prisma/schema.prisma --exit-code` returned
  `No difference detected.`
- The throwaway database was dropped.
- No production DB commands were run.

Deployment blocker status:

- The fresh-staging blocker is cleared, assuming deployment uses
  `prisma migrate deploy` with this migration history.
- Existing production still requires the baseline runbook. If production has
  the pre-brain schema but no Prisma migration history, first verify that it
  matches the baseline, then mark only
  `00000000000000_baseline_pre_brain` as applied with
  `npx prisma migrate resolve --applied
  00000000000000_baseline_pre_brain`, then run `npx prisma migrate deploy`.
- Do not run `db push`, `migrate dev`, or `migrate reset` in staging or
  production.

Exact staging path:

```bash
export DATABASE_URL="postgresql://..."
export DATABASE_URL_UNPOOLED="postgresql://..."
npx prisma validate
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

Exact existing-production baseline path:

```bash
export DATABASE_URL="postgresql://..."
export DATABASE_URL_UNPOOLED="postgresql://..."
git show 9727e55:prisma/schema.prisma > /tmp/derya-pre-brain-schema.prisma
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel /tmp/derya-pre-brain-schema.prisma --exit-code
npx prisma migrate resolve --applied 00000000000000_baseline_pre_brain
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

Caveats:

- The production baseline path assumes the existing production database really
  matches the pre-brain schema from `9727e55`. If the diff reports drift, stop.
- Code rollback does not roll back database schema.
- The next step is D1: create clean release commits from the dirty worktree.

## D1 Proposed Release Commit Plan

Status before staging:

- Branch: `codex/lead-to-quote-batch`.
- HEAD before D1: `9727e55 feat: add integration setup gates`.
- No push, deploy, production DB command, live Firecrawl run, or cron enablement
  is allowed during D1.
- Use explicit `git add -- <paths>` only. Do not use `git add .`.
- The first broad secret scan reported env var names and placeholder examples
  in docs/tests, not live-looking secrets. Continue with stricter real-secret
  scanning before staging.

Manifest buckets:

- A. Prisma baseline: `prisma/migrations/00000000000000_baseline_pre_brain`,
  `prisma/migrations/migration_lock.toml`,
  `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`.
- B. Memory foundation: memory Prisma migration, core memory ingest/event/
  backfill/search modules, backfill script, memory write hooks in existing
  Gmail/WhatsApp/Sheets/inquiry/job/quote/strategy flows, and memory smoke test.
- C. Memory usefulness/retrieval: customer dossier, morning brief, memory
  doctor, canonical taxonomy, hybrid search, relevance/evidence helpers,
  memory search/morning brief tests, and agent memory context/tool updates.
- D. Market intelligence core: `MarketSignal`, `MarketSignalLink`, market
  registry/policy, market source/object ingestion, extraction/linking, market
  tools, strategy/risk context hooks, and market intelligence smoke test.
- E. Impact review/feedback: `MarketImpactReview`,
  `MarketSignalFeedback`, review service, review/feedback tools, market impact
  tests, and doctor/reporting support.
- F. Firecrawl/Research Inbox: Firecrawl client, Firecrawl ingestion path,
  `MarketIngestionRun`, `/dashboard/intelligence`, Firecrawl smoke test, and
  live-pilot runbook.
- G. Source quality/scheduling: source quality ranking, scheduled ingestion,
  market cron route, source quality and scheduled ingestion tests, and ranked
  Research Inbox/Morning Brief behavior.
- H. Security/hardening: OAuth token encryption compatibility, portal token
  hardening, quote PDF escaping, Firecrawl/live-ingestion guards, tenant audit
  improvements, security tests, and Gmail token runbook.
- I. H2 hygiene/suppression: failed POLB fixture, content hygiene, signal
  suppression, extraction gates, social-link blocking, suppression labels, and
  H2 tests.
- J. Docs/protocol: AGENTS files, collaboration protocol, handoff/log,
  company-brain and market docs, decisions, deep discovery, next task, and
  intentionally repo-scoped `.codex/rules`.
- K. Excluded unless explicitly intended: `.env`, `.env.local`, `.next/`,
  `node_modules/`, local DB files, logs, raw secrets, and generated artifacts.

Commit plan:

1. `chore(db): add pre-brain prisma baseline`
   - Include baseline migration, migration lock, and baseline deployment runbook.
   - Why: clears fresh staging migration history.
   - Caveat: docs/log references are finalized in the docs commit to avoid
     patch-staging huge untracked handoff files.
2. `feat(memory): add company brain memory foundation`
   - Include memory models/migration, core memory write modules, backfill, and
     memory emitters across existing freight flows.
   - Caveat: some mixed files also contain later agent/market hooks; use the
     smallest coherent full-file staging where patch-staging is not practical.
3. `feat(memory): add dossiers, morning brief, retrieval, and evidence`
   - Include dossier, morning brief, memory doctor, canonical taxonomy, hybrid
     retrieval, evidence/relevance, memory tests, and agent memory usage.
4. `feat(market): add market intelligence signal pipeline`
   - Include market source/object ingestion, source registry/policy, signal
     extraction/linking, market tools, strategy/risk market context, and market
     tests.
5. `feat(market): add impact reviews and feedback loop`
   - Include review/feedback schema, review service, feedback tools, impact
     tests, and doctor support.
6. `feat(market): add firecrawl ingestion and research inbox`
   - Include Firecrawl client/ingestion, `MarketIngestionRun`, Research Inbox
     page/nav/styles, Firecrawl tests, and live-pilot docs.
7. `feat(market): add source quality and scheduled ingestion controls`
   - Include source quality, scheduled ingestion, market cron route, ranking
     behavior, and scheduling/source-quality tests.
8. `chore(security): harden tokens portal pdf and ingestion guards`
   - Include token encryption, portal token access, quote PDF escaping, live
     ingestion gates, tenant audit, `.env.example`, and security tests.
9. `fix(market): add extraction hygiene and signal suppression`
   - Include H2 content hygiene, suppression helpers, failed pilot fixture,
     extraction/link hygiene, suppression behavior, and H2 tests.
10. `docs: add ai collaboration handoff and deployment runbooks`
    - Include protocol docs, handoff/log/decisions, AGENTS files, runbooks, and
      repo-scoped Codex rules.

Verification after commits:

- Run the full D1 suite: `npx prisma validate`, `npm run db:generate`,
  `npx tsc --noEmit`, all memory/market/security tests, doctors, tenant audit,
  `npm run build`, and `npm run ai:handoff`.

## D2 Preview/Staging Deployment Prep

Status:

- Completed on 2026-06-22.
- Branch pushed: yes.
- Branch: `codex/lead-to-quote-batch`.
- Pushed head: `e9aa328 docs: add ai collaboration handoff and deployment runbooks`.
- Remote branch verified at `origin/codex/lead-to-quote-batch`.
- No production deploy was run.
- No production database command was run.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.
- Operational records were not mutated.

Repository checks:

- `git status --short`: clean before push.
- `git branch --show-current`: `codex/lead-to-quote-batch`.
- `git log --oneline -n 12`: release commit stack from
  `a9c48d9` through `e9aa328` is present.
- `npx tsc --noEmit`: passed before push.

Remote and Vercel status:

- Git remote: `origin` is the GitHub SSH remote for `mmturna/derya-crm`.
- Push succeeded with a fast-forward branch update from `9727e55` to
  `e9aa328`.
- Vercel CLI is not installed in this shell.
- No `.vercel/project.json` link file is present.
- Vercel Git integration could not be detected locally. If the Vercel project
  is connected to this GitHub repo, the branch push should create a Preview
  deployment. Check the Vercel dashboard under the Derya project deployments
  for branch `codex/lead-to-quote-batch`.
- Preview URL: not available from local tooling during D2.

Preview/staging environment status:

Local env presence was checked without printing values. This is not proof that
Vercel Preview env vars are configured, because Vercel CLI was unavailable.

| Variable | Local presence | Vercel Preview status |
| --- | --- | --- |
| `DATABASE_URL` | yes | unknown |
| `DATABASE_URL_UNPOOLED` | yes | unknown |
| `DIRECT_URL` | no | unknown |
| `TOKEN_ENCRYPTION_KEY` | no | unknown |
| `CRON_SECRET` | yes | unknown |
| `ANTHROPIC_API_KEY` | yes | unknown |
| `OPENAI_API_KEY` | yes | unknown |
| `GOOGLE_CLIENT_ID` | no | unknown |
| `GOOGLE_CLIENT_SECRET` | no | unknown |
| `GOOGLE_REDIRECT_URI` | no | unknown |
| `FIRECRAWL_API_KEY` | yes | unknown |
| `MARKET_INTELLIGENCE_PROVIDER` | yes | unknown |
| `MARKET_INTELLIGENCE_CRON_ENABLED` | yes, disabled | unknown |
| `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN` | yes | unknown |
| `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN` | yes | unknown |
| `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN` | yes | unknown |
| `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET` | yes | unknown |
| `DOCUMENT_STORAGE_DRIVER` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_BUCKET` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_REGION` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_ENDPOINT` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_ACCESS_KEY_ID` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_SESSION_TOKEN` | documented in `.env.example` | unknown |

Safe Preview market-intelligence values:

- `MARKET_INTELLIGENCE_CRON_ENABLED=false`
- `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN=3`
- `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN=3`
- `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN=1`
- `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET=25`

Database status:

- Local `DATABASE_URL` and `DATABASE_URL_UNPOOLED` point to a local Postgres
  database named `derya_crm_app`.
- No staging `DATABASE_URL` was explicitly available locally.
- Staging migration was therefore skipped. That is intentional. Do not run
  `migrate deploy` against an unknown database.
- For a fresh staging database, run:

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

- For an existing staging database with the pre-brain schema but no migration
  history, follow `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`. Do not stamp
  the baseline unless a diff proves the database matches the pre-brain schema.
- Do not use `db push`, `migrate dev`, or `migrate reset` for staging or
  production.

Build/deploy requirements:

- `postinstall` runs `prisma generate`.
- `build` runs `prisma generate && next build`.
- No live Firecrawl ingestion runs during install or build.
- No database migration runs during install or build.
- `vercel.json` contains cron entries for risk scan, Gmail sync, and
  background jobs. Market intelligence cron is not listed there and remains
  gated in code by env flags.

Preview smoke-test checklist once the Preview URL exists:

- App loads.
- Login works.
- `/dashboard` loads.
- `/dashboard/intelligence` loads.
- Research Feed, Market Signals, and Impact Reviews render.
- Customer and job pages load.
- Morning Brief renders without recommending suppressed market signals.
- Quote PDF route works.
- A valid portal token works.
- `job.id` as a portal token fails.
- Gmail OAuth callback URI matches the Preview URL or Gmail is intentionally
  production-only for this Preview.
- Cron routes reject unauthenticated calls.
- Market cron remains disabled.
- `npm run memory:doctor` and `npm run market:doctor` pass against staging if
  run from an environment configured for the staging database.

Blockers:

- Vercel Preview deployment status could not be verified locally because the
  Vercel CLI is unavailable and the repo is not locally linked with
  `.vercel/project.json`.
- Vercel Preview env var presence could not be checked locally.
- Staging migrations were not run because no explicit staging database URL was
  available locally.
- `TOKEN_ENCRYPTION_KEY`, Gmail OAuth vars, and Preview document-storage vars
  must be confirmed in Vercel before realistic Preview testing.

Recommended next step:

- Confirm Vercel Git integration created a Preview for
  `codex/lead-to-quote-batch`.
- Configure/verify Preview env vars with safe market-intelligence defaults.
- Run staging migrations only against a confirmed staging database.
- Then run D3 staging smoke tests.

## D3A-FIX Vercel Hobby Cron Compatibility

Status:

- Completed on 2026-06-22.
- Goal: unblock Vercel Preview deployment on a Hobby account after Vercel
  rejected a sub-daily cron expression before build.
- Production deploy was not run.
- Production database commands were not run.
- Live Firecrawl ingestion was not run.
- Market intelligence cron was not enabled.

Problem:

- Vercel rejected the project because Hobby accounts only allow cron schedules
  that run at most once per day.
- The invalid schedule was `/api/cron/background-jobs` with
  `*/10 * * * *`, which runs every ten minutes.

Change:

- Updated `vercel.json` so every configured cron runs no more than once per
  day.
- Kept existing cron auth behavior intact; routes still require `CRON_SECRET`
  checks in code.
- Market intelligence scheduled ingestion remains disabled by env and is not
  configured in `vercel.json`.

Cron schedules after the fix:

- `/api/cron/risk-scan`: `0 6 * * *`
- `/api/cron/gmail-sync`: `0 7 * * *`
- `/api/cron/background-jobs`: `0 9 * * *`

Operational note:

- Frequent background processing should move to Vercel Pro, an external
  scheduler, or a manual/operator-triggered sync path later. Do not sneak
  sub-daily schedules back into `vercel.json` while deploying on Hobby.

Verification:

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `npm run ai:handoff`: passed.

## D3B Preview Runtime, Env, Staging DB, And Smoke Test

Status:

- Run on 2026-06-22.
- Preview deployment status from founder input: Ready.
- Preview URL:
  `https://derya-crm-git-codex-lead-to-quote-batch-merts-projects-b132014b.vercel.app`
- Branch: `codex/lead-to-quote-batch`.
- Preview commit: `3ab82df`.
- Production remains old at `main @ 49d7154`.
- No merge to main was performed.
- No production deploy was run.
- No production database command was run.
- No live Firecrawl ingestion was run.
- Market intelligence cron was not enabled.
- No customer/supplier messages were sent.

Local release state:

- Worktree was clean before D3B docs were updated.
- Branch: `codex/lead-to-quote-batch`.
- Head commit: `3ab82df fix(deploy): make vercel crons hobby-compatible`.
- `npx tsc --noEmit`: passed.

Preview HTTP checks:

- `/`: `401 Authentication Required`.
- `/login`: `401 Authentication Required`.
- `/dashboard`: `401 Authentication Required`.
- `/dashboard/intelligence`: `401 Authentication Required`.
- `/api/health`: `401 Authentication Required`.
- Cron routes checked without secret also returned the Vercel deployment
  protection page before app-level cron auth could run.

Conclusion:

- Vercel has the deployment Ready, but the Preview is protected by Vercel
  deployment authentication. The app shell, login page, dashboard, intelligence
  page, health endpoint, and app-level cron behavior could not be verified from
  this unauthenticated shell.

Preview env readiness:

- Vercel CLI is not installed locally.
- The repo has no `.vercel/project.json` link.
- `/api/health` could not be reached because Preview deployment protection
  returns `401`.
- Therefore Preview env vars are `unknown` from this environment. Do not infer
  they are configured just because the deployment built.

| Variable | Preview status |
| --- | --- |
| `DATABASE_URL` | unknown |
| `DATABASE_URL_UNPOOLED` or `DIRECT_URL` | unknown |
| `TOKEN_ENCRYPTION_KEY` | unknown |
| `CRON_SECRET` | unknown |
| `ANTHROPIC_API_KEY` | unknown |
| `OPENAI_API_KEY` | unknown |
| `GOOGLE_CLIENT_ID` | unknown |
| `GOOGLE_CLIENT_SECRET` | unknown |
| `GOOGLE_REDIRECT_URI` | unknown |
| `FIRECRAWL_API_KEY` | unknown |
| `MARKET_INTELLIGENCE_PROVIDER` | unknown |
| `MARKET_INTELLIGENCE_CRON_ENABLED` | unknown |
| `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN` | unknown |
| `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN` | unknown |
| `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN` | unknown |
| `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET` | unknown |

Staging database migration status:

- Staging DB provider input: unknown.
- Confirmed staging DB separate from production: unknown.
- Founder confirmation that it is safe to migrate: not available in this run.
- Migrations were skipped intentionally.
- Do not run `migrate deploy` until `DATABASE_URL` is confirmed to point to a
  staging/preview database that is separate from production.
- Do not use `prisma db push`, `migrate dev`, or `migrate reset`.

Build/deploy assumptions verified from repo:

- `postinstall` runs `prisma generate`.
- `build` runs `prisma generate && next build`.
- No database migration runs during Vercel build.
- No live Firecrawl ingestion runs during build.
- `vercel.json` schedules all configured crons daily for Hobby compatibility.
- App cron routes require `CRON_SECRET` checks in code, although Vercel
  deployment protection prevented external unauthenticated route testing from
  reaching the app.
- Market intelligence cron remains env-gated and is not listed in
  `vercel.json`.

Manual smoke-test checklist once Preview protection access is available:

- App shell loads.
- Login page loads or dashboard redirects correctly.
- Login works with staging credentials only.
- `/dashboard` loads.
- `/dashboard/intelligence` loads.
- Research Feed section loads.
- Market Signals section loads.
- Impact Reviews section loads.
- Customer page loads.
- Job page loads.
- Morning Brief loads.
- Quote PDF route works.
- A valid portal token works.
- `job.id` as portal token fails.
- Gmail OAuth link/callback uses the expected Preview redirect URI, or Gmail is
  intentionally production-only for Preview.
- Cron routes reject unauthenticated calls after bypassing Vercel deployment
  protection.
- Market cron remains disabled.

Blockers:

- Preview deployment protection blocks unauthenticated smoke tests.
- Preview env var status is unknown without Vercel CLI/dashboard access or an
  accessible `/api/health`.
- Staging DB provider and production separation are unknown, so migrations were
  correctly skipped.

Recommended next step:

- Provide Vercel Preview access or a Vercel bypass token for smoke testing, or
  run the manual checklist in the Vercel-authenticated browser.
- Confirm Preview env vars in the Vercel dashboard without exposing values.
- Confirm staging DB provider and separation from production.
- Run `prisma migrate deploy` only after staging DB safety is confirmed.
- Proceed to H2.2 staging Firecrawl pilot only after Preview app boots,
  staging DB is migrated, `/dashboard/intelligence` loads, and smoke checks are
  clean.

## D3C-DB Preview Runtime Database Fix Attempt

Status:

- Run on 2026-06-22.
- Preview deployment is Ready, but runtime logs show the Preview app is
  connected to a database whose schema is older than the release branch.
- No merge to main was performed.
- No production deploy was run.
- No production database command was run.
- No migration was run.
- No `prisma db push`, `migrate dev`, or `migrate reset` command was run.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.

Root cause from Preview runtime logs:

- `PrismaClientKnownRequestError P2022`: `Inquiry.containerCount` does not
  exist in the current database.
- `PrismaClientKnownRequestError P2021`: table `public.AgentProposal` does not
  exist in the current database.
- This is a runtime database schema mismatch, not a Vercel build problem.

Local release state:

- Branch: `codex/lead-to-quote-batch`.
- Head commit: `3ab82df fix(deploy): make vercel crons hobby-compatible`.
- `npx tsc --noEmit`: passed.
- Worktree already had uncommitted D3B docs changes before D3C docs were
  appended.

Database target check:

- Local `DATABASE_URL`: configured, but points to local Postgres database
  `derya_crm_app`.
- Local `DATABASE_URL_UNPOOLED`: configured, but points to the same local
  database.
- Local `DIRECT_URL`: not configured.
- Local target appears staging/preview: no.
- Staging database provider input: not provided.
- Confirmed staging database separate from production: not provided.
- Founder confirmation it is safe to migrate: not available in this run.

Decision:

- Migrations were intentionally skipped. Running `prisma migrate deploy`
  without a confirmed staging database would be a blind database operation.

Preview env readiness:

- Vercel CLI is not installed locally.
- No `.vercel/project.json` link exists.
- Preview `/api/health` is still protected by Vercel deployment authentication.
- Preview env var status remains unknown from this shell.
- Local env status is not equivalent to Vercel Preview env status.

Preview HTTP check:

- `/`: `401 Authentication Required`.
- `/login`: `401 Authentication Required`.
- `/dashboard`: `401 Authentication Required`.
- `/dashboard/intelligence`: `401 Authentication Required`.
- `/api/health`: `401 Authentication Required`.

Required next step:

1. Create or identify a staging database that is explicitly separate from
   production.
2. Configure Vercel Preview `DATABASE_URL` and `DATABASE_URL_UNPOOLED` or
   `DIRECT_URL` to that staging database.
3. Confirm safe Preview env values without exposing secrets:
   `MARKET_INTELLIGENCE_CRON_ENABLED=false`,
   `MARKET_INTELLIGENCE_PROVIDER=firecrawl`, and conservative market limits.
4. Apply migrations only against the confirmed staging database:

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

5. Expected final diff: `No difference detected`.
6. Redeploy the Preview after env and migrations are correct.
7. Re-run smoke tests with Vercel Preview access or a bypass token.

If the staging database is existing/pre-brain with no migration history:

- Follow `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`.
- Generate the pre-brain schema from `9727e55`.
- Diff the existing DB against that schema.
- If drift appears, stop.
- Only if it matches, mark
  `00000000000000_baseline_pre_brain` as applied, then run
  `prisma migrate deploy`.

Current blockers:

- Staging DB provider/separation are not confirmed.
- Preview env vars cannot be inspected locally.
- Preview deployment protection blocks external smoke tests.
- Runtime schema mismatch remains until the Preview database is corrected and
  migrated.

Safe-to-proceed status:

- Safe to H2.2 staging Firecrawl pilot: no.
- Safe to production checklist: no.
- Safe next action: configure confirmed staging DB and Preview envs, then run
  migrations against staging only.

## P0 Production Cutover Prep With Fresh Office And Cherry-Pick Import

Status:

- Implemented on 2026-06-23.
- No production database commands were run.
- No production deploy was run.
- No merge to main was performed.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.
- No secrets were printed.

Files added:

- `scripts/create-production-office.ts`
- `scripts/export-office-cherry-pick.ts`
- `scripts/import-office-cherry-pick.ts`
- `scripts/validate-office-import.ts`
- `docs/RUNBOOKS/PRODUCTION_CUTOVER_CHERRY_PICK.md`

Files updated:

- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`

New package scripts:

- `npm run seed:production-office`
- `npm run export:office-cherry-pick`
- `npm run import:office-cherry-pick`
- `npm run validate:office-import`

Cutover model:

- Create a fresh Neon production database on the current schema with
  `prisma migrate deploy`.
- Create a new real Office/Admin with `npm run seed:production-office`.
- Export selected safe business data from the old database to JSON.
- Import that JSON into the new Office after a dry run.
- Validate the import before setting Vercel Production env vars and merging to
  main.

Safety model:

- Production office creation requires `ALLOW_PRODUCTION_OFFICE_SEED=1`.
- Cherry-pick import defaults to dry run and requires
  `ALLOW_CHERRY_PICK_IMPORT=1` plus `DRY_RUN=false` for writes.
- Export uses `OLD_DATABASE_URL`; import uses `DATABASE_URL`.
- Old Gmail OAuth tokens are never exported or imported.
- Sessions and password hashes are not exported.
- Old portal tokens are not exported. Jobs that had old portal tokens get new
  64-hex random tokens during import.
- Background jobs are not copied.
- Company-brain memory rows and market-intelligence rows are not copied.
- Agent proposals and forwarder draft send artifacts are not copied.
- Documents are metadata-only. Job document URLs are null; company document
  URLs use a `metadata-only://...` sentinel because the schema requires a URL.

Safe imported data:

- companies
- contacts
- company owner references by safe user email only
- activities
- quotes
- shipment records
- inquiries
- active jobs by default
- milestones
- document metadata
- carrier quotes
- forwarders
- lane rates
- margin profiles
- target price history

Email import:

- Off by default with `INCLUDE_EMAILS=false`.
- If enabled, email threads/messages are sanitized and imported without
  accounts, OAuth tokens, provider external IDs, Gmail message IDs, HTML bodies,
  or attachment URLs.

Verification:

- Refusal-path smoke checks for the new scripts: passed with expected guard
  errors and no writes.
- `npx prisma validate`: passed.
- `npm run db:generate`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `npm run ai:handoff`: passed.

## Go-Live Merge To Main

Status:

- Completed on 2026-06-23.
- PR #1, `codex/lead-to-quote-batch` -> `main`, was merged with a GitHub merge
  commit.
- Main moved from the old production commit `49d7154` to merge commit
  `debe8182d99f928793c0ba076cbe6d6d7c51346c`.
- The merge commit includes release commit
  `073cd434bff8358a3d660147094273ada5307014`
  (`chore(cutover): add production office and cherry-pick import tooling`).
- The release branch was not deleted.

Production safety:

- No database migrations were run during go-live.
- No `prisma db push`, `migrate dev`, or `migrate reset` command was run.
- Market intelligence cron remained disabled by environment configuration.
- No live Firecrawl ingestion was run.
- No secrets were printed.

Vercel:

- Production deployment should trigger from the `main` branch push/merge.
- Watch Vercel -> Deployments -> Production for source branch `main`.
- The latest production deployment should no longer point at `49d7154`.

Immediate smoke-test checklist:

- Production app loads.
- Login works for `mert@usederya.com`.
- Demo users remain disabled.
- `/dashboard` loads.
- `/dashboard/intelligence` loads without enabling market cron.
- Customer and job pages load.
- Quote PDF route works.
- A valid portal token works; `job.id` as portal token fails.
- Gmail OAuth uses the production redirect URI.
- Cron routes reject unauthenticated calls.
- Market intelligence cron remains disabled.

## Live Intelligence Map And Manual Ingestion UI

Status:

- Implemented on 2026-06-23 in the main-branch dirty worktree.
- Goal: make `/dashboard/intelligence` operationally usable in production
  without enabling scheduled ingestion or running local live Firecrawl from
  Codex.

What changed:

- Added `getIntelligenceMapData(officeId)` for deterministic world-map data.
- Added clickable intelligence map, hotspot panel, source cards, visual icons,
  and admin manual ingestion controls.
- Replaced the old permissive inline "Run one" action with an admin-only manual
  ingestion action.
- Manual live ingestion requires
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` and refuses to run while
  `MARKET_INTELLIGENCE_CRON_ENABLED=true`.
- Manual source allowlist is restricted to Maersk, Drewry WCI, CBP CSMS, and
  Port of Los Angeles. FreightWaves/JOC/media are not available by default.
- Manual pulls clamp to one source and three results/pages.

Safety:

- No Prisma migration was needed.
- No live Firecrawl ingestion was run locally.
- No scheduled market cron was enabled.
- External intelligence remains advisory and does not mutate jobs, RFQs, quotes,
  customers, milestones, prices, or messages.

Verification passed:

```bash
npx tsc --noEmit
npm run test:intelligence-map
npm run test:manual-market-ingestion-action
npm run test:market-content-hygiene
npm run test:market-signal-suppression
npm run test:source-quality
npm run test:market-intelligence
npm run test:market-impact
npm run build
npm run ai:handoff
```

Production use:

- Ensure Vercel Production has
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` before using the live button.
- Keep `MARKET_INTELLIGENCE_CRON_ENABLED=false`.
