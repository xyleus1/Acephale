import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  assertBenchmarkResetAllowed,
  BenchmarkConfigurationError,
  loadBenchmarkConfig,
  parseBenchmarkProfile,
} from "../src/lib/supply-os/benchmark/config";
import {
  createBenchmarkClients,
  inspectBenchmarkPostgresRuntimeConfiguration,
  type BenchmarkSqlClient,
} from "../src/lib/supply-os/benchmark/database";
import {
  applyBenchmarkRuntimeFlags,
  bootstrapBenchmarkEnvironment,
} from "../src/lib/supply-os/benchmark/bootstrap";
import { BENCHMARK_PRISMA_POOL_CONFIGURATION } from "../src/lib/supply-os/benchmark/pool-config";
import {
  BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM,
  benchmarkSourceTreePaths,
  fingerprintBenchmarkSourceTreeEntries,
} from "../src/lib/supply-os/benchmark/source-tree";
import {
  benchmarkExactLexicalCanonicalPointers,
  benchmarkOperatorId,
  benchmarkStableIds,
  generateBenchmarkCorpus,
} from "../src/lib/supply-os/benchmark/generate";
import {
  aggregateBenchmarkMetrics,
  benchmarkEvidenceKeys,
  evaluateBenchmarkCase,
} from "../src/lib/supply-os/benchmark/metrics";
import {
  benchmarkCaseOrder,
  buildBenchmarkSystemSummaries,
  runCommercialStateBenchmark,
} from "../src/lib/supply-os/benchmark/runner";
import { loadLatestBenchmarkArtifacts } from "../src/lib/supply-os/benchmark/load-results";
import {
  SUPPLY_SEMANTIC_FACT_ADAPTER_VERSION,
  surfaceSupplySemanticFacts,
} from "../src/lib/supply-os/benchmark/semantic-facts";
import type { BenchmarkMeasuredCaseResult } from "../src/lib/supply-os/benchmark/result-types";
import type { BenchmarkSummaryDocument } from "../src/lib/supply-os/benchmark/result-types";
import type { DeryaBenchmarkExecutor } from "../src/lib/supply-os/benchmark/executor-types";
import type { SupplyWorldStatePacket } from "../src/lib/supply-os/state-runtime/types";
import { renderBenchmarkReport } from "../src/lib/supply-os/benchmark/report";
import {
  benchmarkBaselineSearchInput,
  benchmarkSearchInput,
} from "../src/lib/supply-os/benchmark/runtime";
import { COMMERCIAL_STATE_BENCHMARK_SCENARIOS } from "../src/lib/supply-os/benchmark/scenarios";
import {
  BENCHMARK_METADATA_COLUMNS,
  BENCHMARK_METADATA_TABLES,
} from "../src/lib/supply-os/benchmark/schema";
import {
  BENCHMARK_KNOWLEDGE_CHUNK_TRIGRAM_INDEX,
  BENCHMARK_LEXICAL_ANALYZE_SQL,
  BENCHMARK_LEXICAL_INDEX_PREPARE_SQL,
  BENCHMARK_MEMORY_EVENT_OBJECT_INDEX,
  analyzeBenchmarkLexicalTables,
  benchmarkLexicalPlanUsesEventObjectIndex,
  benchmarkLexicalPlanUsesTrigramIndex,
  prepareBenchmarkLexicalIndexes,
  validateBenchmarkLexicalIndexes,
} from "../src/lib/supply-os/benchmark/lexical-indexes";
import {
  BENCHMARK_PROFILE_RETRIEVABLE_TARGETS,
  BENCHMARK_QUERY_DISTRIBUTION,
  type BenchmarkProfile,
} from "../src/lib/supply-os/benchmark/types";

const benchmarkEnvironment = {
  BENCHMARK_DATABASE_OWNER_URL: "postgresql://benchmark_owner:secret@benchmark-db.example.test:5432/derya_benchmark?sslmode=require",
  BENCHMARK_APP_DATABASE_URL: "postgresql://derya_app:secret@benchmark-db.example.test:5432/derya_benchmark?sslmode=require",
  BENCHMARK_APP_DATABASE_URL_UNPOOLED: "postgresql://derya_app:secret@benchmark-db.example.test:5432/derya_benchmark?sslmode=require",
  BENCHMARK_WORKFLOW_DATABASE_URL: "postgresql://dashboard_api:secret@benchmark-db.example.test:5432/derya_benchmark?sslmode=require",
  BENCHMARK_BOURNE_DATABASE_URL: "postgresql://bourne_supply_chain:secret@benchmark-db.example.test:5432/derya_benchmark?sslmode=require",
  BENCHMARK_OUTPUT_DIR: "outputs/supply-state-benchmark",
  DATABASE_URL: "postgresql://derya_app:secret@production-db.example.test:5432/derya_app?sslmode=require",
  DATABASE_URL_UNPOOLED: "postgresql://derya_app:secret@production-db.example.test:5432/derya_app?sslmode=require",
  WORKFLOW_DATABASE_URL: "postgresql://dashboard_api:secret@production-workflow.example.test:5432/neondb?sslmode=require",
} as const;

assert.throws(
  () => loadBenchmarkConfig({
    DATABASE_URL: benchmarkEnvironment.DATABASE_URL,
    BENCHMARK_APP_DATABASE_URL: benchmarkEnvironment.BENCHMARK_APP_DATABASE_URL,
  }),
  (error: unknown) => error instanceof BenchmarkConfigurationError
    && /BENCHMARK_DATABASE_OWNER_URL is required/.test(error.message),
  "Benchmark configuration must not fall back to DATABASE_URL.",
);

assert.throws(
  () => loadBenchmarkConfig({
    ...benchmarkEnvironment,
    BENCHMARK_DATABASE_OWNER_URL: "postgresql://benchmark_owner:secret@benchmark-db.example.test:5432/derya_runtime?sslmode=require",
    BENCHMARK_APP_DATABASE_URL: "postgresql://derya_app:secret@benchmark-db.example.test:5432/derya_runtime?sslmode=require",
    BENCHMARK_APP_DATABASE_URL_UNPOOLED: "postgresql://derya_app:secret@benchmark-db.example.test:5432/derya_runtime?sslmode=require",
    BENCHMARK_WORKFLOW_DATABASE_URL: "postgresql://dashboard_api:secret@benchmark-db.example.test:5432/derya_runtime?sslmode=require",
    BENCHMARK_BOURNE_DATABASE_URL: "postgresql://bourne_supply_chain:secret@benchmark-db.example.test:5432/derya_runtime?sslmode=require",
  }),
  /database name must contain benchmark, bench, synthetic, or test/,
);

