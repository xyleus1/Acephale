import type { FirecrawlClientOptions } from "./firecrawl-client";
import { ingestMarketSourcePreview } from "./market-tools";
import { runScheduledMarketIngestion } from "./scheduled-ingestion";
import { getMarketIntelligenceSource, type MarketIntelligenceSourceDefinition } from "./source-registry";
import { sourceAllowedDomains, validateMarketSourceDefinition } from "./source-policy";

export const SAFE_MANUAL_MARKET_SOURCE_IDS = [
  "maersk-news-advisories",
  "drewry-world-container-index",
  "cbp-csms",
  "port-of-los-angeles-latest-news",
] as const;

export const SAFE_MANUAL_MARKET_BUNDLE_SOURCE_IDS = [
  "maersk-news-advisories",
  "drewry-world-container-index",
  "cbp-csms",
] as const;

export type SafeManualMarketSourceId = typeof SAFE_MANUAL_MARKET_SOURCE_IDS[number];
export type ManualMarketIngestionMode = "preview" | "live";

export type ManualMarketIngestionSummary = {
  ok: boolean;
  mode: ManualMarketIngestionMode;
  sourceId: string;
  sourceName: string;
  message: string;
  runIds: string[];
  candidateUrls: string[];
  researchItemsCreated: number;
  marketSignalsCreated: number;
  marketSignalLinksCreated: number;
  marketImpactReviewsCreated: number;
  extractionSkips: number;
  duplicateOrSkippedCandidates: number;
  providerErrors: string[];
  details?: unknown;
};

export type ManualMarketIngestionValidation = {
  ok: boolean;
  error?: string;
  source?: MarketIntelligenceSourceDefinition;
  allowedDomains?: string[];
};

export type ManualMarketIngestionRuntimeStatus = {
  firecrawlConfigured: boolean;
  manualLiveEnabled: boolean;
  cronEnabled: boolean;
  provider: string;
  maxResultsPerRun: number;
  maxPagesPerRun: number;
  safeSourceCount: number;
  safeBundleSourceIds: string[];
  liveDisabledReason: string | null;
};

export type ManualMarketIngestionBundleSummary = {
  ok: boolean;
  mode: ManualMarketIngestionMode;
  message: string;
  sourceIds: string[];
  summaries: ManualMarketIngestionSummary[];
  researchItemsCreated: number;
  marketSignalsCreated: number;
  marketSignalLinksCreated: number;
  marketImpactReviewsCreated: number;
  extractionSkips: number;
  duplicateOrSkippedCandidates: number;
  providerErrors: string[];
};

