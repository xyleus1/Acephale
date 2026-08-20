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

### 2026-08-20 - Remove dashboard hydration server action

- Branch: `fix/dashboard-server-action-hook-crash`, based on production main.
- Task: Fix persistent React error #310 by removing the initial client-side
  server action that suspended Next.js App Router during hydration.
- Files changed: live event toast, authenticated latest-event GET route, Supply
  OS navigation contract, handoff, and engineering log.
- Evidence: the minified `D` frame maps to Next.js App Router, production logs
  show POST immediately after GET, and `LiveEventToast` made the matching
  `getLatestEvent` server-action call on mount.
- Verification target: Supply OS and security CI, Vercel preview and production
  builds, production request-method logs, and a fresh browser load.
- Safety: event reads remain session-authenticated and office-scoped. No send,
  purchase, booking, or customer-visible mutation is added.

### 2026-08-20 - Remove Context hook-order crash

- Branch: `fix/context-react-hook-crash`, based on production main.
- Task: Fix React error #310 on `/dashboard/supply-os` after the Context
  auto-open release changed the hook count of long-lived client components.
- Files changed: Supply OS shell, company index, two focused contracts, handoff,
  and engineering log.
- Verification target: focused Context and company-navigation contracts,
  TypeScript, production build, CI, preview deploy, and production smoke test.
- Safety: Navigation still resolves the first real office-scoped workspace.
  Tenant authorization, Context persistence, uploads, and outbound approval are
  unchanged.

### 2026-08-20 - Retire automatic production pentest seeding

- Branch: `fix/remove-production-pentest-cron`, based on current main.
- Task: Stop the five-minute Vercel cron from recreating synthetic tenant data
  in the newly unified production database.
- Files changed: Vercel cron configuration, deployment boundary contract,
  decisions, handoff, and engineering log.
- Verification: Deployment boundary, TypeScript, build, CI, production deploy,
  and post-deploy tenant counts.
- Safety: The explicit seed tool remains available for isolated test databases.
  No workflow data or supplier email behavior changes.

### 2026-08-20 - Remove database DDL from Vercel builds

- Branch: `fix/vercel-build-no-ddl`, based on production main.
- Task: Recover the failed Context hotfix deployment after Vercel attempted
  `prisma migrate deploy` with the intentionally restricted application role.
- Files changed: package scripts, deployment boundary contract, decisions,
  app-role grants, handoff, and engineering log.
- Verification: Deployment boundary, CI, preview build, and production deploy.
- Safety: Workflow-table isolation is unchanged. The app role gains only the
  six new quoted Context tables and migrations remain owner-run.

### 2026-08-20 - Open the Context chat from direct navigation

- Branch: `fix/context-opens-chat`, based on production main.
- Task: Stop `?panel=context` from highlighting Context while leaving the
  company directory visible. Resolve the first real office workspace and open
  its persistent chat, including when the current selection is demo-only.
- Files changed: Supply OS shell, company index, navigation contract, and
  release documentation.
- Verification: Company navigation contract, TypeScript, production build,
  diff hygiene, and the forbidden-character scan are required before merge.
- Safety: The fix changes navigation only. It does not send messages, upload
  files, modify schema, or change tenant authorization.

### 2026-08-19 - Harden the merged Context chat release

- Branch: `fix/context-chat-hardening-20260819`, based on main after PR #177.
- Task: Repair the evidence, upload, portal scoping, retry, pilot-gating, and
  uncertain Gmail delivery paths on the Context implementation that actually
  reached main.
- Files changed: Context agent, persistence, outbound Gmail state machine,
  authenticated routes, internal and portal chat clients, focused contracts,
  and release documentation.
- Verification: Context source contracts, TypeScript, production build, and the
  disposable PostgreSQL persistence suite are required before merge.
- Safety: No supplier message, customer message, purchase, booking, migration,
  or feature flag is executed by this change.

### 2026-08-19 - Prepare unified Neon login and workflow cutover

- Branch: `chore/unified-neon-cutover`, based on current `origin/main`.
- Task: Retire the old application database from the production path by adding
  the current Prisma schema and a fresh Dreamz login to the existing workflow
  Neon database, without weakening database roles.
- Files changed: production identity seed, restricted app-role SQL, procurement
  database CI, unified cutover runbook, integration guide, decision log, and
  handoff.
- Verification: production build, TypeScript, procurement workflow contracts,
  GUILD2 contracts, customer procurement bridge, deployment boundary, product
  copy policy, workflow YAML parsing, and diff hygiene passed locally.
- Failed/skipped checks: The disposable local PostgreSQL server could not start
  because the Mac exhausted its System V shared-memory slots before database
  creation. The existing GitHub PostgreSQL job now performs the exact combined
  schema, role, seed-idempotency, tenant-isolation, and privilege test.
- Caveats: Production database and Vercel secret changes remain intentionally
  blocked until that disposable CI job passes. The old database must remain
  untouched as rollback through production smoke testing.
- Follow-up: Push the branch, require the procurement security job, then apply
  `docs/RUNBOOKS/UNIFIED_NEON_CUTOVER.md` using the owner connection in a
  controlled shell.

### 2026-08-18 - Unify customer sourcing on Neon and Bourne

- Branch: `feat/unify-custom-sourcing-bourne`, based on current `origin/main`.
- Task: Route custom and inventory sourcing through the same customer-scoped
  Neon workflow as GUILD2 and disable the old in-application research engine.
- Files changed: Supply OS intake, dashboard and queue restoration, customer
  workflow bridge, authenticated wake retry route, legacy POST and cron routes,
  procurement contracts, tests, and architecture documentation.
- Verification: Custom bridge, procurement workflow, GUILD2, Atlas sourcing,
  legacy route shutdown, supplier-research failure, and TypeScript checks pass.
- Caveats: Historical legacy research is retained as authenticated read-only
  data. External research progress still requires the active workflow and its
  webhook secret or fallback schedule.
- Follow-up: Deploy, create one complete custom request, and confirm it advances
  from queued to supplier results without any supplier email being sent.

### 2026-08-18 - Repair custom supplier-research result routing

- Branch: `fix/custom-sourcing-run-results`, based on production `origin/main`.
- Task: Stop same-text saved research runs from opening stale state and retain
  native provider source URLs for independent validation when strict JSON has
  no inline citation annotations.
- Files changed: Supply OS dashboard keying, OpenAI supplier research, provider
  retrieval contracts, Atlas workflow contract, decision log, and handoff.
- Verification: OpenAI retrieval, supplier-research failure and lifecycle,
  polling, Atlas sourcing, product-copy, deployment-boundary, TypeScript,
  whitespace, and production build checks passed.
- Caveats: Dreamz custom sourcing uses Derya's primary saved-research worker, not
  the GUILD2 Bourne workflow. Existing failed runs remain immutable; the user
  must retry them after the fix is deployed.

### 2026-08-18 - Repair the customer sourcing workspace

- Branch: `fix/customer-sourcing-workspace-ui`, based on `origin/main` commit
  `e26fd95`.
- Task: Fix overlapping research progress copy and keep workflow implementation
  details out of the customer-facing sourcing experience.
- Files changed: Customer procurement workspace, Supply OS queue, customer
  status helpers, scoped layout styles, workflow boundary tests, decision log,
  and handoff.
- Verification: GUILD2 workflow, procurement workflow, Atlas sourcing,
  product-copy policy, deployment boundary, TypeScript, and whitespace checks
  passed.
- Caveats: The UI cannot claim or process a queued order. Worker activation,
  trigger delivery, and schedule recovery remain separate infrastructure.
- Follow-up: Verify the deployed workspace visually, then manually run the
  current queued request before enabling unattended processing.

### 2026-08-18 - Authenticate Bourne webhook wakes

- Branch: `fix/bourne-webhook-auth`, based on `origin/main` commit `2a0e01b`.
- Task: Send the separate Bourne inbound webhook secret as a server-only bearer
  credential after the procurement transaction commits.
- Files changed: procurement workflow, webhook contract tests, environment
  example, integration guide, decision log, and handoff.
- Verification: procurement workflow contract, GUILD2 boundary, TypeScript,
  product-copy policy, deployment boundary, and production build passed.
- Caveats: The webhook remains only a wake signal. Neon remains authoritative,
  and webhook failure does not roll back or delete an accepted order.

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

### 2026-07-17 - US flag toggle, lead quality triage, smart lead email

