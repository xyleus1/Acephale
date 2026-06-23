import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ingestKnowledgeObject } from "@/lib/memory/ingest-object";
import { recordMemoryEvent } from "@/lib/memory/record-event";
import { toMemoryJson } from "@/lib/memory/record-event";
import { extractMarketSignals, type MarketSignalCandidate } from "./extract-market-signals";
import { linkMarketSignalToBusinessObjects } from "./link-market-signals";
import { generateMarketImpactReviews } from "./market-impact-review";
import type { MarketIntelligenceSourceDefinition } from "./source-registry";
import {
  extractCleanEvidenceText,
  scoreMarketContentQuality,
} from "./content-hygiene";

export type MarketSourceItem = {
  externalId?: string | null;
  url?: string | null;
  title: string;
  content: string;
  publishedAt?: Date | string | null;
  author?: string | null;
};

export type IngestMarketObjectInput = {
  officeId: string;
  source: MarketIntelligenceSourceDefinition;
  item: MarketSourceItem;
  strict?: boolean;
};

function hash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function compact(text: string | null | undefined, max = 8000) {
  return text?.replace(/\s+/g, " ").trim().slice(0, max) ?? "";
}

function stableItemId(source: MarketIntelligenceSourceDefinition, item: MarketSourceItem) {
  const stable = item.externalId?.trim() || item.url?.trim() || hash({ title: item.title, content: compact(item.content, 1500) }).slice(0, 32);
  return `market:${source.id}:${stable}`.slice(0, 500);
}

function signalDedupeKey(sourceObjectId: string, candidate: MarketSignalCandidate) {
  return hash({
    sourceObjectId,
    category: candidate.category,
    summary: candidate.summary,
    affectedModes: candidate.affectedModes,
    affectedOrigins: candidate.affectedOrigins,
    affectedDestinations: candidate.affectedDestinations,
    affectedLanes: candidate.affectedLanes,
  }).slice(0, 64);
}

function signalText(candidate: MarketSignalCandidate) {
  return [
    candidate.summary,
    `Category: ${candidate.category}`,
    `Severity: ${candidate.severity}`,
    candidate.affectedLanes.length ? `Lanes: ${candidate.affectedLanes.join(", ")}` : null,
    candidate.affectedModes.length ? `Modes: ${candidate.affectedModes.join(", ")}` : null,
    candidate.operatorImplication,
    candidate.pricingImplication,
    candidate.customerImpact,
    ...(candidate.recommendedActions ?? []),
  ].filter(Boolean).join("\n");
}

