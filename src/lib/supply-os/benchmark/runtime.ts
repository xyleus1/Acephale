import "server-only";

import { applyBenchmarkRuntimeFlags } from "./bootstrap";
import type {
  BenchmarkRuntimeInput,
  BenchmarkSystemExecution,
  DeryaBenchmarkExecutor,
} from "./executor-types";
import type { BenchmarkSystemName } from "./systems";
import type { SupplyWorldStatePacket } from "../state-runtime/types";
import { diversifyMemoryResults } from "@/lib/memory/diversify";
import { reciprocalRankFuse } from "@/lib/memory/fusion";
import { hybridSearchMemory } from "@/lib/memory/hybrid-search";
import { lexicalSearchMemory } from "@/lib/memory/retrievers/lexical";
import type {
  HybridMemorySearchInput,
  HybridMemorySearchResult,
} from "@/lib/memory/retrievers/types";
import {
  retrieveVectorMemory,
  type VectorMemoryRetriever,
} from "@/lib/memory/retrievers/vector";
import { compileSupplyWorldStateLive } from "@/lib/supply-os/state-runtime/compile";
import { validateSupplyStateRead } from "@/lib/supply-os/state-runtime/validate";
import { surfaceSupplySemanticFacts } from "./semantic-facts";

export function benchmarkSearchInput(input: BenchmarkRuntimeInput, limit: number): HybridMemorySearchInput {
  const scope = input.scope;
  return {
    officeId: scope.officeId,
    query: input.queryText,
    companyId: scope.type === "company" || scope.type === "procurement_request" || scope.type === "item"
      ? scope.companyId
      : scope.type === "supplier" ? scope.companyId ?? null : null,
    workspaceId: scope.type === "workspace" || scope.type === "item"
      ? scope.workspaceId
      : "workspaceId" in scope ? scope.workspaceId ?? null : null,
    procurementOrderId: scope.type === "procurement_request"
      ? scope.orderId
      : scope.type === "supplier" ? scope.orderId ?? null : null,
    procurementVendorId: scope.type === "supplier" ? scope.vendorId ?? null : null,
    supplierKey: scope.type === "supplier" ? scope.supplierKey ?? null : null,
    itemId: scope.type === "item" ? scope.itemId ?? null : null,
    itemKey: scope.type === "item" ? scope.itemKey ?? null : null,
    includeChunks: true,
    includeEvents: true,
    strictReadErrors: true,
    limit,
  };
}

/** Current/standard RAG baselines keep the legacy Company Brain filters. */
export function benchmarkBaselineSearchInput(
  input: BenchmarkRuntimeInput,
  limit: number,
): HybridMemorySearchInput {
  const scoped = benchmarkSearchInput(input, limit);
  return {
    officeId: scoped.officeId,
    query: scoped.query,
    companyId: scoped.companyId,
    includeChunks: true,
    includeEvents: true,
    includeOperationalState: false,
    strictReadErrors: true,
    limit: scoped.limit,
  };
}

function boundedTopK(value: number) {
  return Math.max(1, Math.min(75, Math.floor(value)));
}

function sanitizedResultEvidence(result: HybridMemorySearchResult) {
  return {
    officeId: result.officeId,
    kind: result.kind,
    objectId: result.objectId,
    chunkId: result.chunkId,
    eventId: result.eventId,
    entityType: result.entityType,
    entityId: result.entityId,
    emailThreadId: result.emailThreadId ?? null,
    evidence: result.evidence,
  };
}

function resultEvidence(results: HybridMemorySearchResult[], topK: number) {
  return results
    .filter((result) => result.evidence.length > 0)
    .slice(0, boundedTopK(topK))
    .map(sanitizedResultEvidence);
}

function stateEvidence(packet: SupplyWorldStatePacket) {
  return packet.evidenceRefs.map((reference) => ({
    officeId: packet.scope.officeId,
    kind: "state_packet_evidence",
    evidence: [reference],
  }));
}

