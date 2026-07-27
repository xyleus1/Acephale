import {
  STARTUP_HARDWARE_CATEGORY_LABELS,
  STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET_ID,
  STARTUP_PRODUCTION_HARDWARE_CORE43_CODES,
  STARTUP_PRODUCTION_HARDWARE_BASKET,
  WEST_COAST_GATEWAY_DISTRICTS,
  type OceanHardwareCategoryRollup,
  type OceanHardwareCountryRollup,
  type OceanHardwareGatewayCorridorRollup,
  type OceanHardwareGeographyRollup,
  type OceanHardwareGeographyScope,
  type OceanHardwareModeTotals,
  type OceanHardwarePrecomputedRollups,
  type OceanHardwareYearRollup,
  type StartupHardwareCategory,
  type StartupHardwareHsCode,
} from "./ocean-hardware";
import {
  dedupeIntelSourceUses,
  isSecretFreeSourceUrl,
  resolveIntelSourceUse,
  type IntelSourceUse,
} from "../sources";

export const CENSUS_PUBLIC_HARDWARE_SCHEMA_VERSION = 4;
export const CENSUS_STATE_IMPORTS_LAYOUT_URL =
  "https://www.census.gov/foreign-trade/reference/products/layouts/isths6.html";
export const CENSUS_PORT_IMPORTS_LAYOUT_URL =
  "https://www.census.gov/foreign-trade/reference/products/layouts/dporths6i.html";
export const CENSUS_TRADE_PRODUCTS_URL =
  "https://www.census.gov/foreign-trade/data/dataproducts.html";
export const CENSUS_SCHEDULE_C_URL =
  "https://www.census.gov/foreign-trade/schedules/c/country3.txt";

export type CensusPublicMetricTotals = {
  generalValueUsd: number;
  vesselValueUsd: number;
  vesselWeightKg: number;
  containerizedVesselValueUsd: number;
  containerizedVesselWeightKg: number;
  airValueUsd: number;
  airWeightKg: number;
};

export type CensusPublicSourceFile = {
  dataUrl: string;
  layoutUrl: string;
  fileName: string;
  archiveSha256: string;
  fetchedAt: string;
  lastModified: string | null;
};

export type CensusPublicDictionarySource = {
  dataUrl: string;
  archiveSha256: string;
  fetchedAt: string;
  lastModified: string | null;
};

export type CensusPublicCategorySummary = {
  category: StartupHardwareCategory;
  totals: CensusPublicMetricTotals;
  matchedSourceRowCount: number;
  hsCodes: StartupHardwareHsCode[];
};

export type CensusPublicCountrySummary = {
  countryCode: string;
  countryName: string;
  totals: CensusPublicMetricTotals;
  matchedSourceRowCount: number;
};

export type CensusPublicGeographySummary = {
  geographyCode: string;
  geographyLabel: string;
  totals: CensusPublicMetricTotals;
  matchedSourceRowCount: number;
};

export type CensusPublicGatewayCorridorSummary = {
  category: StartupHardwareCategory;
  countryCode: string;
  gatewayDistrictCode: string;
  vesselValueUsd: number;
  vesselWeightKg: number;
  containerizedVesselValueUsd: number;
  containerizedVesselWeightKg: number;
};

export type CensusPublicGatewayCorridorSlice = {
  period: string;
  geographyBasis: "port_of_unlading_district";
  originBasis: "country_of_origin";
  commodityBasis: "startup_hardware_category";
  positiveVesselSegments: CensusPublicGatewayCorridorSummary[];
};

export type CensusPublicScopeSummary = {
  scope: OceanHardwareGeographyScope;
  basis: "state_of_ultimate_destination" | "port_of_unlading";
  source: CensusPublicSourceFile;
  totals: CensusPublicMetricTotals;
  categories: CensusPublicCategorySummary[];
  countries: CensusPublicCountrySummary[];
  geographies: CensusPublicGeographySummary[];
  matchedSourceRowCount: number;
  observedHsCodes: StartupHardwareHsCode[];
  originCountryCount: number;
};

export type CensusPublicPeriodSummary = {
  period: string;
  periodKind: "complete_year" | "current_ytd";
  applicableHsCodeCount: number;
  californiaDestination: CensusPublicScopeSummary;
  westCoastGateways: CensusPublicScopeSummary;
};

export type CensusPublicOriginHistoryCategoryVesselSummary = {
  category: StartupHardwareCategory;
  vesselValueUsd: number;
  vesselWeightKg: number;
};

export type CensusPublicOriginHistoryGeographyVesselSummary = {
  geographyCode: string;
  vesselValueUsd: number;
  vesselWeightKg: number;
};

export type CensusPublicOriginHistoryScopeSummary = {
  scope: OceanHardwareGeographyScope;
  basis: "state_of_ultimate_destination" | "port_of_unlading";
  source: CensusPublicSourceFile;
  totals: CensusPublicMetricTotals;
  originTotals: CensusPublicMetricTotals;
  originCategoryVesselSummaries: CensusPublicOriginHistoryCategoryVesselSummary[];
  originGeographyVesselSummaries: CensusPublicOriginHistoryGeographyVesselSummary[];
  matchedSourceRowCount: number;
  originMatchedSourceRowCount: number;
  observedHsCodeKey: string;
};

export type CensusPublicOriginHistoryPeriod = {
  period: string;
  periodKind: "complete_year" | "current_ytd";
  californiaDestination: CensusPublicOriginHistoryScopeSummary;
  westCoastGateways: CensusPublicOriginHistoryScopeSummary;
};

export type CensusPublicOriginHistorySlice = {
  originCountryCode: "5700";
  originCountryName: "China";
  basketId: typeof STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET_ID;
  startYear: 2010;
  applicableHsCodeCount: number;
  periods: CensusPublicOriginHistoryPeriod[];
};