- Branch: us-rfq-sheet-panel (Conductor workspace cody, targets main)
- Commit: see git log (follow-up to PR #16, same branch)
- Task: Mert's iteration on the US leads flow: (1) US leads behind a
  Türkiye/US flag toggle instead of a stacked panel, (2) show only good
  leads by default, (3) one click emails the lead — confirmation when their
  details are complete, a missing-info request otherwise.
- Files changed: `src/lib/lead-quality.ts` (new), `src/lib/lead-emails.ts`
  (new), `src/lib/rfq-whatsapp.ts` (leadMissingQuestions/leadFirstName
  extracted), `src/lib/rfq-mail.ts` (buildLeadCustomerEmail replaces
  buildLeadConfirmationEmail; infoRequestSentAt stamp),
  `src/lib/google-sheets-sync.ts` (preserve infoRequestSentAt),
  `src/app/dashboard/rfq/page.tsx` (flag toggle labels, ?quality= chips,
  quality per row, smart confirmation preview),
  `src/app/dashboard/rfq/actions.ts` (kind-aware stamp),
  `src/components/rfq-expandable-rows.tsx` (quality pill, kind-aware card,
  per-row Confirm/Ask-info button, send column 176px),
  `src/app/globals.css`, `scripts/lead-quality.test.ts` (new),
  `scripts/lead-emails.test.ts` (new), `package.json`, docs.
- Behavior: US view defaults to Good-quality leads with Good/Review/All
  chips; deterministic scorer (contact + lane gates; commercial/size/timing/
  budget/company/commodity points; GOOD ≥ 8, REVIEW ≥ 4) with reasons shown
  on the row pill and expanded answers. Lead customer email picks
  confirmation vs info-request from the same missing-details source as the
  WhatsApp draft, in the lead's language; separate send stamps per kind,
  resync-preserved; sendable from the row or the expanded preview card.
  Nothing sends automatically.
- Verification: build clean; test:lead-quality, test:lead-emails,
  test:rfq-whatsapp, test:crm, check:docs pass; tenant-scope audit at
  baseline; prod read-only dry run of the scorer: 42 leads → 18 GOOD /
  21 REVIEW / 3 WEAK (junk lanes gated to WEAK).
- Failed/skipped checks: none.
- Caveats: quality thresholds are v1 heuristics — tune GOOD_MIN/REVIEW_MIN
  and the junk-token sets in `src/lib/lead-quality.ts` as the desk gives
  feedback. First tuning applied 2026-07-18 per Mert: explicitly commercial
  shipments (EN "yes, commercial…" / TR "evet, ticari…") are always GOOD
  (gates still apply). Second tuning same day ("not all are business
  significant"): declared-individual shipments and personal-effects moves
  cap at REVIEW; prod dry-run after both: 71 leads → 16/52/3. TR view intentionally has no quality chips (mixed with email/
  manual RFQs); lead rows there still show the quality pill.
- Follow-up: possible auto-suggest "Ignored" for WEAK leads; batch "email
  all good leads" action if the desk wants it.

### 2026-07-20 - Auto-reply to Good US leads on every sheet sync

- Branch: us-rfq-sheet-panel (Conductor workspace cody, targets main)
- Commit: see git log
- Task: Mert asked to automate the lead replies ("send the emails for good
  vs bad ones; if in doubt send only the good ones and ignore the bad").
  Policy implemented: GOOD-tier US leads get the smart customer email
  automatically after every lead sync (hourly cron + button); Review/Weak
  leads are left untouched — no auto-declines (a wrong decline to a
  mislabeled real customer costs more than silence).
- Files changed: `src/lib/lead-auto-reply.ts` (new),
  `src/lib/google-sheets-sync.ts` (containerType derived from the size
  answers; auto-reply pass wired in after lead sync; autoReplies in the
  summary; autoRepliedAt stamp preserved on resync),
  `src/lib/rfq-whatsapp.ts` (leadMissingQuestions: timing-range answers
  satisfy the ready-date question; DG probe — UN38.3/MSDS — appended for
  battery/solar/hazmat commodities, EN+TR),
  `src/lib/rfq-mail.ts` (autoRepliedAt stamp key),
  `src/components/sync-google-sheet-button.tsx` (auto-reply count),
  `scripts/lead-emails.test.ts` (timing-complete container → confirmation,
  researcher still asked, DG probe), docs.
- Safety rails: per-kind CAS send stamps (no double sends; manual sends
  block auto), open-status only, strict single-address recipient, 25 sends
  per run (hourly cron drains backlog), DERYA_LEAD_AUTO_REPLY=off kill
  switch, failures logged to sync warnings and never fail the sync.
- Verification: build clean; test:lead-emails/-quality/rfq-whatsapp/crm
  pass; tenant-scope at baseline (9). Read-only prod dry run
  (.context/auto-reply-dry-run.ts): 16 sends queued — 3 confirmations
  (Erin/roof panels, Adam Rifi/kitchen cabinets, Saygin/furniture→Mersin:
  complete, pass straight to pricing) + 13 info-requests with per-lead
  missing lists; 55 leads untouched.
- Failed/skipped checks: none.
- Caveats: confirmation copy still promises "processed within 6 hours"
  (Mert to confirm or soften); TR leads not automated; declines exist only
  as an idea, not code.
- Follow-up: possible auto-decline template for personal moves if Mert
  wants it; extend automation to TR leads.

### 2026-07-20 - Loadboard employee accounts, load assignment, admin activity log

- Branch: edmonton
- Commit: see git log (PR from edmonton → main)
- Task: Loadboard-only EMPLOYEE role (atahan@/merve@usederya.com), personal
  ("My board") vs general board tabs driven by Job.assignedToUserId, claim +
  admin-assign actions, and an AuditLog table + admin Activity-log tab that
  records who changed what on every load (status, fields, notes, claim,
  assign, create).
- Files changed: prisma/schema.prisma, prisma/migrations/20260720000100_employee_role_assignee_audit_log/,
  src/lib/audit.ts (new), src/lib/login-code.ts, src/middleware.ts,
  src/app/dashboard/{layout,loads/page,jobs/page}.tsx,
  src/app/dashboard/jobs/[jobId]/{page,actions}.tsx?ts,
  src/app/dashboard/jobs/new/page.tsx, src/app/dashboard/queue-actions.ts,
  src/lib/rfq-load-review.ts, src/components/jobs-{board,table}.tsx,
  src/app/dashboard/admin/page.tsx, scripts/create-employee-user.ts (new),
  scripts/login-code.test.ts, package.json.
- Verification: npm run build clean; scripts/login-code.test.ts passes; next
  lint on changed files shows only pre-existing issues.
- Failed/skipped checks: full lint baseline untouched (pre-existing errors).
- Caveats: creation paths no longer auto-assign the creator; middleware gates
  routes for EMPLOYEE role only (other roles unchanged); migration must run
  on prod before deploy.
- Follow-up: optionally hide financial columns from employees; audit
  coverage for decision-queue cost/revenue overrides if needed.


### 2026-07-20 - Scope/customs questions in lead emails + one-time follow-up

- Branch: us-rfq-sheet-panel (Conductor workspace cody, targets main)
- Commit: see git log
- Task: Forwarder requirement via Mert: quotes need (1) port-to-port vs
  door + exact addresses, (2) HTS code, commodity, country of origin for
  duty calculation. Ask these automatically the moment a Good lead lands,
  and follow up with every Good lead already emailed without them.
- Files changed: `src/lib/rfq-whatsapp.ts` (scope + customs questions in
  leadMissingQuestions, meta-leads rows only), `src/lib/lead-emails.ts`
  (buildLeadScopeFollowUpContent EN/TR), `src/lib/rfq-mail.ts`
  (buildLeadScopeFollowUpEmail, scopeAskedAt stamp key),
  `src/lib/lead-auto-reply.ts` (follow-up pass for already-emailed Good
  leads lacking scopeAskedAt; first-touch settles scopeAskedAt),
  `src/lib/google-sheets-sync.ts` (preserve scopeAskedAt),
  `src/app/dashboard/rfq/actions.ts` (manual info-request send settles
  scopeAskedAt), `scripts/lead-emails.test.ts`.
- Behavior: every lead info-request (email + WhatsApp draft) now ends with
  the two quoting essentials; "confirmation" kind no longer occurs for
  fresh ad leads (scope is always unknown), so first-touch is always an
  ask. Previously-emailed Good leads get one short follow-up asking only
  the two questions (subject "Two quick details to finalize your quote"),
  sent by the same hourly auto-reply pass, CAS-stamped via scopeAskedAt.
- Verification: build clean; lead-emails (rewritten cases incl. follow-up
  EN/TR, meta-leads gating), rfq-whatsapp, lead-quality suites pass; lint
  baseline only.
- Caveats: scope/customs questions are gated on parsedData source
  "meta-leads" so email/manual RFQs (which carry incoterms) are unaffected.
- Follow-up: parse lead replies into inquiry fields (currently the desk
  reads replies at oguzhan@/mert@ and edits the row).

### 2026-07-21 - Repo-wide em dash ban

- Branch: us-rfq-sheet-panel (Conductor workspace cody, targets main)
- Commit: see git log
- Task: Mert's absolute rule: never use em dashes anywhere (UI, emails,
  WhatsApp, subjects, notes, prompts, comments).
- Files changed: 123 files swept (src, scripts, prisma seeds, globals.css,
  schema.prisma comments); new `src/lib/no-em-dash.ts` (stripEmDashes +
  prompt rule constant); outbound guards in `src/lib/rfq-mail.ts`
  (SMTP), `src/lib/gmail-send.ts`, `src/lib/whatsapp.ts` (covers Cloud API
  and Green API); style rule appended to customer-facing LLM prompts
  (job-email, customer-notify, agent-chat SYSTEM); rule added to AGENTS.md
  Engineering Rules.
- Behavior: spaced em dashes became " - ", others "-", email signatures use
  "--". Dynamic text (LLM drafts, operator input, sheet data echoed into
  messages) is sanitized at every send path, so nothing outbound can carry
  an em dash regardless of source.
- Verification: build clean; lead-emails, lead-quality, rfq-whatsapp, crm,
  email-classifier, rfq-load-draft, strategy, email-labels,
  whatsapp-display, truckload-quotes, security-sop, load-check,
  carrier-vetting suites all pass.
- Caveats: historical Prisma migration SQL untouched (checksummed). En
  dashes in Meta form-data matchers are input parsing and remain.
- Follow-up: none.

### Intelligence branch history
### 2026-07-21 - Intel Phase A silo, source registry, and citation UI

- Branch: casablanca (Conductor workspace, targets main)
- Commit: not committed
- Task: Complete Phase A of the Derya Intelligence Layer by moving the
  existing load pre-flight and public market baseline behind an isolated Intel
  boundary, then make exact source provenance visible and persistable.
- Files changed: `src/lib/intel/**`, `src/app/dashboard/intel/**`, one-way
  compatibility shims under the old library/component/route paths,
  `src/lib/domestic-trucking-pricing.ts`, `src/lib/security-sop.ts`,
  `src/lib/carrier-vetting.ts`, `src/components/nav-link.tsx`, Intel tests,
  `package.json`, and required docs.
- Behavior added: `/dashboard/intel` is the canonical cited pre-flight and
  market-baseline surface; `/dashboard/market` redirects there. A typed source
  registry gates every Intel fetch and citation host. Source chips show exact
  deep links, data dates, and either cache age or manual review age. RFQ
  promotion re-runs the check server-side, remains office-scoped, stores the
  structured source snapshot, and appends a plain-text sources footer.
- Verification: Intel source, boundary, load-check, enrichment,
  market-indicator, security-SOP, carrier-vetting, and truckload-quote tests
  passed. TypeScript and the production build passed with a disposable local
  database URL. Authenticated HTTP integration rendered Intel, confirmed the
  Market redirect, ran analysis, created `DRY26070002`, and verified persisted
  source records plus the report footer in a throwaway Postgres
  database. Scoped Next lint passed for Intel-owned files and compatibility
  shims.
- Failed/skipped checks: repo-wide `npm run lint` still fails on unrelated
  pre-existing lint debt. The claimed DB-free full `test:*` premise is false:
  several existing scripts use Prisma or seed prerequisites, so the relevant
  bridge and pure-lib suites were run instead. Click-level browser visual QA
  was unavailable; source popover behavior was reviewed in code but not
  exercised by a browser automation tool.
- Caveats: this is Phase A, not the complete Intel V1. The unified question
  input, intent router, `AnswerDocument`, QCMobile integration, and standalone
  customs/carrier/lane resolvers remain Phase B. Adversarial completion-gap
  review caught an attempted deletion of six existing calendar and equipment
  checks; all six were restored with narrower copy and claim-specific CargoNet,
  FBI, TI, R+L, and National Weather Service citations.
- Follow-up: implement Phase B on top of the public Intel entrypoints, then add
  browser interaction coverage for source popovers and the four resolver
  families.

### 2026-07-22 - Hardware import research report and provider reality

- Branch: find-hardware-import-data (Conductor workspace, targets main)
- Commit: see git log
- Task: Replace the shipment-check response to a California and West Coast
  hardware-import research question with a fixed, decision-grade, sourced
  report and evaluate public versus paid company-level data options.
- Files changed: new AnswerDocument and ocean-hardware research contracts under
  `src/lib/intel/answers/` and `src/lib/intel/research/`; new report component,
  server data composer, and responsive report stylesheet under
  `src/app/dashboard/intel/components/`; source registry and source catalog;
  pure contract tests and package scripts.
- Behavior: the report leads with a direct answer, then official aggregate
  coverage, the 46-code commodity proxy, three manually verified ImportGenius
  examples, system recommendations, and a source ledger. California
  destination and West Coast gateway results remain separate. Census fetches
  are bounded to ten partitions and partial results are labeled as subtotals.
  Shipment pre-flight remains available below the report.
- Data reality: no paid provider is connected. ImportYeti is not available for
  Derya commercial use without permission or a license. Current aggregate data
  requires the free Census key; 2021-2025 history requires a scheduled
  backfill; complete importer rankings require licensed bill-of-lading data.
- Verification: all seven targeted Intel suites passed, TypeScript passed, the
  production build passed against disposable Postgres, and authenticated
  browser QA passed across phone, tablet, and desktop layouts with no runtime
  console errors or horizontal overflow.
- Follow-up: configure the Census key in the target environment, build the
  annual snapshot job, then request a narrow ImportGenius or equivalent sample
  export before buying any provider.

### 2026-07-22 - Keyless Census hardware snapshot and report upgrade

- Branch: find-hardware-import-data (Conductor workspace, targets main)
- Commit: not committed at documentation time
- Task: Replace the hardware report's runtime Census API dependency and
  missing five-year history with a validated keyless public-file snapshot,
  then make current origins, coverage, and source roles explicit in the report.
- Files changed: `scripts/build-census-public-hardware-snapshot.ts`,
  `scripts/intel-census-public-hardware.test.ts`,
  `src/lib/intel/research/census-public-hardware.ts`,
  `src/lib/intel/research/generated/census-public-hardware-v1.json`,
  `src/lib/intel/research/ocean-hardware.ts`, `src/lib/intel/sources.ts`,
  `src/lib/intel/index.ts`, the Intel hardware report components and CSS, the
  authenticated hardware data export route, `package.json`, and required docs.
- Behavior: `npm run snapshot:intel-hardware -- --as-of=YYYY-MM` downloads and
  streams official Census State Imports HS6 and Port Imports HS6 ZIPs, applies
  the declared startup-production hardware basket, resolves Schedule C country
  names, validates the compact result, and atomically writes the generated JSON
  artifact. The checked-in snapshot contains 2021-2025 revised December YTD
  totals plus May 2026 YTD for California ultimate destination and West Coast
  ports of unlading. The report now renders current-period origin rankings,
  a five-district West Coast port mix, exact file coverage, a separate
  provider-reference ledger, print controls, and a role-restricted Census JSON
  export without a runtime Census key.
- Integrity: every scope must reconcile its category, country, and geography
  row counts and all seven metrics to the scope total. Every source retains its
  ZIP SHA-256. Warm caches are reused only after Census HTTP validators,
  byte-length, and local checksum verification; `--refresh` forces clean
  downloads.
- Data boundary: 2021 contains 43 applicable codes; 2022 onward contains 46
  because 8485, 8806, and 8807 entered in the HS 2022 revision. Current origins
  and categories use only the current YTD period. Census aggregates never
  establish company identity, startup status, supplier relationships, bill of
  lading history, shipment delays, or lead quality.
- Verification: `npm run test:intel-census-public-hardware`,
  `npm run test:intel-ocean-hardware`, `npm run test:intel-sources`,
  `npm run test:intel-report-ui`, and
  `npx tsc --noEmit --incremental false` passed. The production build passed
  against disposable local Postgres. Authenticated browser QA passed at 390,
  768, and 1440 pixel widths, including zero horizontal overflow, the 17-source
  ledger, 13 source checksums, print layout, a `200` authenticated export, a
  `401` unauthenticated export, a clean 14-page letter PDF, and no runtime
  console errors. Mobile report labels render at 10 pixels or larger, and long
  origin names wrap instead of truncating.
- Caveats: snapshot refresh is manual and reviewed. A complete importer ranking
  still requires licensed company-level bill-of-lading coverage, and public
  vessel-manifest disclosure can be incomplete. Cache and route-role tests are
  still contract-level rather than injected-fetch and request-level behavior
  tests.
- Follow-up: refresh the snapshot after each new Census monthly release and
  review the artifact diff. Evaluate a narrow licensed provider sample before
  buying company-level coverage.

### 2026-07-23 - Joint hardware corridor slice and operator decision report

- Branch: `find-hardware-import-data`
- Commits: `f6425d6`, `f671e9b`, `4c19bef`
- Snapshot contract: bumped the checked-in Census artifact to schema v3 and
  added a current-only country-of-origin by hardware-category by West Coast
  unlading-district slice. The artifact stores 681 positive-vessel-value
  segments and remains under 1.3 MB.
- Validation: tuple uniqueness, declared dimensions, safe non-negative integer
  metrics across scope and every rollup, positive vessel value, containerized
  bounds, deterministic ordering, and exact four-metric reconciliation all
  fail closed. Fractional and unsafe aggregate values have regression tests.
- Domain behavior: West Coast research reports expose label-resolved corridor
  rollups with exact Port Imports HS6 and Schedule C evidence. California
  destination reports expose an empty corridor array.
- Report behavior: replaced the generic top conclusion with a three-finding
  decision brief, added a category-by-gateway matrix and ranked segment
  disclosure, separated completed years from current YTD, and made qualified
  lead count explicitly zero.
- Provider behavior: refreshed precise official ImportGenius, TradeAtlas, and
  Trademo references, added the official `w3.importgenius.com` host to the
  source allow-list, and published one identical sample and acceptance gate.
  No provider connection, account, export, or API was created.
- Visual behavior: reduced hero height and collapsed detailed evidence,
  provider references, ranked corridors, methodology, and sample acceptance
  content by default. Print opens report details before capture.
- Export behavior: the role-gated snapshot route delegates to an injected
  handler with behavioral tests for anonymous HTTP 401, employee HTTP 403, and
  authorized HTTP 200 responses. Denied requests do not read the artifact.
- Verification passed: Intel source, Census public snapshot, ocean hardware,
  Census ocean, export route, report UI, and Intel boundary suites;
  TypeScript; production build; authenticated responsive browser QA at 390,
  768, and 1440 pixels; no horizontal overflow; no runtime console errors;
  authenticated schema-v3 export with 681 segments.
- Safety: no tenant, company-brain, CRM, RFQ, job, provider, or customer-facing
  writes were added. Aggregate corridor signals remain excluded from lead
  scoring and route optimization.

### 2026-07-23 - China corridor watch and routing research brief

- Branch: `find-hardware-import-data`
- Commit: see git log
- Task: Make China to the U.S. West Coast the primary hardware intelligence
  workflow, improve the operator report hierarchy, and add deterministic
  gateway and routing-research signals without inventing a route.
- Files changed: new corridor-watch domain and tests under
  `src/lib/intel/research/` and `scripts/`; new China watch component and
  responsive stylesheet under `src/app/dashboard/intel/components/`; Intel
  report composition and hierarchy; authenticated China watch export route and
  handler; strengthened Census snapshot validation; package scripts and
  required docs.
- Behavior added: May 2026 China value, West Coast share, five gateway
  districts, 23 category-by-gateway segments, 2022-2025 comparable history,
  category-specific research posture, explicit missing routing evidence, and a
  five-gate research queue. The generic all-origin report is collapsed by
  default but remains available with its evidence ledger.
- Validation added: all four current corridor metrics reconcile exactly across
  category, country, gateway district, and grand-total views. Twelve balanced
  adversarial mutations cover every dimension and metric while preserving the
  grand total.
- Export added: `/api/intel/hardware-imports/china-watch` returns the
  deterministic watch plus routing brief to the explicit `ADMIN`, `MANAGER`,
  and `SALES` role allow-list. Anonymous, unknown-role, customer-role, and all
  three authorized paths have behavioral tests.
- Verification: Census snapshot, corridor watch, China export, full hardware
  export, report UI, and Intel boundary tests passed. TypeScript and the
  production build passed against disposable local Postgres. Authenticated
  browser QA passed at 390, 768, and 1440 pixel widths with no horizontal
  overflow and no runtime console errors after a clean reload. The downloaded
  watch contained schema v1, China origin, 23 segments, and
  `research_only` readiness.
- Failed/skipped checks: scoped ESLint could not start because this repository
  has ESLint 9 with only legacy `.eslintrc.json` configuration and no flat
  `eslint.config.*`. No live provider test was possible because no
  ImportGenius, TradeAtlas, Trademo, schedule, rate, or carrier integration is
  connected.
- Caveats: District 27 groups Los Angeles, Long Beach, Hueneme, and other
  district ports. The watch does not identify the foreign loading port, exact
  discharge port or terminal, carrier service, sailing, rate, transit
  reliability, shipment endpoints, importer, supplier, or qualified lead.
- Follow-up: choose between a licensed bill-of-lading sample for company and
  port-pair evidence or live schedule and rate inputs for route feasibility.

### 2026-07-23 - Fixed China history and customs intelligence layer

- Branch: `find-hardware-import-data`
- Commit: see git log
- Task: extend the China hardware report with comparable pre-2021 customs
  history and a deterministic, source-backed customs operating guide.
- Census data: schema v4 adds a China-only core43 slice for complete years
  2010-2025 and May 2026 YTD. It captures 34 unique State Imports HS6 and Port
  Imports HS6 ZIPs plus the Schedule C dictionary and remains below the
  1.3 MB artifact ceiling.
- Historical method: the fixed series excludes the three HS groups introduced
  in 2022. Current 46-code all-origin and category detail remains separate.
  Values are nominal customs value, not inflation-adjusted economic output.
- Historical UI: two accessible small-multiple charts show West Coast and
  California value and China share. The exact 16-year table and claim-local
  source links are available in a keyboard-accessible disclosure.
- Customs data: 47 official authority and guidance references support eight
  gates and twelve product-specific triggers. The source review order is
  controlling authority, fact-matched ruling or scope decision, current
  implementation guidance, then handbook context.
- Temporal controls: the guide stores a rule as-of date, review timestamp,
  publication date, effective range, handbook revision, and page modification
  separately. Alert order is domain data, not a hard-coded UI list. The report
  derives the next revalidation boundary from active and upcoming rules.
- Current authority snapshot: HTS 2026 Revision 12, the time-limited Section
  122 action ending July 24, the Section 301 exclusions ending November 9, and
  EPA refrigerant changes effective July 27 are represented with their exact
  temporal state as of July 23, 2026.
- Product controls: added explicit conditional screens for lithium transport,
  engines, refrigerant equipment, DOE-covered equipment, regulated solid wood
  packaging, FCC, FDA, and CPSC requirements. Charged finished equipment and
  bulk refrigerant remain separate decisions.
- Export: China watch schema v2 includes the customs guide and fixed history.
  The full authenticated Census export now returns snapshot schema v4.
- Safety: no live provider, broker, customs, customer, tenant, CRM, RFQ, job,
  or company-brain writes were added. The guide does not calculate duties or
  produce a compliance determination.
- Verification passed: focused Census, corridor, customs, China export, full
  export, ocean report, source registry, UI contract, Intel boundary, and
  TypeScript checks plus the production build against local Postgres.
  Authenticated responsive browser QA passed at 390, 768, and 1440 pixel
  widths with no horizontal overflow.

### 2026-07-23 - Live USTR refresh and report design audit

- Branch: `find-hardware-import-data`
- Commits: see git log
- Regulatory refresh: reviewed USTR's July 23 forced-labor Section 301 final
  action and added it as an upcoming July 24 rule. The model records 12.5
  percent under HTSUS 9903.05.31, Annex I and Annex II Part A exemptions, and
  the conjunctive vessel-loading, final-mode transit, and July 28 entry
  conditions without presenting any of them as shipment-ready duty advice.
- Boundary precision: exact EDT instants are separate from legal dates. The
  UI shows the next cutoff in West Coast local time and official Eastern time.
  Tests cover the second before and at the July 24 transition for both the new
  Section 301 action and expiring Section 122 action.
- Regulatory corrections: split the FCC pre-sale condition effective April
  12, 2022 from the covered-equipment amendment effective December 26, 2025.
  Split FDA medical devices from medical and non-medical radiation-emitting
  products.
- Product coverage: added direct regulation and guidance branches for general
  hazardous materials, vessel carriage, nuclear and radioactive imports, and
  EPA FIFRA pesticides and pesticidal devices. The guide now collects
  material, license, consignee, declaration, labeling, transport, and carrier
  evidence without deciding compliance.
- Trust guard: the no-duty-conclusion invariant now rejects broad shipment
  statements such as a total duty percentage while allowing a cited action's
  published rate in its authority record.
- Authority fix: controlling authority now precedes fact-matched rulings or
  scope decisions, then current implementation guidance and handbook context.
  A recently updated guidance page no longer outranks an applicable ruling.
- Responsive evidence: replaced the six-column annual table with year, West
  Coast, and California columns. Each geography contains its value, China
  share, and labeled source, and the cells stack on mobile.
- Accessibility: chart descriptions identify the solid and dashed series and
  their start and end values. Historical source targets expose 44 pixel touch
  areas and open the evidence ledger. Customs alert contrast and mobile text
  size were increased.
- Report structure: primary sections now run from 01 through 06. Supporting
  all-origin analysis is Appendix A with A1 through A6.
- Browser verification: authenticated QA covered 390, 768, and 1440 pixel
  widths, keyboard disclosures, source deep links, assistant-open desktop
  layout, and collapsed Appendix A. No horizontal overflow was found. A clean
  reload had no product console errors; later hydration warnings were isolated
  to the browser QA tool changing caret inline styles while capturing images.
- Safety: no customs determination, broker instruction, live provider call,
  CRM write, lead score, route choice, quote, or customer-facing action was
  added.

### 2026-07-24 - Read-only China ocean load review

- Branch: `find-hardware-import-data`
- Commit: see git log
- Task: turn the static China customs guide into a real-load pre-flight without
  reusing the domestic trucking contract or creating an RFQ.
- Files changed: new China shipment input, extraction, assessment, route,
  component, stylesheet, and focused tests under `src/lib/intel/preflight/`,
  `src/app/dashboard/intel/load/`,
  `src/app/dashboard/intel/components/`, and `scripts/`; Intel actions,
  entrypoints, source controls, report links, domestic-tool labeling, package
  scripts, and required docs.
- Behavior: `/dashboard/intel/load` accepts a pasted brief or manual packet,
  keeps the review in memory, and renders a fixed report before the editor.
  The report covers facts, exact dated actions, eight customs gates, twelve
  product screens, next questions, and a 47-record official source ledger.
  Print exposes source URLs and the question list can be copied.
- Extraction fallback: when Anthropic is absent or fails, a deterministic
  local parser reads only explicitly labeled shipment facts and explicit
  positive lithium or solid-wood statements. It does not infer negative
  screens, and all locally parsed facts remain supplier statements until the
  operator confirms them.
- Trust controls: the action is authenticated and contains no Prisma write.
  AI values require individual confirmation, negative screens require
  confirmed or document-backed facts, request sequencing rejects stale
  responses, unsupported origin is visible, and no output may claim duty,
  compliance, admissibility, approval, or clearance.
- Final adversarial review also fixed two fail-open paths: submitted non-ocean
  modes now remain outside the ocean workflow, and a confirmed damaged-battery
  blocker now requires confirmed provenance for both the battery screen and
  the damage claim.
- Regulatory behavior: the official source review is current through
  `2026-07-24T23:48:00.000Z`. USTR and Section 122 switch at the exact July 24
  Eastern cutoff. The in-transit fact request closes at the July 28 deadline.
  Exact controlling event, origin, HTS, value, product, filing, and evidence
  facts remain required.
- Verification: China load assessment, local extraction, China load UI, China
  customs guide, TypeScript, production build, and browser checks at 390px and
  1440px passed. The browser check found and fixed a closed editor that still
  consumed layout space.
- Caveats: no live HTS, ACE, broker, rate, schedule, bill-of-lading provider,
  persistence, filing, RFQ creation, or customer action was added. The USTR
  source is the official prepublication final notice and still requires a
  current filing-time check.
- Follow-up: test several real operator loads, record which questions create
  useful broker or supplier follow-up, then design an office-scoped saved
  review only if the workflow proves repeatable.

### 2026-07-27 - China load trial UX and authority refresh

- Branch: `find-hardware-import-data`
- Route: `/dashboard/intel/load`
- Regulatory refresh: moved the guide snapshot to July 27 while preserving
  individual source-review timestamps. Marked the published Section 122
  window expired, made the EPA July 27 date-only rule current, added the
  current July 16 FCC previously authorized covered-equipment prohibition,
  added FCC 26-50 as adopted but not yet effective, and refreshed the FCC
  Covered List metadata to July 7.
- Temporal correctness: date-only rule boundaries now participate in snapshot
  freshness. The report shows a readable legal date and says the source gives
  date only when an exact timestamp was not published.
- Review workflow: added explicit multi-select confirmation for AI and
  source-text drafts. The operator must select rows and then press a separate
  confirm action. One action rebuilds the assessment after all selected facts
  receive operator-confirmed provenance.
- Questions: replaced generic field-by-field prompts with role-owned Mert,
  supplier, and broker or importer groups. The deterministic queue preserves
  UFLPA, ISF, agency, and dated-action questions.
- Evidence: the assessment now contains the 49 authorities referenced by its
  gates, screens, and timing actions. The collapsed UI ledger shows authority
  status, type, effective window, source review, caveat, and exact report use.
  Historical handbooks are visibly historical.
- Visual QA: desktop review found stretched short question groups beside the
  long supplier list. Adding start alignment keeps each owner card at its
  natural height. Mobile and desktop layouts have no page-level horizontal
  overflow.
- Safety: the page remains read-only and nonpersistent. No exact duty,
  compliance, admissibility, approval, broker filing, clearance, RFQ, or
  customer action was added.
- Verification: focused customs, assessment, extraction, UI, report, boundary,
  source, and load-check tests passed. TypeScript and the production build
  passed. Authenticated browser QA at 1440px and 390px exercised fallback
  extraction, batch confirmation, triggered battery and wood screens, all 49
  authority records, and responsive layouts with a clean console.

### 2026-07-27 - China Intel GPT-5.6 extraction

- Branch: `find-hardware-import-data`
- Commit: see git log
- Task: Route the read-only China hardware load extractor through the existing
  server-side `OPENAI_API_KEY` and GPT-5.6.
- Files changed: `src/lib/intel/preflight/extract-china-import.ts`, the China
  load review disclosure and focused tests, `.env.example`,
  `docs/PROJECT_CONTEXT.md`, `docs/intel/NEXT_SESSION_BRIEF.md`,
  `docs/AI_HANDOFF.md`, and `docs/DECISIONS.md`.
- Behavior: OpenAI Responses API extraction uses the `gpt-5.6` alias, medium
  reasoning, `store: false`, a 45-second timeout, one SDK retry, and
  Zod-backed Structured Outputs. The existing no-key or request-failure path
  still performs conservative local parsing. The deterministic customs
  assessment and operator-confirmation boundary are unchanged.
- Verification: `npm run test:intel-china-load-extraction`,
  `npm run test:intel-china-load-ui`, and
  `npm run test:intel-china-load-assessment`,
  `npm run test:intel-china-customs-guide`, `npm run test:intel-boundary`,
  `npm run test:intel-sources`, `npm run test:docs`, `npm run check:docs`,
  `npx tsc --noEmit --incremental false`, and the production build passed.
- Failed/skipped checks: the first build attempt stopped before compilation
  because this shell had no `DATABASE_URL`. The build passed with a disposable
  local PostgreSQL-shaped URL. No live OpenAI request was made because
  credentials were not read or printed from this workspace.
- Caveats: the model drafts shipment facts only. It does not calculate duty,
  establish origin or classification, decide admissibility, promise clearance,
  persist records, or make customer-facing or broker-facing changes.
- Follow-up: test the GPT-5.6 path with one real operator load in Preview, then
  compare extracted facts against the source packet before confirming them.

### 2026-07-27 - Unified active AI runtime on GPT-5.6

- Branch: `find-hardware-import-data`
- Commit: pending
- Task: Make GPT-5.6 the reasoning model for every active AI-assisted product
  path using the existing `OPENAI_API_KEY`.
- Files changed: added `src/lib/gpt56-client.ts`, migrated all active
  Anthropic callers, removed `@anthropic-ai/sdk`, updated the authenticated
  health environment contract and current provider documentation, and added
  `scripts/gpt56-runtime.test.ts`.
- Runtime: the shared Responses API adapter centralizes the `gpt-5.6` alias,
  `store: false`, timeout, retry count, reasoning level, message conversion,
  function schemas, reasoning-item replay, and function call output history.
- Safety: deterministic freight logic, office scoping, proposal review, and
  outbound approval requirements remain unchanged. The China load extractor
  retains its stricter Zod Structured Outputs contract.
- Model exception: `whisper-1` remains only for audio transcription because
  GPT-5.6 is not the speech-to-text endpoint.
- Verification: `npm run test:gpt56-runtime`,
  `npm run test:email-classifier`, and `npx tsc --noEmit` passed before the
  final production build.
- Follow-up: exercise a real load in Preview, compare extracted fields with the
  source packet, and monitor latency and token cost before raising reasoning
  effort on high-volume classifiers.

### 2026-07-27 - Agent identity and pre-flight false-green fix

- Branch: `find-hardware-import-data`
- Commit: pending
- Symptom: production screenshots showed the desk agent claiming to be Claude
  and a model-identity question producing a green domestic pre-flight result.
- Root cause: the deployed branch did not yet contain the GPT-5.6 migration,
  model identity was left to generation, and description-only parser fallback
  could reach verdict code that treated zero blockers and risks as approval.
- Fix: centralized a deterministic GPT-5.6 identity answer, added the same
  identity boundary to the system prompt, reject unsupported pre-flight text
  with no operational facts, require lane plus cargo facts for a
  decision-ready verdict or RFQ conversion, and replaced "nothing breaks" with
  the narrower "no flagged rule conflicts" result.
- Verification: load-check regression tests, GPT-5.6 runtime tests,
  TypeScript, production build, and the original unsupported-input
  reproduction passed.
### Main branch CRM and lead workflow history
### 2026-07-22 - US lead outreach sequence + lead cards view

- Branch: us-lead-outreach-sequence (Conductor workspace yamoussoukro,
  targets main)
- Commit: see git log
- Task: Per Mert: (1) auto-email the middle-ground leads too, not just Good;
  (2) show where each lead is in the outreach process on /dashboard/rfq;
  (3) the middle tier is "Maybe" and still gets asked; (4) a drastic visual
  upgrade of the US view (big cards).
- Files changed: new `src/lib/lead-outreach.ts` (stage derivation, cadence
  0/+2d/+5d/+9d, drop grace 4d, LA send window, follow-up + qualifier copy
  EN/TR, reply excerpts), new `src/components/us-lead-cards.tsx` (card view
  replacing the sheet under ?view=us), `src/lib/lead-auto-reply.ts` (engine:
  reply detection, Good+Review first touches within a 30-day backlog,
  follow-ups 2-4, auto-drop to IGNORED), `src/lib/rfq-mail.ts` (new stamp
  keys, RESYNC_PRESERVED_PARSED_KEYS, Message-ID capture + In-Reply-To
  threading, mergeInquiryParsedData), `src/lib/lead-emails.ts`
  (extraQuestions prepend), `src/lib/lead-quality.ts` (hasCompanySignal;
  REVIEW label renamed "Maybe"), `src/lib/google-sheets-sync.ts` (preserve
  list from shared const; summary carries followUps/replies/dropped),
  `src/app/dashboard/rfq/page.tsx` (outreach state per row, live reply
  lookup, stage chips, card view swap), `src/app/dashboard/rfq/actions.ts`
  (sendNextOutreachAction, toggleLeadSequenceAction),
  `src/components/rfq-expandable-rows.tsx` (RfqOutreachDisplay type;
  EmailPreviewCard/RfqSearchBar exported; Maybe badge),
  `src/components/icon.tsx` (phone/play/pause), `src/app/globals.css`
  (lead-card styles), `scripts/lead-outreach.test.ts`, `package.json`.
- Behavior: US leads (Good + Maybe tiers) get the smart first email on sync
  (Maybe leads get qualifier questions prepended, never a processing
  promise), then up to three follow-ups spaced 2/3/4 days from the last
  outbound, sent only 07:00-19:00 America/Los_Angeles; after the final
  email sits 4 days unanswered the lead is auto-set to IGNORED. Inbound
  mail from the lead's address (landing in oguzhan@/mert@ via Reply-To/CC)
  stops the sequence and flags the card "Replied - needs action" with the
  reply excerpt. Any desk status change (pricing, custom) freezes the
  automation ("With the desk"). The US view renders cards with a 4-step
  tracker, stage chips (Replied/Waiting/Not emailed/Dropped), send-next,
  pause/resume, WhatsApp, and expandable form answers + email previews.
- Verification: tsc clean; lead-outreach (new), lead-quality, lead-emails,
  rfq-whatsapp suites pass; next build clean; lint error count unchanged
  vs baseline (101). End-to-end against a Neon copy-on-write branch of
  prod: page renders 20 Good cards, Maybe (71) chip, stage chips with live
  counts; engine dry-run with a fake SMTP password detected the 2 real
  replies (DRY26070146, DRY26070127), rolled back claimed stamps on send
  failure, and aborted after 3 systemic failures as designed.
- Failed/skipped checks: none.
- Caveats: rfq@ stays SMTP-only; reply detection relies on the OAuth-synced
  oguzhan@/mert@ inboxes (verified connected in prod). Leads older than 30
  days (DERYA_LEAD_OUTREACH_BACKLOG_DAYS) never get a first touch. The
  qualifier prepend also reaches the TR sheet's manual "Ask info" email for
  Maybe-tier TR leads (same builder); the automated sequence itself remains
  US-only. DERYA_LEAD_AUTO_REPLY=off still kills all automated sends.
- Follow-up: consider OAuth-connecting rfq@ for direct-reply capture;
  parse reply content into inquiry fields; multi-select/bulk actions on
  the card view.

### 2026-07-22 - US lead replies to rfq@, day-30 revival, oguzhan@ out of US flow

- Branch: us-lead-reply-routing-revival (Conductor workspace yamoussoukro,
  targets main)
- Commit: see git log
- Task: Per Mert: US lead replies must land at rfq@usederya.com (mert@ cc'd,
  nothing hits oguzhan@ for US); auto-dropped leads get one revival email.
- Files changed: `src/lib/rfq-mail.ts` (leadReplyToFor: US leads Reply-To
  rfq@ via RFQ_LEAD_REPLY_TO_US, TR unchanged; buildLeadRevivalEmail;
  revivalSentAt stamp + preserve key; Send-all pool excludes US leads),
  `src/lib/lead-outreach.ts` (REVIVAL_AFTER_DAYS=30, dropped stage carries
  the revival due time/detail, buildLeadRevivalContent EN/TR),
  `src/lib/lead-auto-reply.ts` (dropped-candidates query; reply detection
  widened to auto-dropped leads; revival pass, window/budget/abort shared),
  `src/lib/google-sheets-sync.ts` + `src/components/sync-google-sheet-button.tsx`
  (revivals in summary), `src/components/us-lead-cards.tsx` +
  `src/components/rfq-expandable-rows.tsx` (reply-to texts dynamic),
  `src/app/dashboard/settings/email/page.tsx` (RFQ desk mailbox row +
  setup gate: connected means refresh token, not just an account row),
  `src/app/api/auth/gmail/start/route.ts` (login hint for rfq@),
  `scripts/lead-outreach.test.ts`.
- Behavior: every US lead email (first touch, follow-ups, scope, revival)
  now asks for replies at rfq@usederya.com; TR keeps oguzhan@. Send-all
  desk forwards skip US leads entirely (57 TR rows, 0 US verified). Auto-
  dropped leads (leadDroppedAt stamp; manual ignores excluded) get one
  "still shipping?" email 30 days after the drop, threaded onto the
  original conversation; reply detection now also covers dropped leads so
  a late answer resurfaces them as Replied.
- Verification: tsc clean, build clean, lead-outreach suite extended and
  passing; on a Neon branch of prod: US replyTo=rfq@, TR replyTo=oguzhan@,
  Send-all pool 0 US leads, engine ran the new queries (fake SMTP, stamps
  rolled back, abort guard hit); settings page renders the rfq@ row as
  "reply capture off" and the replied cards render "waiting in the
  rfq@usederya.com inbox".
- Failed/skipped checks: none.
- Caveats: DEPLOY DEPENDENCY - rfq@usederya.com must be OAuth-connected
  (Settings → Email → RFQ desk mailbox → Connect, signed in as rfq@)
  right after deploy; until then new replies to rfq@ are invisible to
  detection (old in-flight leads still reply to oguzhan@, which stays
  synced). Signature on US emails still says Oğuzhan Karaca - flagged to
  Mert, not changed.
- Follow-up: SMS escalation via Twilio (needs account + A2P registration);
  bounce parsing from the rfq@ inbox once connected.

### 2026-07-26 - CRM daily outreach operating loop

- Branch: crm-status-structure (Conductor workspace phoenix, targets main)
- Commit: not committed
- Task: Rebuild the CRM contact sheet around Status, Importance, Category,
  Contact, Company, and contact details. Add a deterministic weekly pool and
  daily promotion loop for 20 Bookface, 30 LinkedIn, and 30 Email contacts,
  with explicit completion and daily progress reporting.
- Files changed: `prisma/schema.prisma`,
  `prisma/migrations/20260726000100_crm_outreach_planner/migration.sql`,
  `src/lib/contact-fields.ts`, `src/lib/crm-outreach.ts`,
  `src/lib/crm-outreach-plan.ts`, `src/app/dashboard/crm/page.tsx`,
  `src/app/dashboard/crm/actions.ts`, `src/components/contact-sheet.tsx`,
  `src/app/globals.css`, `scripts/crm-sheet.test.ts`,
  `scripts/crm-outreach.test.ts`, `scripts/crm-outreach-db.test.ts`,
  `package.json`, and docs.
- Verification: `npx prisma validate`, `npm run db:generate`,
  `npm run test:crm`, planner tests against all migrations on disposable
  Postgres, `npx tsc --noEmit`, `npm run build`, documentation checks,
  `git diff --check`, and desktop/mobile browser QA passed. Browser QA verified
  exact quota counts, required column order, manual completion without daily
  refill, forwarder exclusion, mobile action visibility, and no console errors.
- Failed/skipped checks: Targeted ESLint could not start because this repository
  has ESLint 9 but no flat `eslint.config.*`. No unrelated lint configuration
  was added. The non-strict tenant-scope audit exited successfully but reported
  eight pre-existing findings in unrelated files: five high and three medium.
- Caveats: Deploy the new Prisma migration before this build. Existing contacts
  are not eligible until they have a Personally important or Startups category
  and a Bookface, LinkedIn, or Email channel. Outreach completion records a
  touch but never sends a message.
- Follow-up: Populate the weekly pool to 140 Bookface, 210 LinkedIn, and 210
  Email contacts, then use the daily report to decide where source quality or
  response tracking needs improvement.
### 2026-07-24 - Desk Assistant grounded in the Incoming RFQs lead board

- Branch: pattaya (Conductor workspace, targets main)
- Commit: see git log
- Task: On /dashboard/rfq?view=us the Desk Assistant answered a lead-board
  question ("loads arrived last 3 days that replied to our initial email")
  from stuck jobs and an unrelated implicit-focus job. Root causes: no agent
  tool over the Meta-lead cards, and the chat had no idea what page the dock
  was on, so the implicit most-recent-job focus plus job-centric tools
  hijacked the answer.
- Files changed: `src/lib/lead-board.ts` (new pure derivation: stage chips,
  quality, live-reply rules, filters, agent/prompt shapes),
  `src/lib/lead-board-query.ts` (new prisma side: meta-lead fetch via the
  '"source":"meta-leads"' / US market markers + latestInboundByEmail join),
  `src/lib/agent-tools.ts` (list_lead_board tool + dispatch; search_inquiries
  now matches reference and fromCompany and returns reference/receivedAt),
  `src/lib/agent-chat.ts` (scopePage arg; board-page context block with live
  snapshot; suppresses implicit job focus, brain preflight, and price-intel
  prefetch on the board; SYSTEM routing for lead vocabulary),
  `src/components/agent-chat-widget.tsx` (passes pathname+query as scopePage),
  `scripts/lead-board.test.ts` (new), `package.json` (test:lead-board).
- Verification: tsc + next build clean; test:lead-board, test:lead-outreach,
  test:lead-quality pass. Read-only loadLeadBoard run against prod (Derya
  office): Good+open lens total 26 / replied 2 / waiting 24 / new 0 /
  dropped 0, identical to the live board chips; the original question yields
  5 replied leads arrived within 3 days with correct reply excerpts; TR
  market returns 249 leads.
- Failed/skipped checks: lint has pre-existing baseline errors
  (thread-actions.ts/whatsapp.ts any-types); no findings in touched files.
- Caveats: US-view snapshot maps any explicit status tab to
  status_scope=all (named in the filter label) instead of per-tab SQL; TR
  sheet snapshot lists rows without outreach derivation (list_lead_board
  market=TR covers that). No DB migration.
- Follow-up: consider a lead-board quick action in the dock's empty state;
  wire the workbench/company-brain chat surfaces to pass scopePage too.

### 2026-07-27 - Chat-first Intel workspace

- Branch: find-hardware-import-data
- Commit: see git log
- Task: Replace the static report-first Intel landing with a persistent
  full-page chat that attaches the complete sourced hardware report only after
  the relevant question succeeds.
- Files changed: `src/app/dashboard/intel/page.tsx`,
  `src/app/dashboard/intel/components/intel-chat-desk.tsx`,
  `src/app/dashboard/intel/components/intel-chat-desk.module.css`,
  `src/components/agent-chat-widget.tsx`, `src/lib/agent-chat.ts`,
  `src/lib/agent-tools.ts`, `src/lib/intel/server.ts`,
  `src/lib/intel/research/hardware-agent-brief.ts`,
  `scripts/intel-chat-first.test.ts`, `package.json`, and docs.
- Verification: `npm run test:intel-chat-first`,
  `npm run test:gpt56-runtime`, `npm run test:intel-report-ui`,
  `npm run test:intel-boundary`, `npm run test:intel-ocean-hardware`,
  `npm run test:intel-china-customs-guide`, and
  `npm run test:intel-china-load-ui` passed. Prisma generation,
  `npx tsc --noEmit`, the Next.js production build, docs freshness, and final
  diff checks also passed.
- Failed/skipped checks: Authenticated visual browser review was not available
  from the clean browser session. The production Intel route correctly
  redirected that unauthenticated session to login.
- Caveats: The attached report uses the existing validated Census snapshot.
  ImportGenius, TradeAtlas, and Trademo are still research targets, not live
  integrations. Intel chat history is client-local for the current page
  session and Intel turns skip the persistent agent event log.
- Follow-up: Test one real hardware question and one real China ocean load
  after deployment. Keep the chat answer and report claims separated from
  shipment-specific conclusions until the load facts are reviewed.

### 2026-07-29 - Email-first customer workspace

- Branch: customer-portal-strategy
- Commit: see git log
- Task: Record the customer interface strategy in the company brain and build
  the first authenticated customer portal without splitting operational truth
  away from the Freight OS.
- Architecture: Added separate office-scoped external users, passwordless login
  codes and sessions, explicit company memberships, and a pending customer
  action queue. The customer view model is an allowlisted projection over
  canonical RFQs, jobs, milestones, quote lines, and documents.
- Safety: Quote responses do not change job status or book freight. Customer
  uploads fill only requested slots and return to operator review. Documents
  require approval plus an explicit customer-visible flag. Internal cost,
  margin, notes, supplier messages, and agent reasoning are excluded.
- Operator workflow: Admins and managers can grant and revoke company access,
  acknowledge or resolve customer actions, request documents on the job, and
  publish approved files. All customer writes and operator portal decisions
  create provenance-backed memory events.
- Customer workflow: The company workspace shows RFQs, active and completed
  shipments, quote actions, milestone dates, approved files, and requested
  uploads. The read-only one-load guest page remains available with a tighter
  document boundary.
- Verification: Prisma validation, client generation, disposable PostgreSQL
  migration deployment, focused portal tests, security tests, TypeScript,
  production build, docs freshness, tenant audit, and diff checks passed. HTTP
  runtime checks proved session enforcement, company workspace rendering,
  guest and member document authorization, and customer quote acceptance
  remaining a pending action while job status stayed `QUOTED`.
- Verification limitation: The connected in-app browser control was
  unavailable, so the interface received HTTP runtime checks rather than a
  screenshot-based visual review.
- Deployment: Apply migration
  `20260729000100_customer_portal_workspace` before application deployment.
  Existing documents remain hidden until an operator explicitly publishes
  them.

### 2026-08-03 - Customer shipment control tower and tracking detail

- Branch: customer-logistics-dashboard
- Commit: see git log
- Task: Turn the authenticated customer workspace into the main customer-facing
  shipment dashboard and add a dedicated detail page for every visible load.
- Files changed: Portal workspace and shipment routes, portal styles, customer
  projection and scoped data loaders, membership hardening, focused tests, and
  customer portal documentation.
- Verification: Customer portal tests, TypeScript, Prisma validation, all
  migrations, security tests, docs checks, non-strict tenant audit, and the
  production build passed against a disposable PostgreSQL database.
  Authenticated browser QA covered login, dashboard and detail pages at 1440,
  820, and 390 pixel widths, no horizontal overflow, no console errors, legacy
  workspace redirects, unauthenticated redirects, inaccessible-load 404s, and
  quote approval remaining pending while the job stayed `QUOTED`.
- Failed/skipped checks: The in-app browser controller was unavailable in this
  session, so the checked-in browser QA runner was used. The tenant audit
  exited successfully and reported nine pre-existing suspicious queries in
  unrelated agent, search, RFQ, login-code, thread, and WhatsApp paths.
- Caveats: Shipment tracking is based on operator-recorded milestones. It is
  intentionally not described as live GPS, vessel, or carrier tracking. Portal
  invitations are still sent manually after access is granted.
- Release hardening: Customer quote lines now come only from `Job.quoteLines`,
  never the legacy internal-note fallback. The customer document route rejects
  arbitrary remote URLs before the shared document streamer can fetch them.
- Release hardening verification: `npm run test:customer-portal`,
  `npx tsc --noEmit`, and `git diff --check` passed.
- Follow-up: Apply the customer portal migration, grant a pilot customer access,
  and verify the same flows on the deployed URL before calling this production
  ready.

### 2026-08-03 - Read-only operator preview of the customer workspace

- Branch: customer-logistics-dashboard
- Commit: see git log
- Task: Let an authenticated operator open the actual customer dashboard and
  shipment pages instead of seeing only the portal sign-in or access form.
- Files changed: Customer portal admin page and styles, workspace and shipment
  routes, portal styles, preview authentication and navigation helpers, focused
  tests, decision record, and handoff documentation.
- Security: Preview requires an internal admin or manager session, resolves the
  selected company with both `id` and `officeId`, and constructs a temporary
  member-shaped principal without writing customer identity or access records.
  Customer mutation server actions still require a real customer portal
  principal. Preview renders quote and upload controls disabled.
- Verification: Customer portal tests, TypeScript, Prisma validation, security
  tests, docs checks, the non-strict tenant audit, and the production build
  passed. All migrations applied to a fresh disposable PostgreSQL database.
  Browser QA verified the admin launcher, real workspace, and shipment detail
  at 1280, 768, and 375 pixel widths with no horizontal overflow or console
  errors. Anonymous access redirected to login, a sales role redirected to the
  dashboard, the valid same-office preview returned 200, and an invalid company
  returned 404.
- Failed/skipped checks: None. The tenant audit still reports nine known
  unrelated baseline warnings and reports no finding in the new preview path.
- Caveats: Preview is intentionally read-only and does not impersonate a real
  customer session. It shows the member experience, not customer-admin account
  management behavior.
- Follow-up: Deploy, open `/dashboard/customer-portal`, choose a real company,
  and verify its current shipment records before sharing customer access.

### 2026-08-03 - Customer portal design and audience entry points

- Branch: customer-logistics-dashboard
- Commits: `e919164`, `cfec4cd`, `8dc441a`, `434aa46`
- Task: Replace the templated customer portal presentation with a calmer
  freight operations interface and make customer versus staff access explicit.
- Customer entry: `/portal` now has a dedicated customer sign-in layout, a
  new-shipment email route, and a Derya team sign-in link. `/login` links
  customers back to the shipment workspace.
- Customer workspace: Replaced icon tiles, gradients, nested rounded cards,
  and decorative reassurance copy with a compact status summary, shipment
  rows, direct action language, and record-like shipment detail.
- Staff workflow: `/dashboard/customer-portal` now exposes the customer
  sign-in URL, a company-scoped `View as customer` flow, member-specific
  sign-in links, and labeled access fields.
- Safety: Preview remains read-only, admin or manager only, and scoped by
  `officeId`. No schema, dependency, membership, session, or shipment-state
  behavior changed.
- Verification: Customer portal tests, TypeScript, Prisma validation, security
  tests, docs checks, the non-strict tenant audit, and the production build
  passed. Browser review covered customer and staff surfaces at desktop and
  mobile widths with no horizontal overflow.
- Baseline note: The tenant audit still reports nine unrelated findings.
  Browser inspection of disabled controls injected temporary inline styles and
  produced hydration mismatch messages; no application exception was found.
- Deployment: No migration or environment change is required. Merge and deploy
  the branch, then use `/portal` for customers and
  `/dashboard/customer-portal` for staff access management and preview.

### 2026-08-04 - Public customer design sandbox

- Branch: customer-logistics-dashboard
- Commit: see git log
- Task: Add a stable `/customer` route for rapid founder review without portal
  authentication or Vercel branch-preview access.
- Implementation: Added a fictional customer overview and shareable shipment
  detail states. The sandbox reuses portal styles and deterministic status and
  milestone projection, while keeping all quote, upload, and file controls
  disabled.
- Security: The page is `noindex, nofollow`, imports no Prisma or portal-auth
  loader, and never reads tenant, company, shipment, or document records.
- Verification: Customer portal tests and TypeScript passed. Both the overview
  and `?shipment=dry-2608-014` returned HTTP 200 locally, and rendered output
  included the fictional-data disclosure and `noindex` metadata.
- Local review: Start Next.js on the Conductor workspace port and open
  `/customer`. The active workspace used port 55050.
- Deployment: No migration, dependency, or environment change is required.
  Public production visibility still requires merging and deploying the branch.

### 2026-08-04 - Customer operations brief and shared overview

- Branch: `customer-logistics-dashboard`
- Commits: `db89590`, `2d7db55`
- Task: Make the customer workspace useful as an outsourced freight operations
  surface and remove the remaining generic dashboard structure.
- Domain logic: Added `buildCustomerPortalOperationsBrief`, a pure helper over
  `CustomerPortalShipment`. It derives date-based schedule watch items, recent
  customer-safe activity, and document readiness without new database reads.
- UI: Added `CustomerOperationsOverview` and reused it from both
  `/portal/workspace` and `/customer`. The page now prioritizes customer
  actions, one next milestone per load, active shipments, shared updates, open
  requests, and delivered records.
- Safety: Existing office and company query scoping is unchanged. Hidden
  documents and internal freight data remain outside the view model. Customer
  writes still create review actions and do not execute freight operations.
- Design QA: Browser checks passed at 1440, 820, and 390 pixel widths with no
  overflow or console errors. Customer action links and shipment detail were
  checked directly.
- Verification: `npm run test:customer-portal`,
  `npx tsc --noEmit --incremental false`, and `git diff --check` passed before
  documentation updates.
- Deployment: Pending merge to `main`. No migration, dependency, or environment
  change is required.

### 2026-08-06 - Publish Supply OS through the main sidebar

- Branch: crm-status-structure (Conductor workspace phoenix, targets main)
- Commit: see git log
- Task: Make the standalone Supply OS v0.5 prototype discoverable from the
  authenticated product and publish the reconciled result to main.
- Files changed: `src/app/dashboard/layout.tsx`,
  `scripts/supply-os-prototype.test.ts`, the existing `src/app/supply-os`
  prototype, `package.json`, and handoff documentation.
- Verification: `npm run test:supply-os-prototype`,
  `npm run test:customer-portal`, `npx tsc --noEmit --incremental false`, the
  production build with non-secret placeholders, `git diff --check`, and the
  changed-text em dash scan passed. The production route table contains the
  static `/supply-os` page.
- Failed/skipped checks: The first TypeScript pass used stale generated Next
  route types from before the main merge and rejected `/portal` redirects. The
  build regenerated route types, and the unchanged TypeScript command then
  passed. Authenticated browser QA of the dashboard sidebar was not run because
  the local runtime has no disposable database session; the focused test
  verifies the exact rendered navigation declaration.
- Caveats: The main dashboard sidebar opens a standalone synthetic prototype
  with its own sidebar. It does not read or write office data and does not
  execute freight, customs, supplier, or customer actions.
- Follow-up: After deployment, sign in with a non-employee account, click
  `Supply OS` under Commercial Workflow, and confirm `/supply-os` loads.

### 2026-08-06 - Integrate Supply OS and replace the decorative map

- Branch: crm-status-structure (Conductor workspace phoenix, targets main)
- Commit: see git log
- Task: Correct the standalone green Supply OS prototype by placing it inside
  the authenticated dashboard, preserving the product palette, using real
  geography, and reducing generic dashboard styling.
- Files changed: the dashboard navigation and brand, the legacy Supply OS
  redirect, a new dashboard Supply OS route and workspace, the focused test,
  and handoff and decision documentation. The old standalone component and
  stylesheet were removed.
- Verification: `npm run test:supply-os-prototype`, `npm run
  test:load-route-map`, `npm run test:customer-portal`, TypeScript, the
  production build with non-secret placeholders, `git diff --check`, and the
  changed-text em dash check passed. Local visual review covered desktop and
  390 pixel widths in the dashboard shell.
- Failed/skipped checks: Authenticated browser review used a local-only shell
  harness because the workspace has no disposable authenticated session. The
  harness was removed before commit. Route authentication and the compatibility
  redirect were checked separately.
- Caveats: Every supplier, quote, route, event, and score in this workspace is
  synthetic. Natural Earth provides real geography, but lanes are modeled and
  are not live vessel, container, or carrier tracking.
- Follow-up: Replace synthetic records only after office-scoped supplier,
  product, lane, quote, and approval contracts are accepted.

### 2026-08-06 - Rebuild Supply OS as an enterprise map control tower

- Branch: crm-status-structure (Conductor workspace phoenix, targets main)
- Commits: `395cc3c`, `194639b`
- Task: Make Supply OS resemble an enterprise maritime operations product while
  keeping Derya's current dashboard shell and color system.
- UI: Replaced the sparse map and decisions-card layout with a split operating
  console. The left pane now shows exceptions, exposure, quote-source coverage,
  active modeled movements, and the selected workflow. The right pane is a
  full-height Natural Earth map with search, filters, analysis modes, risk areas,
  route focus, zoom, modeled milestones, and a selected-movement inspector.
- Interaction: Selecting one of four modeled POs updates the workflow, route
  emphasis, status, and inspector. The Supply map tab expands the same map and
  preserves the shared selection and filters.
- Data boundary: Real geography and coordinates remain deterministic and
  checked in. Every movement, route, date, cost, status, milestone, and risk
  area is synthetic. The UI states that no live AIS or GPS feed is connected.
- Safety: No database, tenant, provider, server action, or external write path
  was added. Existing approval and execution boundaries are unchanged.
- Design QA: Browser review covered 1280, 768, and 375 pixel widths. Search,
  movement selection, map modes, layer filters, route focus, and zoom worked
  without console errors. A local dashboard-shell harness was removed before
  commit.
- Verification: `npm run test:supply-os-enterprise-design`, `npm run
  test:supply-os-prototype`, `npm run test:load-route-map`, `npm run
  test:customer-portal`, TypeScript, the production build with non-secret
  placeholders, `git diff --check`, and the changed-text em dash scan passed.
- Follow-up: Connect the surface to office-scoped canonical supplier, product,
  lane, quote, shipment, and approval records only after those contracts are
  approved.

### 2026-08-06 - Replace the Supply OS command demo with customer-case generation

- Branch: crm-status-structure, targeting main
- Commit: see git log
- Task: Start Supply OS from a customer description, generate one coherent
  sourcing and logistics dashboard, and let the operator save and reopen demo
  cases.
- Files changed: deterministic case model, Supply OS workspace and scoped
  stylesheet, page metadata, three Supply OS regression tests, package script,
  decisions, engineering log, and handoff.
- Behavior: one prompt now produces normalized customer facts, supplier and
  gateway nodes, conditional customs checkpoints, route legs, supplier search
  briefs, indicative forwarder comparisons, risks, customs readiness checks,
  and missing questions. Results scroll into view and can be saved in versioned
  browser storage.
- Trust boundary: no CRM company is created or linked. No Prisma, server action,
  provider request, booking, filing, message, or customer publication was
  added. Missing and inferred facts stay marked for confirmation or review.
- Local persistence: browser keys include `officeId` and `userId`, stale-tab
  saves merge against current storage, storage failures remain non-fatal, and
  legacy unscoped demo keys are removed rather than ambiguously migrated.
- Route trust: unresolved geography stays unmodeled. Domestic and intra-EU
  lanes omit import customs, Mexico-US lanes use a border-road model, Pacific
  routes wrap at the date line, and destination-specific checks avoid applying
  US rules to non-US imports.
- Verification: Supply OS model, prototype, design, and prior command-model
  tests pass with TypeScript and the production build. Browser QA covered the
  example, a separate medtech company, missing inputs, save and reopen, refresh
  persistence, route-node selection, and desktop, tablet, and mobile overflow.
- Caveats: local browser storage is for the demo only. It is namespaced by
  office and user but is not shared or protected by server-enforced tenancy.
  Production persistence needs office-scoped cases, immutable snapshots,
  server-created provenance, explicit CRM linking, and customer-safe projection.
- Follow-up: validate the demo with customers before adding shared persistence
  or live supplier, rate, customs, and forwarder adapters.

### 2026-08-06 - Split and simplify Supply OS customer cases

- Branch: crm-status-structure, targeting main
- Commit: see git log
- Task: Separate case generation from saved customer dashboards and remove
  planning internals from the default customer-facing view.
- Files changed: separate dashboard, generator, and browser-storage modules;
  new authenticated generator route; simplified shared stylesheet; updated
  Supply OS UI regression tests; decisions, engineering log, and handoff.
- Behavior: `/dashboard/supply-os/new` builds and reviews a customer case, then
  saves and opens it. `/dashboard/supply-os` browses saved customers and shows
  only the selected route, map, expected cost and transit, end-to-end legs,
  customs, risks to verify, and three next actions.
- Data compatibility: the version 1 case serializer and movement-scoped
  operating-plan engine were not changed. Existing scoped browser saves remain
  readable. Detailed provider, connector, evidence, invoice, and supplier data
  stays available in the engine but is no longer dumped into the customer page.
- Verification: Supply OS prototype, design, case-model, operating-plan, and
  command-model tests pass. TypeScript and the production build pass.
  Authenticated browser QA covered
  the empty state, separate generator, example extraction, save and reopen,
  movement switching, desktop, tablet, and mobile layouts, page overflow, and
  console errors.
- Failed/skipped checks: no live provider, customs, carrier, terminal, rate,
  booking, or customer-publication path was exercised because this remains a
  deterministic browser-saved prototype.
- Caveats: the dashboard is not a server-enforced customer projection and does
  not persist outside the current browser. Human approval and existing
  operational trust boundaries are unchanged.
- Follow-up: validate the simpler hierarchy with customers before adding a
  separate operator evidence drill-down or shared office-scoped persistence.

### 2026-08-06 - Make Supply OS sell operational ownership

- Branch: supply-os-operating-ownership, targeting main
- Commit: see git log
- Task: Make the generated customer case immediately show that Derya can run
  the full supply chain or one selected module, especially for robotics and
  hardware startups.
- Files changed: optional case engagement scope, new deterministic engagement
  plan and test, generator scope selector, customer dashboard, scoped design,
  Supply OS regression tests, package script, decisions, log, and handoff.
- Behavior: the Atlas demo now maps inbound components from Shenzhen to Austin
  production and outbound finished robots from Austin to Detroit and
  Nashville. Five workstreams cover sourcing, supplier coordination, inbound
  movement, customs, and finished-goods delivery. Coverage choices save to the
  browser case and survive reload. The three kickoff inputs and offer copy
  change with the selected module instead of presenting cosmetic scope buttons.
- Topology: new cases separate company location from the production or
  receiving site, including the San Francisco headquarters and Austin factory
  case. Multi-source flows state that component allocation is unconfirmed.
- Trust boundary: the customer page no longer shows modeled prices, first-in-
  array provider assignments, static gateway recommendations, or a broker name
  as if selected. It asks for three kickoff inputs, states the broker approval
  boundary, and keeps operational handoffs collapsed by default.
- Persistence and customs: scope changes merge against current browser state,
  including the latest same-customer record. Failed writes do not alter the
  visible plan, cross-tab scope changes sync,
  and domestic or unknown lanes no longer display import-specific broker copy.
  Customs scope evaluates supplier-to-production and production-to-customer
  legs separately, and incomplete networks stay unknown unless an import is
  unavoidable.
- Location integrity: headquarters-only production assumptions create an open
  confirmation question, and specific city aliases win over generic region
  text so San Francisco does not inherit Los Angeles coordinates. Product-use
  language does not become a confirmed production site.
- Scope integrity: collapsed execution details include only the selected
  module, while full-operation cases show both inbound and finished-goods
  handoffs. Domestic and unknown cases omit import-only broker steps.
- Verification: engagement-plan, case-model, prototype, enterprise-design,
  operating-plan, and command-model tests pass. TypeScript passes. Authenticated
  browser QA covered generator scope, save, reopen, scope persistence, network
  flow selection, workstream drill-down, execution disclosure, desktop, and
  390-pixel mobile with zero page overflow.
- Build: the production Next.js build passes with the local test database
  configuration.
- Failed/skipped checks: no supplier, provider, broker, customs, rate, booking,
  or messaging integration was called because this remains a browser-local
  scoping prototype.
- Caveats: detailed provider and cost models still exist in the internal
  planning engine. They require current attributable evidence before any
  customer-facing reuse.
- Follow-up: validate the operating-ownership framing with robotics founders,
  then persist office-scoped cases before connecting live supplier, quote,
  broker, and shipment records.

### 2026-08-06 - Add evidence-backed company research to Supply OS

- Branch: supply-os-company-research, targeting main
- Commit: see git log
- Task: Turn a company name, website, or operating description into a sourced
  customer presentation instead of changing only the displayed company name.
- Files changed: new authenticated company-research API and research service,
  optional research provenance on the browser case, generator and presentation
  flow, company identity and research surfaces, presentation-mode shell rules,
  regression tests, package scripts, decisions, handoff, and engineering log.
- Verification: company-research, case-model, prototype, enterprise-design,
  engagement-plan, operating-plan, and command-model tests pass. TypeScript and
  the production build pass. Authenticated browser QA covered the unavailable
  research state, explicit local fallback, full-width 1440-pixel presentation,
  official company logo, source disclosure, inferred inputs, real map, and a
  390-pixel layout with no horizontal overflow.
- Trust boundary: provider-attributed URLs are the citation allow-list. Public
  research cannot confirm suppliers, lanes, rates, customs treatment, or
  providers unless a retained source directly supports the claim. Operational
  hypotheses remain `verify` facts and all commitments retain human approval.
- Security: the metadata fetch occurs only after the official website matches
  a returned web-search source. It rejects credentials, local or private
  address resolution, unsafe redirects, non-HTML responses, over-large bodies,
  and cross-domain logo candidates.
- Failed/skipped checks: no live research request ran locally because the local
  server did not have `OPENAI_API_KEY`. No supplier, provider, broker, customs,
  booking, filing, rate, or message action was called.
- Caveats: research is a bounded useful-company brief rather than a complete
  mirror of every public page. Saved customer cases are still scoped browser
  records, not shared or durable server records.
- Follow-up: configure the deployment key, verify one live company request in
  production, then persist the sourced research packet as an office-scoped
  record before enabling customer publishing.

### 2026-08-07 - Repair Supply OS controls and make company research resilient

- Branch: supply-os-light-gray, targeting main
- Commits: cc487dc, 2ee2011, 8114746
- Task: Fix collapsed generator buttons, lighten the Supply OS palette, expose
  meaningful company-research progress, and stop provider outages from killing
  website-backed demos.
- UI: the engagement grid now clears its floated legend and measures at full
  card width. The palette uses a lighter neutral graphite scale with deliberate
  borders and no decorative highlights. The generator renders a compact trace
  for verified, active, inferred, and failed research steps.
- Research transport: the authenticated route streams newline-delimited JSON
  progress and result events. The browser client incrementally publishes those
  events to the active generator and preserves the existing research-first
  planning order.
- Resilience: an explicit public website enables a same-domain fallback when
  the OpenAI key is absent, the provider call fails, no attributable sources
  return, or structured normalization fails. The fallback reads at most four
  selected official pages and returns a partial, sourced research packet.
- Extraction: official metadata and JSON-LD provide identity, descriptions,
  logos, addresses, and products. Product page titles add bounded product
  context without treating marketing headings as products. Deterministic
  industry patterns generate likely-input hypotheses.
- Safety: SSRF checks, public DNS validation, same-domain redirects, HTML-only
  responses, byte caps, timeouts, source limits, and the existing human
  approval boundary remain in force. Prompt-provided locations are inferred,
  not relabeled as verified facilities.
- Verification: all Supply OS tests, the new research-progress regression test,
  TypeScript, and the production build passed. Authenticated browser QA covered
  AON3D website-only success, actionable no-website failure, desktop and mobile
  scope controls, official source disclosure, logo extraction, and customer
  location confirmation.
- Caveat: provider-backed live public search was not exercised locally because
  the disposable server intentionally had no `OPENAI_API_KEY`. That absence was
  used to verify the new official-site fallback end to end.

### 2026-08-07 - Fix production Supply OS stream cutoff

- Branch: hotfix-supply-research-terminal, targeting main
- Symptom: the AON3D example emitted only `Searching public sources`, then the
  browser reported that research ended without a dashboard result.
- Root cause: a configured model key made explicit-website prompts enter the
  slower public-search call first. The production function ended while waiting
  on that upstream call, outside the route's normal result and error events.
- Fix: select `official_site` before `public_search` whenever the prompt has a
  valid public website. Retain public search as recovery if the official site is
  unreachable, and cap name-only model calls at 20 seconds with zero SDK
  retries.
- Regression coverage: `selectCompanyResearchStrategy()` is tested for website,
  name-only configured, and unavailable cases.
- Fresh reproduction: an AON3D request with an intentionally invalid model key
  returned the official name, website, four sources, and six progress events in
  1.6 seconds.

### 2026-08-07 - Make name-only company research terminal and correct

- Branch: `fix/supply-os-research-quality`, targeting `main`
- Commits: `de33b50`, `eb85d15`, `dc7e9e4`, `fa62a03`
- Symptom: `do nox metals` emitted early progress, then production ended the
  stream without a dashboard.
- Root cause: name-only prompts still made provider-backed public search the
  prerequisite for the first usable result. A host cutoff could therefore
  occur outside the route's result and error handling.
- Research fix: generate likely domains from the company name, inspect each
  with bounded SSRF-safe official-site requests, score identity evidence,
  reject parked or mismatched domains, and keep model search as optional
  secondary enrichment. The browser also converts any remaining timeout or
  malformed stream into a saved description-based dashboard.
- Quality fix: split likely materials into `Needs` and geographic origins into
  `Sources`. With no origin or destination, the map shows only the verified
  facility and asks for a real endpoint.
- Design fix: replace the dark graphite field with light-gray and white
  surfaces, reduce the generator height, simplify explanatory copy, collapse
  workstream details by default, and remove supplemental content on mobile.
- Regression coverage: official-domain candidate generation and ranking,
  parked-site rejection, Nox `.co` selection, research strategy ordering,
  automatic fallback, metals inputs, source-region separation, and expandable
  workstream semantics.
- Verification: all eight Supply OS test scripts, `npx tsc --noEmit
  --incremental false`, the optimized production build, and authenticated
  desktop/mobile browser QA passed. Clean browser reload showed no console
  errors.
- Caveat: public domain discovery is a bounded heuristic, not a company master
  data service. The user can provide the official website when a name is
  ambiguous.

### 2026-08-07 - Build the Supply OS company optimization engine

- Branch: `feat/supply-os-optimization-engine`, targeting `main`
- Product: Replaced the passive customer dashboard with a supplier-to-customer
  network, selected-node dossier, ranked action queue, kickoff inputs, and
  collapsed evidence section.
- Design: Removed the corner logo tile, tab underlines, decorative effects, and
  mixed highlight colors. Added a light neutral system with one operational
  navy accent, flatter rows, deliberate dividers, and responsive map layouts.
- Inference: Added deterministic profiles for metals, robotics, additive
  manufacturing, aerospace, medical devices, chemicals, automotive, and
  industrial hardware. Each profile supplies plausible source markets,
  customer markets, cargo, movement modes, confirmation steps, and five
  workstream actions.
- NOX: Added capability-matched upstream candidates for aerospace plate mills,
  Great Lakes buffer stock, and Southern Ontario alternates, plus regional and
  national buyer profiles. Every candidate remains labeled as inferred and not
  a known relationship.
- Navigation: Added authenticated routes for procurement, supplier contact,
  shipment planning, customs, and fulfillment or 3PL. Routes carry the
  browser-local case identifier and contain no execution side effects.
- Research: Added bounded visible-address extraction for relevant official
  pages and protected the parser from treating an alloy number as the street
  number.
- Tests: Added `test:supply-os-optimization-engine`, rewrote the prototype and
  enterprise-design assertions for the new product shape, and extended company
  research coverage for visible addresses.
- Review fixes: Preserved third-party public evidence as a separate provenance
  class, kept all non-customer-confirmed movements inferred, and made the
  original customer prompt authoritative for profile selection. Added profile
  coverage for every deterministic industry branch.
- Verification: Nine Supply OS suites, TypeScript, scoped lint, the optimized
  production build, and authenticated desktop, tablet, and mobile browser QA
  passed. Full-repository lint still reports the pre-existing unrelated lint
  backlog.
- Safety: No schema, dependency, secret, environment, supplier, booking,
  customs filing, message, or spend mutation was introduced.

### 2026-08-07 - Replace the Supply OS report with a fixed command map

- Branch: `feat/supply-os-command-map`, targeting `main`
- Product: Replaced the scroll-based saved-customer report with a compact
  header, physical-flow object rail, full map canvas, selected-object dossier,
  and bottom status strip. The supported desktop and presentation view has no
  document scroll.
- Map: Added React MapLibre and MapLibre GL JS with the OpenFreeMap Positron
  style. Routes use GeoJSON layers, map controls come from MapLibre, operational
  symbols come from Lucide, and menus and tooltips come from Radix.
- Interaction: Supplier, movement, customs, factory, distribution, and customer
  objects expose hover contact cards and persistent click selection. The
  selected dossier shows cargo, evidence basis, candidate providers, readiness
  checks, one next action, and a case-scoped workstream link.
- Network detail: Added deterministic candidate coverage for DHL Global
  Forwarding, Uber Freight, Livingston International, and Farrow. Added an
  explicit Windsor-Detroit customs object for inferred U.S.-Canada movements.
  Provider selection now follows the actual modeled movement: Farrow appears
  only on U.S.-Canada work, China ocean movement omits domestic truck capacity,
  and domestic sites do not receive an irrelevant customs broker. All contacts
  and lanes remain unassigned planning candidates.
- Resilience: Added a WebGL 2 capability gate so unsupported browsers retain
  the route list and dossier instead of entering the application error
  boundary. Basemap connection failure also leaves the operating objects
  available.
- Case parsing: Added exact Ferndale, Michigan coordinates and descriptor
  extraction for prompts such as `NOX Metals is a Ferndale, Michigan metals
  service center`, which restores factory, lane, and customs generation in the
  description-only fallback. Negative coverage prevents `China-focused
  supplier` from becoming a false headquarters, keeps Ferndale inside the U.S.
  customs territory, and classifies Laredo, Texas as U.S. geography before the
  generic Mexico border alias.
- Tests: Added `test:supply-os-command-map` and rewrote the prototype and design
  assertions around the fixed map-first surface. Extended case-model coverage
  for Ferndale extraction.
- Browser QA: Authenticated NOX Metals creation produced three suppliers,
  Windsor-Detroit customs, the Ferndale site, two customer clusters, provider
  contacts, and workstream navigation. The page measured 720 pixels of content
  in a 720 pixel viewport with no document scroll and no console errors after
  reload. The headless browser lacks WebGL 2, so it verified the fallback while
  the live map path remained build and test verified.
- Safety: No database schema, secret, environment, supplier, booking, customs
  filing, message, or spend mutation was introduced.

### 2026-08-07 - Restore the Supply OS basemap and deepen company analysis

- Branch: `fix/supply-os-map-analysis-v2`, targeting `main`.
- Root causes: the map depended on one nested vector-style resource graph and
  did not recover from partial style failures; Radix collision handling pulled
  the coverage menu back over the right inspector; logo extraction treated a
  social image or generic `company-logo` carousel as company identity; the map
  view discarded most fields from the optimization engine.
- Map fix: made CARTO raster the first provider, added bounded remount fallback
  through CARTO Positron and OpenFreeMap Positron, marked the raster ready on
  source content, preserved the WebGL fallback, and retained the route and
  provider planning boundary.
- UI fix: moved the coverage menu fully left of the inspector with a stable
  Radix alignment offset, added Radix tabs for object detail and company
  optimization, and kept the fixed one-viewport layout at 1280 by 720 and 2048
  by 1100.
- Identity fix: ranked JSON-LD and visible brand assets above icons, ignored
  social-preview images and unlabelled customer-logo carousels, corrected empty
  HTML attribute parsing, and normalized saved SEO-tagline names before model
  generation.
- Analysis fix: added measured outcomes to every action and expanded the
  advanced-aircraft profile to eight controls across BOM, demand, serial kits,
  production lanes, supplier industrialization, customs, gateway selection,
  and field logistics. Added UK or European propulsion supply, U.S. mission
  systems, international customs handoffs, and conditional Oman, Fiji, and
  European deployment nodes.
- Regression coverage: exact Odys hero-photo versus logo fixture, customer-logo
  carousel versus favicon, SEO-title normalization, advanced-aircraft network
  and action set, international broker selection, Radix analysis surface,
  basemap fallback, and menu positioning contract.
- Browser QA: GPU-enabled Chrome rendered the real CARTO basemap, zero document
  overflow, zero console errors, and a non-overlapping coverage menu. A live
  Odys research run returned the official logo and the eight-priority operating
  model. The separate headless browser correctly retained the no-WebGL fallback.
- Safety: No schema, secret, external supplier action, booking, customs filing,
  message, or spend mutation was introduced.

### 2026-08-07 - Add selectable transport paths and lane decision support

- Branch: `feat/supply-os-route-intelligence`, targeting `main`.
- Fixed route loss when public research supplied a recognizable operating city
  without normalized coordinates. The fallback is bounded to known cities and
  preserves the original evidence basis and confidence.
- Added endpoint-aware domestic and cross-border road modes so a robotics or
  hardware profile cannot label Phoenix-to-Tulsa as air or ocean freight.
- Promoted each movement into a first-class route object with a mapped
  optimization priority, carrier candidates, and an optional deterministic
  road-cost envelope.
- Added official public candidate records for Stewart Transport, Knight
  Transportation, Dependable Supply Chain Services, Universal Logistics, Old
  Dominion Freight Line, and C.A.T., plus existing global forwarder, truck,
  and customs candidates. Cards expose source links, phone numbers, addresses,
  capabilities, and endpoint relevance.
- Added projected route geometry over the maintained MapLibre basemap. Solid
  route lines update on map move and resize. A narrow native button follows
  each line, preserves map panning outside the lane, supports keyboard focus,
  and opens the matching movement dossier.
- Added Recharts Sankey and bar views for network flow, lane flow, and modeled
  price range. No custom geography, map symbol set, or proprietary visual asset
  was introduced.
- Verification: ten Supply OS suites, TypeScript, optimized production build,
  and GPU browser QA at 1280 and 2048 pixels passed. Browser QA confirmed lane
  click selection, pointer affordance, local contact detail, zero viewport
  overflow, and zero console errors.
- Tooling note: scoped ESLint is blocked by the repository's ESLint 9 plus
  legacy config mismatch and duplicate Next plugin resolution inside the nested
  Conductor worktree.
- Safety: No schema, tenant scope, secret, outbound message, live quote,
  booking, customs filing, supplier award, or spend mutation was introduced.
### 2026-08-07 - Supply OS directional route corridors and carrier depth

- Replaced straight route presentation with 33-point quadratic corridors that
  stay connected during map movement and resize.
- Added a MapLibre GeoJSON route source plus visible projected casing and core
  geometry, repeated Lucide direction markers, and 24-pixel direct hit segments.
- Curved route clicks select the exact movement object and update the existing
  transport-leg inspector.
- Expanded deterministic carrier candidates for Tulsa, Phoenix, Los Angeles and
  Long Beach, Quebec, and Ontario. Added broader Schneider, J.B. Hunt, and
  ArcBest road alternatives.
- Updated command-map, prototype, and enterprise-design regression tests for
  connected curved geometry, direct hit targets, direction markers, and carrier
  depth.
- GPU browser QA at 1440 by 900 and 2048 by 900 confirmed a live basemap, six
  direction markers for two lanes, direct line selection, nine Tulsa-to-Phoenix
  carrier candidates, no viewport overflow, and no console errors.

### 2026-08-07 - Supply OS gateway marker correction

- Aligned customs dossier coordinates with the rendered customs handoff for
  ocean, air, and cross-border road routes.
- Moved lane controls onto the primary transport segment to avoid overlap with
  border controls.
- Added Taiwan gateway routing for Kaohsiung and Taoyuan.
- Preserved the complete AON3D fallback when the user enters only the company
  name or official domain.
- Verified the command-map regression suite, TypeScript, optimized production
  build, diff hygiene, and the repository em-dash prohibition.
### 2026-08-07 - Add evidence-gated steel supplier discovery

- Branch: steel-supplier-finder, targeting main
- Commit: see git log
- Task: Add an authenticated Supplier Finder for steel-sector raw material,
  fuel, semi-finished, and finished-product sourcing, with protected private
  origin context and public-source evidence gates.
- Files changed: supplier search domain and API route, dedicated dashboard
  page and scoped styles, sidebar navigation, regression test, package script,
  durable decision, engineering log, and handoff.
- Verification: focused supplier-search regression, TypeScript, optimized
  production build, diff hygiene, and changed-file U+2014 checks pass.
- Failed/skipped checks: live public search was not executed because it depends
  on the deployed `OPENAI_API_KEY` and would introduce changing external data
  into a deterministic implementation check.
- Caveats: candidates are not reliable, approved, sanctioned-clear,
  financially verified, allocated, or ready to contract. Private notes are
  browser-local and are not encrypted shared office storage.
- Follow-up: add office-scoped candidate records and a reviewed diligence
  workflow before enabling supplier outreach or award actions.

### 2026-08-07 - Keep generated Supply OS networks connected

- Fixed the generated-company path that could show supplier and customer
  points while silently dropping every lane because the operating site lacked
  normalized coordinates.
- Added low-confidence provisional map placement for unresolved facilities,
  explicit source regions, and destinations. The placement remains labeled as
  an assumption and never upgrades the underlying evidence basis.
- Preserved customs objects for lanes whose modeled mode explicitly says
  cross-border or international, even when one endpoint country is unknown.
- Added a regression for a NOX-style research result with no location data.
  The case now produces five connected lanes, visible route segments, and a
  customs handoff instead of zero lanes.

### 2026-08-07 - Gate map signals by evidence and relevance

- Added route-linked map insights derived only from official or public
  research findings with attributable URLs. Matching requires a shared cargo
  or location token with a rendered route, and the map is capped at three
  signals to preserve legibility.
- Expanded company research to request dated, current material, freight,
  customs, port, tariff, congestion, and capacity evidence after official-site
  verification. Cost direction requires a cited comparison or time series,
  and live-rate language requires a current lane-specific source.
- Preserved the official-site result as the fallback when public research
  times out, returns no attributable sources, or fails normalization.
- Removed repeated non-selected lane labels, the empty MapLibre navigation
  control, the full-width disclaimer sentence, and the redundant rate bars.
  Flow charts and warning lists now render only when their data shape warrants
  them.
- Added `scripts/supply-os-evidence-insights.test.ts` for provenance,
  route-relevance, legend copy, chart gating, and map-control regressions.
- Verification: new evidence test, command-map test, company-research test,
  diff checks, em-dash scan, and optimized production build passed.

### 2026-08-08 - Consolidate the product into Supply OS

- Made Supply OS the default and sole primary navigation destination, with
  materials, suppliers, scenarios, logistics, and tracking in one shell.
- Added tenant-scoped PostgreSQL persistence for shared office workspaces,
  normalized CSV imports, immutable published snapshots, product structures,
  inventory, demand, media, evidence, decisions, approvals, and action tasks.
- Connected published snapshot data to the product twin with deterministic BOM
  buildability calculations and explicit missing-data states.
- Added the typed `supply-os/v1` capability DSL and concrete capability
  contracts for ERP ingestion, product mapping, supplier and shipper discovery,
  compliance, sourcing, logistics, tracking, and controlled execution.
- Added deterministic proposal and action hashes, role-gated approvals,
  self-approval protection, immutable approved decisions, and release only to
  `READY` without external side effects.
- Integrated office-scoped market evidence into scenario decisions and
  redirected the standalone Supplier Finder and Market pages into Supply OS.
- Added `docs/SUPPLY_OS_ARCHITECTURE.md` and
  `docs/SUPPLY_OS_LEGACY_EXTRACTION.md` for durable architecture and cutover
  boundaries.
- Verification: focused UI, snapshot, persistence, DSL, execution, TypeScript,
  diff hygiene, and prohibited-character checks passed. Disposable integration
  databases were removed after verification.

### 2026-08-08 - Cut Supply OS over to full-width product chrome

- Branch: supply-os-grand-vision, targeting main
- Commit: see git log
- Task: Remove the obsolete one-link sidebar, make Supply OS panels URL-backed,
  move shared data controls into a modal, and constrain the workspace to the
  available viewport.
- Files changed: dashboard layout, Supply OS operating shell and styles, panel
  routing helper and regression, single-surface regression, package scripts,
  engineering log, and handoff.
- Verification: single-surface, shell-routing, product-twin, and snapshot-twin
  tests pass. TypeScript and diff hygiene pass. Authenticated browser checks at
  1440 by 900, 1024 by 768, and 390 by 844 found zero page overflow and no
  console errors. Panel query state, browser history, modal open, and Escape
  close behavior were exercised.
- Failed/skipped checks: the in-app browser controller was unavailable, so the
  repository headless browser was used against a disposable local database.
- Caveats: legacy operator detail routes remain available until their workflows
  have equivalent Supply OS panels or drawers.
- Follow-up: harden employee scope and snapshot-bound approvals before adding
  more decision UI.

### 2026-08-08 - Harden Supply OS workspace and snapshot trust boundaries

- Branch: supply-os-grand-vision, targeting main
- Commit: see git log
- Task: prevent restricted employees from inheriting office-wide workspace
  access and prevent approvals or action release against stale supply data.
- Files changed: Supply OS persistence and execution services, integration
  regressions, engineering log, and handoff.
- Verification: persistence and execution integration tests pass against
  disposable PostgreSQL databases. TypeScript, diff hygiene, and the
  changed-content prohibited-character scan pass.
- Caveats: database-level composite tenant and snapshot consistency guards
  remain a separate migration. Future external executors must recheck the
  current snapshot immediately before performing a side effect.
- Follow-up: add database consistency constraints, then build the deterministic
  multi-level planning engine without treating missing commercial data as zero.

### 2026-08-08 - Enforce Supply OS reference scope in PostgreSQL

- Branch: supply-os-grand-vision, targeting main
- Commit: see git log
- Task: make tenant and snapshot reference integrity a database invariant
  instead of relying only on application query discipline.
- Added a forward migration that rejects cross-office company and user links on
  workspaces, memberships, imports, snapshots, and aliases. It also rejects
  BOM, inventory, demand, and media references outside the exact owning
  snapshot.
- Added integration coverage for a foreign-office member, a foreign-office
  workspace creator, and an inventory item borrowed from another snapshot.
- Verification: the full migration chain deploys into a fresh PostgreSQL
  database. Persistence and execution integration suites, Prisma validation,
  TypeScript, diff hygiene, and changed-content prohibited-character checks
  pass.
- Follow-up: treat the deterministic planning engine and visual product twin as
  the next parallel product checkpoints. Database safety is no longer the
  excuse for leaving the main page visually static.

### 2026-08-08 - Harden Supply OS ingestion and component research

- Branch: agent3/data-ingestion-supplier-intelligence, integrated into
  supply-os-grand-vision
- Expanded the normalized snapshot contract to eight CSV types with header
  detection, explicit mappings, malformed-row locations, deterministic row
  ordering, templates, reference and cycle checks, unit and coordinate checks,
  inventory freshness, and optional purchase-order, supplier-term, and
  compliance datasets.
- Registered CSV, SAP, and Oracle behind one adapter contract. SAP and Oracle
  remain explicitly unavailable and hold no connector credentials.
- Added deterministic product identity resolution. Exact identifiers may
  resolve automatically; lexical and optional vector candidates remain human
  review proposals and cannot publish inferred BOM edges.
- Added component-scoped supplier research with citation filtering, common
  evidence envelopes, freshness, official-domain checks, no-source
  degradation, role-qualified provider gates, approval scope checks, bounded
  research fetch policy, and rate limiting.
- Added a forward migration that keeps missing inventory quantities and BOM
  scrap rates nullable instead of silently converting them to zero.
- Verification: focused CSV, identity, research, supplier, DSL, lane,
  suppression, intelligence-map, persistence, and execution suites passed.
  All migrations deployed into fresh PostgreSQL databases. Prisma validation,
  touched-path tenant audit, TypeScript, production build, and diff hygiene
  passed.
- Caveat: optional purchase-order, supplier-term, and compliance rows are
  immutable snapshot metadata in this slice. They need dedicated relational
  models when execution or cross-snapshot querying is implemented.

### 2026-08-08 - Add deterministic Supply OS planning and scenario results

- Branch: agent2/deterministic-planning-engine, integrated into
  supply-os-grand-vision
- Task: Build the server-owned planning brain without changing Supply OS UI or
  dashboard routes.
- Added a pure engine for multi-level BOM explosion, shared-component and
  facility constraints, dated demand coverage, shortage dates, commercial and
  evidence completeness, cash exposure, FCC review state, and deterministic
  scenario recommendation order.
- Added canonical snapshot supplier terms and FCC profiles, workspace-approved
  equivalence rules, an expected inventory receipt date, and an append-only
  planning result with reproducibility hashes.
- Added a strict server loader that rejects client-authored rank, cost,
  feasibility, lead time, and unsupported request fields. It computes stale
  state by comparing immutable results with the latest published snapshot.
- Added focused acceptance coverage for deep BOMs, scrap, optional lines,
  shared components, shortage dates, assembled buys, alternate suppliers,
  approved and unapproved substitutes, unknown commercial fields, row-order
  determinism, cycle and unit rejection, FCC blocking, result immutability,
  stale snapshots, and client trust boundaries.
- Verification: focused tests, tenant audit, Prisma validation, TypeScript,
  fresh migration deploy, production build, diff hygiene, and prohibited
  character scan. See the current handoff for exact command status.
- Follow-up: teach customer-specific ingestion adapters to populate canonical
  supplier terms, FCC profiles, and distinct receipt-date positions.

### 2026-08-08 - Cut legacy operator navigation over to Supply OS

- Branch: supply-os-grand-vision, targeting main
- Commit: see git log
- Task: stop rendering legacy module entry pages as competing products while
  preserving engines, side-effect boundaries, and utility surfaces.
- CRM and Search now enter Materials; RFQ and Outreach enter Suppliers; Intel,
  Intelligence, Brain, Pricing, and Reports enter Scenarios; Jobs, Loads,
  Carriers, and Domestic Pricing enter Logistics; Inbox and Activity enter
  Tracking.
- Old Supply OS builder and workstream URLs also return to panel state in the
  single workspace. Query and prior-path context remain available for future
  drawers.
- Navigation-only redirects leave server actions, APIs, background workers,
  admin, settings, authentication, and the customer portal intact.
- Verification: legacy route, single-surface, and panel-routing regressions,
  TypeScript, and diff hygiene pass.
- Follow-up: replace unreachable page wrappers with redirect stubs and remove
  UI-only dependencies after import analysis.

### 2026-08-08 - Remove the first obsolete legacy page implementations

- Branch: supply-os-grand-vision, targeting main
- Commit: see git log
- Task: stop compiling unreachable legacy operator interfaces after the route
  cutover, without deleting reusable engines or server actions.
- Replaced Dashboard home, Activity, Brain, Carriers, CRM, Domestic Pricing,
  Inbox, Outreach, Pricing, Reports, and Search page implementations with typed
  Supply OS redirect stubs.
- Removed roughly 7,700 lines of obsolete page UI while retaining action files,
  domain logic, APIs, admin, settings, and customer portal surfaces.
- Production build confirms the retired routes now use the shared minimal
  redirect bundle instead of their former page-specific bundles.
- Verification: legacy-route and single-surface regressions, TypeScript,
  production build, and diff hygiene pass.
- Follow-up: extract and retire the remaining Intel, Intelligence, Jobs, Loads,
  RFQ, builder, and workstream page wrappers without breaking embedded engines.

### 2026-08-08 - Restore the Supply OS operator sidebar and network map

- Branch: supply-os-sidebar-map, targeting main
- Added a persistent Supply OS navigation rail without restoring Deal Desk,
  CRM, RFQ, Outreach, Intel, or other retired product navigation.
- Promoted the existing MapLibre command map to the second primary destination
  and added direct map shortcuts in both the rail and command header.
- Added an explicitly illustrative Atlas Robotics network fallback for clean
  browsers so the restored map does not open to a dead end. Saved browser cases
  still win and the fallback is not written as shared office truth.
- Removed broken New Customer links that pointed at a retired redirect route.
- Added Motion for React for navigation, panel, modal, hover, and tap feedback,
  with user reduced-motion behavior enabled.
- Responsive behavior keeps the labeled rail on desktop, an icon rail on
  medium viewports, and a compact horizontal navigation strip on narrow
  viewports.
- Verification: sidebar-map, shell-routing, single-surface, product-twin, and
  command-map tests pass. Prisma generation, TypeScript, production build, and
  diff hygiene pass.
- Bundle note: Supply OS first-load JavaScript increased from 312 kB to 354 kB,
  about 13.5 percent, which remains inside the prior 15 percent release limit.

### 2026-08-08 - Remove Supply OS copy and control bloat

- Branch: supply-os-copy-cleanup, targeting main
- Commit: see git log
- Task: Keep the restored Supply OS product surface while removing repeated
  labels, generic narration, and redundant controls from its primary panels.
- Files changed: dashboard and root layouts, Supply OS shell, product twin,
  snapshot adapter, shared-data dialog, decision signals, supplier search,
  scoped shell styles, product copy check, UI contracts, handoff, and
  engineering log.
- Verification: product copy, sidebar, operations UI, snapshot, scenario,
  supplier search, production build, diff whitespace, and changed-file U+2014
  checks pass.
- Failed/skipped checks: no authenticated browser session was available for a
  post-change click-through. The production build and source-level UI contracts
  are the verification evidence.
- Caveats: operational facts, warnings, provenance, demo status, and approval
  boundaries remain visible. No behavior, schema, dependency, or external
  action changed.
- Follow-up: none.

### 2026-08-08 - Reduce the account menu to sign-out only

- Branch: fix/account-menu-signout-only, targeting main
- Commit: see git log
- Task: Remove product, admin, settings, identity, and language controls from
  the authenticated dashboard account dropdown.
- Files changed: dashboard layout, logout button, global menu styles,
  single-surface regression coverage, handoff, and engineering log. The unused
  language-toggle component was deleted.
- Verification: single-surface regression, TypeScript, diff whitespace, and
  changed-file U+2014 checks pass.
- Failed/skipped checks: browser click-through was not required for this
  source-level menu contraction.
- Caveats: the underlying authentication, admin, settings, and customer portal
  routes remain unchanged. Only the dashboard account menu entry points were
  removed.
- Follow-up: none.

### 2026-08-08 - Remove repeated product labels and mismatched rail icons

- Branch: supply-os-copy-cleanup, targeting main
- Commit: see git log
- Task: Remove the product suffix from the authenticated navbar, remove the
  repeated workspace heading, and make the five primary sections text-only.
- Files changed: dashboard layout, operating shell, scoped responsive styles,
  sidebar and single-surface regression checks, handoff, and engineering log.
- Verification: single-surface, sidebar-map, shell-routing, operations UI,
  product-copy, TypeScript, production build, and diff hygiene checks pass.
- Failed/skipped checks: the in-app browser had no attached tab, so no
  authenticated screenshot or click-through was available.
- Caveats: internal route names and component identifiers remain unchanged.
  No product behavior, schema, dependency, approval rule, or external action
  changed.

### 2026-08-09 - Define the app-wide airy system and zero-fluff copy rule

- Branch: main
- Commit: not committed
- Task: Make the Pallet-inspired direction materially more modern and airy,
  remove non-operational narration, and make the rules durable for future
  agents.
- Files changed: `DESIGN.md`, `AGENTS.md`, `docs/DECISIONS.md`,
  `docs/AI_HANDOFF.md`, and this engineering log. The revised interactive
  Logistics review artifact remains outside the repository.
- Verification: preview JavaScript parses, Quick Look rendered the revised page
  at 1600px, prohibited preview phrases are absent, changed lines contain no
  U+2014 character, and diff whitespace checks pass.
- Failed/skipped checks: application tests and build were not run because no
  production code, dependency, schema, or runtime behavior changed.
- Caveats: this task defines the system and review artifact. Existing product
  screens have not yet been migrated to the new tokens and geometry.
- Follow-up: after visual approval, implement shared tokens and primitives, then
  migrate Supply OS as the reference production surface.

### 2026-08-09 - Apply the approved airy system across production surfaces

- Branch: main
- Commit: not committed
- Task: Make the full app follow the approved 80 percent airy, 20 percent
  operational design and keep interface copy strictly functional.
- Files changed: the root layout and design layer, Supply OS shell and panel
  styles, customer and supplier surfaces, both sign-in routes, UI contract
  tests, product-copy enforcement, project context, handoff, and this log.
- Verification: product-copy, Supply OS single-surface, shell-routing,
  sidebar-map, company-navigation, continuous-layout, operations UI, scenario,
  enterprise-design, customer-portal, TypeScript, production build, desktop and
  mobile public-route browser inspection, console inspection, diff whitespace,
  and changed-line U+2014 checks pass.
- Failed/skipped checks: authenticated Supply OS browser inspection was not
  possible because the checkout has no usable local database. Documented demo
  logins failed and read-only pentest verification reported database access was
  denied.
- Caveats: no schema, dependency, domain behavior, tenant scope, approval rule,
  or external action changed. The existing legacy stylesheet remains in place;
  the canonical design layer loads after it to provide the migration boundary.
- Publication: pushed `main` to GitHub and verified the Vercel deployment
  completed successfully. The production sign-in page changed from the legacy
  `Derya Supply OS` grid treatment to the approved airy system.
- Follow-up: complete an authenticated browser pass at desktop, tablet, and
  mobile widths when an attached user session or valid test account is
  available.

### 2026-08-09 - Rewrite every visible Logistics element

- Branch: main
- Commit: pending
- Task: Remove legacy visual inheritance from the Logistics page and rebuild
  the complete surface with the approved airy system.
- Files changed: Supply OS page, operating shell, command map, dashboard style
  routing, dedicated Logistics CSS module, sidebar contract test, handoff, and
  this engineering log.
- Integration: rebased onto the concurrently merged fixed-map-grid work and
  styled its bounded map panel, horizontal context rail, and persistent
  inspector inside the same dedicated module.
- Verification: authenticated browser review at 1440px, 768px, and 390px found
  zero legacy workspace classes, zero interactive targets below 44px, and zero
  horizontal overflow. Product-copy and ten Supply OS UI contract suites,
  TypeScript, production build, diff whitespace, and changed-file U+2014 checks
  pass.
- Failed/skipped checks: the headless browser does not expose WebGL 2, so visual
  QA exercised the explicit map fallback instead of the live renderer.
- Caveats: no domain behavior, data model, tenant scope, approval rule,
  dependency, or external action changed.
- Follow-up: verify the authenticated production route after deployment when a
  valid production test session is available.

### 2026-08-09 - Replace the Atlas Robotics monogram with an official logo

- Branch: main
- Commit: pending
- Task: Replace the synthetic-looking `AR` company mark in the built-in Atlas
  Robotics demo row and persistent company ribbon with a real company logo.
- Files changed: demo company identity module, Supply OS operating shell,
  company index and styles, company-navigation contract, handoff, and this log.
- Source: the official Atlas Robotics site publishes
  `https://www.atlas-robotics.com/icon.svg` and identifies it as the company
  logo in same-domain structured metadata.
- Verification: the official asset returned HTTP 200 with `image/svg+xml`;
  company-navigation, product-copy, TypeScript, diff whitespace, and
  changed-diff U+2014 checks pass.
- Failed/skipped checks: the in-app browser had no attached tab, so desktop and
  mobile rendered inspection was unavailable.
- Caveats: initials remain as a broken-image fallback. The official demo logo
  cannot leak into real workspaces that do not have stored media.
- Follow-up: inspect the authenticated company index and ribbon in an attached
  browser before the next production release.

### 2026-08-09 - Set the browser identity to Derya

- Branch: main
- Commit: pending
- Task: Change the favicon and browser tab identity to Derya.
- Files changed: root metadata, primary Supply OS page metadata, generated app
  icon, single-surface contract, handoff, and this log.
- Behavior: the root title is `Derya`, child route titles use `Derya` as the
  brand suffix, and the primary Supply OS workspace uses the exact tab title
  `Derya`. The official mark now renders on a padded neutral tile and receives
  a new generated icon hash.
- Verification: single-surface, product-copy, TypeScript, production build,
  generated production HTML, icon response headers and PNG signature, original
  64px icon inspection, diff whitespace, and changed-diff U+2014 checks pass.
- Failed/skipped checks: the in-app browser had no attached tab, so browser
  chrome was not inspected directly.
- Caveats: route-specific pages outside the primary workspace keep useful page
  names with `Derya` as their suffix. No application behavior changed.
- Follow-up: verify the deployed tab after the next production release.

### 2026-08-09 - Reconcile restrained motion with the Logistics rewrite

- Branch: main
- Commit: pending
- Task: Apply the final state-motion finding after the Logistics rewrite and
  fixed-map-grid integration landed.
- Files changed: Supply OS dashboard, dedicated Logistics styles, retired
  workspace styles, enterprise-design contract, handoff, and this log.
- Integration: cherry-picked `5f281b0`, retained its `useReducedMotion` guarded
  React transitions, and moved its CSS feedback from the retired workspace
  module into the live dedicated Logistics module.
- Verification: enterprise design, operations UI, fixed map-grid, product-copy,
  TypeScript, production build, diff whitespace, and changed-diff U+2014 checks
  pass.
- Caveats: motion is limited to 150ms opacity and 3 to 4px position changes.
  Reduced-motion users receive no entry animation.

### 2026-08-09 - Replace Derya mark and remove final Supply OS holdovers

- Branch: main
- Commits: `de42eeb`, `603fb21`, `42545a2`, `a67f3e0`, and `a99362f`
- Task: Replace the invented Derya pictogram with the official identity mark,
  then iteratively inspect and correct every remaining visual regression on the
  Supply OS company and Logistics surfaces.
- Files changed: shared Derya logo component, app icon, Supply OS operating
  shell responsive rules, company directory component and styles, handoff, and
  this engineering log.
- Verification: authenticated browser review of the company directory, open
  company form, Logistics workspace, sign-in page, and customer portal.
  Logistics passes at 1440px, 768px, and 390px with zero legacy workspace
  classes, zero interactive targets below 44px, and zero horizontal overflow.
  Product-copy, Supply OS company-navigation, sidebar-map, single-surface, and
  enterprise-design contracts, TypeScript, production build, diff whitespace,
  and changed-file U+2014 checks pass.
- Failed/skipped checks: the headless browser does not expose WebGL 2, so the
  explicit map fallback was reviewed instead of the live renderer.
- Caveats: no data, schema, domain behavior, tenant scope, approval rule,
  dependency, or external action changed.
- Follow-up: recheck the public sign-in surface after the production deployment
  completes. Authenticated production Supply OS still requires a valid
  production session.

### 2026-08-09 - Turn Opportunities into a scenario workbench

- Branch: main
- Commits: `4d00cd9` and `e965548`
- Task: Replace the barren Opportunities map copy with runnable Supply,
  Logistics, Production, and Network scenarios.
- Files changed: Supply OS dashboard, dedicated Logistics styles, new scenario
  contract, decisions, handoff, and this engineering log.
- Behavior: each play exposes the current condition, change, missing inputs,
  modeled output, measure, decision, evidence state, and approval boundary.
  Running a play updates the output and brings it into view on narrow screens.
- Verification: new opportunity-scenario contract, scenario-viewport,
  continuous-layout, enterprise-design, operations-UI, product-copy, and
  TypeScript checks pass. The production build passed against disposable local
  PostgreSQL. Authenticated browser QA passed at 1440 by 1000, 1024 by 900, and
  390 by 844 with no horizontal overflow or console errors.
- Failed/skipped checks: scoped ESLint could not start because the repo uses
  ESLint 9 without an `eslint.config.js`, `.mjs`, or `.cjs` file.
- Caveats: output is deterministic planning guidance from the current company
  model. It does not execute a supplier, carrier, customs, or spend action.
- Follow-up: connect persisted canonical planning results when the server-owned
  planning API exposes them to this workspace.

### 2026-08-09 - Add the Supply OS automation draft workspace

- Branch: main
- Commits: `939a0ad`, `35c2ac8`, `f576b34`, `dec7520`, and `c9b6faf`
- Task: Add Automations as the sixth Supply OS tab with chat-led workflow
  drafting and replace the repeated generic Boxes icon.
- Files changed: panel routing, operating shell, dashboard switch, new
  automation component and styles, Supply OS icon maps, regression contract,
  package script, decisions, handoff, and this log.
- Behavior: operators can inspect five built-in automation drafts, select one,
  add steps or an approval gate through chat, and create a new browser-session
  draft. The right pane always exposes the selected step sequence and inactive
  state.
- Verification: automation, routing, sidebar, continuous-layout,
  enterprise-design, operations-UI, product-copy, TypeScript, desktop browser,
  and mobile browser checks passed. No horizontal overflow or undersized
  interactive target was found on the new surface.
- Existing failure: `test:supply-os-product-twin` expects the retired
  `commandMap.insights` source pattern and fails on current `main`. It was not
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

### 2026-08-18 - Move the product origin to app.derya.ai

- Branch: `chore/app-product-domain`, targeting `main`.
- Task: Keep the public landing page on the apex domain and make
  `app.derya.ai` the canonical Freight OS origin.
- Files changed: environment example, RFQ link generation, Gmail setup guide,
  deployment boundary test, decision log, and handoff.
- Verification: deployment boundary, product-copy policy, TypeScript, diff
  hygiene, public DNS, Vercel domain verification, TLS, login, and protected
  route redirect.
- Caveats: Google Cloud must allow
  `https://app.derya.ai/api/auth/gmail/callback` before a Gmail account can be
  connected or reconnected from the new host.

### 2026-08-18 - Keep Bourne procurement results in the Supply OS queue

- Confirmed that the stuck Threaded inserts request was committed correctly in
  Neon but had never been leased or updated by Bourne.
- Removed the GUILD2 row redirect to the generic procurement dashboard.
- Restored saved row state from the customer-scoped order list using the
  stored `request_context.source.source_sku` value.
- Added in-place status, progress, supplier evidence, quote state, and approval
  boundary display, plus focus and scroll behavior from each row action.
- Added a validated, parameterized GUILD2 campaign filter after customer
  scoping so unrelated orders cannot push saved GUILD2 rows out of the list.
- Preserved seven-second active polling and bounded concurrent detail reads.
- Passed the GUILD2 and procurement workflow contracts, TypeScript, product
  copy policy, deployment boundary, optimized production build, and diff
  hygiene.

### 2026-08-18 - Restore the guided sourcing experience for Bourne orders

- Replaced the inline GUILD2 results panel with the existing four-step Supply
  OS sourcing workspace pattern.
- Row-level Source now opens visible research progress immediately after the
  durable order is accepted. Existing orders open the same workspace through
  View results.
- Added continuous seven-second polling while an order is active and automatic
  progression from Research to Compare and Procure based on Neon status.
- Reused the existing supplier comparison table for read-only supplier,
  contact, evidence, quote, and source display.
- Extended the bounded order detail projection with safe supplier contact
  snapshots. No Gmail IDs or workflow-controlled fields were added.
- Preserved the Bourne Inbox approval boundary and removed dashboard-side
  shortlist mutation from this integration path.
- Passed GUILD2, procurement, Atlas sourcing, product-copy, TypeScript,
  production build, and diff-hygiene checks. Targeted Next lint remains blocked
  by the repository's duplicate plugin resolution across nested checkouts.
- Added database-backed contact projection fixtures for flat, nested, and
  identity snapshots. The suite was not run locally because Docker was
  unavailable and must pass in GitHub CI before merge.

### 2026-08-18 - Fix customer sourcing canvas and queued-order recovery

- Branch: `fix/sourcing-workspace-density-worker-wake`, based on
  `origin/main` commit `26e7102`.
- Task: Remove the accidental duplicate dossier and recover a committed order
  when its first workflow wake does not produce a claim.
- Files changed: customer procurement workspace, Supply OS dashboard,
  procurement workflow, focused contracts, and durable handoff docs.
- Verification: `npm run test:procurement-workflow`,
  `npm run test:workflow-guild2`, TypeScript, and diff hygiene passed locally.
- Failed/skipped checks: Authenticated visual verification requires the user's
  browser session and will be repeated after production deployment.
- Caveats: Recovery can wake an active worker, but it cannot activate or publish
  an external automation. The schedule remains the final fallback.
- Follow-up: Keep the external automation active with its webhook and schedule,
  and use atomic bounded claims when more than one order is queued.

### 2026-08-19 - Rebuild Context as a conversation with attachments

- Branch: `feature/context-chat-v2`, targeting current `main`.
- Commit: see git log.
- Task: Replace the rejected database-style Context workspace with one
  ChatGPT-style conversation and a file rail while preserving tenant scoping,
  provenance, grounded retrieval, portal visibility, and approval boundaries.
- Files changed: Context persistence and APIs, operator and portal surfaces,
  document extraction and storage, shell routing and layout, tests, design
  guidance, decision record, and handoff.
- Verification on current main: Fresh PostgreSQL migrations and seed, concurrent
  Context root creation, database persistence, TXT upload and parsing, desktop
  and mobile browser QA, focused contracts, Prisma, TypeScript, product copy,
  optimized build, and diff hygiene passed.
- Failed/skipped checks: This local environment has no `OPENAI_API_KEY`, so the
  live model answer was not available. The user message still persisted and the
  UI showed the explicit configuration blocker.
- Caveats: ZIP and STL are stored but not parsed. Images, Word, and Excel need a
  configured model key. Production requires the additive migration and one
  allowlisted pilot office before Context is visible.
- Follow-up: Push the branch and test the preview before any production merge.

### 2026-08-20 - Restore login-code bootstrap delivery

- Traced production `send_failed` responses through the login-code state
  machine. The active user and LoginCode schema were present; the fresh Office
  lacked an OAuth-connected Gmail sender.
- Added an RFQ Gmail SMTP fallback after the office-scoped Gmail attempt. This
  removes the fresh-database login deadlock without copying OAuth tokens or
  weakening the allowlist.
- Kept code persistence after confirmed delivery so a failed SMTP or Gmail send
  cannot consume a rate-limit slot or invalidate a previously delivered code.
- Added focused configuration coverage. Production merge remains gated on CI,
  deployment readiness, and one live code-delivery attempt.
