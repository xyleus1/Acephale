import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getMarketIntelligenceSourceRegistry,
  type MarketIntelligenceSourceDefinition,
  type MarketSourceTrustLevel,
} from "./source-registry";

export type SourceQualityScoreInput = {
  trustLevel: MarketSourceTrustLevel | string | null | undefined;
  usefulFeedbackCount?: number;
  actionedReviewCount?: number;
  wrongLinkFeedbackCount?: number;
  irrelevantFeedbackCount?: number;
  dismissedCount?: number;
  duplicateCount?: number;
  staleSignalCount?: number;
  zeroLinkSignalCount?: number;
  failedRunCount?: number;
};

export type SourceQualitySummary = {
  sourceId: string;
  name: string;
  sourceCategory: string;
  trustLevel: string;
  enabled: boolean;
  fetchType: string;
  allowedDomains: string[];
  score: number;
  scoreBand: "excellent" | "good" | "watch" | "poor";
  components: Record<string, number>;
  objectCount: number;
  signalCount: number;
  zeroLinkSignalCount: number;
  staleSignalCount: number;
  usefulFeedbackCount: number;
  actionedReviewCount: number;
  wrongLinkFeedbackCount: number;
  irrelevantFeedbackCount: number;
  dismissedCount: number;
  duplicateCount: number;
  failedRunCount: number;
  runCount: number;
  lastRunAt: Date | null;
  sourceObjectIds: string[];
};

export type SourceQualityLookup = {
  bySourceId: Map<string, SourceQualitySummary>;
  bySourceObjectId: Map<string, SourceQualitySummary>;
};

const TRUST_BASE: Record<string, number> = {
  OFFICIAL: 86,
  PARTNER: 78,
  INDUSTRY: 72,
  TRUSTED: 70,
  INTERNAL: 65,
  NEWS: 58,
  MANUAL: 55,
  EXTERNAL: 45,
  LOW: 30,
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function hash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);
}

