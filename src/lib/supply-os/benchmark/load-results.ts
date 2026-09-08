import type { BenchmarkSqlClient } from "./database";
import {
  aggregateBenchmarkMetrics,
  aggregateMetricsByQueryType,
} from "./metrics";
import type {
  BenchmarkCaseMetrics,
  BenchmarkCaseResult,
  BenchmarkMeasuredCaseResult,
  BenchmarkRunConfiguration,
  BenchmarkRunSummary,
  BenchmarkPreparationSummary,
  BenchmarkWarmupSummary,
  BenchmarkValidationResult,
} from "./result-types";
import { buildBenchmarkSummaryDocument } from "./runner";
import {
  BENCHMARK_SYSTEM_NAMES,
  type BenchmarkSystemName,
} from "./systems";

type RunRow = {
  id: string;
  profile: string;
  systemName: string;
  configurationJson: unknown;
  startedAt: Date | string;
  completedAt: Date | string;
  summaryMetricsJson: unknown;
};

type ResultRow = {
  runId: string;
  caseId: string;
  profile: string;
  systemName: string;
  queryType: string;
  difficulty: string;
  latencyMs: number;
  retrievedFactsJson: unknown;
  retrievedEvidenceJson: unknown;
  validationResultJson: unknown;
  metricsJson: unknown;
};

// The full publication cohort exceeds the Node native string limit when
// Prisma serializes all evidence payloads in one result. Bound each transfer.
const RESULT_RUN_BATCH_SIZE = 5;

function compareResultOrder(left: BenchmarkCaseResult, right: BenchmarkCaseResult) {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return compare(left.profile, right.profile)
    || compare(left.systemName, right.systemName)
    || compare(left.runId, right.runId)
    || compare(left.caseId, right.caseId);
}

function parsed(value: unknown) {
  if (typeof value !== "string") return value;
  return JSON.parse(value) as unknown;
}

function object(value: unknown, label: string) {
  const parsedValue = parsed(value);
  if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsedValue as Record<string, unknown>;
}

function array(value: unknown, label: string) {
  const parsedValue = parsed(value);
  if (!Array.isArray(parsedValue)) throw new Error(`${label} must be a JSON array.`);
  return parsedValue;
}

function objectOrEmpty(value: unknown) {
  const parsedValue = parsed(value);
  return parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)
    ? parsedValue as Record<string, unknown>
    : {};
}

function parseRunSupplement(value: unknown, key: "warmup"): BenchmarkWarmupSummary | null;
function parseRunSupplement(value: unknown, key: "preparation"): BenchmarkPreparationSummary | null;
function parseRunSupplement(
  value: unknown,
  key: "warmup" | "preparation",
): BenchmarkWarmupSummary | BenchmarkPreparationSummary | null {
  const supplement = objectOrEmpty(value)[key];
  return supplement && typeof supplement === "object" && !Array.isArray(supplement)
    ? supplement as BenchmarkWarmupSummary | BenchmarkPreparationSummary
    : null;
}

function iso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("Benchmark run timestamp is invalid.");
  return date.toISOString();
}

function systemName(value: string): BenchmarkSystemName {
  if (!BENCHMARK_SYSTEM_NAMES.includes(value as BenchmarkSystemName)) {
    throw new Error(`Persisted benchmark system ${value} is invalid.`);
  }
  return value as BenchmarkSystemName;
}

function vectorModelComparable(configuration: BenchmarkRunConfiguration) {
  const vector = configuration.vectorIndex;
  return vector ? {
    modelId: vector.modelId,
    modelRevision: vector.modelRevision,
    modelDtype: vector.modelDtype,
    dimensions: vector.dimensions,
    runtimePackage: vector.runtimePackage,
    runtimeVersion: vector.runtimeVersion,
    modelAssets: vector.modelAssets,
  } : null;
}

