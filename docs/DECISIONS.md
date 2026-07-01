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

### 2026-07-01 - Production pentest sandbox self-repairs by cron

- Status: accepted
- Owner: engineering
- Context: Local `seed:pentest-demo -- --apply` verified the pentest account,
  but production login still failed because the deployed app uses a different
  database. The production shell/database URL is not available to every coding
  session.
- Decision: Keep the pentest sandbox provisioned through an idempotent
  `CRON_SECRET`-protected route at `/api/cron/pentest-demo`, scheduled by
  Vercel every 5 minutes. The route verifies first and only repairs the
  sandbox when missing or broken. It also removes legacy `admin@demo.local`
  rows in the target database.
- Rationale: A sandbox account that only works in the local database is useless
  to pentesters. The route uses the same auth pattern as existing cron jobs and
  avoids exposing production database URLs or secret values to local agents.
- Consequences: The pentest account is intentionally resettable and synthetic.
  Do not put real customer, supplier, token, OAuth, or production facts into
  this tenant. Remove the cron when the internal pentest window ends.
- Revisit when: there is a first-class internal admin console or controlled
  deployment task runner for one-off production data operations.

### 2026-07-01 - Public signup and sample admin access stay disabled

- Status: accepted
- Owner: engineering
- Context: The login page exposed both public office creation and a legacy
  `admin@demo.local / admin1234` sample access path. For an internal pentest
  sandbox, those controls make testers use the wrong account and allow tenant
  creation outside the prepared sandbox.
- Decision: The public login page should only allow sign-in. Do not expose
  sample/admin credentials, `?demo=1` autofill, or a public `/signup` office
  creation page. Pentest access is provisioned through the explicit
  `seed:pentest-demo` command and legacy demo admin cleanup through
  `cleanup:demo-admin`.
- Rationale: Internal test accounts should be deliberate, resettable, and
  isolated. Public sample credentials and open tenant creation are noisy and
  weaken the test surface.
- Consequences: New offices must be created through controlled setup scripts
  or future admin-only tooling, not public self-serve signup. Do not re-add
  `admin@demo.local` as a visible login hint.
- Revisit when: Derya intentionally supports public self-serve onboarding.

### 2026-06-30 - Separate top-down dashboard from focused load cockpit

- Status: accepted
- Owner: engineering
- Context: The focused `/dashboard` load view was rendering office-wide
  decision queue and control-sheet modules under the selected job. That made a
  real load like `JOB-2026-021` appear to contain unrelated sheet rows and
  under-covered RFQs from other lanes.
- Decision: `/dashboard` defaults to the focused load cockpit and should render
  only the selected job's route, pricing, timeline, documents, conversation,
  and load-scoped workflow context. Office-wide queue/control-sheet views
  live behind an explicit top-down mode at `/dashboard?view=overview`.
- Rationale: Operators need to trust that a load page is scoped to that load.
  Global prioritization is useful, but mixing it into a specific load makes the
  system look like it is hallucinating or cross-contaminating customer work.
- Consequences: Future dashboard widgets must choose one scope: focused job or
  office-wide overview. If a widget needs both, it should expose separate
  scoped variants instead of reusing the same component blindly.
- Revisit when: the product has a dedicated route structure for
  `/dashboard/overview` and `/dashboard/jobs/[jobId]/workbench`.

### 2026-06-30 - Domestic trucking pricing V1 is US-only

- Status: accepted
- Owner: engineering
- Context: The first domestic pricing page treated any `ROAD` RFQ as
  domestic, which incorrectly surfaced Turkey and Europe lanes as domestic
  trucking candidates. That is commercially misleading and makes the wedge
  look fake.
- Decision: Domestic trucking pricing V1 is limited to US pickup to US delivery
  lanes. The UI may still show non-US road RFQs as suppressed context, but only
  `US_DOMESTIC` lanes can produce mock/manual rate options or draft quote
  economics. Unknown/generic locations such as country-only `USA` remain
  blocked until city/state/ZIP is explicit.
- Rationale: US domestic truckload/LTL rating, loadboards, and DAT/Truckstop
  style provider integrations are a different product surface from
  international road or multimodal forwarding. Mixing them destroys operator
  trust.
- Consequences: Future live-provider work should start with US-only adapters,
  US location normalization, provider credential status, approval state, and
  audit persistence. International trucking can be added as a separate market
  model later.
- Revisit when: there is a deliberate non-US road provider strategy with
  coverage, contract terms, and lane-normalization rules.

### 2026-06-30 - Domestic trucking V1 is draft-only mock/manual pricing

