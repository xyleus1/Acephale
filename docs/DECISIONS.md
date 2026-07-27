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

### 2026-07-27 - Outreach execution is a top-level workspace over CRM data

- Status: accepted
- Owner: product and engineering
- Context: Daily and weekly outreach was implemented inside the CRM contact
  page, which made the operating queue look like a secondary CRM mode and made
  it too easy to miss.
- Decision: Keep `/dashboard/crm` focused on canonical contact data and expose
  daily and weekly execution at the top-level `/dashboard/outreach` route.
  Both routes reuse the same office-scoped `Contact`, `Company`, and
  `OutreachPlanItem` records, server loader, planner, and mutation actions.
  Legacy CRM outreach URLs redirect to the new workspace.
- Rationale: CRM is where relationship data is maintained. Outreach is where
  the operator executes today's work and reviews weekly capacity. Separate
  navigation makes that distinction obvious without creating a second contact
  database or duplicating business logic.
- Consequences: Contact and outreach mutations revalidate both routes. The
  Outreach workspace links back to CRM for classification and channel fixes,
  while CRM provides a direct link into today's Outreach queue. No new schema,
  automated send behavior, or parallel outreach system is introduced.
- Revisit when: channel integrations support approved sending and delivery
  evidence, or outreach execution needs a dedicated agent context.

### 2026-07-26 - CRM outreach uses a weekly plan over canonical contacts

- Status: accepted
- Owner: product and engineering
- Context: Founder outreach needs a repeatable daily operating loop without
  creating a second contact database or implying that social and email messages
  were sent automatically.
- Decision: Keep `Contact` and `Company` as canonical relationship truth. Use
  office-scoped `OutreachPlanItem` rows to maintain seven days of capacity and
  promote daily work at fixed channel limits: 20 Bookface, 30 LinkedIn, and 30
  Email. Only Personally important and Startup contacts with an assigned
  channel are eligible. Forwarders are data-only. Operators must explicitly
  mark outreach complete; the action records an activity and touch timestamps
  but does not send a message.
- Rationale: A finite queue makes progress measurable while preserving tenant
  isolation, canonical CRM records, and human control over external contact.
  Keeping weekly planning separate from contact status also provides an
  auditable history without overloading the contact record.
- Consequences: Weekly pool gaps are visible, overdue tasks consume the next
  day's channel capacity, and completing a task does not silently refill beyond
  that day's quota. The planner ranks importance deterministically before age.
- Revisit when: channel integrations can prove delivery and an approved
  automation policy exists for outbound outreach.

### 2026-07-03 - CRM relationship OS reuses company/contact truth

- Status: accepted
- Owner: engineering
- Context: The internal CRM needs to track customers, prospects, partners,
  vendors, investors, advisors, RFQs, follow-ups, and source-linked brain
  context. The app already has `Company`, `Contact`, `Activity`, `Task`,
  `Inquiry`, `Job`, and memory models. Creating parallel `CrmCompany` and
  `CrmContact` tables would split the inbox/RFQ/load source of truth.
- Decision: V1 reuses `Company` as the account object and `Contact` as the
  person object, adds nullable relationship metadata to existing records, and
  adds only one new generic `CrmOpportunity` model for non-load/RFQ
  relationship opportunities. Contacts remain company-scoped in V1.
- Rationale: This keeps the product on the coherent path of emails to RFQs to
  active loads while adding a founder/operator relationship layer around the
  same data. It avoids Salesforce-style duplication and keeps tenant scoping
  straightforward.
- Consequences: Standalone people without a company are not first-class yet.
  Future standalone-person work should be a deliberate migration, not a quick
  duplicate table. CRM agent actions stay internal/draft-only until persisted
  approval records exist.
- Revisit when: live GBrain retrieval and CRM-specific reviewed agent
  proposals are ready for production use.

### 2026-07-01 - RFQ Brain Context V1 is read-only and draft-only

- Status: accepted
- Owner: engineering
- Context: The RFQ detail page now surfaces domestic trucking rate context and
  future GBrain/web-intelligence slots next to real RFQ data. Without explicit
  boundaries, operators or future agents could mistake mock/manual rate context
  for a sent quote, approved customer price, live provider rate, or booked load.
- Decision: RFQ Brain Context V1 must remain read-only against operational
  truth and draft-only for customer wording. It may compute deterministic
  missing-field checks, mock benchmark options, manual-rate placeholders,
  source-tagged brain context, draft economics, next questions, and audit
  previews. It must not call live providers, read provider credentials, send
  customer/vendor messages, book/tender freight, persist approval state, or
  override product RFQ/job truth.
