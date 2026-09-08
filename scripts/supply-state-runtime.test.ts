import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalSupplyStateJson,
  canonicalizeSupplyStateValue,
  hashSupplyStateDependencies,
  hashSupplyStateValue,
  hashSupplyWorldStatePacket,
  MAX_SUPPLY_STATE_PACKET_BYTES,
  SupplyStateCanonicalizationError,
} from "../src/lib/supply-os/state-runtime/canonicalize";
import {
  createSupplyStateFactRegistry,
  readSupplyStateDependency,
  SupplyStateFactRegistry,
  type SupplyStateFactRegistryEntry,
} from "../src/lib/supply-os/state-runtime/fact-registry";
import {
  compileSupplyWorldState,
  resolveSupplyStateCompilationDependencies,
} from "../src/lib/supply-os/state-runtime/compile";
import {
  makeSupplyStateDependency,
  resolveRegisteredSupplyStateDependencies,
  SupplyStateDependencyDriftError,
} from "../src/lib/supply-os/state-runtime/readers/types";
import { readCompanyBrainState } from "../src/lib/supply-os/state-runtime/readers/company-brain";
import { readCompanyState } from "../src/lib/supply-os/state-runtime/readers/company";
import { readEmailThreadState } from "../src/lib/supply-os/state-runtime/readers/email-thread";
import { readExecutionState } from "../src/lib/supply-os/state-runtime/readers/execution";
import { readSupplierState } from "../src/lib/supply-os/state-runtime/readers/supplier";
import {
  canonicalItemIdentityValue,
  companyIdentityValue,
  companySupplierRelationshipValue,
} from "../src/lib/supply-os/state-runtime/readers/selectors";
import { SupplyStateScopeOwnershipError } from "../src/lib/supply-os/state-runtime/readers/scope-ownership";
import {
  persistSupplyStateRead,
  SupplyStateReadPersistenceError,
} from "../src/lib/supply-os/state-runtime/persist-read";
import {
  supplyStateScopeRef,
  supplyStateWorkspaceId,
  type SupplyStateDependency,
  type SupplyWorldStatePacket,
} from "../src/lib/supply-os/state-runtime/types";
import type { SupplyStateProjectionSnapshot } from "../src/lib/supply-os/state-runtime/projections/types";
import {
  recordSupplyStateMetric,
  resetSupplyStateInstrumentationForTests,
  setSupplyStateMetricSink,
  type SupplyStateMetricEvent,
} from "../src/lib/supply-os/state-runtime/instrumentation";

class Decimal {
  constructor(private readonly value: string) {}
  toString() {
    return this.value;
  }
}

function dependency(overrides: Partial<SupplyStateDependency> = {}): SupplyStateDependency {
  const value = { stage: "AWAITING_QUOTES", quoted: false };
  return {
    key: "procurement.order_stage:customer-1:order-1",
    source: "WORKFLOW_DB",
    entityType: "ProcurementOrder",
    entityRef: "customer-1:order-1",
    version: "stage-v1",
    valueHash: hashSupplyStateValue(value),
    policy: "STRICT",
    reason: "The order stage must remain current.",
    evidenceRefs: [{ kind: "procurement_order", id: "order-1", valueHash: hashSupplyStateValue(value) }],
    ...overrides,
  };
}

function packet(overrides: Partial<SupplyWorldStatePacket> = {}): SupplyWorldStatePacket {
  const dependencies = overrides.dependencies ?? [dependency()];
  const value: SupplyWorldStatePacket = {
    schemaVersion: 1,
    compilerVersion: "supply-state-v1-test",
    scope: {
      type: "procurement_request",
      officeId: "office-1",
      companyId: "company-1",
      customerId: "customer-1",
      orderId: "order-1",
      workspaceId: "workspace-1",
    },
    objective: "Determine whether the current supplier draft remains safe to send.",
    compiledAt: "2026-08-26T12:00:00.000Z",
    currentState: { order: { stage: "AWAITING_QUOTES" } },
    derivedState: {},
    openLoops: [],
    uncertainties: [],
    evidenceRefs: dependencies.flatMap((entry) => entry.evidenceRefs),
    dependencies,
    sourceFingerprint: hashSupplyStateDependencies(dependencies),
    packetHash: "",
    diagnostics: {
      projectionHit: false,
      sourceCounts: { WORKFLOW_DB: 1 },
      timingsMs: { workflow: 3 },
    },
    ...overrides,
  };
  value.packetHash = hashSupplyWorldStatePacket(value);
  return value;
}

async function expectPersistenceError(
  operation: () => Promise<unknown>,
  code: SupplyStateReadPersistenceError["code"],
) {
  await assert.rejects(operation, (error: unknown) => (
    error instanceof SupplyStateReadPersistenceError && error.code === code
  ));
}

async function canonicalCompanyStateContract() {
  const companyRow = {
    id: "company-1",
    name: "Canonical Company",
    status: "IN_PROGRESS",
    crmNotes: "Unrelated operator notes",
    updatedAt: new Date("2026-08-26T12:00:00.000Z"),
  };
  assert.deepEqual(companyIdentityValue(companyRow), {
    id: "company-1",
    name: "Canonical Company",
    status: "IN_PROGRESS",
  });

  let query: Record<string, unknown> | null = null;
  const result = await readCompanyState({
    scope: { type: "company", officeId: "office-1", companyId: "company-1" },
    objective: "Compile canonical company state.",
  }, {
    findCompany: (async (args: Record<string, unknown>) => {
      query = args;
      return companyRow;
    }) as never,
  });
  assert.deepEqual(query && (query as { where: unknown }).where, {
    id: "company-1",
    officeId: "office-1",
  });
  assert.deepEqual(result.currentState.company, companyIdentityValue(companyRow));
  assert.equal(result.dependencies.length, 1);
  assert.equal(result.dependencies[0]?.key, "company.identity:company-1");
  assert.equal(result.dependencies[0]?.policy, "STRICT");
  assert.equal(result.dependencies[0]?.valueHash, hashSupplyStateValue(companyIdentityValue(companyRow)));
  assert.equal(result.sourceCounts.companies, 1);
}

