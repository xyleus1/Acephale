import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import snapshotJson from "../src/lib/intel/research/generated/census-public-hardware-v1.json";
import {
  parseCensusPortHs6Line,
  parseCensusStateHs6Line,
  parseAsOfMonth,
  startupHardwareBasketCodeFor,
} from "./build-census-public-hardware-snapshot";
import {
  buildCensusPublicPrecomputedRollups,
  buildCensusPublicReportStatus,
  censusSourceValidatorsMatch,
  compareCensusPublicGatewayCorridors,
  validateCensusPublicHardwareSnapshot,
  type CensusPublicGatewayCorridorSummary,
  type CensusPublicHardwareSnapshot,
} from "../src/lib/intel/research/census-public-hardware";
import {
  STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET_ID,
  STARTUP_PRODUCTION_HARDWARE_CORE43_CODES,
} from "../src/lib/intel/research/ocean-hardware";

function fixedWidthRecord(
  length: number,
  fields: readonly [start: number, end: number, value: string][]
): string {
  const record = Array<string>(length).fill(" ");
  for (const [start, end, rawValue] of fields) {
    const width = end - start;
    assert.ok(rawValue.length <= width, `fixture value ${rawValue} fits ${start}:${end}`);
    const value = /^\d+$/.test(rawValue) && rawValue.length < width
      ? rawValue.padStart(width, " ")
      : rawValue.padEnd(width, " ");
    for (let index = 0; index < width; index += 1) record[start + index] = value[index];
  }
  return record.join("");
}

assert.deepEqual(parseAsOfMonth("2026-05"), { year: 2026, month: 5 });
assert.throws(
  () => parseAsOfMonth("2026-12"),
  /January through November/,
  "December refreshes fail with an explicit complete-year contract boundary"
);

const stateFixture = fixedWidthRecord(258, [
  [0, 6, "847950"],
  [6, 10, "5520"],
  [10, 12, "CA"],
  [12, 16, "2026"],
  [16, 18, "05"],
  [138, 153, "1000"],
  [168, 183, "100"],
  [183, 198, "10"],
  [198, 213, "800"],
  [213, 228, "80"],
  [228, 243, "700"],
  [243, 258, "70"],
]);
const expectedStateFields = {
  hsCode: "847950",
  countryCode: "5520",
  geographyCode: "CA",
  generalValueUsd: 1000,
  airValueUsd: 100,
  airWeightKg: 10,
  vesselValueUsd: 800,
  vesselWeightKg: 80,
  containerizedVesselValueUsd: 700,
  containerizedVesselWeightKg: 70,
};
assert.deepEqual(
  parseCensusStateHs6Line(stateFixture, "2026-05"),
  expectedStateFields,
  "the 258-character State HS6 layout reads exact YTD offsets"
);
assert.deepEqual(
  parseCensusStateHs6Line(`${stateFixture}${" ".repeat(22)}`, "2026-05"),
  expectedStateFields,
  "the documented 280-character State HS6 variant accepts blank trailing filler"
);
assert.equal(startupHardwareBasketCodeFor("854231", 2026), "8542", "HS6 rows roll up to declared HS4 groups");
assert.equal(startupHardwareBasketCodeFor("847950", 2026), "847950", "industrial robots retain their HS6 group");
assert.equal(startupHardwareBasketCodeFor("880610", 2021), null, "HS 2022 headings are excluded from 2021");

const portFixture = fixedWidthRecord(230, [
  [0, 6, "850440"],
  [6, 10, "5700"],
  [10, 14, "2704"],
  [14, 18, "2026"],
  [18, 20, "05"],
  [125, 140, "2000"],
  [140, 155, "200"],
  [155, 170, "20"],
  [170, 185, "1600"],
  [185, 200, "160"],
  [200, 215, "1500"],
  [215, 230, "150"],
]);
assert.deepEqual(
  parseCensusPortHs6Line(portFixture, "2026-05"),
  {
    hsCode: "8504",
    countryCode: "5700",
    geographyCode: "27",
    generalValueUsd: 2000,
    airValueUsd: 200,
    airWeightKg: 20,
    vesselValueUsd: 1600,
    vesselWeightKg: 160,
    containerizedVesselValueUsd: 1500,
    containerizedVesselWeightKg: 150,
  },
  "the 230-character Port HS6 layout reads exact YTD offsets and district"
);
const inlandPortFixture = `${portFixture.slice(0, 10)}1101${portFixture.slice(14)}`;
assert.equal(
  parseCensusPortHs6Line(inlandPortFixture, "2026-05"),
  null,
  "ports outside the five declared West Coast districts are excluded"
);

