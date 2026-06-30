import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildEvidenceRefs, formatEvidenceForAgent, formatEvidenceForUser, type MemoryEvidenceRef } from "@/lib/memory/evidence";
import { hybridSearchMemory } from "@/lib/memory/hybrid-search";
import { FirecrawlClient } from "./firecrawl-client";
import { scoreSignalAgainstLane } from "./link-market-signals";
import { getMarketIntelligenceSource, getMarketIntelligenceSourceRegistry } from "./source-registry";
import { runScheduledMarketIngestion } from "./scheduled-ingestion";
import {
  buildSourceQualityLookup,
  listSourceQualitySummaries,
  rankMarketImpactReviews,
  rankMarketSignals,
  rankResearchFeedItems,
} from "./source-quality";
import {
  assertCanUseFirecrawlSource,
  filterAllowedFirecrawlUrls,
  sourceAllowedDomains,
  sourceRunLimits,
  validateMarketSourceDefinition,
} from "./source-policy";
import {
  getMarketSignalSuppressionReason,
  shouldSuppressMarketSignal,
  shouldUseMarketSignalInStrategyContext,
} from "./signal-suppression";
import { isValidMarketLane, normalizeMarketLane } from "./lane-validation";

function clampLimit(limit: number | null | undefined, fallback = 12) {
  return Math.max(1, Math.min(50, Math.floor(limit ?? fallback)));
}

