import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import {
  CENSUS_PORT_IMPORTS_LAYOUT_URL,
  CENSUS_PUBLIC_HARDWARE_SCHEMA_VERSION,
  CENSUS_SCHEDULE_C_URL,
  CENSUS_STATE_IMPORTS_LAYOUT_URL,
  censusSourceValidatorsMatch,
  compareCensusPublicGatewayCorridors,
  type CensusPublicCategorySummary,
  type CensusPublicCountrySummary,
  type CensusPublicDictionarySource,
  type CensusPublicGatewayCorridorSummary,
  type CensusPublicGeographySummary,
  type CensusPublicHardwareSnapshot,
  type CensusPublicMetricTotals,
  type CensusPublicOriginHistoryCategoryVesselSummary,
  type CensusPublicOriginHistoryGeographyVesselSummary,
  type CensusPublicOriginHistoryPeriod,
  type CensusPublicOriginHistoryScopeSummary,
  type CensusPublicScopeSummary,
  type CensusPublicSourceFile,
  validateCensusPublicHardwareSnapshot,
} from "../src/lib/intel/research/census-public-hardware";
import {
  STARTUP_PRODUCTION_HARDWARE_BASKET,
  STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET_ID,
  STARTUP_PRODUCTION_HARDWARE_CORE43_CODES,
  WEST_COAST_GATEWAY_DISTRICTS,
  type OceanHardwareGeographyScope,
  type StartupHardwareCategory,
  type StartupHardwareHsCode,
} from "../src/lib/intel/research/ocean-hardware";

const DEFAULT_OUTPUT = path.join(
  process.cwd(),
  "src/lib/intel/research/generated/census-public-hardware-v1.json"
);
const SNAPSHOT_MAX_BYTES = 1_300_000;
const WEST_COAST_DISTRICTS = new Set(
  WEST_COAST_GATEWAY_DISTRICTS.map((district) => district.code)
);
const DISTRICT_LABELS = new Map<string, string>(
  WEST_COAST_GATEWAY_DISTRICTS.map((district) => [district.code, district.label])
);
const BASKET_BY_CODE = new Map(
  STARTUP_PRODUCTION_HARDWARE_BASKET.map((entry) => [entry.code, entry])
);
const CORE43_HS_CODES = new Set<StartupHardwareHsCode>(
  STARTUP_PRODUCTION_HARDWARE_CORE43_CODES
);
const CHINA_SCHEDULE_C_CODE = "5700";
const CHINA_HISTORY_START_YEAR = 2010;

type DownloadResult = {
  zipPath: string;
  dataUrl: string;
  archiveSha256: string;
  fetchedAt: string;
  lastModified: string | null;
};

type DownloadCacheMetadata = {
  dataUrl: string;
  contentLength: number;
  sha256: string;
  fetchedAt: string;
  lastModified: string | null;
  etag: string | null;
};

export type ParsedCensusHardwareFields = CensusPublicMetricTotals & {
  hsCode: StartupHardwareHsCode;
  countryCode: string;
  geographyCode: string;
};

type MutableSummary = {
  totals: CensusPublicMetricTotals;
  matchedSourceRowCount: number;
  hsCodes: Set<StartupHardwareHsCode>;
};

type MutableGatewayCorridorSummary = Omit<
  CensusPublicGatewayCorridorSummary,
  "category" | "countryCode" | "gatewayDistrictCode"
>;

function cliValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function cliFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function parseAsOfMonth(value: string): {
  year: number;
  month: number;
} {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) throw new Error("--as-of must use YYYY-MM");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2015 || month < 1 || month > 12) {
    throw new Error("--as-of must be a valid month from 2015 onward");
  }
  if (month === 12) {
    throw new Error(
      "--as-of must use January through November; December is a complete-year file, not the current YTD contract"
    );
  }
  return { year, month };
}

function emptyTotals(): CensusPublicMetricTotals {
  return {
    generalValueUsd: 0,
    vesselValueUsd: 0,
    vesselWeightKg: 0,
    containerizedVesselValueUsd: 0,
    containerizedVesselWeightKg: 0,
    airValueUsd: 0,
    airWeightKg: 0,
  };
}