- Rationale: This gives operators useful pricing/risk context without creating
  fake authority or hidden side effects.
- Consequences: Future live integrations must extend the provider boundary,
  persist office-scoped audit/approval records, and keep customer-facing actions
  behind explicit human approval.
- Revisit when: the approval queue, persisted rate audit model, and provider
  sandbox credentials are ready for an operator-reviewed pilot.

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

### 2026-07-03 - /dashboard/crm is the only CRM surface

- Status: accepted
- Owner: engineering
- Context: The Internal CRM V1 shipped alongside the legacy
  `/dashboard/customers` workspace and `/dashboard/pipeline` kanban, giving two
  divergent UIs over the same `Company` rows and three unsynced lifecycle
  fields (`Company.status`, `Company.crmStage`, `CrmOpportunity.stage`).
- Decision: Delete the legacy customers and pipeline UI code, repoint every
  link to `/dashboard/crm`, add temporary redirects, and treat `crmStage` as
  the canonical company lifecycle. Legacy DB columns and data stay untouched.
  Documents, owner management, and the inbox-approval toggle were ported into
  the CRM company/person pages; quotes UI, saved views, bulk status, and the
  class1/class2 taxonomy editors were dropped.
- Rationale: Two account surfaces drift immediately and corrupt trust in both.
  The founder decided the old CRM code and even its data are expendable; the
  future surface is the Relationship OS.
- Consequences: `CustomerStatus` remains in the schema for old rows and the
  companies CSV export but has no editing surface. New CRM writes still set
  `status: "UNTOUCHED"` for compatibility.
- Revisit when: reports/search are modernized to read `crmStage`, or the
  `status` column is formally dropped.

### 2026-07-03 - Emails resolve to CRM touches automatically

- Status: accepted
- Owner: engineering
- Context: `lastTouchAt` was only written by manual CRM notes, so the stale
  relationships panel flagged accounts the office emails daily, and email
  history never appeared in CRM timelines.
- Decision: Every synced inbound/outbound Gmail message is resolved to a CRM
  company/contact (contact email match, then inquiry link, then job link, then
  company domain; freemail domains excluded), logged as an EMAIL `Activity`
  with `sourceRefs`/`provenance`, cached on `EmailThread.companyId/contactId`,
  and bumps `Company.lastTouchAt`/`Contact.lastTouchAt` forward-only.
  `Inquiry.companyId` is adopted only on strong (contact-email) matches.
  A batched backfill script (`npm run backfill:crm-email`) covers history.
- Rationale: The Relationship OS's core promise (staleness, next actions)
  is only trustworthy if touches reflect reality, not manual note discipline.
- Consequences: Additive migration `20260703010000_email_crm_touch` must be
  applied before deploying this code. Touch logging is wrapped so Gmail
  sync/send never fail because of CRM writes.
- Revisit when: WhatsApp or meeting sources should write touches, or domain
  matching needs a review queue for false positives.

### 2026-07-03 - CRM serves two explicit layers: office book and founder network

- Status: accepted
- Owner: engineering
- Context: Docs conflicted on whether the CRM is a sales sub-module or a
  founder relationship OS. The founder wants both: the AI-native freight
  office's customer book and the startup's investor/advisor/partner network.
- Decision: Keep one `Company` table and derive a layer from `crmCategory`
  (customer/prospect/carrier/broker/customs_broker/freight_backend = office
  book; partner/vendor/investor/advisor/software_provider/other = network).
  Companies, people, and opportunities views get layer chips; the command
  center links both views.
- Rationale: One data spine, two lenses. Splitting tables would fork every
  timeline/task/opportunity feature for no benefit at this scale.
- Consequences: A relationship that is both vendor and customer still needs a
  category call; `crmTags` can carry the nuance until categories become
  multi-valued.
- Revisit when: either layer needs different fields, permissions, or agents.

### 2026-07-03 - CRM agent suggestions persist dismissals as AgentProposal rows

- Status: accepted
- Owner: engineering
- Context: The command center's heuristic agent suggestions had no accept or
  dismiss loop and no audit trail, while the rest of the app already audits
  agent actions through `AgentProposal`.
