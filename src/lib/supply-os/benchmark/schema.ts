import {
  assertBenchmarkResetAllowed,
  type BenchmarkConfig,
  validateBenchmarkConfig,
} from "./config";
import {
  assertBenchmarkConnection,
  type BenchmarkSqlClient,
} from "./database";
import {
  BENCHMARK_OFFICE_ID_PREFIX,
  BENCHMARK_OFFICE_NAME_PREFIX,
} from "./types";
import {
  analyzeBenchmarkLexicalTables,
  prepareBenchmarkLexicalIndexes,
} from "./lexical-indexes";

export const BENCHMARK_METADATA_TABLES = ["cases", "runs", "results"] as const;

export const BENCHMARK_METADATA_COLUMNS = {
  cases: [
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
  ],
  runs: [
    "id",
    "profile",
    "system_name",
    "configuration_json",
    "started_at",
    "completed_at",
    "summary_metrics_json",
  ],
  results: [
    "run_id",
    "case_id",
    "latency_ms",
    "retrieved_facts_json",
    "retrieved_evidence_json",
    "validation_result_json",
    "metrics_json",
  ],
} as const;

const CREATE_CASES_SQL = `
  CREATE TABLE IF NOT EXISTS benchmark.cases (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL CHECK (profile IN ('graph-small', 'graph-medium', 'graph-large')),
    query_text TEXT NOT NULL,
    query_type TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    scope_json JSONB NOT NULL,
    gold_facts_json JSONB NOT NULL,
    gold_evidence_json JSONB NOT NULL,
    gold_dependencies_json JSONB NOT NULL,
    metadata_json JSONB NOT NULL
  )
`;

const CREATE_RUNS_SQL = `
  CREATE TABLE IF NOT EXISTS benchmark.runs (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL CHECK (profile IN ('graph-small', 'graph-medium', 'graph-large')),
    system_name TEXT NOT NULL,
    configuration_json JSONB NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    summary_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb
  )
`;

const CREATE_RESULTS_SQL = `
  CREATE TABLE IF NOT EXISTS benchmark.results (
    run_id TEXT NOT NULL REFERENCES benchmark.runs(id) ON DELETE CASCADE,
    case_id TEXT NOT NULL REFERENCES benchmark.cases(id) ON DELETE RESTRICT,
    latency_ms DOUBLE PRECISION NOT NULL CHECK (latency_ms >= 0),
    retrieved_facts_json JSONB NOT NULL,
    retrieved_evidence_json JSONB NOT NULL,
    validation_result_json JSONB NOT NULL,
    metrics_json JSONB NOT NULL,
    PRIMARY KEY (run_id, case_id)
  )
`;

async function benchmarkTables(client: BenchmarkSqlClient) {
  const rows = await client.$queryRawUnsafe<Array<{ tableName: string }>>(`
    SELECT tablename::text AS "tableName"
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'benchmark'
    ORDER BY tablename
  `);
  return rows.map((row) => row.tableName);
}

async function assertNoUnexpectedMetadataTables(client: BenchmarkSqlClient) {
  const allowed = new Set<string>(BENCHMARK_METADATA_TABLES);
  const unexpected = (await benchmarkTables(client)).filter((table) => !allowed.has(table));
  if (unexpected.length) {
    throw new Error(`Benchmark schema contains unexpected tables: ${unexpected.join(", ")}.`);
  }
}

export async function validateBenchmarkMetadataSchema(client: BenchmarkSqlClient) {
  const failures: string[] = [];
  const tables = await benchmarkTables(client);
  for (const expected of BENCHMARK_METADATA_TABLES) {
    if (!tables.includes(expected)) failures.push(`benchmark.${expected} is missing.`);
  }
  for (const table of tables) {
    if (!(BENCHMARK_METADATA_TABLES as readonly string[]).includes(table)) {
      failures.push(`benchmark.${table} is not an allowed metadata table.`);
    }
  }
  const columnRows = await client.$queryRawUnsafe<Array<{ tableName: string; columnName: string }>>(`
    SELECT table_name::text AS "tableName", column_name::text AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'benchmark'
    ORDER BY table_name, ordinal_position
  `);
  for (const table of BENCHMARK_METADATA_TABLES) {
    const actual = columnRows.filter((row) => row.tableName === table).map((row) => row.columnName);
    const expected = [...BENCHMARK_METADATA_COLUMNS[table]];
    if (actual.join("\u0000") !== expected.join("\u0000")) {
      failures.push(`benchmark.${table} columns do not match the metadata contract.`);
    }
  }
  return { valid: failures.length === 0, tables, failures };
}

