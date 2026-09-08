import { isDeepStrictEqual } from "node:util";
import { diversifyMemoryResults } from "../src/lib/memory/diversify";
import { reciprocalRankFuse, recordMemoryRetrievalRecallAtK } from "../src/lib/memory/fusion";
import { hybridSearchMemory } from "../src/lib/memory/hybrid-search";
import {
  buildMemoryQueryPlan,
  MEMORY_RETRIEVAL_V2_FLAG,
  memoryRetrievalV2Enabled,
} from "../src/lib/memory/query-plan";
import type { SearchMemoryInput } from "../src/lib/memory/search-memory";
import { DEMO_EMAIL_THREAD_MARKER } from "../src/lib/email-demo-markers";
import { UNROUTED_MAIL_THREAD_MARKER } from "../src/lib/inbound-mail-routing";
import {
  hashSupplyStateDependencies,
  hashSupplyStateValue,
} from "../src/lib/supply-os/state-runtime/canonicalize";
import {
  exactEntityScopes,
  lexicalSearchMemory,
  linkedMemoryObjectBelongsToOffice,
  memoryEventWhere,
  memoryObjectWhere,
  type LexicalMemoryDatabase,
} from "../src/lib/memory/retrievers/lexical";
import {
  retrieveEntityMemory,
  type EntityMemoryDependencies,
} from "../src/lib/memory/retrievers/entity";
import {
  filterOperationalStateResultsForInput,
  isOperationalProjectionCurrent,
  projectionScopeCandidates,
  retrieveOperationalStateProjections,
  type OperationalProjectionRow,
} from "../src/lib/memory/retrievers/operational-state";
import type {
  HybridMemorySearchResult,
  RankedMemoryList,
} from "../src/lib/memory/retrievers/types";
import {
  MEMORY_VECTOR_SEARCH_FLAG,
  retrieveVectorMemory,
  vectorMemoryRetrievalEnabled,
  type VectorMemoryChunkRow,
  type VectorMemoryDatabase,
} from "../src/lib/memory/retrievers/vector";
import {
  filterRoutedMemoryCandidates,
  type RoutedMemoryDatabase,
} from "../src/lib/memory/retrievers/routed-email";
import {
  getSupplyStateMetricSummaries,
  resetSupplyStateInstrumentationForTests,
} from "../src/lib/supply-os/state-runtime/instrumentation";
import { resolveSnapshotItemIdentity } from "../src/lib/supply-os/state-runtime/readers/item-identity";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  assert(isDeepStrictEqual(actual, expected), message);
}

function result(input: {
  id: string;
  score: number;
  occurredAt?: Date;
  emailThreadId?: string | null;
}): HybridMemorySearchResult {
  return {
    officeId: "office-a",
    kind: "object",
    objectId: input.id,
    chunkId: null,
    eventId: null,
    sourceType: "SYSTEM",
    sourceExternalId: `object:${input.id}`,
    canonicalType: "customer_note",
    title: input.id,
    excerpt: input.id,
    score: input.score,
    occurredAt: input.occurredAt ?? new Date("2026-08-26T00:00:00.000Z"),
    entityType: "test",
    entityId: input.id,
    companyId: null,
    jobId: null,
    inquiryId: null,
    emailThreadId: input.emailThreadId,
    reasons: [],
    evidence: [{ refType: "knowledge_object", knowledgeObjectId: input.id }],
  };
}

