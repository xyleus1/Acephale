import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { Prisma, type PrismaClient } from "../../generated/world-client";
import { readCsvRows } from "./csv";
import { parseCompaniesHouseRow } from "./sources/companies-house";
import { parseEpaFrsRow } from "./sources/epa-frs";
import {
  aggregateKey as euIndustrialEmissionsAggregateKey,
  parseEuIndustrialEmissionsRow,
} from "./sources/eu-industrial-emissions";
import { parseGleifRow } from "./sources/gleif";
import { parsePdlFreeRow } from "./sources/pdl-free";
import type { NormalizedSourceRecord } from "./records";

type Source = "gleif" | "companies_house" | "pdl_free" | "epa_frs" | "eu_industrial_emissions";

const parsers: Record<Source, (row: Record<string, unknown>) => NormalizedSourceRecord | null> = {
  gleif: (row) => parseGleifRow(row as Record<string, string>),
  companies_house: (row) => parseCompaniesHouseRow(row as Record<string, string>),
  pdl_free: parsePdlFreeRow,
  epa_frs: (row) => parseEpaFrsRow(row as Record<string, string>),
  eu_industrial_emissions: (row) => parseEuIndustrialEmissionsRow(row as Record<string, string>),
};

function parseSource(value: string): Source {
  if (value in parsers) return value as Source;
  throw new Error(`Unsupported world source: ${value}`);
}

function inputStream(filePath: string) {
  const stream = createReadStream(filePath);
  return filePath.toLowerCase().endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
}

function jsonValue(value: unknown) {
  return value as NormalizedSourceRecord["payload"];
}

function nullableJson(value: NormalizedSourceRecord["legalIds"]) {
  return value ?? Prisma.DbNull;
}

function createManyInput(record: NormalizedSourceRecord, loadRunId: string) {
  return {
    source: record.source,
    sourceRecordId: record.sourceRecordId,
    loadRunId,
    name: record.name,
    nameNormalized: record.nameNormalized,
    nameMatchable: record.nameMatchable,
    domain: record.domain,
    lei: record.lei,
    country: record.country,
    region: record.region,
    city: record.city,
    postalCode: record.postalCode,
    addressLine: record.addressLine,
    legalIds: nullableJson(record.legalIds),
    industryCodes: nullableJson(record.industryCodes),
    isManufacturer: record.isManufacturer,
    manufacturerEvidence: nullableJson(record.manufacturerEvidence),
    sizeBand: record.sizeBand,
    foundedYear: record.foundedYear,
    linkedinUrl: record.linkedinUrl,
    website: record.website,
    entityStatus: record.entityStatus,
    payload: jsonValue(record.payload),
  };
}

type JsonObject = Record<string, unknown>;

function objectValue(value: NormalizedSourceRecord["payload"] | NormalizedSourceRecord["industryCodes"]) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function reportYear(record: NormalizedSourceRecord) {
  return reportYearValue(aggregateDetails(record).latest);
}

function reportYearValue(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return -Infinity;
  const year = Number((value as JsonObject).reportingYear);
  return Number.isFinite(year) ? year : -Infinity;
}