- Decision: Suggestions stay derived-on-read, but dismissing one writes an
  `AgentProposal` row (kind `CRM_SUGGESTION`, status `DISCARDED`) that the
  command center filters against for 30 days. RFQ-created opportunities now
  populate `sourceRefs` (`rfq:` and `email_thread:` refs) so Brain Context
  panels render linked sources.
- Rationale: Reuses the existing approval/audit primitive instead of a
  parallel store, without write-on-read bloat from persisting every render.
- Consequences: Full agent-generated proposals (create/apply CRM mutations via
  the dispatcher) remain the documented next slice.
- Revisit when: an agent starts proposing CRM mutations rather than
  navigational suggestions.

### 2026-07-04 - Sign-in is email-code only, allowlisted to the founders

- Status: accepted
- Owner: engineering
- Context: The app is an internal tool for the two founders, but login was
  open email+password for any provisioned user (demo offices, pentest
  sandbox), and there was no Google sign-in.
- Decision: Sign-in sends a 6-digit single-use code (10 min TTL, 5 verify
  attempts, 3 requests/15 min) to the entered email via the office's
  connected Gmail, and every sign-in path (code, password fallback, signup
  helper) rejects emails outside the allowlist — default
  mert@usederya.com + oguzhan@usederya.com, overridable via
  LOGIN_ALLOWED_EMAILS. A password fallback stays behind a collapsed
  disclosure as break-glass for Gmail-send outages, allowlist-gated the same
  way. Codes are HMAC-hashed with AUTH_SECRET in a new LoginCode table
  (additive migration 20260704000100_login_email_codes) and never create
  inbox threads or CRM touches.
- Rationale: Internal-only by construction beats internal-only by policy;
  emailed codes remove password management for a two-person team.
- Consequences: Demo-office users, the sinan office, and the pentest sandbox
  account can no longer sign in anywhere. Google SSO remains unimplemented;
  Gmail OAuth stays mailbox-connection-only.
- Revisit when: the team grows past the allowlist, real SSO is wanted, or
  the pentest sandbox needs login again (add it via LOGIN_ALLOWED_EMAILS —
  note its .invalid domain cannot receive codes, so it would need the
  password fallback).

### 2026-07-16 - Carrier bench is a first-class operational entity

- Status: accepted
- Owner: engineering
- Context: The CA tech-freight niche (high-value, security-sensitive loads
  for hardware companies) is the US wedge, and its core moat asset is a
  hand-vetted carrier bench. Carriers were previously only representable as
  `Forwarder` rows (intl supplier email directory) or CRM Companies —
  neither carries MC/DOT, insurance limits, equipment capability, or fraud
  checks.
- Decision: New `Carrier` + `CarrierChecklistItem` models
  (migration `20260716000100_carrier_bench`) hold the vetted bench:
  deceptive-pickup defenses (verified callback phone, expected email domain,
  factoring, authority age), insurance limits/expiries with `nextReviewAt`,
  capability flags, and reserved scorecard columns. `vettingStatus` can only
  reach `approved` through the deterministic `carrierVettingGate()` over the
  checklist (`src/lib/carrier-vetting.ts`); the COI check requires
  producer-direct verification, never a carrier-supplied attachment.
  Carriers are separate from `Forwarder` and from CRM Companies (optional
  `companyId` link, never auto-created). UI at `/dashboard/carriers`.
- Rationale: In a deceptive-pickup fraud wave, the vetting process is the
  product; encoding it as data + a gate makes it consistent and auditable.
- Consequences: Scorecards are manual columns until the flywheel computes
  them from load history. FMCSA/RMIS API verification stays manual-with-
  evidence-URL in V1.
- Revisit when: bid volume justifies Highway/RMIS-style API vetting, or
  carriers need portal access.

### 2026-07-16 - Truckload quotes, bids, and outcomes persist (the flywheel)

- Status: accepted
- Owner: engineering
- Context: The 2026-06-30 "draft-only mock/manual pricing" decision and the
  2026-07-01 "RFQ Brain Context is read-only" no-persistence clause predate
  the niche strategy, whose data moat requires every quote, buy rate, and
  win/loss to accrue.
