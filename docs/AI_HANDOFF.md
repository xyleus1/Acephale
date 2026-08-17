Warning: truncated output (original token count: 97990)
Total output lines: 8872

# AI Handoff

## Latest Update

### GUILD2 now creates customer-scoped Bourne procurement orders

- Neon provisioning is resumable after a partial run. It no longer issues
  superuser-only `ALTER ROLE` clauses through Neon's managed owner. It applies
  `NOINHERIT`, then fails closed unless the dashboard role has no elevated role
  attributes or memberships.
- Each searchable GUILD2 row posts to the authenticated
  `/api/procurement/requests` endpoint. The browser sends request inputs and a
  deterministic line key only. Customer identity still comes from the active
  Derya Office mapping on the server.
- The fixed plan classifies all 40 lines. GUILD-027 remains blocked for missing
  quantity and unit, GUILD-039 remains an award documentation requirement, and
  only the other 38 lines can create orders.
- The bulk control is enabled only when that exact 40-line classification is
  present. It creates the 38 orders with concurrency capped at three. Retrying
  uses the same durable keys, returns existing orders, and does not issue a
  second Bourne wake.
- Each newly committed order gets at most one bounded post-commit webhook
  attempt. Failure leaves the order in Neon for the Bourne schedule. Active
  row status polls the customer-scoped detail endpoint every seven seconds.
- GUILD2 request notes carry the `[BOURNE TEST]` marker required for controlled
  commissioning. A row shows `Needs trigger` when no server-side wake URL is
  configured for a newly created order, without exposing its value. An
  idempotent duplicate does not falsely report a missing trigger.
- The request detail supplier table renders at most three bounded evidence
  snippets per candidate. React escapes the text, and arbitrary research JSON
  is not dumped into the page.
- The POST route counts streamed request bytes and rejects bodies above 64 KB,
  including requests with missing or false `Content-Length` headers.
- The database suite now races the same tenant-scoped idempotency key through
  separate clients, asserts one order and one wake, and checks destructive
  customer, BOM, order, vendor, and idempotency privileges are denied.
- The obsolete runtime DDL bridge and `WORKFLOW_AGENT_TRIGGER_*` configuration
  were removed. `WORKFLOW_DATABASE_URL` is only the restricted `dashboard_api`
  connection, and `BOURNE_WORKFLOW_WEBHOOK_URL` is the only optional wake URL.
- No production database, deployment secret, webhook, or Bourne automation was
  changed.

Verification:

- `npm run test:workflow-guild2`
- `npm run test:procurement-workflow`
- `npm run test:supply-os-atlas-sourcing`
- `node --import tsx scripts/product-copy-policy.test.ts`
- `node --import tsx scripts/supply-os-deployment-boundary.test.ts`
- `npx tsc --noEmit`
- `npx next build` with placeholder server-only database URLs
- Local disposable PostgreSQL provisioning was attempted and remains blocked
  by the host System V shared-memory ID limit. A pull-request workflow now
  provisions separate disposable app and workflow databases and runs the
  database-backed tenant, privilege, idempotency, webhook, and authenticated
  handler suite before production can be considered.


### Supplier research now survives the browser and request lifetime

- Supplier research POST requests no longer wait for public discovery to
  finish. The route validates and rate-limits the request, creates or reuses an
  identical active `SupplyCapabilityRun`, and returns HTTP 202 with
  `{ run, reused, pollUrl }` plus `cache-control: no-store`.
- The exact-run GET is read-only and remains office and workspace scoped. The
  procurement screen polls that run, renders its saved terminal result, and
  moves a still-active run to an explicit background state after three minutes.
  Leaving the page does not cancel the durable job.
- Next.js `after()` starts work quickly when the request host remains alive. It
  is only a latency optimization. The protected supplier-research cron advances
  campaigns, claims at most two queued runs, and reconciles campaign state so a
  redeploy or terminated request cannot strand queued work.
- Claims atomically move one run from QUEUED to RUNNING. Duplicate workers skip
  an already claimed run. Only stale RUNNING work is failed by recovery;
  untouched QUEUED work is never mistaken for a timed-out provider call.
- Worker failures are stored with stable failure codes and sanitized messages.
  Terminal success or failure stays on the same run record for polling and
  later inspection.
- Campaign parents and aggregate artifacts follow the database provenance
  state machine from QUEUED to RUNNING before reaching a terminal state. A
  manual retry creates a linked immutable campaign generation and carries
  forward validated predecessor aggregates instead of rewriting history or
  paying to rediscover completed lines. Twelve manual generations are allowed;
  another retry fails visibly and requires a reviewed scope instead of growing
  an ancestry chain until recovery becomes impossible.
- Reconciliation holds an expiring token on the RUNNING campaign parent.
  Aggregate writes, child enqueue, lease release, and terminal transitions
  verify that token under the parent row lock. Attempt watermarks prevent stale
  generations from replacing newer evidence, while current receipt validation
  can reduce an invalid prior aggregate from three leads to two or zero.
- The fixed GUILD campaign is resumable and bounded. It searches 38 of the 40
  lines, keeps GUILD-027 in clarification because quantity and unit are missing,
  and treats GUILD-039 as an award documentation requirement instead of a
  supplier search. Work is queued in batches of six with retry backoff, a
  48-attempt daily campaign cap, and a 72-attempt daily office cap.
- Campaign reservation and worker claim share one stable office quota lock and
  derive the UTC day from the database clock after acquiring it. A request
  waiting across midnight cannot escape or be charged to the wrong daily cap.
- A campaign line completes only with three to five distinct, attributable
  `REVIEW_REQUIRED` supplier leads. Each retained lead must have one public
  source supporting its identity and product capability. Campaign aggregate
  runs preserve the accepted candidates and evidence; no lead becomes an
  approved supplier, quote, order, or outbound contact.
- Campaign child work is pinned to Exa forced-live validation. If that provider
  is unavailable or unauthenticated, the line blocks visibly rather than
  silently falling back to discovery that cannot produce a validated lead.

Verification completed during integration:

- `npm run test:supply-os-bom-acceptance`
- `npm run test:supply-os-research-worker-lifecycle`
- `npm run test:supply-os-supplier-research-polling`
- `npm run test:supply-os-supplier-leads`
- `npm run test:supply-os-atlas-sourcing`
- `npm run test:supply-os-continuous-sourcing`
- `npx tsc --noEmit --pretty false --incremental false`
- `npm run build` with the prebuild contract run separately through the Node
  loader because this sandbox blocks the `tsx` CLI IPC socket

Release verification still required:

- Run the PostgreSQL-backed Supply OS persistence contracts in CI; no local
  PostgreSQL service was available in this sandbox.
- Run `npm run test:supply-os-live-research` against the deployed authenticated
  app with explicit base URL, cookie, and workspace ID.
- Run `npm run test:supply-os-continuous-sourcing-acceptance` against the
  deployed authenticated app. It is intentionally bounded but may span daily
  attempt windows. It was not run locally because deployment credentials were
  not available.

### Supplier research keeps discovery evidence when Exa content validation times out

- Exa supplier research no longer erases successful search results when the
  subsequent forced-live Contents request reaches its deadline.
- Forced-live content validation is bounded to the first three ranked public
  results. Search can still return up to six attributable source URLs.
- If content validation times out, the run completes as degraded with the
  discovered URLs and source-domain candidates. Roles, product capability,
  price, currency, MOQ, lead time, and listing receipts remain unknown.
- Search failures still fail the run because no attributable source exists.
  Other invalid, oversized, or provider-failure responses still fail closed.
- Retry remains available, and no supplier contact, qualification, approval,
  purchase action, or Logistics state is created by the degraded result.

Verification:

- `npm run test:supply-os-exa-retrieval`
- `npm run test:supply-os-supplier-research-failures`
- `npm run test:supply-os-research-route-lifecycle`
- `node --conditions=react-server --import tsx scripts/supply-os-supply-intelligence.test.ts`
- `node --import tsx scripts/supply-os-ingestion-research.test.ts`
- `node --import tsx scripts/supply-os-atlas-sourcing.test.ts`
- `npx tsc --noEmit --pretty false --incremental false`

### Exa now creates bounded forced-live public listing receipts

- `EXA_API_KEY` enables an Exa-first supplier-research path: Search finds public
  URLs, then Contents retrieves only those URLs with `maxAgeHours: 0`. Calls go
  only to fixed `api.exa.ai` endpoints. Search and content bodies, record text,
  per-URL status, and the whole operation have explicit size and time ceilings.
- Exa structured summaries are proposals, not evidence. Deterministic code
  accepts a price only when one successful, non-cached record contains the exact
  requested identity and one excerpt with a positive amount, ISO 4217
  currency, explicit unit or package basis, and source URL. Cross-record and
  cross-product stitching fail closed.
- Public search results are identified by their source domain and carry no
  trusted supplier role. Generated seller names, manufacturer roles, and
  authorization claims cannot expand durable supplier identity or roles.
- Valid captures store a server-owned retrieval time, response and source hashes,
  an exact excerpt, and provider request IDs. Provider publication dates do not
  control freshness. The receipt becomes managed-retrieval evidence plus an
  append-only `PUBLIC_LIST_PRICE` observation linked to the supplier profile and
  research run.
- A public listing remains separate from a reviewed supplier quote. It is shown
  with `RFQ confirmation required`, and server-side public candidate selection
  continues to null price, currency, MOQ, and delivery before procurement.
- When Exa is absent, the existing OpenAI web-search discovery path remains and
  its timestamps stay untrusted. Exa does not fall back to another provider.
  A Contents timeout after successful Exa Search retains only the search URLs
  as degraded, unvalidated evidence. Cloudflare Browser Rendering is not part
  of this slice.

Verification:

- `npm run test:supply-os-exa-retrieval`
- `npm run test:supply-os-supplier-research-failures`
- `node --conditions=react-server --import tsx scripts/supply-os-supply-intelligence.test.ts`
- `node --import tsx scripts/supply-os-ingestion-research.test.ts`
- `node --import tsx scripts/supply-os-atlas-sourcing.test.ts`
- `npx tsc --noEmit --pretty false --incremental false`
- Prisma validation and generation plus diff hygiene passed. The integrated
  release branch must run the optimized production build before deployment.

### Supply intelligence production schema rollout is complete

- Added only the four additive persistence models needed for supplier profiles,
  profile facts, benchmark series, and source-backed price observations.
- Added migration `20260812000100_supply_intelligence_profiles` with explicit
  transaction, lock timeout, statement timeout, tenant-scope triggers, domain
  checks, and append-only guards.
- PR #140 merged and the production Vercel deployment succeeded at commit
  `a361ea38bd017c418c37f1ddcc1f5a093a9225da`, including migration deploy and
  migration status before the application build.
- Removed the one-time production migration hook after that confirmation.
  Routine Vercel builds no longer run database migrations, and the existing
  Supply OS connector cron remains intact.
- No supply intelligence runtime code was included in the schema rollout. The
  production schema prerequisite is now cleared for the separately verified
  runtime release.

Verification:

- `npx prisma validate`
- `npm run db:generate`
- `node --import tsx scripts/supply-os-deployment-boundary.test.ts`
- `npx tsc --noEmit --pretty false --incremental false`
- `npm run build`
- `git diff --check` and changed-file U+2014 scan

Follow-up:

- Land this cleanup before the separately verified supply intelligence runtime.

### Real company workspaces now use sourced company profiles

- New company creation runs attributable company research whether or not the operator supplies a website.
- Opening an older company without stored research triggers the same bounded profile research and stores the resulting profile and same-domain logo.
- Real workspaces render the researched company name, headquarters, locations, products, and evidence. They no longer fall back to the Atlas browser case or generic Austin location copy.
- Real-company inventory and demo sourcing history start empty. Atlas and GUILD fixtures load only from their explicit demo rows.
- Missing or failed research shows a retry state without substituting demo facts.
- Unilever verification used official Unilever sources. The official UK head office is listed at 100 Victoria Embankment in London, and Unilever describes a presence across 190 markets.

Verification:

- `npm run build` passed in the Vercel preview and production deployment for PR #138.
- Production commit `6e913c72c0d94bc5db488a8983b812b5e5d6de76` deployed successfully.
- `scripts/supply-os-company-navigation.test.ts` guards name-only research, profile retry access, real-workspace routing, empty inventory, and removal of generic location fallback.
- Changed-file U+2014 scan passed.
- Authenticated browser verification was unavailable in the restricted runtime.

### Supply OS company creation is restored in production

