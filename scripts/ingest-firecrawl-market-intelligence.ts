import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { ingestFirecrawlMarketSource, listFirecrawlEnabledMarketSources } from "../src/lib/market-intelligence/ingest-firecrawl-source";
import { getMarketIntelligenceSource } from "../src/lib/market-intelligence/source-registry";

function arg(name: string) {
  const prefix = `--${name}=`;
  const direct = process.argv.find((value) => value.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const officeId = arg("office");
  if (!officeId) throw new Error("Usage: npm run market:ingest:firecrawl -- --office <officeId> [--source id] [--query text] [--url https://...] --confirm-live");
  const liveEnabled = process.env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED === "true";
  const confirmed = process.argv.includes("--confirm-live");
  if (!liveEnabled || !confirmed) {
    throw new Error("Live Firecrawl ingestion is blocked. Set MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true and pass --confirm-live after running a dry-run/preview.");
  }
  const sourceId = arg("source");
  const query = arg("query");
  const url = arg("url");
  const strict = process.argv.includes("--strict");
  const limit = arg("limit") ? Number(arg("limit")) : undefined;

  const sources = sourceId
    ? [getMarketIntelligenceSource(sourceId)]
    : listFirecrawlEnabledMarketSources();
  if (sources.length === 0) throw new Error("No enabled Firecrawl market sources. Pass --source or enable a source in MARKET_INTELLIGENCE_SOURCES_JSON.");

  const results = [];
  for (const source of sources) {
    results.push(await ingestFirecrawlMarketSource({
      officeId,
      source,
      query,
      urls: url ? [url] : undefined,
      limit,
      strict,
    }));
  }
  console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