function asRecord(value: Prisma.JsonValue | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sourceIdFromExternalId(value: string | null | undefined) {
  const match = value?.match(/^market:([^:]+)/);
  return match?.[1] ?? null;
}

function sourceIdFromObject(object: {
  sourceExternalId?: string | null;
  payload?: Prisma.JsonValue | null;
  source?: { externalId: string | null; metadata: Prisma.JsonValue | null } | null;
} | null | undefined) {
  const sourceMetadata = asRecord(object?.source?.metadata);
  const payload = asRecord(object?.payload);
  const metadataSourceId = typeof sourceMetadata.sourceId === "string" ? sourceMetadata.sourceId : null;
  const payloadSourceId = typeof payload.sourceId === "string" ? payload.sourceId : null;
  return metadataSourceId
    ?? payloadSourceId
    ?? sourceIdFromExternalId(object?.sourceExternalId)
    ?? sourceIdFromExternalId(object?.source?.externalId);
}

function band(score: number): SourceQualitySummary["scoreBand"] {
  if (score >= 82) return "excellent";
  if (score >= 68) return "good";
  if (score >= 50) return "watch";
  return "poor";
}

export function getSourceQualityScore(input: SourceQualityScoreInput) {
  const base = TRUST_BASE[String(input.trustLevel ?? "EXTERNAL").toUpperCase()] ?? TRUST_BASE.EXTERNAL;
  const components = {
    trustBase: base,
    usefulFeedback: (input.usefulFeedbackCount ?? 0) * 4,
    actionedReviews: (input.actionedReviewCount ?? 0) * 5,
    wrongLinks: -(input.wrongLinkFeedbackCount ?? 0) * 8,
    irrelevantFeedback: -(input.irrelevantFeedbackCount ?? 0) * 5,
    dismissedReviews: -(input.dismissedCount ?? 0) * 3,
    duplicates: -(input.duplicateCount ?? 0) * 4,
    staleSignals: -(input.staleSignalCount ?? 0) * 2,
    zeroLinkSignals: -(input.zeroLinkSignalCount ?? 0) * 3,
    failedRuns: -(input.failedRunCount ?? 0) * 4,
  };
  const score = clamp(Object.values(components).reduce((sum, value) => sum + value, 0));
  return { score, scoreBand: band(score), components };
}

function emptySummary(source: MarketIntelligenceSourceDefinition): SourceQualitySummary {
  const scored = getSourceQualityScore({ trustLevel: source.trustLevel });
  return {
    sourceId: source.id,
    name: source.name,
    sourceCategory: source.sourceCategory,
    trustLevel: source.trustLevel,
    enabled: source.enabled,
    fetchType: source.fetchType,
    allowedDomains: source.allowedDomains,
    score: scored.score,
    scoreBand: scored.scoreBand,
    components: scored.components,
    objectCount: 0,
    signalCount: 0,
    zeroLinkSignalCount: 0,
    staleSignalCount: 0,
    usefulFeedbackCount: 0,
    actionedReviewCount: 0,
    wrongLinkFeedbackCount: 0,
    irrelevantFeedbackCount: 0,
    dismissedCount: 0,
    duplicateCount: 0,
    failedRunCount: 0,
    runCount: 0,
    lastRunAt: null,
    sourceObjectIds: [],
  };
}

export function buildSourceQualityLookup(summaries: SourceQualitySummary[]): SourceQualityLookup {
  const bySourceId = new Map<string, SourceQualitySummary>();
  const bySourceObjectId = new Map<string, SourceQualitySummary>();
  for (const summary of summaries) {
    bySourceId.set(summary.sourceId, summary);
    for (const objectId of summary.sourceObjectIds) bySourceObjectId.set(objectId, summary);
  }
  return { bySourceId, bySourceObjectId };
}

export async function listSourceQualitySummaries(input: {
  officeId: string;
  sources?: MarketIntelligenceSourceDefinition[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const registry = input.sources ?? getMarketIntelligenceSourceRegistry();
  const summaries = new Map(registry.map((source) => [source.id, emptySummary(source)]));

  const [objects, signals, runs] = await Promise.all([
    prisma.knowledgeObject.findMany({
      where: { officeId: input.officeId, sourceType: "MARKET", canonicalType: "market_update" },
      select: {
        id: true,
        sourceExternalId: true,
        payload: true,
        source: { select: { externalId: true, metadata: true } },
      },
      take: 5000,
    }).catch(() => []),
    prisma.marketSignal.findMany({
      where: { officeId: input.officeId },
      include: {
        links: { select: { id: true } },
        feedback: { select: { feedbackKind: true } },
        impactReviews: { select: { status: true, impactLevel: true } },
        sourceObject: {
          select: {
            id: true,
            sourceExternalId: true,
            payload: true,
            source: { select: { externalId: true, metadata: true } },
          },
        },
      },
      take: 5000,
    }).catch(() => []),
    prisma.marketIngestionRun.findMany({
      where: { officeId: input.officeId },
      select: { sourceId: true, status: true, createdAt: true },
      take: 5000,
    }).catch(() => []),
  ]);

  for (const object of objects) {
    const sourceId = sourceIdFromObject(object);
    if (!sourceId) continue;
    const summary = summaries.get(sourceId);
    if (!summary) continue;
    summary.objectCount += 1;
    summary.sourceObjectIds.push(object.id);
  }

  const duplicateKeys = new Map<string, number>();
  for (const signal of signals) {
    const sourceId = sourceIdFromObject(signal.sourceObject);
    if (!sourceId) continue;
    const summary = summaries.get(sourceId);
    if (!summary) continue;
    summary.signalCount += 1;
    if (signal.sourceObject?.id && !summary.sourceObjectIds.includes(signal.sourceObject.id)) {
      summary.sourceObjectIds.push(signal.sourceObject.id);
    }
    if (signal.links.length === 0) summary.zeroLinkSignalCount += 1;
    if (signal.effectiveTo && signal.effectiveTo < now) summary.staleSignalCount += 1;
    for (const feedback of signal.feedback) {
      if (feedback.feedbackKind === "useful") summary.usefulFeedbackCount += 1;
      if (feedback.feedbackKind === "wrong_link") summary.wrongLinkFeedbackCount += 1;
      if (feedback.feedbackKind === "irrelevant") summary.irrelevantFeedbackCount += 1;
      if (feedback.feedbackKind === "duplicate") summary.duplicateCount += 1;
    }
    for (const review of signal.impactReviews) {
      if (review.status === "actioned") summary.actionedReviewCount += 1;
      if (review.status === "dismissed") summary.dismissedCount += 1;
    }
    const dupKey = `${sourceId}:${signal.sourceObjectId ?? "none"}:${signal.category}:${hash(signal.summary)}`;
    duplicateKeys.set(dupKey, (duplicateKeys.get(dupKey) ?? 0) + 1);
  }

  for (const [key, count] of duplicateKeys.entries()) {
    if (count <= 1) continue;
    const sourceId = key.split(":")[0];
    const summary = summaries.get(sourceId);
    if (summary) summary.duplicateCount += count - 1;
  }

  for (const run of runs) {
    const sourceId = run.sourceId ?? "unknown";
    const summary = summaries.get(sourceId);
    if (!summary) continue;
    summary.runCount += 1;
    if (run.status === "failed") summary.failedRunCount += 1;
    if (!summary.lastRunAt || run.createdAt > summary.lastRunAt) summary.lastRunAt = run.createdAt;
  }

  for (const summary of summaries.values()) {
    summary.sourceObjectIds = [...new Set(summary.sourceObjectIds)];
    const scored = getSourceQualityScore(summary);
    summary.score = scored.score;
    summary.scoreBand = scored.scoreBand;
    summary.components = scored.components;
  }

  return [...summaries.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function severityRank(value: string | null | undefined) {
  if (value === "critical") return 4;
  if (value === "high") return 3;
  if (value === "medium") return 2;
  if (value === "low") return 1;
  return 0;
}

export function impactRank(value: string | null | undefined) {
  return severityRank(value);
}

function recencyScore(value: Date | string | null | undefined, now = new Date()) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
  return Math.max(0, 20 - Math.min(20, ageDays));
}

function sourceScore(lookup: SourceQualityLookup | undefined, sourceObjectId: string | null | undefined) {
  if (!lookup || !sourceObjectId) return 45;
  return lookup.bySourceObjectId.get(sourceObjectId)?.score ?? 45;
}

export function rankMarketSignals<T extends {
  sourceObjectId?: string | null;
  severity: string;
  confidence: number;
  createdAt: Date;
  links?: unknown[];
  impactReviews?: Array<{ status: string }>;
}>(signals: T[], lookup?: SourceQualityLookup, now = new Date()) {
  return [...signals].sort((a, b) => {
    const aLinks = a.links?.length ?? 0;
    const bLinks = b.links?.length ?? 0;
    const aPending = a.impactReviews?.filter((review) => review.status === "pending").length ?? 0;
    const bPending = b.impactReviews?.filter((review) => review.status === "pending").length ?? 0;
    const aScore = severityRank(a.severity) * 120 + sourceScore(lookup, a.sourceObjectId) + aLinks * 8 + aPending * 10 + a.confidence * 20 + recencyScore(a.createdAt, now);
    const bScore = severityRank(b.severity) * 120 + sourceScore(lookup, b.sourceObjectId) + bLinks * 8 + bPending * 10 + b.confidence * 20 + recencyScore(b.createdAt, now);
    return bScore - aScore;
  });
}

export function rankMarketImpactReviews<T extends {
  status: string;
  impactLevel: string;
  createdAt: Date;
  linkedEntityType: string;
  marketSignal: { sourceObjectId?: string | null; severity: string; confidence?: number | null };
  marketSignalLink?: { confidence: number } | null;
}>(reviews: T[], lookup?: SourceQualityLookup, now = new Date()) {
  return [...reviews].sort((a, b) => {
    const pending = (review: T) => review.status === "pending" ? 80 : review.status === "acknowledged" ? 30 : 0;
    const activeWork = (review: T) => ["job", "inquiry", "company"].includes(review.linkedEntityType) ? 30 : 10;
    const score = (review: T) =>
      pending(review)
      + impactRank(review.impactLevel) * 120
      + severityRank(review.marketSignal.severity) * 30
      + sourceScore(lookup, review.marketSignal.sourceObjectId)
      + activeWork(review)
      + (review.marketSignalLink?.confidence ?? review.marketSignal.confidence ?? 0) * 20
      + recencyScore(review.createdAt, now);
    return score(b) - score(a);
  });
}

export function rankResearchFeedItems<T extends {
  id: string;
  occurredAt: Date;
  marketSignals?: Array<{ severity: string; links?: unknown[]; impactReviews?: Array<{ status: string }> }>;
}>(items: T[], lookup?: SourceQualityLookup, now = new Date()) {
  return [...items].sort((a, b) => {
    const score = (item: T) => {
      const quality = sourceScore(lookup, item.id);
      const signals = item.marketSignals ?? [];
      const signalScore = signals.reduce((sum, signal) => {
        const pending = signal.impactReviews?.filter((review) => review.status === "pending").length ?? 0;
        return sum + severityRank(signal.severity) * 30 + (signal.links?.length ?? 0) * 5 + pending * 12;
      }, 0);
      return quality + signalScore + recencyScore(item.occurredAt, now);
    };
    return score(b) - score(a);
  });
}
