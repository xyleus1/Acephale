# AI Handoff

## Latest Update

### Reconciled the reverted retirement and locked the product direction

- Reverted PR #81's single revert commit on top of current `main`, restoring
  the exact PR #77 tree without overwriting concurrent uncommitted work in the
  primary checkout.
- Restored all requested follow-up commits that followed PR #77: sourced
  Supplier Finder company and product images, reduced navigation and copy, and
  secondary-action menus.
- Added an explicit founder product-direction rule to `AGENTS.md` and a durable
  decision that supersedes the older entries used to justify restoring the
  retired prototype.
- Added a pull-request and `main` GitHub check that requires the retirement
  boundary and product-copy enforcement files, then runs both checks against
  the proposed tree.
- No new product behavior, database model, dependency, tenant scope, sending,
  or approval path was introduced beyond the already approved PR #77 change.
- Fresh verification passed: product copy, retirement boundary, Supplier
  Finder images, employee routing, docs freshness, freight workflow tests,
  customer portal tests, Prisma validation, TypeScript, the full 24-migration
  chain on a disposable PostgreSQL database, zero retired database objects,
  production build, diff hygiene, and changed-line U+2014 scan.

### Removed generic capability copy from active pages

- Deleted redundant taglines, eyebrow labels, section explanations, and empty
  state narration across the dashboard, pricing, context, intelligence,
  supplier finder, contacts, outreach, customer access, and shipment portal.
- Replaced internal metaphors with direct labels. Examples include Price check,
  Documents, Recorded context, Timeline, Scenario Lab, and RFQ and carrier
  rates.
- Kept copy that states a real status, scope, limit, action, approval boundary,
  or source. No workflow, pricing, tenant scope, customer access, supplier
  search, database schema, or dependency changed.
- Added a UI copy regression rule for the removed capability taglines and the
  Company Brain and Pricing brain labels.
- Verification passed: `npm run check:product-copy`, `npm run
  test:customer-portal`, `npm run test:steel-supplier-search`, `npx tsc
  --noEmit --incremental false`, `git diff --check`, changed-file U+2014 scan,
  and `npm run build` with disposable local database URLs.

### Reduced navigation, copy, and secondary-action noise

- Removed the retired Supply OS page before this pass, so the fixture-heavy
  product twin and its parallel navigation are no longer active on this branch.
- Reduced the authenticated sidebar to daily work areas. Channels, company
  context, customer access, and admin now sit under one visible Manage control.
- Added a reusable overflow menu for secondary page actions. Inbox maintenance,
  RFQ batch tools, load shortcuts, and destructive pricing actions no longer
  compete with the main task.
- Pricing now opens on the RFQ workspace. Queue analysis, the full decision
  audit, and the forwarder directory remain available through disclosures.
  Duplicate playbook, route, evidence, and factor blocks were removed from RFQ
  list rows.
- Deleted the four-step load playbook that narrated the workflow already shown
  by the load record. Shortened page titles and subtitles across RFQs, loads,
  jobs, reports, operations, channels, and intelligence.
- No schema, dependency, tenant scope, sending, approval, or pricing rule
  changed.
- Verification passed: `npm run check:product-copy`, `npx tsc --noEmit
  --incremental false`, `git diff --check`, changed-file U+2014 scan, route
  compilation, and `npm run build` with disposable local database URLs. The
  authenticated screens could not be visually inspected because this checkout
  has no usable test login. No real sign-in email was sent and no auth bypass
  was added.

### Added source-backed visual research to Supplier Finder

- Supplier research now asks the existing public web search for up to 30 image
  results covering the requested good, candidate companies, logos, factories,
  mills, mines, facilities, and product photos.
- Every accepted image keeps its caption, direct URL, thumbnail, and public
  source page. Duplicate, loopback, private-network, and unattributed image
  records are removed.
- Images from a candidate's official or primary domain render inside that
  candidate card. Other images render in a separate product and market gallery
  so a commodity photo is not presented as company property.
- The UI links every image to its source page, hides failed images, sends no
  referrer, and states that visual context does not prove ownership, facility
  control, grade, origin, availability, or product fit.
- No database schema, dependency, persistence, supplier contact, or approval
  behavior changed.
- Verification passed: `npm run test:steel-supplier-search`, `npm run
  check:product-copy`, `npx tsc --noEmit`, `git diff --check`, changed-file
  U+2014 scan, and a production build with a disposable local `DATABASE_URL`.
  The first build attempt stopped before compilation because Prisma required
  that variable. No database was contacted or modified, and no live image
  search was run during tests.

### Retired the parallel procurement prototype and restored freight workflows

- Removed the isolated prototype UI, API routes, domain modules, browser state,
  styles, tests, and feature-only documentation.
- Restored the freight dashboard, RFQ, pricing, inbox, CRM, carrier, activity,
  reporting, search, and domestic-pricing pages that had been replaced with
  redirects.
- Restored `/dashboard` as the operator home and `/dashboard/loads` as the
  restricted employee home.
- Removed dependencies that no remaining source file imports.
- Removed model promotion, slogans, internal strategy jargon, and
  anthropomorphic system copy from active product surfaces.
- Added `docs/PRODUCT_COPY_POLICY.md` and a build-time copy check.

## Date

2026-08-08

## Branch

reconcile-requested-changes, targeting main

## Verification

- The complete 24-migration chain passed on a disposable PostgreSQL database.
  Post-migration checks found zero retired relations, functions, triggers, or
  constraints.
- Prisma validation, generated client, TypeScript, production build, docs
  freshness, copy policy, and focused freight workflow regressions passed.
- Authenticated runtime smoke checks returned 200 for ten restored admin routes.
  The employee loads page returned 200, while dashboard home and new-load entry
  redirected to the employee loads board as required.

## Database Retirement

The founder approved permanent removal of the retired prototype's persisted
data. The 26 active Prisma models are removed and a forward migration drops
their 26 tables and 18 trigger functions. The five historical migrations remain
unchanged so deployed databases retain a valid migration history.
