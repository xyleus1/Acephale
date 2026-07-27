# Intel source catalog (connectable public data)

Merged from the 2026-07-16/17 intelligence pulls and the 53-source web scout. Statuses reflect live verification from both local and Vercel runtimes.


Raw pulls live in `raw/`. Every OPEN source below has a repeatable command; re-run to refresh.
Access legend: **OPEN** (pulled today, keyless) · **KEY** (free key needed - blocked until provided) · **PAID** · **MANUAL** (no clean automation path).

## Report source contract: U.S. hardware imports

Source checked: **2026-07-23**.

This contract applies to the five-complete-year plus current-YTD hardware-import report. It keeps official aggregate import volume separate from manually observed company examples. A company name must never be inferred from an aggregate Census row.

### Official aggregate import volume

- **Public products:** the report uses keyless files from the Census
  International Trade Data Products catalog at
  `https://www.census.gov/foreign-trade/data/dataproducts.html`. It does not
  need `CENSUS_API_KEY` and does not make a live Census request while the page
  renders.
- **California destination volume:** use State Imports HS6. Census defines
  this geography as state of ultimate destination. A California row supports
  aggregate import value reported to California as the ultimate destination state.
  It does not prove which customs gateway handled the cargo, which company
  bought it, or where it was finally delivered. Layout:
  `https://www.census.gov/foreign-trade/reference/products/layouts/isths6.html`.
  Download pattern:
  `https://www.census.gov/trade/downloads/YYYY/state_imp/hs6_m/ISTHSMYYMM.ZIP`.
- **West Coast throughput:** use Port Imports HS6, filtered to ports of
  unlading whose port codes fall within districts **25 San Diego, 27 Los
  Angeles, 28 San Francisco, 29 Columbia-Snake, and 30 Seattle**. These values
  describe where cargo was unladen, not the importer location, customs entry
  district, destination state, or final delivery point. Layout:
  `https://www.census.gov/foreign-trade/reference/products/layouts/dporths6i.html`.
  Download pattern:
  `https://www.census.gov/trade/downloads/YYYY/Port/im_hs6_m/PORTHS6MMYYMM.ZIP`.
- **Origin names:** country codes are resolved through the official Schedule C
  dictionary at
  `https://www.census.gov/foreign-trade/schedules/c/country3.txt`. Country is
  country of origin, not supplier location, country of shipment, or foreign
  loading port.
- **Mode variables:** the snapshot retains general, vessel, containerized
  vessel, and air value plus vessel, containerized vessel, and air shipping
  weight. Containerized vessel is a subset of vessel, not a container count or
  separate mode, and must not be added to vessel. Air stays separate from
  vessel. Year-to-date fields are not summed across months.
- **Company limitation:** Census state, port, HS, country, mode, value, and
  weight rows are official aggregate statistics. They cannot identify an
  importer, consignee, supplier, startup, buyer, bill of lading, shipment
  count, transit time, or delay.

### Checked-in snapshot and refresh contract

- The current validated artifact is
  `src/lib/intel/research/generated/census-public-hardware-v1.json`. It covers
  revised December YTD files for 2021-2025 and May 2026 YTD for the full
  basket. A China-only fixed core43 slice extends complete-year history to
  2010 and also includes May 2026 YTD. Across the overlapping views there are
  34 unique import ZIPs plus one hashed Schedule C dictionary. The evidence
  ledger also lists the HS revision notice and three manual company
  observations. The artifact is schema v4 and includes 681 positive-value
  current-period origin-country by hardware-category by West Coast
  unlading-district segments.
- Rebuild with
  `npm run snapshot:intel-hardware -- --as-of=YYYY-MM`. Add `--refresh` to
  force clean downloads. The generator downloads
  raw ZIPs into a temporary cache, streams each fixed-width text file, resolves
  Schedule C names, validates the compact result, rereads it, and atomically
  replaces the checked-in JSON. Raw Census ZIPs are not committed.
- The current-period contract accepts January through November. A December
  `--as-of` value fails explicitly because the Census archive is a complete
  year while the report and export still model `asOfMonth` as current YTD.
  Use the latest available non-December month. The following January refresh
  then picks up the prior December as a complete-year period.
- Each period and scope retains the exact source URL, file name, original fetch
  time, source HTTP timestamp, archive SHA-256, matched row count, observed HS
  codes, origin count, and rollups by category, origin, and geography. The
  current West Coast Port HS6 file also retains the joint category, country of
  origin, and port-of-unlading district slice with vessel value, vessel weight,
  containerized vessel value, and containerized vessel weight. All four joint
  metrics must reconcile exactly to the current West Coast scope. This is a
  corridor research signal, not a foreign-port lane, shipment, or route.
  The
  Schedule C URL, original fetch time, revision, and SHA-256 are retained too.
  Warm caches are reused only when content length, local SHA-256, and every
  upstream validator Census supplies still match. Cache validation never
  relabels an old archive as newly fetched. URLs must pass the Intel secret-free
  allow-list. Census `Last-Modified` can vary between requests, so a mismatch
  conservatively forces a fresh download. The committed SHA-256, not the HTTP
  timestamp, is the integrity identity.
