import type { MemoryEvidenceRef } from "./evidence";
import type { HybridMemorySearchResult, RankedMemoryList } from "./retrievers/types";
import { recordSupplyStateMetric } from "../supply-os/state-runtime/instrumentation";

export const DEFAULT_RRF_K = 60;

export function memoryResultKey(result: HybridMemorySearchResult) {
  if (result.eventId) return `event:${result.eventId}`;
  if (result.objectId) return `object:${result.objectId}`;
  if (result.kind === "projection" && result.entityId) return `projection:${result.entityId}`;
  if (result.entityType && result.entityId) return `${result.kind}:${result.entityType}:${result.entityId}`;
  if (result.chunkId) return `chunk:${result.chunkId}`;
  return `${result.kind}:${result.sourceExternalId ?? result.title ?? result.excerpt}`;
}

/** Records Recall@K only for an explicit benchmark fixture, never live traffic. */
export function recordMemoryRetrievalRecallAtK(args: {
  benchmarkName: string;
  relevant: HybridMemorySearchResult[];
  retrieved: HybridMemorySearchResult[];
  k: number;
}) {
  const relevant = new Set(args.relevant.map(memoryResultKey));
  const k = Math.max(1, Math.floor(args.k));
  const retrieved = new Set(args.retrieved.slice(0, k).map(memoryResultKey));
  const hits = [...relevant].filter((key) => retrieved.has(key)).length;
  const recall = relevant.size ? hits / relevant.size : 1;
  recordSupplyStateMetric("retrieval_recall_at_k", recall, {
    benchmark: true,
    benchmarkName: args.benchmarkName.trim().slice(0, 160) || "unnamed",
  });
  return recall;
}

function evidenceKey(ref: MemoryEvidenceRef) {
  return [
    ref.refType,
    ref.knowledgeObjectId ?? "",
    ref.knowledgeChunkId ?? "",
    ref.memoryEventId ?? "",
    ref.entityType ?? "",
    ref.entityId ?? "",
    ref.sourceExternalId ?? "",
  ].join(":");
}

function mergeEvidence(left: MemoryEvidenceRef[], right: MemoryEvidenceRef[]) {
  const merged = new Map<string, MemoryEvidenceRef>();
  for (const ref of [...left, ...right]) merged.set(evidenceKey(ref), ref);
  return [...merged.values()];
}

/**
 * Fuses independently ranked retriever lists. Source scores are intentionally
 * ignored because lexical, temporal, and future vector scores are not on a
 * comparable scale.
 */
export function reciprocalRankFuse(
  lists: RankedMemoryList[],
  options?: { k?: number },
) {
  const k = Math.max(1, Math.floor(options?.k ?? DEFAULT_RRF_K));
  const fused = new Map<string, {
    result: HybridMemorySearchResult;
    rrfScore: number;
    ranks: Array<{ retriever: RankedMemoryList["retriever"]; rank: number }>;
  }>();

  for (const list of lists) {
    const seenInList = new Set<string>();
    list.results.forEach((result, index) => {
      const key = memoryResultKey(result);
      if (seenInList.has(key)) return;
      seenInList.add(key);
      const rank = index + 1;
      const current = fused.get(key);
      if (!current) {
        fused.set(key, {
          result: { ...result, evidence: [...result.evidence], reasons: [...result.reasons] },
          rrfScore: 1 / (k + rank),
          ranks: [{ retriever: list.retriever, rank }],
        });
        return;
      }
      current.rrfScore += 1 / (k + rank);
      current.ranks.push({ retriever: list.retriever, rank });
      current.result.evidence = mergeEvidence(current.result.evidence, result.evidence);
      current.result.reasons = [...new Set([...current.result.reasons, ...result.reasons])];
      current.result.emailThreadId ??= result.emailThreadId;
      current.result.workspaceId ??= result.workspaceId;
      current.result.procurementOrderId ??= result.procurementOrderId;
      current.result.procurementVendorId ??= result.procurementVendorId;
      current.result.supplierKey ??= result.supplierKey;
      current.result.itemId ??= result.itemId;
      current.result.itemKey ??= result.itemKey;
    });
  }

  return [...fused.values()]
    .sort((left, right) =>
      right.rrfScore - left.rrfScore ||
      right.result.occurredAt.getTime() - left.result.occurredAt.getTime(),
    )
    .map(({ result, rrfScore, ranks }) => ({
      ...result,
      // A fixed display scale keeps scores readable without mixing source scores.
      score: rrfScore * 1_000,
      reasons: [
        ...result.reasons,
        ...ranks.map(({ retriever, rank }) => `rrf:${retriever}:rank=${rank}`),
      ],
    }));
}
