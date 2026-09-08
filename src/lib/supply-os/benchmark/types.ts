import type {
  SupplyStateDependency,
  SupplyStateScope,
  SupplyWorldEvidenceRef,
} from "../state-runtime/types";

export const BENCHMARK_SCHEMA_VERSION = 1 as const;
export const BENCHMARK_SEED_VERSION = "commercial-state-v1.0.0" as const;

export const BENCHMARK_ID_PREFIX = "supply-state-benchmark-v1" as const;
export const BENCHMARK_OFFICE_ID_PREFIX = "benchmark-commercial-state-v1-" as const;
export const BENCHMARK_OFFICE_NAME_PREFIX = "Derya Commercial State Benchmark" as const;

export const BENCHMARK_PROFILES = [
  "graph-small",
  "graph-medium",
  "graph-large",
] as const;

export type BenchmarkProfile = (typeof BENCHMARK_PROFILES)[number];

export const BENCHMARK_PROFILE_RETRIEVABLE_TARGETS: Record<BenchmarkProfile, number> = {
  "graph-small": 10_000,
  "graph-medium": 50_000,
  "graph-large": 250_000,
};

export const BENCHMARK_QUERY_TYPES = [
  "exact",
  "semantic",
  "current_vs_stale",
  "temporal",
  "entity_hop",
  "routing_tenant",
  "autopilot_action",
] as const;

export type BenchmarkQueryType = (typeof BENCHMARK_QUERY_TYPES)[number];

export const BENCHMARK_QUERY_DISTRIBUTION: Record<BenchmarkQueryType, number> = {
  exact: 40,
  semantic: 40,
  current_vs_stale: 35,
  temporal: 30,
  entity_hop: 30,
  routing_tenant: 15,
  autopilot_action: 10,
};

export type BenchmarkDifficulty = "easy" | "medium" | "hard";

export type BenchmarkJson =
  | null
  | boolean
  | number
  | string
  | BenchmarkJson[]
  | { [key: string]: BenchmarkJson };

export type BenchmarkGoldFact = {
  key: string;
  value: BenchmarkJson;
};

export type BenchmarkGoldEvidence = {
  ref: SupplyWorldEvidenceRef;
  source: "APP_DB" | "WORKFLOW_DB" | "EMAIL_LEDGER" | "COMPANY_BRAIN";
  supportsFactKeys: string[];
};

export type BenchmarkGoldDependency = Pick<
  SupplyStateDependency,
  "key" | "source" | "entityType" | "entityRef" | "policy" | "reason"
> & {
  expectedVersion: string;
  expectedValueHash: string;
  evidenceRefs: SupplyWorldEvidenceRef[];
};

export type BenchmarkHardNegative = {
  evidenceRef: SupplyWorldEvidenceRef;
  reason: string;
};

export type BenchmarkConcurrencyMutation =
  | {
      kind: "vendor_latest_message";
      orderId: string;
      vendorId: string;
      providerMessageId: string;
    }
  | {
      kind: "vendor_quote";
      orderId: string;
      vendorId: string;
      quoteRevision: string;
    }
  | {
      kind: "vendor_saved_draft";
      orderId: string;
      vendorId: string;
      inputHash: string;
    }
  | {
      kind: "company_context_document";
      companyId: string;
      contextId: string;
      contentHash: string;
    }
  | {
      kind: "workspace_snapshot";
      workspaceId: string;
      snapshotId: string;
      sourceHash: string;
    }
  | {
      kind: "supplier_fact_head";
      workspaceId: string;
      supplierKey: string;
      factId: string;
      contentHash: string;
    }
  | {
      kind: "supplier_price_head";
      workspaceId: string;
      supplierKey: string;
      observationId: string;
      contentHash: string;
    };

export type BenchmarkActionConcurrency = {
  stateReadId: string;
  expectedValid: boolean;
  expectedChangedStrictKeys: string[];
  expectedChangedAdvisoryKeys: string[];
  baselineDependencyKey: string;
  mutation: BenchmarkConcurrencyMutation;
  unrelatedControl?: BenchmarkConcurrencyMutation;
};

