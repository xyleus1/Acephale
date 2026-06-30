import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canonicalTypesForSearch,
  normalizeCanonicalType,
  normalizeSourceType,
} from "./canonical-types";
import type { MemoryEvidenceRef } from "./evidence";
import {
  buildEvidenceRefs,
  formatEvidenceForAgent,
  formatEvidenceForUser,
} from "./evidence";
import {
  canonicalTypeBoost,
  compactMemoryText,
  entityScopeBoost,
  excerptAroundQuery,
  recencyBoost,
  sourceTypeBoost,
  textMatchScore,
  tokenizeMemoryQuery,
} from "./relevance";

export type HybridMemorySearchInput = {
  officeId: string;
  query?: string | null;
  companyId?: string | null;
  jobId?: string | null;
  inquiryId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  canonicalTypes?: string[] | null;
  sourceTypes?: string[] | null;
  dateRange?: {
    from?: Date | string | null;
    to?: Date | string | null;
  } | null;
  limit?: number | null;
  includeEvents?: boolean;
  includeChunks?: boolean;
};

export type HybridMemorySearchResult = {
  kind: "object" | "chunk" | "event";
  objectId: string | null;
  chunkId: string | null;
  eventId: string | null;
  sourceType: string | null;
  sourceExternalId: string | null;
  canonicalType: string | null;
  title: string | null;
  excerpt: string;
  score: number;
  occurredAt: Date;
  entityType: string | null;
  entityId: string | null;
  companyId: string | null;
  jobId: string | null;
  inquiryId: string | null;
  reasons: string[];
  evidence: MemoryEvidenceRef[];
};