async function main() {
  resetSupplyStateInstrumentationForTests();
  const previousRuntimeFlag = process.env.SUPPLY_STATE_RUNTIME_ENABLED;
  const previousRetrievalV2Flag = process.env[MEMORY_RETRIEVAL_V2_FLAG];
  process.env[MEMORY_RETRIEVAL_V2_FLAG] = "false";
  const lexicalBaselinePlan = buildMemoryQueryPlan({
    officeId: "office-a",
    companyId: "company-a",
    includeEvents: true,
  });
  assert(lexicalBaselinePlan.retrievers.lexical.enabled, "The lexical baseline was disabled with Retrieval V2.");
  assert(
    !lexicalBaselinePlan.retrievers.entity.enabled
      && !lexicalBaselinePlan.retrievers.temporal.enabled
      && !lexicalBaselinePlan.retrievers.operational_state.enabled,
    "Retrieval V2 retrievers remained active while the rollout flag was disabled.",
  );
  process.env[MEMORY_RETRIEVAL_V2_FLAG] = "true";
  process.env.SUPPLY_STATE_RUNTIME_ENABLED = "false";
  const runtimeDisabledPlan = buildMemoryQueryPlan({
    officeId: "office-a",
    companyId: "company-a",
  });
  assert(
    !runtimeDisabledPlan.retrievers.operational_state.enabled &&
    runtimeDisabledPlan.retrievers.operational_state.reason === "supply_state_runtime_disabled",
    "Runtime-disabled search still enabled operational state retrieval.",
  );
  let disabledOperationalRuns = 0;
  const runtimeDisabledSearch = await hybridSearchMemory({
    officeId: "office-a",
    companyId: "company-a",
    query: "baseline",
    includeEvents: false,
  }, {
    retrievers: {
      lexical: async () => [result({ id: "runtime-disabled-lexical", score: 1 })],
      entity: async () => [],
      operationalState: async () => {
        disabledOperationalRuns += 1;
        return [];
      },
    },
  });
  assert(disabledOperationalRuns === 0, "Runtime-disabled hybrid search invoked operational state.");
  assert(
    runtimeDisabledSearch.retrieval.retrievers.operational_state.reason === "supply_state_runtime_disabled",
    "Runtime-disabled hybrid diagnostics lost the rollout reason.",
  );
  process.env.SUPPLY_STATE_RUNTIME_ENABLED = "true";
  const publicInput: SearchMemoryInput = {
    officeId: " office-a ",
    query: " supplier quote ",
    workspaceId: "workspace-a",
    procurementOrderId: "order-a",
    procurementVendorId: "vendor-a",
    supplierKey: "supplier-key-a",
    itemKey: "item-key-a",
    limit: 500,
  };
  const plan = buildMemoryQueryPlan(publicInput);
  assert(plan.input.strictReadErrors === false, "Retrieval reads did not default to legacy fallback mode.");
  assert(
    buildMemoryQueryPlan({ officeId: "office-a", strictReadErrors: true }).input.strictReadErrors === true,
    "The query plan dropped the strict read-error opt-in.",
  );
  assert(plan.input.officeId === "office-a", "Query plan did not normalize office scope.");
  assert(plan.limit === 75, "Query plan did not clamp the public result limit.");
  assert(plan.retrievers.lexical.enabled, "Lexical baseline must always run.");
  assert(typeof lexicalSearchMemory === "function", "Lexical baseline is not independently measurable.");
  assert(plan.retrievers.entity.enabled, "Exact entity retriever was not enabled.");
  assert(plan.retrievers.operational_state.enabled, "Operational retriever was not enabled.");
  assert(
    buildMemoryQueryPlan({ officeId: "office-a", companyId: "company-a" })
      .retrievers.operational_state.enabled,
    "Company scope did not enable current operational state retrieval.",
  );
  assert(
    !buildMemoryQueryPlan({
      officeId: "office-a",
      companyId: "company-a",
      includeOperationalState: false,
    }).retrievers.operational_state.enabled,
    "Operational state retrieval could not be disabled for projection compilation.",
  );

  const readTimeout = new Error("synthetic PostgreSQL statement timeout");
  const rejectingLexicalDatabase = {
    knowledgeObject: {
      findMany: async () => {
        throw readTimeout;
      },
    },
    knowledgeChunk: { findMany: async () => [] },
    memoryEvent: { findMany: async () => [] },
  } as unknown as LexicalMemoryDatabase;
  const compatibleLexicalRead = await lexicalSearchMemory({
    officeId: "office-a",
    includeChunks: false,
    includeEvents: false,
  }, rejectingLexicalDatabase);
  assert(
    compatibleLexicalRead.results.length === 0,
    "Default lexical reads no longer preserve the legacy empty-result fallback.",
  );
  let strictLexicalError: unknown = null;
  try {
    await lexicalSearchMemory({
      officeId: "office-a",
      includeChunks: false,
      includeEvents: false,
      strictReadErrors: true,
    }, rejectingLexicalDatabase);
  } catch (error) {
    strictLexicalError = error;
  }
  assert(
    strictLexicalError === readTimeout,
    "Strict lexical reads did not rethrow the original database error.",
  );

  type LexicalCall = {
    where?: Record<string, unknown>;
    select?: unknown;
    include?: unknown;
    orderBy?: unknown;
  };
  let finalExactObjectCall: LexicalCall | null = null;
  let finalExactChunkCall: LexicalCall | null = null;
  let finalExactEventCall: LexicalCall | null = null;
  const candidateTransactionDatabase = {
    knowledgeObject: {
      findMany: async (args: LexicalCall) => {
        if (args.select) {
          assert(
            args.where?.officeId === "office-a",
            "Exact object candidate resolution was not tenant scoped.",
          );
          const identity = (args.where?.OR as Array<{ entityId?: string }> | undefined)?.[0]?.entityId;
          return identity === "workspace-a"
            ? [{ id: "object-a" }]
            : [{ id: "object-b" }, { id: "object-c" }];
        }
        finalExactObjectCall = args;
        return [];
      },
    },
    entityMention: {
      findMany: async (args: LexicalCall) => {
        assert(
          args.where?.officeId === "office-a",
          "Exact mention candidate resolution was not tenant scoped.",
        );
        const identity = args.where?.entityId;
        return identity === "workspace-a"
          ? [{ objectId: "object-b" }]
          : [{ objectId: "object-d" }];
      },
    },
    knowledgeChunk: {
      findMany: async (args: LexicalCall) => {
        assert(
          args.where?.officeId === "office-a",
          "Final exact-scope chunk read was not tenant scoped.",
        );
        finalExactChunkCall = args;
        return [];
      },
    },
    memoryEvent: {
      findMany: async (args: LexicalCall) => {
        if (args.include) {
          finalExactEventCall = args;
          return [];
        }
        assert(
          args.where?.officeId === "office-a",
          "Exact event candidate resolution was not tenant scoped.",
        );
        if (args.where?.objectId) {
          const ids = (args.where.objectId as { in?: string[] }).in ?? [];
          return ids.includes("object-a")
            ? [{ id: "event-b" }]
            : [{ id: "event-c" }];
        }
        const identity = args.where?.entityId;
        return identity === "workspace-a"
          ? [{ id: "event-a" }]
          : [{ id: "event-b" }];
      },
    },
  } as unknown as LexicalMemoryDatabase;
  let exactTransactionRuns = 0;
  let exactTransactionOptions: Record<string, unknown> | null = null;
  const outsideTransactionRead = async () => {
    throw new Error("Exact-scope reads escaped the repeatable-read transaction.");
  };
  const candidateDatabase = {
    knowledgeObject: { findMany: outsideTransactionRead },
    entityMention: { findMany: outsideTransactionRead },
    knowledgeChunk: { findMany: outsideTransactionRead },
    memoryEvent: { findMany: outsideTransactionRead },
    $transaction: async (
      callback: (transaction: LexicalMemoryDatabase) => Promise<unknown>,
      options: Record<string, unknown>,
    ) => {
      exactTransactionRuns += 1;
      exactTransactionOptions = options;
      return callback(candidateTransactionDatabase);
    },
  } as unknown as LexicalMemoryDatabase;
  const exactCandidateInput = {
    officeId: "office-a",
    query: "is workspace",
    workspaceId: "workspace-a",
    itemId: "item-a",
    strictReadErrors: true,
  } as const;
  await lexicalSearchMemory(exactCandidateInput, candidateDatabase);
  assert(
    exactTransactionRuns === 1 &&
    exactTransactionOptions?.isolationLevel === "RepeatableRead" &&
    typeof exactTransactionOptions.maxWait === "number" &&
    typeof exactTransactionOptions.timeout === "number",
    "Exact-scope preflight and final reads did not share one bounded Repeatable Read transaction.",
  );
  const objectWhere = (finalExactObjectCall as LexicalCall | null)?.where as {
    AND?: unknown[];
  } | undefined;
  assertDeepEqual(
    objectWhere?.AND?.[0],
    memoryObjectWhere(exactCandidateInput, true),
    "Exact candidate resolution changed the final KnowledgeObject predicate.",
  );
  assertDeepEqual(
    objectWhere?.AND?.[1],
    { id: { in: ["object-b"] } },
    "Exact candidate resolution did not intersect object identities across scopes.",
  );
  assertDeepEqual(
    (finalExactObjectCall as LexicalCall | null)?.orderBy,
    [{ occurredAt: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
    "KnowledgeObject lexical reads do not have a deterministic ID tie-breaker.",
  );
  const objectInclude = (finalExactObjectCall as LexicalCall | null)?.include as {
    chunks?: { orderBy?: unknown };
    mentions?: { orderBy?: unknown };
  } | undefined;
  assertDeepEqual(
    objectInclude?.chunks?.orderBy,
    [{ ordinal: "asc" }, { id: "asc" }],
    "Included KnowledgeChunk rows do not have a deterministic ID tie-breaker.",
  );
  assertDeepEqual(
    objectInclude?.mentions?.orderBy,
    { id: "asc" },
    "Included EntityMention rows do not have deterministic ordering.",
  );
  const chunkWhere = (finalExactChunkCall as LexicalCall | null)?.where as {
    objectId?: unknown;
    object?: unknown;
    OR?: unknown[];
  } | undefined;
  assertDeepEqual(
    chunkWhere?.objectId,
    { in: ["object-b"] },
    "Exact candidate resolution did not constrain the final KnowledgeChunk predicate.",
  );
  assertDeepEqual(
    chunkWhere?.object,
    memoryObjectWhere(exactCandidateInput, false),
    "Exact candidate resolution changed the final KnowledgeChunk object scope.",
  );
  assertDeepEqual(
    chunkWhere?.OR,
    [
      { text: { contains: "is workspace", mode: "insensitive" } },
      { text: { contains: "is", mode: "insensitive" } },
      { text: { contains: "workspace", mode: "insensitive" } },
    ],
    "Exact candidate resolution changed lexical tokenization or short-token semantics.",
  );
  assertDeepEqual(
    (finalExactChunkCall as LexicalCall | null)?.orderBy,
    [{ createdAt: "desc" }, { id: "asc" }],
    "KnowledgeChunk lexical reads do not have a deterministic ID tie-breaker.",
  );
  const eventWhereWithCandidates = (finalExactEventCall as LexicalCall | null)?.where as {
    AND?: unknown[];
  } | undefined;
  assertDeepEqual(
    eventWhereWithCandidates?.AND?.[0],
    memoryEventWhere(exactCandidateInput, true),
    "Exact candidate resolution changed the final MemoryEvent predicate.",
  );
  assertDeepEqual(
    eventWhereWithCandidates?.AND?.[1],
    { id: { in: ["event-b"] } },
    "Exact candidate resolution did not preserve each event scope's direct-or-linked union.",
  );
  assertDeepEqual(
    (finalExactEventCall as LexicalCall | null)?.orderBy,
    [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    "MemoryEvent lexical reads do not have a deterministic ID tie-breaker.",
  );
  const eventInclude = (finalExactEventCall as LexicalCall | null)?.include as {
    object?: { select?: { chunks?: { orderBy?: unknown } } };
  } | undefined;
  assertDeepEqual(
    eventInclude?.object?.select?.chunks?.orderBy,
    [{ ordinal: "asc" }, { id: "asc" }],
    "MemoryEvent evidence chunks do not have a deterministic ID tie-breaker.",
  );

  let broadLexicalReads = 0;
  const emptyExactScopeDatabase = {
    knowledgeObject: {
      findMany: async (args: LexicalCall) => {
        if (!args.select) broadLexicalReads += 1;
        return [];
      },
    },
    entityMention: { findMany: async () => [] },
    knowledgeChunk: {
      findMany: async () => {
        broadLexicalReads += 1;
        return [];
      },
    },
    memoryEvent: {
      findMany: async (args: LexicalCall) => {
        if (args.include) broadLexicalReads += 1;
        return [];
      },
    },
  } as unknown as LexicalMemoryDatabase;
  const emptyExactRead = await lexicalSearchMemory({
    officeId: "office-a",
    query: "which record is current",
    workspaceId: "workspace-without-lexical-links",
    strictReadErrors: true,
  }, emptyExactScopeDatabase);
  assert(
    emptyExactRead.results.length === 0 && broadLexicalReads === 0,
    "An empty exact scope did not short-circuit broad lexical table scans.",
  );

  const transactionFailure = new Error("synthetic repeatable-read failure");
  const failingTransactionDatabase = {
    knowledgeObject: { findMany: outsideTransactionRead },
    entityMention: { findMany: outsideTransactionRead },
    knowledgeChunk: { findMany: outsideTransactionRead },
    memoryEvent: { findMany: outsideTransactionRead },
    $transaction: async () => {
      throw transactionFailure;
    },
  } as unknown as LexicalMemoryDatabase;
  const compatibleTransactionFailure = await lexicalSearchMemory({
    officeId: "office-a",
    workspaceId: "workspace-a",
  }, failingTransactionDatabase);
  assert(
    compatibleTransactionFailure.results.length === 0,
    "A non-strict repeatable-read failure no longer preserves the empty-result fallback.",
  );
  let strictTransactionError: unknown = null;
  try {
    await lexicalSearchMemory({
      officeId: "office-a",
      workspaceId: "workspace-a",
      strictReadErrors: true,
    }, failingTransactionDatabase);
  } catch (error) {
    strictTransactionError = error;
  }
  assert(
    strictTransactionError === transactionFailure,
    "A strict repeatable-read failure did not preserve the original database error.",
  );

  const retrieverTimeout = new Error("synthetic benchmark lexical timeout");
  const compatibleHybridRead = await hybridSearchMemory({
    officeId: "office-a",
    includeEvents: false,
  }, {
    retrievers: {
      lexical: async () => {
        throw retrieverTimeout;
      },
    },
  });
  assert(
    compatibleHybridRead.results.length === 0 &&
    compatibleHybridRead.retrieval.retrievers.lexical.reason === "retriever_failed",
    "Default Retrieval V2 orchestration no longer converts lexical failures to legacy empty results.",
  );
  let strictHybridError: unknown = null;
  try {
    await hybridSearchMemory({
      officeId: "office-a",
      includeEvents: false,
      strictReadErrors: true,
    }, {
      retrievers: {
        lexical: async () => {
          throw retrieverTimeout;
        },
      },
    });
  } catch (error) {
    strictHybridError = error;
  }
  assert(
    strictHybridError === retrieverTimeout,
    "Strict Retrieval V2 orchestration converted a benchmark timeout into a completed result.",
  );

  const incompleteSupplierPlan = buildMemoryQueryPlan({
    officeId: "office-a",
    supplierKey: "workspace-local-key",
  });
  assert(
    !incompleteSupplierPlan.retrievers.entity.enabled &&
    !incompleteSupplierPlan.retrievers.operational_state.enabled &&
    incompleteSupplierPlan.scopeDiagnostics.ignoredIncompleteScopes.includes(
      "supplierKey_requires_workspaceId",
    ),
    "A workspace-local supplier key was treated as a globally exact scope.",
  );
  const incompleteVendorPlan = buildMemoryQueryPlan({
    officeId: "office-a",
    procurementVendorId: "vendor-without-order",
  });
  assert(
    !incompleteVendorPlan.retrievers.entity.enabled &&
    incompleteVendorPlan.scopeDiagnostics.ignoredIncompleteScopes.includes(
      "procurementVendorId_requires_procurementOrderId",
    ),
    "A request vendor without its order was treated as an exact entity scope.",
  );

  const exactScopes = exactEntityScopes(plan.input);
  assert(
    exactScopes.some((scope) => scope.entityTypes.includes("procurement_order") && scope.entityId === "order-a"),
    "Procurement order scope did not compile to an exact entity link.",
  );
  assert(
    exactScopes.some((scope) => scope.entityTypes.includes("supplier_key") && scope.entityId === "supplier-key-a"),
    "Supplier key scope did not compile to an exact entity link.",
  );
  const supplierKeyScope = exactScopes.find((scope) => scope.entityId === "supplier-key-a");
  assert(
    supplierKeyScope?.entityTypes.join(",") === "supplier_key",
    "Supplier key was conflated with a Supplier or SupplySupplierProfile row id.",
  );
  const itemKeyScope = exactScopes.find((scope) => scope.entityId === "item-key-a");
  assert(
    itemKeyScope?.entityTypes.includes("item_key") &&
    !itemKeyScope.entityTypes.includes("item") &&
    !itemKeyScope.entityTypes.includes("supply_item"),
    "Item key was conflated with an Item or SupplyItem row id.",
  );
  const canonicalItemScope = exactEntityScopes({
    officeId: "office-a",
    itemId: "canonical-item-a",
  })[0];
  assert(
    canonicalItemScope?.entityTypes.join(",") === "item",
    "Canonical Item.id was conflated with a snapshot SupplyItem row id.",
  );

  const snapshotItem = (id: string, itemKey: string) => ({
    id,
    workspaceId: "workspace-a",
    snapshotId: "snapshot-a",
    itemKey,
    externalId: null,
    sku: "CANONICAL-SKU",
    manufacturer: "Maker A",
    mpn: "PART-A",
    gtin: null,
    name: itemKey,
    description: null,
    category: null,
    itemType: "COMPONENT",
    unitOfMeasure: "EA",
    metadata: null,
    sourceRefs: null,
    createdAt: new Date("2026-08-26T08:00:00.000Z"),
  });
  const canonicalItem = {
    id: "canonical-item-a",
    companyId: "company-a",
    name: "Canonical A",
    sku: "CANONICAL-SKU",
    specification: null,
    manufacturer: "Maker A",
    partNumber: "PART-A",
    unit: "EA",
    updatedAt: new Date("2026-08-26T07:00:00.000Z"),
  };
  let foreignSnapshotLookup = false;
  const foreignIdentity = await resolveSnapshotItemIdentity({
    officeId: "office-a",
    companyId: "company-a",
    workspaceId: "workspace-a",
    snapshotId: "snapshot-a",
    itemId: "foreign-item",
    itemKey: "item-key-a",
  }, {
    findCanonicalItem: async ({ officeId, companyId }) => {
      assert(officeId === "office-a" && companyId === "company-a", "Canonical lookup lost tenant scope.");
      return null;
    },
    findApprovedAliases: async () => [],
    findSnapshotItems: async () => {
      foreignSnapshotLookup = true;
      return [snapshotItem("foreign-supply-item", "item-key-a")];
    },
  });
  assert(
    foreignIdentity.status === "UNRESOLVED" && !foreignSnapshotLookup,
    "A foreign canonical Item.id was allowed to resolve through a local snapshot key.",
  );
  let itemKeyOnlyCanonicalLookup = false;
  const itemKeyOnlyIdentity = await resolveSnapshotItemIdentity({
    officeId: "office-a",
    companyId: "company-a",
    workspaceId: "workspace-a",
    snapshotId: "snapshot-a",
    itemKey: "item-key-a",
  }, {
    findCanonicalItem: async () => {
      itemKeyOnlyCanonicalLookup = true;
      return canonicalItem;
    },
    findApprovedAliases: async () => [],
    findSnapshotItems: async ({ officeId, workspaceId, snapshotId, itemKeys, identifiers }) => {
      assert(
        officeId === "office-a" && workspaceId === "workspace-a" && snapshotId === "snapshot-a" &&
        itemKeys.join(",") === "item-key-a" && identifiers.length === 0,
        "Item-key-only resolution lost its exact tenant and snapshot boundary.",
      );
      return [snapshotItem("supply-item-a", "item-key-a")];
    },
  });
  assert(
    itemKeyOnlyIdentity.status === "RESOLVED" &&
    itemKeyOnlyIdentity.method === "ITEM_KEY_ONLY" &&
    !itemKeyOnlyCanonicalLookup,
    "Item-key-only behavior no longer resolves independently of canonical Item.id.",
  );
  const mismatchedExplicitIdentity = await resolveSnapshotItemIdentity({
    officeId: "office-a",
    companyId: "company-a",
    workspaceId: "workspace-a",
    snapshotId: "snapshot-a",
    itemId: canonicalItem.id,
    itemKey: "unrelated-key",
  }, {
    findCanonicalItem: async () => canonicalItem,
    findApprovedAliases: async () => [],
    findSnapshotItems: async () => [{
      ...snapshotItem("unrelated-supply-item", "unrelated-key"),
      sku: "UNRELATED-SKU",
      manufacturer: "Other Maker",
      mpn: "PART-A",
    }],
  });
  assert(
    mismatchedExplicitIdentity.status === "UNRESOLVED" &&
    mismatchedExplicitIdentity.supplyItem === null,
    "An unrelated canonical Item.id and SupplyItem itemKey pair did not fail closed.",
  );
  const approvedExplicitIdentity = await resolveSnapshotItemIdentity({
    officeId: "office-a",
    companyId: "company-a",
    workspaceId: "workspace-a",
    snapshotId: "snapshot-a",
    itemId: canonicalItem.id,
    itemKey: "approved-key",
  }, {
    findCanonicalItem: async () => canonicalItem,
    findApprovedAliases: async ({ officeId, workspaceId, normalizedValues }) => {
      assert(
        officeId === "office-a" && workspaceId === "workspace-a" && normalizedValues.includes("canonicalsku"),
        "Approved alias validation lost canonical tenant identity.",
      );
      return [{ canonicalItemKey: "approved-key" }];
    },
    findSnapshotItems: async () => [{
      ...snapshotItem("approved-supply-item", "approved-key"),
      sku: "UNRELATED-SKU",
      manufacturer: "Other Maker",
      mpn: "OTHER-PART",
    }],
  });
  assert(
    approvedExplicitIdentity.status === "RESOLVED" &&
    approvedExplicitIdentity.method === "APPROVED_ALIAS",
    "An active approved alias did not verify an explicit canonical-to-snapshot mapping.",
  );
  const ambiguousIdentity = await resolveSnapshotItemIdentity({
    officeId: "office-a",
    companyId: "company-a",
    workspaceId: "workspace-a",
    snapshotId: "snapshot-a",
    itemId: canonicalItem.id,
  }, {
    findCanonicalItem: async () => canonicalItem,
    findApprovedAliases: async () => [],
    findSnapshotItems: async () => [
      snapshotItem("supply-item-a", "item-key-a"),
      snapshotItem("supply-item-b", "item-key-b"),
    ],
  });
  assert(
    ambiguousIdentity.status === "AMBIGUOUS" && ambiguousIdentity.supplyItem === null,
    "Ambiguous canonical-to-snapshot identity did not fail closed.",
  );
  const eventWhere = memoryEventWhere({ officeId: "office-a" }, false);
  assert(
    JSON.stringify(eventWhere).includes('"objectId":null') &&
    JSON.stringify(eventWhere).includes('"officeId":"office-a"'),
    "Memory event scope did not require a same-office linked object.",
  );
  assert(
    !linkedMemoryObjectBelongsToOffice({ object: { officeId: "office-b" } }, "office-a") &&
    linkedMemoryObjectBelongsToOffice({ object: null }, "office-a"),
    "Cross-office linked memory objects were not rejected defensively.",
  );
  const threadScopes = exactEntityScopes({
    officeId: "office-a",
    entityType: "email_thread",
    entityId: "thread-a",
  });
  assert(
    threadScopes.length === 1 &&
    threadScopes[0]?.entityId === "thread-a" &&
    threadScopes[0]?.directField === "emailThreadId",
    "Routed email thread scope did not use its exact stored link.",
  );

  const entityLexicalCalls: Array<{
    companyId?: string | null;
    workspaceId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  }> = [];
  const entityDependencies: EntityMemoryDependencies = {
    lexicalSearch: (async (input) => {
      entityLexicalCalls.push(input);
      let results: HybridMemorySearchResult[] = [];
      if (input.workspaceId) {
        // There is deliberately no populated operational EntityMention index.
        results = [];
      } else if (input.entityType === "email_thread" && input.entityId === "thread-routed") {
        results = [{
          ...result({ id: "routed-thread-history", score: 1, emailThreadId: "thread-routed" }),
          companyId: "company-a",
          entityType: "email_message",
          entityId: "local-message-a",
        }];
      } else if (input.entityType === "email_message" && input.entityId === "local-message-a") {
        results = [{
          ...result({ id: "routed-message-history", score: 1, emailThreadId: "thread-routed" }),
          companyId: "company-a",
          entityType: "email_message",
          entityId: "local-message-a",
        }];
      } else if (input.companyId === "company-a") {
        results = [
          { ...result({ id: "customer-company-history", score: 1 }), companyId: "company-a" },
          { ...result({ id: "cross-office-history", score: 999 }), officeId: "office-b", companyId: "company-a" },
        ];
      } else if (input.companyId === "supplier-company-a") {
        results = [{ ...result({ id: "supplier-company-history", score: 1 }), companyId: "supplier-company-a" }];
      }
      return { results } as Awaited<ReturnType<EntityMemoryDependencies["lexicalSearch"]>>;
    }) as EntityMemoryDependencies["lexicalSearch"],
    findCompany: async ({ officeId, companyId }) => (
      officeId === "office-a" && ["company-a", "supplier-company-a"].includes(companyId)
        ? { id: companyId }
        : null
    ),
    findWorkspace: async ({ officeId, workspaceId, companyId }) => (
      officeId === "office-a" && workspaceId === "workspace-a" && companyId === "company-a"
        ? {
            id: "workspace-a",
            companyId: "company-a",
            name: "Workspace A",
            status: "ACTIVE",
            updatedAt: new Date("2026-08-26T12:00:00.000Z"),
          }
        : null
    ),
    findSupplierProfile: async ({ officeId, workspaceId, supplierKey }) => (
      officeId === "office-a" && workspaceId === "workspace-a" && supplierKey === "supplier-key-a"
        ? {
            id: "supplier-profile-a",
            workspaceId,
            linkedCompanyId: "supplier-company-a",
            supplierKey,
            companyName: "Supplier A",
            status: "QUALIFIED",
            lastSeenAt: new Date("2026-08-26T11:00:00.000Z"),
          }
        : null
    ),
    findProfileFacts: async ({ officeId, workspaceId, subjectType, subjectRef }) => {
      assert(officeId === "office-a" && workspaceId === "workspace-a", "Entity facts lost tenant scope.");
      if (subjectType === "SUPPLIER" && subjectRef === "supplier-key-a") {
        return [{
          id: "supplier-fact-a",
          subjectType,
          subjectRef,
          factType: "PUBLIC_DISCOVERY",
          value: { capability: "precision machining" },
          sourceType: "PUBLIC_WEB",
          evidenceId: "evidence-supplier-a",
          observedAt: new Date("2026-08-25T10:00:00.000Z"),
          capturedAt: new Date("2026-08-25T10:01:00.000Z"),
        }];
      }
      if (subjectType === "ITEM" && subjectRef === "item-key-a") {
        return [{
          id: "item-fact-a",
          subjectType,
          subjectRef,
          factType: "SPECIFICATION",
          value: { grade: "6061" },
          sourceType: "OPERATOR_INPUT",
          evidenceId: null,
          observedAt: null,
          capturedAt: new Date("2026-08-24T10:00:00.000Z"),
        }];
      }
      return [];
    },
    findPriceObservations: async ({ officeId, workspaceId, supplierProfileId, itemKey }) => {
      assert(officeId === "office-a" && workspaceId === "workspace-a", "Entity prices lost tenant scope.");
      if (supplierProfileId === "supplier-profile-a" || itemKey === "item-key-a") {
        return [{
          id: supplierProfileId ? "supplier-price-a" : "item-price-a",
          supplierProfileId: "supplier-profile-a",
          evidenceId: "evidence-price-a",
          itemKey: "item-key-a",
          observationType: "SUPPLIER_QUOTE",
          amount: "42.50",
          currency: "USD",
          unitOfMeasure: "EA",
          observedAt: new Date("2026-08-26T09:00:00.000Z"),
          capturedAt: new Date("2026-08-26T09:01:00.000Z"),
        }];
      }
      return [];
    },
    findLatestSnapshot: async ({ officeId, workspaceId }) => (
      officeId === "office-a" && workspaceId === "workspace-a"
        ? { id: "snapshot-a", publishedAt: new Date("2026-08-26T08:00:00.000Z") }
        : null
    ),
    resolveItemIdentity: async ({ officeId, companyId, workspaceId, snapshotId, itemId, itemKey }) => (
      officeId === "office-a" && companyId === "company-a" && workspaceId === "workspace-a" &&
      snapshotId === "snapshot-a" && itemId === "item-row-a" && itemKey === "item-key-a"
        ? {
            status: "RESOLVED" as const,
            method: "EXPLICIT_SCOPED_ITEM_KEY" as const,
            reason: "Exact scoped test identity.",
            candidateItemKeys: [itemKey],
            canonicalItem: {
              id: itemId,
              companyId,
              name: "Canonical Item A",
              sku: "ITEM-A",
              specification: null,
              manufacturer: "Maker A",
              partNumber: "PART-A",
              unit: "EA",
              updatedAt: new Date("2026-08-26T07:00:00.000Z"),
            },
            supplyItem: {
              id: "supply-item-a",
              workspaceId,
              snapshotId,
              itemKey,
              externalId: null,
              sku: "ITEM-A",
              manufacturer: "Maker A",
              mpn: "MPN-A",
              gtin: null,
              name: "Item A",
              description: null,
              category: null,
              itemType: "COMPONENT",
              unitOfMeasure: "EA",
              metadata: null,
              sourceRefs: null,
              createdAt: new Date("2026-08-26T08:00:00.000Z"),
            },
          }
        : {
            status: "UNRESOLVED" as const,
            method: "NONE" as const,
            reason: "Out of scope.",
            candidateItemKeys: [],
            canonicalItem: null,
            supplyItem: null,
          }
    ),
    findEvidence: async ({ officeId, workspaceId, evidenceIds }) => {
      assert(
        officeId === "office-a" && workspaceId === "workspace-a" &&
        evidenceIds.includes("evidence-supplier-a") && evidenceIds.includes("evidence-price-a"),
        "Entity evidence traversal lost exact linked ids.",
      );
      return evidenceIds.map((id) => ({
        id,
        kind: "TEST_EVIDENCE",
        sourceType: "APP_DB",
        title: id,
        excerpt: `Evidence ${id}`,
        observedAt: new Date("2026-08-26T06:00:00.000Z"),
        capturedAt: new Date("2026-08-26T06:01:00.000Z"),
      }));
    },
    findWorkflowAccount: async ({ officeId, companyId }) => (
      officeId === "office-a" && companyId === "company-a" ? { id: "customer-a" } : null
    ),
    findProcurementReplyTasks: async ({ officeId, workspaceId, customerId, orderId, vendorId }) => {
      assert(
        officeId === "office-a" && workspaceId === "workspace-a" && customerId === "customer-a" &&
        orderId === "order-a" && vendorId === "vendor-a",
        "Procurement reply traversal was not bound to the exact tenant request/vendor.",
      );
      return [{
        id: "reply-task-a",
        workspaceId: "workspace-a",
        taskType: "PROCUREMENT_SUPPLIER_REPLY_EMAIL",
        status: "SUCCEEDED",
        input: {
          customerId: "customer-a",
          orderId: "order-a",
          vendorId: "vendor-a",
          sourceMessageId: "local-message-a",
        },
        result: { localThreadId: "thread-routed" },
        createdAt: new Date("2026-08-26T05:00:00.000Z"),
        updatedAt: new Date("2026-08-26T05:01:00.000Z"),
      }];
    },
  };
  const entityLexicalTimeout = new Error("synthetic entity traversal lexical timeout");
  const rejectingEntityLexicalDependencies: EntityMemoryDependencies = {
    ...entityDependencies,
    lexicalSearch: async () => {
      throw entityLexicalTimeout;
    },
  };
  await retrieveEntityMemory({
    officeId: "office-a",
    companyId: "company-a",
    includeEvents: false,
  }, 10, rejectingEntityLexicalDependencies);
  let strictEntityLexicalError: unknown = null;
  try {
    await retrieveEntityMemory({
      officeId: "office-a",
      companyId: "company-a",
      includeEvents: false,
      strictReadErrors: true,
    }, 10, rejectingEntityLexicalDependencies);
  } catch (error) {
    strictEntityLexicalError = error;
  }
  assert(
    strictEntityLexicalError === entityLexicalTimeout,
    "Strict entity traversal swallowed an embedded lexical read error.",
  );
  const traversed = await retrieveEntityMemory({
    officeId: "office-a",
    companyId: "company-a",
    workspaceId: "workspace-a",
    supplierKey: "supplier-key-a",
    itemId: "item-row-a",
    itemKey: "item-key-a",
    procurementOrderId: "order-a",
    procurementVendorId: "vendor-a",
    includeOperationalState: false,
  }, 75, entityDependencies);
  const traversedIds = new Set(traversed.flatMap((entry) => [entry.entityId, entry.objectId].filter(Boolean)));
  for (const expected of [
    "workspace-a",
    "supplier-profile-a",
    "supplier-fact-a",
    "item-fact-a",
    "supplier-price-a",
    "item-price-a",
    "evidence-supplier-a",
    "evidence-price-a",
    "supply-item-a",
    "item-row-a",
    "reply-task-a",
    "customer-company-history",
    "supplier-company-history",
    "routed-thread-history",
    "routed-message-history",
  ]) {
    assert(traversedIds.has(expected), `Direct entity traversal omitted ${expected}.`);
  }
  assert(
    !traversed.some((entry) => entry.officeId === "office-b"),
    "Direct entity traversal admitted an injected cross-office history row.",
  );
  assert(
    entityLexicalCalls.some((call) =>
      call.companyId === "company-a" && call.workspaceId == null && call.entityType == null) &&
    entityLexicalCalls.some((call) =>
      call.companyId === "supplier-company-a" && call.workspaceId == null && call.entityType == null),
    "Proven company history was not queried separately from absent operational mentions.",
  );
  assert(
    entityLexicalCalls.some((call) =>
      call.companyId === "company-a" && call.entityType === "email_thread" && call.entityId === "thread-routed") &&
    entityLexicalCalls.some((call) =>
      call.companyId === "company-a" && call.entityType === "email_message" && call.entityId === "local-message-a"),
    "Exact procurement reply task links did not traverse through the routed thread/message reader.",
  );
  assert(
    traversed.every((entry) => entry.evidence.length > 0) &&
    traversed.filter((entry) => entry.entityType === "supply_profile_fact" || entry.entityType === "supply_price_observation")
      .every((entry) => entry.evidence.some((ref) => ref.entityType === "supply_evidence") || entry.entityId === "item-fact-a"),
    "Canonical fact or price traversal lost its evidence pointers.",
  );

  const projections = projectionScopeCandidates(plan.input);
  assert(
    projections.some((scope) =>
      scope.projectionType === "supplier_relationship_v1" &&
      scope.scopeRef.includes("supplierKey=supplier-key-a") &&
      scope.scopeRef.includes("vendor=vendor-a")),
    "Supplier projection scope was not encoded by exact identities.",
  );
  assert(
    projections.some((scope) =>
      scope.projectionType === "workspace_supply_v1" && scope.scopeRef === "workspace=workspace-a"),
    "Workspace projection scope was not exact.",
  );
  assert(
    projectionScopeCandidates({ officeId: "office-a", supplierKey: "supplier-key-a" }).length === 0,
    "A supplier key without its workspace produced an invalid projection scope.",
  );
  assert(
    projectionScopeCandidates({ officeId: "office-a", procurementVendorId: "vendor-a" }).length === 0,
    "A request vendor without its order produced an invalid projection scope.",
  );

  const projectionDependencies = [{
    key: "procurement.order:customer-a:order-a",
    source: "WORKFLOW_DB" as const,
    entityType: "procurement_order",
    entityRef: "customer-a:order-a",
    version: "v1",
    valueHash: "a".repeat(64),
    policy: "STRICT" as const,
    reason: "The request must still match.",
    evidenceRefs: [],
  }];
  const projectionPayload = {
    currentState: {},
    derivedState: {},
    openLoops: [],
    uncertainties: [],
  };
  const projectionRow: OperationalProjectionRow = {
    id: "projection-a",
    officeId: "office-a",
    workspaceId: "workspace-a",
    scopeType: "procurement_request",
    scopeRef: "company=company-a|customer=customer-a|order=order-a|workspace=workspace-a",
    projectionType: "procurement_request_v1",
    compilerVersion: "supply-world-state-v1.2",
    sourceFingerprint: hashSupplyStateDependencies(projectionDependencies),
    payload: projectionPayload,
    payloadHash: hashSupplyStateValue(projectionPayload),
    evidenceRefs: [],
    dependencyManifest: projectionDependencies,
    builtAt: new Date("2026-08-26T12:00:00.000Z"),
    dirtyAt: null,
  };
  let semanticChecks = 0;
  assert((await isOperationalProjectionCurrent(
    projectionRow,
    "office-a",
    async () => {
      semanticChecks += 1;
      return { fresh: false, sourceFingerprint: null, changedKeys: [projectionDependencies[0]!.key], failedKeys: [] };
    },
  )) === false, "Operational retrieval accepted a semantically stale projection.");
  assert((await isOperationalProjectionCurrent(
    projectionRow,
    "office-a",
    async () => {
      semanticChecks += 1;
      return { fresh: true, sourceFingerprint: projectionRow.sourceFingerprint, changedKeys: [], failedKeys: [] };
    },
  )) === true, "Operational retrieval rejected a semantically current projection.");
  assert(semanticChecks === 2, "Operational retrieval skipped semantic fingerprint validation.");

  const freshProjectionRequests: Array<Record<string, unknown>> = [];
  const liveProjectionResults = await retrieveOperationalStateProjections(
    { officeId: "office-a", companyId: "company-a" },
    true,
    {
      findWorkflowAccount: async () => null,
      getFreshProjection: async (request) => {
        freshProjectionRequests.push(request as unknown as Record<string, unknown>);
        return {
          id: null,
          scope: request.scope,
          projectionType: "company_context_v1",
          compilerVersion: request.compilerVersion ?? "supply-world-state-v1.2",
          sourceFingerprint: "b".repeat(64),
          payload: {
            currentState: { company: { id: "company-a", status: "ACTIVE" } },
            derivedState: {},
            openLoops: [],
            uncertainties: [],
          },
          payloadHash: "c".repeat(64),
          evidenceRefs: [{ kind: "knowledge_object", id: "knowledge-a" }],
          dependencies: [],
          builtAt: "2026-08-26T12:01:00.000Z",
          dirtyAt: null,
          projectionHit: false,
          sourceCounts: { APP_DB: 1 },
          timingsMs: { company_context: 3 },
        };
      },
    },
  );
  assert(
    freshProjectionRequests.length === 1 &&
    (freshProjectionRequests[0]?.scope as { type?: string } | undefined)?.type === "company",
    "Operational retrieval did not resolve current state through the projection API.",
  );
  assert(
    !Object.hasOwn(freshProjectionRequests[0] ?? {}, "queryEvidence"),
    "Operational retrieval fed historical query evidence back into projection compilation.",
  );
  assert(
    liveProjectionResults.length === 1 &&
    liveProjectionResults[0]?.kind === "operational" &&
    liveProjectionResults[0]?.reasons.includes("projection:live_canonical_fallback"),
    "A projection miss did not return the live canonical compilation.",
  );
  assert(
    liveProjectionResults[0]?.companyId === "company-a" &&
    liveProjectionResults[0]?.evidence.some((ref) =>
      ref.refType === "knowledge_object" && ref.knowledgeObjectId === "knowledge-a"),
    "Live projection fallback lost exact scope metadata or evidence pointers.",
  );
  const projectionOnlyResults = await retrieveOperationalStateProjections(
    { officeId: "office-a", companyId: "company-a" },
    true,
    {
      findWorkflowAccount: async () => null,
      getFreshProjection: async (request) => ({
        id: "projection-without-canonical-evidence",
        scope: request.scope,
        projectionType: "company_context_v1",
        compilerVersion: request.compilerVersion ?? "supply-world-state-v1.2",
        sourceFingerprint: hashSupplyStateDependencies([]),
        payload: projectionPayload,
        payloadHash: hashSupplyStateValue(projectionPayload),
        evidenceRefs: [],
        dependencies: [],
        builtAt: "2026-08-26T12:01:00.000Z",
        dirtyAt: null,
        projectionHit: true,
        sourceCounts: {},
        timingsMs: {},
      }),
    },
  );
  assert(
    projectionOnlyResults.length === 0,
    "A derived projection was admitted as its own sole evidence source.",
  );

  const operationalCompany = {
    ...result({ id: "operational-company", score: 1 }),
    kind: "operational" as const,
    objectId: null,
    canonicalType: "company",
  };
  const untypedOperational = {
    ...operationalCompany,
    entityId: "untyped-operational",
    canonicalType: null,
  };
  assert(
    filterOperationalStateResultsForInput(
      [operationalCompany, untypedOperational],
      { officeId: "office-a", canonicalTypes: ["company"] },
    ).map((entry) => entry.entityId).join(",") === operationalCompany.entityId,
    "Operational retrieval did not preserve canonical type filtering.",
  );
  assert(
    filterOperationalStateResultsForInput(
      [operationalCompany, untypedOperational],
      { officeId: "office-a", canonicalTypes: ["email_message"] },
    ).length === 0,
    "Operational state bypassed a restrictive canonical type filter.",
  );

  const a = result({ id: "a", score: 1 });
  const b = result({ id: "b", score: 1_000_000 });
  const c = result({ id: "c", score: 10 });
  const lists: RankedMemoryList[] = [
    { retriever: "lexical", results: [b, a] },
    { retriever: "entity", results: [c, a] },
  ];
  const fused = reciprocalRankFuse(lists);
  assert(fused[0]?.objectId === "a", "RRF did not reward agreement across retrievers.");
  assert(
    fused.find((entry) => entry.objectId === "b")?.score !== b.score,
    "RRF reused an incomparable source score.",
  );
  assert(fused.every((entry) => entry.evidence.length > 0), "Fusion dropped evidence pointers.");
  assert(
    recordMemoryRetrievalRecallAtK({
      benchmarkName: "state-runtime-fixture-v1",
      relevant: [a, c],
      retrieved: fused,
      k: 2,
    }) === 0.5,
    "Recall@K benchmark calculation changed.",
  );
  assert(
    getSupplyStateMetricSummaries().some((metric) =>
      metric.name === "retrieval_recall_at_k" && metric.labels.benchmarkName === "state-runtime-fixture-v1"),
    "Recall@K benchmark metric was not recorded.",
  );

  let routedThreadQuery: Record<string, unknown> | null = null;
  const routingDatabase: RoutedMemoryDatabase = {
    emailMessage: {
      findMany: async () => [
        { id: "message-routed", threadId: "thread-routed" },
        { id: "message-resolved", threadId: "thread-routed" },
        { id: "message-conflict", threadId: "thread-routed" },
        { id: "message-unrouted", threadId: "thread-unrouted" },
        { id: "message-other-office", threadId: "thread-other-office" },
      ],
    },
    emailThread: {
      findMany: async (args) => {
        routedThreadQuery = args as Record<string, unknown>;
        return [{ id: "thread-routed", companyId: "company-a" }];
      },
    },
  };
  const routedEvidence = await filterRoutedMemoryCandidates("office-a", [
    { sourceType: "GMAIL", entityType: "email_message", entityId: "message-routed", companyId: "company-a" },
    { sourceType: "GMAIL", entityType: "email_message", entityId: "message-resolved", companyId: "company-a" },
    {
      sourceType: "GMAIL",
      entityType: "email_message",
      entityId: "message-conflict",
      emailThreadId: "thread-stale",
      companyId: "company-a",
    },
    { sourceType: "GMAIL", entityType: "email_message", entityId: "message-unrouted", companyId: "company-a" },
    { sourceType: "GMAIL", entityType: "email_message", entityId: "message-other-office", companyId: "company-a" },
    { sourceType: "APP_DB", entityType: "supplier", entityId: "supplier-a", companyId: "company-a" },
  ], routingDatabase, "company-a");
  assert(
    routedEvidence.map((entry) => entry.entityId).join(",") ===
      "message-routed,message-resolved,supplier-a",
    "Current routing admission exposed stale, unrouted, or other-office email evidence.",
  );
  assert(
    routedEvidence.find((entry) => entry.entityId === "message-resolved")?.emailThreadId === "thread-routed",
    "Current canonical message membership was not propagated for diversification.",
  );
  const routedWhere = (routedThreadQuery as { where?: Record<string, unknown> } | null)?.where;
  assert(routedWhere?.officeId === "office-a", "Routing admission did not bind the exact office.");
  assert(routedWhere?.hiddenAt === null, "Routing admission did not exclude hidden mail.");
  assert(Boolean(routedWhere?.companyId), "Routing admission did not require a routed company owner.");
  const routedWhereJson = JSON.stringify(routedWhere);
  assert(
    routedWhereJson.includes(UNROUTED_MAIL_THREAD_MARKER) &&
    routedWhereJson.includes(DEMO_EMAIL_THREAD_MARKER),
    "Routing admission did not exclude both unrouted shared-mailbox and demo-only threads.",
  );

  const crowded = [
    result({ id: "thread-1-a", score: 10, emailThreadId: "thread-1" }),
    result({ id: "thread-1-b", score: 9, emailThreadId: "thread-1" }),
    result({ id: "thread-1-c", score: 8, emailThreadId: "thread-1" }),
    result({ id: "thread-1-d", score: 7, emailThreadId: "thread-1" }),
    result({ id: "independent", score: 6 }),
  ];
  const diversified = diversifyMemoryResults(crowded, { limit: 4, maxPerEmailThread: 2 });
  assert(
    diversified.filter((entry) => entry.emailThreadId === "thread-1").length === 2,
    "Diversification let one email thread consume the result set.",
  );
  assert(
    diversified.some((entry) => entry.objectId === "independent"),
    "Diversification removed independent evidence.",
  );

  assert(
    memoryRetrievalV2Enabled({ MEMORY_RETRIEVAL_V2_ENABLED: "true" }),
    "Retrieval V2 feature flag did not enable explicitly.",
  );
  assert(
    !memoryRetrievalV2Enabled({ MEMORY_RETRIEVAL_V2_ENABLED: "false" }),
    "Retrieval V2 feature flag did not default closed.",
  );
  assert(
    vectorMemoryRetrievalEnabled({ MEMORY_VECTOR_SEARCH_ENABLED: "true" }),
    "New vector search feature flag did not enable explicitly.",
  );
  assert(
    vectorMemoryRetrievalEnabled({ MEMORY_VECTOR_RETRIEVAL_ENABLED: "true" }),
    "Legacy vector feature flag did not remain compatible.",
  );
  assert(
    !vectorMemoryRetrievalEnabled({ MEMORY_VECTOR_RETRIEVAL_ENABLED: "false" }),
    "Vector feature flag did not default closed.",
  );

  const previousVectorFlag = process.env[MEMORY_VECTOR_SEARCH_FLAG];
  process.env[MEMORY_VECTOR_SEARCH_FLAG] = "true";
  try {
    const forgedBackendResult: HybridMemorySearchResult = {
      ...result({ id: "same-office", score: 1 }),
      kind: "chunk",
      chunkId: "chunk-same-office",
      title: "FORGED BACKEND TITLE",
      excerpt: "FORGED BACKEND CONTENT",
      companyId: "company-forged",
      evidence: [{
        refType: "knowledge_chunk",
        knowledgeObjectId: "same-office",
        knowledgeChunkId: "chunk-same-office",
      }],
    };
    const crossOfficePointer: HybridMemorySearchResult = {
      ...forgedBackendResult,
      objectId: "other-office",
      chunkId: "chunk-other-office",
      evidence: [{
        refType: "knowledge_chunk",
        knowledgeObjectId: "other-office",
        knowledgeChunkId: "chunk-other-office",
      }],
    };
    const missingCanonicalPointer: HybridMemorySearchResult = {
      ...forgedBackendResult,
      objectId: "missing-object",
      chunkId: "chunk-missing",
      evidence: [{
        refType: "knowledge_chunk",
        knowledgeObjectId: "missing-object",
        knowledgeChunkId: "chunk-missing",
      }],
    };
    const noChunkPointer = result({ id: "no-chunk-pointer", score: 3 });
    const canonicalRow: VectorMemoryChunkRow = {
      id: "chunk-same-office",
      officeId: "office-a",
      text: "Canonical supplier quote evidence for order A.",
      object: {
        id: "object-canonical",
        officeId: "office-a",
        canonicalType: "customer_note",
        title: "Canonical quote evidence",
        sourceType: "SYSTEM",
        sourceExternalId: "canonical:quote-a",
        entityType: "supplier",
        entityId: "supplier-key-a",
        companyId: "company-a",
        contactId: null,
        inquiryId: null,
        jobId: null,
        emailThreadId: null,
        emailMessageId: null,
        jobDocumentId: null,
        strategyAssessmentId: null,
        agentProposalId: null,
        occurredAt: new Date("2026-08-26T12:02:00.000Z"),
        mentions: [
          { entityType: "supply_workspace", entityId: "workspace-a" },
          { entityType: "procurement_order", entityId: "order-a" },
          { entityType: "procurement_vendor", entityId: "vendor-a" },
          { entityType: "supplier_key", entityId: "supplier-key-a" },
          { entityType: "item_key", entityId: "item-key-a" },
        ],
      },
    };
    const crossOfficeRow: VectorMemoryChunkRow = {
      ...canonicalRow,
      id: "chunk-other-office",
      officeId: "office-b",
      object: {
        ...canonicalRow.object,
        id: "object-other-office",
        officeId: "office-b",
      },
    };
    let vectorDatabaseQuery: Record<string, unknown> | null = null;
    const vectorDatabase: VectorMemoryDatabase = {
      knowledgeChunk: {
        findMany: async (args) => {
          vectorDatabaseQuery = args as Record<string, unknown>;
          // Deliberately return a cross-office row to verify defense in depth
          // even if an injected database adapter ignores its where clause.
          return [crossOfficeRow, canonicalRow];
        },
      },
    };
    const vectorResults = await retrieveVectorMemory(
      {
        input: {
          officeId: "office-a",
          companyId: "company-a",
          workspaceId: "workspace-a",
          procurementOrderId: "order-a",
          procurementVendorId: "vendor-a",
          supplierKey: "supplier-key-a",
          itemKey: "item-key-a",
          query: "supplier",
        },
        limit: 10,
      },
      {
        name: "test",
        retrieve: async () => [
          crossOfficePointer,
          noChunkPointer,
          missingCanonicalPointer,
          forgedBackendResult,
        ],
      },
      vectorDatabase,
    );
    assert(
      vectorResults.length === 1 &&
      vectorResults[0]?.officeId === "office-a" &&
      vectorResults[0]?.objectId === "object-canonical",
      "Vector boundary admitted a missing or cross-office canonical chunk.",
    );
    assert(
      vectorResults.every((entry) => entry.kind === "chunk" && entry.chunkId),
      "Vector boundary admitted a result without a source-linked chunk.",
    );
    assert(
      vectorResults[0]?.title === "Canonical quote evidence" &&
      vectorResults[0]?.excerpt.includes("Canonical supplier quote") &&
      !vectorResults[0]?.excerpt.includes("FORGED"),
      "Vector retrieval returned backend-authored content instead of canonical chunk content.",
    );
    assert(
      vectorResults[0]?.workspaceId === "workspace-a" &&
      vectorResults[0]?.procurementOrderId === "order-a" &&
      vectorResults[0]?.procurementVendorId === "vendor-a" &&
      vectorResults[0]?.supplierKey === "supplier-key-a" &&
      vectorResults[0]?.itemKey === "item-key-a",
      "Canonical vector rehydration lost exact operational scope metadata.",
    );
    assert(
      vectorResults[0]?.evidence.some((ref) =>
        ref.refType === "knowledge_chunk" && ref.knowledgeChunkId === "chunk-same-office") &&
      vectorResults[0]?.evidence.some((ref) =>
        ref.refType === "entity" && ref.entityType === "procurement_vendor" && ref.entityId === "vendor-a"),
      "Canonical vector rehydration lost source-linked evidence pointers.",
    );
    const vectorWhere = (vectorDatabaseQuery as { where?: Record<string, unknown> } | null)?.where;
    assert(
      vectorWhere?.officeId === "office-a" && JSON.stringify(vectorWhere).includes("chunk-same-office"),
      "Vector canonical rehydration was not database-scoped to the office and ranked pointers.",
    );
  } finally {
    if (previousVectorFlag == null) delete process.env[MEMORY_VECTOR_SEARCH_FLAG];
    else process.env[MEMORY_VECTOR_SEARCH_FLAG] = previousVectorFlag;
  }

  const integrationVectorFlag = process.env[MEMORY_VECTOR_SEARCH_FLAG];
  process.env[MEMORY_VECTOR_SEARCH_FLAG] = "false";
  let temporalRuns = 0;
  try {
    const consensusLexical = {
      ...result({ id: "consensus", score: 999 }),
      reasons: ["lexical_consensus"],
    };
    const consensusEntity = {
      ...result({ id: "consensus", score: 1 }),
      workspaceId: "workspace-a",
      procurementOrderId: "order-a",
      procurementVendorId: "vendor-a",
      supplierKey: "supplier-key-a",
      itemKey: "item-key-a",
      reasons: ["entity_consensus"],
    };
    const threadOne = result({ id: "thread-one", score: 100, emailThreadId: "thread-shared" });
    const threadTwo = result({ id: "thread-two", score: 90, emailThreadId: "thread-shared" });
    const threadThree = result({ id: "thread-three", score: 80, emailThreadId: "thread-shared" });
    const otherOfficeResult = {
      ...result({ id: "cross-office", score: 10_000 }),
      officeId: "office-b",
    };
    const currentState = {
      ...result({ id: "current-state", score: 1 }),
      kind: "operational" as const,
      objectId: null,
      entityType: "supply_state_company",
      entityId: "company=company-a",
      workspaceId: "workspace-a",
      reasons: ["retriever:operational_state"],
      evidence: [{
        refType: "entity" as const,
        entityType: "company",
        entityId: "company-a",
        sourceType: "APP_DB",
      }],
    };
    const hybrid = await hybridSearchMemory({
      officeId: " office-a ",
      companyId: "company-a",
      workspaceId: "workspace-a",
      procurementOrderId: "order-a",
      procurementVendorId: "vendor-a",
      supplierKey: "supplier-key-a",
      itemKey: "item-key-a",
      query: " supplier quote ",
      limit: 6,
    }, {
      retrievers: {
        lexical: async (input, limit) => {
          assert(input.officeId === "office-a" && input.query === "supplier quote", "Hybrid search skipped query normalization.");
          assert(limit >= 25, "Hybrid search did not allocate a bounded candidate pool.");
          return [consensusLexical, threadOne, threadTwo, threadThree, otherOfficeResult];
        },
        entity: async () => [consensusEntity],
        operationalState: async () => [currentState],
        temporal: async ({ search, anchors }) => {
          temporalRuns += 1;
          assert(
            search.officeId === "office-a" && anchors.length > 0 &&
            anchors.every((anchor) => anchor.officeId === "office-a"),
            "Temporal retrieval received unscoped or cross-office anchors.",
          );
          return [{
            ...result({ id: "temporal-neighbor", score: 1 }),
            kind: "event" as const,
            objectId: null,
            eventId: "event-neighbor",
            reasons: ["temporal_neighborhood:1m"],
            evidence: [{ refType: "memory_event" as const, memoryEventId: "event-neighbor" }],
          }];
        },
      },
    });
    assert(temporalRuns === 1, "Hybrid search did not run temporal retrieval from evidence anchors.");
    assert(
      hybrid.results[0]?.objectId === "consensus" &&
      hybrid.results[0]?.reasons.some((reason) => reason.startsWith("rrf:lexical")) &&
      hybrid.results[0]?.reasons.some((reason) => reason.startsWith("rrf:entity")),
      "Hybrid search did not use RRF agreement across heterogeneous retrievers.",
    );
    assert(
      hybrid.results[0]?.workspaceId === "workspace-a" &&
      hybrid.results[0]?.procurementOrderId === "order-a" &&
      hybrid.results[0]?.procurementVendorId === "vendor-a" &&
      hybrid.results[0]?.supplierKey === "supplier-key-a" &&
      hybrid.results[0]?.itemKey === "item-key-a",
      "Fusion did not retain exact optional scope metadata from a corroborating result.",
    );
    assert(
      hybrid.results.filter((entry) => entry.emailThreadId === "thread-shared").length <= 2 &&
      hybrid.results.some((entry) => entry.kind === "operational") &&
      hybrid.results.some((entry) => entry.eventId === "event-neighbor"),
      "Hybrid diversification crowded out current or temporal evidence.",
    );
    assert(
      !hybrid.results.some((entry) => entry.officeId === "office-b") &&
      hybrid.results.every((entry) => entry.evidence.length > 0),
      "Hybrid orchestration admitted cross-office or pointer-free evidence.",
    );
    assert(
      hybrid.retrieval.fusion === "reciprocal_rank_fusion" &&
      hybrid.retrieval.diversification === "email_thread_cap" &&
      hybrid.retrieval.retrievers.lexical.resultCount === 4 &&
      hybrid.retrieval.retrievers.operational_state.resultCount === 1 &&
      hybrid.retrieval.retrievers.entity.resultCount === 1 &&
      hybrid.retrieval.retrievers.temporal.resultCount === 1 &&
      !hybrid.retrieval.retrievers.vector.enabled,
      "Hybrid retrieval diagnostics did not describe the executed pipeline.",
    );
    assert(
      hybrid.filters.workspaceId === "workspace-a" &&
      hybrid.filters.procurementOrderId === "order-a" &&
      hybrid.filters.procurementVendorId === "vendor-a" &&
      hybrid.filters.supplierKey === "supplier-key-a" &&
      hybrid.filters.itemKey === "item-key-a" &&
      hybrid.evidence.length > 0,
      "Hybrid public response lost exact filters or evidence pointers.",
    );
  } finally {
    if (integrationVectorFlag == null) delete process.env[MEMORY_VECTOR_SEARCH_FLAG];
    else process.env[MEMORY_VECTOR_SEARCH_FLAG] = integrationVectorFlag;
  }

  process.env[MEMORY_RETRIEVAL_V2_FLAG] = "false";
  const legacyThreadResults = Array.from({ length: 20 }, (_, index) => ({
    ...result({ id: `legacy-${index}`, score: 100 - index }),
    emailThreadId: "one-legacy-thread",
  }));
  let legacyCandidateLimit = 0;
  const disabledSearch = await hybridSearchMemory({ officeId: "office-a", limit: 20 }, {
    retrievers: {
      lexical: async (_input, limit) => {
        legacyCandidateLimit = limit;
        return legacyThreadResults;
      },
      entity: async () => { throw new Error("Disabled entity retrieval ran"); },
      temporal: async () => { throw new Error("Disabled temporal retrieval ran"); },
    },
  });
  assertDeepEqual(disabledSearch.results, legacyThreadResults,
    "Disabling Retrieval V2 must retain legacy scores, order and all results from the same thread.");
  assert(legacyCandidateLimit === 20 && disabledSearch.retrieval.fusion === "none"
    && disabledSearch.retrieval.diversification === "none",
  "Disabled Retrieval V2 must use the original candidate budget and report no ranking transformations.");

  if (previousRuntimeFlag == null) delete process.env.SUPPLY_STATE_RUNTIME_ENABLED;
  else process.env.SUPPLY_STATE_RUNTIME_ENABLED = previousRuntimeFlag;
  if (previousRetrievalV2Flag == null) delete process.env[MEMORY_RETRIEVAL_V2_FLAG];
  else process.env[MEMORY_RETRIEVAL_V2_FLAG] = previousRetrievalV2Flag;

  console.log(JSON.stringify({
    ok: true,
    retrievers: Object.keys(plan.retrievers),
    exactScopeCount: exactScopes.length,
    projectionScopeCount: projections.length,
    fusedOrder: fused.map((entry) => entry.objectId),
    diversifiedOrder: diversified.map((entry) => entry.objectId),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
