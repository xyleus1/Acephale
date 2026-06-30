import { ingestMarketObject, type MarketSourceItem } from "./ingest-market-object";
import {
  getMarketIntelligenceSource,
  getMarketIntelligenceSourceRegistry,
  type MarketIntelligenceSourceDefinition,
} from "./source-registry";

export type IngestMarketSourceInput = {
  officeId: string;
  sourceId?: string | null;
  source?: MarketIntelligenceSourceDefinition | null;
  items?: MarketSourceItem[] | null;
  content?: string | null;
  title?: string | null;
  url?: string | null;
  strict?: boolean;
  limit?: number | null;
};

function compactHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function tag(block: string, name: string) {
  const found = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1];
  return found ? compactHtml(decodeXml(found)) : null;
}

function parseRss(xml: string, source: MarketIntelligenceSourceDefinition, limit: number): MarketSourceItem[] {
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  return blocks.slice(0, limit).map((block, index) => {
    const title = tag(block, "title") ?? `${source.name} item ${index + 1}`;
    const link = tag(block, "link") ?? source.url;
    const description = tag(block, "description") ?? tag(block, "content:encoded") ?? title;
    const guid = tag(block, "guid") ?? link ?? `${source.id}:${index}:${title}`;
    const pubDate = tag(block, "pubDate") ?? tag(block, "updated") ?? null;
    return {
      externalId: guid,
      url: link,
      title,
      content: description,
      publishedAt: pubDate,
    };
  });
}

async function fetchSourceItems(source: MarketIntelligenceSourceDefinition, limit: number): Promise<MarketSourceItem[]> {
  if (source.fetchType === "firecrawl_search" || source.fetchType === "firecrawl_scrape") {
    throw new Error(`Market source ${source.id} uses Firecrawl. Use ingestFirecrawlMarketSource instead of generic source ingestion.`);
  }
  if (!source.url) return [];
  const response = await fetch(source.url, { headers: { "user-agent": "DeryaFreightOS/market-intelligence" } });
  if (!response.ok) throw new Error(`Market source fetch failed for ${source.id}: ${response.status}`);
  const body = await response.text();
  if (source.fetchType === "rss") return parseRss(body, source, limit);
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? source.name;
  return [{
    externalId: source.url,
    url: source.url,
    title: compactHtml(title),
    content: compactHtml(body).slice(0, 12000),
    publishedAt: new Date(),
  }];
}

export async function ingestMarketSource(input: IngestMarketSourceInput) {
  const source = input.source ?? getMarketIntelligenceSource(input.sourceId);
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 10)));
  let items = input.items ?? null;
  if (!items && input.content) {
    items = [{
      externalId: input.url ?? input.title ?? source.id,
      url: input.url ?? source.url,
      title: input.title ?? source.name,
      content: input.content,
      publishedAt: new Date(),
    }];
  }
  if (!items) {
    if (!source.enabled && source.fetchType !== "manual") {
      throw new Error(`Market source ${source.id} is disabled. Pass explicit items/content or enable it in the source registry.`);
    }
    items = await fetchSourceItems(source, limit);
  }

  const results = [];
  for (const item of items.slice(0, limit)) {
    results.push(await ingestMarketObject({ officeId: input.officeId, source, item, strict: input.strict }));
  }
  const signalCount = results.reduce((sum, result) => sum + result.signals.length, 0);
  const linkCount = results.reduce((sum, result) => sum + result.signals.reduce((inner, signal) => inner + signal.links.length, 0), 0);

  return {
    ok: true as const,
    source: { id: source.id, name: source.name, fetchType: source.fetchType, trustLevel: source.trustLevel },
    items: results.length,
    signals: signalCount,
    links: linkCount,
    results,
  };
}

export function listEnabledMarketSources() {
  return getMarketIntelligenceSourceRegistry().filter((source) => source.enabled);
}
