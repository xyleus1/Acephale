import { prisma } from "@/lib/prisma";
import {
  getProcurementWorkflowAccount,
  procurementCustomerIdFromServerMetadata,
} from "@/lib/procurement-workflow";
import { canonicalTypesForSearch, normalizeSourceType } from "../canonical-types";
import { compactMemoryText } from "../relevance";
import type { MemoryEvidenceRef } from "../evidence";
import {
  hashSupplyStateDependencies,
  hashSupplyStateValue,
} from "../../supply-os/state-runtime/canonicalize";
import { supplyStateRuntimeConfig } from "../../supply-os/state-runtime/config";
import {
  supplyStateScopeRef,
  type SupplyStateDependency,
  type SupplyStateScope,
} from "../../supply-os/state-runtime/types";
import {
  projectionTypeForSupplyStateScope,
  SUPPLY_STATE_COMPILER_VERSION,
  type SupplyStateProjectionRequest,
  type SupplyStateProjectionSnapshot,
} from "../../supply-os/state-runtime/projections/types";
import type { HybridMemorySearchInput, HybridMemorySearchResult } from "./types";
import { resolveSnapshotItemIdentity } from "../../supply-os/state-runtime/readers/item-identity";

export type OperationalProjectionRow = {
  id: string;
  officeId: string;
  workspaceId: string | null;
  scopeType: string;
  scopeRef: string;
  projectionType: string;
  compilerVersion: string;
  sourceFingerprint: string;
  payload: unknown;
  payloadHash: string;
  evidenceRefs: unknown;
  dependencyManifest: unknown;
  builtAt: Date;
  dirtyAt: Date | null;
};

type ProjectionRow = OperationalProjectionRow;

type ProjectionFreshnessChecker = (args: {
  officeId: string;
  expectedSourceFingerprint: string;
  dependencies: SupplyStateDependency[];
}) => Promise<{ fresh: boolean }>;

type ProjectionScopeCandidate = {
  projectionType: string;
  scopeType: string;
  scopeRef: string;
};

export type OperationalProjectionDependencies = {
  findWorkflowAccount(args: {
    officeId: string;
    companyId: string;
  }): Promise<{ id: string } | null>;
  getFreshProjection(
    request: SupplyStateProjectionRequest,
  ): Promise<SupplyStateProjectionSnapshot>;
};

const defaultProjectionDependencies: OperationalProjectionDependencies = {
  findWorkflowAccount: ({ officeId, companyId }) => getProcurementWorkflowAccount({
    officeId,
    customerId: procurementCustomerIdFromServerMetadata(officeId),
    companyId,
  }),
  getFreshProjection: async (request) => {
    // Keep the public memory module importable in non-React test and CLI
    // runtimes. The state-runtime store is server-only and is loaded only when
    // an operational projection is actually requested.
    const { getFreshStateProjection } = await import(
      "../../supply-os/state-runtime/projections/store"
    );
    return getFreshStateProjection(request);
  },
};

