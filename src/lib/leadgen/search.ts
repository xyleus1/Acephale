// Search providers share one normalizer so HTML, Serper, and JSONL results
// receive identical engine and non-lead filtering.

import { readFile } from "node:fs/promises";
import { registrableDomain } from "./extract";
import { checkPublicUrl, guardedRequest } from "./fetch-guard";

export type SearchEngine = "brave" | "duckduckgo" | "bing" | "serper" | "jsonl" | "openai";
export type SearchProviderName = "html" | "serper" | "jsonl" | "openai";

export type SearchHit = {
  url: string;
  domain: string;
  engine: SearchEngine;
  rank: number;
  provider?: SearchProviderName;
  sourceUrl?: string;
  title?: string;
  snippet?: string;
};

export type SearchProviderOptions = {
  offset?: number;
  signal?: AbortSignal;
  maxPagesRemaining?: number;
};

export type SearchProviderResult = {
  hits: SearchHit[];
  pagesFetched: number;
  providersUsed: string[];
};

export type SearchProvider = {
  name: string;
  search(query: string, options?: SearchProviderOptions): Promise<SearchHit[]>;
  searchWithStats?: (
    query: string,
    options?: SearchProviderOptions,
  ) => Promise<SearchProviderResult>;
};

const ENGINE_HOSTS: Record<"brave" | "duckduckgo" | "bing", readonly string[]> = {
  brave: ["brave.com", "search.brave.com"],
  duckduckgo: ["duckduckgo.com", "duck.com"],
  bing: ["bing.com", "microsoft.com", "msn.com"],
};

const NON_LEAD_HOSTS = [
  "google.", "youtube.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "pinterest.", "tiktok.com", "wikipedia.org", "sahibinden.com",
  "hepsiburada.com", "trendyol.com", "n11.com", "armut.com", "gittigidiyor.com",
  "amazon.", "alibaba.com", "indeed.com", "kariyer.net", "yenibiris.com", "apple.com",
  "play.google.com", "wordpress.org", "blogspot.com", "medium.com", "reddit.com",
];

export function isNonLeadHost(host: string) {
  return NON_LEAD_HOSTS.some((blocked) =>
    blocked.endsWith(".")
      ? host === blocked.slice(0, -1) || host.startsWith(blocked) || host.includes(`.${blocked}`)
      : host === blocked || host.endsWith(`.${blocked}`),
  );
}

const DUCKDUCKGO_REDIRECT = /^https?:\/\/(?:duckduckgo\.com|links\.duckduckgo\.com)\/l\/\?uddg=([^&]+)/i;

function normalizeHit(rawUrl: string, engine: SearchEngine, rank: number, metadata: Pick<SearchHit, "title" | "snippet"> = {}) {
  let raw = rawUrl.trim();
  const redirect = DUCKDUCKGO_REDIRECT.exec(raw);
  if (redirect?.[1]) {
    try {
      raw = decodeURIComponent(redirect[1]);
    } catch {
      return null;
    }
  }
  if (!/^https?:\/\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  url.hash = "";
  const host = url.hostname.toLowerCase();
  if (engine !== "serper" && engine !== "jsonl" && engine !== "openai"
    && ENGINE_HOSTS[engine].some((engineHost) => host.endsWith(engineHost))) return null;
  if (isNonLeadHost(host)) return null;
  return { url: url.toString(), domain: registrableDomain(host), engine, rank, ...metadata };
}

export function parseSearchResults(html: string, engine: Exclude<SearchEngine, "serper" | "jsonl" | "openai">): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const hit = normalizeHit(match[1] ?? "", engine, hits.length + 1);
    if (!hit || seen.has(hit.url)) continue;
    seen.add(hit.url);
    hits.push(hit);
  }
  return hits;
}

export type SerperOrganicResult = {
  link?: string;
  title?: string;
  snippet?: string;
  position?: number;
};

export function parseSerperResults(payload: unknown): SearchHit[] {
  if (!payload || typeof payload !== "object") return [];
  const organic = (payload as { organic?: unknown }).organic;
  if (!Array.isArray(organic)) return [];
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const [index, result] of organic.entries()) {
    if (!result || typeof result !== "object") continue;
    const item = result as SerperOrganicResult;
    const hit = normalizeHit(
      item.link ?? "",
      "serper",
      Number.isFinite(item.position) ? item.position! : index + 1,
      { title: item.title, snippet: item.snippet },
    );
    if (!hit || seen.has(hit.url)) continue;
    seen.add(hit.url);
    hits.push(hit);
  }
  return hits.sort((a, b) => a.rank - b.rank);
}

