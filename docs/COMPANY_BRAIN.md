# Company Brain Phase 1

Phase 1 adds a canonical memory/event layer without changing product behavior.
It is an append-only-ish substrate for customer memory, operational memory,
strategy explanations, and future retrieval. It does not add UI, vector search,
or autonomous workflows.

## Canonical Tables

- `KnowledgeSource`: tenant-scoped source registry for CRM, Gmail, WhatsApp,
  Google Sheets, documents, strategy, agents, and system records.
- `KnowledgeObject`: canonical object row for a source artifact or durable
  business object, such as a company, email message, job, document, or strategy
  assessment.
- `KnowledgeChunk`: searchable text chunks for a `KnowledgeObject`. Phase 1
  stores plain text only. No embeddings.
- `EntityMention`: normalized entity references found in objects and chunks.
- `MemoryEvent`: canonical event ledger. Every row has `officeId`,
  `sourceType`, entity reference, `occurredAt`, provenance, and
  `payloadVersion`.
- `AgentMemory`: durable agent notes or learned facts. Phase 1 defines the
  table and search shape; long-term memory policies come later.

## Write Contract

Live writes must be additive and best effort. Product writes happen first.
Memory writes run after the product write and should not break the user flow if
the memory migration has not been applied yet.

Required event fields:

- `officeId`
- `sourceType`
- `entityType` and `entityId`
- `occurredAt`
- `payloadVersion`
- `provenance`
- `payload`

Use `idempotencyKey` whenever an upstream source has a stable id.

## Emitters

Current Phase 1 hooks:

- Gmail sync message ingest: `src/lib/gmail-sync.ts`
- WhatsApp ingest: `src/lib/whatsapp.ts`
- Google Sheets request and operation sync: `src/lib/google-sheets-sync.ts`
- RFQ create/update/status/AI parse/convert: dashboard RFQ actions and pricing
  actions
- Job status, milestone, and document updates:
  `src/app/dashboard/jobs/[jobId]/actions.ts`
- Forwarder draft create/send:
  `src/lib/forwarder-drafts.ts`,
  `src/app/dashboard/pricing/page.tsx`
- Customer quote draft create/apply:
  job draft event helper and `src/lib/customer-quote-drafts.ts`
- Agent proposal create/review: `src/lib/agent-proposals.ts`
- Strategy assessment persist/reuse:
  `src/lib/commercial-strategy-persistence.ts`

## Backfill

Run:

```bash
npm run memory:backfill -- --office=<officeId> --strict
```

Arguments:

- `--office=<officeId>` limits backfill to one office.
- `--limit=<n>` limits rows per entity class for smoke runs.
- `--strict` makes missing tables or schema drift fail loudly.

Backfill covers Companies, Contacts, Activities, Inquiries, Jobs,
EmailThreads, EmailMessages, JobDocuments, StrategyAssessments, and
AgentProposals.

## Agent Tools

New agent tools:

- `get_customer_dossier`
- `search_customer_memory`
- `search_job_memory`
- `explain_strategy_decision`

These tools read the canonical memory layer plus core CRM/job/strategy tables.
Phase 2A upgrades them to deterministic hybrid retrieval. Do not pretend this is
semantic search yet.

## Canonical Taxonomy

Canonical object types live in:

```text
src/lib/memory/canonical-types.ts
```

Allowed `canonicalType` values:

- `company`
- `contact`
- `activity`
- `rfq`
- `job`
- `email_thread`
- `email_message`
- `job_document`
- `strategy_assessment`
- `agent_proposal`
- `customer_note`
- `market_update`
- `market_signal`
- `product_decision`
- `code_reference`
- `personal_note`

Allowed source types:

- `CRM`
- `GMAIL`
- `WHATSAPP`
- `GOOGLE_SHEETS`
- `INQUIRY`
- `JOB`
- `DOCUMENT`
- `STRATEGY`
- `AGENT`
- `SYSTEM`
- `MARKET`
- `PRODUCT`
- `CODE`
- `PERSONAL`

