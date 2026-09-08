import { normalizeCanonicalType, normalizeSourceType } from "./canonical-types";
import { diversifyMemoryResults } from "./diversify";
import { buildEvidenceRefs, formatEvidenceForAgent, formatEvidenceForUser } from "./evidence";
import { memoryResultKey, reciprocalRankFuse } from "./fusion";
import { buildMemoryQueryPlan, memoryRetrievalV2Enabled } from "./query-plan";
import { retrieveEntityMemory } from "./retrievers/entity";
import { lexicalSearchMemory } from "./retrievers/lexical";
import { retrieveOperationalState } from "./retrievers/operational-state";
import { retrieveTemporalMemory } from "./retrievers/temporal";
import type {
  HybridMemorySearchInput,
  HybridMemorySearchResult,
  MemoryRetrievalDiagnostics,
  MemoryRetrieverName,
  RankedMemoryList,
} from "./retrievers/types";
import {
  retrieveVectorMemory,
  type VectorMemoryDatabase,
  type VectorMemoryRetriever,
} from "./retrievers/vector";

export type { HybridMemorySearchInput, HybridMemorySearchResult } from "./retrievers/types";
export { lexicalSearchMemory } from "./retrievers/lexical";

type RetrieverRun = {
  list: RankedMemoryList;
  diagnostic: MemoryRetrievalDiagnostics["retrievers"][MemoryRetrieverName];
};

type InitialMemoryRetriever = (
  input: HybridMemorySearchInput,
  limit: number,
) => Promise<HybridMemorySearchResult[]>;

export type HybridMemoryRetrieverOverrides = {
  lexical?: InitialMemoryRetriever;
  entity?: InitialMemoryRetriever;
  operationalState?: InitialMemoryRetriever;
  temporal?: typeof retrieveTemporalMemory;
};

export type HybridMemorySearchOptions = {
  vectorRetriever?: VectorMemoryRetriever | null;
  vectorDatabase?: VectorMemoryDatabase;
  /** Test and benchmark seams. Normal runtime callers use canonical retrievers. */
  retrievers?: HybridMemoryRetrieverOverrides;
};

async function runRetriever(
  retriever: MemoryRetrieverName,
  officeId: string,
  enabled: boolean,
  reason: string | undefined,
  rethrowErrors: boolean,
  run: () => Promise<HybridMemorySearchResult[]>,
): Promise<RetrieverRun> {
  if (!enabled) {
    return {
      list: { retriever, results: [] },
      diagnostic: { enabled: false, resultCount: 0, durationMs: 0, ...(reason ? { reason } : {}) },
    };
  }
  const startedAt = performance.now();
  try {
    const results = (await run()).filter((result) =>
      result.officeId === officeId && result.evidence.length > 0);
    return {
      list: { retriever, results },
      diagnostic: {
        enabled: true,
        resultCount: results.length,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      },
    };
  } catch (error) {
    if (rethrowErrors) throw error;
    return {
      list: { retriever, results: [] },
      diagnostic: {
        enabled: true,
        resultCount: 0,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        reason: "retriever_failed",
      },
    };
  }
}

function temporalAnchors(lists: RankedMemoryList[]) {
  const anchors: HybridMemorySearchResult[] = [];
  const seen = new Set<string>();
  for (let rank = 0; rank < 12; rank += 1) {
    for (const list of lists) {
      const result = list.results[rank];
      if (!result) continue;
      const key = memoryResultKey(result);
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push(result);
      if (anchors.length >= 12) return anchors;
    }
  }
  return anchors;
}

