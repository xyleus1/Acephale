# AI Handoff

## Latest Update

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

### Inventory and sourcing now runs request, research, comparison, and handoff

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
- Added a draft logistics handoff confirmation. It prepares part, quantity,
  pickup, destination, delivery, and need-by context without changing the
  Logistics panel or creating a purchase order, contact, booking, or spend.
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

- Research results are not persisted as a canonical office-scoped run yet.
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
  rounded tile and enough padding to remain legible at browser-tab size. The
  changed icon output receives a new content hash, preventing browsers from
  reusing the previous cached icon URL.
- Expanded the single-surface contract to enforce the browser title, brand
  suffix, primary workspace title, and favicon treatment.
- No data, schema, tenant boundary, approval rule, dependency, freight logic,
  or external action changed.

Verification:

- `npm run test:supply-os-single-surface`
- `npm run check:product-copy`
- `npx tsc --noEmit --incremental false`
- Production build with a disposable PostgreSQL URL
- Production server output contained `<title>Derya</title>`
- Production server output contained `application-name` set to `Derya`
- Generated favicon returned HTTP 200 as a cache-busted 64px PNG
- Generated favicon image inspected at its original 64px size
- `git diff --check`
- Changed-diff U+2014 scan

Skipped verification:

- The in-app browser had no attached tab, so direct browser-chrome inspection
  was unavailable. Production HTML, response headers, PNG bytes, and the
  rendered favicon image were checked directly instead.

### Derya identity and final Supply OS visual holdovers corrected

- Replaced the invented Derya pictogram with the official circular Derya mark
  from `https://www.usederya.com/derya-logo.svg` in the shared logo component
  and generated app icon. The internal shell, sign-in page, customer portal,
  and browser icon now use the same identity source.
- Preserved the approved airy Supply OS treatment while retaining Derya site
  identity on tablet and mobile. Compact layouts show the mark beside the full
  navigation instead of hiding the brand.
- Removed the repeated `Companies` heading and the non-operational `Operating
  workspaces` eyebrow. The company directory now shows one page title and a
  factual company count.
- Raised refresh, create, cancel, and company-name controls to a verified 44px
  minimum. The mobile creation form no longer inherits the global 42px input
  rule.
- Authenticated browser review covered the company directory, open company
  form, Logistics workspace, sign-in page, and customer portal. Logistics was
  rechecked at 1440px, 768px, and 390px with zero legacy workspace classes,
  zero undersized interactive targets, and zero page overflow.
- No data, schema, tenant boundary, approval rule, dependency, freight logic,
  or external action changed.

Verification:

- `npm run test:supply-os-company-navigation`
- `npm run test:supply-os-sidebar-map`
- `npm run test:supply-os-single-surface`
- `npm run test:supply-os-enterprise-design`
- `npm run check:product-copy`
- `npx tsc --noEmit --incremental false`
- Production build with a disposable PostgreSQL URL
- `git diff --check`
- Changed-file U+2014 scan

### Logistics state changes now use restrained motion

- Added 150ms opacity and position transitions when the active Logistics domain,
  selected network object, or inspector mode changes.
- Motion uses `useReducedMotion`; users who request reduced motion receive the
  state change without the entry animation.
- Moved row press and tab-state transitions into the dedicated Logistics module.
  The retired workspace stylesheet does not carry live Logistics behavior.
- Added regression checks for both animated regions, reduced-motion handling,
  and bounded row press feedback.
- No data, schema, tenant boundary, approval rule, dependency, or external
  action changed.

Verification:

- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-operations-ui`
- `npm run test:supply-os-fixed-map-grid`
- `npm run check:product-copy`
- `npx tsc --noEmit --incremental false`
- Production build with a disposable PostgreSQL URL
- `git diff --check`
- Changed-diff U+2014 scan

### Atlas Robotics demo now uses its official logo

- Replaced the visible `AR` monogram in the built-in Atlas Robotics company
  row and persistent company ribbon with the official same-domain Atlas
  Robotics icon from `https://www.atlas-robotics.com/icon.svg`.
- Centralized the demo company name, logo URL, and official source URL in one
  small module so the index and ribbon cannot drift.
- Preserved initials as a load-error fallback. The demo logo is used only for
  the built-in demo. A real workspace without stored media keeps its own
  monogram and is never assigned the Atlas Robotics logo.
- Added a company-navigation contract covering the ribbon image, company-row
  image, and official same-domain asset URL.
- No schema, dependency, tenant boundary, freight logic, approval rule, or
  external action changed.

Verification:

- Official logo asset returned HTTP 200 with `image/svg+xml`
- `npm run test:supply-os-company-navigation`
- `npm run check:product-copy`
- `npx tsc --noEmit --incremental false`
- `git diff --check`
- Changed-diff U+2014 scan

Skipped verification:

- The in-app browser had no attached tab, so this checkout does not claim a
  rendered screenshot pass. The image source and render path were verified,
  but desktop and mobile visual inspection remains to be completed in an
  attached authenticated session.

### Logistics page rewritten without legacy visual inheritance

- Replaced the Logistics page's cascade-over-legacy approach with a dedicated
  `supply-os-logistics.module.css` implementation. Every rendered Logistics
  class now resolves to the new module. The authenticated DOM audit found zero
  classes from `supply-os-workspace.module.css`.
- Rebuilt every visible layer: app rail, company header, status ribbon, object
  list, object rows, map canvas, map state, map legend, inspector tabs,
  inspector sections, provider links, priority rows, and primary action.
- Desktop now uses a 260px navigation rail, 88px header, bounded map panel,
  horizontal object rail, persistent inspector, 44px controls, and a 16px
  workspace radius. At 900px and below, navigation moves above the workspace.
  The map, object rail, and inspector become a scrollable single-column grid.
  Mobile keeps full section labels in a horizontal strip.
- Removed instructional fallback copy. The unsupported browser state now says
  only `Map renderer unavailable`; WebGL checking remains a factual status.
- Updated the sidebar contract test to enforce the new responsive shell instead
  of the obsolete 190px medium-width rail.
- No domain behavior, data model, tenant scope, approval rule, dependency, or
  external action changed.

Verification:

- Authenticated browser review at 1440px, 768px, and 390px
- Zero legacy workspace classes in the rendered Logistics DOM
- Zero interactive targets below 44px at all three widths
- Zero horizontal overflow at all three widths
- `npm run check:product-copy`
- `npm run test:supply-os-single-surface`
- `npm run test:supply-os-shell-routing`
- `npm run test:supply-os-sidebar-map`
- `npm run test:supply-os-company-navigation`
- `npm run test:supply-os-continuous-layout`
- `npm run test:supply-os-operations-ui`
- `npm run test:supply-os-scenario-viewport`
- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-command-map`
- `npm run test:supply-os-fixed-map-grid`
- `npx tsc --noEmit --incremental false`
- Disposable PostgreSQL-backed `npm run build`
- `git diff --check`
- Changed-file U+2014 scan

Browser caveat:

- The headless browser does not expose WebGL 2, so visual QA exercised the
  designed map fallback. Map behavior and operational data logic were not
  changed.

### Approved airy system implemented across the production app

- Published commit `7b2ea43` to `origin/main`. Vercel completed the production
  deployment successfully.
- Live verification at `https://www.derya.ai/login` confirms the deployed page
  now uses the `#f7f8f7` canvas, Instrument Sans, a 16px sign-in workspace, the
  direct `Derya` title, and no legacy grid background or blue header.
- The initial report that the app still looked unchanged was correct. The prior
  work existed only as uncommitted local files and had never reached production.

- Added `src/app/design-system.css` as the production token and component layer.
  It loads after the legacy global stylesheet and defines the approved canvas,
  surfaces, typography, spacing, radii, controls, tables, dialogs, and responsive
  behavior.
- Rebuilt the Supply OS shell around the approved Logistics reference: a 228px
  labeled rail, 78px factual header, 16px operational workspace, softer map
  overlays, 10px controls, 14px panels, and restrained shadows.
- Applied the same system to the company index, product twin, shared workspace,
  decision intelligence, workstreams, snapshot surfaces, supplier finder,
  customer administration, internal sign-in, and customer sign-in.
- Removed the customer portal marketing hero and reduced both sign-in surfaces
  to direct labels and required access guidance.
- Expanded product-copy and design regression checks so the approved tokens,
  geometry, navigation structure, and prohibited filler phrases are enforced.
- No database schema, dependency, freight logic, tenant boundary, approval rule,
  or external action changed.

Verification:

- `npm run check:product-copy`
- `npm run test:supply-os-single-surface`
- `npm run test:supply-os-shell-routing`
- `npm run test:supply-os-sidebar-map`
- `npm run test:supply-os-company-navigation`
- `npm run test:supply-os-continuous-layout`
- `npm run test:supply-os-operations-ui`
- `npm run test:supply-os-scenario-viewport`
- `npm run test:supply-os-enterprise-design`
- `npm run test:customer-portal`
- `npx tsc --noEmit --incremental false`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/derya npm run build`
- Desktop and mobile browser inspection of `/login` and `/portal`
- Browser console inspection, with no application-owned runtime error found
- `git diff --check`
- Changed-line U+2014 scan

Skipped verification:

- Authenticated Supply OS screenshot inspection was unavailable because this
  checkout has no usable local database. Both documented demo logins failed,
  and the read-only pentest verification command reported database access was
  denied. The route is covered by the production build and expanded UI tests,
  but this handoff does not claim an authenticated browser pass.
- The in-app browser was not attached, and the documented production pentest
  password was not accepted. Authenticated production screenshots remain
  unverified rather than inferred from the public route.

### App-wide airy design direction and zero-fluff copy rule

- Replaced the partial Supply OS styling note with an app-wide `DESIGN.md`
  contract targeting 80 percent airy and 20 percent compact operational UI.
- Added exact color, typography, spacing, geometry, component, map, motion,
  responsive, and copy rules. Marketing-style page intros, repeated subtitles,
  obvious interaction instructions, and square enterprise geometry are now
  explicit regressions.
- Added `DESIGN.md` to the required reading in `AGENTS.md` so future UI and copy
  changes start from the same system.
- Recorded the direction as an accepted durable decision.
- Revised the isolated Logistics review artifact outside the repository. It
  starts directly with the network, uses factual labels only, and applies the
  softer geometry and larger whitespace scale.
- No production component, behavior, schema, dependency, approval rule, or
  external action changed.

Verification:

- Inline preview JavaScript parse check
- Quick Look render at 1600px and visual inspection
- Prohibited preview-copy scan
- Changed-line U+2014 scan
- `git diff --check`

### Account menu reduced to sign-out only

- Reduced the authenticated dashboard account dropdown to one action: Sign out.
- Removed the user name and email header, Email and WhatsApp link, customer
  portal link, admin link, and language control from that dropdown.
- Removed the unused language-toggle component and its dead menu styles.
- Kept authentication, admin, settings, and customer portal routes unchanged.
- Updated the single-surface regression contract to prevent the removed account
  menu options from returning.

Verification:

- `npm run test:supply-os-single-surface`
- `npm run check:product-copy`
- `npx tsc --noEmit --incremental false`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/derya npm run build`
- `git diff --check`

## Prior Update

### Navbar and workspace navigation no longer repeat the product name

- The authenticated navbar now shows only the Derya brand.
- The primary workspace rail no longer shows a second product heading.
- Supply, Logistics, Suppliers, Opportunities, and Tracking now use text-only
  navigation. The mismatched section icons and the duplicate active-panel icon
  were removed.
- Medium-width layouts keep section labels instead of collapsing into an
  icon-only rail. Narrow layouts keep the existing horizontal section strip.
- No route, panel state, data behavior, schema, dependency, approval rule, or
  external action changed.

Verification:

- `npm run test:supply-os-single-surface`
- `npm run test:supply-os-sidebar-map`
- `npm run test:supply-os-shell-routing`
- `npm run test:supply-os-operations-ui`
- `npm run check:product-copy`
- `npx tsc --noEmit`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/derya npm run build`
- `git diff --check`

Skipped verification:

- The in-app browser had no attached tab, so authenticated visual inspection
  was unavailable. Responsive behavior is covered by source contracts,
  TypeScript, and the production build, but no screenshot claim is made.

### Supply OS copy and control cleanup

- Kept Supply OS as the primary operator surface and removed its repeated
  narration. The five sidebar destinations are now Materials, Network,
  Suppliers, Scenarios, and Tracking with no descriptive sublabels.
- Removed the duplicate map shortcut, command-header map button, scenario
  instruction banner, and permanent five-item demo status ribbon. Data import
  and workspace controls remain behind the Data dialog.
- Moved the AMR photo credit onto the image, fixed the collapsed sidebar and
  mobile demand display, and removed dead responsive selectors left by the
  deleted copy.
- Removed the dashboard-wide product tagline and reduced application metadata
  to a direct freight-operations description.
- Shortened the product, inventory, scenario, evidence, approval, tracking,
  supplier-search, market-signal, snapshot, and shared-data language while
  preserving demo, read-only, provenance, and human-approval boundaries.
- Added `npm run check:product-copy` and updated Supply OS UI contracts so the
  removed phrases and controls cannot return unnoticed.
- No product behavior, database schema, dependency, approval rule, or external
  action changed.

Verification:

- `npm run check:product-copy`
- `npm run test:supply-os-sidebar-map`
- `npm run test:supply-os-operations-ui`
- `npm run test:supply-os-snapshot-twin`
- `npm run test:supply-os-scenario-viewport`
- `npm run test:steel-supplier-search`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/derya npm run build`

### Supply OS restored its operator sidebar and network map

- Added a persistent Supply OS sidebar for Materials, Network Map, Suppliers,
  Scenarios, and Tracking without bringing back the retired CRM product maze.
- Promoted the existing MapLibre supplier, factory, customs, and delivery map
  to the second primary destination, with a dedicated sidebar status card and
  command-header shortcut.
- A clean browser now opens a deterministic, explicitly labeled Atlas Robotics
  network fixture instead of a dead empty state. Saved customer cases still
  take precedence and the fixture is not persisted as canonical office data.
- Added Motion for React for active navigation, panel transitions, overlay
  entry and exit, and bounded hover and tap feedback. Motion honors the user's
  reduced-motion setting.
- The rail collapses to icons at medium widths and becomes a compact horizontal
  navigation strip on narrow screens.

### Deterministic Supply OS planning and scenario engine

- Added a pure multi-level BOM engine with cycle rejection, exact unit checks,
  scrap multiplication, optional-line exclusion, subassembly expansion, shared
  component constraints, facility inventory, dated demand allocation, and
  explicit unknown handling.
- Added the four allowed scenario families: current purchasing plan, alternate
  supplier, assembled subassembly purchase, and approved equivalence change.
  Unapproved substitutions are blocked.
- Scenario output now includes material, freight, evidenced duty, landed-cost
  completeness, lead range, dated buildability, shortages, concentration, cash
  exposure, evidence completeness, FCC review state, blockers, and unknowns.
- Recommendation order is deterministic and rule-based. It rejects blocked
  cases, maximizes required-date units, uses landed cost only when complete,
  then compares lead time and supplier concentration.
- Added snapshot-owned supplier terms and FCC profiles, workspace-approved
  equivalence rules, expected inventory receipt dates, and append-only planning
  results with snapshot, normalized-input, engine-version, and output hashes.
- The server rejects client-authored rank, cost, feasibility, and unsupported
  fields. Older results are returned with `isStale` after a newer snapshot is
  published, without mutation.

### Legacy operator routes now enter Supply OS panels

- Legacy CRM, RFQ, Outreach, Intel, Intelligence, Brain, Pricing, Reports,
  Jobs, Loads, Carriers, Inbox, Activity, and Domestic Pricing navigation now
  redirects into the appropriate Supply OS panel.
- The separate Supply OS customer builder and workstream URLs now return to the
  single workspace instead of rendering another product surface.
- Redirects apply only to navigation requests. Retained actions, APIs,
  background engines, admin, settings, authentication, and customer portal
  behavior remain available.
- Original query state and path context are preserved for future native record
  drawers instead of silently discarding deep-link intent.
- Dashboard home, Activity, Brain, Carriers, CRM, Domestic Pricing, Inbox,
  Outreach, Pricing, Reports, and Search no longer compile their old page UIs.
  They are small redirect stubs backed by the same route contract.

## Date

2026-08-08

## Branch

supply-os-sidebar-map, targeting main

## Verification passed

- `npm run test:supply-os-sidebar-map`
- `npm run test:supply-os-command-map`
- `npm run test:supply-os-planning-engine`
- `npm run test:supply-os-planning-persistence` against disposable PostgreSQL
- `npm run test:supply-os-legacy-routes`
- `npm run test:supply-os-single-surface`
- `npm run test:supply-os-shell-routing`
- Fresh-database `npx prisma migrate deploy`
- `npx prisma validate`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`

## Caveats

- Supplier terms and FCC profiles are canonical snapshot inputs, but the CSV
  adapter does not yet import those record types.
- One inventory position has one optional expected receipt timestamp for its
  in-transit and on-order quantities. Split positions when those quantities
  have different dates.
- Planning results are recommendations only. They do not place orders, book
  freight, file customs entries, send messages, or authorize spend.
- Intel, Intelligence, Jobs, Loads, RFQ, and the old Supply OS builder and
  workstream implementations still compile until their useful components and
  legacy source-based tests are extracted or retired.
- Redirected record details currently preserve `legacyPath`; native Supply OS
  drawers for those records remain a follow-up.
- The existing network map still uses browser-local case compatibility data;
  this UI change does not pretend that those records are shared office truth.
- The retired `/dashboard/supply-os/new` builder link was removed from the map
  surface because the route now redirects into the single workspace.

## Prior Update

### Restricted operators and approvals now respect snapshot boundaries

- An `EMPLOYEE` no longer gains office-wide Supply OS access when the legacy
  `canViewWholeOffice` flag is true. Employees require an active workspace
  membership and remain unable to edit or import workspace data.
- Publishing a newer snapshot expires pending approvals tied to older
  decisions or execution tasks.
- Decision creation, proposal, approval requests, approval decisions, task
  creation, task approval requests, and task release now reject stale snapshot
  inputs. Approved work cannot be released after the workspace data changes.
- A forward migration now rejects cross-office workspace company and user
  references, plus BOM, inventory, demand, and media references whose linked
  records do not belong to the exact same snapshot.

## Date

2026-08-08

## Branch

supply-os-grand-vision, targeting main

## Verification passed

- `npm run test:supply-os-persistence` against a disposable PostgreSQL database
- `npm run test:supply-os-execution` against a disposable PostgreSQL database
- Fresh-database `npx prisma migrate deploy`
- `npx prisma validate`
- `npx tsc --noEmit`
- `git diff --check`
- Changed-content U+2014 scan

## Caveats

- Existing released tasks remain ledger records after a newer snapshot is
  published. Any future external executor must repeat the current-snapshot
  check immediately before its side effect.

## Prior Update

### Supply OS now owns the authenticated product chrome

- Removed the dashboard sidebar instead of wasting permanent space on one
  navigation link. Authenticated utility routes retain the compact account
  header, while Supply OS uses the full page width.
- Materials, Suppliers, Scenarios, Logistics, and Tracking now update the
  `panel` query parameter. Direct links, refresh, and browser back or forward
  preserve the selected operating panel.
- Workspace, facility, freshness, and import controls now sit in the Supply OS
  command header. Shared workspace and CSV controls open in an accessible
  modal instead of expanding the page vertically.
- The operating shell uses the available viewport with internal panel
  scrolling. Browser verification found no page overflow at 1440 by 900,
  1024 by 768, or 390 by 844.
- This slice does not redirect CRM, RFQ, Job, or other detailed operational
  routes. Those remain reachable until their workflows have real Supply OS
  replacements.

## Date

2026-08-08

## Branch

supply-os-grand-vision, targeting main

## Verification passed

- `npm run test:supply-os-single-surface`
- `npm run test:supply-os-shell-routing`
- `npm run test:supply-os-product-twin`
- `npm run test:supply-os-snapshot-twin`
- `npx tsc --noEmit`
- `npm run build` against a disposable PostgreSQL database
- Authenticated browser panel, history, modal, overflow, and console checks
- `git diff --check`

## Caveats

- Legacy detail pages are still live. Removing their navigation rail is not
  the same as completing workflow parity.
- The supplier and logistics panels still contain browser-local compatibility
  state that must move to shared workspace records.

## Prior Update

### Supply OS is the primary product surface with shared operating state

- `/dashboard/supply-os` is the default and only primary navigation surface.
  Supplier discovery, market evidence, sourcing scenarios, logistics planning,
  and tracking visibility now live inside its five-panel operating shell.
- Office workspaces, CSV import runs, immutable snapshots, locations, items,
  aliases, BOM lines, inventory, demand, and media persist in tenant-scoped
  PostgreSQL records. Browser storage is limited to explicitly labeled legacy
  compatibility data and draft UI convenience state.
- Published snapshots now drive the product twin. The adapter calculates
  buildability from BOM demand and shared inventory without inventing missing
  costs, lead times, images, or sourcing scenarios. Incomplete datasets fall
  back to a clearly labeled demonstration fixture.
- The typed `supply-os/v1` capability DSL defines ingestion, mapping, supplier,
  compliance, sourcing, logistics, tracking, and execution boundaries. Unknown
  capabilities, invalid dependency graphs, untrusted execution evidence, and
  missing approval are rejected deterministically.
- Decisions, evidence, scenarios, approvals, and execution tasks use an
  append-only PostgreSQL ledger. Proposal and action hashes bind approval to
  exact inputs. Release stops at `READY`; no external order, booking, customs
  filing, message, or spend action is performed.
- The standalone Supplier Finder and Market pages now redirect into the
  relevant Supply OS panels. Operational detail routes and APIs remain in place
  until their workflows have equivalent Supply OS destinations.

## Date

2026-08-08

## Branch

supply-os-grand-vision, targeting main

## Verification passed

- `npm run test:supply-os-single-surface`
- `npm run test:supply-os-product-twin`
- `npm run test:supply-os-snapshot-twin`
- `npm run test:supply-os-dsl`
- `npm run test:supply-os-execution` against a disposable PostgreSQL database
- `npx tsc --noEmit`
- `git diff --check`
- Changed-content U+2014 scan

## Caveats

- Supplier candidates and market signals are decision evidence, not approved
  suppliers, live quotes, committed capacity, or compliance clearance.
- The product twin can only be as complete as its published BOM, inventory,
  demand, and media inputs. Missing commercial fields remain visible as missing.
- `READY` means approved for a future adapter to execute. It does not mean an
  external action occurred.

## Prior Update

### Generated Supply OS cases retain a connected operating network

- Generated companies no longer lose every route when public research finds
  products, supplier markets, and customer markets but cannot normalize the
  operating-site address.
- The optimization model now assigns a low-confidence provisional map
  placement when a facility, source region, or destination lacks drawable
  coordinates. The object detail explicitly says that placement must be
  confirmed, and researched coordinates still take precedence.
- Profile-labeled cross-border lanes retain their customs dossier even when
  one endpoint country is still unresolved.
- Existing saved dashboards benefit immediately because the operating model
  is rebuilt when the dashboard renders. Regeneration is not required.
- Regression coverage proves that a NOX-style name-only case produces a
  processing site, one route per modeled edge, visible transport segments, and
  a customs handoff.

## Date

2026-08-07

## Branch

steel-supplier-finder, targeting main

## Task implemented

### Add a steel-sector Supplier Finder tab

- Added a dedicated authenticated `Supplier Finder` navigation tab for raw
  materials, fuels, semi-finished products, and finished steel products.
- The search brief separates product, grade or standard, volume, buying
  market, target regions, commercial model, and required evidence.
- Public research returns up to eight attributable producer, trader, or agent
  candidates. Model-provided citations that were not returned by the web
  search provider are removed before display.
- Every candidate is measured against five public evidence gates: official
  identity, producer status, product capability, quality system, and export
  market evidence. Missing citations cannot remain `supported`.
- The interface does not label candidates reliable or approved. Ownership,
  sanctions, adverse media, financial references, capacity, samples,
  inspection, and contracting remain explicit human verification work.
- Sensitive current origins and supplier relationships have a separate private
  note. That note is saved only in office-and-user-scoped browser storage and
  is excluded from the public search request contract.
- No database schema, dependency, supplier message, commercial award, freight
  booking, customs filing, or spend action was added.

## Verification passed

- `npm run test:steel-supplier-search`
- `npx tsc --noEmit --incremental false`
- `npm run build` with a disposable local database URL
- `git diff --check`
- Changed-file U+2014 check

## Caveats

- Live public research requires `OPENAI_API_KEY` in the deployed environment.
- Public-source evidence is only candidate discovery. Legal entity, ownership,
  sanctions, financial standing, references, authority, allocation, quality,
  samples, and site capability still require independent verification.
- The private note is browser-local convenience storage, not encrypted shared
  office storage or a formal secret-management system.

## Prior Update

## Date

2026-08-07

## Branch

feat/supply-os-full-network-demo, targeting main

## Task implemented

### Render the full multimodal chain and provide a complete AON3D demo

- Every commercial lane now contains separate pickup, main-carriage, customs,
  and final-delivery legs instead of one supplier-to-destination curve.
- Road, ocean, air, and customs legs have distinct maintained Lucide symbols,
  directional route lines, wide click targets, and labeled gateway markers.
- Ocean and air planning adds explicit origin gateway, receiving gateway,
  customs-release, and final-mile points. Cross-border truck planning splits
  at the customs handoff.
- Clicking any visible segment or gateway opens the parent transport dossier.
  The dossier flow chart now follows every handoff rather than showing only
  origin, a compound mode string, and destination.
- The new-customer page includes a one-click `Open full AON3D demo` action. It
  creates a Montreal production case with Shenzhen and Ontario sourcing plus
  Detroit and Germany deliveries, exercising procurement, truck, ship, plane,
  customs, and final-mile planning in one saved dashboard.
- Added deterministic Montreal and Ontario geographic resolution so the demo
  works without a research API response.
- Ocean comparisons now include Maersk, MSC, CMA CGM, Kuehne+Nagel, DHL, and
  relevant endpoint or customs candidates. Air comparisons add Kuehne+Nagel
  and DSV alongside DHL. Every entry links to an official service source and
  remains unawarded until a live quote is returned.

## Verification passed

- All ten Supply OS regression suites
- `npx tsc --noEmit --incremental false`
- `npm run build` with the local test database configuration
- Regression coverage confirms the AON3D demo has two supplier clusters, two
  customer clusters, four commercial lanes, at least ten operating legs, and
  road, ocean, air, and customs modes

## Caveats

- Gateway choices, paths, and handoffs are inferred planning records, not
  observed shipments, booked terminals, live schedules, broker acceptance, or
  turn-by-turn road routing.
- The in-app browser-control runtime was unavailable in this session, so visual
  interaction was not rechecked through that surface. Static interaction tests,
  TypeScript, and the production build passed.

## Prior Update

## Date

2026-08-07

## Branch

feat/supply-os-marine-routes, targeting main

## Task implemented

### Make Supply OS lanes read and behave like transport corridors

- Supplier, factory, and customer points are now connected by continuous curved
  route corridors instead of straight overlay strokes.
- Every corridor has repeated direction markers, a white casing that keeps it
  legible over the basemap, selected and hover emphasis, and direct pointer
  targets along the full curve.
- Clicking any visible part of a corridor opens the matching transport leg.
  The route list remains the keyboard-accessible equivalent.
- Movement labels now sit on the curved route rather than the old straight-line
  midpoint.
- Road lanes can expose up to nine official carrier candidates. The shortlist
  now mixes local or endpoint specialists with national capacity alternatives.
- Added Tulsa, Phoenix, Los Angeles and Long Beach, Quebec, and Ontario options,
  plus broader Schneider, J.B. Hunt, and ArcBest alternatives. Each candidate
  retains an official service or company source and remains a candidate until
  a live quote and operating scope are confirmed.

## Verification passed

- All ten Supply OS regression suites
- `npx tsc --noEmit --incremental false`
- `npm run build` with the local test database configuration
- GPU-backed browser QA at 1440 by 900 and 2048 by 900
- Direct clicks on curved route geometry opened the matching transport leg
- Both browser sizes stayed within the viewport with no console errors
- The Tulsa to Phoenix lane displayed nine alternatives, including Melton,
  Stewart, Knight, Swift, Schneider, J.B. Hunt, and ArcBest

## Caveats

- Corridors are planning geometry, not turn-by-turn road routing or observed
  vessel tracks.
- Carrier entries are researched candidates, not live capacity, contracted
  providers, or awarded loads. Rates remain modeled until comparable quotes
  are returned.
- Provider coverage is currently deterministic for known demo regions. A
  production provider-search service still needs to resolve local candidates
  for arbitrary endpoints.

## Prior Update

## Date

2026-08-06

## Branch

supply-os-operating-ownership, targeting main

## Task implemented

### Turn a company name or website into an evidence-backed customer dashboard

- The new-customer page now accepts a company name, official URL, or operating
  description and runs one authenticated public-research request before it
  builds the Supply OS case.
- Research finds and verifies the official website, extracts a same-domain
  logo, and structures the useful public company picture: description,
  industry, headquarters, operating locations, products, customer markets,
  and a short set of supply-chain findings.
- Every official or public claim retains its attributable source URLs. The
  normalizer discards model citations that were not returned by the web-search
  provider and does not let unsupported public claims survive as facts.
- Likely inputs, source regions, and destination markets stay labeled as
  hypotheses. They cannot silently become confirmed suppliers, lanes, customs
  treatment, providers, rates, or bookings.
- Official-site metadata fetching is limited to verified public HTTP(S)
  domains, rejects private-address resolution and unsafe redirects, uses a
  timeout and response-size cap, and loads only same-domain logo candidates.
- The generated dashboard opens in a dedicated presentation mode that hides
  the internal application chrome. It shows the company logo and profile,
  official-source count, operating map, three research findings, inputs to
  confirm, the work Derya can take over, and the three items needed to start.
- Company research failure is explicit. The operator can build from their own
  description, but the resulting dashboard states that public research is not
  attached instead of pretending it is verified.
- Compact labeled input now stops location fields before a following company
  sentence, so one-line prompts do not turn a city into a paragraph.

## Files changed

- `src/lib/supply-os-company-research.ts`
- `src/lib/supply-os-case-model.ts`
- `src/app/api/supply-os/company-research/route.ts`
- `src/app/dashboard/supply-os/page.tsx`
- `src/app/dashboard/supply-os/supply-os-research-client.ts`
- Supply OS generator, dashboard, scoped stylesheet, and presentation globals
- Company-research, prototype, enterprise-design, and case-model regression
  tests
- `package.json`, `docs/DECISIONS.md`, `docs/ENGINEERING_LOG.md`, and this handoff

## Verification passed

- `npm run test:supply-os-company-research`
- `npm run test:supply-os-case-model`
- `npm run test:supply-os-prototype`
- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-engagement-plan`
- `npm run test:supply-os-operating-plan`
- `npm run test:supply-os-command-model`
- `npx tsc --noEmit --incremental false`
- `npm run build` with the local test database configuration
- Authenticated browser flow for research failure, explicit description-only
  fallback, save, presentation-mode navigation, and responsive rendering
- Evidence-backed AON3D presentation fixture with official logo, public source
  links, three findings, inferred inputs, full-width desktop rendering, and
  390-pixel rendering with no horizontal overflow

