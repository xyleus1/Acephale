import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { ingestMarketSource, listEnabledMarketSources } from "../src/lib/market-intelligence/ingest-market-source";
import { getMarketIntelligenceSource } from "../src/lib/market-intelligence/source-registry";

function argValue(name: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function main() {
  const officeArg = argValue("office");
  const office = officeArg
    ? await prisma.office.findUnique({ where: { id: officeArg }, select: { id: true, name: true } })
    : await prisma.office.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!office) throw new Error("No office found. Pass --office=<officeId> after creating an office.");

  const contentFile = argValue("content-file");
  const content = argValue("content") ?? (contentFile ? readFileSync(contentFile, "utf8") : null);
  const sourceId = argValue("source");
  const title = argValue("title");
  const url = argValue("url");
  const strict = process.argv.includes("--strict");
  const limit = Number(argValue("limit") ?? 10);

  if (content) {
    const source = getMarketIntelligenceSource(sourceId ?? "manual-market-intel");
    const result = await ingestMarketSource({
      officeId: office.id,
      source,
      title: title ?? "Manual market intelligence update",
      url,
      content,
      strict,
      limit: 1,
    });
    console.log(JSON.stringify({ office, result }, null, 2));
    return;
  }

  const sources = sourceId
    ? [getMarketIntelligenceSource(sourceId)]
    : listEnabledMarketSources().filter((source) => source.fetchType !== "manual");
  if (sources.length === 0) {
    throw new Error("No enabled fetchable market sources. Pass --content or configure MARKET_INTELLIGENCE_SOURCES_JSON.");
  }

  const results = [];
  for (const source of sources) {
    results.push(await ingestMarketSource({ officeId: office.id, source, strict, limit }));
  }
  console.log(JSON.stringify({ office, results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