const snapshot = validateCensusPublicHardwareSnapshot(
  snapshotJson as CensusPublicHardwareSnapshot
);
assert.throws(
  () =>
    validateCensusPublicHardwareSnapshot({
      ...snapshot,
      asOfMonth: "2025-12",
    }),
  /January through November/,
  "a December artifact cannot be recast as the current YTD period"
);

assert.equal(
  censusSourceValidatorsMatch({
    remoteLastModified: "Tue, 07 Jul 2026 13:24:00 GMT",
    remoteEtag: '"archive-v2"',
    cachedLastModified: "Tue, 07 Jul 2026 13:24:00 GMT",
    cachedEtag: '"archive-v2"',
  }),
  true,
  "all available upstream validators can match"
);
assert.equal(
  censusSourceValidatorsMatch({
    remoteLastModified: "Tue, 07 Jul 2026 13:24:00 GMT",
    remoteEtag: '"archive-v3"',
    cachedLastModified: "Tue, 07 Jul 2026 13:24:00 GMT",
    cachedEtag: '"archive-v2"',
  }),
  false,
  "a matching revision date cannot mask a changed ETag"
);
assert.equal(
  censusSourceValidatorsMatch({
    remoteLastModified: "Wed, 08 Jul 2026 13:24:00 GMT",
    remoteEtag: '"archive-v2"',
    cachedLastModified: "Tue, 07 Jul 2026 13:24:00 GMT",
    cachedEtag: '"archive-v2"',
  }),
  false,
  "a matching ETag cannot mask a changed revision date"
);
assert.equal(
  censusSourceValidatorsMatch({
    remoteLastModified: null,
    remoteEtag: null,
    cachedLastModified: "Tue, 07 Jul 2026 13:24:00 GMT",
    cachedEtag: '"archive-v2"',
  }),
  false,
  "a cache is not trusted when the server provides no identity validator"
);

assert.equal(snapshot.schemaVersion, 4);
assert.equal(snapshot.basketId, "startup_production_hardware_v1");
assert.ok(
  fs.statSync(
    path.join(
      process.cwd(),
      "src/lib/intel/research/generated/census-public-hardware-v1.json"
    )
  ).size < 1_300_000,
  "the reviewed snapshot stays below the 1.3 MB artifact budget"
);
assert.match(snapshot.asOfMonth, /^\d{4}-(0[1-9]|1[0-2])$/);
assert.equal(snapshot.countryDictionarySource.dataUrl.includes("key="), false);
assert.match(snapshot.countryDictionarySource.archiveSha256, /^[a-f0-9]{64}$/);
assert.equal(Number.isNaN(new Date(snapshot.countryDictionarySource.fetchedAt).getTime()), false);
const currentSnapshotYear = Number(snapshot.asOfMonth.slice(0, 4));
assert.deepEqual(
  snapshot.periods.map((period) => period.period),
  [
    ...Array.from({ length: 5 }, (_, index) => `${currentSnapshotYear - 5 + index}-12`),
    snapshot.asOfMonth,
  ]
);
for (const period of snapshot.periods) {
  const periodYear = Number(period.period.slice(0, 4));
  assert.equal(period.applicableHsCodeCount, periodYear < 2022 ? 43 : 46);
}

assert.equal(snapshot.originHistorySlices.length, 1);
const chinaHistory = snapshot.originHistorySlices[0];
assert.equal(chinaHistory.originCountryCode, "5700");
assert.equal(chinaHistory.originCountryName, "China");
assert.equal(
  chinaHistory.basketId,
  STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET_ID
);
assert.equal(chinaHistory.startYear, 2010);
assert.equal(chinaHistory.applicableHsCodeCount, 43);
const expectedCore43CodeKey = [...STARTUP_PRODUCTION_HARDWARE_CORE43_CODES]
  .sort()
  .join(",");
