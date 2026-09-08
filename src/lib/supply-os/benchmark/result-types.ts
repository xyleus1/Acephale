import type { BenchmarkSystemName } from "./systems";
import type { BenchmarkPrismaPoolConfiguration } from "./pool-config";
import type { BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM } from "./source-tree";

export type BenchmarkJson =
  | null
  | boolean
  | number
  | string
  | BenchmarkJson[]
  | { [key: string]: BenchmarkJson };

export type BenchmarkVectorAssetMetadata = {
  bytes: number;
  sha256: string;
};

/**
 * Reproducibility metadata copied from the validated local vector-index
 * manifest. Paths are deliberately omitted because they are machine-local;
 * the content hashes bind the exact assets used by a run.
 */
export type BenchmarkVectorIndexConfiguration = {
  schemaVersion: number;
  profile: string;
  seedVersion: string;
  modelId: string;
  modelRevision: string;
  modelDtype: string;
  dimensions: number;
  runtimePackage: string;
  runtimeVersion: string;
  modelAssets: BenchmarkVectorAssetMetadata[];
  indexChunkCount: number;
  corpusFingerprint: string;
  vectorAsset: BenchmarkVectorAssetMetadata;
  metadataAsset: BenchmarkVectorAssetMetadata;
  buildMs: number;
  builtAt: string;
  manifestHash: string;
};

export type BenchmarkRunConfiguration = {
  profile: string;
  corpusSize: number;
  queryCount: number;
  topK: number;
  warmupCount: number;
  warmupPassCount: number;
  warmupPolicy: "full_corpus_seeded_random";
  concurrency: number;
  embeddingModel: string;
  embeddingDimensions: number | null;
  vectorIndex: BenchmarkVectorIndexConfiguration | null;
  runCount: number;
  runIndex: number;
  queryOrderPolicy: "seeded_random_per_pass_shared_across_systems";
  queryOrderSeed: number;
  queryOrderHash: string;
  hardwareLabel: string;
  runtimeLabel: string;
  branch: string;
  commitSha: string;
  workingTreeDirty: boolean;
  sourceTreeFingerprint: string;
  sourceTreeFingerprintAlgorithm: typeof BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM | "legacy_unknown";
  sourceTreeFileCount: number;
  postgresVersion: string;
  postgresStatementTimeout: string;
  prismaPoolConfiguration: BenchmarkPrismaPoolConfiguration;
  timestamp: string;
  databaseLabel: string;
};

export type BenchmarkTimingAggregate = {
  sampleCount: number;
  totalMs: number;
  p50Ms: number;
  p95Ms: number;
};

export type BenchmarkWarmupSummary = {
  passCount: number;
  executionCount: number;
  failureCount: number;
  queryOrderHashes: string[];
  componentTimings: Record<string, BenchmarkTimingAggregate>;
};

export type BenchmarkPreparationSummary = {
  projectionCount: number;
  failureCount: number;
  buildFailureCount: number;
  persistenceFailureCount: number;
  componentTimings: Record<string, BenchmarkTimingAggregate>;
};

export type BenchmarkValidationResult = {
  valid: boolean;
  checkedAt?: string;
  changedStrict: unknown[];
  changedAdvisory: unknown[];
};

export type BenchmarkCaseMetrics = {
  recallAt5: number;
  recallAt10: number;
  recallAt20: number;
  factRecallAt20: number;
  reciprocalRank: number;
  currentStateAccuracy: number | null;
  temporalOrderAccuracy: number | null;
  entityResolutionAccuracy: number | null;
  correctEvidenceCount: number;
  correctFactCount: number;
  evidenceBandwidthPerSecond: number;
  factBandwidthPerSecond: number;
  projectionHit: boolean | null;
  tenantLeakCount: number;
  unroutedLeakCount: number;
  strictStaleDetected: number | null;
  staleEscape: number | null;
  falseConflict: number | null;
  retrievalMs: number;
  hydrationMs: number;
  validationMs: number | null;
  componentTimingsMs: Record<string, number>;
  measurementPass: number;
  queryOrdinal: number;
};

