import { prisma } from "@/lib/prisma";
import { toMemoryJson } from "@/lib/memory/record-event";
import { ingestMarketObject, type MarketSourceItem } from "./ingest-market-object";
import { FirecrawlClient, sanitizeFirecrawlProviderMessage, type FirecrawlClientOptions, type FirecrawlNormalizedItem } from "./firecrawl-client";
import {
  getMarketIntelligenceSource,
  getMarketIntelligenceSourceRegistry,
  type MarketIntelligenceSourceDefinition,
} from "./source-registry";
import {
  assertCanUseFirecrawlSource,
  filterAllowedFirecrawlUrls,
  isBlockedMarketContent,
  sourceAllowedDomains,
  sourceRunLimits,
} from "./source-policy";

export type IngestFirecrawlMarketSourceInput = {
  officeId: string;
  sourceId?: string | null;
  source?: MarketIntelligenceSourceDefinition | null;
  query?: string | null;
  urls?: string[] | null;
  limit?: number | null;
  strict?: boolean;
  clientOptions?: FirecrawlClientOptions;
};

function clamp(value: number | null | undefined, fallback: number, max: number) {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(max, Math.floor(raw)));
}

function itemFromFirecrawl(input: {
  source: MarketIntelligenceSourceDefinition;
  item: FirecrawlNormalizedItem;
  fetchedAt: Date;
}): MarketSourceItem {
  const content = [
    input.item.title,
    input.item.description,
    input.item.markdown,
  ].filter(Boolean).join("\n\n");
  return {
    externalId: input.item.url,
    url: input.item.url,
    title: input.item.title,
    content,
    publishedAt: input.item.publishedAt ?? null,
    author: typeof input.item.metadata.author === "string" ? input.item.metadata.author : input.source.name,
  };
}

async function createRun(input: {
  officeId: string;
  sourceId: string;
  query: string | null;
  metadata: Record<string, unknown>;
}) {
  return prisma.marketIngestionRun.create({
    data: {
      officeId: input.officeId,
      provider: "firecrawl",
      sourceId: input.sourceId,
      query: input.query,
      status: "running",
      startedAt: new Date(),
      metadata: toMemoryJson(input.metadata),
    },
  });
}