export async function prepareBenchmarkSchema(args: {
  owner: BenchmarkSqlClient;
  config: BenchmarkConfig;
  environment?: Readonly<Record<string, string | undefined>>;
}) {
  const config = validateBenchmarkConfig(args.config, args.environment ?? process.env);
  await assertBenchmarkConnection(args.owner, { databaseName: config.databaseName });
  await prepareBenchmarkLexicalIndexes(args.owner);
  await analyzeBenchmarkLexicalTables(args.owner);
  await assertNoUnexpectedMetadataTables(args.owner);
  await args.owner.$executeRawUnsafe("CREATE SCHEMA IF NOT EXISTS benchmark");
  await args.owner.$executeRawUnsafe("REVOKE ALL ON SCHEMA benchmark FROM PUBLIC");
  await args.owner.$executeRawUnsafe(CREATE_CASES_SQL);
  await args.owner.$executeRawUnsafe(CREATE_RUNS_SQL);
  await args.owner.$executeRawUnsafe(CREATE_RESULTS_SQL);
  await assertNoUnexpectedMetadataTables(args.owner);

  await args.owner.$executeRawUnsafe("REVOKE ALL ON ALL TABLES IN SCHEMA benchmark FROM PUBLIC");
  await args.owner.$executeRawUnsafe("REVOKE ALL ON SCHEMA benchmark FROM derya_app, dashboard_api, bourne_supply_chain");
  await args.owner.$executeRawUnsafe("REVOKE ALL ON ALL TABLES IN SCHEMA benchmark FROM derya_app, dashboard_api, bourne_supply_chain");
  await args.owner.$executeRawUnsafe("GRANT USAGE ON SCHEMA benchmark TO derya_app");
  await args.owner.$executeRawUnsafe("GRANT SELECT ON TABLE benchmark.cases TO derya_app");
  await args.owner.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE ON TABLE benchmark.runs, benchmark.results TO derya_app");

  const validation = await validateBenchmarkMetadataSchema(args.owner);
  if (!validation.valid) throw new Error(validation.failures.join(" "));
  return validation;
}

async function relationExists(client: BenchmarkSqlClient, relation: string) {
  const rows = await client.$queryRawUnsafe<Array<{ exists: boolean }>>(
    "SELECT to_regclass($1)::text IS NOT NULL AS exists",
    relation,
  );
  return rows[0]?.exists === true;
}

