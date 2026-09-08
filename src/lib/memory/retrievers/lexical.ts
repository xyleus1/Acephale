import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canonicalTypesForSearch,
  normalizeCanonicalType,
  normalizeSourceType,
} from "../canonical-types";
import type { MemoryEvidenceRef } from "../evidence";
import {
  buildEvidenceRefs,
  formatEvidenceForAgent,
  formatEvidenceForUser,
} from "../evidence";
import {
  canonicalTypeBoost,
  compactMemoryText,
  entityScopeBoost,
  excerptAroundQuery,
  recencyBoost,
  sourceTypeBoost,
  textMatchScore,
  tokenizeMemoryQuery,
} from "../relevance";
import {
  memoryOperationalScopeMetadata,
  type HybridMemorySearchInput,
  type HybridMemorySearchResult,
} from "./types";
import { filterRoutedMemoryCandidates } from "./routed-email";

function clampLimit(limit: number | null | undefined, fallback = 20) {
  return Math.max(1, Math.min(75, Math.floor(limit ?? fallback)));
}

type LexicalMemoryReadDatabase = Pick<
  typeof prisma,
  "knowledgeObject" | "knowledgeChunk" | "entityMention" | "memoryEvent"
>;

export type LexicalMemoryDatabase = LexicalMemoryReadDatabase &
  Partial<Pick<typeof prisma, "$transaction">>;

const LEXICAL_REPEATABLE_READ_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 120_000,
  timeout: 600_000,
} as const;

