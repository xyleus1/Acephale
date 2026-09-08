import { createHash, randomUUID } from "node:crypto";
import type { BenchmarkConfig } from "./config";
import {
  inspectBenchmarkPostgresRuntimeConfiguration,
  type BenchmarkSqlClient,
} from "./database";
import {
  aggregateBenchmarkMetrics,
  aggregateMetricsByQueryType,
  benchmarkEvidenceKeys,
  calculateBandwidthMultipliers,
  evaluateBenchmarkCase,
  percentile,
  systemKey,
} from "./metrics";
import { writeBenchmarkArtifacts } from "./outputs";
import {
  completeBenchmarkRun,
  insertBenchmarkResult,
  insertBenchmarkRun,
  loadBenchmarkCases,
} from "./persistence";
import type {
  BenchmarkCaseResult,
  BenchmarkMeasuredCaseResult,
  BenchmarkRunConfiguration,
  BenchmarkRunSummary,
  BenchmarkSummaryDocument,
  BenchmarkSystemSummary,
  BenchmarkValidationResult,
  BenchmarkVectorIndexConfiguration,
} from "./result-types";
import {
  BENCHMARK_SYSTEM_NAMES,
  benchmarkSystemAvailability,
  type BenchmarkSystemName,
} from "./systems";
import {
  BENCHMARK_PROFILE_RETRIEVABLE_TARGETS,
  type BenchmarkCase,
  type BenchmarkProfile,
} from "./types";
import { supplyStateScopeRef } from "../state-runtime/types";
import type {
  BenchmarkRuntimeInput,
  DeryaBenchmarkExecutor,
} from "./executor-types";
import { BENCHMARK_PRISMA_POOL_CONFIGURATION } from "./pool-config";
import { BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM } from "./source-tree";

export type CommercialStateBenchmarkOptions = {
  profile: BenchmarkProfile;
  systems?: BenchmarkSystemName[];
  topK: number;
  warmupCount: number;
  concurrency: number;
  runCount: number;
  embeddingModel: string;
  hardwareLabel: string;
  timestamp?: string;
  vectorEnabled: boolean;
  randomSeed?: number;
  embeddingDimensions?: number | null;
  vectorIndex?: BenchmarkVectorIndexConfiguration | null;
  runtimeLabel?: string;
  branch?: string;
  commitSha?: string;
  workingTreeDirty?: boolean;
  sourceTreeFingerprint: string;
  sourceTreeFingerprintAlgorithm: typeof BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM;
  sourceTreeFileCount: number;
};

export type CommercialStateBenchmarkProgress = {
  event: "system_started" | "system_skipped" | "system_completed" | "system_failed";
  profile: BenchmarkProfile;
  systemName: BenchmarkSystemName;
  runIndex: number;
  caseCount: number;
  reason?: string;
};

function positiveInteger(value: number, label: string, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return value;
}

function validateOptions(options: CommercialStateBenchmarkOptions) {
  const topK = positiveInteger(options.topK, "Benchmark top-K", 75);
  if (topK < 20) throw new Error("Benchmark top-K must be at least 20 to measure Recall@20.");
  if (!Number.isInteger(options.warmupCount) || options.warmupCount < 0 || options.warmupCount > 10_000) {
    throw new Error("Benchmark warmup count must be an integer from 0 through 10000.");
  }
  positiveInteger(options.concurrency, "Benchmark concurrency", 64);
  positiveInteger(options.runCount, "Benchmark run count", 100);
  if (options.runCount < 10) {
    throw new Error("Publication benchmark run count must be at least 10 measured passes.");
  }
  if (options.warmupCount < 3) {
    throw new Error("Publication benchmark warmup count must be at least 3 full-corpus passes.");
  }
  const randomSeed = options.randomSeed ?? 42;
  if (!Number.isSafeInteger(randomSeed)) throw new Error("Benchmark random seed must be a safe integer.");
  if (options.embeddingDimensions != null
    && (!Number.isInteger(options.embeddingDimensions) || options.embeddingDimensions < 1)) {
    throw new Error("Benchmark embedding dimensions must be a positive integer when provided.");
  }
  if (!options.embeddingModel.trim()) throw new Error("Benchmark embedding model label is required.");
  if (!options.hardwareLabel.trim()) throw new Error("Benchmark hardware label is required.");
  if (!/^[a-f0-9]{64}$/.test(options.sourceTreeFingerprint)) {
    throw new Error("Benchmark source-tree fingerprint must be a lowercase SHA-256 digest.");
  }
  if (options.sourceTreeFingerprintAlgorithm !== BENCHMARK_SOURCE_TREE_FINGERPRINT_ALGORITHM) {
    throw new Error("Benchmark source-tree fingerprint algorithm is invalid.");
  }
  positiveInteger(options.sourceTreeFileCount, "Benchmark source-tree file count", 10_000_000);
  const systems = options.systems?.length ? [...new Set(options.systems)] : [...BENCHMARK_SYSTEM_NAMES];
  if (systems.some((system) => !BENCHMARK_SYSTEM_NAMES.includes(system))) {
    throw new Error("Benchmark system selection is invalid.");
  }
  return { ...options, systems, topK, randomSeed };
}