assert.deepEqual(
  chinaHistory.periods.map((period) => period.period),
  [
    ...Array.from(
      { length: currentSnapshotYear - 2010 },
      (_, index) => `${2010 + index}-12`
    ),
    snapshot.asOfMonth,
  ],
  "the compact China core43 history is continuous from 2010 through the current YTD period"
);
assert.equal(
  new Set(
    chinaHistory.periods.flatMap((period) => [
      period.californiaDestination.source.dataUrl,
      period.westCoastGateways.source.dataUrl,
    ])
  ).size,
  chinaHistory.periods.length * 2,
  "every historical scope retains its exact official Census archive URL"
);
for (const period of chinaHistory.periods) {
  assert.equal(
    period.periodKind,
    period.period.endsWith("-12") ? "complete_year" : "current_ytd"
  );
  for (const scope of [
    period.californiaDestination,
    period.westCoastGateways,
  ]) {
    assert.equal(scope.observedHsCodeKey, expectedCore43CodeKey);
    assert.ok(scope.matchedSourceRowCount > 0);
    assert.ok(scope.originMatchedSourceRowCount > 0);
    assert.ok(scope.originMatchedSourceRowCount <= scope.matchedSourceRowCount);
    assert.match(scope.source.archiveSha256, /^[a-f0-9]{64}$/);
    assert.equal(scope.source.dataUrl.includes("key="), false);
    for (const metric of [
      "generalValueUsd",
      "vesselValueUsd",
      "vesselWeightKg",
      "containerizedVesselValueUsd",
      "containerizedVesselWeightKg",
      "airValueUsd",
      "airWeightKg",
    ] as const) {
      assert.ok(
        scope.originTotals[metric] <= scope.totals[metric],
        `${period.period} China ${scope.scope} ${metric} stays within its all-origin total`
      );
    }
    assert.equal(
      scope.originCategoryVesselSummaries.reduce(
        (sum, category) => sum + category.vesselValueUsd,
        0
      ),
      scope.originTotals.vesselValueUsd
    );
    assert.equal(
      scope.originCategoryVesselSummaries.reduce(
        (sum, category) => sum + category.vesselWeightKg,
        0
      ),
      scope.originTotals.vesselWeightKg
    );
    assert.equal(
      scope.originGeographyVesselSummaries.reduce(
        (sum, geography) => sum + geography.vesselValueUsd,
        0
      ),
      scope.originTotals.vesselValueUsd
    );
    assert.equal(
      scope.originGeographyVesselSummaries.reduce(
        (sum, geography) => sum + geography.vesselWeightKg,
        0
      ),
      scope.originTotals.vesselWeightKg
    );
  }
}

const firstChinaHistoryPeriod = chinaHistory.periods[0];
assert.equal(firstChinaHistoryPeriod.period, "2010-12");
assert.equal(
  firstChinaHistoryPeriod.californiaDestination.originTotals.vesselValueUsd,
  23_146_595_943
);
assert.equal(
  firstChinaHistoryPeriod.californiaDestination.totals.vesselValueUsd,
  31_094_724_001
);
assert.equal(
  firstChinaHistoryPeriod.westCoastGateways.originTotals.vesselValueUsd,
  45_360_375_377
);
assert.equal(
  firstChinaHistoryPeriod.westCoastGateways.totals.vesselValueUsd,
  67_427_247_346
);
const currentChinaHistoryPeriod = chinaHistory.periods.at(-1)!;
assert.equal(currentChinaHistoryPeriod.period, snapshot.asOfMonth);
assert.equal(
  currentChinaHistoryPeriod.westCoastGateways.originTotals.vesselValueUsd,
  8_701_070_792
);
assert.equal(
  currentChinaHistoryPeriod.westCoastGateways.totals.vesselValueUsd,
  41_926_717_483
);

for (const period of snapshot.periods) {
  assert.equal(period.californiaDestination.basis, "state_of_ultimate_destination");
  assert.equal(period.westCoastGateways.basis, "port_of_unlading");
  assert.ok(period.californiaDestination.matchedSourceRowCount > 0);
  assert.ok(period.westCoastGateways.matchedSourceRowCount > 0);
  assert.ok(period.californiaDestination.totals.vesselValueUsd > 0);
  assert.ok(period.westCoastGateways.totals.vesselValueUsd > 0);
  assert.match(period.californiaDestination.source.archiveSha256, /^[a-f0-9]{64}$/);
  assert.match(period.westCoastGateways.source.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    period.californiaDestination.source.dataUrl.includes("state_imp/hs6_m/ISTHSM"),
    true
  );
  assert.equal(
    period.westCoastGateways.source.dataUrl.includes("Port/im_hs6_m/PORTHS6MM"),
    true
  );
  assert.equal(period.californiaDestination.source.dataUrl.includes("key="), false);
  assert.equal(period.westCoastGateways.source.dataUrl.includes("key="), false);
  assert.equal(
    period.californiaDestination.countries.some((country) =>
      country.countryName.startsWith("Schedule C ")
    ),
    false,
    `${period.period} California countries all resolve through Schedule C`
  );
  assert.equal(
    period.westCoastGateways.countries.some((country) =>
      country.countryName.startsWith("Schedule C ")
    ),
    false,
    `${period.period} West Coast countries all resolve through Schedule C`
  );
}

