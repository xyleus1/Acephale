# Decisions

Use this log for durable product and engineering decisions. Do not put every implementation detail here. If future agents should treat something as settled context, it belongs here.

## Decision Template

### YYYY-MM-DD - Decision title

- Status: proposed | accepted | rejected | superseded
- Owner:
- Context:
- Decision:
- Rationale:
- Consequences:
- Revisit when:

## Log

### 2026-06-29 - Sync Gmail recently every hour and backfill history by windows

- Status: accepted
- Owner: engineering
- Context: The native Derya Gmail inboxes are operational sources, not passive
  archives. A single `newer_than:365d` scan capped by thread count can miss
  older messages in busy inboxes, and daily refresh is too stale for load/RFQ
  operations.
- Decision: Keep hourly Gmail refresh focused on recent mail, and recover
  historical mail through queued monthly `GMAIL_SYNC_WINDOW` background jobs.
  Manual sync enqueues those backfill windows. Because Vercel Hobby rejects
  hourly cron, keep Vercel cron daily as a fallback and run the hourly schedule
  through an external scheduler or GitHub Actions calling the same protected
  cron endpoints with `CRON_SECRET`.
- Rationale: Recent mail must arrive predictably without forcing every sync to
  walk years of Gmail history. Monthly windows avoid the newest-page-only
  failure mode and give older mail a deterministic path into Derya without
  blocking the settings page on one giant request.
- Consequences: Historical backfill is progressive; counts may climb over
  several background-job runs after manual sync. Hourly refresh depends on the
  external scheduler having the production `CRON_SECRET`. Backfill messages
  remain separated by `EmailAccount` and still use existing tenant-scoped
  dedupe and classifier/linking flows.
- Revisit when: Gmail push notifications, Pub/Sub history IDs, or a real worker
  queue replaces cron polling and DB-backed background jobs.

### 2026-06-28 - Treat Mert and Oguzhan Gmail as native load/RFQ inboxes

- Status: accepted
- Owner: engineering
- Context: Operators need to see load/RFQ-related mail from both
  `mert@usederya.com` and `oguzhan@usederya.com` in the app without relying on
  an external Company Brain review queue or manual Gmail searching.
- Decision: Model the Derya Gmail addresses as expected native inboxes, default
  to `mert@usederya.com` and `oguzhan@usederya.com`, allow production to extend
  that required list with `DERYA_LOAD_RFQ_INBOXES`, keep account OAuth/token
  storage in existing `EmailAccount` rows, and derive `load/*` workflow labels
  from classifier and job/RFQ link state instead of adding a new email-label
  schema.
- Rationale: The existing inbox, sync, memory, and thread promotion pipeline is
  already tenant-scoped and provenance-aware. A derived label layer gives the
  operator the Company Brain-style triage language without duplicating data or
  mutating Google labels.
- Consequences: Missing/paused configured Derya inboxes are visible setup
  problems; synced mail remains separated by account; `load/rfq`,
  `load/customer`, `load/forwarder`, `load/note`, `load/linked`, and
  `load/related` labels are Derya workflow labels, not Gmail label mutations.
- Revisit when: operators need label review/apply state, manual overrides, or
  two-way Gmail label synchronization.

### 2026-06-23 - Layer Derya Brain Ops on existing Knowledge memory

- Status: accepted
- Owner: engineering
- Context: The requested Brain Ops work overlaps with the existing
  company-brain substrate (`KnowledgeSource`, `KnowledgeObject`,
  `KnowledgeChunk`, `MemoryEvent`, and `AgentProposal`). Adding a second
  `BrainSource`/`BrainDocument` schema would create duplicated truth and more
  places for agents to hallucinate from.
- Decision: Implement Brain Ops as Codex-native docs, skills, safety rails,
  docs freshness checks, and a controlled ingest/query service on top of the
  existing memory schema.
- Rationale: This preserves tenant scoping and provenance while making the repo
  more agent-legible. Calibration ingest creates reviewable proposals instead
  of silently writing customer truth.
- Consequences: Future UI/API review work should consume `AgentProposal` rows
  created by `src/lib/brain-ops/ingest.ts`. Exact-match entity linking remains
  the rule; fuzzy merges remain forbidden.