`strategy_decision` is a legacy canonical type and normalizes to
`strategy_assessment`. New writes should never intentionally create
`strategy_decision`; the doctor flags existing rows so they can be cleaned.

Write-path rules:

- `ingestKnowledgeObject` normalizes source and canonical types.
- `ingestKnowledgeObjectStrict` rejects unknown canonical types.
- `recordMemoryEvent` normalizes source type before deriving idempotency keys.
- Backfill uses the canonical helper so future taxonomy drift fails loudly.

## Hybrid Search Contract

Hybrid search lives in:

```text
src/lib/memory/hybrid-search.ts
src/lib/memory/relevance.ts
src/lib/memory/evidence.ts
src/lib/memory/search-memory.ts
```

Inputs:

- `officeId`
- `query`
- `companyId`
- `jobId`
- `inquiryId`
- `entityType` / `entityId`
- `canonicalTypes`
- `sourceTypes`
- `dateRange`
- `limit`
- `includeEvents`
- `includeChunks`

Retrieval signals:

- direct structured filters on `KnowledgeObject`
- chunk text matches
- title and source external ID matches
- entity mention matches
- direct event matches
- recency boost
- canonical type boost
- source type boost
- exact entity scope boost

Results include:

- `objectId`
- `chunkId`
- `eventId`
- `entityType` / `entityId`
- `companyId`
- `jobId`
- `inquiryId`
- `sourceType`
- `sourceExternalId`
- `canonicalType`
- `title`
- `excerpt`
- `score`
- `occurredAt`
- `reasons`
- `evidence`

Search must be read-only. `npm run test:memory-search` checks that repeated
searches do not mutate `KnowledgeObject`, `KnowledgeChunk`, `MemoryEvent`, or
`EntityMention` counts.

## Evidence Contract

Evidence helpers live in:

```text
src/lib/memory/evidence.ts
```

Each memory-based result should expose compact source references:

- `KnowledgeObject` id
- `KnowledgeChunk` id when chunk text was used
- `MemoryEvent` id when event ledger data was used
- underlying entity type and id
- source type and source external id
- canonical type
- occurrence date

Agent-facing evidence can include raw ids because it is an audit trail. User
answers should mention sources naturally unless the operator asks for raw ids:

```text
Based on the latest RFQ email, the active strategy assessment, and the pending document row...
```

The public formatter is `formatEvidenceForUser`. The internal formatter is
`formatEvidenceForAgent`.

## Memory Health Checks

Run:

```bash
npm run memory:doctor
```

Optional:

```bash
npm run memory:doctor -- --office=<officeId>
```

The doctor reports object/event/chunk/mention counts, company/job linkage,
orphaned objects, missing provenance, duplicate source IDs/content hashes,
backfill-vs-live volume, event time range, the top customers/jobs by memory
volume, canonical/source taxonomy quality, unknown and legacy canonical types,
orphaned indexed text, entity mentions pointing to missing rows, and search
index readiness.

Doctor output should be treated as a trust gate:

- Unknown canonical types mean writes are not governed.
- Legacy canonical types mean old rows need migration or backfill cleanup.
- Orphaned objects mean retrieval can return facts without business context.
- Chunks without entity mentions mean search can find text the agent cannot
  safely attribute.
- Missing provenance means the company cannot explain where a claim came from.
- Duplicate source IDs or hashes mean idempotency is weak.

Do not layer vector search on top of dirty canonical memory. That just makes the
wrong facts easier to retrieve.

## Customer Dossier Contract

`getCustomerDossier` returns a source-linked account packet:

- `company_profile`
- `contacts`
- `recent_emails`
- `recent_activities`
- `active_jobs`
- `recent_inquiries`
- `recent_quotes`
- `target_price_history`
- `recent_documents`
- `recent_strategy_assessments`
- `open_risks`
- `open_tasks`
- `unresolved_loops`
- `relationship_preferences`
- `commercial_summary`
- `operational_summary`
- `recommended_next_actions`
- `memory.recent_events`
- `memory.recent_objects`