function recoverLexicalReadError(error: unknown, strictReadErrors: boolean): never[] {
  if (strictReadErrors) throw error;
  return [];
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

type ExactEntityScope = {
  entityTypes: string[];
  entityId: string;
  directField?:
    | "companyId"
    | "inquiryId"
    | "jobId"
    | "emailThreadId"
    | "emailMessageId"
    | "jobDocumentId"
    | "strategyAssessmentId"
    | "agentProposalId";
};

const DIRECT_OBJECT_ENTITY_FIELDS: Record<string, ExactEntityScope["directField"]> = {
  company: "companyId",
  inquiry: "inquiryId",
  job: "jobId",
  email_thread: "emailThreadId",
  email_message: "emailMessageId",
  job_document: "jobDocumentId",
  strategy_assessment: "strategyAssessmentId",
  agent_proposal: "agentProposalId",
};

/** Exact aliases only. Labels and similar names never establish identity. */
export function exactEntityScopes(input: HybridMemorySearchInput): ExactEntityScope[] {
  const scopes: ExactEntityScope[] = [];
  const hasRequestOwner = Boolean(input.companyId || input.workspaceId);
  if (input.workspaceId) {
    scopes.push({ entityTypes: ["workspace", "supply_workspace"], entityId: input.workspaceId });
  }
  if (input.procurementOrderId && hasRequestOwner) {
    scopes.push({
      entityTypes: ["procurement_order", "procurement_request"],
      entityId: input.procurementOrderId,
    });
  }
  if (input.procurementVendorId && input.procurementOrderId && hasRequestOwner) {
    scopes.push({
      entityTypes: ["procurement_vendor", "order_supplier"],
      entityId: input.procurementVendorId,
    });
  }
  if (input.supplierKey && input.workspaceId) {
    scopes.push({
      // Supply supplier keys are workspace-local semantic keys. They are not
      // canonical Supplier ids or SupplySupplierProfile row ids.
      entityTypes: ["supplier_key"],
      entityId: input.supplierKey,
    });
  }
  if (input.itemId) {
    // Public itemId is the canonical app-owned Item.id. Snapshot SupplyItem
    // row ids are internal and must not be inferred from this identifier.
    scopes.push({ entityTypes: ["item"], entityId: input.itemId });
  }
  if (input.itemKey && input.workspaceId) {
    scopes.push({
      // Item keys are snapshot/workspace keys, not Item or SupplyItem row ids.
      entityTypes: ["item_key", "supply_item_key"],
      entityId: input.itemKey,
    });
  }
  if (input.entityType && input.entityId) {
    scopes.push({
      entityTypes: [input.entityType],
      entityId: input.entityId,
      ...(DIRECT_OBJECT_ENTITY_FIELDS[input.entityType]
        ? { directField: DIRECT_OBJECT_ENTITY_FIELDS[input.entityType] }
        : {}),
    });
  }
  return scopes;
}

function exactObjectScopeClause(
  input: HybridMemorySearchInput,
  scope: ExactEntityScope,
): Prisma.KnowledgeObjectWhereInput {
  const direct = scope.directField ? [{ [scope.directField]: scope.entityId }] : [];
  return {
    OR: [
      { entityType: { in: scope.entityTypes }, entityId: scope.entityId },
      {
        mentions: {
          some: {
            officeId: input.officeId,
            entityType: { in: scope.entityTypes },
            entityId: scope.entityId,
          },
        },
      },
      ...direct,
    ],
  };
}

type ExactScopeCandidates = {
  objectIds: string[];
  eventIds: string[];
};

function intersectCandidateIds(current: Set<string> | null, values: Set<string>) {
  if (!current) return new Set(values);
  return new Set([...current].filter((value) => values.has(value)));
}

/**
 * Resolve exact operational scopes before applying broad lexical OR predicates.
 *
 * The final reads retain their original predicates. These IDs are a redundant,
 * semantics-preserving restriction that lets PostgreSQL use exact B-tree
 * indexes before evaluating short-token ILIKE branches or relation EXISTS
 * branches. Each event scope is resolved as the same direct-event OR
 * linked-object union used by memoryEventWhere, then intersected across scopes.
 */
async function exactScopeCandidates(
  input: HybridMemorySearchInput,
  database: LexicalMemoryReadDatabase,
): Promise<ExactScopeCandidates | null> {
  const scopes = exactEntityScopes(input);
  if (scopes.length === 0) return null;

  let objectIds: Set<string> | null = null;
  let eventIds: Set<string> | null = null;

  for (const scope of scopes) {
    const directObjectClauses: Prisma.KnowledgeObjectWhereInput[] = [{
      entityType: { in: scope.entityTypes },
      entityId: scope.entityId,
    }];
    if (scope.directField) {
      directObjectClauses.push({ [scope.directField]: scope.entityId });
    }

    const [directObjects, mentions, directEvents] = await Promise.all([
      database.knowledgeObject.findMany({
        where: {
          officeId: input.officeId,
          OR: directObjectClauses,
        },
        select: { id: true },
      }),
      database.entityMention.findMany({
        where: {
          officeId: input.officeId,
          entityType: { in: scope.entityTypes },
          entityId: scope.entityId,
          objectId: { not: null },
        },
        select: { objectId: true },
      }),
      database.memoryEvent.findMany({
        where: {
          officeId: input.officeId,
          entityType: { in: scope.entityTypes },
          entityId: scope.entityId,
        },
        select: { id: true },
      }),
    ]);

    const scopeObjectIds = new Set<string>([
      ...directObjects.map((object) => object.id),
      ...mentions.flatMap((mention) => mention.objectId ? [mention.objectId] : []),
    ]);
    const linkedEvents = scopeObjectIds.size > 0
      ? await database.memoryEvent.findMany({
          where: {
            officeId: input.officeId,
            objectId: { in: [...scopeObjectIds] },
          },
          select: { id: true },
        })
      : [];
    const scopeEventIds = new Set<string>([
      ...directEvents.map((event) => event.id),
      ...linkedEvents.map((event) => event.id),
    ]);

    objectIds = intersectCandidateIds(objectIds, scopeObjectIds);
    eventIds = intersectCandidateIds(eventIds, scopeEventIds);
  }

  return {
    objectIds: [...(objectIds ?? [])].sort(),
    eventIds: [...(eventIds ?? [])].sort(),
  };
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
  for (const scope of exactEntityScopes(input)) clauses.push(exactObjectScopeClause(input, scope));
  return clauses;
}

export function memoryObjectWhere(
  input: HybridMemorySearchInput,
  includeTextFilter: boolean,
): Prisma.KnowledgeObjectWhereInput {
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
  for (const scope of exactEntityScopes(input)) {
    clauses.push({
      OR: [
        { entityType: { in: scope.entityTypes }, entityId: scope.entityId },
        { object: { is: exactObjectScopeClause(input, scope) } },
      ],
    });
  }
  return clauses;
}

export function memoryEventWhere(
  input: HybridMemorySearchInput,
  includeTextFilter: boolean,
): Prisma.MemoryEventWhereInput {
  const sourceTypes = uniqueNonEmpty((input.sourceTypes ?? []).map(normalizeSourceType));
  const from = asDate(input.dateRange?.from);
  const to = asDate(input.dateRange?.to);
  const and: Prisma.MemoryEventWhereInput[] = eventScopeClauses(input);
  and.push({
    OR: [
      { objectId: null },
      { object: { is: { officeId: input.officeId } } },
    ],
  });
  const textOr: Prisma.MemoryEventWhereInput[] = [
    ...textContainsClauses(input.query, ["eventType", "sourceExternalId", "entityType", "entityId"]),
  ];
  if (input.query?.trim()) {
    textOr.push({ object: { is: { title: { contains: input.query.trim(), mode: "insensitive" } } } });
  }
  if (includeTextFilter && textOr.length > 0) and.push({ OR: textOr });

  return {
    officeId: input.officeId,
    ...(sourceTypes.length ? { sourceType: { in: sourceTypes } } : {}),
    ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

export function linkedMemoryObjectBelongsToOffice(
  candidate: { object?: { officeId?: string | null } | null },
  officeId: string,
) {
  return !candidate.object || candidate.object.officeId === officeId;
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

async function lexicalSearchMemoryInSnapshot(
  input: HybridMemorySearchInput,
  database: LexicalMemoryReadDatabase,
) {
  const limit = clampLimit(input.limit);
  const take = Math.min(250, Math.max(limit * 8, 25));
  const q = input.query?.trim() || null;
  const includeEvents = input.includeEvents !== false;
  const includeChunks = input.includeChunks !== false;
  const baseObjectWhere = memoryObjectWhere(input, true);
  const scopeObjectWhere = memoryObjectWhere(input, false);
  let exactCandidates: ExactScopeCandidates | null = null;
  try {
    exactCandidates = await exactScopeCandidates(input, database);
  } catch (error) {
    if (input.strictReadErrors === true) throw error;
  }

  const exactObjectIds = exactCandidates?.objectIds ?? null;
  const exactEventIds = exactCandidates?.eventIds ?? null;
  const finalObjectWhere: Prisma.KnowledgeObjectWhereInput = exactObjectIds
    ? { AND: [baseObjectWhere, { id: { in: exactObjectIds } }] }
    : baseObjectWhere;

  const [objects, chunks, events] = await Promise.all([
    exactObjectIds?.length === 0
      ? Promise.resolve([])
      : database.knowledgeObject.findMany({
          where: finalObjectWhere,
          orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
          take,
          include: {
            chunks: {
              where: { officeId: input.officeId },
              orderBy: [{ ordinal: "asc" }, { id: "asc" }],
              take: 2,
              select: { id: true, text: true, ordinal: true },
            },
            mentions: {
              where: { officeId: input.officeId },
              orderBy: { id: "asc" },
              take: 12,
              select: { entityType: true, entityId: true, label: true },
            },
          },
        }).catch((error) => recoverLexicalReadError(error, input.strictReadErrors === true)),
    includeChunks && exactObjectIds?.length !== 0
      ? database.knowledgeChunk.findMany({
          where: {
            officeId: input.officeId,
            ...(exactObjectIds ? { objectId: { in: exactObjectIds } } : {}),
            object: scopeObjectWhere,
            ...(q ? { OR: chunkTextClauses(q) } : {}),
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take,
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
              },
            },
          },
        }).catch((error) => recoverLexicalReadError(error, input.strictReadErrors === true))
      : Promise.resolve([]),
    includeEvents && exactEventIds?.length !== 0
      ? database.memoryEvent.findMany({
          where: {
            AND: [
              memoryEventWhere(input, true),
              ...(exactEventIds ? [{ id: { in: exactEventIds } }] : []),
            ],
          },
          orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
          take,
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
                  where: { officeId: input.officeId },
                  orderBy: [{ ordinal: "asc" }, { id: "asc" }],
                  take: 1,
                  select: { id: true, text: true },
                },
              },
            },
          },
        }).catch((error) => recoverLexicalReadError(error, input.strictReadErrors === true))
      : Promise.resolve([]),
  ]);

  const scopedObjects = objects.filter((object) => object.officeId === input.officeId);
  const scopedChunks = chunks.filter((chunk) =>
    chunk.officeId === input.officeId && chunk.object.officeId === input.officeId);
  const scopedEvents = events.filter((event) => linkedMemoryObjectBelongsToOffice(event, input.officeId));
  const [routedObjects, routedChunkCandidates, routedEventCandidates] = await Promise.all([
    filterRoutedMemoryCandidates(input.officeId, scopedObjects, undefined, input.companyId),
    filterRoutedMemoryCandidates(input.officeId, scopedChunks.map((chunk) => ({
      candidateId: chunk.id,
      ...chunk.object,
    })), undefined, input.companyId),
    filterRoutedMemoryCandidates(input.officeId, scopedEvents.map((event) => ({
      candidateId: event.id,
      sourceType: event.sourceType,
      canonicalType: event.object?.canonicalType ?? null,
      entityType: event.entityType,
      entityId: event.entityId,
      companyId: event.object?.companyId ?? null,
      emailThreadId: event.object?.emailThreadId ??
        (event.entityType === "email_thread" ? event.entityId : null),
    })), undefined, input.companyId),
  ]);
  const routedChunkIds = new Set(routedChunkCandidates.map((candidate) => candidate.candidateId));
  const routedEventIds = new Set(routedEventCandidates.map((candidate) => candidate.candidateId));
  const routedChunkThreads = new Map(routedChunkCandidates.map((candidate) => [
    candidate.candidateId,
    candidate.emailThreadId ?? null,
  ]));
  const routedEventThreads = new Map(routedEventCandidates.map((candidate) => [
    candidate.candidateId,
    candidate.emailThreadId ?? null,
  ]));

  const results: HybridMemorySearchResult[] = [];

  for (const object of routedObjects) {
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
      officeId: input.officeId,
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
      emailThreadId: object.emailThreadId,
      ...memoryOperationalScopeMetadata(input),
      reasons: scored.reasons,
      evidence: evidenceForObject(object, object.chunks[0]?.id ?? null),
    });
  }

  for (const chunk of scopedChunks.filter((candidate) => routedChunkIds.has(candidate.id))) {
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
      officeId: input.officeId,
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
      emailThreadId: routedChunkThreads.get(chunk.id) ?? object.emailThreadId,
      ...memoryOperationalScopeMetadata(input),
      reasons: scored.reasons,
      evidence: evidenceForObject(object, chunk.id),
    });
  }

  for (const event of scopedEvents.filter((candidate) => routedEventIds.has(candidate.id))) {
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
      officeId: input.officeId,
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
      emailThreadId: routedEventThreads.get(event.id) ?? object?.emailThreadId ??
        (event.entityType === "email_thread" ? event.entityId : null),
      ...memoryOperationalScopeMetadata(input),
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

  return lexicalSearchResponse(input, sorted);
}