- Revisit when: proposal review/apply UI needs first-class workflow state that
  cannot be represented cleanly in `AgentProposal`.

### 2026-06-23 - Cut production over with a fresh database and cherry-pick import

- Status: accepted
- Owner: engineering
- Context: The company-brain and market-intelligence release expects the
  current Prisma schema. Preview runtime failures showed what happens when new
  code points at an older database schema. Migrating the old production
  database in place would also carry old sessions, OAuth tokens, portal tokens,
  background jobs, memory rows, and bad market-intelligence audit residue into
  the new release.
- Decision: Production cutover will use a fresh current-schema Neon production
  database, create a new real Office/Admin, and import only selected business
  records from the old database through controlled export/import scripts.
  OAuth tokens, sessions, password hashes, old portal tokens, background jobs,
  company-brain memory rows, market-intelligence rows, and AI proposal noise
  will not be copied.
- Rationale: This keeps the production launch clean, auditable, and reversible
  at the data-selection layer. It also prevents legacy integration secrets or
  bad external-intelligence residue from becoming production truth.
- Consequences: Users must reconnect Gmail after cutover. Portal links must be
  regenerated. Historical memory/market intelligence can be rebuilt after
  launch if needed. The import should be reviewed through dry run and
  validation before main is merged.
- Revisit when: production has enough clean post-cutover data to justify a
  separate memory backfill or a carefully scoped historical email import.

### 2026-06-22 - Add pre-brain Prisma baseline for deployable migration history

- Status: accepted
- Owner: engineering
- Context: Phase 1-H2 added additive company-brain and market-intelligence
  migrations, but those migrations assume the original freight CRM tables such
  as `Office`, `Company`, `Job`, `Inquiry`, and `EmailThread` already exist.
  A fresh staging database cannot run `prisma migrate deploy` unless that
  pre-brain schema exists in migration history.
- Decision: Add `00000000000000_baseline_pre_brain`, generated from
  `9727e55:prisma/schema.prisma`, as the baseline migration for the original
  freight CRM schema. Fresh staging databases run the baseline plus additive
  migrations through `prisma migrate deploy`. Existing production databases
  that already contain the pre-brain schema should mark only the baseline as
  applied with `prisma migrate resolve --applied
  00000000000000_baseline_pre_brain`, then run `prisma migrate deploy` for the
  additive migrations.
- Rationale: The release needs one migration history that works for both fresh
  staging and existing production. `db push`, `migrate dev`, and reset commands
  are not acceptable deployment tools.
- Consequences: Production rollout must include a baseline verification step
  before stamping the baseline. Code rollback does not roll back schema, so
  migrations must stay additive and forward-compatible.
- Revisit when: production already has complete Prisma migration history from
  an earlier release, or the schema baseline commit changes.

### 2026-06-22 - Gate scraped pages before market signal extraction

- Status: accepted
- Owner: engineering
- Context: The first live Firecrawl pilot against Port of Long Beach stored a
  listing/navigation page and treated page chrome/social links as freight
  intelligence. The architecture contained the blast radius through
  `MarketImpactReview` and feedback, but Morning Brief still surfaced the bad
  raw signal.
- Decision: Source/page hygiene gates market signal extraction. Derya may store
  raw research for audit, but only article-like, evidence-backed,
  quality-scored content can create `MarketSignal` rows. Poor-quality,
  dismissed, wrong-link-heavy, irrelevant, index, or navigation-derived signals
  are suppressed from Morning Brief and strategy context.
- Rationale: External intelligence is useful only when it is operationally
  interpretable and source-backed. A crawler can fetch garbage; the company
  brain must not convert garbage into recommended work.
- Consequences: Listing pages can remain visible in Research Feed, but they do
  not produce signal links or impact reviews. Suppressed signals remain
  auditable in `/dashboard/intelligence`; operators can still see what happened
  without having the bad signal influence pricing, strategy, risk, or morning
  recommendations.
- Revisit when: enough source-quality feedback exists to tune thresholds per
  source category or replace deterministic gates with evaluated extraction
  models.

### 2026-06-22 - Harden autonomy prerequisites before live intelligence expansion

- Status: accepted
- Owner: engineering
- Context: Phase 2E made live market intelligence technically possible, but the
  system still had production hazards: plaintext Gmail OAuth token storage, a
  public portal fallback from token to `job.id`, raw quote PDF HTML
  interpolation, noisy tenant-scope audit output, and live Firecrawl controls
  that needed a clearer operator safety switch.