function evidenceIdentity(value: unknown) {
  const object = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nested = Array.isArray(object.evidence) ? object.evidence[0] : null;
  const reference = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : object;
  return [
    reference.kind,
    reference.id,
    reference.refType,
    reference.knowledgeChunkId,
    reference.knowledgeObjectId,
    reference.memoryEventId,
    reference.entityType,
    reference.entityId,
    object.kind,
    object.objectId,
    object.chunkId,
    object.eventId,
  ].map((part) => typeof part === "string" ? part : "").join(":");
}

function mergeEvidence(topK: number, ...lists: unknown[][]) {
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const value of lists.flat()) {
    const identity = evidenceIdentity(value);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(value);
    if (merged.length >= boundedTopK(topK)) break;
  }
  return merged;
}

function stateFacts(packet: SupplyWorldStatePacket) {
  const facts: unknown[] = surfaceSupplySemanticFacts(packet);
  facts.push(...packet.dependencies.map((dependency) => ({
    key: dependency.key,
    valueHash: dependency.valueHash,
    version: dependency.version,
    policy: dependency.policy,
  })));
  return facts.slice(0, 300);
}

function systemFlags(system: BenchmarkSystemName, vectorAvailable: boolean) {
  const vector = vectorAvailable
    && (system === "VECTOR_RAG" || system === "STRONG_HYBRID_RAG"
      || system === "DERYA_COLD" || system === "DERYA_HOT");
  return {
    stateRuntimeEnabled: system === "DERYA_COLD" || system === "DERYA_HOT",
    projectionsEnabled: system === "DERYA_HOT",
    validationMode: system === "DERYA_HOT" ? "enforce" as const : "off" as const,
    retrievalV2Enabled: system === "DERYA_COLD" || system === "DERYA_HOT",
    vectorRetrievalEnabled: vector,
  };
}

async function lexicalExecution(input: BenchmarkRuntimeInput, topK: number) {
  const startedAt = performance.now();
  const search = await lexicalSearchMemory({
    ...benchmarkBaselineSearchInput(input, topK),
  });
  const durationMs = Math.max(0, performance.now() - startedAt);
  return {
    retrievedFacts: [],
    retrievedEvidence: resultEvidence(search.results, topK),
    retrievalMs: durationMs,
    hydrationMs: durationMs,
    projectionHit: null,
    componentTimingsMs: {
      lexicalRetrievalMs: durationMs,
      totalRetrievalMs: durationMs,
    },
  } satisfies BenchmarkSystemExecution;
}

async function vectorExecution(
  input: BenchmarkRuntimeInput,
  topK: number,
  vectorRetriever: VectorMemoryRetriever,
) {
  const startedAt = performance.now();
  const results = await retrieveVectorMemory({
    input: benchmarkBaselineSearchInput(input, topK),
    limit: boundedTopK(topK),
  }, vectorRetriever);
  const durationMs = Math.max(0, performance.now() - startedAt);
  return {
    retrievedFacts: [],
    retrievedEvidence: resultEvidence(results, topK),
    retrievalMs: durationMs,
    hydrationMs: durationMs,
    projectionHit: null,
    componentTimingsMs: {
      vectorRetrievalMs: durationMs,
      totalRetrievalMs: durationMs,
    },
  } satisfies BenchmarkSystemExecution;
}

