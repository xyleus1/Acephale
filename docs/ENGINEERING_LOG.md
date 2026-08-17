Warning: truncated output (original token count: 82138)
Total output lines: 5462

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

### 2026-08-11 - Make company creation canonical and evidence-backed

- Branch: `agent/guild-company-create`, targeting `main`.
- Task: Repair the Companies create path and make a newly added company a CRM customer with a linked Supply OS workspace and attributable public profile.
- Behavior: The form accepts name and website, validates the current database administrator, creates or reuses canonical office-scoped records, stores researched evidence, and loads the selected company's own profile.
- Safety: Tenant scope stays on every company, workspace, membership, evidence, and media operation. Research failure does not roll back the canonical customer record.
- Verification: company-create, company-navigation, company-research, product-copy, TypeScript, production build, whitespace, and changed-file U+2014 checks.
- Boundary: GUILD public positioning comes from its official website. Suppliers, BOM, inventory, demand, facilities, rates, customs treatment, and approvals remain unconfirmed until customer data is connected.
### 2026-08-17 - Add the dashboard to Bourne procurement boundary

- Branch: `feat/bourne-neon-dashboard-clean`, based on the locally cached
  `origin/main` commit `fdbf485`
- Commit: see git log
- Task: Add authenticated procurement creation, customer-scoped idempotency,
  read-only status and supplier polling, and an optional post-commit Bourne wake
  signal.
- Files changed: procurement API routes and server library, workflow dashboard,
  request and status contracts, restricted-role Neon provisioning SQL,
  database fixtures and tests, environment examples, and integration docs.
- Verification: procurement contract, TypeScript, product-copy policy,
  deployment-boundary contract, and production build passed with placeholder
  server-only configuration.
- Failed/skipped checks: Local PostgreSQL could not initialize because the host
  had exhausted its System V shared-memory IDs. The database-backed role and
  tenant suite remains required against provisioned test databases. Network
  resolution also prevented refreshing the GitHub remote beyond the locally
  cached `origin/main` commit. Full-repository lint remains red on inherited
  files; the task-scoped files have no lint findings. The packaged-server smoke
  test could not bind `127.0.0.1:3107` because this sandbox returned
  `listen EPERM` before startup.
- Caveats: No Derya Prisma migration was added. Production Neon was not
  provisioned, no deployment secrets were changed, no webhook was created, and
  Bourne remains unactivated by this change.
- Follow-up: Provision temporary Derya and workflow databases, run
  `npm run test:procurement-workflow-db`, then apply the reviewed Neon SQL and
  activate Bourne only after explicit production approval.

### 2026-08-17 - Route GUILD2 through the reviewed procurement boundary

- Branch: `feat/bourne-neon-dashboard-clean`, rebased onto verified
  `origin/main` commit `cffef825`.
- Task: Replace the conflicting GUILD2 runtime-schema bridge with row-level and
  bounded bulk procurement order creation through the authenticated API.
- Behavior: The plan validates 40 lines, blocks GUILD-027, keeps GUILD-039 as
  documentation, and creates the 38 searchable orders with deterministic keys
  and concurrency three. Active order detail polls every seven seconds.
- Safety: Browser input cannot choose a customer or workflow-owned fields. A
  webhook runs only for a newly committed order, and duplicate retries do not
  issue another wake.
- Verification: GUILD2 boundary, procurement contract, Atlas sourcing, and
  TypeScript checks passed. A disposable PostgreSQL CI job now provisions
  separate app and workflow databases and exercises tenant isolation,
  privileges, idempotency, webhook failure, and authenticated route handlers.
- Failed/skipped checks: Local PostgreSQL `initdb` still fails because this host
  has exhausted System V shared-memory IDs. The new database CI job has not run
  until the branch is pushed. No production provisioning or deployment was
  attempted.

### 2026-08-17 - Make dashboard role provisioning compatible with Neon

- Branch: `feat/bourne-neon-dashboard-clean`.
- Task: Repair the live commissioning failure caused by sending
  `ALTER ROLE ... NOSUPERUSER` through Neon's managed owner role.
- Behavior: New roles are created with `NOINHERIT`. Partial runs can be safely
  resumed. The script verifies and rejects elevated role attributes or role
  memberships before granting any table access.
- Verification: Procurement contract, GUILD2 contract, TypeScript, SQL diff,
  and database-backed CI are required before the live rerun.
- Caveat: The first live attempt created `dashboard_api` and set its two timeout
  defaults, then stopped before table grants or idempotency-table creation.

### 2026-08-10 - Add controlled connected-Gmail supplier quote release

- Branch: supply-os-supplier-communication, targeting main
- Commit: see git log
- Task: Turn the saved supplier quote request into a revisioned email draft,
  exact-message manager approval, connected Gmail delivery, durable provider
  receipt, and uncertain-delivery recovery without touching Logistics.
- Files changed: supplier communication persistence and Gmail adapter, scoped
  API routes, procurement case projection, sourcing client types, in-page quote
  controls, dashboard sender-account loading, persistence and UI contracts,
  architecture, decisions, and handoff.
- Verification: Atlas sourcing contract, local PostgreSQL sourcing lifecycle,
  TypeScript, production build, product copy, whitespace, tenant audit, and
  changed-file U+2014 checks.
- Caveats: Gmail is the only connected supplier-contact provider. Manual portal,
  EDI, phone, and external email remain evidence-only. Purchase-order release,
  payment, booking, customs, and Logistics remain unchanged.
- Follow-up: ingest connected supplier replies into the same quote cycle and
  match quote attachments to canonical response evidence.

### 2026-08-10 - Persist the supplier quote request and response cycle

- The selected quote cycle now reaches `SUCCEEDED` only after the linked
  authorized order is fully acknowledged. Legacy purchase actions without
  quote-cycle provenance remain acknowledgeable.

- Branch: supply-os-supplier-quote-cycle, targeting main
- Commit: see git log
- Task: Replace browser-authored commercial confirmation with a resumable RFQ
  draft, recorded external release, append-only supplier responses, and exact
  response selection.
- Files changed: procurement persistence and quote routes, sourcing types,
  in-page quote controls, queue state, database and UI contracts, architecture,
  decision record, and handoff.
- Verification: Atlas sourcing contract, disposable-database lifecycle and
  tenant contract, TypeScript, layout contracts, product copy, production
  build, whitespace, and changed-file U+2014 checks.
- Caveats: External release is recorded evidence. Derya still does not send the
  RFQ or supplier order, create a canonical PO, or open Logistics.
- Follow-up: Add controlled supplier communication only when an approved,
  idempotent connector can persist the actual provider message and response.

### 2026-08-10 - Record partial and full supplier acknowledgment

- Branch: supply-os-supplier-acknowledgment, targeting main
- Commit: see git log
- Task: Persist externally received supplier acceptance against the exact
  authorized order while keeping supplier and Logistics side effects off.
- Files changed: procurement persistence and acknowledgment route, sourcing
  types, in-page acceptance controls, queue state, database and UI contracts,
  architecture, decision record, and handoff.
- Verification: Atlas sourcing contract, disposable-database lifecycle and
  tenant contract, TypeScript, layout contracts, product copy, whitespace, and
  changed-file U+2014 checks.
- Caveats: The workflow records evidence only. It does not send an order, create
  a canonical PO, pay, book freight, or create a Logistics handoff.
- Follow-up: Create the approval-gated Logistics handoff only from a fully
  acknowledged order scope.

### 2026-08-10 - Bind final purchase approval to the complete order scope

- Branch: supply-os-purchase-action, targeting main
- Commit: see git log
- Task: Progress a persistent order draft into a separately approved immutable
  purchase action while keeping all supplier and Logistics side effects off.
- Files changed: procurement persistence and action routes, sourcing types,
  in-page procurement controls, queue state, role propagation, scoped styles,
  persistence and UI contracts, architecture, decisions, and handoff.
- Verification: Atlas sourcing contract, disposable-database lifecycle and
  tenant contract, TypeScript, production build, Supply OS layout contracts,
  product copy, docs, tenant audit, whitespace, and changed-file U+2014 checks.
- Caveats: `READY` is authorization only. No supplier connector, canonical PO,
  payment, booking, customs mutation, or Logistics handoff exists in this slice.
- Follow-up: Implement a provider-specific, idempotent release connector with
  acknowledgment storage. Only then create a Logistics handoff from the
  acknowledged order scope.

### 2026-08-10 - Persist approved purchase preparation drafts

- Branch: supply-os-purchase-draft, targeting main
- Commit: see git log
- Task: Turn an approved sourcing case into a resumable internal order draft
  without claiming that a purchase order or supplier action exists.
- Files changed: procurement persistence and purchase-draft route, sourcing
  client types, in-page procurement workflow, queue state, scoped styles,
  persistence and UI contracts, architecture, decision record, and handoff.
- Verification: Atlas sourcing contract, disposable-database sourcing
  persistence contract, TypeScript, production build, tenant audit, whitespace,
  product copy, docs, and changed-file U+2014 checks.
- Caveats: The draft does not contact the supplier, issue a PO, authorize spend,
  book freight, or open Logistics. Authenticated production interaction still
  requires a valid operator session.
- Follow-up: Copy the exact draft into a new immutable order-action input,
  require a separate admin approval, then implement an idempotent supplier
  connector and Logistics handoff.

### 2026-08-10 - Add persistent procurement qualification and exact-scope approval

- Branch: supply-os-procurement-qualification, targeting main
- Commit: see git log
- Task: Replace passive procurement gates with durable supplier evidence,
  commercial confirmation, quality planning, and exact-scope manager approval.
- Files changed: procurement persistence and routes, sourcing client types,
  in-page procurement workflow, queue status, scoped styles, database and UI
  contracts, architecture decision, handoff, and engineering log.
- Verification: sourcing UI and disposable-database persistence contracts,
  TypeScript, production build, whitespace, and changed-file U+2014 checks
  pass.
- Failed/skipped checks: the strict tenant audit still reports nine pre-existing
  findings outside the changed Supply OS files. The repository-wide U+2014 scan
  still reports legacy documentation; the changed-file scan is clean. No
  external supplier, PO, payment, booking, shipment, customs, or Logistics
  action was attempted.
- Caveats: approval authorizes only purchase preparation. It is deliberately
  separate from the mutable case and does not release an external action.
- Follow-up: add approved-scope purchase-order drafting, then create a separate
  approval-gated Logistics handoff that references the immutable sourcing scope.

### 2026-08-09 - Persist supplier selection and procurement readiness gates

