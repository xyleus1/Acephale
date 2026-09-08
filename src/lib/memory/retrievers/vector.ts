import { prisma } from "@/lib/prisma";
import { canonicalTypesForSearch, normalizeSourceType } from "../canonical-types";
import type { MemoryEvidenceRef } from "../evidence";
import { excerptAroundQuery } from "../relevance";
import { exactEntityScopes, memoryObjectWhere } from "./lexical";
import { filterRoutedMemoryCandidates } from "./routed-email";
import {
  memoryOperationalScopeMetadata,
  type HybridMemorySearchInput,
  type HybridMemorySearchResult,
} from "./types";

export const MEMORY_VECTOR_SEARCH_FLAG = "MEMORY_VECTOR_SEARCH_ENABLED";
// Compatibility alias for the initial Retrieval V2 rollout name. New
// deployments and benchmark runs should use MEMORY_VECTOR_SEARCH_ENABLED.
export const MEMORY_VECTOR_RETRIEVAL_FLAG = "MEMORY_VECTOR_RETRIEVAL_ENABLED";

export type VectorMemoryQuery = {
  input: HybridMemorySearchInput;
  limit: number;
};

export interface VectorMemoryRetriever {
  readonly name: string;
  retrieve(query: VectorMemoryQuery): Promise<HybridMemorySearchResult[]>;
}

export type VectorMemoryChunkRow = {
  id: string;
  officeId: string;
  text: string;
  object: {
    id: string;
    officeId: string;
    canonicalType: string;
    title: string | null;
    sourceType: string;
    sourceExternalId: string;
    entityType: string | null;
    entityId: string | null;
    companyId: string | null;
    contactId: string | null;
    inquiryId: string | null;
    jobId: string | null;
    emailThreadId: string | null;
    emailMessageId: string | null;
    jobDocumentId: string | null;
    strategyAssessmentId: string | null;
    agentProposalId: string | null;
    occurredAt: Date;
    mentions: Array<{
      entityType: string;
      entityId: string;
    }>;
  };
};

export type VectorMemoryDatabase = {
  knowledgeChunk: {
    findMany(args: unknown): Promise<VectorMemoryChunkRow[]>;
  };
};

