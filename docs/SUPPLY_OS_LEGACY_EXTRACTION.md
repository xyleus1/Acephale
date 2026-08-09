# Supply OS Legacy Extraction

## Product boundary

Supply OS is the product. CRM-style modules are implementation details or
operational drill-downs, not separate products in the primary navigation.

The primary surface is `/dashboard/supply-os` with five panels:

1. Materials: product twin, BOM, inventory, demand, and buildability.
2. Suppliers: candidate discovery, evidence, and diligence gaps.
3. Scenarios: sourcing alternatives, compliance constraints, and market signals.
4. Logistics: movement strategy, provider options, customs, and handoffs.
5. Tracking: cost and movement visibility after a plan is approved.

## Completed cutover

- The authenticated product chrome has no legacy module sidebar.
- The dashboard default redirects to Supply OS.
- The standalone Supplier Finder route redirects to the Suppliers panel.
- The standalone Market route redirects to the Scenarios panel.
- Legacy CRM and search entry routes redirect to Materials.
- Legacy RFQ and Outreach entry routes redirect to Suppliers.
- Legacy Intel, Intelligence, Brain, Pricing, and Reports routes redirect to
  Scenarios.
- Legacy Jobs, Loads, Carriers, and Domestic Pricing routes redirect to
  Logistics.
- Legacy Inbox and Activity routes redirect to Tracking.
- The separate Supply OS customer builder and workstream routes redirect into
  panel state on the single operating surface.
- Dashboard home, Activity, Brain, Carriers, CRM, Domestic Pricing, Inbox,
  Outreach, Pricing, Reports, and Search page implementations are now minimal
  redirect stubs rather than compiled legacy product interfaces.
- Redirects preserve the prior path and query context for later panel and
  drawer parity work. Non-navigation requests are not redirected, so retained
  server actions and background engines continue to function.
- Supplier discovery and market intelligence are embedded decision inputs.
- Shared office data uses PostgreSQL with `officeId` tenant boundaries.

## Intentionally preserved

The following code is not dead merely because it is no longer primary
navigation:

- Supplier search and intelligence APIs used by embedded Supply OS panels.
- RFQ, job, shipment, carrier, CRM, and intelligence engines still consumed by
  Supply OS, server actions, background processing, and APIs.
- Authentication, office administration, audit, and integration surfaces.
- Customer portal routes and explicit customer publication controls.
- Legacy map and supplier components still rendered inside Supply OS.

Deleting those now would remove capabilities without replacing their detailed
workflow. The correct sequence is embed, redirect, measure parity, then delete.

## Remaining extraction work

1. Replace browser-local compatibility state in embedded legacy components with
   shared workspace records.
2. Replace the preserved `legacyPath` context with native Supply OS record
   drawers for job, RFQ, company, carrier, and message detail.
3. Add route-level telemetry so obsolete entry points can be proven dead.
4. Replace the remaining Intel, Intelligence, Jobs, Loads, RFQ, builder, and
   workstream page implementations with redirect stubs after their useful
   components and tests are extracted or retired.
5. Delete UI-only dependencies that become unreferenced after the remaining
   wrappers are retired.
6. Keep destructive supplier, booking, order, and customs actions behind the
   approval ledger and future capability adapters.

## Persistence boundary

Shared office truth belongs in PostgreSQL: workspaces, published snapshots,
product structures, inventory, demand, evidence, decisions, approvals, tasks,
and execution receipts.

JSONB is appropriate for source payloads and typed capability inputs or outputs.
Relational foreign keys remain authoritative for tenancy, workflow state, and
approval integrity. Graph traversal is currently represented with relational
adjacency because the product graph is bounded and transactional. A separate
graph database would add operational cost without solving a demonstrated query
problem. Vector search should be added only for semantic retrieval over source
evidence, never as the system of record.