assert.throws(
  () => loadBenchmarkConfig({
    ...benchmarkEnvironment,
    BENCHMARK_DATABASE_OWNER_URL: "postgresql://benchmark_owner:secret@benchmark-db.example.test:5432/latest_production?sslmode=require",
    BENCHMARK_APP_DATABASE_URL: "postgresql://derya_app:secret@benchmark-db.example.test:5432/latest_production?sslmode=require",
    BENCHMARK_APP_DATABASE_URL_UNPOOLED: "postgresql://derya_app:secret@benchmark-db.example.test:5432/latest_production?sslmode=require",
    BENCHMARK_WORKFLOW_DATABASE_URL: "postgresql://dashboard_api:secret@benchmark-db.example.test:5432/latest_production?sslmode=require",
    BENCHMARK_BOURNE_DATABASE_URL: "postgresql://bourne_supply_chain:secret@benchmark-db.example.test:5432/latest_production?sslmode=require",
  }),
  /database name must contain benchmark, bench, synthetic, or test/,
  "A production-looking name must not pass merely because a safety word appears inside another word.",
);

assert.throws(
  () => loadBenchmarkConfig({
    ...benchmarkEnvironment,
    DATABASE_URL: "postgresql://production_owner:secret@benchmark-db.example.test:5432/derya_benchmark?sslmode=require",
  }),
  /must not identify the database configured by DATABASE_URL/,
);

assert.throws(
  () => loadBenchmarkConfig({
    ...benchmarkEnvironment,
    BENCHMARK_BOURNE_DATABASE_URL: "postgresql://bourne_supply_chain:secret@different-benchmark-db.example.test:5432/derya_benchmark?sslmode=require",
  }),
  /same benchmark database host, port, and name/,
  "Every benchmark role must connect to the same isolated database target.",
);

const config = loadBenchmarkConfig(benchmarkEnvironment);
assert.equal(config.databaseName, "derya_benchmark");
const sourceTreeEntries = [
  { path: "src/z.ts", bytes: Buffer.from([0, 255, 1]) },
  { path: "README.md", bytes: Buffer.from("alpha", "utf8") },
];
const sourceTreeFingerprint = fingerprintBenchmarkSourceTreeEntries(sourceTreeEntries);
assert.equal(sourceTreeFingerprint.algorithm, BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM);
assert.equal(sourceTreeFingerprint.fileCount, 2);
assert.match(sourceTreeFingerprint.sha256, /^[a-f0-9]{64}$/);
assert.equal(
  fingerprintBenchmarkSourceTreeEntries([...sourceTreeEntries].reverse()).sha256,
  sourceTreeFingerprint.sha256,
  "Source-tree hashing must sort paths before hashing.",
);
assert.notEqual(
  fingerprintBenchmarkSourceTreeEntries([
    sourceTreeEntries[0]!,
    { path: "README.md", bytes: Buffer.from("beta", "utf8") },
  ]).sha256,
  sourceTreeFingerprint.sha256,
  "A working-tree byte change must change the source fingerprint.",
);
assert.throws(
  () => fingerprintBenchmarkSourceTreeEntries([sourceTreeEntries[0]!, sourceTreeEntries[0]!]),
  /path is duplicated/,
);
assert.equal(parseBenchmarkProfile("graph-small"), "graph-small");
assert.throws(() => parseBenchmarkProfile("small"), /graph-small, graph-medium, graph-large/);
assert.throws(() => assertBenchmarkResetAllowed({}), /ALLOW_BENCHMARK_RESET=1/);
assert.doesNotThrow(() => assertBenchmarkResetAllowed({ ALLOW_BENCHMARK_RESET: "1" }));

const runtimeEnvironment: NodeJS.ProcessEnv = {};
const flags = applyBenchmarkRuntimeFlags({
  stateRuntimeEnabled: true,
  projectionsEnabled: true,
  validationMode: "shadow",
  retrievalV2Enabled: true,
  vectorRetrievalEnabled: false,
}, runtimeEnvironment);
assert.equal(flags.validationMode, "shadow");
assert.equal(runtimeEnvironment.MEMORY_RETRIEVAL_V2_ENABLED, "true");
assert.equal(runtimeEnvironment.MEMORY_VECTOR_SEARCH_ENABLED, "false");
assert.equal(runtimeEnvironment.MEMORY_VECTOR_RETRIEVAL_ENABLED, "false");

const benchmarkBootstrapEnvironment: NodeJS.ProcessEnv = {};
const benchmarkBootstrap = bootstrapBenchmarkEnvironment({
  config,
  procurementCustomerMapping: { "office-fixture": "customer-fixture" },
  environment: benchmarkBootstrapEnvironment,
});
assert.deepEqual(benchmarkBootstrap.prismaPoolConfiguration, BENCHMARK_PRISMA_POOL_CONFIGURATION);
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "WORKFLOW_DATABASE_URL"] as const) {
  const databaseUrl = new URL(benchmarkBootstrapEnvironment[key]!);
  assert.equal(databaseUrl.searchParams.get("connection_limit"), "32");
  assert.equal(databaseUrl.searchParams.get("pool_timeout"), "120");
}

const benchmarkRetrievalInput = {
  queryText: "supplier quote evidence",
  scope: {
    type: "company" as const,
    officeId: "benchmark-office",
    companyId: "benchmark-company",
  },
};
assert.equal(
  benchmarkBaselineSearchInput(benchmarkRetrievalInput, 10).strictReadErrors,
  true,
  "Current Keyword and Strong Hybrid benchmark reads must fail on lexical database errors.",
);
assert.equal(
  benchmarkSearchInput(benchmarkRetrievalInput, 10).strictReadErrors,
  true,
  "Derya Cold and Hot evidence reads must fail on lexical database errors.",
);

assert.deepEqual(BENCHMARK_METADATA_TABLES, ["cases", "runs", "results"]);
assert.deepEqual(Object.keys(BENCHMARK_METADATA_COLUMNS), ["cases", "runs", "results"]);
assert.deepEqual(BENCHMARK_METADATA_COLUMNS.cases, [
  "id",
  "profile",
  "query_text",
  "query_type",
  "difficulty",
  "scope_json",
  "gold_facts_json",
  "gold_evidence_json",
  "gold_dependencies_json",
  "metadata_json",
]);
assert.deepEqual(BENCHMARK_METADATA_COLUMNS.runs, [
  "id",
  "profile",
  "system_name",
  "configuration_json",
  "started_at",
  "completed_at",
  "summary_metrics_json",
]);
assert.deepEqual(BENCHMARK_METADATA_COLUMNS.results, [
  "run_id",
  "case_id",
  "latency_ms",
  "retrieved_facts_json",
  "retrieved_evidence_json",
  "validation_result_json",
  "metrics_json",
]);

