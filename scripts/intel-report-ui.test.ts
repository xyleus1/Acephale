import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "src/app/dashboard/intel/page.tsx"), "utf8");
const report = fs.readFileSync(
  path.join(root, "src/app/dashboard/intel/components/ocean-hardware-report.tsx"),
  "utf8"
);
const reportData = fs.readFileSync(
  path.join(root, "src/app/dashboard/intel/components/ocean-hardware-report-data.tsx"),
  "utf8"
);
const censusPublic = fs.readFileSync(
  path.join(root, "src/lib/intel/research/census-public-hardware.ts"),
  "utf8"
);
const styles = fs.readFileSync(
  path.join(root, "src/app/dashboard/intel/components/intel-report.module.css"),
  "utf8"
);
const chinaWatch = fs.readFileSync(
  path.join(root, "src/app/dashboard/intel/components/china-corridor-watch.tsx"),
  "utf8"
);
const chinaWatchStyles = fs.readFileSync(
  path.join(
    root,
    "src/app/dashboard/intel/components/china-corridor-watch.module.css"
  ),
  "utf8"
);
const customsGuide = fs.readFileSync(
  path.join(
    root,
    "src/app/dashboard/intel/components/china-customs-decision-guide.tsx"
  ),
  "utf8"
);
const customsGuideStyles = fs.readFileSync(
  path.join(
    root,
    "src/app/dashboard/intel/components/china-customs-decision-guide.module.css"
  ),
  "utf8"
);
const customsGuideDomain = fs.readFileSync(
  path.join(root, "src/lib/intel/research/china-customs-guide.ts"),
  "utf8"
);
const actions = fs.readFileSync(
  path.join(root, "src/app/dashboard/intel/components/intel-report-actions.tsx"),
  "utf8"
);
const exportRoute = fs.readFileSync(
  path.join(root, "src/app/api/intel/hardware-imports/export/route.ts"),
  "utf8"
);
const chinaWatchExportRoute = fs.readFileSync(
  path.join(
    root,
    "src/app/api/intel/hardware-imports/china-watch/route.ts"
  ),
  "utf8"
);
const exportHandler = fs.readFileSync(
  path.join(root, "src/lib/intel/hardware-imports-export.ts"),
  "utf8"
);
const intelServer = fs.readFileSync(path.join(root, "src/lib/intel/server.ts"), "utf8");
const loadCheckPanel = fs.readFileSync(
  path.join(root, "src/app/dashboard/intel/components/load-check-panel.tsx"),
  "utf8"
);
const intelActions = fs.readFileSync(
  path.join(root, "src/app/dashboard/intel/actions.ts"),
  "utf8"
);