Major records include `sources` with underlying entity ids plus linked
`KnowledgeObject` and `MemoryEvent` ids when available.

## Morning Brief Contract

`generateMorningBrief` returns deterministic office triage:

- urgent customer follow-ups
- stuck jobs
- unanswered inbound messages
- new supplier offers
- high-risk strategy assessments
- missing documents
- upcoming ETAs/ETDs
- stale RFQs
- customer risks
- recommended actions

Run:

```bash
npm run test:morning-brief
```

This does not send email, Slack, WhatsApp, or notifications. It only returns
structured data.

## Agent Memory Usage Policy

- Focused job pages inject compact linked customer memory into agent context.
- Focused job pages also inject compact job memory into agent context.
- Customer pages pass the route customer id to the global agent widget.
- Agent context may include compact market intelligence only as risk/pricing
  context, never as a replacement for CRM/job/RFQ truth.
- The compact memory block is background context, not enough for detailed
  answers.
- For customer history, call `get_customer_dossier`.
- For job history or "what changed", call `search_job_memory`.
- For customer memory search, call `search_customer_memory`.
- For external freight updates, call `search_market_intelligence`.
- For a lane-specific rate/disruption read, call `get_lane_intelligence`.
- For customer exposure to external market signals, call
  `get_customer_market_exposure`.
- For price/route/risk "why" questions, call `explain_strategy_decision`.
- The existing `morning_briefing` tool includes the deterministic memory
  morning brief.

## Source And Evidence Requirements

Memory-based answers should prefer claims backed by a CRM entity id,
`KnowledgeObject` id, `MemoryEvent` id, strategy assessment id, email/thread id,
job/document/RFQ id, or source provenance. User-facing answers can stay concise
and mention sources naturally: "based on the latest RFQ email, the active
strategy assessment, and the pending invoice document." Raw ids belong in tool
traces and audit output unless the operator asks.

## Verification

Run the normal schema/code checks:

```bash
npx prisma validate
npm run db:generate
npm run test:strategy
npx tsc --noEmit
npm run test:memory
npm run test:memory-search
npm run memory:doctor
npm run test:morning-brief
npm run build
```

The smoke test creates a temporary office and verifies strict `MemoryEvent`
writes for Gmail, Inquiry, Job, and Strategy event types, verifies the customer
dossier shape, verifies repeat backfill idempotency, then deletes the temporary
office.

## Known Gaps

- No vector index or embeddings.
- No UI for memory review.
- No retention policy executor.
- No event bus. Writes are direct Prisma calls.
- No complete Slack/support/CRM connector memory yet.
- Plain keyword search will miss semantically related facts.
- Customer page scope is route-derived from the global widget; there is not yet
  a first-class customer-scoped chat panel.
- The morning brief is deterministic triage, not a notification workflow.
- Evidence ids are collected for trust, but there is no clickable memory audit
  UI yet.

## Future Vector Search Plan

Phase 2A deliberately does not add embeddings. The correct next step is:

1. Clean canonical taxonomy and entity mentions until `memory:doctor` shows no
   unknown types, no orphaned chunks, and no duplicate source IDs.
2. Add stable chunk IDs and immutable text snapshots for embedding.
3. Embed `KnowledgeChunk.text` only after provenance and entity links are
   present.
4. Store embedding model/version on each vector row.
5. Keep hybrid structured filters as mandatory pre-filters for tenant,
   customer, job, inquiry, source type, and canonical type.
6. Use vector similarity only as an additional ranking signal, not as the only
   source of truth.

The boring deterministic layer comes first. Otherwise semantic search will
confidently retrieve unscoped junk.

## Phase 2B: Market Intelligence

Phase 2B adds external freight/logistics intelligence to the same company brain
instead of building a separate news dashboard. The flow is:

```text
external source -> KnowledgeSource -> KnowledgeObject -> KnowledgeChunk
  -> MarketSignal -> affected customers/jobs/RFQs/lanes
  -> Morning Brief / Agent / Strategy / Risk
```

The important product distinction:

- `KnowledgeObject` stores the raw article/update/advisory with provenance.
- `MarketSignal` stores the operational interpretation: what changed, how
  severe it is, which lanes/modes/carriers may be affected, and what an operator
  should do next.

### MarketSignal Contract

`MarketSignal` rows are office scoped and linked to a source
`KnowledgeObject`. Required operational fields:

- `category`: `rate`, `port_disruption`, `customs`, `carrier_advisory`,
  `weather`, `labor`, `geopolitical`, `capacity`, `compliance`
- `severity`: `low`, `medium`, `high`, `critical`
- `confidence`: deterministic extraction confidence from 0 to 1
- affected dimensions: modes, origins, destinations, ports, lanes, carriers
- effective window: `effectiveFrom`, `effectiveTo`
- implications: operator, pricing, customer impact
- `recommendedActions`
- `sourceRefs`
- `provenance`, `payloadVersion`, timestamps

`MarketSignalLink` conservatively connects signals to internal business objects:

- active RFQs/inquiries
- active jobs
- companies derived from affected active work
- named lanes

These links mean "possibly affected", not "definitely impacted." The system is
intentionally cautious because bad certainty here would produce bad pricing and
bad customer communication.

### Market Intelligence Sources

Source definitions live in
`src/lib/market-intelligence/source-registry.ts`. The registry supports:

- `id`
- `name`
- `sourceType`
- `trustLevel`
- `url`
- `fetchType`: `rss`, `html`, or `manual`
- `defaultCategory`
- `enabled`

The default live registry is deliberately small. Additional sources can be
provided through `MARKET_INTELLIGENCE_SOURCES_JSON`. Smoke tests use fixtures and
do not depend on the public internet.

### Ingestion And Idempotency

The ingestion path is:

- `src/lib/market-intelligence/ingest-market-source.ts`
- `src/lib/market-intelligence/ingest-market-object.ts`
- `src/lib/market-intelligence/extract-market-signals.ts`
- `src/lib/market-intelligence/link-market-signals.ts`

Writes are additive and idempotent:

- source URL/external id/hash dedupes `KnowledgeObject`
- source object + extracted signal hash dedupes `MarketSignal`
- signal/entity pairs dedupe `MarketSignalLink`
- source-linked `MemoryEvent` rows are emitted for market updates and signals

### Morning Brief Market Section

`generateMorningBrief` now includes `market_intelligence` for recent high and
critical signals. Each item includes:

- signal category/severity/confidence
- affected modes and lanes
- affected active RFQ/job/customer counts
- recommended actions
- link reasons
- source references

The brief does not send notifications.

### Customer Dossier Market Section

`getCustomerDossier` now includes a `market_intelligence` section based on
signals linked directly to the company or derived from active jobs/RFQs. The
commercial and operational summaries include market exposure counts and latest
signal context when available.

### Agent Tools

The agent has three market tools:

- `search_market_intelligence`
- `get_lane_intelligence`
- `get_customer_market_exposure`

Tool responses include evidence refs. Agent answers should describe market
signals as external context and cite the source update naturally when useful.

### Strategy And Risk Use

Commercial strategy now accepts linked `marketSignals` as evidence. High or
critical market signals can:

- add `MARKET` risk assessments
- lower win probability modestly
- reduce pricing power for high/critical rate signals
- add market context to the strategy memo

This does not overwrite operational truth. A market signal can warn that rates
may have moved; it cannot change a job, quote, customer price, or milestone by
itself.

### Verification

Additional checks:

```bash
npm run test:market-intelligence
npm run market:ingest
```

`npm run test:market-intelligence` creates a temporary office, ingests a
deterministic Asia-Europe ocean rate fixture, verifies idempotency, links the
signal to RFQ/job/company/lane, checks market agent tools, checks the Morning
Brief market section, and checks commercial strategy market evidence.