- Branch: supply-os-procurement-progression, targeting main
- Commit: see git log
- Task: Turn a saved supplier comparison into a durable procurement planning case with
  server-derived evidence state, append-only selection history, and resumable
  readiness gates.
- Files changed: procurement-case persistence and API, sourcing client types,
  dashboard and queue restoration, procurement comparison and gate UI, scoped
  styles, database and UI contracts, architecture decision, handoff, and log.
- Verification: sourcing persistence and UI contracts, enterprise design,
  product copy, TypeScript, production build, whitespace, and changed-line
  U+2014 checks.
- Failed/skipped checks: no live supplier was contacted and no negotiation,
  sample, inspection, order, payment, booking, spend, or Logistics record was
  created.
- Caveats: readiness gates are deterministic and fail closed. This mutable case
  is not an approval target; the future execution action must bind the exact
  supplier and terms in immutable input. Evidence upload,
  qualification review, commercial confirmation, and inspection planning do
  not have operator input forms yet, so purchase approval cannot become ready.
- Follow-up: add evidence-backed gate actions and a supplier quote schema before
  adding approval requests or purchase-order drafting.

### 2026-08-09 - Persist and resume supplier research from the sourcing queue

- Branch: supply-os-persistent-procurement, targeting main
- Commit: see git log
- Task: Persist every interactive supplier research result, restore custom and
  component research in the sourcing queue, and replace passive next-step text
  with state-aware actions.
- Files changed: research persistence, supplier-research API, procurement and
  sourcing workspaces, dashboard state, scoped styles, sourcing contract,
  architecture decision, handoff, and engineering log.
- Verification: sourcing and enterprise design contracts, product copy,
  TypeScript, production build, whitespace, and changed-line U+2014 checks.
- Failed/skipped checks: no supplier contact, negotiation, order, payment,
  inspection, booking, spend, or Logistics record is created.
- Caveats: the latest run per component is the queue default. Older runs remain
  canonical but do not yet have a visible history drawer. The system workspace
  is office-shared and deliberately excluded from the company directory.
- Follow-up: add run history and quote normalization, then introduce explicit
  supplier qualification, sample or inspection, commercial approval, and
  purchase-order stages before Logistics handoff.

### 2026-08-09 - Connect procurement comparison to public supplier research

- Branch: supply-os-live-supplier-research, targeting main
- Commit: see git log
- Task: Replace the purely illustrative source scan with an authenticated,
  rate-limited call to the existing evidence-gated public supplier research
  engine while retaining modeled Atlas starting candidates.
- Files changed: interactive supplier-research API, procurement workspace,
  sourcing composer, scoped styles, sourcing regression contract, decisions,
  engineering log, and handoff.
- Verification: sourcing and supplier-research contracts, TypeScript, product
  copy, production build, whitespace, and changed-line U+2014 checks pass.
- Failed/skipped checks: no supplier was contacted and no purchase order,
  booking, spend, or Logistics record was created.
- Caveats: public results depend on the configured research provider. Missing
  price, currency, MOQ, or lead time remains unknown. Results are unqualified
  and are not persisted in this slice.
- Follow-up: persist the read-only research run and selected evidence, then
  create the approval-gated Logistics handoff action.

### 2026-08-09 - Replace inventory counters with procurement research flow

- Branch: supply-os-procurement-flow, targeting main
- Commit: see git log
- Task: Turn Inventory and sourcing into a request-to-recommendation workflow
  with an in-place dashboard transition, visible source research, option
  comparison, operator choice, and a draft logistics handoff.
- Files changed: Supply OS dashboard, sourcing queue, procurement workspace,
  scoped styles, Atlas demo fixture, sourcing regression contract, architecture
  decision, handoff, and engineering log.
- Verification: focused Supply OS routing, product twin, layout, map, sourcing,
  enterprise design, product copy, TypeScript, production build, whitespace,
  and authenticated desktop and mobile browser checks pass.
- Failed/skipped checks: no live web source, supplier system, ERP, purchase
  order, message, booking, spend, or logistics record was called or changed.
- Caveats: candidates, prices, delivery dates, quality states, and research
  progress are illustrative or modeled and are labeled accordingly.
- Follow-up: connect registered read-only source adapters with persisted source
  evidence, then create an approval-gated `SupplyAction` that opens Logistics
  with the accepted sourcing context.

### 2026-08-07 - Expand Supply OS lanes into multimodal legs

- Branch: feat/supply-os-full-network-demo, targeting main
- Commit: see git log
- Task: Replace single compound route curves with explicit pickup, ocean or
  air, customs, and final-mile planning legs, and add a complete one-click
  AON3D reference dashboard. Expand ocean and air comparisons with official
  carrier and forwarder candidates.
- Files changed: Supply OS case geography, command-map domain model, map
  renderer, dashboard lane flow, generator example, scoped styles, command-map
  regression coverage, decisions, engineering log, and handoff.
- Verification: all ten Supply OS regression suites, TypeScript, production
  build, diff whitespace, and changed-file U+2014 checks pass.
- Failed/skipped checks: in-app browser control was unavailable in this session,
  so visual click-through was not rechecked there.
- Caveats: gateway and route segments are inferred planning hypotheses. No live
  route, schedule, booking, capacity, filing, broker acceptance, or rate is
  claimed.
- Follow-up: replace inferred legs one by one as shipment, schedule, provider,
  terminal, broker, and route-engine integrations become available.

### 2026-08-06 - Add movement-scoped customs and execution planning

- Branch: crm-status-structure, targeting main
- Commit: see git log
- Task: Extend generated Supply OS customer cases with isolated port, customs,
  current-condition, provider, handoff, and end-to-end cost plans for every
  source-to-destination movement.
- Files changed: new operating-plan domain model and tests, Supply OS workspace
  and scoped stylesheet, prototype and enterprise design regression tests,
  package scripts, decisions, engineering log, and handoff.
- Verification: case-model, operating-plan, prototype, enterprise-design, and
  command-model tests pass. TypeScript, production build, diff whitespace, and
  changed-file U+2014 checks pass. Browser QA covers movement switching, scoped
  map emphasis, port ranking, customs records, source requirements, leg costs,
  provider details, desktop, tablet, mobile, overflow, focus, and console state.
- Adversarial review added regression coverage for non-overlapping service
  handoffs, US versus non-US providers and authority sources, ground versus
  ocean intelligence, Mexico-US land-border topology, structured US territory
  resolution, dangerous-goods price suppression, source-specific agricultural
  data, map keyboard interaction, and non-public connector records.
- A release-blocking provider-scope review found reused road quote text on
  downstream legs. Road provider candidates now receive each leg's exact
  origin and destination and have unique leg-scoped IDs; domestic, intra-EU,
  and Mexico-US regressions assert both endpoints in every road request.
- The same review removed overlapping door-to-door language from DHL's
  port-to-port linehaul request and corrected US-to-Mexico routing so both
  cross-border directions hand off at Laredo rather than a default US ocean
  gateway.
- Final release review added fail-closed geography handling for North Korea,
  retained mixed known and unsupported source and destination lists, removed
  duplicate inland charges for port-local imports, corrected empty-plan status,
  and introduced an explicit air-freight topology that does not inherit ocean
  providers, ports, containers, vessels, or drayage.
- Air mode now requires explicit routing language such as `by air` or `via
  air`, so a company that makes air-cargo products cannot trigger it. Air
  linehaul requests are airport-to-airport only and exclude the separately
  priced pickup, handling, customs, storage, and final-recovery legs.
- Authenticated design QA fixed four responsive and interaction defects in
  separate commits: the mobile execution ledger, 44-pixel action and map
  targets, numeric cost wrapping, and the blank strip caused by a direct-child
  dashboard width override. Rechecks at 1440, 1024, and 390 pixels found zero
  page overflow and no console errors after interaction.
- Failed/skipped checks: no provider, customs, terminal, rate, broker, ERP, TMS,
  or procurement callback was executed because this change adds no live adapter
  or external write path.
- Caveats: current findings and costs are deterministic modeled records. Duties
  and taxes are excluded. A technology connector does not replace a licensed
  broker or direct importer-to-broker authorization for customs entry work.
- Follow-up: persist office-scoped case snapshots, then add read-only provider
  adapters with provenance, freshness, and expiry before enabling approved
  outbound or execution actions.

### 2026-08-06 - Remove decorative color and flatten Supply OS hierarchy

- Branch: crm-status-structure, targeting main
- Commit: see git log
- Task: Keep the dense Supply OS operating model while replacing the improvised
  tactical color treatment with a restrained, Pallet-informed enterprise
  system.
- Files changed: Supply OS workspace and scoped stylesheet, global form and
  button theme isolation, enterprise design regression test, engineering log,
  and handoff.
- Pre-landing review: generic form and button exclusions were converted to
  zero-specificity `:where()` selectors so the isolation does not strengthen
  global rules on unrelated pages. Remaining generic button states are scoped
  out of Supply OS, which now owns its neutral keyboard focus treatment.
- Verification: all three Supply OS tests, TypeScript, production build, and
  `git diff --check` pass. Browser QA covered all six views and command layouts
  at desktop, 1024 by 900, and 390 by 844.
- Failed/skipped checks: authenticated production behavior was not exercised
  locally because the design prototype has no production data or provider
  connection. Browser console history contained unrelated WebGL failures from
  the Pallet reference tab and a style attribute injected into local inputs by
  the browser harness.
- Caveats: operational records remain modeled or fictional. This change does
  not add live feeds, persistence, booking, filing, messaging, or external
  writes.
- Follow-up: connect office-scoped canonical records and provider evidence
  behind the existing human-approval boundaries before enabling actions.

### 2026-08-06 - Rebuild Supply OS as a customer command center

- Branch: crm-status-structure, targeting main
- Commit: see git log
- Task: Replace the sparse Supply OS presentation with a dense customer-facing
  operating picture informed by Kpler and Windward patterns.
- Files changed: the Supply OS workspace and scoped stylesheet, command model,
  three Supply OS regression tests, package scripts, architecture decision,
  engineering log, and handoff.
- Verification: all three Supply OS tests and TypeScript pass. Browser QA covered
  all six views, objective recompute, exception synchronization, review state,
  map search and layers, quote approval, execution gates, authority controls,
  responsive layouts, and console errors.
- Integrity checks cover movement-scoped assessment resolution, separate
  Yantian and Shanghai quote sets, honest no-quote states, country of origin,
  and prevention of cross-movement quote approvals in execution.
- Failed/skipped checks: targeted ESLint could not run because this repository
  has no `eslint.config.*` for its installed ESLint 9. Live provider behavior
  was not tested because no live provider or write path is part of this
  prototype.