async function sharedMailboxRoutingRegression() {
  const unroutedMarker = "UNROUTED_SHARED_MAILBOX";
  const sharedProviderMessageId = "shared-mailbox-provider-message";
  const threadRows = [
    {
      id: "thread-a-routed",
      officeId: "office-a",
      companyId: "company-a",
      hiddenAt: null,
      autoLinkSkipReason: null,
      subject: "Office A routed",
      participants: "[\"supplier@example.com\"]",
      externalThreadId: "provider-thread-a",
      lastMessageAt: new Date("2026-08-26T10:00:00.000Z"),
      messageCount: 1,
      messages: [{
        id: "message-a-routed",
        externalId: null,
        gmailMessageId: sharedProviderMessageId,
        rfcMessageId: "<a@example.com>",
        direction: "INBOUND",
        fromEmail: "supplier@example.com",
        fromName: "Supplier",
        toEmails: "[\"shared@example.com\"]",
        ccEmails: null,
        subject: "A reply",
        bodyText: "Office A evidence",
        sentAt: new Date("2026-08-26T10:00:00.000Z"),
        classification: "CARRIER_REPLY",
      }],
    },
    {
      id: "thread-a-unrouted",
      officeId: "office-a",
      companyId: "company-a",
      hiddenAt: null,
      autoLinkSkipReason: unroutedMarker,
      subject: "Office A unrouted",
      participants: "[]",
      externalThreadId: "provider-thread-a-unrouted",
      lastMessageAt: new Date("2026-08-26T11:00:00.000Z"),
      messageCount: 1,
      messages: [{
        id: "message-a-unrouted",
        externalId: null,
        gmailMessageId: "unrouted-provider-message-a",
        rfcMessageId: "<unrouted-a@example.com>",
        direction: "INBOUND",
        fromEmail: "unknown@example.com",
        fromName: null,
        toEmails: "[\"shared@example.com\"]",
        ccEmails: null,
        subject: "Unrouted",
        bodyText: "Must not compile",
        sentAt: new Date("2026-08-26T11:00:00.000Z"),
        classification: null,
      }],
    },
    {
      id: "thread-b-routed",
      officeId: "office-b",
      companyId: "company-b",
      hiddenAt: null,
      autoLinkSkipReason: null,
      subject: "Office B routed",
      participants: "[\"supplier@example.com\"]",
      externalThreadId: "provider-thread-b",
      lastMessageAt: new Date("2026-08-26T12:00:00.000Z"),
      messageCount: 1,
      messages: [{
        id: "message-b-routed",
        externalId: null,
        gmailMessageId: sharedProviderMessageId,
        rfcMessageId: "<b@example.com>",
        direction: "INBOUND",
        fromEmail: "supplier@example.com",
        fromName: "Supplier",
        toEmails: "[\"shared@example.com\"]",
        ccEmails: null,
        subject: "B reply",
        bodyText: "Office B evidence",
        sentAt: new Date("2026-08-26T12:00:00.000Z"),
        classification: "CARRIER_REPLY",
      }],
    },
  ];
  const queries: Array<Record<string, unknown>> = [];
  const findThreads = async (args: { where: Record<string, unknown> }) => {
    const where = args.where;
    queries.push(where);
    assert.equal(where.hiddenAt, null);
    assert.deepEqual(where.OR, [
      { autoLinkSkipReason: null },
      { autoLinkSkipReason: { not: unroutedMarker } },
    ]);
    return threadRows.filter((thread) => (
      thread.officeId === where.officeId
      && thread.companyId === where.companyId
      && thread.hiddenAt === null
      && thread.autoLinkSkipReason !== unroutedMarker
    ));
  };
  const dependencies = {
    findWorkspace: async () => null,
    findThreads,
  } as never;
  const officeA = await readEmailThreadState({
    scope: { type: "company", officeId: "office-a", companyId: "company-a" },
    objective: "Compile routed company evidence.",
  }, dependencies);
  const officeB = await readEmailThreadState({
    scope: { type: "company", officeId: "office-b", companyId: "company-b" },
    objective: "Compile routed company evidence.",
  }, dependencies);
  assert.deepEqual(queries.map((where) => [where.officeId, where.companyId]), [
    ["office-a", "company-a"],
    ["office-b", "company-b"],
  ]);
  assert.deepEqual(officeA.evidenceRefs.map((reference) => reference.id), ["message-a-routed"]);
  assert.deepEqual(officeB.evidenceRefs.map((reference) => reference.id), ["message-b-routed"]);
  assert.equal(officeA.evidenceRefs.some((reference) => (
    reference.id === "message-b-routed" || reference.id === "message-a-unrouted"
  )), false);
  assert.equal(officeB.evidenceRefs.some((reference) => (
    reference.id === "message-a-routed" || reference.id === "message-a-unrouted"
  )), false);
  assert.deepEqual(
    officeA.evidenceRefs.map((reference) => (
      reference.kind === "email_message" ? reference.providerMessageId : null
    )),
    [sharedProviderMessageId],
  );
  assert.deepEqual(
    officeB.evidenceRefs.map((reference) => (
      reference.kind === "email_message" ? reference.providerMessageId : null
    )),
    [sharedProviderMessageId],
  );
}