## Caveats

- Live research requires `OPENAI_API_KEY` in the deployed environment. Local
  browser QA verified the honest unavailable state because the local server did
  not have a key.
- Research is a bounded public discovery brief, not a blind full-site crawl.
  It intentionally omits marketing repetition, private data, login or paywall
  content, and personal contact details.
- Cases remain office-and-user-scoped browser records. They are not shared,
  backed up, customer-published, or server-persisted.
- Public context can propose discovery questions, but a BOM, purchase orders,
  supplier records, shipment documents, live quotes, and approvals are still
  required before operational commitments.

## Prior Update

## Date

2026-08-06

## Branch

supply-os-company-research, targeting main

## Task implemented

### Reframe Supply OS around full or modular operational ownership

The customer case now answers what Derya can take over before exposing any
freight mechanics.

- Case generation includes a saved coverage choice: full operation, supplier
  sourcing, inbound logistics, customs preparation, or finished-goods
  delivery.
- The Atlas Robotics network now shows Shenzhen components entering Austin
  production, then finished robots and spares leaving Austin for Detroit and
  Nashville. It no longer presents components as if they move directly from a
  supplier region to the finished-goods customer.
- New cases keep the company location and production or receiving site as
  separate facts. A company based in San Francisco but manufacturing in Austin
  now routes components through Austin. Headquarters-only inputs remain visible
  assumptions and create a production-site confirmation question.
- Five customer-facing workstreams cover supplier search, supplier
  coordination, component movement, customs, and finished-goods delivery.
  Each exposes a concrete output and a short operational drill-down.
- The dashboard asks for three kickoff inputs: BOM or component list, existing
  supplier material if any, and the next production or delivery deadline for
  full-operation cases. Modular cases replace those with three scope-specific
  inputs for sourcing, inbound movement, customs, or finished-goods delivery.
- Saved coverage changes persist in the same office-and-user-scoped browser
  case and survive reload. Existing version 1 cases without a coverage field
  or production-site field remain valid and default to the full operation.
- Coverage writes merge against current scoped browser storage, failed writes
  leave the visible plan unchanged, and same-case cross-tab updates use the
  persisted scope.
- Customer-facing modeled prices, transit claims, provider assignments,
  gateway recommendations, and broker selections were removed. The page now
  states a domestic, unknown, or import-specific customs boundary and keeps
  deeper handoffs in one collapsed execution section.
- The collapsed execution section includes only the selected modular scope, or
  the complete handoff for full-operation cases. Domestic and unknown cases do
  not inherit import broker or clearance steps.
- Customs and tariff logic follows both supplier-to-production and
  production-to-customer legs. Domestic and unknown cases no longer receive
  import-specific broker copy or kickoff inputs. Incomplete networks remain
  unknown unless the known endpoints make an international movement
  unavoidable.
- The detailed movement engine remains unchanged and available for future
  operator tooling.

## Files changed

- `src/lib/supply-os-engagement-plan.ts`
- `src/lib/supply-os-case-model.ts`
- `src/app/dashboard/supply-os/supply-os-generator.tsx`
- `src/app/dashboard/supply-os/supply-os-dashboard.tsx`
- `src/app/dashboard/supply-os/supply-os-workspace.module.css`
- `scripts/supply-os-engagement-plan.test.ts`
- Supply OS model, prototype, and design regression tests
- `package.json`, `docs/DECISIONS.md`, `docs/ENGINEERING_LOG.md`, and this handoff

## Verification passed

- `npm run test:supply-os-engagement-plan`
- `npm run test:supply-os-case-model`
- `npm run test:supply-os-prototype`
- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-operating-plan`
- `npm run test:supply-os-command-model`
- `npx tsc --noEmit --incremental false`
- `npm run build` with the local test database configuration
- Authenticated browser generation, modular scope save, reopen, full-scope
  change, reload persistence, workstream selection, flow selection, and
  collapsed execution-detail checks
- Desktop and 390-pixel mobile visual review with no page overflow

## Caveats

- Cases and coverage remain browser-local and are not shared, backed up,
  customer-published, or server-enforced records.
- The new network is a truthful operating-intent map, not a live route. It
  does not discover suppliers, tender providers, return quotes, select a
  broker, file an entry, or book freight.
- Multi-source cases keep component-to-source allocation explicitly
  unconfirmed until supplier or purchase-order data establishes it.
- City resolution prefers specific place names and no longer treats a state
  name such as California as proof that the site is in Los Angeles.
- Product-use language such as robots used in warehouses does not become a
  confirmed production site.
- Current provider, pricing, gateway, and customs detail remains modeled in the
  internal engine and must not return to the default customer view without
  attributable current evidence.

## Prior Update

## Date

2026-08-06

## Branch

crm-status-structure, targeting main

## Task implemented

### Split Supply OS into generation and saved dashboard pages

Supply OS now has one page for creating a customer case and a separate page
for browsing saved customer dashboards.

- `/dashboard/supply-os` contains the saved-customer browser and the selected
  customer's operational dashboard.
- `/dashboard/supply-os/new` contains only the company prompt, extracted input
  review, missing information, and `Save and open dashboard` action.
- Saving merges against the latest office-and-user-scoped browser state, writes
  the selected case, then returns to the dashboard page. Storage failure keeps
  the operator on the generator and reports the error.
- The default dashboard now shows the customer, lane selector, real Natural
  Earth map, recommended gateway, expected cost range, transit assumption,
  three next actions, a compact door-to-door plan, customs, and risks to verify.
- The page no longer renders the anchor strip, duplicated prompt facts,
  scenario cards, raw source requirements, connector catalog, field-by-field
  invoice guidance, provider request and verification text, generic supplier
  profiles, or duplicate readiness sections.
- The detailed movement engine remains unchanged. Existing version 1 browser
  cases continue to work, and no database schema, provider call, booking,
  filing, outbound message, or approval path changed.

## Files changed

- `src/app/dashboard/supply-os/page.tsx`
- `src/app/dashboard/supply-os/new/page.tsx`
- `src/app/dashboard/supply-os/supply-os-dashboard.tsx`
- `src/app/dashboard/supply-os/supply-os-generator.tsx`
- `src/app/dashboard/supply-os/supply-os-storage.ts`
- `src/app/dashboard/supply-os/supply-os-workspace.module.css`
- `scripts/supply-os-prototype.test.ts`
- `scripts/supply-os-enterprise-design.test.ts`
- `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`, `docs/DECISIONS.md`

## Verification passed

- `npm run test:supply-os-prototype`
- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-case-model`
- `npm run test:supply-os-operating-plan`
- `npm run test:supply-os-command-model`
- `npx tsc --noEmit --incremental false`
- `npm run build`
- Authenticated browser flow from empty state to generator, generated review,
  save, selected dashboard, movement switch, reload, and responsive layouts
- Browser widths at 1440, 1024, and 390 pixels with no page overflow or console
  errors

## Caveats

- Customer dashboards remain local to one browser. They are namespaced by
  office and user but are not shared, server-persisted, or customer-published.
- Costs, transit, providers, and routes remain deterministic planning outputs,
  not live quotes, capacity, customs decisions, or bookings.
- The removed details still exist in the planning engine for a future operator
  drill-down. They are intentionally absent from the default customer view.

## Prior Update

## Date

2026-08-06

## Branch

crm-status-structure, targeting main

## Task implemented

### Movement-scoped customs and door-to-door operating plan

Each generated customer case now expands into a separate operating plan for
every source-to-destination movement. The existing prompt, map, saved case,
supplier, and risk flow remains intact while the result adds port selection,
customs preparation, current-condition checks, detailed providers, handoffs,
and expected cost ranges through final delivery.

- A movement selector scopes the map, port ranking, customs plan, intelligence
  checks, provider sequence, quote blockers, and cost range. A case with two
  source regions and two destinations creates four isolated movements rather
  than mixing their evidence or quotes.
- Import movements rank practical receiving gateways with fit, tradeoffs,
  inland implications, and verification requirements. Domestic and intra-EU
  movements correctly omit import clearance, broker, and customs connector
  workflows.
- Port ranking uses ordered candidates and stated tradeoffs without fabricated
  precision scores. Mexico-US road movements use a land-border plan and do not
  inherit ocean terminals, vessels, port drayage, or carrier schedule feeds.
  The same Laredo handoff logic applies in both directions, so a US-to-Mexico
  road case cannot inherit a US source's default ocean export gateway.
- Current-condition checks are attached to the relevant commodity, source,
  terminal, gateway, customs point, or delivery market. The UI states the
  current finding is unknown until a listed callback or source is checked and
  shows the decision rule, freshness target, and evidence requirement.
- Mixed known and unsupported source or destination lists retain every stated
  location. Unsupported names stay visible as confirmation blockers instead of
  being dropped or borrowed from a partial match. In particular, North Korea
  cannot normalize to South Korea or produce a Busan route and numeric total.
- The customs plan covers pre-classification, commercial invoice preparation,
  broker handoff, entry review, release, and audit retention. Invoice guidance
  identifies the missing fields that block a defensible entry packet.
- Broker candidates and customs technology connectors are presented as
  evaluation paths, not endorsements or connected services. Zonos, Digicust,
  Descartes CustomsInfo, Customs4trade, and Avalara are represented with exact
  intended roles and connection requirements.
- The execution plan covers origin pickup, origin handling, international
  linehaul, customs clearance, destination handling, drayage, inland transport,
  and last mile. Each leg names candidate providers or services, the request to
  send, the facts to verify, handoffs, and a modeled cost range.
- Road, cross-border, inland, and final-mile quote requests are generated from
  the exact endpoints of their own execution leg. Provider records use unique
  leg-scoped identifiers so a request cannot silently retain another leg's
  origin or destination.
- Domestic, intra-EU, land-border, US ocean-import, and non-US ocean-import
  movements use separate service, authority, broker, drayage, and inland
  templates. Drayage, hub-to-hub transport, and final delivery have explicit
  non-overlapping handoffs.
- Port-local ocean deliveries omit the duplicate hub-to-hub inland leg and
  hand the recovered cargo directly into final delivery. Explicit air-freight
  prompts use air-cargo gateways, air providers, flight and warehouse checks,
  air handling, customs release, and airport recovery without ocean carriers,
  vessel data, container equipment, port ranking, or drayage.
- China to US examples include DHL Ocean Freight FCL coordination and a Maersk
  TP6 schedule candidate. Both remain published candidates until a current
  provider response confirms route, capacity, equipment, dates, and price.
  The DHL request is scoped to the priced port-to-port leg and explicitly
  excludes the separately modeled pickup, handling, drayage, inland, and final
  delivery legs.
- Totals are deterministic demo estimates in USD, exclude duties and taxes,
  and disappear when geography is unresolved. No rate, schedule, terminal
  condition, customs decision, capacity, booking, or provider response is
  presented as live.
- Battery, chemical, and other recognized dangerous-goods prompts withhold the
  numeric total until SDS, transport classification, and carrier acceptance
  are confirmed. Multi-source, multi-commodity cases require an explicit
  source-to-item assignment instead of copying every commodity to every lane.
- Existing version 1 browser-saved cases remain compatible because operating
  plans are derived at render time. No database schema, dependency, server
  action, external request, or customer-visible write path was added.
- A prompt with no complete movement returns a verification state rather than
  claiming that an empty plan is modeled.
- The door-to-door execution table becomes a labeled ledger below 560 pixels,
  so providers, quote instructions, transit, cost, and status stay visible
  without horizontal scrolling. Map controls and primary actions use a
  44-pixel minimum interaction target.
- A neutral page frame lets the scoped dark workspace fill the dashboard
  viewport at desktop, tablet, and mobile widths without changing shared shell
  CSS.

## Files changed

- `src/lib/supply-os-operating-plan.ts`
- `src/lib/supply-os-case-model.ts`
- `src/app/dashboard/supply-os/page.tsx`
- `src/app/dashboard/supply-os/supply-os-workspace.tsx`
- `src/app/dashboard/supply-os/supply-os-workspace.module.css`
- `scripts/supply-os-operating-plan.test.ts`
- `scripts/supply-os-prototype.test.ts`
- `scripts/supply-os-enterprise-design.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`, `docs/DECISIONS.md`

## Verification passed

- `npm run test:supply-os-case-model`
- `npm run test:supply-os-operating-plan`
- `npm run test:supply-os-prototype`
- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-command-model`
- `npx tsc --noEmit --incremental false`
- `DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/derya_build' AUTH_SECRET='local-build-secret-only' npm run build`
- Browser generation, movement switching, source-link inspection, and cost
  scoping at desktop, tablet, and mobile widths
- Browser keyboard-focus, overflow, and clean-console checks
- At 390 pixels, the execution table width and scroll width both resolve to
  360 pixels, all seven row labels remain visible, and page overflow is zero

## Caveats

- Saved dashboards are local to one browser and namespaced by office and user.
  They are not shared, backed up, protected by server-enforced tenant records,
  linked to CRM companies, or customer-visible.
- This is deterministic planning, not live supplier discovery, rate retrieval,
  legal or customs advice, provider execution, or a booking path.
- CBP entry preparation and filing must remain under a licensed customs broker
  or authorized importer workflow. A technology connector does not replace the
  direct importer-to-broker authorization or human review boundary.
- A production version needs office-scoped `SupplyCase` records with immutable
  snapshots, server-created provenance, explicit CRM linking, and an allowlisted
  customer projection. Live adapters need normalized evidence records,
  provider timestamps, expiry rules, and human approval for outbound or
  operational actions.

## Previous Update

## Date

2026-08-06

## Branch

crm-status-structure, targeting main

## Task implemented

### Supply OS customer-case builder and saved dashboard flow

Supply OS now starts with the customer instead of a prebuilt fictional command
center. An operator can describe what a company does, where it operates, what
it needs to source, likely source regions, and delivery markets in one prompt.
The page generates one coherent case and scrolls to the result.

- The six disconnected command-center tabs, fake coverage metrics, model
  timestamp, briefing control, watches, exports, and repeated prototype copy
  were removed.
- The generated case contains normalized company facts, a Natural Earth route
  with supplier, gateway, conditional customs, and destination nodes, supplier
  search briefs, three indicative forwarder options, operating risks, customs
  checks, open questions, and one recommended first move.
- Missing facts fail closed as `needs_confirmation`. Inferred supplier
  profiles, gateways, forwarder choices, schedules, prices, and customs checks
  never present themselves as confirmed or live.
- Generated dashboards can be saved, reopened, and browsed from versioned
  browser storage namespaced by the signed-in office and user.
- Route generation uses source-aware gateways and separates domestic,
  intra-EU, cross-border road, and import lanes.
- The graphite visual system, limited semantic palette, real Natural Earth
  geography, and responsive layouts remain.

## Caveats

- Saved dashboards remain local browser records and are not shared or backed
  by server-enforced tenant records.
- This remains deterministic demo generation with no external provider calls.

## Previous Update

## Date

2026-08-06

## Branch

crm-status-structure, targeting main

## Task implemented

### Supply OS command center with Pallet-style visual restraint

The authenticated Supply OS is now a customer-facing logistics command center
that combines Kpler and Windward operating density with Pallet's visual
discipline without copying any of those products.

- The stylesheet now uses a deliberate graphite surface system, one muted
  interactive accent, and red, amber, or sage only for real operating states.
  The explicit palette fell from 373 improvised values to 56 controlled tokens.
- Decorative radial highlights, route glows, color-washed cards, and multicolor
  chart bands are gone. Selected objects use weight, contrast, and a quiet edge
  indicator instead of neon decoration.
- The duplicate map tool rail and redundant operating-picture plate are gone.
  Search, analysis mode, time range, layers, zoom, legend, and the selected-node
  plate remain available in one clear control hierarchy.
- Exception rows, evidence, signal summaries, tables, and secondary dossiers
  have flatter grouping, larger working text, and fewer boxed subsections.
- The evidence ledger is collapsed by default, keeping provenance one click
  away without letting it dominate the current decision.
- A stable Supply OS root scope now prevents old global button and input theme
  rules from overriding the customer workspace. Zero-specificity `:where()`
  exclusions preserve the cascade on every other page, while Supply OS keeps a
  neutral keyboard focus ring. The module adds no `!important` workaround.
- The command layout stacks at 1040 pixels, so common tablet widths no longer
  show a horizontally clipped three-column canvas.
- Regression coverage now caps palette drift and rejects decorative radial
  highlights, glowing map treatments, duplicated map controls, and lost global
  style isolation.

- Command combines a ranked exception queue, real Natural Earth map, selected
  movement dossier, confidence, evidence, next action, saved watches, and a
  compact network event stream.
- Network expands the same supply graph with tracked movements and a port,
  supplier, crossing, or destination dossier.
- Supplier intelligence combines dependency, performance, document quality,
  capacity, price, facility, gateway, audit, and resilience actions.
- Procurement normalizes movement-scoped modeled offers against lane history,
  reliability, free time, transit, emissions, cost, and delivery buffer. The
  Yantian and Shanghai decisions have distinct quote sets and lane evidence.
- Execution keeps chronology, custody, customs packet state, evidence, and the
  transport approval gate in one record.
- Authority makes observe, assist, coordinate, and execute boundaries explicit
  per action class. High-risk commitments remain human-gated.
- The dark command-center language is scoped to Supply OS. It does not change
  the internal Derya shell or introduce a green theme.
- Desktop, tablet, and mobile now have deliberate layouts. Narrow screens
  stack the exception queue, map, dossier, and event stream instead of
  cropping a desktop canvas.
- Every live-looking surface states that its records are fictional or modeled.
  No AIS, GPS, carrier, customs, port, booking, messaging, filing, persistence,
  or external write path was added.
- Movement selection now scopes the assessment, quote approval, execution
  partner, and customs origin. Missing quote evidence produces an honest empty
  state instead of borrowing another movement's data.

## Files changed

- `src/app/dashboard/supply-os/supply-os-workspace.tsx`
- `src/app/dashboard/supply-os/supply-os-workspace.module.css`
- `src/app/globals.css`
- `scripts/supply-os-enterprise-design.test.ts`
- `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:supply-os-prototype`
- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-command-model`
- `npx tsc --noEmit`
- production `npm run build` with non-secret local placeholders
- Browser interaction checks for objectives, exceptions, review state, search,
  map modes, layers, quote approval, execution gates, and authority controls
- Browser screenshots of the command surface at desktop, 1024 by 900, and
  390 by 844, plus visual review of all six workspace views

## Caveats

- This remains a client-side modeled workspace. Production data must come from
  office-scoped canonical records with source provenance and approval-aware
  actions.

## Previous Update

## Date

2026-08-06

## Branch

crm-status-structure, merged with current main

## Commit

see git log

## Task implemented

### Supply OS enterprise control tower

The authenticated Supply OS now uses one dense operating surface modeled on
enterprise maritime control towers instead of a sparse card dashboard.

- The Overview keeps planning input above a split control tower. The left pane
  shows exceptions, concentration signals, forwarder coverage, active modeled
  movements, and the selected workflow without forcing the operator through
  separate cards.
- The right pane makes the Natural Earth map the primary workspace. It adds
  supplier, port, route, milestone, and risk layers; network, risk, and cost
  analysis modes; supplier and PO search; zoom and route focus; a filter drawer;
  and a selected-movement inspector.
- The dedicated Supply map tab expands the same map into a larger operating
  canvas with a movement selector and the same shared state as Overview.
- Four modeled movements can be selected. The selected PO updates the route,
  status, workflow, map emphasis, and inspector across both views.
- The map uses actual coordinates for suppliers, ports, destinations, and
  chokepoints. All cargo positions, lanes, costs, dates, status, and risk areas
  remain synthetic. The UI explicitly says there is no live AIS or GPS feed.
- The Derya dashboard shell and its navy, blue-gray, walnut, white, and semantic
  status colors remain unchanged. No green product theme was introduced.
- The prototype still imports no Prisma client, server action, external
  provider, or write path. It sends, books, files, and persists nothing.

## Files changed

- `src/app/dashboard/supply-os/supply-os-workspace.tsx`
- `src/app/dashboard/supply-os/supply-os-workspace.module.css`
- `scripts/supply-os-enterprise-design.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:supply-os-enterprise-design`
- `npm run test:supply-os-prototype`
- `npm run test:load-route-map`
- `npm run test:customer-portal`
- `npx tsc --noEmit --incremental false`
- production `npm run build` with non-secret local placeholders
- `git diff --check`
- changed-text em dash check
- local browser review at 1280, 768, and 375 pixel widths in the dashboard shell
- movement selection, search, map modes, filters, route focus, and zoom checks
- browser console error check

## Caveats

- The prototype is a review surface, not production supply-chain execution.
  Live implementation still requires canonical office-scoped records,
  provider adapters, provenance, and approval-gated actions.

## Earlier Update

## Date

2026-08-04

## Branch

customer-logistics-dashboard

## Commit

see git log

## Task implemented

### Public customer design sandbox

`/customer` is now a no-login review surface for iterating on the customer
workspace without Vercel preview protection or customer authentication.

- The overview contains fictional active, quoted, customs, delivered, RFQ,
  quote-action, and document-request states.
- Shipment rows open shareable detail states such as
  `/customer?shipment=dry-2608-014`, and the detail view returns to the same
  overview.
- The sandbox uses the real customer portal stylesheet, typography, status
  order, milestone labels, and deterministic customer shipment projection.
- Quote, upload, and document controls are visible but disabled. The page does
  not import Prisma, portal authentication, or customer workspace loaders.
- The route is marked `noindex, nofollow` and says plainly that its data is
  fictional.
- The authenticated product remains `/portal`. `/customer` is a design and
  feedback harness, not a second customer data surface.

## Verification

- `npm run test:customer-portal`
- `npx tsc --noEmit --incremental false`
- HTTP 200 for `/customer`
- HTTP 200 for `/customer?shipment=dry-2608-014`
- rendered output contains the development label, fictional company, shipment
  overview, and `noindex`

## Local review

Run the app on the Conductor workspace port and open `/customer`. For this
workspace the current URL is `http://127.0.0.1:55050/customer`.

## Deployment note

No schema, migration, environment, or dependency change is required. The route
will be publicly reachable at `/customer` after this branch is merged and
deployed. It must never be connected to live customer records without a new
authenticated design.

## Prior update

## Date

2026-08-03

## Branch

customer-logistics-dashboard

## Commit

see git log

## Task implemented

### Customer-facing portal design and clear staff access

The portal now reads as a real freight operations workspace instead of a
generic generated dashboard.

- `/portal` is a dedicated customer sign-in surface with customer-specific
  copy, a passwordless email-code form, a new-shipment email link, and an
  explicit route back to internal Derya sign-in.
- The internal `/login` page now sends customers to `/portal` instead of
  leaving the two audiences ambiguous.
- The customer workspace uses a compact operating summary, shipment rows,
  document requests, and direct status language. Decorative icon tiles,
  gradients, shadows, and nested rounded cards were removed.
- Shipment detail is organized as a record with separated facts, milestones,
  quote actions, and documents. It still says tracking comes from Derya
  milestones, not live GPS or vessel position.
- `/dashboard/customer-portal` now gives staff a generic customer sign-in URL,
  company-scoped `View as customer` controls, and member-specific sign-in
  links. The access form has visible labels.
- Staff preview remains read-only and office-scoped. This design pass adds no
  schema, dependency, membership, authentication, or shipment-state change.
- Portal entry-point tests now protect the customer login, staff login, and
  staff preview routes.

## Verification

- `npm run test:customer-portal`
- `npx tsc --noEmit --incremental false`
- `npx prisma validate`
- `npm run test:security`
- `npm run test:docs`
- `npm run audit:tenant-scope`
- `npm run build`
- authenticated browser review of the customer login, workspace, shipment
  detail, and staff access page at desktop and mobile widths
- no horizontal overflow at 390 pixels
- customer quote and upload controls remain disabled in staff preview

The non-strict tenant audit exits successfully and still reports nine known
warnings in unrelated agent, search, login-code, RFQ, thread, and WhatsApp
paths. Browser automation added temporary inline style attributes while
inspecting disabled form controls, which produced hydration mismatch messages;
no application exception was observed.

## Deployment note

No migration or environment change is required. Customers enter at `/portal`.
Admins and managers enter at `/dashboard/customer-portal`, where they can
grant access, copy a sign-in link, or open the same workspace with `View as
customer`.

## Prior update

## Date

2026-08-03

## Branch

customer-logistics-dashboard

## Commit

see git log

## Task implemented

### Read-only preview of the actual customer workspace

Internal admins and managers can now inspect the customer-facing product
without creating a fake customer account or stopping at the sign-in page.

- `/dashboard/customer-portal` has a company picker that opens the real
  customer shipment dashboard in read-only preview mode.
- Preview uses the existing customer-safe workspace and shipment projection
  over current same-office company data. It does not maintain a second mock or
  copy shipment records.
- Preview identity comes from the authenticated internal session and is limited
  to `ADMIN` and `MANAGER`. Company selection is scoped by `officeId`; invalid
  company or shipment IDs return 404.
- Workspace, action-queue, active-load, delivered-load, and shipment-detail
  links preserve preview context.
- Quote decisions and requested-document controls remain visible so operators
  can see the member experience, but all of those controls are disabled.
  Customer server actions still require a real customer portal session.
- Published document links use the existing internal, office-scoped document
  route during preview. Real customers still use the customer portal document
  route.
- No schema, migration, dependency, customer identity, membership, login code,
  or customer session is added by preview.

## Verification

- `npm run test:customer-portal`
- `npx tsc --noEmit --incremental false`
- `npx prisma validate`
- `npm run test:security`
- `npm run test:docs`
- `npm run audit:tenant-scope`
- `npm run build`
- all migrations applied to a disposable PostgreSQL database
- authenticated browser QA of the admin launcher, customer dashboard, and
  shipment detail at desktop, tablet, and mobile widths
- no horizontal overflow or console errors
- preview quote, textarea, file, and upload controls verified disabled
- anonymous preview redirects to internal login, non-manager preview redirects
  to the dashboard, valid same-office preview returns 200, and invalid company
  scope returns 404

The non-strict tenant audit exits successfully and still reports nine known
warnings in unrelated agent, search, login-code, RFQ, thread, and WhatsApp
paths. The new preview query is office-scoped and adds no finding.

## Deployment note

No migration or environment change is required. After deployment, sign in as
an admin or manager, open `/dashboard/customer-portal`, choose a company, and
click View as customer.

## Prior update

## Date

2026-08-03

## Branch

customer-logistics-dashboard

## Commit

see git log

## Task implemented

### Customer shipment control tower and tracking detail

The authenticated customer workspace now starts with an operations dashboard
and gives every visible load a dedicated shipment page.

- `/portal/workspace` shows counts for in-progress, in-transit, action-needed,
  and delivered shipments, plus a consolidated quote and document action queue.
- Active shipment cards show the customer-safe route, current stage, milestone
  progress, ETD, ETA, and next recorded milestone.
- `/portal/shipments/[jobId]` shows the full customer-safe timeline, shipment
  facts, quote lines, requested uploads, and explicitly published documents.
- The shipment page says plainly that it reflects recorded milestones and does
  not claim live GPS or vessel position.
- Detail reads require an authenticated portal session, the same `officeId`,
  and an active membership in the shipment's company. Missing or unauthorized
  shipment IDs return 404.
- Quote approval remains a pending operator action. Browser verification proved
  the approval notice appears while the canonical job remains `QUOTED`.
- The release review removed the legacy internal-note fallback from customer
  quote lines. Portal document downloads now reject arbitrary remote URLs and
  accept only Derya-managed storage, Gmail attachments, or embedded demo files.

## Files changed

- `src/app/portal/workspace/page.tsx`
- `src/app/portal/shipments/[jobId]/page.tsx`
- `src/app/portal/portal-workspace.module.css`
- `src/lib/customer-portal-auth.ts`
- `src/lib/customer-portal-data.ts`
- `src/lib/customer-portal-security.ts`
- `src/lib/customer-portal-view.ts`
- `src/app/api/portal/documents/[id]/route.ts`
- `scripts/customer-portal.test.ts`
- customer portal architecture and handoff documentation

## Verification

- `npm run test:customer-portal`
- `npx tsc --noEmit --incremental false`
- Prisma schema validation and all migrations on disposable PostgreSQL
- `npm run test:security`
- `npm run test:docs`
- `npm run audit:tenant-scope`
- `npm run build`
- Authenticated browser QA at desktop, tablet, and mobile widths with no
  horizontal overflow or console errors
- Runtime checks for login, legacy `?job=` redirects, unauthenticated detail
  redirects, inaccessible shipment 404s, and pending quote approval
- Release-review regression tests for internal-note isolation and portal
  document source restrictions

## Deployment note

Apply migration `20260729000100_customer_portal_workspace` before deploying.
Portal access still requires an operator to grant company membership and send
the deployed `/portal` URL. Tracking is milestone-based until a carrier or
telematics source is explicitly integrated and its data quality is defined.

## Prior update

## Date

2026-07-29

## Branch

customer-portal-strategy

## Commit

see git log

## Task implemented

### Email-first customer portal and operator control plane

Derya now has an authenticated, company-scoped customer workspace on top of
the existing Freight OS records.

- External customer identities, login codes, sessions, and company
  memberships are separate from internal operator authentication.
- Customers can see their company's RFQs, active and completed shipments,
  quote lines, customer milestones, and explicitly published documents.
- Customers can accept a quote, request quote changes, and upload only
  documents that an operator requested.
- Every customer write creates a pending operator-review action. No portal
  action books freight, changes job status, approves a document, or sends an
  external message.
- Operators manage access and customer actions at
  `/dashboard/customer-portal`.
- Job document controls now distinguish request, upload, approval, and
  customer publication. Existing documents remain hidden after migration.
- The guest shipment page remains read-only, now shows ETD, ETA, and customs
  milestones, and serves only explicitly customer-visible approved files
  through an authorized proxy.
- The company-brain delivery contract and durable architecture decision now
  record the email, portal, and human operating model.

## Files changed

- `prisma/schema.prisma` and
  `prisma/migrations/20260729000100_customer_portal_workspace/migration.sql`
- `src/app/portal`, `src/app/api/portal`, and customer portal libraries
- `src/app/dashboard/customer-portal`
- job document actions, controls, and download response helper
- `scripts/customer-portal.test.ts` and `package.json`
- company brain, decisions, product context, ideas, handoff, and engineering log

## Verification

- Prisma schema validation
- Prisma client generation
- TypeScript no-emit check
- Customer portal unit test
- Production build, docs check, tenant audit, and final diff checks

## Deployment note

Apply the new Prisma migration before deploying the application. Portal access
does not send an invitation automatically. An operator grants access and sends
the deployed `/portal` URL to the customer through the normal approved channel.

## Prior update

## Date

2026-07-29

## Branch

find-hardware-import-data, merged with current main

## Commit

see git log

## Task implemented

### Production health severity fix

The public `/api/health` route no longer reports the entire application as
down because one recoverable background job exhausted its retries.

- Database reachability and checked Prisma schema fields remain critical. Any
  failure in those checks still returns HTTP 500 with `status=unhealthy`.
- Background-job backlog is now an operational warning. Failed or stale jobs
  return HTTP 200 with `status=degraded`, while the authorized diagnostic
  still includes the failed check, severity, and redacted counts.
- The public response remains shallow. It exposes only `ok`, `status`, and a
  timestamp, with no environment values, queue counts, model names, or errors.