function configuration(row: RunRow) {
  const value = object(row.configurationJson, `benchmark run ${row.id} configuration`);
  const status = value.status;
  if (status !== "completed" && status !== "skipped" && status !== "failed") {
    throw new Error(`Benchmark run ${row.id} has no terminal status.`);
  }
  const warmupCount = Number(value.warmupPassCount ?? value.warmupCount ?? 0);
  return {
    ...value,
    warmupCount,
    warmupPassCount: warmupCount,
    warmupPolicy: value.warmupPolicy ?? "full_corpus_seeded_random",
    embeddingDimensions: value.embeddingDimensions == null ? null : Number(value.embeddingDimensions),
    vectorIndex: value.vectorIndex && typeof value.vectorIndex === "object" && !Array.isArray(value.vectorIndex)
      ? value.vectorIndex
      : null,
    queryOrderPolicy: value.queryOrderPolicy ?? "seeded_random_per_pass_shared_across_systems",
    queryOrderSeed: Number(value.queryOrderSeed ?? 42),
    queryOrderHash: typeof value.queryOrderHash === "string" ? value.queryOrderHash : "legacy-fixed-order",
    runtimeLabel: typeof value.runtimeLabel === "string" ? value.runtimeLabel : "unknown",
    branch: typeof value.branch === "string" ? value.branch : "unknown",
    commitSha: typeof value.commitSha === "string" ? value.commitSha : "unknown",
    workingTreeDirty: Boolean(value.workingTreeDirty),
    sourceTreeFingerprint: typeof value.sourceTreeFingerprint === "string"
      ? value.sourceTreeFingerprint
      : "unknown",
    sourceTreeFingerprintAlgorithm: typeof value.sourceTreeFingerprintAlgorithm === "string"
      ? value.sourceTreeFingerprintAlgorithm
      : "legacy_unknown",
    sourceTreeFileCount: Number(value.sourceTreeFileCount ?? 0),
    postgresVersion: typeof value.postgresVersion === "string" ? value.postgresVersion : "unknown",
    postgresStatementTimeout: typeof value.postgresStatementTimeout === "string"
      ? value.postgresStatementTimeout
      : "unknown",
    prismaPoolConfiguration: value.prismaPoolConfiguration
      && typeof value.prismaPoolConfiguration === "object"
      && !Array.isArray(value.prismaPoolConfiguration)
      ? value.prismaPoolConfiguration
      : {
        connectionLimit: 0,
        poolTimeoutSeconds: 0,
        source: "legacy_unknown",
        appliedTo: [],
      },
  } as BenchmarkRunConfiguration & {
    status: "completed" | "skipped" | "failed";
    skipReason?: string;
  };
}

