# Market Intelligence

Market intelligence turns external freight/logistics updates into operational
signals that can affect pricing, strategy, risk, customer memory, and morning
briefing.

It is not a news dashboard. Raw articles are stored, but operators and agents
consume `MarketSignal` records.

## Data Flow

```text
source registry
  -> fetch/manual item/Firecrawl result
  -> KnowledgeSource
  -> KnowledgeObject canonicalType=market_update
  -> KnowledgeChunk
  -> MarketSignal
  -> KnowledgeObject canonicalType=market_signal
  -> MemoryEvent
  -> MarketSignalLink
  -> MarketImpactReview
  -> Research Inbox / agent tools / morning brief / customer dossier / strategy / risk
```

## Source Registry

Source definitions live in
`src/lib/market-intelligence/source-registry.ts`.

Fields:

- `id`: stable source id
- `name`: human readable source name
- `sourceType`: currently `MARKET`
- `trustLevel`: `OFFICIAL`, `PARTNER`, `INDUSTRY`, `NEWS`, `MANUAL`,
  `INTERNAL`, `TRUSTED`, `EXTERNAL`, or `LOW`
- `url`: RSS, HTML, source landing URL, or Firecrawl scrape target
- `homepage`: source home domain for policy checks
- `sourceCategory`: `official`, `carrier`, `port`, `regulatory`,
  `rate_index`, `media`, `research`, `competitor`, or `misc`
- `allowedDomains`: explicit allow-list for web ingestion
- `fetchType`: `rss`, `html`, `manual`, `firecrawl_search`, or
  `firecrawl_scrape`
- `defaultCategory`: fallback signal category
- `defaultCategories`: fallback signal category set for source metadata
- `defaultAffectedModes`: source-level mode hints such as `ocean` or `air`
- `maxResultsPerRun` and `maxPagesPerRun`: connector run bounds
- `enabled`: opt-in for live ingest
- `termsPolicyNotes`: short source-policy notes for crawl/reuse constraints

`MARKET_INTELLIGENCE_SOURCES_JSON` can override/add registry entries without a
UI. Keep this boring until source quality is proven.

Curated Phase 2E registry entries:

- `cbp-csms`: official customs/compliance source, disabled by default.
- `fmc-news-advisories`: official maritime regulatory source, disabled by
  default.
- `maersk-news-advisories`: carrier advisory source, disabled by default.
- `port-of-los-angeles-latest-news`: official port source, disabled by default.
- `port-of-long-beach-news`: official port source, disabled by default.
- `drewry-world-container-index`: rate-index source, disabled by default.
- `xeneta-market-updates`: rate/market research source, disabled by default.
- `freightwaves-maritime`: media/context source, disabled by default.
- `journal-of-commerce-container-shipping`: media/context source, disabled by
  default.

Official/regulatory/port/carrier sources intentionally start with higher trust
than media/context sources. Media is useful context, not truth.

## Source Quality Ranking

Deterministic source quality lives in:

```text
src/lib/market-intelligence/source-quality.ts
```

The score starts from configured trust and adjusts using review/feedback data:

- useful feedback increases score
- actioned impact reviews increase score
- wrong-link feedback decreases score
- irrelevant feedback decreases score
- dismissed reviews decrease score
- duplicate signals decrease score
- stale signals decrease score
- zero-link signals decrease score
- failed ingestion runs decrease score

Helpers:

- `getSourceQualityScore`
- `listSourceQualitySummaries`
- `rankMarketSignals`
- `rankMarketImpactReviews`
- `rankResearchFeedItems`

There is no LLM ranking in Phase 2E. This is deliberate; the ranking has to be
auditable before it becomes clever.

## Firecrawl Connector

Firecrawl is a fetch/extraction provider, not a source of truth. The connector
is implemented in:

```text
src/lib/market-intelligence/firecrawl-client.ts
src/lib/market-intelligence/ingest-firecrawl-source.ts
scripts/ingest-firecrawl-market-intelligence.ts
```

Configuration:

```bash
FIRECRAWL_API_KEY=""
MARKET_INTELLIGENCE_PROVIDER="firecrawl"
MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED="false"
MARKET_INTELLIGENCE_FIRECRAWL_TIMEOUT_MS="60000"
MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN="10"
MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN="20"
MARKET_INTELLIGENCE_CRON_ENABLED="false"
MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN="3"
MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET="100"
```