- Root cause: Supply OS persistence migrations were merged into application code but were not applied to the production database. Workspace and supplier-research reads therefore returned HTTP 500.
- Recovery: PR #135 ran the pending Prisma migrations before the production build, restored the optional company website input, and removed all example placeholders from the creation form.
- The GUILD demo company and its 40-part sourcing fixture remain available. They are demo rows, not default values in the new-company form.
- Company creation remains admin-only and office-scoped. It creates or reuses the canonical CRM customer and linked Supply OS workspace.
- The temporary production migration build command was removed after the recovery deployment and the subsequent connector migration deployment both succeeded.

Verification:

- Vercel preview for PR #135 succeeded.
- Vercel production deployment for recovery commit `2a76dbfbb24d398b63ad2fb79c382af7da7d1697` succeeded after `prisma migrate deploy` and `npm run build`.
- Vercel production deployment for connector commit `067d6f534686fd27100927e7fee540652f19ef5b` also succeeded with the recovery hook before cleanup.
- `scripts/supply-os-company-navigation.test.ts` rejects placeholders and verifies website forwarding plus canonical customer-workspace creation.
- Authenticated browser verification was unavailable in the restricted runtime.

### Client integrations now have internal settings and a public handoff page

- Added a lower-rail Settings link to the authenticated Supply OS navigation.
  It opens `/dashboard/settings/integrations`, where an admin can select a
  company workspace, configure the OAuth REST connector, test it, enable or
  disable hourly sync, run a manual sync, and inspect health timestamps.
- Added the public `/integrations` page for client technical handoff. It states
  the supported data scope, OAuth and response-envelope requirements, sync flow,
  client checklist, tenant controls, and the read-only boundary.
- Added `/dashboard/settings` as a redirect to the Integrations settings page.
  Existing channel settings remain available as a separate Settings tab.
- The public page documents the client connection contract. It is not a public
  write API and it does not expose connector credentials or client data.
- Connector runs normalize client records into immutable office-and-workspace
  scoped snapshots. A failed run keeps the prior published snapshot.

Verification:

- `npm run test:supply-os-connectors`
- `npm run test:integrations-surface`
- `npx tsc --noEmit --incremental false`
- Production build with disposable PostgreSQL-shaped URLs
- `git diff --check` and changed-file U+2014 scan

Caveat:

- `https://derya.ai/integrations` will not exist until the branch is merged,
  the connector migration is applied, and the production deployment completes.

### Inventory sourcing intake now preserves structured request context

- Inventory and GUILD BOM rows seed the procurement workspace with product, quantity, unit, specification, destination, and need-by date.
- The chat API receives that structured draft instead of a null request, so revisions update the actual request instead of restarting generic intake.
- Complete requests expose a deterministic Continue to research action. Supplier research rejects incomplete inventory requests server-side instead of silently bypassing validation.

Verification:

- `node --import tsx scripts/supply-os-atlas-sourcing.test.ts`
- `node --import tsx scripts/supply-os-company-navigation.test.ts`
- `npx tsc --noEmit --pretty false --incremental false`
- `npm run build`

### Company creation builds a canonical customer workspace

- The Companies index accepts a company name and official website.
- Create links or creates the office-scoped CRM Company, marks it as an active customer, and creates or reuses its linked Supply OS workspace.
- Creation validates the current database user instead of trusting a long-lived cookie role.
- The official website profile and same-domain logo are stored as attributable Supply OS evidence when research succeeds.
- A selected database workspace loads its own company profile and cannot silently render the Atlas Robotics browser demo.
- GUILD uses https://www.guildai.co/ as its official website. Supplier identity, BOM quantities, operating locations, lanes, rates, customs treatment, and approvals stay unknown until customer data is connected.

Verification:

- `npm run test:supply-os-company-create`
- `npm run test:supply-os-company-navigation`
- `npm run test:supply-os-company-research`
- `npm run check:product-copy`
- `npx tsc --noEmit --incremental false`
- Production build with disposable PostgreSQL-shaped URLs
### Customer supply profiles and supplier prices now accumulate

- Selecting a shared customer workspace now scopes sourcing history, supplier
  research, procurement cases, and the new intelligence projection to that
  workspace. The legacy Atlas fallback remains only when no shared workspace is
  selected.
- Each completed research run appends a customer sourcing-need fact and merges
  candidates into stable workspace supplier profiles. Prior capability outputs
  remain intact, so new research expands the supplier universe without erasing
  evidence history.
- Public research preserves source-linked listing claims but does not create a
  durable current-price observation. A managed connector must produce a
  server-owned receipt binding the supplier item, amount, currency, unit, date,
  and source before that append-only record can exist.
- The Inventory & sourcing surface shows the customer profile count, accumulated
  supplier universe, any previously verified price observations, exact supplier
  links, and `RFQ required` when verified pricing is absent. The active research
  view may separately show an explicitly unverified listing claim and its URL.
- Benchmark-series records explicitly distinguish real-time, delayed, daily,
  weekly, and monthly sources. No market-data connector or unlicensed exchange
  feed is claimed in this slice.

Verification:

- `npm run db:generate` with disposable PostgreSQL-shaped URLs
- `npx tsc --noEmit --pretty false --incremental false`
- `node --conditions=react-server --import tsx scripts/supply-os-supply-intelligence.test.ts`
- `node --import tsx scripts/supply-os-ingestion-research.test.ts`
- `node --import tsx scripts/supply-os-atlas-sourcing.test.ts`
- Database-backed migration and sourcing persistence tests require a disposable
  PostgreSQL server and were not available in this workspace.
### Dashboard procurement requests now use the Bourne Neon workflow boundary

- Authenticated users can create, list, and poll procurement requests from
  `/dashboard/workflow`. The API resolves the active Derya Office on the server,
  then maps it to a Neon customer UUID through server-only auth metadata.
- Derya authentication remains on `DATABASE_URL`. The separate
  `WORKFLOW_DATABASE_URL` is accepted only when it uses the `dashboard_api`
  username and requires SSL.
- Request creation, BOM creation, and customer-scoped idempotency happen in one
  Neon transaction. A webhook is attempted only after commit, and its failure
  leaves the order queued for the Bourne schedule.
- The dashboard can read status and supplier results. It has no mutation route
  for workflow state, approvals, leases, vendor research, quotes, or email IDs.
- No Derya Prisma migration is required. Neon still needs the reviewed
  `dashboard_api` role and `procurement_api_idempotency` provisioning before the
  integration can run.
- Production was not provisioned and Bourne was not activated. This remains a
  staging candidate until database-backed tests run against provisioned test
  databases.

Verification:

- `npm run test:procurement-workflow`
- `npx tsc --noEmit --pretty false --incremental false`
- `node --import tsx scripts/product-copy-policy.test.ts`
- `node --import tsx scripts/supply-os-deployment-boundary.test.ts`
- production `next build` with placeholder server-only configuration
- Local PostgreSQL database-contract setup was blocked during `initdb` by the
  host System V shared-memory ID limit. The database-backed suite was not
  represented as passing.
- The packaged-server smoke test was blocked before startup because the sandbox
  denied binding `127.0.0.1:3107` with `listen EPERM`.

### Connected supplier quote PDFs are bounded review sources

- `extract.supplier_quote_terms@2` can read text PDFs attached to the exact
  connected Gmail supplier reply. It does not accept browser URLs or arbitrary
  files.
- Retrieval is pinned to the office-scoped active Gmail account, provider
  message ID, local message, and provider attachment IDs stored on that
  connected message.
  At most three PDFs are considered, each is capped at 8 MB, parsing is limited
  to 25 pages, and combined attachment text is capped at 30,000 characters.
  Provider responses are streamed under an encoded-size ceiling, and each PDF
  is parsed in a time- and memory-limited worker.
- Every proposed field names one source and carries an exact excerpt that must
  occur wholly inside that email subject, email body, or attachment. Cross-source
  stitching and mislabeled citations fail closed.
- Scanned, encrypted, malformed, oversized, unsupported, and truncated files
  remain visible as deterministic warnings. OCR is not claimed or simulated.
- Attachment retrieval failures create immutable failed capability attempts and
  retry through a new attempt. Successful proposals store attachment text hashes
  and source labels without duplicating the full PDF text in operational output.
- Version 1 proposals remain visible. Replies previously marked attachment-only
  can run version 2 without losing the original proposal history.
- The operator still reviews and records the quote manually. Attachment parsing
  cannot advance qualification, commercial approval, supplier selection,
  purchasing, spend, or Logistics.

Verification:

- `npm run test:supply-os-supplier-quote-attachments`
- `npm run test:supply-os-supplier-quote-extraction`
- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false --incremental false`

### Connected supplier replies now produce reviewable quote-term proposals

- An operator can run `Extract terms` on one connected supplier reply. Supply
  OS proposes only price, currency, MOQ, unit, delivery date, quote reference,
  and validity date that are supported by exact supplier text.
- Unsupported or attachment-only values remain unknown. Unit mismatch and
  delivery after the requested need-by date remain conflicts. Attachment names
  are visible to the capability, but attachment contents are not parsed.
- Every extraction is pinned to the office, workspace, quote cycle, request
  hash, source evidence hash, requested unit, dates, capability version, and
  prompt version. Successful output becomes append-only model-derived proposal
  evidence linked to the connected-provider reply.
- Completed extraction scopes are idempotent. Failed attempts remain immutable
  and retry as new linked capability runs. The proposal survives queue reloads.
- `Review extracted terms` only prefills the existing operator form. Extraction
  cannot record a quote response, advance the commercial gate, select a
  supplier, request approval, contact a supplier, or commit spend.
- The slice also fixes the supplier follow-up draft lifecycle. An approved draft
  now enters `RUNNING` with its delivery action before both can reach
  `SUCCEEDED`, matching the database state machine.

Verification:

- `npm run test:supply-os-supplier-quote-extraction`
- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL `npm run test:supply-os-sourcing-persistence`
- `npm run test:supply-os-supplier-email-provider`
- `npm run test:supply-os-operations-ui`
- `npm run test:supply-os-continuous-layout`
- `npx tsc --noEmit --pretty false --incremental false`
- disposable PostgreSQL production `npm run build`
- strict tenant audit reported nine inherited findings outside this slice
- changed-file U+2014 scan
- `git diff --check`

### Overdue released orders now have a durable supplier follow-up

- The sourcing queue no longer stops at `Supplier response overdue`. An
  operator can draft a connected-Gmail follow-up against the exact active order
  release and remaining quantity, obtain manager approval, deliver it, and
  resume the workstream after navigation or refresh.
- The message threads against the connected purchase-order email or latest
  follow-up when provider identifiers exist. Each definitive send persists its
  Gmail receipt, local email record, connected-provider evidence, and follow-up
  history on the released order.
- Timeout and ambiguous provider results block duplicate delivery. The operator
  must reconcile the stable message ID, document verified non-delivery, and then
  retry. Identical and concurrent saves or sends converge.
- Recording an acknowledgment or supplier exception cancels safe unsent
  follow-up work. It does not hide an in-flight or uncertain send. Connected
  replies remain evidence that requires manual quantity, delivery, or exception
  review.
- No schema, dependency, payment, booking, customs, inventory, or Logistics
  behavior changed.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL `npm run test:supply-os-sourcing-persistence`
- `npm run test:supply-os-supplier-email-provider`
- `npx tsc --noEmit --pretty false --incremental false`
- `git diff --check`

### Authorized orders now have a durable release checkpoint

- Final purchase authorization no longer jumps directly to supplier
  acknowledgment. An admin or manager records the exact externally issued order
  with its channel, buyer PO reference, release date, acknowledgment due date,
  evidence URL, and immutable purchase-action scope hash.
- The queue persists and resumes `RELEASED` as a real awaiting-supplier state.
  Supplier acknowledgment is blocked until it references the exact release
  hash. Partial and full acknowledgment continue against the frozen quantity.
- Release fails closed when authorization, tenant scope, active admin decision,
  supplier qualification on the release date, quote validity, or need-by timing
  does not match. Concurrent and lost-response retries converge without
  duplicate evidence or events.
- Recording release is evidence-only. Derya still does not send the order,
  create a canonical PO, commit spend, book freight, or open Logistics.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false --incremental false`
- `git diff --check`

### Supplier contact now fails closed at the actual release boundary

- Connected supplier email approval now pins the exact qualification review
  hash and validity date. Drafting, approval request, approval decision, and the
  final send claim all recheck current qualification on the server.
- The send claim locks the procurement case before the quote cycle and email
  action. Gmail is never called when qualification expired or changed after
  approval.
- Manual external RFQ release requires qualification valid on the recorded
  release date. Identical retries remain idempotent after the release already
  exists.