- Production evidence before the patch showed the app, Gmail cron,
  background-job cron, Google Sheets sync, and pentest repair route returning
  successfully while only `/api/health` returned 500.

Verification used a fresh disposable PostgreSQL database with one intentionally
failed background job. The public route returned HTTP 200 and
`status=degraded`; the authorized diagnostic retained
`backgroundJob_backlog ok=false`, `severity=warning`, and the fixture count.
The disposable database was removed after verification.

### Olympian load dossier and unified load workspace

The dashboard now has one office-scoped, idempotent Olympian Motors import for
reference `OM-O1-AUG2026-SHA-LAX`.

- An ADMIN can add or reopen the load from `/dashboard/jobs`. The importer
  creates one company link, inquiry, job, deduplicated sanitized conversation,
  required-document list, milestone plan, issue tasks, audit event, and memory
  event. Re-running it returns the same load and repairs missing fixture-owned
  messages, documents, tasks, milestones, audit evidence, and memory evidence.
- The imported facts describe two prototype Model O1 Coupe EVs in one 40HC,
  Shanghai origin, a requested Los Angeles-area ocean arrival, Irvine final
  delivery, installed batteries, August 27 cargo-ready target, and the
  requested August 31 through September 2 vessel window.
- Missing weights, VINs, commercial value, currency, HTS, Incoterm, broker,
  confirmed booking, ETD, ETA, carrier acceptance, and port authorization stay
  unresolved. The April 30 rate revision is visible only as historical source
  evidence. It does not create a carrier quote, cost, revenue, or target.
- The primary load page is now a unified control surface with an ordered issue
  brief, action queue, evidence-state dossier, document and conversation
  counts, load-scoped chat, and a working offline route map. Dense legacy
  commercial, document, security, and operating controls remain available in
  one collapsed supporting section.
- The Shanghai to Irvine plan renders a coarse, date-line-safe city-area
  corridor because neither exact port is confirmed. It does not invent
  Yangshan, the Port of Los Angeles, or drayage handoffs. Explicit ports render
  only when the load names them. The map is planned, not live tracking.
- `Review this load in Intel` opens `/dashboard/intel/load?jobId=...` with a
  privacy-safe, office-scoped structured brief. The operator must review and
  click Build shipment report. No analysis starts automatically and nothing
  is persisted. `Research lane risks` prefills the main Intel chat without
  sending the question.

Local verification created the load in the disposable QA office. Production
creation still requires the authenticated ADMIN action after deployment.

### Recontact support and eight fresh hardware prospects

The authenticated campaign loader now queues contacts whose CRM status is
`contacted`, matching the operator's explicit decision that prior outreach does
not disqualify a person from a new attempt.

- Truly protected relationship states still stop the transaction, and a person
  already marked Reached out in the current week still cannot be reloaded.
- Eight new researched hardware-company prospects expand the campaign from 112
  to 120 people: Atomic Industries, Forge Robotics, Tensr, Diode Computers,
  Cosmic Robotics, Tenet Industries, ProvenMetal, and Nine Fives.
- Today's load is now 27 YC hardware founders on Bookface, 31 hardware-company
  leaders on LinkedIn, and 62 specialist hardware investors on Email.
- The loader test proves that a previously contacted CRM person is preserved,
  reused, changed back to queued, and added to today's outreach plan.

### Production outreach loader advisory-lock hotfix

The first production campaign-load attempt failed before any CRM writes because
PostgreSQL returns `pg_advisory_xact_lock` as `void`, which Prisma cannot decode
from `$queryRaw`.

- The advisory-lock query now casts its result to `text` while preserving the
  same transaction-scoped, office-specific lock.
- The loader test now reproduces Prisma's `void` deserialization failure when
  that cast is missing.
- The focused campaign suite, CRM suite, and TypeScript check pass with the
  fix. The operator can safely retry the load after deployment.

### Corrected 120-person hardware outreach campaign

The Outreach workspace now has an authenticated, tenant-scoped loader for a
researched hardware-company and investor campaign.

- Bookface contains exactly 27 YC hardware-company founders. LinkedIn contains
  exactly 31 hardware-company founders and executives. Those 58 rows are
  startup buyer leads, not investors.
- Email contains 62 specialist hardware, industrial, logistics, climate, and
  deep-tech investors from Fifty Years, HAX, DCVC, Lux, Root, Playground,
  Construct, Dynamo, Ironspring, Autotech, Material Impact, and related funds.
- Every company target includes an official source, freight relevance, and a
  direct discovery ask about components, Asia manufacturing, and U.S. inbound
  freight. Every investor target includes a specific portfolio-introduction ask.
- The loader reuses a matching person already in CRM and creates only missing
  companies and contacts. It preserves existing email, phone, and profile data.
  It refuses to overwrite duplicate people, protected relationship statuses, or
  outreach already completed this week.
- Loading the campaign makes those 120 people today's open queue and moves the
  previous open Today rows back to the weekly pool. It verifies the 27/31/62
  split before committing the transaction.
- Matching is case-insensitive within the current office. The transaction locks
  company and contact writes during the one-time load, and an intentional reload
  restores skipped campaign rows to Today.
- Email addresses remain blank when they have not been verified. The 62 VC
  targets include a LinkedIn people search and official team source so the
  operator can find and confirm the address rather than storing guessed data.
- The daily and weekly tables show the freight-prospect or portfolio-intro
  reason and ask directly beside each person.

## Files changed

- `src/lib/hardware-vc-outreach-campaign.ts`
- `src/lib/load-hardware-vc-outreach.ts`
- `src/app/dashboard/crm/actions.ts`
- `src/components/contact-sheet.tsx`
- `src/app/globals.css`
- `scripts/hardware-vc-outreach.test.ts`
- `scripts/hardware-vc-outreach-loader.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:hardware-vc-outreach`
- `npm run test:crm`
- `npm run test:crm-outreach`
- `npx tsc --noEmit`
- `git diff --check`
- Changed-text em dash check

## Verification blocked

- `npm run test:crm-outreach-db` reached Prisma correctly with the required
  React Server condition, but the disposable PostgreSQL URL is not available
  in this workspace. The database rejected the placeholder credentials before
  the test could create its isolated office.

### Intel is chat-first

`/dashboard/intel` now opens as a dedicated full-page intelligence
conversation instead of rendering the hardware import report before the
operator can ask a question.

- The question composer stays visible while answers and evidence are read.
  Suggested questions cover China to U.S. West Coast history, California
  hardware categories, trade-data providers, and customs risk.
- A successful `get_hardware_import_report` tool call attaches the complete
  sourced hardware report directly under that answer. The report does not
  render as a landing banner.
- The hardware tool returns deterministic facts from the validated Census
  snapshot plus explicit provider gaps. ImportGenius, TradeAtlas, and Trademo
  remain labeled as not connected.
- Every `/dashboard/intel` route suppresses the duplicate floating agent dock.
  The main Intel desk also suppresses recent job focus, job and customer memory
  injection, price prefetch, and pasted-RFQ ingestion. Questions and answers
  are not written to the agent event log. Actual shipment review stays at
  `/dashboard/intel/load`.

### GPT-5.6 and Intel shipment review
All active application reasoning paths now use OpenAI GPT-5.6 through the
existing server-side `OPENAI_API_KEY`.

- `src/lib/gpt56-client.ts` centralizes the Responses API contract, including
  `store: false`, a 45-second timeout, one SDK retry, low reasoning for bounded
  calls, medium reasoning for function-tool loops, and provider-neutral
  message and function schema conversion. It replays GPT reasoning items and
  function call IDs with each tool result.
- RFQ parsing, pasted-load extraction, email classification, thread
  consolidation, document analysis, supplier-offer extraction, job proposal
  population, meeting notes, email drafts, stuck-job recommendations, intent
  parsing, and the main operator agent all use GPT-5.6.
- The Anthropic SDK and active `ANTHROPIC_API_KEY` contract were removed.
  `whisper-1` remains only for `/api/transcribe` because speech-to-text is a
  specialized endpoint.
- Deterministic freight rules, tenant-scoped data access, proposal review, and
  outbound human approval boundaries remain unchanged.
- `scripts/gpt56-runtime.test.ts` scans all TypeScript source files and rejects
  Anthropic imports, Anthropic environment references, Claude model names, and
  unexpected model literals.
- Model identity questions bypass model generation and return the canonical
  OpenAI GPT-5.6 identity string. The domestic trucking pre-flight rejects
  unsupported text with zero operational load facts, labels partial loads as
  needing details, disables RFQ creation until lane and cargo facts exist, and
  no longer presents zero findings as "nothing breaks."

Intel also has a dedicated, read-only China to U.S. ocean shipment review at
`/dashboard/intel/load`.

- The review accepts a pasted shipment brief or a blank manual packet. When
  `OPENAI_API_KEY` is configured, the page sends pasted text to OpenAI
  GPT-5.6 through the Responses API and requires Zod-backed Structured
  Outputs. The request uses medium reasoning and `store: false`. The text,
  extracted fields, and assessment are not persisted by Derya, and the action
  has no Prisma write, RFQ conversion, revalidation, or downstream provider
  action.
- If model extraction is unavailable or fails, a conservative local parser
  still reads explicitly labeled shipment facts. It does not infer negative
  product screens, and every locally parsed value remains an unconfirmed
  supplier statement.
- A separate versioned input contract records route, controlling customs
  event, exact entry timing, product identity, proposed HTS, origin,
  valuation, importer and broker facts, UFLPA evidence, ocean filing, and
  twelve tri-state product screens. Missing values remain unknown.
- AI and supplier values remain unverified until individually confirmed.
  Hidden values cannot be bulk-confirmed, negative agency screens close only
  from operator-confirmed or document-backed facts, and stale async responses
  cannot overwrite newer edits.
- Explicit air, road, rail, or unknown modes remain outside this ocean
  workflow instead of being coerced into scope. A damaged-battery blocker
  requires confirmed provenance for both the battery screen and the damage
  claim.
- The report renders before the editor and contains an executive readiness
  view, missing and unconfirmed facts, date-sensitive actions, eight customs
  gates, product and agency screens, a supplier/importer/broker question list,
  and a collapsed 47-record official source ledger. It includes sticky report
  navigation, print output with source URLs, and copyable questions.
- Rule timing was refreshed at `2026-07-24T23:48:00.000Z`. The July 24 USTR
  Section 301 action is active at and after 12:01 a.m. EDT, while the temporary
  Section 122 action is expired at that same instant. The review recomputes
  state from the shipment's confirmed controlling event and exact timestamp.
- The USTR in-transit path asks for vessel-loading and final-mode facts only
  before the July 28, 12:01 a.m. EDT exception deadline. Dotted ten-digit HTS
  values normalize safely, nonpositive weights and values fail closed, and a
  late ISF timestamp cannot make the ocean-filing gate ready.
- The old load checker is now labeled as a U.S. domestic trucking pre-flight
  and explicitly says that it does not assess import duty, ocean filing,
  product admissibility, or customs clearance. A missing local Carrier table
  now degrades to an empty carrier bench instead of crashing that read path.

## Verification passed

- `npm run test:gpt56-runtime`
- `npm run test:email-classifier`
- `npm run test:intel-china-load-assessment`
- `npm run test:intel-china-load-extraction`
- `npm run test:intel-china-load-ui`
- `npm run test:intel-china-customs-guide`
- `npx tsc --noEmit --incremental false`
- `npm run build` with the documented local database and auth placeholders
- Browser QA at 390px and 1440px with no horizontal overflow or console errors

## Known gaps

- The shipment review does not calculate duty, fetch a live HTS result, submit
  ISF or entry data, replace a licensed customs broker, or promise clearance.
- The USTR final action is represented from the official July 23
  prepublication final notice. The current USITC HTS revision predates the
  July 24 transition, so a broker and current ACE/HTS check remain mandatory.
- No ImportGenius, TradeAtlas, Trademo, schedule, rate, or carrier provider is
  connected. Freight quote readiness means the core fact packet is usable for
  rate research, not that a rate was retrieved.
- The page is intentionally nonpersistent. Printing or copying the questions
  is the current handoff path; a saved, office-scoped review record would
  require a separate approved schema and audit design.
### CRM and Outreach workspace
Split Outreach into its own top-level workspace while keeping it fully
connected to CRM.

- Added `/dashboard/outreach` and a dedicated Outreach item in the Commercial
  Workflow navigation. The route defaults to today's queue and keeps the weekly
  pool at `?view=week`.
- `/dashboard/crm` is now the contact-data workspace. It shows status,
  importance, category, channel, and contact details, with a direct Open
  Outreach button instead of embedding outreach as a CRM mode.
- Both routes reuse the same office-scoped contacts, companies, deterministic
  planner, `OutreachPlanItem` records, and CRM server actions. There is no
  copied data and no second outreach implementation.
- Daily and weekly views return to CRM through Manage CRM contacts and the
  empty-capacity cards. Search text survives the route transition.
- Existing `/dashboard/crm?view=today|week` links redirect to the new Outreach
  route so bookmarks do not strand operators on an obsolete CRM mode.
- Contact edits, Reached out, and Later now revalidate both CRM and Outreach.
  Manual completion still writes the CRM activity and touch timestamps.

## Files changed

- `src/app/dashboard/outreach/page.tsx`
- `src/app/dashboard/crm/page.tsx`, `src/app/dashboard/crm/actions.ts`
- `src/app/dashboard/layout.tsx`, `src/components/contact-sheet.tsx`
- `src/lib/crm-view.ts`, `src/lib/crm-workspace.ts`
- `scripts/crm-outreach-ui.test.ts`
- `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`

## Verification passed

- `npm run test:crm`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check` and changed-text em dash check
- Authenticated browser QA with a disposable local Postgres database. Verified
  the sidebar tab, CRM and Outreach cross-links, daily and weekly URLs, legacy
  redirects, search preservation, responsive layouts, Reached out persistence
  into CRM, and no console errors.

## Verification failed then resolved

- The first build invocation omitted `DATABASE_URL`. The build passed after
  using the disposable local database URL.
- The first local login attempts lacked the QA email allowlist and
  `AUTH_SECRET`. Both were supplied only to the disposable local server.
- The disposable QA database was behind the current Prisma schema. A guarded
  local `npm run db:push` synchronized it before browser QA.

## Caveats

- This route split has no schema or dependency change. The production planner
  migration was already deployed with the prior CRM outreach release.
- Outreach remains human-operated. No Bookface, LinkedIn, or Email message is
  sent automatically.
- Contacts must be classified as Personally important or Startups and assigned
  a channel before they can fill capacity. Forwarders remain data-only.

## Previous Update

## Date

### Intelligence history
2026-07-23

## Branch

find-hardware-import-data (Conductor workspace, targets main)

## Commit

see git log

## Task implemented

Intel now opens as a structured China to U.S. West Coast hardware report with
fixed-basket customs history, current tariff and admissibility controls, and
claim-local official evidence.

- Census snapshot schema v4 contains a China-only fixed 43-code vessel series
  for every complete year from 2010 through 2025 plus May 2026 YTD. It uses 34
  unique official State Imports HS6 and Port Imports HS6 ZIP files plus the
  Schedule C dictionary, with checksums and reconciliation checks.
- The fixed 43-code history stays separate from the current 46-code hardware
  basket. The report does not splice classifications introduced in 2022 into
  earlier years or compare a partial YTD period directly with a complete year.
- The primary watch still reports May 2026 YTD China-origin vessel value of
  $8.89B across West Coast port-of-unlading districts, 20.8% of the current
  West Coast hardware basket by value, and 23 positive category-by-district
  observations. Districts remain research areas, not port, carrier, or route
  recommendations.
- The customs operator guide uses eight deterministic gates and 47 official
  authority and guidance references. It separately stores controlling law,
  fact-matched rulings or scope decisions, current implementation guidance,
  and handbook context.
- The same-day USTR review added the July 23, 2026 forced-labor Section 301
  final action. The prepublication notice establishes 12.5 percent under HTSUS
  9903.05.31 for covered products of China from 12:01 a.m. EDT on July 24,
  subject to Annex I and Annex II Part A exemptions. A narrow in-transit
  exception requires loading onto a vessel at the port of loading and transit
  on the final mode before the cutoff, followed by entry before 12:01 a.m. EDT
  on July 28. The UI shows the July 24 Eastern cutoff as July 23 at 9:01 p.m.
  PDT for West Coast operators and requires rechecking the filed notice,
  current HTS, exact product, expected entry date, and transit facts.
- Rules remain evaluated as of `2026-07-23`; source review time is
  `2026-07-24T01:36:03.000Z`. Publication, effectiveness, expiration, handbook
  revision, page modification, and review dates are not collapsed into one
  misleading date.
- Twelve product screens separate FCC current conditions and dated
  amendments, FDA medical-device and radiation-product requirements, CPSC,
  lithium batteries, general hazardous materials and vessel carriage, NRC
  nuclear imports, EPA engines, EPA FIFRA pesticides and devices, EPA
  refrigerant equipment, DOE covered equipment, and APHIS solid wood
  packaging. Finished charged equipment remains separate from bulk
  refrigerant and from its transport classification.
- The report presents primary sections 01 through 06 and moves the all-origin
  supporting report into Appendix A. Historical evidence is a responsive
  three-column table that stacks on mobile, chart descriptions name each
  series and endpoints, alerts meet readable contrast, and source links expose
  their geography.
- The authenticated China watch export returns schema v2 JSON containing the
  watch, fixed history, routing brief, and customs guide. No provider account,
  licensed bill-of-lading export, CRM write, route choice, quote, lead score,
  or customer-facing action was added.

## Verification passed

- `npm run test:intel-census-public-hardware`
- `npm run test:intel-corridor-watch`
- `npm run test:intel-china-customs-guide`
- `npm run test:intel-china-watch-export`
- `npm run test:intel-hardware-export-route`
- `npm run test:intel-ocean-hardware`
- `npm run test:intel-sources`
- `npm run test:intel-report-ui`
- `npm run test:intel-boundary`
- `npx tsc --noEmit --incremental false`
- `npm run check:docs`
- Production build against local Postgres
- Authenticated browser QA at 390, 768, and 1440 pixel widths
- Zero horizontal overflow, working evidence deep links, keyboard-operable
  disclosures, collapsed Appendix A, and no product console errors on a clean
  reload

## Known gaps

- Refresh is an explicit build step, not a scheduler. Run
  `npm run snapshot:intel-hardware -- --as-of=YYYY-MM` after a new Census
  monthly release from January through November, review the diff, and commit
  the regenerated artifact. December is rejected because that file represents
  a complete year; the following January refresh captures it correctly.
- The watch still lacks the foreign loading port, exact U.S. port and terminal,
  shipment endpoints, actual bill-of-lading route, carrier and service,
  sailing schedule, rate and accessorials, transit reliability, and
  shipment-specific cargo constraints.
- Company and lead qualification still require licensed bill-of-lading
  evidence. ImportGenius, TradeAtlas, and Trademo remain unconnected.
- District observations cannot be joined to the independent California
  ultimate-destination signal. May 2026 is partial-year data and cannot be
  compared directly with a complete year.
- The customs guide organizes evidence and blocks unsupported promises. It
  does not calculate the exact duty, issue a ruling, replace a customs broker,
  or promise admissibility or clearance. Revalidate all current, upcoming, and
  time-limited actions against the expected entry date.
- Scoped ESLint cannot start in the current repository because ESLint 9 expects
  a flat `eslint.config.*` file while the repo still has `.eslintrc.json`.

## Previous Update

## Date

2026-07-22

## Summary

The hardware report moved to the validated keyless Census file snapshot with
five complete years plus current YTD, exact ZIP checksums, current origin and
gateway rollups, and a role-gated full snapshot export. See the engineering
log and the 2026-07-22 decisions for the complete source and refresh contract.

## Previous Update

## Date

2026-07-21

## Branch

casablanca (Conductor workspace, targets main)
### CRM outreach history
2026-07-26

## Branch

crm-status-structure (Conductor workspace phoenix, targets main)

## Commit

not committed

## Task implemented

### Intel Phase A
Intel Phase A is complete.

- Canonical code now lives under `src/lib/intel/` and
  `src/app/dashboard/intel/`. The old load-check, enrichment, market-indicator,
  component, and Market route paths are one-way compatibility shims or a
  redirect. Domestic pricing uses the canonical Intel location classifier.
- `src/lib/intel/sources.ts` is the typed source spine. Every fetch is
  registry-gated, citation hosts are allow-listed, secret-bearing links fail
  closed, and cache timestamps are stored inside cached results. Manual rule
  review time is distinct from live data fetch time.
- Every Intel card and finding exposes an exact Sources chip. Census commodity
  tiles cite only their own HS query. Persisted RFQ reports include a
  plain-text source footer, and `parsedData.preflight.sources` stores the same
  structured snapshot.
- `/dashboard/intel` is canonical, `/dashboard/market` redirects, and
  `/dashboard/intelligence` remains the separate company-brain market-signal
  surface. Nav matching uses path-segment boundaries so Intel and Intelligence
  do not collide.
- Adversarial review fixes include rejecting modified CBP rulings, removing
  historical Section 301 percentage claims from heading-level scans, hedging
  MFN output until an 8 or 10 digit classification exists, and using FMCSA
  dataset metadata instead of HTTP fetch time for insurance data vintage.
  L&I history is filtered to active policies before display; broker
  registration copy now separates federal requirements from Derya policy; and
  HOS-based mileage thresholds are labeled as Intel planning assumptions. A
  completion-gap review also restored all six original calendar and equipment
  checks with narrower language and claim-specific CargoNet, FBI, TI, R+L,
  and National Weather Service citations.

## Verification passed

- `npm run test:intel-sources`
- `npm run test:intel-boundary`
- `npm run test:load-check`
- `npm run test:load-check-enrich`
- `npm run test:market-indicators`
- `npm run test:security-sop`
- `npm run test:carrier-vetting`
- `npm run test:truckload-quotes`
- `npx tsc --noEmit --incremental false`
- Production build with disposable database placeholders
- Scoped Next lint for Intel-owned files and compatibility shims
- Authenticated local HTTP integration: rendered Intel, followed the Market
  redirect, analyzed the flagship battery load, created a throwaway RFQ, and
  verified office scope, persisted source records, and the report footer

## Known baseline failures and gaps

- Repo-wide lint still fails on unrelated pre-existing lint debt, including
  the dashboard layout's plain anchor and domestic pricing's image warning.
- Several existing `test:*` scripts use Prisma or seed prerequisites, contrary
  to the brief's DB-free assumption. The relevant pure-lib and bridge suites
  above passed.
- Click-level browser visual QA was unavailable. Source-chip keyboard,
  positioning, scroll, and link behavior were code-reviewed but not exercised
  by a browser automation tool.
- This is Phase A only. The one-input intent router, serializable
  `AnswerDocument`, standalone customs/carrier/lane resolvers, and QCMobile
  work remain Phase B.

## Earlier Update
### CRM outreach operating loop
CRM outreach operating loop with a finite daily queue and weekly source pool.

- The CRM now leads with Status, Importance, Category, Contact, Company, and
  contact details. Categories are Personally important, Startups, Forwarders,
  and Other. Forwarders remain data-only and are excluded from the outreach
  queue.
- The deterministic planner maintains weekly channel pools at seven days of
  capacity and promotes at most 20 Bookface, 30 LinkedIn, and 30 Email contacts
  each day. Importance controls promotion order. Unfinished work carries
  forward and consumes the next day's capacity.
- Operators explicitly mark a contact Reached out or defer it with Later.
  Completion creates an office-scoped activity and best-effort memory event,
  updates contact and company touch timestamps, and never sends a message.
- The CRM header reports today, yesterday, and current-week progress. Channel
  cards show reached, due, weekly planned, and weekly target counts. A visible
  warning explains any weekly pool shortfall.
- Mobile daily rows render as complete task cards so contact details and
  completion actions do not require hidden horizontal scrolling.

## Files changed

- `prisma/schema.prisma`,
  `prisma/migrations/20260726000100_crm_outreach_planner/migration.sql`
- `src/lib/contact-fields.ts`, `src/lib/crm-outreach.ts`,
  `src/lib/crm-outreach-plan.ts`
- `src/app/dashboard/crm/page.tsx`, `src/app/dashboard/crm/actions.ts`
- `src/components/contact-sheet.tsx`, `src/app/globals.css`
- `scripts/crm-sheet.test.ts`, `scripts/crm-outreach.test.ts`,
  `scripts/crm-outreach-db.test.ts`, `package.json`, and docs

## Verification passed

- Prisma validate and client generation.
- CRM unit tests, planner tests against all migrations on disposable Postgres,
  TypeScript, production build, documentation checks, and diff checks.
- Browser QA at desktop and mobile widths, including login, queue totals,
  manual completion, no quota backfill after completion, contact column order,
  forwarder exclusion, and console errors.

## Caveats

- Deploy the new Prisma migration before serving this build.
- Existing contacts need an outreach channel and an eligible category before
  the planner can use them. A short weekly pool is reported honestly.
- ESLint 9 cannot run in this repository because no flat `eslint.config.*`
  exists. This task does not add unrelated lint configuration.
- The non-strict tenant-scope audit still reports eight pre-existing queries
  in unrelated files: five high and three medium. None are in this change.
## Previous Update

## Date

2026-07-24

## Branch

pattaya (Conductor workspace, targets main)

## Commit

see git log

## Task implemented

Desk Assistant grounded in the Incoming RFQs lead board. The floating agent,
asked on /dashboard/rfq?view=us "what loads arrived in the last 3 days that
replied to our initial email", answered from stuck jobs and an unrelated
implicit-focus job because it had no tool over the Meta-lead cards and no idea
what page it was on. Fixed on three legs:

- **list_lead_board agent tool** (`src/lib/lead-board.ts` pure derivation +
  `src/lib/lead-board-query.ts` prisma side): lists Meta-lead cards with the
  page's exact rules - lead quality tier, outreach sequence state (chips:
  replied/waiting/new/dropped/desk), live inbound reply detection (only after
  our first outbound), reply excerpts, review URLs. Filters: market US/TR,
  stage, quality tier, arrived_within_days, replied_within_days, status_scope
  open/all, free-text q, limit.
- **Page scope**: the agent dock now passes the page URL to `chatWithAgent`
  (new optional `scopePage` arg). On /dashboard/rfq the system prompt gets a
  live board snapshot (stage counts + up to 30 visible cards mirroring the
  URL's view/quality/stage/status/q filters; TR view gets the sheet rows) and
  the implicit most-recent-job focus, commercial-brain preflight, and price
  intel prefetch are suppressed - those were exactly how the agent hijacked
  board questions onto a different load. SYSTEM prompt routes lead vocabulary
  to list_lead_board and forbids answering lead questions from job tools.
- **search_inquiries** now also matches `reference` (DRY... codes were
  unfindable) and `fromCompany`, and returns reference + receivedAt.

## Files changed

- `src/lib/lead-board.ts` (new), `src/lib/lead-board-query.ts` (new)
- `src/lib/agent-tools.ts`, `src/lib/agent-chat.ts`
- `src/components/agent-chat-widget.tsx`
- `scripts/lead-board.test.ts` (new), `package.json` (test:lead-board)

## Verification passed

- tsc + next build clean; `test:lead-board` (new), `test:lead-outreach`,
  `test:lead-quality` pass.
- Read-only run of `loadLeadBoard` against prod (Derya office): Good+open
  lens returns total 26 / replied 2 / waiting 24 / new 0 / dropped 0 -
  identical to the live board chips; the original question resolves to 5
  leads arrived <=3 days with replies (DRY26070377, DRY26070370, DRY26070167,
  DRY26070166, DRY26070161) with correct excerpts; TR market returns 249.

## Caveats

- Lint baseline errors (thread-actions/whatsapp any-types) pre-date this
  change; no new lint findings in touched files.
- The US-view snapshot maps any explicit status tab to status_scope=all
  (named in the filter label) rather than replicating per-tab SQL.
- No DB migration.

## Previous Update

## Date

2026-07-22 (later session)

## Branch

us-lead-reply-routing-revival (Conductor workspace yamoussoukro, targets main)

## Commit

see git log

## Task implemented

US lead replies rerouted to rfq@; oguzhan@ removed from the US flow; day-30
revival email for auto-dropped leads.

- **Reply routing**: every US lead email (first touch, follow-ups 2-4, scope
  follow-up, revival) now sets `Reply-To: rfq@usederya.com`
  (`RFQ_LEAD_REPLY_TO_US`, defaults to the sending address); TR lead emails
  keep `oguzhan@`. Send-all desk forwards exclude US leads entirely
  (`pendingDeskForwardWhere`); the per-row Forward button stays for one-off
  use. **DEPLOY DEPENDENCY: connect rfq@usederya.com via OAuth (Settings →
  Email → "RFQ desk mailbox" row → Connect, signed in as rfq@) right after
  deploy - until then, new replies land in an unsynced mailbox and reply
  detection cannot see them.** The settings page has a dedicated row +
  setup gate for this; "connected" means a refresh token, not just the
  SMTP-only account row that already exists.
- **Revival**: auto-dropped leads (the `leadDroppedAt` stamp - manual
  ignores are never revived) get one "still planning to ship?" email 30
  days after the drop (`REVIVAL_AFTER_DAYS`, stamp `revivalSentAt`,
  threaded via `leadLastMsgId`). Reply detection now also covers dropped
  leads, so an answer to the break-up or revival email resurfaces the card
  as "Replied - needs action".
- Sync summary + button now count revivals; card and expanded-panel copy
  show the actual Reply-To instead of hardcoded oguzhan@.

## Files changed

- `src/lib/rfq-mail.ts`, `src/lib/lead-outreach.ts`, `src/lib/lead-auto-reply.ts`
- `src/lib/google-sheets-sync.ts`, `src/components/sync-google-sheet-button.tsx`
- `src/components/us-lead-cards.tsx`, `src/components/rfq-expandable-rows.tsx`
- `src/app/dashboard/settings/email/page.tsx`, `src/app/api/auth/gmail/start/route.ts`
- `scripts/lead-outreach.test.ts`, `docs/*`

## Verification passed

- tsc + build clean; extended `test:lead-outreach` passes.
- Neon branch of prod: US lead replyTo=rfq@ (first touch and follow-ups),
  TR replyTo=oguzhan@, Send-all pool = 57 TR rows / 0 US leads, engine ran
  the new dropped+revival queries safely (fake SMTP: stamps rolled back,
  abort after 3 failures), settings page renders the rfq@ row as "reply
  capture off", replied cards render "waiting in the rfq@usederya.com inbox".

## Caveats

- US emails are still signed "Oğuzhan Karaca" - flagged to Mert as a
  persona decision, not changed here.
- No DB migration.

## Previous Update

## Date

2026-07-22

## Branch

us-lead-outreach-sequence (Conductor workspace yamoussoukro, targets main)

## Commit

see git log

## Task implemented

US lead outreach sequence (Good + Maybe tiers) + lead cards view.

- **Sequence** (`src/lib/lead-outreach.ts`, engine in
  `src/lib/lead-auto-reply.ts`, runs after every hourly lead-sheet sync):
  first email on arrival for GOOD and REVIEW ("Maybe") tiers - Maybe leads
  get qualifier questions prepended (commercial? company?) and never a
  processing promise; WEAK never emailed. Follow-ups 2/3/4 go out 2/3/4
  days after the last outbound (net day 0/+2/+5/+9), only 07:00-19:00
  America/Los_Angeles; 4 silent days after the final email the lead is
  auto-set IGNORED (`leadDroppedAt`). First touches only for leads received
  within `DERYA_LEAD_OUTREACH_BACKLOG_DAYS` (default 30).
  `DERYA_LEAD_AUTO_REPLY=off` kills all sends.
- **Reply detection**: deterministic - newest INBOUND `EmailMessage` from
  the lead's address (case-insensitive) after our first send, across the
  OAuth-synced inboxes (oguzhan@ = Reply-To, mert@ = CC; both verified
  connected in prod). Stamps `leadRepliedAt`, stops the sequence, card goes
  "Replied - needs action" with the reply excerpt. Any desk status change
  (PRICING, custom) freezes automation ("With the desk").
- **Stamps** live in `parsedData` (`followUp2/3/4SentAt`, `leadRepliedAt`,
  `leadDroppedAt`, `sequenceStoppedAt`, `leadLastMsgId` for In-Reply-To
  threading); the sheet-resync preserve list is now the shared
  `RESYNC_PRESERVED_PARSED_KEYS` const in rfq-mail - add any new stamp
  there or the hourly resync erases it.
- **US cards view** (`src/components/us-lead-cards.tsx` replaces the sheet
  under `/dashboard/rfq?view=us`; Türkiye keeps the table): one card per
  lead - quality badge (Review now displays "Maybe"), lane, contact,
  4-step tracker with dates, stage chip, reply panel, send-next /
  pause-resume / WhatsApp actions, expandable form answers + email
  previews. Stage filter chips (Replied / Waiting / Not emailed / Dropped)
  compose with the Good/Maybe/All quality chips and the status tabs.
  New actions: `sendNextOutreachAction`, `toggleLeadSequenceAction`.

## Files changed

- `src/lib/lead-outreach.ts` (new), `src/lib/lead-auto-reply.ts`,
  `src/lib/rfq-mail.ts`, `src/lib/lead-emails.ts`, `src/lib/lead-quality.ts`,
  `src/lib/google-sheets-sync.ts`
- `src/app/dashboard/rfq/page.tsx`, `src/app/dashboard/rfq/actions.ts`
- `src/components/us-lead-cards.tsx` (new),
  `src/components/rfq-expandable-rows.tsx`,
  `src/components/sync-google-sheet-button.tsx`, `src/components/icon.tsx`
- `src/app/globals.css`, `scripts/lead-outreach.test.ts` (new), `package.json`

## Verification passed

- `npx tsc --noEmit` clean; `npm run build` (dummy DATABASE_URL) clean.
- `test:lead-outreach` (new), `test:lead-quality`, `test:lead-emails`,
  `test:rfq-whatsapp` pass; lint error count unchanged vs baseline (101).
- End-to-end on a Neon copy-on-write branch of prod: US view renders 20
  Good cards + Maybe (71) chip + stage chips with live counts; engine
  dry-run (fake SMTP password) detected the 2 real replies (DRY26070146,
  DRY26070127), rolled back claimed stamps on send failure, aborted after
  3 systemic failures.

## Caveats

- No DB migration - all state is parsedData JSON; nothing to run on prod
  before deploy.
- rfq@ stays SMTP-only; reply capture depends on oguzhan@/mert@ staying
  OAuth-connected.
- The ~50 in-window Maybe leads get first touches over the first ticks
  after deploy (cap 25 emails/tick); older Maybe leads stay manual.
- The qualifier prepend also reaches the TR sheet's manual "Ask info"
  email for Maybe-tier TR leads (same builder); the automated sequence
  itself only processes US-marker leads.

## Previous Update

## Date

2026-07-20

## Branch

edmonton (Conductor workspace, targets main)

## Commit

see git log

## Task implemented

Loadboard employee accounts + load assignment + admin activity log.

- **EMPLOYEE role** (`UserRole.EMPLOYEE`): loadboard-only operators. Route
  gating lives in `src/middleware.ts` (verifies the `crm_session` HMAC with
  WebCrypto on the edge runtime, mirrors `decodeSession`); employees may open
  only `/dashboard/loads` and `/dashboard/jobs*` (not `/dashboard/jobs/new`),
  everything else redirects to `/dashboard/loads`. The dashboard layout hides
  all non-loads nav/chrome for employees (CommandPalette, agent chat widget,
  live toast, RFQ/WhatsApp chips, channels/admin links). Sign-in allowlist
  defaults now include atahan@ and merve@usederya.com
  (`src/lib/login-code.ts`).
- **Load assignment**: `Job.assignedToUserId` is now a real relation
  (`Job.assignedTo`, `User.assignedJobs`, FK + index in migration
  `20260720000100_employee_role_assignee_audit_log`). Every load surface has
  a **General board / My board** scope (loads page tabs `?scope=mine`, deal
  pipeline scope tabs preserved across Board/Table). Loads table + jobs table
  show an Assigned column; board cards show an assignee chip. Job detail
  header: admins/managers get an assign dropdown (`assignJobAction`,
  role-gated), everyone else gets **Take this load** (`claimJobAction`,
  atomic claim of unassigned loads only). Creation paths no longer
  auto-assign the creator (jobs/new, queue convert, RFQ load review) — loads
  start unassigned so the personal-board/claim flow works.
- **Activity log**: new `AuditLog` model (officeId, actorUserId/actorEmail,
  action, entityRef, summary, changes JSON) + `src/lib/audit.ts`
  (`recordAuditLog`, `diffAuditChanges`). Hooked into `updateJobStatus`,
  `updateJobAllFields` (field-level diff), `updateJobField`, `updateJobNote`,
  `selectCarrierQuote`, claim/assign, and the three load-creation paths.
  Admin → **Activity log** tab renders the last 200 entries (who, action,
  load link, per-field from → to).
- **Employee provisioning**: `scripts/create-employee-user.ts`
  (`npm run create:employee`, env-driven, guarded by
  `ALLOW_EMPLOYEE_USER_CREATE=1`).

## Files changed

- `prisma/schema.prisma`, `prisma/migrations/20260720000100_employee_role_assignee_audit_log/migration.sql`
- `src/lib/audit.ts` (new), `src/lib/login-code.ts`, `src/middleware.ts`
- `src/app/dashboard/layout.tsx`, `src/app/dashboard/loads/page.tsx`, `src/app/dashboard/jobs/page.tsx`
- `src/app/dashboard/jobs/[jobId]/page.tsx`, `src/app/dashboard/jobs/[jobId]/actions.ts`, `src/app/dashboard/jobs/new/page.tsx`
- `src/app/dashboard/queue-actions.ts`, `src/lib/rfq-load-review.ts`
- `src/components/jobs-board.tsx`, `src/components/jobs-table.tsx`
- `src/app/dashboard/admin/page.tsx`
- `scripts/create-employee-user.ts` (new), `scripts/login-code.test.ts`, `package.json`

## Verification passed

- `npm run build` (dummy DATABASE_URL) — types + build clean.
- `npx tsx scripts/login-code.test.ts` — updated for the new default allowlist.
- `next lint` on changed files — only pre-existing `<a>`-vs-`Link` errors and
  unused-var warnings that predate this change.

## Caveats

- Middleware gating is defense-in-depth for routing; server actions outside
  the loads surfaces are still importable by an authenticated employee who
  crafts requests (internal-trust deployment; assign action is role-gated).
- Employees see full load details incl. revenue/cost and the customer-portal
  button; restrict later if needed.
- Migration must run on prod before deploy (`prisma migrate deploy`) — the
  new FK cleans orphan `assignedToUserId` pointers first, and the enum value
  is additive.

## Previous Update

## Date

2026-07-17

## Branch

cody (Conductor workspace, targets main)

## Commit

see git log

## Task implemented

US section on Incoming RFQs, fed by the new US Meta lead sheet
("DERYA LEAD - USA CALIFORNIA", spreadsheet
`1wSZBm5iNbDWjml5ddMebULb7iLBKjs5vuX3U_5oC_Ic`).

- **Shared lead-sheet config**: new `src/lib/meta-leads.ts` declares both Meta
  Lead Ads sources (TR + US; same Meta export column layout) with env
  overrides `DERYA_META_LEADS_US_SHEET_ID/_TAB/_GID` (defaults: the sheet
  above, tab `ca leads`, gid 86480056 — the spreadsheet's gid-0 tab "Sayfa1"
  is header-only, and the sync now warns when a lead sheet reads zero data
  rows so a wrong tab/gid is never silent). Exports `US_LEAD_PARSED_MARKER`
  (`"market":"US"`) and `metaLeadMarketOf()` — nothing else writes a `market`
  key into inquiry parsedData.
- **Sync**: `syncMetaLeadRows` is parameterized by source and now loops over
  both sheets independently (one failing must not block the other; warnings
  are per-sheet). Rows gain `market` in parsedData, `Market`/`Job title` in
  the lead notes body, and US subjects read `US lead: …` (TR subjects
  unchanged). Sync summary gains `leadsUs`; the sync button reports
  "N TR leads · M US leads". The hourly `/api/google-sheets/sync` cron picks
  the US sheet up with no config change. Resync now also preserves the
  `whatsappSentAt` stamp (pre-existing bug: it preserved only
  deskForwardedAt/confirmationSentAt, so the hourly sync wiped the WA sent
  indicator).
- **/dashboard/rfq US view** (iterated same day per Mert's feedback — a
  chosen tab, not a default on-screen panel): the default view is the
  original single sheet minus US leads; a right-aligned `view-switcher`
  flag toggle ("🇹🇷 Türkiye" | "🇺🇸 US (n)") swaps to `?view=us`, which shows
  only US-market leads plus a "Lead sheet" external link in the page
  actions. Status tabs and ?q= search compose within either view (tab links
  carry `view`; the search bar preserves it by reading the query string at
  fire time). The default view's exclusion filter is null-safe
  (`parsedData: null` OR NOT contains) so manual RFQs with NULL parsedData
  stay visible. RfqSheet gained `emptyHint` (US view's empty-state copy +
  hides the New RFQ button); the interim `hideToolbar` prop was removed
  with the two-panel layout.
