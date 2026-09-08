import type { BenchmarkSqlClient } from "./database";

export const BENCHMARK_KNOWLEDGE_CHUNK_TRIGRAM_INDEX =
  "benchmark_KnowledgeChunk_text_trgm_idx";
export const BENCHMARK_MEMORY_EVENT_OBJECT_INDEX =
  "benchmark_MemoryEvent_officeId_objectId_idx";

export const BENCHMARK_LEXICAL_INDEX_PREPARE_SQL = [
  "CREATE EXTENSION IF NOT EXISTS pg_trgm",
  `CREATE INDEX IF NOT EXISTS "${BENCHMARK_KNOWLEDGE_CHUNK_TRIGRAM_INDEX}"
    ON public."KnowledgeChunk" USING GIN ("text" gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS "${BENCHMARK_MEMORY_EVENT_OBJECT_INDEX}"
    ON public."MemoryEvent" ("officeId", "objectId")`,
] as const;

export const BENCHMARK_LEXICAL_ANALYZE_SQL = `
  ANALYZE
    public."KnowledgeObject",
    public."KnowledgeChunk",
    public."EntityMention",
    public."MemoryEvent"
`;

export async function prepareBenchmarkLexicalIndexes(owner: BenchmarkSqlClient) {
  for (const statement of BENCHMARK_LEXICAL_INDEX_PREPARE_SQL) {
    await owner.$executeRawUnsafe(statement);
  }
}

export async function analyzeBenchmarkLexicalTables(owner: BenchmarkSqlClient) {
  await owner.$executeRawUnsafe(BENCHMARK_LEXICAL_ANALYZE_SQL);
}

type ExplainNode = {
  "Index Name"?: unknown;
  Plans?: unknown;
};

function explainNodes(value: unknown): ExplainNode[] {
  if (Array.isArray(value)) return value.flatMap(explainNodes);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const node = record.Plan && typeof record.Plan === "object"
    ? record.Plan as ExplainNode
    : record as ExplainNode;
  const children = Array.isArray(node.Plans) ? node.Plans.flatMap(explainNodes) : [];
  return [node, ...children];
}

export function benchmarkLexicalPlanUsesTrigramIndex(plan: unknown) {
  return explainNodes(plan).some((node) => (
    node["Index Name"] === BENCHMARK_KNOWLEDGE_CHUNK_TRIGRAM_INDEX
  ));
}

export function benchmarkLexicalPlanUsesEventObjectIndex(plan: unknown) {
  return explainNodes(plan).some((node) => (
    node["Index Name"] === BENCHMARK_MEMORY_EVENT_OBJECT_INDEX
  ));
}

export type BenchmarkLexicalIndexValidation = {
  extensionInstalled: boolean;
  indexInstalled: boolean;
  planUsesIndex: boolean;
  eventObjectIndexInstalled: boolean;
  eventObjectPlanUsesIndex: boolean;
};

export async function validateBenchmarkLexicalIndexes(
  owner: BenchmarkSqlClient,
): Promise<BenchmarkLexicalIndexValidation> {
  const catalogRows = await owner.$queryRawUnsafe<Array<{
    extensionInstalled: boolean;
    indexInstalled: boolean;
    eventObjectIndexInstalled: boolean;
  }>>(`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_extension
        WHERE extname = 'pg_trgm'
      ) AS "extensionInstalled",
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS index_class
        JOIN pg_catalog.pg_namespace AS index_namespace
          ON index_namespace.oid = index_class.relnamespace
        JOIN pg_catalog.pg_index AS index_row
          ON index_row.indexrelid = index_class.oid
        JOIN pg_catalog.pg_class AS table_class
          ON table_class.oid = index_row.indrelid
        JOIN pg_catalog.pg_namespace AS table_namespace
          ON table_namespace.oid = table_class.relnamespace
        JOIN pg_catalog.pg_am AS access_method
          ON access_method.oid = index_class.relam
        JOIN pg_catalog.pg_attribute AS indexed_attribute
          ON indexed_attribute.attrelid = table_class.oid
          AND indexed_attribute.attnum = index_row.indkey[0]
        JOIN pg_catalog.pg_opclass AS operator_class
          ON operator_class.oid = index_row.indclass[0]
        WHERE index_namespace.nspname = 'public'
          AND index_class.relname = '${BENCHMARK_KNOWLEDGE_CHUNK_TRIGRAM_INDEX}'
          AND table_namespace.nspname = 'public'
          AND table_class.relname = 'KnowledgeChunk'
          AND access_method.amname = 'gin'
          AND index_row.indnkeyatts = 1
          AND indexed_attribute.attname = 'text'
          AND operator_class.opcname = 'gin_trgm_ops'
          AND index_row.indisvalid
          AND index_row.indisready
      ) AS "indexInstalled",
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS index_class
        JOIN pg_catalog.pg_namespace AS index_namespace
          ON index_namespace.oid = index_class.relnamespace
        JOIN pg_catalog.pg_index AS index_row
          ON index_row.indexrelid = index_class.oid
        JOIN pg_catalog.pg_class AS table_class
          ON table_class.oid = index_row.indrelid
        JOIN pg_catalog.pg_namespace AS table_namespace
          ON table_namespace.oid = table_class.relnamespace
        JOIN pg_catalog.pg_am AS access_method
          ON access_method.oid = index_class.relam
        WHERE index_namespace.nspname = 'public'
          AND index_class.relname = '${BENCHMARK_MEMORY_EVENT_OBJECT_INDEX}'
          AND table_namespace.nspname = 'public'
          AND table_class.relname = 'MemoryEvent'
          AND access_method.amname = 'btree'
          AND index_row.indnkeyatts = 2
          AND pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) = '"officeId"'
          AND pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) = '"objectId"'
          AND index_row.indisvalid
          AND index_row.indisready
      ) AS "eventObjectIndexInstalled"
  `);
  const trigramPlanRows = await owner.$queryRawUnsafe<Array<{ "QUERY PLAN": unknown }>>(`
    EXPLAIN (FORMAT JSON)
    SELECT id
    FROM public."KnowledgeChunk"
    WHERE "text" ILIKE '%benchmark-trigram-plan-probe-7f3c%'
  `);
  const eventProbeOfficeRows = await owner.$queryRawUnsafe<Array<{ officeId: string }>>(`
    SELECT "officeId"
    FROM public."MemoryEvent"
    WHERE "objectId" IS NOT NULL
    GROUP BY "officeId"
    ORDER BY count(*) DESC, "officeId" ASC
    LIMIT 1
  `);
  const eventProbeOfficeId = eventProbeOfficeRows[0]?.officeId;
  const eventObjectPlanRows = eventProbeOfficeId
    ? await owner.$queryRawUnsafe<Array<{ "QUERY PLAN": unknown }>>(`
        EXPLAIN (FORMAT JSON)
        SELECT id
        FROM public."MemoryEvent"
        WHERE "officeId" = $1
          AND "objectId" = 'benchmark-event-object-plan-probe-object'
      `, eventProbeOfficeId)
    : [];
  const catalog = catalogRows[0];
  return {
    extensionInstalled: catalog?.extensionInstalled === true,
    indexInstalled: catalog?.indexInstalled === true,
    planUsesIndex: benchmarkLexicalPlanUsesTrigramIndex(trigramPlanRows[0]?.["QUERY PLAN"]),
    eventObjectIndexInstalled: catalog?.eventObjectIndexInstalled === true,
    eventObjectPlanUsesIndex: benchmarkLexicalPlanUsesEventObjectIndex(
      eventObjectPlanRows[0]?.["QUERY PLAN"],
    ),
  };
}