function nonEmpty(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function projectionScopes(input: HybridMemorySearchInput): SupplyStateScope[] {
  const scopes: SupplyStateScope[] = [];
  if (input.companyId) {
    scopes.push({
      type: "company",
      officeId: input.officeId,
      companyId: input.companyId,
      workspaceId: input.workspaceId,
    });
  }
  const hasWorkspaceSupplier = Boolean(input.workspaceId && input.supplierKey);
  const hasRequestVendor = Boolean(input.procurementOrderId && input.procurementVendorId);
  if (hasWorkspaceSupplier || hasRequestVendor) {
    scopes.push({
      type: "supplier",
      officeId: input.officeId,
      companyId: input.companyId,
      workspaceId: input.workspaceId,
      supplierKey: hasWorkspaceSupplier ? input.supplierKey : null,
      orderId: hasRequestVendor ? input.procurementOrderId : null,
      vendorId: hasRequestVendor ? input.procurementVendorId : null,
    });
  }
  if (input.companyId && input.workspaceId && (input.itemId || input.itemKey)) {
    scopes.push({
      type: "item",
      officeId: input.officeId,
      companyId: input.companyId,
      workspaceId: input.workspaceId,
      itemId: input.itemId,
      itemKey: input.itemKey,
    });
  }
  if (input.workspaceId) {
    scopes.push({
      type: "workspace",
      officeId: input.officeId,
      workspaceId: input.workspaceId,
    });
  }
  return scopes;
}

export function projectionScopeCandidates(input: HybridMemorySearchInput): ProjectionScopeCandidate[] {
  return projectionScopes(input).map((scope) => ({
    projectionType: projectionTypeForSupplyStateScope(scope),
    scopeType: scope.type,
    scopeRef: supplyStateScopeRef(scope),
  }));
}

async function resolvedProjectionScopes(
  input: HybridMemorySearchInput,
  dependencies: Pick<OperationalProjectionDependencies, "findWorkflowAccount">,
) {
  const scopes = projectionScopes(input);
  if (!input.procurementOrderId || !input.companyId) return scopes;
  const workflowAccount = await dependencies.findWorkflowAccount({
    officeId: input.officeId,
    companyId: input.companyId,
  }).catch(() => null);
  if (!workflowAccount) return scopes;
  scopes.push({
    type: "procurement_request",
    officeId: input.officeId,
    companyId: input.companyId,
    customerId: workflowAccount.id,
    orderId: input.procurementOrderId,
    workspaceId: input.workspaceId,
  });
  return scopes;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function projectionEvidence(
  value: unknown,
  projectionId: string | null,
  dependencies: SupplyStateDependency[],
): MemoryEvidenceRef[] {
  const refs: MemoryEvidenceRef[] = [];
  for (const item of Array.isArray(value) ? value.slice(0, 24) : []) {
    const ref = asObject(item);
    const kind = typeof ref?.kind === "string" ? ref.kind : null;
    const id = typeof ref?.id === "string" ? ref.id : null;
    if (!kind || !id) continue;
    if (kind === "knowledge_object") {
      refs.push({ refType: "knowledge_object", knowledgeObjectId: id, sourceType: "COMPANY_BRAIN" });
    } else if (kind === "knowledge_chunk") {
      refs.push({ refType: "knowledge_chunk", knowledgeChunkId: id, sourceType: "COMPANY_BRAIN" });
    } else if (kind === "memory_event") {
      refs.push({ refType: "memory_event", memoryEventId: id, sourceType: "COMPANY_BRAIN" });
    } else {
      const sourceType = kind === "procurement_order" || kind === "procurement_vendor"
        ? "WORKFLOW_DB"
        : kind === "procurement_message" || kind === "email_message"
          ? "EMAIL_LEDGER"
          : "APP_DB";
      refs.push({ refType: "entity", entityType: kind, entityId: id, sourceType });
    }
  }
  for (const dependency of dependencies.slice(0, 24)) {
    if (dependency.entityType.trim() && dependency.entityRef.trim()) {
      refs.push({
        refType: "entity",
        entityType: dependency.entityType,
        entityId: dependency.entityRef,
        sourceType: dependency.source,
      });
    }
  }
  const canonicalRefs = [...new Map(refs.map((ref) => [
    `${ref.refType}:${ref.knowledgeObjectId ?? ""}:${ref.knowledgeChunkId ?? ""}:${ref.memoryEventId ?? ""}:${ref.entityType ?? ""}:${ref.entityId ?? ""}`,
    ref,
  ])).values()];
  if (!canonicalRefs.length) return [];
  if (projectionId) {
    canonicalRefs.unshift({
      refType: "entity",
      entityType: "supply_state_projection",
      entityId: projectionId,
      sourceType: "APP_DB",
    });
  }
  return canonicalRefs;
}

function projectionIntegrityValid(row: ProjectionRow) {
  if (!Array.isArray(row.dependencyManifest)) return false;
  try {
    return hashSupplyStateValue(row.payload) === row.payloadHash &&
      hashSupplyStateDependencies(row.dependencyManifest as SupplyStateDependency[]) === row.sourceFingerprint;
  } catch {
    return false;
  }
}

export async function isOperationalProjectionCurrent(
  row: OperationalProjectionRow,
  officeId: string,
  checkFreshness?: ProjectionFreshnessChecker,
) {
  if (row.officeId !== officeId || row.dirtyAt !== null
    || row.compilerVersion !== SUPPLY_STATE_COMPILER_VERSION
    || !projectionIntegrityValid(row)) return false;
  try {
    const checker = checkFreshness ?? (await import(
      "../../supply-os/state-runtime/projections/freshness"
    )).checkSupplyStateProjectionFreshness;
    return (await checker({
      officeId,
      expectedSourceFingerprint: row.sourceFingerprint,
      dependencies: row.dependencyManifest as SupplyStateDependency[],
    })).fresh;
  } catch {
    return false;
  }
}

function entityEvidence(entityType: string, entityId: string, sourceType = "APP_DB"): MemoryEvidenceRef[] {
  return [{ refType: "entity", entityType, entityId, sourceType }];
}

function operationalResult(input: {
  officeId: string;
  entityType: string;
  entityId: string;
  title: string;
  excerpt: string;
  occurredAt: Date;
  evidence?: MemoryEvidenceRef[];
  companyId?: string | null;
  workspaceId?: string | null;
  procurementOrderId?: string | null;
  procurementVendorId?: string | null;
  supplierKey?: string | null;
  itemId?: string | null;
  itemKey?: string | null;
  sourceType?: string;
  canonicalType?: string | null;
}): HybridMemorySearchResult {
  const sourceType = input.sourceType ?? "APP_DB";
  return {
    officeId: input.officeId,
    kind: "operational",
    objectId: null,
    chunkId: null,
    eventId: null,
    sourceType,
    sourceExternalId: `${input.entityType}:${input.entityId}`,
    canonicalType: input.canonicalType ?? null,
    title: input.title,
    excerpt: compactMemoryText(input.excerpt, 900),
    score: input.occurredAt.getTime(),
    occurredAt: input.occurredAt,
    entityType: input.entityType,
    entityId: input.entityId,
    companyId: input.companyId ?? null,
    jobId: null,
    inquiryId: null,
    workspaceId: input.workspaceId ?? null,
    procurementOrderId: input.procurementOrderId ?? null,
    procurementVendorId: input.procurementVendorId ?? null,
    supplierKey: input.supplierKey ?? null,
    itemId: input.itemId ?? null,
    itemKey: input.itemKey ?? null,
    reasons: ["retriever:operational_state", `exact:${input.entityType}:${input.entityId}`],
    evidence: input.evidence ?? entityEvidence(input.entityType, input.entityId, sourceType),
  };
}

function projectionScopeMetadata(scope: SupplyStateScope) {
  return {
    companyId: "companyId" in scope ? scope.companyId ?? null : null,
    workspaceId: "workspaceId" in scope ? scope.workspaceId ?? null : null,
    procurementOrderId: scope.type === "procurement_request"
      ? scope.orderId
      : scope.type === "supplier"
        ? scope.orderId ?? null
        : null,
    procurementVendorId: scope.type === "supplier" ? scope.vendorId ?? null : null,
    supplierKey: scope.type === "supplier" ? scope.supplierKey ?? null : null,
    itemId: scope.type === "item" ? scope.itemId ?? null : null,
    itemKey: scope.type === "item" ? scope.itemKey ?? null : null,
  };
}

function projectionCanonicalType(scope: SupplyStateScope) {
  if (scope.type === "company") return "company";
  if (scope.type === "procurement_request") return "rfq";
  return null;
}

function projectionResult(snapshot: SupplyStateProjectionSnapshot): HybridMemorySearchResult | null {
  const builtAt = asDate(snapshot.builtAt);
  if (!builtAt || snapshot.scope.officeId.trim() === "") return null;
  const isStored = Boolean(snapshot.id);
  const entityType = isStored ? "supply_state_projection" : `supply_state_${snapshot.scope.type}`;
  const entityId = snapshot.id ?? supplyStateScopeRef(snapshot.scope);
  const evidence = projectionEvidence(
    snapshot.evidenceRefs,
    snapshot.id,
    snapshot.dependencies,
  );
  if (!evidence.length) return null;
  const projectionState = snapshot.projectionHit
    ? "projection:cache_hit"
    : isStored
      ? "projection:rebuilt_and_stored"
      : "projection:live_canonical_fallback";
  return {
    officeId: snapshot.scope.officeId,
    kind: isStored ? "projection" : "operational",
    objectId: null,
    chunkId: null,
    eventId: null,
    sourceType: "APP_DB",
    sourceExternalId: `${entityType}:${entityId}`,
    canonicalType: projectionCanonicalType(snapshot.scope),
    title: `${snapshot.projectionType} current state`,
    excerpt: compactMemoryText(JSON.stringify(snapshot.payload), 900),
    score: builtAt.getTime(),
    occurredAt: builtAt,
    entityType,
    entityId,
    ...projectionScopeMetadata(snapshot.scope),
    jobId: null,
    inquiryId: null,
    reasons: [
      "retriever:operational_state",
      projectionState,
      `compiler_version:${snapshot.compilerVersion}`,
      `source_fingerprint:${snapshot.sourceFingerprint}`,
      `payload_hash:${snapshot.payloadHash}`,
    ],
    evidence,
  };
}

export function filterOperationalStateResultsForInput(
  results: HybridMemorySearchResult[],
  input: HybridMemorySearchInput,
) {
  const requestedCanonicalTypes = canonicalTypesForSearch(input.canonicalTypes ?? []);
  const from = asDate(input.dateRange?.from);
  const to = asDate(input.dateRange?.to);
  return results.filter((result) =>
    (!requestedCanonicalTypes.length || Boolean(result.canonicalType &&
      requestedCanonicalTypes.includes(result.canonicalType))) &&
    (!from || result.occurredAt >= from) &&
    (!to || result.occurredAt <= to) &&
    result.evidence.length > 0);
}

/**
 * Resolves projections through the state-runtime API. Missing, dirty, corrupt,
 * or semantically stale cache rows therefore compile from canonical readers
 * and remain usable even when the derived cache cannot be written. Projection
 * compilation does not call memory retrieval, so this path cannot feed a
 * projection back into its own build.
 */
export async function retrieveOperationalStateProjections(
  input: HybridMemorySearchInput,
  workspaceAllowed: boolean,
  dependencies: OperationalProjectionDependencies = defaultProjectionDependencies,
): Promise<HybridMemorySearchResult[]> {
  if (!workspaceAllowed) return [];
  const scopes = await resolvedProjectionScopes(input, dependencies);
  const snapshots = await Promise.all(scopes.map((scope) => dependencies.getFreshProjection({
    scope,
    compilerVersion: SUPPLY_STATE_COMPILER_VERSION,
  }).catch(() => null)));
  return snapshots
    .map((snapshot) => snapshot ? projectionResult(snapshot) : null)
    .filter((result): result is HybridMemorySearchResult => Boolean(result));
}

export async function retrieveOperationalState(
  input: HybridMemorySearchInput,
  limit: number,
): Promise<HybridMemorySearchResult[]> {
  if (!supplyStateRuntimeConfig().enabled) return [];
  const requestedSourceTypes = nonEmpty(input.sourceTypes ?? []).map(normalizeSourceType);
  if (requestedSourceTypes.length && !requestedSourceTypes.includes("APP_DB")) return [];
  const workspace = input.workspaceId
    ? await prisma.supplyWorkspace.findFirst({
        where: {
          id: input.workspaceId,
          officeId: input.officeId,
          ...(input.companyId ? { companyId: input.companyId } : {}),
        },
        select: { id: true, companyId: true, name: true, status: true, version: true, updatedAt: true },
      }).catch(() => null)
    : null;
  const workspaceAllowed = !input.workspaceId || Boolean(workspace);
  if (!workspaceAllowed) return [];

  const latestItemSnapshot = workspace && (input.itemId || input.itemKey)
    ? await prisma.supplySnapshot.findFirst({
        where: { officeId: input.officeId, workspaceId: workspace.id, status: "PUBLISHED" },
        orderBy: [{ version: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
        select: { id: true, sourceHash: true, publishedAt: true },
      }).catch(() => null)
    : null;
  const itemIdentity = workspace?.companyId && latestItemSnapshot && (input.itemId || input.itemKey)
    ? await resolveSnapshotItemIdentity({
        officeId: input.officeId,
        companyId: workspace.companyId,
        workspaceId: workspace.id,
        snapshotId: latestItemSnapshot.id,
        itemId: input.itemId,
        itemKey: input.itemKey,
      }).catch(() => null)
    : null;
  const standaloneCanonicalItem = input.itemId && !workspace
    ? await prisma.item.findFirst({
        where: {
          id: input.itemId,
          officeId: input.officeId,
          ...(input.companyId ? { companyId: input.companyId } : {}),
        },
        select: {
          id: true,
          companyId: true,
          name: true,
          sku: true,
          specification: true,
          manufacturer: true,
          partNumber: true,
          unit: true,
          updatedAt: true,
        },
      }).catch(() => null)
    : null;
  const canonicalItem = itemIdentity?.canonicalItem ?? standaloneCanonicalItem;
  const supplyItem = itemIdentity?.supplyItem ?? null;

  const reads: Array<Promise<HybridMemorySearchResult[]>> = [];
  if (workspace) {
    reads.push(Promise.resolve([operationalResult({
      officeId: input.officeId,
      entityType: "supply_workspace",
      entityId: workspace.id,
      title: workspace.name,
      excerpt: `Workspace status ${workspace.status}; version ${workspace.version}.`,
      occurredAt: workspace.updatedAt,
      companyId: workspace.companyId,
      workspaceId: workspace.id,
    })]));
  }
  if (input.companyId) {
    reads.push(prisma.company.findFirst({
      where: { id: input.companyId, officeId: input.officeId },
      select: { id: true, name: true, status: true, lane: true, updatedAt: true },
    }).then((company) => company ? [operationalResult({
      officeId: input.officeId,
      entityType: "company",
      entityId: company.id,
      title: company.name,
      excerpt: [
        `Company status ${company.status}.`,
        company.lane ? `Primary lane ${company.lane}.` : "Primary lane unknown.",
      ].join(" "),
      occurredAt: company.updatedAt,
      companyId: company.id,
      canonicalType: "company",
    })] : []).catch(() => []));
  }

  // Procurement request and vendor rows are not read through the app Prisma
  // client. Their current state enters retrieval only through a state projection
  // compiled by the workflow reader, which enforces the dashboard_api boundary.

  if (canonicalItem) {
    reads.push(Promise.resolve([operationalResult({
      officeId: input.officeId,
      entityType: "item",
      entityId: canonicalItem.id,
      title: canonicalItem.name,
      excerpt: [
        canonicalItem.sku ? `SKU ${canonicalItem.sku}.` : "SKU unknown.",
        canonicalItem.manufacturer ? `Manufacturer ${canonicalItem.manufacturer}.` : "Manufacturer unknown.",
        canonicalItem.partNumber ? `Part ${canonicalItem.partNumber}.` : "Part number unknown.",
        canonicalItem.unit ? `Unit ${canonicalItem.unit}.` : "Unit unknown.",
      ].join(" "),
      occurredAt: canonicalItem.updatedAt,
      companyId: canonicalItem.companyId,
      workspaceId: workspace?.id,
      itemId: canonicalItem.id,
      itemKey: supplyItem?.itemKey,
    })]));
  }

  if (supplyItem && workspace && latestItemSnapshot) {
    reads.push(Promise.resolve([operationalResult({
          officeId: input.officeId,
          entityType: "supply_item",
          entityId: supplyItem.id,
          title: supplyItem.name,
          excerpt: [
            `Item key ${supplyItem.itemKey}.`,
            supplyItem.sku ? `SKU ${supplyItem.sku}.` : "SKU unknown.",
            supplyItem.manufacturer ? `Manufacturer ${supplyItem.manufacturer}.` : "Manufacturer unknown.",
            supplyItem.mpn ? `MPN ${supplyItem.mpn}.` : "MPN unknown.",
            `Unit ${supplyItem.unitOfMeasure}.`,
          ].join(" "),
          occurredAt: latestItemSnapshot.publishedAt ?? supplyItem.createdAt,
          companyId: workspace.companyId,
          workspaceId: supplyItem.workspaceId,
          itemId: canonicalItem?.id ?? null,
          itemKey: supplyItem.itemKey,
          evidence: [
            ...entityEvidence("supply_item", supplyItem.id),
            ...entityEvidence("supply_snapshot", latestItemSnapshot.id),
          ],
        })]));
  }

  // A workspace supplier key is not proof that a workflow vendor is the same
  // supplier. Combined request/vendor scopes rely on the compiled projection,
  // whose supplier reader validates each exact relationship category.
  if (input.supplierKey && input.workspaceId && !input.procurementOrderId && !input.procurementVendorId) {
    reads.push(prisma.supplySupplierProfile.findMany({
      where: {
        officeId: input.officeId,
        supplierKey: input.supplierKey,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.companyId
          ? { OR: [{ linkedCompanyId: input.companyId }, { workspace: { companyId: input.companyId } }] }
          : {}),
      },
      orderBy: { lastSeenAt: "desc" },
      take: 10,
      select: {
        id: true,
        workspaceId: true,
        linkedCompanyId: true,
        supplierKey: true,
        companyName: true,
        website: true,
        roles: true,
        status: true,
        lastSeenAt: true,
        workspace: { select: { companyId: true } },
      },
    }).then((profiles) => profiles.map((profile) => operationalResult({
      officeId: input.officeId,
      entityType: "supply_supplier_profile",
      entityId: profile.id,
      title: profile.companyName,
      excerpt: [
        `Workspace supplier key ${profile.supplierKey}.`,
        `Status ${profile.status}.`,
        profile.website ? `Website ${profile.website}.` : "Website unknown.",
        profile.roles ? `Roles ${compactMemoryText(JSON.stringify(profile.roles), 240)}.` : "Roles unknown.",
      ].join(" "),
      occurredAt: profile.lastSeenAt,
      companyId: profile.linkedCompanyId ?? profile.workspace.companyId,
      workspaceId: profile.workspaceId,
      supplierKey: profile.supplierKey,
    }))).catch(() => []));
  }

  reads.push(retrieveOperationalStateProjections(input, workspaceAllowed).catch(() => []));
  const results = filterOperationalStateResultsForInput((await Promise.all(reads)).flat(), input);
  return results
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
    .slice(0, Math.max(1, limit));
}
