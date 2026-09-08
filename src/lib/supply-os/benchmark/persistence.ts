import type { BenchmarkSqlClient } from "./database";
import type {
  BenchmarkCase,
  BenchmarkCaseMetadata,
  BenchmarkDifficulty,
  BenchmarkGoldDependency,
  BenchmarkGoldEvidence,
  BenchmarkGoldFact,
  BenchmarkProfile,
  BenchmarkQueryType,
} from "./types";
import {
  BENCHMARK_PROFILES,
  BENCHMARK_QUERY_TYPES,
} from "./types";
import type {
  BenchmarkCaseResult,
  BenchmarkRunConfiguration,
} from "./result-types";
import type { BenchmarkSystemName } from "./systems";
import type { SupplyStateScope } from "../state-runtime/types";

type BenchmarkCaseDatabaseRow = {
  id: string;
  profile: string;
  queryText: string;
  queryType: string;
  difficulty: string;
  scopeJson: unknown;
  goldFactsJson: unknown;
  goldEvidenceJson: unknown;
  goldDependenciesJson: unknown;
  metadataJson: unknown;
};

function parsedJson(value: unknown, label: string) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function object(value: unknown, label: string) {
  const parsed = parsedJson(value, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function array(value: unknown, label: string) {
  const parsed = parsedJson(value, label);
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function parseScope(value: unknown, label: string): SupplyStateScope {
  const scope = object(value, label);
  const type = requiredString(scope.type, `${label}.type`);
  const officeId = requiredString(scope.officeId, `${label}.officeId`);
  if (type === "company") {
    return {
      type,
      officeId,
      companyId: requiredString(scope.companyId, `${label}.companyId`),
      workspaceId: typeof scope.workspaceId === "string" ? scope.workspaceId : null,
    };
  }
  if (type === "procurement_request") {
    return {
      type,
      officeId,
      companyId: requiredString(scope.companyId, `${label}.companyId`),
      customerId: requiredString(scope.customerId, `${label}.customerId`),
      orderId: requiredString(scope.orderId, `${label}.orderId`),
      workspaceId: typeof scope.workspaceId === "string" ? scope.workspaceId : null,
    };
  }
  if (type === "supplier") {
    return {
      type,
      officeId,
      companyId: typeof scope.companyId === "string" ? scope.companyId : null,
      workspaceId: typeof scope.workspaceId === "string" ? scope.workspaceId : null,
      supplierId: typeof scope.supplierId === "string" ? scope.supplierId : null,
      supplierKey: typeof scope.supplierKey === "string" ? scope.supplierKey : null,
      orderId: typeof scope.orderId === "string" ? scope.orderId : null,
      vendorId: typeof scope.vendorId === "string" ? scope.vendorId : null,
    };
  }
  if (type === "item") {
    return {
      type,
      officeId,
      companyId: requiredString(scope.companyId, `${label}.companyId`),
      workspaceId: requiredString(scope.workspaceId, `${label}.workspaceId`),
      itemId: typeof scope.itemId === "string" ? scope.itemId : null,
      itemKey: typeof scope.itemKey === "string" ? scope.itemKey : null,
    };
  }
  if (type === "workspace") {
    return {
      type,
      officeId,
      workspaceId: requiredString(scope.workspaceId, `${label}.workspaceId`),
    };
  }
  throw new Error(`${label}.type is not a supported commercial-state scope.`);
}

function parseCase(row: BenchmarkCaseDatabaseRow): BenchmarkCase {
  const profile = requiredString(row.profile, `benchmark case ${row.id} profile`) as BenchmarkProfile;
  if (!BENCHMARK_PROFILES.includes(profile)) throw new Error(`Benchmark case ${row.id} has an invalid profile.`);
  const queryType = requiredString(row.queryType, `benchmark case ${row.id} query type`) as BenchmarkQueryType;
  if (!BENCHMARK_QUERY_TYPES.includes(queryType)) throw new Error(`Benchmark case ${row.id} has an invalid query type.`);
  const difficulty = requiredString(row.difficulty, `benchmark case ${row.id} difficulty`) as BenchmarkDifficulty;
  if (!(["easy", "medium", "hard"] as const).includes(difficulty)) {
    throw new Error(`Benchmark case ${row.id} has an invalid difficulty.`);
  }
  return {
    id: requiredString(row.id, "benchmark case id"),
    profile,
    queryText: requiredString(row.queryText, `benchmark case ${row.id} query text`),
    queryType,
    difficulty,
    scope: parseScope(row.scopeJson, `benchmark case ${row.id} scope`),
    goldFacts: array(row.goldFactsJson, `benchmark case ${row.id} gold facts`) as BenchmarkGoldFact[],
    goldEvidence: array(row.goldEvidenceJson, `benchmark case ${row.id} gold evidence`) as BenchmarkGoldEvidence[],
    goldDependencies: array(row.goldDependenciesJson, `benchmark case ${row.id} gold dependencies`) as BenchmarkGoldDependency[],
    metadata: object(row.metadataJson, `benchmark case ${row.id} metadata`) as BenchmarkCaseMetadata,
  };
}

export async function loadBenchmarkCases(input: {
  database: BenchmarkSqlClient;
  profile: BenchmarkProfile;
}) {
  const rows = await input.database.$queryRawUnsafe<BenchmarkCaseDatabaseRow[]>(`
    SELECT
      id,
      profile,
      query_text AS "queryText",
      query_type AS "queryType",
      difficulty,
      scope_json AS "scopeJson",
      gold_facts_json AS "goldFactsJson",
      gold_evidence_json AS "goldEvidenceJson",
      gold_dependencies_json AS "goldDependenciesJson",
      metadata_json AS "metadataJson"
    FROM benchmark.cases
    WHERE profile = $1
    ORDER BY id
  `, input.profile);
  const cases = rows.map(parseCase);
  if (!cases.length) throw new Error(`No benchmark cases are loaded for ${input.profile}.`);
  const duplicateIds = cases.filter((caseRow, index) =>
    cases.findIndex((candidate) => candidate.id === caseRow.id) !== index);
  if (duplicateIds.length) throw new Error("Benchmark cases contain duplicate IDs.");
  return cases;
}

export async function loadBenchmarkProcurementCustomerMapping(input: {
  database: BenchmarkSqlClient;
  profile: BenchmarkProfile;
}) {
  const rows = await input.database.$queryRawUnsafe<Array<{ scopeJson: unknown }>>(`
    SELECT scope_json AS "scopeJson"
    FROM benchmark.cases
    WHERE profile = $1
      AND scope_json ->> 'type' = 'procurement_request'
    ORDER BY id
  `, input.profile);
  const mapping = new Map<string, string>();
  for (const [index, row] of rows.entries()) {
    const scope = parseScope(row.scopeJson, `procurement mapping scope ${index + 1}`);
    if (scope.type !== "procurement_request") continue;
    const existing = mapping.get(scope.officeId);
    if (existing && existing !== scope.customerId) {
      throw new Error(`Benchmark office ${scope.officeId} maps to more than one workflow customer.`);
    }
    mapping.set(scope.officeId, scope.customerId);
  }
  if (!mapping.size) throw new Error(`No procurement customer mapping is loaded for ${input.profile}.`);
  return Object.fromEntries(mapping);
}

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

export async function insertBenchmarkRun(input: {
  database: BenchmarkSqlClient;
  runId: string;
  profile: BenchmarkProfile;
  systemName: BenchmarkSystemName;
  configuration: BenchmarkRunConfiguration & {
    status: "running" | "completed" | "skipped";
    skipReason?: string;
  };
  startedAt: string;
}) {
  await input.database.$executeRawUnsafe(`
    INSERT INTO benchmark.runs (
      id,
      profile,
      system_name,
      configuration_json,
      started_at,
      summary_metrics_json
    ) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, '{}'::jsonb)
  `, input.runId, input.profile, input.systemName, json(input.configuration), input.startedAt);
}

export async function insertBenchmarkResult(input: {
  database: BenchmarkSqlClient;
  result: BenchmarkCaseResult;
}) {
  const result = input.result;
  await input.database.$executeRawUnsafe(`
    INSERT INTO benchmark.results (
      run_id,
      case_id,
      latency_ms,
      retrieved_facts_json,
      retrieved_evidence_json,
      validation_result_json,
      metrics_json
    ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)
  `,
  result.runId,
  result.caseId,
  result.latencyMs,
  json(result.retrievedFacts),
  json(result.retrievedEvidence),
  json(result.validationResult),
  json(result.metrics
    ? { executionStatus: result.status, ...result.metrics }
    : { executionStatus: result.status, failureCode: result.failureCode }));
}

export async function completeBenchmarkRun(input: {
  database: BenchmarkSqlClient;
  runId: string;
  completedAt: string;
  configuration: BenchmarkRunConfiguration & {
    status: "completed" | "skipped" | "failed";
    skipReason?: string;
  };
  summaryMetrics: unknown;
}) {
  const changed = await input.database.$executeRawUnsafe(`
    UPDATE benchmark.runs
    SET completed_at = $2::timestamptz,
        configuration_json = $3::jsonb,
        summary_metrics_json = $4::jsonb
    WHERE id = $1
  `, input.runId, input.completedAt, json(input.configuration), json(input.summaryMetrics));
  if (changed !== 1) throw new Error(`Benchmark run ${input.runId} was not completed exactly once.`);
}