function validateCorpus(cases: BenchmarkCase[]) {
  if (cases.length !== 200) {
    throw new Error(`Benchmark profile must contain exactly 200 cases; found ${cases.length}.`);
  }
  const concurrencyCount = cases.filter((caseRow) => caseRow.metadata.actionConcurrency).length;
  if (concurrencyCount !== 40) {
    throw new Error(`Benchmark profile must contain exactly 40 semantic-concurrency cases; found ${concurrencyCount}.`);
  }
}

export function assertBenchmarkCustomerMapping(
  cases: BenchmarkCase[],
  mapping: Readonly<Record<string, string>>,
) {
  for (const caseRow of cases) {
    const scope = caseRow.scope;
    if (scope.type === "procurement_request") {
      if (mapping[scope.officeId] !== scope.customerId) {
        throw new Error(`Benchmark procurement case ${caseRow.id} does not use its office's configured workflow account.`);
      }
    }
    if (scope.type === "supplier" && (scope.orderId || scope.vendorId) && !mapping[scope.officeId]) {
      throw new Error(`Benchmark request-linked supplier case ${caseRow.id} has no configured workflow account.`);
    }
  }
}

/** This is the only object passed into retrieval and state compilation. */
export function benchmarkRuntimeInput(caseRow: BenchmarkCase): BenchmarkRuntimeInput {
  return {
    queryText: caseRow.queryText,
    scope: caseRow.scope,
  };
}

function overlaps(left: unknown, right: unknown) {
  const expected = new Set(benchmarkEvidenceKeys(left));
  return benchmarkEvidenceKeys(right).some((key) => expected.has(key));
}