async function unrelatedWorkspaceControlsStayAdvisory() {
  const now = new Date("2026-08-26T12:00:00.000Z");
  const result = await readExecutionState({
    scope: { type: "workspace", officeId: "office-1", workspaceId: "workspace-1" },
    objective: "Plan an unrelated new workspace action.",
  }, {
    findWorkspace: async () => ({
      id: "workspace-1",
      companyId: "company-1",
      externalKey: "workspace-key",
      name: "Workspace",
      status: "ACTIVE",
      version: 1,
      archivedAt: null,
    }),
    findDecisions: async () => [{
      id: "decision-unrelated",
      snapshotId: "snapshot-1",
      supersedesDecisionId: null,
      decisionType: "SOURCE",
      subjectType: "ITEM",
      subjectRef: "item-unrelated",
      title: "Unrelated decision",
      objective: "Choose an unrelated source.",
      status: "PROPOSED",
      riskLevel: "LOW",
      proposal: {},
      proposalHash: "decision-hash",
      rationale: null,
      constraints: null,
      finalizedAt: null,
      createdAt: now,
      updatedAt: now,
    }],
    findApprovals: async () => [{
      id: "approval-unrelated",
      decisionId: "decision-unrelated",
      executionTaskId: null,
      status: "PENDING",
      requiredRole: "MANAGER",
      scopeHash: "approval-hash",
      requestReason: null,
      requestedAt: now,
      decidedAt: null,
      expiresAt: null,
      updatedAt: now,
    }],
    findTasks: async () => [{
      id: "task-unrelated",
      snapshotId: "snapshot-1",
      decisionId: "decision-unrelated",
      scenarioId: null,
      parentTaskId: null,
      taskKey: "unrelated-task",
      taskType: "action.execute",
      capabilityKey: "action.execute",
      status: "PLANNED",
      requiresApproval: true,
      input: {},
      inputHash: "task-hash",
      resultHash: null,
      externalSystem: null,
      externalRef: null,
      scheduledFor: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
      events: [],
    }],
  } as never);
  const actionScopedDependencies = result.dependencies.filter((entry) => (
    entry.key.startsWith("decision.proposal:")
      || entry.key.startsWith("approval.scope:")
      || entry.key.startsWith("execution.task:")
  ));
  assert.equal(
    actionScopedDependencies.length,
    0,
    "Context-only workspace reads must not reuse strict action-scoped control facts.",
  );
  const controlsHead = result.dependencies.find((entry) => entry.key === "execution.controls:workspace-1");
  assert(controlsHead);
  assert.equal(controlsHead.policy, "ADVISORY");
  const contextRegistry = new SupplyStateFactRegistry([{
    prefix: "execution.controls:",
    source: "APP_DB",
    defaultPolicy: "ADVISORY",
    canonicalize: canonicalizeSupplyStateValue,
    hash: () => controlsHead.valueHash,
    evidence: (current) => current.evidenceRefs ?? [],
    readCurrent: async () => ({
      exists: true,
      entityType: controlsHead.entityType,
      entityRef: controlsHead.entityRef,
      value: {},
      version: controlsHead.version,
      evidenceRefs: controlsHead.evidenceRefs,
    }),
  }]);
  const [resolvedHead] = await resolveRegisteredSupplyStateDependencies(
    [controlsHead],
    { officeId: "office-1" },
    contextRegistry,
  );
  assert.equal(
    resolvedHead?.policy,
    "ADVISORY",
    "The sealed context head must remain advisory after registry resolution.",
  );
}