- Caveats: all operational records, rates, risk areas, locations, evidence,
  confidence, and events on the page are modeled or fictional. The interface
  explicitly says no AIS, GPS, carrier, customs, or port feed is connected.
- Follow-up: project office-scoped customer records into this interface, then
  add provider adapters and human-approved actions without weakening source
  provenance or tenant boundaries.

### 2026-07-29 - Separate liveness failures from queue degradation

- Branch: find-hardware-import-data
- Commit: see git log
- Task: Fix production `/api/health` returning 500 while the application and
  scheduled routes remained reachable.
- Files changed: `src/app/api/health/route.ts`,
  `src/lib/health-status.ts`, `scripts/health-status.test.ts`, and handoff
  documentation.
- Verification: The regression test covers healthy, degraded, and unhealthy
  classifications. A fresh disposable PostgreSQL database was seeded with one
  failed background job, then the production build was served locally. Public
  `/api/health` returned HTTP 200 with `status=degraded`; the authorized
  response retained the failed warning and safe queue counts. `npm run
  test:security`, `npx tsc --noEmit`, and `npm run build` passed against the
  current schema.
- Failed/skipped checks: The first security-test attempt had no
  `DATABASE_URL`. The existing local database was then rejected because its
  `Job` table lacks current fields. No existing database was modified.
- Caveats: The production route must be rechecked after deployment. If it
  remains HTTP 500, a critical database or schema check is failing and the
  detailed `CRON_SECRET`-authorized diagnostic must be used before any further
  code change.
- Follow-up: Deploy, verify production reports healthy or degraded with HTTP
  200, then inspect and retry failed queue items from the Admin page without
  treating them as an application outage.

### 2026-07-29 - Olympian load dossier, unified workspace, and Intel bridge

- Branch: find-hardware-import-data
- Commit: see git log
- Task: Create the real Olympian Motors shipment as one deduplicated load,
  redesign the load page around its operational fields and conversations, make
  the route map trustworthy, and connect the load naturally to Intel.
- Files changed: `src/lib/olympian-load.ts`, Olympian import scripts and tests,
  the jobs index and detail routes, `src/lib/load-workspace.ts`,
  `src/components/load-workspace.tsx`, offline load-route helpers and
  components, the dashboard route map, the load-to-Intel brief helper, Intel
  page prefills, the agent dock suppression, package scripts, and docs.
- Verification: Olympian database import test passed against disposable
  Postgres with first-create, idempotent rerun, office isolation, one thread,
  seven messages, fifteen fixture documents, nine tasks, six milestones, zero
  carrier quotes, and one memory event. The repair case preserved a sixteenth
  operator-created document row instead of overwriting it. Load workspace, route map, legacy
  workbench map, Intel privacy brief, Intel chat-first, and China load UI tests
  passed. `npx tsc --noEmit`, `git diff --check`, changed-file U+2014 checks,
  and the production build passed. Authenticated browser QA covered the actual
  Olympian load, no horizontal overflow, load-scoped chat, the offline
  Shanghai to Irvine city-area route, privacy-safe Intel prefill, unsent Intel
  questions, and a clean console before screenshot tooling modified form caret
  styles. Adversarial review then removed invented port calls, isolated every
  Intel route from the global dock, made Job truth outrank parsed dossier data,
  office-scoped linked records, bounded the conversation feed, and made
  idempotent imports repair their fixture-owned child records.
- Failed/skipped checks: ESLint cannot start because the repository uses
  `.eslintrc` while installed ESLint 9 expects flat configuration. No lint
  configuration was changed.
- Caveats: The local QA database contains the recreated Olympian demo load.
  Production creation requires the ADMIN action after deployment. Imported
  messages are sanitized summaries and must be checked against the original
  email exports. The map is planned routing, not live tracking. Historical
  rate evidence is not an executable carrier quote.
- Follow-up: Test the deployed ADMIN import, open the load in Intel, review the
  privacy-safe brief, and build the read-only customs report. Attach original
  documents only through the normal document controls.

### 2026-07-27 - Requeue contacted people and expand hardware prospects

- Branch: crm-status-structure (Conductor workspace phoenix, targets main)
- Commit: see git log
- Task: Honor the operator's decision to contact previously contacted people
  again and add eight fresh hardware-company prospects.
- Files changed: `src/lib/hardware-vc-outreach-campaign.ts`,
  `src/lib/load-hardware-vc-outreach.ts`, `src/components/contact-sheet.tsx`,
  `scripts/hardware-vc-outreach.test.ts`,
  `scripts/hardware-vc-outreach-loader.test.ts`, and handoff docs.
- Verification: `npm run test:hardware-vc-outreach`, `npm run test:crm`, and
  `npx tsc --noEmit` pass. The loader test covers re-queueing a contacted person
  while preserving verified contact details and current-week completion safety.
- Failed/skipped checks: No direct production database write was run because
  this workspace has no authenticated production database session.
- Caveats: The campaign is now 120 people with a 27 Bookface, 31 LinkedIn, and
  62 Email split. Only CRM status `contacted` was added to the safe requeue set.
  Other protected statuses and current-week Reached out rows still stop loading.
- Follow-up: Deploy, retry the authenticated campaign load, and verify the
  resulting 27/31/62 Today queue.

### 2026-07-27 - Fix production advisory-lock deserialization

- Branch: crm-status-structure (Conductor workspace phoenix, targets main)
- Commit: see git log
- Task: Fix the production campaign loader failure caused by Prisma trying to
  deserialize PostgreSQL's `void` return from `pg_advisory_xact_lock`.
- Files changed: `src/lib/load-hardware-vc-outreach.ts`,
  `scripts/hardware-vc-outreach-loader.test.ts`, and handoff docs.
- Verification: The new regression test failed with the reported
  deserialization error before the fix. `npm run test:hardware-vc-outreach`,
  `npm run test:crm`, and `npx tsc --noEmit` pass after casting the lock result
  to a Prisma-supported text value.
- Failed/skipped checks: No direct production database test was run because
  this workspace has no production database credential.
- Caveats: The failed live attempt stopped on the first statement, before
  company, contact, or outreach-plan writes.
- Follow-up: Retry the authenticated campaign load after the hotfix deploys.

### 2026-07-27 - Corrected hardware-company and VC channel campaign

- Branch: crm-status-structure (Conductor workspace phoenix, targets main)
- Commit: see git log
- Task: Populate today's Outreach workflow with 20 YC hardware-company founders
  on Bookface, 30 hardware-company leaders on LinkedIn, and 62 hardware and
  deep-tech investors on email.
- Files changed: `src/lib/hardware-vc-outreach-campaign.ts`,
  `src/lib/load-hardware-vc-outreach.ts`, `src/app/dashboard/crm/actions.ts`,
  `src/components/contact-sheet.tsx`, `src/app/globals.css`,
  `scripts/hardware-vc-outreach.test.ts`,
  `scripts/hardware-vc-outreach-loader.test.ts`, `package.json`, and docs.
- Verification: `npm run test:hardware-vc-outreach`,
  `npm run test:crm-outreach`, `npm run test:crm`, `npx tsc --noEmit`,
  `git diff --check`, and changed-text em dash check passed.
- Failed/skipped checks: `npm run test:crm-outreach-db` could not run because
  this workspace has no disposable PostgreSQL credential. The test reached
  Prisma with the correct React Server condition and failed at database
  authentication against the explicit placeholder URL.
- Caveats: The campaign is human-operated and sends nothing. Email addresses
  are intentionally not guessed. Bookface and LinkedIn contacts are categorized
  as startup buyer leads; email contacts are categorized as personally
  important investors. Loading is limited to admin and manager roles, reuses
  canonical office-scoped CRM rows, refuses protected status changes, locks
  company/contact writes during the load, and requires explicit confirmation.
- Follow-up: Load the campaign from `/dashboard/outreach`, verify any email
  addresses before outreach, and mark each completed contact Reached out.

### 2026-07-27 - Separate connected Outreach workspace

- Branch: crm-status-structure (Conductor workspace phoenix, targets main)
- Commit: see git log
- Task: Move daily and weekly outreach execution out of the CRM page and into
  a top-level Outreach tab without duplicating contact data or planner logic.
- Files changed: `src/app/dashboard/outreach/page.tsx`,
  `src/app/dashboard/crm/page.tsx`, `src/app/dashboard/crm/actions.ts`,
  `src/app/dashboard/layout.tsx`, `src/components/contact-sheet.tsx`,
  `src/lib/crm-view.ts`, `src/lib/crm-workspace.ts`,
  `scripts/crm-outreach-ui.test.ts`, and docs.
- Verification: `npm run test:crm`, `npx tsc --noEmit`, `npm run build`,
  `git diff --check`, changed-text em dash check, and authenticated browser QA
  against a disposable local Postgres database. Browser QA verified the
  top-level navigation link, daily and weekly route state, legacy CRM redirect,
  CRM return link, responsive layouts, manual completion, canonical CRM status
  updates, and no console errors.
- Failed/skipped checks: The first build invocation omitted `DATABASE_URL`.
  The build passed after using the disposable local database URL. The first
  local login attempts lacked the QA allowlist and `AUTH_SECRET`; both were
  supplied only to the disposable local server. The stale QA schema was
  synchronized after the first dashboard load exposed a missing column.
- Caveats: No migration or dependency change is part of this route split.
  Outreach remains human-operated and records completion without sending.
- Follow-up: Populate real CRM contacts and work the daily Outreach queue from
  `/dashboard/outreach`.

### 2026-07-27 - CRM Outreach Desk entry point and capacity gaps

- Branch: crm-status-structure (Conductor workspace phoenix, targets main)
- Commit: 00c57f6
- Task: Make the existing daily and weekly CRM outreach loop visible from the
  contact-first CRM screen, expose per-channel empty capacity, and keep send
  controls usable when the agent panel narrows the page.
- Implementation: `/dashboard/crm` now defaults to Contacts and renders a
  persistent Outreach Desk launcher. Daily and weekly panels are URL-backed by
  `src/lib/crm-view.ts`; their channel cards filter the queue; three explicit
  capacity slots report missing Bookface, LinkedIn, and Email contacts and
  return to contact classification. The outreach action column is sticky on
  desktop and returns to normal card flow on mobile.
- Verification: Prisma validation and generation, `npm run test:crm`,
  post-merge `npm run test:lead-board`, `npx tsc --noEmit`, `npm run build`,
  `git diff --check`, changed-text em dash check, and browser QA at desktop and
  mobile widths against a disposable local Postgres database. Contacts, daily,
  and weekly views rendered without console errors.