Rules:

- Never log `FIRECRAWL_API_KEY`.
- Firecrawl sources must have `allowedDomains`, `homepage`, or `url`.
- Firecrawl search requests without `includeDomains` are rejected.
- Scrapes request cleaner source text with `onlyMainContent`,
  `removeBase64Images`, `blockAds`, and chrome `excludeTags`.
- Optional Firecrawl beta cleaning is controlled by
  `MARKET_INTELLIGENCE_FIRECRAWL_CLEAN_CONTENT`; keep it disabled until it has
  been tested source-by-source.
- Firecrawl cleanup is only a first pass. Derya's content hygiene gate decides
  whether a page can create signals.
- Broad web ingestion is blocked by `source-policy.ts`.
- Login, subscribe, checkout, and paywall-like URLs/content are filtered.
- Provider errors are sanitized before being shown or stored.
- Tests must mock Firecrawl responses and must not depend on live internet.
- Generic `ingestMarketSource` rejects `firecrawl_*` sources; use
  `ingestFirecrawlMarketSource`.

`MarketIngestionRun` records provider observability:

- provider/source/query/status
- started/completed timestamps
- result/object/signal/review counts
- error text
- run metadata

## Web Extraction Hygiene

The first live Firecrawl pilot proved the safety model but exposed a content
hygiene failure: the Port of Long Beach listing page was stored and page
chrome/social links were interpreted as freight intelligence. H2 fixes that by
gating signal extraction before `MarketSignal` creation.

Deterministic hygiene lives in:

```text
src/lib/market-intelligence/content-hygiene.ts
src/lib/market-intelligence/signal-suppression.ts
```

Every scraped or manually ingested market update is classified as:

- `article`
- `advisory`
- `press_release`
- `rate_update`
- `regulatory_update`
- `index_page`
- `navigation_page`
- `unknown`

Only article-like or advisory-like pages are signal eligible:

- `article`
- `advisory`
- `press_release`
- `rate_update`
- `regulatory_update`

`index_page`, `navigation_page`, and `unknown` pages may still be stored as
Research Feed `KnowledgeObject` rows for audit, but they must not create
`MarketSignal`, `MarketSignalLink`, or `MarketImpactReview` rows.

Before extraction, Derya sanitizes markdown and scores content quality from:

- title quality
- published date presence
- body length and paragraph count
- freight/logistics keyword density
- unique sentence count
- link-to-text and social-link ratios
- boilerplate markers
- article/advisory URL patterns

The default extraction threshold is `contentQualityScore >= 60`. Rejected items
store extraction metadata in the source `KnowledgeObject.payload`:

- `pageType`
- `contentQualityScore`
- `extractionStatus`
- `extractionRejectionReason`
- `extractionRejectionReasons`

Rejected updates also record a `market.update.extraction_skipped` memory event.
That gives operators auditability without letting bad pages become operational
recommendations.

Social, share, footer, and utility links are not valid lane/entity evidence.
The extractor and linker ignore URL/social/footer/navigation text and block
domains/schemes such as:

- `facebook.com`
- `x.com`
- `twitter.com`
- `linkedin.com`
- `instagram.com`
- `youtube.com`
- `tiktok.com`
- `threads.net`
- `mailto:`
- `tel:`

A lane/entity match must come from clean article/advisory body evidence, not
from links, footer text, metadata-only text, or social chrome.

## Signal Suppression

External signals remain visible for audit, but recommendation surfaces suppress
bad or closed-out signals. Morning Brief, strategy context, and agent lane/customer
exposure tools ignore a signal when any of these is true:

- source quality is `poor` or below score `50`
- source object page type is not signal eligible
- source object extraction status is rejected/skipped
- source object `contentQualityScore` is below `60`
- all related `MarketImpactReview` rows are closed and none are pending or
  acknowledged
- feedback is majority `wrong_link` or `irrelevant`
- there is no valid pending/acknowledged review where a recommendation would be
  shown

`/dashboard/intelligence` still shows suppressed signals and dismissed reviews
for audit, but labels them as suppressed/poor-quality instead of presenting them
as recommended work.

## Scheduled Ingestion

Scheduled controls live in:

```text
src/lib/market-intelligence/scheduled-ingestion.ts
src/app/api/cron/market-intelligence/route.ts
```

