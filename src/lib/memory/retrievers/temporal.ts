import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canonicalTypesForSearch } from "../canonical-types";
import type { MemoryEvidenceRef } from "../evidence";
import { compactMemoryText, excerptAroundQuery } from "../relevance";
import {
  memoryOperationalScopeMetadata,
  type HybridMemorySearchInput,
  type HybridMemorySearchResult,
} from "./types";
import { linkedMemoryObjectBelongsToOffice, memoryEventWhere } from "./lexical";
import { filterRoutedMemoryCandidates } from "./routed-email";

const DEFAULT_NEIGHBORHOOD_MS = 3 * 24 * 60 * 60 * 1_000;
const MAX_ANCHORS = 12;

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function boundDate(date: Date, deltaMs: number) {
  return new Date(date.getTime() + deltaMs);
}

function anchorIdentity(anchor: HybridMemorySearchResult): Prisma.MemoryEventWhereInput | null {
  const exact: Prisma.MemoryEventWhereInput[] = [];
  if (anchor.eventId) exact.push({ id: anchor.eventId });
  if (anchor.objectId) exact.push({ objectId: anchor.objectId });
  if (anchor.entityType && anchor.entityId) {
    exact.push({ entityType: anchor.entityType, entityId: anchor.entityId });
  }
  return exact.length ? { OR: exact } : null;
}