async function finishRun(input: {
  officeId: string;
  runId: string;
  status: "succeeded" | "failed";
  resultCount?: number;
  objectCount?: number;
  signalCount?: number;
  reviewCount?: number;
  error?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return prisma.marketIngestionRun.updateMany({
    where: { id: input.runId, officeId: input.officeId },
    data: {
      status: input.status,
      completedAt: new Date(),
      resultCount: input.resultCount ?? 0,
      objectCount: input.objectCount ?? 0,
      signalCount: input.signalCount ?? 0,
      reviewCount: input.reviewCount ?? 0,
      error: input.error ? sanitizeFirecrawlProviderMessage(input.error).slice(0, 2000) : null,
      metadata: input.metadata ? toMemoryJson(input.metadata) : undefined,
    },
  });
}

export async function ingestFirecrawlMarketSource(input: IngestFirecrawlMarketSourceInput) {
  const source = input.source ?? getMarketIntelligenceSource(input.sourceId);
  assertCanUseFirecrawlSource(source);
  if (source.fetchType !== "firecrawl_search" && source.fetchType !== "firecrawl_scrape") {
    throw new Error(`Source ${source.id} is ${source.fetchType}; use a Firecrawl source for Firecrawl ingestion.`);
  }
  if (!source.enabled && !input.urls?.length && !input.query) {
    throw new Error(`Market source ${source.id} is disabled. Pass explicit query/urls or enable it in the source registry.`);
  }

  const limits = sourceRunLimits(source);
  const resultLimit = clamp(input.limit, source.maxResultsPerRun, limits.maxResults);
  const pageLimit = clamp(input.limit, source.maxPagesPerRun, limits.maxPages);
  const allowedDomains = sourceAllowedDomains(source);
  const query = input.query?.trim() || source.name;
  const run = await createRun({
    officeId: input.officeId,
    sourceId: source.id,
    query: source.fetchType === "firecrawl_search" ? query : null,
    metadata: {
      sourceName: source.name,
      fetchType: source.fetchType,
      allowedDomains,
      maxResults: resultLimit,
      maxPages: pageLimit,
    },
  });

  try {
    const client = new FirecrawlClient({
      maxResultsPerRun: resultLimit,
      maxPagesPerRun: pageLimit,
      ...input.clientOptions,
    });
    const fetchedAt = new Date();
    let normalizedItems: FirecrawlNormalizedItem[] = [];

    if (source.fetchType === "firecrawl_search") {
      const search = await client.search({
        query,
        limit: resultLimit,
        includeDomains: allowedDomains,
        scrapeResults: false,
      });
      const urls = filterAllowedFirecrawlUrls(search.items.map((item) => item.url), source).slice(0, pageLimit);
      const uniqueUrls = [...new Set(urls)];
      const scraped = [];
      for (const url of uniqueUrls) {
        const result = await client.scrape({ url });
        if (result.item) scraped.push(result.item);
      }
      normalizedItems = scraped.length ? scraped : search.items.filter((item) => uniqueUrls.includes(item.url));
    } else {
      const urls = filterAllowedFirecrawlUrls(input.urls?.length ? input.urls : [source.url ?? ""], source).slice(0, pageLimit);
      const uniqueUrls = [...new Set(urls)];
      for (const url of uniqueUrls) {
        const result = await client.scrape({ url });
        if (result.item) normalizedItems.push(result.item);
      }
    }

    const ingested = [];
    for (const item of normalizedItems) {
      if (isBlockedMarketContent(item.markdown ?? item.description ?? item.title)) continue;
      ingested.push(await ingestMarketObject({
        officeId: input.officeId,
        source,
        item: itemFromFirecrawl({ source, item, fetchedAt }),
        strict: input.strict,
      }));
    }

    const objectCount = ingested.filter((result) => result.objectId).length;
    const signalCount = ingested.reduce((sum, result) => sum + result.signals.length, 0);
    const skippedExtractionCount = ingested.filter((result) => "extractionSkipped" in result && result.extractionSkipped).length;
    const reviewCount = ingested.reduce(
      (sum, result) => sum + result.signals.reduce((inner, signal) => inner + (signal.reviews?.length ?? 0), 0),
      0,
    );
    await finishRun({
      officeId: input.officeId,
      runId: run.id,
      status: "succeeded",
      resultCount: normalizedItems.length,
      objectCount,
      signalCount,
      reviewCount,
      metadata: {
        sourceName: source.name,
        fetchedAt: fetchedAt.toISOString(),
        acceptedUrls: normalizedItems.map((item) => item.url),
        skippedExtractionCount,
      },
    });
    return {
      ok: true as const,
      runId: run.id,
      source: { id: source.id, name: source.name, fetchType: source.fetchType, trustLevel: source.trustLevel, sourceCategory: source.sourceCategory },
      resultCount: normalizedItems.length,
      objectCount,
      signalCount,
      reviewCount,
      results: ingested,
    };
  } catch (error) {
    await finishRun({
      officeId: input.officeId,
      runId: run.id,
      status: "failed",
      error: error instanceof Error ? sanitizeFirecrawlProviderMessage(error.message) : sanitizeFirecrawlProviderMessage(String(error)),
    }).catch(() => null);
    if (input.strict) throw error;
    return {
      ok: false as const,
      runId: run.id,
      error: error instanceof Error ? sanitizeFirecrawlProviderMessage(error.message) : sanitizeFirecrawlProviderMessage(String(error)),
    };
  }
}

export function listFirecrawlEnabledMarketSources() {
  return getMarketIntelligenceSourceRegistry()
    .filter((source) => source.enabled && (source.fetchType === "firecrawl_search" || source.fetchType === "firecrawl_scrape"));
}