- Decision: New `CarrierBid` (buy side, per-load $) and `TruckloadQuote`
  (sell side + outcome, normalized lane states, economics, quote-speed
  stamps) persist office-scoped (migration `20260716000300_truckload_quotes`).
  RFQ status changes settle outcomes (BOOKED=>WON, MISSED=>LOST) as
  best-effort hooks that never block sheet edits. Buy rates also accrue
  `LaneRate` history under domestic mode strings (FTL/LTL/PARTIAL/DRAYAGE),
  deliberately distinct from intl `ROAD` so intl lane matching never
  cross-contaminates. `CarrierQuote` stays ocean-shaped for the intl stack;
  the dormant `Quote` model stays untouched. This partially supersedes the
  two decisions above: persistence exists now, but live rate providers,
  booking/tender, and customer sends remain out — those still require the
  env-gated provider adapter + `DomesticRateAudit` slice.
- Rationale: A niche this narrow makes small data dense — 6-12 months of
  outcomes on CA tech corridors out-prices anyone without the book.
- Consequences: Quote rows are versions (one per Record press); outcome
  reasons are operator-set on lost quotes. Reports/lane-index aggregation is
  a later slice.
- Revisit when: DAT RateView (or equivalent) credentials land — add the
  provider adapter behind `DomesticRateProvider` with audit persistence.

### 2026-07-16 - Security tiers + SOP checklists gate high-value tech loads

- Status: accepted
- Owner: engineering
- Context: CA is the national cargo-theft epicenter and electronics the top
  target; the niche sells security as the wedge. Loads had no notion of
  declared value, security handling, or first-class truck equipment.
- Decision: `Inquiry`+`Job` carry declaredValue(+currency), securityTier,
  commodityCategory (tech taxonomy incl. UN3480/3481 batteries),
  trackingType, equipmentType, teamDriversRequired (migration
  `20260716000200_high_value_security_fields`). `deriveSecurityTier()`
  (value ladder x category floor, deterministic) writes a visible,
  overridable suggestion — operator choice always wins. Tiered loads seed
  `LoadSecurityCheck` rows from `securityChecklistTemplate(tier)`
  (anti-deceptive-pickup playbook; standard tier seeds nothing). The
  domestic pricing engine prefers first-class equipment over
  containerType/parsedData guesses and returns `needs_human_review` for
  high_value/critical tiers — they never auto-rate. Prior-load carry
  includes equipment/tier but never declaredValue (same principle as target
  price).
- Rationale: SOP-as-checklist makes small-team execution consistent and is
  the artifact a customer-facing security one-pager renders from later.
- Consequences: The portal rendering, rate-con clauses, and COI-per-load
  artifacts are Phase 2. Checklist rows are never auto-deleted on tier
  downgrade. Completed checks stay part of the record.
- Revisit when: the portal one-pager ships or an insurer requires a
  different checklist shape.

### 2026-07-21 - Intel is an isolated decision layer with typed provenance

- Status: accepted
- Owner: engineering
- Context: Shipment pre-flight and public market data previously lived in
  generic library and component paths, while the company-brain market-signal
  ingestion stack already owned a different persistence and retrieval job.
  Mixing them would make source attribution, extraction, and tenant behavior
  harder to audit.
- Decision: Canonical decision logic, parsers, fetchers, source definitions,
  and public-data UI live under `src/lib/intel/` and
  `src/app/dashboard/intel/`. Outside code uses the client-safe
  `@/lib/intel` entrypoint or the build-enforced server-only
  `@/lib/intel/server` entrypoint. Old library and component paths are
  one-way compatibility shims. `/dashboard/intelligence` and
  `src/lib/market-intelligence/` remain a separate company-brain ingestion
  surface.
- Rationale: Intel answers need deterministic rules and an exact source set,
  while company-brain ingestion needs office-scoped durable memory and review
  workflows. A narrow typed boundary lets either system evolve or be extracted
  without silently importing the other's persistence model.
- Consequences: Live facts carry a data date plus cache-stable fetch time.
  Human-reviewed authority pages carry a separate review time and are never
  labeled as cached data. Citation URLs must use a registered HTTPS host and
  must not contain credentials or secret parameters. Reports persist the exact
  source snapshot and a plain-text source footer. The engine rejects any new
  finding without a registered source. Existing calendar and equipment checks
  remain behaviorally present, but their copy distinguishes public evidence
  from conservative Intel policy and links to claim-specific CargoNet, FBI,
  manufacturer, carrier, or National Weather Service material.
- Revisit when: Phase B adds `AnswerDocument`, the intent router, and the
  standalone customs, carrier, and lane resolvers.

### 2026-07-22 - Market research renders as a cited report, not a shipment check

