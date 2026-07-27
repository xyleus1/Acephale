import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CENSUS_OCEAN_HARDWARE_QUERY_PARTITIONS,
  CENSUS_OCEAN_HARDWARE_MAX_FETCH_WALL_CLOCK_MS,
  buildCensusOceanSourceUrl,
  parseCensusOceanTable,
  resolveCensusOceanHardwareSnapshot,
} from "../src/lib/intel/research/census-ocean";
import {
  resolveIntelSourceUse,
  type IntelSourceUse,
} from "../src/lib/intel/sources";

async function main() {
assert.equal(CENSUS_OCEAN_HARDWARE_QUERY_PARTITIONS.length, 5);
assert.equal(CENSUS_OCEAN_HARDWARE_MAX_FETCH_WALL_CLOCK_MS, 50_000);
assert.ok(
  CENSUS_OCEAN_HARDWARE_MAX_FETCH_WALL_CLOCK_MS < 60_000,
  "all current Census partitions have a network wall-clock bound below the route limit"
);
assert.deepEqual(
  CENSUS_OCEAN_HARDWARE_QUERY_PARTITIONS.map((partition) => partition.commodity),
  ["84*", "85*", "88*", "90*", "847950"]
);

const stateSourceUrl = buildCensusOceanSourceUrl({
  scope: "california_destination",
  partitionId: "hs4-84",
  asOfMonth: "2026-05",
});
const stateUrl = new URL(stateSourceUrl);
assert.equal(stateUrl.pathname.endsWith("/imports/statehs"), true);
assert.equal(stateUrl.searchParams.get("STATE"), "CA");
assert.equal(stateUrl.searchParams.get("YEAR"), "2026");
assert.equal(stateUrl.searchParams.get("MONTH"), "05");
assert.equal(stateUrl.searchParams.get("COMM_LVL"), "HS4");
assert.equal(stateUrl.searchParams.get("I_COMMODITY"), "84*");
assert.equal(stateUrl.searchParams.get("SUMMARY_LVL"), "DET");
assert.equal(stateUrl.searchParams.get("SUMMARY_LVL2"), "HSSTCY");
assert.equal(stateUrl.searchParams.has("key"), false, "citation URL contains no API key");
assert.doesNotThrow(() =>
  resolveIntelSourceUse({
    sourceId: "census_trade",
    sourceUrl: stateSourceUrl,
    asOf: "2026-05",
    fetchedAt: "2026-07-22T12:00:00.000Z",
    reviewedAt: null,
  })
);
for (const variable of [
  "GEN_VAL_YR",
  "VES_VAL_YR",
  "VES_WGT_YR",
  "CNT_VAL_YR",
  "CNT_WGT_YR",
  "AIR_VAL_YR",
  "AIR_WGT_YR",
]) {
  assert.ok(stateUrl.searchParams.get("get")?.split(",").includes(variable));
}

const gatewaySourceUrl = buildCensusOceanSourceUrl({
  scope: "west_coast_gateway",
  partitionId: "hs6-847950",
  asOfMonth: "2025-12",
});
const gatewayUrl = new URL(gatewaySourceUrl);
assert.equal(gatewayUrl.pathname.endsWith("/imports/hs"), true);
assert.deepEqual(gatewayUrl.searchParams.getAll("DISTRICT"), ["25", "27", "28", "29", "30"]);
assert.equal(gatewayUrl.searchParams.get("COMM_LVL"), "HS6");
assert.equal(gatewayUrl.searchParams.get("I_COMMODITY"), "847950");
assert.equal(gatewayUrl.searchParams.get("SUMMARY_LVL2"), "HSCYDT");
assert.equal(gatewayUrl.searchParams.has("key"), false);

const source: IntelSourceUse = {
  sourceId: "census_trade",
  sourceUrl: stateSourceUrl,
  asOf: "2026-05",
  fetchedAt: "2026-07-22T12:00:00.000Z",
  reviewedAt: null,
};
const stateFixture = JSON.stringify([
  [
    "AIR_WGT_YR",
    "STATE",
    "CTY_NAME",
    "I_COMMODITY",
    "CNT_VAL_YR",
    "LAST_UPDATE",
    "VES_VAL_YR",
    "GEN_VAL_YR",
    "CTY_CODE",
    "VES_WGT_YR",
    "CNT_WGT_YR",
    "AIR_VAL_YR",
  ],
  ["12", "CA", "CHINA", "8471", "0", "2026-07-08", "0", "", "5700", "", "0", "25"],
  ["2", "CA", "JAPAN", "8479", "3", "2026-07-08", "4", "5", "5880", "6", "7", "8"],
  ["2", "CA", "TOTAL FOR ALL COUNTRIES", "8471", "3", "2026-07-08", "4", "5", "-", "6", "7", "8"],
  ["2", "TX", "JAPAN", "8471", "3", "2026-07-08", "4", "5", "5880", "6", "7", "8"],
]);
const stateRows = parseCensusOceanTable({
  text: stateFixture,
  scope: "california_destination",
  partitionId: "hs4-84",
  asOfMonth: "2026-05",
  source,
});
assert.equal(stateRows.length, 1, "only exact-basket, individual-country, CA rows survive");
assert.equal(stateRows[0].generalValueUsd, null, "blank is missing, not zero");
assert.equal(stateRows[0].vesselValueUsd, 0, "reported zero remains zero");
assert.equal(stateRows[0].vesselWeightKg, null);
assert.equal(stateRows[0].containerizedVesselValueUsd, 0);
assert.equal(stateRows[0].airValueUsd, 25);
assert.equal(stateRows[0].geographyBasis, "destination_state");
assert.equal(stateRows[0].destinationState, "CA");
assert.equal(stateRows[0].customsDistrictCode, null);

const introducedSeriesFixture = JSON.stringify([
  [
    "STATE",
    "CTY_CODE",
    "CTY_NAME",
    "I_COMMODITY",
    "GEN_VAL_YR",
    "VES_VAL_YR",
    "VES_WGT_YR",
    "CNT_VAL_YR",
    "CNT_WGT_YR",
    "AIR_VAL_YR",
    "AIR_WGT_YR",
    "LAST_UPDATE",
  ],
  ["CA", "5700", "CHINA", "8485", "1", "1", "1", "1", "1", "1", "1", "2022-02-01"],
]);
assert.equal(
  parseCensusOceanTable({
    text: introducedSeriesFixture,
    scope: "california_destination",
    partitionId: "hs4-84",
    asOfMonth: "2021-12",
    source: { ...source, asOf: "2021-12" },
  }).length,
  0,
  "HS 8485 is not treated as available before 2022"
);
const aircraftPartsFixture = introducedSeriesFixture.replaceAll("8485", "8807");
assert.equal(
  parseCensusOceanTable({
    text: aircraftPartsFixture,
    scope: "california_destination",
    partitionId: "hs4-88",
    asOfMonth: "2021-12",
    source: { ...source, asOf: "2021-12" },
  }).length,
  0,
  "HS 8807 is not treated as a comparable series before its 2022 introduction"
);

const districtSource: IntelSourceUse = {
  ...source,
  sourceUrl: gatewaySourceUrl,
  asOf: "2025-12",
};
const districtFixture = JSON.stringify([
  [
    "DISTRICT",
    "DIST_NAME",
    "CTY_CODE",
    "CTY_NAME",
    "I_COMMODITY",
    "GEN_VAL_YR",
    "VES_VAL_YR",
    "VES_WGT_YR",
    "CNT_VAL_YR",
    "CNT_WGT_YR",
    "AIR_VAL_YR",
    "AIR_WGT_YR",
    "LAST_UPDATE",
  ],
  ["27", "LOS ANGELES, CA", "5700", "CHINA", "847950", "100", "80", "30", "70", "25", "20", "5", "2026-02-04"],
  ["53", "HOUSTON-GALVESTON, TX", "5700", "CHINA", "847950", "999", "999", "999", "999", "999", "999", "999", "2026-02-04"],
]);
const districtRows = parseCensusOceanTable({
  text: districtFixture,
  scope: "west_coast_gateway",
  partitionId: "hs6-847950",
  asOfMonth: "2025-12",
  source: districtSource,
});
assert.equal(districtRows.length, 1);
assert.equal(districtRows[0].geographyBasis, "customs_district");
assert.equal(districtRows[0].customsDistrictCode, "27");
assert.equal(districtRows[0].destinationState, null);
assert.equal(districtRows[0].containerizedVesselValueUsd, 70);

assert.throws(
  () =>
    parseCensusOceanTable({
      text: JSON.stringify([["STATE", "I_COMMODITY"], ["CA", "8471"]]),
      scope: "california_destination",
      partitionId: "hs4-84",
      asOfMonth: "2026-05",
      source,
    }),
  /Invalid Census response: missing/,
  "missing required headers fail as an invalid query instead of becoming zero"
);
assert.throws(
  () =>
    parseCensusOceanTable({
      text: stateFixture.replace('"0","","5700"', '"not-a-number","","5700"'),
      scope: "california_destination",
      partitionId: "hs4-84",
      asOfMonth: "2026-05",
      source,
    }),
  /Invalid Census response:/,
  "a malformed non-empty metric fails the query instead of becoming zero or missing"
);

const previousKey = process.env.CENSUS_API_KEY;
delete process.env.CENSUS_API_KEY;
try {
  const unavailable = await resolveCensusOceanHardwareSnapshot({ asOfMonth: "2026-05" });
  assert.equal(unavailable.coverage.status, "blocked");
  assert.equal(unavailable.coverage.aggregateData, "unavailable");
  assert.equal(unavailable.coverage.requestedQueryCount, 10);
  assert.equal(unavailable.coverage.successfulQueryCount, 0);
  assert.equal(unavailable.coverage.failedQueryCount, 10);
  assert.equal(unavailable.coverage.fiveYearHistory, "not_fetched");
  assert.equal(unavailable.sources.length, 0);
  assert.equal(unavailable.californiaDestination.failures[0].code, "missing_api_key");
  assert.equal(unavailable.westCoastGateways.failures[0].code, "missing_api_key");
  assert.ok(
    unavailable.californiaDestination.missingData.some((item) => item.includes("CENSUS_API_KEY")),
    "California coverage carries its own missing-key explanation"
  );
  assert.ok(
    unavailable.westCoastGateways.missingData.some((item) => item.includes("CENSUS_API_KEY")),
    "gateway coverage carries its own missing-key explanation"
  );
  assert.notEqual(
    unavailable.californiaDestination.missingData,
    unavailable.westCoastGateways.missingData,
    "scope coverage arrays are independent provenance records"
  );
} finally {
  if (previousKey == null) delete process.env.CENSUS_API_KEY;
  else process.env.CENSUS_API_KEY = previousKey;
}

for (const file of [
  "src/lib/intel/research/census-ocean.ts",
  "scripts/intel-census-ocean.test.ts",
]) {
  assert.equal(
    fs.readFileSync(path.join(process.cwd(), file), "utf8").includes("\u2014"),
    false,
    `${file} contains no em dash character`
  );
}

console.log("All Intel Census ocean checks passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
