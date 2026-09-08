import { createHash } from "node:crypto";
import {
  hashSupplyStateDependencies,
  hashSupplyStateValue,
  hashSupplyWorldStatePacket,
} from "../state-runtime/canonicalize";
import type {
  SupplyStateDependency,
  SupplyStateScope,
  SupplyWorldEvidenceRef,
  SupplyWorldStatePacket,
} from "../state-runtime/types";
import { COMMERCIAL_STATE_BENCHMARK_SCENARIOS } from "./scenarios";
import {
  BENCHMARK_ID_PREFIX,
  BENCHMARK_OFFICE_ID_PREFIX,
  BENCHMARK_OFFICE_NAME_PREFIX,
  BENCHMARK_PROFILE_RETRIEVABLE_TARGETS,
  BENCHMARK_QUERY_DISTRIBUTION,
  BENCHMARK_QUERY_TYPES,
  BENCHMARK_SEED_VERSION,
  type BenchmarkActionConcurrency,
  type BenchmarkCase,
  type BenchmarkConcurrencyMutation,
  type BenchmarkCorpusManifest,
  type BenchmarkGoldDependency,
  type BenchmarkGoldEvidence,
  type BenchmarkJson,
  type BenchmarkProfile,
  type BenchmarkQueryType,
  type BenchmarkRetrievableCounts,
  type BenchmarkScenarioSeed,
  type BenchmarkStableIds,
} from "./types";

export const BENCHMARK_GENERATED_AT = "2026-08-01T00:00:00.000Z" as const;
export const BENCHMARK_OFFICE_COUNT = 2 as const;
export const BENCHMARK_COMPANY_COUNT = 12 as const;
export const BENCHMARK_SUPPLIER_COUNT = 120 as const;
export const BENCHMARK_REQUEST_COUNT = 48 as const;
export const BENCHMARK_VENDOR_COUNT = 96 as const;

const UUID_NAMESPACE = `${BENCHMARK_ID_PREFIX}:uuid`;
const STABLE_ID_CACHE = new Map<BenchmarkProfile, BenchmarkStableIds>();
const SCENARIO_CONTEXT_CACHE = new Map<string, ReturnType<typeof buildScenarioContext>>();
const QUERY_TYPE_OFFSETS: Record<BenchmarkQueryType, number> = {
  exact: 0,
  semantic: 40,
  current_vs_stale: 80,
  temporal: 115,
  entity_hop: 145,
  routing_tenant: 175,
  autopilot_action: 190,
};

const ROUTING_SCENARIOS = new Set([
  "similar-supplier-names",
  "shared-mailbox-ambiguous-cross-office",
  "exact-commercial-identifiers",
]);

const AUTOPILOT_SCENARIOS = new Set([
  "standard-versus-missed-rush",
  "quote-after-follow-up",
  "new-inbound-after-draft",
  "shared-mailbox-ambiguous-cross-office",
  "legal-commercial-escalation",
  "exact-commercial-identifiers",
]);

function hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function deterministicBenchmarkUuid(profile: BenchmarkProfile, logicalKey: string) {
  const digest = hex(`${UUID_NAMESPACE}:${profile}:${logicalKey}`).slice(0, 32).split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = digest.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function deterministicBenchmarkId(profile: BenchmarkProfile, logicalKey: string) {
  // Production ids used inside colon-delimited semantic fact keys do not
  // contain the registry separator. Keep benchmark ids representative while
  // retaining a safe, profile-specific reset prefix.
  return `${BENCHMARK_ID_PREFIX}-${profile}-${hex(`${profile}:${logicalKey}`).slice(0, 24)}`;
}

export function benchmarkProfilePrefix(profile: BenchmarkProfile) {
  return `${BENCHMARK_OFFICE_ID_PREFIX}${profile}`;
}

export function benchmarkAccountEmail(profile: BenchmarkProfile) {
  return `shared-buying+${profile}@example.test`;
}

export function benchmarkOperatorId(profile: BenchmarkProfile, officeIndex: 0 | 1) {
  return deterministicBenchmarkId(profile, `operator:${officeIndex + 1}`);
}

export function benchmarkOfficeName(profile: BenchmarkProfile, officeIndex: 0 | 1) {
  return `${BENCHMARK_OFFICE_NAME_PREFIX} ${profile} Office ${officeIndex + 1}`;
}

export function benchmarkStableIds(profile: BenchmarkProfile): BenchmarkStableIds {
  const cached = STABLE_ID_CACHE.get(profile);
  if (cached) return cached;
  const officeIds = [0, 1].map((index) => `${benchmarkProfilePrefix(profile)}-office-${index + 1}`) as [string, string];
  const companyIds = Array.from({ length: BENCHMARK_COMPANY_COUNT }, (_, index) => (
    deterministicBenchmarkId(profile, `company:${index + 1}`)
  ));
  const workflowCustomerIds = Array.from({ length: BENCHMARK_COMPANY_COUNT }, (_, index) => (
    deterministicBenchmarkUuid(profile, `workflow-customer:${index + 1}`)
  ));
  const workspaceIds = Array.from({ length: BENCHMARK_COMPANY_COUNT }, (_, index) => (
    deterministicBenchmarkId(profile, `workspace:${index + 1}`)
  ));
  const supplierIds = Array.from({ length: BENCHMARK_SUPPLIER_COUNT }, (_, index) => (
    deterministicBenchmarkUuid(profile, `supplier:${index + 1}`)
  ));
  const itemIds = Array.from({ length: BENCHMARK_REQUEST_COUNT }, (_, index) => (
    deterministicBenchmarkUuid(profile, `item:${index + 1}`)
  ));
  const orderIds = Array.from({ length: BENCHMARK_REQUEST_COUNT }, (_, index) => (
    deterministicBenchmarkUuid(profile, `order:${index + 1}`)
  ));
  const vendorIds = Array.from({ length: BENCHMARK_VENDOR_COUNT }, (_, index) => (
    deterministicBenchmarkUuid(profile, `vendor:${index + 1}`)
  ));
  const ids = {
    profile,
    officeIds,
    companyIds,
    workflowCustomerIds,
    workspaceIds,
    supplierIds,
    itemIds,
    orderIds,
    vendorIds,
    goldenCompanyIds: [0, 1, 6, 7].map((index) => companyIds[index]!),
    goldenSupplierIds: [0, 1, 2, 3, 60, 61, 62, 63].map((index) => supplierIds[index]!),
  };
  STABLE_ID_CACHE.set(profile, ids);
  return ids;
}

export function benchmarkVendorId(ids: BenchmarkStableIds, requestIndex: number, slot = 0) {
  const id = ids.vendorIds[(requestIndex * 2) + slot];
  if (!id) throw new Error(`Benchmark vendor ${requestIndex}:${slot} is outside the scripted graph.`);
  return id;
}

function buildScenarioContext(profile: BenchmarkProfile, scenario: BenchmarkScenarioSeed) {
  const ids = benchmarkStableIds(profile);
  const companyId = ids.companyIds[scenario.companyIndex]!;
  const customerId = ids.workflowCustomerIds[scenario.companyIndex]!;
  const workspaceId = ids.workspaceIds[scenario.companyIndex]!;
  const supplierId = ids.supplierIds[scenario.supplierIndexes[0]!]!;
  const itemId = ids.itemIds[scenario.requestIndex]!;
  const orderId = ids.orderIds[scenario.requestIndex]!;
  const vendorId = benchmarkVendorId(ids, scenario.requestIndex);
  const contextId = deterministicBenchmarkId(profile, `scenario:${scenario.id}:context-current`);
  const snapshotId = deterministicBenchmarkId(profile, `workspace:${scenario.companyIndex + 1}:snapshot-v2`);
  const planningResultId = deterministicBenchmarkId(profile, `scenario:${scenario.id}:planning-result`);
  const executionTaskId = deterministicBenchmarkId(profile, `scenario:${scenario.id}:execution-task`);
  return {
    ids,
    officeId: ids.officeIds[scenario.officeIndex],
    companyId,
    customerId,
    workspaceId,
    supplierId,
    supplierKey: scenario.supplierKey,
    itemId,
    itemKey: scenario.itemKey,
    orderId,
    vendorId,
    contextId,
    snapshotId,
    planningResultId,
    executionTaskId,
  };
}

export function benchmarkScenarioContext(profile: BenchmarkProfile, scenario: BenchmarkScenarioSeed) {
  const key = `${profile}:${scenario.id}`;
  const cached = SCENARIO_CONTEXT_CACHE.get(key);
  if (cached) return cached;
  const context = buildScenarioContext(profile, scenario);
  SCENARIO_CONTEXT_CACHE.set(key, context);
  return context;
}

function replacementMap(profile: BenchmarkProfile, scenario: BenchmarkScenarioSeed) {
  const context = benchmarkScenarioContext(profile, scenario);
  return {
    officeId: context.officeId,
    companyId: context.companyId,
    customerId: context.customerId,
    workspaceId: context.workspaceId,
    supplierId: context.supplierId,
    supplierKey: context.supplierKey,
    itemId: context.itemId,
    itemKey: context.itemKey,
    orderId: context.orderId,
    vendorId: context.vendorId,
    contextId: context.contextId,
    snapshotId: context.snapshotId,
    planningResultId: context.planningResultId,
    executionTaskId: context.executionTaskId,
    accountEmail: benchmarkAccountEmail(profile),
  };
}

function resolveString(profile: BenchmarkProfile, scenario: BenchmarkScenarioSeed, value: string) {
  const replacements = replacementMap(profile, scenario);
  return value
    .replace(/\{\{hash:([^}]+)\}\}/g, (_match, key: string) => (
      hashSupplyStateValue({ profile, scenarioId: scenario.id, key })
    ))
    .replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (match, key: keyof typeof replacements) => (
      replacements[key] ?? match
    ));
}

function resolveJson(profile: BenchmarkProfile, scenario: BenchmarkScenarioSeed, value: BenchmarkJson): BenchmarkJson {
  if (typeof value === "string") return resolveString(profile, scenario, value);
  if (Array.isArray(value)) return value.map((entry) => resolveJson(profile, scenario, entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveJson(profile, scenario, entry)]));
  }
  return value;
}

function otherOfficeRequestIndex(scenario: BenchmarkScenarioSeed) {
  return scenario.officeIndex === 0
    ? 24 + (scenario.requestIndex % 24)
    : scenario.requestIndex % 24;
}

export function benchmarkProviderMessageId(
  profile: BenchmarkProfile,
  scenario: BenchmarkScenarioSeed,
  logicalId: string,
) {
  const exact = typeof scenario.currentState.providerMessageId === "string"
    ? scenario.currentState.providerMessageId
    : typeof scenario.currentState.latestProviderMessageId === "string"
      ? scenario.currentState.latestProviderMessageId
      : null;
  if (!/other|lookalike|foreign|routed-office-a/.test(logicalId) && exact) return exact;
  if (logicalId === "quote-arrival-message") return "provider-quote-arrival-003";
  if (logicalId === "legal-commercial-question") return "provider-legal-question-011";
  return `benchmark-provider-${hex(`${profile}:${scenario.id}:${logicalId}`).slice(0, 24)}`;
}