assert.equal(BENCHMARK_LEXICAL_INDEX_PREPARE_SQL.length, 3);
assert.match(BENCHMARK_LEXICAL_INDEX_PREPARE_SQL[0], /^CREATE EXTENSION IF NOT EXISTS pg_trgm$/);
assert.match(
  BENCHMARK_LEXICAL_INDEX_PREPARE_SQL[1],
  /CREATE INDEX IF NOT EXISTS "benchmark_KnowledgeChunk_text_trgm_idx"[\s\S]+public\."KnowledgeChunk" USING GIN \("text" gin_trgm_ops\)/,
);
assert.match(
  BENCHMARK_LEXICAL_INDEX_PREPARE_SQL[2],
  /CREATE INDEX IF NOT EXISTS "benchmark_MemoryEvent_officeId_objectId_idx"[\s\S]+public\."MemoryEvent" \("officeId", "objectId"\)/,
);
assert.doesNotMatch(
  BENCHMARK_LEXICAL_INDEX_PREPARE_SQL.join("\n"),
  /KnowledgeObject|EntityMention/,
  "The benchmark must not add stranded GIN indexes for cross-relation OR predicates.",
);
for (const table of ["KnowledgeObject", "KnowledgeChunk", "EntityMention", "MemoryEvent"]) {
  assert.match(BENCHMARK_LEXICAL_ANALYZE_SQL, new RegExp(`public\\."${table}"`));
}
assert.equal(benchmarkLexicalPlanUsesTrigramIndex([
  {
    Plan: {
      "Node Type": "Bitmap Heap Scan",
      Plans: [{
        "Node Type": "Bitmap Index Scan",
        "Index Name": BENCHMARK_KNOWLEDGE_CHUNK_TRIGRAM_INDEX,
      }],
    },
  },
]), true);
assert.equal(benchmarkLexicalPlanUsesTrigramIndex([
  { Plan: { "Node Type": "Seq Scan", "Relation Name": "KnowledgeChunk" } },
]), false);
assert.equal(benchmarkLexicalPlanUsesEventObjectIndex([{
  Plan: {
    "Node Type": "Index Scan",
    "Index Name": BENCHMARK_MEMORY_EVENT_OBJECT_INDEX,
  },
}]), true);
assert.equal(benchmarkLexicalPlanUsesEventObjectIndex([
  { Plan: { "Node Type": "Seq Scan", "Relation Name": "MemoryEvent" } },
]), false);

assert.equal(COMMERCIAL_STATE_BENCHMARK_SCENARIOS.length, 12);
const profiles: BenchmarkProfile[] = ["graph-small", "graph-medium", "graph-large"];
const generated = profiles.map((profile) => generateBenchmarkCorpus(profile));
for (const corpus of generated) {
  const stableIds = benchmarkStableIds(corpus.profile);
  const operatorIds = stableIds.officeIds.map((_officeId, index) => (
    benchmarkOperatorId(corpus.profile, index as 0 | 1)
  ));
  assert.equal(new Set(operatorIds).size, 2);
  assert.deepEqual(operatorIds, stableIds.officeIds.map((_officeId, index) => (
    benchmarkOperatorId(corpus.profile, index as 0 | 1)
  )), "Every benchmark office must have a stable, profile-specific internal operator ID.");
  assert.equal(corpus.cases.length, 200);
  assert.equal(corpus.retrievableCounts.total, BENCHMARK_PROFILE_RETRIEVABLE_TARGETS[corpus.profile]);
  assert.equal(corpus.cases.filter((entry) => entry.metadata.actionConcurrency).length, 40);
  assert.equal(
    corpus.cases.filter((entry) => entry.metadata.actionConcurrency?.expectedValid).length,
    20,
  );
  assert.equal(new Set(corpus.cases.map((entry) => entry.id)).size, 200);
  assert.equal(new Set(corpus.cases.map((entry) => entry.metadata.scenarioId)).size, 12);
  assert.deepEqual(
    Object.fromEntries(Object.keys(BENCHMARK_QUERY_DISTRIBUTION).map((queryType) => [
      queryType,
      corpus.cases.filter((entry) => entry.queryType === queryType).length,
    ])),
    BENCHMARK_QUERY_DISTRIBUTION,
  );
  assert.ok(corpus.cases.every((entry) => entry.goldFacts.length > 0));
  assert.ok(corpus.cases.every((entry) => entry.goldEvidence.length > 0));
  assert.ok(corpus.cases.every((entry) => entry.goldDependencies.length > 0));
  assert.ok(corpus.cases.every((entry) => entry.metadata.hardNegatives.length > 0));
  assert.ok(corpus.cases.every((entry) => entry.goldEvidence.every((gold) => gold.ref.id)));
  assert.ok(corpus.cases.every((entry) => {
    const goldKeys = new Set(entry.goldEvidence.flatMap(benchmarkEvidenceKeys));
    return entry.metadata.hardNegatives.every((negative) =>
      benchmarkEvidenceKeys(negative.evidenceRef).every((key) => !goldKeys.has(key)));
  }), "A benchmark case must never label the same evidence as both gold and a hard negative.");
  assert.ok(corpus.cases.every((entry) => entry.goldEvidence.every((gold) =>
    gold.ref.kind !== "email_message" || !entry.metadata.hardNegatives.some((negative) =>
      /ambiguous|unrouted/i.test(negative.reason)
      && benchmarkEvidenceKeys(negative.evidenceRef).some((key) =>
        benchmarkEvidenceKeys(gold.ref).includes(key))))));

  const lexicalPointers = new Map(benchmarkExactLexicalCanonicalPointers(corpus.profile)
    .map((entry) => [entry.scenarioId, entry]));
  assert.equal(lexicalPointers.size, 12);
  for (const caseRow of corpus.cases.filter((entry) => entry.queryType === "exact")) {
    const pointer = lexicalPointers.get(caseRow.metadata.scenarioId);
    assert.ok(pointer, `Exact case ${caseRow.id} must have a lexical canonical pointer.`);
    const indexedKeys = benchmarkEvidenceKeys({ sourceExternalId: pointer.canonicalPointer });
    assert.ok(caseRow.goldEvidence.some((gold) =>
      benchmarkEvidenceKeys(gold).some((key) => indexedKeys.includes(key))),
    `Exact case ${caseRow.id} must have reachable gold evidence in the keyword index.`);
    assert.ok(caseRow.metadata.hardNegatives.every((negative) =>
      benchmarkEvidenceKeys(negative.evidenceRef).every((key) => !indexedKeys.includes(key))));
  }
}
assert.deepEqual(
  generated[0]!.cases.map((entry) => entry.queryText),
  generated[1]!.cases.map((entry) => entry.queryText),
  "Profile growth must not change the evaluation questions.",
);
assert.deepEqual(
  generated[1]!.cases.map((entry) => entry.queryText),
  generated[2]!.cases.map((entry) => entry.queryText),
  "Only distractor history may grow between profiles.",
);

