import { prisma } from "@/lib/prisma";
import {
  getProcurementWorkflowAccount,
  procurementCustomerIdFromServerMetadata,
} from "@/lib/procurement-workflow";
import { canonicalTypesForSearch, normalizeSourceType } from "../canonical-types";
import type { MemoryEvidenceRef } from "../evidence";
import { compactMemoryText } from "../relevance";
import { exactEntityScopes, lexicalSearchMemory } from "./lexical";
import {
  memoryOperationalScopeMetadata,
  type HybridMemorySearchInput,
  type HybridMemorySearchResult,
  type MemoryOperationalScope,
} from "./types";
import {
  resolveSnapshotItemIdentity,
  type CanonicalItemIdentityRow,
  type SnapshotSupplyItemIdentityRow,
} from "../../supply-os/state-runtime/readers/item-identity";

const PROCUREMENT_REPLY_TASK_TYPES = [
  "PROCUREMENT_SUPPLIER_REPLY_DRAFT",
  "PROCUREMENT_SUPPLIER_REPLY_EMAIL",
] as const;

type CompanyRow = { id: string };
type WorkspaceRow = {
  id: string;
  companyId: string | null;
  name: string;
  status: string;
  updatedAt: Date;
};
type SupplierProfileRow = {
  id: string;
  workspaceId: string;
  linkedCompanyId: string | null;
  supplierKey: string;
  companyName: string;
  status: string;
  lastSeenAt: Date;
};
type ProfileFactRow = {
  id: string;
  subjectType: string;
  subjectRef: string;
  factType: string;
  value: unknown;
  sourceType: string;
  evidenceId: string | null;
  observedAt: Date | null;
  capturedAt: Date;
};
type PriceObservationRow = {
  id: string;
  supplierProfileId: string | null;
  evidenceId: string | null;
  itemKey: string;
  observationType: string;
  amount: unknown;
  currency: string;
  unitOfMeasure: string;
  observedAt: Date;
  capturedAt: Date;
};
type SnapshotRow = {
  id: string;
  publishedAt: Date | null;
};
type SupplyEvidenceRow = {
  id: string;
  kind: string;
  sourceType: string;
  title: string;
  excerpt: string | null;
  observedAt: Date | null;
  capturedAt: Date;
};
type WorkflowAccountRow = { id: string };
type ProcurementReplyTaskRow = {
  id: string;
  workspaceId: string;
  taskType: string;
  status: string;
  input: unknown;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type EntityMemoryDependencies = {
  lexicalSearch: typeof lexicalSearchMemory;
  findCompany(input: { officeId: string; companyId: string }): Promise<CompanyRow | null>;
  findWorkspace(input: {
    officeId: string;
    workspaceId: string;
    companyId?: string | null;
  }): Promise<WorkspaceRow | null>;
  findSupplierProfile(input: {
    officeId: string;
    workspaceId: string;
    supplierKey: string;
  }): Promise<SupplierProfileRow | null>;
  findProfileFacts(input: {
    officeId: string;
    workspaceId: string;
    subjectType: "SUPPLIER" | "ITEM";
    subjectRef: string;
    limit: number;
  }): Promise<ProfileFactRow[]>;
  findPriceObservations(input: {
    officeId: string;
    workspaceId: string;
    supplierProfileId?: string | null;
    itemKey?: string | null;
    limit: number;
  }): Promise<PriceObservationRow[]>;
  findLatestSnapshot(input: {
    officeId: string;
    workspaceId: string;
  }): Promise<SnapshotRow | null>;
  resolveItemIdentity: typeof resolveSnapshotItemIdentity;
  findEvidence(input: {
    officeId: string;
    workspaceId: string;
    evidenceIds: string[];
    limit: number;
  }): Promise<SupplyEvidenceRow[]>;
  findWorkflowAccount(input: {
    officeId: string;
    companyId: string;
  }): Promise<WorkflowAccountRow | null>;
  findProcurementReplyTasks(input: {
    officeId: string;
    workspaceId?: string | null;
    customerId: string;
    orderId: string;
    vendorId?: string | null;
    limit: number;
  }): Promise<ProcurementReplyTaskRow[]>;
};

const defaultDependencies: EntityMemoryDependencies = {
  lexicalSearch: lexicalSearchMemory,
  findCompany: ({ officeId, companyId }) => prisma.company.findFirst({
    where: { id: companyId, officeId },
    select: { id: true },
  }),
  findWorkspace: ({ officeId, workspaceId, companyId }) => prisma.supplyWorkspace.findFirst({
    where: {
      id: workspaceId,
      officeId,
      ...(companyId ? { companyId } : {}),
    },
    select: { id: true, companyId: true, name: true, status: true, updatedAt: true },
  }),
  findSupplierProfile: ({ officeId, workspaceId, supplierKey }) => prisma.supplySupplierProfile.findFirst({
    where: { officeId, workspaceId, supplierKey },
    select: {
      id: true,
      workspaceId: true,
      linkedCompanyId: true,
      supplierKey: true,
      companyName: true,
      status: true,
      lastSeenAt: true,
    },
  }),
  findProfileFacts: ({ officeId, workspaceId, subjectType, subjectRef, limit }) => (
    prisma.supplyProfileFact.findMany({
      where: { officeId, workspaceId, subjectType, subjectRef },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        subjectType: true,
        subjectRef: true,
        factType: true,
        value: true,
        sourceType: true,
        evidenceId: true,
        observedAt: true,
        capturedAt: true,
      },
    })
  ),
  findPriceObservations: ({
    officeId,
    workspaceId,
    supplierProfileId,
    itemKey,
    limit,
  }) => prisma.supplyPriceObservation.findMany({
    where: {
      officeId,
      workspaceId,
      ...(supplierProfileId ? { supplierProfileId } : {}),
      ...(itemKey ? { itemKey } : {}),
    },
    orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      supplierProfileId: true,
      evidenceId: true,
      itemKey: true,
      observationType: true,
      amount: true,
      currency: true,
      unitOfMeasure: true,
      observedAt: true,
      capturedAt: true,
    },
  }),
  findLatestSnapshot: ({ officeId, workspaceId }) => prisma.supplySnapshot.findFirst({
    where: { officeId, workspaceId, status: "PUBLISHED" },
    orderBy: [{ version: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
    select: { id: true, publishedAt: true },
  }),
  resolveItemIdentity: resolveSnapshotItemIdentity,
  findEvidence: ({ officeId, workspaceId, evidenceIds, limit }) => prisma.supplyEvidence.findMany({
    where: { officeId, workspaceId, id: { in: evidenceIds } },
    orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      kind: true,
      sourceType: true,
      title: true,
      excerpt: true,
      observedAt: true,
      capturedAt: true,
    },
  }),
  findWorkflowAccount: ({ officeId, companyId }) => getProcurementWorkflowAccount({
    officeId,
    customerId: procurementCustomerIdFromServerMetadata(officeId),
    companyId,
  }),
  findProcurementReplyTasks: ({
    officeId,
    workspaceId,
    customerId,
    orderId,
    vendorId,
    limit,
  }) => prisma.supplyExecutionTask.findMany({
    where: {
      officeId,
      ...(workspaceId ? { workspaceId } : {}),
      taskType: { in: [...PROCUREMENT_REPLY_TASK_TYPES] },
      AND: [
        { input: { path: ["customerId"], equals: customerId } },
        { input: { path: ["orderId"], equals: orderId } },
        ...(vendorId ? [{ input: { path: ["vendorId"], equals: vendorId } }] : []),
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      workspaceId: true,
      taskType: true,
      status: true,
      input: true,
      result: true,
      createdAt: true,
      updatedAt: true,
    },
  }),
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function entityEvidence(
  entityType: string,
  entityId: string,
  sourceType = "APP_DB",
): MemoryEvidenceRef[] {
  return [{ refType: "entity", entityType, entityId, sourceType }];
}

function resultDate(value: Date | null | undefined, fallback: Date) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : fallback;
}

function directResult(input: {
  officeId: string;
  entityType: string;
  entityId: string;
  title: string;
  excerpt: string;
  occurredAt: Date;
  companyId?: string | null;
  metadata: MemoryOperationalScope;
  evidence?: MemoryEvidenceRef[];
  sourceType?: string;
}): HybridMemorySearchResult {
  return {
    officeId: input.officeId,
    kind: "operational",
    objectId: null,
    chunkId: null,
    eventId: null,
    sourceType: input.sourceType ?? "APP_DB",
    sourceExternalId: `${input.entityType}:${input.entityId}`,
    canonicalType: null,
    title: input.title,
    excerpt: compactMemoryText(input.excerpt, 900),
    score: input.occurredAt.getTime(),
    occurredAt: input.occurredAt,
    entityType: input.entityType,
    entityId: input.entityId,
    companyId: input.companyId ?? null,
    jobId: null,
    inquiryId: null,
    ...memoryOperationalScopeMetadata(input.metadata),
    reasons: [
      "retriever:entity_exact",
      `exact:${input.entityType}:${input.entityId}`,
    ],
    evidence: input.evidence ?? entityEvidence(
      input.entityType,
      input.entityId,
      input.sourceType,
    ),
  };
}

function withoutOperationalScopes(
  input: HybridMemorySearchInput,
  overrides: Partial<HybridMemorySearchInput>,
): HybridMemorySearchInput {
  return {
    ...input,
    workspaceId: null,
    procurementOrderId: null,
    procurementVendorId: null,
    supplierKey: null,
    itemId: null,
    itemKey: null,
    includeOperationalState: false,
    ...overrides,
  };
}

function resultMatchesFilters(result: HybridMemorySearchResult, input: HybridMemorySearchInput) {
  const sources = unique(input.sourceTypes ?? []).map(normalizeSourceType);
  if (sources.length && (!result.sourceType || !sources.includes(normalizeSourceType(result.sourceType)))) {
    return false;
  }
  const canonicalTypes = canonicalTypesForSearch(input.canonicalTypes ?? []);
  if (canonicalTypes.length && (!result.canonicalType || !canonicalTypes.includes(result.canonicalType))) {
    return false;
  }
  const from = input.dateRange?.from ? new Date(input.dateRange.from) : null;
  const to = input.dateRange?.to ? new Date(input.dateRange.to) : null;
  if (from && !Number.isNaN(from.getTime()) && result.occurredAt < from) return false;
  if (to && !Number.isNaN(to.getTime()) && result.occurredAt > to) return false;
  return result.officeId === input.officeId && result.evidence.length > 0;
}

function resultIdentity(result: HybridMemorySearchResult) {
  if (result.eventId) return `event:${result.eventId}`;
  if (result.objectId) return `object:${result.objectId}`;
  if (result.chunkId) return `chunk:${result.chunkId}`;
  return `${result.kind}:${result.entityType ?? ""}:${result.entityId ?? result.sourceExternalId ?? ""}`;
}

function annotateTraversalResults(
  results: HybridMemorySearchResult[],
  metadata: MemoryOperationalScope,
  reason: string,
) {
  return results.map((result) => ({
    ...result,
    ...memoryOperationalScopeMetadata(metadata),
    reasons: [...new Set([...result.reasons, "retriever:entity_exact", reason])],
  }));
}

function recoverEntityLexicalError(
  error: unknown,
  input: HybridMemorySearchInput,
): HybridMemorySearchResult[] {
  if (input.strictReadErrors === true) throw error;
  return [];
}

/**
 * Traverses only canonical, tenant-scoped relationships. EntityMention remains
 * an optional acceleration index; correctness does not depend on a backfill.
 * Workflow-owned rows are not queried here because this retriever has no
 * reverse dashboard_api ledger lookup. Exact app-owned reply tasks provide the
 * bounded order/vendor-to-routed-thread bridge when one has been persisted.
 */
export async function retrieveEntityMemory(
  input: HybridMemorySearchInput,
  limit: number,
  dependencies: EntityMemoryDependencies = defaultDependencies,
): Promise<HybridMemorySearchResult[]> {
  const boundedLimit = Math.max(1, Math.min(75, Math.floor(limit)));
  const perKindLimit = Math.max(5, Math.min(25, boundedLimit));
  const direct: HybridMemorySearchResult[] = [];
  const history: HybridMemorySearchResult[] = [];

  const requestedCompany = input.companyId
    ? await dependencies.findCompany({ officeId: input.officeId, companyId: input.companyId }).catch(() => null)
    : null;
  const workspace = input.workspaceId
    ? await dependencies.findWorkspace({
        officeId: input.officeId,
        workspaceId: input.workspaceId,
        companyId: requestedCompany?.id ?? input.companyId,
      }).catch(() => null)
    : null;
  const requestCompanyId = requestedCompany?.id ?? workspace?.companyId ?? null;

  const profile = workspace && input.supplierKey
    ? await dependencies.findSupplierProfile({
        officeId: input.officeId,
        workspaceId: workspace.id,
        supplierKey: input.supplierKey,
      }).catch(() => null)
    : null;
  const latestSnapshot = workspace && (input.itemId || input.itemKey)
    ? await dependencies.findLatestSnapshot({
        officeId: input.officeId,
        workspaceId: workspace.id,
      }).catch(() => null)
    : null;
  const itemIdentity = workspace && workspace.companyId && latestSnapshot && (input.itemId || input.itemKey)
    ? await dependencies.resolveItemIdentity({
        officeId: input.officeId,
        companyId: workspace.companyId,
        workspaceId: workspace.id,
        snapshotId: latestSnapshot.id,
        itemId: input.itemId,
        itemKey: input.itemKey,
      }).catch(() => null)
    : null;
  const supplyItem: SnapshotSupplyItemIdentityRow | null = itemIdentity?.supplyItem ?? null;
  const canonicalItem: CanonicalItemIdentityRow | null = itemIdentity?.canonicalItem ?? null;

  let supplierFacts: ProfileFactRow[] = [];
  let supplierPrices: PriceObservationRow[] = [];
  if (workspace && profile) {
    [supplierFacts, supplierPrices] = await Promise.all([
      dependencies.findProfileFacts({
        officeId: input.officeId,
        workspaceId: workspace.id,
        subjectType: "SUPPLIER",
        subjectRef: profile.supplierKey,
        limit: perKindLimit,
      }).catch(() => []),
      dependencies.findPriceObservations({
        officeId: input.officeId,
        workspaceId: workspace.id,
        supplierProfileId: profile.id,
        limit: perKindLimit,
      }).catch(() => []),
    ]);
  }

  let itemFacts: ProfileFactRow[] = [];
  let itemPrices: PriceObservationRow[] = [];
  if (workspace && supplyItem) {
    [itemFacts, itemPrices] = await Promise.all([
      dependencies.findProfileFacts({
        officeId: input.officeId,
        workspaceId: workspace.id,
        subjectType: "ITEM",
        subjectRef: supplyItem.itemKey,
        limit: perKindLimit,
      }).catch(() => []),
      dependencies.findPriceObservations({
        officeId: input.officeId,
        workspaceId: workspace.id,
        itemKey: supplyItem.itemKey,
        limit: perKindLimit,
      }).catch(() => []),
    ]);
  }

  const evidenceIds = unique([
    ...supplierFacts.map((fact) => fact.evidenceId),
    ...supplierPrices.map((observation) => observation.evidenceId),
    ...itemFacts.map((fact) => fact.evidenceId),
    ...itemPrices.map((observation) => observation.evidenceId),
  ]);
  const evidence = workspace && evidenceIds.length
    ? await dependencies.findEvidence({
        officeId: input.officeId,
        workspaceId: workspace.id,
        evidenceIds,
        limit: perKindLimit,
      }).catch(() => [])
    : [];

  let procurementTasks: ProcurementReplyTaskRow[] = [];
  let workflowAccount: WorkflowAccountRow | null = null;
  if (requestCompanyId && input.procurementOrderId) {
    workflowAccount = await dependencies.findWorkflowAccount({
      officeId: input.officeId,
      companyId: requestCompanyId,
    }).catch(() => null);
    if (workflowAccount) {
      procurementTasks = await dependencies.findProcurementReplyTasks({
        officeId: input.officeId,
        workspaceId: workspace?.id,
        customerId: workflowAccount.id,
        orderId: input.procurementOrderId,
        vendorId: input.procurementVendorId,
        limit: perKindLimit,
      }).catch(() => []);
      procurementTasks = procurementTasks.filter((task) => {
        const taskInput = record(task.input);
        return taskInput.customerId === workflowAccount?.id
          && taskInput.orderId === input.procurementOrderId
          && (!input.procurementVendorId || taskInput.vendorId === input.procurementVendorId)
          && (!workspace || task.workspaceId === workspace.id);
      });
    }
  }

  const metadata: MemoryOperationalScope = {
    workspaceId: workspace?.id ?? null,
    supplierKey: profile?.supplierKey ?? null,
    itemId: canonicalItem?.id ?? null,
    itemKey: supplyItem?.itemKey ?? null,
    procurementOrderId: workflowAccount && procurementTasks.length ? input.procurementOrderId ?? null : null,
    procurementVendorId: workflowAccount && procurementTasks.length ? input.procurementVendorId ?? null : null,
  };

  if (workspace) {
    direct.push(directResult({
      officeId: input.officeId,
      entityType: "supply_workspace",
      entityId: workspace.id,
      title: workspace.name,
      excerpt: `Workspace status ${workspace.status}.`,
      occurredAt: workspace.updatedAt,
      companyId: workspace.companyId,
      metadata,
    }));
  }
  if (profile) {
    direct.push(directResult({
      officeId: input.officeId,
      entityType: "supply_supplier_profile",
      entityId: profile.id,
      title: profile.companyName,
      excerpt: `Workspace supplier key ${profile.supplierKey}; status ${profile.status}.`,
      occurredAt: profile.lastSeenAt,
      companyId: workspace?.companyId,
      metadata,
    }));
  }
  if (supplyItem) {
    direct.push(directResult({
      officeId: input.officeId,
      entityType: "supply_item",
      entityId: supplyItem.id,
      title: supplyItem.name,
      excerpt: [
        `Item key ${supplyItem.itemKey}.`,
        supplyItem.sku ? `SKU ${supplyItem.sku}.` : "SKU unknown.",
        supplyItem.manufacturer ? `Manufacturer ${supplyItem.manufacturer}.` : "Manufacturer unknown.",
        supplyItem.mpn ? `MPN ${supplyItem.mpn}.` : "MPN unknown.",
      ].join(" "),
      occurredAt: resultDate(latestSnapshot?.publishedAt, supplyItem.createdAt),
      companyId: workspace?.companyId,
      metadata,
      evidence: [
        ...entityEvidence("supply_item", supplyItem.id),
        ...entityEvidence("supply_snapshot", supplyItem.snapshotId),
      ],
    }));
  }
  if (canonicalItem) {
    direct.push(directResult({
      officeId: input.officeId,
      entityType: "item",
      entityId: canonicalItem.id,
      title: canonicalItem.name,
      excerpt: [
        `SKU ${canonicalItem.sku}.`,
        canonicalItem.manufacturer ? `Manufacturer ${canonicalItem.manufacturer}.` : "Manufacturer unknown.",
        canonicalItem.partNumber ? `Part ${canonicalItem.partNumber}.` : "Part number unknown.",
      ].join(" "),
      occurredAt: canonicalItem.updatedAt,
      companyId: canonicalItem.companyId,
      metadata,
    }));
  }

  for (const fact of [...supplierFacts, ...itemFacts]) {
    const linkedEvidence = fact.evidenceId
      ? entityEvidence("supply_evidence", fact.evidenceId)
      : [];
    direct.push(directResult({
      officeId: input.officeId,
      entityType: "supply_profile_fact",
      entityId: fact.id,
      title: `${fact.subjectType.toLowerCase()} ${fact.factType.toLowerCase().replaceAll("_", " ")}`,
      excerpt: `${fact.sourceType}: ${compactMemoryText(JSON.stringify(fact.value), 700)}`,
      occurredAt: resultDate(fact.observedAt, fact.capturedAt),
      companyId: workspace?.companyId,
      metadata,
      evidence: [
        ...entityEvidence("supply_profile_fact", fact.id),
        ...linkedEvidence,
      ],
    }));
  }
  for (const observation of [...supplierPrices, ...itemPrices]) {
    const linkedEvidence = observation.evidenceId
      ? entityEvidence("supply_evidence", observation.evidenceId)
      : [];
    direct.push(directResult({
      officeId: input.officeId,
      entityType: "supply_price_observation",
      entityId: observation.id,
      title: `${observation.observationType.toLowerCase().replaceAll("_", " ")} for ${observation.itemKey}`,
      excerpt: `${String(observation.amount)} ${observation.currency} per ${observation.unitOfMeasure}.`,
      occurredAt: observation.observedAt,
      companyId: workspace?.companyId,
      metadata,
      evidence: [
        ...entityEvidence("supply_price_observation", observation.id),
        ...linkedEvidence,
      ],
    }));
  }
  for (const row of evidence) {
    direct.push(directResult({
      officeId: input.officeId,
      entityType: "supply_evidence",
      entityId: row.id,
      title: row.title,
      excerpt: row.excerpt ?? `${row.kind} evidence from ${row.sourceType}.`,
      occurredAt: resultDate(row.observedAt, row.capturedAt),
      companyId: workspace?.companyId,
      metadata,
      evidence: entityEvidence("supply_evidence", row.id),
    }));
  }
  for (const task of procurementTasks) {
    direct.push(directResult({
      officeId: input.officeId,
      entityType: "execution_task",
      entityId: task.id,
      title: "Procurement supplier reply task",
      excerpt: `${task.taskType} is ${task.status}.`,
      occurredAt: task.updatedAt,
      companyId: requestCompanyId,
      metadata,
    }));
  }

  const lexicalCalls: Array<Promise<HybridMemorySearchResult[]>> = [];
  if (exactEntityScopes(input).length) {
    lexicalCalls.push(dependencies.lexicalSearch({
      ...input,
      query: null,
      limit: boundedLimit,
      includeEvents: input.includeEvents ?? true,
      includeChunks: input.includeChunks ?? true,
      includeOperationalState: false,
    }).then((search) => annotateTraversalResults(
      search.results,
      metadata,
      "entity_link:indexed_exact",
    )).catch((error) => recoverEntityLexicalError(error, input)));
  }

  const provenCompanyIds = unique([
    requestedCompany?.id,
    workspace?.companyId,
    profile?.linkedCompanyId,
  ]);
  for (const companyId of provenCompanyIds) {
    const company = companyId === requestedCompany?.id
      ? requestedCompany
      : await dependencies.findCompany({ officeId: input.officeId, companyId }).catch(() => null);
    if (!company) continue;
    lexicalCalls.push(dependencies.lexicalSearch(withoutOperationalScopes(input, {
      companyId: company.id,
      jobId: null,
      inquiryId: null,
      entityType: null,
      entityId: null,
      query: null,
      limit: boundedLimit,
      includeEvents: input.includeEvents ?? true,
      includeChunks: input.includeChunks ?? true,
    })).then((search) => annotateTraversalResults(
      search.results,
      metadata,
      company.id === profile?.linkedCompanyId
        ? "entity_link:supplier_profile_company"
        : "entity_link:workspace_company",
    )).catch((error) => recoverEntityLexicalError(error, input)));
  }

  for (const task of procurementTasks) {
    const taskInput = record(task.input);
    const taskResult = record(task.result);
    const threadIds = unique([
      stringValue(taskInput.localThreadId),
      stringValue(taskResult.localThreadId),
    ]);
    const messageIds = unique([stringValue(taskInput.sourceMessageId)]);
    for (const threadId of threadIds) {
      lexicalCalls.push(dependencies.lexicalSearch(withoutOperationalScopes(input, {
        companyId: requestCompanyId,
        jobId: null,
        inquiryId: null,
        entityType: "email_thread",
        entityId: threadId,
        query: null,
        limit: perKindLimit,
        includeEvents: input.includeEvents ?? true,
        includeChunks: input.includeChunks ?? true,
      })).then((search) => annotateTraversalResults(
        search.results,
        metadata,
        `entity_link:procurement_reply_task:${task.id}`,
      )).catch((error) => recoverEntityLexicalError(error, input)));
    }
    for (const messageId of messageIds) {
      lexicalCalls.push(dependencies.lexicalSearch(withoutOperationalScopes(input, {
        companyId: requestCompanyId,
        jobId: null,
        inquiryId: null,
        entityType: "email_message",
        entityId: messageId,
        query: null,
        limit: perKindLimit,
        includeEvents: input.includeEvents ?? true,
        includeChunks: input.includeChunks ?? true,
      })).then((search) => annotateTraversalResults(
        search.results,
        metadata,
        `entity_link:procurement_reply_task:${task.id}`,
      )).catch((error) => recoverEntityLexicalError(error, input)));
    }
  }
  history.push(...(await Promise.all(lexicalCalls)).flat());

  const deduped = new Map<string, HybridMemorySearchResult>();
  for (const result of [...direct, ...history]
    .filter((entry) => resultMatchesFilters(entry, input))
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())) {
    const key = resultIdentity(result);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, result);
      continue;
    }
    existing.evidence = [...new Map([...existing.evidence, ...result.evidence].map((ref) => [
      `${ref.refType}:${ref.knowledgeObjectId ?? ""}:${ref.knowledgeChunkId ?? ""}:${ref.memoryEventId ?? ""}:${ref.entityType ?? ""}:${ref.entityId ?? ""}`,
      ref,
    ])).values()];
    existing.reasons = [...new Set([...existing.reasons, ...result.reasons])];
  }

  return [...deduped.values()].slice(0, boundedLimit);
}