- The startup-production proxy has 43 applicable codes in 2021 and 46 from
  2022 onward. HS 8485, 8806, and 8807 entered in the HS 2022 revision. Do not
  describe full-basket 2021-to-2022 growth as a like-for-like comparison unless
  predecessor codes are separately researched and backcast. The separate
  China core43 series uses only the fixed 43 codes for 2010-2026. Its nominal
  customs values are comparable by included code set, but are not adjusted for
  inflation.
- The UI reads the validated artifact and exposes a JSON download to roles that
  can open Intel. Refresh remains a reviewed build operation, not an automatic
  write into tenant or company-brain data.
- HS revision reference:
  `https://www.usitc.gov/press_room/archive/featured_news/update_2022_hts_basic_edition`.

### China corridor-watch contract

- The China watch uses Schedule C code `5700` and the current joint Port
  Imports HS6 slice. It contains 23 positive category-by-gateway observations
  for May 2026 and must reconcile to the China country marginal, every
  category marginal, every gateway marginal, and the West Coast scope total.
- Current facts are observations, not lanes: $8.89B in China-origin West Coast
  hardware vessel value, 20.8% of the West Coast basket by value, and $6.29B
  observed in District 27. District 27 groups Los Angeles, Long Beach,
  Hueneme, and other district ports.
- Comparable China history uses one fixed 43-code basket for complete years
  2010-2025. Current May 2026 YTD and the current 46-code basket stay separate
  from those complete-year trend statements. The fixed series excludes HS
  8485, 8806, and 8807 and is not adjusted for inflation.
- Category posture is deterministic and research-only. A comparison district
  must represent at least 10% of the category and at least $50M in observed
  vessel value. A concentration label does not establish route feasibility,
  risk, service quality, or a rerouting opportunity.
- Observed dollar value divided by reported shipping weight is unit value per
  kg, not physical cargo density. It may be paired with aggregate weight as a
  commercial research cue, but it does not establish handling complexity or
  shipment risk.
- The routing brief stays `research_only` until the foreign loading port,
  exact U.S. discharge port and terminal, pickup and delivery endpoints,
  shipment route, carrier and service, sailing schedule, transit reliability,
  freight rate and accessorials, cargo handling requirements, and licensed
  company shipment evidence are available.
- The role-gated JSON export at
  `/api/intel/hardware-imports/china-watch` contains the watch, source
  checksums, limitations, customs guide, and routing brief. It does not write
  to operational or company-brain data.

### China-to-U.S. customs authority contract

- **Authority date:** the checked-in guide is reviewed and evaluated as of
  2026-07-23. It must be refreshed for the expected entry date before quoting
  landed cost or promising clearance.
- **Source review order:** start with controlling authority such as the HTS,
  statute, regulation, Federal Register action, or enforceable order. Then use
  an applicable ruling or scope decision, current implementation guidance, and
  handbook context. Legacy handbooks and recently modified guidance pages do
  not override current authority or a fact-matched ruling.
- **Current HTS:** use the edition in force on entry. The reviewed release is
  2026 Revision 12:
  `https://www.usitc.gov/2026_hts_revision_12`.
- **Section 301:** use exact origin, 10-digit classification, Chapter 99
  instructions, entry date, and exclusion language. The reviewed exclusion
  extension begins 2025-11-30 and runs through 2026-11-09:
  `https://www.govinfo.gov/content/pkg/FR-2025-12-01/pdf/2025-21671.pdf`.
- **Temporary Section 122 action:** as of 2026-07-23 the action ends before
  2026-07-24 00:01 EDT unless changed or extended. Exact exemptions and
  Section 232 interaction require review:
  `https://www.federalregister.gov/documents/2026/02/25/2026-03824/imposing-a-temporary-import-surcharge-to-address-fundamental-international-payments-problems`.
- **Classification and customs process:** current Title 19 regulations and
  the HTS control. CBP CROSS supports fact-matched classification research:
  `https://rulings.cbp.gov/`. The commercial importer handbook was last
  revised in 2006. The specialized classification, value, entry,
  recordkeeping, and reasonable-care publications preserve their own
  historical publication or revision dates.
- **UFLPA:** forced-labor tracing is separate from tariff calculation. A
  current entity-list search is necessary but not sufficient. Shipment-level
  production and transaction evidence is still required:
  `https://www.dhs.gov/uflpa-entity-list`.