### Market Intelligence Limitations

- Extraction is deterministic keyword/regex logic, not an LLM judge.
- No vector search or embeddings.
- Live source fetching is intentionally basic.
- No source-management UI.
- No customer notifications.
- No automatic quote mutation or repricing.
- Matching is conservative and lane/mode text based, so some real impacts will
  be missed until the lane model gets stricter normalization.

## Phase 2C: Market Impact Review And Feedback

Phase 2C turns linked market signals into reviewable operational action items.
The data flow is:

```text
MarketSignal -> MarketSignalLink -> MarketImpactReview -> operator feedback
```

`MarketImpactReview` is deliberately separate from `MarketSignalLink`.
`MarketSignalLink` preserves evidence that a signal may affect an entity.
`MarketImpactReview` stores the operator workflow state:

- `pending`
- `acknowledged`
- `dismissed`
- `actioned`
- `expired`

Feedback kinds:

- `useful`
- `irrelevant`
- `wrong_link`
- `duplicate`
- `already_known`
- `severity_wrong`
- `source_low_quality`

The review layer can answer:

- which market impacts are pending?
- which jobs/RFQs/customers need review?
- which links were wrong?
- which sources produce useful or irrelevant intelligence?
- which actions were already handled?

It cannot mutate:

- jobs
- RFQs
- quotes
- prices
- milestones
- customer records
- outbound customer or supplier messages

### Market Impact Agent Tools

The agent can use:

- `list_market_impacts`
- `acknowledge_market_impact`
- `dismiss_market_impact`
- `mark_market_impact_actioned`
- `record_market_signal_feedback`

These tools update only review and feedback records. Human operators still use
the existing freight workflows to change quotes, jobs, customer commitments, or
supplier/customer communication.

### Market Doctor

Run:

```bash
npm run market:doctor
```

The doctor reports signal volume, zero-link signals, inactive links, review
status counts, stale signals, duplicate signals, and feedback by source. This is
the noise-control loop for market intelligence.

## Phase 2D: Firecrawl Research Inbox

Phase 2D adds a constrained web intelligence connector and a small operator
review surface. It keeps the same company-brain contract:

```text
approved external source
  -> Firecrawl fetch/search
  -> KnowledgeSource
  -> KnowledgeObject canonicalType=market_update
  -> KnowledgeChunk
  -> MarketSignal
  -> MarketImpactReview
  -> Research Inbox / agent / morning brief / strategy
```

Key files:

- `src/lib/market-intelligence/firecrawl-client.ts`
- `src/lib/market-intelligence/source-policy.ts`
- `src/lib/market-intelligence/ingest-firecrawl-source.ts`
- `src/app/dashboard/intelligence/page.tsx`
- `scripts/ingest-firecrawl-market-intelligence.ts`
- `scripts/firecrawl-smoke.test.ts`

### Firecrawl Policy

Firecrawl is only a fetch provider. It does not define operational truth.
Sources must be registry-backed and domain-constrained. Broad internet crawls,
login pages, subscribe/paywall flows, and secret logging are blocked by policy.

Required env:

```bash
FIRECRAWL_API_KEY=""
MARKET_INTELLIGENCE_PROVIDER="firecrawl"
MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN="10"
MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN="20"
```

### Research Inbox Contract

`/dashboard/intelligence` shows:

- impact reviews with acknowledge/actioned/dismiss/wrong-link actions
- research feed `KnowledgeObject` rows
- interpreted `MarketSignal` rows
- `MarketIngestionRun` connector observability

The page is intentionally small. It never sends customer messages and never
edits jobs, quotes, carrier rates, milestones, or customer records.

### Additional Agent Tools

- `search_market_research`: search raw market update objects
- `list_market_research_feed`: list recent source-backed research feed items
- `ingest_market_source_preview`: preview a Firecrawl source without persisting
  memory or mutating operations

