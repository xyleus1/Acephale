# Supply OS Architecture

## The short answer

Supply OS should use PostgreSQL as its operational source of truth. Do not add
Neo4j, Pinecone, or another database just because the domain can be drawn as a
graph. Product structures, supplier relationships, routes, decisions, and
execution tasks are relational records with strong tenant, version, and
approval constraints. PostgreSQL already handles them well.

Use a typed DSL above that data. The DSL defines which capability may read,
analyze, decide, or execute. It is a control contract, not an agent prompt.
Capabilities can use deterministic code, a connector, public research, or an
LLM internally, but they must return a typed result with evidence and must obey
the same approval policy.

Vector retrieval is optional enrichment for unstructured documents. It must
never become the source of truth for inventory, BOM quantities, quotes,
compliance status, approvals, or execution state.

## Storage decisions

| Data | Primary structure | Why |
| --- | --- | --- |
| Office, workspace, members | PostgreSQL relations | Authorization and tenancy require hard constraints. |
| ERP imports | Immutable PostgreSQL snapshots | Operators need reproducible quantities and source hashes. |
| Products and parts | PostgreSQL item records | SKU, MPN, GTIN, manufacturer, and aliases need deterministic identity. |
| BOM and subassemblies | PostgreSQL adjacency lists | Recursive SQL can explode assemblies without a second graph database. |
| Inventory and demand | PostgreSQL fact tables | Quantities, units, locations, and dates need exact arithmetic. |
| Supplier terms, equivalence rules, FCC profiles | PostgreSQL records with nullable commercial fields and explicit approval or evidence state | Planning must distinguish missing facts from zero and approved substitutions from guesses. |
| Supplier and shipper candidates | PostgreSQL records plus attributable evidence | A candidate must remain separate from an approved or awarded provider. |
| Connector-specific payloads | JSONB beside normalized fields | Preserve raw detail without weakening the canonical query model. |
| Decisions and scenarios | PostgreSQL records with immutable hashes | A human must approve the exact proposal they reviewed. |
| Planning results | Append-only PostgreSQL records with snapshot, input, engine, and output hashes | Scenario ordering must be reproducible and older results must survive as stale history. |
| Execution history | Append-only PostgreSQL events | Every attempted external action needs an auditable sequence. |
| Product and location media | PostgreSQL metadata, object storage or licensed HTTPS asset | The database stores attribution and identity, not large binaries. |
| Long documents and notes | Existing knowledge objects and chunks | Provenance and deterministic retrieval already exist in the company brain. |
| Semantic similarity | Optional pgvector column later | Add only when measured retrieval failures justify it. |

### Why no graph database now

The important graph is the BOM. `SupplyBomLine` is an adjacency edge from a
parent item to a component item. Recursive PostgreSQL queries can traverse it,
find cycles, calculate required quantities, and identify alternative groups.
Routes can use the same pattern when live route edges arrive.

A separate graph database would introduce a second authorization boundary, a
second consistency model, a sync process, and harder backups. Add one only if
measured traversal workloads exceed PostgreSQL after indexes, recursive CTEs,
and materialized projections are exhausted.

### Why no vector database now

Inventory balance, a supplier quote, an FCC rule, and an approval are not
similarity-search facts. They are exact records. The current company brain
already supports source-linked deterministic and full-text retrieval.

If semantic recall later proves weak across product manuals, emails, quotes,
and compliance documents, add embeddings to the existing chunk model with
pgvector. Keep the original chunk, source reference, office ID, document
version, and extraction timestamp. A vector match may nominate evidence. It
cannot certify a fact or authorize an action.

## What shared office persistence means

Shared office persistence means data is saved on the server under an
`officeId`, not in one employee's browser.

- An office owns Supply OS workspaces.
- A workspace may be visible office-wide to authorized managers, or limited
  to explicit workspace members.
- Membership roles are owner, editor, member, or viewer.
- Every import, snapshot, item, location, decision, approval, capability run,
  task, and event carries the same office and workspace scope.
- Database triggers reject a row whose referenced snapshot, decision, task,
  evidence, user, or workspace belongs to another office.
- Published ERP snapshots are immutable. A later import creates a new version.
- Evidence and execution events are append-only.
- An approval is bound to the hash of the exact decision proposal or task
  input. Changing the proposal requires a new approval.