- Failed/skipped checks: The first production build collided with a running
  `next dev` process and lost generated route files. The dev server was stopped,
  its `.next` cache was moved aside, and the clean rerun passed. The first
  post-merge validation invocation omitted `DATABASE_URL`, and the first
  post-merge TypeScript pass used a stale generated Prisma client. Supplying the
  disposable database URL and rerunning `npm run db:generate` resolved both.
- Caveats: The workflow records manual completion and never auto-sends. Contacts
  need an eligible category and assigned outreach channel before they can fill
  capacity. Current `origin/main` was merged and the combined tree was
  reverified before push.
- Follow-up: Merge current main, deploy the planner migration, then populate the
  visible weekly gaps until Bookface reaches 140 and LinkedIn and Email reach
  210 each.

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
- Commit: `7b2ea43`
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
  Thresholds may need source-specific …52138 tokens truncated…ern and fails on current `main`. It was not
  changed because the task does not own that upstream contract.
- Caveat: chat behavior is deterministic and session-only. No production
  automation or external action is connected.
- Follow-up: introduce an office-scoped workflow model and approval-bound
  execution only when typed triggers, actions, versioning, audit history, and
  idempotent workers are ready.

### 2026-08-09 - Open up the Automations workspace

- Branch: main
- Commit: `861d538`
- Task: Keep the existing chat and automation-library split while making the
  surface airier and less like a dense settings table.
- Files changed: Automations component and scoped styles, design guidance,
  handoff, and this engineering log.
- Design: centered the conversation and composer on readable measures,
  increased section spacing, removed the repeated company label, softened the
  template list, and added concise selected-workflow context. DualEntry and
  Campfire now complement Pallet.com as spacing and composition references.
- Verification: Automations, shell-routing, sidebar-map, continuous-layout,
  enterprise-design, operations-UI, product-twin, product-copy, and TypeScript
  checks pass. Authenticated browser QA passed at 1440 by 1000 and 390 by 844.
  Draft creation and the inactive execution boundary remain intact.
- Failed/skipped checks: none at this stage.
- Caveat: the workflow remains deterministic and browser-session only. It does
  not persist or execute an external action.
- Follow-up: keep future automation controls inside the same calm two-pane
  hierarchy. Do not reintroduce a card grid or full-width chat text.

### 2026-08-09 - Add a collapsible Supply OS rail and structural Automations whitespace

- Branch: main
- Commits: `53a8de6`, `21e3e44`, `622017b`, and `a4af47b`
- Task: Make the persistent domain navigation collapsible and make the
  Automations workspace materially airier at desktop widths.
- Files changed: Supply OS operating shell and styles, Automations styles, new
  collapsible-navigation regression contract, design system, decisions,
  handoff, and this log.
- Design: the expanded 260px rail remains the default. Operators can collapse
  it to an 84px numbered rail without losing domain names in the accessibility
  tree. Automations now uses larger outer gutters, a centered 1240px work
  surface, a lighter boundary, and wider internal spacing.
- Verification: collapsible-navigation, company-navigation, Automations,
  continuous-layout, enterprise-design, TypeScript, desktop browser, and
  mobile browser checks pass. Collapse remains active while switching domains,
  the mobile sixth tab remains visible, and both checked widths have zero page
  overflow.
- Failed/skipped checks: none at this stage.
- Caveat: collapse preference is session-local and is not persisted across a
  full page reload.
- Follow-up: if lower-rail utilities are added, prefer one global search or
  switcher and one workspace-settings entry. Do not add duplicate domain links
  merely to occupy blank rail space.

### 2026-08-09 - Move the Supply OS collapse control into the rail header

- Branch: main
- Task: Replace the oversized lower-rail collapse action with a compact control
  beside the Derya logo.
- Files changed: Supply OS operating shell and styles, collapsible-navigation
  regression contract, handoff, and this log.
- Design: the toggle is now a 44px icon-only button in the 88px desktop brand
  row. It keeps its accessible label, title, expanded state, and controlled
  navigation ID. The control remains hidden when navigation becomes horizontal
  below 900px.
- Verification: collapsible-navigation, company-navigation, sidebar-map,
  operations-UI, product-copy, TypeScript, diff-check, and changed-diff U+2014
  checks pass. TypeScript contracts used the sandbox-compatible Node TS loader.
- Failed/skipped checks: the in-app browser had no attached tab, so rendered
  desktop and mobile inspection was unavailable. Commit and push were blocked
  because the sandbox could not create `.git/index.lock`.
- Caveat: collapse preference remains session-local and is not persisted across
  a full page reload.

### 2026-08-09 - Replace scripted Automations chat with GPT workflow drafting

- Task: Remove redundant Automations narration and connect the chat to the
  existing GPT-5.6 runtime.
- Files changed: Automations component and styles, new authenticated chat route,
  new structured-output workflow drafting library, automation contracts,
  package scripts, decision record, and handoff docs.
- Behavior: The chat now sends company context, the selected workflow, recent
  conversation, and the operator instruction to GPT. Structured responses can
  create or update browser-session workflow drafts. Deterministic server logic
  restores an explicit approval gate when a risky draft omits one.
- UI: Removed both local headers and all static assistant narration. The initial
  left pane is an empty canvas with one compact composer, and the right pane
  starts directly with the workflow list.
- Verification: Automation chat, Automations workspace, company navigation,
  shell routing, sidebar map, continuous layout, enterprise design, operations
  UI, product twin, Atlas sourcing, collapsible navigation, product copy, and
  TypeScript checks passed. Authenticated desktop and mobile browser checks
  passed with no horizontal overflow. Local live GPT completion was unavailable
  because the local environment has no `OPENAI_API_KEY`.

### 2026-08-09 - Remove optimization inspector header and composer resize handle

- Branch: main
- Task: Remove the optimization profile header and the Automations textarea
  resize handle.
- Files changed: Supply OS dashboard, Logistics styles, operations UI contract,
  handoff, and this log.
- Design: The optimization view now starts directly with its actionable content.
  Its tab no longer repeats the priority count. The Automations composer keeps
  its fixed shape without exposing the browser resize affordance.
- Verification: Operations UI, collapsible navigation, sidebar map, enterprise
  design, product copy, TypeScript, diff-check, and changed-diff U+2014 checks
  passed. Authenticated browser QA at 1440 by 1000 confirmed the composer has
  no resize affordance, the optimization title block is absent, and the page
  has no horizontal overflow.
- Failed/skipped checks: None.
- Caveats: None. Optimization data and behavior are unchanged.

### 2026-08-09 - Center the collapsed Supply OS header

- Branch: main
- Task: Center the Derya mark when the domain rail is collapsed.
- Files changed: Supply OS shell styles, collapsible-navigation contract,
  handoff, and this log.
- Design: The mark is centered in the 84px rail. The expand control sits on the
  rail boundary so it does not shift the mark off-axis.
- Verification: Collapsible navigation, company navigation, sidebar map,
  product copy, TypeScript, diff-check, and authenticated browser QA pass.
- Failed/skipped checks: None.

### 2026-08-10 - Bind supplier progression to the evidence ledger

- Branch: supply-os-procurement-evidence, targeting main
- Commit: see git log
- Task: Replace procurement URLs trapped in task JSON with independently
  addressable evidence records that survive navigation and flow into approval.
- Files changed: procurement persistence, authenticated evidence redirect,
  sourcing types and evidence links, database and UI contracts, architecture,
  decision record, and handoff.
- Verification: Atlas sourcing contract, disposable-database sourcing
  lifecycle and tenant contract, TypeScript, product copy, Supply OS layout
  regressions, production build, whitespace, and changed-file U+2014 checks.
- Caveats: Evidence URLs are captured records, not uploaded files or connected
  supplier messages. Derya still does not send the RFQ or purchase order.
- Follow-up: Add a controlled supplier communication task only after exact
  recipient, message body, sender account, approval hash, provider message ID,
  and unknown-send recovery are persisted.

### 2026-08-10 - Capture connected supplier replies in the quote cycle

- Branch: supply-os-supplier-replies, targeting main
- Task: Close the gap between a connected Gmail quote request and commercial
  review without allowing email text to become approved terms automatically.
- Behavior: The active quote cycle can sync the approved Gmail account, capture
  exact-sender inbound replies from the delivered provider thread, persist
  immutable connected evidence, and restore the reply cards from the sourcing
  queue. A buyer selects a reply as evidence and manually confirms the complete
  commercial structure before the normal review and approval gates continue.
- Safety: Other thread participants, pre-send messages, duplicate provider IDs,
  and cross-scope evidence are rejected. Repeat and concurrent syncs are
  idempotent. Connected response dates are pinned to the provider observation.
- Boundary: No email parser or model confirms price, MOQ, delivery, validity, or
  quote identity. Logistics remains unchanged.

### 2026-08-10 - Add competitive supplier quote workstreams

- Branch: supply-os-multi-supplier-quotes, targeting main
- Task: Preserve multiple supplier RFQ paths for one sourcing request and make
  them resumable from one competitive quote inbox.
- Behavior: Shortlisting creates one supplier-specific procurement case per
  candidate. Repeated, mixed-contract, and concurrent requests converge on the
  same task identity. Queue restoration groups siblings by research run.
- Comparison: The inbox uses the selected response and suppresses price or
  delivery badges when RFQ scope, unit, or currency is not comparable.
- Safety: Dirty forms block supplier switching, each workstream retains isolated
  evidence, and only one sibling can enter award approval at a time.
- Verification: Atlas sourcing contract, disposable-database sourcing lifecycle,
  concurrent first-create, cross-office write denial, TypeScript, production
  build, diff check, and responsive authenticated browser QA.
- Boundary: Logistics handoff remains unchanged in this slice.

### 2026-08-10 - Make sourcing history fully resumable

- Branch: supply-os-procurement-queue-v2, targeting main
- Task: Replace the fixed client-side sourcing join with a bounded, cursor-based
  server read model and keep every older research run actionable.
- Behavior: The queue appends stable older-work pages, shows dated saved
  research, retries failed page loads, and loads all supplier workstreams for
  the exact research runs returned by each page.
- Safety: Current user access is refreshed before sourcing workspace reads.
  Office and workspace scope remain mandatory. Quote-cycle and supplier-email
  routes use exact task ancestry instead of scanning the newest 120 cases.
- Verification: Atlas sourcing contract, disposable PostgreSQL pagination,
  cross-office access, stale-session access, exact-run hydration, 120-case
  saturation, TypeScript, and whitespace checks.