const currentWestCoastScope = snapshot.periods.find(
  (period) => period.period === snapshot.asOfMonth
)!.westCoastGateways;
const corridorSlice = snapshot.currentWestCoastCorridors;
assert.equal(corridorSlice.period, snapshot.asOfMonth);
assert.equal(corridorSlice.geographyBasis, "port_of_unlading_district");
assert.equal(corridorSlice.originBasis, "country_of_origin");
assert.equal(corridorSlice.commodityBasis, "startup_hardware_category");
assert.ok(corridorSlice.positiveVesselSegments.length > 0);
assert.equal(
  new Set(
    corridorSlice.positiveVesselSegments.map(
      (segment) =>
        `${segment.category}:${segment.countryCode}:${segment.gatewayDistrictCode}`
    )
  ).size,
  corridorSlice.positiveVesselSegments.length,
  "current corridor tuples are unique"
);
assert.equal(
  corridorSlice.positiveVesselSegments.every(
    (segment, index) =>
      segment.vesselValueUsd > 0 &&
      (index === 0 ||
        corridorSlice.positiveVesselSegments[index - 1].vesselValueUsd >=
          segment.vesselValueUsd)
  ),
  true,
  "only positive vessel segments are stored in descending value order"
);
for (const metric of [
  "vesselValueUsd",
  "vesselWeightKg",
  "containerizedVesselValueUsd",
  "containerizedVesselWeightKg",
] as const) {
  assert.equal(
    corridorSlice.positiveVesselSegments.reduce(
      (sum, segment) => sum + segment[metric],
      0
    ),
    currentWestCoastScope.totals[metric],
    `${metric} corridors reconcile exactly to the current West Coast scope`
  );
}

const california = buildCensusPublicPrecomputedRollups(snapshot, "california_destination");
const gateways = buildCensusPublicPrecomputedRollups(snapshot, "west_coast_gateway");
assert.equal(california.years.length, 6);
assert.equal(gateways.years.length, 6);
assert.deepEqual(
  california.currentGatewayCorridors,
  [],
  "California destination reports do not receive port corridor data"
);
assert.equal(
  gateways.currentGatewayCorridors.length,
  corridorSlice.positiveVesselSegments.length,
  "the domain layer retains every validated current corridor"
);
assert.equal(
  gateways.currentGatewayCorridors.every(
    (corridor) =>
      corridor.period === snapshot.asOfMonth &&
      corridor.categoryLabel.length > 0 &&
      corridor.countryName.length > 0 &&
      corridor.gatewayDistrictLabel.length > 0 &&
      corridor.sources.some((source) => source.sourceId === "census_trade_downloads") &&
      corridor.sources.some((source) => source.sourceId === "census_schedule_c")
  ),
  true,
  "the domain layer resolves corridor labels and evidence"
);
for (const [label, countries] of [
  ["California", california.currentCountries],
  ["West Coast", gateways.currentCountries],
] as const) {
  assert.ok(countries.length > 8, `${label} retains a full origin ranking`);
  assert.equal(
    countries.every((country, index) =>
      index === 0 ||
      (countries[index - 1].totals.vesselValueUsd ?? 0) >= (country.totals.vesselValueUsd ?? 0)
    ),
    true,
    `${label} current origins remain ranked by vessel value`
  );
}
assert.equal(
  california.currentCountries.reduce(
    (sum, country) => sum + (country.totals.vesselValueUsd ?? 0),
    0
  ),
  california.years.at(-1)?.totals.vesselValueUsd,
  "current California origin totals do not blend historical periods"
);
assert.equal(
  gateways.currentCountries.reduce(
    (sum, country) => sum + (country.totals.vesselValueUsd ?? 0),
    0
  ),
  gateways.years.at(-1)?.totals.vesselValueUsd,
  "current West Coast origin totals do not blend historical periods"
);
assert.ok(
  (california.countries[0].totals.vesselValueUsd ?? 0) >
    (california.currentCountries[0].totals.vesselValueUsd ?? 0),
  "all-period origins remain distinct from the current-period ranking"
);
for (const [label, sources] of [
  ["California", california.sources],
  ["West Coast", gateways.sources],
] as const) {
  assert.equal(sources.filter((source) => source.sourceId === "census_trade_downloads").length, 6);
  assert.equal(sources.filter((source) => source.sourceId === "census_schedule_c").length, 1);
  assert.equal(sources.length, 7, `${label} rollups retain six import archives and Schedule C`);
  assert.equal(
    sources.filter((source) => source.sourceId === "census_trade_downloads").every(
      (source) => source.displayName?.includes("Imports HS6, ")
    ),
    true,
    `${label} import archives have scope and period labels`
  );
}
assert.equal(
  california.sources.every((source) => /^[a-f0-9]{64}$/.test(source.integritySha256 ?? "")),
  true,
  "California source uses retain archive checksums"
);
assert.equal(
  gateways.sources.every((source) => /^[a-f0-9]{64}$/.test(source.integritySha256 ?? "")),
  true,
  "West Coast source uses retain archive checksums"
);