- Provider receipts still persist after a provider call. Qualification changes
  cannot erase or hide contact that may already have occurred. A definitive
  send is terminal against late timeout and reconciliation writes.
- Pre-release email actions without a qualification hash are not grandfathered
  and do not strand the operator. Safe unsent actions reopen the same draft for
  a newly scoped approval. Unresolved deliveries remain visible for recovery.
- No schema, connector, purchase, spend, booking, customs, or Logistics behavior
  changed.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false --incremental false`
- `git diff --check`

### Supplier qualification is structured, expiring, and reversible

- Gate 1 no longer accepts one URL plus a free-text confirmation. A supplier
  must now have operator-reviewed identity evidence, component-capability
  evidence, a declared manufacturer or distributor relationship, a validity
  date, and a review note before an RFQ can be prepared.
- Authorized distributors require attributable manufacturer-authorization
  evidence. Supplier identity evidence must match the attributed supplier
  domain. Independent distributors remain explicitly identified instead of
  being presented as authorized.
- Operators can reject a supplier with a structured reason. The rejected
  workstream remains visible in the sourcing queue, reopens with its evidence
  and note, and can be requalified later without losing history.
- Every outcome appends immutable `SUPPLIER_QUALIFICATION` evidence and a hashed
  qualification or rejection event. The evidence record is correctly labeled
  as operator-recorded external review, not as an automatically verified fact.
- Expired and legacy free-text reviews reopen Gate 1 in the queue. Server-side
  RFQ, sourcing approval, order preparation, and final purchase-authorization
  boundaries reject missing or expired qualification evidence.
- No schema, dependency, supplier contact, purchase execution, spend, booking,
  customs, or Logistics behavior changed.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false --incremental false`
- authenticated browser QA at 1440x900 and 390x844, including rejection,
  refresh, queue resume, conditional authorization evidence, internal scrolling,
  no horizontal overflow, and no Supply OS console errors
- `git diff --check`

### Free-text sourcing requests clarify before supplier research

- New free-text requests enter the sourcing queue immediately and remain in
  office, user, and company scoped browser storage until research is persisted.
- An authenticated, rate-limited intake route uses a strict GPT response to
  extract the item, quantity, unit, manufacturer, part number, specification,
  source region, delivery location, and need-by date.
- Deterministic rules require the item, quantity and unit, technical identity,
  delivery location, and need-by date before public supplier research starts.
- Missing facts open an inline clarification conversation. Each answer updates
  the visible request summary. A complete request starts the existing
  attributable research run and then uses the canonical persisted procurement
  workflow already on `main`.
- Generic material requests use an open-request research mode that can retain
  evidenced producers, processors, exporters, traders, manufacturers, and
  distributors. Catalog component research remains limited to manufacturers
  and distributors.
- `Refine request` now reopens that conversation and can start a new research
  run. It no longer returns the operator to an empty composer.
- Public results remain unqualified candidates. Intake does not contact a
  supplier, approve a source, issue a purchase order, book freight, or spend.

### Sourcing history is paginated, visible, and actionable

- Inventory and sourcing now loads research through an opaque server cursor
  ordered by creation time and stable ID. `Load older requests` appends pages
  without replacing newer queue state and exposes a retry state for transient
  failures.
- Prior runs are visible as dated research rows instead of being silently
  collapsed behind the latest run for a component. Saved results, quote inboxes,
  order drafts, approvals, and acknowledgments reopen from those rows.
- Each page loads procurement cases for its exact research-run IDs. The queue no
  longer depends on an independently capped recent-case list.
- Quote-cycle and supplier-email API routes reload their parent case through
  exact task ancestry. A regression test saturates the legacy 120-case window
  and proves an older quote workstream still reloads.
- Current active-user state, office scope, workspace access, cursor validation,
  and cross-office denial are enforced server-side. No database migration,
  dependency, supplier contact, purchase, spend, or Logistics change was added.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- `npm run test:supply-os-ingestion-research`
- disposable PostgreSQL `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false`
- `npm run build`
- Browser QA at 1440x900 and 390x844, including two-page queue loading,
  saved-research reopen and return, console errors, and horizontal overflow
- `git diff --check`

### Supplier quote email is approval-gated and provider-backed

- A saved supplier quote request can now become a revisioned Gmail draft inside
  the same procurement workspace. The exact sender account, sender address,
  recipient, subject, body, supplier, and quote-request hash are copied into an
  immutable `SUPPLIER_QUOTE_EMAIL_ACTION` input.
- A manager approval binds directly to the action input hash. Message edits or
  quote-request edits cancel any pending or approved unsent action and require a
  new approval scope.
- Sending claims a stable RFC message ID before contacting Gmail. A successful
  Gmail receipt stores the provider message and thread IDs, a local outbound
  email record, and `CONNECTED_PROVIDER` quote-release evidence. The quote cycle
  then advances to `AWAITING_RESPONSE`.
- Network, rate-limit, or incomplete-receipt outcomes become
  `DELIVERY_UNKNOWN`. Automatic resend is blocked. Derya searches Gmail by the
  stable message ID, and a manager must document verified non-delivery before a
  new attempt receives a different message ID.
- Manual supplier portal, EDI, phone, or external-email release recording remains
  available as a separate evidence-only fallback. Logistics is unchanged.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- local PostgreSQL `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --incremental false`

### Supplier progression now uses canonical evidence records

- Supplier source review, quote-request release, each supplier quote response,
  and each order acknowledgment now append an office-scoped `SupplyEvidence`
  record in the same transaction as the procurement event.
- Evidence records preserve the exact task, source URL, source reference,
  observed date, payload hash, actor, and capture time. Repeated identical
  actions reuse the same evidence record instead of producing fake proof.
- Commercial approval now carries the exact quote evidence ID with the quote
  response hash. Purchase drafting validates both against the same quote-cycle
  task before copying them into the immutable order scope.
- Evidence links in the quote and acknowledgment views resolve through an
  authenticated, tenant-scoped Supply OS route. Legacy records without an
  evidence ID still use their existing source URL.
- Operator-recorded channels remain an evidence ledger. Connected Gmail quote
  release now has its own separately approved execution path. Purchase-order
  release remains unconnected.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL migration plus
  `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false`

### Supplier quote requests and responses are persistent

- Commercial confirmation no longer accepts browser-authored price and delivery
  fields directly. It requires a server-owned supplier quote response hash.
- After source review, an operator can save and revise an RFQ draft with
  quantity, unit, need-by, destination, response deadline, requirements, and
  notes. The sourcing queue restores `Quote request draft` after navigation or
  reload.
- The operator can record how the request was sent outside Derya, including
  channel, date, evidence URL, and note. That moves the queue to `Awaiting
  supplier quote` without claiming that Derya sent a message.
- Supplier responses append price, currency, MOQ, unit, delivery, validity,
  reference, evidence, note, actor, timestamp, and deterministic hash. Multiple
  revisions remain visible and resumable.
- Selecting `Use quote` copies only the chosen stored response into the
  commercial gate. The response task and hash continue through procurement
  approval, order drafting, and final purchase authorization.
- Supplier changes cancel the active quote cycle. Identical request, release,
  and response retries do not append fake history.
- Full supplier order acknowledgment closes the exact quote cycle used by the
  authorized purchase action, so completed sourcing work does not remain active.

### Supplier quote negotiation rounds are persistent

- Every recorded supplier response now offers `Use quote` or `Request revised
  quote` in the same sourcing workstream.
- A counter-request creates a new internal RFQ draft. The prior released round
  becomes immutable history with its request, release, responses, evidence, and
  the exact response hash that triggered negotiation.
- Queue reloads restore the active round plus compact negotiation history.
  Identical and concurrent counter-request retries converge on one new task.
- Saving a revised request does not contact the supplier. Existing email draft,
  approval, send, delivery reconciliation, and external-release controls apply
  independently to the new round.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL migration plus
  `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false`

### Supplier acceptance is persistent, cumulative, and resumable

- An admin or manager can record an externally received supplier acknowledgment
  from the authorized purchase action without leaving Supply OS.
- Each entry binds channel, release date, acknowledgment date, supplier order
  reference, accepted quantity, confirmed delivery date, evidence URL, note,
  operator, timestamp, and hash to the immutable authorized order scope.
- Partial acceptances keep the purchase action open and show accepted and
  remaining quantity in the sourcing queue. Full cumulative acceptance closes
  the action and marks the order ready for a future Logistics handoff.
- Repeated identical submissions are idempotent. Accepted quantity cannot
  exceed the authorized order, and release cannot predate approval or occur
  after quote validity. Supplier or gate scope cannot change after acceptance
  recording starts.
- This is evidence recording only. Derya did not send the order, create a
  canonical PO, pay the supplier, book freight, or create a Logistics record.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL migration plus
  `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false`

### Purchase drafts now progress to exact-scope final authorization

- A saved order draft can be submitted for final admin approval from the same
  in-page procurement workspace.
- Supply OS copies the full server-owned draft into an immutable
  `PURCHASE_ORDER_ACTION` input: supplier, order quantity and unit, destination,
  Incoterm, payment terms, quote terms, subtotal, source review, quality plan,
  procurement approval, draft revision, and draft result hash.
- The final `SupplyApproval.scopeHash` equals that immutable action input hash.
  Managers may approve sourcing, but only an active admin may authorize the
  final purchase action. Self-authorization is blocked when another active admin
  exists.
- Editing a draft cancels its pending final approval. A rejected scope must be
  revised before resubmission. An approved action freezes the draft, and an
  upstream supplier or evidence change cancels the approved but unexecuted
  action.
- Queue rows now resume into `Final purchase approval pending`, `Purchase action
  revision required`, or `Approved to issue` states.
- Authorization is not execution. No PO number, supplier message, payment,
  booking, customs action, or Logistics record is created.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL migration plus
  `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false`

### Approved procurement cases now resume into a persistent order draft

- A case at `PURCHASE_READY` now opens an in-page order preparation form instead
  of ending at a passive status label.
- Saving creates or versions an office-scoped `PURCHASE_ORDER_DRAFT` child task.
  The sourcing queue shows `Order draft ready` and reopens the saved quantity,
  need-by date, ship-to location, Incoterm, payment terms, buyer reference, and
  notes after navigation or reload.
- Supplier identity, quote reference, price, currency, MOQ, unit of measure,
  delivery date, and quote validity come from the immutable approved scope. The
  browser cannot replace them with client-authored commercial facts.
- Quantity and money use exact decimal arithmetic. Updates require the current
  revision, identical retries do not create fake history, and supplier or gate
  changes cancel the active draft.
- Expired approved terms return the case to the relevant review gate. They do
  not silently create an order from stale evidence.
- This remains internal preparation. It does not create a PO number, contact a
  supplier, authorize payment or spend, book freight, or open Logistics.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- disposable PostgreSQL migration plus
  `npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false`

### Procurement qualification and exact-scope approval are now persistent

- The procurement brief now runs four sequential gates in place: supplier
  source review, commercial quote confirmation, quality acceptance planning,
  and manager approval.
- Gate submissions are server-validated against the active selection hash and
  stored in the office-scoped procurement case with append-only hashed events.
- Approval uses a separate immutable `PROCUREMENT_APPROVAL` task containing the
  exact supplier, confirmed quote, evidence review, and quality plan. The
  `SupplyApproval.scopeHash` must match that task input hash.
- Pending approvals become stale when supplier or gate scope changes. Historical
  approved records are preserved. A requester cannot self-approve when another
  eligible manager or admin exists.
- Expired approval requests, quotes, delivery dates, and quality-plan dates fail
  closed and return the case to the relevant review gate instead of stranding it.
- An approved case is only ready for purchase preparation. No supplier message,
  purchase order, payment, booking, shipment, customs filing, or spend is
  created.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- `DATABASE_URL=... npm run test:supply-os-sourcing-persistence`
- `npx tsc --noEmit --pretty false`
- Production build with a harmless local PostgreSQL URL
- `git diff --check`
- Changed-file U+2014 scan
- `npm run audit:tenant-scope:strict` still reports the same nine pre-existing
  findings outside this Supply OS slice; no new procurement finding was added.

### Supplier selection now becomes a durable procurement planning case

- Continuing from a supplier comparison now creates or updates an office-scoped
  `SupplyExecutionTask` with task type `PROCUREMENT_CASE`. The research run is
  immutable input, while the selected option and deterministic readiness gates
  are stored as the current result.
- Every supplier selection creates an append-only `SupplyExecutionEvent` with
  a payload hash. Changing the selected supplier updates the current case and
  preserves the prior selection in the event ledger.
- Public supplier identity, source, price, currency, lead time state, and
  quality state are re-derived from the persisted research output on the
  server. Client-authored sourced terms cannot become procurement evidence.