function distinctStrings(values: unknown[], limit = Number.POSITIVE_INFINITY) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const normalized = String(value).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function aggregateDetails(record: NormalizedSourceRecord) {
  const payload = objectValue(record.payload);
  const legacyRows = arrayValue(payload.rows);
  const rows = legacyRows.length ? legacyRows : [record.payload];
  const first = payload.first ?? rows[0];
  const latest = payload.latest ?? rows.reduce((current, row) => (
    reportYearValue(row) > reportYearValue(current) ? row : current
  ), rows[0]);
  const reportingYears = payload.reportingYears
    ? distinctStrings(arrayValue(payload.reportingYears))
    : distinctStrings(rows.map((row) => (
      typeof row === "object" && row !== null && !Array.isArray(row)
        ? (row as JsonObject).reportingYear
        : null
    )));
  const pollutants = payload.pollutants
    ? distinctStrings(arrayValue(payload.pollutants), 200)
    : distinctStrings(rows.flatMap((row) => (
      typeof row === "object" && row !== null && !Array.isArray(row)
        ? [(row as JsonObject).Pollutant, (row as JsonObject).pollutant]
        : []
    )), 200);
  const activities = payload.activities
    ? distinctStrings(arrayValue(payload.activities))
    : distinctStrings(rows.flatMap((row) => (
      typeof row === "object" && row !== null && !Array.isArray(row)
        ? [
          (row as JsonObject).mainActivity,
          (row as JsonObject).MainActivity,
          (row as JsonObject).IEDAnnexIMainActivity,
          (row as JsonObject).EPRTRAnnexIMainActivity,
        ]
        : []
    )));
  return {
    first,
    latest,
    rowCount: typeof payload.rowCount === "number" ? payload.rowCount : rows.length,
    reportingYears,
    pollutants,
    activities,
    files: distinctStrings(arrayValue(payload.files)),
  };
}