function addTotals(target: CensusPublicMetricTotals, values: CensusPublicMetricTotals): void {
  target.generalValueUsd += values.generalValueUsd;
  target.vesselValueUsd += values.vesselValueUsd;
  target.vesselWeightKg += values.vesselWeightKg;
  target.containerizedVesselValueUsd += values.containerizedVesselValueUsd;
  target.containerizedVesselWeightKg += values.containerizedVesselWeightKg;
  target.airValueUsd += values.airValueUsd;
  target.airWeightKg += values.airWeightKg;
}

function mutableSummary(): MutableSummary {
  return { totals: emptyTotals(), matchedSourceRowCount: 0, hsCodes: new Set() };
}

function addToSummary(summary: MutableSummary, fields: ParsedCensusHardwareFields): void {
  addTotals(summary.totals, fields);
  summary.matchedSourceRowCount += 1;
  summary.hsCodes.add(fields.hsCode);
}

function parseFixedNumber(line: string, start: number, end: number, label: string): number {
  const raw = line.slice(start, end).trim();
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${label}: expected a non-negative integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid ${label}: exceeds safe integer range`);
  return value;
}

export function startupHardwareBasketCodeFor(
  commodity: string,
  year: number
): StartupHardwareHsCode | null {
  const candidate = commodity === "847950" ? commodity : commodity.slice(0, 4);
  const basket = BASKET_BY_CODE.get(candidate as StartupHardwareHsCode);
  if (!basket) return null;
  if (basket.introducedYear != null && year < basket.introducedYear) return null;
  return basket.code;
}

function sourceUrls(period: string): { state: string; port: string } {
  const [year, month] = period.split("-");
  const shortYear = year.slice(2);
  return {
    state: `https://www.census.gov/trade/downloads/${year}/state_imp/hs6_m/ISTHSM${shortYear}${month}.ZIP`,
    port: `https://www.census.gov/trade/downloads/${year}/Port/im_hs6_m/PORTHS6MM${shortYear}${month}.ZIP`,
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(
  url: string,
  destination: string,
  options: { refresh: boolean }
): Promise<DownloadResult> {
  const metadataPath = `${destination}.metadata.json`;
  if (!options.refresh) {
    try {
      const [existing, metadataRaw, head] = await Promise.all([
        stat(destination),
        readFile(metadataPath, "utf8"),
        fetch(url, { method: "HEAD", redirect: "follow" }),
      ]);
      if (!head.ok) throw new Error(`Census metadata check returned HTTP ${head.status}`);
      const metadata = JSON.parse(metadataRaw) as DownloadCacheMetadata;
      const remoteLength = Number(head.headers.get("content-length"));
      const remoteLastModified = head.headers.get("last-modified");
      const remoteEtag = head.headers.get("etag");
      const remoteIdentityMatches = censusSourceValidatorsMatch({
        remoteLastModified,
        remoteEtag,
        cachedLastModified: metadata.lastModified,
        cachedEtag: metadata.etag,
      });
      if (
        metadata.dataUrl === url &&
        existing.size > 0 &&
        existing.size === metadata.contentLength &&
        typeof metadata.fetchedAt === "string" &&
        !Number.isNaN(new Date(metadata.fetchedAt).getTime()) &&
        Number.isSafeInteger(remoteLength) &&
        remoteLength === existing.size &&
        remoteIdentityMatches
      ) {
        const cachedBytes = await readFile(destination);
        if (sha256(cachedBytes) === metadata.sha256) {
          return {
            zipPath: destination,
            dataUrl: url,
            archiveSha256: metadata.sha256,
            fetchedAt: metadata.fetchedAt,
            lastModified: remoteLastModified,
          };
        }
      }
    } catch {
      // A missing or unverifiable cache is replaced by a fresh download below.
    }
  }
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Census download returned HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000) throw new Error(`Census download was unexpectedly small: ${url}`);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`Census download was not a ZIP archive: ${url}`);
  }
  await writeFile(destination, bytes);
  const metadata: DownloadCacheMetadata = {
    dataUrl: url,
    contentLength: bytes.length,
    sha256: sha256(bytes),
    fetchedAt: new Date().toISOString(),
    lastModified: response.headers.get("last-modified"),
    etag: response.headers.get("etag"),
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return {
    zipPath: destination,
    dataUrl: url,
    archiveSha256: metadata.sha256,
    fetchedAt: metadata.fetchedAt,
    lastModified: response.headers.get("last-modified"),
  };
}