export function parseJsonlResults(jsonl: string, query: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const item = value as { query?: unknown; url?: unknown; rank?: unknown };
    if (item.query !== query || typeof item.url !== "string") continue;
    const rank = typeof item.rank === "number" && Number.isFinite(item.rank) ? item.rank : hits.length + 1;
    const hit = normalizeHit(item.url, "jsonl", rank);
    if (!hit || seen.has(hit.url)) continue;
    seen.add(hit.url);
    hits.push(hit);
  }
  return hits.sort((a, b) => a.rank - b.rank);
}

export function searchUrl(engine: Exclude<SearchEngine, "serper" | "jsonl" | "openai">, query: string, offset = 0) {
  const encoded = encodeURIComponent(query);
  if (engine === "brave") return `https://search.brave.com/search?q=${encoded}&offset=${offset}`;
  if (engine === "duckduckgo") return `https://html.duckduckgo.com/html/?q=${encoded}`;
  return `https://www.bing.com/search?q=${encoded}&first=${offset * 10 + 1}&setlang=tr`;
}

async function defaultHtmlFetch(url: string, signal?: AbortSignal) {
  const check = await checkPublicUrl(url);
  if (!check.ok) return null;
  try {
    const response = await guardedRequest(check.url, { signal, headers: { accept: "text/html" } });
    return response.status === 200 ? response.body.toString("utf8") : null;
  } catch {
    return null;
  }
}

export function createHtmlSearchProvider(options: {
  engine?: Exclude<SearchEngine, "serper" | "jsonl" | "openai">;
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<string | null>;
} = {}): SearchProvider {
  const engine = options.engine ?? "duckduckgo";
  const fetchPage = options.fetchPage ?? defaultHtmlFetch;
  const searchWithStats = async (query: string, providerOptions?: SearchProviderOptions): Promise<SearchProviderResult> => {
    const html = await fetchPage(searchUrl(engine, query, providerOptions?.offset ?? 0), providerOptions?.signal);
    return {
      hits: html ? parseSearchResults(html, engine).map((hit) => ({ ...hit, provider: "html" as const })) : [],
      pagesFetched: 1,
      providersUsed: [`html:${engine}`],
    };
  };
  return {
    name: "html",
    search: async (query, providerOptions) => (await searchWithStats(query, providerOptions)).hits,
    searchWithStats,
  };
}