export async function persistMarketSignalCandidate(args: {
  officeId: string;
  source: MarketIntelligenceSourceDefinition;
  sourceObjectId: string;
  sourceExternalId: string;
  candidate: MarketSignalCandidate;
  strict?: boolean;
}) {
  const dedupeKey = signalDedupeKey(args.sourceObjectId, args.candidate);
  const provenance = {
    source: "market_intelligence",
    operation: "extract_market_signal",
    path: "src/lib/market-intelligence/ingest-market-object.ts",
    function: "persistMarketSignalCandidate",
    sourceRecordId: args.sourceObjectId,
    sourceExternalId: args.sourceExternalId,
  };
  const payload = {
    ...args.candidate,
    sourceObjectId: args.sourceObjectId,
    sourceExternalId: args.sourceExternalId,
    sourceId: args.source.id,
    sourceName: args.source.name,
    trustLevel: args.source.trustLevel,
  };

  const signal = await prisma.marketSignal.upsert({
    where: {
      officeId_dedupeKey: {
        officeId: args.officeId,
        dedupeKey,
      },
    },
    update: {
      sourceObjectId: args.sourceObjectId,
      category: args.candidate.category,
      severity: args.candidate.severity,
      confidence: args.candidate.confidence,
      affectedModes: toMemoryJson(args.candidate.affectedModes),
      affectedOrigins: toMemoryJson(args.candidate.affectedOrigins),
      affectedDestinations: toMemoryJson(args.candidate.affectedDestinations),
      affectedPorts: toMemoryJson(args.candidate.affectedPorts),
      affectedLanes: toMemoryJson(args.candidate.affectedLanes),
      affectedCarriers: toMemoryJson(args.candidate.affectedCarriers),
      effectiveFrom: args.candidate.effectiveFrom ?? null,
      effectiveTo: args.candidate.effectiveTo ?? null,
      summary: args.candidate.summary,
      operatorImplication: args.candidate.operatorImplication ?? null,
      pricingImplication: args.candidate.pricingImplication ?? null,
      customerImpact: args.candidate.customerImpact ?? null,
      recommendedActions: toMemoryJson(args.candidate.recommendedActions),
      sourceRefs: toMemoryJson(args.candidate.sourceRefs),
      payloadVersion: 1,
      provenance: toMemoryJson(provenance),
    },
    create: {
      officeId: args.officeId,
      sourceObjectId: args.sourceObjectId,
      category: args.candidate.category,
      severity: args.candidate.severity,
      confidence: args.candidate.confidence,
      affectedModes: toMemoryJson(args.candidate.affectedModes),
      affectedOrigins: toMemoryJson(args.candidate.affectedOrigins),
      affectedDestinations: toMemoryJson(args.candidate.affectedDestinations),
      affectedPorts: toMemoryJson(args.candidate.affectedPorts),
      affectedLanes: toMemoryJson(args.candidate.affectedLanes),
      affectedCarriers: toMemoryJson(args.candidate.affectedCarriers),
      effectiveFrom: args.candidate.effectiveFrom ?? null,
      effectiveTo: args.candidate.effectiveTo ?? null,
      summary: args.candidate.summary,
      operatorImplication: args.candidate.operatorImplication ?? null,
      pricingImplication: args.candidate.pricingImplication ?? null,
      customerImpact: args.candidate.customerImpact ?? null,
      recommendedActions: toMemoryJson(args.candidate.recommendedActions),
      sourceRefs: toMemoryJson(args.candidate.sourceRefs),
      dedupeKey,
      payloadVersion: 1,
      provenance: toMemoryJson(provenance),
    },
    select: { id: true, createdAt: true },
  });

  const signalObject = await ingestKnowledgeObject({
    officeId: args.officeId,
    sourceType: "MARKET",
    sourceExternalId: `market:signal:${dedupeKey}`,
    sourceLabel: args.source.name,
    sourceMetadata: { sourceId: args.source.id, trustLevel: args.source.trustLevel },
    canonicalType: "market_signal",
    title: args.candidate.summary,
    text: signalText(args.candidate),
    entityType: "market_signal",
    entityId: signal.id,
    occurredAt: args.candidate.effectiveFrom ?? signal.createdAt,
    payloadVersion: 1,
    payload: { ...payload, marketSignalId: signal.id },
    provenance,
    mentions: [
      { entityType: "market_signal", entityId: signal.id, label: args.candidate.summary, confidence: args.candidate.confidence },
    ],
    strict: args.strict,
  }).catch((error) => {
    if (args.strict) throw error;
    return null;
  });

  await recordMemoryEvent({
    officeId: args.officeId,
    sourceType: "MARKET",
    sourceExternalId: `market:signal:${dedupeKey}`,
    sourceLabel: args.source.name,
    objectId: signalObject?.id ?? args.sourceObjectId,
    eventType: "market.signal.detected",
    entityType: "market_signal",
    entityId: signal.id,
    actorType: "system",
    actorId: null,
    occurredAt: args.candidate.effectiveFrom ?? signal.createdAt,
    payloadVersion: 1,
    payload: { ...payload, marketSignalId: signal.id, signalObjectId: signalObject?.id ?? null },
    provenance,
    idempotencyKey: `market:signal:${dedupeKey}:detected`,
    strict: args.strict,
  }).catch((error) => {
    if (args.strict) throw error;
    return null;
  });

  const links = await linkMarketSignalToBusinessObjects({
    officeId: args.officeId,
    signalId: signal.id,
    strict: args.strict,
  });
  const reviews = await generateMarketImpactReviews({
    officeId: args.officeId,
    marketSignalId: signal.id,
    strict: args.strict,
  });

  return { signalId: signal.id, signalObjectId: signalObject?.id ?? null, dedupeKey, links, reviews };
}