export function vectorMemoryRetrievalEnabled(
  env: Record<string, string | undefined> = process.env as unknown as Record<string, string | undefined>,
) {
  const configured = env[MEMORY_VECTOR_SEARCH_FLAG] ?? env[MEMORY_VECTOR_RETRIEVAL_FLAG];
  return String(configured ?? "")
    .trim()
    .toLowerCase() === "true";
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rowHasEntity(
  row: VectorMemoryChunkRow,
  entityTypes: string[],
  entityId: string,
  directField?: string,
) {
  if (entityTypes.includes(row.object.entityType ?? "") && row.object.entityId === entityId) return true;
  if (row.object.mentions.some((mention) =>
    entityTypes.includes(mention.entityType) && mention.entityId === entityId)) return true;
  if (!directField) return false;
  return (row.object as unknown as Record<string, unknown>)[directField] === entityId;
}

function canonicalVectorRowMatchesScope(
  row: VectorMemoryChunkRow,
  input: HybridMemorySearchInput,
) {
  if (row.officeId !== input.officeId || row.object.officeId !== input.officeId) return false;
  if (input.companyId && !rowHasEntity(row, ["company"], input.companyId, "companyId")) return false;
  if (input.jobId && !rowHasEntity(row, ["job"], input.jobId, "jobId")) return false;
  if (input.inquiryId && !rowHasEntity(row, ["inquiry"], input.inquiryId, "inquiryId")) return false;
  for (const scope of exactEntityScopes(input)) {
    if (!rowHasEntity(row, scope.entityTypes, scope.entityId, scope.directField)) return false;
  }

  const canonicalTypes = canonicalTypesForSearch(input.canonicalTypes ?? []);
  if (canonicalTypes.length && !canonicalTypes.includes(row.object.canonicalType)) return false;
  const sourceTypes = [...new Set((input.sourceTypes ?? []).map(normalizeSourceType).filter(Boolean))];
  if (sourceTypes.length && !sourceTypes.includes(normalizeSourceType(row.object.sourceType))) return false;
  const occurredAt = asDate(row.object.occurredAt);
  const from = asDate(input.dateRange?.from);
  const to = asDate(input.dateRange?.to);
  return Boolean(occurredAt) && (!from || occurredAt! >= from) && (!to || occurredAt! <= to);
}

function canonicalEvidence(row: VectorMemoryChunkRow): MemoryEvidenceRef[] {
  const common = {
    entityType: row.object.entityType,
    entityId: row.object.entityId,
    sourceType: row.object.sourceType,
    sourceExternalId: row.object.sourceExternalId,
    canonicalType: row.object.canonicalType,
    title: row.object.title,
    occurredAt: row.object.occurredAt,
  };
  return [
    {
      refType: "knowledge_object",
      knowledgeObjectId: row.object.id,
      ...common,
    },
    {
      refType: "knowledge_chunk",
      knowledgeObjectId: row.object.id,
      knowledgeChunkId: row.id,
      ...common,
    },
    ...row.object.mentions.slice(0, 12).map((mention): MemoryEvidenceRef => ({
      refType: "entity",
      entityType: mention.entityType,
      entityId: mention.entityId,
      sourceType: row.object.sourceType,
      sourceExternalId: row.object.sourceExternalId,
      occurredAt: row.object.occurredAt,
    })),
  ];
}

/**
 * V1 deliberately has no built-in vector backend. A backend can rank only
 * opaque KnowledgeChunk pointers. Every pointer is reloaded from the canonical
 * Company Brain tables under the requesting office and exact scope before any
 * text or metadata is returned.
 */
export async function retrieveVectorMemory(
  query: VectorMemoryQuery,
  retriever?: VectorMemoryRetriever | null,
  database: VectorMemoryDatabase = prisma as unknown as VectorMemoryDatabase,
) {
  if (!vectorMemoryRetrievalEnabled() || !retriever || query.input.includeChunks === false) return [];
  const backendResults = await retriever.retrieve(query);
  const pointers = new Map<string, { rank: number; score: number }>();
  for (const [rank, result] of backendResults.slice(0, 500).entries()) {
    if (result.kind !== "chunk" || !result.chunkId) continue;
    if (!result.evidence.some((ref) =>
      ref.refType === "knowledge_chunk" && ref.knowledgeChunkId === result.chunkId)) continue;
    if (!pointers.has(result.chunkId)) {
      pointers.set(result.chunkId, {
        rank,
        score: Number.isFinite(result.score) ? Math.max(0, result.score) : 0,
      });
    }
  }
  if (!pointers.size) return [];

  const rows = await database.knowledgeChunk.findMany({
    where: {
      id: { in: [...pointers.keys()] },
      officeId: query.input.officeId,
      object: memoryObjectWhere(query.input, false),
    },
    select: {
      id: true,
      officeId: true,
      text: true,
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
          contactId: true,
          inquiryId: true,
          jobId: true,
          emailThreadId: true,
          emailMessageId: true,
          jobDocumentId: true,
          strategyAssessmentId: true,
          agentProposalId: true,
          occurredAt: true,
          mentions: {
            take: 24,
            select: { entityType: true, entityId: true },
          },
        },
      },
    },
  }).catch(() => []);

  const canonicalResults = rows
    .filter((row) => pointers.has(row.id) && canonicalVectorRowMatchesScope(row, query.input))
    .map((row): HybridMemorySearchResult => {
      const pointer = pointers.get(row.id)!;
      return {
        officeId: row.officeId,
        kind: "chunk",
        objectId: row.object.id,
        chunkId: row.id,
        eventId: null,
        sourceType: row.object.sourceType,
        sourceExternalId: row.object.sourceExternalId,
        canonicalType: row.object.canonicalType,
        title: row.object.title,
        excerpt: excerptAroundQuery(row.text, query.input.query),
        score: pointer.score,
        occurredAt: row.object.occurredAt,
        entityType: row.object.entityType,
        entityId: row.object.entityId,
        companyId: row.object.companyId,
        jobId: row.object.jobId,
        inquiryId: row.object.inquiryId,
        emailThreadId: row.object.emailThreadId,
        ...memoryOperationalScopeMetadata(query.input),
        reasons: ["retriever:vector_pointer", `vector_rank:${pointer.rank + 1}`],
        evidence: canonicalEvidence(row),
      };
    })
    .sort((left, right) => {
      const leftRank = pointers.get(left.chunkId!)?.rank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = pointers.get(right.chunkId!)?.rank ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    });

  return (await filterRoutedMemoryCandidates(
    query.input.officeId,
    canonicalResults,
    undefined,
    query.input.companyId,
  )).slice(0, Math.max(1, query.limit));
}