- **Product controls:** deterministic feature screens use direct or official
  FCC, FDA, CPSC, PHMSA, EPA, DOE, and APHIS sources. HS category alone does
  not establish agency jurisdiction.
- **Refrigerant equipment:** current 40 CFR Parts 84 and 82 require exact end
  use, product or component status, refrigerant, GWP, charge, date, and label
  facts. Finished charged equipment is not a bulk HFC import merely because it
  contains refrigerant. The 2026 reconsideration rule was published on
  2026-05-26 but is upcoming until 2026-07-27:
  `https://www.govinfo.gov/content/pkg/FR-2026-05-26/pdf/2026-10387.pdf`.
- **Boundary:** the guide collects evidence and blocks unsupported promises.
  It is not legal advice, a customs ruling, a broker filing instruction, a
  duty calculator, or a compliance determination.

### Company-level bill-of-lading evidence

- **ImportGenius public pages:** public importer and supplier pages under `https://www.importgenius.com/importers/` and `https://www.importgenius.com/suppliers/`, plus the public U.S. trade preview at `https://www.importgenius.com/tradebase`, may be cited only as manually reviewed public-preview samples. Record the exact page URL and review date. Do not automate retrieval, aggregate the preview pages, or describe the visible sample as complete history. ImportGenius is not connected to Derya: there is no account, licensed export, API, or live integration.
- **ImportYeti:** `https://www.importyeti.com/` is unavailable for Derya commercial use under its public terms. The terms at `https://www.importyeti.com/policies/terms` limit use to personal, internal, non-commercial purposes and prohibit robot, spider, site-search, data-mining, and other automated retrieval. Derya must not search, retrieve, manually copy, cite as company evidence, scrape, crawl, bulk-download, or automate ImportYeti data unless Derya first obtains explicit written commercial permission or a commercial license. The terms page may be cited only to document this access restriction.
- **ImportGenius paid benchmark:** the official pricing page at `https://w3.importgenius.com/pricing` lists USA Pro Flex at $449 per month with U.S. import history from 2006 to present, 50 searches per day, and 1,000 downloaded rows per month. The same page says no free trial is offered. The U.S. field page at `https://w3.importgenius.com/how-it-works/our-datasets/us-imports` lists entity-resolved importers, consignee addresses, shippers, foreign and U.S. ports, vessel, weight, quantity, and descriptions. This is published product documentation, not proof that a Derya sample meets those claims.
- **TradeAtlas sample path:** the official pricing page at `https://www.tradeatlas.com/en/pricing-data-and-ai-package` starts at $2,950 per year for 15 six-digit HS codes and publishes importer, exporter, product, and port searches. `https://www.tradeatlas.com/en` offers a free 2022 U.S. sample and paths to request sample files and an API trial. Field availability and normalization vary and must be checked in the requested sample.
- **Trademo sales-validation path:** `https://www.trademo.com/intel/pricing` publishes custom pricing plus prospect, contact, saved-search, and monitoring claims. `https://www.trademo.com/faqs` claims a no-expiry free trial and a 1-2 day update lag. Its public pages publish conflicting shipment and company counts, so coverage must be clarified in writing and tested before purchase.
- **Connection state:** ImportGenius, TradeAtlas, and Trademo are not connected to Derya. There is no licensed account, export, API, or live integration. Public marketing or preview pages are not evidence of complete company coverage and must not be presented as retrieved shipment data.
- **Five-year company history:** a complete five-year company bill-of-lading history requires a licensed company-level BOL provider with an approved export or API path. Official Census aggregates and scattered public previews cannot supply that history. Even licensed results must retain the provider query, coverage dates, record identifiers, retrieval date, and vessel-manifest confidentiality caveat. Air company history requires a separate licensed source because public U.S. vessel manifests do not cover air shipments.
- **Public-manifest boundary:** company-level ocean records derive from public vessel-manifest disclosure and can be incomplete because parties may request confidentiality. The governing public-disclosure reference is `https://www.ecfr.gov/current/title-19/part-103/section-103.31`. Company examples are observed records, not a census of all importers and not qualified leads without separate review.

### Licensed-provider sample gate

Request the same sample from every candidate before buying access:

- U.S. ocean imports from April 1 through June 30, 2026, plus the same quarter
  in 2022-2025.
- HS6 codes 847950, 850760, 854231, 902750, and 880622.
- West Coast arrival ports kept separate from importer addresses in
  California, Oregon, and Washington.
- Complete row counts, a stable untruncated export, field dictionary,
  suppression rules, update timestamp, API or delivery quote, and written
  commercial-use rights.

Hard acceptance gates:

- Five-year history and update lag no more than 7 days.
- Core shipment fields at least 95% complete and normalized state and ZIP at
  least 80% complete.
- Entity-resolution precision at least 90% on the top 50 importers and
  intermediary contamination no more than 10%.
