import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_HARDWARE_BASKET_EXCLUSIONS,
  STARTUP_PRODUCTION_HARDWARE_BASKET,
  buildOceanHardwareResearchWindow,
  composeOceanHardwareResearchReport,
  createOceanHardwareResearchRequest,
  deriveOceanHardwareAggregateData,
  deriveOceanHardwareCoverage,
  type ManualObservedCompanyEvidence,
  type OceanHardwareCoverage,
  type OceanHardwareImportRow,
  type OceanHardwareResearchRequest,
  type StartupHardwareHsCode,
} from "../src/lib/intel/research/ocean-hardware";
import type { IntelSourceUse } from "../src/lib/intel/sources";

const census: IntelSourceUse = {
  sourceId: "census_trade",
  sourceUrl:
    "https://api.census.gov/data/timeseries/intltrade/imports/hs?get=VES_VAL_MO,AIR_VAL_MO&time=from%202021-01",
  asOf: "2026-05",
  fetchedAt: "2026-07-22T12:00:00.000Z",
  reviewedAt: null,
};
const manual: IntelSourceUse = {
  sourceId: "usitc_hts",
  sourceUrl: "https://hts.usitc.gov/",
  asOf: "2026-07-22",
  fetchedAt: null,
  reviewedAt: "2026-07-22T12:00:00.000Z",
};

assert.equal(STARTUP_PRODUCTION_HARDWARE_BASKET.length, 46, "proxy basket has exactly 46 HS series");
assert.equal(
  new Set(STARTUP_PRODUCTION_HARDWARE_BASKET.map((entry) => entry.code)).size,
  46,
  "proxy basket codes are unique"
);
assert.equal(STARTUP_PRODUCTION_HARDWARE_BASKET.find((entry) => entry.code === "8485")?.introducedYear, 2022);
assert.equal(STARTUP_PRODUCTION_HARDWARE_BASKET.find((entry) => entry.code === "8806")?.introducedYear, 2022);
assert.equal(STARTUP_PRODUCTION_HARDWARE_BASKET.find((entry) => entry.code === "8807")?.introducedYear, 2022);
assert.ok(DEFAULT_HARDWARE_BASKET_EXCLUSIONS.some((item) => item.includes("commodity inputs")));
assert.ok(DEFAULT_HARDWARE_BASKET_EXCLUSIONS.some((item) => item.includes("mobility")));

assert.deepEqual(buildOceanHardwareResearchWindow("2026-05"), {
  completeYears: [2021, 2022, 2023, 2024, 2025],
  currentYtdYear: 2026,
  ytdThroughMonth: 5,
  fromMonth: "2021-01",
  throughMonth: "2026-05",
});
assert.throws(() => buildOceanHardwareResearchWindow("2026-13"), /valid month/);

const caRequest = createOceanHardwareResearchRequest({
  question: "Find hardware imports that can expose startup shipment problems",
  asOfMonth: "2026-05",
  geographyScope: "california_destination",
});
assert.equal(caRequest.hsCodes.length, 46);
assert.deepEqual(caRequest.modes, ["vessel", "air"]);
assert.match(caRequest.geographyExplanation, /destination state/);

function row(
  id: string,
  period: string,
  hsCode: StartupHardwareHsCode,
  values: Partial<OceanHardwareImportRow> = {}
): OceanHardwareImportRow {
  return {
    id,
    period,
    hsCode,
    originCountryCode: "5700",
    originCountryName: "China",
    geographyBasis: "destination_state",
    destinationState: "CA",
    customsDistrictCode: null,
    customsDistrictName: null,
    vesselValueUsd: 100,
    vesselWeightKg: 10,
    airValueUsd: 40,
    airWeightKg: 2,
    sources: [census],
    ...values,
  };
}