function leakCounts(caseRow: BenchmarkCase, retrievedEvidence: unknown[]) {
  const tenantLeakIndexes = new Set<number>();
  const unroutedLeakIndexes = new Set<number>();
  retrievedEvidence.forEach((value, index) => {
    const entry = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
    if (entry && typeof entry.officeId === "string" && entry.officeId !== caseRow.scope.officeId) {
      tenantLeakIndexes.add(index);
    }
  });
  for (const negative of caseRow.metadata.hardNegatives) {
    const reason = negative.reason.toLowerCase();
    retrievedEvidence.forEach((value, index) => {
      if (!overlaps(negative.evidenceRef, value)) return;
      if (/other office|foreign|cross[ -]?tenant|tenant/.test(reason)) tenantLeakIndexes.add(index);
      if (/unrouted|ambiguous/.test(reason)) unroutedLeakIndexes.add(index);
    });
  }
  return {
    tenantLeakCount: tenantLeakIndexes.size,
    unroutedLeakCount: unroutedLeakIndexes.size,
  };
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await map(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function runId(profile: BenchmarkProfile, systemName: BenchmarkSystemName, runIndex: number) {
  return [
    "benchmark",
    profile,
    systemName.toLowerCase(),
    String(runIndex),
    randomUUID(),
  ].join(":");
}

function orderHash(cases: readonly BenchmarkCase[]) {
  return createHash("sha256").update(cases.map((entry) => entry.id).join("\n"), "utf8").digest("hex");
}

/** Stable pseudo-random order with no dependence on process-global RNG state. */
export function benchmarkCaseOrder(input: {
  cases: readonly BenchmarkCase[];
  profile: BenchmarkProfile;
  seed: number;
  passIndex: number;
  phase: "warmup" | "measured";
}) {
  return [...input.cases].sort((left, right) => {
    const digest = (caseId: string) => createHash("sha256")
      .update(`${input.seed}:${input.profile}:${input.phase}:${input.passIndex}:${caseId}`, "utf8")
      .digest("hex");
    return digest(left.id).localeCompare(digest(right.id)) || left.id.localeCompare(right.id);
  });
}

function baseConfiguration(input: {
  options: ReturnType<typeof validateOptions>;
  config: BenchmarkConfig;
  caseCount: number;
  runIndex: number;
  timestamp: string;
  queryOrderHash: string;
  postgresVersion: string;
  postgresStatementTimeout: string;
}): BenchmarkRunConfiguration {
  return {
    profile: input.options.profile,
    corpusSize: BENCHMARK_PROFILE_RETRIEVABLE_TARGETS[input.options.profile],
    queryCount: input.caseCount,
    topK: input.options.topK,
    warmupCount: input.options.warmupCount,
    warmupPassCount: input.options.warmupCount,
    warmupPolicy: "full_corpus_seeded_random",
    concurrency: input.options.concurrency,
    embeddingModel: input.options.embeddingModel.trim(),
    embeddingDimensions: input.options.embeddingDimensions ?? null,
    vectorIndex: input.options.vectorIndex ?? null,
    runCount: input.options.runCount,
    runIndex: input.runIndex,
    queryOrderPolicy: "seeded_random_per_pass_shared_across_systems",
    queryOrderSeed: input.options.randomSeed,
    queryOrderHash: input.queryOrderHash,
    hardwareLabel: input.options.hardwareLabel.trim(),
    runtimeLabel: input.options.runtimeLabel?.trim() || `node ${process.version}`,
    branch: input.options.branch?.trim() || "unknown",
    commitSha: input.options.commitSha?.trim() || "unknown",
    workingTreeDirty: input.options.workingTreeDirty ?? false,
    sourceTreeFingerprint: input.options.sourceTreeFingerprint,
    sourceTreeFingerprintAlgorithm: input.options.sourceTreeFingerprintAlgorithm,
    sourceTreeFileCount: input.options.sourceTreeFileCount,
    postgresVersion: input.postgresVersion,
    postgresStatementTimeout: input.postgresStatementTimeout,
    prismaPoolConfiguration: BENCHMARK_PRISMA_POOL_CONFIGURATION,
    timestamp: input.timestamp,
    databaseLabel: input.config.databaseName,
  };
}

async function warmSystem(input: {
  executor: DeryaBenchmarkExecutor;
  systemName: BenchmarkSystemName;
  cases: BenchmarkCase[];
  passCount: number;
  profile: BenchmarkProfile;
  seed: number;
  topK: number;
  concurrency: number;
}) {
  const samples = new Map<string, number[]>();
  const queryOrderHashes: string[] = [];
  let executionCount = 0;
  let failureCount = 0;
  for (let passIndex = 1; passIndex <= input.passCount; passIndex += 1) {
    const ordered = benchmarkCaseOrder({
      cases: input.cases,
      profile: input.profile,
      seed: input.seed,
      passIndex,
      phase: "warmup",
    });
    queryOrderHashes.push(orderHash(ordered));
    const outcomes = await mapConcurrent(ordered, input.concurrency, async (caseRow) => {
      const runtimeInput = benchmarkRuntimeInput(caseRow);
      try {
        const execution = await input.executor.execute(input.systemName, runtimeInput, input.topK);
        let validationWarmupMs: number | null = null;
        if (input.systemName === "DERYA_HOT" && caseRow.metadata.actionConcurrency) {
          // Warm semantic validation on the same full-corpus passes without
          // folding validator work into retrieval or hydration timing.
          const validation = await input.executor.validate({
            officeId: caseRow.scope.officeId,
            stateReadId: caseRow.metadata.actionConcurrency.stateReadId,
          });
          validationWarmupMs = validation.validationMs;
        }
        return {
          ok: true as const,
          timings: {
            ...execution.componentTimingsMs,
            ...(validationWarmupMs == null ? {} : { semanticValidationMs: validationWarmupMs }),
          },
        };
      } catch {
        return { ok: false as const, timings: {} };
      }
    });
    executionCount += outcomes.length;
    for (const outcome of outcomes) {
      if (!outcome.ok) failureCount += 1;
      for (const [name, value] of Object.entries(outcome.timings)) {
        if (!Number.isFinite(value) || value < 0) continue;
        const values = samples.get(name) ?? [];
        values.push(value);
        samples.set(name, values);
      }
    }
  }
  return {
    passCount: input.passCount,
    executionCount,
    failureCount,
    queryOrderHashes,
    componentTimings: Object.fromEntries([...samples.entries()].map(([name, values]) => [name, {
      sampleCount: values.length,
      totalMs: values.reduce((sum, value) => sum + value, 0),
      p50Ms: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
    }])),
  };
}

function aggregateTimingSamples(samples: Map<string, number[]>) {
  return Object.fromEntries([...samples.entries()].map(([name, values]) => [name, {
    sampleCount: values.length,
    totalMs: values.reduce((sum, value) => sum + value, 0),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  }]));
}

async function prepareHotProjections(input: {
  database: BenchmarkSqlClient;
  executor: DeryaBenchmarkExecutor;
  cases: BenchmarkCase[];
  concurrency: number;
}) {
  const officeIds = [...new Set(input.cases.map((entry) => entry.scope.officeId))].sort();
  // The config guard has already proved this is the dedicated benchmark
  // database. Projections are rebuildable cache rows owned by benchmark offices.
  await input.database.$executeRawUnsafe(`
    DELETE FROM "SupplyStateProjection"
    WHERE "officeId" IN (SELECT jsonb_array_elements_text($1::jsonb))
  `, JSON.stringify(officeIds));
  const uniqueScopes = [...new Map(input.cases.map((caseRow) => [
    `${caseRow.scope.officeId}:${caseRow.scope.type}:${supplyStateScopeRef(caseRow.scope)}`,
    caseRow,
  ])).values()];
  const outcomes = await mapConcurrent(uniqueScopes, input.concurrency, async (caseRow) => {
    try {
      const preparation = await input.executor.prepare("DERYA_HOT", benchmarkRuntimeInput(caseRow));
      return {
        ok: preparation.projectionBuilt && preparation.projectionPersisted,
        built: preparation.projectionBuilt,
        persisted: preparation.projectionPersisted,
        timings: preparation.componentTimingsMs,
      };
    } catch {
      return { ok: false, built: false, persisted: false, timings: {} };
    }
  });
  const samples = new Map<string, number[]>();
  for (const outcome of outcomes) {
    for (const [name, value] of Object.entries(outcome.timings)) {
      if (!Number.isFinite(value) || value < 0) continue;
      const values = samples.get(name) ?? [];
      values.push(value);
      samples.set(name, values);
    }
  }
  return {
    projectionCount: uniqueScopes.length,
    failureCount: outcomes.filter((outcome) => !outcome.ok).length,
    buildFailureCount: outcomes.filter((outcome) => !outcome.built).length,
    persistenceFailureCount: outcomes.filter((outcome) => outcome.built && !outcome.persisted).length,
    componentTimings: aggregateTimingSamples(samples),
  };
}

async function measureCase(input: {
  database: BenchmarkSqlClient;
  executor: DeryaBenchmarkExecutor;
  systemName: BenchmarkSystemName;
  caseRow: BenchmarkCase;
  runId: string;
  topK: number;
  measurementPass: number;
  queryOrdinal: number;
}) {
  const runtimeInput = benchmarkRuntimeInput(input.caseRow);
  const startedAt = performance.now();
  const execution = await input.executor.execute(input.systemName, runtimeInput, input.topK);
  const latencyMs = Math.max(0, performance.now() - startedAt);
  let validation: BenchmarkValidationResult | null = null;
  let validationMs: number | null = null;
  const concurrency = input.caseRow.metadata.actionConcurrency ?? null;
  if (concurrency && input.systemName === "DERYA_HOT") {
    const outcome = await input.executor.validate({
      officeId: input.caseRow.scope.officeId,
      stateReadId: concurrency.stateReadId,
    });
    validation = outcome.result;
    validationMs = outcome.validationMs;
  } else if (concurrency) {
    // Baselines with validation disabled proceed without comparing semantic
    // dependencies. Model that explicit behavior so stale-action escape can be
    // compared rather than silently omitted from the safety graph.
    validation = {
      valid: true,
      changedStrict: [],
      changedAdvisory: [],
    };
  }
  const leaks = leakCounts(input.caseRow, execution.retrievedEvidence);
  const metrics = evaluateBenchmarkCase({
    queryType: input.caseRow.queryType,
    goldFacts: input.caseRow.goldFacts,
    goldEvidence: input.caseRow.goldEvidence,
    retrievedFacts: execution.retrievedFacts,
    retrievedEvidence: execution.retrievedEvidence,
    hardNegativeEvidence: input.caseRow.metadata.hardNegatives.map((negative) => negative.evidenceRef),
    retrievalMs: execution.retrievalMs,
    hydrationMs: execution.hydrationMs,
    validationMs,
    componentTimingsMs: execution.componentTimingsMs,
    measurementPass: input.measurementPass,
    queryOrdinal: input.queryOrdinal,
    projectionHit: execution.projectionHit,
    validationResult: validation,
    validationExpectation: concurrency
      ? concurrency.expectedValid ? "unchanged" : "strict_change"
      : null,
    expectedChangedStrictKeys: concurrency?.expectedChangedStrictKeys,
    expectedChangedAdvisoryKeys: concurrency?.expectedChangedAdvisoryKeys,
    ...leaks,
  });
  const result: BenchmarkMeasuredCaseResult = {
    status: "completed",
    failureCode: null,
    runId: input.runId,
    caseId: input.caseRow.id,
    profile: input.caseRow.profile,
    systemName: input.systemName,
    queryType: input.caseRow.queryType,
    difficulty: input.caseRow.difficulty,
    latencyMs,
    retrievedFacts: execution.retrievedFacts,
    retrievedEvidence: execution.retrievedEvidence,
    validationResult: validation,
    metrics,
  };
  await insertBenchmarkResult({ database: input.database, result });
  return result;
}

function failureCode(error: unknown) {
  const object = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const explicit = typeof object.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(object.code)
    ? object.code
    : null;
  const name = error instanceof Error && /^[A-Za-z0-9_.-]{1,80}$/.test(error.name)
    ? error.name
    : "runtime_error";
  return explicit ? `${name}:${explicit}` : name;
}

async function measureCaseSafely(input: Parameters<typeof measureCase>[0]): Promise<BenchmarkCaseResult> {
  const startedAt = performance.now();
  try {
    return await measureCase(input);
  } catch (error) {
    const result: BenchmarkCaseResult = {
      status: "failed",
      failureCode: failureCode(error),
      runId: input.runId,
      caseId: input.caseRow.id,
      profile: input.caseRow.profile,
      systemName: input.systemName,
      queryType: input.caseRow.queryType,
      difficulty: input.caseRow.difficulty,
      latencyMs: Math.max(0, performance.now() - startedAt),
      retrievedFacts: [],
      retrievedEvidence: [],
      validationResult: null,
      metrics: null,
    };
    await insertBenchmarkResult({ database: input.database, result });
    return result;
  }
}

function skippedCaseResult(input: {
  caseRow: BenchmarkCase;
  systemName: BenchmarkSystemName;
  runId: string;
  reason: string;
}): BenchmarkCaseResult {
  return {
    status: "skipped",
    failureCode: input.reason,
    runId: input.runId,
    caseId: input.caseRow.id,
    profile: input.caseRow.profile,
    systemName: input.systemName,
    queryType: input.caseRow.queryType,
    difficulty: input.caseRow.difficulty,
    latencyMs: 0,
    retrievedFacts: [],
    retrievedEvidence: [],
    validationResult: null,
    metrics: null,
  };
}

function rotateSystems(systems: BenchmarkSystemName[], runIndex: number) {
  if (!systems.length) return [];
  const offset = (runIndex - 1) % systems.length;
  return [...systems.slice(offset), ...systems.slice(0, offset)];
}

export function buildBenchmarkSystemSummaries(input: {
  runs: BenchmarkRunSummary[];
  results: BenchmarkCaseResult[];
}) {
  const summaries: BenchmarkSystemSummary[] = [];
  const keys = [...new Set(input.runs.map((run) => systemKey(run.profile, run.systemName)))];
  for (const key of keys) {
    const runs = input.runs.filter((run) => systemKey(run.profile, run.systemName) === key);
    const first = runs[0]!;
    const expectedRunCount = first.configuration.runCount;
    const runIndexes = new Set(runs.map((run) => run.configuration.runIndex));
    const completeRunSet = runs.length === expectedRunCount
      && runIndexes.size === expectedRunCount
      && Array.from({ length: expectedRunCount }, (_, index) => index + 1)
        .every((index) => runIndexes.has(index));
    const failed = !completeRunSet || runs.some((run) => run.configuration.status === "failed");
    const completedRunIds = new Set(runs
      .filter((run) => run.configuration.status === "completed")
      .map((run) => run.runId));
    const measured = failed ? [] : input.results.filter((result): result is BenchmarkMeasuredCaseResult =>
      result.status === "completed"
      && completedRunIds.has(result.runId)
      && systemKey(result.profile, result.systemName) === key);
    const { runIndex: _runIndex, ...configuration } = first.configuration;
    const completed = measured.length > 0;
    const allSkipped = runs.every((run) => run.configuration.status === "skipped");
    summaries.push({
      profile: first.profile,
      systemName: first.systemName,
      configuration,
      status: completed ? "completed" : allSkipped ? "skipped" : "failed",
      ...(!completed ? {
        skipReason: first.configuration.skipReason ?? (allSkipped ? "not_measured" : "all_cases_failed"),
      } : {}),
      metrics: completed ? aggregateBenchmarkMetrics(measured) : null,
      byQueryType: completed ? aggregateMetricsByQueryType(measured) : {},
      measuredRunIds: completed ? runs.filter((run) => run.metrics).map((run) => run.runId) : [],
      warmups: runs.flatMap((run) => run.warmup ? [run.warmup] : []),
      preparations: runs.flatMap((run) => run.preparation ? [run.preparation] : []),
    });
  }
  return summaries.sort((left, right) =>
    left.profile.localeCompare(right.profile)
    || BENCHMARK_SYSTEM_NAMES.indexOf(left.systemName) - BENCHMARK_SYSTEM_NAMES.indexOf(right.systemName));
}

export function buildBenchmarkSummaryDocument(input: {
  runs: BenchmarkRunSummary[];
  results: BenchmarkCaseResult[];
  generatedAt?: string;
}): BenchmarkSummaryDocument {
  const systems = buildBenchmarkSystemSummaries(input);
  const profiles = [...new Set(systems.map((system) => system.profile))].sort();
  const projectionAmortization = profiles.map((profile) => {
    const cold = systems.find((system) => system.profile === profile && system.systemName === "DERYA_COLD");
    const hot = systems.find((system) => system.profile === profile && system.systemName === "DERYA_HOT");
    const build = hot?.preparations[0]?.componentTimings.projectionMaterializationMs?.p50Ms ?? null;
    const coldMs = cold?.metrics?.hydrationP50Ms ?? null;
    const hotMs = hot?.metrics?.hydrationP50Ms ?? null;
    const savings = coldMs != null && hotMs != null ? coldMs - hotMs : null;
    const valid = build != null && savings != null && savings > 0;
    return {
      profile,
      projectionBuildP50Ms: build,
      coldHydrationP50Ms: coldMs,
      hotHydrationP50Ms: hotMs,
      repeatedReadsToBreakEven: valid ? build / savings : null,
      ...(!valid ? { reason: savings != null && savings <= 0 ? "hot_not_faster" : "timing_not_measured" } : {}),
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    configurations: input.runs.map((run) => run.configuration),
    systems,
    runs: input.runs,
    bandwidthMultiplier: calculateBandwidthMultipliers(systems),
    projectionAmortization,
  };
}

export async function runCommercialStateBenchmark(input: {
  config: BenchmarkConfig;
  database: BenchmarkSqlClient;
  executor: DeryaBenchmarkExecutor;
  options: CommercialStateBenchmarkOptions;
  procurementCustomerMapping: Readonly<Record<string, string>>;
  onProgress?: (progress: CommercialStateBenchmarkProgress) => void;
}) {
  const options = validateOptions(input.options);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const cases = await loadBenchmarkCases({ database: input.database, profile: options.profile });
  validateCorpus(cases);
  assertBenchmarkCustomerMapping(cases, input.procurementCustomerMapping);
  const runs: BenchmarkRunSummary[] = [];
  const results: BenchmarkCaseResult[] = [];
  const {
    version: postgresVersion,
    statementTimeout: postgresStatementTimeout,
  } = await inspectBenchmarkPostgresRuntimeConfiguration(input.database);
  const warmupsBySystem = new Map<BenchmarkSystemName, Awaited<ReturnType<typeof warmSystem>>>();
  const preparationsBySystem = new Map<BenchmarkSystemName, Awaited<ReturnType<typeof prepareHotProjections>>>();

  // Establish one publication-wide barrier: every runnable system must finish
  // its full-corpus preparation and warmup before any measured row is stored.
  for (const systemName of options.systems) {
    const availability = benchmarkSystemAvailability({
      system: systemName,
      vectorEnabled: options.vectorEnabled,
      vectorRetrieverAvailable: input.executor.vectorRetrieverAvailable,
    });
    if (!availability.runnable) continue;
    input.executor.configureSystem(systemName);
    if (systemName === "DERYA_HOT") {
      const preparation = await prepareHotProjections({
        database: input.database,
        executor: input.executor,
        cases,
        concurrency: options.concurrency,
      });
      preparationsBySystem.set(systemName, preparation);
      if (preparation.failureCount > 0) {
        throw new Error(`Hot projection preparation failed for ${preparation.failureCount} scoped projections.`);
      }
    }
    const warmup = await warmSystem({
      executor: input.executor,
      systemName,
      cases,
      passCount: options.warmupCount,
      profile: options.profile,
      seed: options.randomSeed,
      topK: options.topK,
      concurrency: options.concurrency,
    });
    warmupsBySystem.set(systemName, warmup);
    if (warmup.failureCount > 0) {
      throw new Error(`${systemName} warmup failed for ${warmup.failureCount} full-corpus executions.`);
    }
  }

  for (let runIndex = 1; runIndex <= options.runCount; runIndex += 1) {
    const orderedCases = benchmarkCaseOrder({
      cases,
      profile: options.profile,
      seed: options.randomSeed,
      passIndex: runIndex,
      phase: "measured",
    });
    const queryOrderHash = orderHash(orderedCases);
    for (const systemName of rotateSystems(options.systems, runIndex)) {
      const id = runId(options.profile, systemName, runIndex);
      const configuration = baseConfiguration({
        options,
        config: input.config,
        caseCount: cases.length,
        runIndex,
        timestamp,
        queryOrderHash,
        postgresVersion,
        postgresStatementTimeout,
      });
      const availability = benchmarkSystemAvailability({
        system: systemName,
        vectorEnabled: options.vectorEnabled,
        vectorRetrieverAvailable: input.executor.vectorRetrieverAvailable,
      });
      const startedAt = new Date().toISOString();
      await insertBenchmarkRun({
        database: input.database,
        runId: id,
        profile: options.profile,
        systemName,
        configuration: {
          ...configuration,
          status: availability.runnable ? "running" : "skipped",
          ...(!availability.runnable ? { skipReason: availability.reason } : {}),
        },
        startedAt,
      });

      if (!availability.runnable) {
        const skippedResults = await mapConcurrent(cases, options.concurrency, async (caseRow) => {
          const result = skippedCaseResult({
            caseRow,
            systemName,
            runId: id,
            reason: availability.reason,
          });
          await insertBenchmarkResult({ database: input.database, result });
          return result;
        });
        results.push(...skippedResults);
        const completedAt = new Date().toISOString();
        const completedConfiguration = {
          ...configuration,
          status: "skipped" as const,
          skipReason: availability.reason,
        };
        await completeBenchmarkRun({
          database: input.database,
          runId: id,
          completedAt,
          configuration: completedConfiguration,
          summaryMetrics: { status: "skipped", reason: availability.reason },
        });
        runs.push({
          runId: id,
          profile: options.profile,
          systemName,
          configuration: completedConfiguration,
          startedAt,
          completedAt,
          metrics: null,
          byQueryType: {},
          warmup: null,
          preparation: null,
        });
        input.onProgress?.({
          event: "system_skipped",
          profile: options.profile,
          systemName,
          runIndex,
          caseCount: cases.length,
          reason: availability.reason,
        });
        continue;
      }

      input.executor.configureSystem(systemName);
      input.onProgress?.({
        event: "system_started",
        profile: options.profile,
        systemName,
        runIndex,
        caseCount: cases.length,
      });
      const runResults = await mapConcurrent(orderedCases, options.concurrency, (caseRow, queryIndex) => measureCaseSafely({
        database: input.database,
        executor: input.executor,
        systemName,
        caseRow,
        runId: id,
        topK: options.topK,
        measurementPass: runIndex,
        queryOrdinal: queryIndex + 1,
      }));
      const measuredRunResults = runResults.filter((result): result is BenchmarkMeasuredCaseResult =>
        result.status === "completed");
      const runComplete = measuredRunResults.length === cases.length;
      const metrics = runComplete ? aggregateBenchmarkMetrics(measuredRunResults) : null;
      const byQueryType = runComplete ? aggregateMetricsByQueryType(measuredRunResults) : {};
      const completedAt = new Date().toISOString();
      const completedConfiguration = {
        ...configuration,
        status: runComplete ? "completed" as const : "failed" as const,
      };
      await completeBenchmarkRun({
        database: input.database,
        runId: id,
        completedAt,
        configuration: completedConfiguration,
        summaryMetrics: {
          status: completedConfiguration.status,
          completedCaseCount: measuredRunResults.length,
          failedCaseCount: runResults.length - measuredRunResults.length,
          ...(metrics ?? {}),
          byQueryType,
          warmup: runIndex === 1 ? warmupsBySystem.get(systemName) ?? null : null,
          preparation: runIndex === 1 ? preparationsBySystem.get(systemName) ?? null : null,
        },
      });
      results.push(...runResults);
      runs.push({
        runId: id,
        profile: options.profile,
        systemName,
        configuration: completedConfiguration,
        startedAt,
        completedAt,
        metrics,
        byQueryType,
        warmup: runIndex === 1 ? warmupsBySystem.get(systemName) ?? null : null,
        preparation: runIndex === 1 ? preparationsBySystem.get(systemName) ?? null : null,
      });
      input.onProgress?.({
        event: runComplete ? "system_completed" : "system_failed",
        profile: options.profile,
        systemName,
        runIndex,
        caseCount: cases.length,
      });
      if (!runComplete) {
        throw new Error(
          `${systemName} measured pass ${runIndex} failed for ${runResults.length - measuredRunResults.length} cases; later passes were not started.`,
        );
      }
    }
  }

  const summary = buildBenchmarkSummaryDocument({ runs, results });
  const artifacts = await writeBenchmarkArtifacts({
    outputDir: input.config.outputDir,
    summary,
    results,
  });
  return { summary, results, artifacts };
}