- Decision: Before expanding autonomy or live external ingestion, harden
  secrets, public access, HTML output, tenant-scope checks, Firecrawl domain
  controls, cron gating, and live-pilot runbooks. External intelligence remains
  advisory and must not overwrite operational truth.
- Rationale: A company brain that can retrieve more context is only useful if
  operators can trust its provenance and access boundaries. Live ingestion and
  agent autonomy multiply mistakes; boring controls have to come first.
- Consequences: Gmail OAuth writes require `TOKEN_ENCRYPTION_KEY`, portal access
  requires real random portal tokens, quote PDF output is escaped, broad
  Firecrawl search is blocked, live ingestion needs explicit enablement, and
  hardening tests are part of the verification path.
- Revisit when: production secrets, source enablement, and live pilot telemetry
  are stable enough to discuss broader autonomy.

### 2026-06-22 - Rank market sources with deterministic trust and feedback before LLM ranking

- Status: accepted
- Owner: engineering
- Context: Phase 2E activates Firecrawl-backed market intelligence as a
  controlled daily system. Source ranking now affects Research Inbox, Morning
  Brief, and agent-visible market context.
- Decision: Use deterministic source quality ranking from configured trust
  level plus operator feedback/review outcomes before any LLM ranking. Official,
  regulatory, carrier, and port sources outrank freight media by default.
  External intelligence remains advisory.
- Rationale: Operators need auditable reasons for why a signal is prominent.
  Trust level, useful feedback, actioned reviews, wrong links, irrelevant
  feedback, duplicates, stale signals, zero-link signals, and failed runs are
  inspectable. LLM ranking would hide too much judgment too early.
- Consequences: Source quality can prioritize research, signals, reviews, and
  morning brief items, but it cannot mutate jobs, RFQs, quotes, prices,
  milestones, customer records, or messages. Media/context sources can still be
  useful, but require stronger review before operational influence.
- Revisit when: there is enough labeled feedback to evaluate LLM-assisted
  ranking against deterministic baselines.

### 2026-06-22 - Treat Firecrawl as a constrained fetch provider

- Status: accepted
- Owner: engineering
- Context: Phase 2D adds web intelligence ingestion for freight/logistics
  sources. A generic web crawler can easily become a noisy, unsafe, and
  unreviewable "news brain" if it is not bounded.
- Decision: Use Firecrawl only behind registry-backed source definitions,
  domain allow-lists, run limits, provenance, and `MarketIngestionRun`
  observability. Store fetched pages as `KnowledgeObject`/`KnowledgeChunk`, then
  interpret them through `MarketSignal` and `MarketImpactReview`.
- Rationale: Derya needs source-backed operational intelligence, not generic web
  scraping. Keeping Firecrawl as an adapter preserves evidence and lets humans
  review impact before anything touches pricing, jobs, customer promises, or
  outbound communication.
- Consequences: No broad crawls, no paywall/login scraping, no live-internet
  tests, and no secret logging. The Research Inbox is a review surface, not a
  separate news product.
- Revisit when: source quality metrics show enough useful feedback to justify
  scheduled ingestion, source scoring, or stricter automated prioritization.

### 2026-06-22 - Store external intelligence as MarketSignals, not just articles

- Status: accepted
- Owner: engineering
- Context: Phase 2B needs external freight/logistics intelligence to help with
  pricing, route choice, risk, strategy, morning brief, and agent answers.
  Storing articles alone would make the company brain a passive news archive.
- Decision: Store raw source updates as `KnowledgeObject`/`KnowledgeChunk`, then
  store operational interpretations as `MarketSignal` rows linked to affected
  RFQs, jobs, companies, and lanes through `MarketSignalLink`.
- Rationale: Operators do not need "more news"; they need to know which active
  customer work may be affected and what action to take. Separating raw source
  records from operational signals keeps provenance intact while giving agents a
  structured, auditable decision surface.
- Consequences: Signal extraction and linking must be conservative and
  evidence-backed. Market signals can influence morning brief, agent context,
  strategy, and risk, but they must not overwrite operational truth or mutate
  quotes/jobs/customer commitments by themselves.