export type CensusPublicHardwareSnapshot = {
  schemaVersion: typeof CENSUS_PUBLIC_HARDWARE_SCHEMA_VERSION;
  basketId: "startup_production_hardware_v1";
  asOfMonth: string;
  generatedAt: string;
  countryDictionarySource: CensusPublicDictionarySource;
  currentWestCoastCorridors: CensusPublicGatewayCorridorSlice;
  originHistorySlices: CensusPublicOriginHistorySlice[];
  periods: CensusPublicPeriodSummary[];
};

export function censusSourceValidatorsMatch(input: {
  remoteLastModified: string | null;
  remoteEtag: string | null;
  cachedLastModified: string | null;
  cachedEtag: string | null;
}): boolean {
  const checks: boolean[] = [];
  if (input.remoteLastModified != null) {
    checks.push(input.cachedLastModified === input.remoteLastModified);
  }
  if (input.remoteEtag != null) {
    checks.push(input.cachedEtag === input.remoteEtag);
  }
  return checks.length > 0 && checks.every(Boolean);
}

export type CensusPublicReportStatus = {
  asOfMonth: string;
  generatedAt: string;
  sourceKind: "census_public_downloads";
  californiaCurrentLoaded: boolean;
  gatewayCurrentLoaded: boolean;
  californiaLoadedYears: number[];
  gatewayLoadedYears: number[];
  californiaContainerizedValueUsd: number | null;
  gatewayContainerizedValueUsd: number | null;
  californiaCurrentRowCount: number;
  gatewayCurrentRowCount: number;
  sourceFileCount: number;
  latestSourceModifiedAt: string | null;
};

const CATEGORY_ORDER = Object.keys(
  STARTUP_HARDWARE_CATEGORY_LABELS
) as StartupHardwareCategory[];
const EXPECTED_HS_CODES = new Set(
  STARTUP_PRODUCTION_HARDWARE_BASKET.map((entry) => entry.code)
);
const CORE43_HS_CODE_KEY = [...STARTUP_PRODUCTION_HARDWARE_CORE43_CODES]
  .sort()
  .join(",");
const CORE43_CATEGORY_ORDER = CATEGORY_ORDER.filter((category) =>
  STARTUP_PRODUCTION_HARDWARE_BASKET.some(
    (entry) => entry.category === category && entry.introducedYear == null
  )
);
const DISTRICT_LABELS = new Map<string, string>(
  WEST_COAST_GATEWAY_DISTRICTS.map((district) => [district.code, district.label])
);
const METRIC_NAMES = [
  "generalValueUsd",
  "vesselValueUsd",
  "vesselWeightKg",
  "containerizedVesselValueUsd",
  "containerizedVesselWeightKg",
  "airValueUsd",
  "airWeightKg",
] as const satisfies readonly (keyof CensusPublicMetricTotals)[];
const CORRIDOR_METRIC_NAMES = [
  "vesselValueUsd",
  "vesselWeightKg",
  "containerizedVesselValueUsd",
  "containerizedVesselWeightKg",
] as const satisfies readonly (keyof CensusPublicGatewayCorridorSummary)[];
type CorridorMetricName = (typeof CORRIDOR_METRIC_NAMES)[number];

export function compareCensusPublicGatewayCorridors(
  left: CensusPublicGatewayCorridorSummary,
  right: CensusPublicGatewayCorridorSummary
): number {
  if (left.vesselValueUsd !== right.vesselValueUsd) {
    return left.vesselValueUsd > right.vesselValueUsd ? -1 : 1;
  }
  for (const [leftValue, rightValue] of [
    [left.category, right.category],
    [left.countryCode, right.countryCode],
    [left.gatewayDistrictCode, right.gatewayDistrictCode],
  ] as const) {
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
  }
  return 0;
}

function parsePeriod(value: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid Census public snapshot period: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2010 || month < 1 || month > 12) {
    throw new Error(`Invalid Census public snapshot period: ${value}`);
  }
  return { year, month };
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
  );
}

function isHttpDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function validateSafeNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe non-negative integer`);
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validateDimensionTotals(
  summaries: readonly { totals: CensusPublicMetricTotals; matchedSourceRowCount: number }[],
  scope: CensusPublicScopeSummary,
  label: string
): void {
  if (
    summaries.reduce((sum, summary) => sum + summary.matchedSourceRowCount, 0) !==
    scope.matchedSourceRowCount
  ) {
    throw new Error(`${label} row counts do not reconcile to the scope total`);
  }
  for (const metric of METRIC_NAMES) {
    const dimensionTotal = summaries.reduce(
      (sum, summary) => sum + summary.totals[metric],
      0
    );
    if (dimensionTotal !== scope.totals[metric]) {
      throw new Error(`${label} ${metric} does not reconcile to the scope total`);
    }
  }
}

function validateMetricTotals(totals: CensusPublicMetricTotals, label: string): void {
  for (const [name, value] of Object.entries(totals)) {
    validateSafeNonNegativeInteger(value, `${label} ${name}`);
  }
  if (totals.containerizedVesselValueUsd > totals.vesselValueUsd) {
    throw new Error(`${label} containerized vessel value exceeds vessel value`);
  }
  if (totals.containerizedVesselWeightKg > totals.vesselWeightKg) {
    throw new Error(`${label} containerized vessel weight exceeds vessel weight`);
  }
  if (totals.vesselValueUsd + totals.airValueUsd > totals.generalValueUsd) {
    throw new Error(`${label} vessel and air value exceeds general import value`);
  }
}

function sourceUse(scope: CensusPublicScopeSummary, period: string): IntelSourceUse {
  return {
    sourceId: "census_trade_downloads",
    sourceUrl: scope.source.dataUrl,
    displayName:
      scope.scope === "california_destination"
        ? `State Imports HS6, ${period}`
        : `Port Imports HS6, ${period}`,
    asOf: period,
    fetchedAt: scope.source.fetchedAt,
    reviewedAt: null,
    integritySha256: scope.source.archiveSha256,
  };
}

function countryDictionarySourceUse(snapshot: CensusPublicHardwareSnapshot): IntelSourceUse {
  const source = snapshot.countryDictionarySource;
  return {
    sourceId: "census_schedule_c",
    sourceUrl: source.dataUrl,
    displayName: "Schedule C country code file",
    asOf: source.lastModified
      ? new Date(source.lastModified).toISOString().slice(0, 10)
      : null,
    fetchedAt: source.fetchedAt,
    reviewedAt: null,
    integritySha256: source.archiveSha256,
  };
}

function validateCountryDictionarySource(
  source: CensusPublicDictionarySource,
  generatedAt: string
): void {
  if (source.dataUrl !== CENSUS_SCHEDULE_C_URL || !isSecretFreeSourceUrl(source.dataUrl)) {
    throw new Error("Census public hardware snapshot uses an unexpected country dictionary");
  }
  resolveIntelSourceUse({
    sourceId: "census_schedule_c",
    sourceUrl: source.dataUrl,
    asOf: null,
    fetchedAt: source.fetchedAt,
    reviewedAt: null,
  });
  if (
    typeof source.archiveSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.archiveSha256) ||
    !isIsoTimestamp(source.fetchedAt)
  ) {
    throw new Error("Census public hardware snapshot needs valid country dictionary provenance");
  }
  if (source.lastModified !== null && !isHttpDate(source.lastModified)) {
    throw new Error("Census public hardware snapshot has an invalid country dictionary revision");
  }
  if (new Date(source.fetchedAt).getTime() > new Date(generatedAt).getTime()) {
    throw new Error("Census public hardware snapshot country dictionary was fetched after generation");
  }
}

function validateSource(source: CensusPublicSourceFile, label: string, generatedAt: string): void {
  for (const [field, value] of [
    ["dataUrl", source.dataUrl],
    ["layoutUrl", source.layoutUrl],
  ] as const) {
    if (typeof value !== "string" || !isSecretFreeSourceUrl(value)) {
      throw new Error(`${label} ${field} must be a secret-free HTTPS URL`);
    }
  }
  resolveIntelSourceUse({
    sourceId: "census_trade_downloads",
    sourceUrl: source.dataUrl,
    asOf: null,
    fetchedAt: source.fetchedAt,
    reviewedAt: null,
  });
  if (
    typeof source.fileName !== "string" ||
    !source.fileName.trim() ||
    typeof source.archiveSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.archiveSha256) ||
    !isIsoTimestamp(source.fetchedAt)
  ) {
    throw new Error(`${label} needs a file name and valid fetchedAt`);
  }
  if (source.lastModified !== null && !isHttpDate(source.lastModified)) {
    throw new Error(`${label} has an invalid lastModified timestamp`);
  }
  if (new Date(source.fetchedAt).getTime() > new Date(generatedAt).getTime()) {
    throw new Error(`${label} was fetched after snapshot generation`);
  }
}

function validateScopeSource(
  source: CensusPublicSourceFile,
  expectedScope: OceanHardwareGeographyScope,
  period: string,
  isCurrentPeriod: boolean,
  generatedAt: string,
  label: string
): void {
  validateSource(source, label, generatedAt);
  const expectedLayoutUrl =
    expectedScope === "california_destination"
      ? CENSUS_STATE_IMPORTS_LAYOUT_URL
      : CENSUS_PORT_IMPORTS_LAYOUT_URL;
  if (source.layoutUrl !== expectedLayoutUrl) {
    throw new Error(`${label} uses the wrong layout reference`);
  }
  const [periodYear, periodMonth] = period.split("-");
  const expectedArchiveName =
    expectedScope === "california_destination"
      ? `ISTHSM${periodYear.slice(2)}${periodMonth}.ZIP`
      : `PORTHS6MM${periodYear.slice(2)}${periodMonth}.ZIP`;
  const expectedTextFileName =
    expectedScope === "california_destination"
      ? `${isCurrentPeriod ? "isthsm" : "isthsr"}${periodYear.slice(2)}${periodMonth}.txt`
      : `${isCurrentPeriod ? "porths6mm" : "dporths6ir"}${periodYear.slice(2)}${periodMonth}.txt`;
  if (
    !new URL(source.dataUrl).pathname.endsWith(`/${expectedArchiveName}`) ||
    source.fileName.toLowerCase() !== expectedTextFileName
  ) {
    throw new Error(`${label} uses the wrong source file`);
  }
}

function validateScope(
  scope: CensusPublicScopeSummary,
  expectedScope: OceanHardwareGeographyScope,
  period: string,
  expectedHsCodes: readonly StartupHardwareHsCode[],
  isCurrentPeriod: boolean,
  generatedAt: string
): void {
  if (scope.scope !== expectedScope) {
    throw new Error(`Census public snapshot ${period} has the wrong ${expectedScope} scope`);
  }
  if (
    (expectedScope === "california_destination" && scope.basis !== "state_of_ultimate_destination") ||
    (expectedScope === "west_coast_gateway" && scope.basis !== "port_of_unlading")
  ) {
    throw new Error(`Census public snapshot ${period} has the wrong geography basis`);
  }
  validateScopeSource(
    scope.source,
    expectedScope,
    period,
    isCurrentPeriod,
    generatedAt,
    `Census public snapshot ${period}`
  );
  validateMetricTotals(scope.totals, `Census public snapshot ${period} scope total`);
  validatePositiveInteger(scope.matchedSourceRowCount, `${period} matched source row count`);
  validatePositiveInteger(scope.originCountryCount, `${period} origin country count`);
  if (!sameStringSet(scope.observedHsCodes, expectedHsCodes)) {
    throw new Error(`Census public snapshot ${period} does not cover every applicable HS code`);
  }
  for (const code of scope.observedHsCodes) {
    if (!EXPECTED_HS_CODES.has(code)) {
      throw new Error(`Census public snapshot ${period} has unknown HS code ${code}`);
    }
  }
  const expectedCategories = CATEGORY_ORDER.filter((category) =>
    STARTUP_PRODUCTION_HARDWARE_BASKET.some(
      (entry) => entry.category === category && expectedHsCodes.includes(entry.code)
    )
  );
  if (!sameStringSet(scope.categories.map((category) => category.category), expectedCategories)) {
    throw new Error(`Census public snapshot ${period} has incomplete category coverage`);
  }
  for (const category of scope.categories) {
    if (!CATEGORY_ORDER.includes(category.category)) {
      throw new Error(`Census public snapshot ${period} has unknown category ${category.category}`);
    }
    validateMetricTotals(category.totals, `${period} category ${category.category}`);
    validatePositiveInteger(
      category.matchedSourceRowCount,
      `${period} category ${category.category} row count`
    );
    const expectedCategoryCodes = STARTUP_PRODUCTION_HARDWARE_BASKET.filter(
      (entry) => entry.category === category.category && expectedHsCodes.includes(entry.code)
    ).map((entry) => entry.code);
    if (!sameStringSet(category.hsCodes, expectedCategoryCodes)) {
      throw new Error(`Census public snapshot ${period} has incomplete ${category.category} HS coverage`);
    }
  }
  if (scope.countries.length !== scope.originCountryCount) {
    throw new Error(`Census public snapshot ${period} origin count does not match country rollups`);
  }
  if (!hasUniqueStrings(scope.countries.map((country) => country.countryCode))) {
    throw new Error(`Census public snapshot ${period} has duplicate country codes`);
  }
  for (const country of scope.countries) {
    if (
      !/^\d{4}$/.test(country.countryCode) ||
      !country.countryName.trim() ||
      /^Schedule C \d{4}$/.test(country.countryName)
    ) {
      throw new Error(`Census public snapshot ${period} has invalid country metadata`);
    }
    validateMetricTotals(country.totals, `${period} country ${country.countryCode}`);
    validatePositiveInteger(
      country.matchedSourceRowCount,
      `${period} country ${country.countryCode} row count`
    );
  }
  const expectedGeographyCodes =
    expectedScope === "california_destination"
      ? ["CA"]
      : WEST_COAST_GATEWAY_DISTRICTS.map((district) => district.code);
  if (!sameStringSet(scope.geographies.map((geography) => geography.geographyCode), expectedGeographyCodes)) {
    throw new Error(`Census public snapshot ${period} has incomplete geography coverage`);
  }
  for (const geography of scope.geographies) {
    if (!geography.geographyCode.trim() || !geography.geographyLabel.trim()) {
      throw new Error(`Census public snapshot ${period} has invalid geography metadata`);
    }
    validateMetricTotals(geography.totals, `${period} geography ${geography.geographyCode}`);
    validatePositiveInteger(
      geography.matchedSourceRowCount,
      `${period} geography ${geography.geographyCode} row count`
    );
  }
  validateDimensionTotals(scope.categories, scope, `${period} categories`);
  validateDimensionTotals(scope.countries, scope, `${period} countries`);
  validateDimensionTotals(scope.geographies, scope, `${period} geographies`);
}

function validateCurrentWestCoastCorridors(
  slice: CensusPublicGatewayCorridorSlice,
  currentScope: CensusPublicScopeSummary,
  asOfMonth: string
): void {
  if (
    slice.period !== asOfMonth ||
    slice.geographyBasis !== "port_of_unlading_district" ||
    slice.originBasis !== "country_of_origin" ||
    slice.commodityBasis !== "startup_hardware_category"
  ) {
    throw new Error("Census public hardware corridor slice has the wrong period or basis");
  }
  if (!Array.isArray(slice.positiveVesselSegments) || slice.positiveVesselSegments.length === 0) {
    throw new Error("Census public hardware corridor slice needs positive vessel segments");
  }
  const knownCountries = new Set(
    currentScope.countries.map((country) => country.countryCode)
  );
  const knownDistricts = new Set<string>(
    WEST_COAST_GATEWAY_DISTRICTS.map((district) => district.code)
  );
  const seenTuples = new Set<string>();
  for (const segment of slice.positiveVesselSegments) {
    if (!CATEGORY_ORDER.includes(segment.category)) {
      throw new Error(`Census public hardware corridor has unknown category ${segment.category}`);
    }
    if (!knownCountries.has(segment.countryCode)) {
      throw new Error(
        `Census public hardware corridor has unknown country ${segment.countryCode}`
      );
    }
    if (!knownDistricts.has(segment.gatewayDistrictCode)) {
      throw new Error(
        `Census public hardware corridor has unknown gateway district ${segment.gatewayDistrictCode}`
      );
    }
    const tuple = `${segment.category}:${segment.countryCode}:${segment.gatewayDistrictCode}`;
    if (seenTuples.has(tuple)) {
      throw new Error(`Census public hardware corridor has duplicate tuple ${tuple}`);
    }
    seenTuples.add(tuple);
    for (const metric of CORRIDOR_METRIC_NAMES) {
      validateSafeNonNegativeInteger(
        segment[metric],
        `Census public hardware corridor ${tuple} ${metric}`
      );
    }
    if (segment.vesselValueUsd === 0) {
      throw new Error(`Census public hardware corridor ${tuple} must have positive vessel value`);
    }
    if (segment.containerizedVesselValueUsd > segment.vesselValueUsd) {
      throw new Error(
        `Census public hardware corridor ${tuple} containerized vessel value exceeds vessel value`
      );
    }
    if (segment.containerizedVesselWeightKg > segment.vesselWeightKg) {
      throw new Error(
        `Census public hardware corridor ${tuple} containerized vessel weight exceeds vessel weight`
      );
    }
  }
  const sorted = [...slice.positiveVesselSegments].sort(
    compareCensusPublicGatewayCorridors
  );
  if (!sorted.every((segment, index) => segment === slice.positiveVesselSegments[index])) {
    throw new Error("Census public hardware corridor segments are not in deterministic order");
  }
  for (const metric of CORRIDOR_METRIC_NAMES) {
    const total = slice.positiveVesselSegments.reduce(
      (sum, segment) => sum + segment[metric],
      0
    );
    validateSafeNonNegativeInteger(total, `Census public hardware corridor ${metric} total`);
    if (total !== currentScope.totals[metric]) {
      throw new Error(
        `Census public hardware corridor ${metric} does not reconcile to the current West Coast total`
      );
    }
  }
  const validateMarginalTotals = (
    summaries: readonly {
      key: string;
      totals: CensusPublicMetricTotals;
    }[],
    segmentKey: (segment: CensusPublicGatewayCorridorSummary) => string,
    label: string
  ): void => {
    const totalsByKey = new Map<
      string,
      Record<CorridorMetricName, number>
    >();
    for (const segment of slice.positiveVesselSegments) {
      const key = segmentKey(segment);
      const totals = totalsByKey.get(key) ?? {
        vesselValueUsd: 0,
        vesselWeightKg: 0,
        containerizedVesselValueUsd: 0,
        containerizedVesselWeightKg: 0,
      };
      for (const metric of CORRIDOR_METRIC_NAMES) {
        totals[metric] += segment[metric];
      }
      totalsByKey.set(key, totals);
    }
    for (const summary of summaries) {
      const actual = totalsByKey.get(summary.key);
      for (const metric of CORRIDOR_METRIC_NAMES) {
        if ((actual?.[metric] ?? 0) !== summary.totals[metric]) {
          throw new Error(
            `Census public hardware corridor ${label} ${summary.key} ${metric} does not reconcile to the current West Coast ${label} total`
          );
        }
      }
    }
  };
  validateMarginalTotals(
    currentScope.categories.map((category) => ({
      key: category.category,
      totals: category.totals,
    })),
    (segment) => segment.category,
    "category"
  );
  validateMarginalTotals(
    currentScope.countries.map((country) => ({
      key: country.countryCode,
      totals: country.totals,
    })),
    (segment) => segment.countryCode,
    "country"
  );
  validateMarginalTotals(
    currentScope.geographies.map((geography) => ({
      key: geography.geographyCode,
      totals: geography.totals,
    })),
    (segment) => segment.gatewayDistrictCode,
    "gateway district"
  );
}

function validateOriginHistoryVesselDimension(
  summaries: readonly {
    vesselValueUsd: number;
    vesselWeightKg: number;
  }[],
  totals: CensusPublicMetricTotals,
  label: string
): void {
  for (const summary of summaries) {
    validateSafeNonNegativeInteger(
      summary.vesselValueUsd,
      `${label} vesselValueUsd`
    );
    validateSafeNonNegativeInteger(
      summary.vesselWeightKg,
      `${label} vesselWeightKg`
    );
  }
  for (const metric of ["vesselValueUsd", "vesselWeightKg"] as const) {
    const dimensionTotal = summaries.reduce(
      (sum, summary) => sum + summary[metric],
      0
    );
    validateSafeNonNegativeInteger(dimensionTotal, `${label} ${metric} total`);
    if (dimensionTotal !== totals[metric]) {
      throw new Error(`${label} ${metric} does not reconcile to the origin total`);
    }
  }
}

function validateOriginHistoryScope(
  scope: CensusPublicOriginHistoryScopeSummary,
  expectedScope: OceanHardwareGeographyScope,
  period: string,
  isCurrentPeriod: boolean,
  generatedAt: string
): void {
  const label = `Census public China core43 history ${period}`;
  if (scope.scope !== expectedScope) {
    throw new Error(`${label} has the wrong ${expectedScope} scope`);
  }
  if (
    (expectedScope === "california_destination" &&
      scope.basis !== "state_of_ultimate_destination") ||
    (expectedScope === "west_coast_gateway" &&
      scope.basis !== "port_of_unlading")
  ) {
    throw new Error(`${label} has the wrong geography basis`);
  }
  validateScopeSource(
    scope.source,
    expectedScope,
    period,
    isCurrentPeriod,
    generatedAt,
    label
  );
  validateMetricTotals(scope.totals, `${label} all-origin total`);
  validateMetricTotals(scope.originTotals, `${label} origin total`);
  validatePositiveInteger(
    scope.matchedSourceRowCount,
    `${label} matched source row count`
  );
  validatePositiveInteger(
    scope.originMatchedSourceRowCount,
    `${label} origin matched source row count`
  );
  if (scope.originMatchedSourceRowCount > scope.matchedSourceRowCount) {
    throw new Error(`${label} origin row count exceeds the all-origin row count`);
  }
  for (const metric of METRIC_NAMES) {
    if (scope.originTotals[metric] > scope.totals[metric]) {
      throw new Error(`${label} origin ${metric} exceeds the all-origin total`);
    }
  }
  if (scope.observedHsCodeKey !== CORE43_HS_CODE_KEY) {
    throw new Error(`${label} does not cover every core43 HS code`);
  }
  if (
    !Array.isArray(scope.originCategoryVesselSummaries) ||
    scope.originCategoryVesselSummaries.length === 0 ||
    !hasUniqueStrings(
      scope.originCategoryVesselSummaries.map((category) => category.category)
    )
  ) {
    throw new Error(`${label} needs unique observed origin categories`);
  }
  for (const category of scope.originCategoryVesselSummaries) {
    if (!CORE43_CATEGORY_ORDER.includes(category.category)) {
      throw new Error(`${label} has an invalid core43 category`);
    }
  }
  validateOriginHistoryVesselDimension(
    scope.originCategoryVesselSummaries,
    scope.originTotals,
    `${label} categories`
  );

  if (
    !Array.isArray(scope.originGeographyVesselSummaries) ||
    scope.originGeographyVesselSummaries.length === 0 ||
    !hasUniqueStrings(
      scope.originGeographyVesselSummaries.map(
        (geography) => geography.geographyCode
      )
    )
  ) {
    throw new Error(`${label} needs unique observed origin geographies`);
  }
  const expectedGeographyCodes = new Set<string>(
    expectedScope === "california_destination"
      ? ["CA"]
      : WEST_COAST_GATEWAY_DISTRICTS.map((district) => district.code)
  );
  for (const geography of scope.originGeographyVesselSummaries) {
    if (!expectedGeographyCodes.has(geography.geographyCode)) {
      throw new Error(`${label} has invalid origin geography metadata`);
    }
  }
  validateOriginHistoryVesselDimension(
    scope.originGeographyVesselSummaries,
    scope.originTotals,
    `${label} geographies`
  );
}

function validateOriginHistorySlices(
  slices: CensusPublicOriginHistorySlice[],
  asOfMonth: string,
  generatedAt: string
): void {
  if (!Array.isArray(slices) || slices.length !== 1) {
    throw new Error("Census public hardware snapshot needs one China core43 history slice");
  }
  const [slice] = slices;
  if (
    slice.originCountryCode !== "5700" ||
    slice.originCountryName !== "China" ||
    slice.basketId !== STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET_ID ||
    slice.startYear !== 2010 ||
    slice.applicableHsCodeCount !== STARTUP_PRODUCTION_HARDWARE_CORE43_CODES.length ||
    STARTUP_PRODUCTION_HARDWARE_CORE43_CODES.length !== 43
  ) {
    throw new Error("Census public hardware snapshot has invalid China core43 history metadata");
  }
  const current = parsePeriod(asOfMonth);
  const expectedPeriods = [
    ...Array.from(
      { length: current.year - slice.startYear },
      (_, index) => `${slice.startYear + index}-12`
    ),
    asOfMonth,
  ];
  if (
    slice.periods.length !== expectedPeriods.length ||
    !slice.periods.every(
      (period, index) => period.period === expectedPeriods[index]
    )
  ) {
    throw new Error(
      "Census public hardware snapshot does not contain the complete China core43 history window"
    );
  }
  for (const period of slice.periods) {
    const parsed = parsePeriod(period.period);
    const expectedKind =
      parsed.month === 12 ? "complete_year" : "current_ytd";
    if (period.periodKind !== expectedKind) {
      throw new Error(
        `Census public China core43 history ${period.period} has the wrong period kind`
      );
    }
    validateOriginHistoryScope(
      period.californiaDestination,
      "california_destination",
      period.period,
      period.period === asOfMonth,
      generatedAt
    );
    validateOriginHistoryScope(
      period.westCoastGateways,
      "west_coast_gateway",
      period.period,
      period.period === asOfMonth,
      generatedAt
    );
  }
}

export function validateCensusPublicHardwareSnapshot(
  input: CensusPublicHardwareSnapshot
): CensusPublicHardwareSnapshot {
  if (input.schemaVersion !== CENSUS_PUBLIC_HARDWARE_SCHEMA_VERSION) {
    throw new Error("Unsupported Census public hardware snapshot schema");
  }
  if (input.basketId !== "startup_production_hardware_v1") {
    throw new Error("Census public hardware snapshot uses the wrong basket");
  }
  const asOfPeriod = parsePeriod(input.asOfMonth);
  if (asOfPeriod.month === 12) {
    throw new Error(
      "Census public hardware snapshot asOfMonth must use January through November; December is a complete-year file"
    );
  }
  if (!isIsoTimestamp(input.generatedAt)) {
    throw new Error("Census public hardware snapshot needs a valid generatedAt");
  }
  validateCountryDictionarySource(input.countryDictionarySource, input.generatedAt);
  const seenPeriods = new Set<string>();
  for (const period of input.periods) {
    const parsed = parsePeriod(period.period);
    if (seenPeriods.has(period.period)) {
      throw new Error(`Duplicate Census public snapshot period: ${period.period}`);
    }
    seenPeriods.add(period.period);
    const expectedKind = parsed.month === 12 ? "complete_year" : "current_ytd";
    if (period.periodKind !== expectedKind) {
      throw new Error(`Census public snapshot ${period.period} has the wrong period kind`);
    }
    const expectedHsCodes = STARTUP_PRODUCTION_HARDWARE_BASKET.filter(
      (entry) => entry.introducedYear == null || entry.introducedYear <= parsed.year
    ).map((entry) => entry.code);
    if (period.applicableHsCodeCount !== expectedHsCodes.length) {
      throw new Error(`Census public snapshot ${period.period} has the wrong applicable code count`);
    }
    validateScope(
      period.californiaDestination,
      "california_destination",
      period.period,
      expectedHsCodes,
      period.period === input.asOfMonth,
      input.generatedAt
    );
    validateScope(
      period.westCoastGateways,
      "west_coast_gateway",
      period.period,
      expectedHsCodes,
      period.period === input.asOfMonth,
      input.generatedAt
    );
  }
  if (!seenPeriods.has(input.asOfMonth)) {
    throw new Error("Census public hardware snapshot is missing its current period");
  }
  const currentPeriod = input.periods.find((period) => period.period === input.asOfMonth);
  if (!currentPeriod) {
    throw new Error("Census public hardware snapshot is missing its current period");
  }
  validateCurrentWestCoastCorridors(
    input.currentWestCoastCorridors,
    currentPeriod.westCoastGateways,
    input.asOfMonth
  );
  validateOriginHistorySlices(
    input.originHistorySlices,
    input.asOfMonth,
    input.generatedAt
  );
  const current = parsePeriod(input.asOfMonth);
  const expectedPeriods = [
    ...Array.from({ length: 5 }, (_, index) => `${current.year - 5 + index}-12`),
    input.asOfMonth,
  ];
  if (!sameStringSet([...seenPeriods], expectedPeriods)) {
    throw new Error("Census public hardware snapshot does not contain the requested five-year window");
  }
  return input;
}

function modeTotals(totals: CensusPublicMetricTotals): OceanHardwareModeTotals {
  return {
    vesselValueUsd: totals.vesselValueUsd,
    vesselWeightKg: totals.vesselWeightKg,
    airValueUsd: totals.airValueUsd,
    airWeightKg: totals.airWeightKg,
  };
}

function addModeTotals(
  left: OceanHardwareModeTotals,
  right: OceanHardwareModeTotals
): OceanHardwareModeTotals {
  return {
    vesselValueUsd: (left.vesselValueUsd ?? 0) + (right.vesselValueUsd ?? 0),
    vesselWeightKg: (left.vesselWeightKg ?? 0) + (right.vesselWeightKg ?? 0),
    airValueUsd: (left.airValueUsd ?? 0) + (right.airValueUsd ?? 0),
    airWeightKg: (left.airWeightKg ?? 0) + (right.airWeightKg ?? 0),
  };
}

function emptyModeTotals(): OceanHardwareModeTotals {
  return {
    vesselValueUsd: 0,
    vesselWeightKg: 0,
    airValueUsd: 0,
    airWeightKg: 0,
  };
}

function scopeFor(
  period: CensusPublicPeriodSummary,
  scope: OceanHardwareGeographyScope
): CensusPublicScopeSummary {
  return scope === "california_destination"
    ? period.californiaDestination
    : period.westCoastGateways;
}

function buildCategoryRollups(
  periods: readonly CensusPublicPeriodSummary[],
  scope: OceanHardwareGeographyScope
): OceanHardwareCategoryRollup[] {
  return CATEGORY_ORDER.map((category) => {
    const matches = periods.flatMap((period) => {
      const scoped = scopeFor(period, scope);
      const summary = scoped.categories.find((entry) => entry.category === category);
      return summary ? [{ period, scoped, summary }] : [];
    });
    return {
      category,
      label: STARTUP_HARDWARE_CATEGORY_LABELS[category],
      totals: matches.reduce(
        (total, match) => addModeTotals(total, modeTotals(match.summary.totals)),
        emptyModeTotals()
      ),
      rowCount: matches.reduce((sum, match) => sum + match.summary.matchedSourceRowCount, 0),
      hsCodes: [
        ...new Set(matches.flatMap((match) => match.summary.hsCodes)),
      ].sort(),
      sources: dedupeIntelSourceUses(
        matches.map((match) => sourceUse(match.scoped, match.period.period))
      ),
    };
  });
}

function buildCountryRollups(
  periods: readonly CensusPublicPeriodSummary[],
  scope: OceanHardwareGeographyScope,
  dictionarySource: IntelSourceUse
): OceanHardwareCountryRollup[] {
  const groups = new Map<
    string,
    { countryName: string; totals: OceanHardwareModeTotals; rowCount: number; sources: IntelSourceUse[] }
  >();
  for (const period of periods) {
    const scoped = scopeFor(period, scope);
    const source = sourceUse(scoped, period.period);
    for (const country of scoped.countries) {
      const current = groups.get(country.countryCode) ?? {
        countryName: country.countryName,
        totals: emptyModeTotals(),
        rowCount: 0,
        sources: [],
      };
      current.totals = addModeTotals(current.totals, modeTotals(country.totals));
      current.rowCount += country.matchedSourceRowCount;
      current.sources.push(source);
      groups.set(country.countryCode, current);
    }
  }
  return [...groups.entries()]
    .map(([countryCode, country]) => ({
      countryCode,
      countryName: country.countryName,
      totals: country.totals,
      rowCount: country.rowCount,
      sources: dedupeIntelSourceUses([...country.sources, dictionarySource]),
    }))
    .sort(
      (a, b) =>
        (b.totals.vesselValueUsd ?? 0) - (a.totals.vesselValueUsd ?? 0) ||
        a.countryName.localeCompare(b.countryName)
    );
}

function buildGeographyRollups(
  periods: readonly CensusPublicPeriodSummary[],
  scope: OceanHardwareGeographyScope
): OceanHardwareGeographyRollup[] {
  const groups = new Map<
    string,
    { geographyLabel: string; totals: OceanHardwareModeTotals; rowCount: number; sources: IntelSourceUse[] }
  >();
  for (const period of periods) {
    const scoped = scopeFor(period, scope);
    const source = sourceUse(scoped, period.period);
    for (const geography of scoped.geographies) {
      const current = groups.get(geography.geographyCode) ?? {
        geographyLabel: geography.geographyLabel,
        totals: emptyModeTotals(),
        rowCount: 0,
        sources: [],
      };
      current.totals = addModeTotals(current.totals, modeTotals(geography.totals));
      current.rowCount += geography.matchedSourceRowCount;
      current.sources.push(source);
      groups.set(geography.geographyCode, current);
    }
  }
  return [...groups.entries()]
    .map(([geographyCode, geography]) => ({
      geographyKey:
        scope === "california_destination"
          ? `state:${geographyCode}`
          : `port-district:${geographyCode}`,
      geographyLabel:
        scope === "west_coast_gateway"
          ? DISTRICT_LABELS.get(geographyCode) ?? geography.geographyLabel
          : geography.geographyLabel,
      geographyBasis:
        scope === "california_destination"
          ? ("destination_state" as const)
          : ("port_of_unlading" as const),
      totals: geography.totals,
      rowCount: geography.rowCount,
      sources: dedupeIntelSourceUses(geography.sources),
    }))
    .sort(
      (a, b) =>
        (b.totals.vesselValueUsd ?? 0) - (a.totals.vesselValueUsd ?? 0) ||
        a.geographyLabel.localeCompare(b.geographyLabel)
    );
}

function buildGatewayCorridorRollups(
  snapshot: CensusPublicHardwareSnapshot,
  scope: OceanHardwareGeographyScope,
  dictionarySource: IntelSourceUse
): OceanHardwareGatewayCorridorRollup[] {
  if (scope === "california_destination") return [];
  const currentPeriod = snapshot.periods.find(
    (period) => period.period === snapshot.currentWestCoastCorridors.period
  );
  if (!currentPeriod) {
    throw new Error("Current Census public hardware corridor period is unavailable");
  }
  const countryNames = new Map(
    currentPeriod.westCoastGateways.countries.map((country) => [
      country.countryCode,
      country.countryName,
    ])
  );
  const importSource = sourceUse(
    currentPeriod.westCoastGateways,
    currentPeriod.period
  );
  return snapshot.currentWestCoastCorridors.positiveVesselSegments.map((segment) => ({
    period: snapshot.currentWestCoastCorridors.period,
    category: segment.category,
    categoryLabel: STARTUP_HARDWARE_CATEGORY_LABELS[segment.category],
    countryCode: segment.countryCode,
    countryName: countryNames.get(segment.countryCode)!,
    gatewayDistrictCode: segment.gatewayDistrictCode,
    gatewayDistrictLabel:
      DISTRICT_LABELS.get(segment.gatewayDistrictCode) ??
      `District ${segment.gatewayDistrictCode}`,
    vesselValueUsd: segment.vesselValueUsd,
    vesselWeightKg: segment.vesselWeightKg,
    containerizedVesselValueUsd: segment.containerizedVesselValueUsd,
    containerizedVesselWeightKg: segment.containerizedVesselWeightKg,
    sources: dedupeIntelSourceUses([importSource, dictionarySource]),
  }));
}

export function buildCensusPublicPrecomputedRollups(
  snapshotInput: CensusPublicHardwareSnapshot,
  scope: OceanHardwareGeographyScope
): OceanHardwarePrecomputedRollups {
  const snapshot = validateCensusPublicHardwareSnapshot(snapshotInput);
  const periods = [...snapshot.periods].sort((a, b) => a.period.localeCompare(b.period));
  const currentPeriod = periods.find((period) => period.period === snapshot.asOfMonth);
  if (!currentPeriod) throw new Error("Current Census public hardware period is unavailable");
  const years: OceanHardwareYearRollup[] = periods.map((period) => {
    const parsed = parsePeriod(period.period);
    const scoped = scopeFor(period, scope);
    return {
      year: parsed.year,
      periodKind: period.periodKind,
      throughMonth: parsed.month,
      totals: modeTotals(scoped.totals),
      coverage: {
        rowCount: scoped.matchedSourceRowCount,
        observedHsCodes: [...scoped.observedHsCodes].sort(),
        expectedHsCodeCount: period.applicableHsCodeCount,
        originCountryCount: scoped.originCountryCount,
      },
      sources: [sourceUse(scoped, period.period)],
    };
  });
  const currentOnly = [currentPeriod];
  const dictionarySource = countryDictionarySourceUse(snapshot);
  return {
    totals: years.reduce(
      (total, year) => addModeTotals(total, year.totals),
      emptyModeTotals()
    ),
    years,
    categories: buildCategoryRollups(periods, scope),
    countries: buildCountryRollups(periods, scope, dictionarySource),
    geographies: buildGeographyRollups(periods, scope),
    currentCategories: buildCategoryRollups(currentOnly, scope),
    currentCountries: buildCountryRollups(currentOnly, scope, dictionarySource),
    currentGeographies: buildGeographyRollups(currentOnly, scope),
    currentGatewayCorridors: buildGatewayCorridorRollups(
      snapshot,
      scope,
      dictionarySource
    ),
    sources: dedupeIntelSourceUses(
      [
        ...periods.map((period) => sourceUse(scopeFor(period, scope), period.period)),
        dictionarySource,
      ]
    ),
  };
}

function latestDate(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.reduce<string | null>((latest, value) => {
    if (!latest) return value;
    return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
  }, null);
}

export function buildCensusPublicReportStatus(
  snapshotInput: CensusPublicHardwareSnapshot
): CensusPublicReportStatus {
  const snapshot = validateCensusPublicHardwareSnapshot(snapshotInput);
  const current = snapshot.periods.find((period) => period.period === snapshot.asOfMonth);
  if (!current) throw new Error("Current Census public hardware period is unavailable");
  const historical = snapshot.periods.filter((period) => period.periodKind === "complete_year");
  const sourceFiles = [
    ...snapshot.periods.flatMap((period) => [
      period.californiaDestination.source,
      period.westCoastGateways.source,
    ]),
    ...snapshot.originHistorySlices.flatMap((slice) =>
      slice.periods.flatMap((period) => [
        period.californiaDestination.source,
        period.westCoastGateways.source,
      ])
    ),
  ].filter(
    (source, index, sources) =>
      sources.findIndex(
        (candidate) => candidate.dataUrl === source.dataUrl
      ) === index
  );
  return {
    asOfMonth: snapshot.asOfMonth,
    generatedAt: snapshot.generatedAt,
    sourceKind: "census_public_downloads",
    californiaCurrentLoaded: current.californiaDestination.matchedSourceRowCount > 0,
    gatewayCurrentLoaded: current.westCoastGateways.matchedSourceRowCount > 0,
    californiaLoadedYears: historical.map((period) => Number(period.period.slice(0, 4))),
    gatewayLoadedYears: historical.map((period) => Number(period.period.slice(0, 4))),
    californiaContainerizedValueUsd:
      current.californiaDestination.totals.containerizedVesselValueUsd,
    gatewayContainerizedValueUsd:
      current.westCoastGateways.totals.containerizedVesselValueUsd,
    californiaCurrentRowCount: current.californiaDestination.matchedSourceRowCount,
    gatewayCurrentRowCount: current.westCoastGateways.matchedSourceRowCount,
    sourceFileCount: sourceFiles.length,
    latestSourceModifiedAt: latestDate([
      ...sourceFiles.map((source) => source.lastModified),
      snapshot.countryDictionarySource.lastModified,
    ]),
  };
}