function lexicalSearchResponse(
  input: HybridMemorySearchInput,
  results: HybridMemorySearchResult[],
) {
  const q = input.query?.trim() || null;
  const includeEvents = input.includeEvents !== false;
  const includeChunks = input.includeChunks !== false;
  return {
    query: q,
    filters: {
      officeId: input.officeId,
      companyId: input.companyId ?? null,
      jobId: input.jobId ?? null,
      inquiryId: input.inquiryId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      workspaceId: input.workspaceId ?? null,
      procurementOrderId: input.procurementOrderId ?? null,
      procurementVendorId: input.procurementVendorId ?? null,
      supplierKey: input.supplierKey ?? null,
      itemId: input.itemId ?? null,
      itemKey: input.itemKey ?? null,
      canonicalTypes: input.canonicalTypes?.map(normalizeCanonicalType) ?? [],
      sourceTypes: input.sourceTypes?.map(normalizeSourceType) ?? [],
      dateRange: input.dateRange ?? null,
      includeEvents,
      includeChunks,
    },
    results,
    evidence: buildEvidenceRefs(results),
    evidence_for_agent: formatEvidenceForAgent(results),
    evidence_for_user: formatEvidenceForUser(results),
  };
}

/**
 * Exact-scope preflight and final candidate reads share one stable snapshot.
 * Injected test databases without interactive transactions retain the legacy
 * direct-read seam, while the canonical Prisma client uses Repeatable Read.
 */
export async function lexicalSearchMemory(
  input: HybridMemorySearchInput,
  database: LexicalMemoryDatabase = prisma,
) {
  if (exactEntityScopes(input).length === 0 || typeof database.$transaction !== "function") {
    return lexicalSearchMemoryInSnapshot(input, database);
  }

  try {
    return await database.$transaction(
      (transaction) => lexicalSearchMemoryInSnapshot(input, transaction),
      LEXICAL_REPEATABLE_READ_OPTIONS,
    );
  } catch (error) {
    if (input.strictReadErrors === true) throw error;
    return lexicalSearchResponse(input, []);
  }
}