- **Lead quality triage** (`src/lib/lead-quality.ts`): deterministic score
  over what the lead form actually gives (contact channel and lane are
  gates; commercial intent, load size, timing, budget, company, commodity
  are points) → GOOD / REVIEW / WEAK with human-readable reasons. The US
  view defaults to Good only, with Good/Review/All chips (`?quality=`)
  showing counts; each lead row carries a colored quality pill (tooltip =
  score + reasons) and the expanded row lists "Lead quality" among the lead
  answers. Thresholds: GOOD ≥ 8, REVIEW ≥ 4 — plus the desk rules (Mert,
  2026-07-18): GOOD means business-significant. An explicitly commercial
  shipment ("yes, commercial…" / "evet, ticari…") is ALWAYS GOOD (only the
  contact/lane gates outrank it); a declared-individual shipment ("no,
  individual…" / "hayır, bireysel…") or a personal-effects move (household
  goods / belongings commodity) caps at REVIEW no matter the container
  size; "not sure"/blank answers rank on points so unlabelled importers can
  still reach GOOD. Dry-run over the real prod leads after both rules:
  71 leads → 16 GOOD / 52 REVIEW / 3 WEAK — the GOOD list is pure business
  freight; junk ("Isk → Idk", "national and international") gates to WEAK.
- **Smart lead email** (`src/lib/lead-emails.ts`, pure/testable; rfq-mail
  wraps it with SMTP config as `buildLeadCustomerEmail`, replacing
  `buildLeadConfirmationEmail`): when the lead's details are complete the
  email is the received-confirmation; when not, it asks for exactly the
  missing details — the question list comes from the same
  `leadMissingQuestions()` the WhatsApp draft uses (extracted from
  `buildWhatsAppInquiry`), EN for US leads / TR for TR leads. Each kind has
  its own send stamp (`confirmationSentAt` / new `infoRequestSentAt`, both
  resync-preserved), so sending the info-request doesn't mark the later
  confirmation as sent — once the lead's data is filled in, the card and
  button flip to the confirmation automatically. The sheet's Send column
  gained a per-row "Confirm" / "Ask info" button for lead rows (send column
  default width 120 → 176); the expanded card's title/hint follow the kind.
- **Market-aware outreach**: `buildLeadConfirmationEmail` sends English
  subject/body to US-market leads (Turkish copy unchanged for TR).
  `buildWhatsAppInquiry` drafts the whole message in English for US leads
  (greeting, missing-detail questions, subject phrase; en-US name casing so
  "igor" ≠ "İgor"). `waPhoneDigits` takes an optional market: US promotes
  bare 10-digit NANP numbers to `1…`; TR behavior is byte-identical.
  `sendWhatsAppInquiryAction` resolves digits with the same market so the
  Cloud API send matches the previewed wa.me link. Source chips read
  "Facebook lead · US" outside the panel.

## Files changed

`src/lib/meta-leads.ts` (new), `src/lib/google-sheets-sync.ts`,
`src/lib/inquiry-source.ts`, `src/lib/rfq-mail.ts`, `src/lib/rfq-whatsapp.ts`,
`src/app/dashboard/rfq/page.tsx`, `src/app/dashboard/rfq/actions.ts`,
`src/components/rfq-expandable-rows.tsx`,
`src/components/sync-google-sheet-button.tsx`,
`scripts/rfq-whatsapp.test.ts`, docs.

## Verification passed

next build clean; `test:rfq-whatsapp` (extended with US cases: English draft,
en-US casing, NANP phone promotion, country-only destination), new
`test:lead-quality` (gates, tier calibration on real-shaped fixtures,
company-fallback handling) and `test:lead-emails` (confirmation vs
info-request, EN/TR copy, email questions === WhatsApp questions),
`test:crm`, `check:docs`, `audit:tenant-scope` (baseline 9 findings, none
new) pass. Lint on touched files shows only the two pre-existing baseline
findings (rfq/new `<a>`, `_removed` unused). Full end-to-end run against a
scratch local Postgres and the REAL sheets (`.context/e2e-us-leads.ts`):
34 US + 63 TR leads created, market tags/subjects/DRY references/budget
bounds correct, spot-checked contact row incl. jobTitle and `+1` phone; the
page's two partition queries split 98 rows with no leakage and keep a
NULL-parsedData manual RFQ visible (confirmed naive NOT-contains DOES drop
NULL rows on Prisma 6 — the OR-null guard is load-bearing); resync created
no duplicates and preserved operator status + whatsappSentAt. The e2e is
also what caught the header-only gid-0 tab (hence the `ca leads`/86480056
default). Quality scorer dry-run against the live prod leads (read-only,
`.context/quality-dry-run.ts`): 42 leads → 18 GOOD / 21 REVIEW / 3 WEAK.

## Caveats

US leads only appear in the panel after the next sync stamps `market` into
parsedData (button or hourly cron; sourceKey dedupe means no duplicates if
rows were ever imported before). TR rows adopt the market tag on their next
resync — until then they are simply not in the US panel (correct either way).
Send-all-to-desk intentionally covers both markets (desk forward is internal
English). The lead sheet must stay link-viewable (or a service account /
`GOOGLE_SHEETS_API_KEY` configured) for the sync to read it.

## Previous Update

## Date

2026-07-07 (second update this date)

## Branch

rfq-bulk-select-status (Conductor workspace walla-walla, targets main)

## Commit

see git log

## Task implemented

Three features: Trash as a closed RFQ status, ⌘K app-wide search, RFQ page
search bar.

- **Trash status**: promoted from ad-hoc custom status to canonical TRASH in
  `src/lib/inquiry-status.ts` (INQUIRY_STATUSES + badge). Stored case variants
  "Trash"/"trash" alias via LEGACY_TO_CANONICAL (no backfill);
  CLOSED_INQUIRY_STATUSES gained TRASH/Trash/trash, so trashed rows leave the
  Open tab, the topbar pending count, Send-all-to-desk (which previously still
  emailed trashed meta-leads), agent tools, decision queue, merge/dedup and
  stale-RFQ nags — while keeping their own Trash tab. The incoming ?status=
  param is canonicalized on /dashboard/rfq so pre-promotion ?status=Trash links
  still land on the Trash tab. Pricing page STATUS_META + status select gained
  TRASH.
- **⌘K global search**: `src/components/command-palette.tsx` rewritten from
  jobs-only to grouped app-wide search backed by new server action
  `src/lib/global-search.ts` (loads, RFQs, companies, contacts, email threads;
  officeId-scoped; companies/contacts respect the same ownership scoping as
  /dashboard/search; Prisma `mode: "insensitive"`). Picking navigates: loads →
  /dashboard/jobs/[id] (middleware still sets the focus-job cookie, replacing
  the old focusJobAction flow), RFQs → /dashboard/rfq/[id],
  companies/contacts → /dashboard/crm?q= (no detail routes exist), threads →
  /dashboard/inbox?q=. `src/lib/job-search.ts` deleted (dead after the
  rewrite; removing it retires two now-unused live server-action endpoints).
  CRM page keys ContactSheet by q so a same-route ?q= navigation applies.
  The .cmdk-* classnames are load-bearing for later theme layers and were kept.
- **RFQ search bar**: /dashboard/rfq accepts ?q= (server-side insensitive OR
  over reference/subject/fromCompany/fromEmail/origin/destination/commodity,
  composed with the status tab; tabs carry q). Debounced RfqSearchBar in the
  sheet toolbar rewrites the URL, reading the rest of the query string at fire
  time; it re-syncs from the URL on external navigations unless focused. The
  empty state moved into RfqSheet so the bar stays visible at 0 results.
  Repeated ?q= params degrade instead of crashing (.trim on array).

## Files changed

`src/lib/inquiry-status.ts`, `src/lib/global-search.ts` (new),
`src/lib/job-search.ts` (deleted), `src/lib/job-focus.ts` (comment),
`src/components/command-palette.tsx`, `src/components/rfq-expandable-rows.tsx`,
`src/app/dashboard/rfq/page.tsx`, `src/app/dashboard/crm/page.tsx`,
`src/app/dashboard/pricing/page.tsx`, `src/app/dashboard/page.tsx` (⌘K hint),
`src/app/globals.css`.

## Verification passed

tsc clean; next build clean; test:rfq-whatsapp, test:strategy,
test:email-labels, test:rfq-load-draft pass; adversarial multi-agent review
over the diff — 11 confirmed findings all fixed (stale ?status=Trash links,
pricing TRASH label/option, CRM same-route pick no-op, palette reopen flash,
search-bar URL desync incl. back button and stale-status race, duplicate ?q=
crash, stale workbench ⌘K hint, dead job-search endpoints). DB-backed tests
skipped (no local DATABASE_URL).

## Caveats

Company/contact ⌘K picks deep-link into the CRM sheet's filter (no detail
routes exist). Email-thread picks land on inbox search by subject. The
/dashboard/search page itself was not touched (still companies/contacts/
activities only, case-sensitive) — the palette supersedes it. Trash rows on
the kanban: previously auto-created PROPOSED shell loads are not retracted
when an RFQ is trashed (pre-existing behavior, same as Ignored).

## Previous Update

## Date

2026-07-07

## Branch

rfq-bulk-select-status (Conductor workspace walla-walla, targets main)

## Commit

see git log

## Task implemented

RFQ sheet: Gmail-style multi-select + bulk status change, and per-user
column layout (hide / reorder / resize).

Column layout (second change in this set):

- The 10 data columns (Received … Send) can be hidden via a "Columns (N)"
  toolbar picker (same chrome as the Loads table), reordered by dragging a
  header onto another (drop indicator shows the landing edge), and resized by
  dragging a header's right edge (clamped 60–640px). "Reset layout" in the
  picker restores defaults. The select-checkbox and row-actions columns are
  fixed chrome.
- Layout persists to localStorage keyed per account:
  `derya.rfqSheet.layout.<userId>` — per user per browser, no schema change.
  Stored layouts are sanitized on load (unknown keys dropped, new columns
  appended, all-hidden falls back to all-visible, widths clamped).
- `.rfq-sheet` switched to `table-layout: fixed` so user widths are exact;
  cell content truncates with ellipsis instead of stretching columns (cell
  dropdown menus are position:fixed, so clipping cannot hide them);
  `min-width: 0` added to sheet inputs so they shrink in narrowed columns.
- Rows render cells by column key and are memoized (`MemoRowPair`) — header
  drag/resize only re-renders colgroup/thead, not the 200 rows.

Multi-select + bulk status change (first change in this set):

- Every sheet row gets a leading checkbox; the header checkbox selects/clears
  all visible rows (indeterminate when partially selected). Ticked rows are
  tinted (`tr.rfq-row-selected`); clicking the checkbox never toggles the
  row's expand panel.
- Selecting ≥1 row shows a sticky bulk bar (same `.bulk-action-bar` chrome as
  inbox triage): "N selected", one-click **Ignore**, a **Set status ▾**
  dropdown listing the full status vocabulary (canonical + office custom
  statuses), and **Clear**. Errors surface inline in the bar; selection is
  kept on failure, cleared on success.