assert.ok(page.includes("<OceanHardwareReportData />"), "the fixed report is the primary Intel surface");
assert.ok(page.includes("<LoadCheckPanel />"), "shipment pre-flight remains available as a secondary tool");
assert.ok(
  page.indexOf("<OceanHardwareReportData />") < page.indexOf("<LoadCheckPanel />"),
  "the report renders before the shipment tool"
);
assert.equal(page.includes("MarketBaseline"), false, "the unrelated market card is removed from this report page");
assert.ok(
  loadCheckPanel.includes("isLoadIdeaDecisionable(fields)") &&
    loadCheckPanel.includes("NEEDS DETAILS - add lane and cargo facts") &&
    loadCheckPanel.includes("CHECKED - no flagged rule conflicts") &&
    !loadCheckPanel.includes("nothing breaks"),
  "domestic pre-flight never turns missing facts into a green approval"
);
assert.ok(
  intelActions.includes("hasOperationalLoadFacts(fields)") &&
    intelActions.includes("isDeryaModelIdentityQuestion(text)") &&
    intelActions.includes("message:") &&
    intelActions.includes("isLoadIdeaDecisionable(fields)"),
  "the server rejects unsupported text and blocks incomplete RFQ conversion"
);
assert.equal(reportData.includes("sharedSources"), false, "scope reports do not share cross-geography provenance");
assert.ok(
  reportData.includes('buildCensusPublicPrecomputedRollups(\n    snapshot,\n    "california_destination"'),
  "California report uses the public State HS6 snapshot rollups"
);
assert.ok(
  reportData.includes('buildCensusPublicPrecomputedRollups(snapshot, "west_coast_gateway")'),
  "gateway report uses the public Port HS6 snapshot rollups"
);
assert.ok(
  reportData.includes("hasCompanyEvidence: observedCompanies.length > 0") &&
    reportData.includes("hasCompanyEvidence: false"),
  "company evidence coverage is derived independently for each scope"
);
assert.equal(
  reportData.includes("resolveCensusOceanHardwareSnapshot"),
  false,
  "page rendering does not cold-fetch Census API partitions"
);
assert.ok(
  reportData.includes("getCensusPublicHardwareSnapshot"),
  "the page reads a validated snapshot through the server entrypoint"
);
assert.ok(
  reportData.includes("buildChinaWestCoastCorridorWatch(snapshot)") &&
    reportData.includes("buildOceanHardwareRoutingResearchBrief(chinaWatch)") &&
    reportData.includes("buildChinaUsCustomsDecisionGuide()") &&
    reportData.includes("chinaWatch={chinaWatch}") &&
    reportData.includes("chinaRoutingBrief={chinaRoutingBrief}") &&
    reportData.includes("chinaCustomsGuide={chinaCustomsGuide}"),
  "the page builds and passes the deterministic China corridor and customs guides"
);
assert.ok(
  reportData.includes("return <OceanHardwareReportUnavailable />") &&
    report.includes("export function OceanHardwareReportUnavailable") &&
    intelServer.includes("validatedCensusPublicHardwareSnapshot ??="),
  "an invalid artifact renders a fail-closed report state instead of crashing the page"
);

