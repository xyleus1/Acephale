import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildSourceQualityLookup, listSourceQualitySummaries } from "./source-quality";
import { getMarketSignalSuppressionReason } from "./signal-suppression";

export type IntelligenceSeverity = "low" | "medium" | "high" | "critical";

export type IntelligenceHotspot = {
  id: string;
  label: string;
  type: "port" | "lane" | "country" | "region" | "source" | "customer" | "market";
  lat: number;
  lng: number;
  severity: IntelligenceSeverity;
  confidence: number;
  category: string;
  sourceId: string | null;
  sourceName: string | null;
  signalCount: number;
  reviewCount: number;
  pendingReviewCount: number;
  latestSummary: string;
  evidenceRefs: string[];
  recommendedActions: string[];
  suppressed: boolean;
  suppressionReasons: string[];
  relatedResearchIds: string[];
  relatedSignalIds: string[];
  relatedReviewIds: string[];
  affectedEntities: Array<{ type: string; id: string; label: string }>;
};

export type IntelligenceLaneArc = {
  id: string;
  label: string;
  from: { lat: number; lng: number; label: string };
  to: { lat: number; lng: number; label: string };
  severity: IntelligenceSeverity;
  signalCount: number;
};

export type IntelligenceResearchItem = {
  id: string;
  title: string;
  sourceId: string | null;
  sourceName: string | null;
  url: string | null;
  occurredAt: string;
  pageType: string | null;
  extractionStatus: string | null;
  contentQualityScore: number | null;
  excerpt: string;
};

export type IntelligenceImpactReviewItem = {
  id: string;
  status: string;
  impactLevel: string;
  linkedEntityType: string;
  linkedEntityId: string;
  linkedEntityLabel: string;
  recommendedAction: string | null;
  signalId: string;
  signalSummary: string;
  sourceId: string | null;
  sourceName: string | null;
  createdAt: string;
};

export type IntelligenceMapMetrics = {
  researchItems24h: number;
  researchItems7d: number;
  signalsBySeverity: Record<IntelligenceSeverity, number>;
  pendingImpactReviews: number;
  affectedLanes: number;
  affectedCustomers: number;
  affectedJobs: number;
  affectedRfqs: number;
  sourceQualityAverage: number | null;
  suppressedSignals: number;
};

export type IntelligenceMapData = {
  hotspots: IntelligenceHotspot[];
  lanes: IntelligenceLaneArc[];
  researchItems: IntelligenceResearchItem[];
  impactReviews: IntelligenceImpactReviewItem[];
  metrics: IntelligenceMapMetrics;
  sourceHealth: Array<{
    sourceId: string;
    name: string;
    sourceCategory: string;
    trustLevel: string;
    score: number;
    scoreBand: string;
    objectCount: number;
    signalCount: number;
    lastRunAt: string | null;
  }>;
};

type Coordinates = { label: string; lat: number; lng: number; type: IntelligenceHotspot["type"] };