const status = buildCensusPublicReportStatus(snapshot);
const uniqueSnapshotArchiveUrls = new Set([
  ...snapshot.periods.flatMap((period) => [
    period.californiaDestination.source.dataUrl,
    period.westCoastGateways.source.dataUrl,
  ]),
  ...snapshot.originHistorySlices.flatMap((slice) =>
    slice.periods.flatMap((period) => [
      period.californiaDestination.source.dataUrl,
      period.westCoastGateways.source.dataUrl,
    ])
  ),
]);
assert.equal(status.sourceFileCount, uniqueSnapshotArchiveUrls.size);
assert.equal(status.sourceFileCount, 34);
assert.equal(status.californiaCurrentLoaded, true);
assert.equal(status.gatewayCurrentLoaded, true);
const expectedHistoricalYears = snapshot.periods
  .filter((period) => period.periodKind === "complete_year")
  .map((period) => Number(period.period.slice(0, 4)));
assert.deepEqual(status.californiaLoadedYears, expectedHistoricalYears);
assert.deepEqual(status.gatewayLoadedYears, expectedHistoricalYears);
assert.ok((status.californiaContainerizedValueUsd ?? 0) > 0);
assert.ok((status.gatewayContainerizedValueUsd ?? 0) > 0);
const sourceRevisionDates = snapshot.periods
  .flatMap((period) => [
    period.californiaDestination.source.lastModified,
    period.westCoastGateways.source.lastModified,
  ])
  .filter((value): value is string => value != null);
sourceRevisionDates.push(
  ...snapshot.originHistorySlices
    .flatMap((slice) =>
      slice.periods.flatMap((period) => [
        period.californiaDestination.source.lastModified,
        period.westCoastGateways.source.lastModified,
      ])
    )
    .filter((value): value is string => value != null)
);
if (snapshot.countryDictionarySource.lastModified) {
  sourceRevisionDates.push(snapshot.countryDictionarySource.lastModified);
}
const expectedLatestRevision = sourceRevisionDates.reduce((latest, value) =>
  new Date(value).getTime() > new Date(latest).getTime() ? value : latest
);
assert.equal(
  status.latestSourceModifiedAt,
  expectedLatestRevision,
  "latest source HTTP timestamp compares dates chronologically"
);

const corruptCoverage = structuredClone(snapshot);
const corruptCurrent = corruptCoverage.periods.at(-1)?.californiaDestination;
assert.ok(corruptCurrent);
corruptCurrent.matchedSourceRowCount = 1;
corruptCurrent.observedHsCodes = [corruptCurrent.observedHsCodes[0]];
corruptCurrent.categories = [];
corruptCurrent.countries = [];
corruptCurrent.geographies = [];
corruptCurrent.originCountryCount = 1;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(corruptCoverage),
  /does not cover every applicable HS code/,
  "a partial or corrupt scope cannot be reported as complete"
);

const missingPeriod = structuredClone(snapshot);
missingPeriod.periods = missingPeriod.periods.slice(1);
assert.throws(
  () => validateCensusPublicHardwareSnapshot(missingPeriod),
  /five-year window/,
  "the requested five-year window is mandatory"
);

const missingHistoryPeriod = structuredClone(snapshot);
missingHistoryPeriod.originHistorySlices[0].periods =
  missingHistoryPeriod.originHistorySlices[0].periods.slice(1);
assert.throws(
  () => validateCensusPublicHardwareSnapshot(missingHistoryPeriod),
  /complete China core43 history window/,
  "the China core43 history cannot silently omit an official year"
);

const corruptHistoryCoverage = structuredClone(snapshot);
corruptHistoryCoverage.originHistorySlices[0].periods[0].californiaDestination.observedHsCodeKey =
  STARTUP_PRODUCTION_HARDWARE_CORE43_CODES[0];
assert.throws(
  () => validateCensusPublicHardwareSnapshot(corruptHistoryCoverage),
  /does not cover every core43 HS code/,
  "the historical all-origin denominator must cover the exact core43 basket"
);

const excessiveHistoryOrigin = structuredClone(snapshot);
const excessiveHistoryOriginScope =
  excessiveHistoryOrigin.originHistorySlices[0].periods[0]
    .californiaDestination;
excessiveHistoryOriginScope.originTotals.vesselValueUsd =
  excessiveHistoryOriginScope.totals.vesselValueUsd + 1;
excessiveHistoryOriginScope.originTotals.airValueUsd = 0;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(excessiveHistoryOrigin),
  /origin vesselValueUsd exceeds the all-origin total/,
  "historical China totals cannot exceed their official all-origin denominator"
);

const corruptHistoryCategory = structuredClone(snapshot);
corruptHistoryCategory.originHistorySlices[0].periods[0]
  .californiaDestination.originCategoryVesselSummaries[0].vesselValueUsd += 1;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(corruptHistoryCategory),
  /categories vesselValueUsd does not reconcile/,
  "historical category marginals reconcile to the China vessel total"
);