- Status: accepted
- Owner: engineering
- Context: A broad hardware-import question was being parsed as if it described
  one shipment. That produced an irrelevant missing-field checklist and mixed
  all-mode gateway value, company-level manifest examples, and requested
  historical coverage into one weak answer.
- Decision: Research questions render from a serializable `AnswerDocument` and
  a fixed report hierarchy. The primary `/dashboard/intel` report keeps
  California destination volume separate from West Coast customs gateways,
  vessel separate from air, requested periods separate from loaded periods,
  and official aggregate data separate from manually observed company records.
  Shipment pre-flight remains available as a secondary workflow. Partial
  Census partitions are labeled as partial sums, failures are never treated as
  zero, and provider references never imply a live connection.
- Rationale: The operator needs to see the answer, its coverage, and its
  evidence state before seeing tools. This structure is easier to audit and
  prevents a polished UI from overstating incomplete data.
- Consequences: The v1 hardware basket is a declared 46-code proxy, not a claim
  to represent all startup hardware. The Census reader is bounded to two
  batches of five concurrent requests under the 60-second route limit.
  Company examples remain unqualified manual observations. Historical
  snapshots and licensed bill-of-lading coverage are explicit future unlocks.
- Revisit when: the general intent router can select report templates from any
  operator question, or a licensed provider sample passes identity, history,
  port, and commodity coverage checks.

### 2026-07-22 - Hardware import reporting uses keyless Census file snapshots

- Status: accepted
- Owner: engineering
- Context: Runtime Census API calls made a fixed five-year report depend on a
  secret key, request limits, and dozens of cold network partitions. Census
  also publishes keyless State Imports HS6 and Port Imports HS6 files that can
  be parsed once, validated, reviewed, and cited by exact file.
- Decision: The hardware-import report reads a versioned, checked-in compact
  JSON snapshot generated by
  `scripts/build-census-public-hardware-snapshot.ts`. The generator uses
  December year-to-date files for the five complete years and the latest
  available year-to-date file for the current year. It keeps California State
  Imports HS6, whose geography is state of ultimate destination, separate from
  Port Imports HS6 records for ports of unlading in West Coast districts 25,
  27, 28, 29, and 30. It preserves exact file provenance and does not write to
  tenant, CRM, job, RFQ, or company-brain records.
- Rationale: A reviewed static artifact makes the report deterministic,
  keyless at runtime, fast to render, and auditable down to each official
  source file. The two Census products answer different questions and must not
  be collapsed into a fake California market total.
- Consequences: Snapshot generation must validate fixed-width layouts,
  non-negative metrics, Schedule C country names, exact HS coverage, dimension
  reconciliation, source checksums, and secret-free source URLs before
  atomically replacing the artifact. The Schedule C file retains its own
  fetch time, revision, and SHA-256. Raw ZIPs stay in a temporary cache and are
  not committed. A warm cache preserves the original fetch time and is trusted
  only when content length, local SHA-256, and every upstream validator Census
  provides still match. The 2021 basket has 43
  applicable codes; the HS 2022 additions 8485, 8806, and 8807 bring later
  periods to 46. Full-basket 2021-to-2022 growth is not a like-for-like metric
  without a researched predecessor-code backcast. Official aggregates cannot
  establish company identity, startup status, shipment count, or lead quality.
  This supersedes only the API-partition and future-history clauses in the
  prior 2026-07-22 report decision; its fixed report hierarchy, evidence
  separation, and licensed-provider boundaries remain accepted.
- Revisit when: Census changes either file layout, Derya automates a reviewed
  monthly refresh, or a licensed company-level provider passes identity,
  history, port, commodity, and confidentiality coverage checks.

### 2026-07-23 - Corridor signals require joint Port HS6 dimensions

- Status: accepted
- Owner: engineering
- Context: Separate current totals by hardware category, country of origin,
  and West Coast gateway district could not establish which product from which
  origin used which gateway. Presenting those separate marginals as lane
  intelligence would create a polished but unsupported join.
- Decision: Census hardware snapshot schema v3 stores one current-period joint
  slice from the official Port Imports HS6 rows, keyed by startup-hardware
  category, country of origin, and port-of-unlading district. Only
  positive-vessel-value segments are retained. Vessel value, vessel weight,
  containerized vessel value, and containerized vessel weight must reconcile
  exactly to the current West Coast scope. The product calls these corridor
  signals, never port-to-port lanes.
- Rationale: Every joint dimension comes from the same official source row, so
  the result can prioritize research without a probabilistic or cross-dataset
  join. Keeping the slice current-only limits artifact growth and avoids
  inventing historical momentum that the report does not yet compare on a
  like-for-like YTD basis.