const LOCATION_LOOKUP: Record<string, Coordinates> = {
  china: { label: "China", lat: 35.8, lng: 103.8, type: "country" },
  shanghai: { label: "Shanghai", lat: 31.23, lng: 121.47, type: "port" },
  ningbo: { label: "Ningbo", lat: 29.87, lng: 121.55, type: "port" },
  shenzhen: { label: "Shenzhen", lat: 22.54, lng: 114.06, type: "port" },
  "hong kong": { label: "Hong Kong", lat: 22.32, lng: 114.17, type: "port" },
  singapore: { label: "Singapore", lat: 1.29, lng: 103.85, type: "port" },
  europe: { label: "Europe", lat: 50.8, lng: 10.4, type: "region" },
  "northern europe": { label: "Northern Europe", lat: 54.4, lng: 9.9, type: "region" },
  hamburg: { label: "Hamburg", lat: 53.55, lng: 9.99, type: "port" },
  rotterdam: { label: "Rotterdam", lat: 51.92, lng: 4.48, type: "port" },
  antwerp: { label: "Antwerp", lat: 51.22, lng: 4.4, type: "port" },
  "los angeles": { label: "Los Angeles", lat: 33.74, lng: -118.26, type: "port" },
  "long beach": { label: "Long Beach", lat: 33.75, lng: -118.2, type: "port" },
  "new york": { label: "New York", lat: 40.68, lng: -74.04, type: "port" },
  savannah: { label: "Savannah", lat: 32.08, lng: -81.09, type: "port" },
  turkey: { label: "Turkey", lat: 39.0, lng: 35.2, type: "country" },
  istanbul: { label: "Istanbul", lat: 41.01, lng: 28.97, type: "port" },
  mersin: { label: "Mersin", lat: 36.8, lng: 34.63, type: "port" },
  suez: { label: "Suez", lat: 29.97, lng: 32.55, type: "port" },
  "suez canal": { label: "Suez Canal", lat: 30.45, lng: 32.35, type: "region" },
  panama: { label: "Panama", lat: 9.08, lng: -79.68, type: "port" },
  "panama canal": { label: "Panama Canal", lat: 9.08, lng: -79.68, type: "region" },
  "red sea": { label: "Red Sea", lat: 20.2, lng: 38.2, type: "region" },
  us: { label: "US", lat: 39.5, lng: -98.35, type: "country" },
  usa: { label: "US", lat: 39.5, lng: -98.35, type: "country" },
  "united states": { label: "US", lat: 39.5, lng: -98.35, type: "country" },
  eu: { label: "EU", lat: 50.5, lng: 10.5, type: "region" },
  global: { label: "Global Market", lat: 8, lng: 0, type: "market" },
  "global market": { label: "Global Market", lat: 8, lng: 0, type: "market" },
  ocean: { label: "Ocean", lat: 5, lng: -30, type: "market" },
  asia: { label: "Asia", lat: 34, lng: 95, type: "region" },
  "north america": { label: "North America", lat: 43, lng: -100, type: "region" },
};

const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