- New server action `bulkUpdateInquiryStatusAction(ids, status)` in
  `src/app/dashboard/rfq/actions.ts`: office-scoped `updateMany`, same status
  normalization + reserved-name ("all"/"open") guard as the single-row edit,
  capped at 200 ids (the sheet's page size), records the same
  `inquiry.updated` memory event per row (operation `sheet_bulk_status`).
- Structural: the table markup (colgroup/thead) moved from
  `rfq/page.tsx` into the client component; `RfqExpandableRows` (tbody-only)
  became `RfqSheet` (full table + bulk bar). Selection is plain React state
  local to the sheet — deliberately NOT the shared `bulk-select-store`
  singleton, which would leak selections across inbox ⇄ RFQ pages. Stale ids
  (row left the filter after refresh) are pruned against visible rows before
  any action.

## Files changed

`src/app/dashboard/rfq/actions.ts` (new bulk action),
`src/app/dashboard/rfq/page.tsx` (renders RfqSheet with userId, table markup
removed), `src/components/rfq-expandable-rows.tsx` (column model + layout
persistence + header DnD/resize + Columns picker + RfqSheet + RfqBulkBar +
checkbox cells + memoized rows), `src/app/globals.css` (select column,
selected-row tint, fixed table layout + truncation, th drag/resize
affordances, picker reset row).

## Verification passed

tsc clean; next build clean; eslint — no new findings in touched files (the
two `<a href="/dashboard/rfq/new">` errors in rfq/page.tsx pre-exist on the
base commit, verified via stash). DB-backed tests skipped (no local
DATABASE_URL in this workspace).

## Caveats

Column layout is per user per browser (localStorage) — it does not roam
across devices; a DB-backed preference store would need a schema migration
(deliberately avoided). Header drag uses HTML5 DnD — mouse only, no touch or
keyboard reorder (hide/show via picker works everywhere). First paint uses
the default layout until the stored one loads (same flash the Loads table
has). Select-all covers the visible page only (query takes 200 newest). No
shift-click range selection. Bulk bar only changes status — bulk delete/send
deliberately out of scope.

## Previous Update

## Date

2026-07-06

## Branch

berlin (Conductor workspace, targets main)

## Commit

see git log

## Task implemented

RFQ page rebuilt as an inline-editable sheet + new status vocabulary + focused-load strip removed:

- The focused-load context strip ("FOCUSED DRY… · customer · route · status")
  no longer renders on any page; removed from `src/app/dashboard/layout.tsx`.
  The focus-cookie mechanism stays (dashboard workbench + ⌘K still use it);
  `src/components/hide-on-routes.tsx` deleted (strip was its only consumer).
- `/dashboard/rfq` cells now edit in place like the CRM sheet: subject,
  from company/email, origin → destination, mode, status, target price.
  Blur/Enter saves via `updateInquiryRowAction`; failed saves revert the cell
  and flash an inline error row. Per-row ✕ deletes (confirm dialog;
  status Ignored is the archive path). The chevron button expands load
  details as before.
- New RFQ status set (control-sheet lingo): BOOKED / PRICING / MISSED ($) /
  RECEIVED / IGNORED — `src/lib/inquiry-status.ts`. Legacy values alias onto
  it (INGESTED,PARSED→RECEIVED; PRICED,QUOTED→PRICING; WON→BOOKED;
  LOST→MISSED) so NO data backfill was needed; automations that still write
  legacy values keep working. "Open" = notIn {BOOKED,MISSED,IGNORED,WON,LOST};
  every open-inquiry predicate in the app now shares
  `openInquiryStatusFilter()`.
- Status and mode dropdowns support "Add option…" — a brand-new value typed
  in the cell becomes an option and a filter tab for the office (options and
  tabs are derived from values in use; Inquiry.status/mode are free strings,
  no migration).
- RFQ detail: field edits and AI parse no longer demote an operator-set
  status; "Mark Lost" is now "Mark Missed" (writes MISSED).

## Files changed

`src/lib/inquiry-status.ts` (new), `src/components/sheet-cells.tsx` (new —
CellInput/CellSelect extracted from contact-sheet, plus allowCreate),
`src/components/contact-sheet.tsx`, `src/components/rfq-expandable-rows.tsx`,
`src/app/dashboard/rfq/{page,actions}.tsx`,
`src/app/dashboard/rfq/[inquiryId]/{page,actions}.tsx`,
`src/app/dashboard/layout.tsx`, `src/app/globals.css`, open-filter swaps in
inbox/activity/domestic-pricing/pricing pages and
agent-chat/agent-tools/decision-queue/email-classifier/thread-actions/
merge-actions/setup-demo-actions/job-actions/rfq-mail/prewarm-summary/
morning-brief/market-tools/link-market-signals libs, plus
`scripts/market-doctor.ts`, `scripts/validate-office-import.ts`.

## Verification passed

tsc clean; next build clean; eslint no new errors; test:strategy,
test:rfq-load-draft, test:email-labels pass; adversarial multi-agent diff
review, confirmed findings fixed. No schema changes — safe to deploy without
migrations.

## Caveats

Legacy status values remain in the DB (aliases handle display/filtering).
Custom statuses/modes persist only while ≥1 row uses them. Dead job-focus-*
CSS left in globals.css. DB-backed tests skipped (no local DATABASE_URL).

## Previous Update

## Date

2026-07-04 (later same day)

## Branch

sidebar-rfq-crm-company-brain (not merged to main)

## Commit

see git log

## Task implemented

Sidebar IA rework + Company Brain page:

- Sidebar: Commercial Workflow is now Deal Desk, Incoming RFQs
  (`/dashboard/rfq`), Loads (`/dashboard/loads`), Pricing, CRM (renamed from
  Relationships, same route), Company Brain (`/dashboard/brain`). Domestic
  Rates and Intelligence are archived from the nav (routes stay reachable
  directly). Inbox moved to the bottom of the Setup section. Topbar chips:
  "active" now lands on /dashboard/loads, "RFQs" on /dashboard/rfq with a
  count matching that page's default Open tab (notIn WON/LOST).
- `/dashboard/rfq` is no longer a redirect to the inbox: it is a real
  Incoming RFQs list (Inquiry table, status filter tabs, links to detail,
  "Inbox triage" button keeps the thread view reachable).
- `/dashboard/loads` (new): dense spreadsheet-style list of all Jobs.
- `/dashboard/brain` (new): Company Brain. Default view is a full-page
  ChatGPT-style chat (`CompanyBrainChat`) on the existing `chatWithAgent`
  server action (same tools/memory as the Desk Assistant dock; dock hides
  itself only on this chat view). Quiet header switcher reveals secondary
  sections: To-dos (open Tasks via TaskListInline), Daily news (research
  feed + high-severity hotspots from `getIntelligenceMapData`, the 11:00 UTC
  cron output), Intelligence map (external logistics `WorldIntelligenceMap`;
  internal company map is a placeholder with memory-substrate counts).
- Merged local branch `intelligence-map-polish` (map geography polish);
  conflicts resolved keeping main's walnut-navy palette over the branch's
  teal/cyan colors while taking all structural changes.
- New shared `LinkRow` client component gives the two new server-rendered
  tables the full-row click navigation the `.data-row` styling promises.

## Files changed

- `src/app/dashboard/layout.tsx`, `src/app/dashboard/rfq/page.tsx`,
  `src/app/dashboard/loads/page.tsx` (new), `src/app/dashboard/brain/page.tsx`
  (new), `src/components/company-brain-chat.tsx` (new),
  `src/components/link-row.tsx` (new), `src/components/agent-chat-widget.tsx`,
  `src/app/globals.css`, label fixes in `src/app/dashboard/activity/page.tsx`,
  `src/app/dashboard/rfq/[inquiryId]/page.tsx`, `src/app/dashboard/rfq/new/page.tsx`,
  plus the intelligence-map-polish merge
  (`src/components/intelligence/*`, `src/lib/market-intelligence/intelligence-map.ts`,
  `src/app/dashboard/intelligence/page.tsx`, `scripts/intelligence-map.test.ts`).

## Verification passed

- `npx tsc --noEmit` clean, `npm run build` clean. No schema changes, no
  migrations, no new dependencies. Multi-agent adversarial review run; all
  confirmed findings fixed (chip/page count mismatch, brain-section dock
  suppression, dead evidence cues, job-focus-strip height, stale labels,
  truncation wording, table affordances).

## Caveats

- `npm run test:intelligence-map` not run locally (needs DATABASE_URL); its
  static source assertions were verified by grep after the merge.
- Company Brain chat is session-only (no persistence), like the dock.
- Internal company map is an explicit placeholder — configured later.

## Previous Update

## Date

2026-07-04

## Branch

crm-v1-review-and-push (pushed to main)

## Commit

see git log

## Task implemented

Email-code sign-in with founder allowlist:

- Sign-in now emails a 6-digit single-use code (10 min TTL, 5 verify
  attempts, 3 requests per 15 min) via the office's connected Gmail.
- Every sign-in path (code, collapsed password fallback, unused signup
  helper) rejects emails outside the allowlist: mert@usederya.com and
  oguzhan@usederya.com by default, LOGIN_ALLOWED_EMAILS to override.
- New LoginCode table (additive migration 20260704000100_login_email_codes,
  applied to production before deploy). Codes stored HMAC-hashed with
  AUTH_SECRET; the code email bypasses inbox persistence and CRM touches.
- Also this session: created the oguzhan@usederya.com ADMIN user in the
  Derya office (his Gmail account was already connected and syncing).

## Files changed

- `prisma/schema.prisma`, `prisma/migrations/20260704000100_login_email_codes/`
- `src/lib/login-code.ts` (new), `src/lib/auth.ts`, `src/app/login/page.tsx`
- `scripts/login-code.test.ts` (new), `package.json`

## Verification passed

- `npx tsc --noEmit`, `npm run test:crm` (3 suites), `npm run check:docs`,
  `npm run build`, migration applied to production before merge.

## Caveats

- Pentest sandbox and demo-office logins are intentionally dead (allowlist).
- If Gmail send breaks, use the "Use password instead" disclosure on /login.
- No change-password UI yet.

## Previous Update

## Date

2026-07-03 (later same day)

## Branch

crm-v1-review-and-push

## Commit

committed on crm-v1-review-and-push, stacked on 6dcd65c (see git log)

## Task implemented

CRM V1.1 — post-review hardening plus founder direction decisions:

- Fix pack: rank-correct priority/leverage sorting everywhere (string enums
  sort alphabetically in Postgres), contact + opportunity edit forms, working
  Follow-ups status filter with Done view and reopen, per-entity filter
  options, success/error notices on all CRM forms, active tab state, create
  flows on People/Opportunities/Follow-ups list pages, `nextActionAt` only
  moves earlier, removed the Relationships tab.
- Purged legacy `/dashboard/customers` and `/dashboard/pipeline` UI (code
  only; data stays), repointed 23 links across 13 files, added redirects,
  ported documents/owners/inbox-approval into the CRM pages. `crmStage` is
  the canonical lifecycle.
- Office book vs Network layer views derived from `crmCategory`.
- Inbox → CRM touch integration: `EmailThread.companyId/contactId`
  (migration `20260703010000_email_crm_touch`), resolver + EMAIL Activity
  logging hooked into gmail-sync, gmail-send, and thread linking; forward-only
  `lastTouchAt` bumps; `npm run backfill:crm-email` for history.
- RFQ-created opportunities populate `sourceRefs`; agent suggestion
  dismissals persist as `AgentProposal` audit rows (kind `CRM_SUGGESTION`).

## Files changed

- `src/lib/crm/*`, `src/components/crm/*`, `src/app/dashboard/crm/**`
- `src/lib/crm/email-touch.ts` (new), `src/lib/gmail-sync.ts`,
  `src/lib/gmail-send.ts`, `src/lib/thread-actions.ts`
- `prisma/schema.prisma`,
  `prisma/migrations/20260703010000_email_crm_touch/migration.sql`
- deleted `src/app/dashboard/customers/**`, `src/app/dashboard/pipeline/**`,
  `src/components/unified-crm-workspace.tsx`,
  `src/components/pipeline-board.tsx`
- link repoints: `layout.tsx`, jobs/admin/reports/search pages,
  activity-feed, customer-popover, notification-bell, task-list-inline,
  pending-quotes-inline, decision-queue, agent-actions
- `next.config.ts` (redirects), `src/app/globals.css`, `package.json`
- `scripts/backfill-crm-email-touch.ts`, `scripts/crm-email-touch.test.ts`

## Verification passed

- `npx prisma validate`, `npm run db:generate`
- `npx tsc --noEmit` clean
- `npm run test:crm` (both suites)
- `npm run audit:tenant-scope` — only the pre-existing medium finding at
  `src/lib/rfq-load-review.ts:265`
- Full migration chain replayed on a scratch Postgres;
  `prisma migrate diff` reported no drift
- `npm run build`

## Caveats

- Deploy ordering is mandatory: run `npx prisma migrate deploy` against the
  production database BEFORE the code deploys (two pending migrations:
  `20260703000100_internal_crm_relationship_os`,
  `20260703010000_email_crm_touch`). The Vercel build does not run
  migrations.
- After deploy, run `npm run backfill:crm-email` once against production.
- Legacy `Company.status` has no editing surface anymore; reports/search
  still read legacy fields.

## Previous Update

## Date

2026-07-03

## Branch

feature/internal-crm-v1

## Commit

not committed

## Task implemented

Internal CRM / Relationship OS V1:

- Added `PRODUCT_CRM_IMPLEMENTATION_PLAN.md` before implementation.
- Reused `Company` and `Contact` as canonical CRM account/person truth.
- Added additive relationship metadata to `Company`, `Contact`, `Activity`,
  and `Task`.
- Added `CrmOpportunity` for non-load/RFQ relationship opportunities.
- Added `/dashboard/crm` command center plus companies, people,
  opportunities, tasks, relationships, and detail pages.
- Added server-side CRM data helpers/actions with explicit `officeId` and
  owner scoping.
- Added CRM Brain Context panels backed by existing customer dossier and
  operational brain search.
- Added RFQ detail CRM context and RFQ-linked opportunity creation.
- Kept V1 internal-only: no email sending, Slack posting, Gmail mutation,
  booking, tendering, payment, provider API call, or quote commitment.

## Files changed

- `PRODUCT_CRM_IMPLEMENTATION_PLAN.md`
- `PRODUCT_CRM_V1_MANUAL_TEST_GUIDE.md`
- `PRODUCT_CRM_V1_PR_SUMMARY.md`
- `prisma/schema.prisma`
- `prisma/migrations/20260703000100_internal_crm_relationship_os/migration.sql`
- `src/lib/crm/*`
- `src/components/crm/crm-components.tsx`
- `src/app/dashboard/crm/**`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `src/app/dashboard/layout.tsx`
- `src/app/globals.css`
- `scripts/crm-relationship-os.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`

## Verification passed

- `npx prisma validate`
- `npm run db:generate`
- `npm run test:crm`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run audit:tenant-scope` passed in non-strict mode with only one
  pre-existing medium finding in `src/lib/rfq-load-review.ts`.
- `npm run build`

## Caveats

- Contacts remain company-scoped in V1.
- Live GBrain retrieval is not called from browser/client code.
- CRM-specific persisted agent proposals are not implemented yet; suggestions
  are derived from stale tasks/RFQs/relationships.
- Brain workspace root `/Users/mert/derya-ai-brain-setup` is not a git repo,
  so those docs were updated in place and not committed there.

## Previous Update

## Date

2026-07-01

## Branch

main

## Commit

not committed

## Task implemented

Production pentest account repair:

- Reproduced the production login failure against
  `https://derya-crm.vercel.app/login`: posting
  `pentest@derya-pentest.invalid / PentestDemo!2026` returned `303` to
  `/login?error=1`.
- Confirmed production `/api/health` was already on commit `3ecdd12`, so the
  root cause was production database state, not stale deployed code.
- Made `scripts/create-pentest-demo-account.ts` import-safe and exported an
  idempotent `ensurePentestDemoSeed` helper for server routes.
- Added `GET/POST /api/cron/pentest-demo`, protected by the existing
  `CRON_SECRET` pattern, to verify or repair the pentest sandbox and remove
  legacy `admin@demo.local` rows in the target database.
- Added the route to Vercel cron every 5 minutes so production can repair the
  sandbox with its own configured database and cron secret.

## Files changed

- `scripts/create-pentest-demo-account.ts`
- `src/app/api/cron/pentest-demo/route.ts`
- `vercel.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`

## Verification passed

- Production health check showed `VERCEL_GIT_COMMIT_SHA=3ecdd12` and DB ping
  healthy before this fix.
- Production login POST reproduced the invalid-credentials redirect before this
  fix.
- `npm run test:pentest-demo`
- `npm run test:demo-admin-removed`
- `npx tsc --noEmit`
- `node -e 'JSON.parse(require("fs").readFileSync("vercel.json","utf8"))'`
- `npx tsx -e '...'` import smoke for `ensurePentestDemoSeed`
- `npx tsx -e '...'` route smoke: missing cron secret returns `401`
- `npx tsx -e '...'` route smoke: valid cron bearer verifies the sandbox
- `npm run check:docs`
- `npm run build`
- Deployed commit `12a6243` reached production.
- After the Vercel cron ran, production login with
  `pentest@derya-pentest.invalid / PentestDemo!2026` returned `303` to
  `/dashboard`, and authenticated `/dashboard` returned `200`.
- Production login with `admin@demo.local / admin1234` still returned `303` to
  `/login?error=1`.
- Production `/signup` returned `404`.

## Caveats

- If the production DB is reset or the sandbox is damaged later, the cron route
  should repair it on the next 5-minute run.
- The route intentionally returns whether the password source is the default or
  `PENTEST_DEMO_PASSWORD`, but never returns a secret env password value.

## Previous Update

## Date

2026-07-01

## Branch

main

## Commit

not committed

## Task implemented

Login hardening for internal pentest access:

- Removed the public login footer that linked to `Create your office` and
  advertised `admin@demo.local / admin1234` sample access.
- Removed the public `/signup` page so testers cannot create arbitrary offices
  by guessing the route.
- Updated `seed:pentest-demo` so each `--apply` resets the pentest password to
  `PENTEST_DEMO_PASSWORD` when set, otherwise the documented default
  `PentestDemo!2026`.
- Added `cleanup:demo-admin` and `test:demo-admin-removed` for deleting and
  verifying removal of the legacy `admin@demo.local` account.
- Updated older demo seed scripts so they do not depend on
  `admin@demo.local`, and changed `prisma/seed.ts` so it no longer recreates
  that legacy account.
- Applied both local database operations: reset the pentest account password and
  deleted one `admin@demo.local` user from `Istanbul Office`.

## Files changed

- `src/app/login/page.tsx`
- `src/app/signup/page.tsx`
- `scripts/create-pentest-demo-account.ts`
- `scripts/remove-demo-admin-account.ts`
- `scripts/reset-video-demo-loads.ts`
- `scripts/seed-giresun-workflow-load.ts`
- `scripts/seed-map-example-loads.ts`
- `prisma/seed.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`

## Verification passed

- `npm run seed:pentest-demo -- --apply`
- `npm run cleanup:demo-admin`
- `npm run cleanup:demo-admin -- --apply`
- `npm run test:pentest-demo`
- `npm run test:demo-admin-removed`
- `npm run check:docs`
- `npm run build`
- `npx tsc --noEmit`

## Caveats

- These database operations were applied only to the configured local
  `DATABASE_URL`. Apply the same commands against any preview/staging database
  that pentesters actually use.
- The first `npx tsc --noEmit` run after deleting `/signup` hit stale
  generated `.next/types/app/signup` files. `npm run build` regenerated Next
  types and the rerun passed.

## Previous Update

## Date

2026-07-01

## Branch

main

## Commit

not committed

## Task implemented

Pentest demo sandbox account:

- Added `npm run seed:pentest-demo`, a dry-run-by-default seed command for a
  separate `Pentest Sandbox Office` tenant.
- The seed creates one ADMIN sandbox user, one synthetic customer/contact, one
  active RFQ/load, carrier quotes, email threads/messages, target-price
  history, documents, milestones, lane/margin reference data, memory objects,
  memory events, and a persisted commercial strategy assessment.
- The seed intentionally creates no OAuth tokens, provider credentials, live
  email send state, imported production data, or real customer/supplier facts.
- Default login is `pentest@derya-pentest.invalid` with password
  `PentestDemo!2026`, unless `PENTEST_DEMO_PASSWORD` is set.
- Added `npm run test:pentest-demo` to verify the account, tenant isolation,
  no OAuth tokens, seeded job graph, memory search, customer dossier, and
  strategy guardrail.

## Files changed

- `scripts/create-pentest-demo-account.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run seed:pentest-demo`
- `npx tsc --noEmit`
- `npm run seed:pentest-demo -- --apply`
- `npm run seed:pentest-demo -- --apply` idempotent rerun
- `npm run test:pentest-demo`

## Caveats

- Local seed was applied to the configured local database only.
- The smoke test verifies the deterministic data, memory, and commercial
  strategy surfaces the agent relies on. Browser chat with the LLM still
  requires a runtime `ANTHROPIC_API_KEY` and was not browser-clicked here.

## Previous Update

## Date

2026-06-30

## Branch

main

## Commit

not committed

## Task implemented

Giresun to Ancona workflow load seed:

- Added an idempotent seed command for a real-looking, near-complete Avlia Home
  Giresun, Turkey to Ancona, Italy sea-FCL load.
- The seed creates the approved customer/contact, RFQ inquiry, booked job,
  inbox-linked email threads, three forwarder rate replies, customer acceptance,
  quote lines, target-price history, milestones, and six document records with
  generated PDF data URLs and AI extraction summaries.
- The command is dry-run by default. Use `npm run seed:giresun-workflow -- --apply
  --create-seed-inbox` for a first local write, and add `--reset` to replace the
  existing seeded copy.
- Added `POST /api/admin/seed-giresun-workflow`, ADMIN-only and office-scoped,
  so production can create/find the same completed copy after deployment.
- Fixed the focused dashboard quote display to read `Job.quoteLines` through
  `parseQuoteLines`, matching the job page and quote PDF behavior.

## Files changed

- `src/app/dashboard/page.tsx`
- `src/app/api/admin/seed-giresun-workflow/route.ts`
- `scripts/seed-giresun-workflow-load.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run seed:giresun-workflow`
- `npm run seed:giresun-workflow -- --apply --create-seed-inbox`
- Prisma verification of the seeded job, threads/messages, quotes, documents,
  milestones, and target-price history
- `npm run test:workbench-route-map`
- `npm run test:route-map`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`

## Caveats

- The seed creates generated PDFs for walkthrough data; they are not legal
  shipment documents.
- Browser-authenticated visual QA was not run in this session.

## Previous Update

## Date

2026-06-30

## Branch

main

## Commit

not committed

## Task implemented

Focused load cockpit and route-map correction:

- Moved route lookup and route-leg construction into
  `src/lib/workbench-route-map.ts`.
- Added explicit Giresun, Ancona, Shenzhen, Berlin, and Guadalajara geography,
  plus Black Sea to Adriatic sea waypoints through Bosphorus, Dardanelles, and
  Adriatic approach.
- Removed the global control-sheet decision queue and reference-deal snapshot
  from the focused `/dashboard` load view.
- Added `/dashboard?view=overview` as the explicit top-down dashboard for
  global queue/control-sheet work, with a link back to the focused load view.
- Added a load-specific workflow panel so the focused page explains the
  RFQ -> qualification -> forwarder pricing -> quote/documents walkthrough
  for the selected load rather than leaking unrelated office-wide work.

## Files changed

- `src/app/dashboard/page.tsx`
- `src/app/globals.css`
- `src/lib/workbench-route-map.ts`
- `scripts/workbench-route-map.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:workbench-route-map`
- `npm run test:route-map`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`

## Caveats

- Browser-authenticated visual QA was not run before this handoff.

## Previous Update

## Date

2026-06-30

## Branch

main

## Commit

not committed

## Task implemented

Inbox RFQ-to-load pipeline, video-demo inbox records, and Today fast lane:

- Added a `Today RFQs` path: `/dashboard/inbox?filter=_TODAY&view=rfqs`
  now filters the RFQ table, not just the thread list.
- Added `rfq@usederya.com` as the default deterministic RFQ source sender via
  `DERYA_RFQ_SOURCE_EMAILS`. Inbound mail from that address is classified as
  RFQ before LLM classification and counts as load/RFQ work in Inbox filters.
- Added a reviewed RFQ-to-load creation modal from Inbox RFQs and RFQ detail.
  Operators can edit fields before creating a load, and carried-forward
  customer history is marked as prior-load context rather than email truth.
- Added deterministic prior-load autofill for missing route, cargo, and service
  fields while intentionally excluding prior target price carry-forward.
- Created a reproducible video-demo reset script and disabled the old visible
  fake demo seed paths.
- Added an Inbox `Today` filter and default Today section using
  `lastMessageAt`, plus a `Sync Derya inboxes` button in the Inbox header.

## Files changed

- `src/lib/rfq-load-draft-core.ts`
- `src/lib/rfq-load-review.ts`
- `src/lib/rfq-promote.ts`
- `src/components/rfq-load-review-button.tsx`
- `src/components/rfq-row-actions.tsx`
- `src/components/create-inquiry-button.tsx`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `src/app/dashboard/rfq/[inquiryId]/actions.ts`
- `src/app/dashboard/inbox/page.tsx`
- `src/app/globals.css`
- `src/lib/derya-inboxes.ts`
- `src/lib/email-classifier.ts`
- `src/lib/thread-actions.ts`
- `scripts/email-classifier.test.ts`
- `scripts/email-workflow-labels.test.ts`
- `scripts/rfq-load-draft.test.ts`
- `scripts/reset-video-demo-loads.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:rfq-load-draft`
- `npm run test:email-classifier`
- `npm run test:email-labels`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`

## Caveats

- Browser-authenticated click-through was not run from this session.
- Production Gmail cron could not be manually triggered from local because the
  local `CRON_SECRET` did not match production; Vercel cron remains the
  production scheduler after deploy.

## Previous Update

## Date

2026-06-30

## Branch

codex/domestic-pricing-us-loadboard-20260630

## Commit

not committed

## Task implemented

US-only domestic loadboard correction:

- Tightened domestic trucking eligibility so V1 is US pickup to US delivery
  only. Road moves outside the United States are now suppressed instead of
  labeled domestic.
- Added explicit market scope (`US_DOMESTIC`, `NON_US`, `UNKNOWN`) and US
  location checks for city/state/ZIP, known US cities, state names/codes, and
  generic `USA` blockers.
- Reworked `/dashboard/domestic-pricing` into a loadboard-style first screen
  with status, lane, equipment, pickup, weight, spot estimate, blockers, and
  selected-RFQ navigation.
- Added a selected-lane map panel using OpenStreetMap route tiles when both
  endpoints resolve to US locations.
- Added an in-product `Blocking real data` panel explaining that live data is
  blocked by US lane quality, provider contracts/credentials, missing shipment
  facts, and approval/audit persistence.

## Files changed

- `src/lib/domestic-trucking-pricing.ts`
- `src/app/dashboard/domestic-pricing/page.tsx`
- `src/app/globals.css`
- `scripts/domestic-trucking-pricing.test.ts`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsx scripts/domestic-trucking-pricing.test.ts`
- `npx tsc --noEmit`
- `npm run check:docs`
- `DATABASE_URL='postgresql://local:local@127.0.0.1:5432/derya_crm_dummy' npm run build`

## Caveats

- The map uses deterministic known-city/state/ZIP matching, not a geocoder.
  Ambiguous city-only locations outside the small known-city table stay blocked
  until a US state or ZIP is present.
- Live loadboard/provider data is still not connected. V1 remains mock/manual
  and draft-only.

## Previous Update

## Date

2026-06-30

## Branch

codex/domestic-pricing-live-20260630

## Commit

not committed

## Task implemented

Domestic trucking instant pricing V1:

- Added `/dashboard/domestic-pricing` and linked it from the dashboard sidebar
  as `Domestic Rates`.
- Added a compact RFQ detail panel with required-field blockers, provider
  readiness, simulated rate options, draft quote economics, and approval
  warnings.
- Added deterministic domestic pricing domain logic for normalized truck rate
  requests, mock/manual providers, quote drafts, and brain-context placeholders.
- Kept V1 quote-only: no live provider calls, credential reads, customer sends,
  bookings, tenders, database schema changes, or canonical brain writes.

## Files changed

- `src/lib/domestic-trucking-pricing.ts`
- `src/components/domestic-trucking-rate-panel.tsx`
- `src/app/dashboard/domestic-pricing/page.tsx`
- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `src/app/globals.css`
- `scripts/domestic-trucking-pricing.test.ts`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsx scripts/domestic-trucking-pricing.test.ts`
- `npx tsc --noEmit`
- `npm run check:docs`
- `DATABASE_URL='postgresql://local:local@127.0.0.1:5432/derya_crm_dummy' npm run build`

## Caveats

- Provider and GBrain integrations are intentionally stubs. This branch makes
  the wedge visible on the app, not a live carrier-rating system.

## Previous Update

## Date

2026-06-29

## Branch

main

## Commit

not committed

## Task implemented

Vercel Pro hourly Gmail scheduling:

- Switched `/api/cron/gmail-sync` to Vercel hourly cron now that the project is
  on Vercel Pro.
- Switched `/api/cron/background-jobs` to run hourly five minutes after Gmail
  sync, so queued historical Gmail backfill windows drain without waiting for
  the old daily fallback.
- Removed the GitHub Actions hourly Gmail scheduler. Vercel is now the single
  scheduler for production Gmail refresh, which avoids duplicate sync runs.

## Files changed

- `vercel.json`
- `.github/workflows/hourly-gmail-sync.yml`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run check:docs`
- `npx tsc --noEmit`
- `npm run build`

## Caveats

- No live cron run was manually triggered from this agent session. Vercel will
  run the hourly schedules after deployment.

## Previous Update

## Date

2026-06-29

## Branch

main

## Commit

not committed

## Task implemented

App-wide palette discipline and Intelligence map visual cleanup:

- Revamped the active visual system around walnut, navy, white, and light
  gray-blue surfaces.
- Added a final palette discipline layer so pricing, decision, status, setup,
  and strategy widgets stop falling back to amber/tan/pink/bright-green fills.
- Restricted red/green usage to calm maroon/dark-green text, borders, and
  narrow left-edge accents for genuinely blocked/ready states.
- Updated active sidebar/page controls so selected chips and mode buttons use
  navy with white text instead of beige/brown active fills.
- Recolored the Intelligence world map, hotspots, legend, reference ports, and
  entity badges away from bright teal/orange/red/green.
- Fixed the Intelligence map SVG sizing bug that made the map appear as a
  mostly blank dark panel by forcing the Natural Earth map to render at its
  2:1 aspect ratio.
- Fixed the Intelligence hotspot duplicate evidence-key warning that surfaced
  as a visible dev overlay issue badge.
- Replaced loud success fallbacks in small inline components with the dark
  green/white semantic palette.

## Files changed

- `src/app/globals.css`
- `src/components/intelligence/world-intelligence-map.tsx`
- `src/components/intelligence/world-map-base.tsx`
- `src/components/intelligence/intelligence-hotspot-panel.tsx`
- `src/components/intelligence/intelligence-visual-icons.tsx`
- `src/components/pending-quotes-inline.tsx`
- `src/components/status-badge-toggle.tsx`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`
- Source sweep for disallowed bright palette tokens in `src/app`,
  `src/components`, and `src/lib`
- Browser smoke login with `admin@demo.local / admin1234`
- Desktop screenshots at 1440x900 for Pricing, Intelligence, and Email
  Settings
- Strict computed-color audit across `/dashboard`, `/dashboard/inbox`,
  `/dashboard/pricing`, `/dashboard/intelligence`, `/dashboard/customers`,
  `/dashboard/settings/email`, `/dashboard/admin`, `/dashboard/jobs`,
  `/dashboard/reports`, and `/dashboard/activity`: no warm tan/orange panels or
  loud red/green semantic fills detected.

## Caveats

- The CSS file still contains older overridden theme layers. This change adds a
  final discipline layer and patches high-risk inline/component colors. A later
  cleanup pass should delete the obsolete layers instead of continuing to stack
  overrides.
- During visual QA, the local Next dev cache corrupted under repeated hot reload
  and browser passes. Only generated `.next` output was cleared before starting
  a fresh dev server.

## Previous Update

## Date

2026-06-29

## Branch

main

## Commit

not committed

## Task implemented

Gmail historical sync and hourly refresh hardening:

- Changed Gmail sync from one newest-page yearly scan to a two-lane flow:
  recent sync runs immediately, while historical sync is queued as monthly
  backfill windows for the last five years.
- Added `GMAIL_SYNC_WINDOW` background jobs so older Gmail threads are pulled
  progressively instead of depending on one large web request.
- Manual per-account sync and combined Derya inbox sync now enqueue historical
  backfill windows and report how many windows were queued.
- Hourly production refresh is configured through a GitHub Actions scheduler
  that calls the protected Gmail sync and background drain endpoints with
  `CRON_SECRET`. Vercel cron remains daily as a fallback because the current
  Vercel Hobby plan rejects hourly cron expressions.
- Post-sync AI automation is scoped to touched threads for recent/windowed
  syncs, so old backfill jobs do not repeatedly run AI over every unlinked
  thread in the office.

## Files changed

- `src/lib/gmail-sync.ts`
- `src/lib/gmail-sync-windows.ts`
- `src/lib/background-jobs.ts`
- `src/app/api/cron/background-jobs/route.ts`
- `src/app/dashboard/settings/email/page.tsx`
- `src/components/sync-account-button.tsx`
- `src/components/sync-derya-inboxes-button.tsx`
- `scripts/gmail-sync-windows.test.ts`
- `.github/workflows/hourly-gmail-sync.yml`
- `package.json`
- `vercel.json`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:gmail-sync-windows`
- `npm run test:gmail-oauth`
- `npm run test:email-labels`
- `npx tsc --noEmit`
- `npm run build`

## Caveats

- No live Gmail sync was run from this agent session. The next manual sync will
  enqueue historical window jobs; the hourly background cron then drains them.
- The GitHub Actions scheduler requires a repository secret named
  `CRON_SECRET` with the same value as production. If that secret is absent,
  the workflow will fail closed instead of running unauthenticated.

## Previous Update

## Date

2026-06-29

## Branch

main

## Commit

not committed

## Task implemented

Follow-up layout correction after visual QA:

- Fixed the dashboard agent suppression bug. `/dashboard` now suppresses the
  global agent only when an embedded workbench agent actually exists; empty or
  queue-only dashboard states fall back to the full-height global right dock.
- Tightened the collapsed-agent layout contract across sidebar routes. When the
  global agent is inactive, page content and cards fill the available width
  instead of leaving a reserved right-side gap.
- Fixed dashboard workbench padding so the embedded agent only reserves width
  while expanded; its collapsed state returns workbench padding to `0px`.
- Reworked the assistant header copy to the requested simple stack: `Agent`,
  `Desk Assistant`, `RFQs, target price, forwarder replies`.
- Replaced the text-heavy hide control with a visible `x` icon and made send
  arrows/close icons visibly white inside their buttons.
- Forced sidebar navigation icons to white in collapsed, hover, and active
  states.
- Calmed the decision queue surfaces: blocked proof/contract/action sections
  now stay white and use maroon only for the left warning edge and small labels,
  rather than filling whole panels with red/pink.
- Removed inline pink/green/beige fills from email setup gate rows; the rows are
  now white with status carried by the left edge and status text.

## Files changed

- `src/app/dashboard/settings/email/page.tsx`
- `src/app/globals.css`
- `src/components/agent-chat-widget.tsx`
- `src/components/job-conversation-panel.tsx`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`
- Local dev server at `http://localhost:3001`
- Browser smoke login with `admin@demo.local / admin1234`
- Desktop email settings at 1440x900: global agent open measured full viewport
  height with right dock width `461px`; after collapse, content margin-right was
  `0px`, page container width was `1382px`, and visible cards expanded to
  `1322px`.
- Desktop dashboard at 1440x900: embedded workbench agent open reserved
  `478.8px`; after clicking the `x`, workbench padding-right returned to `0px`
  and visible workbench cards expanded from `843px` to `1322px`.
- Dashboard fallback check: after removing the embedded workbench agent in the
  browser, the global agent appeared on `/dashboard`, set `agent-dock-open`, and
  measured full viewport height.
- Collapsed sidebar-route sweep for Inbox, Pricing, Intelligence, CRM, Email,
  and Admin: content margin-right stayed `0px`, page containers measured
  `1382px`, launcher overlay was present, and horizontal overflow stayed `0`.
- Color checks: sidebar icon computed color was white; blocked decision queue
  surface computed white with maroon inset edge; email setup gate computed white
  with maroon left edge.

## Caveats

- The current dev data has a focused workbench job, so the real dashboard empty
  state was verified by DOM-removing the embedded workbench agent and letting
  the new fallback observer take over. That is enough for this UI regression,
  but a seeded no-job fixture would be cleaner.
- This was a layout/color pass only. No schema migration, dependency change,
  live Gmail sync, or external ingestion was run.

## Previous Update

## Date

2026-06-29

## Branch

main

## Commit

not committed

## Task implemented

Workbench and global shell layout cleanup:

- Removed the manual sidebar toggle button. The desktop sidebar is now a narrow
  rail that expands on hover/focus and collapses back automatically.
- Reworked the global agent into a full-height right-side dock on non-workbench
  pages. It reserves width only while open; when collapsed, the page expands
  back into the available space and the launcher overlays the page.
- Reworked the dashboard workbench agent into a full-height right-side panel
  from the top of the viewport to the bottom. Its collapsed state returns the
  right-side width to the workbench and leaves only a compact overlay launcher.
- Added an authoritative walnut/navy/light blue/white visual layer with calm
  maroon and dark green semantic colors. This tones down the old bright red,
  bright green, tan, orange, and mixed-brown surfaces.
- Recolored the Gmail connect mark away from Google red and moved setup/status
  gate colors onto the shared app tokens.
- Toned down hard-coded Intelligence page source/control/map colors so they no
  longer fight the primary Derya palette.
- Fixed mobile overflow in the email settings WhatsApp environment grid.

## Files changed

- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/settings/email/page.tsx`
- `src/app/globals.css`
- `src/components/agent-chat-widget.tsx`
- `src/components/intelligence/intelligence-source-card.tsx`
- `src/components/intelligence/manual-market-ingestion-controls.tsx`
- `src/components/intelligence/world-intelligence-map.tsx`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsc --noEmit`
- Local dev server at `http://localhost:3001`
- Browser smoke login with `admin@demo.local / admin1234`
- Desktop dashboard check at 1440x900: sidebar rail measured 58px collapsed and
  236px on hover; embedded workbench agent measured full viewport height; after
  collapsing the agent, workbench padding-right returned to `0px`.
- Desktop email settings check at 1440x900: global agent measured full viewport
  height on the right; after collapsing it, page content expanded to the full
  available width with no reserved right gap.
- Mobile email settings check at 390x844: global agent fit the viewport and the
  page had no horizontal overflow after the environment-grid fix.

## Caveats

- The stylesheet still contains older legacy color layers below the app history.
  The new final layer is authoritative for the current UI, but a later cleanup
  pass should delete dead overridden CSS instead of letting the file keep
  accumulating sediment.
- Local Gmail OAuth env was not configured, so the real Gmail OAuth button did
  not render in the smoke session. The source no longer uses the red Google
  mark.
- No schema migration, dependency change, production build, live Gmail sync, or
  live external ingestion was run.

## Previous Update

## Date

2026-06-28

## Branch

main

## Commit

not committed

## Task implemented

Production Gmail OAuth redirect hardening:

- Added redirect URI normalization so a malformed env value pasted as
  `GOOGLE_REDIRECT_URI=https://...` is stripped before constructing the Google
  OAuth URL.
- Gmail OAuth start now prefers the current request origin for the callback
  URI, and the callback token exchange uses the callback request origin. This
  keeps `https://www.derya.ai` flows on `www` instead of losing the session on
  the apex domain.
- Added a public health diagnostic that reports the sanitized redirect URI plus
  whether the raw env still has the accidental `GOOGLE_REDIRECT_URI=` prefix.
- Added a focused config test covering the env-key prefix and quoted URL cases.

## Files changed

- `src/lib/gmail-oauth.ts`
- `src/app/api/auth/gmail/start/route.ts`
- `src/app/api/auth/gmail/callback/route.ts`
- `src/app/api/health/route.ts`
- `scripts/gmail-oauth-config.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:gmail-oauth`
- `npm run test:email-labels`
- `npx tsc --noEmit`
- `npm run build`

## Caveats

- This is a defensive app-side guard. Production should still fix the Vercel
  value for `GOOGLE_REDIRECT_URI` so the value is only the callback URL, not
  `GOOGLE_REDIRECT_URI=<url>`.
- The Google Cloud OAuth Web Client must contain the exact callback URL for
  each host operators use, especially
  `https://www.derya.ai/api/auth/gmail/callback`.

## Previous Update

## Date

2026-06-28

## Branch

main

## Commit

not committed

## Task implemented

Native Derya load/RFQ inbox setup for `mert@usederya.com` and
`oguzhan@usederya.com`:

- Added a shared Derya inbox manifest for the two expected Gmail accounts.
- The expected native inbox list defaults to `mert@usederya.com` and
  `oguzhan@usederya.com`, and can be extended in prod with
  `DERYA_LOAD_RFQ_INBOXES=addr1,addr2,addr3` without changing code.
- Added deterministic `load/*` workflow labels for synced mail:
  `load/rfq`, `load/customer`, `load/forwarder`, `load/note`,
  `load/linked`, and `load/related`.
- Gmail OAuth start now supports account-selection plus a `login_hint` for the
  targeted Derya inbox rows, so connecting the second Google account is less
  error-prone.
- Gmail sync still sweeps the last year and now excludes spam/trash explicitly.
  It stores safe workflow labels and Derya inbox metadata in the Company Brain
  email message payload/provenance without changing schema or writing secrets.
- `/dashboard/settings/email` now shows Mert and Oguzhan as first-class
  load/RFQ inboxes with connected/paused/missing status, per-account sync, and
  a combined `Sync Derya inboxes` action.
- `/dashboard/inbox` now warns when either Derya inbox is missing, adds a
  `Load/RFQ` filter, and shows `load/*` labels on thread rows and expanded
  messages.

## Files changed

- `src/lib/derya-inboxes.ts`
- `src/lib/email-workflow-labels.ts`
- `src/lib/gmail-oauth.ts`
- `src/lib/gmail-sync.ts`
- `src/app/api/auth/gmail/start/route.ts`
- `src/app/dashboard/settings/email/page.tsx`
- `src/app/dashboard/inbox/page.tsx`
- `src/components/sync-derya-inboxes-button.tsx`
- `src/components/thread-accordion.tsx`
- `src/app/globals.css`
- `scripts/email-workflow-labels.test.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npm run test:email-labels`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run test:brain`
- Local dev smoke at `http://localhost:3000`: `/dashboard/inbox` and
  `/dashboard/settings/email` redirect unauthenticated users to `/login`;
  `/api/auth/gmail/start?email=mert@usederya.com` now also redirects to
  `/login` instead of catching the auth redirect as a 500.

## Caveats

- I did not and cannot silently connect real Gmail accounts. Each account must
  complete Google OAuth consent from `/dashboard/settings/email`.
- Production should set `DERYA_LOAD_RFQ_INBOXES` before onboarding extra
  required inboxes beyond Mert/Oguzhan.
- No Gmail labels are modified in Google. The `load/*` labels are native Derya
  workflow labels derived from classifier/link state and stored in Derya memory
  payloads.
- No schema migration was added.

## Previous Update

## Date

2026-06-28

## Branch

main

## Commit

not committed

## Task implemented

Workbench visual refresh follow-up requested by founder:

- Reworked the dashboard topbar brand lockup to show `Derya Deal Desk` with
  `Freight Control Tower` subtitle.
- Added a route summary strip above the focused deal map with origin,
  destination, country flags, ETD/ETA, mode, and transit timing.
- Added a real map-backed route panel to the focused deal brief using full-world
  OpenStreetMap raster tiles, dynamic origin/destination markers, country flags
  for recognized ports/cities, sea-route waypoints, mode chip, attribution, and
  three zoomed route sections for long lanes.
- Replaced the static overview map with `src/lib/route-map-viewport.ts`, a
  shared Web Mercator viewport builder. Overview tiles, route line, markers,
  and zoom panels now come from the same fitted route coordinate system.
- Removed origin/destination cards from inside the map; those details stay in
  the compact route summary above the map.
- Added a final navy/white notebook visual layer over the older warm notebook
  palette, including gridline background, white panels, navy controls, and
  responsive mobile workbench ordering.
- Recolored the logo/app icon and the remaining sheet/focus/status surfaces
  away from the old tan/brown token set into navy/blue/white.
- Removed the desktop workbench max-width/fixed-agent gap so the main workbench
  expands to the agent rail instead of leaving a dead center strip.
- Added idempotent local demo map loads:
  `DEMO-MAP-001` Port Klang, MY to Istanbul, TR and
  `DEMO-MAP-002` Shanghai, CN to Mersin, TR.

## Files changed

- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/globals.css`
- `src/app/icon.tsx`
- `src/components/logo-mark.tsx`
- `src/lib/route-map-viewport.ts`
- `scripts/route-map-viewport.test.ts`
- `scripts/seed-map-example-loads.ts`
- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`

## Verification passed

- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run test:route-map`
- `npx tsx scripts/seed-map-example-loads.ts`
- Local dev server at `http://localhost:3000`
- Browser smoke login with `admin@demo.local / admin1234`
- Desktop browser checks for `DEMO-MAP-001` and `DEMO-MAP-002`: route summary
  includes expected origin/destination, map no longer renders origin/destination
  cards, overview and zoom route paths render with sea waypoints, all fitted
  OpenStreetMap overview/zoom tiles loaded, no broken map images, no console
  errors, and old brown/tan target-color scan returned zero hits in the
  requested sheet/focus/logo surfaces.
- Mobile screenshot check at 390px width for `DEMO-MAP-001`: route strip and
  map labels present, 8/8 tiles loaded, no route-strip/map overflow.

## Caveats

- The map panel uses public OpenStreetMap tile URLs directly. This is acceptable
  for local/product visual iteration, but production should use a proper map
  provider/account or cached tile strategy before serious traffic.
- Route geocoding is deterministic lookup-based for common demo lanes. Unknown
  locations fall back to a generic marker instead of calling a geocoder.

## Date

2026-06-22

## Branch

codex/lead-to-quote-batch

## Commit

not committed

## Task implemented

H1: Production Hardening and Live Intelligence Pilot Prep.

This sprint intentionally did not add a new product surface. It hardened the
company brain and market-intelligence plumbing before any live pilot or broader
agent autonomy.

Pre-hardening checkpoint:

- Phase 1 through Phase 2E were already present in the worktree.
- The worktree was heavily dirty before H1. Do not blindly stage unrelated
  files.
- Baseline `npx tsc --noEmit` passed before H1 edits.
- External intelligence remains advisory. It cannot mutate jobs, RFQs, quotes,
  prices, milestones, customer records, documents, or outbound messages.
- Do not run live Firecrawl ingestion during verification.

## Files changed

- `.env.example`
- `package.json`
- `src/lib/security/crypto.ts`
- `src/lib/security/html.ts`
- `src/lib/portal-token.ts`
- `src/lib/gmail-oauth.ts`
- `src/app/api/auth/gmail/callback/route.ts`
- `src/lib/portal.ts`
- `src/app/portal/[token]/page.tsx`
- `src/components/copy-portal-link.tsx`
- `src/lib/customer-notify.ts`
- `src/lib/agent-tools.ts`
- `src/lib/seed-demo-load.ts`
- `src/app/api/jobs/[jobId]/quote-pdf/route.ts`
- `src/lib/market-intelligence/firecrawl-client.ts`
- `src/lib/market-intelligence/ingest-firecrawl-source.ts`
- `src/lib/market-intelligence/scheduled-ingestion.ts`
- `src/app/api/cron/market-intelligence/route.ts`
- `scripts/security-hardening.test.ts`
- `scripts/audit-tenant-scope.ts`
- `scripts/firecrawl-smoke.test.ts`
- `scripts/scheduled-market-ingestion.test.ts`
- `scripts/market-doctor.ts`
- `docs/RUNBOOKS/MARKET_INTELLIGENCE_LIVE_PILOT.md`
- `docs/COMPANY_BRAIN.md`
- `docs/MARKET_INTELLIGENCE.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`
- `docs/AI_HANDOFF.md`

## Behavior added

- Gmail OAuth access/refresh token writes now use AES-256-GCM encryption in the
  existing `EmailAccount` token columns.
- `TOKEN_ENCRYPTION_KEY` is required for new encrypted OAuth token writes.
- Legacy plaintext OAuth token reads remain supported so local/dev databases do
  not immediately break; reconnecting or a successful refresh rewrites tokens
  encrypted.
- Public portal access no longer falls back from `portalToken` to `job.id`.
- New portal tokens use 32 random bytes encoded as 64 hex chars; legacy 32-hex
  real portal tokens still resolve.
- Quote PDF HTML escapes dynamic job, customer, route, and line-item values.
- Firecrawl search now requires `includeDomains`; broad web search is blocked
  at the client boundary.
- Firecrawl provider errors are sanitized before being thrown or stored in
  `MarketIngestionRun.error`.
- Scheduled market ingestion now requires
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` for live runs unless a
  mocked test fetch client is supplied.
- Firecrawl cron route fails closed when `CRON_SECRET` is unset.
- Direct live Firecrawl CLI requires both
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` and `--confirm-live`.
- Tenant-scope audit now supports `--strict`, `--json`, severity labels, and
  actionable hints.
- Market doctor reports hardening controls, source-domain gaps, risky broad
  fetch configs, sources exceeding limits, live toggle state, and key configured
  yes/no only.
- Added live-pilot runbook.

## New scripts

- `npm run test:security`

## Verification passed

- `npx prisma validate`
- `npm run db:generate`
- `npx tsc --noEmit`
- `npm run test:security`
- `npm run test:strategy`
- `npm run test:memory`
- `npm run test:memory-search`
- `npm run test:morning-brief`
- `npm run test:market-intelligence`
- `npm run test:market-impact`

## Hardware corridor intelligence and decision brief

Status:

- Implemented on 2026-07-23 on `find-hardware-import-data`.
- Local commits: `f6425d6`, `f671e9b`, and `4c19bef`.
- Not pushed at documentation time.

What changed:

- Census hardware snapshot schema v3 adds 681 positive-value current-period
  segments keyed by hardware category, country of origin, and West Coast
  port-of-unlading district.
- All four stored vessel metrics reconcile exactly to the current West Coast
  Port Imports HS6 totals. California destination reports receive no gateway
  corridor rows.
- The hardware report now leads with three explicit decisions: the first
  corridor to research, gateway concentration to stress-test, and a hard hold
  on lead outreach because the report contains zero qualified leads.
- The Origins section adds a category-by-gateway matrix and a collapsed ranked
  segment table. Copy states that this is a corridor signal, not a
  port-to-port lane.
- Completed annual totals are visually separated from current YTD metrics.
- ImportGenius, TradeAtlas, and Trademo now have precise official pricing,
  field, sample, FAQ, and API references. The report compares their public
  acquisition paths and defines one identical licensed-sample scorecard.
- Exact claim evidence, provider references, ranked segment rows, methodology,
  and sample acceptance details are collapsed by default but open
  automatically for print.
- The hero and decision hierarchy were tightened for operator use. The fixed
  seven-section report and print mode remain intact.
- Final review hardened every aggregate snapshot metric to a safe
  non-negative integer. Fractional and unsafe values now fail validation even
  when dimension totals otherwise reconcile.
- Export authorization now has behavioral coverage for anonymous HTTP 401,
  employee HTTP 403, and authorized HTTP 200 responses. Denied requests do not
  read the snapshot.

Provider reality:

- No paid shipment provider is connected.
- ImportGenius Pro is the clearest published benchmark at $449 per month for
  U.S. history from 2006 to present, subject to published search and download
  limits.
- TradeAtlas publishes a free 2022 U.S. sample path and starts at $2,950 per
  year for 15 HS6 codes.
- Trademo publishes custom pricing and strong prospect-workflow claims, but
  its public coverage counts conflict and require written clarification.
- Do not buy any provider until the same sample passes history, freshness,
  shipment-field, geography, entity-resolution, relevance, and commercial
  rights gates.

Verification:

- `npm run test:intel-sources`
- `npm run test:intel-census-public-hardware`
- `npm run test:intel-ocean-hardware`
- `npm run test:intel-census-ocean`
- `npm run test:intel-hardware-export-route`
- `npm run test:intel-report-ui`
- `npm run test:intel-boundary`
- `npx tsc --noEmit --incremental false`
- `npm run build`
- Authenticated browser QA at 390, 768, and 1440 pixels with zero horizontal
  overflow and no runtime console errors.
- Authenticated snapshot export returned HTTP 200, schema version 3, and all
  681 corridor segments.

Boundaries and next work:

- The joint slice does not establish a foreign loading port, service, rate,
  transit, delay, buyer, supplier, optimized route, or lead.
- The next product choice is whether to make saved corridor watches and
  shipment research briefs the primary operator workflow, or to prioritize a
  licensed lead queue after the provider sample.
- `npm run test:firecrawl`
- `npm run test:source-quality`
- `npm run test:scheduled-market-ingestion`
- `npm run memory:doctor`
- `npm run market:doctor`
- `npm run audit:tenant-scope`
- `npm run build`
- `npm run ai:handoff`

## Verification failed/skipped

- No live Firecrawl ingestion was run.
- No production database commands were run.

## Caveats

- No Prisma schema change was required for token encryption; encrypted blobs are
  stored in the existing token columns.
- Existing plaintext Gmail tokens are compatible. A successful refresh
  re-encrypts a legacy plaintext refresh token; reconnecting also stores
  encrypted values.
- `TOKEN_ENCRYPTION_KEY` must be backed up like any production secret. Losing it
  makes encrypted OAuth tokens unrecoverable.
- Live Firecrawl ingestion remains disabled by default and must start with
  dry-run plus one reviewed source.

## Recommended next step

Run the full H1 verification list, then pilot one official or carrier source in
dry-run mode before enabling any live scheduled ingestion.

## Checkpoint Plan For Dirty Worktree

Generated after inspecting:

- `git status --short`
- `git diff --stat`
- `git diff --name-only`
- `git branch --show-current`
- `git log -1 --oneline`

Current branch: `codex/lead-to-quote-batch`.

Current HEAD: `9727e55 feat: add integration setup gates`.

Tracked diff at inspection time: 37 files, roughly 6k insertions and 2.5k
deletions. Many Phase 1 through H1 files are still untracked. Do not make one
giant "company brain" commit unless you enjoy making future debugging worse.

### Logical File Buckets

Phase 1 memory plumbing:

- `prisma/schema.prisma`
- `prisma/migrations/20260621000100_company_brain_memory/migration.sql`
- `src/lib/memory/record-event.ts`
- `src/lib/memory/ingest-object.ts`
- `src/lib/memory/backfill.ts`
- `src/lib/memory/search-memory.ts`
- `scripts/backfill-company-brain.ts`
- memory write hooks in `src/lib/gmail-sync.ts`, `src/lib/whatsapp.ts`,
  `src/lib/google-sheets-sync.ts`, `src/lib/thread-actions.ts`,
  `src/lib/forwarder-drafts.ts`, `src/lib/customer-quote-drafts.ts`,
  `src/lib/agent-proposals.ts`, and
  `src/lib/commercial-strategy-persistence.ts`
- `scripts/memory-write-smoke.test.ts`

Phase 1.5 memory usefulness, doctor, and morning brief:

- `src/lib/memory/customer-dossier.ts`
- `src/lib/memory/morning-brief.ts`
- `scripts/memory-doctor.ts`
- `scripts/morning-brief.test.ts`
- memory sections in `src/lib/agent-chat.ts` and `src/lib/agent-tools.ts`

Phase 2A hybrid retrieval and evidence:

- `src/lib/memory/canonical-types.ts`
- `src/lib/memory/evidence.ts`
- `src/lib/memory/hybrid-search.ts`
- `src/lib/memory/relevance.ts`
- `scripts/memory-search.test.ts`

Phase 2B market intelligence:

- `prisma/migrations/20260622000100_market_intelligence/migration.sql`
- `src/lib/market-intelligence/source-registry.ts`
- `src/lib/market-intelligence/ingest-market-source.ts`
- `src/lib/market-intelligence/ingest-market-object.ts`
- `src/lib/market-intelligence/extract-market-signals.ts`
- `src/lib/market-intelligence/link-market-signals.ts`
- `src/lib/market-intelligence/market-tools.ts`
- `scripts/ingest-market-intelligence.ts`
- `scripts/market-intelligence-smoke.test.ts`

Phase 2C market impact review and feedback:

- `prisma/migrations/20260622000200_market_impact_review/migration.sql`
- `src/lib/market-intelligence/market-impact-review.ts`
- market review/feedback additions in `src/lib/market-intelligence/*`
- agent tool additions in `src/lib/agent-tools.ts`
- morning brief additions in `src/lib/memory/morning-brief.ts`
- `scripts/market-impact-review.test.ts`

Phase 2D Firecrawl connector and Research Inbox:

- `prisma/migrations/20260622000300_firecrawl_market_ingestion/migration.sql`
- `src/lib/market-intelligence/firecrawl-client.ts`
- `src/lib/market-intelligence/source-policy.ts`
- `src/lib/market-intelligence/ingest-firecrawl-source.ts`
- `src/app/dashboard/intelligence/page.tsx`
- `scripts/ingest-firecrawl-market-intelligence.ts`
- `scripts/firecrawl-smoke.test.ts`
- related CSS in `src/app/globals.css`

Phase 2E source quality and scheduled ingestion:

- `src/lib/market-intelligence/source-quality.ts`
- `src/lib/market-intelligence/scheduled-ingestion.ts`
- `src/app/api/cron/market-intelligence/route.ts`
- Research Inbox ranking changes in `src/app/dashboard/intelligence/page.tsx`
- agent/source-quality changes in `src/lib/agent-tools.ts` and
  `src/lib/agent-chat.ts`
- `scripts/source-quality.test.ts`
- `scripts/scheduled-market-ingestion.test.ts`

H1 hardening:

- `.env.example`
- `src/lib/security/crypto.ts`
- `src/lib/security/html.ts`
- `src/lib/portal-token.ts`
- `src/lib/gmail-oauth.ts`
- `src/app/api/auth/gmail/callback/route.ts`
- `src/lib/portal.ts`
- `src/app/portal/[token]/page.tsx`
- `src/components/copy-portal-link.tsx`
- `src/lib/customer-notify.ts`
- `src/lib/seed-demo-load.ts`
- `src/app/api/jobs/[jobId]/quote-pdf/route.ts`
- hardening changes in `src/lib/market-intelligence/firecrawl-client.ts`,
  `src/lib/market-intelligence/ingest-firecrawl-source.ts`,
  `src/lib/market-intelligence/scheduled-ingestion.ts`, and
  `src/app/api/cron/market-intelligence/route.ts`
- `scripts/security-hardening.test.ts`
- `scripts/audit-tenant-scope.ts`
- hardening additions in `scripts/firecrawl-smoke.test.ts`,
  `scripts/scheduled-market-ingestion.test.ts`, and `scripts/market-doctor.ts`
- `docs/RUNBOOKS/MARKET_INTELLIGENCE_LIVE_PILOT.md`

AI collaboration, docs, and handoff:

- `AGENTS.md`
- `docs/AGENTS.md`
- `docs/AI_COLLABORATION_PROTOCOL.md`
- `docs/AI_HANDOFF.md`
- `docs/CODEBASE_DEEP_DISCOVERY_REPORT.md`
- `docs/COMPANY_BRAIN.md`
- `docs/DECISIONS.md`
- `docs/ENGINEERING_LOG.md`
- `docs/MARKET_INTELLIGENCE.md`
- `docs/NEXT_AGENT_TASK.md`
- `src/lib/AGENTS.md`
- `src/lib/memory/AGENTS.md`
- `src/lib/market-intelligence/AGENTS.md`
- `src/app/api/AGENTS.md`
- `prisma/AGENTS.md`
- `scripts/generate-ai-handoff.ts`

Pre-existing or cross-cutting app/UI changes needing careful review:

- `src/app/dashboard/admin/page.tsx`
- `src/app/dashboard/inbox/page.tsx`
- `src/app/dashboard/jobs/[jobId]/actions.ts`
- `src/app/dashboard/jobs/[jobId]/page.tsx`
- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/pricing/page.tsx`
- `src/app/dashboard/rfq/[inquiryId]/actions.ts`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `src/app/dashboard/rfq/new/page.tsx`
- `src/app/globals.css`
- `src/components/agent-chat-widget.tsx`
- `src/components/commercial-brain-engine-schematic.tsx`
- `src/components/commercial-decision-cockpit.tsx`
- `src/lib/commercial-strategy.ts`
- `src/lib/risk.ts`

Generated/build artifacts:

- No `.next`, `node_modules`, logs, local DB files, or build output appeared in
  `git status --short`.
- `.codex/rules/*.rules` are local agent rules. Commit them only if the team
  wants repo-local Codex rules.

### Risky Files

- Schema/migrations: `prisma/schema.prisma`, all
  `prisma/migrations/202606*.sql`.
- Env/script surface: `.env.example`, `package.json`.
- Auth/security: `src/lib/security/crypto.ts`, `src/lib/gmail-oauth.ts`,
  `src/app/api/auth/gmail/callback/route.ts`.
- Public portal: `src/lib/portal-token.ts`, `src/lib/portal.ts`,
  `src/app/portal/[token]/page.tsx`, `src/components/copy-portal-link.tsx`,
  `src/lib/customer-notify.ts`.
- Quote output: `src/app/api/jobs/[jobId]/quote-pdf/route.ts`.
- Firecrawl/live ingestion: `src/lib/market-intelligence/firecrawl-client.ts`,
  `src/lib/market-intelligence/ingest-firecrawl-source.ts`,
  `src/lib/market-intelligence/scheduled-ingestion.ts`,
  `scripts/ingest-firecrawl-market-intelligence.ts`.
- Cron: `src/app/api/cron/market-intelligence/route.ts`.
- Package scripts: `package.json`.

### Recommended Commit Sequence

Commit 1: `company brain memory foundation`

- Include: memory Prisma models/migration, `record-event`, `ingest-object`,
  `backfill`, initial memory write hooks, backfill script, memory smoke test.
- Reason: establishes canonical additive memory/event layer.
- Verify before/after: `npx prisma validate`, `npm run db:generate`,
  `npm run test:memory`, `npx tsc --noEmit`.
- Caveat: several write-hook files also contain later phase changes. Use
  patch-level staging, not blind file-level staging.

Commit 2: `memory retrieval evidence and morning brief`

- Include: canonical taxonomy, hybrid search, evidence helpers, customer
  dossier, morning brief, memory doctor, memory search test, agent memory tools.
- Reason: makes memory useful and auditable without vector search.
- Verify: `npm run test:memory-search`, `npm run test:morning-brief`,
  `npm run memory:doctor`, `npx tsc --noEmit`.
- Caveat: `src/lib/agent-tools.ts`, `src/lib/agent-chat.ts`, and
  `src/lib/memory/morning-brief.ts` are shared with market phases.

Commit 3: `market intelligence core pipeline`

- Include: `MarketSignal` migration/model, market source registry, ingest
  market source/object, signal extraction, signal linking, market agent tools,
  market smoke test.
- Reason: separates raw articles from operational intelligence.
- Verify: `npx prisma validate`, `npm run db:generate`,
  `npm run test:market-intelligence`, `npx tsc --noEmit`.
- Caveat: keep external intelligence advisory language in docs with this
  commit.

Commit 4: `market impact reviews and feedback`

- Include: market impact review migration, review/feedback service, agent
  review tools, morning brief review surfacing, market impact test.
- Reason: adds the human-review bridge between possible links and action.
- Verify: `npm run test:market-impact`, `npm run test:morning-brief`,
  `npx tsc --noEmit`.
- Caveat: do not mark any review `actioned` from automation.

Commit 5: `firecrawl research inbox and source quality controls`

- Include: Firecrawl client, source policy, ingestion runs, scheduled ingestion,
  market cron route, Research Inbox, source quality ranking, Firecrawl/source
  quality/scheduled tests, market doctor additions.
- Reason: controlled external intelligence pilot infrastructure.
- Verify: `npm run test:firecrawl`, `npm run test:source-quality`,
  `npm run test:scheduled-market-ingestion`, `npm run market:doctor`,
  `npx tsc --noEmit`.
- Caveat: do not run live ingestion as part of committing. Tests must stay
  mocked.

Commit 6: `harden secrets portal pdf and live ingestion gates`

- Include: token encryption, Gmail OAuth compatibility, portal token hardening,
  quote PDF escaping, Firecrawl broad-search/live gates, cron fail-closed,
  tenant audit improvements, security test, hardening runbook.
- Reason: production safety before live pilot or new autonomy.
- Verify: `npm run test:security`, `npm run test:firecrawl`,
  `npm run test:scheduled-market-ingestion`, `npm run audit:tenant-scope`,
  `npm run build`.
- Caveat: `TOKEN_ENCRYPTION_KEY` must be configured before Gmail reconnects or
  token refresh writes.

Commit 7: `AI collaboration docs and handoff`

- Include: collaboration protocol, discovery report, company brain docs,
  decisions, engineering log, handoff, AGENTS files, Codex rules only if
  intentionally repo-scoped.
- Reason: documents operating contract and next-agent context.
- Verify: `npm run ai:handoff`, `npx tsc --noEmit`.
- Caveat: docs should reference the actual commit hashes after commits exist.

### Files To Exclude Unless Explicitly Intended

- Any `.env`, real secrets, token dumps, logs, local DB files, `.next`,
  `node_modules`, and generated build output.
- `.codex/rules/*.rules` unless the team wants Codex rules in the repo.
- Dashboard/CSS/report/UI changes that cannot be tied to the phase they are
  staged with. The `globals.css` diff is huge; review it manually.
- Any live-ingestion output or local one-off script output.

## Gmail OAuth Token Encryption Compatibility Audit

Current behavior:

- `src/lib/security/crypto.ts` treats values starting with `enc:v1:` as
  encrypted AES-256-GCM payloads.
- Values without that prefix are treated as legacy plaintext and returned as-is
  by `decryptOAuthTokenFromStorage`.
- `getValidAccessToken` reads a legacy plaintext refresh token successfully.
- After a successful refresh, both the new access token and any legacy
  plaintext refresh token are stored encrypted.
- A Gmail account with no refresh token fails with:
  `Account has no refresh token (re-connect needed)`.
- Missing `TOKEN_ENCRYPTION_KEY` fails on encrypted writes/decrypts with:
  `TOKEN_ENCRYPTION_KEY is required to encrypt or decrypt OAuth tokens. Generate one with: openssl rand -base64 32`.

Production risk:

- Legacy plaintext rows are compatible, but they remain sensitive until a
  successful refresh or reconnect encrypts them.
- `TOKEN_ENCRYPTION_KEY` must be present and backed up before deployment. Lose
  it and encrypted OAuth tokens are unrecoverable.
- There is no standalone database migration/backfill script for existing
  plaintext tokens. The chosen approach is compatibility plus re-encryption on
  next refresh, because it avoids printing or bulk-touching secrets.

Recommendation:

- Use option B: compatibility path plus re-encryption on next successful
  refresh.
- Do not require all Gmail accounts to reconnect immediately unless production
  policy demands rapid removal of plaintext-at-rest rows.
- If production already has many Gmail accounts and strict compliance pressure,
  add an admin-only one-time migration script later. It must not log token
  values and must require `TOKEN_ENCRYPTION_KEY`.

## Controlled Live Firecrawl Pilot Result

Pilot source:

- `port-of-long-beach-news`
- Name: Port of Long Beach News and Press
- Trust: `OFFICIAL`
- Fetch type: `firecrawl_scrape`
- URL tested: `https://polb.com/port-info/news-and-press/`
- Allowed domains: `polb.com`
- Clamp: max results `3`, max pages `3`
- Office: `cmqlgbg1u0000rnztu66omsr0` / Istanbul Office

Environment/safety state:

- `FIRECRAWL_API_KEY` configured: yes
- `MARKET_INTELLIGENCE_PROVIDER` configured: yes (`firecrawl`)
- `MARKET_INTELLIGENCE_CRON_ENABLED`: disabled
- `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED`: disabled by default
- enabled fetchable source count: `0`
- risky broad fetch configs: `0`
- allowed-domain issues: `0`
- max results/pages configured: yes / yes
- daily budget configured: yes (`25`)
- database URL classification: local

Dry run:

- policy passed
- estimated pages/results: `3` / `3`
- candidate URL: `https://polb.com/port-info/news-and-press/`
- duplicate preview before live run: no existing candidate object
- expected write upper bound for this scrape source: one market update object,
  with derived signals/reviews depending on fetched content

Live run:

- Command used one explicit URL and temporary one-command live flag:
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true npm run market:ingest:firecrawl -- --office cmqlgbg1u0000rnztu66omsr0 --source port-of-long-beach-news --url https://polb.com/port-info/news-and-press/ --limit 3 --confirm-live`
- `MarketIngestionRun`: `cmqpc884m0001rn6hgs2ire2b`
- Status: succeeded
- Provider results consumed: `1`
- Source URLs accepted: `https://polb.com/port-info/news-and-press/`
- Source `KnowledgeObject`: `cmqpc8c7g0005rn6hhbbr00e2`
  (`market_update`)
- Derived signal `KnowledgeObject`: `cmqpc8c8k000irn6htd6si82i`
  (`market_signal`)
- `KnowledgeChunk` rows created: `2`
- `MarketSignal` rows created: `1`
- `MarketSignalLink` rows created: `11`
- `MarketImpactReview` rows created: `11`
- Provider errors: none

Feedback recorded:

- The scraped source page produced a bad operational interpretation from page
  navigation/social-link text. This is exactly the kind of thing the pilot was
  meant to catch.
- Dismissed `11` impact reviews.
- Recorded `8` `irrelevant` feedback entries for customer/job/RFQ impacts.
- Recorded `3` `wrong_link` feedback entries for bogus social-link lanes:
  `FlickrLinks -> Port of Long Beach Flickr`,
  `InstagramLinks -> Port of Long Beach`, and
  `Twitterlinks -> Port of Long Beach`.
- No review was marked `actioned`.
- No operational job, RFQ, quote, customer, milestone, message, or price record
  was mutated.

Doctor summaries after feedback:

- `memory:doctor`: unknown canonical rows `0`, legacy canonical rows `0`,
  events missing provenance `0`, duplicate source ids `0`, duplicate content
  hashes `0`.
- `market:doctor`: cron enabled `false`, live ingestion enabled `false`,
  enabled fetchable source count `0`, allowed-domain issues `0`, risky broad
  fetch configs `0`.
- `market:doctor`: pending `MarketImpactReview` rows `0`, dismissed `11`.
- `market:doctor`: signals with zero links `0`, high/critical signals with
  zero links `0`.
- Source quality for `port-of-long-beach-news` moved from `86/excellent` to
  `0/poor` because the pilot recorded `3` wrong links, `8` irrelevant impacts,
  and `11` dismissed reviews.

Product-surface observations:

- `/dashboard/intelligence` Research Feed has one Port of Long Beach research
  item, one signal, zero pending reviews, and eleven dismissed reviews.
- `/dashboard/intelligence` Market Signals still lists the derived critical
  port-disruption signal, but the source quality is `0/poor`.
- `/dashboard/intelligence` Impact Reviews default pending view should be empty.
- Morning Brief currently suppresses pending market impact reviews, but still
  includes the poor-quality high/critical signal in `market_intelligence` and
  as the top recommended market action. That is a real product defect: dismissed
  or poor-quality signals should be demoted or suppressed before they drive
  recommended actions.

Recommendation:

- Do not test a second source yet.
- Keep scheduled ingestion disabled.
- Before the next live source, fix extraction hygiene: strip navigation/footer
  text, require source pages to contain an article/advisory/date-like signal,
  block social-link-derived lanes, and make Morning Brief ignore or heavily
  demote signals whose source quality is poor or whose linked reviews were all
  dismissed.

## H2 Web Extraction Hygiene And Signal Suppression

Status:

- Implemented in the dirty worktree.
- Not committed.
- Live Firecrawl ingestion was not run during H2.
- Cron remains disabled.

What changed:

- Added deterministic content hygiene in
  `src/lib/market-intelligence/content-hygiene.ts`.
- Added signal suppression helpers in
  `src/lib/market-intelligence/signal-suppression.ts`.
- Preserved the failed Port of Long Beach pilot as
  `scripts/fixtures/market-intelligence/port-long-beach-news-index.bad.json`.
- Updated Firecrawl scrape requests to ask for cleaner main content:
  `onlyMainContent`, `removeBase64Images`, `blockAds`, and chrome
  `excludeTags`.
- Updated market ingestion so low-quality/index/navigation pages can be stored
  as Research Feed `KnowledgeObject` rows but cannot create `MarketSignal`,
  `MarketSignalLink`, or `MarketImpactReview` rows.
- Updated extraction and linking to ignore social/utility/footer/navigation URL
  text as lane/entity evidence.
- Updated Morning Brief, strategy context, lane/customer exposure tools, and
  agent market search so suppressed/poor-quality signals do not become
  recommended action.
- Updated `/dashboard/intelligence` so suppressed signals, dismissed reviews,
  and extraction-skipped research items remain visible for audit.
- Updated `market:doctor` to report low-quality skips, index/navigation
  classifications, suppressed signals, majority wrong-link/irrelevant signals,
  social-link lane candidates, and suppressed signals still appearing in Morning
  Brief.

Current H2 contract:

- Firecrawl cleanup helps, but Derya hygiene decides.
- Signal-eligible page types are `article`, `advisory`, `press_release`,
  `rate_update`, and `regulatory_update`.
- `index_page`, `navigation_page`, and `unknown` are research-only unless a
  future source-specific parser proves otherwise.
- Default signal extraction threshold is `contentQualityScore >= 60`.
- Rejected extraction stores `pageType`, `contentQualityScore`,
  `extractionStatus`, and rejection reasons on `KnowledgeObject.payload`.
- Rejected extraction records a `market.update.extraction_skipped` memory event.
- Morning Brief and strategy ignore signals from poor sources, rejected pages,
  low-quality content, closed-only review sets, majority wrong-link/irrelevant
  feedback, and signals without active pending/acknowledged impact work.

Important local evidence:

- Failed live source object: `cmqpc8c7g0005rn6hhbbr00e2`.
- Failed derived signal object: `cmqpc8c8k000irn6htd6si82i`.
- Failed run id: `cmqpc884m0001rn6hgs2ire2b`.
- The old bad signal is now suppressed from Morning Brief by source quality and
  review/feedback state.

Do next:

1. Do not test a second source yet.
2. Rerun the same `port-of-long-beach-news` source with the same `3` result /
   `3` page clamp.
3. Expected result: listing page stored as Research Feed, no fake
   `MarketSignal`, no social-link lanes, no impact reviews, no Morning Brief
   recommendation.
4. Only after that passes, test one official/regulatory/carrier/rate source.

Verification snapshot for H2 will be refreshed by `npm run ai:handoff` after
the final verification run.

## H2.1 Same-Source Firecrawl Regression Rerun

Status:

- Passed.
- Source tested: `port-of-long-beach-news`.
- Office: `cmqlgbg1u0000rnztu66omsr0` / Istanbul Office.
- URL tested: `https://polb.com/port-info/news-and-press/`.
- Clamp: max results `3`, max pages `3`.
- Live Firecrawl was run once for this exact source and URL.
- Cron remains disabled.
- No second source was tested.
- No operational job, RFQ, quote, customer, milestone, message, or price record
  was mutated.
- Historical bad pilot data was not deleted.

Safety state:

- `FIRECRAWL_API_KEY` configured: yes.
- `MARKET_INTELLIGENCE_PROVIDER` configured: yes.
- `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN` configured: yes.
- `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN` configured: yes.
- `MARKET_INTELLIGENCE_CRON_ENABLED` configured: yes, disabled.
- `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET` configured: yes.
- `TOKEN_ENCRYPTION_KEY` configured in this shell: no.
- `CRON_SECRET` configured: yes.
- Enabled fetchable sources: `0`.
- Risky broad fetch configs: `0`.
- Allowed-domain issues: `0`.

Dry-run / preview result:

- Candidate URL: `https://polb.com/port-info/news-and-press/`.
- Title: `News & Press - Port of Long Beach`.
- Published date: none.
- Page type: `index_page`.
- Signal eligible: false.
- Eligibility reason: `page_type_index_page`.
- Clean body length from preview wrapper: `0`.
- Expected research items: `1`.
- Expected extraction skipped: `1`.
- Expected `MarketSignal`: `0`.
- Expected `MarketSignalLink`: `0`.
- Expected `MarketImpactReview`: `0`.
- Duplicate check: existing research URL count `1`, matching the original bad
  pilot object.

Live run result:

- `MarketIngestionRun`: `cmqpkglvy0001rn99xnek5o3i`.
- Status: succeeded.
- Provider results consumed: `1`.
- Accepted URL: `https://polb.com/port-info/news-and-press/`.
- Research `KnowledgeObject`: `cmqpc8c7g0005rn6hhbbr00e2`; the existing object
  was updated idempotently rather than duplicated.
- `KnowledgeChunk` rows newly created: `0`; existing chunk updated.
- New `MarketSignal` rows from this run: `0`.
- New `MarketSignalLink` rows from this run: `0`.
- New `MarketImpactReview` rows from this run: `0`.
- Provider errors: none.
- Run metadata: `skippedExtractionCount: 1`.

Extraction state after rerun:

- Source object page type: `index_page`.
- `contentQualityScore`: `0`.
- `extractionStatus`: `rejected_low_quality`.
- `extractionRejectionReason`: `page_type_index_page`.
- Rejection reasons:
  - `page_type_index_page`
  - `content_quality_below_60`
  - `insufficient_clean_body_text`
- A new `market.update.extraction_skipped` memory event was recorded.

Doctor summaries:

- `memory:doctor`: unknown canonical rows `0`, legacy canonical rows `0`,
  events missing provenance `0`, duplicate source ids `0`, duplicate content
  hashes `0`.
- `market:doctor`: cron enabled `false`, live ingestion enabled `false`,
  provider configured `true`, enabled fetchable source count `0`, allowed-domain
  issues `0`, risky broad fetch configs `0`.
- `market:doctor`: market updates skipped for low quality includes
  `cmqpc8c7g0005rn6hhbbr00e2`.
- `market:doctor`: market updates classified as index/navigation includes
  `cmqpc8c7g0005rn6hhbbr00e2`.
- `market:doctor`: suppressed signals still appearing in Morning Brief: none.
- `market:doctor`: pending `MarketImpactReview` rows `0`, dismissed `11`.
- Source quality for `port-of-long-beach-news` remains `0/poor`, which is
  expected because the historical bad run still has wrong-link/irrelevant
  feedback.

Product-surface observations:

- Research Feed shows the Port of Long Beach research item for audit.
- The historical bad signal remains attached to that old research object, but
  it is suppressed with reason `source_quality_poor`.
- Agent market search returns no active Port of Long Beach signals and lists the
  historical signal only under suppressed signals.
- Impact Reviews have no pending work for Port of Long Beach; the eleven old
  reviews remain dismissed.
- Morning Brief market section has `0` market impact reviews and `0` market
  signals for this source.

H2.1 verdict:

- Passed. The same listing/index page is now research-only and did not create
  fake operational intelligence.
- Safe to run one second-source pilot next, preferably
  `maersk-news-advisories`, then `cbp-csms`, then
  `drewry-world-container-index`, then `port-of-los-angeles-latest-news`.
- Keep scheduled ingestion disabled. Do not enable cron until several sources
  and enough review feedback have been observed.

## Deployment Readiness Audit

Status:

- Audit completed on 2026-06-22.
- No files were staged or committed.
- No deployment was run.
- No live Firecrawl ingestion was run.
- No production database command was run.
- Product behavior was not intentionally changed; this entry is documentation
  only.

Repo state inspected:

- Branch: `codex/lead-to-quote-batch`.
- HEAD: `9727e55 feat: add integration setup gates`.
- Tracked diff at inspection time: 37 files, roughly 6k insertions and 2.5k
  deletions.
- The worktree is still heavily dirty. It contains tracked edits plus many
  untracked Phase 1 through H2.1 files. Do not use `git add .`.

Release buckets:

- Phase 1 memory foundation: Prisma memory models, memory ingest/event/search,
  backfill, memory write hooks, and memory smoke scripts.
- Phase 1.5 usefulness: memory doctor, customer dossier, morning brief, and
  agent memory context.
- Phase 2A retrieval/evidence: canonical taxonomy, hybrid search, relevance,
  and evidence helpers.
- Phase 2B market intelligence: `MarketSignal`, source registry, market object
  ingestion, signal extraction/linking, agent tools, and docs.
- Phase 2C review loop: `MarketImpactReview`, `MarketSignalFeedback`, review
  generation, feedback tools, and morning brief integration.
- Phase 2D Firecrawl/Research Inbox: Firecrawl client, source policy,
  `/dashboard/intelligence`, ingestion run tracking, and smoke tests.
- Phase 2E scheduling/source quality: scheduled ingestion controls, source
  quality scoring, ranked market sections, and doctor checks.
- H1 hardening: OAuth token encryption, portal token hardening, quote PDF HTML
  escaping, Firecrawl safety gates, tenant audit, and runbooks.
- H2/H2.1 extraction hygiene: page classification, content quality gates,
  social/footer stripping, suppression, failed-pilot fixture, and same-source
  regression evidence.
- Docs/handoff: `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`,
  `docs/COMPANY_BRAIN.md`, `docs/MARKET_INTELLIGENCE.md`,
  `docs/DECISIONS.md`, runbooks, and protocol docs.
- Generated/local exclude: `.env`, `.env.local`, `.next/`, `node_modules/`,
  `prisma/dev.db`, logs, and local `.codex/` state must not be committed.

Migration inventory:

- `20260621000100_company_brain_memory`: creates memory/source/object/chunk/
  mention/event/agent-memory tables.
- `20260622000100_market_intelligence`: creates market signal/link tables.
- `20260622000200_market_impact_review`: creates impact review and feedback
  tables.
- `20260622000300_firecrawl_market_ingestion`: creates ingestion run tracking
  and Firecrawl metadata support.
- The migration SQL is additive. No destructive `DROP` or column-removal
  statements were found.
- Critical deployment blocker: these migrations are not a full baseline for a
  fresh database. They reference existing tables such as `Office` and assume
  the pre-brain schema already exists. `prisma migrate deploy` is sufficient
  only against a database that already has the old application schema or a
  properly marked baseline. A clean staging database will fail without a
  baseline/stamping plan.
- Local `prisma migrate status` reported the four new migrations as not yet
  applied locally, while the local schema appears to exist through prior
  `db push` usage. That drift needs to be resolved before pretending the
  migration path is production-ready.

Package/deploy script notes:

- `build` runs `prisma generate && next build`.
- `postinstall` runs `prisma generate`, which is correct for Vercel-style
  dependency caching.
- `db:migrate` is `prisma migrate dev` and must not be used in production.
- `db:push` is guarded but remains a development command, not a production
  migration path.
- Market ingestion scripts exist but live ingestion stays gated behind explicit
  env flags and CLI confirmation.

Environment inventory:

- Required for preview/prod: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
  `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`,
  `NEXT_PUBLIC_APP_URL`, `ANTHROPIC_API_KEY`.
- Required if Gmail is enabled: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`.
- Required if transcription is enabled: `OPENAI_API_KEY`.
- Required if live market ingestion is enabled: `FIRECRAWL_API_KEY`,
  `MARKET_INTELLIGENCE_PROVIDER`, `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN`,
  `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN`,
  `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET`.
- Safe production defaults before broader rollout:
  `MARKET_INTELLIGENCE_CRON_ENABLED=false` and
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=false`.
- `.env.example` still needs cleanup before a polished release because several
  deployment-critical vars are referenced by code but not documented there:
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `CRON_SECRET`,
  `NEXT_PUBLIC_APP_URL`, and optional Firecrawl tuning vars.

Deployment blockers and risks:

- Blocker: migration baseline/history is not deployment-ready for fresh staging
  or production unless the target DB already has the pre-brain schema and the
  baseline is handled deliberately.
- Blocker: Vercel/project env vars need to be configured explicitly. Local
  build success does not prove preview/prod secrets exist.
- High risk: Gmail OAuth redirects must match Google Cloud OAuth exactly.
  Relying on preview URL fallbacks is asking for callback failures.
- Medium risk: `/api/cron/risk-scan` uses `x-cron-secret` or `?secret=`, while
  other cron routes accept Vercel-style `Authorization: Bearer`. It is gated,
  but the scheduled Vercel request may 401 unless adjusted or routed through the
  expected auth style.
- Medium risk: `/api/health` reports env presence and exposes the configured
  Gmail redirect URI. That is not a token, but it is more deployment detail
  than a public endpoint should ideally leak.
- Controlled risk: historical bad Port of Long Beach market data remains in the
  local DB for audit. It is suppressed from Morning Brief and strategy context.
- Controlled risk: existing plaintext Gmail tokens are supported and
  re-encrypted on refresh, but production must set and back up
  `TOKEN_ENCRYPTION_KEY`.

Verification run during this audit:

- Passed: `npx prisma validate`
- Passed: `npm run db:generate`
- Passed: `npx tsc --noEmit`
- Passed: `npm run test:security`
- Passed: `npm run test:strategy`
- Passed: `npm run test:memory`
- Passed: `npm run test:memory-search`
- Passed: `npm run test:morning-brief`
- Passed: `npm run test:market-intelligence`
- Passed: `npm run test:market-impact`
- Passed: `npm run test:firecrawl`
- Passed: `npm run test:source-quality`
- Passed: `npm run test:scheduled-market-ingestion`
- Passed: `npm run test:market-content-hygiene`
- Passed: `npm run test:market-signal-suppression`
- Passed: `npm run memory:doctor`
- Passed: `npm run market:doctor`
- Passed: `npm run audit:tenant-scope`
- Passed: `npm run build`
- Passed: `npm run ai:handoff`
- Passed after docs update: `npx tsc --noEmit`

Recommended deployment plan:

1. Create a release branch/checkpoint with patch-level staging by bucket. Do not
   stage local env files, generated output, local DBs, or `.codex/`.
2. Fix or formally document the Prisma baseline path. For a fresh staging DB,
   create/apply the pre-brain baseline or use Prisma's baseline/stamp workflow
   before these additive migrations.
3. Provision a staging database and run `prisma migrate deploy` there, not
   `migrate dev`, `db push`, or reset commands.
4. Configure Vercel preview env vars explicitly. Keep market cron/live
   ingestion disabled.
5. Deploy preview, run health checks, login/signup, dashboard load, Gmail OAuth
   callback smoke, portal token smoke, quote PDF smoke, memory/market doctor
   scripts against the intended DB, and cron auth smoke.
6. Only after preview passes, promote the same commit to production.
7. Keep scheduled market ingestion disabled until at least 3-4 sources and a
   meaningful review-feedback sample have been observed.

Rollback plan:

- If preview deploy fails before migrations: revert the deployment to the last
  known-good Vercel build and fix env/build issues locally.
- If migrations fail in staging: stop. Do not run `db push` or reset. Restore
  from DB snapshot if needed, fix the baseline/migration history, then retry
  `migrate deploy`.
- If app runtime fails after deploy: roll back Vercel to the previous
  deployment and keep the DB snapshot. The new memory/market tables are
  additive, so rollback mostly means old code ignores them.
- If Gmail encryption fails: ensure `TOKEN_ENCRYPTION_KEY` is present and
  unchanged. If encrypted tokens were written with the wrong key, affected
  accounts need reconnect.
- If market intelligence behaves badly: leave
  `MARKET_INTELLIGENCE_CRON_ENABLED=false` and
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=false`; use feedback/suppression
  instead of mutating operations.

Hard recommendation:

- Do not deploy this as-is to a fresh staging or production database. The code
  passes, but the database migration story is not clean enough yet. That is the
  boring part of shipping, and skipping it is how you buy yourself a stupid
  outage.

## D0 Prisma Migration Baseline And Release Packaging Prep

Status:

- Implemented on 2026-06-22.
- No files were staged or committed.
- No production database command was run.
- No live Firecrawl ingestion was run.
- Cron was not enabled.
- Runtime product behavior was not changed.

Files added or updated:

- `prisma/migrations/00000000000000_baseline_pre_brain/migration.sql`
- `prisma/migrations/migration_lock.toml`
- `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`
- `docs/DECISIONS.md`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`

Baseline source:

- The baseline was generated from `9727e55:prisma/schema.prisma`, accessed as
  `git show HEAD:prisma/schema.prisma` before this D0 work was committed.
- HEAD at generation time was `9727e55 feat: add integration setup gates`.
- That schema contains the pre-company-brain freight CRM tables and does not
  contain `Knowledge*`, `MemoryEvent`, `AgentMemory`, `MarketSignal`,
  `MarketSignalLink`, `MarketImpactReview`, `MarketSignalFeedback`, or
  `MarketIngestionRun`.
- Current working-tree `prisma/schema.prisma` adds those memory and
  market-intelligence models. Later migrations continue to own those tables.

Migration order now verified:

1. `00000000000000_baseline_pre_brain`
2. `20260621000100_company_brain_memory`
3. `20260622000100_market_intelligence`
4. `20260622000200_market_impact_review`
5. `20260622000300_firecrawl_market_ingestion`

Disposable DB verification:

- A throwaway local Postgres database was created.
- `npx prisma migrate deploy` applied all five migrations in order.
- `npx prisma migrate diff --from-url <throwaway-url>
  --to-schema-datamodel prisma/schema.prisma --exit-code` returned
  `No difference detected.`
- The throwaway database was dropped.
- No production DB commands were run.

Deployment blocker status:

- The fresh-staging blocker is cleared, assuming deployment uses
  `prisma migrate deploy` with this migration history.
- Existing production still requires the baseline runbook. If production has
  the pre-brain schema but no Prisma migration history, first verify that it
  matches the baseline, then mark only
  `00000000000000_baseline_pre_brain` as applied with
  `npx prisma migrate resolve --applied
  00000000000000_baseline_pre_brain`, then run `npx prisma migrate deploy`.
- Do not run `db push`, `migrate dev`, or `migrate reset` in staging or
  production.

Exact staging path:

```bash
export DATABASE_URL="postgresql://..."
export DATABASE_URL_UNPOOLED="postgresql://..."
npx prisma validate
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

Exact existing-production baseline path:

```bash
export DATABASE_URL="postgresql://..."
export DATABASE_URL_UNPOOLED="postgresql://..."
git show 9727e55:prisma/schema.prisma > /tmp/derya-pre-brain-schema.prisma
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel /tmp/derya-pre-brain-schema.prisma --exit-code
npx prisma migrate resolve --applied 00000000000000_baseline_pre_brain
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

Caveats:

- The production baseline path assumes the existing production database really
  matches the pre-brain schema from `9727e55`. If the diff reports drift, stop.
- Code rollback does not roll back database schema.
- The next step is D1: create clean release commits from the dirty worktree.

## D1 Proposed Release Commit Plan

Status before staging:

- Branch: `codex/lead-to-quote-batch`.
- HEAD before D1: `9727e55 feat: add integration setup gates`.
- No push, deploy, production DB command, live Firecrawl run, or cron enablement
  is allowed during D1.
- Use explicit `git add -- <paths>` only. Do not use `git add .`.
- The first broad secret scan reported env var names and placeholder examples
  in docs/tests, not live-looking secrets. Continue with stricter real-secret
  scanning before staging.

Manifest buckets:

- A. Prisma baseline: `prisma/migrations/00000000000000_baseline_pre_brain`,
  `prisma/migrations/migration_lock.toml`,
  `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`.
- B. Memory foundation: memory Prisma migration, core memory ingest/event/
  backfill/search modules, backfill script, memory write hooks in existing
  Gmail/WhatsApp/Sheets/inquiry/job/quote/strategy flows, and memory smoke test.
- C. Memory usefulness/retrieval: customer dossier, morning brief, memory
  doctor, canonical taxonomy, hybrid search, relevance/evidence helpers,
  memory search/morning brief tests, and agent memory context/tool updates.
- D. Market intelligence core: `MarketSignal`, `MarketSignalLink`, market
  registry/policy, market source/object ingestion, extraction/linking, market
  tools, strategy/risk context hooks, and market intelligence smoke test.
- E. Impact review/feedback: `MarketImpactReview`,
  `MarketSignalFeedback`, review service, review/feedback tools, market impact
  tests, and doctor/reporting support.
- F. Firecrawl/Research Inbox: Firecrawl client, Firecrawl ingestion path,
  `MarketIngestionRun`, `/dashboard/intelligence`, Firecrawl smoke test, and
  live-pilot runbook.
- G. Source quality/scheduling: source quality ranking, scheduled ingestion,
  market cron route, source quality and scheduled ingestion tests, and ranked
  Research Inbox/Morning Brief behavior.
- H. Security/hardening: OAuth token encryption compatibility, portal token
  hardening, quote PDF escaping, Firecrawl/live-ingestion guards, tenant audit
  improvements, security tests, and Gmail token runbook.
- I. H2 hygiene/suppression: failed POLB fixture, content hygiene, signal
  suppression, extraction gates, social-link blocking, suppression labels, and
  H2 tests.
- J. Docs/protocol: AGENTS files, collaboration protocol, handoff/log,
  company-brain and market docs, decisions, deep discovery, next task, and
  intentionally repo-scoped `.codex/rules`.
- K. Excluded unless explicitly intended: `.env`, `.env.local`, `.next/`,
  `node_modules/`, local DB files, logs, raw secrets, and generated artifacts.

Commit plan:

1. `chore(db): add pre-brain prisma baseline`
   - Include baseline migration, migration lock, and baseline deployment runbook.
   - Why: clears fresh staging migration history.
   - Caveat: docs/log references are finalized in the docs commit to avoid
     patch-staging huge untracked handoff files.
2. `feat(memory): add company brain memory foundation`
   - Include memory models/migration, core memory write modules, backfill, and
     memory emitters across existing freight flows.
   - Caveat: some mixed files also contain later agent/market hooks; use the
     smallest coherent full-file staging where patch-staging is not practical.
3. `feat(memory): add dossiers, morning brief, retrieval, and evidence`
   - Include dossier, morning brief, memory doctor, canonical taxonomy, hybrid
     retrieval, evidence/relevance, memory tests, and agent memory usage.
4. `feat(market): add market intelligence signal pipeline`
   - Include market source/object ingestion, source registry/policy, signal
     extraction/linking, market tools, strategy/risk market context, and market
     tests.
5. `feat(market): add impact reviews and feedback loop`
   - Include review/feedback schema, review service, feedback tools, impact
     tests, and doctor support.
6. `feat(market): add firecrawl ingestion and research inbox`
   - Include Firecrawl client/ingestion, `MarketIngestionRun`, Research Inbox
     page/nav/styles, Firecrawl tests, and live-pilot docs.
7. `feat(market): add source quality and scheduled ingestion controls`
   - Include source quality, scheduled ingestion, market cron route, ranking
     behavior, and scheduling/source-quality tests.
8. `chore(security): harden tokens portal pdf and ingestion guards`
   - Include token encryption, portal token access, quote PDF escaping, live
     ingestion gates, tenant audit, `.env.example`, and security tests.
9. `fix(market): add extraction hygiene and signal suppression`
   - Include H2 content hygiene, suppression helpers, failed pilot fixture,
     extraction/link hygiene, suppression behavior, and H2 tests.
10. `docs: add ai collaboration handoff and deployment runbooks`
    - Include protocol docs, handoff/log/decisions, AGENTS files, runbooks, and
      repo-scoped Codex rules.

Verification after commits:

- Run the full D1 suite: `npx prisma validate`, `npm run db:generate`,
  `npx tsc --noEmit`, all memory/market/security tests, doctors, tenant audit,
  `npm run build`, and `npm run ai:handoff`.

## D2 Preview/Staging Deployment Prep

Status:

- Completed on 2026-06-22.
- Branch pushed: yes.
- Branch: `codex/lead-to-quote-batch`.
- Pushed head: `e9aa328 docs: add ai collaboration handoff and deployment runbooks`.
- Remote branch verified at `origin/codex/lead-to-quote-batch`.
- No production deploy was run.
- No production database command was run.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.
- Operational records were not mutated.

Repository checks:

- `git status --short`: clean before push.
- `git branch --show-current`: `codex/lead-to-quote-batch`.
- `git log --oneline -n 12`: release commit stack from
  `a9c48d9` through `e9aa328` is present.
- `npx tsc --noEmit`: passed before push.

Remote and Vercel status:

- Git remote: `origin` is the GitHub SSH remote for `mmturna/derya-crm`.
- Push succeeded with a fast-forward branch update from `9727e55` to
  `e9aa328`.
- Vercel CLI is not installed in this shell.
- No `.vercel/project.json` link file is present.
- Vercel Git integration could not be detected locally. If the Vercel project
  is connected to this GitHub repo, the branch push should create a Preview
  deployment. Check the Vercel dashboard under the Derya project deployments
  for branch `codex/lead-to-quote-batch`.
- Preview URL: not available from local tooling during D2.

Preview/staging environment status:

Local env presence was checked without printing values. This is not proof that
Vercel Preview env vars are configured, because Vercel CLI was unavailable.

| Variable | Local presence | Vercel Preview status |
| --- | --- | --- |
| `DATABASE_URL` | yes | unknown |
| `DATABASE_URL_UNPOOLED` | yes | unknown |
| `DIRECT_URL` | no | unknown |
| `TOKEN_ENCRYPTION_KEY` | no | unknown |
| `CRON_SECRET` | yes | unknown |
| `ANTHROPIC_API_KEY` | yes | unknown |
| `OPENAI_API_KEY` | yes | unknown |
| `GOOGLE_CLIENT_ID` | no | unknown |
| `GOOGLE_CLIENT_SECRET` | no | unknown |
| `GOOGLE_REDIRECT_URI` | no | unknown |
| `FIRECRAWL_API_KEY` | yes | unknown |
| `MARKET_INTELLIGENCE_PROVIDER` | yes | unknown |
| `MARKET_INTELLIGENCE_CRON_ENABLED` | yes, disabled | unknown |
| `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN` | yes | unknown |
| `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN` | yes | unknown |
| `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN` | yes | unknown |
| `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET` | yes | unknown |
| `DOCUMENT_STORAGE_DRIVER` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_BUCKET` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_REGION` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_ENDPOINT` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_ACCESS_KEY_ID` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY` | documented in `.env.example` | unknown |
| `DOCUMENT_STORAGE_S3_SESSION_TOKEN` | documented in `.env.example` | unknown |

Safe Preview market-intelligence values:

- `MARKET_INTELLIGENCE_CRON_ENABLED=false`
- `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN=3`
- `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN=3`
- `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN=1`
- `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET=25`

Database status:

- Local `DATABASE_URL` and `DATABASE_URL_UNPOOLED` point to a local Postgres
  database named `derya_crm_app`.
- No staging `DATABASE_URL` was explicitly available locally.
- Staging migration was therefore skipped. That is intentional. Do not run
  `migrate deploy` against an unknown database.
- For a fresh staging database, run:

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

- For an existing staging database with the pre-brain schema but no migration
  history, follow `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`. Do not stamp
  the baseline unless a diff proves the database matches the pre-brain schema.
- Do not use `db push`, `migrate dev`, or `migrate reset` for staging or
  production.

Build/deploy requirements:

- `postinstall` runs `prisma generate`.
- `build` runs `prisma generate && next build`.
- No live Firecrawl ingestion runs during install or build.
- No database migration runs during install or build.
- `vercel.json` contains cron entries for risk scan, Gmail sync, and
  background jobs. Market intelligence cron is not listed there and remains
  gated in code by env flags.

Preview smoke-test checklist once the Preview URL exists:

- App loads.
- Login works.
- `/dashboard` loads.
- `/dashboard/intelligence` loads.
- Research Feed, Market Signals, and Impact Reviews render.
- Customer and job pages load.
- Morning Brief renders without recommending suppressed market signals.
- Quote PDF route works.
- A valid portal token works.
- `job.id` as a portal token fails.
- Gmail OAuth callback URI matches the Preview URL or Gmail is intentionally
  production-only for this Preview.
- Cron routes reject unauthenticated calls.
- Market cron remains disabled.
- `npm run memory:doctor` and `npm run market:doctor` pass against staging if
  run from an environment configured for the staging database.

Blockers:

- Vercel Preview deployment status could not be verified locally because the
  Vercel CLI is unavailable and the repo is not locally linked with
  `.vercel/project.json`.
- Vercel Preview env var presence could not be checked locally.
- Staging migrations were not run because no explicit staging database URL was
  available locally.
- `TOKEN_ENCRYPTION_KEY`, Gmail OAuth vars, and Preview document-storage vars
  must be confirmed in Vercel before realistic Preview testing.

Recommended next step:

- Confirm Vercel Git integration created a Preview for
  `codex/lead-to-quote-batch`.
- Configure/verify Preview env vars with safe market-intelligence defaults.
- Run staging migrations only against a confirmed staging database.
- Then run D3 staging smoke tests.

## D3A-FIX Vercel Hobby Cron Compatibility

Status:

- Completed on 2026-06-22.
- Goal: unblock Vercel Preview deployment on a Hobby account after Vercel
  rejected a sub-daily cron expression before build.
- Production deploy was not run.
- Production database commands were not run.
- Live Firecrawl ingestion was not run.
- Market intelligence cron was not enabled.

Problem:

- Vercel rejected the project because Hobby accounts only allow cron schedules
  that run at most once per day.
- The invalid schedule was `/api/cron/background-jobs` with
  `*/10 * * * *`, which runs every ten minutes.

Change:

- Updated `vercel.json` so every configured cron runs no more than once per
  day.
- Kept existing cron auth behavior intact; routes still require `CRON_SECRET`
  checks in code.
- Market intelligence scheduled ingestion remains disabled by env and is not
  configured in `vercel.json`.

Cron schedules after the fix:

- `/api/cron/risk-scan`: `0 6 * * *`
- `/api/cron/gmail-sync`: `0 7 * * *`
- `/api/cron/background-jobs`: `0 9 * * *`

Operational note:

- Frequent background processing should move to Vercel Pro, an external
  scheduler, or a manual/operator-triggered sync path later. Do not sneak
  sub-daily schedules back into `vercel.json` while deploying on Hobby.

Verification:

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `npm run ai:handoff`: passed.

## D3B Preview Runtime, Env, Staging DB, And Smoke Test

Status:

- Run on 2026-06-22.
- Preview deployment status from founder input: Ready.
- Preview URL:
  `https://derya-crm-git-codex-lead-to-quote-batch-merts-projects-b132014b.vercel.app`
- Branch: `codex/lead-to-quote-batch`.
- Preview commit: `3ab82df`.
- Production remains old at `main @ 49d7154`.
- No merge to main was performed.
- No production deploy was run.
- No production database command was run.
- No live Firecrawl ingestion was run.
- Market intelligence cron was not enabled.
- No customer/supplier messages were sent.

Local release state:

- Worktree was clean before D3B docs were updated.
- Branch: `codex/lead-to-quote-batch`.
- Head commit: `3ab82df fix(deploy): make vercel crons hobby-compatible`.
- `npx tsc --noEmit`: passed.

Preview HTTP checks:

- `/`: `401 Authentication Required`.
- `/login`: `401 Authentication Required`.
- `/dashboard`: `401 Authentication Required`.
- `/dashboard/intelligence`: `401 Authentication Required`.
- `/api/health`: `401 Authentication Required`.
- Cron routes checked without secret also returned the Vercel deployment
  protection page before app-level cron auth could run.

Conclusion:

- Vercel has the deployment Ready, but the Preview is protected by Vercel
  deployment authentication. The app shell, login page, dashboard, intelligence
  page, health endpoint, and app-level cron behavior could not be verified from
  this unauthenticated shell.

Preview env readiness:

- Vercel CLI is not installed locally.
- The repo has no `.vercel/project.json` link.
- `/api/health` could not be reached because Preview deployment protection
  returns `401`.
- Therefore Preview env vars are `unknown` from this environment. Do not infer
  they are configured just because the deployment built.

| Variable | Preview status |
| --- | --- |
| `DATABASE_URL` | unknown |
| `DATABASE_URL_UNPOOLED` or `DIRECT_URL` | unknown |
| `TOKEN_ENCRYPTION_KEY` | unknown |
| `CRON_SECRET` | unknown |
| `ANTHROPIC_API_KEY` | unknown |
| `OPENAI_API_KEY` | unknown |
| `GOOGLE_CLIENT_ID` | unknown |
| `GOOGLE_CLIENT_SECRET` | unknown |
| `GOOGLE_REDIRECT_URI` | unknown |
| `FIRECRAWL_API_KEY` | unknown |
| `MARKET_INTELLIGENCE_PROVIDER` | unknown |
| `MARKET_INTELLIGENCE_CRON_ENABLED` | unknown |
| `MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN` | unknown |
| `MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN` | unknown |
| `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN` | unknown |
| `MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET` | unknown |

Staging database migration status:

- Staging DB provider input: unknown.
- Confirmed staging DB separate from production: unknown.
- Founder confirmation that it is safe to migrate: not available in this run.
- Migrations were skipped intentionally.
- Do not run `migrate deploy` until `DATABASE_URL` is confirmed to point to a
  staging/preview database that is separate from production.
- Do not use `prisma db push`, `migrate dev`, or `migrate reset`.

Build/deploy assumptions verified from repo:

- `postinstall` runs `prisma generate`.
- `build` runs `prisma generate && next build`.
- No database migration runs during Vercel build.
- No live Firecrawl ingestion runs during build.
- `vercel.json` schedules all configured crons daily for Hobby compatibility.
- App cron routes require `CRON_SECRET` checks in code, although Vercel
  deployment protection prevented external unauthenticated route testing from
  reaching the app.
- Market intelligence cron remains env-gated and is not listed in
  `vercel.json`.

Manual smoke-test checklist once Preview protection access is available:

- App shell loads.
- Login page loads or dashboard redirects correctly.
- Login works with staging credentials only.
- `/dashboard` loads.
- `/dashboard/intelligence` loads.
- Research Feed section loads.
- Market Signals section loads.
- Impact Reviews section loads.
- Customer page loads.
- Job page loads.
- Morning Brief loads.
- Quote PDF route works.
- A valid portal token works.
- `job.id` as portal token fails.
- Gmail OAuth link/callback uses the expected Preview redirect URI, or Gmail is
  intentionally production-only for Preview.
- Cron routes reject unauthenticated calls after bypassing Vercel deployment
  protection.
- Market cron remains disabled.

Blockers:

- Preview deployment protection blocks unauthenticated smoke tests.
- Preview env var status is unknown without Vercel CLI/dashboard access or an
  accessible `/api/health`.
- Staging DB provider and production separation are unknown, so migrations were
  correctly skipped.

Recommended next step:

- Provide Vercel Preview access or a Vercel bypass token for smoke testing, or
  run the manual checklist in the Vercel-authenticated browser.
- Confirm Preview env vars in the Vercel dashboard without exposing values.
- Confirm staging DB provider and separation from production.
- Run `prisma migrate deploy` only after staging DB safety is confirmed.
- Proceed to H2.2 staging Firecrawl pilot only after Preview app boots,
  staging DB is migrated, `/dashboard/intelligence` loads, and smoke checks are
  clean.

## D3C-DB Preview Runtime Database Fix Attempt

Status:

- Run on 2026-06-22.
- Preview deployment is Ready, but runtime logs show the Preview app is
  connected to a database whose schema is older than the release branch.
- No merge to main was performed.
- No production deploy was run.
- No production database command was run.
- No migration was run.
- No `prisma db push`, `migrate dev`, or `migrate reset` command was run.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.

Root cause from Preview runtime logs:

- `PrismaClientKnownRequestError P2022`: `Inquiry.containerCount` does not
  exist in the current database.
- `PrismaClientKnownRequestError P2021`: table `public.AgentProposal` does not
  exist in the current database.
- This is a runtime database schema mismatch, not a Vercel build problem.

Local release state:

- Branch: `codex/lead-to-quote-batch`.
- Head commit: `3ab82df fix(deploy): make vercel crons hobby-compatible`.
- `npx tsc --noEmit`: passed.
- Worktree already had uncommitted D3B docs changes before D3C docs were
  appended.

Database target check:

- Local `DATABASE_URL`: configured, but points to local Postgres database
  `derya_crm_app`.
- Local `DATABASE_URL_UNPOOLED`: configured, but points to the same local
  database.
- Local `DIRECT_URL`: not configured.
- Local target appears staging/preview: no.
- Staging database provider input: not provided.
- Confirmed staging database separate from production: not provided.
- Founder confirmation it is safe to migrate: not available in this run.

Decision:

- Migrations were intentionally skipped. Running `prisma migrate deploy`
  without a confirmed staging database would be a blind database operation.

Preview env readiness:

- Vercel CLI is not installed locally.
- No `.vercel/project.json` link exists.
- Preview `/api/health` is still protected by Vercel deployment authentication.
- Preview env var status remains unknown from this shell.
- Local env status is not equivalent to Vercel Preview env status.

Preview HTTP check:

- `/`: `401 Authentication Required`.
- `/login`: `401 Authentication Required`.
- `/dashboard`: `401 Authentication Required`.
- `/dashboard/intelligence`: `401 Authentication Required`.
- `/api/health`: `401 Authentication Required`.

Required next step:

1. Create or identify a staging database that is explicitly separate from
   production.
2. Configure Vercel Preview `DATABASE_URL` and `DATABASE_URL_UNPOOLED` or
   `DIRECT_URL` to that staging database.
3. Confirm safe Preview env values without exposing secrets:
   `MARKET_INTELLIGENCE_CRON_ENABLED=false`,
   `MARKET_INTELLIGENCE_PROVIDER=firecrawl`, and conservative market limits.
4. Apply migrations only against the confirmed staging database:

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

5. Expected final diff: `No difference detected`.
6. Redeploy the Preview after env and migrations are correct.
7. Re-run smoke tests with Vercel Preview access or a bypass token.

If the staging database is existing/pre-brain with no migration history:

- Follow `docs/RUNBOOKS/PRISMA_BASELINE_DEPLOYMENT.md`.
- Generate the pre-brain schema from `9727e55`.
- Diff the existing DB against that schema.
- If drift appears, stop.
- Only if it matches, mark
  `00000000000000_baseline_pre_brain` as applied, then run
  `prisma migrate deploy`.

Current blockers:

- Staging DB provider/separation are not confirmed.
- Preview env vars cannot be inspected locally.
- Preview deployment protection blocks external smoke tests.
- Runtime schema mismatch remains until the Preview database is corrected and
  migrated.

Safe-to-proceed status:

- Safe to H2.2 staging Firecrawl pilot: no.
- Safe to production checklist: no.
- Safe next action: configure confirmed staging DB and Preview envs, then run
  migrations against staging only.

## P0 Production Cutover Prep With Fresh Office And Cherry-Pick Import

Status:

- Implemented on 2026-06-23.
- No production database commands were run.
- No production deploy was run.
- No merge to main was performed.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.
- No secrets were printed.

Files added:

- `scripts/create-production-office.ts`
- `scripts/export-office-cherry-pick.ts`
- `scripts/import-office-cherry-pick.ts`
- `scripts/validate-office-import.ts`
- `docs/RUNBOOKS/PRODUCTION_CUTOVER_CHERRY_PICK.md`

Files updated:

- `package.json`
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`

New package scripts:

- `npm run seed:production-office`
- `npm run export:office-cherry-pick`
- `npm run import:office-cherry-pick`
- `npm run validate:office-import`

Cutover model:

- Create a fresh Neon production database on the current schema with
  `prisma migrate deploy`.
- Create a new real Office/Admin with `npm run seed:production-office`.
- Export selected safe business data from the old database to JSON.
- Import that JSON into the new Office after a dry run.
- Validate the import before setting Vercel Production env vars and merging to
  main.

Safety model:

- Production office creation requires `ALLOW_PRODUCTION_OFFICE_SEED=1`.
- Cherry-pick import defaults to dry run and requires
  `ALLOW_CHERRY_PICK_IMPORT=1` plus `DRY_RUN=false` for writes.
- Export uses `OLD_DATABASE_URL`; import uses `DATABASE_URL`.
- Old Gmail OAuth tokens are never exported or imported.
- Sessions and password hashes are not exported.
- Old portal tokens are not exported. Jobs that had old portal tokens get new
  64-hex random tokens during import.
- Background jobs are not copied.
- Company-brain memory rows and market-intelligence rows are not copied.
- Agent proposals and forwarder draft send artifacts are not copied.
- Documents are metadata-only. Job document URLs are null; company document
  URLs use a `metadata-only://...` sentinel because the schema requires a URL.

Safe imported data:

- companies
- contacts
- company owner references by safe user email only
- activities
- quotes
- shipment records
- inquiries
- active jobs by default
- milestones
- document metadata
- carrier quotes
- forwarders
- lane rates
- margin profiles
- target price history

Email import:

- Off by default with `INCLUDE_EMAILS=false`.
- If enabled, email threads/messages are sanitized and imported without
  accounts, OAuth tokens, provider external IDs, Gmail message IDs, HTML bodies,
  or attachment URLs.

Verification:

- Refusal-path smoke checks for the new scripts: passed with expected guard
  errors and no writes.
- `npx prisma validate`: passed.
- `npm run db:generate`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `npm run ai:handoff`: passed.

## Go-Live Merge To Main

Status:

- Completed on 2026-06-23.
- PR #1, `codex/lead-to-quote-batch` -> `main`, was merged with a GitHub merge
  commit.
- Main moved from the old production commit `49d7154` to merge commit
  `debe8182d99f928793c0ba076cbe6d6d7c51346c`.
- The merge commit includes release commit
  `073cd434bff8358a3d660147094273ada5307014`
  (`chore(cutover): add production office and cherry-pick import tooling`).
- The release branch was not deleted.

Production safety:

- No database migrations were run during go-live.
- No `prisma db push`, `migrate dev`, or `migrate reset` command was run.
- Market intelligence cron remained disabled by environment configuration.
- No live Firecrawl ingestion was run.
- No secrets were printed.

Vercel:

- Production deployment should trigger from the `main` branch push/merge.
- Watch Vercel -> Deployments -> Production for source branch `main`.
- The latest production deployment should no longer point at `49d7154`.

Immediate smoke-test checklist:

- Production app loads.
- Login works for `mert@usederya.com`.
- Demo users remain disabled.
- `/dashboard` loads.
- `/dashboard/intelligence` loads without enabling market cron.
- Customer and job pages load.
- Quote PDF route works.
- A valid portal token works; `job.id` as portal token fails.
- Gmail OAuth uses the production redirect URI.
- Cron routes reject unauthenticated calls.
- Market intelligence cron remains disabled.

## Production Smoke Test After Go-Live

Status:

- Run on 2026-06-23 against `https://www.derya.ai`.
- Production deployment status from GitHub/Vercel status API: success /
  deployment completed.
- Production deployment commit from `/api/health`: `408261c`.
- This is newer than old production commit `49d7154` and includes the release
  merge plus the go-live docs commit.

Route smoke results:

- `/`: `307` redirect to `/login`.
- `/login`: `200`.
- `/dashboard`: `307` redirect to `/login`.
- `/dashboard/intelligence`: `307` redirect to `/login`.
- `/dashboard/jobs`: `307` redirect to `/login`.
- `/dashboard/customers`: `307` redirect to `/login`.
- `/dashboard/inbox`: `307` redirect to `/login`.
- `/dashboard/pricing`: `307` redirect to `/login`.
- `/dashboard/settings/email`: `307` redirect to `/login`.
- `/api/health`: `200`, `ok=true`.

Health check:

- `NODE_ENV=production`.
- `VERCEL_ENV=production`.
- `AUTH_SECRET`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, Gmail OAuth envs, and
  `CRON_SECRET` were reported configured by presence only.
- DB ping passed.
- Recent Prisma field checks passed for email threads, jobs, job documents,
  email messages, and background jobs.
- Background job backlog passed with `queued=0`, `failed=0`,
  `staleRunning=0`.

Auth and cron smoke:

- Demo login with `admin@demo.local / admin1234` failed and redirected to
  `/login?error=1`, as expected.
- Real admin login for `mert@usederya.com` was not tested because the password
  was not available in this shell.
- `/api/cron/market-intelligence` without `CRON_SECRET`: `401`.
- `/api/cron/background-jobs` without `CRON_SECRET`: `401`.

Runtime logs:

- Vercel CLI is not installed locally, so runtime logs were not directly
  available from this shell.
- No Prisma `P2021`/`P2022` or env errors appeared through `/api/health`; all
  health checks passed.

Safety:

- No database migrations were run.
- No `prisma db push`, `migrate dev`, or `migrate reset` command was run.
- No old-data import was run.
- No live Firecrawl ingestion was run.
- Market cron was not enabled.

## Derya Brain Ops First Version

Status:

- Implemented on 2026-06-23 in the dirty worktree.
- This task adapted the attached Merlon-style prompt to Codex-native Derya
  conventions.
- No new Prisma schema was added because the repo already has the
  `Knowledge*`/`MemoryEvent`/`AgentProposal` company-brain substrate.

What changed:

- Updated root `AGENTS.md` with Brain Ops rules, prompt-injection handling,
  source citation expectations, and docs/test commands.
- Added `CONTEXT.md` canonical glossary.
- Added status-governed docs under `docs/current-state/`, `docs/brain/`,
  `docs/sops/`, `docs/agent-journal/`, `docs/templates/`, `docs/decisions/`,
  and `docs/gotchas.md`.
- Added `scripts/check-docs-fresh.ts` plus `npm run check:docs` and
  `npm run test:docs`.
- Added Brain Ops controlled service files:
  `src/lib/brain-ops/ingest.ts`, `src/lib/brain-ops/query.ts`, and
  `src/lib/brain-ops/types.ts`.
- Added `npm run test:brain` with `scripts/brain-ops.test.ts`.
- Added repo-scoped Codex skills in `.agents/skills/`.
- Added advisory local Codex hook files in `.codex/hooks/`.

Behavior:

- `applyBrainIngest` validates source payloads and creates a source
  `KnowledgeObject` plus reviewable `AgentProposal` rows.
- Calibration mode does not create final business records.
- Organization linking is exact normalized company-name matching only.
- Similar non-exact organization names stay unresolved.
- Commitments, decisions, risks, and open questions require source quotes
  unless explicitly manually entered.
- `query.ts` exposes read-only helper functions that return source metadata.

Verification passed:

- `npm run test:docs`
- `npm run test:brain`
- `npm run check:docs`
- `npx tsc --noEmit`

Skipped:

- No Prisma migration was generated.
- No production database command was run.
- No live Firecrawl ingestion was run.
- No UI/API routes were added yet.

Follow-up:

- Add an admin-only Brain Ops review surface or API routes that consume the
  existing `AgentProposal` rows.
- If first-class review state outgrows `AgentProposal`, add dedicated proposal
  tables then, with migration and UI semantics decided up front.

## Granola Meeting Notes In Brain Ops

Status:

- Implemented on 2026-06-23 in the dirty worktree.
- Goal: make pasted/exported Granola notes usable as source-backed context for
  company, RFQ, and job workflows without mutating operational records.

What changed:

- Added `granola_meeting_note` as a Brain Ops source type.
- Added `operational_refs` to Brain Ops payloads.
- Exact refs now resolve:
  - `company` by scoped id or exact name
  - `job` by scoped id or exact reference
  - `inquiry` by scoped id or exact subject
  - `contact` by exact email or full name within the office
- Resolved refs are stored on the source `KnowledgeObject` where applicable and
  as `EntityMention` rows.
- Added `getOperationalBrainContext` for customer/job/RFQ workflows to retrieve
  related Granola notes and other source-backed memory.
- Added CLI:

```bash
npm run brain:ingest:granola -- --office=<officeId> --file=<payload.json>
```

Behavior:

- Granola notes default to calibration mode.
- Notes can store full text in `source.raw_text` and a Granola/internal URL in
  `source.source_uri`.
- Bad or typoed operational refs remain unresolved instead of fuzzy-linking.
- Extracted commitments, decisions, risks, and open questions still require
  source quotes and become reviewable `AgentProposal` rows.

Verification passed:

- `npx tsc --noEmit`
- `npm run test:brain`

Skipped:

- No Prisma migration was generated.
- No production database command was run.
- No live external ingestion was run.

## Granola Brain Ops Hardening Pass

Status:

- Implemented on 2026-06-23 in the dirty worktree.
- Goal: make the existing Granola Brain Ops extension safer and more
  repeatable without redesigning the schema.

What changed:

- Exact duplicate payloads are now idempotent. Re-running the same Granola
  payload returns the existing source object and proposal rows.
- Granola notes now require either `source.raw_text` or `source.source_uri`.
- If `userId` is supplied to ingest, it must belong to the same `officeId`.
- Ambiguous exact matches for non-unique records, such as duplicate contact
  emails or duplicate RFQ subjects, remain unresolved instead of using
  first-row behavior.
- Added conservative support for id-only operational refs to email threads,
  email messages, job documents, and strategy assessments.
- Expanded `scripts/brain-ops.test.ts` around duplicate ingest, ambiguous refs,
  cross-office actor rejection, evidence-less Granola rejection, and scoped
  job-document refs.

Verification passed:

- `npm run test:brain`
- `npm run check:docs`
- `npm run test:docs`
- `npx tsc --noEmit`
- `npm run build`

Skipped:

- No Prisma migration was generated.
- No production database command was run.
- No live external ingestion or Firecrawl run was performed.
- No `.env` values were inspected or printed.

## Live Intelligence Map And Manual Ingestion UI

Status:

- Implemented on 2026-06-23 in the main-branch dirty worktree.
- Goal: make `/dashboard/intelligence` operationally usable in production
  without enabling scheduled ingestion or running local live Firecrawl from
  Codex.

What changed:

- Added `getIntelligenceMapData(officeId)` for deterministic world-map data.
- Added a local SVG world map, clickable hotspot panel, source cards, visual
  icons, and admin manual ingestion controls.
- Added a visible first-ingestion empty state so production does not look like a
  decorative empty dashboard when Research Feed / Market Signals / Impact
  Reviews are all empty.
- Added runtime readiness badges for Firecrawl, manual-live enablement, cron
  disabled state, provider, safe source count, and result/page clamps.
- Replaced the old permissive inline "Run one" action with an admin-only manual
  ingestion action.
- Manual live ingestion requires
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` and refuses to run while
  `MARKET_INTELLIGENCE_CRON_ENABLED=true`.
- Manual source allowlist is restricted to Maersk, Drewry WCI, CBP CSMS, and
  Port of Los Angeles. FreightWaves/JOC/media are not available by default.
- Manual pulls clamp to one source and three results/pages.
- Added a safe bundle action for Maersk + Drewry WCI + CBP CSMS only.

Safety:

- No Prisma migration was needed.
- No live Firecrawl ingestion was run locally.
- No scheduled market cron was enabled.
- External intelligence remains advisory and does not mutate jobs, RFQs, quotes,
  customers, milestones, prices, or messages.

Verification to run before deploy:

```bash
npx tsc --noEmit
npm run test:intelligence-map
npm run test:manual-market-ingestion-action
npm run test:intelligence-page-empty-state
npm run test:market-content-hygiene
npm run test:market-signal-suppression
npm run test:source-quality
npm run test:market-intelligence
npm run test:market-impact
npm run build
npm run ai:handoff
```

Production use:

- Ensure Vercel Production has
  `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true` before using the live button.
- Keep `MARKET_INTELLIGENCE_CRON_ENABLED=false`.
- First manual source should be `maersk-news-advisories`.
- Review Research Feed, Market Signals, and Impact Reviews before acting.

## Intelligence Page Visibility Fix

Status:

- Implemented on 2026-06-23 after production screenshot review.
- Goal: make the live intelligence map and detail panels readable under the
  beige Derya production theme.

What changed:

- Added solid dark fallback backgrounds to the map shell, hotspot panel, metric
  cards, and source cards so global `background-image: none !important` theme
  rules cannot leave white text on beige panels.
- Increased foreground contrast for headings, summaries, recommended actions,
  affected work pills, source metadata, and metric labels.
- Added dark SVG text strokes behind map labels so hotspot text remains readable
  over route arcs and glowing pins.
- Brightened latitude/longitude labels and map grid contrast.

Verification:

- `npx tsc --noEmit`
- `npm run test:intelligence-map`
- `npm run test:intelligence-page-empty-state`
- `npm run build`

## Intelligence Map Accuracy And CBP Lane Validation

Status:

- Implemented on 2026-06-23 after production showed fake geography and CBP
  pseudo-lanes on `/dashboard/intelligence`.

What changed:

- Replaced the hand-drawn blob map with a local Natural Earth 1:110m land asset
  (`src/lib/market-intelligence/world-map-asset.ts`). This is an existing
  public-domain map dataset rendered offline; no external tile provider or live
  map API is used.
- Added deterministic freight geography in
  `src/lib/market-intelligence/lane-validation.ts` for known ports, regions,
  countries, and chokepoints.
- Valid lanes must normalize to known freight locations. Boilerplate phrases
  such as `Countdown`, `Welcome`, `Messaging Service`, `Updates`, `Search`, and
  `Archive` are rejected.
- CBP/regulatory extraction now models clean items as U.S. customs/compliance
  context unless clean article body evidence contains a validated freight lane.
- Map data, Morning Brief, strategy/agent market tools, and signal suppression
  now filter invalid lane links. Bad historical links remain visible as
  suppressed/audit data, not recommended affected work.
- Added guarded cleanup script:
  `ALLOW_MARKET_REVIEW_CLEANUP=1 npm run cleanup:bad-cbp-market-reviews`.
  It dismisses pending CBP pseudo-lane reviews and records `wrong_link`
  feedback; it does not delete records or mutate operational freight data.
- Added daily market cron entry in `vercel.json`:
  `/api/cron/market-intelligence` at `0 11 * * *`. Live execution still requires
  `CRON_SECRET` and `MARKET_INTELLIGENCE_CRON_ENABLED=true`.
- Daily automation defaults to one safe source/day, three pages/results, and a
  safe source rotation of Maersk, Drewry WCI, CBP CSMS, and Port of Los Angeles.
  FreightWaves/JOC/media are excluded.

Verification passed:

```bash
npx tsc --noEmit
npm run test:market-lane-validation
npm run test:market-signal-suppression
npm run test:intelligence-map
npm run test:scheduled-market-ingestion
npm run test:market-content-hygiene
npm run test:market-intelligence
npm run test:manual-market-ingestion-action
npm run test:source-quality
npm run test:market-impact
npm run test:firecrawl
npm run test:morning-brief
npm run market:doctor
npm run memory:doctor
npm run build
npm run ai:handoff
```

Safety:

- No live Firecrawl ingestion was run.
- No Prisma migration was needed.
- No cleanup was run against production.
- Keep `MARKET_INTELLIGENCE_CRON_ENABLED=false` until operators explicitly want
  the daily cron active.

## V2 Intelligence Map Visual QA

Status:

- Implemented on 2026-06-23 for the production Intelligence page readability
  and trust issue.

What changed:

- The Intelligence map now renders Natural Earth public-domain land geometry
  plus visible reference labels for continents, key freight ports, and
  chokepoints. This prevents the map from degrading into a dark decorative
  canvas when few market signals are present.
- The map base was brightened with stronger coastline contrast and a darker
  ocean background so white and cyan labels remain readable.
- Empty map copy now says: `Pull trusted market data to light up the map.`
- Hotspot evidence refs are collapsed behind a details control so operator
  actions and affected work remain the dominant text.
- The map regression test now asserts that the component uses the Natural Earth
  asset and includes port/chokepoint reference layers.

Cleanup:

- Production CBP cleanup was not run from the local shell because
  `DATABASE_URL` was not configured and therefore could not be confirmed as the
  production Neon database. Use this only after explicitly exporting the
  confirmed production URL:

```bash
ALLOW_MARKET_REVIEW_CLEANUP=1 npm run cleanup:bad-cbp-market-reviews
```

Verification:

- `npx tsc --noEmit`
- `npm run test:intelligence-map`
- `npm run test:market-lane-validation`
- `npm run test:market-signal-suppression`
- `npm run test:market-content-hygiene`
- `npm run test:source-quality`
- `npm run test:market-intelligence`
- `npm run test:market-impact`

## China hardware history and customs operator guide

Status:

- Implemented on 2026-07-23 on `find-hardware-import-data`.
- Local commits are recorded in git history. The branch is not assumed to be
  pushed.

What changed:

- Census snapshot schema v4 adds a China-only fixed 43-code vessel history for
  every complete year from 2010 through 2025 plus May 2026 YTD. The current
  five-year all-origin and category detail keeps the 46-code current basket.
  The two series are deliberately separate.
- The compact artifact contains 17 China history periods, 34 unique official
  Census ZIP URLs, one Schedule C dictionary source, exact archive checksums,
  fixed-code coverage validation, and an atomic 1.3 MB byte ceiling.
- The China report now uses two accessible trend charts for nominal vessel
  value and China basket share. Exact annual values and their State Imports
  HS6 and Port Imports HS6 files remain in a keyboard-accessible disclosure.
- The report evidence ledger now includes all China-watch sources. The header
  identifies the 46-code current basket and 43-code fixed history separately.
- A deterministic China-to-U.S. customs guide adds eight ordered decision
  gates: classification, origin and marking, valuation, tariff stack, product
  admissibility, UFLPA traceability, importer and entry ownership, and ocean
  filing.
- The guide uses 47 official authority and guidance references. Its source
  review order separates controlling authority, fact-matched rulings or scope
  decisions, current implementation guidance, and handbook context.
  Publication, effective, expiration, handbook revision, page modification,
  source review, and rule as-of dates remain separate.
- Twelve feature-driven product screens cover FCC, separate FDA medical-device
  and radiation-product branches, CPSC, lithium batteries, general hazardous
  materials and vessel carriage, NRC nuclear imports, EPA engines, EPA FIFRA
  pesticides and devices, EPA refrigerant equipment, DOE covered equipment,
  and APHIS solid wood packaging. Finished refrigerant-charged equipment is
  not treated as bulk refrigerant or as transport-exempt without product
  facts.
- The UI shows active and upcoming quote-changing actions, derives its alert
  order from domain data, exposes the next revalidation boundary, and keeps
  the detailed gates, document packet, evidence hierarchy, and historical
  timeline collapsed by default.
- The July 23 USTR forced-labor Section 301 final action is represented as an
  upcoming July 24 action. Its 12.5 percent rate, HTSUS 9903.05.31, Annex
  exemptions, and July 28 in-transit deadline remain subject to shipment-level
  verification.
- Exact EDT boundary instants are stored separately from legal dates. The
  report displays the next boundary in West Coast local time and the official
  Eastern cutoff, and temporal tests cover the second immediately before and
  at the July 24 switch.
- The responsive exact-value table groups each year's West Coast value, share,
  and source separately from its California value, share, and source. Chart
  descriptions name both series and their endpoints. The primary report uses
  sections 01 through 06, while the all-origin report is Appendix A.
- The authenticated China watch JSON contract is schema v2 and includes the
  customs guide. The embedded Census snapshot contract is schema v4.

Trust boundaries:

- The 2010-to-2025 values are nominal customs value and are not adjusted for
  inflation.
- The long-run series excludes HS 8485, 8806, and 8807 because those groups
  entered in 2022. Do not splice the 46-code current view into the 43-code
  trend.
- Customs gates organize evidence collection. They do not calculate a duty,
  issue a ruling, promise clearance, or replace a licensed customs broker or
  legal review.
- Current regulatory status is frozen to `rulesAsOf=2026-07-23`. Revalidate
  every time-limited or upcoming action for the expected entry date.
- Census aggregates still do not identify an importer, supplier, loading port,
  carrier service, shipment, rate, qualified lead, or recommended route.

Verification completed before handoff:

- `npm run test:intel-census-public-hardware`
- `npm run test:intel-corridor-watch`
- `npm run test:intel-china-customs-guide`
- `npm run test:intel-china-watch-export`
- `npm run test:intel-hardware-export-route`
- `npm run test:intel-ocean-hardware`
- `npm run test:intel-sources`
- `npm run test:intel-report-ui`
- `npm run test:intel-boundary`
- `npx tsc --noEmit --incremental false`
- production `npm run build` against local Postgres

Handoff checks completed:

- Authenticated responsive browser review at 390, 768, and 1440 pixel widths.
- Exact-value evidence navigation opens the collapsed evidence ledger and
  positions the selected source.
- No horizontal overflow and no product console errors on a clean reload.
- Refresh current tariff and agency actions for the expected entry date before
  relying on the guide.

## China load trial readiness, July 27 regulatory refresh

Status:

- Implemented on `find-hardware-import-data`.
- The authenticated test surface remains `/dashboard/intel/load`.
- The branch still requires a successful remote push before another machine
  can use it.

What changed:

- The customs rules snapshot is current through
  `2026-07-27T19:10:49.000Z`. Source records keep their individual review
  timestamps, so a July 27 rule refresh does not falsely relabel every older
  handbook or guidance review as new.
- The July 24 Section 122 cutoff is represented as expired. The USTR July 23
  final action uses HTSUS 9903.05.31 and the stated 9903.05.85 through
  9903.05.92 exceptions, while still blocking shipment duty output until the
  current HTS and filing instructions are confirmed.
- The July 16 FCC prohibition for certain previously authorized Covered List
  equipment is current. FCC 26-50 is separately labeled upcoming because
  Federal Register publication and its effective date were not available at
  the review timestamp. The FCC Covered List source is dated July 7.
- EPA's HFC Technology Transitions reconsideration is current on July 27.
  Because the authority supplies a date without an exact timestamp, the report
  displays date precision instead of inventing a time or zone.
- Rules freshness now evaluates both exact-instant and date-only boundaries.
  A date-only boundary can invalidate an older snapshot instead of being
  silently ignored.
- The assessment carries all 49 referenced authority records with status,
  effective window, caveat, source identity, review provenance, and the report
  gates, agency screens, or timing actions that use each authority.
- Questions are prioritized and separated into Mert, supplier, and broker or
  importer ownership. UFLPA, ISF, triggered agency, and deadline-sensitive
  questions are no longer displaced by a twelve-item list of generic field
  prompts.
- AI and source-text facts can be explicitly selected and confirmed in one
  rebuild. Selection alone has no effect, and each confirmed value keeps the
  operator-review boundary. Local fallback extraction is visibly labeled.

Trust boundary:

- The review remains in memory and performs no Prisma, RFQ, shipment, filing,
  provider, customer, or company-brain write.
- It does not calculate duty, establish origin or classification, decide
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