- Caveats: Queue order is research creation order. A later operational-priority
  projection may rank urgent work, but it must not hide historical runs.
- Boundary: No database migration, dependency, supplier contact, purchase,
  spend, booking, customs, or Logistics behavior changed.

### 2026-08-10 - Add sourcing clarification before public research

- Branch: `codex/procurement-request-refinement`, rebased onto procurement PR
  #116.
- Task: Add free-text requests to the queue, collect missing parameters in an
  inline conversation, and start public research only after deterministic
  readiness checks pass.
- Integration: The intake flow was forward-ported onto the canonical research,
  procurement case, supplier reply, and competitive quote workflow. It does not
  replace or bypass those records.
- Files changed: sourcing request extractor and route, supplier research input,
  procurement workspace, browser-scoped pending queue, styles, tests, decisions,
  and handoff.
- Verification: Atlas sourcing contract, ingestion and research trust contract,
  TypeScript, production build with disposable PostgreSQL-shaped URLs, and diff
  checks.
- Boundary: Pending drafts are browser-local. Research runs and downstream
  procurement work remain office-scoped canonical records with human approval.

### 2026-08-10 - Replace free-text source review with supplier qualification

- Branch: supply-os-supplier-progression-v3, targeting main
- Commit: see git log
- Task: Make supplier progression evidence-backed before RFQ preparation and
  keep rejected or stale workstreams visible and resumable.
- Behavior: Gate 1 now captures identity, component capability, relationship,
  optional manufacturer authorization, validity, review note, and an explicit
  qualified or rejected outcome. Rejections persist in the queue and can be
  requalified later without erasing evidence history.
- Safety: Identity evidence must match the attributed supplier domain.
  Authorized distributors require manufacturer evidence. Legacy and expired
  reviews reopen Gate 1, and downstream RFQ and approval boundaries fail closed.
- Verification: Atlas sourcing contract, disposable PostgreSQL qualification
  lifecycle, rejection and requalification, expiry projection, tenant checks,
  TypeScript, responsive authenticated browser QA, product copy, production
  build, whitespace, and changed-file U+2014 checks.
- Boundary: No schema, dependency, supplier contact, purchase execution, spend,
  booking, customs, or Logistics behavior changed.

### 2026-08-10 - Revalidate qualification at supplier contact release

- Branch: supply-os-qualified-release-v4, targeting main
- Commit: see git log
- Task: Close the stale-authorization window between supplier qualification,
  email approval, and actual supplier contact.
- Behavior: Connected-email approval pins the qualification review hash and
  validity. Draft, approval, and final send boundaries revalidate it. Manual
  release requires qualification valid on the recorded release date.
- Safety: The send claim locks the procurement case first and refuses to call
  the provider after expiry or requalification. Once a provider call starts,
  its receipt remains durable evidence. Existing release retries stay
  idempotent. Late provider or reconciliation misses cannot overwrite `SENT`.
  Legacy unsent approvals are replaced with qualification-scoped approvals;
  unresolved legacy delivery remains recoverable instead of being hidden.
- Verification: Atlas sourcing contract, disposable PostgreSQL sourcing
  lifecycle with provider-call denial assertions, TypeScript, production build,
  whitespace, and changed-file U+2014 checks.
- Failed check: Repository-wide strict tenant audit still reports nine existing
  findings outside this change. No changed Supply OS file is named by the audit.
- Boundary: No schema, dependency, purchase, spend, booking, customs, or
  Logistics behavior changed.

### 2026-08-10 - Separate purchase order release from supplier acknowledgment

- Branch: supply-os-procurement-next, targeting main
- Commit: see git log
- Task: Add the missing awaiting-supplier checkpoint between final order
  authorization and supplier acknowledgment.
- Behavior: The operator records the external PO release, evidence, exact action
  scope, and acknowledgment due date. The queue resumes `RELEASED`, and supplier
  acknowledgment must reference the release hash before partial or full
  acceptance can be recorded.
- Safety: Authorization, active admin decision, qualification, quote validity,
  tenant scope, and need-by timing are rechecked. Changed releases are rejected;
  identical and concurrent retries converge without duplicate history.
- Verification: Atlas sourcing contract, disposable PostgreSQL sourcing
  lifecycle, TypeScript, product copy, and whitespace checks.
- Boundary: This is recorded external evidence. Derya does not send the order,
  create a canonical PO, commit spend, book freight, or open Logistics.

### 2026-08-10 - Deliver authorized purchase orders through connected Gmail

- Branch: `supply-os-order-delivery`, targeting `main`.
- Task: Close the gap between final purchase authorization and durable supplier
  delivery without treating authorization as permission to send arbitrary text.
- Behavior: The operator drafts the exact purchase order email, obtains a
  separate manager approval, sends through a connected office Gmail account,
  and resumes pending, uncertain, retry-ready, sent, and released states from
  the sourcing queue.
- Safety: Current access, purchase scope, supplier qualification, quote
  validity, sender account, recipient, message hash, and order timing are
  revalidated. Unknown provider results block duplicate sends and alternate
  release channels until reconciled. Provider receipt and release evidence are
  persisted atomically.
- Verification: Atlas sourcing contract, disposable PostgreSQL delivery
  lifecycle, stale-session and cross-office rejection, provider uncertainty and
  recovery, idempotent retry, TypeScript, build, copy, tenant, whitespace, and
  changed-file U+2014 checks.
- Boundary: No schema, dependency, payment, booking, customs, canonical PO, or
  Logistics behavior changed.

### 2026-08-10 - Capture connected supplier order acknowledgments

- Branch: `supply-os-connected-order-acknowledgments`, targeting `main`.
- Task: Close the manual inbox gap after a connected Gmail purchase order is
  released.
- Behavior: Supply OS syncs the exact order thread, captures matching supplier
  replies as durable evidence, restores them in the sourcing queue, and lets an
  operator use one reply while confirming structured acceptance terms.
- Safety: Account, office, workspace, thread, sender, send time, purchase action,
  and release hash are pinned. Replies never infer quantity or delivery. A
  connected reply cannot be reused to count accepted quantity twice.
- Fix: Connected Gmail release URLs retain a thread fragment. The legacy
  acknowledgment validator treated them as generic public URLs and stripped the
  fragment, which blocked every connected release from being acknowledged. The
  validator now follows the stored evidence class.
- Verification: Atlas contract, disposable PostgreSQL capture and review
  lifecycle, wrong account, thread, sender, time, evidence kind, stale session,
  cross-office access, provider failure, concurrency, idempotency, TypeScript,
  build, copy, docs, tenant, whitespace, and U+2014 checks.
- Boundary: No schema, dependency, automated term extraction, payment, booking,
  customs, inventory mutation, or Logistics behavior changed.

### 2026-08-10 - Route supplier counteroffers through order exceptions

- Branch: `supply-os-order-exceptions`, targeting `main`.
- Task: Prevent changed supplier terms from being recorded against an unchanged
  purchase authorization.
- Behavior: Operators can record quantity, price, delivery, payment-term,
  rejection, and other exceptions from connected Gmail or external evidence.
  The sourcing queue restores open-review and reauthorization-required states.
- Safety: Exceptions pin the release hash and evidence. One connected reply
  cannot support both acceptance and an exception. Open and revision-required
  exceptions block acknowledgments. Only an admin can require new purchase
  authorization.
- Verification: Atlas sourcing contract, disposable PostgreSQL lifecycle,
  concurrent idempotency, evidence reuse, stale-session and cross-office denial,
  TypeScript, build, copy, docs, tenant, whitespace, and U+2014 checks.
- Boundary: Reauthorization is a blocking state, not a replacement order. No
  supplier message, payment, inventory mutation, booking, customs filing, or
  Logistics handoff is created.

### 2026-08-11 - Authorize and release immutable replacement orders

- Branch: `supply-os-revised-order-authorization`, targeting `main`.
- Task: Complete the replacement-order lifecycle after a supplier changes an
  already released purchase order.
- Behavior: A revision-required exception produces a versioned replacement
  draft and a fresh exact-scope purchase approval. Both manual release and
  connected Gmail delivery supersede the old action only after durable release
  evidence exists.
- Safety: Current tenant access, original release hash, exception evidence,
  supplier qualification, prior sourcing approval, quality plan, commercial
  validity, replacement scope, and approval are revalidated. Repeated and
  concurrent draft preparation converges. Obsolete-release acknowledgments are
  blocked before and after supersession.
- Verification: Atlas sourcing, operations UI, continuous layout, product copy,
  TypeScript, production build, and disposable PostgreSQL lifecycle checks for
  concurrent manual release, connected Gmail uncertainty and retry, stale
  supersession, approval expiry recovery, queue restoration, and supplier
  rejection return-to-sourcing.
- Boundary: No schema, dependency, payment, inventory, booking, customs, or
  Logistics behavior changed.

### 2026-08-11 - Recover stale revised-order authorization scopes

- Branch: `supply-os-authorization-freshness`, targeting `main`.
- Task: Remove the dead end created when supplier qualification or an approved
  quality plan expires after a replacement draft exists.
- Behavior: Request, approval, manual release, and connected Gmail send
  boundaries return stale revised orders to the supplier shortlist. The
  transition cancels the unusable replacement chain while preserving the
  original released supplier order and immutable evidence history.
- Safety: The connected-email claim checks freshness before the provider call.
  Unresolved provider delivery blocks recovery. Durable case and exception
  projections retain the stale gate, cancelled replacement IDs, actor, and
  timestamp.
- Verification: Atlas sourcing contract, TypeScript, disposable PostgreSQL
  request and pending-action recovery, released-order preservation, approval
  expiry, event idempotency, and the full existing sourcing lifecycle.
- Boundary: No migration, dependency, supplier contact, spend, payment,
  inventory, booking, customs, or Logistics behavior changed.

### 2026-08-11 - Add approval-gated supplier acknowledgment follow-up

- Branch: `supply-os-supplier-followup`, targeting `main`.
- Task: Turn an overdue released-order warning into a durable connected-Gmail
  follow-up workflow without changing Logistics.
- Behavior: Operators can save a revisioned message, request and decide exact
  message approval, send or reconcile delivery, resume every state from the
  sourcing queue, and inspect persistent follow-up history and evidence.
- Safety: Current user, office, workspace, release hash, purchase-action scope,
  remaining quantity, recipient, due date, Gmail account, approval scope, and
  provider receipt are revalidated. Stable message identity and serializable
  retries prevent duplicate supplier contact. A response cancels only safe
  unsent follow-up work.