for (const section of ["answer", "scale", "origins", "basket", "companies", "system", "sources"]) {
  assert.ok(report.includes(`id=\"${section}\"`), `the report includes the ${section} section`);
}
for (const requiredCopy of [
  "Sample, not complete history",
  "Coverage status",
  "China hardware corridor watch",
  "China origin + U.S. West Coast arrival geography",
  "The sample rows are not filtered to,",
  "Company-level air",
  "Observed importer profile",
  "Workflow hypothesis",
  "Where the hardware comes from",
  "Country of origin, not loading port",
  "The downloadable data preserves the full origin ranking",
  "Complete files, 43-code basis",
  "ports of unlading",
  'data-label="West Coast port vessel"',
  "Share of vessel import value, not container count or shipment share.",
  "Provider references evaluated",
  "SHA-256",
  "Origin-product-gateway corridor signals",
  "This is an origin-country corridor signal, not a port-to-port lane.",
  "0 qualified leads in this report",
  "Test the same sample before buying any provider",
  "Identical sample request",
  "Completed-year trend",
]) {
  assert.ok(report.includes(requiredCopy), `the report preserves required copy: ${requiredCopy}`);
}
for (const requiredCopy of [
  "is the observed research starting point, not a route recommendation.",
  "Research only",
  "Ranked China gateway districts",
  "China exposure, 2010 to present",
  "not adjusted for inflation",
  "category routing research",
  "No gateway district in this report is a recommended route.",
  "Turn aggregate exposure into a route decision",
  "Download watch JSON",
  "Share of China-origin West Coast value",
  "Containerized share of vessel value",
  "Review customs gates",
]) {
  assert.ok(
    chinaWatch.includes(requiredCopy),
    `the China watch preserves required copy: ${requiredCopy}`
  );
}
for (const requiredCopy of [
  "What can be quoted, and what is still blocked",
  "Landed-cost quote",
  "Not assessable",
  "dated actions that can change the quote",
  "What controls when sources disagree",
  "Handbook to shipment documents",
  "What changed over time",
  "Separate from the Census data date",
  "Document revised",
  "Published",
  "Page modified",
]) {
  assert.ok(
    customsGuide.includes(requiredCopy),
    `the customs guide preserves required copy: ${requiredCopy}`
  );
}
for (const requiredCopy of [
  "Product identity and 10-digit classification",
  "Full tariff and trade-remedy stack",
  "UFLPA and supply-chain traceability",
]) {
  assert.ok(
    customsGuideDomain.includes(requiredCopy),
    `the customs guide domain preserves required copy: ${requiredCopy}`
  );
}
assert.ok(
  chinaWatch.includes("<ChinaCustomsDecisionGuideSection") &&
    chinaWatch.indexOf("<ChinaCustomsDecisionGuideSection") <
      chinaWatch.indexOf('id="routing-brief"'),
  "the customs decision guide appears before routing inputs"
);
assert.ok(
  report.includes('href="#customs-guide"') &&
    report.includes('href="#china-history"') &&
    report.includes("...chinaWatch.sources") &&
    report.includes("...chinaCustomsGuide.sources") &&
    !report.includes('<span>03</span> Customs'),
  "customs has report navigation and participates in the evidence ledger"
);
assert.ok(
  customsGuide.includes("<ol className={styles.gateList}>") &&
    customsGuide.includes("<details className={styles.gateDisclosure}>") &&
    customsGuide.includes("change.effectiveAt ?? change.effectiveDate") &&
    customsGuide.includes("change.effectiveToAt ?? change.effectiveTo") &&
    customsGuide.includes('"America/Los_Angeles"') &&
    customsGuide.includes("formatOfficialEasternBoundary") &&
    customsGuide.includes("guide.authorityPriority.map"),
  "customs gates and dated rule history use semantic structures with exact local and official cutoffs"
);
assert.ok(
  customsGuideStyles.includes("@container china-watch (max-width: 700px)") &&
    customsGuideStyles.includes("min-height: 48px") &&
    customsGuideStyles.includes(":focus-visible"),
  "customs disclosures retain mobile and keyboard accessibility"
);
assert.ok(
  chinaWatch.includes("<HistoryLineChart") &&
    chinaWatch.includes('role="img"') &&
    chinaWatch.includes("Open exact annual values and official files") &&
    chinaWatch.includes('id="china-history"'),
  "fixed-basket history uses accessible charts and keeps exact annual evidence in a disclosure"
);
assert.ok(
  customsGuide.includes("change.operatorAlertPriority != null") &&
    customsGuide.includes("Revalidate by") &&
    !customsGuide.includes("const alertIds = new Set") &&
    !customsGuide.includes('className={styles.supportingDetails} open'),
  "customs alerts are domain-prioritized, expose revalidation, and keep supporting history collapsed"
);
assert.ok(
  report.includes("<ChinaCorridorWatch") &&
    report.indexOf("<ChinaCorridorWatch") <
      report.indexOf("className={styles.marketContextDetails}"),
  "the China watch is primary and the all-origin report is secondary"
);
assert.ok(
  chinaWatch.includes("selectCorridorWatchPrimaryGateway") &&
    chinaWatch.includes("watch.currentCategorySignals.length") &&
    chinaWatch.includes("watch.fixedBasketOriginHistory") &&
    chinaWatch.includes("period.basketComparable"),
  "primary gateway, category count, and fixed-basket history follow the watch data"
);
assert.equal(
  chinaWatch.includes("period.year <= 2025"),
  false,
  "future complete years are not silently hidden"
);
assert.ok(
  report.includes("Open the full all-origin market report") &&
    report.includes('id="market-context"'),
  "the full all-origin report remains available behind a labeled disclosure"
);