This is different from browser persistence. Browser persistence is useful for
presentation preferences and temporary drafts. It is not shared, durable,
auditable, or sufficient for operational truth.

### Current implementation boundary

The shared server foundation is implemented for:

- workspaces and workspace membership;
- mapped CSV imports for locations, items, BOM lines, inventory, demand,
  purchase orders, supplier terms, and compliance records;
- immutable published snapshots;
- product identity aliases and attributable media metadata;
- evidence, capability runs, decisions, scenarios, comparisons, approvals,
  execution tasks, and append-only events.
- canonical supplier terms, approved equivalence rules, FCC evidence profiles,
  and immutable deterministic planning results.

The normalized CSV contract is schema version 2. Required operational rows are
stored in typed snapshot tables. The optional purchase-order, supplier-term,
and compliance datasets are stored inside immutable snapshot metadata until
their execution workflows justify dedicated relational tables. Blank numeric
and date fields stay `null`; they are not converted to zero or epoch dates.
Inventory quantity and BOM scrap columns are nullable for the same reason.

The product twin reads the newest published snapshot and uses an explicitly
labeled robotics fixture only when canonical product data is incomplete. The
legacy map and supplier-search draft still contain browser-local compatibility
state. They must not be described as shared office records until their data is
migrated to the canonical models.

## Deterministic planning brain

`src/lib/supply-os/planning-engine.ts` is a pure calculation boundary. It reads
one published snapshot projection plus canonical supplier terms, equivalence
rules, and FCC evidence profiles. It has no UI, network, LLM, or database side
effects.

The engine:

- validates units and rejects every BOM cycle before calculation;
- explodes required, non-optional BOM edges to arbitrary practical depth;
- multiplies quantity and scrap at each edge and aggregates shared leaf demand;
- allocates facility inventory against demand in date, priority, and key order;
- counts inbound or supplier capacity by a demand date only when quantity and
  conservative receipt timing are known;
- leaves missing price, freight, duty, lead time, inventory, and capacity as
  null plus an explicit unknown record;
- supports only current plan, alternate supplier, assembled subassembly, and
  approved equivalence scenarios;
- emits FCC state only as `evidence_complete`, `review_required`, or `blocked`;
- orders recommendations by blockers, required-date units, complete landed
  cost, lead time, supplier concentration, and stable scenario key.

`src/lib/supply-os/planning-persistence.ts` is the trust boundary. The client
may name a snapshot, product, scenario family, and canonical term or rule key.
It may not submit rank, cost, feasibility, or lead time. The server loads the
published records, normalizes and hashes them, runs the engine, and appends one
`SupplyPlanningResult`. Listing results compares their snapshot ID with the
newest published version and returns `isStale` without rewriting history.

This engine does not replace the approval ledger. A planning result is an
auditable recommendation input. External ordering, booking, filing, messaging,
or spend still requires the existing decision and execution approval path.

## The Supply DSL

`supply-os/v1` is a deliberately small line-based language. It makes a plan
reviewable, reproducible, and testable before any capability runs.

```text
supply-os/v1
context office=office-a workspace=robot-program actor=planner-7

evidence erp type=erp_export trust=trusted source="ERP export" observedAt=2026-08-08T12:00:00Z
evidence product type=product_page trust=trusted source="Reviewed product page" observedAt=2026-08-08T12:02:00Z
evidence rules type=compliance_source trust=trusted source="FCC rule review" observedAt=2026-08-08T12:10:00Z

step snapshot uses=erp.ingest evidence=$evidence.erp dataset=inventory
step capture uses=product.scrape evidence=$evidence.product targetUrl=https://robot.example/amr-240
step map uses=product.map after=snapshot,capture snapshot=$snapshot.snapshot scrapedProduct=$capture.productRecord productKey=AMR-240
step compliance uses=compliance.assess after=map productMap=$map.productMap destinationCountry=US evidence=$evidence.rules
```

The compiler rejects:

- unknown capabilities;
- missing or cyclic dependencies;
- references to outputs a capability does not produce;
- missing evidence types;
- unauthorized approval roles;
- execution without human approval;
- execution that inherits any untrusted evidence.

## Capability registry

The registry is the skills layer. A capability name stays stable while its
implementation can improve.