function measuredResult(input: {
  caseId: string;
  correctEvidenceCount: number;
  correctFactCount: number;
  retrievalMs: number;
  hydrationMs: number;
}): BenchmarkMeasuredCaseResult {
  return {
    status: "completed",
    failureCode: null,
    runId: "bandwidth-test",
    caseId: input.caseId,
    profile: "graph-small",
    systemName: "DERYA_HOT",
    queryType: "exact",
    difficulty: "easy",
    latencyMs: input.retrievalMs + input.hydrationMs,
    retrievedFacts: [],
    retrievedEvidence: [],
    validationResult: null,
    metrics: {
      recallAt5: 0,
      recallAt10: 0,
      recallAt20: 0,
      factRecallAt20: 0,
      reciprocalRank: 0,
      currentStateAccuracy: null,
      temporalOrderAccuracy: null,
      entityResolutionAccuracy: null,
      correctEvidenceCount: input.correctEvidenceCount,
      correctFactCount: input.correctFactCount,
      evidenceBandwidthPerSecond: input.correctEvidenceCount / (input.retrievalMs / 1_000),
      factBandwidthPerSecond: input.correctFactCount / (input.hydrationMs / 1_000),
      projectionHit: true,
      tenantLeakCount: 0,
      unroutedLeakCount: 0,
      strictStaleDetected: null,
      staleEscape: null,
      falseConflict: null,
      retrievalMs: input.retrievalMs,
      hydrationMs: input.hydrationMs,
      validationMs: null,
      componentTimingsMs: {},
      measurementPass: 1,
      queryOrdinal: 1,
    },
  };
}
const bandwidth = aggregateBenchmarkMetrics([
  measuredResult({ caseId: "one", correctEvidenceCount: 1, correctFactCount: 2, retrievalMs: 100, hydrationMs: 200 }),
  measuredResult({ caseId: "two", correctEvidenceCount: 3, correctFactCount: 4, retrievalMs: 900, hydrationMs: 800 }),
]);
assert.equal(bandwidth.evidenceBandwidthPerSecond, 4);
assert.equal(bandwidth.factBandwidthPerSecond, 6);

const reportMetrics = aggregateBenchmarkMetrics([
  measuredResult({
    caseId: "report",
    correctEvidenceCount: 1,
    correctFactCount: 1,
    retrievalMs: 10,
    hydrationMs: 5,
  }),
]);
const reportConfiguration = {
  profile: "graph-small",
  corpusSize: 10_000,
  queryCount: 200,
  topK: 20,
  warmupCount: 10,
  warmupPassCount: 10,
  warmupPolicy: "full_corpus_seeded_random",
  concurrency: 4,
  embeddingModel: "test-model",
  embeddingDimensions: 384,
  vectorIndex: null,
  runCount: 1,
  runIndex: 1,
  queryOrderPolicy: "seeded_random_per_pass_shared_across_systems",
  queryOrderSeed: 42,
  queryOrderHash: "test-order-hash",
  hardwareLabel: "test-hardware",
  runtimeLabel: "node test",
  branch: "main",
  commitSha: "abc1234",
  workingTreeDirty: true,
  sourceTreeFingerprint: sourceTreeFingerprint.sha256,
  sourceTreeFingerprintAlgorithm: BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM,
  sourceTreeFileCount: sourceTreeFingerprint.fileCount,
  postgresVersion: "17.6",
  postgresStatementTimeout: "10min",
  prismaPoolConfiguration: BENCHMARK_PRISMA_POOL_CONFIGURATION,
  timestamp: "2026-08-27T00:00:00.000Z",
  databaseLabel: "test-benchmark",
} as const;
const reportSummary: BenchmarkSummaryDocument = {
  schemaVersion: 1,
  generatedAt: reportConfiguration.timestamp,
  configurations: [reportConfiguration],
  systems: [{
    profile: "graph-small",
    systemName: "DERYA_HOT",
    configuration: reportConfiguration,
    status: "completed",
    metrics: { ...reportMetrics, staleEscapeRate: 0, falseConflictRate: 0 },
    byQueryType: { exact: reportMetrics },
    measuredRunIds: ["report-run"],
    warmups: [],
    preparations: [],
  }],
  runs: [],
  bandwidthMultiplier: [],
  projectionAmortization: [],
};
const partialRunSummary = buildBenchmarkSystemSummaries({
  runs: [{
    runId: "partial-run",
    profile: "graph-small",
    systemName: "CURRENT_KEYWORD",
    configuration: {
      ...reportConfiguration,
      runCount: 1,
      status: "failed",
    },
    startedAt: reportConfiguration.timestamp,
    completedAt: reportConfiguration.timestamp,
    metrics: null,
    byQueryType: {},
    warmup: null,
    preparation: null,
  }],
  results: [measuredResult({
    caseId: "partial-result",
    correctEvidenceCount: 1,
    correctFactCount: 1,
    retrievalMs: 10,
    hydrationMs: 10,
  })],
});
assert.equal(partialRunSummary[0]?.status, "failed");
assert.equal(partialRunSummary[0]?.metrics, null);
assert.deepEqual(partialRunSummary[0]?.measuredRunIds, []);
const factOnlyWhenSurfaced = evaluateBenchmarkCase({
  queryType: "current_vs_stale",
  goldFacts: [{ key: "supplier.payment_terms", value: "NET_60" }],
  goldEvidence: [{
    ref: { kind: "supply_profile_fact", id: "fact-1", contentHash: "hash-1" },
    supportsFactKeys: ["supplier.payment_terms"],
  }],
  retrievedFacts: [],
  retrievedEvidence: [{ evidence: [{ kind: "supply_profile_fact", id: "fact-1", contentHash: "hash-1" }] }],
  retrievalMs: 10,
  hydrationMs: 10,
});
assert.equal(factOnlyWhenSurfaced.correctFactCount, 0);
assert.equal(factOnlyWhenSurfaced.factRecallAt20, 0);
assert.equal(factOnlyWhenSurfaced.currentStateAccuracy, 0);