- Bill-of-lading deduplication and commodity relevance at least 85%.
- Written permission to store, normalize, score, and use the licensed data in
  Derya workflows.

Aggregate Census volume can rank market and corridor research. It cannot
increase a company lead score.

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
`api.census.gov/data/timeseries/intltrade/imports/hs` - monthly import value by **HS code × customs district** (LA=27, SF=28, San Diego=25). **Key active since 2026-07-16** (`CENSUS_API_KEY` in Vercel prod+preview; never in repo). Wired into the market-baseline card via `fetchCensusTechImports()` in `src/lib/intel/market/indicators.ts` (6 HS codes, from-prior-January range, 24h cache). First read (May 2026, latest published): **selected West Coast gateway tech import value across all transportation modes was $12.42B/mo, +17.7% YoY - networking gear +51%, semicap +32%, computers $6.28B, batteries −11%**. This is a customs-gateway aggregate for districts 25, 27, and 28, not California destination volume or California-only imports. Districts 27 and 28 include Nevada-area ports such as Las Vegas and Reno. Aggregate only - no company names.

## 4a. China customs authority guide · ACTIVE, REVIEWED

The China hardware report uses 47 official authority and guidance references
across classification, origin and marking, valuation, tariff stacking, product
admissibility, UFLPA traceability, importer and entry ownership, and ocean
filing. Review controlling authority first, then an applicable ruling or scope
decision, current implementation guidance, and handbook context.

- Rules are evaluated as of `2026-07-23`; sources were reviewed at
  `2026-07-24T01:36:03.000Z`.
- USTR's July 23, 2026 forced-labor Section 301
  [final action notice](https://ustr.gov/sites/default/files/files/Press/Releases/2026/FLIP%20301%20Investigation%20Final%20Action%20FRN%207-23-26%20FINAL.pdf)
  is modeled as upcoming on July 24. It establishes 12.5 percent under HTSUS
  9903.05.31 for covered products of China, subject to listed exemptions and a
  conditional July 28 in-transit deadline. The exception requires loading onto
  a vessel at the port of loading and transit on the final mode before the
  July 24 cutoff. The report shows that official 12:01 a.m. EDT cutoff as July
  23 at 9:01 p.m. PDT for West Coast operators.
- FCC history separates the April 12, 2022 pre-sale import condition in 47 CFR
  2.1204(a)(11) from the December 26, 2025 covered-equipment amendment to
  paragraph (a)(1).
- FDA medical-device requirements are separate from medical and non-medical
  radiation-emitting product requirements, including 21 CFR 1.77, performance
  standards, product reports, accession numbers, and Form FDA 2877 where
  applicable.
- General hazardous-material screening cites 49 CFR Parts 172, 173, and 176
  for classification, communication, packaging, vessel stowage, segregation,
  and acceptance. A narrow PHMSA refrigerating-machine interpretation is
  preserved as fact-specific guidance, not a blanket refrigerant exception.
- NRC screening covers radioactive sources, nuclear material, and nuclear
  equipment under 10 CFR Part 110, including license or exception basis,
  consignee possession authority, and required notifications.
- EPA FIFRA screening covers hardware with pesticidal claims or functions,
  including sterilizers, sanitizers, UV devices, and similar equipment. It
  requires product scope, registration or exception, producing-establishment,
  labeling, and Notice of Arrival evidence.
- The guide is an evidence checklist, not a duty calculator, binding ruling,
  broker instruction, admissibility decision, or clearance promise. Recheck
  the filed Federal Register notice, current HTS revision, expected entry date,
  product description, origin facts, and any claimed exemption for each
  shipment.

## 5. Company-level customs BOLs (who imports what, from which CM) · PAID/MANUAL
Ocean bills of lading name shipper + consignee - the prospecting goldmine ("X just imported 12 containers of server racks from Foxconn").
- ImportYeti - unavailable for Derya commercial use without explicit written permission or a commercial license; do not use public-term lookups as company evidence
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
Weekly: FRED (diesel/PPI). Monthly: FMCSA aggregates, port TEUs (manual), and
the keyless Census hardware snapshot after the new monthly files publish. The
separate Census API key remains relevant to the legacy six-code market-baseline
tile, not to the hardware research report. Keep snapshot regeneration
reviewed until release timing, revision behavior, and artifact diffs are stable.

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
- **Wire into:** Market baseline tile - the direct replacement for blocked-FRED. One cached daily fetch gives the "TL linehaul rates up X% y/y" line in reports and on `/dashboard/intel`.
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
- **Licensed ocean BOL sample** - ImportYeti is unavailable for Derya commercial use without explicit written permission or a commercial license. Test the identical sample gate against ImportGenius Pro at the published $449 monthly benchmark, TradeAtlas, and Trademo before buying any provider.
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