function strings(value: Prisma.JsonValue | unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function normalizedLanes(value: Prisma.JsonValue | unknown) {
  return strings(value)
    .map(normalizeMarketLane)
    .filter((lane): lane is string => Boolean(lane))
    .filter((lane, index, array) => array.indexOf(lane) === index);
}

function queryTokens(query: string | null | undefined) {
  return (query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 8);
}

function safeRecord(value: Prisma.JsonValue | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function excerpt(value: string | null | undefined, max = 360) {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, max - 1).trim()}...`;
}

function sourceLabel(source: { label: string | null; type: string } | null | undefined) {
  return source?.label ?? source?.type ?? "Market source";
}

function evidenceFromSignal(signal: {
  id: string;
  sourceObjectId: string | null;
  sourceRefs: Prisma.JsonValue;
  sourceObject?: { id: string; sourceType: string; sourceExternalId: string; canonicalType: string; title: string | null; occurredAt: Date } | null;
}) {
  const refs: MemoryEvidenceRef[] = [];
  for (const ref of strings(signal.sourceRefs)) {
    const [refType, id] = ref.split(":");
    if (refType === "KnowledgeObject" && id) {
      refs.push({
        refType: "knowledge_object" as const,
        knowledgeObjectId: id,
      });
    }
  }
  if (signal.sourceObject) {
    refs.push({
      refType: "knowledge_object",
      knowledgeObjectId: signal.sourceObject.id,
      sourceType: signal.sourceObject.sourceType,
      sourceExternalId: signal.sourceObject.sourceExternalId,
      canonicalType: signal.sourceObject.canonicalType,
      title: signal.sourceObject.title,
      occurredAt: signal.sourceObject.occurredAt,
    });
  } else if (signal.sourceObjectId) {
    refs.push({ refType: "knowledge_object", knowledgeObjectId: signal.sourceObjectId });
  }
  refs.push({ refType: "entity", entityType: "market_signal", entityId: signal.id });
  return refs;
}

function compactSignal(signal: Prisma.MarketSignalGetPayload<{
  include: {
    links: true;
    sourceObject: { select: { id: true; sourceType: true; sourceExternalId: true; canonicalType: true; title: true; occurredAt: true } };
  };
}>, sourceQuality?: { score?: number | null; scoreBand?: string | null } | null) {
  const result = {
    id: signal.id,
    category: signal.category,
    severity: signal.severity,
    confidence: signal.confidence,
    affectedModes: strings(signal.affectedModes),
    affectedOrigins: strings(signal.affectedOrigins),
    affectedDestinations: strings(signal.affectedDestinations),
    affectedPorts: strings(signal.affectedPorts),
    affectedLanes: normalizedLanes(signal.affectedLanes),
    affectedCarriers: strings(signal.affectedCarriers),
    effectiveFrom: signal.effectiveFrom,
    effectiveTo: signal.effectiveTo,
    summary: signal.summary,
    operatorImplication: signal.operatorImplication,
    pricingImplication: signal.pricingImplication,
    customerImpact: signal.customerImpact,
    recommendedActions: strings(signal.recommendedActions),
    links: signal.links.filter((link) => link.entityType !== "lane" || isValidMarketLane(link.entityId)).map((link) => ({
      entityType: link.entityType,
      entityId: link.entityId,
      matchType: link.matchType,
      confidence: link.confidence,
      reason: link.reason,
    })),
    sourceObject: signal.sourceObject,
    suppressionReason: getMarketSignalSuppressionReason({ signal, sourceQuality }),
    evidence: evidenceFromSignal(signal),
  };
  return result;
}

export async function searchMarketIntelligence(input: {
  officeId: string;
  query?: string | null;
  category?: string | null;
  severity?: string | null;
  limit?: number | null;
}) {
  const limit = clampLimit(input.limit);
  const q = input.query?.trim();
  const tokens = queryTokens(q);
  const [signals, memory, sourceQuality] = await Promise.all([
    prisma.marketSignal.findMany({
      where: {
        officeId: input.officeId,
        ...(input.category ? { category: input.category } : {}),
        ...(input.severity ? { severity: input.severity } : {}),
        ...(tokens.length > 0 ? {
          OR: tokens.flatMap((token) => [
            { summary: { contains: token, mode: "insensitive" as const } },
            { operatorImplication: { contains: token, mode: "insensitive" as const } },
            { pricingImplication: { contains: token, mode: "insensitive" as const } },
            { customerImpact: { contains: token, mode: "insensitive" as const } },
          ]),
        } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: limit * 3,
      include: {
        links: true,
        impactReviews: { select: { status: true, feedbackKind: true } },
        feedback: { select: { feedbackKind: true } },
        sourceObject: { select: { id: true, sourceType: true, sourceExternalId: true, canonicalType: true, title: true, occurredAt: true, payload: true } },
      },
    }).catch(() => []),
    hybridSearchMemory({
      officeId: input.officeId,
      query: q,
      canonicalTypes: ["market_update", "market_signal"],
      sourceTypes: ["MARKET"],
      limit,
      includeEvents: true,
      includeChunks: true,
    }).catch(() => null),
    listSourceQualitySummaries({ officeId: input.officeId }).catch(() => []),
  ]);

  const qualityLookup = buildSourceQualityLookup(sourceQuality);
  const rankedSignals = rankMarketSignals(signals, qualityLookup);
  const activeSignals = rankedSignals
    .filter((signal) => !shouldSuppressMarketSignal({
      signal,
      sourceQuality: qualityLookup.bySourceObjectId.get(signal.sourceObjectId ?? ""),
    }))
    .slice(0, limit);
  const compactSignals = activeSignals.map((signal) => compactSignal(
    signal,
    qualityLookup.bySourceObjectId.get(signal.sourceObjectId ?? ""),
  ));
  const suppressedSignals = rankedSignals
    .map((signal) => ({
      signal,
      suppressionReason: getMarketSignalSuppressionReason({
        signal,
        sourceQuality: qualityLookup.bySourceObjectId.get(signal.sourceObjectId ?? ""),
      }),
    }))
    .filter((row) => row.suppressionReason)
    .slice(0, 10)
    .map((row) => ({
      id: row.signal.id,
      category: row.signal.category,
      severity: row.signal.severity,
      summary: row.signal.summary,
      suppressionReason: row.suppressionReason,
    }));
  return {
    query: q ?? null,
    signals: compactSignals,
    suppressed_signals: suppressedSignals,
    memory_results: memory?.results ?? [],
    evidence: [
      ...compactSignals.flatMap((signal) => signal.evidence),
      ...buildEvidenceRefs(memory?.results ?? []),
    ],
    evidence_for_agent: [
      ...compactSignals.map((signal, index) => `${index + 1}. ${signal.summary} (${signal.category}/${signal.severity}) links=${signal.links.length} [MarketSignal:${signal.id}]`),
      memory?.evidence_for_agent ?? "",
    ].filter(Boolean).join("\n"),
    evidence_for_user: [
      ...compactSignals.slice(0, 6).map((signal) => `${signal.summary} (${signal.category}/${signal.severity})`),
      ...(memory ? formatEvidenceForUser(memory.results) : []),
    ],
  };
}

export async function listMarketResearchFeed(input: {
  officeId: string;
  sourceId?: string | null;
  query?: string | null;
  limit?: number | null;
}) {
  const limit = clampLimit(input.limit, 20);
  const q = input.query?.trim();
  const tokens = queryTokens(q);
  const [objects, sourceQuality] = await Promise.all([
    prisma.knowledgeObject.findMany({
    where: {
      officeId: input.officeId,
      sourceType: "MARKET",
      canonicalType: "market_update",
      ...(input.sourceId ? { sourceExternalId: { startsWith: `market:${input.sourceId}:` } } : {}),
      ...(tokens.length ? {
        OR: tokens.flatMap((token) => [
          { title: { contains: token, mode: "insensitive" as const } },
          { sourceExternalId: { contains: token, mode: "insensitive" as const } },
          { rawRef: { contains: token, mode: "insensitive" as const } },
        ]),
      } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      source: { select: { id: true, label: true, type: true, metadata: true } },
      chunks: { orderBy: { ordinal: "asc" }, take: 1 },
      marketSignals: {
        orderBy: [{ severity: "desc" }, { confidence: "desc" }],
        take: 5,
        include: {
          links: { take: 10 },
          impactReviews: { take: 10 },
        },
      },
    },
    }),
    listSourceQualitySummaries({ officeId: input.officeId }).catch(() => []),
  ]);
  const qualityLookup = buildSourceQualityLookup(sourceQuality);

  const items = rankResearchFeedItems(objects, qualityLookup).map((object) => {
    const metadata = safeRecord(object.source?.metadata);
    const trustLevel = typeof metadata.trustLevel === "string" ? metadata.trustLevel : null;
    const signals = object.marketSignals.map((signal) => ({
      id: signal.id,
      category: signal.category,
      severity: signal.severity,
      confidence: signal.confidence,
      summary: signal.summary,
      linkCount: signal.links.length,
      pendingReviewCount: signal.impactReviews.filter((review) => review.status === "pending").length,
    }));
    return {
      id: object.id,
      title: object.title ?? object.sourceExternalId,
      url: object.rawRef ?? object.sourceExternalId,
      source: {
        id: object.source?.id ?? object.sourceId,
        name: sourceLabel(object.source),
        trustLevel,
        qualityScore: qualityLookup.bySourceObjectId.get(object.id)?.score ?? null,
        qualityBand: qualityLookup.bySourceObjectId.get(object.id)?.scoreBand ?? null,
      },
      sourceExternalId: object.sourceExternalId,
      contentHash: object.contentHash,
      canonicalType: object.canonicalType,
      occurredAt: object.occurredAt,
      createdAt: object.createdAt,
      excerpt: excerpt(object.chunks[0]?.text ?? object.title ?? object.sourceExternalId),
      signals,
      evidence: [{
        refType: "knowledge_object" as const,
        knowledgeObjectId: object.id,
        sourceType: object.sourceType,
        sourceExternalId: object.sourceExternalId,
        canonicalType: object.canonicalType,
        title: object.title,
        occurredAt: object.occurredAt,
      }],
    };
  });

  return {
    query: q ?? null,
    items,
    evidence: items.flatMap((item) => item.evidence),
    evidence_for_agent: items.map((item, index) => (
      `${index + 1}. ${item.title} source=${item.source.name}${item.source.trustLevel ? ` trust=${item.source.trustLevel}` : ""} signals=${item.signals.length} [KnowledgeObject:${item.id}]`
    )).join("\n"),
    evidence_for_user: items.slice(0, 6).map((item) => `${item.title} (${item.source.name})`),
  };
}

export async function listMarketSources(input: {
  officeId?: string | null;
  includeDisabled?: boolean;
}) {
  const registry = getMarketIntelligenceSourceRegistry();
  const quality = input.officeId ? await listSourceQualitySummaries({ officeId: input.officeId }).catch(() => []) : [];
  const qualityBySource = new Map(quality.map((summary) => [summary.sourceId, summary]));
  return registry
    .filter((source) => input.includeDisabled !== false || source.enabled)
    .map((source) => ({
      id: source.id,
      name: source.name,
      enabled: source.enabled,
      fetchType: source.fetchType,
      sourceCategory: source.sourceCategory,
      trustLevel: source.trustLevel,
      defaultCategory: source.defaultCategory,
      defaultCategories: source.defaultCategories,
      defaultAffectedModes: source.defaultAffectedModes,
      homepage: source.homepage,
      url: source.url,
      allowedDomains: sourceAllowedDomains(source),
      allowedPathPatterns: source.allowedPathPatterns ?? [],
      blockedPathPatterns: source.blockedPathPatterns ?? [],
      articleUrlPatterns: source.articleUrlPatterns ?? [],
      indexUrlPatterns: source.indexUrlPatterns ?? [],
      requirePublishedDate: source.requirePublishedDate ?? false,
      maxResultsPerRun: source.maxResultsPerRun,
      maxPagesPerRun: source.maxPagesPerRun,
      notes: source.notes,
      termsPolicyNotes: source.termsPolicyNotes,
      policy: validateMarketSourceDefinition(source),
      quality: qualityBySource.get(source.id) ?? null,
      caveat: source.sourceCategory === "media" ? "Media/context source. Prefer official confirmation before operational action." : "External intelligence is advisory.",
    }));
}

export async function getMarketSourceQuality(input: {
  officeId: string;
  sourceId?: string | null;
}) {
  const summaries = await listSourceQualitySummaries({ officeId: input.officeId });
  return {
    sourceId: input.sourceId ?? null,
    summaries: input.sourceId ? summaries.filter((summary) => summary.sourceId === input.sourceId) : summaries,
    caveat: "Source quality is deterministic trust plus review feedback. It is not an LLM judgment.",
  };
}

export async function runMarketSourceIngestion(input: {
  officeId: string;
  sourceId: string;
  dryRun?: boolean;
  limit?: number | null;
}) {
  const sourceId = input.sourceId.trim();
  if (!sourceId) return { ok: false as const, error: "sourceId is required." };
  const result = await runScheduledMarketIngestion({
    officeId: input.officeId,
    sourceIds: [sourceId],
    maxSources: 1,
    maxPagesPerRun: input.limit,
    dryRun: input.dryRun,
    force: true,
    allowDisabled: true,
  });
  return {
    ok: result.ok,
    result,
    caveat: "Single-source ingestion only. External intelligence remains advisory and cannot mutate jobs, RFQs, quotes, prices, milestones, customers, or messages.",
  };
}

export async function searchMarketResearch(input: {
  officeId: string;
  query: string;
  limit?: number | null;
}) {
  const query = input.query.trim();
  if (!query) return { query, results: [], evidence: [], evidence_for_agent: "", evidence_for_user: [] };
  const memory = await hybridSearchMemory({
    officeId: input.officeId,
    query,
    canonicalTypes: ["market_update"],
    sourceTypes: ["MARKET"],
    limit: clampLimit(input.limit, 12),
    includeEvents: true,
    includeChunks: true,
  });
  return {
    query,
    results: memory.results,
    evidence: buildEvidenceRefs(memory.results),
    evidence_for_agent: memory.evidence_for_agent,
    evidence_for_user: formatEvidenceForUser(memory.results),
  };
}

export async function ingestMarketSourcePreview(input: {
  sourceId: string;
  query?: string | null;
  url?: string | null;
  limit?: number | null;
}) {
  const source = getMarketIntelligenceSource(input.sourceId);
  assertCanUseFirecrawlSource(source);
  if (source.fetchType !== "firecrawl_search" && source.fetchType !== "firecrawl_scrape") {
    return { ok: false as const, error: `Source ${source.id} is ${source.fetchType}; preview only supports Firecrawl sources.` };
  }
  const limits = sourceRunLimits(source);
  const allowedDomains = sourceAllowedDomains(source);
  const limit = clampLimit(input.limit, Math.min(source.maxResultsPerRun, limits.maxResults));
  const client = new FirecrawlClient({
    maxResultsPerRun: Math.min(limit, limits.maxResults),
    maxPagesPerRun: Math.min(limit, limits.maxPages),
  });

  if (source.fetchType === "firecrawl_search") {
    const query = input.query?.trim() || source.name;
    const search = await client.search({
      query,
      limit,
      includeDomains: allowedDomains,
      scrapeResults: false,
    });
    const items = search.items.map((item) => ({
      url: item.url,
      title: item.title,
      description: item.description,
      publishedAt: item.publishedAt,
      allowed: filterAllowedFirecrawlUrls([item.url], source).length === 1,
    }));
    return {
      ok: true as const,
      persisted: false,
      source: { id: source.id, name: source.name, fetchType: source.fetchType, allowedDomains, trustLevel: source.trustLevel },
      query,
      creditsUsed: search.creditsUsed,
      items,
    };
  }

  const url = input.url?.trim() || source.url || "";
  const allowedUrl = filterAllowedFirecrawlUrls([url], source)[0];
  if (!allowedUrl) {
    return { ok: false as const, error: `URL is outside source policy for ${source.id}.`, source: { id: source.id, allowedDomains } };
  }
  const scrape = await client.scrape({ url: allowedUrl });
  return {
    ok: true as const,
    persisted: false,
    source: { id: source.id, name: source.name, fetchType: source.fetchType, allowedDomains, trustLevel: source.trustLevel },
    creditsUsed: scrape.creditsUsed,
    item: scrape.item ? {
      url: scrape.item.url,
      title: scrape.item.title,
      description: scrape.item.description,
      publishedAt: scrape.item.publishedAt,
      excerpt: excerpt(scrape.item.markdown ?? scrape.item.description ?? scrape.item.title, 800),
    } : null,
  };
}

export async function getLaneIntelligence(input: {
  officeId: string;
  origin: string;
  destination: string;
  mode?: string | null;
  limit?: number | null;
}) {
  const limit = clampLimit(input.limit);
  const [signals, sourceQuality] = await Promise.all([
    prisma.marketSignal.findMany({
      where: { officeId: input.officeId },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: {
        links: true,
        impactReviews: { select: { status: true, feedbackKind: true } },
        feedback: { select: { feedbackKind: true } },
        sourceObject: { select: { id: true, sourceType: true, sourceExternalId: true, canonicalType: true, title: true, occurredAt: true, payload: true } },
      },
    }).catch(() => []),
    listSourceQualitySummaries({ officeId: input.officeId }).catch(() => []),
  ]);
  const qualityLookup = buildSourceQualityLookup(sourceQuality);

  const scored = signals
    .filter((signal) => shouldUseMarketSignalInStrategyContext({
      signal,
      sourceQuality: qualityLookup.bySourceObjectId.get(signal.sourceObjectId ?? ""),
    }))
    .map((signal) => ({ signal, match: scoreSignalAgainstLane(signal, input) }))
    .filter((row) => row.match.matched)
    .sort((a, b) => b.match.confidence - a.match.confidence)
    .slice(0, limit)
    .map((row) => ({ ...compactSignal(row.signal), laneMatch: row.match }));

  return {
    lane: { origin: input.origin, destination: input.destination, mode: input.mode ?? null },
    signals: scored,
    evidence: scored.flatMap((signal) => signal.evidence),
    evidence_for_agent: formatEvidenceForAgent(scored.map((signal) => ({
      title: signal.summary,
      excerpt: `${signal.operatorImplication ?? ""} ${signal.pricingImplication ?? ""}`.trim(),
      score: Math.round(signal.laneMatch.confidence * 100),
      occurredAt: signal.effectiveFrom ?? undefined,
      evidence: signal.evidence,
      canonicalType: "market_signal",
      sourceType: "MARKET",
    }))),
    evidence_for_user: scored.slice(0, 6).map((signal) => `${signal.summary} (${signal.category}/${signal.severity})`),
  };
}

export async function getCustomerMarketExposure(input: {
  officeId: string;
  companyId?: string | null;
  query?: string | null;
  limit?: number | null;
}) {
  const company = input.companyId
    ? await prisma.company.findFirst({ where: { id: input.companyId, officeId: input.officeId }, select: { id: true, name: true } })
    : input.query?.trim()
      ? await prisma.company.findFirst({
          where: { officeId: input.officeId, name: { contains: input.query.trim(), mode: "insensitive" } },
          select: { id: true, name: true },
          orderBy: { updatedAt: "desc" },
        })
      : null;
  if (!company) return { found: false as const, message: "No matching customer found." };

  const [jobs, inquiries, directLinks] = await Promise.all([
    prisma.job.findMany({ where: { officeId: input.officeId, companyId: company.id, status: { notIn: ["DELIVERED", "CANCELLED"] } }, select: { id: true, reference: true, origin: true, destination: true, mode: true }, take: 50 }),
    prisma.inquiry.findMany({ where: { officeId: input.officeId, companyId: company.id, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] } }, select: { id: true, subject: true, origin: true, destination: true, mode: true }, take: 50 }),
    prisma.marketSignalLink.findMany({
      where: { officeId: input.officeId, entityType: "company", entityId: company.id },
      include: {
        signal: {
          include: {
            links: true,
            impactReviews: { select: { status: true, feedbackKind: true } },
            feedback: { select: { feedbackKind: true } },
            sourceObject: { select: { id: true, sourceType: true, sourceExternalId: true, canonicalType: true, title: true, occurredAt: true, payload: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: clampLimit(input.limit),
    }).catch(() => []),
  ]);
  const sourceQuality = await listSourceQualitySummaries({ officeId: input.officeId }).catch(() => []);
  const qualityLookup = buildSourceQualityLookup(sourceQuality);

  const signalById = new Map<string, ReturnType<typeof compactSignal>>();
  for (const link of directLinks) {
    if (!shouldUseMarketSignalInStrategyContext({
      signal: link.signal,
      sourceQuality: qualityLookup.bySourceObjectId.get(link.signal.sourceObjectId ?? ""),
    })) continue;
    signalById.set(link.signal.id, compactSignal(link.signal));
  }
  const activeWork = [
    ...jobs.map((job) => ({ entityType: "job", ...job })),
    ...inquiries.map((inquiry) => ({ entityType: "inquiry", ...inquiry })),
  ];

  return {
    found: true as const,
    company,
    active_work: activeWork,
    signals: [...signalById.values()].slice(0, clampLimit(input.limit)),
    evidence: [...signalById.values()].flatMap((signal) => signal.evidence),
    evidence_for_agent: [...signalById.values()].map((signal, index) => `${index + 1}. ${signal.summary} (${signal.category}/${signal.severity}) [MarketSignal:${signal.id}]`).join("\n"),
    evidence_for_user: [...signalById.values()].slice(0, 6).map((signal) => `${signal.summary} (${signal.category}/${signal.severity})`),
  };
}