function envFlag(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function envInt(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

function normalizeMode(value: string | null | undefined): ManualMarketIngestionMode {
  return value === "live" ? "live" : "preview";
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/firecrawl[_-]?api[_-]?key[=:]\s*[A-Za-z0-9._~+/=-]+/gi, "FIRECRAWL_API_KEY=[redacted]")
    .slice(0, 1000);
}

export function isSafeManualMarketSourceId(sourceId: string): sourceId is SafeManualMarketSourceId {
  return SAFE_MANUAL_MARKET_SOURCE_IDS.includes(sourceId as SafeManualMarketSourceId);
}

export function normalizeManualMarketIngestionMode(value: string | null | undefined) {
  return normalizeMode(value);
}

export function getManualMarketIngestionRuntimeStatus(env: NodeJS.ProcessEnv = process.env): ManualMarketIngestionRuntimeStatus {
  const cronEnabled = envFlag(env.MARKET_INTELLIGENCE_CRON_ENABLED);
  const manualLiveEnabled = envFlag(env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED);
  const firecrawlConfigured = Boolean(env.FIRECRAWL_API_KEY?.trim());
  const liveDisabledReason = cronEnabled
    ? "Scheduled market cron is enabled. Manual ingestion is disabled until cron is off."
    : !manualLiveEnabled
      ? "Live manual ingestion is disabled. Set MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true."
      : !firecrawlConfigured
        ? "FIRECRAWL_API_KEY is not configured."
        : null;
  return {
    firecrawlConfigured,
    manualLiveEnabled,
    cronEnabled,
    provider: env.MARKET_INTELLIGENCE_PROVIDER?.trim() || "firecrawl",
    maxResultsPerRun: Math.min(3, envInt(env.MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN, 3, 100)),
    maxPagesPerRun: Math.min(3, envInt(env.MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN, 3, 100)),
    safeSourceCount: SAFE_MANUAL_MARKET_SOURCE_IDS.length,
    safeBundleSourceIds: [...SAFE_MANUAL_MARKET_BUNDLE_SOURCE_IDS],
    liveDisabledReason,
  };
}

export function validateManualMarketIngestionRequest(input: {
  role: string | null | undefined;
  sourceId: string | null | undefined;
  mode?: string | null;
  env?: NodeJS.ProcessEnv;
}): ManualMarketIngestionValidation {
  const env = input.env ?? process.env;
  const sourceId = String(input.sourceId ?? "").trim();
  const mode = normalizeMode(input.mode);
  if (input.role !== "ADMIN") return { ok: false, error: "Only ADMIN users can run manual market ingestion." };
  if (!sourceId) return { ok: false, error: "Select a market source first." };
  if (!isSafeManualMarketSourceId(sourceId)) {
    return { ok: false, error: `Source ${sourceId} is not in the manual ingestion allowlist.` };
  }

  const source = getMarketIntelligenceSource(sourceId);
  const allowedDomains = sourceAllowedDomains(source);
  const policy = validateMarketSourceDefinition(source);
  if (!policy.ok) return { ok: false, error: `Source policy failed: ${policy.issues.join(", ")}`, source, allowedDomains };
  if (source.sourceCategory === "media" || source.id.includes("freightwaves") || source.id.includes("journal-of-commerce") || source.id.includes("joc")) {
    return { ok: false, error: "Media and broad context sources are blocked for manual production ingestion.", source, allowedDomains };
  }
  if (source.fetchType !== "firecrawl_search" && source.fetchType !== "firecrawl_scrape") {
    return { ok: false, error: `Source ${source.id} is ${source.fetchType}; manual ingestion only supports Firecrawl sources.`, source, allowedDomains };
  }
  if (allowedDomains.length === 0) return { ok: false, error: "Source has no allowed domains. Broad crawls are blocked.", source, allowedDomains };
  if (envFlag(env.MARKET_INTELLIGENCE_CRON_ENABLED)) {
    return { ok: false, error: "Scheduled market cron is enabled. Manual ingestion refuses to run until cron is disabled.", source, allowedDomains };
  }
  if (mode === "live" && !envFlag(env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED)) {
    return { ok: false, error: "MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED must be true for live manual ingestion.", source, allowedDomains };
  }
  if (!env.FIRECRAWL_API_KEY?.trim() && mode === "live") {
    return { ok: false, error: "FIRECRAWL_API_KEY is not configured.", source, allowedDomains };
  }
  return { ok: true, source, allowedDomains };
}

function countLinks(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const rows = "results" in result && Array.isArray((result as { results?: unknown[] }).results)
    ? (result as { results: unknown[] }).results
    : [];
  return rows.reduce<number>((sum, row) => {
    const signals = row && typeof row === "object" && "signals" in row && Array.isArray((row as { signals?: unknown[] }).signals)
      ? (row as { signals: unknown[] }).signals
      : [];
    return sum + signals.reduce<number>((inner, signal) => {
      if (!signal || typeof signal !== "object") return inner;
      const links = "links" in signal && Array.isArray((signal as { links?: unknown[] }).links)
        ? (signal as { links: unknown[] }).links.length
        : 0;
      return inner + links;
    }, 0);
  }, 0);
}

function countExtractionSkips(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const rows = "results" in result && Array.isArray((result as { results?: unknown[] }).results)
    ? (result as { results: unknown[] }).results
    : [];
  return rows.filter((row) => row && typeof row === "object" && "extractionSkipped" in row && (row as { extractionSkipped?: boolean }).extractionSkipped).length;
}

function summarizeLiveResult(source: MarketIntelligenceSourceDefinition, result: Awaited<ReturnType<typeof runScheduledMarketIngestion>>): ManualMarketIngestionSummary {
  const runIds: string[] = [];
  const providerErrors: string[] = [];
  let researchItemsCreated = 0;
  let marketSignalsCreated = 0;
  let marketImpactReviewsCreated = 0;
  let marketSignalLinksCreated = 0;
  let extractionSkips = 0;

  for (const row of result.results) {
    const nested = "result" in row ? row.result : null;
    if (nested && typeof nested === "object" && "runId" in nested && typeof nested.runId === "string") runIds.push(nested.runId);
    if (nested && typeof nested === "object" && "objectCount" in nested && typeof nested.objectCount === "number") researchItemsCreated += nested.objectCount;
    if (nested && typeof nested === "object" && "signalCount" in nested && typeof nested.signalCount === "number") marketSignalsCreated += nested.signalCount;
    if (nested && typeof nested === "object" && "reviewCount" in nested && typeof nested.reviewCount === "number") marketImpactReviewsCreated += nested.reviewCount;
    if (nested && typeof nested === "object") {
      marketSignalLinksCreated += countLinks(nested);
      extractionSkips += countExtractionSkips(nested);
      if ("error" in nested && typeof nested.error === "string") providerErrors.push(nested.error);
    }
    if ("reason" in row && typeof row.reason === "string") providerErrors.push(row.reason);
  }

  return {
    ok: result.ok,
    mode: "live",
    sourceId: source.id,
    sourceName: source.name,
    message: result.ok ? "Manual market ingestion completed." : "Manual market ingestion completed with errors.",
    runIds,
    candidateUrls: [],
    researchItemsCreated,
    marketSignalsCreated,
    marketSignalLinksCreated,
    marketImpactReviewsCreated,
    extractionSkips,
    duplicateOrSkippedCandidates: 0,
    providerErrors: [...new Set(providerErrors.map(safeError))],
    details: result,
  };
}

export async function runManualMarketIngestion(input: {
  officeId: string;
  role: string;
  sourceId: string;
  mode?: string | null;
  clientOptions?: FirecrawlClientOptions;
}): Promise<ManualMarketIngestionSummary> {
  const mode = normalizeMode(input.mode);
  const validation = validateManualMarketIngestionRequest({ role: input.role, sourceId: input.sourceId, mode });
  if (!validation.ok || !validation.source) {
    return {
      ok: false,
      mode,
      sourceId: input.sourceId,
      sourceName: input.sourceId,
      message: validation.error ?? "Manual market ingestion request was rejected.",
      runIds: [],
      candidateUrls: [],
      researchItemsCreated: 0,
      marketSignalsCreated: 0,
      marketSignalLinksCreated: 0,
      marketImpactReviewsCreated: 0,
      extractionSkips: 0,
      duplicateOrSkippedCandidates: 0,
      providerErrors: validation.error ? [validation.error] : [],
    };
  }

  if (mode === "preview") {
    const preview = await ingestMarketSourcePreview({ sourceId: validation.source.id, limit: 3 });
    const candidateUrls = "items" in preview && Array.isArray(preview.items)
      ? preview.items.map((item) => item.url).filter(Boolean)
      : "item" in preview && preview.item?.url
        ? [preview.item.url]
        : [];
    return {
      ok: preview.ok,
      mode,
      sourceId: validation.source.id,
      sourceName: validation.source.name,
      message: preview.ok ? "Preview completed. No records were written." : "Preview failed.",
      runIds: [],
      candidateUrls,
      researchItemsCreated: 0,
      marketSignalsCreated: 0,
      marketSignalLinksCreated: 0,
      marketImpactReviewsCreated: 0,
      extractionSkips: 0,
      duplicateOrSkippedCandidates: "items" in preview && Array.isArray(preview.items) ? preview.items.filter((item) => !item.allowed).length : 0,
      providerErrors: preview.ok ? [] : ["error" in preview ? String(preview.error) : "Preview failed."],
      details: preview,
    };
  }

  const result = await runScheduledMarketIngestion({
    officeId: input.officeId,
    sourceIds: [validation.source.id],
    maxSources: 1,
    maxPagesPerRun: 3,
    dailyCreditBudget: 3,
    dryRun: false,
    force: true,
    allowDisabled: true,
    clientOptions: input.clientOptions,
  });
  return summarizeLiveResult(validation.source, result);
}

function summarizeBundle(mode: ManualMarketIngestionMode, summaries: ManualMarketIngestionSummary[]): ManualMarketIngestionBundleSummary {
  const providerErrors = summaries.flatMap((summary) => summary.providerErrors);
  const ok = summaries.every((summary) => summary.ok);
  return {
    ok,
    mode,
    message: ok
      ? "Safe market ingestion bundle completed."
      : "Safe market ingestion bundle completed with blocked or failed sources.",
    sourceIds: [...SAFE_MANUAL_MARKET_BUNDLE_SOURCE_IDS],
    summaries,
    researchItemsCreated: summaries.reduce((sum, summary) => sum + summary.researchItemsCreated, 0),
    marketSignalsCreated: summaries.reduce((sum, summary) => sum + summary.marketSignalsCreated, 0),
    marketSignalLinksCreated: summaries.reduce((sum, summary) => sum + summary.marketSignalLinksCreated, 0),
    marketImpactReviewsCreated: summaries.reduce((sum, summary) => sum + summary.marketImpactReviewsCreated, 0),
    extractionSkips: summaries.reduce((sum, summary) => sum + summary.extractionSkips, 0),
    duplicateOrSkippedCandidates: summaries.reduce((sum, summary) => sum + summary.duplicateOrSkippedCandidates, 0),
    providerErrors: [...new Set(providerErrors.map(safeError))],
  };
}

export async function runSafeMarketIngestionBundle(input: {
  officeId: string;
  role: string;
  mode?: string | null;
  clientOptions?: FirecrawlClientOptions;
}): Promise<ManualMarketIngestionBundleSummary> {
  const mode = normalizeMode(input.mode);
  const summaries: ManualMarketIngestionSummary[] = [];
  for (const sourceId of SAFE_MANUAL_MARKET_BUNDLE_SOURCE_IDS) {
    summaries.push(await runManualMarketIngestion({
      officeId: input.officeId,
      role: input.role,
      sourceId,
      mode,
      clientOptions: input.clientOptions,
    }));
  }
  return summarizeBundle(mode, summaries);
}