const surfacedCurrentFact = evaluateBenchmarkCase({
  queryType: "current_vs_stale",
  goldFacts: [{ key: "supplier.payment_terms", value: "NET_60" }],
  goldEvidence: [],
  retrievedFacts: [{ key: "supplier.payment_terms", value: "NET_60" }],
  retrievedEvidence: [],
  retrievalMs: 10,
  hydrationMs: 10,
});
assert.equal(surfacedCurrentFact.correctFactCount, 1);
assert.equal(surfacedCurrentFact.factRecallAt20, 1);
assert.equal(surfacedCurrentFact.currentStateAccuracy, 1);

function semanticPacket(
  currentState: Record<string, unknown>,
  derivedState: Record<string, unknown> = {},
): SupplyWorldStatePacket {
  return {
    schemaVersion: 1,
    compilerVersion: "semantic-fact-fixture-v1",
    scope: { type: "workspace", officeId: "office-fixture", workspaceId: "workspace-fixture" },
    objective: "Fixture only",
    compiledAt: "2026-08-01T00:00:00.000Z",
    currentState,
    derivedState,
    openLoops: [],
    uncertainties: [],
    evidenceRefs: [],
    dependencies: [],
    sourceFingerprint: "fixture-source",
    packetHash: "fixture-packet",
    diagnostics: { projectionHit: false, sourceCounts: {}, timingsMs: {} },
  };
}

const typedSemanticFacts = surfaceSupplySemanticFacts(semanticPacket({
  supplier: {
    globalIdentity: { name: "Atlas Fasteners LLC", domain: "atlas-fasteners.example" },
    workspaceIntelligence: {
      facts: [
        { factType: "PAYMENT_TERMS", value: { paymentTerms: "NET_60" }, observedAt: "2026-06-15T00:00:00.000Z" },
        { factType: "PAYMENT_TERMS", value: { payment_terms: "NET_45" }, observedAt: "2025-11-03T00:00:00.000Z" },
        { factType: "PAYMENT_TERMS", value: "NET_30", observedAt: "2025-01-10T00:00:00.000Z" },
      ],
    },
  },
  procurementRequest: {
    requestContext: {
      source: { rfq: "RFQ-BENCH-0048" },
      procurementContext: { service_level: "STANDARD", rush: false },
    },
    vendors: [{
      quote: { revision: "Q-2" },
      triage: { decision: "ESCALATE" },
      conversation: {
        available: true,
        accountEmail: "SHARED-BUYING@example.test",
        messageCount: 1,
        routing: { basis: "EXPLICIT_REQUEST_VENDOR", ambiguousIncluded: false },
        latestMessage: { providerMessageId: "provider-message-not-in-typed-contract" },
      },
    }],
  },
  workspaceSupply: {
    currentSnapshot: { version: 2, publishedAt: "2026-08-01T00:00:00.000Z" },
  },
  itemSupply: {
    currentSnapshot: { version: 2, publishedAt: "2026-08-01T00:00:00.000Z" },
    inventory: [{
      quantityOnHand: "40",
      quantityAllocated: "0",
      quantityInTransit: "50",
      quantityOnOrder: "0",
    }],
    demands: [{ quantity: "120", status: "OPEN" }],
  },
}, {
  itemPlanning: [{ output: { availableAfterDemand: -30, shortage: 30 } }],
  // Free text and untyped history are deliberately outside the adapter.
  historicalStateEvidence: {
    note: "A4-80 READY, REVIEW_QUOTE, provider-msg-exact-012, 5-axis confirmed.",
  },
}));
const typedSemanticFactMap = new Map(typedSemanticFacts.map((fact) => [fact.key, fact]));
for (const [key, value] of Object.entries({
  "supplier.payment_terms.current": "NET_60",
  "supplier.payment_terms.previous": ["NET_30", "NET_45"],
  "supplier.identity.name": "Atlas Fasteners LLC",
  "supplier.identity.domain": "atlas-fasteners.example",
  "procurement.request.service_level": "STANDARD",
  "procurement.request.rush": false,
  "procurement.identifiers.rfq": "RFQ-BENCH-0048",
  "email.routing.account_email": "shared-buying@example.test",
  "email.routing.ambiguous_included": false,
  "workspace.current_snapshot.version": 2,
  "workspace.current_snapshot.published": true,
  "item.supply.shortage": 30,
  "item.supply.available_after_demand": -30,
})) {
  assert.deepEqual(typedSemanticFactMap.get(key)?.value, value, `Typed semantic fact ${key} should surface.`);
  assert.equal(typedSemanticFactMap.get(key)?.adapterVersion, SUPPLY_SEMANTIC_FACT_ADAPTER_VERSION);
}

for (const unsupportedKey of [
  "procurement.vendor.quote_recorded",
  "procurement.vendor.next_action",
  "procurement.vendor.latest_message_id",
  "item.technical_spec.tensile_class",
  "item.technical_spec.processing_state",
  "email.routing.latest_included_message",
  "supplier.capability.broad_cnc",
  "supplier.capability.exact_bom_match",
  "procurement.vendor.triage",
  "procurement.identifiers.purchase_order",
  "procurement.identifiers.sku",
  "procurement.identifiers.provider_message",
]) {
  assert.equal(
    typedSemanticFactMap.has(unsupportedKey),
    false,
    `${unsupportedKey} must remain a miss without a typed source path.`,
  );
}

const unknownInventoryFacts = surfaceSupplySemanticFacts(semanticPacket({
  itemSupply: {
    inventory: [{
      quantityOnHand: "40",
      quantityAllocated: null,
      quantityInTransit: "50",
      quantityOnOrder: "0",
    }],
    demands: [{ quantity: "120", status: "OPEN" }],
  },
  decoy: {
    supplierName: "Atlas Fastener LLC",
    domain: "atlas-fastener.example",
    paymentTerms: "NET_45",
  },
}));
assert.equal(unknownInventoryFacts.some((fact) => fact.key.startsWith("item.supply.")), false);
assert.equal(unknownInventoryFacts.some((fact) => fact.key.startsWith("supplier.")), false);