async function strongHybridExecution(
  input: BenchmarkRuntimeInput,
  topK: number,
  vectorRetriever: VectorMemoryRetriever,
) {
  const startedAt = performance.now();
  const candidateLimit = Math.min(250, Math.max(boundedTopK(topK) * 8, 25));
  const scoped = benchmarkBaselineSearchInput(input, candidateLimit);
  const [lexicalTimed, vectorTimed] = await Promise.all([
    (async () => {
      const componentStartedAt = performance.now();
      const value = await lexicalSearchMemory(scoped);
      return { value, durationMs: Math.max(0, performance.now() - componentStartedAt) };
    })(),
    (async () => {
      const componentStartedAt = performance.now();
      const value = await retrieveVectorMemory({ input: scoped, limit: candidateLimit }, vectorRetriever);
      return { value, durationMs: Math.max(0, performance.now() - componentStartedAt) };
    })(),
  ]);
  const fusionStartedAt = performance.now();
  const fused = reciprocalRankFuse([
    { retriever: "lexical", results: lexicalTimed.value.results },
    { retriever: "vector", results: vectorTimed.value },
  ]);
  const results = diversifyMemoryResults(fused, { limit: boundedTopK(topK) });
  const fusionMs = Math.max(0, performance.now() - fusionStartedAt);
  const durationMs = Math.max(0, performance.now() - startedAt);
  return {
    retrievedFacts: [],
    retrievedEvidence: resultEvidence(results, topK),
    retrievalMs: durationMs,
    hydrationMs: durationMs,
    projectionHit: null,
    componentTimingsMs: {
      lexicalRetrievalMs: lexicalTimed.durationMs,
      vectorRetrievalMs: vectorTimed.durationMs,
      fusionAndDiversificationMs: fusionMs,
      totalRetrievalMs: durationMs,
    },
  } satisfies BenchmarkSystemExecution;
}

function sourceReadCriticalPathMs(packet: SupplyWorldStatePacket) {
  const infrastructure = new Set([
    "packetAssembly",
    "projectionLookup",
    "projectionFreshness",
    "projectionBuild",
    "projectionPersist",
  ]);
  const readerTimes = Object.entries(packet.diagnostics.timingsMs)
    .filter(([name, value]) => !infrastructure.has(name) && Number.isFinite(value) && value >= 0)
    .map(([, value]) => value);
  return readerTimes.length ? Math.max(...readerTimes) : 0;
}

async function deryaExecution(
  input: BenchmarkRuntimeInput,
  topK: number,
  options: { useProjections: boolean; vectorRetriever: VectorMemoryRetriever | null },
) {
  const totalStartedAt = performance.now();
  const stateStartedAt = performance.now();
  const packetPromise = compileSupplyWorldStateLive({
    scope: input.scope,
    objective: input.queryText,
    retrieveEvidence: false,
    useProjections: options.useProjections,
  }).then((packet) => ({
    packet,
    durationMs: Math.max(0, performance.now() - stateStartedAt),
  }));
  const evidenceStartedAt = performance.now();
  const evidencePromise = hybridSearchMemory({
    ...benchmarkSearchInput(input, topK),
    // Both conditions use the same query-specific retrieval stack. The state
    // compiler's projection toggle is the only Cold versus Hot difference.
    includeOperationalState: false,
  }, {
    vectorRetriever: options.vectorRetriever,
  }).then((search) => ({
    search,
    durationMs: Math.max(0, performance.now() - evidenceStartedAt),
  }));
  const [{ packet, durationMs: stateCompilationMs }, evidence] = await Promise.all([
    packetPromise,
    evidencePromise,
  ]);
  const totalHydrationMs = Math.max(0, performance.now() - totalStartedAt);
  const projectionLookupMs = packet.diagnostics.timingsMs.projectionLookup ?? 0;
  const projectionFreshnessMs = packet.diagnostics.timingsMs.projectionFreshness ?? 0;
  const projectionBuildMs = packet.diagnostics.timingsMs.projectionBuild ?? 0;
  const projectionPersistMs = packet.diagnostics.timingsMs.projectionPersist ?? 0;
  return {
    retrievedFacts: stateFacts(packet),
    retrievedEvidence: mergeEvidence(topK, stateEvidence(packet), resultEvidence(evidence.search.results, topK)),
    // State facts and state-linked evidence are unavailable until hydration is
    // complete, so both bandwidth denominators use the total wall clock.
    retrievalMs: totalHydrationMs,
    hydrationMs: totalHydrationMs,
    projectionHit: packet.diagnostics.projectionHit,
    componentTimingsMs: {
      sourceReadCriticalPathMs: sourceReadCriticalPathMs(packet),
      stateCompilationMs,
      historicalEvidenceRetrievalMs: evidence.durationMs,
      queryEvidenceRetrievalMs: evidence.durationMs,
      ...(options.useProjections ? {
        projectionLoadMs: projectionLookupMs,
        projectionFreshnessMs,
        projectionBuildMs,
        projectionPersistMs,
      } : {
        liveStateBuildMs: projectionBuildMs,
      }),
      totalHydrationMs,
    },
  } satisfies BenchmarkSystemExecution;
}