export function createSerperSearchProvider(apiKey = process.env.SERPER_API_KEY): SearchProvider {
  const searchWithStats = async (query: string, options?: SearchProviderOptions): Promise<SearchProviderResult> => {
    if (!apiKey) return { hits: [], pagesFetched: 0, providersUsed: [] };
    const check = await checkPublicUrl("https://google.serper.dev/search");
    if (!check.ok) return { hits: [], pagesFetched: 0, providersUsed: [] };
    try {
      const response = await guardedRequest(check.url, {
        method: "POST",
        signal: options?.signal,
        headers: { accept: "application/json", "content-type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({ q: query, page: (options?.offset ?? 0) + 1 }),
      });
      if (response.status !== 200) return { hits: [], pagesFetched: 1, providersUsed: ["serper"] };
      return {
        hits: parseSerperResults(JSON.parse(response.body.toString("utf8"))).map((hit) => ({
          ...hit,
          provider: "serper" as const,
        })),
        pagesFetched: 1,
        providersUsed: ["serper"],
      };
    } catch {
      return { hits: [], pagesFetched: 1, providersUsed: ["serper"] };
    }
  };
  return {
    name: "serper",
    search: async (query, options) => (await searchWithStats(query, options)).hits,
    searchWithStats,
  };
}

export function createJsonlSearchProvider(filePath: string): SearchProvider {
  let contents: Promise<string> | undefined;
  return {
    name: "jsonl",
    async search(query) {
      const result = await this.searchWithStats!(query);
      return result.hits;
    },
    async searchWithStats(query) {
      contents ??= readFile(filePath, "utf8");
      try {
        return {
          hits: parseJsonlResults(await contents, query).map((hit) => ({ ...hit, provider: "jsonl" as const })),
          pagesFetched: 0,
          providersUsed: ["jsonl"],
        };
      } catch {
        return { hits: [], pagesFetched: 0, providersUsed: ["jsonl"] };
      }
    },
  };
}

export function createCascadingSearchProvider(options: {
  freeEngines?: readonly Exclude<SearchEngine, "serper" | "jsonl" | "openai">[];
  threshold?: number;
  serperFallbackThreshold?: number;
  serperApiKey?: string;
  serperProvider?: SearchProvider;
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<string | null>;
} = {}): SearchProvider {
  const freeEngines = options.freeEngines ?? ["duckduckgo", "brave", "bing"];
  const fallbackThreshold = Math.max(0, Math.floor(options.threshold ?? options.serperFallbackThreshold ?? 3));
  const serperApiKey = options.serperApiKey ?? process.env.SERPER_API_KEY;
  const searchWithStats = async (query: string, providerOptions?: SearchProviderOptions): Promise<SearchProviderResult> => {
    let pagesFetched = 0;
    const providersUsed: string[] = [];
    const hits: SearchHit[] = [];
    const maxPages = providerOptions?.maxPagesRemaining;
    if (serperApiKey && !(maxPages !== undefined && pagesFetched >= maxPages)) {
      const serper = options.serperProvider ?? createSerperSearchProvider(serperApiKey);
      const result = serper.searchWithStats
        ? await serper.searchWithStats(query, providerOptions)
        : { hits: await serper.search(query, providerOptions), pagesFetched: 1, providersUsed: ["serper"] };
      pagesFetched += result.pagesFetched;
      providersUsed.push(...result.providersUsed);
      hits.push(...result.hits);
      if (
        dedupeByDomain(hits).length >= fallbackThreshold
        || (maxPages !== undefined && pagesFetched >= maxPages)
      ) {
        return { hits, pagesFetched, providersUsed };
      }
    }

    for (const engine of freeEngines) {
      if (maxPages !== undefined && pagesFetched >= maxPages) break;
      const provider = createHtmlSearchProvider({ engine, fetchPage: options.fetchPage });
      const result = provider.searchWithStats
        ? await provider.searchWithStats(query, providerOptions)
        : { hits: await provider.search(query, providerOptions), pagesFetched: 1, providersUsed: [`html:${engine}`] };
      pagesFetched += result.pagesFetched;
      providersUsed.push(...result.providersUsed);
      hits.push(...result.hits);
      if (dedupeByDomain(hits).length >= fallbackThreshold) break;
    }

    return { hits, pagesFetched, providersUsed };
  };
  return {
    name: "cascade",
    search: async (query, providerOptions) => (await searchWithStats(query, providerOptions)).hits,
    searchWithStats,
  };
}

export function createSearchProvider(
  providerName: SearchProviderName,
  options: { htmlEngine?: Exclude<SearchEngine, "serper" | "jsonl" | "openai">; jsonlPath?: string } = {},
): SearchProvider {
  if (providerName === "serper") return createSerperSearchProvider();
  if (providerName === "jsonl") return createJsonlSearchProvider(options.jsonlPath ?? "");
  if (providerName === "openai") throw new Error("OpenAI search requires a leadgen profile.");
  return createHtmlSearchProvider({ engine: options.htmlEngine });
}

export function selectSearchProvider(options: {
  provider?: SearchProvider;
  providerName?: SearchProviderName;
  htmlEngine?: Exclude<SearchEngine, "serper" | "jsonl" | "openai">;
  jsonlPath?: string;
} = {}): SearchProvider {
  if (options.provider) return options.provider;
  if (options.providerName === "jsonl") {
    return options.jsonlPath ? createJsonlSearchProvider(options.jsonlPath) : createJsonlSearchProvider("");
  }
  if (options.providerName === "serper") return createSerperSearchProvider();
  if (options.providerName === "openai") throw new Error("OpenAI search requires a leadgen profile.");
  if (options.providerName === "html") return createHtmlSearchProvider({ engine: options.htmlEngine });
  return createCascadingSearchProvider({ serperApiKey: process.env.SERPER_API_KEY });
}

export const getSearchProvider = selectSearchProvider;

/** Collapse hits to one entry per registrable domain, keeping the best rank. */
export function dedupeByDomain(hits: readonly SearchHit[]) {
  const best = new Map<string, SearchHit>();
  for (const hit of hits) {
    const current = best.get(hit.domain);
    if (!current || hit.rank < current.rank) best.set(hit.domain, hit);
  }
  return [...best.values()].sort((a, b) => a.rank - b.rank);
}
