import "server-only";

import { fetchIntelSourceText } from "../fetch";
import {
  dedupeIntelSourceUses,
  type IntelSourceUse,
} from "../sources";
import {
  STARTUP_PRODUCTION_HARDWARE_BASKET,
  WEST_COAST_GATEWAY_DISTRICTS,
  type OceanHardwareGeographyScope,
  type OceanHardwareImportRow,
  type StartupHardwareHsCode,
} from "./ocean-hardware";

const CENSUS_BASE = "https://api.census.gov/data/timeseries/intltrade/imports";
const CENSUS_TIMEOUT_MS = 25_000;
const CENSUS_CONCURRENCY = 5;

export const CENSUS_OCEAN_HARDWARE_QUERY_PARTITIONS = [
  { id: "hs4-84", commodity: "84*", commodityLevel: "HS4" },
  { id: "hs4-85", commodity: "85*", commodityLevel: "HS4" },
  { id: "hs4-88", commodity: "88*", commodityLevel: "HS4" },
  { id: "hs4-90", commodity: "90*", commodityLevel: "HS4" },
  { id: "hs6-847950", commodity: "847950", commodityLevel: "HS6" },
] as const;

export const CENSUS_OCEAN_HARDWARE_MAX_FETCH_WALL_CLOCK_MS =
  CENSUS_TIMEOUT_MS *
  Math.ceil((CENSUS_OCEAN_HARDWARE_QUERY_PARTITIONS.length * 2) / CENSUS_CONCURRENCY);

export type CensusOceanHardwarePartitionId =
  (typeof CENSUS_OCEAN_HARDWARE_QUERY_PARTITIONS)[number]["id"];

export type CensusOceanHardwareRow = OceanHardwareImportRow & {
  generalValueUsd: number | null;
  containerizedVesselValueUsd: number | null;
  containerizedVesselWeightKg: number | null;
  censusLastUpdatedAt: string | null;
  queryPartitionId: CensusOceanHardwarePartitionId;
};

export type CensusOceanQueryFailureCode =
  | "missing_api_key"
  | "timeout"
  | "http_error"
  | "invalid_response"
  | "request_failed";

export type CensusOceanQueryFailure = {
  scope: OceanHardwareGeographyScope;
  partitionId: CensusOceanHardwarePartitionId;
  code: CensusOceanQueryFailureCode;
  message: string;
};

export type CensusOceanHardwareScopeResult = {
  scope: OceanHardwareGeographyScope;
  status: "available" | "partial" | "unavailable";
  rows: CensusOceanHardwareRow[];
  sources: IntelSourceUse[];
  requestedQueryCount: number;
  successfulQueryCount: number;
  failedQueryCount: number;
  droppedDuplicateRowCount: number;
  failures: CensusOceanQueryFailure[];
  missingData: string[];
  fetchedAt: string | null;
  censusLastUpdatedAt: string | null;
};

export type CensusOceanHardwareCoverage = {
  status: "partial" | "blocked";
  aggregateData: "partial" | "unavailable";
  windowKind: "single_complete_year_snapshot" | "single_ytd_snapshot";
  asOfMonth: string;
  historicalCompleteYears: [];
  fiveYearHistory: "not_fetched";
  requestedQueryCount: number;
  successfulQueryCount: number;
  failedQueryCount: number;
  missingData: string[];
  notes: string[];
  sources: IntelSourceUse[];
};

export type CensusOceanHardwareSnapshot = {
  asOfMonth: string;
  coverage: CensusOceanHardwareCoverage;
  californiaDestination: CensusOceanHardwareScopeResult;
  westCoastGateways: CensusOceanHardwareScopeResult;
  sources: IntelSourceUse[];
};

export type ResolveCensusOceanHardwareSnapshotInput = {
  asOfMonth: string;
};

type CensusQueryPartition = (typeof CENSUS_OCEAN_HARDWARE_QUERY_PARTITIONS)[number];

type CensusQueryDefinition = {
  scope: OceanHardwareGeographyScope;
  partition: CensusQueryPartition;
  asOfMonth: string;
};

type CensusQuerySuccess = {
  ok: true;
  definition: CensusQueryDefinition;
  rows: CensusOceanHardwareRow[];
  source: IntelSourceUse;
};