const orderPassOne = benchmarkCaseOrder({
  cases: generated[0]!.cases,
  profile: "graph-small",
  seed: 42,
  passIndex: 1,
  phase: "measured",
}).map((entry) => entry.id);
const orderPassOneRepeat = benchmarkCaseOrder({
  cases: generated[0]!.cases,
  profile: "graph-small",
  seed: 42,
  passIndex: 1,
  phase: "measured",
}).map((entry) => entry.id);
const orderPassTwo = benchmarkCaseOrder({
  cases: generated[0]!.cases,
  profile: "graph-small",
  seed: 42,
  passIndex: 2,
  phase: "measured",
}).map((entry) => entry.id);
assert.deepEqual(orderPassOne, orderPassOneRepeat);
assert.notDeepEqual(orderPassOne, generated[0]!.cases.map((entry) => entry.id));
assert.notDeepEqual(orderPassOne, orderPassTwo);
const reportHtml = renderBenchmarkReport(reportSummary);
for (const graphId of [
  "recall-system",
  "recall-query-type",
  "recall-latency-pareto",
  "evidence-bandwidth",
  "scale-p95",
  "cold-hot-hydration",
  "semantic-concurrency",
]) {
  assert.match(reportHtml, new RegExp(`id="${graphId}"`));
}
for (const label of [
  "Corpus size",
  "Query count",
  "Top-K",
  "Embedding model",
  "Run count",
  "Hardware",
  "PostgreSQL statement timeout",
  "Prisma pool",
  "Source tree SHA-256",
  "Source file count",
  "Timestamp",
]) {
  assert.equal(reportHtml.split(`<dt>${label}</dt>`).length - 1, 7);
}
assert.match(reportHtml, /10min/);
assert.match(reportHtml, /32 connections \/ 120s wait/);

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