export function createDeryaBenchmarkExecutor(input: {
  vectorRetriever?: VectorMemoryRetriever | null;
} = {}): DeryaBenchmarkExecutor {
  const vectorRetriever = input.vectorRetriever ?? null;
  return {
    vectorRetrieverAvailable: Boolean(vectorRetriever),
    vectorRetrieverName: vectorRetriever?.name ?? null,
    configureSystem(system) {
      applyBenchmarkRuntimeFlags(systemFlags(system, Boolean(vectorRetriever)));
    },
    async prepare(system, runtimeInput) {
      if (system !== "DERYA_HOT") {
        return {
          componentTimingsMs: {} as Record<string, number>,
          projectionBuilt: false,
          projectionPersisted: false,
        };
      }
      const startedAt = performance.now();
      const packet = await compileSupplyWorldStateLive({
        scope: runtimeInput.scope,
        objective: runtimeInput.queryText,
        retrieveEvidence: false,
        useProjections: true,
      });
      const totalMs = Math.max(0, performance.now() - startedAt);
      const verificationStartedAt = performance.now();
      const verification = await compileSupplyWorldStateLive({
        scope: runtimeInput.scope,
        objective: runtimeInput.queryText,
        retrieveEvidence: false,
        useProjections: true,
      });
      const verificationMs = Math.max(0, performance.now() - verificationStartedAt);
      return {
        projectionBuilt: !packet.diagnostics.projectionHit,
        projectionPersisted: verification.diagnostics.projectionHit,
        componentTimingsMs: {
          projectionBuildMs: packet.diagnostics.timingsMs.projectionBuild ?? 0,
          projectionPersistMs: packet.diagnostics.timingsMs.projectionPersist ?? 0,
          projectionMaterializationMs: (packet.diagnostics.timingsMs.projectionBuild ?? 0)
            + (packet.diagnostics.timingsMs.projectionPersist ?? 0),
          projectionPreparationTotalMs: totalMs,
          projectionVerificationMs: verificationMs,
        },
      };
    },
    async execute(system, runtimeInput, topK) {
      if (system === "CURRENT_KEYWORD") return lexicalExecution(runtimeInput, topK);
      if (system === "VECTOR_RAG") {
        if (!vectorRetriever) throw new Error("VECTOR_RAG requires a configured vector retriever.");
        return vectorExecution(runtimeInput, topK, vectorRetriever);
      }
      if (system === "STRONG_HYBRID_RAG") {
        if (!vectorRetriever) throw new Error("STRONG_HYBRID_RAG requires a configured vector retriever.");
        return strongHybridExecution(runtimeInput, topK, vectorRetriever);
      }
      if (system === "DERYA_COLD") {
        return deryaExecution(runtimeInput, topK, { useProjections: false, vectorRetriever });
      }
      return deryaExecution(runtimeInput, topK, { useProjections: true, vectorRetriever });
    },
    async validate(validationInput) {
      const startedAt = performance.now();
      const result = await validateSupplyStateRead({
        officeId: validationInput.officeId,
        stateReadId: validationInput.stateReadId,
        validationMode: "enforce",
      });
      return {
        result,
        validationMs: Math.max(0, performance.now() - startedAt),
      };
    },
  };
}
