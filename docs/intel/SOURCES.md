# Intel source catalog (connectable public data)

Merged from the 2026-07-16/17 intelligence pulls and the 53-source web scout. Statuses reflect live verification from both local and Vercel runtimes.


Raw pulls live in `raw/`. Every OPEN source below has a repeatable command; re-run to refresh.
Access legend: **OPEN** (pulled today, keyless) · **KEY** (free key needed - blocked until provided) · **PAID** · **MANUAL** (no clean automation path).

## 1. Carrier supply - FMCSA Company Census · OPEN
Socrata dataset `az4n-8mr2` on data.transportation.gov. Full US carrier universe: identity (DOT#, legal/DBA name), location, fleet size, drivers, hazmat flag, phone, operation class. Keyless (throttled; a free Socrata app token raises limits).
- CA for-hire active by fleet bucket → `raw/fmcsa_ca_forhire_by_fleetsize.json`
- CA for-hire active, hazmat-certified: **7,500** → `raw/fmcsa_ca_forhire_hazmat_count.json`
- CA for-hire active, 5–100 power units (the partner-carrier sweet spot): **12,074** → `raw/fmcsa_ca_forhire_5to100pu_count.json`
- Intersection - hazmat-certified AND 5–100 power units: **1,160** (the lithium-capable partner pool)
- Prospecting sample (400 largest in band, w/ phone) → `raw/fmcsa_ca_forhire_sample.json`

```sh
curl "https://data.transportation.gov/resource/az4n-8mr2.json?\
\$select=dot_number,legal_name,phy_city,power_units,total_drivers,hm_ind,phone&\
\$where=phy_state='CA' AND status_code='A' AND classdef like '%AUTHORIZED FOR HIRE%' \
AND power_units::number between 5 and 100 AND carrier_operation='A'&\$limit=400"
```
Caveats: includes passenger/ambulance etc. (filter `carship`/`classdef` further); **no equipment detail (reefer/air-ride) and no insurance** - insurance/authority detail = FMCSA L&I (per-carrier pages, no bulk) or QCMobile API (**KEY**, free webkey registration).

## 2. Rates & cost baselines - FRED · OPEN
Keyless CSV: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>` → `raw/fred_*.csv`
- `GASDESW` US on-highway diesel, weekly - **$4.796 @ 2026-07-13, +26% YoY, +38% YTD**
- `PCU4841214841212` PPI TL long-distance - **207.2 @ Jun-2026, +21.4% YoY**
- `PCU484121484121` PPI general freight long-distance - +21.5% YoY
- `TSIFRGHT` Freight Transportation Services Index - **+1.4% YoY** (volumes flat while prices surge = capacity-driven cycle)
- CA-specific diesel: EIA API v2 series `EMD_EPD2D_PTE_SCA_DPG` · **ACTIVE ✅** since 2026-07-16 (`EIA_API_KEY` in Vercel prod+preview) - on the baseline card next to US diesel. First read: **$6.13/gal, +23.6% YoY** (a ~28% premium over national - CA lanes price fuel differently).

## 3. Port demand - LA / Long Beach TEUs · MANUAL (sites bot-blocked)
Both port sites 403 automated fetches. Monthly numbers reliably appear in press releases/news (June 2026: **PoLA 1,002,734 TEU - record June, imports +13%; POLB 779k TEU, +10.6%** - importers frontloading). Options: manual monthly grab, scrape with browser headers, or Port Optimizer (volumes.portoptimizer.com) if they expose a feed.

## 4. Customs flows (the actual "customs data") - US Census International Trade API · ACTIVE ✅
`api.census.gov/data/timeseries/intltrade/imports/hs` - monthly import value by **HS code × customs district** (LA=27, SF=28, San Diego=25). **Key active since 2026-07-16** (`CENSUS_API_KEY` in Vercel prod+preview; never in repo). Wired into the market-baseline card via `fetchCensusTechImports()` in `src/lib/market-indicators.ts` (6 HS codes, from-prior-January range, 24h cache). First read (May 2026, latest published): **CA tech imports $12.42B/mo, +17.7% YoY - networking gear +51%, semicap +32%, computers $6.28B, batteries −11%**. Aggregate only - no company names.

## 5. Company-level customs BOLs (who imports what, from which CM) · PAID/MANUAL
Ocean bills of lading name shipper + consignee - the prospecting goldmine ("X just imported 12 containers of server racks from Foxconn").
- ImportYeti - free web UI, manual lookups (ToS disallows scraping)
- ImportGenius / Panjiva (S&P) - paid APIs/exports
- Raw CBP AMS data subscription - paid, heavy engineering
Note: air shipments (most high-value tech) are largely NOT in public BOL data.

## 6. Mexico cross-border (CM nearshoring lanes) - BTS TransBorder · MANUAL
Truck freight value by port of entry (Otay Mesa/Calexico) × commodity × state. Not query-able on Socrata (story pages only), and bts.gov 403s automated fetches - monthly CSVs must be downloaded in a browser. Worth a manual grab when we target MX CM lanes.

## 7. Cargo theft - narrative only without paying
- CargoNet (Verisk) / Overhaul intelligence: **PAID**
- Free: FBI IC3 PSAs, CargoNet quarterly press summaries, FreightWaves/JOC coverage. Good enough for the security-wedge content + tier calibration; not lane-level data.

## 8. Live spot rates - DAT RateView · PAID (Phase 2)
Adapter slot already exists (`DomesticRateProvider`). Commercial/API paperwork is the long pole - start now.

## Refresh cadence suggestion
Weekly: FRED (diesel/PPI). Monthly: FMCSA aggregates, port TEUs (manual), Census trade (once key exists). Product wiring: a `scripts/intel-pull.ts` + BackgroundJob cron writing `MarketSignal` rows is the natural next slice - after the key/paid decisions land.

---

# Data source shortlist - CA tech-loads niche

Date: 2026-07-17. Ranked by (value to the niche ÷ effort) from 53 scout-verified sources. Goal: make pre-flight reports, carrier vetting, and the market baseline cite **real numbers** (actual duty rates, actual safety/insurance records, actual theft geography) instead of generic advice.

---

## Top 8

### 1. USITC HTS REST API + "China Tariffs" Section 301 reference file (bundled - one integration)
- **Wire into:** Pre-flight rule enrichment (customs findings). For a load's declared HTS (8471 servers, 8542 semis, 8486 semicap, 8507 lithium cells): emit the real MFN duty rate and, if origin=China, the 301 list membership + chapter-99 heading - e.g. "8517.62.00: MFN Free, but China origin triggers 9903.88.04/.15 - Section 301 surcharge applies."
- **Access steps:** Keyless. (a) `GET https://hts.usitc.gov/reststop/search?keyword={hts_code}` per code, cache aggressively. (b) Download the China Tariffs PDF once per HTS release from `https://hts.usitc.gov/reststop/file?release=currentRelease&filename=China+Tariffs`, text-extract into a static 8-digit → 9903.88.x lookup table committed to the repo/DB.
- **Gotchas:** Bulk `/reststop/exportList` returns 400 - per-code search only, so cache and pre-warm the ~20 HTS families the niche actually ships. The PDF parse must re-run each HTS release (last updated 2026-02-25). 9903 headings give list membership, not the % - keep a small hand-maintained map of 9903.88.x/9903.91.x → current rate and re-verify it against chapter-99 notes when parsing (several rates were modified in the 2024–25 review). Cross-check footnote-based detection (per-code API) against the static table; discrepancy = flag for human review.
- **Effort:** hours.

### 2. FMCSA QCMobile API
- **Wire into:** Carrier vetting automation (the vetted carrier bench) + the carrier section of pre-flight: real safety rating, SMS BASIC percentiles, OOS rates vs national average, crash totals, and operating-authority status per DOT number. Nightly bench refresh + on-demand check when a new carrier is proposed for a load.
- **Access steps:** Free. Login.gov developer account → `mobile.fmcsa.dot.gov/QCDevsite` → My WebKeys → key issued immediately. Call `https://mobile.fmcsa.dot.gov/qc/services/carriers/{dot}?webKey=KEY` plus `/basics`, `/authority`, `/oos`.
- **Gotchas:** **Test reachability from Vercel first** - same US-gov IP-blocking risk as FRED. Key is per-developer: keep server-side, never client. Search endpoints cap at 50 results (paginate with start/size). Contingency if blocked: SaferWebAPI at $30/mo (see skip list).
- **Effort:** hours.

### 3. FMCSA L&I insurance datasets via Socrata (qh9u-swkp / 9mw4-x3tu / 6eyk-hxee)
- **Wire into:** Pre-flight insurance findings + bench monitoring. Replaces "verify insurance" with "BIPD max $1M (form 91X), **cancellation effective 08/10 pending**" and "coverage $750K < suggested floor for a $2M GPU load." Daily job: scan bench DOT numbers for new `cancl_effective_date` and thin coverage.
- **Access steps:** Keyless; literally the same Socrata client already written for FMCSA Company Census, pointed at `data.transportation.gov/resource/qh9u-swkp.json?dot_number=X` (+ 9mw4-x3tu authority history, 6eyk-hxee carrier master). Optional free app token to avoid throttling.
- **Gotchas:** Dataset metadata says it "will no longer be updated" after 05/14/2026, yet rowsUpdatedAt was 2026-07-17 - treat as **at-risk**: add a staleness monitor (alert if rowsUpdatedAt > 7 days old) and pin `li-public.fmcsa.dot.gov` as the manual fallback in the finding copy. QCMobile does NOT expose policy-level insurance; this is the only free source that does.
- **Effort:** hours.

### 4. BLS PPI - Long-Distance Truckload (PCU484121484121)
- **Wire into:** Market baseline tile - the direct replacement for blocked-FRED. One cached daily fetch gives the "TL linehaul rates up X% y/y" line in reports and on /dashboard/market.
- **Access steps:** Keyless works now (25 queries/day, verified live); register a free BLS key for 500/day headroom. `POST https://api.bls.gov/publicAPI/v2/timeseries/data/` with the series ID; cache 24h.
- **Gotchas:** Latest month is often flagged preliminary (June 2026 was) - render a "(prelim)" annotation and expect revisions. BLS is the primary source FRED mirrors, but still smoke-test from a Vercel function before deleting the FRED code path.
- **Effort:** hours.

### 5. CBP CROSS rulings JSON API
- **Wire into:** Pre-flight customs findings - attach citable classification precedent: "CBP classified a comparable GPU compute module under 8471.50 (ruling N361915, 2026-06-22)" with a deep link. Turns classification advice from generic to defensible, and surfaces contested classifications for semicap/robotics gear.
- **Access steps:** Keyless. `GET https://rulings.cbp.gov/api/search?term={query}&collection=ALL&pageSize=10&sortBy=DATE_DESC`. Build canned per-commodity queries (GPU server, lithium-ion battery, wafer handling robot, semiconductor deposition) mapped to the niche's HTS families; refresh weekly and store top rulings per family.
- **Gotchas:** Undocumented API behind an Angular app - wrap defensively, cache results, fail soft to a plain CROSS search link. `/api/ruling/{n}` detail 404s: link the HTML page `rulings.cbp.gov/ruling/{number}` instead. Check `revoked`/`modified` arrays before citing a ruling.
- **Effort:** hours.

### 6. UFLPA Entity List via OpenSanctions (us_dhs_uflpa)
- **Wire into:** Pre-flight forced-labor screen on China-origin loads: fuzzy-match shipper/supplier names → "UFLPA detention risk - supplier matches Entity List" finding. Lithium cells and polysilicon-adjacent components are stated enforcement priorities - squarely on-niche.
- **Access steps:** Keyless: cron-download `https://data.opensanctions.org/datasets/latest/us_dhs_uflpa/targets.simple.csv` (304 entities, refreshed ~6h) into a table; normalize + match against aliases column.
- **Gotchas:** **License:** OpenSanctions free tier is non-commercial; Derya is commercial - either buy their data license or treat the match as an internal pointer and verify/cite against the official DHS HTML list in the finding. Fuzzy name matching will false-positive on transliterated Chinese company names - findings should say "possible match, confirm manually," never auto-fail a load.
- **Effort:** hours.

### 7. FBI Crime Data Explorer - Cargo Theft NIBRS dataset
- **Wire into:** Pre-flight security rule: county-level theft incidence and location-type stats (truck stop vs rest area vs warehouse) along origin/destination corridors, filtered to computer hardware/electronics property types - "this lane crosses 2 of CA's top-10 cargo-theft counties (FBI NIBRS, n=X incidents)" instead of generic "high-theft corridor."
- **Access steps:** Free. Download yearly Cargo Theft CSV zips from the CDE downloads page (`cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads`, keyless via browser); one-time ETL: ORI → county via the FBI ORI crosswalk, aggregate by county × location type × property description × value. Optional free api.data.gov key for other CDE series.
- **Gotchas:** Cargo theft is **bulk-download only** - not in the CDE API (probed: null skeleton), so this is an annual manual refresh, not a live feed. Voluntary NIBRS reporting = undercounting: use for *relative* geography, never absolute totals, and say so in the finding copy. Data lags ~a year - pair with #8 for freshness.
- **Effort:** days (the only structured theft-geography source that exists; worth it).

### 8. Overhaul quarterly US Cargo Theft Reports
- **Wire into:** Fresh headline numbers for pre-flight security findings and the market baseline "theft pulse": "Q1-2026: 574 US incidents, 36% in California; deceptive-pickup schemes +31%" - cited verbatim with source + date. Complements #7 (FBI = geography, Overhaul = current-quarter trend + fraud modality).
- **Access steps:** Free marketing form at `over-haul.com/us-cargo-theft-report` with the work email; each quarter, hand-transcribe 4–6 stats into a citations table (value, unit, source, as-of date, link).
- **Gotchas:** PDF-only, no API - put a quarterly calendar reminder on it. Stats are Overhaul-network incidents, not a census: cite as "Overhaul recorded…". Expire stale stats (don't quote Q1 numbers in Q4) - store an `expires_at` on each citation row.
- **Effort:** hours.

---

## Skip for now

**Cheap fast-follows (good, just behind the top 8 - next baseline pass):**
- **Cass Indexes xlsx** - cleanest free $/mile TL trend, one monthly server-side xlsx parse; add as second baseline tile after BLS PPI lands.
- **BTS TSI (Socrata)** - near-zero cost with the existing Socrata client; generic national volume, add when the baseline needs a volume backdrop.
- **Port of LA container stats** - keyless HTML, real CA inbound demand pulse; add as a baseline tile in the same pass.
- **Drewry WCI** - Shanghai→LA $/40ft weekly scrape for import-heavy findings; add once customs findings ship.
- **TT Club/BSI annual theft report** - free insurer stats (insider involvement, electronics share) for insurance-finding copy; annual manual pull.
- **CARB ARBER TRU search** - no API; ship as a deep-link + "ask for CARB IDN" line in the reefer pre-flight rule (no integration needed).
- **CA AB5** - verified no dataset exists; encode the joint-liability *rule* for CA intrastate owner-op legs, cite the Costco/Ryder action.
- **USITC DataWeb v2** - real duties-collected by HTS × district, but POST query-builder + JWT = days; do after the HTS API proves out.
- **DOL WHD enforcement** - labor-risk flag needs fuzzy employer matching; monthly batch-score the bench later, not per-load.
- **Sensitech / Munich Re reports** - corroborating avg-loss and tactics stats; fold into the quarterly Overhaul ingestion habit.

**Prospecting signals (valuable, but a different workstream than report specificity):**
- **YC OSS API, SEC EDGAR Form D, San Jose permits (CKAN), SIA CHIPS list, Cleanview, Baxtel** - demand-side triggers for the CRM/RFQ pipeline; batch these into a separate "prospect signals" project.
- **FCC EAS grants** - best "about to ship" signal, but apps.fcc.gov showed FRED-style fetch failures; needs a Vercel reachability test (fcc.report mirror as fallback) before committing.

**Paid - revisit at load volume / with DAT paperwork:**
- **CargoNet RouteScore API** - the only buyable lane-level theft score; start sales conversation in Phase 2 alongside DAT (meanwhile scrape their free quarterly analyses).
- **Truckstop Rate Insights V3** - documented API, but weeks of SIA paperwork; start it in parallel with DAT per the Phase 2 plan.
- **Carrier411 ($99/mo, 30-day trial)** - FreightGuard complaint history is the one non-reproducible vetting signal; first paid pilot once the free vetting stack is live.
- **SONAR Quick Rates ($249/yr)** - buy a seat as a human rate-check tool; it's not an integration (no API at that tier).
- **SaferWebAPI ($30/mo)** - hold as contingency only if QCMobile blocks Vercel IPs.
- **ImportYeti (free) / ImportGenius ($229–449/mo)** - manual sales-side BOL research; use ImportYeti ad-hoc, pay ImportGenius only if the workflow proves out.
- **NMFTA SCAC ($570/yr), Highway, MyCarrierPortal ($515/mo), Truckstop RMIS ($340+)** - identity/onboarding suites; redundant until volume justifies, and MCP/RMIS are build-vs-buy benchmarks, not feeds.
- **TAPA IIS ($2,100/yr)** - cheapest live theft-alert feed; revisit when there are recurring high-value lanes to monitor.
- **UN Comtrade / Freightos FBX / ACT Research** - context-only; free tiers have no usable API path worth automating now.

**Ruled out:**
- **Panjiva / Descartes Datamyne** - quote-only enterprise, no differentiator over ImportGenius's published tiers.
- **CBP AMS raw manifests** - weeks of parsing + offline CD-ROM procurement; Phase 3 build-your-own-index option only.
- **Freight Data Watch** - unknown data provenance; a liability in a brokerage product. Evaluated and rejected.
- **ISO ClaimSearch** - no access path for brokerages (CargoNet is the buyable proxy, same parent).
- **FBI IC3, CHP CTIP, LASD Cargo CATS** - no machine-readable data; CPRA request only if a citable CA-official number is ever needed.
- **Port Optimizer / The Signal** - Okta-gated, no anonymous API; register a stakeholder account someday, use POLA stats page meanwhile.
- **Port of Long Beach** - bot-blocked from server-side fetch; POLA alone covers San Pedro Bay.
- **Data Center Map** - HTTP 429s scrapers; one-time manual cross-check only.
- **Greenscreens/Triumph Rates** - network model needs your own load history; too thin at current volume.

---

## Suggested build order

1. **Week 1 (all keyless, all hours):** HTS+301 lookup (#1) and CROSS citations (#5) into pre-flight customs; L&I insurance (#3) into pre-flight insurance; BLS PPI (#4) to unblock the baseline.
2. **Week 1–2:** QCMobile key + Vercel reachability test (#2) → carrier bench refresh job; UFLPA screen (#6) with license decision.
3. **Week 2+:** FBI cargo-theft ETL (#7) + Overhaul citations table (#8) → security rule gets real geography and fresh trend numbers.

Cross-cutting gotcha: three of eight sources (QCMobile, BLS, FCC in fast-follows) carry the FRED-style Vercel IP-block risk - build one shared "fetch via server with reachability probe + cached fallback" helper and run probes from prod before wiring any of them into user-facing tiles.