- Commercial values become sourced only when their field-level envelope is
  supported, attributable, and fresh. Price, currency, MOQ, and lead time must
  all clear that boundary before commercial terms can be evidence-complete.
- Modeled Atlas options remain allowed only as modeled proposals with no source
  URL. They are downgraded to new and unverified when saved, and their
  source-evidence gate stays blocked.
- The procurement brief now shows supplier evidence, commercial terms, quality
  plan, and purchase approval gates. The queue restores existing cases as
  `Continue procurement`; operators can review alternatives and persist a new
  selection.
- The mutable planning case is not an approval target. A future immutable
  execution action must include the selected supplier and terms in its input so
  approval is invalidated by any change. Purchase approval remains blocked.
  No supplier contact, negotiation, sample,
  inspection, purchase order, payment, booking, or spend is created.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- `DATABASE_URL=... npm run test:supply-os-sourcing-persistence`
- `npm run test:supply-os-enterprise-design`
- `npm run check:product-copy`
- `npx tsc --noEmit --incremental false`
- Production build with a disposable PostgreSQL URL
- `git diff --check`
- Changed-line U+2014 scan

### Supplier research is persistent and resumable from the sourcing queue

- Every interactive supplier research request now creates an office-scoped
  `SupplyCapabilityRun` before public research starts and completes that run
  with the attributable result. Refreshing or leaving the page no longer
  discards completed research.
- The sourcing queue loads saved runs and attaches the latest run to its
  component. Custom free-text requests also return as queue rows.
- Replaced the passive `Next step` column with an `Action` column. Rows expose
  `Start research`, `Researching`, `View results`, or `Retry research`
  according to durable run state.
- Opening saved results skips the research animation and restores the supplier
  comparison directly. Modeled Atlas candidates remain distinct from sourced
  public candidates and unknown terms.
- A hidden office-scoped system workspace owns demo procurement runs without
  appearing as a duplicate company in the company directory. No Prisma schema
  migration was required.
- Supplier contact, negotiation, order, payment, inspection, and logistics
  remain approval-gated follow-ups.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- `npm run test:supply-os-enterprise-design`
- `npm run check:product-copy`
- `npx tsc --noEmit --incremental false`
- Production build with a disposable PostgreSQL URL
- `git diff --check`
- Changed-line U+2014 scan

### Collapsed navigation brand is centered

- Centered the Derya mark inside the 84px collapsed rail header.
- Moved the compact expand control onto the rail boundary so it no longer
  pushes the mark toward the left edge.
- Kept the expanded header, navigation behavior, accessible names, and mobile
  layout unchanged.
- Added a regression contract for the collapsed header alignment.

Verification:

- `npx tsx scripts/supply-os-collapsible-navigation.test.ts`
- `npm run test:supply-os-company-navigation`
- `npm run test:supply-os-sidebar-map`
- `npm run check:product-copy`
- `npx tsc --noEmit`
- `git diff --check`

### Optimization inspector header is removed

- Removed the decorative checklist icon from the optimization inspector.
- Removed the computed priorities-count badge from the inspector header.
- Removed the remaining profile-title header and the repeated count in the
  Priorities tab. The ranked priority list now starts the panel directly.
- Disabled textarea resizing in Automations so the browser drag handle is not
  exposed in the composer.
- Added a regression contract for the clean header composition.
- No optimization data, ranking, selection, schema, tenant boundary, approval
  rule, or external action changed.

Verification:

- `node --import tsx scripts/supply-os-operations-ui.test.ts`
- `node --import tsx scripts/supply-os-automations-workspace.test.ts`
- `node --import tsx scripts/supply-os-collapsible-navigation.test.ts`
- `node --import tsx scripts/supply-os-sidebar-map.test.ts`
- `node --import tsx scripts/supply-os-enterprise-design.test.ts`
- `node --import tsx scripts/product-copy-policy.test.ts`
- `npx tsc --noEmit --incremental false`
- `git diff --check`
- Changed-diff U+2014 scan
- Authenticated browser QA at 1440 by 1000 confirmed the composer computed
  `resize` value is `none`, the optimization title block is absent, and the
  page has no horizontal overflow.

### Inventory and sourcing now runs request, research, comparison, and procurement

- Replaced inventory-control counters with a sourcing request composer and a
  compact queue of component needs. Operators can start from a known Atlas
  Robotics component or enter a new part request in the composer.
- Starting procurement now transitions inside the mounted Supply OS workspace.
  The visible research sequence checks approved records, official manufacturer
  catalogs, distributor catalogs, and new public sources before showing an
  option comparison.
- Added an operator comparison across modeled price, delivery, quality, and
  source class. The suggested option remains selectable rather than silently
  becoming an award.
- Added a procurement brief after supplier comparison. It prepares part,
  quantity, source, destination, delivery, and need-by context without changing
  the Logistics panel or creating a purchase order, contact, booking, or spend.
- Unknown free-text requests fail honestly. If no SKU, product name, or
  manufacturer part number can be resolved, commercial terms remain unknown.
- The research sequence now calls the existing authenticated, rate-limited
  public supplier research engine. Returned candidates require attributable
  web sources and remain unqualified. Atlas starting candidates and their
  commercial terms remain explicitly modeled.

Verification:

- `npm run test:supply-os-atlas-sourcing`
- `npm run test:supply-os-shell-routing`
- `npm run test:supply-os-product-twin`
- `npm run test:supply-os-continuous-layout`
- `npm run test:supply-os-panel-map-focus`
- `npm run test:supply-os-sidebar-map`
- `npm run test:supply-os-enterprise-design`
- `npm run check:product-copy`
- `npx tsc --noEmit`
- Production build with a disposable PostgreSQL URL
- `git diff --check`
- Authenticated browser QA covered the queue, visible research sequence,
  comparison, selection, handoff, unknown request, desktop, and mobile states.

Deferred:

- Research results are now persisted as canonical office-scoped capability
  runs. A visible older-run history remains deferred.
- The Logistics panel remains unchanged. A later slice should create an
  approval-gated `SupplyAction` and open Logistics with the handoff context.

### Automations chat now drafts workflows with GPT

- Replaced the keyword-based browser response with an authenticated GPT-5.6
  Responses API route. Chat can create a new workflow draft, revise the
  selected draft, or answer a workflow-design question with structured output.
- Added office and user rate limiting, request-size limits, no-store responses,
  strict output validation, and a deterministic approval-gate safeguard for
  messaging, filing, booking, record, customs, and spend-related steps.
- Removed both pane headers, the initial assistant lecture, speaker labels,
  the visible message label, the long placeholder, the text send label, the
  repeated browser-draft warning, the automation count, and the redundant new
  draft button. The selected workflow keeps the compact `Draft` state.
- The initial workspace is now an empty chat canvas with one compact composer.
  Enter sends, Shift+Enter adds a line, and failed requests restore the input.
- No schema, dependency, persistence, canonical record, external message,
  filing, booking, or spend action changed.

Verification:

- `npm run test:supply-os-automation-chat`
- `npm run test:supply-os-automations`
- `npm run test:supply-os-company-navigation`
- `npm run test:supply-os-shell-routing`
- `npm run test:supply-os-sidebar-map`
- `npm run test:supply-os-continuous-layout`
- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-operations-ui`
- `npm run test:supply-os-product-twin`
- `npm run test:supply-os-atlas-sourcing`
- `npm run check:product-copy`
- `npx tsx scripts/supply-os-collapsible-navigation.test.ts`
- `npx tsc --noEmit`
- Authenticated browser QA at 1440 by 1000 and 390 by 844. The stripped
  desktop and mobile compositions have no horizontal overflow. The local
  endpoint correctly returns its configured error because local development
  has no `OPENAI_API_KEY`; production success still requires post-deploy
  verification against the configured environment.

### Supply OS collapse control moved into the rail header

- Moved the desktop navigation collapse control from the bottom of the rail to
  the Derya logo row.
- Reduced the control to a 44px icon-only button. Its accessible label, title,
  expanded state, and navigation relationship remain available to assistive
  technology.
- Preserved the 84px collapsed rail and the labeled horizontal navigation used
  below 900px.
- Extended the collapsible-navigation contract to reject the old footer
  control and visible `Expand` or `Collapse` button text.
- No schema, dependency, tenant boundary, approval rule, freight logic,
  persistence, or external action changed.

Verification:

- `node --import tsx scripts/supply-os-collapsible-navigation.test.ts`
- `node --import tsx scripts/supply-os-company-navigation.test.ts`
- `node --import tsx scripts/supply-os-sidebar-map.test.ts`
- `node --import tsx scripts/supply-os-operations-ui.test.ts`
- `node --import tsx scripts/product-copy-policy.test.ts`
- `npx tsc --noEmit --incremental false`
- `git diff --check`
- Changed-diff U+2014 scan

Skipped verification:

- The in-app browser had no attached tab, so a rendered desktop and mobile
  inspection could not be completed in this checkout.
- Commit and push were blocked because the workspace sandbox did not permit
  creating `.git/index.lock`. The five task files remain unstaged.

### Supply OS navigation now collapses and Automations has structural whitespace

- Added a desktop collapse control to the persistent Supply OS domain rail.
  Expanded navigation remains the default. Collapsed navigation is 84px wide,
  keeps the six numbered domain targets, preserves accessible names, and stays
  collapsed while switching domains in the mounted shell.
- Kept tablet and mobile navigation horizontal and labeled. The desktop
  collapse control is hidden below 900px.
- Gave the selected Automations workspace 36 to 40px outer gutters, a centered
  1240px maximum width, a lighter workspace boundary, and more internal space
  around chat, the composer, templates, and workflow steps.
- Added a dedicated collapsible-navigation regression contract without
  changing existing tests.
- No schema, dependency, tenant boundary, approval rule, freight logic,
  persistence, provider call, message, filing, booking, or spend action
  changed.

Verification:

- `npx tsx scripts/supply-os-collapsible-navigation.test.ts`
- `npm run test:supply-os-company-navigation`
- `npm run test:supply-os-automations`
- `npm run test:supply-os-continuous-layout`
- `npm run test:supply-os-enterprise-design`
- `npx tsc --noEmit`
- Browser QA at 1440 by 1000 and 390 by 844. Collapse, expand, domain
  switching, active sixth-tab visibility, and zero horizontal overflow passed.

### Automations workspace now uses the approved airy composition

- Kept the two-pane automation workspace, with chat as the primary surface and
  templates plus the selected step plan as secondary context.
- Increased header, conversation, composer, list, and step-plan spacing. Chat
  content and the composer now use readable centered measures instead of
  stretching across the full pane.
- Removed the repeated company label from the chat header, shortened the
  initial prompt, and renamed the local action to `New draft`.
- Replaced table-like automation row borders with quiet spacing and one soft
  selected state. Added the selected automation purpose above its steps.
- Recorded DualEntry and Campfire as secondary composition references beside
  Pallet.com. Their branding, assets, color systems, and layouts were not
  copied.
- No data, schema, dependency, tenant boundary, approval rule, freight logic,
  persistence, provider call, or external action changed.

Verification:

- `npm run test:supply-os-automations`
- `npm run test:supply-os-shell-routing`
- `npm run test:supply-os-sidebar-map`
- `npm run test:supply-os-continuous-layout`
- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-operations-ui`
- `npm run test:supply-os-product-twin`
- `npm run check:product-copy`
- `npx tsc --noEmit`
- Authenticated browser QA at 1440 by 1000 and 390 by 844. Draft creation,
  active sixth-tab visibility, zero horizontal overflow, and the inactive
  execution boundary passed.

### Browser identity now uses Derya

- Changed the root browser metadata from `Derya Supply OS` to `Derya`.
  Route titles now use `Derya` as the brand suffix, while the primary Supply OS
  workspace uses the exact tab title `Derya`.
- Updated the generated favicon canvas so the official Derya mark has a neutral
  rounded tile and enough padding to remain leg…67990 tokens truncated…ication, decide
  admissibility, promise clearance, or replace a broker or legal review.
- HTS Revision 12 predates the July 23 USTR final action. Filing-time HTS,
  broker, ACE, and official-action confirmation remain required.

Verification:

- China customs guide, load assessment, local extraction, load UI, report UI,
  Intel boundary, source registry, load-check, and load-check enrichment tests
  passed.
- `npx tsc --noEmit --incremental false` passed.
- Production `npm run build` passed against local Postgres configuration.
- Authenticated browser QA passed at 1440px and 390px. Batch confirmation
  reduced the review queue from 23 to 21 facts in one rebuild, the two
  confirmed agency screens became triggered, all 49 authority records
  rendered, horizontal overflow stayed false, and the console remained clean.