- Consequences: The May 2026 artifact contains 681 positive-value segments and
  stays below the 1.3 MB artifact budget. A segment can support an
  origin-product-gateway research queue. It cannot identify the foreign
  loading port, carrier, service, buyer, supplier, transit time, delay, freight
  rate, optimized route, or qualified lead. California destination totals
  remain separate and cannot be joined to these gateway segments.
- Revisit when: a licensed bill-of-lading sample supplies validated foreign
  loading ports, importer identity, carrier and service fields, timing, and
  commercial usage rights.

### 2026-07-23 - Origin watches are research briefs, not generic lane scores

- Status: accepted
- Owner: engineering
- Context: The all-origin hardware report could rank current aggregate
  segments, but it buried the requested China decision and implied that one
  generic corridor ranking could guide every hardware category. Power
  equipment, factory machinery, compute equipment, medical equipment, and
  drones show materially different observed gateway patterns.
- Decision: Origin-focused intelligence uses a deterministic corridor-watch
  contract built from the validated Census snapshot. The China watch is the
  first implementation. It keeps California ultimate destination separate from
  West Coast port-of-unlading districts, keeps current YTD separate from
  complete years, and produces category-specific research posture. A routing
  brief remains `research_only` until all required shipment, port, service,
  schedule, reliability, rate, handling, and company evidence is present.
- Rationale: An operator needs a bounded research queue and exact evidence
  gaps, not a polished but unsupported lane score. Category-specific
  concentration can prioritize which gateway alternatives to investigate
  without pretending that aggregate value proves feasibility, price, risk, or
  demand.
- Consequences: The product may say that the highest-value observed district in
  the current snapshot is a starting point for China hardware research. It
  derives that district on refresh and may not call it a recommended route,
  infer a foreign port, join it to California destination volume, score a lead,
  or explain a historical change causally. Company-level and port-pair
  enrichment must come from licensed shipment evidence, while schedules,
  services, rates, and transit reliability remain separate live inputs. The
  all-origin report stays available as supporting context and does not lead the
  workflow.
- Revisit when: a licensed bill-of-lading sample passes the provider gate, or
  live schedule and rate adapters can populate a shipment-specific route
  comparison with evidence and operator approval.

### 2026-07-23 - Long-run China history uses a fixed core43 basket

- Status: accepted
- Owner: engineering
- Context: The 46-code hardware proxy includes HS 8485, 8806, and 8807, which
  entered with the 2022 HS revision. Extending that exact basket before 2022
  would create a false like-for-like trend. Expanding the complete all-country
  snapshot to 2010 would also exceed the artifact budget and introduce
  historical Schedule C code problems unrelated to the China question.
- Decision: Preserve the full 46-code five-year and current-YTD snapshot for
  current market and category detail. Add one compact China-only vessel slice
  that applies the fixed 43 codes available across 2010-2026. Store every
  complete year from 2010 through 2025 and the current YTD period, with
  separate California ultimate-destination and West Coast port-of-unlading
  denominators, China marginals, category marginals, geography marginals,
  official files, and checksums.
- Rationale: A fixed basket supports a defensible long-run composition view
  without backcasting classifications, inflating the artifact, or pretending
  current categories existed under the same code structure in earlier years.
- Consequences: The report labels this series `fixed_core43`, displays nominal
  customs value and China share, and keeps the 46-code current YTD view
  separate. It does not adjust for inflation, infer causality, or apply the
  China-only slice to other origin watches. Snapshot generation fails if any
  core code, year, source, reconciliation, ordering rule, or byte limit fails.
  A December `asOfMonth` also fails explicitly until the current-period
  contract can represent a complete December file without recasting it as YTD.
- Revisit when: Derya needs an all-country long-run comparison and has a
  researched concordance for historical HS and Schedule C revisions.

### 2026-07-23 - Customs intelligence is a dated evidence workflow

- Status: accepted
- Owner: engineering
- Context: A list of customs links is not operational, but an aggregate Census
  category cannot support a duty, admissibility, or clearance conclusion.
  Current tariff actions, regulations, agency guidance, product triggers, and
  old CBP handbooks also use different date semantics and authority weight.
