import { createHash } from "node:crypto";
import {
  BENCHMARK_PROFILE_RETRIEVABLE_TARGETS,
  BENCHMARK_QUERY_DISTRIBUTION,
  BENCHMARK_SEED_VERSION,
  type BenchmarkProfile,
} from "./types";
import {
  BENCHMARK_OFFICE_ID_PREFIX,
  BENCHMARK_OFFICE_NAME_PREFIX,
  type BenchmarkConfig,
  validateBenchmarkConfig,
} from "./config";
import {
  assertBenchmarkClientRoles,
  type BenchmarkClients,
  type BenchmarkSqlClient,
} from "./database";
import {
  benchmarkOperatorId,
  benchmarkStableIds,
} from "./generate";
import { validateBenchmarkMetadataSchema } from "./schema";
import {
  type BenchmarkLexicalIndexValidation,
  validateBenchmarkLexicalIndexes,
} from "./lexical-indexes";

function procurementMessageEvidenceId(args: {
  customerId: string;
  orderId: string;
  vendorId: string;
  provider: string;
  accountEmail: string;
  providerMessageId: string;
}) {
  return createHash("sha256")
    .update([
      args.customerId,
      args.orderId,
      args.vendorId,
      args.provider,
      args.accountEmail,
      args.providerMessageId,
    ].join("\u0000"))
    .digest("hex");
}

export type BenchmarkDoctorFailure = {
  code: string;
  message: string;
  count?: number;
  sampleIds?: string[];
};

export type BenchmarkDoctorReport = {
  ok: boolean;
  checkedAt: string;
  profile: {
    name: BenchmarkProfile;
    targetRetrievableRecords: number;
  };
  seed: {
    version: string | null;
    caseCount: number;
    expectedCaseCount: number;
    retrievableRecordCount: number;
  };
  roleValidation: Record<string, string | boolean>;
  lexicalIndex: BenchmarkLexicalIndexValidation;
  entityCounts: Record<string, number>;
  queryDistribution: {
    expected: Record<string, number>;
    actual: Record<string, number>;
  };
  goldCounts: {
    facts: number;
    evidence: number;
    dependencies: number;
    missingEvidence: number;
  };
  concurrency: {
    cases: number;
    expectedCases: number;
  };
  distractors: {
    cases: number;
    hardNegatives: number;
    retrievableRecords: number;
    ratio: number;
  };
  messages: {
    routedProcurementLedger: number;
    routedEmail: number;
    routedTotal: number;
    unroutedEmail: number;
  };
  dateRange: {
    earliest: string | null;
    latest: string | null;
  };
  failures: BenchmarkDoctorFailure[];
};

type CountRow = { count: number | bigint | string };