- Browser QA found and fixed unequal question-card stretching on the desktop
  report.

## Customer freight operations desk, August 4

Status:

- Implemented on `customer-logistics-dashboard`.
- Production deployment remains pending until this branch is merged to `main`.

What changed:

- Replaced the generic customer KPI strip and alert card with an operations
  desk organized around customer actions, one next recorded event per active
  shipment, active load records, recent shared activity, open RFQs, and the
  delivered archive.
- Added a deterministic customer-safe operations brief derived only from the
  existing portal shipment projection. It summarizes overdue and upcoming
  recorded milestones, approved document publication, requested uploads under
  review, quote responses, and document counts.
- Moved the overview presentation into one shared server component used by the
  authenticated `/portal/workspace` and fictional `/customer` sandbox. Design
  feedback can no longer improve the sandbox while leaving the real customer
  workspace behind.
- Preserved the compact shipment tracking page and added customer-specific
  browser titles plus `aria-current` navigation state.
- Date-only freight milestones now render in UTC so a planned calendar date
  does not shift to the previous day in a West Coast development environment.

Safety:

- No schema, dependency, membership, session, upload, quote-action, or job
  status behavior changed.
- The operations brief consumes only the allowlisted customer portal view
  model. It does not add Prisma reads or expose internal notes, cost, margin,
  supplier messages, or hidden documents.
- `/customer` remains fictional, noindex, and independent of portal auth and
  live tenant data.

Verification completed before release:

- `npm run test:customer-portal`
- `npx tsc --noEmit --incremental false`
- `git diff --check`
- Browser checks at 1440px, 820px, and 390px with no horizontal overflow or
  console errors.
- Quote and document action links opened the correct sample shipment anchors.
- Shipment detail remained readable at desktop and mobile widths.

Design result:

- Design score improved from B- to A-.
- AI slop score improved from C+ to A.
- Full local report:
  `~/.gstack/projects/mmturna-derya-crm/designs/design-audit-20260804/design-audit-customer.md`.

Release note:

- No migration or environment change is required. After merge, verify
  `/customer`, `/portal`, and one authenticated or staff-preview shipment on
  the deployed domain.

## Supply OS generator repair and resilient research, August 7

Status:

- Implemented on `supply-os-light-gray`, targeting `main`.
- No database migration or new environment variable is required.

What changed:

- Restored the five engagement-scope buttons. The floated fieldset legend had
  collapsed their grid to zero width.
- Lifted Supply OS from near-black to a lighter neutral graphite scale while
  retaining the restrained enterprise design language.
- Added an inline research trace that reports website verification, company and
  product discovery, operating-location evidence, supply assumptions, and
  dashboard generation.
- Company research now streams progress as newline-delimited JSON instead of
  returning one opaque blocking response.
- When public search is unavailable or returns unusable output, a prompt with
  an explicit website falls back to a bounded review of up to four relevant
  pages on the verified official domain.
- The official-site fallback extracts the company name, description, logo,
  structured locations, product page titles, customer markets, evidence links,
  and deterministic likely-input hypotheses.
- Customer-provided operating locations remain inferred and visibly require
  confirmation. An official structured facility address can be shown as found.
- A prompt without a website now receives an actionable recovery message and
  retains the description-only build option.

Trust boundary:

- The official-site fallback stays on the user-supplied public domain, rejects
  local or private addresses, caps response size, limits redirects and page
  count, and does not read login or paywalled content.
- Public pages do not confirm suppliers, source countries, lanes, rates,
  customs treatment, providers, or customer demand. Likely inputs remain
  hypotheses and external commitments retain human approval.

Verification:

- All eight Supply OS regression suites passed.
- `npx tsc --noEmit` passed.
- The production Next.js build passed against the disposable local Postgres
  database.
- Authenticated browser QA passed for the AON3D official-site fallback, the
  no-website recovery path, full-width scope buttons, the resulting sourced
  dashboard, and the 390-pixel layout.
- Design score improved from D to B and AI slop score improved from B to A.
- Full report:
  `~/.gstack/projects/mmturna-derya-crm/designs/design-audit-20260807-supply-os-light-gray/design-audit-20260807-supply-os-light-gray.md`.

Caveat:

- Cases remain browser-local. The fallback improves demo resilience but is not
  a replacement for office-scoped persistence or connected ERP, TMS,
  procurement, customs, rate, and shipment data.

## Supply OS production research cutoff hotfix, August 7

Status:

- Implemented on `hotfix-supply-research-terminal`, targeting `main`.

Root cause and fix:

- Production selected the model-backed public-search path whenever
  `OPENAI_API_KEY` existed, even when the prompt already contained the official
  website. The deployed function was cut off while awaiting that upstream call,
  after the first progress event but before a result or structured error.
- Explicit websites now use the bounded official-site path first. If that site
  is unreachable and public search is configured, the model path remains a
  secondary recovery path.
- Name-only public search now has a 20-second client timeout and no SDK retry,
  so it can return a structured error before the deployment runtime closes the
  response.

Verification:

- The strategy regression test proves that a prompt with `aon3d.com` chooses
  `official_site` even when public search is configured.
- A manual AON3D reproduction with a deliberately invalid provider key returned
  four official sources and all six progress steps in 1.6 seconds, proving the
  provider was bypassed.

## Supply OS name-only research and customer-result quality, August 7

Status:

- Implemented on `fix/supply-os-research-quality`, targeting `main`.
- No database migration, dependency, or new environment variable is required.

Root cause and fix:

- The previous hotfix protected prompts with an explicit website, but a
  name-only prompt still waited on model-backed public search before any useful
  dashboard existed. Production could close that stream without a terminal
  event.
- Name-only research now derives a bounded set of likely public domains,
  verifies company identity from official metadata and page content, rejects
  parked or mismatched sites, and ranks the strongest official candidate.
- Public model search is secondary enrichment with an eight-second bound. The
  browser has a twelve-second total research deadline and automatically builds
  a saved draft from the user input if enrichment cannot finish.
- `do nox metals` resolves `noxmetals.co` instead of the unrelated legacy
  `noxmetals.com` business and produces a sourced dashboard without an OpenAI
  key.

Planning quality:

- Company materials and components now use a distinct `Needs` field. They are
  never parsed as geographic source regions.
- When supplier or customer geography is unknown, the map shows the verified
  operating site and asks for one real endpoint instead of inventing a lane.
- Metals delivery copy describes stock, cut-to-size orders, and replenishment
  material rather than generic finished goods.

Customer surface:

- Supply OS now uses light-gray page surfaces, white working panels, and the
  existing navy shell without gradients, decorative color, or visual noise.
- The new-customer page is one compact form. Workstream details remain closed
  until selected, and supplementary form explanation is removed on mobile.

Verification:

- All eight Supply OS suites, TypeScript, and the production Next.js build
  passed.
- Authenticated browser QA covered the exact `do nox metals` input, correct
  official-site resolution, four retained official sources, the verified
  Ferndale operating location, zero invented route origins, workstream
  expand/collapse behavior, and clean 1440 by 1000 and 390 by 844 layouts.
- A clean reload reported no browser console errors.
- Design review improved the result from C to A- and AI slop from B to A-.

Caveat:

- Likely-domain discovery is deliberately bounded and heuristic. Ambiguous
  company names can still require an explicit website, but failure can no
  longer prevent the user from receiving a dashboard.

## Supply OS company network optimization engine, August 7

Status:

- Implemented on `feat/supply-os-optimization-engine`, targeting `main`.
- No database migration, dependency, secret, or new environment variable is
  required.

Customer result:

- The Supply OS dashboard is now a light, restrained operating surface with no
  corner logo tile, decorative underline selection, gradients, or random
  highlight colors.
- The page order is company evidence, operating scope, one working network
  summary, interactive supplier-to-customer network, ranked improvement queue,
  first-input handoff, then evidence and assumptions.
- The map zooms to the customer's network. A stage rail selects each source,
  operating site, and buyer market, while the adjacent dossier shows cargo,
  likely movement, confidence, evidence basis, qualification targets, and the
  next fact to confirm.
- The ranked queue provides a current condition, recommended change, customer
  decision, required input, and linked workstream for procurement, supplier
  contact, shipment planning, customs, and fulfillment or 3PL.
- Each linked workstream route carries the customer case context and shows a
  customer-specific starting point. The routes explicitly state that no
  supplier, booking, filing, or spend action is active.

NOX Metals model:

- The network now models direct U.S. aerospace plate mills, Great Lakes
  service-center buffer stock, a Southern Ontario alternate, the official
  operating site, Southeast Michigan production buyers, and nationwide
  aerospace, defense, and new-space buyers.
- Qualification targets include Arconic Davenport Works, Constellium
  Ravenswood, Kaiser Aluminum Trentwood, ICI Metals, Yarde Metals, and Samuel
  Service Center. These are capability matches to investigate, not claimed NOX
  suppliers.
- The first five actions cover grade-level source control, supplier release
  cadence, urgent versus planned inbound, Canadian customs pre-clearance, and
  delivery policy by plate and order profile.

Research quality:

- Official-site research now extracts visible U.S. postal addresses from
  relevant pages in addition to JSON-LD. The parser rejects a second pure
  numeric token, preventing an alloy number such as 5083 from becoming part of
  a street address.
- A fresh authenticated `do nox metals` run resolved `noxmetals.co`, retained
  four official sources, and produced the clean official Ferndale address.

Verification:

- All nine Supply OS regression suites passed.
- `npx tsc --noEmit` passed.
- Scoped lint passed with no warnings or errors. The repository-wide lint still
  fails on the existing unrelated backlog in inbox, jobs, RFQ, agent, and
  portal files.
- The optimized Next.js production build passed against the disposable local
  Postgres database.
- Authenticated browser QA passed at 1440 by 1000, 1024 by 900, and 390 by 844.
  It covered fresh NOX research, stage selection, qualification links, action
  disclosure, workstream routing, presentation mode, and horizontal overflow.
- Design system: `DESIGN.md`.
- Design audit:
  `~/.gstack/projects/mmturna-derya-crm/designs/supply-os-optimization-20260807/design-audit.md`.

Trust boundary:

- Official, third-party public, customer-stated, and inferred node evidence now
  retain distinct labels. A route is customer-stated only when both endpoints
  came from customer input; known or researched endpoints alone do not prove a
  shipment occurred.
- Profile selection reads the original customer prompt before the legacy
  fallback industry label, so an explicit additive, robotics, medical,
  aerospace, chemical, or automotive description is not overwritten by a
  generic classification.
- Inferred nodes and dashed routes remain planning hypotheses. Candidate
  suppliers and buyer profiles are not known relationships. The dashboard
  still needs office-scoped ERP, procurement, CRM, shipment, and broker records
  before it can represent the customer's actual operating network.

## Supply OS fixed command map, August 7

Status:

- Implemented on `feat/supply-os-command-map`, targeting `main`.
- No database migration, secret, environment variable, or external operating
  action is required.

Customer result:

- The saved-customer dashboard is now one fixed-height page with no document
  scrolling at supported desktop and presentation sizes.
- A compact customer header, physical-flow object rail, live map, selected
  dossier, and bottom status strip replace the prior stacked report sections.
- Suppliers, movements, customs handoffs, factories, distribution points, and
  customers are selectable. Map hover or keyboard focus shows a compact local
  contact card. The dossier exposes provider candidates, readiness checks, one
  next action, and the relevant workstream.
- International and domestic movement candidates include DHL Global
  Forwarding and Uber Freight. U.S.-Canada customs candidates include
  Livingston International and Farrow. These are public capability matches,
  not connected providers, live rates, or awarded work.

Design and implementation:

- The map uses React MapLibre and MapLibre GL JS with OpenFreeMap Positron.
  Lucide supplies operational symbols, and Radix supplies menus and tooltips.
  No hand-drawn geography, invented icon set, or copied proprietary asset is
  included.
- Color is limited to evidence and operating status. Selection uses border,
  weight, and a quiet neutral background.
- A WebGL 2 capability gate prevents the map engine from taking down the page.
  Unsupported environments retain the object rail and dossier with a bounded
  renderer notice.
- Movement and customs markers use separate screen offsets when they share a
  modeled coordinate, so both remain selectable without inventing a second
  geographic location.
- The location parser recognizes Ferndale, Michigan only when it appears as a
  direct operating-location descriptor. Market language such as
  `China-focused supplier` cannot become a false headquarters. Ferndale remains
  in the U.S. customs territory.