export type BenchmarkMeasuredCaseResult = {
  status: "completed";
  failureCode: null;
  runId: string;
  caseId: string;
  profile: string;
  systemName: BenchmarkSystemName;
  queryType: string;
  difficulty: string;
  latencyMs: number;
  retrievedFacts: unknown[];
  retrievedEvidence: unknown[];
  validationResult: BenchmarkValidationResult | null;
  metrics: BenchmarkCaseMetrics;
};

export type BenchmarkUnmeasuredCaseResult = {
  status: "failed" | "skipped";
  failureCode: string;
  runId: string;
  caseId: string;
  profile: string;
  systemName: BenchmarkSystemName;
  queryType: string;
  difficulty: string;
  latencyMs: number;
  retrievedFacts: unknown[];
  retrievedEvidence: unknown[];
  validationResult: BenchmarkValidationResult | null;
  metrics: null;
};

export type BenchmarkCaseResult = BenchmarkMeasuredCaseResult | BenchmarkUnmeasuredCaseResult;

export type BenchmarkRunSummary = {
  runId: string;
  profile: string;
  systemName: BenchmarkSystemName;
  configuration: BenchmarkRunConfiguration & {
    status: "completed" | "skipped" | "failed";
    skipReason?: string;
  };
  startedAt: string;
  completedAt: string;
  metrics: BenchmarkAggregateMetrics | null;
  byQueryType: Record<string, BenchmarkAggregateMetrics>;
  warmup: BenchmarkWarmupSummary | null;
  preparation: BenchmarkPreparationSummary | null;
};

export type BenchmarkAggregateMetrics = {
  caseCount: number;
  recallAt5: number;
  recallAt10: number;
  recallAt20: number;
  factRecallAt20: number;
  mrr: number;
  currentStateAccuracy: number | null;
  temporalOrderAccuracy: number | null;
  entityResolutionAccuracy: number | null;
  latencyP50Ms: number;
  latencyP95Ms: number;
  projectionHitRate: number | null;
  hydrationP50Ms: number;
  hydrationP95Ms: number;
  validationP50Ms: number | null;
  validationP95Ms: number | null;
  evidenceBandwidthPerSecond: number;
  factBandwidthPerSecond: number;
  tenantLeakCount: number;
  unroutedLeakCount: number;
  strictStaleDetectionRate: number | null;
  staleEscapeRate: number | null;
  falseConflictRate: number | null;
  componentTimings: Record<string, BenchmarkTimingAggregate>;
};

export type BenchmarkSystemSummary = {
  profile: string;
  systemName: BenchmarkSystemName;
  configuration: Omit<BenchmarkRunConfiguration, "runIndex">;
  status: "completed" | "skipped" | "failed";
  skipReason?: string;
  metrics: BenchmarkAggregateMetrics | null;
  byQueryType: Record<string, BenchmarkAggregateMetrics>;
  measuredRunIds: string[];
  warmups: BenchmarkWarmupSummary[];
  preparations: BenchmarkPreparationSummary[];
};

export type BenchmarkSummaryDocument = {
  schemaVersion: 1;
  generatedAt: string;
  configurations: BenchmarkRunConfiguration[];
  systems: BenchmarkSystemSummary[];
  runs: BenchmarkRunSummary[];
  bandwidthMultiplier: {
    profile: string;
    metric: "evidence" | "fact";
    hotSystem: "DERYA_HOT";
    baselineSystem: "STRONG_HYBRID_RAG";
    value: number | null;
    reason?: string;
  }[];
  projectionAmortization: {
    profile: string;
    projectionBuildP50Ms: number | null;
    coldHydrationP50Ms: number | null;
    hotHydrationP50Ms: number | null;
    repeatedReadsToBreakEven: number | null;
    reason?: string;
  }[];
};