function integer(value: unknown) {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

async function count(client: BenchmarkSqlClient, query: string, ...values: unknown[]) {
  const rows = await client.$queryRawUnsafe<CountRow[]>(query, ...values);
  return integer(rows[0]?.count);
}

function profileOfficePattern(profile: BenchmarkProfile) {
  return `${BENCHMARK_OFFICE_ID_PREFIX}${profile}%`;
}

const ENTITY_COUNT_QUERIES: Record<string, string> = {
  offices: `SELECT count(*)::int AS count FROM public."Office" WHERE id LIKE $1 AND name LIKE $2`,
  companies: `SELECT count(*)::int AS count FROM public."Company" WHERE "officeId" LIKE $1`,
  suppliers: `SELECT count(*)::int AS count FROM public."Supplier" WHERE "officeId" LIKE $1`,
  companySuppliers: `SELECT count(*)::int AS count FROM public."CompanySupplier" WHERE "officeId" LIKE $1`,
  workspaces: `SELECT count(*)::int AS count FROM public."SupplyWorkspace" WHERE "officeId" LIKE $1`,
  snapshots: `SELECT count(*)::int AS count FROM public."SupplySnapshot" WHERE "officeId" LIKE $1`,
  companyContext: `SELECT count(*)::int AS count FROM public."CompanyContext" WHERE "officeId" LIKE $1`,
  supplierProfiles: `SELECT count(*)::int AS count FROM public."SupplySupplierProfile" WHERE "officeId" LIKE $1`,
  supplyProfileFacts: `SELECT count(*)::int AS count FROM public."SupplyProfileFact" WHERE "officeId" LIKE $1`,
  supplyPriceObservations: `SELECT count(*)::int AS count FROM public."SupplyPriceObservation" WHERE "officeId" LIKE $1`,
  supplyEvidence: `SELECT count(*)::int AS count FROM public."SupplyEvidence" WHERE "officeId" LIKE $1`,
  supplyExecutionEvents: `SELECT count(*)::int AS count FROM public."SupplyExecutionEvent" WHERE "officeId" LIKE $1`,
  emailMessages: `
    SELECT count(*)::int AS count
    FROM public."EmailMessage" AS message
    JOIN public."EmailThread" AS thread ON thread.id = message."threadId"
    WHERE thread."officeId" LIKE $1
  `,
  routedEmailMessages: `
    SELECT count(*)::int AS count
    FROM public."EmailMessage" AS message
    JOIN public."EmailThread" AS thread ON thread.id = message."threadId"
    WHERE thread."officeId" LIKE $1
      AND thread."companyId" IS NOT NULL
      AND thread."hiddenAt" IS NULL
      AND coalesce(thread."autoLinkSkipReason", '') NOT ILIKE '%ambiguous%'
      AND coalesce(thread."autoLinkSkipReason", '') NOT ILIKE '%unrouted%'
  `,
  unroutedEmailMessages: `
    SELECT count(*)::int AS count
    FROM public."EmailMessage" AS message
    JOIN public."EmailThread" AS thread ON thread.id = message."threadId"
    WHERE thread."officeId" LIKE $1
      AND (
        thread."companyId" IS NULL
        OR thread."hiddenAt" IS NOT NULL
        OR coalesce(thread."autoLinkSkipReason", '') ILIKE '%ambiguous%'
        OR coalesce(thread."autoLinkSkipReason", '') ILIKE '%unrouted%'
      )
  `,
  knowledgeObjects: `SELECT count(*)::int AS count FROM public."KnowledgeObject" WHERE "officeId" LIKE $1`,
  knowledgeChunks: `SELECT count(*)::int AS count FROM public."KnowledgeChunk" WHERE "officeId" LIKE $1`,
  memoryEvents: `SELECT count(*)::int AS count FROM public."MemoryEvent" WHERE "officeId" LIKE $1`,
  distractorRetrievableRecords: `
    SELECT (
      (SELECT count(*) FROM public."KnowledgeObject"
        WHERE "officeId" LIKE $1 AND provenance->>'distractor' = 'true')
      + (SELECT count(*) FROM public."KnowledgeChunk"
        WHERE "officeId" LIKE $1 AND provenance->>'distractor' = 'true')
      + (SELECT count(*) FROM public."MemoryEvent"
        WHERE "officeId" LIKE $1 AND provenance->>'distractor' = 'true')
    )::int AS count
  `,
  procurementRequests: `
    SELECT count(*)::int AS count
    FROM public."ProcurementOrder" AS request
    JOIN public."CompanyWorkflowAccount" AS account ON account.id = request.customer_id
    WHERE account.office_id LIKE $1
  `,
  procurementVendors: `
    SELECT count(*)::int AS count
    FROM public."OrderSupplier" AS vendor
    JOIN public."ProcurementOrder" AS request ON request.id = vendor.order_id
    JOIN public."CompanyWorkflowAccount" AS account ON account.id = request.customer_id
    WHERE account.office_id LIKE $1
  `,
  procurementCommunicationMessages: `
    SELECT count(*)::int AS count
    FROM public.procurement_communication_messages AS message
    JOIN public."CompanyWorkflowAccount" AS account ON account.id = message.customer_id
    WHERE account.office_id LIKE $1
  `,
};

const GOLD_EVIDENCE_TABLES: Record<string, {
  from: string;
  idExpression: string;
  officeExpression: string;
}> = {
  company_context: { from: `public."CompanyContext" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  supply_snapshot: { from: `public."SupplySnapshot" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  supply_evidence: { from: `public."SupplyEvidence" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  supply_profile_fact: { from: `public."SupplyProfileFact" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  supply_price_observation: { from: `public."SupplyPriceObservation" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  planning_result: { from: `public."SupplyPlanningResult" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  supply_decision: { from: `public."SupplyDecision" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  execution_task: { from: `public."SupplyExecutionTask" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  execution_event: { from: `public."SupplyExecutionEvent" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  procurement_order: {
    from: `public."ProcurementOrder" AS evidence JOIN public."CompanyWorkflowAccount" AS account ON account.id = evidence.customer_id`,
    idExpression: "evidence.id",
    officeExpression: "account.office_id",
  },
  procurement_vendor: {
    from: `public."OrderSupplier" AS evidence JOIN public."ProcurementOrder" AS request ON request.id = evidence.order_id JOIN public."CompanyWorkflowAccount" AS account ON account.id = request.customer_id`,
    idExpression: "evidence.id",
    officeExpression: "account.office_id",
  },
  email_message: {
    from: `public."EmailMessage" AS evidence JOIN public."EmailThread" AS thread ON thread.id = evidence."threadId"`,
    idExpression: "evidence.id",
    officeExpression: `coalesce(evidence."officeId", thread."officeId")`,
  },
  knowledge_object: { from: `public."KnowledgeObject" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  knowledge_chunk: { from: `public."KnowledgeChunk" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
  memory_event: { from: `public."MemoryEvent" AS evidence`, idExpression: "evidence.id", officeExpression: `evidence."officeId"` },
};

async function loadEntityCounts(owner: BenchmarkSqlClient, profile: BenchmarkProfile) {
  const pattern = profileOfficePattern(profile);
  const entries = await Promise.all(Object.entries(ENTITY_COUNT_QUERIES).map(async ([name, query]) => {
    const value = name === "offices"
      ? await count(owner, query, pattern, `${BENCHMARK_OFFICE_NAME_PREFIX}%`)
      : await count(owner, query, pattern);
    return [name, value] as const;
  }));
  return Object.fromEntries(entries) as Record<string, number>;
}

async function loadMissingGoldEvidence(owner: BenchmarkSqlClient, profile: BenchmarkProfile) {
  const rows = await owner.$queryRawUnsafe<Array<{
    caseId: string;
    scopeOfficeId: string | null;
    goldEvidence: unknown;
  }>>(`
    SELECT id AS "caseId", scope_json->>'officeId' AS "scopeOfficeId", gold_evidence_json AS "goldEvidence"
    FROM benchmark.cases
    WHERE profile = $1
  `, profile);
  const refsByKind = new Map<string, Set<string>>();
  const refCases = new Map<string, Set<string>>();
  const refOffices = new Map<string, Set<string>>();
  const malformedCases = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row.goldEvidence)) {
      malformedCases.add(row.caseId);
      continue;
    }
    for (const entry of row.goldEvidence) {
      const ref = entry && typeof entry === "object" && "ref" in entry
        ? (entry as { ref?: unknown }).ref
        : entry;
      if (!ref || typeof ref !== "object") {
        malformedCases.add(row.caseId);
        continue;
      }
      const kind = "kind" in ref && typeof ref.kind === "string" ? ref.kind : null;
      const id = "id" in ref && typeof ref.id === "string" ? ref.id : null;
      if (!kind || !id || !row.scopeOfficeId
        || (kind !== "procurement_message" && !GOLD_EVIDENCE_TABLES[kind])) {
        malformedCases.add(row.caseId);
        continue;
      }
      const key = `${kind}\u0000${id}`;
      const ids = refsByKind.get(kind) ?? new Set<string>();
      ids.add(id);
      refsByKind.set(kind, ids);
      const cases = refCases.get(key) ?? new Set<string>();
      cases.add(row.caseId);
      refCases.set(key, cases);
      const offices = refOffices.get(key) ?? new Set<string>();
      offices.add(row.scopeOfficeId);
      refOffices.set(key, offices);
    }
  }

  const missingKeys = new Set<string>();
  const crossOfficeKeys = new Set<string>();
  for (const [kind, ids] of refsByKind) {
    if (kind === "procurement_message") {
      const messages = await owner.$queryRawUnsafe<Array<{
        customerId: string;
        orderId: string;
        vendorId: string;
        provider: string;
        accountEmail: string;
        providerMessageId: string;
        officeId: string;
      }>>(`
        SELECT
          message.customer_id::text AS "customerId",
          message.order_id::text AS "orderId",
          message.vendor_id::text AS "vendorId",
          message.provider,
          message.account_email AS "accountEmail",
          message.provider_message_id AS "providerMessageId",
          account.office_id AS "officeId"
        FROM public.procurement_communication_messages AS message
        JOIN public."CompanyWorkflowAccount" AS account ON account.id = message.customer_id
        WHERE account.office_id LIKE $1
      `, profileOfficePattern(profile));
      const found = new Map(messages.map((message) => [procurementMessageEvidenceId(message), message.officeId]));
      for (const id of ids) {
        const key = `${kind}\u0000${id}`;
        const officeId = found.get(id);
        if (!officeId) missingKeys.add(key);
        else if (![...(refOffices.get(key) ?? [])].every((expected) => expected === officeId)) {
          crossOfficeKeys.add(key);
        }
      }
      continue;
    }
    const mapping = GOLD_EVIDENCE_TABLES[kind];
    const existing = await owner.$queryRawUnsafe<Array<{ id: string; officeId: string }>>(`
      SELECT ${mapping.idExpression}::text AS id, ${mapping.officeExpression}::text AS "officeId"
      FROM ${mapping.from}
      WHERE ${mapping.idExpression}::text IN (
        SELECT jsonb_array_elements_text($1::jsonb)
      )
    `, JSON.stringify([...ids]));
    const found = new Map(existing.map((row) => [row.id, row.officeId]));
    for (const id of ids) {
      const key = `${kind}\u0000${id}`;
      const officeId = found.get(id);
      if (!officeId) missingKeys.add(key);
      else if (![...(refOffices.get(key) ?? [])].every((expected) => expected === officeId)) {
        crossOfficeKeys.add(key);
      }
    }
  }
  const missingCases = new Set<string>(malformedCases);
  for (const key of missingKeys) {
    for (const caseId of refCases.get(key) ?? []) missingCases.add(caseId);
  }
  const crossOfficeCases = new Set<string>();
  for (const key of crossOfficeKeys) {
    for (const caseId of refCases.get(key) ?? []) crossOfficeCases.add(caseId);
  }
  return {
    count: missingKeys.size + malformedCases.size,
    sampleCaseIds: [...missingCases].sort().slice(0, 10),
    crossOfficeCount: crossOfficeKeys.size,
    crossOfficeSampleCaseIds: [...crossOfficeCases].sort().slice(0, 10),
  };
}

async function loadRoleValidation(config: BenchmarkConfig, clients: BenchmarkClients) {
  const identities = await assertBenchmarkClientRoles(config, clients);
  const rows = await clients.owner.$queryRawUnsafe<Array<Record<string, boolean>>>(`
    SELECT
      has_database_privilege(current_user, current_database(), 'CREATE') AS "ownerCanCreateDatabaseObjects",
      has_schema_privilege(current_user, 'public', 'CREATE') AS "ownerCanCreatePublicObjects",
      has_schema_privilege('derya_app', 'benchmark', 'USAGE') AS "appCanUseBenchmarkSchema",
      has_table_privilege('derya_app', 'benchmark.cases', 'SELECT') AS "appCanReadCases",
      has_table_privilege('derya_app', 'benchmark.cases', 'INSERT') AS "appCanWriteCases",
      has_table_privilege('derya_app', 'benchmark.runs', 'SELECT') AS "appCanReadRuns",
      has_table_privilege('derya_app', 'benchmark.runs', 'INSERT') AS "appCanInsertRuns",
      has_table_privilege('derya_app', 'benchmark.runs', 'UPDATE') AS "appCanUpdateRuns",
      has_table_privilege('derya_app', 'benchmark.runs', 'DELETE') AS "appCanDeleteRuns",
      has_table_privilege('derya_app', 'benchmark.results', 'SELECT') AS "appCanReadResults",
      has_table_privilege('derya_app', 'benchmark.results', 'INSERT') AS "appCanInsertResults",
      has_table_privilege('derya_app', 'benchmark.results', 'UPDATE') AS "appCanUpdateResults",
      has_table_privilege('derya_app', 'benchmark.results', 'DELETE') AS "appCanDeleteResults",
      has_table_privilege('dashboard_api', 'public.procurement_communication_messages', 'SELECT') AS "dashboardCanReadLedger",
      has_table_privilege('dashboard_api', 'public.procurement_communication_messages', 'INSERT')
        OR has_table_privilege('dashboard_api', 'public.procurement_communication_messages', 'UPDATE')
        OR has_table_privilege('dashboard_api', 'public.procurement_communication_messages', 'DELETE')
        OR has_table_privilege('dashboard_api', 'public.procurement_communication_messages', 'TRUNCATE')
        AS "dashboardCanWriteLedger",
      has_schema_privilege('dashboard_api', 'benchmark', 'USAGE') AS "dashboardCanUseBenchmarkSchema",
      has_schema_privilege('bourne_supply_chain', 'benchmark', 'USAGE') AS "bourneCanUseBenchmarkSchema"
  `);
  return {
    ownerRole: identities.owner.role,
    appRole: identities.app.role,
    appUnpooledRole: identities.appUnpooled.role,
    dashboardRole: identities.dashboard.role,
    bourneRole: identities.bourne.role,
    ...(rows[0] ?? {}),
  };
}

export async function runBenchmarkDoctor(args: {
  config: BenchmarkConfig;
  profile: BenchmarkProfile;
  clients: BenchmarkClients;
  environment?: Readonly<Record<string, string | undefined>>;
}): Promise<BenchmarkDoctorReport> {
  const config = validateBenchmarkConfig(args.config, args.environment ?? process.env);
  const failures: BenchmarkDoctorFailure[] = [];
  const addFailure = (failure: BenchmarkDoctorFailure) => failures.push(failure);
  const expectedCaseCount = Object.values(BENCHMARK_QUERY_DISTRIBUTION).reduce((sum, value) => sum + value, 0);
  const schema = await validateBenchmarkMetadataSchema(args.clients.owner);
  if (!schema.valid) {
    addFailure({ code: "metadata_schema", message: schema.failures.join(" ") });
  }

  let lexicalIndex: BenchmarkLexicalIndexValidation = {
    extensionInstalled: false,
    indexInstalled: false,
    planUsesIndex: false,
    eventObjectIndexInstalled: false,
    eventObjectPlanUsesIndex: false,
  };
  try {
    lexicalIndex = await validateBenchmarkLexicalIndexes(args.clients.owner);
    if (
      !lexicalIndex.extensionInstalled ||
      !lexicalIndex.indexInstalled ||
      !lexicalIndex.eventObjectIndexInstalled
    ) {
      addFailure({
        code: "lexical_index_contract",
        message: "The benchmark-only lexical index contract is not installed.",
      });
    } else if (!lexicalIndex.planUsesIndex || !lexicalIndex.eventObjectPlanUsesIndex) {
      addFailure({
        code: "lexical_plan_contract",
        message: "PostgreSQL did not use the expected index for an atomic lexical plan probe.",
      });
    }
  } catch (error) {
    addFailure({
      code: "lexical_index_contract",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  let roleValidation: Record<string, string | boolean> = {};
  try {
    roleValidation = await loadRoleValidation(config, args.clients);
    const invalid = roleValidation.ownerCanCreateDatabaseObjects !== true
      || roleValidation.ownerCanCreatePublicObjects !== true
      || roleValidation.appCanUseBenchmarkSchema !== true
      || roleValidation.appCanReadCases !== true
      || roleValidation.appCanWriteCases !== false
      || roleValidation.appCanReadRuns !== true
      || roleValidation.appCanInsertRuns !== true
      || roleValidation.appCanUpdateRuns !== true
      || roleValidation.appCanDeleteRuns !== false
      || roleValidation.appCanReadResults !== true
      || roleValidation.appCanInsertResults !== true
      || roleValidation.appCanUpdateResults !== true
      || roleValidation.appCanDeleteResults !== false
      || roleValidation.dashboardCanReadLedger !== true
      || roleValidation.dashboardCanWriteLedger !== false
      || roleValidation.dashboardCanUseBenchmarkSchema !== false
      || roleValidation.bourneCanUseBenchmarkSchema !== false;
    if (invalid) addFailure({ code: "role_boundary", message: "Benchmark database role privileges do not match the required boundary." });
  } catch (error) {
    addFailure({ code: "role_boundary", message: error instanceof Error ? error.message : String(error) });
  }

  const entityCounts = await loadEntityCounts(args.clients.owner, args.profile);
  const retrievableKeys = [
    "companyContext",
    "procurementCommunicationMessages",
    "emailMessages",
    "knowledgeObjects",
    "knowledgeChunks",
    "memoryEvents",
    "supplyProfileFacts",
    "supplyPriceObservations",
    "supplyEvidence",
    "supplyExecutionEvents",
  ];
  const retrievableRecordCount = retrievableKeys.reduce((sum, key) => sum + (entityCounts[key] ?? 0), 0);
  const expectedEntityCounts: Record<string, number> = {
    offices: 2,
    companies: 12,
    suppliers: 120,
    procurementRequests: 48,
  };
  for (const [entity, expected] of Object.entries(expectedEntityCounts)) {
    if (entityCounts[entity] !== expected) {
      addFailure({
        code: "entity_count",
        message: `${entity} count is ${entityCounts[entity] ?? 0}, expected ${expected}.`,
        count: entityCounts[entity] ?? 0,
      });
    }
  }
  if (retrievableRecordCount !== BENCHMARK_PROFILE_RETRIEVABLE_TARGETS[args.profile]) {
    addFailure({
      code: "retrievable_count",
      message: `Retrievable record count is ${retrievableRecordCount}, expected ${BENCHMARK_PROFILE_RETRIEVABLE_TARGETS[args.profile]}.`,
      count: retrievableRecordCount,
    });
  }

  const caseSummaryRows = await args.clients.owner.$queryRawUnsafe<Array<{
    count: number;
    facts: number;
    evidence: number;
    dependencies: number;
    concurrencyCases: number;
    distractorCases: number;
    hardNegatives: number;
  }>>(`
    SELECT
      count(*)::int AS count,
      coalesce(sum(jsonb_array_length(gold_facts_json)), 0)::int AS facts,
      coalesce(sum(jsonb_array_length(gold_evidence_json)), 0)::int AS evidence,
      coalesce(sum(jsonb_array_length(gold_dependencies_json)), 0)::int AS dependencies,
      count(*) FILTER (WHERE metadata_json ? 'actionConcurrency')::int AS "concurrencyCases",
      count(*) FILTER (
        WHERE jsonb_typeof(metadata_json->'hardNegatives') = 'array'
          AND jsonb_array_length(metadata_json->'hardNegatives') > 0
      )::int AS "distractorCases",
      coalesce(sum(
        CASE WHEN jsonb_typeof(metadata_json->'hardNegatives') = 'array'
          THEN jsonb_array_length(metadata_json->'hardNegatives') ELSE 0 END
      ), 0)::int AS "hardNegatives"
    FROM benchmark.cases
    WHERE profile = $1
  `, args.profile);
  const caseSummary = caseSummaryRows[0] ?? {
    count: 0,
    facts: 0,
    evidence: 0,
    dependencies: 0,
    concurrencyCases: 0,
    distractorCases: 0,
    hardNegatives: 0,
  };
  const caseCount = integer(caseSummary.count);
  if (caseCount !== expectedCaseCount) {
    addFailure({ code: "case_count", message: `Case count is ${caseCount}, expected ${expectedCaseCount}.`, count: caseCount });
  }

  const versionRows = await args.clients.owner.$queryRawUnsafe<Array<{ version: string | null }>>(`
    SELECT DISTINCT metadata_json->>'seedVersion' AS version
    FROM benchmark.cases
    WHERE profile = $1
    ORDER BY version
  `, args.profile);
  const seedVersion = versionRows.length === 1 ? versionRows[0]?.version ?? null : null;
  if (seedVersion !== BENCHMARK_SEED_VERSION) {
    addFailure({ code: "seed_version", message: "Benchmark cases are missing one consistent supported seed version." });
  }

  const distributionRows = await args.clients.owner.$queryRawUnsafe<Array<{ queryType: string; count: number }>>(`
    SELECT query_type AS "queryType", count(*)::int AS count
    FROM benchmark.cases
    WHERE profile = $1
    GROUP BY query_type
    ORDER BY query_type
  `, args.profile);
  const actualDistribution = Object.fromEntries(distributionRows.map((row) => [row.queryType, integer(row.count)]));
  for (const [queryType, expected] of Object.entries(BENCHMARK_QUERY_DISTRIBUTION)) {
    if ((actualDistribution[queryType] ?? 0) !== expected) {
      addFailure({ code: "query_distribution", message: `${queryType} case count does not match the benchmark contract.` });
    }
  }

  const concurrencyCases = integer(caseSummary.concurrencyCases);
  if (concurrencyCases !== 40) {
    addFailure({ code: "concurrency_cases", message: `Concurrency case count is ${concurrencyCases}, expected 40.`, count: concurrencyCases });
  }
  if (integer(caseSummary.distractorCases) === 0 || integer(caseSummary.hardNegatives) === 0) {
    addFailure({ code: "distractors", message: "Benchmark cases do not contain hard-negative distractors." });
  }

  const duplicateCaseKeys = await args.clients.owner.$queryRawUnsafe<Array<{ caseKey: string; count: number }>>(`
    SELECT metadata_json->>'caseKey' AS "caseKey", count(*)::int AS count
    FROM benchmark.cases
    WHERE profile = $1
    GROUP BY metadata_json->>'caseKey'
    HAVING metadata_json->>'caseKey' IS NULL OR count(*) > 1
    ORDER BY metadata_json->>'caseKey' NULLS FIRST
  `, args.profile);
  if (duplicateCaseKeys.length) {
    addFailure({
      code: "duplicate_stable_ids",
      message: "Benchmark case stable IDs are missing or duplicated.",
      count: duplicateCaseKeys.length,
      sampleIds: duplicateCaseKeys.map((row) => row.caseKey ?? "<missing>").slice(0, 10),
    });
  }

  const missingGold = await loadMissingGoldEvidence(args.clients.owner, args.profile);
  if (missingGold.count) {
    addFailure({
      code: "missing_gold_evidence",
      message: "One or more gold evidence pointers do not resolve to canonical rows.",
      count: missingGold.count,
      sampleIds: missingGold.sampleCaseIds,
    });
  }
  if (missingGold.crossOfficeCount) {
    addFailure({
      code: "cross_office_gold_evidence",
      message: "One or more gold evidence pointers resolve outside the case office.",
      count: missingGold.crossOfficeCount,
      sampleIds: missingGold.crossOfficeSampleCaseIds,
    });
  }

  const officePattern = profileOfficePattern(args.profile);
  const expectedOperators = benchmarkStableIds(args.profile).officeIds.map((officeId, index) => ({
    officeId,
    userId: benchmarkOperatorId(args.profile, index as 0 | 1),
  }));
  const operatorRows = await args.clients.owner.$queryRawUnsafe<Array<{
    id: string;
    officeId: string;
    role: string;
    isActive: boolean;
    canViewWholeOffice: boolean;
    isPortalIdentity: boolean;
  }>>(`
    SELECT
      operator.id,
      operator."officeId" AS "officeId",
      operator.role::text AS role,
      operator."isActive" AS "isActive",
      operator."canViewWholeOffice" AS "canViewWholeOffice",
      EXISTS (
        SELECT 1
        FROM public."CustomerPortalUser" AS portal
        WHERE portal."internalUserId" = operator.id
      ) AS "isPortalIdentity"
    FROM public."User" AS operator
    WHERE operator."officeId" LIKE $1
    ORDER BY operator."officeId", operator.id
  `, officePattern);
  const invalidOperators = expectedOperators.filter((expected) => {
    const operator = operatorRows.find((row) => row.id === expected.userId);
    return !operator
      || operator.officeId !== expected.officeId
      || !operator.isActive
      || operator.isPortalIdentity
      || (!operator.canViewWholeOffice && operator.role !== "ADMIN" && operator.role !== "MANAGER");
  });
  if (invalidOperators.length) {
    addFailure({
      code: "company_context_operator",
      message: "Each benchmark office requires its deterministic internal operator for Company Context compilation.",
      count: invalidOperators.length,
      sampleIds: invalidOperators.map((operator) => `${operator.officeId}:${operator.userId}`),
    });
  }
  const workflowMappingRows = await args.clients.owner.$queryRawUnsafe<Array<{
    officeId: string;
    customerCount: number;
    mismatchedRequests: number;
  }>>(`
    WITH scoped_cases AS (
      SELECT
        scope_json->>'officeId' AS office_id,
        scope_json->>'customerId' AS declared_customer_id,
        scope_json->>'orderId' AS order_id
      FROM benchmark.cases
      WHERE profile = $1
        AND scope_json->>'type' = 'procurement_request'
      UNION ALL
      SELECT
        scope_json->>'officeId' AS office_id,
        NULL::text AS declared_customer_id,
        scope_json->>'orderId' AS order_id
      FROM benchmark.cases
      WHERE profile = $1
        AND scope_json->>'type' = 'supplier'
        AND scope_json->>'orderId' IS NOT NULL
    ), resolved AS (
      SELECT
        scoped_cases.office_id,
        scoped_cases.declared_customer_id,
        account.id::text AS actual_customer_id,
        account.office_id AS customer_office_id,
        request.id IS NULL AS request_missing
      FROM scoped_cases
      LEFT JOIN public."ProcurementOrder" AS request
        ON request.id::text = scoped_cases.order_id
      LEFT JOIN public."CompanyWorkflowAccount" AS account
        ON account.id = request.customer_id
    )
    SELECT
      office_id AS "officeId",
      count(DISTINCT coalesce(declared_customer_id, actual_customer_id))::int AS "customerCount",
      count(*) FILTER (
        WHERE request_missing
          OR actual_customer_id IS NULL
          OR customer_office_id IS DISTINCT FROM office_id
          OR (
            declared_customer_id IS NOT NULL
            AND declared_customer_id IS DISTINCT FROM actual_customer_id
          )
      )::int AS "mismatchedRequests"
    FROM resolved
    GROUP BY office_id
    ORDER BY office_id
  `, args.profile);
  const invalidWorkflowMappings = workflowMappingRows.filter((row) => (
    integer(row.customerCount) !== 1 || integer(row.mismatchedRequests) !== 0
  ));
  if (workflowMappingRows.length !== 2 || invalidWorkflowMappings.length) {
    addFailure({
      code: "workflow_customer_mapping",
      message: "Request and supplier cases must resolve through exactly one workflow customer mapping per benchmark office.",
      count: invalidWorkflowMappings.length || Math.abs(2 - workflowMappingRows.length),
      sampleIds: invalidWorkflowMappings.map((row) => row.officeId).slice(0, 10),
    });
  }

  const crossOfficeRows = await args.clients.owner.$queryRawUnsafe<Array<{ relation: string; id: string }>>(`
    SELECT 'company_supplier' AS relation, link.id::text AS id
    FROM public."CompanySupplier" AS link
    JOIN public."Company" AS company ON company.id = link."companyId"
    JOIN public."Supplier" AS supplier ON supplier.id = link."supplierId"
    WHERE link."officeId" LIKE $1
      AND (company."officeId" <> link."officeId" OR supplier."officeId" <> link."officeId")
    UNION ALL
    SELECT 'workspace_company', workspace.id::text
    FROM public."SupplyWorkspace" AS workspace
    JOIN public."Company" AS company ON company.id = workspace."companyId"
    WHERE workspace."officeId" LIKE $1 AND company."officeId" <> workspace."officeId"
    UNION ALL
    SELECT 'context_company', context.id::text
    FROM public."CompanyContext" AS context
    JOIN public."Company" AS company ON company.id = context."companyId"
    WHERE context."officeId" LIKE $1 AND company."officeId" <> context."officeId"
    UNION ALL
    SELECT 'knowledge_chunk_object', chunk.id::text
    FROM public."KnowledgeChunk" AS chunk
    JOIN public."KnowledgeObject" AS object ON object.id = chunk."objectId"
    WHERE chunk."officeId" LIKE $1 AND object."officeId" <> chunk."officeId"
    UNION ALL
    SELECT 'memory_event_object', event.id::text
    FROM public."MemoryEvent" AS event
    JOIN public."KnowledgeObject" AS object ON object.id = event."objectId"
    WHERE event."officeId" LIKE $1 AND object."officeId" <> event."officeId"
    UNION ALL
    SELECT 'email_message_thread', message.id::text
    FROM public."EmailMessage" AS message
    JOIN public."EmailThread" AS thread ON thread.id = message."threadId"
    WHERE thread."officeId" LIKE $1
      AND message."officeId" IS NOT NULL
      AND message."officeId" <> thread."officeId"
    LIMIT 20
  `, officePattern);
  if (crossOfficeRows.length) {
    addFailure({
      code: "cross_office_reference",
      message: "Benchmark corpus contains cross-office canonical references.",
      count: crossOfficeRows.length,
      sampleIds: crossOfficeRows.map((row) => `${row.relation}:${row.id}`).slice(0, 10),
    });
  }

  const missingProvenanceRows = await args.clients.owner.$queryRawUnsafe<Array<{ kind: string; id: string }>>(`
    SELECT 'knowledge_object' AS kind, id::text
    FROM public."KnowledgeObject"
    WHERE "officeId" LIKE $1 AND (jsonb_typeof(provenance) <> 'object' OR provenance = '{}'::jsonb)
    UNION ALL
    SELECT 'knowledge_chunk', id::text
    FROM public."KnowledgeChunk"
    WHERE "officeId" LIKE $1 AND (jsonb_typeof(provenance) <> 'object' OR provenance = '{}'::jsonb)
    UNION ALL
    SELECT 'memory_event', id::text
    FROM public."MemoryEvent"
    WHERE "officeId" LIKE $1 AND (jsonb_typeof(provenance) <> 'object' OR provenance = '{}'::jsonb)
    UNION ALL
    SELECT 'supply_profile_fact', id::text
    FROM public."SupplyProfileFact"
    WHERE "officeId" LIKE $1 AND ("sourceType" = '' OR "contentHash" = '')
    UNION ALL
    SELECT 'supply_price_observation', id::text
    FROM public."SupplyPriceObservation"
    WHERE "officeId" LIKE $1 AND ("sourceUrl" = '' OR "contentHash" = '')
    UNION ALL
    SELECT 'supply_evidence', id::text
    FROM public."SupplyEvidence"
    WHERE "officeId" LIKE $1 AND ("sourceType" = '' OR "contentHash" IS NULL OR "contentHash" = '')
    LIMIT 20
  `, officePattern);
  if (missingProvenanceRows.length) {
    addFailure({
      code: "missing_provenance",
      message: "Benchmark retrievable records are missing source provenance.",
      count: missingProvenanceRows.length,
      sampleIds: missingProvenanceRows.map((row) => `${row.kind}:${row.id}`).slice(0, 10),
    });
  }

  const unroutedMemoryRows = await args.clients.owner.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT DISTINCT object.id::text AS id
    FROM public."KnowledgeObject" AS object
    JOIN public."EmailMessage" AS message ON message.id = object."emailMessageId"
    JOIN public."EmailThread" AS thread ON thread.id = message."threadId"
    WHERE object."officeId" LIKE $1
      AND (
        thread."companyId" IS NULL
        OR thread."hiddenAt" IS NOT NULL
        OR coalesce(thread."autoLinkSkipReason", '') ILIKE '%ambiguous%'
        OR object."officeId" <> thread."officeId"
      )
    LIMIT 20
  `, officePattern);
  if (unroutedMemoryRows.length) {
    addFailure({
      code: "unrouted_memory",
      message: "Ambiguous, hidden, or unrouted email was indexed into Company Brain memory.",
      count: unroutedMemoryRows.length,
      sampleIds: unroutedMemoryRows.map((row) => row.id).slice(0, 10),
    });
  }

  const ambiguousCompanyLinks = await args.clients.owner.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT thread.id::text AS id
    FROM public."EmailThread" AS thread
    LEFT JOIN public."Company" AS company ON company.id = thread."companyId"
    WHERE thread."officeId" LIKE $1
      AND thread."companyId" IS NOT NULL
      AND (
        company.id IS NULL
        OR company."officeId" <> thread."officeId"
        OR coalesce(thread."autoLinkSkipReason", '') ILIKE '%ambiguous%'
      )
    LIMIT 20
  `, officePattern);
  if (ambiguousCompanyLinks.length) {
    addFailure({
      code: "ambiguous_company_link",
      message: "Benchmark email threads contain ambiguous or cross-office company links.",
      count: ambiguousCompanyLinks.length,
      sampleIds: ambiguousCompanyLinks.map((row) => row.id).slice(0, 10),
    });
  }

  const runtimeDependencies = await args.clients.owner.$queryRawUnsafe<Array<{ kind: string; name: string }>>(`
    SELECT 'view' AS kind, schemaname || '.' || viewname AS name
    FROM pg_catalog.pg_views
    WHERE schemaname NOT IN ('benchmark', 'pg_catalog', 'information_schema')
      AND definition ILIKE '%benchmark.%'
    UNION ALL
    SELECT 'function', namespace.nspname || '.' || procedure.proname
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname NOT IN ('benchmark', 'pg_catalog', 'information_schema')
      AND procedure.prokind IN ('f', 'p')
      AND pg_get_functiondef(procedure.oid) ILIKE '%benchmark.%'
    UNION ALL
    SELECT 'foreign_key', namespace.nspname || '.' || constraint_row.conname
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = constraint_row.connamespace
    WHERE constraint_row.contype = 'f'
      AND namespace.nspname <> 'benchmark'
      AND (
        constraint_row.confrelid IN (
          SELECT class.oid FROM pg_catalog.pg_class AS class
          JOIN pg_catalog.pg_namespace AS target_namespace ON target_namespace.oid = class.relnamespace
          WHERE target_namespace.nspname = 'benchmark'
        )
        OR constraint_row.conrelid IN (
          SELECT class.oid FROM pg_catalog.pg_class AS class
          JOIN pg_catalog.pg_namespace AS target_namespace ON target_namespace.oid = class.relnamespace
          WHERE target_namespace.nspname = 'benchmark'
        )
      )
    LIMIT 20
  `);
  if (runtimeDependencies.length) {
    addFailure({
      code: "runtime_benchmark_schema_dependency",
      message: "A non-benchmark database object depends on the benchmark metadata schema.",
      count: runtimeDependencies.length,
      sampleIds: runtimeDependencies.map((row) => `${row.kind}:${row.name}`).slice(0, 10),
    });
  }

  const dateRows = await args.clients.owner.$queryRawUnsafe<Array<{ earliest: Date | string | null; latest: Date | string | null }>>(`
    SELECT min(value) AS earliest, max(value) AS latest
    FROM (
      SELECT "occurredAt" AS value FROM public."MemoryEvent" WHERE "officeId" LIKE $1
      UNION ALL
      SELECT "occurredAt" FROM public."KnowledgeObject" WHERE "officeId" LIKE $1
      UNION ALL
      SELECT "observedAt" FROM public."SupplyPriceObservation" WHERE "officeId" LIKE $1
      UNION ALL
      SELECT "occurredAt" FROM public."SupplyExecutionEvent" WHERE "officeId" LIKE $1
    ) AS dates
  `, officePattern);
  const date = dateRows[0];
  const iso = (value: Date | string | null | undefined) => value == null ? null : new Date(value).toISOString();
  const routedProcurementLedger = entityCounts.procurementCommunicationMessages ?? 0;
  const routedEmail = entityCounts.routedEmailMessages ?? 0;
  const unroutedEmail = entityCounts.unroutedEmailMessages ?? 0;
  const distractorRetrievableRecords = entityCounts.distractorRetrievableRecords ?? 0;

  return {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    profile: {
      name: args.profile,
      targetRetrievableRecords: BENCHMARK_PROFILE_RETRIEVABLE_TARGETS[args.profile],
    },
    seed: {
      version: seedVersion,
      caseCount,
      expectedCaseCount,
      retrievableRecordCount,
    },
    roleValidation,
    lexicalIndex,
    entityCounts,
    queryDistribution: {
      expected: { ...BENCHMARK_QUERY_DISTRIBUTION },
      actual: actualDistribution,
    },
    goldCounts: {
      facts: integer(caseSummary.facts),
      evidence: integer(caseSummary.evidence),
      dependencies: integer(caseSummary.dependencies),
      missingEvidence: missingGold.count,
    },
    concurrency: {
      cases: concurrencyCases,
      expectedCases: 40,
    },
    messages: {
      routedProcurementLedger,
      routedEmail,
      routedTotal: routedProcurementLedger + routedEmail,
      unroutedEmail,
    },
    distractors: {
      cases: integer(caseSummary.distractorCases),
      hardNegatives: integer(caseSummary.hardNegatives),
      retrievableRecords: distractorRetrievableRecords,
      ratio: retrievableRecordCount > 0
        ? distractorRetrievableRecords / retrievableRecordCount
        : 0,
    },
    dateRange: {
      earliest: iso(date?.earliest),
      latest: iso(date?.latest),
    },
    failures,
  };
}