function strings(value: Prisma.JsonValue | unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function record(value: Prisma.JsonValue | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sourceIdFromExternalId(value: string | null | undefined) {
  return value?.match(/^market:([^:]+)/)?.[1] ?? null;
}

function sourceIdForObject(object: {
  sourceExternalId?: string | null;
  payload?: Prisma.JsonValue | null;
  source?: { externalId: string | null; metadata: Prisma.JsonValue | null } | null;
} | null | undefined) {
  const payload = record(object?.payload);
  const metadata = record(object?.source?.metadata);
  return (typeof metadata.sourceId === "string" ? metadata.sourceId : null)
    ?? (typeof payload.sourceId === "string" ? payload.sourceId : null)
    ?? sourceIdFromExternalId(object?.sourceExternalId)
    ?? sourceIdFromExternalId(object?.source?.externalId);
}

function sourceNameForObject(object: {
  source?: { label: string | null } | null;
  payload?: Prisma.JsonValue | null;
} | null | undefined) {
  const payload = record(object?.payload);
  return object?.source?.label ?? (typeof payload.sourceName === "string" ? payload.sourceName : null);
}

function extractionInfo(object: { payload?: Prisma.JsonValue | null } | null | undefined) {
  const payload = record(object?.payload);
  const hygiene = record(payload.contentHygiene);
  return {
    pageType: typeof hygiene.pageType === "string" ? hygiene.pageType : typeof payload.pageType === "string" ? payload.pageType : null,
    status: typeof hygiene.extractionStatus === "string" ? hygiene.extractionStatus : typeof payload.extractionStatus === "string" ? payload.extractionStatus : null,
    score: typeof hygiene.contentQualityScore === "number" ? hygiene.contentQualityScore : typeof payload.contentQualityScore === "number" ? payload.contentQualityScore : null,
  };
}

function normalizeLocation(value: string) {
  return value.toLowerCase().replace(/\bcn\b/g, "china").replace(/\beu\b/g, "europe").replace(/[^a-z0-9]+/g, " ").trim();
}

function coordinatesFor(value: string | null | undefined): Coordinates | null {
  const normalized = normalizeLocation(value ?? "");
  if (!normalized) return null;
  if (LOCATION_LOOKUP[normalized]) return LOCATION_LOOKUP[normalized];
  const found = Object.keys(LOCATION_LOOKUP)
    .sort((a, b) => b.length - a.length)
    .find((key) => normalized.includes(key));
  if (found) return LOCATION_LOOKUP[found];
  if (/ocean|sea|vessel|carrier|container/.test(normalized)) return LOCATION_LOOKUP.ocean;
  if (/asia|china|shanghai|ningbo|shenzhen|hong kong|singapore/.test(normalized)) return LOCATION_LOOKUP.asia;
  if (/europe|hamburg|rotterdam|antwerp/.test(normalized)) return LOCATION_LOOKUP.europe;
  if (/america|us|los angeles|long beach|new york|savannah/.test(normalized)) return LOCATION_LOOKUP["north america"];
  return LOCATION_LOOKUP.global;
}

function defaultLocationLabelsForSource(sourceId: string | null | undefined, sourceName: string | null | undefined, category: string) {
  const id = sourceId ?? "";
  const name = (sourceName ?? "").toLowerCase();
  if (id === "cbp-csms" || /cargo systems messaging|cbp/.test(name)) return ["US"];
  if (id === "port-of-los-angeles-latest-news" || /port of los angeles/.test(name)) return ["Los Angeles"];
  if (id === "port-of-long-beach-news" || /long beach/.test(name)) return ["Long Beach"];
  if (id === "fmc-news-advisories" || /federal maritime|fmc/.test(name)) return ["US", "Ocean"];
  if (id === "drewry-world-container-index" || /drewry|world container index/.test(name)) return ["Shanghai", "Rotterdam", "Los Angeles", "New York"];
  if (id === "maersk-news-advisories" || /maersk/.test(name)) return ["Ocean", "Global Market"];
  if (category === "customs" || category === "compliance") return ["US"];
  if (category === "rate") return ["Ocean", "Global Market"];
  if (category === "port_disruption") return ["Ocean"];
  return ["Global Market"];
}

function compact(value: string | null | undefined, max = 260) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text;
}

function severity(value: string | null | undefined): IntelligenceSeverity {
  return ["low", "medium", "high", "critical"].includes(value ?? "") ? value as IntelligenceSeverity : "medium";
}

function higherSeverity(a: IntelligenceSeverity, b: IntelligenceSeverity) {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

function addUnique<T>(array: T[], value: T) {
  if (!array.includes(value)) array.push(value);
}

export async function getIntelligenceMapData(officeId: string): Promise<IntelligenceMapData> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [signals, researchObjects, reviews, sourceQuality] = await Promise.all([
    prisma.marketSignal.findMany({
      where: { officeId },
      orderBy: [{ createdAt: "desc" }],
      take: 120,
      include: {
        sourceObject: { include: { source: true, chunks: { orderBy: { ordinal: "asc" }, take: 1 } } },
        links: true,
        impactReviews: true,
        feedback: true,
      },
    }).catch(() => []),
    prisma.knowledgeObject.findMany({
      where: { officeId, sourceType: "MARKET", canonicalType: "market_update" },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 80,
      include: { source: true, chunks: { orderBy: { ordinal: "asc" }, take: 1 } },
    }).catch(() => []),
    prisma.marketImpactReview.findMany({
      where: { officeId },
      orderBy: [{ createdAt: "desc" }],
      take: 80,
      include: { marketSignal: { include: { sourceObject: { include: { source: true } } } } },
    }).catch(() => []),
    listSourceQualitySummaries({ officeId }).catch(() => []),
  ]);

  const qualityLookup = buildSourceQualityLookup(sourceQuality);
  const entityIds = {
    company: [...new Set(reviews.filter((review) => review.linkedEntityType === "company").map((review) => review.linkedEntityId))],
    job: [...new Set(reviews.filter((review) => review.linkedEntityType === "job").map((review) => review.linkedEntityId))],
    inquiry: [...new Set(reviews.filter((review) => review.linkedEntityType === "inquiry").map((review) => review.linkedEntityId))],
  };
  const [companies, jobs, inquiries] = await Promise.all([
    entityIds.company.length ? prisma.company.findMany({ where: { officeId, id: { in: entityIds.company } }, select: { id: true, name: true } }) : [],
    entityIds.job.length ? prisma.job.findMany({ where: { officeId, id: { in: entityIds.job } }, select: { id: true, reference: true, title: true } }) : [],
    entityIds.inquiry.length ? prisma.inquiry.findMany({ where: { officeId, id: { in: entityIds.inquiry } }, select: { id: true, subject: true } }) : [],
  ]);
  const entityLabels = new Map<string, string>([
    ...companies.map((company) => [`company:${company.id}`, company.name] as const),
    ...jobs.map((job) => [`job:${job.id}`, job.reference ?? job.title ?? job.id] as const),
    ...inquiries.map((inquiry) => [`inquiry:${inquiry.id}`, inquiry.subject ?? inquiry.id] as const),
  ]);

  const hotspotMap = new Map<string, IntelligenceHotspot>();
  const laneMap = new Map<string, IntelligenceLaneArc>();
  const suppressedSignalIds = new Set<string>();

  for (const signal of signals) {
    const sourceId = sourceIdForObject(signal.sourceObject);
    const sourceName = sourceNameForObject(signal.sourceObject);
    const sourceQualitySummary = signal.sourceObjectId ? qualityLookup.bySourceObjectId.get(signal.sourceObjectId) : undefined;
    const suppressionReason = getMarketSignalSuppressionReason({ signal, sourceQuality: sourceQualitySummary, requirePendingReview: true });
    if (suppressionReason) suppressedSignalIds.add(signal.id);
    const signalSeverity = severity(signal.severity);
    const pendingReviewCount = signal.impactReviews.filter((review) => review.status === "pending").length;
    const evidenceRefs = [
      `MarketSignal:${signal.id}`,
      signal.sourceObjectId ? `KnowledgeObject:${signal.sourceObjectId}` : null,
      ...strings(signal.sourceRefs),
    ].filter((item): item is string => Boolean(item));
    const recommendedActions = strings(signal.recommendedActions);
    const affectedEntities = signal.links.slice(0, 12).map((link) => ({
      type: link.entityType,
      id: link.entityId,
      label: entityLabels.get(`${link.entityType}:${link.entityId}`) ?? `${link.entityType}:${link.entityId.slice(0, 8)}`,
    }));
    const explicitGeoLabels = [
      ...strings(signal.affectedPorts),
      ...strings(signal.affectedOrigins),
      ...strings(signal.affectedDestinations),
      ...strings(signal.affectedLanes),
    ].filter((item): item is string => Boolean(item));
    const usableLabels = explicitGeoLabels.length
      ? explicitGeoLabels
      : defaultLocationLabelsForSource(sourceId, sourceName, signal.category);

    for (const rawLabel of usableLabels.slice(0, 10)) {
      const coords = coordinatesFor(rawLabel) ?? LOCATION_LOOKUP.global;
      const key = `${coords.type}:${coords.label}`;
      const existing = hotspotMap.get(key);
      if (!existing) {
        hotspotMap.set(key, {
          id: key,
          label: coords.label,
          type: coords.type,
          lat: coords.lat,
          lng: coords.lng,
          severity: signalSeverity,
          confidence: signal.confidence,
          category: signal.category,
          sourceId,
          sourceName,
          signalCount: 1,
          reviewCount: signal.impactReviews.length,
          pendingReviewCount,
          latestSummary: signal.summary,
          evidenceRefs: [...evidenceRefs],
          recommendedActions: [...recommendedActions],
          suppressed: Boolean(suppressionReason),
          suppressionReasons: suppressionReason ? [suppressionReason] : [],
          relatedResearchIds: signal.sourceObjectId ? [signal.sourceObjectId] : [],
          relatedSignalIds: [signal.id],
          relatedReviewIds: signal.impactReviews.map((review) => review.id),
          affectedEntities: [...affectedEntities],
        });
      } else {
        existing.severity = higherSeverity(existing.severity, signalSeverity);
        existing.confidence = Math.max(existing.confidence, signal.confidence);
        existing.signalCount += 1;
        existing.reviewCount += signal.impactReviews.length;
        existing.pendingReviewCount += pendingReviewCount;
        existing.latestSummary = signal.createdAt > new Date(0) ? signal.summary : existing.latestSummary;
        existing.suppressed = existing.suppressed && Boolean(suppressionReason);
        if (suppressionReason) addUnique(existing.suppressionReasons, suppressionReason);
        for (const ref of evidenceRefs) addUnique(existing.evidenceRefs, ref);
        for (const action of recommendedActions) addUnique(existing.recommendedActions, action);
        if (signal.sourceObjectId) addUnique(existing.relatedResearchIds, signal.sourceObjectId);
        addUnique(existing.relatedSignalIds, signal.id);
        for (const review of signal.impactReviews) addUnique(existing.relatedReviewIds, review.id);
        for (const entity of affectedEntities) {
          if (!existing.affectedEntities.some((item) => item.type === entity.type && item.id === entity.id)) existing.affectedEntities.push(entity);
        }
      }
    }

    const lanes = strings(signal.affectedLanes);
    for (const lane of lanes) {
      const [fromRaw, toRaw] = lane.split(/\s*(?:->|→|to)\s*/i);
      const from = coordinatesFor(fromRaw) ?? coordinatesFor(strings(signal.affectedOrigins)[0]);
      const to = coordinatesFor(toRaw) ?? coordinatesFor(strings(signal.affectedDestinations)[0]);
      if (!from || !to || from.label === to.label) continue;
      const key = `${from.label}->${to.label}`;
      const existing = laneMap.get(key);
      if (existing) {
        existing.signalCount += 1;
        existing.severity = higherSeverity(existing.severity, signalSeverity);
      } else {
        laneMap.set(key, {
          id: key,
          label: lane,
          from,
          to,
          severity: signalSeverity,
          signalCount: 1,
        });
      }
    }
  }

  const metrics: IntelligenceMapMetrics = {
    researchItems24h: researchObjects.filter((object) => object.occurredAt >= last24h).length,
    researchItems7d: researchObjects.filter((object) => object.occurredAt >= last7d).length,
    signalsBySeverity: {
      low: signals.filter((signal) => signal.severity === "low").length,
      medium: signals.filter((signal) => signal.severity === "medium").length,
      high: signals.filter((signal) => signal.severity === "high").length,
      critical: signals.filter((signal) => signal.severity === "critical").length,
    },
    pendingImpactReviews: reviews.filter((review) => review.status === "pending").length,
    affectedLanes: laneMap.size,
    affectedCustomers: new Set(reviews.filter((review) => review.linkedEntityType === "company").map((review) => review.linkedEntityId)).size,
    affectedJobs: new Set(reviews.filter((review) => review.linkedEntityType === "job").map((review) => review.linkedEntityId)).size,
    affectedRfqs: new Set(reviews.filter((review) => review.linkedEntityType === "inquiry").map((review) => review.linkedEntityId)).size,
    sourceQualityAverage: sourceQuality.length ? Math.round(sourceQuality.reduce((sum, source) => sum + source.score, 0) / sourceQuality.length) : null,
    suppressedSignals: suppressedSignalIds.size,
  };

  return {
    hotspots: [...hotspotMap.values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.pendingReviewCount - a.pendingReviewCount),
    lanes: [...laneMap.values()],
    researchItems: researchObjects.slice(0, 20).map((object) => {
      const extraction = extractionInfo(object);
      return {
        id: object.id,
        title: object.title ?? object.sourceExternalId,
        sourceId: sourceIdForObject(object),
        sourceName: sourceNameForObject(object),
        url: object.rawRef,
        occurredAt: object.occurredAt.toISOString(),
        pageType: extraction.pageType,
        extractionStatus: extraction.status,
        contentQualityScore: extraction.score,
        excerpt: compact(object.chunks[0]?.text ?? object.sourceExternalId, 320),
      };
    }),
    impactReviews: reviews.slice(0, 30).map((review) => ({
      id: review.id,
      status: review.status,
      impactLevel: review.impactLevel,
      linkedEntityType: review.linkedEntityType,
      linkedEntityId: review.linkedEntityId,
      linkedEntityLabel: entityLabels.get(`${review.linkedEntityType}:${review.linkedEntityId}`) ?? `${review.linkedEntityType}:${review.linkedEntityId.slice(0, 8)}`,
      recommendedAction: review.recommendedAction,
      signalId: review.marketSignalId,
      signalSummary: review.marketSignal.summary,
      sourceId: sourceIdForObject(review.marketSignal.sourceObject),
      sourceName: sourceNameForObject(review.marketSignal.sourceObject),
      createdAt: review.createdAt.toISOString(),
    })),
    metrics,
    sourceHealth: sourceQuality.map((source) => ({
      sourceId: source.sourceId,
      name: source.name,
      sourceCategory: source.sourceCategory,
      trustLevel: source.trustLevel,
      score: source.score,
      scoreBand: source.scoreBand,
      objectCount: source.objectCount,
      signalCount: source.signalCount,
      lastRunAt: source.lastRunAt?.toISOString() ?? null,
    })),
  };
}