- Country matching gives explicit U.S. geography priority over the `Laredo`
  border alias. Monterrey-to-Laredo movements now receive a U.S.-Mexico customs
  handoff, while China ocean movements do not receive a Canada-only broker.

Verification:

- All ten Supply OS suites passed before the final documentation update.
- The command-map coverage audit reached about 70 percent after adding Canada,
  Mexico, China ocean, and domestic regression fixtures across evidence,
  provider, movement, and customs branches.
- TypeScript and the optimized production build passed with generated Prisma
  client artifacts and a disposable local database URL.
- Authenticated browser QA created a NOX Metals case and verified three supplier
  objects, a customs handoff, the Ferndale operating site, customer clusters,
  candidate contacts, workstream navigation, zero document scroll at 1280 by
  720, and a clean console after reload.
- The headless browser does not expose WebGL 2, so browser QA exercised the
  graceful fallback. The live map path is covered by type checking, build, and
  command-map tests but still needs a final GPU-browser production check.

Trust boundary:

- Public provider links are candidate contacts only. No live quote, booking,
  customs filing, provider message, supplier award, or spend mutation was
  introduced.
- Existing browser-local, office/user-scoped customer-case storage and explicit
  evidence labels remain unchanged.

## Supply OS resilient map, company identity, and deep analysis, August 7

Status:

- Implemented on `fix/supply-os-map-analysis-v2`, targeting `main`.
- No database migration, secret, external message, booking, customs filing, or
  spend mutation is required.

Customer result:

- The map now opens on a real neutral CARTO raster basemap. If that source does
  not produce usable content, the component remounts with CARTO Positron and
  then OpenFreeMap Positron. WebGL-unavailable environments retain the network
  rail and inspector.
- The coverage menu opens 18 pixels clear of the right inspector at 1280
  pixels instead of covering its contents.
- Company identity prefers structured data and visible official brand assets.
  It rejects social-preview photographs and unlabelled customer-logo carousel
  images. Existing saved SEO titles collapse back to the company name, and a
  suspicious saved hero image can use the official site's conventional logo
  path before hiding on error.
- The right inspector now separates selected-object detail from optimization
  priorities using Radix tabs. Every action includes condition, Derya move,
  customer decision, starting input, measured result, and a linked workstream.
- The advanced-aircraft model now maps U.S. structures and special processes,
  UK and European propulsion electronics, North American avionics and mission
  systems, final integration, customs, and program or deployment markets. It
  exposes eight operating controls: multi-tier BOM, demand gates,
  serial-number kits, prototype and production lanes, supplier readiness,
  customs passports, gateway variability, and field spares.

Verification:

- All ten Supply OS regression suites pass.
- `npx tsc --noEmit --incremental false` passes.
- GPU-enabled Chrome QA shows the CARTO basemap at 1280 by 720 and 2048 by
  1100, with no document overflow and no console errors.
- Coverage-menu geometry measured `[588, 918]` against inspector geometry
  `[936, 1268]`, so the surfaces do not intersect.
- A live Odys Aviation research run resolved `https://www.odysaviation.com/logo.svg`,
  displayed `Odys Aviation`, built six network objects and four lanes, and
  exposed eight advanced-aircraft priorities.
- Design audit:
  `~/.gstack/projects/mmturna-derya-crm/designs/design-audit-20260807-supply-os-map-analysis/design-audit.md`.

Trust boundary:

- The richer network and recommendations remain outside-in planning
  hypotheses. Public evidence, customer input, and inference stay distinct.
- No candidate provider, supplier, route, classification, rate, or program
  relationship becomes an operating fact without connected records and human
  approval.

## Supply OS clickable lane intelligence, August 7

Status:

- Implemented on `feat/supply-os-route-intelligence`, targeting `main`.
- No database migration, secret, external message, quote request, booking,
  customs filing, supplier award, or spend mutation is required.

Customer result:

- Supplier, factory, and customer points are now joined by visible solid paths
  over the CARTO basemap. Every lane has a 24 pixel native button target, an
  `Open lane` marker, and a matching item in the left network rail.
- Clicking a lane opens one decision surface with cargo, estimated road miles,
  a modeled low and high cost range, modeled cost per mile, required checks,
  and carrier candidates at the relevant endpoint.
- The inspector uses Recharts for a labeled supplier-to-mode-to-destination
  flow and a planning-range bar chart. The optimization tab has a labeled
  whole-network flow view.
- Ranked optimization priorities now appear on the relevant map point or lane.
  Selecting a priority focuses the associated object without leaving the map.
- The current regional candidate set includes official public contact details
  for Phoenix, Los Angeles, Detroit, and Quebec operators. Each card states the
  endpoint it can serve, official phone number, official address, capability,
  and source page.

Model and evidence boundary:

- Known-location normalization keeps a researched factory in the graph when
  the source names a supported city but omits coordinates. It does not upgrade
  the source basis or claim that a movement occurred.
- Domestic U.S. and Canada movements use road modes instead of inheriting an
  industry profile's international air or ocean default.
- Road costs are deterministic planning envelopes, not live quotes. The model
  uses estimated road miles, transparent mode and cross-border buffers, and
  the current ATRI operating-cost benchmark. It excludes duties, taxes,
  insurance, storage, exams, accessorials, live capacity, equipment, exact
  addresses, and appointments.
- Candidate carriers are public capability matches. They are not connected
  capacity, awarded providers, or evidence of a commercial relationship.

Verification:

- All ten Supply OS regression suites passed.
- `npx tsc --noEmit --incremental false` passed.
- The optimized production build passed and generated all 57 static pages.
- GPU-enabled Chrome QA passed at 1280 by 720 and 2048 by 720. The lane path
  showed a pointer cursor, opened the correct transport inspector, retained a
  visible supplier endpoint, produced no document overflow, and logged no
  console errors.
- Scoped ESLint could not run because this repository uses a legacy
  `.eslintrc.json` with ESLint 9 and the nested Conductor worktree resolves two
  copies of `@next/next`. This is a repository tooling issue. Type checking,
  focused regression tests, browser QA, and the production build all passed.

Follow-up release check:

- Customs dossier markers now use the same clearance coordinates as the
  rendered port or airport customs segment, instead of a generic lane midpoint.
- Taiwan is classified separately from mainland China so Kaohsiung and Taoyuan
  gateways are reachable planning paths.
- Entering only `AON3D` or `aon3d.com` still produces the complete demo if
  public research is unavailable.
- Command-map regression tests, TypeScript, and the production build passed.

## Supply OS evidence signals and relevant visuals, August 7

Status:

- Implemented on `feat/supply-os-evidence-insights`, targeting `main`.
- No database migration, secret, outbound action, quote request, booking,
  customs filing, supplier award, or spend mutation is required.

Customer result:

- The map can show up to three current material, lane, port, tariff, customs,
  congestion, or capacity signals. A signal is shown only when it cites a
  public source and matches a displayed route by material or location.
- Signal cards state the sourced finding, operating implication, source, and
  research date. Inferred or uncited findings never become map alerts.
- Company research now continues from the verified official site into a
  bounded public-source pass when an OpenAI key is configured. It asks for
  dated evidence and rejects unsupported language about costs or live rates.
  If that pass fails, the verified official-site result still builds the case.
- Non-selected lanes now use compact transport markers instead of repeated
  `Open lane` labels. The broken navigation control was removed, the scale and
  fit controls remain, and the legend now explains only operating points,
  planned routes, and sourced signals that are present.
- The generic routes-and-providers footer sentence was removed. Single-mode
  transport legs no longer render a flow chart, modeled price ranges no longer
  render a redundant two-bar chart, and completed checks are omitted. The
  whole-network flow appears only for a network with at least three points and
  two movements.

Verification:

- `npx tsx scripts/supply-os-evidence-insights.test.ts` passed.
- Command-map and company-research regression suites passed.
- The optimized production build passed and generated all 57 static pages.
- Local browser navigation reached the expected authentication boundary. A
  post-change authenticated screenshot could not be captured with the local
  placeholder database, so the user screenshots and source-level visual
  contract test are the visual evidence for this patch.

## Supply OS ingestion and supplier intelligence hardening, August 8

Status:

- Implemented on `agent3/data-ingestion-supplier-intelligence` from
  `origin/supply-os-grand-vision`.
- One local commit is intended. Nothing is pushed, and no Supply OS visual
  workspace file was touched.

What changed:

- CSV ingestion now covers locations, items, BOM, inventory, demand, purchase
  orders, supplier terms, and compliance records. It supports explicit column
  mappings, quoted and escaped fields, row-level malformed input, deterministic
  normalization, templates, stale inventory, identity collisions, references,
  units, dates, coordinates, and cycles.
- Missing quantities, scrap, price, MOQ, lead time, and optional dates remain
  unknown. A forward migration makes inventory quantities and BOM scrap
  nullable instead of storing false zeroes.
- Product identity follows the required deterministic order. Fuzzy and vector
  matches are review proposals, never automatic merges.
- Component supplier research keeps only provider-cited claims, attaches every
  candidate to one component, labels freshness, degrades cleanly with no
  sources, and rejects unsupported, stale, or cross-office approval attempts.
- Provider candidates require a concrete logistics role and role-specific
  evidence. Customs boilerplate cannot become a movement lane.
- Authenticated endpoints expose all eight CSV templates and component-scoped
  supplier research. SAP and Oracle are registered as unavailable adapters.

Verification:

- New CSV and ingestion/research suites pass.
- Existing steel supplier, DSL, market-lane, signal-suppression,
  intelligence-map, persistence, and execution suites pass.
- Fresh PostgreSQL migration deploy applies all 22 migrations.
- Prisma validation, TypeScript, production build, diff hygiene, and the
  touched-path tenant audit pass. The full tenant audit still reports nine
  unrelated pre-existing findings outside the touched Supply OS paths.

Caveat and next step:

- Optional purchase-order, supplier-term, and compliance rows are currently
  immutable JSON metadata on the snapshot. Move them to dedicated typed tables
  when Agent 2 needs cross-snapshot queries or execution joins. Do not pretend
  the current component research result is an awarded supplier or live quote.

## Supply OS automation draft workspace, August 9

Status:

- Implemented on `main` in `939a0ad`, `35c2ac8`, `f576b34`, `dec7520`, and
  `c9b6faf`.
- No database schema, dependency, secret, provider call, external message, or
  external write was added.

Operator result:

- Supply OS now has a sixth `Automations` tab with URL state at
  `?panel=automations`.
- The desktop workspace gives chat roughly two-thirds of the width and keeps an
  automation library plus the selected step plan in the right context pane.
- Built-in drafts cover bill of lading preparation, supplier search, freight
  rate requests, customs document checks, and transport exception monitoring.
- Chat can create a new browser-session automation, append an operator step, or
  add an approval gate. New drafts appear immediately in the library and remain
  selected for review.
- The responsive layout stacks chat and the automation library without page
  overflow. The compact navigation scrolls the active sixth tab fully into
  view.
- Generic `Boxes` icons were removed from Supply OS. Supplier, supply,
  loading, drive, and uncategorized states now use object-specific Lucide
  icons.

Verification:

- `npm run test:supply-os-automations`
- `npm run test:supply-os-shell-routing`
- `npm run test:supply-os-sidebar-map`
- `npm run test:supply-os-continuous-layout`
- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-operations-ui`
- `npm run check:product-copy`
- `npx tsc --noEmit`
- Authenticated browser QA at 1440 by 1000 and 390 by 844. The new draft flow,
  six-item navigation, zero horizontal overflow, and 44px minimum interactive
  targets passed.

Trust boundary:

- Automations are client-side session drafts. They do not persist, read or
  write canonical freight records, call an LLM, contact providers or customers,
  file customs, book transport, or authorize spend.
- Production execution requires a separate office-scoped workflow model,
  versioned typed actions, approval hashes, audit history, and idempotent
  workers.

Known existing failure:

- `npm run test:supply-os-product-twin` still fails because its source contract
  expects `commandMap.insights` in the dashboard after the upstream map rewrite.
  This task did not modify that existing test.

## Supply OS connected supplier replies, August 10

Status:

- Implemented on `supply-os-supplier-replies`, targeting `main`.
- No Prisma migration or new dependency is required. Reply state uses the
  existing email, execution-task, event, and evidence records.

Operator result:

- A delivered connected-Gmail quote cycle exposes `Check connected inbox`.
- Supply OS runs the office-scoped Gmail sync, finds inbound messages in the
  exact delivered thread from the approved supplier address, and saves each as
  durable connected evidence.
- Reply cards survive queue navigation and show sender, subject, received date,
  excerpt, attachments, and the evidence link.
- `Use as quote evidence` pins the response date to the Gmail observation. The
  buyer still enters and reviews price, currency, MOQ, unit, delivery, quote
  reference, and validity before the commercial gate can advance.

Trust boundary:

- Email content and attachments remain review input. They never automatically
  become approved commercial terms, supplier qualification, purchase authority,
  spend, or a Logistics handoff.
- Only the current office, workspace, quote cycle, connected sender account,
  provider thread, and exact approved supplier address are accepted.
- Repeated and concurrent checks deduplicate provider messages and do not append
  duplicate evidence or events.

## Supply OS competitive quote inbox, August 10

Status:

- Implemented on `supply-os-multi-supplier-quotes`, targeting `main`.
- No Prisma migration or new dependency is required.

Operator result:

- Supplier comparison supports a shortlist of up to eight candidates.
- Each candidate becomes a durable supplier-specific quote workstream grouped
  under the original research run and restored through the sourcing queue.
- The competitive quote inbox switches between workstreams without leaving
  Supply OS and shows the operator-selected quote, not merely the latest reply.
- Price and delivery badges appear only when request scope and units match;
  price ranking also requires one currency.

Safety and execution boundary:

- Singular and plural API request shapes resolve through the same durable
  supplier identity, so retries do not create duplicate cases.
- Only one supplier in a sourcing group may enter pending or approved award
  state. Supplier contact, quote release, purchase preparation, and final order
  authorization keep their existing approval requirements.
- Attempting to switch supplier workstreams while a form is dirty is blocked
  inline instead of silently discarding operator input.

## Supply OS opportunity scenario workbench, August 9

Status:

- Implemented on `main` in `4d00cd9` and `e965548`.
- No database schema, dependency, secret, provider call, or external write was
  added.

Operator result:

- Opportunities no longer repeats the Logistics map and priority inspector.
  It opens a scenario workbench with Supply, Logistics, Production, and Network
  plays.
- Selecting a play shows its current condition, proposed change, and missing
  inputs. `Run scenario` updates a current-versus-change output with the measure,
  operator decision, evidence state, and human-approval boundary.
- The UI replaces assembly terminology with production language on this
  surface. Company-model text is normalized before display so the retired term
  does not leak back through a generated recommendation.
- Tablet and mobile runs bring the output into view. The layout keeps the
  company ribbon, domain navigation, provenance state, and approval warning.

Verification:

- `npx tsx scripts/supply-os-opportunity-scenarios.test.ts`
- `npm run test:supply-os-scenario-viewport`
- `npm run test:supply-os-continuous-layout`
- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-operations-ui`
- `npm run check:product-copy`
- `npx tsc --noEmit`
- Production `npm run build` passed against a disposable local PostgreSQL
  database and generated all 60 static pages.
- Authenticated browser QA at 1440 by 1000, 1024 by 900, and 390 by 844.
  Scenario selection and run output passed with no horizontal overflow or
  console errors.
- Scoped `npx eslint src/app/dashboard/supply-os/supply-os-dashboard.tsx` did
  not run because this repo has ESLint 9 but no `eslint.config.js`, `.mjs`, or
  `.cjs` file. No lint configuration was changed for this task.

Trust boundary:

- Results reuse the deterministic company optimization model. Missing inputs
  stay visible. No rate, award, booking, filing, supplier commitment, or spend
  approval is implied.

## Supply OS connected purchase order delivery, August 10

Status:

- Implemented on `supply-os-order-delivery`, targeting `main`.
- No Prisma migration or new dependency is required.

Operator result:

- A finally authorized purchase action can produce an exact connected-Gmail
  order draft with sender, supplier recipient, subject, message, purchase order
  reference, and acknowledgment due date.
- The message requires a separate manager approval. Operators can leave and
  resume draft, approval, uncertain delivery, retry, sent, and released states
  from the sourcing queue.
- Gmail receipt evidence and the existing purchase release checkpoint are
  persisted together. The manual external-release path remains available when
  no connected delivery is active.

Trust boundary:

- Purchase authorization does not authorize arbitrary email content. The exact
  message and authorized action scope are independently pinned and approved.
- Unknown provider delivery blocks duplicate sending and alternate release
  channels until reconciliation. A confirmed miss needs a manager recovery note
  before retry.
- This does not create a canonical purchase order, payment, booking, customs
  filing, or Logistics handoff.

## Supply OS connected supplier order acknowledgments, August 10

Status:

- Implemented on `supply-os-connected-order-acknowledgments`, targeting `main`.
- No Prisma migration or new dependency is required.

Operator result:

- A connected-Gmail purchase order that is released or partially acknowledged
  exposes `Check order thread` in the same sourcing workstream.
- Supply OS captures only post-send replies from the exact supplier address in
  the exact connected account and thread. Reply cards, attachments, evidence,
  and the last sync time survive queue navigation.
- `Use as acknowledgment evidence` pins the Gmail observation date. The
  operator still enters supplier reference, accepted quantity, and confirmed
  delivery before the existing partial or full acknowledgment transition runs.

Trust boundary:

- Captured text is review evidence, not structured acceptance. No model or
  parser advances quantity or delivery state.
- One connected reply cannot be reused for another quantity-bearing
  acknowledgment. Partial acceptance preserves the inbox for later replies.
- The acknowledgment validator now respects connected Gmail evidence URLs;
  generic public-URL normalization previously made connected releases
  impossible to acknowledge.
- No payment, booking, customs, inventory mutation, or Logistics handoff is
  created.

## Supply OS supplier order exceptions, August 10

Status:

- Implemented on `supply-os-order-exceptions`, targeting `main`.
- No Prisma migration or new dependency is required.

Operator result:

- A buyer can classify a supplier reply as changed quantity, price, delivery,
  payment terms, rejection, or another order exception.
- The exception and its evidence persist in the supplier workstream. The queue
  shows review or replacement-authorization work instead of a false normal
  acknowledgment action.
- A manager may record that the original authorization remains authoritative.
  An admin may require a new exact-scope purchase authorization.

Trust boundary:

- Open and revision-required exceptions block supplier acknowledgment. A Gmail
  reply can support acceptance or an exception, never both.
- Requiring new authorization does not edit or resend the old order. The next
  slice must create a replacement order scope before supplier acceptance can
  continue.
- No payment, booking, customs, inventory mutation, or Logistics handoff is
  created.

## Supply OS revised purchase authorization, August 11

Status:

- Implemented on `supply-os-revised-order-authorization`, targeting `main`.
- No Prisma migration or new dependency is required.

Operator result:

- A revision-required supplier exception can create a separate replacement
  order draft in the persistent sourcing workstream.
- The replacement scope retains the prior award, supplier qualification,
  quality plan, original release, exception evidence, and exact revised terms.
- A fresh admin decision authorizes the replacement. Manual release evidence or
  connected Gmail delivery then supersedes the original order atomically.

Trust boundary:

- Approval alone does not claim that the supplier received the replacement.
  The original released order remains outstanding and acknowledgment-blocked
  until the revised order is actually released.
- The old release remains immutable history and points to the replacement
  action and release hash after supersession.
- Supplier rejection creates a persistent return-to-sourcing state and returns
  the buyer to the shortlist; it cannot be retained or converted into a revised
  order. No payment, inventory, booking, customs, or Logistics state is created.

## Supply OS replacement authorization freshness, August 11

Status:

- Implemented on `supply-os-authorization-freshness`, targeting `main`.
- No Prisma migration or new dependency is required.

Operator result:

- If supplier qualification or the quality-plan checkpoint expires while a
  replacement order is being prepared, approved, or sent, the supplier
  workstream returns to comparison instead of becoming stuck.
- The sourcing queue records whether qualification or quality evidence expired.
  The original released order remains active and visible until the buyer chooses
  and qualifies a valid source.
- Stale replacement drafts, actions, pending approvals, and unsent connected
  email tasks are cancelled as one recovery transition.

Trust boundary:

- Connected Gmail revalidates freshness before calling the provider. It does
  not send a replacement supported by expired evidence.
- Unknown or in-flight provider delivery cannot be erased by the recovery path;
  it must be reconciled first.
- The recovery state does not contact a supplier, commit spend, supersede the
  existing order, or create Logistics, customs, payment, or inventory state.
### Supply sourcing release hardening after PR review

- PR #132 now derives the customer workspace from the persisted research run or task across shortlist, procurement, supplier email, reply capture, and quote extraction.
- Supplier profiles preserve Unicode identities and keep the base key stable when a website is discovered later. A different known domain receives a deterministic disambiguated key so distinct same-name suppliers do not merge. Price, currency, and unit must bind to one managed retrieval receipt before a public listing observation is stored.
- Research completion locks the run and accepts only one active completion. Failure handling cannot rewrite a completed run.
- Legacy plan-only quality gates now fail closed at award approval, approval decision, purchase preparation, final approval, and authorization.
- Passed: Prisma validation, TypeScript, focused Supply OS contracts, supplier email provider checks, deployment boundary, diff hygiene, and optimized production build.
- Database lifecycle verification remains unavailable in this managed sandbox because PostgreSQL initialization was denied before startup. Apply the migration before merging.

## Supply OS research progress and retry recovery, August 11

Status:

- Implemented on `supply-os-quality-verification`, PR #132.
- No Prisma migration or new dependency is required.

Operator result:

- Research progress now follows the actual request, public search, validation,
  and candidate-screening lifecycle instead of advancing on presentation timers.
- Each stage has an expandable disclosure. Returned source URLs are deduplicated,
  labeled by source type, and linked from the open-web stage.
- Completed research remains visible until the operator chooses Review suppliers,
  so the source disclosures do not disappear on an automatic transition.
- An empty or degraded research result keeps the saved request and offers Retry
  research. Editing the request remains a separate action and is no longer the
  only recovery path.

Trust boundary:

- The UI does not claim that sources were checked before the blocking provider
  response returns. URLs appear only when attributable evidence is present.
- Public results remain unqualified, and retrying research does not contact a
  supplier, authorize spend, or advance procurement.

Acceptance coverage:

- `scripts/fixtures/guild-procurement-bom.ts` captures the supplied 40-line BOM
  across metals, hardware, chemicals, wire, fabrication, instrumentation,
  packaging, and documentation deliverables.
- `npm run test:supply-os-bom-acceptance` validates that every researchable line
  satisfies intake requirements. Item 027 intentionally remains a clarification
  case because `As required` supplies neither quantity nor unit.
- `npm run test:supply-os-live-research -- --ids=001,011` drives the same public
  research provider used by the product. A deployed run requires base URL,
  authenticated cookie, and workspace ID environment variables; a direct run
  requires `OPENAI_API_KEY`.

## Supply OS customer parts intake and research failure recovery, August 12

Status:

- Implemented locally on `supply-os-quality-verification` after PR #132 review.
- Focused contracts, TypeScript, Prisma generation, and the optimized Next build
  pass. The feature is not ready to merge until it is reconciled with current
  main and its migration is applied safely.

Operator result:

- The selected customer workspace exposes a parts CSV importer to administrators
  and managers. The importer accepts the supplied five-column procurement table,
  including quantity cells with units and an explicit unknown quantity.
- Published parts and BOM demand enter the sourcing queue. Known facts survive
  intake refinement, while missing delivery location, date, unit, or quantity
  are asked once as clarification rather than invented.
- Research shows expandable request, discovery, validation, and screening
  stages. Returned checked URLs remain inspectable, including pages that did not
  become retained supplier candidates.
- Retry starts a new provider request. Restored failed runs do not return to the
  initial request cycle.

Failure and evidence boundary:

- Missing provider configuration, timeouts, upstream errors, and invalid
  structured responses are saved as failed runs and returned as typed non-success
  responses. They cannot become successful empty research.
- A supplier is not suggested unless capability, public price, delivery, source,
  currency, unit, and lead time pass the evidence checks. Missing public price
  remains unknown and can move into the approval-gated RFQ workflow.
- Research and import do not contact suppliers, approve spend, release an order,
  create payment, or create Logistics state.

Remaining release checks:

- Rebuild the feature on remote main SHA
  `232c026bdc7ae44eafd23f85bdff668fdd64d273` and preserve current company
  isolation and connector behavior.
- Apply `20260812000100_supply_intelligence_profiles` before feature runtime
  reaches production.
- Run the live acceptance runner with an authenticated workspace and Exa key,
  then confirm at least one attributable forced-live listing receipt for a
  price-suitable BOM item. The listing must remain separate from a reviewed
  supplier quote and require RFQ confirmation.
- Verify CSV upload, retry, URL disclosures, and mobile layout in the deployed
  authenticated browser.

### Follow-up hardening completed before reconciliation