export function benchmarkProcurementMessageTarget(
  profile: BenchmarkProfile,
  scenario: BenchmarkScenarioSeed,
  logicalId: string,
) {
  const context = benchmarkScenarioContext(profile, scenario);
  if (/routed-office-a|foreign/.test(logicalId)) {
    const requestIndex = otherOfficeRequestIndex(scenario);
    const companyIndex = Math.floor(requestIndex / 4);
    return {
      customerId: context.ids.workflowCustomerIds[companyIndex]!,
      orderId: context.ids.orderIds[requestIndex]!,
      vendorId: benchmarkVendorId(context.ids, requestIndex),
    };
  }
  return {
    customerId: context.customerId,
    orderId: context.orderId,
    vendorId: /other-vendor|lookalike/.test(logicalId)
      ? benchmarkVendorId(context.ids, scenario.requestIndex, 1)
      : context.vendorId,
  };
}

export function benchmarkConversationMessageId(args: {
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

function evidencePhysicalId(
  profile: BenchmarkProfile,
  scenario: BenchmarkScenarioSeed,
  logicalId: string,
  kind: SupplyWorldEvidenceRef["kind"],
) {
  const context = benchmarkScenarioContext(profile, scenario);
  if (kind === "procurement_order") {
    if (/foreign|lookalike/.test(logicalId)) return context.ids.orderIds[otherOfficeRequestIndex(scenario)]!;
    return context.orderId;
  }
  if (kind === "procurement_vendor") {
    return /other-vendor/.test(logicalId)
      ? benchmarkVendorId(context.ids, scenario.requestIndex, 1)
      : context.vendorId;
  }
  if (kind === "procurement_message") {
    const target = benchmarkProcurementMessageTarget(profile, scenario, logicalId);
    return benchmarkConversationMessageId({
      ...target,
      provider: "GMAIL",
      accountEmail: benchmarkAccountEmail(profile),
      providerMessageId: benchmarkProviderMessageId(profile, scenario, logicalId),
    });
  }
  if (kind === "supply_snapshot") {
    if (/foreign/.test(logicalId)) {
      const foreignCompanyIndex = scenario.officeIndex === 0 ? 6 : 0;
      return deterministicBenchmarkId(profile, `workspace:${foreignCompanyIndex + 1}:snapshot-v2`);
    }
    if (/snapshot-v1|old-positive/.test(logicalId)) {
      return deterministicBenchmarkId(profile, `workspace:${scenario.companyIndex + 1}:snapshot-v1`);
    }
    return context.snapshotId;
  }
  if (kind === "company_context" && !/foreign/.test(logicalId)) return context.contextId;
  if (kind === "planning_result" && !/foreign/.test(logicalId)) return context.planningResultId;
  if (kind === "execution_task") return context.executionTaskId;
  if (kind === "supply_profile_fact") {
    return deterministicBenchmarkId(profile, `scenario:${scenario.id}:profile-fact:${logicalId}`);
  }
  if (kind === "supply_price_observation") {
    return deterministicBenchmarkId(profile, `scenario:${scenario.id}:price:${logicalId}`);
  }
  return deterministicBenchmarkId(profile, `scenario:${scenario.id}:evidence:${kind}:${logicalId}`);
}

export function benchmarkEvidenceRef(
  profile: BenchmarkProfile,
  scenario: BenchmarkScenarioSeed,
  logicalId: string,
  kind: SupplyWorldEvidenceRef["kind"],
): SupplyWorldEvidenceRef {
  const id = evidencePhysicalId(profile, scenario, logicalId, kind);
  const contentHash = hashSupplyStateValue({ profile, kind, id });
  switch (kind) {
    case "company_context": return { kind, id, contentHash };
    case "supply_snapshot": return { kind, id, sourceHash: contentHash };
    case "supply_evidence": return { kind, id, contentHash };
    case "supply_profile_fact": return { kind, id, contentHash };
    case "supply_price_observation": return { kind, id, contentHash };
    case "planning_result": return { kind, id, outputHash: contentHash };
    case "supply_decision": return { kind, id, proposalHash: contentHash };
    case "execution_task": return { kind, id, inputHash: contentHash };
    case "execution_event": return { kind, id, payloadHash: contentHash };
    case "procurement_order": return { kind, id, valueHash: contentHash };
    case "procurement_vendor": return { kind, id, valueHash: contentHash };
    case "procurement_message": return { kind, id, valueHash: contentHash };
    case "email_message": return { kind, id, providerMessageId: id };
    case "knowledge_object": return { kind, id };
    case "knowledge_chunk": return { kind, id };
    case "memory_event": return { kind, id };
  }
}

function historicalContradiction(reason: string) {
  return /(?:superseded|closed historical|predates|previous conversation head|no longer current)/i.test(reason);
}

function goldEvidenceTemplatesForCase(
  scenario: BenchmarkScenarioSeed,
  queryType: BenchmarkQueryType,
) {
  const historicalQuery = queryType === "current_vs_stale" || queryType === "temporal";
  const negatives = new Map(scenario.hardNegativeTemplates.map((template) => [
    `${template.kind}:${template.logicalId}`,
    template,
  ]));
  const selected = scenario.evidenceTemplates.filter((template) => {
    const negative = negatives.get(`${template.kind}:${template.logicalId}`);
    if (!negative) return true;
    // A superseded record is useful gold only when the question explicitly
    // asks for reconciliation or chronology. Tenant, routing, entity, and
    // capability negatives are never gold evidence.
    return historicalQuery && historicalContradiction(negative.reason);
  });
  if (queryType !== "temporal") return selected;
  // Temporal accuracy treats gold order as chronology. Put retained historical
  // contradictions before the evidence that establishes the final state.
  return [...selected].sort((left, right) => {
    const leftNegative = negatives.get(`${left.kind}:${left.logicalId}`);
    const rightNegative = negatives.get(`${right.kind}:${right.logicalId}`);
    const leftHistorical = leftNegative && historicalContradiction(leftNegative.reason) ? 0 : 1;
    const rightHistorical = rightNegative && historicalContradiction(rightNegative.reason) ? 0 : 1;
    return leftHistorical - rightHistorical;
  });
}

function evidenceForScenario(
  profile: BenchmarkProfile,
  scenario: BenchmarkScenarioSeed,
  queryType: BenchmarkQueryType,
): BenchmarkGoldEvidence[] {
  return goldEvidenceTemplatesForCase(scenario, queryType).map((template) => ({
    ref: benchmarkEvidenceRef(profile, scenario, template.logicalId, template.kind),
    source: template.source,
    supportsFactKeys: [...template.supportsFactKeys],
  }));
}

function dependenciesForScenario(
  profile: BenchmarkProfile,
  scenario: BenchmarkScenarioSeed,
): BenchmarkGoldDependency[] {
  const evidenceByLogicalId = new Map(scenario.evidenceTemplates.map((template) => [
    template.logicalId,
    benchmarkEvidenceRef(profile, scenario, template.logicalId, template.kind),
  ]));
  return scenario.dependencyTemplates.map((template) => {
    const value = resolveJson(profile, scenario, template.value);
    const valueHash = hashSupplyStateValue(value);
    return {
      key: resolveString(profile, scenario, template.key),
      source: template.source,
      entityType: template.entityType,
      entityRef: resolveString(profile, scenario, template.entityRef),
      policy: template.policy,
      reason: template.reason,
      expectedVersion: valueHash,
      expectedValueHash: valueHash,
      evidenceRefs: template.evidenceLogicalIds.flatMap((logicalId) => {
        const reference = evidenceByLogicalId.get(logicalId);
        return reference ? [reference] : [];
      }),
    };
  });
}

function scopeForScenario(profile: BenchmarkProfile, scenario: BenchmarkScenarioSeed): SupplyStateScope {
  const context = benchmarkScenarioContext(profile, scenario);
  if (scenario.id === "payment-terms-progression" || scenario.id === "similar-supplier-names" || scenario.id === "legal-commercial-escalation") {
    return {
      type: "supplier",
      officeId: context.officeId,
      companyId: context.companyId,
      workspaceId: context.workspaceId,
      supplierId: context.supplierId,
      supplierKey: context.supplierKey,
      orderId: context.orderId,
      vendorId: context.vendorId,
    };
  }
  if (scenario.id === "snapshot-v2-supersedes-v1") {
    return { type: "workspace", officeId: context.officeId, workspaceId: context.workspaceId };
  }
  if (scenario.id === "technical-document-reprocessed") {
    return {
      type: "company",
      officeId: context.officeId,
      companyId: context.companyId,
      workspaceId: context.workspaceId,
    };
  }
  if (scenario.id === "capability-versus-bom" || scenario.id === "inventory-inbound-demand-availability") {
    return {
      type: "item",
      officeId: context.officeId,
      companyId: context.companyId,
      workspaceId: context.workspaceId,
      itemId: context.itemId,
      itemKey: context.itemKey,
    };
  }
  return {
    type: "procurement_request",
    officeId: context.officeId,
    companyId: context.companyId,
    customerId: context.customerId,
    orderId: context.orderId,
    workspaceId: context.workspaceId,
  };
}

function scenariosForType(queryType: BenchmarkQueryType) {
  if (queryType === "routing_tenant") {
    return COMMERCIAL_STATE_BENCHMARK_SCENARIOS.filter((scenario) => ROUTING_SCENARIOS.has(scenario.id));
  }
  if (queryType === "autopilot_action") {
    return COMMERCIAL_STATE_BENCHMARK_SCENARIOS.filter((scenario) => AUTOPILOT_SCENARIOS.has(scenario.id));
  }
  return [...COMMERCIAL_STATE_BENCHMARK_SCENARIOS];
}

function queryText(
  _profile: BenchmarkProfile,
  scenario: BenchmarkScenarioSeed,
  queryType: BenchmarkQueryType,
  typeIndex: number,
) {
  const variation = typeIndex % 4;
  const requestRef = typeof scenario.currentState.rfq === "string"
    ? scenario.currentState.rfq
    : `RFQ-BENCH-${String(scenario.requestIndex + 1).padStart(4, "0")}`;
  const companyRef = `BENCH-COMPANY-${String(scenario.companyIndex + 1).padStart(2, "0")}`;
  const workspaceRef = `BENCH-WORKSPACE-${String(scenario.companyIndex + 1).padStart(2, "0")}`;
  const vendorRef = `BENCH-VENDOR-${String((scenario.requestIndex * 2) + 1).padStart(3, "0")}`;
  const itemRef = `BENCH-ITEM-${String(scenario.requestIndex + 1).padStart(3, "0")}`;
  const exactRef = `${requestRef}, supplier ${scenario.supplierKey}`;
  const prompts: Record<BenchmarkQueryType, string[]> = {
    exact: [
      `For ${exactRef}, return the exact current facts for ${scenario.promptSubject}.`,
      `Look up ${requestRef} and state exactly what is current about ${scenario.promptSubject}.`,
      `Using supplier key ${scenario.supplierKey}, identify the exact authoritative state for ${scenario.promptSubject}.`,
      `Resolve the exact IDs ${vendorRef} and ${itemRef}; what is current for ${scenario.promptSubject}?`,
    ],
    semantic: [
      `What should the buyer understand now about ${scenario.promptSubject}?`,
      `Summarize the commercially operative truth for ${scenario.promptSubject}, ignoring obsolete history.`,
      `Which present fact should guide a decision about ${scenario.promptSubject}?`,
      `In plain language, what do the records currently establish about ${scenario.promptSubject}?`,
    ],
    current_vs_stale: [
      `Separate current state from contradictory history for ${scenario.promptSubject}.`,
      `Which record is current and which lookalike or prior record is stale for ${scenario.promptSubject}?`,
      `Would relying on the older evidence for ${scenario.promptSubject} be stale? Explain with exact evidence.`,
      `Reconcile the latest fact with the superseded fact for ${scenario.promptSubject}.`,
    ],
    temporal: [
      `What event sequence produced the current state of ${scenario.promptSubject}?`,
      `Order the relevant changes for ${scenario.promptSubject} and identify the final state.`,
      `Which evidence came first and what later evidence superseded it for ${scenario.promptSubject}?`,
      `Trace the bounded history that matters to ${scenario.promptSubject}.`,
    ],
    entity_hop: [
      `Follow the exact company, workspace, request, and supplier links for ${scenario.promptSubject}; what do they establish?`,
      `Starting from ${companyRef}, traverse only exact links to answer about ${scenario.promptSubject}.`,
      `Which request vendor and evidence belong together for ${scenario.promptSubject}?`,
      `Use the workspace ${workspaceRef} and exact entity links to resolve ${scenario.promptSubject}.`,
    ],
    routing_tenant: [
      `Within office BENCH-OFFICE-${scenario.officeIndex + 1}, which evidence is allowed to answer about ${scenario.promptSubject}?`,
      `Exclude cross-office and ambiguous records when resolving ${scenario.promptSubject}. What remains?`,
      `Does the similarly named or shared-mailbox record belong to BENCH-OFFICE-${scenario.officeIndex + 1} for ${scenario.promptSubject}?`,
      `Apply exact tenant and routing ownership to ${scenario.promptSubject}.`,
    ],
    autopilot_action: [
      `Given the current request and vendor state, what may the sourcing autopilot do for ${scenario.promptSubject}?`,
      `Should the saved supplier action proceed, replan, or escalate for ${scenario.promptSubject}?`,
      `Before any supplier send, which current fact controls the action for ${scenario.promptSubject}?`,
      `Apply the existing supplier communication policy to ${scenario.promptSubject}.`,
    ],
  };
  return `Q${String(typeIndex + 1).padStart(2, "0")} ${prompts[queryType][variation]!}`;
}

function difficultyFor(queryType: BenchmarkQueryType) {
  if (queryType === "exact") return "easy" as const;
  if (queryType === "semantic" || queryType === "temporal") return "medium" as const;
  return "hard" as const;
}

function currentMutation(
  profile: BenchmarkProfile,
  scenario: BenchmarkScenarioSeed,
  unrelated = false,
): BenchmarkConcurrencyMutation {
  const context = benchmarkScenarioContext(profile, scenario);
  const kind = unrelated ? "supplier_fact_head" : (scenario.concurrencyKind ?? "supplier_fact_head");
  if (kind === "vendor_latest_message") {
    const logicalId = scenario.evidenceTemplates.find((entry) => entry.kind === "procurement_message")?.logicalId ?? "current-message";
    return { kind, orderId: context.orderId, vendorId: context.vendorId, providerMessageId: benchmarkProviderMessageId(profile, scenario, logicalId) };
  }
  if (kind === "vendor_quote") {
    return { kind, orderId: context.orderId, vendorId: context.vendorId, quoteRevision: String(scenario.currentState.quoteRevision ?? "BENCHMARK-CURRENT") };
  }
  if (kind === "vendor_saved_draft") {
    return { kind, orderId: context.orderId, vendorId: context.vendorId, inputHash: hashSupplyStateValue({ profile, scenario: scenario.id, draft: "current" }) };
  }
  if (kind === "company_context_document") {
    const logicalId = scenario.evidenceTemplates.find((entry) => entry.kind === "company_context")?.logicalId ?? "current-document";
    const reference = benchmarkEvidenceRef(profile, scenario, logicalId, "company_context");
    const contentHash = "contentHash" in reference ? reference.contentHash : null;
    return { kind, companyId: context.companyId, contextId: context.contextId, contentHash: contentHash ?? hashSupplyStateValue(reference) };
  }
  if (kind === "workspace_snapshot") {
    const reference = benchmarkEvidenceRef(profile, scenario, "snapshot-v2", "supply_snapshot");
    const sourceHash = "sourceHash" in reference ? reference.sourceHash : hashSupplyStateValue(reference);
    return { kind, workspaceId: context.workspaceId, snapshotId: context.snapshotId, sourceHash };
  }
  if (kind === "supplier_price_head") {
    const observationId = deterministicBenchmarkId(profile, `scenario:${scenario.id}:price:current`);
    return { kind, workspaceId: context.workspaceId, supplierKey: context.supplierKey, observationId, contentHash: hashSupplyStateValue({ profile, scenario: scenario.id, price: "current" }) };
  }
  const unrelatedSupplierKey = unrelated ? `${context.supplierKey}-unrelated-control` : context.supplierKey;
  const factId = deterministicBenchmarkId(profile, `scenario:${scenario.id}:profile-fact:${unrelated ? "unrelated-control" : "current-head"}`);
  return { kind: "supplier_fact_head", workspaceId: context.workspaceId, supplierKey: unrelatedSupplierKey, factId, contentHash: hashSupplyStateValue({ profile, scenario: scenario.id, supplierKey: unrelatedSupplierKey, fact: "current" }) };
}

function concurrencyMetadata(
  profile: BenchmarkProfile,
  scenario: BenchmarkScenarioSeed,
  caseKey: string,
  concurrencyIndex: number,
  dependency: BenchmarkGoldDependency,
  expectedValidOverride?: boolean,
): BenchmarkActionConcurrency {
  const expectedValid = expectedValidOverride ?? concurrencyIndex % 2 === 1;
  return {
    stateReadId: deterministicBenchmarkId(profile, `state-read:${caseKey}`),
    expectedValid,
    expectedChangedStrictKeys: expectedValid ? [] : [dependency.key],
    expectedChangedAdvisoryKeys: [],
    baselineDependencyKey: dependency.key,
    mutation: currentMutation(profile, scenario, expectedValid),
    ...(expectedValid ? {} : { unrelatedControl: currentMutation(profile, scenario, true) }),
  };
}

function concurrencyDependencyForScenario(
  profile: BenchmarkProfile,
  scenario: BenchmarkScenarioSeed,
): BenchmarkGoldDependency {
  const context = benchmarkScenarioContext(profile, scenario);
  const kind = scenario.concurrencyKind ?? "supplier_fact_head";
  const common = {
    policy: "STRICT" as const,
    reason: `Benchmark semantic concurrency guard for ${scenario.family}.`,
    expectedVersion: hashSupplyStateValue({ profile, scenario: scenario.id, baseline: "expected" }),
    expectedValueHash: hashSupplyStateValue({ profile, scenario: scenario.id, baseline: "expected" }),
    evidenceRefs: [] as SupplyWorldEvidenceRef[],
  };
  if (kind === "vendor_latest_message") return {
    ...common,
    key: `procurement.vendor_latest_message:${context.customerId}:${context.orderId}:${context.vendorId}`,
    source: "EMAIL_LEDGER",
    entityType: "procurement_communication_message",
    entityRef: context.vendorId,
  };
  if (kind === "vendor_quote") return {
    ...common,
    key: `procurement.vendor_quote:${context.customerId}:${context.orderId}:${context.vendorId}`,
    source: "WORKFLOW_DB",
    entityType: "order_vendor_quote",
    entityRef: context.vendorId,
  };
  if (kind === "vendor_saved_draft") return {
    ...common,
    key: `procurement.vendor_saved_draft:${context.customerId}:${context.orderId}:${context.vendorId}`,
    source: "APP_DB",
    entityType: "SupplyExecutionTask",
    entityRef: context.executionTaskId,
  };
  if (kind === "company_context_document") return {
    ...common,
    key: `company.context_document:${context.companyId}:${context.contextId}`,
    source: "APP_DB",
    entityType: "CompanyContext",
    entityRef: context.contextId,
  };
  if (kind === "workspace_snapshot") return {
    ...common,
    key: `workspace.current_snapshot:${context.workspaceId}`,
    source: "APP_DB",
    entityType: "SupplySnapshot",
    entityRef: context.workspaceId,
  };
  if (kind === "supplier_price_head") return {
    ...common,
    key: `supplier.price_observations:${context.workspaceId}:${encodeURIComponent(context.supplierKey)}`,
    source: "APP_DB",
    entityType: "SupplyPriceObservation",
    entityRef: context.supplierKey,
  };
  return {
    ...common,
    key: `supplier.profile_facts:${context.workspaceId}:${encodeURIComponent(context.supplierKey)}`,
    source: "APP_DB",
    entityType: "SupplyProfileFact",
    entityRef: context.supplierKey,
  };
}

export function generateBenchmarkCases(profile: BenchmarkProfile): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];
  for (const queryType of BENCHMARK_QUERY_TYPES) {
    const eligible = scenariosForType(queryType);
    const count = BENCHMARK_QUERY_DISTRIBUTION[queryType];
    for (let index = 0; index < count; index += 1) {
      const scenario = eligible[index % eligible.length]!;
      const caseNumber = QUERY_TYPE_OFFSETS[queryType] + index + 1;
      const caseKey = `commercial-state-v1-${String(caseNumber).padStart(3, "0")}`;
      const evidenceTemplates = goldEvidenceTemplatesForCase(scenario, queryType);
      const evidence = evidenceForScenario(profile, scenario, queryType);
      const dependencies = dependenciesForScenario(profile, scenario);
      const supportedFactKeys = new Set(evidenceTemplates.flatMap((entry) => entry.supportsFactKeys));
      const goldEvidenceKeys = new Set(evidence.map((entry) => `${entry.ref.kind}:${entry.ref.id}`));
      cases.push({
        id: `${profile}:${caseKey}`,
        profile,
        queryText: queryText(profile, scenario, queryType, index),
        queryType,
        difficulty: difficultyFor(queryType),
        scope: scopeForScenario(profile, scenario),
        goldFacts: scenario.factTemplates
          .filter((fact) => supportedFactKeys.has(fact.key))
          .map((fact) => ({
            key: fact.key,
            value: resolveJson(profile, scenario, fact.value),
          })),
        goldEvidence: evidence,
        goldDependencies: dependencies,
        metadata: {
          schemaVersion: 1,
          seedVersion: BENCHMARK_SEED_VERSION,
          caseKey,
          scenarioId: scenario.id,
          scenarioFamily: scenario.family,
          hardNegatives: scenario.hardNegativeTemplates.flatMap((negative) => {
            const evidenceRef = benchmarkEvidenceRef(profile, scenario, negative.logicalId, negative.kind);
            return goldEvidenceKeys.has(`${evidenceRef.kind}:${evidenceRef.id}`)
              ? []
              : [{ evidenceRef, reason: negative.reason }];
          }),
        },
      });
    }
  }
  const workflowCompatible = new Set([
    "payment-terms-progression",
    "standard-versus-missed-rush",
    "quote-after-follow-up",
    "new-inbound-after-draft",
    "technical-document-reprocessed",
    "snapshot-v2-supersedes-v1",
    "similar-supplier-names",
    "shared-mailbox-ambiguous-cross-office",
    "capability-versus-bom",
    "inventory-inbound-demand-availability",
    "legal-commercial-escalation",
    "exact-commercial-identifiers",
  ]);
  const priority: Record<BenchmarkQueryType, number> = {
    current_vs_stale: 0,
    autopilot_action: 1,
    temporal: 2,
    entity_hop: 3,
    semantic: 4,
    exact: 5,
    routing_tenant: 6,
  };
  const concurrencyCases = cases
    .filter((caseRow) => workflowCompatible.has(caseRow.metadata.scenarioId))
    .sort((left, right) => (
      priority[left.queryType] - priority[right.queryType]
      || left.id.localeCompare(right.id)
    ))
    .slice(0, 40);
  const scenarioOccurrences = new Map<string, number>();
  concurrencyCases.forEach((caseRow, index) => {
    const scenario = COMMERCIAL_STATE_BENCHMARK_SCENARIOS.find(
      (candidate) => candidate.id === caseRow.metadata.scenarioId,
    )!;
    const occurrence = scenarioOccurrences.get(scenario.id) ?? 0;
    scenarioOccurrences.set(scenario.id, occurrence + 1);
    let expectedValid = index % 2 === 1;
    if ((scenario.id === "snapshot-v2-supersedes-v1" || scenario.id === "exact-commercial-identifiers")
      && occurrence === 0) expectedValid = false;
    if ((scenario.id === "payment-terms-progression" || scenario.id === "similar-supplier-names")
      && occurrence === 1) expectedValid = true;
    caseRow.metadata.actionConcurrency = concurrencyMetadata(
      profile,
      scenario,
      caseRow.metadata.caseKey,
      index,
      concurrencyDependencyForScenario(profile, scenario),
      expectedValid,
    );
  });
  assertBenchmarkCases(cases);
  return cases;
}