function clampLimit(limit: number | null | undefined, fallback = 20) {
  return Math.max(1, Math.min(75, Math.floor(limit ?? fallback)));
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function textContainsClauses(query: string | null | undefined, fields: Array<"title" | "sourceExternalId" | "canonicalType" | "eventType" | "entityType" | "entityId">) {
  const q = query?.trim();
  if (!q) return [];
  const terms = uniqueNonEmpty([q, ...tokenizeMemoryQuery(q)]);
  return terms.flatMap((term) => fields.map((field) => ({
    [field]: { contains: term, mode: "insensitive" as const },
  })));
}

function chunkTextClauses(query: string | null | undefined) {
  const q = query?.trim();
  if (!q) return [];
  const terms = uniqueNonEmpty([q, ...tokenizeMemoryQuery(q)]);
  return terms.map((term) => ({ text: { contains: term, mode: "insensitive" as const } }));
}

function objectScopeClauses(input: HybridMemorySearchInput): Prisma.KnowledgeObjectWhereInput[] {
  const clauses: Prisma.KnowledgeObjectWhereInput[] = [];
  if (input.companyId) {
    clauses.push({
      OR: [
        { companyId: input.companyId },
        { entityType: "company", entityId: input.companyId },
        { mentions: { some: { officeId: input.officeId, entityType: "company", entityId: input.companyId } } },
      ],
    });
  }
  if (input.jobId) {
    clauses.push({
      OR: [
        { jobId: input.jobId },
        { entityType: "job", entityId: input.jobId },
        { mentions: { some: { officeId: input.officeId, entityType: "job", entityId: input.jobId } } },
      ],
    });
  }
  if (input.inquiryId) {
    clauses.push({
      OR: [
        { inquiryId: input.inquiryId },
        { entityType: "inquiry", entityId: input.inquiryId },
        { mentions: { some: { officeId: input.officeId, entityType: "inquiry", entityId: input.inquiryId } } },
      ],
    });
  }
  if (input.entityType && input.entityId) {
    clauses.push({
      OR: [
        { entityType: input.entityType, entityId: input.entityId },
        { mentions: { some: { officeId: input.officeId, entityType: input.entityType, entityId: input.entityId } } },
      ],
    });
  }
  return clauses;
}

function objectWhere(input: HybridMemorySearchInput, includeTextFilter: boolean): Prisma.KnowledgeObjectWhereInput {
  const canonicalTypes = canonicalTypesForSearch(input.canonicalTypes ?? []);
  const sourceTypes = uniqueNonEmpty((input.sourceTypes ?? []).map(normalizeSourceType));
  const from = asDate(input.dateRange?.from);
  const to = asDate(input.dateRange?.to);
  const and: Prisma.KnowledgeObjectWhereInput[] = objectScopeClauses(input);
  const textOr: Prisma.KnowledgeObjectWhereInput[] = [
    ...textContainsClauses(input.query, ["title", "sourceExternalId", "canonicalType"]),
    ...chunkTextClauses(input.query).map((clause) => ({ chunks: { some: clause } })),
    ...(input.query?.trim()
      ? uniqueNonEmpty([input.query.trim(), ...tokenizeMemoryQuery(input.query)]).map((term) => ({
          mentions: { some: { officeId: input.officeId, label: { contains: term, mode: "insensitive" as const } } },
        }))
      : []),
  ];
  if (includeTextFilter && textOr.length > 0) and.push({ OR: textOr });

  return {
    officeId: input.officeId,
    ...(canonicalTypes.length ? { canonicalType: { in: canonicalTypes } } : {}),
    ...(sourceTypes.length ? { sourceType: { in: sourceTypes } } : {}),
    ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

function eventScopeClauses(input: HybridMemorySearchInput): Prisma.MemoryEventWhereInput[] {
  const clauses: Prisma.MemoryEventWhereInput[] = [];
  if (input.companyId) {
    clauses.push({
      OR: [
        { entityType: "company", entityId: input.companyId },
        { object: { is: { companyId: input.companyId } } },
      ],
    });
  }
  if (input.jobId) {
    clauses.push({
      OR: [
        { entityType: "job", entityId: input.jobId },
        { object: { is: { jobId: input.jobId } } },
      ],
    });
  }
  if (input.inquiryId) {
    clauses.push({
      OR: [
        { entityType: "inquiry", entityId: input.inquiryId },
        { object: { is: { inquiryId: input.inquiryId } } },
      ],
    });
  }
  if (input.entityType && input.entityId) {
    clauses.push({ entityType: input.entityType, entityId: input.entityId });
  }
  return clauses;
}

function eventWhere(input: HybridMemorySearchInput): Prisma.MemoryEventWhereInput {
  const sourceTypes = uniqueNonEmpty((input.sourceTypes ?? []).map(normalizeSourceType));
  const from = asDate(input.dateRange?.from);
  const to = asDate(input.dateRange?.to);
  const and: Prisma.MemoryEventWhereInput[] = eventScopeClauses(input);
  const textOr: Prisma.MemoryEventWhereInput[] = [
    ...textContainsClauses(input.query, ["eventType", "sourceExternalId", "entityType", "entityId"]),
  ];
  if (input.query?.trim()) {
    textOr.push({ object: { is: { title: { contains: input.query.trim(), mode: "insensitive" } } } });
  }
  if (textOr.length > 0) and.push({ OR: textOr });

  return {
    officeId: input.officeId,
    ...(sourceTypes.length ? { sourceType: { in: sourceTypes } } : {}),
    ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

function evidenceForObject(object: {
  id: string;
  canonicalType: string;
  sourceType: string;
  sourceExternalId: string;
  title: string | null;
  entityType: string | null;
  entityId: string | null;
  occurredAt: Date;
}, chunkId?: string | null): MemoryEvidenceRef[] {
  return [
    {
      refType: "knowledge_object",
      knowledgeObjectId: object.id,
      entityType: object.entityType,
      entityId: object.entityId,
      sourceType: object.sourceType,
      sourceExternalId: object.sourceExternalId,
      canonicalType: object.canonicalType,
      title: object.title,
      occurredAt: object.occurredAt,
    },
    ...(chunkId ? [{
      refType: "knowledge_chunk" as const,
      knowledgeObjectId: object.id,
      knowledgeChunkId: chunkId,
      entityType: object.entityType,
      entityId: object.entityId,
      sourceType: object.sourceType,
      sourceExternalId: object.sourceExternalId,
      canonicalType: object.canonicalType,
      title: object.title,
      occurredAt: object.occurredAt,
    }] : []),
  ];
}

function scoreResult(args: {
  input: HybridMemorySearchInput;
  title?: string | null;
  excerpt?: string | null;
  sourceExternalId?: string | null;
  sourceType?: string | null;
  canonicalType?: string | null;
  occurredAt?: Date | null;
  resultCompanyId?: string | null;
  resultJobId?: string | null;
  resultInquiryId?: string | null;
  resultEntityType?: string | null;
  resultEntityId?: string | null;
  kind: "object" | "chunk" | "event";
}) {
  const query = args.input.query;
  const textScore =
    textMatchScore(args.title, query) +
    textMatchScore(args.excerpt, query) +
    textMatchScore(args.sourceExternalId, query);
  const sourceBoost = sourceTypeBoost(args.sourceType);
  const canonicalBoost = canonicalTypeBoost(args.canonicalType);
  const entityBoost = entityScopeBoost({
    companyId: args.input.companyId,
    jobId: args.input.jobId,
    inquiryId: args.input.inquiryId,
    entityType: args.input.entityType,
    entityId: args.input.entityId,
    resultCompanyId: args.resultCompanyId,
    resultJobId: args.resultJobId,
    resultInquiryId: args.resultInquiryId,
    resultEntityType: args.resultEntityType,
    resultEntityId: args.resultEntityId,
  });
  const recency = recencyBoost(args.occurredAt);
  const kindBoost = args.kind === "chunk" ? 10 : args.kind === "event" ? 7 : 5;
  const score = textScore + sourceBoost + canonicalBoost + entityBoost + recency + kindBoost;
  const reasons = [
    textScore > 0 ? `text_match:${textScore}` : null,
    sourceBoost > 0 ? `source:${args.sourceType ?? "unknown"}+${sourceBoost}` : null,
    canonicalBoost > 0 ? `canonical:${args.canonicalType ?? "unknown"}+${canonicalBoost}` : null,
    entityBoost > 0 ? `entity_scope+${entityBoost}` : null,
    recency > 0 ? `recency+${recency}` : null,
    `kind:${args.kind}+${kindBoost}`,
  ].filter((reason): reason is string => Boolean(reason));
  return { score, reasons };
}

export async function hybridSearchMemory(input: HybridMemorySearchInput) {
  const limit = clampLimit(input.limit);
  const take = Math.min(250, Math.max(limit * 8, 25));
  const q = input.query?.trim() || null;
  const includeEvents = input.includeEvents !== false;
  const includeChunks = input.includeChunks !== false;
  const baseObjectWhere = objectWhere(input, true);
  const scopeObjectWhere = objectWhere(input, false);

  const [objects, chunks, events] = await Promise.all([
    prisma.knowledgeObject.findMany({
      where: baseObjectWhere,
      orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
      take,
      include: {
        chunks: { orderBy: { ordinal: "asc" }, take: 2, select: { id: true, text: true, ordinal: true } },
        mentions: { take: 12, select: { entityType: true, entityId: true, label: true } },
      },
    }).catch(() => []),
    includeChunks
      ? prisma.knowledgeChunk.findMany({
          where: {
            officeId: input.officeId,
            object: scopeObjectWhere,
            ...(q ? { OR: chunkTextClauses(q) } : {}),
          },
          orderBy: [{ createdAt: "desc" }],
          take,
          include: {
            object: {
              select: {
                id: true,
                canonicalType: true,
                title: true,
                sourceType: true,
                sourceExternalId: true,
                entityType: true,
                entityId: true,
                companyId: true,
                jobId: true,
                inquiryId: true,
                occurredAt: true,
              },
            },
          },
        }).catch(() => [])
      : Promise.resolve([]),
    includeEvents
      ? prisma.memoryEvent.findMany({
          where: eventWhere(input),
          orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
          take,
          include: {
            object: {
              select: {
                id: true,
                canonicalType: true,
                title: true,
                sourceType: true,
                sourceExternalId: true,
                entityType: true,
                entityId: true,
                companyId: true,
                jobId: true,
                inquiryId: true,
                occurredAt: true,
                chunks: { orderBy: { ordinal: "asc" }, take: 1, select: { id: true, text: true } },
              },
            },
          },
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const results: HybridMemorySearchResult[] = [];

  for (const object of objects) {
    const text = [object.title, object.sourceExternalId, ...object.chunks.map((chunk) => chunk.text), ...object.mentions.map((mention) => mention.label)].filter(Boolean).join("\n");
    const excerpt = excerptAroundQuery(text, q);
    const scored = scoreResult({
      input,
      title: object.title,
      excerpt: text,
      sourceExternalId: object.sourceExternalId,
      sourceType: object.sourceType,
      canonicalType: object.canonicalType,
      occurredAt: object.occurredAt,
      resultCompanyId: object.companyId,
      resultJobId: object.jobId,
      resultInquiryId: object.inquiryId,
      resultEntityType: object.entityType,
      resultEntityId: object.entityId,
      kind: "object",
    });
    results.push({
      kind: "object",
      objectId: object.id,
      chunkId: object.chunks[0]?.id ?? null,
      eventId: null,
      sourceType: object.sourceType,
      sourceExternalId: object.sourceExternalId,
      canonicalType: object.canonicalType,
      title: object.title,
      excerpt,
      score: scored.score,
      occurredAt: object.occurredAt,
      entityType: object.entityType,
      entityId: object.entityId,
      companyId: object.companyId,
      jobId: object.jobId,
      inquiryId: object.inquiryId,
      reasons: scored.reasons,
      evidence: evidenceForObject(object, object.chunks[0]?.id ?? null),
    });
  }

  for (const chunk of chunks) {
    const object = chunk.object;
    const excerpt = excerptAroundQuery(chunk.text, q);
    const scored = scoreResult({
      input,
      title: object.title,
      excerpt: chunk.text,
      sourceExternalId: object.sourceExternalId,
      sourceType: object.sourceType,
      canonicalType: object.canonicalType,
      occurredAt: object.occurredAt,
      resultCompanyId: object.companyId,
      resultJobId: object.jobId,
      resultInquiryId: object.inquiryId,
      resultEntityType: object.entityType,
      resultEntityId: object.entityId,
      kind: "chunk",
    });
    results.push({
      kind: "chunk",
      objectId: object.id,
      chunkId: chunk.id,
      eventId: null,
      sourceType: object.sourceType,
      sourceExternalId: object.sourceExternalId,
      canonicalType: object.canonicalType,
      title: object.title,
      excerpt,
      score: scored.score,
      occurredAt: object.occurredAt,
      entityType: object.entityType,
      entityId: object.entityId,
      companyId: object.companyId,
      jobId: object.jobId,
      inquiryId: object.inquiryId,
      reasons: scored.reasons,
      evidence: evidenceForObject(object, chunk.id),
    });
  }

  for (const event of events) {
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
    const excerpt = excerptAroundQuery(eventText, q);
    const scored = scoreResult({
      input,
      title: object?.title ?? event.eventType,
      excerpt: eventText,
      sourceExternalId: event.sourceExternalId,
      sourceType: event.sourceType,
      canonicalType: object?.canonicalType ?? null,
      occurredAt: event.occurredAt,
      resultCompanyId: object?.companyId ?? null,
      resultJobId: object?.jobId ?? (event.entityType === "job" ? event.entityId : null),
      resultInquiryId: object?.inquiryId ?? (event.entityType === "inquiry" ? event.entityId : null),
      resultEntityType: event.entityType,
      resultEntityId: event.entityId,
      kind: "event",
    });
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
      ...(object ? evidenceForObject(object, object.chunks[0]?.id ?? null) : []),
    ];
    results.push({
      kind: "event",
      objectId: event.objectId ?? object?.id ?? null,
      chunkId: object?.chunks[0]?.id ?? null,
      eventId: event.id,
      sourceType: event.sourceType,
      sourceExternalId: event.sourceExternalId,
      canonicalType: object?.canonicalType ?? null,
      title: object?.title ?? event.eventType,
      excerpt,
      score: scored.score,
      occurredAt: event.occurredAt,
      entityType: event.entityType,
      entityId: event.entityId,
      companyId: object?.companyId ?? null,
      jobId: object?.jobId ?? (event.entityType === "job" ? event.entityId : null),
      inquiryId: object?.inquiryId ?? (event.entityType === "inquiry" ? event.entityId : null),
      reasons: scored.reasons,
      evidence,
    });
  }

  const deduped = new Map<string, HybridMemorySearchResult>();
  for (const result of results) {
    const key = result.eventId
      ? `event:${result.eventId}`
      : result.objectId
        ? `object:${result.objectId}`
        : `${result.kind}:${result.chunkId ?? result.title ?? result.sourceExternalId}`;
    const existing = deduped.get(key);
    if (!existing || result.score > existing.score) deduped.set(key, result);
  }

  const sorted = [...deduped.values()]
    .sort((a, b) => b.score - a.score || b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit);

  return {
    query: q,
    filters: {
      officeId: input.officeId,
      companyId: input.companyId ?? null,
      jobId: input.jobId ?? null,
      inquiryId: input.inquiryId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      canonicalTypes: input.canonicalTypes?.map(normalizeCanonicalType) ?? [],
      sourceTypes: input.sourceTypes?.map(normalizeSourceType) ?? [],
      dateRange: input.dateRange ?? null,
      includeEvents,
      includeChunks,
    },
    results: sorted,
    evidence: buildEvidenceRefs(sorted),
    evidence_for_agent: formatEvidenceForAgent(sorted),
    evidence_for_user: formatEvidenceForUser(sorted),
  };
}
