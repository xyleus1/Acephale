import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { Prisma, type PrismaClient } from "../../generated/world-client";
import { readCsvRows } from "./csv";
import { parseCompaniesHouseRow } from "./sources/companies-house";
import { parseGleifRow } from "./sources/gleif";
import { parsePdlFreeRow } from "./sources/pdl-free";
import type { NormalizedSourceRecord } from "./records";

type Source = "gleif" | "companies_house" | "pdl_free";

const parsers: Record<Source, (row: Record<string, unknown>) => NormalizedSourceRecord | null> = {
  gleif: (row) => parseGleifRow(row as Record<string, string>),
  companies_house: (row) => parseCompaniesHouseRow(row as Record<string, string>),
  pdl_free: parsePdlFreeRow,
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
      } else {
        batch.push(createManyInput(normalized, run.id));
      }
      if (batch.length >= batchSize) {
        await flush();
      } else if (rowsRead % 50_000 === 0) {
        process.stderr.write(`world load source=${source} rows=${rowsRead} inserted=${rowsInserted}\n`);
        await flush();
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
