import "dotenv/config";
import { Prisma, type PrismaClient } from "../src/generated/world-client";
import { getWorldPrisma } from "../src/lib/world/client";
import { loadSourceFile } from "../src/lib/world/load";
import { mergeSourceRecords } from "../src/lib/world/merge";
import { resolveGleifLatestCsvUrl } from "../src/lib/world/sources/gleif";
import { downloadHint as companiesHouseHint } from "../src/lib/world/sources/companies-house";
import { downloadHint as epaFrsHint } from "../src/lib/world/sources/epa-frs";
import { downloadHint as euIndustrialEmissionsHint } from "../src/lib/world/sources/eu-industrial-emissions";
import { downloadHint as gleifHint } from "../src/lib/world/sources/gleif";
import { downloadHint as pdlHint } from "../src/lib/world/sources/pdl-free";

type Args = Record<string, string | boolean>;

function parseArgs(argv: readonly string[]) {
  const [command = "help", ...rest] = argv;
  const args: Args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return { command, args };
}

function stringArg(args: Args, key: string) {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`--${key} is required`);
  return value;
}

function numberArg(args: Args, key: string, fallback: number) {
  const value = args[key];
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${key} must be a positive integer`);
  return parsed;
}

function printHelp() {
  console.log(`World company spine CLI

  load --source gleif|companies_house|pdl_free|epa_frs|eu_industrial_emissions --file <path> [--limit N] [--batch N]
  merge [--source X] [--max-runs N]
  stats
  urls

CSV and JSONL files may be plain or gzipped. ZIP files are not read directly,
unzip GLEIF and Companies House archives before passing the extracted file.`);
}

async function stats(client: PrismaClient) {
  const [sources, companies, manufacturers, countries] = await Promise.all([
    client.$queryRaw<Array<{ source: string; count: bigint }>>(Prisma.sql`
      SELECT "source", count(*) AS count
      FROM "world_source_record"
      GROUP BY "source"
      ORDER BY "source"
    `),
    client.worldCompany.count(),
    client.worldCompany.count({ where: { isManufacturer: true } }),
    client.$queryRaw<Array<{ country: string | null; count: bigint }>>(Prisma.sql`
      SELECT "country", count(*) AS count
      FROM "world_company"
      GROUP BY "country"
      ORDER BY count DESC NULLS LAST, "country"
      LIMIT 10
    `),
  ]);
  console.log(JSON.stringify({
    sources: sources.map((row) => ({ source: row.source, count: Number(row.count) })),
    companies,
    manufacturers,
    topCountries: countries.map((row) => ({ country: row.country, count: Number(row.count) })),
  }, null, 2));
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "help") {
    printHelp();
    return;
  }
  if (command === "urls") {
    console.log(JSON.stringify({
      gleif: { hint: gleifHint, latestCsvUrl: await resolveGleifLatestCsvUrl() },
      companies_house: companiesHouseHint,
      pdl_free: pdlHint,
      epa_frs: epaFrsHint,
      eu_industrial_emissions: euIndustrialEmissionsHint,
    }, null, 2));
    return;
  }
  const client = getWorldPrisma();
  if (command === "load") {
    const result = await loadSourceFile({
      client,
      source: stringArg(args, "source") as "gleif" | "companies_house" | "pdl_free" | "epa_frs" | "eu_industrial_emissions",
      filePath: stringArg(args, "file"),
      limit: typeof args.limit === "string" ? numberArg(args, "limit", 1) : undefined,
      batchSize: numberArg(args, "batch", 2000),
    });
    console.log(JSON.stringify({
      id: result.id,
      source: result.source,
      status: result.status,
      rowsRead: result.rowsRead,
      rowsInserted: result.rowsInserted,
      rowsSkipped: result.rowsSkipped,
    }, null, 2));
    return;
  }
  if (command === "merge") {
    const maxRuns = numberArg(args, "max-runs", 5);
    let result = await mergeSourceRecords({
      client,
      source: typeof args.source === "string" ? args.source : undefined,
    });
    for (let run = 1; result.leftBehind > 0 && run < maxRuns; run += 1) {
      const rerun = await mergeSourceRecords({
        client,
        source: typeof args.source === "string" ? args.source : undefined,
      });
      result = {
        matchedByLei: result.matchedByLei + rerun.matchedByLei,
        matchedByDomain: result.matchedByDomain + rerun.matchedByDomain,
        matchedByName: result.matchedByName + rerun.matchedByName,
        inserted: result.inserted + rerun.inserted,
        leftBehind: rerun.leftBehind,
      };
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.leftBehind > 0) {
      console.error(`merge left ${result.leftBehind} source records pending after ${maxRuns} runs`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "stats") {
    await stats(client);
    return;
  }
  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
