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
  `scripts/gmail-sync-windows.test.ts`, `package.json`, `vercel.json`, and
  docs.
- Behavior added: manual Gmail sync now performs an immediate recent sync and
  queues monthly historical backfill windows for the last five years.
  Background jobs can execute `GMAIL_SYNC_WINDOW` payloads against a specific
  Gmail search window, and the background drain defaults to 25 jobs per run.
  Gmail and background-job crons are scheduled hourly. Post-sync AI automation
  is scoped to threads touched by the run, avoiding repeated office-wide
  auto-link passes during historical backfill.
- Verification: `npm run test:gmail-sync-windows`, `npm run test:gmail-oauth`,
  `npm run test:email-labels`, `npx tsc --noEmit`, and `npm run build`
  passed.
- Failed/skipped checks: no live Gmail sync or production cron run was executed
  from this agent session.
- Caveats: hourly Vercel cron may require a paid Vercel plan or an external
  scheduler. Historical counts will rise progressively as queued window jobs
  drain; it is not a single synchronous import.