- Verification: Atlas sourcing contract, supplier email provider checks,
  TypeScript, and disposable PostgreSQL lifecycle coverage for concurrent
  drafts, approval, unknown delivery, reconciliation, retry, evidence, queue
  restoration, stale sessions, and cross-office denial.
- Boundary: No migration, dependency, payment, inventory, booking, customs, or
  Logistics behavior changed.

### 2026-08-11 - Extract reviewable terms from connected supplier replies

- Branch: `supply-os-quote-normalization`, targeting `main`.
- Task: Reduce manual quote transcription without treating model output as
  supplier truth or procurement approval.
- Behavior: An operator can extract exact-source price, currency, MOQ, unit,
  delivery, quote reference, and validity proposals from one connected reply,
  inspect warnings and conflicts, prefill the manual response form, and resume
  the proposal from the sourcing queue after navigation or refresh.
- Persistence: The run pins tenant, quote cycle, request, source evidence,
  requested unit, dates, capability version, and prompt version. Successful
  output becomes append-only proposal evidence linked to the original reply.
  Failed attempts remain immutable and retries create linked attempts.
- Safety: Server normalization rejects unsupported citations and invalid values.
  Attachment contents are not parsed. Extraction cannot record a response,
  advance a commercial gate, request approval, contact a supplier, or spend.
  Stale users and foreign offices are rejected before the extractor runs.
- Fix: Supplier follow-up delivery now moves the approved draft from `READY` to
  `RUNNING` before finalization. The prior direct `READY` to `SUCCEEDED`
  transition was rejected by the database state guard.
- Verification: Quote extraction unit coverage, Atlas sourcing contract,
  disposable PostgreSQL persistence and retry lifecycle, supplier email
  provider, operations UI, continuous layout, product copy, TypeScript, and
  production build passed. Strict tenant audit retained nine findings outside
  the changed files. Changed-file U+2014 and diff checks passed.
- Boundary: No migration, dependency, automatic attachment parsing, supplier
  contact, purchase authorization, payment, inventory, booking, customs, or
  Logistics behavior changed.

### 2026-08-11 - Extract connected supplier quote PDF terms

- Branch: `supply-os-quote-attachments`, targeting `main`.
- Task: Remove manual transcription for ordinary supplier quote PDFs without
  weakening source evidence or procurement approvals.
- Behavior: Version 2 retrieves bounded PDF content from the exact connected
  Gmail message, proposes commercial terms with one named source and exact
  excerpt per field, preserves version 1 proposals, and lets the operator
  re-extract earlier attachment-only replies.
- Safety: Office, workspace, message, account, attachment metadata, source
  evidence, request scope, user access, and capability hashes are revalidated.
  Arbitrary URLs, uploads, OCR claims, cross-source citations, and automatic
  commercial progression remain blocked. Full PDF text is not copied into the
  proposal record.
- Verification: Attachment parser, quote normalizer, Atlas sourcing, operations
  UI, continuous layout, TypeScript, and disposable PostgreSQL persistence
  tests, including provider failure, immutable retry, queue restore, stale role,
  and cross-office denial.
- Boundary: No migration, dependency, supplier contact, purchase authorization,
  payment, inventory, booking, customs, or Logistics behavior changed.

### 2026-08-11 - Add persistent supplier quote negotiation rounds

- Branch: `supply-os-quote-negotiation`, targeting `main`.
- Task: Let buyers counter a supplier quote without editing or losing the prior
  RFQ, response, or evidence history.
- Behavior: `Request revised quote` opens the existing inline RFQ editor with a
  response-specific counter-request. Saving closes the prior round as immutable
  history and creates one resumable draft round. The sourcing queue restores
  the active round and its negotiation history after navigation or refresh.
- Safety: The server requires a current qualification, exact supplier selection,
  active released cycle, recorded response hash, changed request, and optimistic
  revision. Parent-first locks, serializable retries, and stable task identity
  make concurrent retries converge without duplicate RFQs.
- Verification: Atlas sourcing, operations UI, continuous layout, TypeScript,
  diff checks, and disposable PostgreSQL lifecycle coverage including invalid
  response rejection, concurrent retry, immutable history, and queue restore.
- Boundary: No migration, dependency, supplier contact, purchase authorization,
  payment, inventory, booking, customs, or Logistics behavior changed.

### 2026-08-11 - Preserve inventory sourcing intake context

- Branch: main
- Task: Fix the procurement chat path that discarded inventory request facts and returned generic intake prompts.
- Files changed: inventory draft builder, GUILD BOM defaults, procurement workspace, supplier research validation, sourcing regression test.
- Verification: Atlas sourcing regression, company navigation regression, TypeScript, docs freshness, and production build passed.
- Failed/skipped checks: Authenticated browser verification was unavailable in the restricted runtime.
- Caveats: Supplier research still requires configured production provider credentials.
- Follow-up: Monitor the live deployment and verify the Guild item flow with an authenticated session.

### 2026-08-11 - Add client connector and client-facing integration surfaces

- Branch: `agent/client-integrations`, targeting `main`.
- Task: Add a reusable read-only OAuth REST connector, a visible lower-rail
  Settings destination, a company-scoped Integrations settings screen, and a
  public technical page at `/integrations`.
- Behavior: Admins can configure, test, enable, disable, and manually sync one
  connector per company workspace. Hourly sync publishes validated immutable
  snapshots and retains the prior snapshot on failure.
- Public handoff: The client page documents data resources, OAuth, cursor
  pagination, response envelopes, controls, and the setup checklist. It does
  not claim a Derya write API.
- Safety: Connector records contain only a deployment secret reference.
  Credentials remain server-side. Connector reads and writes preserve
  `officeId` and workspace scope. External actions remain approval-gated.
- Verification: connector contract, integrations surface contract, TypeScript,
  production build, diff checks, and changed-file U+2014 checks.
- Boundary: No live client sandbox, OAuth endpoint, credential, supplier,
  logistics provider, booking, filing, order, or spend action was used.

### 2026-08-11 - Restore Supply OS company creation in production

- Branch: `fix/supply-os-schema-company-create`, merged by PR #135.
- Root cause: Production code queried Supply OS persistence tables introduced by the 2026-08-08 migrations, but Vercel had never run `prisma migrate deploy` against the production database.
- Fix: A production-only recovery build applied pending migrations before the application build. The company creation form again accepts the official website and both inputs start empty.
- Safety: The migration set is additive, preview builds skipped the database mutation, and Vercel published only after migration and application build both succeeded.
- Verification: Recovery commit `2a76dbfbb24d398b63ad2fb79c382af7da7d1697` and subsequent connector commit `067d6f534686fd27100927e7fee540652f19ef5b` both deployed successfully with the migration hook. The one-time hook was then removed.
- Preserved behavior: GUILD remains an illustrative company with its 40-part BOM. Canonical company creation remains admin-only, office-scoped, and linked to the CRM customer record.
- Skipped: Authenticated browser verification was unavailable in the restricted runtime.

### 2026-08-11 - Isolate and enrich real company workspaces

- Branch: `fix/real-company-profile-enrichment`, merged by PR #138.
- Symptom: A newly created Unilever workspace had no logo and displayed generic demo locations.
- Root cause: Name-only creation skipped company research, and a later demo-data change routed every database workspace through the Atlas demo renderer.
- Fix: New and existing companies run attributable profile research. Stored profiles drive the real workspace name, logo, headquarters, locations, and network model. Missing research fails visibly and can be retried.
- Data boundary: Real-company inventory and demo sourcing history are empty. Atlas and GUILD data load only for explicit demo selections.
- Access: Profile research requires office-scoped workspace edit access. Reads and stored evidence remain office-scoped.
- Verification: Vercel preview and production builds passed for commit `6e913c72c0d94bc5db488a8983b812b5e5d6de76`. Source contracts cover the regression. Authenticated browser verification was unavailable.

### 2026-08-12 - Stage supply intelligence schema before runtime

- Branch: `rollout/supply-intelligence-schema`, targeting `main`.
- Commit: see git log.
- Task: Land the additive supply intelligence schema without shipping runtime
  code that would query tables missing from production.
- Files changed: Prisma schema, one transactional migration, the temporary
  production migration build hook, deployment boundary coverage, and release
  documentation.
- Safety: Preview builds skip database mutation. Production migration deploy and
  status must succeed before the application build. The connector cron remains
  configured. Tenant-scope, reference-scope, value, and append-only guards are
  created in the same transaction as the tables.
- Verification: Prisma validation and generation, deployment boundary,
  TypeScript, production build, whitespace, changed-file scope, and U+2014 scan.
- Caveat: The temporary migration hook is intentionally not permanent.
- Follow-up: Confirm the production migration, remove the hook immediately,
  then merge the supply intelligence runtime.

### 2026-08-12 - Remove the completed supply intelligence migration hook

- Branch: `rollout/supply-intelligence-schema`, targeting `main`.
- Production result: PR #140 merged and Vercel succeeded at commit
  `a361ea38bd017c418c37f1ddcc1f5a093a9225da` after migration deploy and status.
- Change: Removed the one-time production build hook. Routine Vercel builds no
  longer run database migrations, while every existing cron remains configured.
- Verification: Deployment boundary, Prisma validation and generation,
  TypeScript, production build, whitespace, conflict-marker, changed-file
  scope, and U+2014 checks.
- Follow-up: Land the separately verified supply intelligence runtime.

### 2026-08-11 - Accumulate customer and supplier supply intelligence

- Branch: `supply-os-quality-verification`, based on `main` plus the committed
  quality-verification slice.
- Task: Persist an expanding customer supply profile, reusable supplier
  universe, source-linked public prices, and benchmark metadata without mixing
  customer workspaces or overwriting prior research.
- Behavior: Selected shared workspaces now scope sourcing. Completed research
  appends customer need facts and merges stable supplier profiles. Provider
  listing claims remain linked to their source in the research result but do not
  become durable current-price observations without a server-owned retrieval
  receipt. Inventory & sourcing displays the accumulated suppliers and links.
- Safety: All new records carry office and workspace scope. Database triggers
  guard cross-tenant references. Profile facts and prices are append-only.
  Missing units, dates, shared source URLs, or public prices remain unknown and
  route to human-approved RFQ work.
- Verification: Prisma validate and generation, TypeScript, the new supply
  intelligence contract, supplier research trust contract, Atlas sourcing UI
  contract, changed-file U+2014 scan, and diff checks.
- Failed/skipped checks: Database-backed migration and sourcing persistence
  tests could not run because no disposable local PostgreSQL server was
  available. The normal `tsx` wrapper also hit sandbox IPC restrictions, so the
  equivalent Node `--import tsx` test path was used.