- Revisit when: lane normalization, source review, and scheduled ingestion are
  mature enough to support higher-confidence automated ranking.

### 2026-06-22 - Use MarketImpactReview as the human-review bridge

- Status: accepted
- Owner: engineering
- Context: `MarketSignalLink` means "possibly affected." That is useful but
  noisy if operators cannot review, dismiss, action, or correct links.
- Decision: Keep `MarketSignal` and `MarketSignalLink` as source/evidence
  records, and add `MarketImpactReview` plus `MarketSignalFeedback` as the
  operator review and feedback loop.
- Rationale: This creates actionable work without letting external intelligence
  mutate freight truth. Feedback also becomes training/evaluation data for
  future matching, source scoring, and autonomy.
- Consequences: Agents may update review/feedback status only. Jobs, RFQs,
  quotes, prices, milestones, customer records, and outbound messages remain
  controlled by existing workflows and human approval.
- Revisit when: review feedback volume is large enough to improve source
  scoring, lane matching, or automatic prioritization.

### 2026-06-23 - Use existing public map data and validated freight geography

- Status: accepted
- Owner: engineering
- Context: The production Intelligence page rendered a handmade stylized world
  map and then overlaid market intelligence on top. That looked authoritative
  while being geographically weak. A CBP scrape also produced pseudo-lanes such
  as `Countdown -> America` and `Welcome -> U.S. Customs and Border`.
- Decision: Use Natural Earth public-domain world land data as the offline map
  base and require all market lane/entity rendering to pass deterministic
  freight-location validation. CBP/regulatory updates are modeled as
  country/customs/compliance context unless clean body evidence contains a known
  origin/destination pair.
- Rationale: The map is a trust surface. Fake geography and fake lanes are worse
  than no map. Existing public map data gives recognizable geography without a
  runtime map dependency, and strict lane validation prevents page chrome from
  becoming operational advice.
- Consequences: Unknown or boilerplate location phrases are rejected or shown as
  suppressed audit data. Operators may need to extend the known-location
  registry as new lanes/ports become relevant. External intelligence remains
  advisory and cannot mutate freight records.
- Revisit when: Derya needs a richer lane graph, port hierarchy, geospatial
  clustering, or a proper offline vector-map renderer.

### 2026-06-23 - Keep map reference geography visible even without signals

- Status: accepted
- Owner: engineering
- Context: The Intelligence page must remain understandable before a market
  source has produced many clean signals. A technically correct map base is not
  enough if the user cannot quickly identify continents, ports, and chokepoints.
- Decision: Render fixed reference geography on top of the Natural Earth base:
  continent labels, key freight ports, and chokepoints. Keep evidence IDs
  available but collapsed so operational text stays readable.
- Rationale: Operators need a fast freight mental model. Reference labels make
  the map legible and prevent signal dots from floating on an ambiguous dark
  canvas.
- Consequences: The reference layer is deterministic and static for now. It
  should be expanded carefully as new lanes matter, not generated from noisy web
  text.
- Revisit when: the registry grows large enough to need zoom, clustering, or a
  dedicated geospatial renderer.

### 2026-06-28 - Render workbench route maps from one Mercator viewport

- Status: accepted
- Owner: engineering
- Context: The focused workbench route map originally mixed a static
  OpenStreetMap world-tile background, separately projected route markers, and
  unrelated zoom panel tiles. That made plausible-looking but geographically
  wrong route views.
- Decision: Route maps in the workbench use `src/lib/route-map-viewport.ts` as
  the single source for tile selection, marker projection, route SVG paths, and
  zoom-panel route sections. Origin/destination details stay in the compact
  summary above the map instead of being duplicated as floating map cards.
- Rationale: A freight route map is a trust surface. If the map tiles and
  overlay geometry do not share the same projection, the UI can confidently show
  the wrong route. Keeping the math in a pure helper also lets tests guard the
  behavior without needing a browser.
- Consequences: Future map changes should extend the route viewport helper or
  replace it with a real map renderer/provider. Do not reintroduce independent
  static background maps, decorative tile grids, or zoom panels that do not
  draw the same route segment.
- Revisit when: Derya needs live geocoding, selectable alternative routes,
  carrier schedules, AIS-style tracking, or a production map provider/cached
  tile strategy.