const corruptHistoryGeography = structuredClone(snapshot);
corruptHistoryGeography.originHistorySlices[0].periods[0]
  .westCoastGateways.originGeographyVesselSummaries[0].vesselWeightKg += 1;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(corruptHistoryGeography),
  /geographies vesselWeightKg does not reconcile/,
  "historical gateway marginals reconcile to the China vessel total"
);

const wrongHistoricSourceFile = structuredClone(snapshot);
wrongHistoricSourceFile.originHistorySlices[0].periods[0]
  .westCoastGateways.source.fileName = "wrong.txt";
assert.throws(
  () => validateCensusPublicHardwareSnapshot(wrongHistoricSourceFile),
  /wrong source file/,
  "historical records retain exact official archive and text-file identity"
);

const unresolvedCountry = structuredClone(snapshot);
unresolvedCountry.periods.at(-1)!.californiaDestination.countries[0].countryName =
  `Schedule C ${unresolvedCountry.periods.at(-1)!.californiaDestination.countries[0].countryCode}`;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(unresolvedCountry),
  /invalid country metadata/,
  "unresolved Schedule C codes cannot pass snapshot validation"
);

const metricRollupSelectors = [
  {
    label: "scope",
    select: (candidate: CensusPublicHardwareSnapshot) =>
      candidate.periods.at(-1)!.californiaDestination.totals,
  },
  {
    label: "category",
    select: (candidate: CensusPublicHardwareSnapshot) =>
      candidate.periods.at(-1)!.californiaDestination.categories[0].totals,
  },
  {
    label: "country",
    select: (candidate: CensusPublicHardwareSnapshot) =>
      candidate.periods.at(-1)!.californiaDestination.countries[0].totals,
  },
  {
    label: "geography",
    select: (candidate: CensusPublicHardwareSnapshot) =>
      candidate.periods.at(-1)!.californiaDestination.geographies[0].totals,
  },
] as const;
for (const invalidMetric of [
  { label: "fractional", value: 0.5 },
  { label: "unsafe", value: Number.MAX_SAFE_INTEGER + 1 },
] as const) {
  for (const rollup of metricRollupSelectors) {
    const invalidRollupMetric = structuredClone(snapshot);
    rollup.select(invalidRollupMetric).airWeightKg = invalidMetric.value;
    assert.throws(
      () => validateCensusPublicHardwareSnapshot(invalidRollupMetric),
      /airWeightKg must be a safe non-negative integer/,
      `${rollup.label} totals reject ${invalidMetric.label} metrics`
    );
  }
}

const duplicateCorridor = structuredClone(snapshot);
duplicateCorridor.currentWestCoastCorridors.positiveVesselSegments.push({
  ...duplicateCorridor.currentWestCoastCorridors.positiveVesselSegments[0],
});
assert.throws(
  () => validateCensusPublicHardwareSnapshot(duplicateCorridor),
  /duplicate tuple/,
  "duplicate corridor tuples fail closed"
);

const unknownCorridorDistrict = structuredClone(snapshot);
unknownCorridorDistrict.currentWestCoastCorridors.positiveVesselSegments[0].gatewayDistrictCode =
  "99";
assert.throws(
  () => validateCensusPublicHardwareSnapshot(unknownCorridorDistrict),
  /unknown gateway district/,
  "corridors cannot introduce districts outside the declared West Coast scope"
);

const unknownCorridorCountry = structuredClone(snapshot);
unknownCorridorCountry.currentWestCoastCorridors.positiveVesselSegments[0].countryCode =
  "9999";
assert.throws(
  () => validateCensusPublicHardwareSnapshot(unknownCorridorCountry),
  /unknown country/,
  "corridors cannot introduce an origin outside the current official country dimension"
);

const wrongCorridorPeriod = structuredClone(snapshot);
wrongCorridorPeriod.currentWestCoastCorridors.period = "2026-04";
assert.throws(
  () => validateCensusPublicHardwareSnapshot(wrongCorridorPeriod),
  /wrong period or basis/,
  "the corridor slice must match the snapshot current period"
);

const zeroValueCorridor = structuredClone(snapshot);
zeroValueCorridor.currentWestCoastCorridors.positiveVesselSegments[0].vesselValueUsd = 0;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(zeroValueCorridor),
  /must have positive vessel value/,
  "zero-value corridor records are excluded from the compact slice"
);

const unsafeCorridorMetric = structuredClone(snapshot);
unsafeCorridorMetric.currentWestCoastCorridors.positiveVesselSegments[0].vesselValueUsd =
  Number.MAX_SAFE_INTEGER + 1;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(unsafeCorridorMetric),
  /safe non-negative integer/,
  "unsafe corridor metrics fail closed"
);