- Follow-up: Add an entitlement-aware benchmark connector. Use World Bank Pink
  Sheet for free monthly context and a licensed LME or CME feed when the product
  actually requires delayed or real-time exchange pricing.
### 2026-08-11 - Close Supply OS sourcing release blockers

- Branch: `supply-os-quality-verification`, PR #132.
- Fixed customer-workspace research, shortlist, procurement, Gmail, reply, and quote-extraction resolution by deriving the authorized workspace from the research run or task.
- Made research completion single-writer, failure transitions conditional on active status, future evidence dates invalid, Unicode supplier identity stable, public price tuples source-consistent, and legacy quality gates fail closed on every approval and order mutation.
- Verification passed: Prisma validation, TypeScript, Atlas sourcing, supply-intelligence, supplier-email provider, deployment boundary, diff checks, forbidden-character scan, and optimized Next.js production build with 64 generated static pages.
- A disposable local PostgreSQL cluster could not initialize because the managed sandbox denied the server shared-memory call. No production database command ran.

### 2026-08-11 - Fix supplier research progress and retry loop

- Branch: `supply-os-quality-verification`, PR #132.
- Root cause: the research screen advanced four source categories with local
  timers while the server performed one blocking public-web request. An empty
  provider result was then presented as an incomplete request with only a
  Refine request action, trapping the operator in the intake flow.
- Fix: replace simulated categories with actual lifecycle stages, disclose the
  live request scope and returned attributable source URLs, and separate Retry
  research from Edit request after an empty result. Remove automatic comparison
  navigation so returned sources remain inspectable.
- Verification: TypeScript, Atlas sourcing contract, operations UI contract,
  product-copy policy, changed-file U+2014 scan, and diff hygiene passed.
- Limitation: the in-app browser was not connected, so preview click-through and
  responsive visual verification remain required after deployment.
- Added a 40-line procurement acceptance catalog plus contract and live-provider
  runners. The catalog contract passes. Live research is currently blocked
  locally because neither an OpenAI key nor an authenticated deployed session is
  available in this workspace.

### 2026-08-12 - Make supplier research retryable and accept customer parts CSV

- Branch: `supply-os-quality-verification`, PR #132.
- Root causes: provider failures collapsed into successful empty results, retry
  did not change any effect dependency, saved failed runs re-entered intake,
  published parts did not feed sourcing, and the staged CSV workspace was not
  mounted in the selected company workflow.
- Behavior: provider failures now return typed status codes and persist FAILED;
  retry issues a new research attempt; saved inputs restore directly; exact
  checked URLs remain visible under expandable research stages; only qualified
  evidence-backed options can be suggested.
- CSV: the one-file importer accepts the founder's five-column BOM shape,
  parses quantities such as `4 blanks` and `300 m total`, preserves `As req.` as
  unknown, publishes available item facts, and routes missing delivery facts to
  clarification. Published direct demand and exploded BOM demand become
  customer-workspace sourcing rows.
- Authorization: import controls are shown only to administrators and managers;
  API edit authorization remains unchanged.
- Verification: CSV, 40-line BOM, Atlas sourcing, ingestion trust, provider
  failures, snapshot twin, operations UI, continuous layout, product copy,
  deployment boundary, TypeScript, Prisma generation, and optimized Next build
  passed. The standard `npm run build` wrapper hit the sandbox `tsx` IPC
  restriction, so its already-passed prebuild contract and the production build
  were run directly.
- Remaining release work: reconcile onto remote main, apply the supply
  intelligence migration through the controlled production migration path, run
  authenticated live research, and complete browser and deployment canaries.

### 2026-08-12 - Harden parts expansion, workspace isolation, and price freshness

- Fixed embedded workspace selection so an inaccessible fixed workspace cannot
  fall back to another customer's first available workspace.
- Scoped locally saved sourcing requests by workspace and restored the saved
  structured draft when retrying a failed research run.
- Changed one-file parts publishing from an items-only replacement to an
  immutable expansion of the latest published snapshot. The expansion retains
  locations, item metadata, BOM revisions and lines, inventory, demand,
  purchase-order metadata, supplier terms, FCC profiles, media, and source
  references. Item type and existing SKU do not get replaced by adapter
  defaults.
- Added a per-workspace advisory lock for import creation and publishing. Parts
  drafts pin their base snapshot and reject stale publication after another
  snapshot wins the race.
- Removed trust in provider-supplied observation time and disabled automatic
  application-origin fetching for public prices. Claimed listing values remain
  visible with their source, but freshness stays unknown and procurement treats
  the price as null until a managed retrieval connector verifies item identity,
  amount, ISO currency, unit, and source date.
- Applied the same downgrade inside server-side shortlist and selection
  canonicalization. Legacy completed runs cannot regain sourced price, currency,
  MOQ, or delivery terms when a buyer saves a candidate.
- Extended the immutable snapshot-copy transaction to 45 seconds inside the
  route's 60-second budget. Prisma's five-second default was too short for an
  accumulated customer twin even when a parts file contained only 40 rows.
- Focused CSV, 40-line BOM, research trust, provider failure, TypeScript,
  Prisma, diff, and optimized production-build checks pass locally. Database
  lifecycle coverage remains blocked because the managed sandbox cannot reach
  a disposable PostgreSQL server.

### 2026-08-12 - Add Exa forced-live supplier listing receipts

- Added a no-dependency Exa adapter that uses fixed Search and Contents API
  endpoints, retrieves only URLs from the current search, forces live contents,
  checks per-URL status, and caps search bytes, content bytes, record text, each
  request, and the total operation.
- Added deterministic one-record evidence validation. Exact requested identity,
  positive amount, ISO 4217 currency, unit or package basis, and one exact excerpt
  must coexist. Wrong MPNs, cross-product values, cross-record stitching,
  missing terms, cached status, invalid JSON, and oversized responses fail
  closed.
- Public result profiles use the listing hostname and no trusted supplier role;
  generated seller names and manufacturer/distributor roles stay untrusted.
- Valid receipts create managed public-retrieval evidence and append-only public
  listing price observations. The server still removes all public candidate
  commercial terms from procurement selection, so the receipt cannot become a
  quote or order authority.
- Exa is preferred only when configured. Existing OpenAI discovery remains the
  unconfigured fallback and cannot supply freshness. Cloudflare remains out of
  scope.

### 2026-08-12 - Preserve Exa discovery after content timeout

- Branch: `fix/supplier-research-timeout`, based on the latest reconciled Supply
  OS research branch.
- Root cause: Exa Search returned attributable URLs, then one forced-live
  Contents request for every result timed out. The adapter threw away the
  Search response, failed the persisted run, and returned zero source records.
- Fix: force-live content validation now covers the first three ranked results.
  A request-level Contents timeout returns all Search URLs as degraded,
  unsupported candidates with every commercial field unknown.
- Safety: Search-only results cannot create managed retrieval receipts, public
  price observations, trusted supplier roles, qualification, approval, or
  external actions.
- Regression: the Exa contract now simulates successful Search followed by a
  Contents timeout and proves that two source URLs survive while zero listing
  receipts are created.
- Verification: Exa retrieval, supplier-failure, route-lifecycle, supply
  intelligence, ingestion/research, and Atlas sourcing contracts pass. Prisma
  generation and TypeScript pass. Direct `tsx` CLI runs were blocked by sandbox
  IPC permissions, so the same scripts passed through `node --import tsx`.
- Follow-up: run authenticated production research for the GUILD equipment-deck
  plate request and confirm the screen shows retained sources even if content
  validation times out.

### 2026-08-12 - Move supplier research to durable queued work

- Branch: `codex/supplier-campaign-local`, integration worktree targeting the
  current main branch.
- Root cause: the supplier-research POST owned the provider call. The host could
  terminate that request while the client remained in a local running state,
  leaving the operator with zero sources and no durable progress to resume.
- Runtime: the route now returns HTTP 202 after persisting or reusing the run.
  The exact-run GET polls the durable record. `after()` provides a fast start;
  the protected cron advances campaigns, runs at most two workers, then
  reconciles campaign state. Claims are atomic, queued work is not stale-failed,
  and worker failures are sanitized before persistence.
- UI: the procurement workspace polls QUEUED and RUNNING status, renders saved
  terminal output, and moves long work to a clear background state after three
  minutes without cancelling it.
- Campaign: the existing run table also stores the fixed GUILD parent, child
  attempts, and aggregate results without a schema change. Thirty-eight lines
  search for three to five distinct attributable leads. GUILD-027 remains a
  quantity and unit clarification. GUILD-039 is an award documentation
  requirement. Batches, retry backoff, attempt ceilings, and daily campaign and
  office caps prevent perpetual HTTP and unbounded provider work.
- Provenance and retry: parents and aggregate artifacts now use the enforced
  QUEUED to RUNNING to terminal transitions. Retrying a failed campaign creates
  a linked immutable generation, and reconciliation reads validated aggregate
  and attempt history across that bounded lineage. Aggregate artifacts are not
  charged as provider calls. Manual retry is capped at twelve generations and
  ancestry reads reject overflow instead of silently truncating it.
- Concurrency hardening: an expiring token on the RUNNING parent fences every
  aggregate write, child enqueue, lease release, and terminal transition under
  a parent row lock. Aggregate revisions carry attempt watermarks across retry
  generations. Older work cannot overwrite newer evidence, while current
  receipt validation can persist a smaller or empty corrected aggregate.
- Quota hardening: campaign reservation and provider claim share an
  office-stable advisory lock. The UTC quota day and persisted timestamps are
  derived from `clock_timestamp()` after that lock is acquired, closing the
  midnight rollover race in the 72-call daily office bound.
- Provider and evidence boundary: campaign child work requires Exa forced-live
  validation, so a configuration change cannot silently switch it to the
  source-only OpenAI path. Generic product or material pages must also support
  distinguishing request qualifiers, including requested material grade and a
  critical dimension when present, before they count toward the lead target.
- Acceptance: the single-run deployed check now requires an explicit base URL,
  authenticated cookie, and workspace ID, expects HTTP 202, and polls the exact
  run to a terminal state. The new campaign check resumes the fixed campaign and
  requires 38 completed searchable lines with three to five attributable
  `REVIEW_REQUIRED` candidates in each aggregate run plus the explicit 027 and
  039 states.
- CI registration: worker lifecycle, client polling, retained supplier lead,
  deterministic continuous campaign, and Atlas sourcing tests now run in the
  Supply OS workflow. Server-only lifecycle execution uses the React server
  condition. Atlas uses `node --import tsx` to avoid the restricted `tsx` IPC
  path.