export async function resetBenchmarkDatabase(args: {
  owner: BenchmarkSqlClient;
  config: BenchmarkConfig;
  environment?: Readonly<Record<string, string | undefined>>;
}) {
  const environment = args.environment ?? process.env;
  assertBenchmarkResetAllowed(environment);
  const config = validateBenchmarkConfig(args.config, environment);
  await assertBenchmarkConnection(args.owner, { databaseName: config.databaseName });
  if (BENCHMARK_OFFICE_ID_PREFIX.length < 16 || BENCHMARK_OFFICE_NAME_PREFIX.length < 16) {
    throw new Error("Benchmark reset prefixes are not specific enough for a destructive operation.");
  }

  const metadataRelations = await Promise.all(BENCHMARK_METADATA_TABLES.map((table) => (
    relationExists(args.owner, `benchmark.${table}`)
  )));
  if (metadataRelations.some(Boolean) && !metadataRelations.every(Boolean)) {
    throw new Error("Benchmark metadata schema is partial. Run benchmark database prepare before reset.");
  }
  if (metadataRelations.every(Boolean)) await assertNoUnexpectedMetadataTables(args.owner);

  const inconsistentOffices = await args.owner.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT id
    FROM public."Office"
    WHERE (id LIKE $1) <> (name LIKE $2)
    LIMIT 10
  `, `${BENCHMARK_OFFICE_ID_PREFIX}%`, `${BENCHMARK_OFFICE_NAME_PREFIX}%`);
  if (inconsistentOffices.length) {
    throw new Error("Benchmark office reset prefixes do not consistently identify the seeded offices.");
  }

  const crossOfficeMemoryReferences = await args.owner.$queryRawUnsafe<Array<{ source: string }>>(`
    SELECT source
    FROM (
      SELECT 'KnowledgeChunk'::text AS source
      FROM public."KnowledgeChunk" AS child
      JOIN public."KnowledgeObject" AS parent ON parent.id = child."objectId"
      WHERE parent."officeId" LIKE $1 AND child."officeId" NOT LIKE $1
      UNION ALL
      SELECT 'EntityMention'::text
      FROM public."EntityMention" AS child
      JOIN public."KnowledgeObject" AS parent ON parent.id = child."objectId"
      WHERE parent."officeId" LIKE $1 AND child."officeId" NOT LIKE $1
      UNION ALL
      SELECT 'MemoryEvent'::text
      FROM public."MemoryEvent" AS child
      JOIN public."KnowledgeObject" AS parent ON parent.id = child."objectId"
      WHERE parent."officeId" LIKE $1 AND child."officeId" NOT LIKE $1
      UNION ALL
      SELECT 'AgentMemory'::text
      FROM public."AgentMemory" AS child
      JOIN public."KnowledgeObject" AS parent ON parent.id = child."objectId"
      WHERE parent."officeId" LIKE $1 AND child."officeId" NOT LIKE $1
      UNION ALL
      SELECT 'MarketSignal'::text
      FROM public."MarketSignal" AS child
      JOIN public."KnowledgeObject" AS parent ON parent.id = child."sourceObjectId"
      WHERE parent."officeId" LIKE $1 AND child."officeId" NOT LIKE $1
    ) AS cross_office
    LIMIT 1
  `, `${BENCHMARK_OFFICE_ID_PREFIX}%`);
  if (crossOfficeMemoryReferences.length) {
    throw new Error(
      `Benchmark reset found a cross-office Company Brain reference in ${crossOfficeMemoryReferences[0]!.source}.`,
    );
  }

  let metadataReset = false;
  if (metadataRelations.every(Boolean)) {
    await args.owner.$executeRawUnsafe(
      "TRUNCATE TABLE benchmark.results, benchmark.runs, benchmark.cases",
    );
    metadataReset = true;
  }

  let ledgerRowsDeleted = 0;
  if (await relationExists(args.owner, "public.procurement_communication_messages")) {
    ledgerRowsDeleted = await args.owner.$executeRawUnsafe(`
      DELETE FROM public.procurement_communication_messages AS message
      USING public."CompanyWorkflowAccount" AS account
      WHERE message.customer_id = account.id
        AND account.office_id LIKE $1
    `, `${BENCHMARK_OFFICE_ID_PREFIX}%`);
  }

  // The benchmark profiles deliberately contain hundreds of thousands of
  // Company Brain rows. Removing those indexed tenant rows directly avoids a
  // very expensive multi-level cascade when the benchmark offices are deleted.
  // The same validated office prefix still bounds every target.
  await args.owner.$executeRawUnsafe(`
    DELETE FROM public."EntityMention"
    WHERE "officeId" LIKE $1
  `, `${BENCHMARK_OFFICE_ID_PREFIX}%`);
  await args.owner.$executeRawUnsafe(`
    DELETE FROM public."AgentMemory"
    WHERE "officeId" LIKE $1
  `, `${BENCHMARK_OFFICE_ID_PREFIX}%`);
  await args.owner.$executeRawUnsafe(`
    DELETE FROM public."MarketSignal"
    WHERE "officeId" LIKE $1
  `, `${BENCHMARK_OFFICE_ID_PREFIX}%`);
  await args.owner.$executeRawUnsafe(`
    DELETE FROM public."MemoryEvent"
    WHERE "officeId" LIKE $1
  `, `${BENCHMARK_OFFICE_ID_PREFIX}%`);
  await args.owner.$executeRawUnsafe(`
    DELETE FROM public."KnowledgeChunk"
    WHERE "officeId" LIKE $1
  `, `${BENCHMARK_OFFICE_ID_PREFIX}%`);
  const officePatternLiteral = `${BENCHMARK_OFFICE_ID_PREFIX}%`.replaceAll("'", "''");
  await args.owner.$executeRawUnsafe(`
    DO $benchmark_reset$
    BEGIN
      ALTER TABLE public."KnowledgeObject" DISABLE TRIGGER ALL;
      DELETE FROM public."KnowledgeObject"
      WHERE "officeId" LIKE '${officePatternLiteral}';
      ALTER TABLE public."KnowledgeObject" ENABLE TRIGGER ALL;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public."KnowledgeObject" ENABLE TRIGGER ALL;
      RAISE;
    END
    $benchmark_reset$
  `);

  const officesDeleted = await args.owner.$executeRawUnsafe(`
    WITH maintenance AS MATERIALIZED (
      SELECT
        set_config('derya.allow_supply_snapshot_mutation', 'on', true) AS snapshot_enabled,
        set_config('derya.allow_supply_provenance_mutation', 'on', true) AS provenance_enabled
    )
    DELETE FROM public."Office" AS office
    USING maintenance
    WHERE office.id LIKE $1
      AND office.name LIKE $2
      AND maintenance.snapshot_enabled = 'on'
      AND maintenance.provenance_enabled = 'on'
  `, `${BENCHMARK_OFFICE_ID_PREFIX}%`, `${BENCHMARK_OFFICE_NAME_PREFIX}%`);

  return {
    databaseName: config.databaseName,
    ledgerRowsDeleted,
    officesDeleted,
    metadataReset,
  };
}