const libraryRoot = join(process.cwd(), "src", "lib");
const benchmarkRoot = join(libraryRoot, "supply-os", "benchmark");
async function assertRuntimeBoundary() {
  const benchmarkSchemaSource = await readFile(join(benchmarkRoot, "schema.ts"), "utf8");
  const semanticFactSource = await readFile(join(benchmarkRoot, "semantic-facts.ts"), "utf8");
  const lexicalRuntimeSource = await readFile(
    join(libraryRoot, "memory", "retrievers", "lexical.ts"),
    "utf8",
  );
  assert.doesNotMatch(semanticFactSource, /from ["'].+\/(?:generate|scenarios|persistence|schema)["']/);
  assert.doesNotMatch(semanticFactSource, /packet\.(?:objective|evidenceRefs)/);
  assert.doesNotMatch(
    lexicalRuntimeSource,
    /(?:from ["'].+supply-os\/benchmark|BENCHMARK_[A-Z_]+)/,
    "Production lexical retrieval must not depend on benchmark-only indexes or modules.",
  );
  assert.match(
    benchmarkSchemaSource,
    /REVOKE ALL ON ALL TABLES IN SCHEMA benchmark FROM derya_app, dashboard_api, bourne_supply_chain/,
    "Schema preparation must clear stale runtime-role grants before applying least privilege.",
  );
  const crossOfficePreflight = benchmarkSchemaSource.indexOf("const crossOfficeMemoryReferences");
  assert.ok(crossOfficePreflight >= 0);
  for (const destructiveStatement of [
    "TRUNCATE TABLE benchmark.results, benchmark.runs, benchmark.cases",
    "DELETE FROM public.procurement_communication_messages",
  ]) {
    assert.ok(
      benchmarkSchemaSource.indexOf(destructiveStatement) > crossOfficePreflight,
      `Reset safety preflights must run before ${destructiveStatement}.`,
    );
  }

  const runtimeFiles = (await filesUnder(libraryRoot)).filter((path) => !path.startsWith(benchmarkRoot));
  const violations: string[] = [];
  for (const path of runtimeFiles) {
    const source = await readFile(path, "utf8");
    if (/benchmark\.(?:cases|runs|results)\b/i.test(source)) {
      violations.push(relative(process.cwd(), path));
    }
  }
  assert.deepEqual(
    violations,
    [],
    "Production runtime modules must not query benchmark metadata tables.",
  );
}

async function assertSourceTreeGitSelection() {
  const paths = await benchmarkSourceTreePaths(process.cwd());
  assert.ok(paths.includes("package.json"), "Tracked repository files must be fingerprinted.");
  assert.ok(
    paths.includes("src/lib/supply-os/benchmark/source-tree.ts"),
    "Nonignored untracked source files must be fingerprinted.",
  );
  assert.equal(
    paths.some((path) => path.startsWith(".benchmark-output/") || path.startsWith("benchmark-output/")),
    false,
    "Ignored benchmark outputs must not be fingerprinted.",
  );
  assert.equal(paths.some((path) => path.startsWith("node_modules/")), false);
}

async function assertVerifiedStatementTimeoutAndParity() {
  let runtimeQuery = "";
  const runtime = await inspectBenchmarkPostgresRuntimeConfiguration({
    async $queryRawUnsafe(query: string) {
      runtimeQuery = query;
      return [{ version: "17.6", statementTimeout: "10min" }];
    },
    async $executeRawUnsafe() {
      throw new Error("Runtime configuration inspection must be read-only.");
    },
  } as BenchmarkSqlClient);
  assert.deepEqual(runtime, { version: "17.6", statementTimeout: "10min" });
  assert.match(runtimeQuery, /current_setting\('statement_timeout'\)/);

  const firstConfiguration = {
    ...reportConfiguration,
    status: "completed",
    runCount: 1,
  } as const;
  const secondConfiguration = {
    ...firstConfiguration,
    profile: "graph-medium",
    corpusSize: 50_000,
    postgresStatementTimeout: "30s",
  } as const;
  let resultQueryReached = false;
  const parityDatabase = {
    async $queryRawUnsafe(query: string) {
      if (/FROM benchmark\.runs/.test(query)) {
        return [
          {
            id: "run-small",
            profile: "graph-small",
            systemName: "CURRENT_KEYWORD",
            configurationJson: firstConfiguration,
            startedAt: reportConfiguration.timestamp,
            completedAt: reportConfiguration.timestamp,
            summaryMetricsJson: {},
          },
          {
            id: "run-medium",
            profile: "graph-medium",
            systemName: "CURRENT_KEYWORD",
            configurationJson: secondConfiguration,
            startedAt: reportConfiguration.timestamp,
            completedAt: reportConfiguration.timestamp,
            summaryMetricsJson: {},
          },
        ];
      }
      resultQueryReached = true;
      return [];
    },
    async $executeRawUnsafe() {
      throw new Error("Artifact loading must be read-only.");
    },
  } as BenchmarkSqlClient;
  await assert.rejects(
    loadLatestBenchmarkArtifacts(parityDatabase),
    /profiles do not share one comparable execution configuration/,
  );
  assert.equal(resultQueryReached, false, "Timeout mismatch must fail before result loading.");

  let candidateConfiguration = {
    ...secondConfiguration,
    postgresStatementTimeout: firstConfiguration.postgresStatementTimeout,
    prismaPoolConfiguration: {
      ...BENCHMARK_PRISMA_POOL_CONFIGURATION,
      poolTimeoutSeconds: 10,
    },
  };
  resultQueryReached = false;
  const poolParityDatabase = {
    async $queryRawUnsafe(query: string) {
      if (/FROM benchmark\.runs/.test(query)) {
        return [
          {
            id: "run-small",
            profile: "graph-small",
            systemName: "CURRENT_KEYWORD",
            configurationJson: firstConfiguration,
            startedAt: reportConfiguration.timestamp,
            completedAt: reportConfiguration.timestamp,
            summaryMetricsJson: {},
          },
          {
            id: "run-medium",
            profile: "graph-medium",
            systemName: "CURRENT_KEYWORD",
            configurationJson: candidateConfiguration,
            startedAt: reportConfiguration.timestamp,
            completedAt: reportConfiguration.timestamp,
            summaryMetricsJson: {},
          },
        ];
      }
      resultQueryReached = true;
      return [];
    },
    async $executeRawUnsafe() {
      throw new Error("Artifact loading must be read-only.");
    },
  } as BenchmarkSqlClient;
  await assert.rejects(
    loadLatestBenchmarkArtifacts(poolParityDatabase),
    /profiles do not share one comparable execution configuration/,
  );
  assert.equal(resultQueryReached, false, "Pool mismatch must fail before result loading.");

  candidateConfiguration = {
    ...secondConfiguration,
    postgresStatementTimeout: firstConfiguration.postgresStatementTimeout,
    sourceTreeFingerprint: "f".repeat(64),
  };
  resultQueryReached = false;
  await assert.rejects(
    loadLatestBenchmarkArtifacts(poolParityDatabase),
    /profiles do not share one comparable execution configuration/,
  );
  assert.equal(resultQueryReached, false, "Source-tree mismatch must fail before result loading.");
}

async function assertBenchmarkLexicalIndexContract() {
  const executed: string[] = [];
  const preparationClient = {
    async $queryRawUnsafe() {
      throw new Error("Lexical index preparation and statistics refresh must not query rows.");
    },
    async $executeRawUnsafe(query: string) {
      executed.push(query);
      return 0;
    },
  } as BenchmarkSqlClient;
  await prepareBenchmarkLexicalIndexes(preparationClient);
  await analyzeBenchmarkLexicalTables(preparationClient);
  assert.deepEqual(executed, [
    ...BENCHMARK_LEXICAL_INDEX_PREPARE_SQL,
    BENCHMARK_LEXICAL_ANALYZE_SQL,
  ]);

  const inspected: Array<{ query: string; values: unknown[] }> = [];
  const validationClient = {
    async $queryRawUnsafe(query: string, ...values: unknown[]) {
      inspected.push({ query, values });
      if (/pg_catalog\.pg_extension/.test(query)) {
        return [{
          extensionInstalled: true,
          indexInstalled: true,
          eventObjectIndexInstalled: true,
        }];
      }
      if (/SELECT "officeId"[\s\S]+FROM public\."MemoryEvent"/.test(query)
        && !/EXPLAIN/.test(query)) {
        return [{ officeId: "benchmark-event-object-plan-probe-office" }];
      }
      if (/EXPLAIN \(FORMAT JSON\)/.test(query)) {
        const indexName = /FROM public\."MemoryEvent"/.test(query)
          ? BENCHMARK_MEMORY_EVENT_OBJECT_INDEX
          : BENCHMARK_KNOWLEDGE_CHUNK_TRIGRAM_INDEX;
        return [{
          "QUERY PLAN": [{
            Plan: {
              "Node Type": "Bitmap Heap Scan",
              Plans: [{
                "Node Type": "Bitmap Index Scan",
                "Index Name": indexName,
              }],
            },
          }],
        }];
      }
      throw new Error(`Unexpected lexical index validation query: ${query}`);
    },
    async $executeRawUnsafe() {
      throw new Error("Lexical index validation must be read-only.");
    },
  } as BenchmarkSqlClient;
  assert.deepEqual(await validateBenchmarkLexicalIndexes(validationClient), {
    extensionInstalled: true,
    indexInstalled: true,
    planUsesIndex: true,
    eventObjectIndexInstalled: true,
    eventObjectPlanUsesIndex: true,
  });
  assert.equal(inspected.length, 4);
  assert.match(inspected[1]!.query, /"text" ILIKE '%benchmark-trigram-plan-probe-7f3c%'/);
  assert.doesNotMatch(inspected[1]!.query, /ANALYZE/);
  assert.match(inspected[2]!.query, /SELECT "officeId"/);
  assert.match(inspected[2]!.query, /"objectId" IS NOT NULL/);
  assert.match(inspected[3]!.query, /FROM public\."MemoryEvent"/);
  assert.match(inspected[3]!.query, /"officeId" = \$1/);
  assert.match(inspected[3]!.query, /"objectId" = 'benchmark-event-object-plan-probe-object'/);
  assert.deepEqual(inspected[3]!.values, ["benchmark-event-object-plan-probe-office"]);
  assert.doesNotMatch(inspected[3]!.query, /ANALYZE/);
}

async function assertWarmupBarrierFailsBeforeMeasuredPersistence() {
  const corpus = generateBenchmarkCorpus("graph-small");
  const caseRows = corpus.cases.map((caseRow) => ({
    id: caseRow.id,
    profile: caseRow.profile,
    queryText: caseRow.queryText,
    queryType: caseRow.queryType,
    difficulty: caseRow.difficulty,
    scopeJson: caseRow.scope,
    goldFactsJson: caseRow.goldFacts,
    goldEvidenceJson: caseRow.goldEvidence,
    goldDependenciesJson: caseRow.goldDependencies,
    metadataJson: caseRow.metadata,
  }));
  const customerMapping: Record<string, string> = {};
  for (const caseRow of corpus.cases) {
    if (caseRow.scope.type === "procurement_request") {
      customerMapping[caseRow.scope.officeId] = caseRow.scope.customerId;
    }
  }
  let persistedWriteCount = 0;
  const database = {
    async $queryRawUnsafe(query: string) {
      if (/FROM benchmark\.cases/.test(query)) return caseRows;
      if (/current_setting\('statement_timeout'\)/.test(query)) {
        return [{ version: "17.6", statementTimeout: "30s" }];
      }
      throw new Error(`Unexpected benchmark query: ${query}`);
    },
    async $executeRawUnsafe() {
      persistedWriteCount += 1;
      return 1;
    },
  } as BenchmarkSqlClient;
  const configuredSystems: string[] = [];
  const executor: DeryaBenchmarkExecutor = {
    vectorRetrieverAvailable: false,
    vectorRetrieverName: null,
    configureSystem(systemName) {
      configuredSystems.push(systemName);
    },
    async prepare() {
      return {
        componentTimingsMs: {},
        projectionBuilt: false,
        projectionPersisted: false,
      };
    },
    async execute(systemName) {
      if (systemName === "DERYA_COLD") throw new Error("fixture warmup failure");
      return {
        retrievedFacts: [],
        retrievedEvidence: [],
        retrievalMs: 1,
        hydrationMs: 1,
        projectionHit: null,
        componentTimingsMs: {},
      };
    },
    async validate() {
      throw new Error("Validation is not used by this fixture.");
    },
  };
  await assert.rejects(
    runCommercialStateBenchmark({
      config,
      database,
      executor,
      procurementCustomerMapping: customerMapping,
      options: {
        profile: "graph-small",
        systems: ["CURRENT_KEYWORD", "DERYA_COLD"],
        topK: 20,
        warmupCount: 3,
        concurrency: 64,
        runCount: 10,
        embeddingModel: "not-configured",
        hardwareLabel: "test-hardware",
        sourceTreeFingerprint: sourceTreeFingerprint.sha256,
        sourceTreeFingerprintAlgorithm: BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM,
        sourceTreeFileCount: sourceTreeFingerprint.fileCount,
        timestamp: reportConfiguration.timestamp,
        vectorEnabled: false,
      },
    }),
    /DERYA_COLD warmup failed for 600 full-corpus executions/,
  );
  assert.deepEqual(configuredSystems, ["CURRENT_KEYWORD", "DERYA_COLD"]);
  assert.equal(
    persistedWriteCount,
    0,
    "No benchmark run or result row may be stored until every runnable system completes warmup.",
  );
}

async function assertBenchmarkClientPoolConfiguration() {
  const databaseUrls: string[] = [];
  const clients = createBenchmarkClients(config, {
    environment: benchmarkEnvironment,
    clientFactory(databaseUrl) {
      databaseUrls.push(databaseUrl);
      return {
        async $queryRawUnsafe() {
          return [];
        },
        async $executeRawUnsafe() {
          return 0;
        },
        async $disconnect() {},
      } as never;
    },
  });
  try {
    assert.equal(databaseUrls.length, 5);
    for (const index of [1, 2, 3]) {
      const parsed = new URL(databaseUrls[index]!);
      assert.equal(parsed.searchParams.get("connection_limit"), "32");
      assert.equal(parsed.searchParams.get("pool_timeout"), "120");
    }
    for (const index of [0, 4]) {
      const parsed = new URL(databaseUrls[index]!);
      assert.equal(parsed.searchParams.has("connection_limit"), false);
      assert.equal(parsed.searchParams.has("pool_timeout"), false);
    }
  } finally {
    await clients.disconnect();
  }
}

async function assertFailedRunStopsLaterPasses() {
  const corpus = generated[0]!;
  const caseRows = corpus.cases.map((caseRow) => ({
    id: caseRow.id,
    profile: caseRow.profile,
    queryText: caseRow.queryText,
    queryType: caseRow.queryType,
    difficulty: caseRow.difficulty,
    scopeJson: caseRow.scope,
    goldFactsJson: caseRow.goldFacts,
    goldEvidenceJson: caseRow.goldEvidence,
    goldDependenciesJson: caseRow.goldDependencies,
    metadataJson: caseRow.metadata,
  }));
  const customerMapping: Record<string, string> = {};
  for (const caseRow of corpus.cases) {
    if (caseRow.scope.type === "procurement_request") {
      customerMapping[caseRow.scope.officeId] = caseRow.scope.customerId;
    }
  }
  const persistedQueries: string[] = [];
  const database = {
    async $queryRawUnsafe(query: string) {
      if (/FROM benchmark\.cases/.test(query)) return caseRows;
      if (/current_setting\('statement_timeout'\)/.test(query)) {
        return [{ version: "17.6", statementTimeout: "10min" }];
      }
      throw new Error(`Unexpected benchmark query: ${query}`);
    },
    async $executeRawUnsafe(query: string) {
      persistedQueries.push(query);
      return 1;
    },
  } as BenchmarkSqlClient;
  let executionCount = 0;
  let configurationCount = 0;
  const executor: DeryaBenchmarkExecutor = {
    vectorRetrieverAvailable: false,
    vectorRetrieverName: null,
    configureSystem() {
      configurationCount += 1;
    },
    async prepare() {
      return {
        componentTimingsMs: {},
        projectionBuilt: false,
        projectionPersisted: false,
      };
    },
    async execute() {
      executionCount += 1;
      if (executionCount === 601) throw new Error("fixture measured failure");
      return {
        retrievedFacts: [],
        retrievedEvidence: [],
        retrievalMs: 1,
        hydrationMs: 1,
        projectionHit: null,
        componentTimingsMs: { fixtureMs: 1 },
      };
    },
    async validate() {
      throw new Error("Validation is not used by this fixture.");
    },
  };
  await assert.rejects(
    runCommercialStateBenchmark({
      config,
      database,
      executor,
      procurementCustomerMapping: customerMapping,
      options: {
        profile: "graph-small",
        systems: ["CURRENT_KEYWORD"],
        topK: 20,
        warmupCount: 3,
        concurrency: 4,
        runCount: 10,
        embeddingModel: "not-configured",
        hardwareLabel: "test-hardware",
        sourceTreeFingerprint: sourceTreeFingerprint.sha256,
        sourceTreeFingerprintAlgorithm: BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM,
        sourceTreeFileCount: sourceTreeFingerprint.fileCount,
        timestamp: reportConfiguration.timestamp,
        vectorEnabled: false,
      },
    }),
    /CURRENT_KEYWORD measured pass 1 failed for 1 cases; later passes were not started/,
  );
  assert.equal(configurationCount, 2, "Only warmup and measured pass 1 may configure the system.");
  assert.equal(executionCount, 800, "The failed pass must finish once without starting pass 2.");
  assert.equal(
    persistedQueries.filter((query) => /INSERT INTO benchmark\.runs/.test(query)).length,
    1,
    "A failed measured pass must not create later run rows.",
  );
  assert.equal(
    persistedQueries.filter((query) => /UPDATE benchmark\.runs/.test(query)).length,
    1,
    "The failed measured pass must be finalized before aborting.",
  );
}

Promise.all([
  assertRuntimeBoundary(),
  assertSourceTreeGitSelection(),
  assertVerifiedStatementTimeoutAndParity(),
  assertBenchmarkClientPoolConfiguration(),
  assertBenchmarkLexicalIndexContract(),
  assertWarmupBarrierFailsBeforeMeasuredPersistence(),
  assertFailedRunStopsLaterPasses(),
])
  .then(() => console.log("Supply state benchmark safety tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