const excessiveContainerizedValue = structuredClone(snapshot);
excessiveContainerizedValue.currentWestCoastCorridors.positiveVesselSegments[0].containerizedVesselValueUsd =
  excessiveContainerizedValue.currentWestCoastCorridors.positiveVesselSegments[0].vesselValueUsd + 1;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(excessiveContainerizedValue),
  /containerized vessel value exceeds vessel value/,
  "containerized corridor value cannot exceed total vessel value"
);

const unreconciledCorridor = structuredClone(snapshot);
unreconciledCorridor.currentWestCoastCorridors.positiveVesselSegments[0].vesselWeightKg += 1;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(unreconciledCorridor),
  /does not reconcile/,
  "corridor vessel metrics must reconcile exactly to the current West Coast scope"
);

const corridorDimensions = [
  "category",
  "countryCode",
  "gatewayDistrictCode",
] as const satisfies readonly (keyof CensusPublicGatewayCorridorSummary)[];
const corridorMetrics = [
  "vesselValueUsd",
  "vesselWeightKg",
  "containerizedVesselValueUsd",
  "containerizedVesselWeightKg",
] as const satisfies readonly (keyof CensusPublicGatewayCorridorSummary)[];
type CorridorDimension = (typeof corridorDimensions)[number];
type CorridorMetric = (typeof corridorMetrics)[number];

function canShiftCorridorMetric(
  donor: CensusPublicGatewayCorridorSummary,
  receiver: CensusPublicGatewayCorridorSummary,
  metric: CorridorMetric
): boolean {
  if (metric === "vesselValueUsd") {
    return donor.vesselValueUsd > donor.containerizedVesselValueUsd;
  }
  if (metric === "vesselWeightKg") {
    return donor.vesselWeightKg > donor.containerizedVesselWeightKg;
  }
  if (metric === "containerizedVesselValueUsd") {
    return (
      donor.containerizedVesselValueUsd > 0 &&
      receiver.containerizedVesselValueUsd < receiver.vesselValueUsd
    );
  }
  return (
    donor.containerizedVesselWeightKg > 0 &&
    receiver.containerizedVesselWeightKg < receiver.vesselWeightKg
  );
}

function shiftOneCorridorMetricBetweenMarginals(
  candidate: CensusPublicHardwareSnapshot,
  dimension: CorridorDimension,
  metric: CorridorMetric
): { donorKey: string; receiverKey: string } {
  const segments = candidate.currentWestCoastCorridors.positiveVesselSegments;
  const fixedDimensions = corridorDimensions.filter((entry) => entry !== dimension);
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex];
      const right = segments[rightIndex];
      if (
        left[dimension] === right[dimension] ||
        !fixedDimensions.every((entry) => left[entry] === right[entry])
      ) {
        continue;
      }
      for (const [donor, receiver] of [
        [left, right],
        [right, left],
      ] as const) {
        if (!canShiftCorridorMetric(donor, receiver, metric)) continue;
        donor[metric] -= 1;
        receiver[metric] += 1;
        if (metric === "vesselValueUsd") {
          segments.sort(compareCensusPublicGatewayCorridors);
        }
        return {
          donorKey: donor[dimension],
          receiverKey: receiver[dimension],
        };
      }
    }
  }
  throw new Error(`test fixture cannot shift ${metric} across ${dimension}`);
}

for (const {
  dimension,
  marginalLabel,
} of [
  { dimension: "countryCode", marginalLabel: "country" },
  { dimension: "category", marginalLabel: "category" },
  { dimension: "gatewayDistrictCode", marginalLabel: "gateway district" },
] as const) {
  for (const metric of corridorMetrics) {
    const corruptMarginal = structuredClone(snapshot);
    const grandTotalBefore = corruptMarginal.currentWestCoastCorridors.positiveVesselSegments.reduce(
      (sum, segment) => sum + segment[metric],
      0
    );
    const shifted = shiftOneCorridorMetricBetweenMarginals(
      corruptMarginal,
      dimension,
      metric
    );
    assert.equal(
      corruptMarginal.currentWestCoastCorridors.positiveVesselSegments.reduce(
        (sum, segment) => sum + segment[metric],
        0
      ),
      grandTotalBefore,
      `${metric} grand total survives the balanced ${marginalLabel} mutation`
    );
    assert.throws(
      () => validateCensusPublicHardwareSnapshot(corruptMarginal),
      new RegExp(
        `corridor ${marginalLabel} (?:${shifted.donorKey}|${shifted.receiverKey}) ${metric} does not reconcile`
      ),
      `${metric} rejects a balanced one-unit shift between ${marginalLabel} summaries`
    );
  }
}