Use research tools for source/article questions. Use signal tools for
operational impact questions. Keep the distinction, because raw source text is
not the same thing as Derya's operational interpretation.

### Additional Verification

```bash
npm run test:firecrawl
npm run market:ingest:firecrawl -- --office <officeId> --source <sourceId>
```

`npm run test:firecrawl` uses deterministic mocked Firecrawl responses. It does
not touch live internet.

## Phase 2E: Source Activation And Quality Ranking

Phase 2E turns market intelligence from a working connector into a controlled
daily intelligence system.

Key files:

- `src/lib/market-intelligence/source-registry.ts`
- `src/lib/market-intelligence/source-quality.ts`
- `src/lib/market-intelligence/scheduled-ingestion.ts`
- `src/app/api/cron/market-intelligence/route.ts`
- `src/app/dashboard/intelligence/page.tsx`
- `scripts/source-quality.test.ts`
- `scripts/scheduled-market-ingestion.test.ts`

### Source Registry

Curated external sources are registry-backed, domain-constrained, and disabled
by default unless explicitly reviewed. Phase 2E includes official/regulatory,
carrier, port, rate-index, and media/context source definitions.

Media/context sources start with lower trust than official/regulatory/carrier
and port sources. Media can add context, but it should not drive operational
truth without review.

### Source Quality Contract

Source quality is deterministic. It uses configured trust plus review feedback:

- useful feedback and actioned reviews raise score
- wrong-link and irrelevant feedback lower score
- dismissed reviews, duplicate signals, stale signals, zero-link signals, and
  failed ingestion runs lower score

This score ranks:

- Research Feed items
- Market Signals
- Market Impact Reviews
- Morning Brief market sections

There is no vector search and no LLM ranking in this phase.

### Scheduled Ingestion

Scheduled ingestion is controlled by:

```bash
MARKET_INTELLIGENCE_CRON_ENABLED="false"
MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN="3"
MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET="100"
```

The cron endpoint supports dry-run preview and single-source execution. Live
Firecrawl runs require `FIRECRAWL_API_KEY`. Tests use mocked Firecrawl
responses and never hit live internet.

### Agent Policy

The agent may:

- list market sources
- inspect source quality
- preview a single source
- run one explicit source when the operator asks

The agent may not:

- trigger broad crawls
- crawl arbitrary URLs
- auto-send customer/supplier messages
- mutate jobs, RFQs, quotes, prices, milestones, customer records, or messages
  from market intelligence

### Verification

```bash
npm run test:source-quality
npm run test:scheduled-market-ingestion
npm run market:doctor
```

## H1: Production Hardening And Live Pilot Prep

H1 is not a product expansion phase. It hardens the memory and market
intelligence plumbing before live ingestion or broader agent autonomy.

Security and trust contracts:

- Gmail OAuth token writes are encrypted with AES-256-GCM using
  `TOKEN_ENCRYPTION_KEY`.
- Existing plaintext Gmail tokens may still be read for local/dev continuity,
  but reconnect/refresh paths store encrypted values.
- Public portal access requires a real random `portalToken`; `job.id` is no
  longer accepted as a fallback.
- Quote PDF HTML escapes all dynamic job, customer, route, and quote-line
  values before interpolation.
- Firecrawl search requires allowed domains; broad search is blocked before any
  network request.
- Live Firecrawl ingestion requires both source policy and explicit live
  enablement. `MARKET_INTELLIGENCE_CRON_ENABLED` alone is not enough.
- External intelligence remains advisory and cannot overwrite operational
  truth.

New verification:

```bash
npm run test:security
npm run audit:tenant-scope
```

Operational checks:

- `npm run market:doctor` reports Firecrawl key configured yes/no only, cron
  state, live-ingestion state, enabled source count, missing allowed domains,
  risky broad fetch configs, sources exceeding limits, recent failures, pending
  impact reviews, and wrong-link-heavy sources.
- `docs/RUNBOOKS/MARKET_INTELLIGENCE_LIVE_PILOT.md` is the live pilot runbook.

