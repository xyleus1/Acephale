import { ingestFirecrawlMarketSource } from "./ingest-firecrawl-source";
import { prisma } from "@/lib/prisma";
import {
  getMarketIntelligenceSourceRegistry,
  type MarketIntelligenceSourceDefinition,
} from "./source-registry";
import { sourceAllowedDomains, sourceRunLimits, validateMarketSourceDefinition } from "./source-policy";
import type { FirecrawlClientOptions } from "./firecrawl-client";
import { listSourceQualitySummaries } from "./source-quality";

export const SAFE_SCHEDULED_MARKET_SOURCE_IDS = [
  "maersk-news-advisories",
  "drewry-world-container-index",
  "cbp-csms",
  "port-of-los-angeles-latest-news",
] as const;

export type ScheduledMarketIngestionInput = {
  officeId: string;
  dryRun?: boolean;
  force?: boolean;
  allowDisabled?: boolean;
  sourceIds?: string[];
  maxSources?: number | null;
  maxPagesPerRun?: number | null;
  dailyCreditBudget?: number | null;
  sources?: MarketIntelligenceSourceDefinition[];
  clientOptions?: FirecrawlClientOptions;
};

function envBool(value: string | undefined, fallback = false) {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function envInt(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

function clamp(value: number | null | undefined, fallback: number, max: number) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export function marketIngestionProviderConfigured() {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

export function scheduledMarketIngestionConfig(input: Partial<ScheduledMarketIngestionInput> = {}) {
  const maxSources = clamp(
    input.maxSources,
    envInt(process.env.MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN, 1, 4),
    4,
  );
  const maxPagesPerRun = clamp(
    input.maxPagesPerRun,
    envInt(process.env.MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN, 3, 25),
    25,
  );
  const dailyCreditBudget = clamp(
    input.dailyCreditBudget,
    envInt(process.env.MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET, 25, 200),
    200,
  );
  return {
    cronEnabled: envBool(process.env.MARKET_INTELLIGENCE_CRON_ENABLED, false),
    liveIngestionEnabled: envBool(process.env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED, false),
    provider: process.env.MARKET_INTELLIGENCE_PROVIDER?.trim() || "firecrawl",
    providerConfigured: marketIngestionProviderConfigured(),
    maxSources,
    maxPagesPerRun,
    dailyCreditBudget,
  };
}

async function eligibleSources(input: ScheduledMarketIngestionInput, config: ReturnType<typeof scheduledMarketIngestionConfig>) {
  const registry = input.sources ?? getMarketIntelligenceSourceRegistry();
  const requested = new Set((input.sourceIds ?? []).map((id) => id.trim()).filter(Boolean));
  const applySafeRotation = !input.sources;
  const quality = applySafeRotation ? await listSourceQualitySummaries({ officeId: input.officeId }).catch(() => []) : [];
  const qualityById = new Map(quality.map((item) => [item.sourceId, item]));
  const lastRunBySource = new Map<string, Date>();
  if (applySafeRotation) {
    const runs = await prisma.marketIngestionRun.findMany({
      where: { officeId: input.officeId, sourceId: { in: [...SAFE_SCHEDULED_MARKET_SOURCE_IDS] } },
      orderBy: { createdAt: "desc" },
      select: { sourceId: true, createdAt: true },
      take: 100,
    }).catch(() => []);
    for (const run of runs) {
      if (run.sourceId && !lastRunBySource.has(run.sourceId)) lastRunBySource.set(run.sourceId, run.createdAt);
    }
  }
  return registry
    .filter((source) => source.fetchType === "firecrawl_search" || source.fetchType === "firecrawl_scrape")
    .filter((source) => requested.size === 0 || requested.has(source.id))
    .filter((source) => !applySafeRotation || SAFE_SCHEDULED_MARKET_SOURCE_IDS.includes(source.id as typeof SAFE_SCHEDULED_MARKET_SOURCE_IDS[number]))
    .filter((source) => applySafeRotation || input.allowDisabled || source.enabled)
    .filter((source) => validateMarketSourceDefinition(source).ok)
    .filter((source) => {
      if (!applySafeRotation) return true;
      const summary = qualityById.get(source.id);
      if (!summary) return true;
      if (summary.scoreBand === "poor") return false;
      return summary.wrongLinkFeedbackCount + summary.irrelevantFeedbackCount < 5;
    })
    .sort((a, b) => {
      if (!applySafeRotation) return 0;
      const aLast = lastRunBySource.get(a.id)?.getTime() ?? 0;
      const bLast = lastRunBySource.get(b.id)?.getTime() ?? 0;
      if (aLast !== bLast) return aLast - bLast;
      return SAFE_SCHEDULED_MARKET_SOURCE_IDS.indexOf(a.id as typeof SAFE_SCHEDULED_MARKET_SOURCE_IDS[number])
        - SAFE_SCHEDULED_MARKET_SOURCE_IDS.indexOf(b.id as typeof SAFE_SCHEDULED_MARKET_SOURCE_IDS[number]);
    })
    .slice(0, config.maxSources);
}

export async function getScheduledMarketAutomationStatus(officeId: string) {
  const config = scheduledMarketIngestionConfig();
  const registry = getMarketIntelligenceSourceRegistry();
  const safeSources = registry
    .filter((source) => SAFE_SCHEDULED_MARKET_SOURCE_IDS.includes(source.id as typeof SAFE_SCHEDULED_MARKET_SOURCE_IDS[number]))
    .map((source) => ({ id: source.id, name: source.name, enabled: source.enabled, sourceCategory: source.sourceCategory }));
  const lastRun = await prisma.marketIngestionRun.findFirst({
    where: { officeId, sourceId: { in: [...SAFE_SCHEDULED_MARKET_SOURCE_IDS] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, sourceId: true, status: true, createdAt: true, objectCount: true, signalCount: true, reviewCount: true },
  }).catch(() => null);
  const eligible = await eligibleSources({ officeId, dryRun: true, allowDisabled: true, maxSources: 1 }, config);
  return {
    config,
    scheduleUtc: "0 11 * * *",
    safeSources,
    lastRun,
    nextRecommendedSource: eligible[0] ? { id: eligible[0].id, name: eligible[0].name } : null,
  };
}

export async function runScheduledMarketIngestion(input: ScheduledMarketIngestionInput) {
  const baseConfig = scheduledMarketIngestionConfig(input);
  const config = {
    ...baseConfig,
    providerConfigured: baseConfig.providerConfigured || Boolean(input.clientOptions?.apiKey?.trim()),
  };
  const dryRun = input.dryRun === true;
  const hasMockFetch = Boolean(input.clientOptions?.fetchImpl);
  if (!input.officeId) throw new Error("officeId is required for scheduled market ingestion.");
  if (!config.cronEnabled && !input.force && !dryRun) {
    return {
      ok: true as const,
      dryRun,
      skipped: true,
      reason: "MARKET_INTELLIGENCE_CRON_ENABLED is not true.",
      config,
      sources: [],
      results: [],
    };
  }
  if (!config.liveIngestionEnabled && !dryRun && !hasMockFetch) {
    return {
      ok: true as const,
      dryRun,
      skipped: true,
      reason: "MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED is not true.",
      config,
      sources: [],
      results: [],
    };
  }

  const sources = await eligibleSources(input, config);
  let remainingPageBudget = config.dailyCreditBudget;
  const results = [];
  for (const source of sources) {
    const limits = sourceRunLimits(source);
    const pageBudget = Math.max(1, Math.min(source.maxPagesPerRun, limits.maxPages, config.maxPagesPerRun, remainingPageBudget));
    const policy = validateMarketSourceDefinition(source);
    const summary = {
      sourceId: source.id,
      name: source.name,
      fetchType: source.fetchType,
      trustLevel: source.trustLevel,
      sourceCategory: source.sourceCategory,
      allowedDomains: sourceAllowedDomains(source),
      estimatedPages: pageBudget,
      policy,
    };
    if (dryRun) {
      results.push({ ...summary, status: "preview" as const, wouldRun: true });
      remainingPageBudget -= pageBudget;
      continue;
    }
    if (!config.providerConfigured) {
      results.push({ ...summary, status: "skipped" as const, reason: "FIRECRAWL_API_KEY is not configured." });
      continue;
    }
    const result = await ingestFirecrawlMarketSource({
      officeId: input.officeId,
      source,
      query: !source.enabled && input.allowDisabled ? source.name : undefined,
      limit: pageBudget,
      strict: false,
      clientOptions: input.clientOptions,
    });
    results.push({ ...summary, status: result.ok ? "succeeded" as const : "failed" as const, result });
    remainingPageBudget -= pageBudget;
    if (remainingPageBudget <= 0) break;
  }

  return {
    ok: results.every((result) => result.status !== "failed"),
    dryRun,
    skipped: false,
    config,
    sources: sources.map((source) => ({ id: source.id, name: source.name, enabled: source.enabled })),
    results,
  };
}