| Capability | Job | Risk |
| --- | --- | --- |
| `erp.ingest` | Normalize ERP exports into a snapshot. | Read |
| `product.scrape` | Extract cited facts from allow-listed product pages. | Read |
| `product.map` | Resolve ERP items and product facts into a BOM identity graph. | Analysis |
| `supplier.find` | Build an attributable component supplier longlist. | Analysis |
| `supplier.assess` | Assess fit, capacity evidence, terms, provenance, and quote quality. | Analysis |
| `compliance.assess` | Assess classification, origin, FCC, and import constraints. | Analysis |
| `sourcing.compare` | Compare cost, supply, lead time, and compliance scenarios. | Decision |
| `shipper.find` | Find forwarder and carrier candidates for the selected lane. | Analysis |
| `logistics.plan` | Build transport, customs, and landed-cost plans. | Decision |
| `tracking.sync` | Normalize carrier events into the execution timeline. | Read |
| `action.execute` | Request a quote, place an order, book a shipment, or file an entry. | Execution |

Each registry entry declares:

- strict input and output schemas;
- required evidence types;
- read, analysis, decision, or execution risk;
- whether a human approval is mandatory;
- roles allowed to approve.

## Adapter rules

Capabilities should not be giant autonomous agents. Use small adapters with
clear boundaries.

### ERP adapters

- Start with validated CSV because it is universal and inspectable.
- Add customer-specific API adapters behind the same normalized contract.
- Store source hashes and idempotency keys.
- Publish only after validation passes.

### Product and supplier research

- Use an allow-list or exact operator-provided URL.
- Treat page content as untrusted input.
- Preserve the page URL, capture time, excerpt, content hash, and extraction
  version.
- Separate discovery from qualification and qualification from award.
- Resolve product identity in this order: exact ERP ID or SKU, manufacturer
  plus MPN, GTIN or approved alias, lexical candidates, then optional Postgres
  vector candidates. Lexical and vector results always require human review.
- Tie every supplier candidate to one component item. Public research may
  return only manufacturer or distributor candidates with provider-returned
  citations and explicit evidence freshness.
- An unsupported or stale candidate cannot become approved. Approval also
  checks the active office and workspace.
- Direct research fetches reject private addresses, cross-domain redirects,
  non-HTML responses, oversized bodies, login pages, and paywalls. Public
  search degrades to an empty cited result instead of inventing candidates.

### Shipper discovery and logistics

- Start with lane facts, cargo facts, required authority, and current quotes.
- Require a provider role: truck carrier, customs broker, freight forwarder,
  ocean carrier, air carrier, or 3PL. Do not use `shipper` as a vague business
  role in new contracts.
- Keep directories and service pages as candidate evidence only.
- Do not label capacity, price, schedule, or performance live without a dated
  provider response.
- Customs preparation does not replace a licensed broker or importer approval.

### Procurement-to-logistics handoff

- Supplier research stays inside Inventory & sourcing through request, visible
  source research, option comparison, selection, and a procurement brief.
- Each interactive research request is persisted before provider execution as
  an office-scoped `SupplyCapabilityRun`. Its hashed input and completed output
  let the sourcing queue restore results after navigation, refresh, or another
  authorized office browser opens the workspace.
- The queue displays the latest run per component plus saved custom requests.
  Older runs remain canonical for a later history surface.
- Continuing from comparison creates one non-executable planning
  `SupplyExecutionTask(taskType=PROCUREMENT_CASE)` per research run. Its input
  hash binds the task to immutable research; its result stores the current
  supplier selection, selection hash, and deterministic readiness gates.
- Each supplier-selection change appends a hashed `SupplyExecutionEvent`.
  Public candidate facts are re-derived from the persisted research output on
  the server. The client cannot promote modeled or unknown terms into sourced
  evidence.
- The mutable procurement case is not an approval target. Operators complete
  three server-validated gates in order: attributable supplier-source review,
  quote and delivery confirmation, and a named quality acceptance plan.
- Quote and delivery confirmation requires a persistent
  `SUPPLIER_QUOTE_CYCLE` child task. A revisioned request records quantity,
  unit, need-by, destination, response deadline, requirements, and notes. The
  request remains an internal draft until an operator records external release
  evidence with channel, date, URL, and note.
- A released quote cycle stays `RUNNING` while supplier responses are appended and
  closes only when the selected quote reaches full supplier order acknowledgment.
  Every response stores exact decimal price and MOQ, unit, delivery, validity,
  reference, evidence URL, operator, timestamp, and hash. The commercial gate
  accepts only a response loaded from that office-scoped task by its hash. It
  never accepts browser-authored commercial terms directly.