async function contentFreeInstrumentationRegression() {
  resetSupplyStateInstrumentationForTests();
  const metricEvents: SupplyStateMetricEvent[] = [];
  setSupplyStateMetricSink((event) => metricEvents.push(event));
  const sensitiveObjective = "Find the confidential customer target price in the private attachment.";
  const result = await readCompanyBrainState({
    scope: { type: "company", officeId: "office-1", companyId: "company-1" },
    objective: sensitiveObjective,
    compilerVersion: "supply-state-v1-test",
  }, {
    search: async () => ({ results: [] }) as never,
    findObjects: async () => [],
    findChunks: async () => [],
    findEvents: async () => [],
    findEmailThreads: async () => [],
  } as never);
  const readerMetric = metricEvents.find((event) => (
    event.name === "source_reader_ms" && event.labels.source === "company_brain"
  ));
  assert(readerMetric, "Company Brain retrieval did not emit a source-reader timing.");
  assert.equal(readerMetric.labels.officeId, "office-1");
  assert.equal(readerMetric.labels.scopeType, "company");
  assert.equal(readerMetric.labels.compilerVersion, "supply-state-v1-test");
  assert.equal(result.timingsMs.company_brain, readerMetric.value);
  assert.equal(JSON.stringify(readerMetric).includes(sensitiveObjective), false);

  setSupplyStateMetricSink(undefined);
  const previousNodeEnv = process.env.NODE_ENV;
  const previousConsoleInfo = console.info;
  const productionLogs: string[] = [];
  try {
    process.env.NODE_ENV = "production";
    console.info = (...args: unknown[]) => {
      productionLogs.push(args.map(String).join(" "));
    };
    recordSupplyStateMetric("packet_bytes", 1_024, {
      officeId: "office-1\r\nforged-line",
      scopeType: "company",
      query: sensitiveObjective,
      packet: { customerContent: sensitiveObjective },
    } as never);
  } finally {
    console.info = previousConsoleInfo;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
  assert.equal(productionLogs.length, 1, "Production metrics did not reach structured logging.");
  const productionMetric = JSON.parse(productionLogs[0] ?? "null") as Record<string, unknown>;
  assert.equal(productionMetric.event, "supply_state_runtime.metric");
  assert.equal(productionMetric.metric, "packet_bytes");
  assert.equal(productionMetric.value, 1_024);
  assert.deepEqual(productionMetric.labels, {
    officeId: "office-1forged-line",
    scopeType: "company",
  });
  assert.equal(productionLogs[0]?.includes(sensitiveObjective), false);
  resetSupplyStateInstrumentationForTests();
}

async function supplierVendorIdentityLinkContract() {
  const canonicalSupplierId = "11111111-1111-4111-8111-111111111111";
  const otherSupplierId = "22222222-2222-4222-8222-222222222222";
  const customerId = "33333333-3333-4333-8333-333333333333";
  const orderId = "44444444-4444-4444-8444-444444444444";
  const vendorId = "55555555-5555-4555-8555-555555555555";
  const supplier = {
    id: canonicalSupplierId,
    name: "Exact Name Components",
    normalizedName: "exact name components",
    website: "https://supplier.example.test",
    domain: "supplier.example.test",
    status: "ACTIVE",
    sourceRefs: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
  const relationship = {
    id: "relationship-1",
    companyId: "company-1",
    supplierId: canonicalSupplierId,
    status: "ACTIVE",
    notes: null,
    sourceRefs: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
  const order = (supplierRegistryId: string | null) => ({
    id: orderId,
    status: "sourcing",
    progress: null,
    neededBy: null,
    quantity: 10,
    unit: "units",
    material: "Test material",
    specification: null,
    requestContext: {},
    approvalRequestedAt: null,
    decisionSnapshot: null,
    vendors: [{
      id: vendorId,
      supplierRegistryId,
      name: supplier.name,
      website: supplier.website,
      contact: { name: null, email: "quotes@supplier.example.test", phone: null },
      contacted: true,
      responseCount: 1,
      status: "shortlisted",
      research: {},
      quote: null,
    }],
    updatedAt: "2026-08-27T12:00:00.000Z",
  });
  const scope = {
    type: "supplier" as const,
    officeId: "office-1",
    companyId: "company-1",
    supplierId: canonicalSupplierId,
    orderId,
    vendorId,
  };
  const baseDependencies = {
    findWorkspace: async () => null,
    findWorkflowAccount: async () => ({ id: customerId, officeId: "office-1", companyId: "company-1" }),
    findSupplier: async () => supplier,
    findCompanySupplier: async () => relationship,
    findSupplierProfile: async () => null,
    findProfileFacts: async () => [],
    findPriceObservations: async () => [],
    findEvidence: async () => [],
    resolveCustomerId: () => customerId,
    getConversation: async () => ({
      available: true,
      unavailableReason: null,
      source: "BOURNE_LEDGER",
      vendor: { id: vendorId, name: supplier.name, contactEmail: "quotes@supplier.example.test" },
      messages: [],
    }),
  };

  const compiled = await readSupplierState({ scope, objective: "Compile the exact linked supplier." }, {
    ...baseDependencies,
    getRequest: async () => order(canonicalSupplierId),
  } as never);
  const supplierState = compiled.currentState.supplier as {
    requestSpecificVendor: { supplierRegistryId: string };
  };
  assert.equal(supplierState.requestSpecificVendor.supplierRegistryId, canonicalSupplierId);
  const vendorDependency = compiled.dependencies.find((entry) => (
    entry.key === `procurement.vendor:${customerId}:${orderId}:${vendorId}`
  ));
  assert(vendorDependency, "The request-specific vendor dependency must be present.");
  assert.equal(
    vendorDependency.valueHash,
    hashSupplyStateValue({
      id: vendorId,
      supplierRegistryId: canonicalSupplierId,
      name: supplier.name,
      website: supplier.website,
      contact: { name: null, email: "quotes@supplier.example.test", phone: null },
      contacted: true,
      status: "shortlisted",
    }),
  );

  await assert.rejects(
    () => readSupplierState({ scope, objective: "Reject a name-only supplier match." }, {
      ...baseDependencies,
      getRequest: async () => order(otherSupplierId),
    } as never),
    /not linked to the scoped canonical supplier/i,
    "Equal supplier names must not override a canonical supplier ID mismatch.",
  );
}

async function main() {
  await canonicalCompanyStateContract();
  await sharedMailboxRoutingRegression();
  await supplierVendorIdentityLinkContract();
  await unrelatedWorkspaceControlsStayAdvisory();
  await contentFreeInstrumentationRegression();
  const first = {
    z: undefined,
    b: new Decimal("123.4500"),
    a: new Date("2026-08-26T12:00:00.000Z"),
    list: [1, undefined, -0],
    big: 9n,
  };
  const second = {
    big: 9n,
    list: [1, null, 0],
    a: new Date("2026-08-26T12:00:00.000Z"),
    b: new Decimal("123.4500"),
  };
  assert.deepEqual(canonicalizeSupplyStateValue(first), canonicalizeSupplyStateValue(second));
  assert.equal(hashSupplyStateValue(first), hashSupplyStateValue(second));
  assert.equal(canonicalSupplyStateJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.throws(() => canonicalizeSupplyStateValue({ value: Number.NaN }), SupplyStateCanonicalizationError);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeSupplyStateValue(cyclic), SupplyStateCanonicalizationError);

  const requestScope = packet().scope;
  assert.match(supplyStateScopeRef(requestScope), /^company=company-1;customer=customer-1;order=order-1;/);
  assert.equal(supplyStateWorkspaceId(requestScope), "workspace-1");
  assert.match(supplyStateScopeRef({
    type: "company",
    officeId: "office-1",
    companyId: "company;with=delimiters",
  }), /company=company%3Bwith%3Ddelimiters/);
  assert.throws(() => supplyStateScopeRef({ type: "supplier", officeId: "office-1" }));
  assert.throws(() => supplyStateScopeRef({
    type: "supplier",
    officeId: "office-1",
    supplierKey: "workspace-key-without-workspace",
  }));
  assert.throws(() => supplyStateScopeRef({
    type: "supplier",
    officeId: "office-1",
    supplierId: "supplier-1",
    orderId: "order-without-vendor",
  }));
  assert.throws(() => supplyStateScopeRef({
    type: "company",
    officeId: "office-1",
    companyId: "company-1\0spoofed",
  }));
  assert.throws(() => supplyStateScopeRef({
    type: "item",
    officeId: "office-1",
    companyId: "company-1",
    workspaceId: "workspace-1",
  }));

  const currentValue = { recipient: "supplier@example.com", quoteRecorded: false };
  const entry: SupplyStateFactRegistryEntry = {
    prefix: "test.vendor:",
    source: "APP_DB",
    defaultPolicy: "STRICT",
    canonicalize: canonicalizeSupplyStateValue,
    hash: hashSupplyStateValue,
    evidence: (current) => current.evidenceRefs ?? [],
    readCurrent: async (context, _key, suffix) => {
      assert.equal(context.officeId, "office-1");
      return {
        exists: true,
        entityType: "TestVendor",
        entityRef: suffix,
        value: currentValue,
        version: "vendor-v1",
        evidenceRefs: [{ kind: "procurement_vendor", id: suffix, valueHash: hashSupplyStateValue(currentValue) }],
      };
    },
  };
  const registry = new SupplyStateFactRegistry([entry]);
  const resolved = await readSupplyStateDependency({
    registry,
    key: "test.vendor:vendor-1",
    context: { officeId: "office-1" },
    reason: "Vendor identity and recipient must remain current.",
  });
  assert.equal(resolved.policy, "STRICT");
  assert.equal(resolved.valueHash, hashSupplyStateValue(currentValue));
  assert.equal(resolved.version, "vendor-v1");
  assert.deepEqual(resolved.evidenceRefs.map((reference) => reference.id), ["vendor-1"]);
  const promoted = await readSupplyStateDependency({
    registry,
    key: "test.vendor:vendor-1",
    context: { officeId: "office-1" },
    policy: "ADVISORY",
  });
  assert.equal(promoted.policy, "STRICT", "registry-owned STRICT facts cannot be downgraded");

  const canonicalItemRow = {
    id: "item-1",
    companyId: "company-1",
    name: "Precision housing",
    sku: "HOUSING-1",
    specification: "5-axis machined",
    manufacturer: "Maker A",
    partNumber: "P-100",
    unit: "EA",
  };
  let canonicalItemWhere: unknown = null;
  const canonicalItemRegistry = createSupplyStateFactRegistry({
    appDb: {
      item: {
        findFirst: async (args: { where: unknown }) => {
          canonicalItemWhere = args.where;
          return canonicalItemRow;
        },
      },
    } as never,
  });
  const canonicalItemDependency = await readSupplyStateDependency({
    registry: canonicalItemRegistry,
    key: "item.identity:company-1:item-1",
    context: { officeId: "office-1" },
  });
  assert.deepEqual(canonicalItemWhere, {
    id: "item-1",
    officeId: "office-1",
    companyId: "company-1",
  });
  assert.equal(canonicalItemDependency.policy, "STRICT");
  assert.equal(
    canonicalItemDependency.valueHash,
    hashSupplyStateValue(canonicalItemIdentityValue(canonicalItemRow)),
  );

  const relationshipRow = {
    id: "relationship-1",
    companyId: "company-1",
    supplierId: "supplier-1",
    status: "ACTIVE",
    notes: "  approved supplier  ",
    sourceRefs: Array.from({ length: 35 }, (_, index) => `  source-${index}  `),
  };
  let profileRow = {
    id: "profile-1",
    linkedCompanyId: "company-1",
    lastResearchRunId: "run-1",
    lastSeenAt: new Date("2026-08-26T10:00:00.000Z"),
    supplierKey: "supplier-key",
    normalizedName: "supplier",
    companyName: "Supplier",
    website: "https://supplier.example",
    websiteDomain: "supplier.example",
    roles: [" distributor "],
    status: "CANDIDATE",
  };
  let supplierEvidenceHash = "evidence-hash-1";
  const supplierRegistry = createSupplyStateFactRegistry({
    appDb: {
      companySupplier: { findFirst: async () => relationshipRow },
      supplySupplierProfile: { findFirst: async () => profileRow },
      supplyProfileFact: { findMany: async () => [{ evidenceId: "evidence-1" }] },
      supplyPriceObservation: { findMany: async () => [] },
      supplyEvidence: {
        findMany: async () => [{
          id: "evidence-1",
          contentHash: supplierEvidenceHash,
          sourceType: "PUBLIC_WEB",
          sourceRecordId: "record-1",
          sourceVersion: "version-1",
        }],
      },
    } as never,
  });
  const relationshipKey = "supplier.company_relationship:company-1:supplier-1";
  const declaredRelationship = makeSupplyStateDependency({
    key: relationshipKey,
    source: "APP_DB",
    entityType: "CompanySupplier",
    entityRef: relationshipRow.id,
    value: companySupplierRelationshipValue(relationshipRow),
    policy: "STRICT",
    reason: "The company-specific supplier relationship changed.",
  });
  const [resolvedRelationship] = await resolveRegisteredSupplyStateDependencies(
    [declaredRelationship],
    { officeId: "office-1" },
    supplierRegistry,
  );
  assert.equal(resolvedRelationship?.valueHash, declaredRelationship.valueHash);

  const profileKey = "supplier.profile:workspace-1:supplier-key";
  const researchKey = "supplier.profile_research:workspace-1:supplier-key";
  const firstProfile = await readSupplyStateDependency({
    registry: supplierRegistry,
    key: profileKey,
    context: { officeId: "office-1" },
  });
  const firstResearch = await readSupplyStateDependency({
    registry: supplierRegistry,
    key: researchKey,
    context: { officeId: "office-1" },
  });
  profileRow = {
    ...profileRow,
    lastResearchRunId: "run-2",
    lastSeenAt: new Date("2026-08-26T11:00:00.000Z"),
  };
  const secondProfile = await readSupplyStateDependency({
    registry: supplierRegistry,
    key: profileKey,
    context: { officeId: "office-1" },
  });
  const secondResearch = await readSupplyStateDependency({
    registry: supplierRegistry,
    key: researchKey,
    context: { officeId: "office-1" },
  });
  assert.equal(firstProfile.policy, "STRICT");
  assert.equal(firstProfile.valueHash, secondProfile.valueHash);
  assert.equal(firstResearch.policy, "ADVISORY");
  assert.notEqual(firstResearch.valueHash, secondResearch.valueHash);

  const evidenceKey = "supplier.evidence:workspace-1:supplier-key";
  const firstEvidence = await readSupplyStateDependency({
    registry: supplierRegistry,
    key: evidenceKey,
    context: { officeId: "office-1" },
  });
  supplierEvidenceHash = "evidence-hash-2";
  const secondEvidence = await readSupplyStateDependency({
    registry: supplierRegistry,
    key: evidenceKey,
    context: { officeId: "office-1" },
  });
  assert.equal(firstEvidence.policy, "ADVISORY");
  assert.notEqual(firstEvidence.valueHash, secondEvidence.valueHash);
  assert.deepEqual(secondEvidence.evidenceRefs, [{
    kind: "supply_evidence",
    id: "evidence-1",
    contentHash: "evidence-hash-2",
  }]);

  let draftProposal: Record<string, unknown> = { recipient: "first@supplier.example" };
  const draftDecisionRegistry = createSupplyStateFactRegistry({
    appDb: {
      supplyDecision: {
        findFirst: async () => ({
          id: "decision-draft",
          proposal: draftProposal,
          proposalHash: null,
          status: "DRAFT",
          snapshotId: "snapshot-1",
        }),
      },
    } as never,
  });
  const firstDraft = await readSupplyStateDependency({
    registry: draftDecisionRegistry,
    key: "decision.proposal:decision-draft",
    context: { officeId: "office-1" },
  });
  draftProposal = { recipient: "changed@supplier.example" };
  const secondDraft = await readSupplyStateDependency({
    registry: draftDecisionRegistry,
    key: "decision.proposal:decision-draft",
    context: { officeId: "office-1" },
  });
  assert.equal(firstDraft.policy, "STRICT");
  assert.notEqual(firstDraft.version, secondDraft.version);
  assert.notEqual(firstDraft.valueHash, secondDraft.valueHash);

  const declared = makeSupplyStateDependency({
    key: "test.vendor:vendor-1",
    source: "APP_DB",
    entityType: "TestVendor",
    entityRef: "vendor-1",
    value: currentValue,
    version: "vendor-v1",
    policy: "STRICT",
    reason: "Vendor identity must remain current.",
  });
  assert.deepEqual(
    await resolveRegisteredSupplyStateDependencies([declared], { officeId: "office-1" }, registry),
    [{ ...resolved, reason: "Vendor identity must remain current." }],
  );
  const resolvedCompilationDependencies = await resolveSupplyStateCompilationDependencies({
    officeId: "office-1",
    projectionDependencies: [],
    queryDependencies: [{ ...declared, policy: "ADVISORY" }],
    registry,
  });
  assert.equal(resolvedCompilationDependencies[0]?.policy, "STRICT");

  const projection: SupplyStateProjectionSnapshot = {
    id: null,
    scope: packet().scope,
    projectionType: "procurement_request_v1",
    compilerVersion: "supply-state-v1-test",
    sourceFingerprint: hashSupplyStateDependencies([declared]),
    payload: { currentState: {}, derivedState: {}, openLoops: [], uncertainties: [] },
    payloadHash: hashSupplyStateValue({ currentState: {}, derivedState: {}, openLoops: [], uncertainties: [] }),
    evidenceRefs: declared.evidenceRefs,
    dependencies: [declared],
    builtAt: "2026-08-26T12:00:00.000Z",
    dirtyAt: null,
    projectionHit: false,
    sourceCounts: { APP_DB: 1 },
    timingsMs: {},
  };
  const mergedPacket = compileSupplyWorldState({
    scope: packet().scope,
    objective: "Verify duplicate dependency policy behavior.",
    projection,
    queryEvidence: {
      dependencies: [{ ...declared, policy: "ADVISORY", reason: "Historical query evidence changed." }],
    },
  });
  assert.equal(mergedPacket.dependencies.length, 1);
  assert.equal(mergedPacket.dependencies[0]?.policy, "STRICT");
  const historicalCurrentState = { vendor: { recipient: "untrusted-history@example.test" } };
  const canonicalCurrentPacket = compileSupplyWorldState({
    scope: packet().scope,
    objective: "Keep canonical current state separate from historical evidence.",
    projection: {
      ...projection,
      payload: {
        ...projection.payload,
        currentState: { vendor: { recipient: "canonical@example.test" } },
      },
      payloadHash: hashSupplyStateValue({
        ...projection.payload,
        currentState: { vendor: { recipient: "canonical@example.test" } },
      }),
    },
    queryEvidence: { currentState: historicalCurrentState } as never,
  });
  assert.deepEqual(canonicalCurrentPacket.currentState, {
    vendor: { recipient: "canonical@example.test" },
  });
  assert.deepEqual(canonicalCurrentPacket.derivedState.historicalStateEvidence, historicalCurrentState);
  assert.throws(() => compileSupplyWorldState({
    scope: packet().scope,
    objective: "Reject conflicting duplicate dependencies.",
    projection,
    queryEvidence: {
      dependencies: [{
        ...declared,
        version: "vendor-v2",
        valueHash: hashSupplyStateValue({ ...currentValue, quoteRecorded: true }),
      }],
    },
  }), /conflicting declarations/);
  const changedEntry = { ...entry, readCurrent: async () => ({
    exists: true,
    entityType: "TestVendor",
    entityRef: "vendor-1",
    value: { ...currentValue, quoteRecorded: true },
    version: "vendor-v2",
    evidenceRefs: [],
  }) } satisfies SupplyStateFactRegistryEntry;
  await assert.rejects(
    () => resolveRegisteredSupplyStateDependencies(
      [declared],
      { officeId: "office-1" },
      new SupplyStateFactRegistry([changedEntry]),
    ),
    (error: unknown) => error instanceof SupplyStateDependencyDriftError
      && error.key === declared.key
      && error.declaredVersion === "vendor-v1"
      && error.currentVersion === "vendor-v2",
  );

  const contextWorkspaceQueries: Array<Record<string, unknown>> = [];
  const contextRegistry = createSupplyStateFactRegistry({
    appDb: {
      supplyWorkspace: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          contextWorkspaceQueries.push(args.where);
          const id = String(args.where.id);
          return { id, companyId: "company-1" };
        },
      },
      companyContext: { findMany: async () => [] },
    } as never,
    assembleCompanyContext: (async (_access: unknown, workspaceId: string) => ({
      company: { id: "company-1", name: workspaceId },
      documents: [],
      messages: [],
    })) as never,
    resolveCompanyContextAccess: (async () => ({ officeId: "office-1" })) as never,
  });
  const firstWorkspaceContext = await readSupplyStateDependency({
    registry: contextRegistry,
    key: "company.context_version:company-1:workspace-a",
    context: { officeId: "office-1" },
  });
  const secondWorkspaceContext = await readSupplyStateDependency({
    registry: contextRegistry,
    key: "company.context_version:company-1:workspace-b",
    context: { officeId: "office-1" },
  });
  assert.equal(contextWorkspaceQueries[0]?.id, "workspace-a");
  assert.equal(contextWorkspaceQueries[1]?.id, "workspace-b");
  assert.equal(firstWorkspaceContext.entityRef, "company-1:workspace-a");
  assert.equal(secondWorkspaceContext.entityRef, "company-1:workspace-b");

  let planningRows: Array<Record<string, unknown>> = [];
  const collectionRegistry = createSupplyStateFactRegistry({
    appDb: {
      supplyPlanningResult: { findMany: async () => planningRows },
    } as never,
  });
  const emptyPlanningHead = await readSupplyStateDependency({
    registry: collectionRegistry,
    key: "planning.latest_results:workspace-a",
    context: { officeId: "office-1" },
  });
  planningRows = [{
    id: "plan-1",
    snapshotId: "snapshot-1",
    engineVersion: "engine-1",
    snapshotHash: "snapshot-hash-1",
    normalizedInputHash: "input-hash-1",
    outputHash: "output-hash-1",
    createdAt: new Date("2026-08-26T12:00:00.000Z"),
  }];
  const appendedPlanningHead = await readSupplyStateDependency({
    registry: collectionRegistry,
    key: "planning.latest_results:workspace-a",
    context: { officeId: "office-1" },
  });
  assert.notEqual(emptyPlanningHead.valueHash, appendedPlanningHead.valueHash);

  const itemPlanningRows = [
    {
      id: "plan-current",
      snapshotId: "snapshot-current",
      engineVersion: "engine-1",
      snapshotHash: "snapshot-current-hash",
      normalizedInputHash: "input-current",
      outputHash: "output-current",
      output: { productItemKey: "item-a" },
      createdAt: new Date("2026-08-26T12:00:00.000Z"),
    },
    {
      id: "plan-stale",
      snapshotId: "snapshot-stale",
      engineVersion: "engine-1",
      snapshotHash: "snapshot-stale-hash",
      normalizedInputHash: "input-stale",
      outputHash: "output-stale",
      output: { productItemKey: "item-a" },
      createdAt: new Date("2026-08-25T12:00:00.000Z"),
    },
  ];
  const itemPlanningRegistry = createSupplyStateFactRegistry({
    appDb: {
      supplySnapshot: {
        findFirst: async () => ({ id: "snapshot-current" }),
      },
      supplyPlanningResult: {
        findMany: async (args: { where: { snapshotId?: string } }) => {
          assert.equal(args.where.snapshotId, "snapshot-current");
          return itemPlanningRows.filter((row) => row.snapshotId === args.where.snapshotId);
        },
      },
    } as never,
  });
  const itemPlanningHead = await readSupplyStateDependency({
    registry: itemPlanningRegistry,
    key: "item.planning_results:workspace-a:item-a",
    context: { officeId: "office-1" },
  });
  assert.deepEqual(itemPlanningHead.evidenceRefs.map((reference) => reference.id), ["plan-current"]);
  assert.equal(itemPlanningHead.evidenceRefs.some((reference) => reference.id === "plan-stale"), false);

  let storedData: Record<string, unknown> | null = null;
  let createCount = 0;
  const database = {
    supplyStateRead: {
      create: async (args: { data: Record<string, unknown> }) => {
        createCount += 1;
        storedData = args.data;
        return {
          id: "state-read-1",
          officeId: args.data.officeId,
          workspaceId: args.data.workspaceId,
          scopeType: args.data.scopeType,
          scopeRef: args.data.scopeRef,
          objective: args.data.objective,
          compilerVersion: args.data.compilerVersion,
          sourceFingerprint: args.data.sourceFingerprint,
          packetHash: args.data.packetHash,
          createdAt: new Date("2026-08-26T12:01:00.000Z"),
        };
      },
    },
  };
  const persistenceDependencies = {
    database: database as never,
    assertScopeOwnership: async () => {},
  };
  const downgradedDependency = dependency({
    key: "procurement.order:customer-1:order-1",
    policy: "ADVISORY",
  });
  const consistentlyDowngradedPacket = packet({ dependencies: [downgradedDependency] });
  await expectPersistenceError(
    () => persistSupplyStateRead(
      { officeId: "office-1", workspaceId: "workspace-1", packet: consistentlyDowngradedPacket },
      persistenceDependencies,
    ),
    "conflict",
  );
  assert.equal(createCount, 0, "A registry-STRICT dependency downgrade reached persistence.");
  const persistedPacket = packet();
  const persisted = await persistSupplyStateRead(
    { officeId: "office-1", workspaceId: "workspace-1", packet: persistedPacket },
    persistenceDependencies,
  );
  assert.equal(persisted.id, "state-read-1");
  const capturedStoredData = (() => {
    if (!storedData) throw new Error("State read data was not captured.");
    return storedData as Record<string, unknown>;
  })();
  assert.equal(capturedStoredData.officeId, "office-1");
  assert.equal(capturedStoredData.workspaceId, "workspace-1");
  assert.equal(capturedStoredData.packetHash, persistedPacket.packetHash);
  assert.deepEqual(capturedStoredData.dependencyManifest, persistedPacket.dependencies);

  const tampered = packet();
  tampered.currentState = { order: { stage: "CANCELLED" } };
  await expectPersistenceError(
    () => persistSupplyStateRead({ officeId: "office-1", packet: tampered }, persistenceDependencies),
    "conflict",
  );
  await expectPersistenceError(
    () => persistSupplyStateRead({ officeId: "office-2", packet: packet() }, persistenceDependencies),
    "invalid_input",
  );
  await expectPersistenceError(
    () => persistSupplyStateRead({ officeId: "office-1", workspaceId: "workspace-2", packet: packet() }, persistenceDependencies),
    "invalid_input",
  );
  const oversized = packet({ currentState: { body: "x".repeat(MAX_SUPPLY_STATE_PACKET_BYTES) } });
  await expectPersistenceError(
    () => persistSupplyStateRead({ officeId: "office-1", packet: oversized }, persistenceDependencies),
    "invalid_input",
  );
  const partialReaderPacket = packet({
    uncertainties: [{ kind: "source_reader_failed", source: "procurement_order" }],
    diagnostics: {
      projectionHit: false,
      sourceCounts: { procurement_order_errors: 1, requiredSourceReaderFailures: 1 },
      timingsMs: {},
    },
  });
  await expectPersistenceError(
    () => persistSupplyStateRead({ officeId: "office-1", packet: partialReaderPacket }, persistenceDependencies),
    "unavailable",
  );
  const dependencyFreePacket = packet({ dependencies: [], evidenceRefs: [] });
  await expectPersistenceError(
    () => persistSupplyStateRead({ officeId: "office-1", packet: dependencyFreePacket }, persistenceDependencies),
    "unavailable",
  );
  const createsBeforeOwnershipFailure = createCount;
  await expectPersistenceError(
    () => persistSupplyStateRead({ officeId: "office-1", packet: packet() }, {
      database: database as never,
      assertScopeOwnership: async () => {
        throw new SupplyStateScopeOwnershipError("Foreign company scope.");
      },
    }),
    "conflict",
  );
  assert.equal(createCount, createsBeforeOwnershipFailure, "A foreign state-read scope reached persistence.");

  const root = process.cwd();
  const files = [
    "prisma/schema.prisma",
    "prisma/migrations/20260826000100_supply_state_runtime/migration.sql",
    "scripts/sql/derya-app-role.sql",
    "scripts/sql/production-verification/20260826000100_supply_state_runtime.sql",
    "src/lib/supply-os/state-runtime/types.ts",
    "src/lib/supply-os/state-runtime/canonicalize.ts",
    "src/lib/supply-os/state-runtime/fact-registry.ts",
    "src/lib/supply-os/state-runtime/persist-read.ts",
    "src/lib/supply-os/state-runtime/validate.ts",
    "src/lib/supply-os/state-runtime/instrumentation.ts",
  ].map((path) => readFileSync(resolve(root, path), "utf8"));
  const [schema, migration, roleSql, verification] = files;
  assert.match(schema!, /model SupplyStateProjection\s*\{/);
  assert.match(schema!, /model SupplyStateRead\s*\{/);
  assert.match(schema!, /stateReadId\s+String\?/);
  assert.match(migration!, /SupplyStateRead_immutable_guard/);
  assert.match(migration!, /SupplyDecision_state_read_immutable_guard/);
  assert.match(migration!, /SupplyCapabilityRun_state_read_immutable_guard/);
  assert.match(migration!, /SupplyExecutionTask_state_read_immutable_guard/);
  assert.match(migration!, /pg_trigger_depth\(\) > 1/);
  assert.match(migration!, /SupplyDecision_state_projection_invalidate/);
  assert.match(migration!, /SupplyApproval_state_projection_invalidate/);
  assert.match(migration!, /SupplyExecutionTask_state_projection_invalidate/);
  assert.match(migration!, /SupplyExecutionEvent_state_projection_invalidate/);
  assert.match(migration!, /EXCEPTION WHEN OTHERS THEN\s+NULL/);
  assert.match(migration!, /supply_assert_reference_scope\('SupplyStateRead', 'stateReadId'\)/);
  assert.doesNotMatch(migration!, /allow_supply_provenance_mutation/);
  assert.match(migration!, /GRANT SELECT, INSERT ON "SupplyStateRead" TO derya_app/);
  assert.match(migration!, /REVOKE UPDATE, DELETE ON "SupplyStateRead" FROM derya_app/);
  assert.match(roleSql!, /'SupplyStateProjection'/);
  assert.match(roleSql!, /'SupplyStateRead'/);
  assert.match(roleSql!, /app_table = 'SupplyStateRead'/);
  assert.match(verification!, /BEGIN READ ONLY/);
  assert.match(verification!, /SupplyStateProjection_workspace_scope_guard/);
  assert.match(verification!, /SupplyStateRead_workspace_scope_guard/);
  assert.match(verification!, /SupplyExecutionEvent_state_projection_invalidate/);
  assert.match(verification!, /tgenabled <> 'D'/);
  assert.match(verification!, /dashboard_api received application-owned Supply state runtime privileges/);
  for (const source of files) {
    assert.equal(source.includes("\u2014"), false, "Supply state runtime files must not contain U+2014");
  }

  console.log("Supply state runtime contract passed.");
}

void main();