- Focused checks passed: `test:supply-os-bom-acceptance`,
  `test:supply-os-research-worker-lifecycle`,
  `test:supply-os-supplier-research-polling`,
  `test:supply-os-supplier-leads`, and `test:supply-os-atlas-sourcing`.
- Integration checks passed: deterministic continuous campaign, supplier lead,
  route lifecycle, worker lifecycle, polling, Atlas, BOM, Exa retrieval,
  sourcing projection, ingestion trust, product copy, TypeScript, and the
  production build. PostgreSQL-backed persistence remains delegated to CI
  because this sandbox has no database service.
- Live checks were not run because no deployed authenticated base URL, cookie,
  workspace ID, or provider credentials were available. Before release, run the
  single deployed acceptance, then the bounded campaign acceptance and monitor
  cron queue progress until it terminates.

### 2026-08-13 - Repair GUILD supplier campaign startup without weakening evidence

- Root cause: the bulk campaign required `EXA_API_KEY` before creating its
  workspace, while the UI rendered any missing workspace as active preparation.
  The existing OpenAI path exposed citations but could not create deterministic
  supplier lead receipts, so simply removing the Exa gate would have spent calls
  and retained zero leads.
- Implemented a terminal unavailable UI state with a safe campaign retry.
- Added exact EXA or OPENAI provider pinning to campaign scope, queued children,
  worker parsing, and provider routing. Runtime provider failures never trigger
  a silent switch.
- Added bounded OpenAI web discovery followed by independently pinned public-page
  retrieval and the existing deterministic supplier lead validation rules.
  Rebuilt receipts are consumed by campaign aggregation and durable supply
  intelligence, while all evidence remains PUBLIC and commercial fields stay
  unknown.
- Added parent-state and provider checks to queue listing and atomic claim so
  superseded work cannot spend provider quota after a scope revision.
- Registered the OpenAI retrieval regression in package scripts and the Supply
  OS GitHub Actions workflow.

### 2026-08-13 - Repair real supplier false negatives after public discovery

- Production symptom: GUILD-001 returned 36 attributable public-search URLs,
  including multiple relevant aluminum suppliers, but retained zero candidates.
- Confirmed root cause: the receipt validator required exact orderability facts
  to admit a material supplier. A realistic TCI Precision Metals page fixture
  proving 6061 Aluminum T6 Sheet failed without the literal requested `2.0 mm`.
  Exact URL matching also failed when a native citation added tracking-only
  query parameters, and the company/domain matcher rejected common compound or
  abbreviated supplier domains.
- Changed the material gate to require independently retrieved evidence for
  supplier identity, role, material, form, and requested alloy or temper. It
  emits only the supported material capability core. Order-specific thickness,
  finish, cutting, QA, commercial, and availability facts remain unknown.
- Added bounded company/domain aliases for leading company-name compounds and
  first-name plus trailing initials. A prefixed impersonation fixture remains
  rejected.
- Canonicalized only known tracking parameters for OpenAI native source,
  citation, proposal, and retrieval binding. Added safe zero-lead stage counts.
- Corrected the research UI to separate discovery URLs from independently
  retrieved and validated supplier pages, and to show terminal zero-lead work
  as complete rather than still researching.
- Focused supplier, OpenAI, Exa, campaign, UI, TypeScript, and diff-hygiene
  checks passed. Production still requires a new research attempt or campaign
  reconciliation after deployment to exercise the changed validator.

### 2026-08-13 - Remove reference noise from supplier discovery

- Confirmed the source-quality bug at provider intake. OpenAI copied every web
  search source into the supplier result, and Exa admitted every public URL
  before supplier relevance filtering. Later receipt validation rejected the
  junk as candidates, but too late to prevent display and retrieval-slot waste.
- Added `isSupplierDiscoveryUrl()` as the shared deterministic gate. It rejects
  known reference, community, social, academic, and public-sector domains plus
  local and IP-literal targets while preserving supplier catalogs and PDFs.
- Applied it to OpenAI, Exa, the legacy component normalizer, the steel supplier
  finder, and historical procurement research display.
- Added regressions proving mixed result sets retain supplier pages, junk-only
  sets fail closed, reference results cannot crowd out Exa supplier retrieval,
  degraded output cannot preserve Reddit or Wikipedia, and historical UI paths
  invoke the same gate.

### 2026-08-13 - Repair GUILD supplier reachability and exploration continuity

- Replaced the tautological all-line supplier test, which copied each request
  verbatim into a fake page, with sanitized supplier-style catalog fixtures and
  explicit line-specific near-miss negatives for all 38 sourceable GUILD lines.
  These fixtures test deterministic reachability and rejection, not live source
  availability.
- Kept company identity and domain binding strict while removing the redundant
  requirement that every role and capability excerpt repeat the company name.
- Added bounded role vocabulary, short-brand domain aliases, product synonyms,
  allowed-equivalent rules, and in-range numeric matching needed by the fixed
  GUILD catalog. Exact and catalog queries no longer include QA paperwork.
- Changed the campaign scheduler from a terminal nine-attempt ceiling to
  durable nine-attempt exploration epochs. Absolute stored ordinals drive query
  rotation, exclusions, UI counts, and bounded backoff.
- Added evidence-policy aggregate carry-forward across the ten-attempt database
  window and bounded aggregate artifacts to five candidates, 64 sources, and 20
  warnings per line.
- Removed the demo-date expiry and twelve-generation product limit. Cron may
  create an immutable successor only for legacy failures caused by the former
  exhaustion rules. Operator-owned failures still require intervention.
- Prevented parent terminal transitions while a child is running and preserved
  daily campaign and office provider budgets.
- Focused provider, campaign, worker, route, polling, BOM, UI, intelligence,
  TypeScript, and diff-hygiene checks passed. The real PostgreSQL persistence
  suite remains a mandatory GitHub CI gate because the local sandbox has no
  database service.

### 2026-08-14 - Add a browser-free live supplier evaluation loop

- Reproduced the old command failure: the deployed continuous-sourcing runner
  exits unless it receives a base URL and authenticated session cookie. It only
  starts and polls the database campaign, so it cannot compare providers,
  replay captures, or explain why a page was rejected.
- Added `evaluatePublicSupplierLeadReceipts()`. It preserves the exact receipt
  admission path and emits one accepted decision or the first deterministic
  fail-closed rejection for every capture record. Empty captures, source
  freshness, URL class, company/domain identity, role proof, verbatim evidence,
  content integrity, and product-profile fit now have stable codes. Diagnostics
  omit page text, excerpts, titles, query strings, fragments, and exception
  messages.
- Added `supply-os:supplier-eval`. It runs Exa and OpenAI directly against the
  canonical GUILD lines, uses the production request parser and aggregate
  revalidation, keeps separate provider ordinals, checkpoints atomically, and
  writes JSON plus Markdown scorecards with retained supplier evidence.
- A fresh both-provider run executes the same baseline attempt through both
  providers even if the first provider already returns three leads. Provider
  configuration fails before file creation. Concurrency is capped at two and
  target or retention flags cannot weaken production acceptance.
- Added deterministic CLI coverage for zero start, both-provider pinning,
  resume, interrupted attempts, key-free offline revalidation, integrity and
  request revisions, file permissions, provider failure exit codes, and exact
  38-line completion. Registered the test in package scripts and the Supply OS
  GitHub Actions workflow.
- Added no-argument help, `--help`, and a read-only `--doctor` preflight so an
  operator cannot accidentally start a 76-attempt default run while checking
  the command. Doctor validates required key presence and checkpoint
  compatibility without research attempts or file writes.
- Changed live scheduling so one retryable line/provider failure does not abort
  all independent work. Provider-wide configuration, authentication, access,
  and rate-limit failures suppress only that provider for the invocation. Any
  provider error remains visible through exit 1.
- Rotated bounded exclusion-domain windows after each nine-attempt exploration
  epoch and scheduled incomplete lines by least attempt count. The documented
  operating sequence is now a 12-attempt six-line canary followed, only after
  review, by an explicitly non-guaranteed 228-attempt full exploration cap.
- Added an owner-only checkpoint lock with heartbeat and token checks. A live
  process cannot be displaced by elapsed time, and a stale lock can be taken
  over only when the local operating system proves its recorded process is
  dead. Fresh running attempts fail closed for 15 minutes before stale resume
  may mark them interrupted.
- Sorted missing provider baselines by exact historical line/provider attempt
  count. Repeated one-attempt resumes therefore advance untouched providers and
  lines instead of retrying the first failed pair forever.
- Live provider acceptance was not run because this checkout has neither
  `EXA_API_KEY` nor `OPENAI_API_KEY`. The next operator action is the bounded
  12-attempt both-provider canary from a shell where both keys are already
  configured, followed by offline replay and evidence-driven tuning.

### 2026-08-16 - GUILD2 external workflow bridge

- Added an idempotent, tenant-scoped `derya` schema boundary in the separate
  workflow Neon database for the GUILD2 customer, copied materials, and durable
  sourcing runs.
- Replaced the GUILD page's automatic primary-database campaign start with an
  explicit web-agent dispatch. Missing trigger configuration fails visibly.
- Kept authentication on the primary database because replacing it without a
  migrated user/session model would lock users out.

### 2026-08-17 - Harden procurement commissioning boundaries

- Branch: `feat/bourne-neon-dashboard-clean`, targeting `main`.
- Task: Close the pre-preview security and demo gaps in the dashboard to Neon
  to Bourne workflow.
- Behavior: GUILD2 Source requests carry `[BOURNE TEST]`, missing wake
  configuration is visible without revealing secrets, supplier evidence is
  rendered as bounded text, and request polling remains seven seconds while
  active.
- Safety: POST bodies are limited by streamed byte count, GitHub Actions are
  SHA-pinned with read-only contents permission and no persisted credentials,
  and the database suite covers concurrent idempotency plus destructive grant
  denial.
- Verification: GUILD2, procurement, Atlas sourcing, product-copy, deployment
  boundary, TypeScript, optimized Next.js build, and diff hygiene passed.
- Failed/skipped checks: The database-backed test requires its disposable CI
  PostgreSQL services and was not run against production or a local substitute.
- Caveats: Production Neon, deployment secrets, the Bourne webhook, and Bourne
  activation remain untouched until CI and preview commissioning pass.
- Follow-up: Push the branch, require the procurement security workflow, deploy
  a preview, then provision and test temporary infrastructure before any
  production change.