export type BenchmarkCaseMetadata = {
  schemaVersion: 1;
  seedVersion: string;
  caseKey: string;
  scenarioId: string;
  scenarioFamily: string;
  hardNegatives: BenchmarkHardNegative[];
  actionConcurrency?: BenchmarkActionConcurrency;
};

export type BenchmarkCase = {
  id: string;
  profile: BenchmarkProfile;
  queryText: string;
  queryType: BenchmarkQueryType;
  difficulty: BenchmarkDifficulty;
  scope: SupplyStateScope;
  goldFacts: BenchmarkGoldFact[];
  goldEvidence: BenchmarkGoldEvidence[];
  goldDependencies: BenchmarkGoldDependency[];
  metadata: BenchmarkCaseMetadata;
};

export type BenchmarkRuntimeQuery = {
  caseId: string;
  profile: BenchmarkProfile;
  query: string;
  queryType: BenchmarkQueryType;
  scope: SupplyStateScope;
};

export type BenchmarkStableIds = {
  profile: BenchmarkProfile;
  officeIds: readonly [string, string];
  companyIds: string[];
  workflowCustomerIds: string[];
  workspaceIds: string[];
  supplierIds: string[];
  itemIds: string[];
  orderIds: string[];
  vendorIds: string[];
  goldenCompanyIds: string[];
  goldenSupplierIds: string[];
};

export type BenchmarkRetrievableCounts = {
  companyContext: number;
  procurementCommunicationMessages: number;
  emailMessages: number;
  knowledgeObjects: number;
  knowledgeChunks: number;
  memoryEvents: number;
  supplyProfileFacts: number;
  supplyPriceObservations: number;
  supplyEvidence: number;
  supplyExecutionEvents: number;
  total: number;
};

export type BenchmarkCorpusManifest = {
  schemaVersion: 1;
  seedVersion: string;
  profile: BenchmarkProfile;
  profilePrefix: string;
  generatedAt: string;
  stableIds: BenchmarkStableIds;
  caseCount: 200;
  concurrencyCaseCount: 40;
  scenarioCount: 12;
  entityCounts: {
    offices: 2;
    companies: 12;
    suppliers: 120;
    procurementRequests: 48;
    goldenCompanies: 4;
    goldenSuppliers: 8;
  };
  retrievableCounts: BenchmarkRetrievableCounts;
  cases: BenchmarkCase[];
};

export type BenchmarkScenarioSeed = {
  id: string;
  ordinal: number;
  family: string;
  officeIndex: 0 | 1;
  companyIndex: number;
  supplierIndexes: number[];
  requestIndex: number;
  supplierKey: string;
  itemKey: string;
  currentState: Record<string, BenchmarkJson>;
  contradictoryHistory: Array<Record<string, BenchmarkJson>>;
  factTemplates: Array<{ key: string; value: BenchmarkJson }>;
  evidenceTemplates: Array<{
    kind: SupplyWorldEvidenceRef["kind"];
    logicalId: string;
    source: BenchmarkGoldEvidence["source"];
    supportsFactKeys: string[];
    content: string;
  }>;
  dependencyTemplates: Array<{
    key: string;
    source: BenchmarkGoldDependency["source"];
    entityType: string;
    entityRef: string;
    policy: "STRICT" | "ADVISORY";
    reason: string;
    value: BenchmarkJson;
    evidenceLogicalIds: string[];
  }>;
  hardNegativeTemplates: Array<{
    kind: SupplyWorldEvidenceRef["kind"];
    logicalId: string;
    reason: string;
  }>;
  promptSubject: string;
  promptCurrentQuestion: string;
  concurrencyKind?: BenchmarkConcurrencyMutation["kind"];
};

export function benchmarkRuntimeQuery(caseRow: BenchmarkCase): BenchmarkRuntimeQuery {
  return {
    caseId: caseRow.id,
    profile: caseRow.profile,
    query: caseRow.queryText,
    queryType: caseRow.queryType,
    scope: caseRow.scope,
  };
}