export async function ingestMarketObject(input: IngestMarketObjectInput) {
  const sourceExternalId = stableItemId(input.source, input.item);
  const occurredAt = asDate(input.item.publishedAt);
  const hygiene = scoreMarketContentQuality({
    title: input.item.title,
    content: input.item.content,
    url: input.item.url ?? input.source.url,
    source: input.source,
    publishedAt: input.item.publishedAt ?? null,
  });
  const cleanEvidenceText = extractCleanEvidenceText({
    title: input.item.title,
    content: input.item.content,
    url: input.item.url ?? input.source.url,
    source: input.source,
    publishedAt: input.item.publishedAt ?? null,
  });
  const provenance = {
    source: "market_intelligence",
    operation: "ingest_market_update",
    path: "src/lib/market-intelligence/ingest-market-object.ts",
    function: "ingestMarketObject",
    sourceRecordId: input.item.externalId ?? input.item.url ?? sourceExternalId,
    sourceExternalId,
    pageType: hygiene.pageType,
    contentQualityScore: hygiene.contentQualityScore,
    extractionStatus: hygiene.extractionStatus,
  };
  const payload = {
    sourceId: input.source.id,
    sourceName: input.source.name,
    trustLevel: input.source.trustLevel,
    sourceCategory: input.source.sourceCategory,
    defaultCategories: input.source.defaultCategories,
    defaultAffectedModes: input.source.defaultAffectedModes,
    url: input.item.url ?? null,
    title: input.item.title,
    author: input.item.author ?? null,
    publishedAt: occurredAt,
    contentHash: hash(input.item.content),
    pageType: hygiene.pageType,
    contentQualityScore: hygiene.contentQualityScore,
    extractionStatus: hygiene.extractionStatus,
    extractionRejectionReason: hygiene.rejectionReason,
    extractionRejectionReasons: hygiene.reasons,
    contentHygiene: {
      pageType: hygiene.pageType,
      contentQualityScore: hygiene.contentQualityScore,
      eligibleForSignals: hygiene.eligibleForSignals,
      extractionStatus: hygiene.extractionStatus,
      rejectionReason: hygiene.rejectionReason,
      reasons: hygiene.reasons,
      metrics: hygiene.metrics,
    },
  };

  const object = await ingestKnowledgeObject({
    officeId: input.officeId,
    sourceType: "MARKET",
    sourceExternalId,
    sourceLabel: input.source.name,
    sourceMetadata: {
      sourceId: input.source.id,
      trustLevel: input.source.trustLevel,
      sourceCategory: input.source.sourceCategory,
      defaultCategories: input.source.defaultCategories,
      defaultAffectedModes: input.source.defaultAffectedModes,
      fetchType: input.source.fetchType,
      url: input.source.url,
      termsPolicyNotes: input.source.termsPolicyNotes ?? null,
    },
    canonicalType: "market_update",
    title: input.item.title,
    text: [input.item.title, compact(cleanEvidenceText || input.item.content)].filter(Boolean).join("\n"),
    rawRef: input.item.url ?? input.source.url ?? null,
    entityType: "market_update",
    entityId: sourceExternalId,
    occurredAt,
    payloadVersion: 1,
    payload,
    provenance,
    mentions: [{ entityType: "market_update", entityId: sourceExternalId, label: input.item.title, confidence: 1 }],
    strict: input.strict,
  });

  if (!object) return { objectId: null, sourceExternalId, signals: [] };

  await recordMemoryEvent({
    officeId: input.officeId,
    sourceType: "MARKET",
    sourceExternalId,
    sourceLabel: input.source.name,
    objectId: object.id,
    eventType: "market.update.ingested",
    entityType: "market_update",
    entityId: sourceExternalId,
    occurredAt,
    payloadVersion: 1,
    payload,
    provenance,
    idempotencyKey: `${sourceExternalId}:ingested`,
    strict: input.strict,
  }).catch((error) => {
    if (input.strict) throw error;
    return null;
  });

  if (!hygiene.eligibleForSignals) {
    await recordMemoryEvent({
      officeId: input.officeId,
      sourceType: "MARKET",
      sourceExternalId,
      sourceLabel: input.source.name,
      objectId: object.id,
      eventType: "market.update.extraction_skipped",
      entityType: "market_update",
      entityId: sourceExternalId,
      occurredAt,
      payloadVersion: 1,
      payload: {
        ...payload,
        skipped: true,
        reason: hygiene.rejectionReason,
      },
      provenance: {
        ...provenance,
        operation: "skip_market_signal_extraction",
        function: "ingestMarketObject",
      },
      idempotencyKey: `${sourceExternalId}:extraction_skipped:${hygiene.rejectionReason ?? "unknown"}`,
      strict: input.strict,
    }).catch((error) => {
      if (input.strict) throw error;
      return null;
    });
    return { objectId: object.id, sourceExternalId, signals: [], extractionSkipped: true, hygiene };
  }

  const sourceRefs = [`KnowledgeObject:${object.id}`];
  const candidates = extractMarketSignals({
    title: input.item.title,
    content: cleanEvidenceText,
    sourceId: input.source.id,
    sourceCategory: input.source.sourceCategory,
    defaultCategory: input.source.defaultCategory,
    defaultAffectedModes: input.source.defaultAffectedModes,
    sourceRefs,
    publishedAt: occurredAt,
  });
  const signals = [];
  for (const candidate of candidates) {
    signals.push(await persistMarketSignalCandidate({
      officeId: input.officeId,
      source: input.source,
      sourceObjectId: object.id,
      sourceExternalId,
      candidate,
      strict: input.strict,
    }));
  }

  return { objectId: object.id, sourceExternalId, signals };
}

export type MarketSignalWithLinks = Prisma.MarketSignalGetPayload<{
  include: { links: true; sourceObject: { select: { id: true; title: true; sourceType: true; sourceExternalId: true; occurredAt: true } } };
}>;