/**
 * Seed-only canonical pointers for the legacy keyword baseline. One bounded
 * Company Brain index row per scenario points back to real gold evidence; the
 * runtime receives only query and scope, never the benchmark labels.
 */
export function benchmarkExactLexicalCanonicalPointers(profile: BenchmarkProfile) {
  const pointers = new Map<string, {
    scenarioId: string;
    canonicalPointer: string;
    ref: SupplyWorldEvidenceRef;
  }>();
  for (const caseRow of generateBenchmarkCases(profile)) {
    if (caseRow.queryType !== "exact" || pointers.has(caseRow.metadata.scenarioId)) continue;
    const gold = caseRow.goldEvidence[0];
    if (!gold) throw new Error(`Exact benchmark case ${caseRow.id} has no gold evidence.`);
    pointers.set(caseRow.metadata.scenarioId, {
      scenarioId: caseRow.metadata.scenarioId,
      canonicalPointer: `${gold.ref.kind}:${gold.ref.id}`,
      ref: gold.ref,
    });
  }
  if (pointers.size !== COMMERCIAL_STATE_BENCHMARK_SCENARIOS.length) {
    throw new Error("Every benchmark scenario must expose one canonical pointer to the keyword index.");
  }
  return [...pointers.values()].sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
}

export function benchmarkFixedRetrievableCounts(): Omit<BenchmarkRetrievableCounts, "knowledgeObjects" | "knowledgeChunks" | "memoryEvents" | "total"> {
  return {
    companyContext: 24,
    procurementCommunicationMessages: 96,
    emailMessages: 24,
    supplyProfileFacts: 24,
    supplyPriceObservations: 12,
    supplyEvidence: 12,
    supplyExecutionEvents: 0,
  };
}