function latestRunSet(rows: RunRow[]) {
  const groups = new Map<string, RunRow[]>();
  for (const row of rows) {
    const key = `${row.profile}:${row.systemName}`;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return [...groups.values()].flatMap((group) => {
    const newest = [...group].sort((left, right) =>
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0]!;
    const newestConfiguration = configuration(newest);
    const timestamp = newestConfiguration.timestamp;
    return group.filter((row) => configuration(row).timestamp === timestamp);
  }).sort((left, right) =>
    left.profile.localeCompare(right.profile)
    || BENCHMARK_SYSTEM_NAMES.indexOf(systemName(left.systemName)) - BENCHMARK_SYSTEM_NAMES.indexOf(systemName(right.systemName))
    || configuration(left).runIndex - configuration(right).runIndex);
}

function assertComparableRunSets(rows: RunRow[]) {
  const passGroups = new Map<string, RunRow[]>();
  for (const row of rows) {
    const config = configuration(row);
    const key = `${row.profile}:${config.runIndex}`;
    const current = passGroups.get(key) ?? [];
    current.push(row);
    passGroups.set(key, current);
  }
  for (const [key, passRows] of passGroups) {
    const hashes = new Set(passRows.map((row) => configuration(row).queryOrderHash));
    if (hashes.size !== 1) {
      throw new Error(`Benchmark pass ${key} did not use one shared randomized query order.`);
    }
  }
  const profiles = [...new Set(rows.map((row) => row.profile))];
  for (const profile of profiles) {
    const profileRows = rows.filter((row) => row.profile === profile);
    const reference = configuration(profileRows[0]!);
    const comparable = JSON.stringify({
      corpusSize: reference.corpusSize,
      queryCount: reference.queryCount,
      topK: reference.topK,
      warmupCount: reference.warmupCount,
      warmupPassCount: reference.warmupPassCount,
      warmupPolicy: reference.warmupPolicy,
      concurrency: reference.concurrency,
      embeddingModel: reference.embeddingModel,
      embeddingDimensions: reference.embeddingDimensions,
      vectorIndex: reference.vectorIndex,
      runCount: reference.runCount,
      hardwareLabel: reference.hardwareLabel,
      runtimeLabel: reference.runtimeLabel,
      branch: reference.branch,
      commitSha: reference.commitSha,
      workingTreeDirty: reference.workingTreeDirty,
      sourceTreeFingerprint: reference.sourceTreeFingerprint,
      sourceTreeFingerprintAlgorithm: reference.sourceTreeFingerprintAlgorithm,
      sourceTreeFileCount: reference.sourceTreeFileCount,
      postgresVersion: reference.postgresVersion,
      postgresStatementTimeout: reference.postgresStatementTimeout,
      prismaPoolConfiguration: reference.prismaPoolConfiguration,
      queryOrderPolicy: reference.queryOrderPolicy,
      queryOrderSeed: reference.queryOrderSeed,
      timestamp: reference.timestamp,
      databaseLabel: reference.databaseLabel,
    });
    for (const row of profileRows.slice(1)) {
      const candidate = configuration(row);
      const candidateComparable = JSON.stringify({
        corpusSize: candidate.corpusSize,
        queryCount: candidate.queryCount,
        topK: candidate.topK,
        warmupCount: candidate.warmupCount,
        warmupPassCount: candidate.warmupPassCount,
        warmupPolicy: candidate.warmupPolicy,
        concurrency: candidate.concurrency,
        embeddingModel: candidate.embeddingModel,
        embeddingDimensions: candidate.embeddingDimensions,
        vectorIndex: candidate.vectorIndex,
        runCount: candidate.runCount,
        hardwareLabel: candidate.hardwareLabel,
        runtimeLabel: candidate.runtimeLabel,
        branch: candidate.branch,
        commitSha: candidate.commitSha,
        workingTreeDirty: candidate.workingTreeDirty,
        sourceTreeFingerprint: candidate.sourceTreeFingerprint,
        sourceTreeFingerprintAlgorithm: candidate.sourceTreeFingerprintAlgorithm,
        sourceTreeFileCount: candidate.sourceTreeFileCount,
        postgresVersion: candidate.postgresVersion,
        postgresStatementTimeout: candidate.postgresStatementTimeout,
        prismaPoolConfiguration: candidate.prismaPoolConfiguration,
        queryOrderPolicy: candidate.queryOrderPolicy,
        queryOrderSeed: candidate.queryOrderSeed,
        timestamp: candidate.timestamp,
        databaseLabel: candidate.databaseLabel,
      });
      if (candidateComparable !== comparable) {
        throw new Error(`Latest ${profile} system runs do not share one comparable benchmark configuration.`);
      }
    }
  }
  const globalReference = configuration(rows[0]!);
  const globalComparable = JSON.stringify({
    queryCount: globalReference.queryCount,
    topK: globalReference.topK,
    warmupCount: globalReference.warmupCount,
    warmupPassCount: globalReference.warmupPassCount,
    warmupPolicy: globalReference.warmupPolicy,
    concurrency: globalReference.concurrency,
    embeddingModel: globalReference.embeddingModel,
    embeddingDimensions: globalReference.embeddingDimensions,
    vectorModel: vectorModelComparable(globalReference),
    runCount: globalReference.runCount,
    hardwareLabel: globalReference.hardwareLabel,
    runtimeLabel: globalReference.runtimeLabel,
    branch: globalReference.branch,
    commitSha: globalReference.commitSha,
    workingTreeDirty: globalReference.workingTreeDirty,
    sourceTreeFingerprint: globalReference.sourceTreeFingerprint,
    sourceTreeFingerprintAlgorithm: globalReference.sourceTreeFingerprintAlgorithm,
    sourceTreeFileCount: globalReference.sourceTreeFileCount,
    postgresVersion: globalReference.postgresVersion,
    postgresStatementTimeout: globalReference.postgresStatementTimeout,
    prismaPoolConfiguration: globalReference.prismaPoolConfiguration,
    queryOrderPolicy: globalReference.queryOrderPolicy,
    queryOrderSeed: globalReference.queryOrderSeed,
    databaseLabel: globalReference.databaseLabel,
  });
  for (const row of rows.slice(1)) {
    const candidate = configuration(row);
    if (JSON.stringify({
      queryCount: candidate.queryCount,
      topK: candidate.topK,
      warmupCount: candidate.warmupCount,
      warmupPassCount: candidate.warmupPassCount,
      warmupPolicy: candidate.warmupPolicy,
      concurrency: candidate.concurrency,
      embeddingModel: candidate.embeddingModel,
      embeddingDimensions: candidate.embeddingDimensions,
      vectorModel: vectorModelComparable(candidate),
      runCount: candidate.runCount,
      hardwareLabel: candidate.hardwareLabel,
      runtimeLabel: candidate.runtimeLabel,
      branch: candidate.branch,
      commitSha: candidate.commitSha,
      workingTreeDirty: candidate.workingTreeDirty,
      sourceTreeFingerprint: candidate.sourceTreeFingerprint,
      sourceTreeFingerprintAlgorithm: candidate.sourceTreeFingerprintAlgorithm,
      sourceTreeFileCount: candidate.sourceTreeFileCount,
      postgresVersion: candidate.postgresVersion,
      postgresStatementTimeout: candidate.postgresStatementTimeout,
      prismaPoolConfiguration: candidate.prismaPoolConfiguration,
      queryOrderPolicy: candidate.queryOrderPolicy,
      queryOrderSeed: candidate.queryOrderSeed,
      databaseLabel: candidate.databaseLabel,
    }) !== globalComparable) {
      throw new Error("Latest benchmark profiles do not share one comparable execution configuration.");
    }
  }
}

function caseResult(row: ResultRow): BenchmarkCaseResult {
  const metricsValue = object(row.metricsJson, `benchmark result ${row.runId}/${row.caseId} metrics`);
  const executionStatus = metricsValue.executionStatus;
  const common = {
    runId: row.runId,
    caseId: row.caseId,
    profile: row.profile,
    systemName: systemName(row.systemName),
    queryType: row.queryType,
    difficulty: row.difficulty,
    latencyMs: Number(row.latencyMs),
    retrievedFacts: array(row.retrievedFactsJson, `benchmark result ${row.caseId} facts`),
    retrievedEvidence: array(row.retrievedEvidenceJson, `benchmark result ${row.caseId} evidence`),
    validationResult: parsed(row.validationResultJson) as BenchmarkValidationResult | null,
  };
  if (executionStatus === "completed") {
    const { executionStatus: _executionStatus, ...metricFields } = metricsValue;
    const normalizedMetrics = {
      ...metricFields,
      factRecallAt20: Number(metricFields.factRecallAt20 ?? 0),
      componentTimingsMs: objectOrEmpty(metricFields.componentTimingsMs),
      measurementPass: Number(metricFields.measurementPass ?? 1),
      queryOrdinal: Number(metricFields.queryOrdinal ?? 1),
    };
    return {
      ...common,
      status: "completed",
      failureCode: null,
      metrics: normalizedMetrics as unknown as BenchmarkCaseMetrics,
    };
  }
  if (executionStatus !== "failed" && executionStatus !== "skipped") {
    throw new Error(`Benchmark result ${row.runId}/${row.caseId} has an invalid execution status.`);
  }
  return {
    ...common,
    status: executionStatus,
    failureCode: typeof metricsValue.failureCode === "string"
      ? metricsValue.failureCode
      : "unclassified",
    metrics: null,
  };
}

export async function loadLatestBenchmarkArtifacts(database: BenchmarkSqlClient) {
  const allRuns = await database.$queryRawUnsafe<RunRow[]>(`
    SELECT
      id,
      profile,
      system_name AS "systemName",
      configuration_json AS "configurationJson",
      started_at AS "startedAt",
      completed_at AS "completedAt"
      , summary_metrics_json AS "summaryMetricsJson"
    FROM benchmark.runs
    WHERE completed_at IS NOT NULL
    ORDER BY started_at, id
  `);
  if (!allRuns.length) throw new Error("No completed benchmark runs are available.");
  const selectedRows = latestRunSet(allRuns);
  assertComparableRunSets(selectedRows);
  const selectedRunIds = selectedRows.map((row) => row.id);
  const results: BenchmarkCaseResult[] = [];
  for (let offset = 0; offset < selectedRunIds.length; offset += RESULT_RUN_BATCH_SIZE) {
    const resultRows = await database.$queryRawUnsafe<ResultRow[]>(`
    SELECT
      result.run_id AS "runId",
      result.case_id AS "caseId",
      run.profile,
      run.system_name AS "systemName",
      benchmark_case.query_type AS "queryType",
      benchmark_case.difficulty,
      result.latency_ms AS "latencyMs",
      result.retrieved_facts_json AS "retrievedFactsJson",
      result.retrieved_evidence_json AS "retrievedEvidenceJson",
      result.validation_result_json AS "validationResultJson",
      result.metrics_json AS "metricsJson"
    FROM benchmark.results AS result
    JOIN benchmark.runs AS run ON run.id = result.run_id
    JOIN benchmark.cases AS benchmark_case ON benchmark_case.id = result.case_id
    WHERE result.run_id IN (
      SELECT jsonb_array_elements_text($1::jsonb)
    )
    ORDER BY run.profile, run.system_name, result.run_id, result.case_id
    `, JSON.stringify(selectedRunIds.slice(offset, offset + RESULT_RUN_BATCH_SIZE)));
    for (const row of resultRows) results.push(caseResult(row));
  }
  // Run batches can interleave systems. Restore the original global ordering
  // over the benchmark's ASCII profile, system, run, and case identifiers.
  results.sort(compareResultOrder);
  const runs: BenchmarkRunSummary[] = selectedRows.map((row) => {
    const config = configuration(row);
    const runResults = results.filter((result) => result.runId === row.id);
    const measured = runResults.filter((result): result is BenchmarkMeasuredCaseResult =>
      result.status === "completed");
    const complete = config.status === "completed"
      && runResults.length === config.queryCount
      && measured.length === config.queryCount;
    const terminalConfiguration = complete || config.status === "skipped"
      ? config
      : { ...config, status: "failed" as const };
    return {
      runId: row.id,
      profile: row.profile,
      systemName: systemName(row.systemName),
      configuration: terminalConfiguration,
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
      metrics: complete ? aggregateBenchmarkMetrics(measured) : null,
      byQueryType: complete ? aggregateMetricsByQueryType(measured) : {},
      warmup: parseRunSupplement(row.summaryMetricsJson, "warmup"),
      preparation: parseRunSupplement(row.summaryMetricsJson, "preparation"),
    };
  });
  const summary = buildBenchmarkSummaryDocument({ runs, results });
  return { summary, results };
}