- Decision: Model China-to-U.S. customs work as eight deterministic gates with
  explicit missing inputs, quote effect, operator action, product triggers,
  and official authority references. Review sources in this order:
  controlling authority such as the HTS, statute, regulation, Federal Register
  notice, or enforceable order; applicable ruling or scope decision; current
  implementation guidance; then handbook context. Store rule as-of, source
  review, publication, effective start, effective end, document revision, and
  page modification, and exact boundary instants separately. Compute active,
  upcoming, expired, and historical state from the exact reviewed instant when
  a source publishes a timed cutoff; retain date-level evaluation when the
  authority provides only a date.
- Rationale: This makes the output usable for shipment evidence collection
  while preventing a recently modified webpage, an old handbook, or a
  four-digit research category from masquerading as current legal treatment.
- Consequences: The guide can block landed-cost or clearance promises and
  identify the next revalidation date. It cannot output an exact duty,
  compliance label, legal opinion, broker instruction, or clearance promise.
  UFLPA remains separate from Section 301. Product screens remain conditional
  on model-level facts and run across every hardware category so an aggregate
  category cannot suppress a feature-driven agency screen. Finished
  refrigerant-charged equipment remains separate from bulk refrigerant
  controls and its transport classification. Medical devices remain separate
  from radiation-emitting products, and regulatory branches for hazardous
  materials, vessel carriage, nuclear imports, and FIFRA devices remain
  explicit. A same-day USTR action can be added as an upcoming timed rule
  without rewriting historical Census observations or treating agency
  guidance as controlling law.
- Revisit when: Derya adds shipment-specific classification, ruling, broker,
  entry, or partner-government-agency evidence and can move an individual gate
  from research to reviewed execution.

### 2026-07-23 - Primary corridor evidence stays linear; supporting analysis is an appendix

- Status: accepted
- Owner: design and engineering
- Context: The China corridor report originally resumed numbered sections
  after a collapsed all-origin analysis, so the visible primary report appeared
  to skip a section. Its six-column annual evidence table also forced
  horizontal scanning on narrow screens and hid the geography of each source
  behind a bare source number.
- Decision: Keep the primary China report in sections 01 through 06. Label the
  supporting all-origin report Appendix A with A1 through A6. Group each
  historical year into three columns: year, West Coast value/share/source, and
  California value/share/source. Stack those geography cells on narrow
  screens and label their evidence links with `WC` or `CA`.
- Rationale: The visible sequence should match the operator's decision path.
  Exact values and sources must remain readable without horizontal panning or
  guessing which geography a citation supports.
- Consequences: The same underlying evidence and supporting report remain
  available. This changes report hierarchy and responsive presentation only;
  it does not alter data, source identity, or customs conclusions.
- Revisit when: the report adds another primary decision stage or the annual
  evidence needs a dedicated comparison view.

### 2026-07-24 - China shipment review uses a separate read-only evidence contract

- Status: accepted
- Owner: engineering
- Context: The existing `LoadIdea` contract and load pre-flight are designed
  for U.S. domestic trucking and can create a road RFQ. Reusing that shape for
  a China ocean import would collapse unknown customs facts into booleans,
  confuse trucking readiness with clearance, and risk writing an incorrect
  operational record.
- Decision: China to U.S. ocean shipment review uses a separate versioned
  input and assessment contract. V1 is authenticated but read-only, performs
  no database or provider write, preserves tri-state unknowns and field
  provenance, recomputes dated rules from the confirmed controlling customs
  event and exact timestamp, and accepts negative product screens only from
  operator-confirmed or document-backed facts. Non-ocean modes stay outside
  scope, and confirmed blockers may depend only on confirmed or documented
  facts.
- Rationale: A real shipment needs deterministic evidence gaps and source-local
  customs gates before it needs automation. Keeping the contract separate
  prevents domestic carrier logic, RFQ conversion, or AI extraction from
  pretending to establish origin, duty, admissibility, or clearance.
- Extraction boundary: a local fallback may read explicitly labeled facts
  when model extraction is absent or fails, but those values stay unconfirmed
  supplier statements and the fallback never infers a negative product screen.
- Consequences: Ready means structured for importer and broker review only.
  AI values require individual confirmation. The system may identify possible
  tariff timing, agency triggers, ISF timing gaps, and evidence requests, but
  it cannot calculate duty or issue a clearance conclusion. A future saved
  review must add explicit office scoping, audit history, and human approval
  rather than silently extending this nonpersistent V1.
- Revisit when: operators have tested several real loads and can define which
  confirmed fields, documents, broker responses, and review outcomes should be
  stored as office-scoped operational evidence.