export function benchmarkRetrievableCountPlan(profile: BenchmarkProfile): BenchmarkRetrievableCounts {
  const fixed = benchmarkFixedRetrievableCounts();
  const fixedWithoutMemory = Object.values(fixed).reduce((total, value) => total + value, 0);
  const relevantObjects = 24;
  const relevantChunks = 24;
  const relevantEvents = 24;
  const remaining = BENCHMARK_PROFILE_RETRIEVABLE_TARGETS[profile]
    - fixedWithoutMemory
    - relevantObjects
    - relevantChunks
    - relevantEvents;
  if (remaining < 0) throw new Error(`Benchmark profile ${profile} is smaller than its fixed relevant corpus.`);
  const distractorBundles = Math.floor(remaining / 3);
  const remainder = remaining % 3;
  const knowledgeObjects = relevantObjects + distractorBundles + (remainder > 0 ? 1 : 0);
  const knowledgeChunks = relevantChunks + distractorBundles + (remainder > 1 ? 1 : 0);
  const memoryEvents = relevantEvents + distractorBundles;
  const total = fixedWithoutMemory + knowledgeObjects + knowledgeChunks + memoryEvents;
  return { ...fixed, knowledgeObjects, knowledgeChunks, memoryEvents, total };
}

export function generateBenchmarkCorpus(profile: BenchmarkProfile): BenchmarkCorpusManifest {
  const retrievableCounts = benchmarkRetrievableCountPlan(profile);
  if (retrievableCounts.total !== BENCHMARK_PROFILE_RETRIEVABLE_TARGETS[profile]) {
    throw new Error(`Benchmark ${profile} retrievable count plan is not exact.`);
  }
  return {
    schemaVersion: 1,
    seedVersion: BENCHMARK_SEED_VERSION,
    profile,
    profilePrefix: benchmarkProfilePrefix(profile),
    generatedAt: BENCHMARK_GENERATED_AT,
    stableIds: benchmarkStableIds(profile),
    caseCount: 200,
    concurrencyCaseCount: 40,
    scenarioCount: 12,
    entityCounts: {
      offices: 2,
      companies: 12,
      suppliers: 120,
      procurementRequests: 48,
      goldenCompanies: 4,
      goldenSuppliers: 8,
    },
    retrievableCounts,
    cases: generateBenchmarkCases(profile),
  };
}