Rules:

- cron ingestion is off unless `MARKET_INTELLIGENCE_CRON_ENABLED=true`
- live ingestion is off unless
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true`
- sources must be enabled unless a single explicit source is requested
- dry-run mode returns a plan and does not call Firecrawl or write records
- live runs require `FIRECRAWL_API_KEY`
- direct CLI live ingestion also requires `--confirm-live`
- tests use mocked Firecrawl clients and never hit live internet
- only registry-backed, allowed-domain sources are eligible

Run a dry-run through the cron route with a valid cron secret:

```text
/api/cron/market-intelligence?dryRun=1
```

Run one explicit source from the agent or Research Inbox only when the operator
names that exact source. Broad source activation from chat is intentionally
blocked.

## MarketSignal Contract

`MarketSignal` is the operational interpretation of a source object.

Core fields:

- `officeId`
- `sourceObjectId`
- `category`
- `severity`
- `confidence`
- `affectedModes`
- `affectedOrigins`
- `affectedDestinations`
- `affectedPorts`
- `affectedLanes`
- `affectedCarriers`
- `effectiveFrom`
- `effectiveTo`
- `summary`
- `operatorImplication`
- `pricingImplication`
- `customerImpact`
- `recommendedActions`
- `sourceRefs`
- `provenance`
- `payloadVersion`

Categories:

- `rate`
- `port_disruption`
- `customs`
- `carrier_advisory`
- `weather`
- `labor`
- `geopolitical`
- `capacity`
- `compliance`

Severity:

- `low`
- `medium`
- `high`
- `critical`

## Ingestion

Entry points:

- `src/lib/market-intelligence/ingest-market-source.ts`
- `src/lib/market-intelligence/ingest-firecrawl-source.ts`
- `src/lib/market-intelligence/ingest-market-object.ts`
- `scripts/ingest-market-intelligence.ts`
- `scripts/ingest-firecrawl-market-intelligence.ts`

Run a manual ingest:

```bash
npm run market:ingest -- --office <officeId> --title "Asia-Europe rates" --url "https://example.com/update" --content "..."
```

Run enabled sources:

```bash
npm run market:ingest -- --office <officeId> --limit 10
```

Run enabled Firecrawl sources:

```bash
npm run market:ingest:firecrawl -- --office <officeId> --limit 10
```

Run one Firecrawl source:

```bash
npm run market:ingest:firecrawl -- --office <officeId> --source <sourceId> --query "Asia Europe ocean rates"
```

The smoke test does not hit live sources:

```bash
npm run test:market-intelligence
npm run test:firecrawl
```

## Idempotency

The system dedupes at three layers:

- `KnowledgeObject`: by office/source type/source external id
- `MarketSignal`: by office/source object/extracted signal hash
- `MarketSignalLink`: by signal/entity pair

Repeated RSS fetches, manual replays, and backfills should update existing rows
instead of creating duplicate operational memory.

## Extraction

`extract-market-signals.ts` currently uses deterministic logic:

- keyword category detection
- severity terms
- lane/location/port/carrier detection
- mode detection
- generated operator/pricing/customer implications
- typed validation with Zod

LLM extraction is intentionally not enabled here. The deterministic extractor is
less magical and much easier to audit. Add LLM extraction only after fixtures,
schema contracts, and review workflows are stronger.

## Linking Policy

`link-market-signals.ts` matches conservatively to:

- active jobs
- active RFQs/inquiries
- companies with affected active work
- explicit lanes named by the signal

Matching uses mode, origin, destination, and lane terms. A link means "possibly
affected." It does not mean "confirmed impacted."

## Agent Tools

Agent tools:

- `search_market_intelligence`
- `get_lane_intelligence`
- `get_customer_market_exposure`
- `search_market_research`
- `list_market_research_feed`
- `ingest_market_source_preview`
- `list_market_sources`
- `get_market_source_quality`
- `preview_market_source`
- `run_market_source_ingestion`
- `list_market_impacts`
- `acknowledge_market_impact`
- `dismiss_market_impact`
- `mark_market_impact_actioned`
- `record_market_signal_feedback`

Each returns compact signal summaries plus evidence refs. The agent should use
these tools for questions about market changes, freight news, rate pressure,
port disruption, customs changes, customer exposure, and "why did we quote this"
when a lane/job/customer is in scope.

Research tools expose raw source objects. Signal tools expose operational
interpretations. Do not collapse those concepts. Raw research can be wrong,
stale, paywalled, or irrelevant; `MarketSignal` plus `MarketImpactReview` is
where Derya decides whether anything matters.

`ingest_market_source_preview` may call Firecrawl when explicitly requested,
but it does not persist `KnowledgeObject`, `MarketSignal`, `MarketImpactReview`,
or operational records.

`run_market_source_ingestion` is single-source only. The agent may use it only
when the operator explicitly names one source id. It may not trigger broad
crawls or arbitrary URLs.

The review tools can update only review/feedback state. They must not mutate
jobs, RFQs, quotes, customer records, milestones, or outbound messages.

## Research Inbox

The small operator UI lives at:

```text
src/app/dashboard/intelligence/page.tsx
```

Sections:

- `Source Health`: source registry status, policy checks, deterministic quality
  score, feedback counts, and single-source preview/run controls.
- `Impact Reviews`: pending/acknowledged/dismissed/actioned review queue with
  acknowledge, actioned, dismiss, and wrong-link feedback actions. Ranked by
  pending status, impact, signal severity, source quality, linkage, and recency.
- `Research Feed`: ranked `KnowledgeObject` rows where `sourceType=MARKET` and
  `canonicalType=market_update`.
- `Market Signals`: ranked interpreted signals with affected modes/lanes,
  confidence, links, source quality, and pending review counts.
- `Ingestion Runs`: `MarketIngestionRun` observability for connector jobs.

The page is deliberately not a news dashboard. It is a review surface for
source-backed operational intelligence. Buttons update review/feedback state
only.

## Market Impact Review

`MarketImpactReview` turns a conservative `MarketSignalLink` into an operator
queue item. It is the human-review bridge between external intelligence and any
real operational action.

Core fields:

- `officeId`
- `marketSignalId`
- optional `marketSignalLinkId`
- `linkedEntityType` and `linkedEntityId`
- `impactLevel`: `low`, `medium`, `high`, `critical`
- `impactReason`
- `recommendedAction`
- `status`: `pending`, `acknowledged`, `dismissed`, `actioned`, `expired`
- optional feedback fields
- source refs, provenance, payload version, timestamps

Generation lives in
`src/lib/market-intelligence/market-impact-review.ts`. It is idempotent by
`officeId + marketSignalId + linkedEntityType + linkedEntityId`. Ingestion
generates pending reviews after signal links are written.

`MarketSignalFeedback` stores explicit operator judgment:

- `useful`
- `irrelevant`
- `wrong_link`
- `duplicate`
- `already_known`
- `severity_wrong`
- `source_low_quality`

This is evaluation/training data. It is not an operational mutation.

## Morning Brief

`src/lib/memory/morning-brief.ts` includes a `market_impact_reviews` section for
pending high/critical review items and a filtered `market_intelligence` section
for active signal context.

Ranking priority:

- pending `MarketImpactReview` before raw `MarketSignal`
- impact level and signal severity
- source trust/quality score
- active linked RFQ/job/customer
- recency

Suppression rules run before ranking. Poor-quality sources, rejected/index pages,
dismissed-only review sets, majority wrong-link/irrelevant feedback, and
low-quality source content do not appear as recommended action. They remain in
the Intelligence page for audit.

Each market impact brief item includes:

- linked RFQ/job/customer/lane
- impact level and reason
- recommended action
- review status
- source references
- signal/link evidence
- source quality summary, when the source is in the registry

No notifications are sent in this phase.

## Strategy And Risk

Commercial strategy accepts market signals as evidence. Linked high/critical
signals can create `MARKET` risks and reduce pricing confidence modestly. This
is advisory context only.

External intelligence must never overwrite:

- quote prices
- carrier buy rates
- milestones
- job status
- customer commitments
- document truth

Operators still need fresh carrier quotes and human review before customer
pricing is sent.

## Live Intelligence Map And Manual Pull

`/dashboard/intelligence` now starts with a deterministic world intelligence map
built by `src/lib/market-intelligence/intelligence-map.ts`.

The map aggregates, per office:

- recent `MarketSignal` rows
- pending `MarketImpactReview` rows
- recent `KnowledgeObject` rows with canonical type `market_update`
- linked jobs, RFQs, customers, lanes, modes, ports, origins, and destinations
- source quality summaries

The map uses a fixed freight-location lookup for common locations such as China,
Shanghai, Ningbo, Shenzhen, Hong Kong, Singapore, Northern Europe, Hamburg,
Rotterdam, Antwerp, Los Angeles, Long Beach, New York, Savannah, Istanbul,
Mersin, Suez, Panama, Red Sea, US, EU, Asia, Europe, Ocean, and Global Market.
It never calls an external geocoding API. The visual base map is local SVG, not
an external map provider.

Manual ingestion lives behind
`src/app/dashboard/intelligence/actions.ts` and
`src/lib/market-intelligence/manual-ingestion.ts`.

Production safety contract:

- only `ADMIN` users can run manual ingestion
- live runs require `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true`
- manual runs refuse to execute if `MARKET_INTELLIGENCE_CRON_ENABLED=true`
- one source per run
- three results/pages max
- source must be in the manual allowlist
- source must have allowed domains
- broad media sources, FreightWaves, and JOC are blocked
- no operational job/RFQ/customer/quote/milestone/message records are mutated

Current manual allowlist:

- `maersk-news-advisories`
- `drewry-world-container-index`
- `cbp-csms`
- `port-of-los-angeles-latest-news`

The production UI exposes:

- an obvious empty state when there are no research items, signals, or reviews
- runtime readiness badges for Firecrawl, manual live ingestion, cron, provider,
  source count, and result/page clamp
- per-source preview and live buttons
- a safe bundle button for `maersk-news-advisories`,
  `drewry-world-container-index`, and `cbp-csms`

Preview writes nothing. Live writes only Research Feed / `MarketSignal` /
`MarketSignalLink` / `MarketImpactReview` advisory records through the existing
ingestion pipeline.

## Evidence Policy

Every market answer should be traceable to:

- `KnowledgeObject` source update
- `MarketSignal`
- linked internal entity, when applicable
- source URL/hash/provenance

User-facing answers can cite naturally:

"Based on the Asia-Europe ocean rate signal linked to this Shanghai -> Hamburg
job, refresh buy rates before sending the customer quote."

Raw ids should stay in tool traces unless an operator asks for audit detail.

## Known Limitations

- No vector search.
- No embeddings.
- Source quality is deterministic only; no LLM ranking.
- No automatic customer messaging.
- No complex source-management UI.
- No scheduled ingestion is enabled by this UI.
- Live RSS/HTML parsing is intentionally basic.
- Matching relies on text normalization, not a dedicated lane graph.
- The extractor can miss synonyms and over-match broad geography terms.
- All curated external sources ship disabled by default until reviewed.

## Live Pilot Hardening

Before enabling live market ingestion:

1. Run `npm run market:doctor`.
2. Confirm no enabled Firecrawl source is missing allowed domains.
3. Confirm risky broad fetch configuration is empty.
4. Run a dry-run through the cron route or Research Inbox.
5. Enable one reviewed source only.
6. Set `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` only for the pilot.
7. Run one source with `--confirm-live`.
8. Review feedback and source quality before enabling cron.

Full runbook:

```text
docs/RUNBOOKS/MARKET_INTELLIGENCE_LIVE_PILOT.md
```

## Intelligence Map Visual Contract

The Intelligence map is a trust surface, not decoration.

- The base map must render the local Natural Earth 1:110m public-domain land
  asset from `src/lib/market-intelligence/world-map-asset.ts`.
- The map must show fixed geographic reference context even before signals are
  present: continents, key freight ports, and chokepoints.
- Market lanes may render only after deterministic freight-location validation.
- Invalid historical lane links may remain visible as suppressed audit evidence,
  but they must not appear as affected work, route arcs, Morning Brief
  recommendations, or strategy context.
- Raw evidence IDs should be available for audit but visually secondary to
  operator implications and recommended actions.

Guarded cleanup:

```bash
ALLOW_MARKET_REVIEW_CLEANUP=1 npm run cleanup:bad-cbp-market-reviews
```

The cleanup dismisses only pending CBP pseudo-lane reviews that match the
boilerplate lane validator. It does not delete records and does not mutate jobs,
RFQs, quotes, prices, customers, milestones, or messages.