export async function retrieveTemporalMemory(input: {
  search: HybridMemorySearchInput;
  anchors: HybridMemorySearchResult[];
  limit: number;
  neighborhoodMs?: number;
}): Promise<HybridMemorySearchResult[]> {
  const neighborhoodMs = Math.max(60_000, input.neighborhoodMs ?? DEFAULT_NEIGHBORHOOD_MS);
  const fromFilter = asDate(input.search.dateRange?.from);
  const toFilter = asDate(input.search.dateRange?.to);
  const anchorClauses: Prisma.MemoryEventWhereInput[] = [];

  for (const anchor of input.anchors.slice(0, MAX_ANCHORS)) {
    const identity = anchorIdentity(anchor);
    if (!identity) continue;
    const from = boundDate(anchor.occurredAt, -neighborhoodMs);
    const to = boundDate(anchor.occurredAt, neighborhoodMs);
    const boundedFrom = fromFilter && fromFilter > from ? fromFilter : from;
    const boundedTo = toFilter && toFilter < to ? toFilter : to;
    if (boundedFrom > boundedTo) continue;
    anchorClauses.push({
      AND: [identity, { occurredAt: { gte: boundedFrom, lte: boundedTo } }],
    });
  }
  if (!anchorClauses.length) return [];

  const canonicalTypes = canonicalTypesForSearch(input.search.canonicalTypes ?? []);
  const events = await prisma.memoryEvent.findMany({
    where: {
      ...memoryEventWhere(input.search, false),
      OR: anchorClauses,
      ...(canonicalTypes.length
        ? { object: { is: { canonicalType: { in: canonicalTypes } } } }
        : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: Math.min(250, Math.max(input.limit * 4, 25)),
    include: {
      object: {
        select: {
          id: true,
          officeId: true,
          canonicalType: true,
          title: true,
          sourceType: true,
          sourceExternalId: true,
          entityType: true,
          entityId: true,
          companyId: true,
          jobId: true,
          inquiryId: true,
          emailThreadId: true,
          occurredAt: true,
          chunks: {
            where: { officeId: input.search.officeId },
            orderBy: { ordinal: "asc" },
            take: 1,
            select: { id: true, text: true },
          },
        },
      },
    },
  }).catch(() => []);

  const scopedEvents = events.filter((event) =>
    linkedMemoryObjectBelongsToOffice(event, input.search.officeId));
  const admittedEvents = await filterRoutedMemoryCandidates(input.search.officeId, scopedEvents.map((event) => ({
    candidateId: event.id,
    sourceType: event.sourceType,
    canonicalType: event.object?.canonicalType ?? null,
    entityType: event.entityType,
    entityId: event.entityId,
    companyId: event.object?.companyId ?? null,
    emailThreadId: event.object?.emailThreadId ??
      (event.entityType === "email_thread" ? event.entityId : null),
  })), undefined, input.search.companyId);
  const admittedEventIds = new Set(admittedEvents.map((event) => event.candidateId));
  const admittedEventThreads = new Map(admittedEvents.map((event) => [
    event.candidateId,
    event.emailThreadId ?? null,
  ]));

  const anchorTimes = input.anchors.slice(0, MAX_ANCHORS).map((anchor) => anchor.occurredAt.getTime());
  const results = scopedEvents.filter((event) => admittedEventIds.has(event.id)).map((event): HybridMemorySearchResult => {
    const object = event.object;
    const eventText = [
      event.eventType,
      event.sourceExternalId,
      event.entityType,
      event.entityId,
      object?.title,
      object?.chunks[0]?.text,
      compactMemoryText(JSON.stringify(event.payload), 800),
    ].filter(Boolean).join("\n");
    const distanceMs = Math.min(...anchorTimes.map((time) => Math.abs(event.occurredAt.getTime() - time)));
    const evidence: MemoryEvidenceRef[] = [
      {
        refType: "memory_event",
        memoryEventId: event.id,
        knowledgeObjectId: event.objectId,
        entityType: event.entityType,
        entityId: event.entityId,
        sourceType: event.sourceType,
        sourceExternalId: event.sourceExternalId,
        canonicalType: object?.canonicalType ?? null,
        title: object?.title ?? event.eventType,
        occurredAt: event.occurredAt,
      },
      ...(object ? [{
        refType: "knowledge_object" as const,
        knowledgeObjectId: object.id,
        entityType: object.entityType,
        entityId: object.entityId,
        sourceType: object.sourceType,
        sourceExternalId: object.sourceExternalId,
        canonicalType: object.canonicalType,
        title: object.title,
        occurredAt: object.occurredAt,
      }] : []),
      ...(object?.chunks[0] ? [{
        refType: "knowledge_chunk" as const,
        knowledgeObjectId: object.id,
        knowledgeChunkId: object.chunks[0].id,
        entityType: object.entityType,
        entityId: object.entityId,
        sourceType: object.sourceType,
        sourceExternalId: object.sourceExternalId,
        canonicalType: object.canonicalType,
        title: object.title,
        occurredAt: object.occurredAt,
      }] : []),
    ];
    return {
      officeId: input.search.officeId,
      kind: "event",
      objectId: event.objectId ?? object?.id ?? null,
      chunkId: object?.chunks[0]?.id ?? null,
      eventId: event.id,
      sourceType: event.sourceType,
      sourceExternalId: event.sourceExternalId,
      canonicalType: object?.canonicalType ?? null,
      title: object?.title ?? event.eventType,
      excerpt: excerptAroundQuery(eventText, input.search.query),
      // Used only to order this retriever list. Fusion never adds it to other scores.
      score: Math.max(0, neighborhoodMs - distanceMs),
      occurredAt: event.occurredAt,
      entityType: event.entityType,
      entityId: event.entityId,
      companyId: object?.companyId ?? null,
      jobId: object?.jobId ?? (event.entityType === "job" ? event.entityId : null),
      inquiryId: object?.inquiryId ?? (event.entityType === "inquiry" ? event.entityId : null),
      emailThreadId: admittedEventThreads.get(event.id) ?? object?.emailThreadId ??
        (event.entityType === "email_thread" ? event.entityId : null),
      ...memoryOperationalScopeMetadata(input.search),
      reasons: [`temporal_neighborhood:${Math.round(distanceMs / 60_000)}m`],
      evidence,
    };
  });

  return results
    .sort((left, right) => right.score - left.score || right.occurredAt.getTime() - left.occurredAt.getTime())
    .slice(0, input.limit);
}