const rows: OceanHardwareImportRow[] = [
  row("ca-2021-compute", "2021-02", "8471", { vesselValueUsd: 100, airValueUsd: 10 }),
  row("ca-2021-new-series", "2021-03", "8485", { vesselValueUsd: 999, airValueUsd: 999 }),
  row("ca-2021-aircraft-parts", "2021-04", "8807", { vesselValueUsd: 999, airValueUsd: 999 }),
  row("ca-2022-new-series", "2022-03", "8485", { vesselValueUsd: 200, airValueUsd: 20 }),
  row("ca-2025-power", "2025-12", "8507", {
    originCountryCode: "5880",
    originCountryName: "Japan",
    vesselValueUsd: 300,
    airValueUsd: 30,
  }),
  row("ca-2026-ytd", "2026-05", "8486", { vesselValueUsd: 400, airValueUsd: 80 }),
  row("ca-after-ytd", "2026-06", "8486", { vesselValueUsd: 5_000, airValueUsd: 5_000 }),
  row("wrong-state", "2025-01", "8471", { destinationState: "TX", vesselValueUsd: 8_000 }),
  row("la-gateway", "2025-01", "8517", {
    geographyBasis: "customs_district",
    destinationState: null,
    customsDistrictCode: "27",
    customsDistrictName: "Los Angeles, CA",
    vesselValueUsd: 700,
    airValueUsd: 70,
  }),
  row("houston-gateway", "2025-01", "8517", {
    geographyBasis: "customs_district",
    destinationState: null,
    customsDistrictCode: "53",
    customsDistrictName: "Houston, TX",
    vesselValueUsd: 9_000,
    airValueUsd: 900,
  }),
];

const observed: ManualObservedCompanyEvidence = {
  id: "observed-1",
  companyName: "Example Hardware Company",
  companyLocation: "San Jose, CA",
  observationType: "company_profile",
  observedRole: "importer",
  shipmentDate: "2026-04-20",
  supplierName: "Example Contract Manufacturer",
  originCountry: "Taiwan",
  productDescription: "Computer hardware",
  hsCodes: ["8471"],
  arrivalPort: "Los Angeles",
  weightKg: 1_200,
  containerCount: 1,
  billOfLadingNumber: null,
  reviewedAt: "2026-07-22T12:00:00.000Z",
  companyQualification: "not_assessed",
  leadQualification: "not_assessed",
  caveats: ["Public profile sample only"],
  sources: [manual],
};

const partialCoverage: OceanHardwareCoverage = {
  status: "partial",
  aggregateData: "partial",
  companyEvidence: "manual_sample",
  airCompanyEvidence: "unavailable",
  missingData: ["No complete company-level air shipment source is connected."],
  notes: ["Company rows are manually observed examples."],
  sources: [census, manual],
};

const caReport = composeOceanHardwareResearchReport({
  request: caRequest,
  rows,
  observedCompanies: [observed],
  coverage: partialCoverage,
  generatedAt: "2026-07-22T13:00:00.000Z",
});

assert.equal(caReport.document.status, "partial");
assert.equal(caReport.totals.vesselValueUsd, 1_000, "CA report includes eligible CA rows only");
assert.equal(caReport.totals.airValueUsd, 140, "air remains separate from vessel value");
assert.equal(caReport.years.find((item) => item.year === 2021)?.coverage.expectedHsCodeCount, 43);
assert.equal(caReport.years.find((item) => item.year === 2022)?.coverage.expectedHsCodeCount, 46);
assert.equal(caReport.years.find((item) => item.year === 2026)?.periodKind, "current_ytd");
assert.equal(caReport.years.find((item) => item.year === 2026)?.throughMonth, 5);
assert.equal(caReport.observedCompanies[0].companyQualification, "not_assessed");
assert.equal(caReport.observedCompanies[0].leadQualification, "not_assessed");
assert.deepEqual(
  caReport.currentGatewayCorridors,
  [],
  "raw destination-state rows do not manufacture gateway corridors"
);
assert.ok(caReport.document.sources.some((source) => source.sourceUrl === census.sourceUrl));
assert.ok(caReport.document.sources.some((source) => source.sourceUrl === manual.sourceUrl));
assert.ok(caReport.document.limitations.some((item) => item.id === "coverage_gap_1"));
assert.match(caReport.document.summary, /Requested window: 2021-2025 plus 2026 YTD/);
assert.match(caReport.document.summary, /Aggregate rows are loaded for 2021, 2022, 2025, 2026 YTD/);
assert.doesNotMatch(caReport.document.summary, /covers five complete years/i);
assert.ok(caReport.document.scope.notes.some((note) => note.includes("2021 proxy is not directly comparable")));
assert.equal(
  caReport.document.facts.find((fact) => fact.id === "current_ytd_vessel_value")?.confidence,
  "medium",
  "partial aggregate coverage cannot produce a high-confidence total"
);
assert.match(
  caReport.document.facts.find((fact) => fact.id === "current_ytd_vessel_value")?.detail ?? "",
  /sum of loaded aggregate rows/
);
assert.deepEqual(JSON.parse(JSON.stringify(caReport)), caReport, "ocean report survives a JSON round trip");