export async function hybridSearchMemory(
  input: HybridMemorySearchInput,
  options?: HybridMemorySearchOptions,
) {
  const retrievalV2Enabled = memoryRetrievalV2Enabled();
  const plan = buildMemoryQueryPlan(input);
  const lexicalPlan = plan.retrievers.lexical;
  const entityPlan = plan.retrievers.entity;
  const operationalPlan = plan.retrievers.operational_state;
  const vectorPlan = plan.retrievers.vector;
  const vectorBackendReady = Boolean(options?.vectorRetriever);

  const [lexical, entity, operational, vector] = await Promise.all([
    runRetriever(
      "lexical",
      plan.input.officeId,
      lexicalPlan.enabled,
      lexicalPlan.reason,
      plan.input.strictReadErrors === true,
      async () => {
        if (options?.retrievers?.lexical) {
          return options.retrievers.lexical(plan.input, plan.candidateLimit);
        }
        const search = await lexicalSearchMemory({ ...plan.input, limit: plan.candidateLimit });
        return search.results;
      },
    ),
    runRetriever(
      "entity",
      plan.input.officeId,
      entityPlan.enabled,
      entityPlan.reason,
      plan.input.strictReadErrors === true,
      () =>
      options?.retrievers?.entity
        ? options.retrievers.entity(plan.input, plan.candidateLimit)
        : retrieveEntityMemory(plan.input, plan.candidateLimit),
    ),
    runRetriever("operational_state", plan.input.officeId, operationalPlan.enabled, operationalPlan.reason, false, () =>
      options?.retrievers?.operationalState
        ? options.retrievers.operationalState(plan.input, plan.candidateLimit)
        : retrieveOperationalState(plan.input, plan.candidateLimit)),
    runRetriever(
      "vector",
      plan.input.officeId,
      vectorPlan.enabled && vectorBackendReady,
      vectorPlan.enabled && !vectorBackendReady ? "backend_not_configured" : vectorPlan.reason,
      false,
      () => retrieveVectorMemory(
        { input: plan.input, limit: plan.candidateLimit },
        options?.vectorRetriever,
        options?.vectorDatabase,
      ),
    ),
  ]);

  const initialLists = [lexical.list, operational.list, entity.list, vector.list];
  const temporalPlan = plan.retrievers.temporal;
  const anchors = temporalAnchors(initialLists);
  const temporal = await runRetriever(
    "temporal",
    plan.input.officeId,
    temporalPlan.enabled && anchors.length > 0,
    temporalPlan.enabled && anchors.length === 0 ? "no_evidence_anchors" : temporalPlan.reason,
    false,
    () => (options?.retrievers?.temporal ?? retrieveTemporalMemory)({
        search: plan.input,
        anchors,
        limit: plan.candidateLimit,
      }),
  );

  const rankedLists = [...initialLists, temporal.list];
  const results = retrievalV2Enabled
    ? diversifyMemoryResults(reciprocalRankFuse(rankedLists), { limit: plan.limit })
    : lexical.list.results.slice(0, plan.limit);
  const diagnostics: MemoryRetrievalDiagnostics = {
    version: 2,
    scopeWarnings: plan.scopeDiagnostics.ignoredIncompleteScopes,
    retrievers: {
      lexical: lexical.diagnostic,
      operational_state: operational.diagnostic,
      entity: entity.diagnostic,
      temporal: temporal.diagnostic,
      vector: vector.diagnostic,
    },
    fusion: retrievalV2Enabled ? "reciprocal_rank_fusion" : "none",
    diversification: retrievalV2Enabled ? "email_thread_cap" : "none",
  };

  return {
    query: plan.query,
    filters: {
      officeId: plan.input.officeId,
      companyId: plan.input.companyId ?? null,
      jobId: plan.input.jobId ?? null,
      inquiryId: plan.input.inquiryId ?? null,
      entityType: plan.input.entityType ?? null,
      entityId: plan.input.entityId ?? null,
      workspaceId: plan.input.workspaceId ?? null,
      procurementOrderId: plan.input.procurementOrderId ?? null,
      procurementVendorId: plan.input.procurementVendorId ?? null,
      supplierKey: plan.input.supplierKey ?? null,
      itemId: plan.input.itemId ?? null,
      itemKey: plan.input.itemKey ?? null,
      canonicalTypes: plan.input.canonicalTypes?.map(normalizeCanonicalType) ?? [],
      sourceTypes: plan.input.sourceTypes?.map(normalizeSourceType) ?? [],
      dateRange: plan.input.dateRange ?? null,
      includeEvents: plan.input.includeEvents !== false,
      includeChunks: plan.input.includeChunks !== false,
      includeOperationalState: plan.input.includeOperationalState !== false,
    },
    results,
    evidence: buildEvidenceRefs(results),
    evidence_for_agent: formatEvidenceForAgent(results),
    evidence_for_user: formatEvidenceForUser(results),
    retrieval: diagnostics,
  };
}