type CensusQueryFailureResult = {
  ok: false;
  definition: CensusQueryDefinition;
  failure: CensusOceanQueryFailure;
};

type CensusQueryResult = CensusQuerySuccess | CensusQueryFailureResult;

const HARDWARE_BY_CODE = new Map<
  string,
  (typeof STARTUP_PRODUCTION_HARDWARE_BASKET)[number]
>(
  STARTUP_PRODUCTION_HARDWARE_BASKET.map((entry) => [entry.code, entry])
);
const HARDWARE_CODES = new Set<string>(HARDWARE_BY_CODE.keys());
const WEST_COAST_DISTRICT_NAMES = new Map<string, string>(
  WEST_COAST_GATEWAY_DISTRICTS.map((district) => [district.code, district.label])
);
const WEST_COAST_DISTRICT_CODES = new Set<string>(WEST_COAST_DISTRICT_NAMES.keys());
const CENSUS_HISTORY_GAP =
  "Five complete historical years were not fetched during this bounded server request. A scheduled snapshot or durable backfill is still required for a five-year trend.";
const CENSUS_COMPANY_GAP =
  "Census aggregate trade data does not identify importers, startups, suppliers, bills of lading, shipment counts, transit times, or delays.";

const COMMON_CENSUS_VARIABLES = [
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
] as const;

function parseAsOfMonth(value: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Census asOfMonth must use YYYY-MM");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2010 || month < 1 || month > 12) {
    throw new Error("Census asOfMonth must be a valid month from 2010 onward");
  }
  return { year, month };
}

function getPartition(partitionId: CensusOceanHardwarePartitionId): CensusQueryPartition {
  const partition = CENSUS_OCEAN_HARDWARE_QUERY_PARTITIONS.find(
    (candidate) => candidate.id === partitionId
  );
  if (!partition) throw new Error(`Unknown Census ocean partition: ${partitionId}`);
  return partition;
}

function queryVariables(scope: OceanHardwareGeographyScope): string[] {
  return scope === "california_destination"
    ? ["STATE", ...COMMON_CENSUS_VARIABLES]
    : ["DISTRICT", "DIST_NAME", ...COMMON_CENSUS_VARIABLES];
}

export function buildCensusOceanSourceUrl(input: {
  scope: OceanHardwareGeographyScope;
  partitionId: CensusOceanHardwarePartitionId;
  asOfMonth: string;
}): string {
  const { year, month } = parseAsOfMonth(input.asOfMonth);
  const partition = getPartition(input.partitionId);
  const endpoint = input.scope === "california_destination" ? "statehs" : "hs";
  const url = new URL(`${CENSUS_BASE}/${endpoint}`);
  url.searchParams.set("get", queryVariables(input.scope).join(","));
  url.searchParams.set("YEAR", String(year));
  url.searchParams.set("MONTH", String(month).padStart(2, "0"));
  if (input.scope === "california_destination") {
    url.searchParams.set("STATE", "CA");
  } else {
    for (const district of WEST_COAST_GATEWAY_DISTRICTS) {
      url.searchParams.append("DISTRICT", district.code);
    }
  }
  url.searchParams.set("COMM_LVL", partition.commodityLevel);
  url.searchParams.set("I_COMMODITY", partition.commodity);
  url.searchParams.set("SUMMARY_LVL", "DET");
  url.searchParams.set(
    "SUMMARY_LVL2",
    input.scope === "california_destination" ? "HSSTCY" : "HSCYDT"
  );
  return url.toString();
}

