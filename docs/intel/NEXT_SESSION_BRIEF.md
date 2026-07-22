# Build the Derya Intelligence Layer ("Intel")

You are building the intelligence layer for Derya (this repo: Next.js 15 App Router + TypeScript + Prisma + Neon Postgres, deployed on Vercel at derya.ai). Derya runs a freight brokerage niche: high-value, security-sensitive tech freight for California hardware companies (servers/GPUs, semicap tools, lithium batteries, networking gear, robotics, instruments). Read `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, and `docs/intel/SOURCES.md` before writing code.

## Mission

An operator types any shipment or market question ("8 pallets of battery modules Fremont to Austin, $180k, Friday pickup", "what duty does a China-origin network switch pay", "is carrier DOT 1234567 safe to use", "what is the market on SF to Phoenix") and gets back a decision-grade answer built from CITED PUBLIC DATA: real duty rates, real rulings, real insurance filings, real carrier safety records, real market indexes. The bar: every answer must beat a generic ChatGPT response because every number is traceable to a named public source. An uncited number is a bug.

## Non-negotiables

1. **Isolated silo.** All new code lives in `src/lib/intel/` (engine, sources, fetchers, parsers) and `src/app/dashboard/intel/` (routes/UI). The rest of the app may import from intel only through a small index (`src/lib/intel/index.ts`); intel may import shared primitives (prisma, auth, sheet-cells, icon) but nothing feature-specific. The goal: this module could be extracted to its own service later without surgery. First task: absorb the existing intel-ish libs into the silo with re-export shims so nothing breaks: `src/lib/load-check.ts` (~30-rule deterministic pre-flight engine, heavily tested), `src/lib/load-check-extract.ts` (Haiku free-text parser), `src/lib/load-check-enrich.ts` (HTS duty + CROSS rulings + FMCSA L&I facts), `src/lib/market-indicators.ts` (EIA/BLS/FMCSA/Census baseline), plus their UI (`load-check-panel.tsx`, `market-baseline.tsx`) and tests (`scripts/load-check*.test.ts`, `scripts/market-indicators.test.ts`).

2. **The Source Registry is the spine.** Create `src/lib/intel/sources.ts`: a typed registry where every source is `{ id, name, publisher, homepage, access: keyless|free_key|manual, cadence, cacheSeconds, reachableFromVercel: boolean, notes }`. Every fetcher returns facts tagged `{ sourceId, asOf, fetchedAt }`. No fetch outside the registry.

3. **The Sources button.** Every intel widget, tile, answer, and report renders a small corner affordance (a compact "Sources" chip/button) that opens a popover listing exactly the sources used for what is on screen: name, deep link, data as-of date, cache age. Exported/persisted reports append a plain-text sources footer. This is a product feature, not a footnote: it is the visible proof that the answer is not made up.

4. **Public data, maximally.** Free and public first, always. Keys already live in Vercel env (never in the repo): `CENSUS_API_KEY`, `EIA_API_KEY`, `ANTHROPIC_API_KEY`. Mert will do free signups when asked (FMCSA QCMobile webkey via login.gov, optional BLS key). Monthly manual steps are acceptable if documented as ops tasks (FBI cargo-theft CSV ETL, BTS TransBorder downloads). No paid sources may be assumed.

5. **Deterministic before LLM.** The AI (Haiku, pattern in `load-check-extract.ts`) only parses free text into structured intent/entities. Every fact comes from a deterministic resolver against the registry; every judgment comes from a rule with a citable basis. Answers compose facts + rules; the LLM never generates facts.

## v1 scope (in priority order)

1. **On-demand cited answers** at `/dashboard/intel` (keep `/dashboard/market` as redirect or absorb it). One input box, four resolver families behind an intent router:
   - Shipment pre-flight (exists: reuse the load-check engine + enrichment, migrate into the silo).
   - Customs/commodity questions: HTS duty rates + Section 301 markers (USITC), classification precedent (CBP CROSS), UFLPA exposure (official DHS list; the OpenSanctions mirror is non-commercial licensed, cite DHS), Census import flows by HS x CA district.
   - Carrier questions: FMCSA company census (Socrata, keyless), L&I insurance filings incl. pending cancellations (Socrata `qh9u-swkp`), QCMobile safety/BASICs/authority once the webkey exists (test Vercel reachability first; SaferWebAPI at $30/mo is the fallback).
   - Lane/market questions: CA diesel (EIA), TL PPI (BLS keyless v1, 25 req/day, cache hard), CA tech import flows (Census), carrier supply counts (FMCSA), theft geography (FBI CDE cargo-theft CSVs after a one-time ETL; Overhaul quarterly numbers hand-refreshed).
2. **Answer documents.** Every answer is a serializable `AnswerDocument { question, intent, facts[], findings[], sources[], generatedAt }` rendered from data, so a customer-shareable branded route can be added later without rework (internal-first now; that is a deliberate architecture decision). Persist them in one additive table when useful; live-fetch + Next data cache is fine for v1.
3. **Bridges that exist and must keep working:** "Create RFQ from this check" (pre-flight to Inquiry with the report in notes), the security-tier and SOP-checklist spine on loads, the carrier bench matcher.

## Environment facts (hard-won; do not rediscover)

- **Vercel egress blocks:** fredgraph.csv (FRED), portoflosangeles.org, polb.com, bts.gov, and likely apps.fcc.gov reject datacenter requests. Working from Vercel: data.transportation.gov (Socrata), api.eia.gov, api.bls.gov, api.census.gov, hts.usitc.gov, rulings.cbp.gov. Always smoke-test a new source FROM a Vercel deployment before building on it.
- **Census intl-trade queries take 5-10s**: use 25s fetch timeouts and `export const maxDuration = 60` on pages that await them; stream behind Suspense.
- Every feed: fail-soft (Promise.allSettled), per-feed timeout, Next data cache with revalidate (6h for series, 24h for census-ish, 7d for HTS/CROSS). A feed that is down may only remove its facts, never break the answer; when everything is down, say so explicitly on screen (never render an empty void: that already bit us once).
- Conductor worktrees have no `.env`: `prisma generate`/build need placeholder `DATABASE_URL` and `DATABASE_URL_UNPOOLED`; all tests must be DB-free pure-lib tsx scripts under `scripts/` with `test:*` entries in package.json.
- L&I data quirks: `dot_number` is zero-padded to 8 digits; `max_cov_amount` is in $ thousands; `cancl_effective_date` also carries far-future policy-term dates, only warn when it lands within ~60 days. CROSS search matches full ruling text, so require a subject-token match before citing (see `parseCrossRulings` mustMatch).

## House rules (this repo, non-negotiable)

- Vercel deploys do NOT run migrations. Any schema change: additive and nullable-first, hand-written SQL migration, rehearse on a throwaway Neon branch, then `prisma migrate deploy` against prod (verify `_prisma_migrations` on prod directly, not the rehearsal branch) BEFORE merging. Prod DB access recipe: Neon project `broad-cloud-67682012`, database `derya_production`.
- Every model and query is `officeId`-scoped. Run `npm run audit:tenant-scope` after adding models/actions.
- NO EM DASHES anywhere: UI copy, docs, prompts, code comments (repo-wide rule, see AGENTS.md; outbound sends are guarded by stripEmDashes).
- Vocabularies are free strings + TS constant files (see `src/lib/inquiry-status.ts` pattern), never new Prisma enums.
- Do not touch or blur the international forwarding surfaces (`/dashboard/pricing`, CarrierQuote, Forwarder).
- Compliance content must be precise and hedged to the authority that owns the rule ("verify with the broker of record"). Before merging rule/compliance content, run an adversarial multi-agent review of the claims; the last pass caught a date-window bug and three wording errors.
- Verify end-to-end by driving the real flow (analyze a load idea, check the citations render, create the RFQ) before opening the PR; build, lint, and the full `test:*` suite must be green.

## Suggested sequence

- Phase A: silo + registry + Sources button retrofitted onto the existing pre-flight and baseline (no new data yet, pure refactor + citation UI).
- Phase B: intent router + the four resolver families; wire QCMobile when the webkey lands.
- Phase C: FBI theft ETL (one-time script + committed dataset), insurance-cancellation scan over the carrier bench (daily cron via the existing BackgroundJob drainer), weekly digest as an AnswerDocument.
- Phase D: prospect signals (FCC equipment authorizations, SEC Form D, YC company API) as a separate resolver; each needs a Vercel reachability test first.

## What NOT to build

No paid integrations (DAT, CargoNet, ImportGenius are cataloged and deliberately deferred). No scraping of hosts that block servers. No customer self-serve yet. No booking/tendering. No LLM-generated facts.

Read `docs/intel/SOURCES.md` for the full verified source catalog (top-8 ranked wiring targets, fast-follows, skip list with reasons) before choosing what to wire next.