- Request revisions, release, response, and selection append hashed events.
  Release and response evidence stays `OPERATOR_RECORDED_EXTERNAL`. Recording
  this evidence does not claim that Derya sent the request or that a supplier
  connector exists. Supplier changes cancel the active quote cycle.
- After those gates complete, Supply OS creates a separate immutable
  `PROCUREMENT_APPROVAL` task. Its input contains the exact selected supplier,
  confirmed quote terms, evidence review, and quality plan. `SupplyApproval`
  binds the manager decision to that input hash. Changing any upstream scope
  cancels a pending approval and requires a new attempt. Expired commercial,
  delivery, quality-plan, or approval dates return the case to the relevant
  review gate instead of leaving an un-actionable pending request.
- Approval marks the sourcing scope ready for purchase preparation. The
  operator can then save a revisioned `PURCHASE_ORDER_DRAFT` child task with
  quantity, need-by, ship-to, Incoterm, payment terms, buyer reference, and
  notes. Supplier identity, price, currency, MOQ, unit of measure, quote
  reference, delivery date, and quote validity are derived from the immutable
  approved input. Exact decimal arithmetic produces the material subtotal.
- The draft is resumable from the sourcing queue and uses optimistic revisions.
  Identical retries are idempotent. Supplier or gate changes cancel the active
  draft, and stale approved dates return the case to the relevant review gate.
- A prepared draft may be copied into an immutable `PURCHASE_ORDER_ACTION` child
  task. That action input contains the full supplier, order, commercial,
  evidence, quality, and prior-approval scope plus the exact draft revision and
  result hash. Final admin approval binds to the action input hash, not to a
  mutable case projection or a generic plan reference.
- Editing a draft cancels its pending action approval. Rejection requires a new
  draft revision. Approval moves the action and draft to `READY`, which freezes
  the exact authorized scope. An upstream supplier or gate change cancels a
  `READY` action that has not been externally executed.
- An admin or manager may record an externally received supplier acknowledgment
  against the frozen action. Every entry is hashed and stores its channel,
  release date, acknowledgment date, supplier reference, accepted quantity,
  confirmed delivery date, evidence URL, actor, and timestamp. The release date
  cannot predate final authorization or exceed the approved quote validity.
- The first acknowledgment moves the action and draft to `RUNNING`. Partial
  acceptance accumulates against the exact authorized quantity. Full acceptance
  moves both records to `SUCCEEDED`. Identical retries are idempotent and an
  operator cannot accept more than the remaining quantity.
- Once supplier acknowledgment begins, the upstream supplier and order scope
  are immutable. A changed scope requires a new procurement case. This prevents
  external evidence from being silently attached to a different order.
- Purchase preparation and acknowledgment recording do not contact the
  supplier, create a canonical purchase order or PO number, commit spend, book
  freight, or open a logistics record.
- Interactive research uses the authenticated, office-rate-limited public web
  research engine. Official and public evidence URLs are returned with
  unqualified candidates; missing commercial values remain unknown.
- Procurement case, gate reviews, sourcing approval, purchase draft, final
  purchase action, supplier quote cycle, action approval, and hashed event
  history are office-scoped PostgreSQL records. Unsaved field edits remain
  browser state.
- After full supplier acknowledgment, a later Logistics integration will create
  a canonical approval-gated
  `SupplyAction`, prefill cargo, quantity, pickup, destination, need-by date,
  selected source, and evidence references, then open the Logistics panel by
  query state.
- Do not modify the Logistics panel or imply that a handoff was persisted until
  that canonical action contract is implemented.

### Execution

- Compile and persist the intended action first.
- Hash the complete action input.
- Request approval against that hash.
- Move a task to `READY` only after a matching approval exists.
- Let a separate connector worker perform the external call idempotently.
- Append the request, acknowledgement, failure, and result as events.
- Never let an LLM silently send, order, book, file, or spend.

## System flow

```text
ERP and documents
  -> immutable snapshot and evidence
  -> product and BOM mapping
  -> supplier, compliance, and shipper capabilities
  -> sourcing and logistics scenarios
  -> human-approved decision hash
  -> human-approved execution input hash
  -> connector worker
  -> append-only tracking and cost events
```

This keeps the intelligence flexible while the operational truth remains
boring, deterministic, and auditable. That is exactly what an industrial
supply-chain system needs.