- One-file parts imports now expand the latest immutable customer snapshot. A
  stale staged parts draft fails at publish, so concurrent uploads cannot hide
  the winner. Full normalized snapshot imports still replace by design.
- Fixed workspace selection fails closed and browser-local sourcing drafts are
  workspace-scoped. Retrying a persisted failed run restores its saved facts
  and enters research directly.
- Public price freshness is server-owned. Provider timestamps are ignored and
  the application does not fetch search-result pages from its own network.
  Listing claims remain visible with source links but stay non-orderable until
  an isolated managed retrieval connector verifies the item and complete tuple.
- Shortlist and selection persistence also downgrade provider commercial terms,
  including completed legacy runs whose model-supplied timestamps once appeared
  fresh.
- Release order remains unchanged: land the schema-only rollout, confirm the
  production migration, remove the temporary migration hook, reconcile the
  runtime feature onto that main, then run authenticated research and browser
  canaries before merging runtime.

### 2026-08-13 - GUILD campaign provider fallback and terminal setup state

- Production symptom: GUILD showed every row as `Preparing workspace` while the
  campaign API returned `Bulk supplier research requires the public-page
  validation provider.` The campaign rejected missing Exa configuration before
  provisioning the GUILD workspace, and the UI confused that terminal error
  with active setup.
- UI correction: A failed campaign start with no workspace now shows `Supplier
  research unavailable` and `Research unavailable`. Every GUILD row offers the
  campaign retry and cannot fall through to the Atlas manual-research workspace.
- Provider correction: The campaign chooses Exa when configured and otherwise
  uses the existing OpenAI key. The chosen provider is immutable per campaign
  generation and child attempt. There is no runtime cross-provider failover.
- OpenAI evidence: Web search source URLs and native citations are proposals,
  not proof. The server retrieves cited pages with public-address pinning and
  strict byte, time, redirect, encoding, content-type, login, and paywall
  limits. Only exact page-backed company identity, supplier role, and requested
  capability excerpts create a PUBLIC supplier lead receipt and a
  `REVIEW_REQUIRED` candidate. Commercial fields remain unknown.
- Persistence and campaign safety: Campaign aggregation and supply intelligence
  rebuild both Exa and OpenAI receipts from immutable captures. Search-only
  sources remain visible with zero admitted leads. Superseded campaign children
  cannot be listed or claimed by workers.
- Verification includes the new `test:supply-os-openai-retrieval` contract plus
  provider-selection, worker pinning, mixed-provider campaign aggregation,
  source-only evidence retention, and database cutover assertions.

### 2026-08-13 - GUILD zero-lead supplier validation repair

Status:

- Implemented after production research returned relevant supplier domains but
  retained zero candidates for GUILD-001.
- No schema or dependency change is required.

Root cause and operator result:

- The material validator required literal order details such as `2.0 mm` and
  exact alloy punctuation before retaining a supplier. It also rejected common
  company/domain forms such as TCI Precision Metals on `tciprecision.com` and
  could miss the same cited page when OpenAI added tracking parameters.
- Material leads now require page-backed material, form, and requested alloy or
  temper. Thickness, finish, cutting, QA documents, stock, price, and lead time
  stay unknown for RFQ confirmation instead of erasing the supplier.
- The supported capability is reduced to the proven core, for example
  `6061-T6 aluminum sheet`. Generic aluminum pages still fail.
- Known tracking-only query parameters are removed for native source, citation,
  proposal, and retrieval binding. Genuine query parameters are preserved.
- Zero-lead output now includes safe counts for discovered URLs, eligible
  proposals, retrieval attempts, retrieved pages, and validated leads.
- The research UI calls search results `Discovery URLs`, shows a terminal
  `Research complete` state for zero leads, avoids repeating the first warning,
  and reopens a saved zero-lead run on its diagnostic and retry view.

Verification:

- `node --import tsx scripts/supply-os-supplier-leads.test.ts`
- `node --import tsx scripts/supply-os-openai-retrieval.test.ts`
- `node --import tsx scripts/supply-os-exa-retrieval.test.ts`
- `node --import tsx scripts/supply-os-continuous-sourcing.test.ts`
- `node --import tsx scripts/supply-os-atlas-sourcing.test.ts`
- `npx tsc --noEmit`

### 2026-08-13 - Supplier discovery reference-domain filter

Status:

- Implemented after a deployed GUILD run displayed Reddit, Wikipedia, arXiv,
  YouTube, NIST, and USITC URLs beside actual supplier catalogs.
- No schema or dependency change is required.

Behavior:

- OpenAI and Exa now reject known social, community, encyclopedia, video,
  academic-reference, government, military, academic, local, and IP-literal
  domains before proposal selection, retrieval, capture, and result sources.
- The legacy component research normalizer and steel supplier finder use the
  same predicate, closing equivalent public-search attribution paths.
- The procurement research view applies the predicate when reopening an older
  immutable run, so historical reference links no longer appear as supplier
  discovery URLs.
- Supplier websites and supplier-hosted catalog PDFs remain eligible. Passing
  this URL gate does not validate a supplier or a commercial claim.

Verification:

- `node --import tsx scripts/supply-os-openai-retrieval.test.ts`
- `node --import tsx scripts/supply-os-exa-retrieval.test.ts`
- `node --import tsx scripts/supply-os-supplier-leads.test.ts`
- `node --import tsx scripts/steel-supplier-search.test.ts`
- `node --import tsx scripts/supply-os-atlas-sourcing.test.ts`
- `node --import tsx scripts/supply-os-continuous-sourcing.test.ts`
- `npx tsc --noEmit`
- `git diff --check`

### 2026-08-13 - Make GUILD supplier research reachable and continuous

Status:

- Implemented after reference-domain filtering exposed two remaining blockers:
  real supplier pages were rejected unless they repeated request-shaped prose,
  and an exhausted nine-attempt line could never run again.
- No schema or dependency change is required.

Supplier reachability:

- Supplier identity remains bound to one independently retrieved public page
  and the supplier domain. Role and capability excerpts no longer need to
  repeat the company name after that binding is established.
- Deterministic role vocabulary now covers service centers, stockists, machine
  shops, fabricators, harness assemblers, packaging suppliers, and inspection
  providers without treating a generic product catalog as role evidence.
- Query variants for exact identity and official catalog discovery omit QA
  paperwork. The capability and QA variant retains it.
- The capability validator handles the bounded synonyms, allowed equivalents,
  and numeric ranges present in the GUILD fixture. It keeps fail-closed negative
  tests for wrong grades, dimensions, cure systems, domains, roles, product
  families, and incomplete packaging bundles.
- A table-driven fixture exercises all 38 sourceable lines with sanitized
  supplier-style catalog phrasing and one line-specific wrong-fit. This is
  deterministic validator coverage, not live supplier acceptance. GUILD-027
  remains clarification-only and GUILD-039 remains a requirement attached to
  awards.

Campaign continuity:

- Nine attempts is now an exploration epoch. Stored attempt ordinals continue
  across epochs, query variants and excluded domains rotate, and retry backoff
  remains bounded at 24 hours.
- Current-policy aggregate evidence carries across the bounded database attempt
  window. Each line retains at most five candidates, 64 sources, and 20
  warnings.
- The demo need-by date and the former twelve-generation limit no longer stop
  discovery. Cron can safely recover only legacy failures caused by the old
  exhaustion rules. Configuration, access, cancellation, superseded scope, and
  manual-review failures remain operator-owned.
- A parent cannot terminalize while a child attempt is running. Daily campaign
  and office provider limits remain unchanged.

Verification:

- `node --import tsx scripts/supply-os-supplier-leads.test.ts`
- `node --import tsx scripts/supply-os-openai-retrieval.test.ts`
- `node --import tsx scripts/supply-os-exa-retrieval.test.ts`
- `node --import tsx scripts/supply-os-continuous-sourcing.test.ts`
- `npm run test:supply-os-research-worker-lifecycle`
- `npm run test:supply-os-research-route-lifecycle`
- `npm run test:supply-os-supplier-research-polling`
- `npm run test:supply-os-supplier-research-failures`
- `node --import tsx scripts/supply-os-bom-acceptance.test.ts`
- `node --import tsx scripts/supply-os-atlas-sourcing.test.ts`
- `NODE_OPTIONS='--conditions=react-server' node --import tsx scripts/supply-os-supply-intelligence.test.ts`
- `npx tsc --noEmit --pretty false --incremental false`
- `git diff --check`

Release boundary:

- The PostgreSQL-backed sourcing persistence suite cannot run in the local
  sandbox because no database service is available. It must pass in GitHub CI
  before merge.
- After deployment, open the authenticated GUILD sourcing queue once. A running
  campaign continues through cron without the browser. Verify the campaign's
  actual retained-lead counts rather than treating deployment status as live
  acceptance.

### 2026-08-14 - Browser-free GUILD supplier evaluation

Status:

- Implemented a direct engineering evaluation command for the fixed 40-line
  GUILD request. It does not use the browser, session cookies, Prisma, the
  production campaign, or the global worker queue.
- The receipt validator now exposes sanitized deterministic decisions for every
  former silent rejection while the production compatibility wrapper returns
  the exact same admitted receipts.

Commands:

```bash
npm run supply-os:supplier-eval -- \
  --doctor \
  --provider=both \
  --checkpoint=.codex-tmp/supplier-eval/guild-canary.json
```

Run the representative six-line canary before the full catalog:

```bash
npm run supply-os:supplier-eval -- \
  --provider=both \
  --ids=001,011,017,024,038,040 \
  --target=3 \
  --retain=5 \
  --max-calls=12 \
  --concurrency=2 \
  --checkpoint=.codex-tmp/supplier-eval/guild-canary.json
```

After reviewing the canary, run the bounded full exploration. The 228-attempt
cap does not guarantee completion, and one research attempt can make more than
one provider HTTP request:

```bash
npm run supply-os:supplier-eval -- \
  --provider=both \
  --ids=all \
  --target=3 \
  --retain=5 \
  --until-complete \
  --max-calls=228 \
  --concurrency=2 \
  --checkpoint=.codex-tmp/supplier-eval/guild.json
```

Resume the same immutable provider streams:

```bash
npm run supply-os:supplier-eval -- \
  --provider=both \
  --ids=all \
  --target=3 \
  --retain=5 \
  --until-complete \
  --max-calls=228 \
  --concurrency=2 \
  --checkpoint=.codex-tmp/supplier-eval/guild.json \
  --resume
```

Replay the saved public-page captures after a validator change without a
provider call:

```bash
npm run supply-os:supplier-eval -- \
  --revalidate=.codex-tmp/supplier-eval/guild.json
```

Output and safety:

- The checkpoint is written atomically after reservation and after every
  provider completion. Stale running attempts become interrupted on resume and
  never reuse an ordinal.
- A local owner-only lock serializes each checkpoint. Fresh or live process
  ownership cannot be stolen. A stale lock is recoverable only when the local
  operating system proves its recorded process is dead.
- The JSON and Markdown scorecards sit beside the checkpoint. They contain the
  retained company, website, evidence URLs, lead counts, and rejection
  histograms. They do not contain API keys or raw page text.
- `EXA_API_KEY` and `OPENAI_API_KEY` must already be exported in the invoking
  shell for `--provider=both`. Missing keys fail before a checkpoint is created.
  Do not paste key values into chat.
- `--doctor` reports only whether required keys are present and whether the
  checkpoint is compatible. It makes no provider calls and writes no file.
- A retryable research error quarantines only that line and provider for the
  current invocation. Authentication, configuration, access, and rate-limit
  failures quarantine that provider. Independent lines and the other provider
  continue, while the final exit remains nonzero so the failure is visible.
- Excluded source domains rotate in bounded windows after every nine attempts,
  and incomplete lines are scheduled by least attempt count to avoid starvation.
- Exit 0 means the exact 38-line, three-to-five-lead acceptance passed. Exit 2
  means the evidence set remains incomplete. Exit 1 means configuration or a
  research attempt failed.

Verification:

- `npm run test:supply-os-supplier-eval`
- `npm run test:supply-os-supplier-leads`
- `npm run test:supply-os-exa-retrieval`
- `npm run test:supply-os-openai-retrieval`
- `npm run test:supply-os-continuous-sourcing`
- `npx tsc --noEmit --pretty false --incremental false`
- `git diff --check`

Live boundary:

- Deterministic tests do not prove live supplier recall. This checkout has no
  provider keys, so the live 38-line command still must be run from a shell
  where both keys are already configured. Inspect the saved per-line rejection
  histogram from the six-line canary first, improve only evidence-proven false
  rejections, revalidate offline, and spend the full bounded call batch only
  when needed.