- Status: accepted
- Owner: engineering
- Context: The approved domestic trucking wedge needs an instant pricing feel
  inside Derya, but the provider bridge and company-brain retrieval are not yet
  production integrations. Faking live quotes or letting the UI imply booking
  authority would create bad commercial risk.
- Decision: V1 exposes a domestic trucking rate workbench and RFQ-side panel
  using deterministic required-field checks, mock benchmark rates, manual-rate
  readiness, draft quote economics, approval warnings, and source-slugged
  brain-context placeholders. It does not store provider credentials, call live
  rate APIs, send customer emails, book capacity, tender to carriers, or bypass
  human approval.
- Rationale: Operators get fast missing-field diagnosis, normalized truckload
  request shape, provisional economics, and a visible bridge slot for future
  GBrain context without pretending the system has live provider truth.
- Consequences: Future provider work must extend the `DomesticRateProvider`
  boundary and keep `officeId`, provenance, credential status, and approval
  semantics explicit.
- Revisit when: provider sandbox credentials, persisted audit logs, and
  source-backed GBrain retrieval are ready for an operator-reviewed pilot.

### 2026-06-30 - RFQ-to-load conversion is reviewed and starts as inquiry

- Status: accepted
- Owner: engineering
- Context: Inbound customer emails can be complete RFQs, partial RFQs, or terse
  follow-ups where existing customers expect unchanged details to be inferred
  from previous loads. Blindly promoting an email RFQ risks hiding old
  assumptions as new facts.
- Decision: Inbox/RFQ conversion creates an editable review draft first.
  Current RFQ/email fields win. Missing operational details may be suggested
  from recent same-customer prior loads, but those fields remain visible,
  editable, and marked as prior-load context. Prior target prices are not
  silently carried forward. Confirmed loads start as `INQUIRY`.
- Rationale: Operators need one click into a useful draft, not a magical
  mutation that corrupts commercial truth. Separating load tracking from RFQ
  maturity lets Derya capture work early while keeping quoting and forwarder
  handoff gated by explicit facts.
- Consequences: Future RFQ conversion buttons should use the reviewed draft
  service, preserve source-by-field provenance, and avoid setting jobs directly
  to quoted/priced stages.
- Revisit when: reviewed examples are available to improve prior-load
  suggestion ranking with evaluated deterministic heuristics or AI assistance.

### 2026-06-30 - Treat rfq@usederya.com as a deterministic RFQ source

- Status: accepted
- Owner: engineering
- Context: Most inbound load requests are expected to arrive from or through
  `rfq@usederya.com`. Relying only on generic AI classification makes same-day
  RFQs too easy to bury under calendar, founder, and operational noise.
- Decision: `rfq@usederya.com` is the default configured RFQ source sender.
  Inbound messages from configured RFQ source senders are treated as `RFQ`
  before LLM classification, count as load/RFQ-related in Inbox filters, and
  bias auto-link/create away from skipping the thread. The list can be extended
  with `DERYA_RFQ_SOURCE_EMAILS`.
- Rationale: This is a strong deterministic production signal, not a style
  preference. The app should use the address structure the business controls
  before asking an LLM to infer intent.
- Consequences: If `rfq@usederya.com` starts receiving non-RFQ mail, route it
  somewhere else or remove it from `DERYA_RFQ_SOURCE_EMAILS`; otherwise that
  noise will intentionally surface as RFQ work.
- Revisit when: there is a richer inbound routing system with per-alias rules,
  Gmail labels, or mailbox-specific ingestion policies.

### 2026-06-29 - Sync Gmail recently every hour and backfill history by windows

- Status: accepted
- Owner: engineering
- Context: The native Derya Gmail inboxes are operational sources, not passive
  archives. A single `newer_than:365d` scan capped by thread count can miss
  older messages in busy inboxes, and daily refresh is too stale for load/RFQ
  operations.
- Decision: Keep hourly Gmail refresh focused on recent mail, and recover
  historical mail through queued monthly `GMAIL_SYNC_WINDOW` background jobs.
  Manual sync enqueues those backfill windows. Now that production runs on
  Vercel Pro, Vercel cron is the single hourly scheduler for Gmail refresh and
  background-job draining.
- Rationale: Recent mail must arrive predictably without forcing every sync to
  walk years of Gmail history. Monthly windows avoid the newest-page-only
  failure mode and give older mail a deterministic path into Derya without
  blocking the settings page on one giant request.
- Consequences: Historical backfill is progressive; counts may climb over
  several background-job runs after manual sync. Do not also run the old GitHub
  Actions hourly workflow, or production will double-hit the sync endpoints.
  Backfill messages remain separated by `EmailAccount` and still use existing
  tenant-scoped dedupe and classifier/linking flows.
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