const blockedCoverage = deriveOceanHardwareCoverage({
  aggregateData: "unavailable",
  hasCompanyEvidence: false,
  missingData: ["No aggregate rows loaded."],
  notes: [],
  sources: [],
});
assert.equal(blockedCoverage.status, "blocked");
assert.equal(blockedCoverage.companyEvidence, "unavailable");

const manualOnlyCoverage = deriveOceanHardwareCoverage({
  aggregateData: "unavailable",
  hasCompanyEvidence: true,
  missingData: ["No aggregate rows loaded."],
  notes: [],
  sources: [manual],
});
assert.equal(manualOnlyCoverage.status, "partial");
assert.equal(manualOnlyCoverage.companyEvidence, "manual_sample");
assert.deepEqual(manualOnlyCoverage.sources, [manual]);

assert.equal(
  deriveOceanHardwareAggregateData({ requestedQueryCount: 5, successfulQueryCount: 5 }),
  "complete"
);
assert.equal(
  deriveOceanHardwareAggregateData({ requestedQueryCount: 5, successfulQueryCount: 3 }),
  "partial"
);
assert.equal(
  deriveOceanHardwareAggregateData({ requestedQueryCount: 5, successfulQueryCount: 0 }),
  "unavailable"
);
assert.equal(
  deriveOceanHardwareAggregateData({ requestedQueryCount: 0, successfulQueryCount: 0 }),
  "unavailable"
);
assert.throws(
  () => deriveOceanHardwareAggregateData({ requestedQueryCount: 5, successfulQueryCount: 6 }),
  /query counts/
);
const currentSnapshotCompleteCoverage = deriveOceanHardwareCoverage({
  aggregateData: deriveOceanHardwareAggregateData({ requestedQueryCount: 5, successfulQueryCount: 5 }),
  hasCompanyEvidence: false,
  missingData: ["Five-year history is not loaded."],
  notes: [],
  sources: [census],
});
assert.equal(currentSnapshotCompleteCoverage.aggregateData, "complete");
assert.equal(
  currentSnapshotCompleteCoverage.status,
  "partial",
  "a complete current snapshot does not conceal the missing five-year history"
);

const westRequest: OceanHardwareResearchRequest = createOceanHardwareResearchRequest({
  question: "Show hardware entering West Coast gateways",
  asOfMonth: "2026-05",
  geographyScope: "west_coast_gateway",
});
const westReport = composeOceanHardwareResearchReport({
  request: westRequest,
  rows,
  coverage: partialCoverage,
  generatedAt: "2026-07-22T13:00:00.000Z",
});
assert.equal(westReport.totals.vesselValueUsd, 700, "gateway report includes LA but excludes Houston and CA destination rows");
assert.equal(westReport.geographies[0].geographyKey, "district:27");
assert.deepEqual(
  westReport.currentGatewayCorridors,
  [],
  "customs-district rows do not masquerade as port-of-unlading corridors"
);
assert.match(westReport.request.geographyExplanation, /does not prove the importer or final destination/);

const portRequest = createOceanHardwareResearchRequest({
  question: "Show hardware unloaded at West Coast ports",
  asOfMonth: "2026-05",
  geographyScope: "west_coast_gateway",
  westCoastBasis: "port_of_unlading",
});
assert.equal(portRequest.geographyLabel, "West Coast ports of unlading");
assert.match(portRequest.geographyExplanation, /ports of unlading/);

assert.throws(
  () =>
    composeOceanHardwareResearchReport({
      request: caRequest,
      rows: [rows[0], rows[0]],
      coverage: partialCoverage,
      generatedAt: "2026-07-22T13:00:00.000Z",
    }),
  /Duplicate ocean hardware row id/,
  "duplicate aggregate records fail closed instead of double counting"
);
assert.throws(
  () =>
    composeOceanHardwareResearchReport({
      request: caRequest,
      rows: [],
      coverage: { ...partialCoverage, status: "complete" },
      generatedAt: "2026-07-22T13:00:00.000Z",
    }),
  /cannot list missing data/,
  "complete status cannot conceal known gaps"
);

for (const file of [
  "src/lib/intel/research/ocean-hardware.ts",
  "scripts/intel-ocean-hardware.test.ts",
]) {
  assert.equal(
    fs.readFileSync(path.join(process.cwd(), file), "utf8").includes("\u2014"),
    false,
    `${file} contains no em dash character`
  );
}

console.log("All ocean hardware research checks passed");