function nonNegativeNumberOrNull(value: unknown, column: string): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Invalid Census response: ${column} is not a non-negative number`);
  }
  return number;
}

function rowValue(row: unknown[], header: string[], column: string): unknown {
  const index = header.indexOf(column);
  return index >= 0 ? row[index] : undefined;
}

function requireColumns(header: string[], columns: readonly string[]): void {
  const missing = columns.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`Invalid Census response: missing ${missing.join(", ")}`);
  }
}

export function parseCensusOceanTable(input: {
  text: string;
  scope: OceanHardwareGeographyScope;
  partitionId: CensusOceanHardwarePartitionId;
  asOfMonth: string;
  source: IntelSourceUse;
}): CensusOceanHardwareRow[] {
  const { year } = parseAsOfMonth(input.asOfMonth);
  const partition = getPartition(input.partitionId);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text);
  } catch {
    throw new Error("Invalid Census response: body is not JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !Array.isArray(parsed[0])) {
    throw new Error("Invalid Census response: expected a header-row table");
  }
  const header = parsed[0].map(String);
  requireColumns(header, queryVariables(input.scope));

  const rows: CensusOceanHardwareRow[] = [];
  for (const rawRow of parsed.slice(1)) {
    if (!Array.isArray(rawRow)) continue;
    const commodity = String(rowValue(rawRow, header, "I_COMMODITY") ?? "").trim();
    const basketEntry = HARDWARE_BY_CODE.get(commodity);
    if (!basketEntry || !HARDWARE_CODES.has(commodity)) continue;
    if (partition.commodityLevel === "HS4" && commodity.length !== 4) continue;
    if (partition.commodityLevel === "HS6" && commodity !== partition.commodity) continue;
    if (basketEntry.introducedYear != null && year < basketEntry.introducedYear) continue;

    const countryCode = String(rowValue(rawRow, header, "CTY_CODE") ?? "").trim();
    const countryName = String(rowValue(rawRow, header, "CTY_NAME") ?? "").trim();
    if (!/^\d{4}$/.test(countryCode) || !countryName) continue;

    const state = String(rowValue(rawRow, header, "STATE") ?? "").trim().toUpperCase();
    const districtCode = String(rowValue(rawRow, header, "DISTRICT") ?? "").trim();
    if (input.scope === "california_destination" && state !== "CA") continue;
    if (input.scope === "west_coast_gateway" && !WEST_COAST_DISTRICT_CODES.has(districtCode)) continue;

    const metrics = {
      generalValueUsd: nonNegativeNumberOrNull(rowValue(rawRow, header, "GEN_VAL_YR"), "GEN_VAL_YR"),
      vesselValueUsd: nonNegativeNumberOrNull(rowValue(rawRow, header, "VES_VAL_YR"), "VES_VAL_YR"),
      vesselWeightKg: nonNegativeNumberOrNull(rowValue(rawRow, header, "VES_WGT_YR"), "VES_WGT_YR"),
      containerizedVesselValueUsd: nonNegativeNumberOrNull(
        rowValue(rawRow, header, "CNT_VAL_YR"),
        "CNT_VAL_YR"
      ),
      containerizedVesselWeightKg: nonNegativeNumberOrNull(
        rowValue(rawRow, header, "CNT_WGT_YR"),
        "CNT_WGT_YR"
      ),
      airValueUsd: nonNegativeNumberOrNull(rowValue(rawRow, header, "AIR_VAL_YR"), "AIR_VAL_YR"),
      airWeightKg: nonNegativeNumberOrNull(rowValue(rawRow, header, "AIR_WGT_YR"), "AIR_WGT_YR"),
    };
    if (Object.values(metrics).every((value) => value == null)) continue;

    const geographyKey = input.scope === "california_destination" ? "CA" : districtCode;
    rows.push({
      id: `census-${input.scope}-${geographyKey}-${input.asOfMonth}-${commodity}-${countryCode}`,
      period: input.asOfMonth,
      hsCode: commodity as StartupHardwareHsCode,
      originCountryCode: countryCode,
      originCountryName: countryName,
      geographyBasis:
        input.scope === "california_destination" ? "destination_state" : "customs_district",
      destinationState: input.scope === "california_destination" ? "CA" : null,
      customsDistrictCode: input.scope === "west_coast_gateway" ? districtCode : null,
      customsDistrictName:
        input.scope === "west_coast_gateway"
          ? String(rowValue(rawRow, header, "DIST_NAME") ?? "").trim() ||
            WEST_COAST_DISTRICT_NAMES.get(districtCode) ||
            districtCode
          : null,
      ...metrics,
      censusLastUpdatedAt:
        String(rowValue(rawRow, header, "LAST_UPDATE") ?? "").trim() || null,
      queryPartitionId: input.partitionId,
      sources: [{ ...input.source }],
    });
  }
  return rows;
}

function safeFailure(
  definition: CensusQueryDefinition,
  error: unknown
): CensusOceanQueryFailure {
  const message = error instanceof Error ? error.message : "";
  if (
    (error instanceof Error && error.name === "TimeoutError") ||
    /timeout|timed out/i.test(message)
  ) {
    return {
      scope: definition.scope,
      partitionId: definition.partition.id,
      code: "timeout",
      message: "The Census request exceeded the 25-second limit.",
    };
  }
  const httpStatus = /HTTP\s+(\d{3})/i.exec(message)?.[1];
  if (httpStatus) {
    return {
      scope: definition.scope,
      partitionId: definition.partition.id,
      code: "http_error",
      message: `The Census API returned HTTP ${httpStatus}.`,
    };
  }
  if (/^Invalid Census response:/.test(message)) {
    return {
      scope: definition.scope,
      partitionId: definition.partition.id,
      code: "invalid_response",
      message,
    };
  }
  return {
    scope: definition.scope,
    partitionId: definition.partition.id,
    code: "request_failed",
    message: "The Census request failed before a valid table was returned.",
  };
}

async function runQuery(
  definition: CensusQueryDefinition,
  apiKey: string
): Promise<CensusQueryResult> {
  const sourceUrl = buildCensusOceanSourceUrl({
    scope: definition.scope,
    partitionId: definition.partition.id,
    asOfMonth: definition.asOfMonth,
  });
  const requestUrl = new URL(sourceUrl);
  requestUrl.searchParams.set("key", apiKey);
  try {
    const response = await fetchIntelSourceText({
      sourceId: "census_trade",
      requestUrl: requestUrl.toString(),
      sourceUrl,
      timeoutMs: CENSUS_TIMEOUT_MS,
    });
    const source: IntelSourceUse = {
      sourceId: response.sourceId,
      sourceUrl: response.sourceUrl,
      asOf: definition.asOfMonth,
      fetchedAt: response.fetchedAt,
      reviewedAt: response.reviewedAt,
    };
    return {
      ok: true,
      definition,
      source,
      rows: parseCensusOceanTable({
        text: response.text,
        scope: definition.scope,
        partitionId: definition.partition.id,
        asOfMonth: definition.asOfMonth,
        source,
      }),
    };
  } catch (error) {
    return { ok: false, definition, failure: safeFailure(definition, error) };
  }
}

function latest(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length > 0 ? present.sort().at(-1) ?? null : null;
}

function dedupeRows(rows: CensusOceanHardwareRow[]): {
  rows: CensusOceanHardwareRow[];
  droppedDuplicateRowCount: number;
} {
  const byId = new Map<string, CensusOceanHardwareRow>();
  let droppedDuplicateRowCount = 0;
  for (const row of rows) {
    if (byId.has(row.id)) {
      droppedDuplicateRowCount += 1;
      continue;
    }
    byId.set(row.id, row);
  }
  return {
    rows: [...byId.values()].sort(
      (a, b) =>
        a.hsCode.localeCompare(b.hsCode) ||
        a.originCountryCode.localeCompare(b.originCountryCode) ||
        (a.customsDistrictCode ?? "").localeCompare(b.customsDistrictCode ?? "")
    ),
    droppedDuplicateRowCount,
  };
}

function buildScopeResult(
  scope: OceanHardwareGeographyScope,
  results: CensusQueryResult[]
): CensusOceanHardwareScopeResult {
  const scoped = results.filter((result) => result.definition.scope === scope);
  const successes = scoped.filter((result): result is CensusQuerySuccess => result.ok);
  const failures = scoped
    .filter((result): result is CensusQueryFailureResult => !result.ok)
    .map((result) => result.failure);
  const deduped = dedupeRows(successes.flatMap((result) => result.rows));
  const sources = dedupeIntelSourceUses(successes.map((result) => result.source));
  const scopeLabel =
    scope === "california_destination"
      ? "the California destination scope"
      : "the West Coast gateway scope";
  const missingData = [CENSUS_HISTORY_GAP, CENSUS_COMPANY_GAP];
  if (failures.some((failure) => failure.code === "missing_api_key")) {
    missingData.push("CENSUS_API_KEY is not configured, so live aggregate coverage is unavailable.");
  } else if (failures.length > 0) {
    missingData.push(
      `${failures.length} of ${scoped.length} bounded Census queries failed for ${scopeLabel}. Successful partitions remain available and failed partitions are not treated as zero.`
    );
  }
  return {
    scope,
    status:
      successes.length === scoped.length
        ? "available"
        : successes.length > 0
          ? "partial"
          : "unavailable",
    rows: deduped.rows,
    sources,
    requestedQueryCount: scoped.length,
    successfulQueryCount: successes.length,
    failedQueryCount: failures.length,
    droppedDuplicateRowCount: deduped.droppedDuplicateRowCount,
    failures,
    missingData,
    fetchedAt: latest(sources.map((source) => source.fetchedAt)),
    censusLastUpdatedAt: latest(
      deduped.rows.map((row) => row.censusLastUpdatedAt)
    ),
  };
}

function missingKeyResults(definitions: CensusQueryDefinition[]): CensusQueryResult[] {
  return definitions.map((definition) => ({
    ok: false,
    definition,
    failure: {
      scope: definition.scope,
      partitionId: definition.partition.id,
      code: "missing_api_key",
      message: "CENSUS_API_KEY is not configured, so no Census request was sent.",
    },
  }));
}

export async function resolveCensusOceanHardwareSnapshot(
  input: ResolveCensusOceanHardwareSnapshotInput
): Promise<CensusOceanHardwareSnapshot> {
  const { month } = parseAsOfMonth(input.asOfMonth);
  const definitions: CensusQueryDefinition[] = (
    ["california_destination", "west_coast_gateway"] as const
  ).flatMap((scope) =>
    CENSUS_OCEAN_HARDWARE_QUERY_PARTITIONS.map((partition) => ({
      scope,
      partition,
      asOfMonth: input.asOfMonth,
    }))
  );

  const apiKey = process.env.CENSUS_API_KEY?.trim();
  const results: CensusQueryResult[] = [];
  if (!apiKey) {
    results.push(...missingKeyResults(definitions));
  } else {
    for (let index = 0; index < definitions.length; index += CENSUS_CONCURRENCY) {
      results.push(
        ...(await Promise.all(
          definitions
            .slice(index, index + CENSUS_CONCURRENCY)
            .map((definition) => runQuery(definition, apiKey))
        ))
      );
    }
  }

  const californiaDestination = buildScopeResult("california_destination", results);
  const westCoastGateways = buildScopeResult("west_coast_gateway", results);
  const sources = dedupeIntelSourceUses([
    ...californiaDestination.sources,
    ...westCoastGateways.sources,
  ]);
  const successfulQueryCount =
    californiaDestination.successfulQueryCount + westCoastGateways.successfulQueryCount;
  const failedQueryCount =
    californiaDestination.failedQueryCount + westCoastGateways.failedQueryCount;
  const missingData = [CENSUS_HISTORY_GAP, CENSUS_COMPANY_GAP];
  if (!apiKey) {
    missingData.push("CENSUS_API_KEY is not configured, so live aggregate coverage is unavailable.");
  } else if (failedQueryCount > 0) {
    missingData.push(
      `${failedQueryCount} of ${definitions.length} bounded Census queries failed. Successful partitions remain available and failed partitions are not treated as zero.`
    );
  }

  const coverage: CensusOceanHardwareCoverage = {
    status: successfulQueryCount > 0 ? "partial" : "blocked",
    aggregateData: successfulQueryCount > 0 ? "partial" : "unavailable",
    windowKind:
      month === 12 ? "single_complete_year_snapshot" : "single_ytd_snapshot",
    asOfMonth: input.asOfMonth,
    historicalCompleteYears: [],
    fiveYearHistory: "not_fetched",
    requestedQueryCount: definitions.length,
    successfulQueryCount,
    failedQueryCount,
    missingData,
    notes: [
      "This resolver intentionally fetches one bounded Census snapshot. It never cold-fetches five years during page rendering.",
      month === 12
        ? "Census *_YR fields represent the requested complete calendar year because month 12 was selected."
        : "Census *_YR fields represent year-to-date values through the requested month. They are not monthly values and must not be summed across months.",
      "California destination-state rows and West Coast customs-district rows are returned separately and must not be merged into one geography claim.",
      "Vessel, containerized vessel, air, and general import measures remain separate. Containerized vessel value is not a TEU count.",
      "Country is Census country of origin, not a supplier address or foreign loading port.",
      "Successful queries are cached for 24 hours by the registered Census Intel source policy.",
    ],
    sources,
  };

  return {
    asOfMonth: input.asOfMonth,
    coverage,
    californiaDestination,
    westCoastGateways,
    sources,
  };
}