assert.ok(styles.includes("@media (max-width: 620px)"), "the report has an explicit mobile layout");
assert.ok(styles.includes("@media print"), "the report has a print layout");
assert.ok(
  styles.includes(":global(.sidebar)") && styles.includes(":global(.agent-fab)"),
  "print output removes application chrome"
);
assert.match(styles, /\.reportNav a \{ min-width: 102px; min-height: 44px;/, "mobile report navigation keeps a 44px hit target");
assert.match(styles, /\.reportActions a \{ min-height: 44px;/, "mobile report actions keep a 44px hit target");
assert.match(styles, /\.originTable \{ min-width: 0; table-layout: fixed; \}/, "mobile origin values do not require horizontal scrolling");
assert.ok(
  styles.includes(".matrixHeader { display: none; }\n  .mobileMatrixLabel {") &&
    styles.includes(".sourceLedger > li { scroll-margin-top: 158px; }"),
  "tablet matrix labels and mobile source anchors remain visible below sticky navigation"
);
assert.ok(styles.includes(".companyEvidenceDetails:not([open]) > :not(summary)"), "print output includes record details");
assert.ok(
  report.includes("const directAnswerSources = aggregateLoaded ? answerMetricSources : companyEvidenceSources"),
  "the public-evidence answer cites company observations instead of Census"
);
assert.ok(report.includes("california.currentCategories"), "category values use only the current period");
assert.ok(
  report.includes("companyEvidenceReviewedDate") &&
    report.includes("Source checked {companyEvidenceReviewedDate}"),
  "company evidence review copy derives from source metadata"
);
assert.ok(
  report.includes("yearEvidenceSources") && report.includes("sources={yearEvidenceSources}"),
  "each trend row cites its California and West Coast import files"
);
assert.ok(
  report.includes("Current values below use the California destination") &&
    report.includes("sources={californiaMetricSources}"),
  "current category values cite the California import file"
);
assert.ok(report.includes("report.currentCountries"), "origin ranking uses only the current period");
assert.ok(
  report.includes("gateways.currentGeographies") &&
    report.includes("West Coast port district mix") &&
    report.includes('geography.geographyKey.split(":").at(-1)'),
  "the report surfaces the loaded West Coast district rollups"
);
assert.ok(
  report.includes("gateways.currentGatewayCorridors") &&
    report.includes("currentGatewayCorridors.slice(0, 8)") &&
    report.includes("corridorValuesByCell") &&
    report.includes("<details className={styles.corridorRankingDetails}>"),
  "the report renders the validated joint origin, category, and gateway slice"
);
assert.ok(
  report.includes("The public data is good enough to rank corridor research") &&
    report.includes("0 qualified leads in this report") &&
    report.includes("licensed sample from each provider"),
  "the decision brief distinguishes research priorities from route and lead claims"
);
assert.ok(
  report.includes("completeYears.map((year)") &&
    report.includes("Current YTD stays in the metric band above."),
  "completed years are visually separated from the current partial year"
);
assert.ok(
  report.includes("const evidenceSourceKeys = new Set(sources.map(sourceKey))"),
  "provider references are separated from numbered claim evidence"
);
for (const referenceLabel of [
  "International Trade data products",
  "State Imports HS6 record layout",
  "Port Imports HS6 record layout",
  "HS 2022 revision notice",
  "ImportGenius pricing and plan limits",
  "ImportGenius U.S. import field coverage",
  "TradeAtlas Data and AI pricing",
  "TradeAtlas free account, sample, and API path",
  "Trademo Intel pricing",
  "Trademo FAQ and trial terms",
]) {
  assert.ok(reportData.includes(referenceLabel), `provider reference has a precise label: ${referenceLabel}`);
}
assert.ok(
  censusPublic.includes('displayName: "Schedule C country code file"'),
  "the fetched Schedule C evidence has a precise ledger label"
);
assert.ok(
  report.includes(": use.displayName ?? definition.name;") &&
    report.includes("<strong>{use.displayName ?? definition.name}</strong>"),
  "both numbered evidence and provider references render precise labels"
);
assert.ok(actions.includes("window.print()"), "the report exposes a print action");
assert.ok(actions.includes("Print report"), "the print action is labeled");
assert.ok(
  actions.includes('window.addEventListener("beforeprint", openReportDetails)') &&
    report.includes("data-intel-report"),
  "print output expands report details before capture"
);
assert.ok(
  report.includes("<details className={styles.evidenceDetails}>") &&
    report.includes("Exact claim evidence") &&
    report.includes("{resolvedSources.length} cited files and observations"),
  "numbered claim evidence is collapsed behind a count-bearing native disclosure"
);
assert.ok(
  report.includes('className={`${styles.evidenceDetails} ${styles.referenceSection}`}') &&
    report.includes("{resolvedProviderReferences.length} method, terms, and vendor pages"),
  "provider references are collapsed behind a count-bearing native disclosure"
);
assert.ok(
  styles.includes(".evidenceDetails > summary:focus-visible") &&
    styles.includes(".marketContextSummary:focus-visible") &&
    styles.includes(".evidenceDetails:not([open]) > :not(summary)") &&
    styles.includes(".sampleProtocol:not([open]) > :not(summary)") &&
    styles.includes(".corridorRankingDetails:not([open]) > :not(summary)"),
  "evidence disclosures preserve keyboard focus and print visibility"
);
assert.ok(actions.includes("/api/intel/hardware-imports/export"), "the report exposes a data download action");
assert.ok(actions.includes("Download Census snapshot"), "the data download action names its exact payload");
assert.ok(
  chinaWatch.includes("/api/intel/hardware-imports/china-watch") &&
    chinaWatch.includes("Download watch JSON"),
  "the China workflow exposes its own machine-readable watch"
);
assert.ok(
  exportRoute.includes("handleHardwareImportsExport") &&
    exportRoute.includes("requireSession"),
  "the data download delegates through the authenticated route adapter"
);
assert.ok(
  exportHandler.includes("await requireSession()"),
  "the data download remains authenticated"
);
assert.ok(
  exportHandler.includes("HARDWARE_IMPORTS_EXPORT_ROLES") &&
    exportHandler.includes("!HARDWARE_IMPORTS_EXPORT_ROLES.has(session.role)") &&
    exportHandler.includes("status: 403"),
  "the data download uses an explicit internal role allow-list"
);
assert.ok(exportRoute.includes("getCensusPublicHardwareSnapshot"), "the export returns the validated snapshot");
assert.ok(
  chinaWatchExportRoute.includes("handleChinaCorridorWatchExport") &&
    chinaWatchExportRoute.includes("requireSession") &&
    chinaWatchExportRoute.includes("getCensusPublicHardwareSnapshot"),
  "the China watch export uses the authenticated route adapter and validated snapshot"
);
assert.ok(
  exportHandler.includes("buildChinaWestCoastCorridorWatch") &&
    exportHandler.includes("buildOceanHardwareRoutingResearchBrief") &&
    exportHandler.includes("buildChinaUsCustomsDecisionGuide") &&
    exportHandler.includes("schemaVersion: 2"),
  "the China watch export returns the deterministic watch, routing brief, and customs guide"
);
assert.ok(exportHandler.includes("Content-Disposition"), "the data route downloads a named JSON artifact");
assert.equal(report.includes("Four manually checked"), false, "sample counts are not hard-coded or overstated");
assert.equal(reportData.includes("2021-2025"), false, "refreshable period copy is derived from the snapshot");
assert.equal(reportData.includes("May 2026"), false, "refreshable current-period copy is not hard-coded");

for (const [name, text] of [
  ["page", page],
  ["report", report],
  ["report data", reportData],
  ["Census public data", censusPublic],
  ["styles", styles],
  ["China watch", chinaWatch],
  ["China watch styles", chinaWatchStyles],
  ["customs guide", customsGuide],
  ["customs guide styles", customsGuideStyles],
  ["customs guide domain", customsGuideDomain],
  ["actions", actions],
  ["export route", exportRoute],
  ["China watch export route", chinaWatchExportRoute],
  ["export handler", exportHandler],
  ["Intel server", intelServer],
] as const) {
  assert.equal(text.includes("\u2014"), false, `${name} contains no em dash character`);
}

console.log("All Intel report UI contract checks passed");