const reorderedCorridors = structuredClone(snapshot);
[
  reorderedCorridors.currentWestCoastCorridors.positiveVesselSegments[0],
  reorderedCorridors.currentWestCoastCorridors.positiveVesselSegments[1],
] = [
  reorderedCorridors.currentWestCoastCorridors.positiveVesselSegments[1],
  reorderedCorridors.currentWestCoastCorridors.positiveVesselSegments[0],
];
assert.throws(
  () => validateCensusPublicHardwareSnapshot(reorderedCorridors),
  /not in deterministic order/,
  "corridor slice order is deterministic"
);

const futureArchiveFetch = structuredClone(snapshot);
futureArchiveFetch.periods[0].californiaDestination.source.fetchedAt = "2099-01-01T00:00:00.000Z";
assert.throws(
  () => validateCensusPublicHardwareSnapshot(futureArchiveFetch),
  /fetched after snapshot generation/,
  "an archive fetch cannot postdate snapshot generation"
);

const futureDictionaryFetch = structuredClone(snapshot);
futureDictionaryFetch.countryDictionarySource.fetchedAt = "2099-01-01T00:00:00.000Z";
assert.throws(
  () => validateCensusPublicHardwareSnapshot(futureDictionaryFetch),
  /country dictionary was fetched after generation/,
  "the dictionary fetch cannot postdate snapshot generation"
);

const nullGeneratedAt = structuredClone(snapshot);
nullGeneratedAt.generatedAt = null as unknown as string;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(nullGeneratedAt),
  /valid generatedAt/,
  "null cannot masquerade as a valid generated timestamp"
);

const numericArchiveFetch = structuredClone(snapshot);
numericArchiveFetch.periods[0].californiaDestination.source.fetchedAt = 0 as unknown as string;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(numericArchiveFetch),
  /valid fetchedAt/,
  "numeric zero cannot masquerade as an archive fetch timestamp"
);

const nullDictionaryFetch = structuredClone(snapshot);
nullDictionaryFetch.countryDictionarySource.fetchedAt = null as unknown as string;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(nullDictionaryFetch),
  /valid country dictionary provenance/,
  "null cannot masquerade as a dictionary fetch timestamp"
);

const localeDateArchiveFetch = structuredClone(snapshot);
localeDateArchiveFetch.periods[0].californiaDestination.source.fetchedAt = "7/23/2026";
assert.throws(
  () => validateCensusPublicHardwareSnapshot(localeDateArchiveFetch),
  /valid fetchedAt/,
  "locale date strings cannot masquerade as ISO fetch timestamps"
);

const arrayArchiveHash = structuredClone(snapshot);
arrayArchiveHash.periods[0].californiaDestination.source.archiveSha256 = [
  arrayArchiveHash.periods[0].californiaDestination.source.archiveSha256,
] as unknown as string;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(arrayArchiveHash),
  /file name and valid fetchedAt/,
  "array coercion cannot masquerade as an archive checksum"
);

const arrayDictionaryHash = structuredClone(snapshot);
arrayDictionaryHash.countryDictionarySource.archiveSha256 = [
  arrayDictionaryHash.countryDictionarySource.archiveSha256,
] as unknown as string;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(arrayDictionaryHash),
  /valid country dictionary provenance/,
  "array coercion cannot masquerade as a dictionary checksum"
);

const arrayArchiveUrl = structuredClone(snapshot);
arrayArchiveUrl.periods[0].californiaDestination.source.dataUrl = [
  arrayArchiveUrl.periods[0].californiaDestination.source.dataUrl,
] as unknown as string;
assert.throws(
  () => validateCensusPublicHardwareSnapshot(arrayArchiveUrl),
  /secret-free HTTPS URL/,
  "array coercion cannot masquerade as an archive URL"
);

const generatorSource = fs.readFileSync(
  path.join(process.cwd(), "scripts/build-census-public-hardware-snapshot.ts"),
  "utf8"
);
assert.ok(generatorSource.includes('method: "HEAD"'), "warm caches verify upstream HTTP validators");
assert.ok(generatorSource.includes("metadata.sha256"), "warm caches verify the local archive hash");
assert.ok(
  generatorSource.includes("fetchedAt: metadata.fetchedAt"),
  "warm caches preserve the original archive fetch time"
);
assert.ok(generatorSource.includes('cliFlag("refresh")'), "operators can force a full source refresh");

for (const file of [
  "src/lib/intel/research/census-public-hardware.ts",
  "scripts/build-census-public-hardware-snapshot.ts",
  "scripts/intel-census-public-hardware.test.ts",
]) {
  assert.equal(
    fs.readFileSync(path.join(process.cwd(), file), "utf8").includes("\u2014"),
    false,
    `${file} contains no em dash character`
  );
}

console.log("All Census public hardware snapshot checks passed");
