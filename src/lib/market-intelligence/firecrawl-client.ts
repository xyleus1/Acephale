export type FirecrawlNormalizedItem = {
  url: string;
  title: string;
  description: string | null;
  markdown: string | null;
  publishedAt: string | null;
  source: "search" | "scrape";
  metadata: Record<string, unknown>;
};

export type FirecrawlSearchInput = {
  query: string;
  limit?: number | null;
  includeDomains?: string[] | null;
  timeoutMs?: number | null;
  scrapeResults?: boolean;
};

export type FirecrawlScrapeInput = {
  url: string;
  timeoutMs?: number | null;
};

export type FirecrawlClientOptions = {
  apiKey?: string | null;
  baseUrl?: string | null;
  timeoutMs?: number | null;
  maxResultsPerRun?: number | null;
  maxPagesPerRun?: number | null;
  fetchImpl?: typeof fetch;
};

type FirecrawlResult = {
  success?: boolean;
  data?: unknown;
  warning?: string | null;
  id?: string | null;
  creditsUsed?: number | null;
  error?: string | null;
};

export function sanitizeFirecrawlProviderMessage(message: string) {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  let sanitized = message;
  if (apiKey) sanitized = sanitized.replaceAll(apiKey, "[redacted]");
  return sanitized
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/firecrawl[_-]?api[_-]?key[=:]\s*[A-Za-z0-9._~+/=-]+/gi, "FIRECRAWL_API_KEY=[redacted]");
}

function cleanDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

function compact(value: unknown, fallback = "") {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
}

function dateString(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function clamp(value: number | null | undefined, fallback: number, max: number) {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(max, Math.floor(raw)));
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timeout) };
}

function firecrawlScrapeOptions() {
  const onlyCleanContent = process.env.MARKET_INTELLIGENCE_FIRECRAWL_CLEAN_CONTENT === "true";
  return {
    formats: ["markdown"],
    onlyMainContent: true,
    removeBase64Images: true,
    blockAds: true,
    excludeTags: ["nav", "footer", "header", "aside", "script", "style", "form"],
    ...(onlyCleanContent ? { onlyCleanContent: true } : {}),
  };
}

function normalizeItem(value: unknown, source: "search" | "scrape"): FirecrawlNormalizedItem | null {
  const row = asRecord(value);
  const metadata = asRecord(row.metadata);
  const url = cleanUrl(row.url) || cleanUrl(metadata.sourceURL) || cleanUrl(metadata.url);
  if (!url) return null;
  const title = compact(row.title)
    || compact(metadata.title)
    || compact(row.description)
    || url;
  const description = compact(row.description) || compact(row.snippet) || compact(metadata.description) || null;
  const markdown = compact(row.markdown) || compact(row.summary) || null;
  return {
    url,
    title,
    description,
    markdown,
    publishedAt: dateString(row.date) ?? dateString(metadata.publishedTime) ?? dateString(metadata.articlePublishedTime),
    source,
    metadata: {
      ...metadata,
      category: row.category ?? null,
      warning: row.warning ?? null,
      position: row.position ?? null,
      statusCode: metadata.statusCode ?? null,
      contentType: metadata.contentType ?? null,
    },
  };
}

export function normalizeFirecrawlSearchResponse(value: unknown) {
  const body = asRecord(value);
  const data = asRecord(body.data);
  const buckets = ["web", "news", "research"].flatMap((key) => asArray(data[key]));
  const seen = new Set<string>();
  const items = buckets.flatMap((item) => {
    const normalized = normalizeItem(item, "search");
    if (!normalized || seen.has(normalized.url)) return [];
    seen.add(normalized.url);
    return [normalized];
  });
  return {
    success: body.success === true,
    id: typeof body.id === "string" ? body.id : null,
    warning: typeof body.warning === "string" ? body.warning : null,
    creditsUsed: typeof body.creditsUsed === "number" ? body.creditsUsed : null,
    items,
  };
}

export function normalizeFirecrawlScrapeResponse(value: unknown) {
  const body = asRecord(value);
  const data = asRecord(body.data);
  const normalized = normalizeItem(data, "scrape");
  return {
    success: body.success === true,
    warning: typeof body.warning === "string" ? body.warning : null,
    creditsUsed: typeof body.creditsUsed === "number" ? body.creditsUsed : null,
    item: normalized,
  };
}

export class FirecrawlClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResultsPerRun: number;
  private readonly maxPagesPerRun: number;

  constructor(options: FirecrawlClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.FIRECRAWL_API_KEY ?? "";
    this.baseUrl = (options.baseUrl ?? process.env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev/v2").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = clamp(options.timeoutMs ?? Number(process.env.MARKET_INTELLIGENCE_FIRECRAWL_TIMEOUT_MS), 60_000, 120_000);
    this.maxResultsPerRun = clamp(options.maxResultsPerRun ?? Number(process.env.MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN), 10, 100);
    this.maxPagesPerRun = clamp(options.maxPagesPerRun ?? Number(process.env.MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN), 20, 100);
  }

  private headers() {
    if (!this.apiKey) throw new Error("FIRECRAWL_API_KEY is not configured.");
    return {
      "authorization": `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
  }

  private async post(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<FirecrawlResult> {
    const { signal, done } = timeoutSignal(timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const parsed = asRecord(json);
        const message = typeof parsed.error === "string" ? parsed.error : `Firecrawl request failed with HTTP ${response.status}`;
        throw new Error(sanitizeFirecrawlProviderMessage(message));
      }
      return json as FirecrawlResult;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Firecrawl request timed out.");
      }
      throw error instanceof Error
        ? new Error(sanitizeFirecrawlProviderMessage(error.message))
        : new Error(sanitizeFirecrawlProviderMessage(String(error)));
    } finally {
      done();
    }
  }

  async search(input: FirecrawlSearchInput) {
    const query = input.query.trim();
    if (!query) throw new Error("Firecrawl search query is required.");
    const includeDomains = [...new Set((input.includeDomains ?? []).map(cleanDomain).filter(Boolean))];
    if (includeDomains.length === 0) {
      throw new Error("Firecrawl search requires includeDomains. Broad web search is blocked.");
    }
    const limit = clamp(input.limit, 10, this.maxResultsPerRun);
    const timeoutMs = clamp(input.timeoutMs, this.timeoutMs, 120_000);
    const response = await this.post("/search", {
      query,
      limit,
      sources: ["web"],
      includeDomains,
      timeout: timeoutMs,
      ignoreInvalidURLs: true,
      scrapeOptions: input.scrapeResults ? firecrawlScrapeOptions() : undefined,
    }, timeoutMs);
    return normalizeFirecrawlSearchResponse(response);
  }

  async scrape(input: FirecrawlScrapeInput) {
    const url = cleanUrl(input.url);
    if (!url) throw new Error("Valid Firecrawl scrape URL is required.");
    const timeoutMs = clamp(input.timeoutMs, this.timeoutMs, 120_000);
    const response = await this.post("/scrape", {
      url,
      ...firecrawlScrapeOptions(),
      timeout: timeoutMs,
    }, timeoutMs);
    return normalizeFirecrawlScrapeResponse(response);
  }

  pageBudget(limit?: number | null) {
    return clamp(limit, this.maxPagesPerRun, this.maxPagesPerRun);
  }
}