function mergeJsonArrays(first: unknown, second: unknown) {
  const values = [...arrayValue(first), ...arrayValue(second)];
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeJsonObjects(
  first: NormalizedSourceRecord["industryCodes"],
  second: NormalizedSourceRecord["industryCodes"],
  latest: NormalizedSourceRecord["industryCodes"],
) {
  const result: JsonObject = {};
  for (const source of [objectValue(first), objectValue(second)]) {
    for (const [key, value] of Object.entries(source)) {
      result[key] = Array.isArray(value)
        ? mergeJsonArrays(result[key], value)
        : result[key] ?? value;
    }
  }
  const latestActivity = objectValue(latest).activity;
  if (Array.isArray(latestActivity)) {
    result.activity = mergeJsonArrays(latestActivity, result.activity);
  }
  return result as NormalizedSourceRecord["industryCodes"];
}

function mergeEvidence(
  first: NormalizedSourceRecord["manufacturerEvidence"],
  second: NormalizedSourceRecord["manufacturerEvidence"],
) {
  const values = [...arrayValue(first), ...arrayValue(second)];
  const seen = new Set<string>();
  return values.filter((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const item = value as JsonObject;
    const key = `${String(item.kind ?? "")}:${String(item.value ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }) as NormalizedSourceRecord["manufacturerEvidence"];
}

function aggregateRecords(
  first: NormalizedSourceRecord,
  second: NormalizedSourceRecord,
  sourceFileName: string,
) {
  const firstDetails = aggregateDetails(first);
  const secondDetails = aggregateDetails(second);
  const latest = reportYear(second) > reportYear(first) ? second : first;
  const latestDetails = latest === second ? secondDetails : firstDetails;
  return {
    ...first,
    name: latest.name,
    nameNormalized: latest.nameNormalized,
    entityStatus: latest.entityStatus,
    industryCodes: mergeJsonObjects(first.industryCodes, second.industryCodes, latest.industryCodes),
    isManufacturer: first.isManufacturer || second.isManufacturer,
    manufacturerEvidence: mergeEvidence(first.manufacturerEvidence, second.manufacturerEvidence),
    payload: {
      first: firstDetails.first,
      latest: latestDetails.latest,
      rowCount: firstDetails.rowCount + secondDetails.rowCount,
      reportingYears: distinctStrings([
        ...firstDetails.reportingYears,
        ...secondDetails.reportingYears,
      ]).sort((a, b) => Number(a) - Number(b)),
      pollutants: distinctStrings([
        ...firstDetails.pollutants,
        ...secondDetails.pollutants,
      ], 200),
      activities: distinctStrings([
        ...firstDetails.activities,
        ...secondDetails.activities,
      ]),
      files: distinctStrings([
        ...firstDetails.files,
        ...secondDetails.files,
        sourceFileName,
      ]),
    } as NormalizedSourceRecord["payload"],
  };
}

function createAggregateRecord(record: NormalizedSourceRecord, sourceFileName: string) {
  const details = aggregateDetails(record);
  return {
    ...record,
    payload: {
      first: details.first,
      latest: details.latest,
      rowCount: 1,
      reportingYears: details.reportingYears,
      pollutants: details.pollutants,
      activities: details.activities,
      files: [sourceFileName],
    } as NormalizedSourceRecord["payload"],
  };
}

const aggregateKeys: Partial<Record<Source, (record: NormalizedSourceRecord) => string>> = {
  eu_industrial_emissions: euIndustrialEmissionsAggregateKey,
};

async function* sourceRows(filePath: string, source: Source): AsyncGenerator<Record<string, unknown>> {
  if (filePath.toLowerCase().endsWith(".zip")) {
    throw new Error("ZIP input is not supported directly. Unzip the file first, then pass the CSV path.");
  }
  const stream = inputStream(filePath);
  if (source === "pdl_free" && /\.(jsonl|json)(\.gz)?$/i.test(filePath)) {
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as Record<string, unknown>;
    }
    return;
  }
  yield* readCsvRows(stream);
}

export async function loadSourceFile(args: {
  source: Source;
  filePath: string;
  limit?: number;
  batchSize?: number;
  client: PrismaClient;
}) {
  const source = parseSource(args.source);
  const batchSize = args.batchSize ?? 2000;
  const run = await args.client.worldLoadRun.create({
    data: { source, fileName: path.basename(args.filePath) },
  });
  let rowsRead = 0;
  let rowsInserted = 0;
  let rowsSkipped = 0;
  let batch: ReturnType<typeof createManyInput>[] = [];
  const aggregateKey = aggregateKeys[source];
  const aggregateBuffer = aggregateKey ? new Map<string, NormalizedSourceRecord>() : null;

  const flush = async () => {
    if (batch.length) {
      const result = await args.client.worldSourceRecord.createMany({ data: batch, skipDuplicates: true });
      rowsInserted += result.count;
      rowsSkipped += batch.length - result.count;
      batch = [];
    }
    await args.client.worldLoadRun.update({
      where: { id: run.id },
      data: { rowsRead, rowsInserted, rowsSkipped },
    });
  };

  try {
    for await (const row of sourceRows(args.filePath, source)) {
      if (args.limit !== undefined && rowsRead >= args.limit) break;
      rowsRead += 1;
      const normalized = parsers[source](row);
      if (!normalized) {
        rowsSkipped += 1;
      } else if (aggregateBuffer && aggregateKey) {
        const key = aggregateKey(normalized);
        const previous = aggregateBuffer.get(key);
        aggregateBuffer.set(
          key,
          previous
            ? aggregateRecords(previous, normalized, path.basename(args.filePath))
            : createAggregateRecord(normalized, path.basename(args.filePath)),
        );
      } else {
        batch.push(createManyInput(normalized, run.id));
      }
      if (!aggregateBuffer && batch.length >= batchSize) {
        await flush();
      } else if (!aggregateBuffer && rowsRead % 50_000 === 0) {
        process.stderr.write(`world load source=${source} rows=${rowsRead} inserted=${rowsInserted}\n`);
        await flush();
      }
    }
    if (aggregateBuffer) {
      for (const record of aggregateBuffer.values()) {
        batch.push(createManyInput(record, run.id));
        if (batch.length >= batchSize) await flush();
      }
    }
    await flush();
    const finished = await args.client.worldLoadRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "DONE", rowsRead, rowsInserted, rowsSkipped },
    });
    process.stderr.write(`world load source=${source} rows=${rowsRead} inserted=${rowsInserted} skipped=${rowsSkipped}\n`);
    return finished;
  } catch (error) {
    await args.client.worldLoadRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "FAILED",
        rowsRead,
        rowsInserted,
        rowsSkipped,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