function zippedTextFile(zipPath: string): string {
  const output = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  const file = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().endsWith(".txt"));
  if (!file) throw new Error(`No TXT file found in ${zipPath}`);
  return file;
}

async function countryNames(): Promise<{
  names: Map<string, string>;
  source: CensusPublicDictionarySource;
}> {
  const response = await fetch(CENSUS_SCHEDULE_C_URL, { redirect: "follow" });
  if (!response.ok) throw new Error(`Schedule C returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("utf8");
  const countries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^"(\d{4})","([^"]+)","[^"]*"/.exec(line.trim());
    if (match) countries.set(match[1], match[2]);
  }
  if (countries.size < 200) throw new Error("Schedule C country dictionary was incomplete");
  return {
    names: countries,
    source: {
      dataUrl: CENSUS_SCHEDULE_C_URL,
      archiveSha256: sha256(bytes),
      fetchedAt: new Date().toISOString(),
      lastModified: response.headers.get("last-modified"),
    },
  };
}

export function parseCensusStateHs6Line(
  line: string,
  period: string
): ParsedCensusHardwareFields | null {
  if (line.length !== 258 && line.length !== 280) {
    throw new Error(`State HS6 record length was ${line.length}, expected 258 or 280`);
  }
  if (line.length === 280 && line.slice(258).trim()) {
    throw new Error("State HS6 trailing filler contained unexpected data");
  }
  if (line.slice(10, 12) !== "CA") return null;
  const [yearText, monthText] = period.split("-");
  if (line.slice(12, 16) !== yearText || line.slice(16, 18) !== monthText) {
    throw new Error(`State HS6 record period did not match ${period}`);
  }
  const year = Number(yearText);
  const hsCode = startupHardwareBasketCodeFor(line.slice(0, 6), year);
  if (!hsCode) return null;
  return {
    hsCode,
    countryCode: line.slice(6, 10),
    geographyCode: "CA",
    generalValueUsd: parseFixedNumber(line, 138, 153, "state GEN_VAL_YR"),
    airValueUsd: parseFixedNumber(line, 168, 183, "state AIR_VAL_YR"),
    airWeightKg: parseFixedNumber(line, 183, 198, "state AIR_SWT_YR"),
    vesselValueUsd: parseFixedNumber(line, 198, 213, "state VES_VAL_YR"),
    vesselWeightKg: parseFixedNumber(line, 213, 228, "state VES_SWT_YR"),
    containerizedVesselValueUsd: parseFixedNumber(line, 228, 243, "state CNT_VAL_YR"),
    containerizedVesselWeightKg: parseFixedNumber(line, 243, 258, "state CNT_SWT_YR"),
  };
}

export function parseCensusPortHs6Line(
  line: string,
  period: string
): ParsedCensusHardwareFields | null {
  if (line.length !== 230) throw new Error(`Port HS6 record length was ${line.length}, expected 230`);
  const portCode = line.slice(10, 14);
  const districtCode = portCode.slice(0, 2);
  if (!WEST_COAST_DISTRICTS.has(districtCode)) return null;
  const [yearText, monthText] = period.split("-");
  if (line.slice(14, 18) !== yearText || line.slice(18, 20) !== monthText) {
    throw new Error(`Port HS6 record period did not match ${period}`);
  }
  const year = Number(yearText);
  const hsCode = startupHardwareBasketCodeFor(line.slice(0, 6), year);
  if (!hsCode) return null;
  return {
    hsCode,
    countryCode: line.slice(6, 10),
    geographyCode: districtCode,
    generalValueUsd: parseFixedNumber(line, 125, 140, "port VALUE_YR"),
    airValueUsd: parseFixedNumber(line, 140, 155, "port AIR_VAL_YR"),
    airWeightKg: parseFixedNumber(line, 155, 170, "port AIR_SWT_YR"),
    vesselValueUsd: parseFixedNumber(line, 170, 185, "port VES_VAL_YR"),
    vesselWeightKg: parseFixedNumber(line, 185, 200, "port VES_SWT_YR"),
    containerizedVesselValueUsd: parseFixedNumber(line, 200, 215, "port CNT_VAL_YR"),
    containerizedVesselWeightKg: parseFixedNumber(line, 215, 230, "port CNT_SWT_YR"),
  };
}

function scopeSource(
  scope: OceanHardwareGeographyScope,
  download: DownloadResult,
  textFile: string
): CensusPublicSourceFile {
  return {
    dataUrl: download.dataUrl,
    layoutUrl:
      scope === "california_destination"
        ? CENSUS_STATE_IMPORTS_LAYOUT_URL
        : CENSUS_PORT_IMPORTS_LAYOUT_URL,
    fileName: textFile,
    archiveSha256: download.archiveSha256,
    fetchedAt: download.fetchedAt,
    lastModified: download.lastModified,
  };
}

async function parseScope(input: {
  period: string;
  scope: OceanHardwareGeographyScope;
  download: DownloadResult;
  countries: ReadonlyMap<string, string>;
  includeGatewayCorridors: boolean;
}): Promise<{
  summary: CensusPublicScopeSummary;
  positiveVesselSegments: CensusPublicGatewayCorridorSummary[];
}> {
  const textFile = zippedTextFile(input.download.zipPath);
  const unzip = spawn("unzip", ["-p", input.download.zipPath, textFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!unzip.stdout) throw new Error("Unable to read Census ZIP output");
  let stderr = "";
  unzip.stderr?.setEncoding("utf8");
  unzip.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const totals = emptyTotals();
  const categories = new Map<StartupHardwareCategory, MutableSummary>();
  const countries = new Map<string, MutableSummary>();
  const geographies = new Map<string, MutableSummary>();
  const gatewayCorridors = new Map<string, MutableGatewayCorridorSummary>();
  const observedHsCodes = new Set<StartupHardwareHsCode>();
  let matchedSourceRowCount = 0;
  const lines = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const fields =
      input.scope === "california_destination"
        ? parseCensusStateHs6Line(line, input.period)
        : parseCensusPortHs6Line(line, input.period);
    if (!fields) continue;
    if (!/^\d{4}$/.test(fields.countryCode)) {
      throw new Error(`Invalid Schedule C country code ${fields.countryCode}`);
    }
    matchedSourceRowCount += 1;
    addTotals(totals, fields);
    observedHsCodes.add(fields.hsCode);
    const category = BASKET_BY_CODE.get(fields.hsCode)?.category;
    if (!category) throw new Error(`Missing category for HS code ${fields.hsCode}`);
    if (input.includeGatewayCorridors && fields.vesselValueUsd > 0) {
      if (input.scope !== "west_coast_gateway") {
        throw new Error("Gateway corridors can only be collected from West Coast port rows");
      }
      const key = `${category}:${fields.countryCode}:${fields.geographyCode}`;
      const corridor = gatewayCorridors.get(key) ?? {
        vesselValueUsd: 0,
        vesselWeightKg: 0,
        containerizedVesselValueUsd: 0,
        containerizedVesselWeightKg: 0,
      };
      corridor.vesselValueUsd += fields.vesselValueUsd;
      corridor.vesselWeightKg += fields.vesselWeightKg;
      corridor.containerizedVesselValueUsd += fields.containerizedVesselValueUsd;
      corridor.containerizedVesselWeightKg +=
        fields.containerizedVesselWeightKg;
      gatewayCorridors.set(key, corridor);
    }
    const categorySummary = categories.get(category) ?? mutableSummary();
    addToSummary(categorySummary, fields);
    categories.set(category, categorySummary);
    const countrySummary = countries.get(fields.countryCode) ?? mutableSummary();
    addToSummary(countrySummary, fields);
    countries.set(fields.countryCode, countrySummary);
    const geographySummary = geographies.get(fields.geographyCode) ?? mutableSummary();
    addToSummary(geographySummary, fields);
    geographies.set(fields.geographyCode, geographySummary);
  }
  const exitCode = await new Promise<number>((resolve, reject) => {
    unzip.once("error", reject);
    unzip.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`unzip failed for ${textFile}: ${stderr.trim()}`);
  if (matchedSourceRowCount === 0) {
    throw new Error(`No hardware rows matched ${input.scope} for ${input.period}`);
  }
  for (const countryCode of countries.keys()) {
    if (!input.countries.has(countryCode)) {
      throw new Error(`Schedule C dictionary did not resolve country code ${countryCode}`);
    }
  }

  const categoryRows: CensusPublicCategorySummary[] = [...categories.entries()]
    .map(([category, summary]) => ({
      category,
      totals: summary.totals,
      matchedSourceRowCount: summary.matchedSourceRowCount,
      hsCodes: [...summary.hsCodes].sort(),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
  const countryRows: CensusPublicCountrySummary[] = [...countries.entries()]
    .map(([countryCode, summary]) => ({
      countryCode,
      countryName: input.countries.get(countryCode)!,
      totals: summary.totals,
      matchedSourceRowCount: summary.matchedSourceRowCount,
    }))
    .sort(
      (a, b) =>
        b.totals.vesselValueUsd - a.totals.vesselValueUsd ||
        a.countryName.localeCompare(b.countryName)
    );
  const geographyRows: CensusPublicGeographySummary[] = [...geographies.entries()]
    .map(([geographyCode, summary]) => ({
      geographyCode,
      geographyLabel:
        input.scope === "california_destination"
          ? "California destination"
          : DISTRICT_LABELS.get(geographyCode) ?? `District ${geographyCode}`,
      totals: summary.totals,
      matchedSourceRowCount: summary.matchedSourceRowCount,
    }))
    .sort((a, b) => a.geographyCode.localeCompare(b.geographyCode));

  const source = scopeSource(input.scope, input.download, textFile);
  const positiveVesselSegments = [...gatewayCorridors.entries()]
    .map(([key, totals]) => {
      const [category, countryCode, gatewayDistrictCode] = key.split(":");
      return {
        category: category as StartupHardwareCategory,
        countryCode,
        gatewayDistrictCode,
        ...totals,
      };
    })
    .sort(compareCensusPublicGatewayCorridors);
  return {
    summary: {
      scope: input.scope,
      basis:
        input.scope === "california_destination"
          ? "state_of_ultimate_destination"
          : "port_of_unlading",
      source,
      totals,
      categories: categoryRows,
      countries: countryRows,
      geographies: geographyRows,
      matchedSourceRowCount,
      observedHsCodes: [...observedHsCodes].sort(),
      originCountryCount: countries.size,
    },
    positiveVesselSegments,
  };
}

async function parseOriginHistoryScope(input: {
  period: string;
  scope: OceanHardwareGeographyScope;
  download: DownloadResult;
  originCountryCode: string;
}): Promise<CensusPublicOriginHistoryScopeSummary> {
  const textFile = zippedTextFile(input.download.zipPath);
  const unzip = spawn("unzip", ["-p", input.download.zipPath, textFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!unzip.stdout) throw new Error("Unable to read Census ZIP output");
  let stderr = "";
  unzip.stderr?.setEncoding("utf8");
  unzip.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const totals = emptyTotals();
  const originTotals = emptyTotals();
  const originCategories = new Map<StartupHardwareCategory, MutableSummary>();
  const originGeographies = new Map<string, MutableSummary>();
  const observedHsCodes = new Set<StartupHardwareHsCode>();
  let matchedSourceRowCount = 0;
  let originMatchedSourceRowCount = 0;

  const lines = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const fields =
      input.scope === "california_destination"
        ? parseCensusStateHs6Line(line, input.period)
        : parseCensusPortHs6Line(line, input.period);
    if (!fields || !CORE43_HS_CODES.has(fields.hsCode)) continue;
    if (!/^\d{4}$/.test(fields.countryCode)) {
      throw new Error(`Invalid Schedule C country code ${fields.countryCode}`);
    }
    matchedSourceRowCount += 1;
    addTotals(totals, fields);
    observedHsCodes.add(fields.hsCode);
    if (fields.countryCode !== input.originCountryCode) continue;

    originMatchedSourceRowCount += 1;
    addTotals(originTotals, fields);
    const category = BASKET_BY_CODE.get(fields.hsCode)?.category;
    if (!category) throw new Error(`Missing category for HS code ${fields.hsCode}`);
    const categorySummary =
      originCategories.get(category) ?? mutableSummary();
    addToSummary(categorySummary, fields);
    originCategories.set(category, categorySummary);
    const geographySummary =
      originGeographies.get(fields.geographyCode) ?? mutableSummary();
    addToSummary(geographySummary, fields);
    originGeographies.set(fields.geographyCode, geographySummary);
  }
  const exitCode = await new Promise<number>((resolve, reject) => {
    unzip.once("error", reject);
    unzip.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`unzip failed for ${textFile}: ${stderr.trim()}`);
  }
  if (matchedSourceRowCount === 0 || originMatchedSourceRowCount === 0) {
    throw new Error(
      `No core43 rows matched ${input.scope} for ${input.period}`
    );
  }

  const categoryRows: CensusPublicOriginHistoryCategoryVesselSummary[] = [
    ...originCategories.entries(),
  ]
    .map(([category, summary]) => ({
      category,
      vesselValueUsd: summary.totals.vesselValueUsd,
      vesselWeightKg: summary.totals.vesselWeightKg,
    }))
    .sort((left, right) => left.category.localeCompare(right.category));
  const geographyRows: CensusPublicOriginHistoryGeographyVesselSummary[] = [
    ...originGeographies.entries(),
  ]
    .map(([geographyCode, summary]) => ({
      geographyCode,
      vesselValueUsd: summary.totals.vesselValueUsd,
      vesselWeightKg: summary.totals.vesselWeightKg,
    }))
    .sort((left, right) =>
      left.geographyCode.localeCompare(right.geographyCode)
    );

  return {
    scope: input.scope,
    basis:
      input.scope === "california_destination"
        ? "state_of_ultimate_destination"
        : "port_of_unlading",
    source: scopeSource(input.scope, input.download, textFile),
    totals,
    originTotals,
    originCategoryVesselSummaries: categoryRows,
    originGeographyVesselSummaries: geographyRows,
    matchedSourceRowCount,
    originMatchedSourceRowCount,
    observedHsCodeKey: [...observedHsCodes].sort().join(","),
  };
}

async function main(): Promise<void> {
  const asOfMonth = cliValue("as-of");
  if (!asOfMonth) throw new Error("Usage: npm run snapshot:intel-hardware -- --as-of=YYYY-MM");
  const { year } = parseAsOfMonth(asOfMonth);
  const outputPath = path.resolve(cliValue("output") ?? DEFAULT_OUTPUT);
  const refresh = cliFlag("refresh");
  const cacheDir = path.resolve(
    cliValue("cache-dir") ?? path.join(os.tmpdir(), "derya-census-hardware-snapshot")
  );
  await mkdir(cacheDir, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });
  const countryDictionary = await countryNames();
  const countries = countryDictionary.names;
  const chinaName = countries.get(CHINA_SCHEDULE_C_CODE);
  if (chinaName !== "China") {
    throw new Error("Schedule C did not resolve China code 5700");
  }
  const periods = [
    ...Array.from({ length: 5 }, (_, index) => `${year - 5 + index}-12`),
    asOfMonth,
  ];
  const historyPeriods = [
    ...Array.from(
      { length: year - CHINA_HISTORY_START_YEAR },
      (_, index) => `${CHINA_HISTORY_START_YEAR + index}-12`
    ),
    asOfMonth,
  ];
  const allPeriods = [...new Set([...historyPeriods, ...periods])].sort();
  const fullPeriodSet = new Set(periods);
  const summaries = [];
  const chinaHistoryPeriods: CensusPublicOriginHistoryPeriod[] = [];
  let currentWestCoastSegments: CensusPublicGatewayCorridorSummary[] = [];
  for (const period of allPeriods) {
    const urls = sourceUrls(period);
    const statePath = path.join(cacheDir, `state-${period}.zip`);
    const portPath = path.join(cacheDir, `port-${period}.zip`);
    console.log(`Checking official Census files for ${period}`);
    const [stateDownload, portDownload] = await Promise.all([
      download(urls.state, statePath, { refresh }),
      download(urls.port, portPath, { refresh }),
    ]);
    console.log(`Parsing China core43 history rows for ${period}`);
    const [historyCalifornia, historyWestCoast] = await Promise.all([
      parseOriginHistoryScope({
        period,
        scope: "california_destination",
        download: stateDownload,
        originCountryCode: CHINA_SCHEDULE_C_CODE,
      }),
      parseOriginHistoryScope({
        period,
        scope: "west_coast_gateway",
        download: portDownload,
        originCountryCode: CHINA_SCHEDULE_C_CODE,
      }),
    ]);
    chinaHistoryPeriods.push({
      period,
      periodKind: period.endsWith("-12")
        ? ("complete_year" as const)
        : ("current_ytd" as const),
      californiaDestination: historyCalifornia,
      westCoastGateways: historyWestCoast,
    });
    if (!fullPeriodSet.has(period)) continue;

    console.log(`Parsing full California and West Coast rows for ${period}`);
    const [californiaResult, westCoastResult] = await Promise.all([
      parseScope({
        period,
        scope: "california_destination",
        download: stateDownload,
        countries,
        includeGatewayCorridors: false,
      }),
      parseScope({
        period,
        scope: "west_coast_gateway",
        download: portDownload,
        countries,
        includeGatewayCorridors: period === asOfMonth,
      }),
    ]);
    const californiaDestination = californiaResult.summary;
    const westCoastGateways = westCoastResult.summary;
    if (period === asOfMonth) {
      currentWestCoastSegments = westCoastResult.positiveVesselSegments;
    }
    const periodYear = Number(period.slice(0, 4));
    summaries.push({
      period,
      periodKind: period.endsWith("-12") ? ("complete_year" as const) : ("current_ytd" as const),
      applicableHsCodeCount: STARTUP_PRODUCTION_HARDWARE_BASKET.filter(
        (entry) => entry.introducedYear == null || entry.introducedYear <= periodYear
      ).length,
      californiaDestination,
      westCoastGateways,
    });
  }
  const snapshot: CensusPublicHardwareSnapshot = {
    schemaVersion: CENSUS_PUBLIC_HARDWARE_SCHEMA_VERSION,
    basketId: "startup_production_hardware_v1",
    asOfMonth,
    generatedAt: new Date().toISOString(),
    countryDictionarySource: countryDictionary.source,
    currentWestCoastCorridors: {
      period: asOfMonth,
      geographyBasis: "port_of_unlading_district",
      originBasis: "country_of_origin",
      commodityBasis: "startup_hardware_category",
      positiveVesselSegments: currentWestCoastSegments,
    },
    originHistorySlices: [
      {
        originCountryCode: CHINA_SCHEDULE_C_CODE,
        originCountryName: chinaName,
        basketId: STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET_ID,
        startYear: CHINA_HISTORY_START_YEAR,
        applicableHsCodeCount:
          STARTUP_PRODUCTION_HARDWARE_CORE43_CODES.length,
        periods: chinaHistoryPeriods,
      },
    ],
    periods: summaries,
  };
  validateCensusPublicHardwareSnapshot(snapshot);
  const serializedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (Buffer.byteLength(serializedSnapshot, "utf8") >= SNAPSHOT_MAX_BYTES) {
    throw new Error(
      `Census public hardware snapshot exceeds ${SNAPSHOT_MAX_BYTES} bytes`
    );
  }
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, serializedSnapshot, "utf8");
  const verified = JSON.parse(await readFile(temporaryPath, "utf8")) as CensusPublicHardwareSnapshot;
  validateCensusPublicHardwareSnapshot(verified);
  await rename(temporaryPath, outputPath);
  console.log(
    `Wrote ${periods.length} full periods and ${historyPeriods.length} China core43 periods to ${outputPath}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