export function buildBenchmarkStateReadPacket(args: {
  caseRow: BenchmarkCase;
  dependency: SupplyStateDependency;
  evidenceRefs: SupplyWorldEvidenceRef[];
}): SupplyWorldStatePacket {
  const packet: SupplyWorldStatePacket = {
    schemaVersion: 1,
    compilerVersion: "commercial-state-benchmark-v1",
    scope: args.caseRow.scope,
    objective: `Benchmark concurrency validation for ${args.caseRow.metadata.caseKey}`,
    compiledAt: BENCHMARK_GENERATED_AT,
    currentState: Object.fromEntries(args.caseRow.goldFacts.map((fact) => [fact.key, fact.value])),
    derivedState: {},
    openLoops: [],
    uncertainties: [],
    evidenceRefs: args.evidenceRefs,
    dependencies: [args.dependency],
    sourceFingerprint: hashSupplyStateDependencies([args.dependency]),
    packetHash: "",
    diagnostics: {
      projectionHit: false,
      sourceCounts: { benchmark: 1, requiredSourceReaderFailures: 0 },
      timingsMs: {},
    },
  };
  packet.packetHash = hashSupplyWorldStatePacket(packet);
  return packet;
}

export function assertBenchmarkCases(cases: readonly BenchmarkCase[]) {
  if (cases.length !== 200) throw new Error("The benchmark must contain exactly 200 queries per profile.");
  const byType = new Map<BenchmarkQueryType, number>();
  for (const caseRow of cases) byType.set(caseRow.queryType, (byType.get(caseRow.queryType) ?? 0) + 1);
  for (const type of BENCHMARK_QUERY_TYPES) {
    if (byType.get(type) !== BENCHMARK_QUERY_DISTRIBUTION[type]) {
      throw new Error(`Benchmark query distribution is incorrect for ${type}.`);
    }
  }
  if (new Set(cases.map((caseRow) => caseRow.id)).size !== cases.length) {
    throw new Error("Benchmark case IDs must be unique.");
  }
  if (new Set(cases.map((caseRow) => caseRow.queryText)).size !== cases.length) {
    throw new Error("Benchmark query text must be unique within a profile.");
  }
  if (new Set(cases.map((caseRow) => caseRow.metadata.scenarioId)).size !== 12) {
    throw new Error("Every scripted scenario family must receive at least one query.");
  }
  const concurrency = cases.filter((caseRow) => caseRow.metadata.actionConcurrency);
  if (concurrency.length !== 40) throw new Error("The benchmark must contain exactly 40 concurrency cases.");
  if (concurrency.filter((caseRow) => caseRow.metadata.actionConcurrency?.expectedValid).length !== 20) {
    throw new Error("The concurrency corpus must contain exactly 20 false-conflict controls.");
  }
  const requestCustomersByOffice = new Map<string, Set<string>>();
  for (const caseRow of cases) {
    if (caseRow.scope.type !== "procurement_request") continue;
    const customers = requestCustomersByOffice.get(caseRow.scope.officeId) ?? new Set<string>();
    customers.add(caseRow.scope.customerId);
    requestCustomersByOffice.set(caseRow.scope.officeId, customers);
  }
  if (requestCustomersByOffice.size !== 2
    || [...requestCustomersByOffice.values()].some((customers) => customers.size !== 1)) {
    throw new Error("Procurement request cases must use exactly one mapped workflow customer per office.");
  }
  for (const scenario of COMMERCIAL_STATE_BENCHMARK_SCENARIOS) {
    const requestLinkedSupplier = scopeForScenario(cases[0]!.profile, scenario);
    if (requestLinkedSupplier.type !== "supplier" || !requestLinkedSupplier.orderId) continue;
    const mappedCompanyIndex = scenario.officeIndex === 0 ? 0 : 6;
    if (Math.floor(scenario.requestIndex / 4) !== mappedCompanyIndex) {
      throw new Error("Request-linked supplier cases must use the office's mapped workflow customer.");
    }
  }
}