Do not run live Firecrawl ingestion in normal tests. Use mocked tests and
dry-runs unless the operator explicitly starts a live pilot.

## H2: Web Extraction Hygiene And Signal Suppression

H2 adds the missing trust boundary between external scraped pages and operational
recommendations.

The rule is blunt:

```text
raw research can be stored for audit
only clean, article-like, evidence-backed content can create MarketSignals
only unsuppressed signals with active impact work can drive Morning Brief or strategy context
```

Key files:

- `src/lib/market-intelligence/content-hygiene.ts`
- `src/lib/market-intelligence/signal-suppression.ts`
- `src/lib/market-intelligence/extract-market-signals.ts`
- `src/lib/market-intelligence/ingest-market-object.ts`
- `src/lib/market-intelligence/link-market-signals.ts`
- `src/lib/memory/morning-brief.ts`
- `scripts/market-content-hygiene.test.ts`
- `scripts/market-signal-suppression.test.ts`

### Extraction Gate

Every external market update is sanitized, classified, and scored before signal
extraction.

Eligible page types:

- `article`
- `advisory`
- `press_release`
- `rate_update`
- `regulatory_update`

Rejected page types:

- `index_page`
- `navigation_page`
- `unknown`

Rejected content is still allowed to become a Research Feed
`KnowledgeObject`, but it must not create `MarketSignal`,
`MarketSignalLink`, or `MarketImpactReview` rows. Rejection metadata is stored
on `KnowledgeObject.payload`, and `market.update.extraction_skipped` records the
skip in memory.

### Evidence Gate

Signal extraction requires clean body evidence, category-specific trigger words,
freight/logistics context, and a minimum content quality score. Social links,
footer/navigation text, share widgets, `mailto:`, `tel:`, and social domains are
not valid lane, carrier, port, customer, or strategy evidence.

### Suppression Gate

Morning Brief, agent market exposure tools, and strategy context ignore signals
when:

- source quality is poor
- source object content quality is below threshold
- source object was classified as index/navigation/unknown
- extraction was rejected or skipped
- all related impact reviews are closed
- feedback is majority `wrong_link` or `irrelevant`
- there is no active pending/acknowledged impact review for a recommendation

The Intelligence page still shows suppressed/bad signals for audit. The point is
not to hide mistakes; it is to stop mistakes from becoming recommended work.

### H2 Verification

```bash
npm run test:market-content-hygiene
npm run test:market-signal-suppression
npm run market:doctor
npm run test:morning-brief
```

The next live pilot should repeat the same `port-of-long-beach-news` source with
the same small clamp before testing a second source. Expected behavior: the
listing page is stored as research, no fake signal is extracted from chrome, no
social-link lanes are created, and Morning Brief stays quiet.

## Live Intelligence Map And Manual Market Pull

The Intelligence page now uses the company-brain market layer directly instead
of being only a list view.

Key files:

- `src/lib/market-intelligence/intelligence-map.ts`
- `src/lib/market-intelligence/manual-ingestion.ts`
- `src/app/dashboard/intelligence/actions.ts`
- `src/components/intelligence/world-intelligence-map.tsx`
- `src/components/intelligence/manual-market-ingestion-controls.tsx`

Contract:

- `getIntelligenceMapData(officeId)` returns hotspots, lane arcs, research
  items, impact reviews, source health, and top-level metrics for one office.
- Map coordinates are deterministic and local. There is no external geocoding.
- Manual market ingestion is admin-only.
- Manual live ingestion requires
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true`.
- Manual ingestion refuses to run while
  `MARKET_INTELLIGENCE_CRON_ENABLED=true`.
- Manual ingestion is source allowlisted and clamps to three results/pages.
- External intelligence remains advisory. It can create research, signals,
  links, and impact reviews, but it must not mutate operational freight records.

New checks:

```bash
npm run test:intelligence-map
npm run test:manual-market-ingestion-action
```