### 2026-07-27 - Preserve legal time precision and authority context

- Status: accepted
- Owner: engineering
- Context: Some customs actions publish exact Eastern cutoff timestamps while
  other rules publish only an effective date. The previous freshness check
  considered only exact timestamps, so a date-only rule could take effect
  without invalidating an older snapshot. The load report also reduced
  authority records to links, hiding whether a citation was current,
  time-limited, upcoming, or historical.
- Decision: Store and display an exact instant only when the authority
  publishes one. Keep date-only boundaries as dates and include both precision
  levels in rules freshness. Keep each source's review timestamp independent
  from the overall guide snapshot. Carry every referenced authority's status,
  type, effective window, caveat, source, and report claim context into the
  read-only shipment assessment.
- Rationale: Invented timestamps create false cutoff certainty, while a bare
  link list makes historical handbooks look equivalent to current regulations.
  Precision and authority rank must survive from research data through the
  operator report.
- Consequences: A crossed date-only boundary can force revalidation. The UI
  labels date precision directly, distinguishes current, time-limited,
  upcoming, and historical sources, and names where each authority is used.
  The additional context does not calculate duty or establish shipment
  compliance.
- Revisit when: a provider supplies versioned filing-time HTS or agency
  instructions with trustworthy publication and effective timestamps.

### 2026-07-27 - China Intel extraction uses GPT-5.6 Structured Outputs

- Status: accepted
- Owner: engineering
- Context: The read-only China load review previously used a free-form
  Anthropic response followed by JSON substring parsing. The production
  environment already provides `OPENAI_API_KEY`, and shipment extraction needs
  a stricter output boundary than prompt-only JSON.
- Decision: Use the OpenAI Responses API with the `gpt-5.6` alias, medium
  reasoning, `store: false`, a 45-second timeout, one SDK retry, and Zod-backed
  Structured Outputs for the China hardware load extractor. Keep the local
  labeled parser when the key is absent or the model request fails. Continue
  to mark every model-derived fact as `ai_extracted` until an operator confirms
  it.
- Rationale: Structured Outputs removes the brittle JSON substring parser and
  constrains model output to the versioned shipment packet. GPT-5.6 improves
  extraction quality while deterministic code remains responsible for
  customs gates, temporal rules, missing evidence, and authority citations.
- Consequences: `OPENAI_API_KEY` now powers China Intel extraction. Existing
  Anthropic CRM paths remain unchanged. The model still cannot calculate duty,
  establish classification or origin, decide admissibility, promise clearance,
  persist the review, or trigger an operational write.
- Revisit when: representative real-load evaluations show that another
  GPT-5.6 tier or reasoning level achieves the same extraction quality at
  materially lower latency or cost.

### 2026-07-27 - GPT-5.6 is the single application reasoning model

- Status: accepted
- Owner: engineering
- Context: The application split reasoning work across direct Anthropic calls
  and a separate OpenAI China-load extractor. That duplicated provider
  configuration, request behavior, failure handling, and tool-call history.
  Production already supplies `OPENAI_API_KEY`.
- Decision: Route every active text reasoning, parsing, classification,
  drafting, document analysis, and agent function-tool path through the OpenAI
  Responses API with the `gpt-5.6` alias. Use one shared adapter with
  `store: false`, a 45-second timeout, one SDK retry, low reasoning for bounded
  single-turn work, and medium reasoning for function-tool loops. Remove the
  Anthropic SDK and `ANTHROPIC_API_KEY` runtime contract. Keep `whisper-1` only
  for audio transcription because speech-to-text is a specialized endpoint,
  not a GPT-5.6 reasoning call.
- Rationale: A single runtime contract makes model behavior, deployment,
  observability, and regression testing understandable. Keeping tool history
  conversion in one adapter preserves reasoning items, function call IDs, and
  office-scoped tool dispatch without rewriting domain actions.
- Consequences: `OPENAI_API_KEY` is now required for all AI-assisted product
  behavior. Deterministic fallbacks and approval boundaries remain in place.
  The China load extractor retains its stricter Zod Structured Outputs path.
  A static runtime test rejects Anthropic imports, Anthropic environment
  references, Claude model names, and unexpected model literals under `src`.
  This decision supersedes the provider split recorded in the earlier China
  extraction entry.
- Revisit when: production evaluations show a task-specific model improves
  measurable accuracy, latency, or cost enough to justify a documented
  exception.
