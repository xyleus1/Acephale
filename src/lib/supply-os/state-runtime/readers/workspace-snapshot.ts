import "server-only";

import { prisma } from "@/lib/prisma";
import type { SupplyStateScope, SupplyWorldEvidenceRef } from "@/lib/supply-os/state-runtime/types";
import {
  boundSupplyStateValue,
  decimalString,
  emptySupplyStateReaderResult,
  makeSupplyStateDependency,
  safeIso,
  SUPPLY_STATE_MAX_COLLECTION,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "./types";
import {
  currentSnapshotFactValue,
  equivalenceRuleListValue,
  snapshotSourceHash,
  workspaceIdentityValue,
  workspacePresentationValue,
} from "./selectors";

const MAX_WORKSPACE_ROWS = 80;
const MAX_BOM_VERSIONS = 12;
const MAX_BOM_LINES = 40;
const MAX_EQUIVALENCE_RULES = 40;

type WorkspaceSnapshotReaderDependencies = {
  findWorkspace: typeof prisma.supplyWorkspace.findFirst;
  findSnapshot: typeof prisma.supplySnapshot.findFirst;
  findEquivalenceRules: typeof prisma.supplyEquivalenceRule.findMany;
};

const defaultDependencies: WorkspaceSnapshotReaderDependencies = {
  findWorkspace: (args) => prisma.supplyWorkspace.findFirst(args),
  findSnapshot: (args) => prisma.supplySnapshot.findFirst(args),
  findEquivalenceRules: (args) => prisma.supplyEquivalenceRule.findMany(args),
};

export function workspaceIdForStateScope(scope: SupplyStateScope) {
  if (scope.type === "workspace" || scope.type === "item") return scope.workspaceId;
  return "workspaceId" in scope ? scope.workspaceId ?? null : null;
}

export async function readWorkspaceSnapshotState(
  input: SupplyStateReaderInput,
  dependencies: WorkspaceSnapshotReaderDependencies = defaultDependencies,
): Promise<SupplyStateReaderResult> {
  const result = emptySupplyStateReaderResult();
  const workspaceId = workspaceIdForStateScope(input.scope);
  if (!workspaceId) return result;
  const expectedCompanyId = input.scope.type === "company"
    || input.scope.type === "procurement_request"
    || input.scope.type === "item"
    ? input.scope.companyId
    : input.scope.type === "supplier" ? input.scope.companyId ?? undefined : undefined;
  const workspace = await dependencies.findWorkspace({
    where: {
      id: workspaceId,
      officeId: input.scope.officeId,
      status: "ACTIVE",
      ...(expectedCompanyId ? { companyId: expectedCompanyId } : {}),
    },
    select: {
      id: true,
      companyId: true,
      externalKey: true,
      name: true,
      status: true,
      version: true,
      archivedAt: true,
      updatedAt: true,
    },
  });
  if (!workspace) {
    result.currentState.workspaceSupply = null;
    result.uncertainties.push({ kind: "supply_workspace_missing", workspaceId });
    result.dependencies.push(makeSupplyStateDependency({
      key: `workspace.identity:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspaceId,
      value: null,
      policy: "STRICT",
      reason: "The requested supply workspace is missing or inactive.",
    }));
    return result;
  }
  result.dependencies.push(
    makeSupplyStateDependency({
      key: `workspace.identity:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspaceId,
      value: workspaceIdentityValue(workspace),
      policy: "STRICT",
      reason: "Supply workspace ownership or lifecycle changed.",
    }),
    makeSupplyStateDependency({
      key: `workspace.presentation:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspaceId,
      value: workspacePresentationValue(workspace),
      policy: "ADVISORY",
      reason: "Supply workspace presentation changed.",
    }),
  );
  const [snapshot, equivalenceRows] = await Promise.all([dependencies.findSnapshot({
    where: { officeId: input.scope.officeId, workspaceId, status: "PUBLISHED" },
    orderBy: [{ version: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      version: true,
      schemaVersion: true,
      sourceHash: true,
      publishedAt: true,
      metadata: true,
      _count: {
        select: {
          locations: true,
          items: true,
          bomLines: true,
          inventory: true,
          demands: true,
          supplierTerms: true,
          fccProfiles: true,
        },
      },
      locations: {
        orderBy: [{ locationKey: "asc" }],
        take: MAX_WORKSPACE_ROWS,
        select: {
          id: true,
          locationKey: true,
          name: true,
          kind: true,
          countryCode: true,
          city: true,
        },
      },
      items: {
        orderBy: [{ itemKey: "asc" }],
        take: MAX_WORKSPACE_ROWS,
        select: {
          id: true,
          itemKey: true,
          externalId: true,
          sku: true,
          manufacturer: true,
          mpn: true,
          name: true,
          category: true,
          itemType: true,
          unitOfMeasure: true,
        },
      },
      bomVersions: {
        where: { status: "ACTIVE" },
        orderBy: [{ effectiveAt: "desc" }, { revision: "desc" }],
        take: MAX_BOM_VERSIONS,
        select: {
          id: true,
          productItemId: true,
          revision: true,
          status: true,
          effectiveAt: true,
          lines: {
            orderBy: [{ lineNumber: "asc" }],
            take: MAX_BOM_LINES,
            select: {
              id: true,
              parentItemId: true,
              componentItemId: true,
              lineNumber: true,
              quantity: true,
              unitOfMeasure: true,
              scrapRate: true,
              isOptional: true,
              alternativeGroup: true,
            },
          },
        },
      },
      inventory: {
        orderBy: [{ asOf: "desc" }, { positionKey: "asc" }],
        take: MAX_WORKSPACE_ROWS,
        select: {
          id: true,
          positionKey: true,
          itemId: true,
          locationId: true,
          lotNumber: true,
          unitOfMeasure: true,
          quantityOnHand: true,
          quantityAllocated: true,
          quantityInTransit: true,
          quantityOnOrder: true,
          expectedReceiptAt: true,
          asOf: true,
        },
      },
      demands: {
        orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { demandKey: "asc" }],
        take: MAX_WORKSPACE_ROWS,
        select: {
          id: true,
          demandKey: true,
          itemId: true,
          locationId: true,
          sourceType: true,
          externalId: true,
          quantity: true,
          unitOfMeasure: true,
          dueAt: true,
          status: true,
          priority: true,
        },
      },
      supplierTerms: {
        orderBy: [{ isCurrent: "desc" }, { termKey: "asc" }],
        take: MAX_WORKSPACE_ROWS,
        select: {
          id: true,
          termKey: true,
          itemId: true,
          facilityId: true,
          supplierKey: true,
          supplierName: true,
          isCurrent: true,
          unitOfMeasure: true,
          currency: true,
          unitPrice: true,
          modeledFreightPerUnit: true,
          evidencedDutyPerUnit: true,
          leadTimeMinDays: true,
          leadTimeMaxDays: true,
          availableQuantity: true,
          availableAt: true,
        },
      },
      fccProfiles: {
        orderBy: [{ itemId: "asc" }],
        take: MAX_WORKSPACE_ROWS,
        select: {
          id: true,
          itemId: true,
          moduleAuthorization: true,
          hostIntegrationConstraints: true,
          labeling: true,
          rfExposure: true,
          testing: true,
          testingGaps: true,
          reviewRequirements: true,
          blockedReasons: true,
        },
      },
    },
  }), dependencies.findEquivalenceRules({
    where: { officeId: input.scope.officeId, workspaceId },
    orderBy: [{ ruleKey: "asc" }, { version: "desc" }],
    take: MAX_EQUIVALENCE_RULES * 2,
    select: {
      id: true,
      ruleKey: true,
      version: true,
      fromItemKey: true,
      toItemKey: true,
      action: true,
      status: true,
      constraints: true,
      ruleHash: true,
      approvedAt: true,
    },
  })]);
  const latestRules = new Map<string, (typeof equivalenceRows)[number]>();
  for (const rule of equivalenceRows) {
    if (latestRules.size >= MAX_EQUIVALENCE_RULES) break;
    if (!latestRules.has(rule.ruleKey)) latestRules.set(rule.ruleKey, rule);
  }
  const equivalenceHead = equivalenceRuleListValue([...latestRules.values()]);
  result.dependencies.push(makeSupplyStateDependency({
    key: `workspace.equivalence_rules:${workspaceId}`,
    source: "APP_DB",
    entityType: "SupplyEquivalenceRuleList",
    entityRef: workspaceId,
    value: equivalenceHead,
    policy: "ADVISORY",
    reason: "The bounded workspace equivalence-rule list changed.",
  }));
  if (!snapshot) {
    result.currentState.workspaceSupply = {
      workspace,
      currentSnapshot: null,
    };
    result.uncertainties.push({ kind: "published_supply_snapshot_missing", workspaceId });
    result.dependencies.push(makeSupplyStateDependency({
      key: `workspace.current_snapshot:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplySnapshot",
      entityRef: workspaceId,
      value: null,
      policy: "STRICT",
      reason: "The workspace has no current published supply snapshot.",
    }));
    return result;
  }

  const itemKeyById = new Map(snapshot.items.map((item) => [item.id, item.itemKey]));
  const locationKeyById = new Map(snapshot.locations.map((location) => [location.id, location.locationKey]));
  const sourceHash = snapshotSourceHash(snapshot);
  const snapshotEvidence: SupplyWorldEvidenceRef = {
    kind: "supply_snapshot",
    id: snapshot.id,
    sourceHash,
  };
  const snapshotHeader = {
    id: snapshot.id,
    version: snapshot.version,
    schemaVersion: snapshot.schemaVersion,
    sourceHash,
    publishedAt: safeIso(snapshot.publishedAt),
    counts: snapshot._count,
  };
  const state = {
    workspace,
    currentSnapshot: snapshotHeader,
    locations: snapshot.locations,
    items: snapshot.items,
    bom: snapshot.bomVersions.map((version) => ({
      id: version.id,
      productItemKey: itemKeyById.get(version.productItemId) ?? null,
      revision: version.revision,
      status: version.status,
      effectiveAt: safeIso(version.effectiveAt),
      lines: version.lines.map((line) => ({
        id: line.id,
        parentItemKey: itemKeyById.get(line.parentItemId) ?? null,
        componentItemKey: itemKeyById.get(line.componentItemId) ?? null,
        lineNumber: line.lineNumber,
        quantity: decimalString(line.quantity),
        unitOfMeasure: line.unitOfMeasure,
        scrapRate: decimalString(line.scrapRate),
        isOptional: line.isOptional,
        alternativeGroup: line.alternativeGroup,
      })),
    })),
    inventory: snapshot.inventory.map((position) => ({
      id: position.id,
      positionKey: position.positionKey,
      itemKey: itemKeyById.get(position.itemId) ?? null,
      locationKey: locationKeyById.get(position.locationId) ?? null,
      lotNumber: position.lotNumber,
      unitOfMeasure: position.unitOfMeasure,
      quantityOnHand: decimalString(position.quantityOnHand),
      quantityAllocated: decimalString(position.quantityAllocated),
      quantityInTransit: decimalString(position.quantityInTransit),
      quantityOnOrder: decimalString(position.quantityOnOrder),
      expectedReceiptAt: safeIso(position.expectedReceiptAt),
      asOf: safeIso(position.asOf),
    })),
    demands: snapshot.demands.map((demand) => ({
      id: demand.id,
      demandKey: demand.demandKey,
      itemKey: itemKeyById.get(demand.itemId) ?? null,
      locationKey: demand.locationId ? locationKeyById.get(demand.locationId) ?? null : null,
      sourceType: demand.sourceType,
      externalId: demand.externalId,
      quantity: decimalString(demand.quantity),
      unitOfMeasure: demand.unitOfMeasure,
      dueAt: safeIso(demand.dueAt),
      status: demand.status,
      priority: demand.priority,
    })),
    supplierTerms: snapshot.supplierTerms.map((term) => ({
      id: term.id,
      termKey: term.termKey,
      itemKey: itemKeyById.get(term.itemId) ?? null,
      facilityKey: term.facilityId ? locationKeyById.get(term.facilityId) ?? null : null,
      supplierKey: term.supplierKey,
      supplierName: term.supplierName,
      isCurrent: term.isCurrent,
      unitOfMeasure: term.unitOfMeasure,
      currency: term.currency,
      unitPrice: decimalString(term.unitPrice),
      modeledFreightPerUnit: decimalString(term.modeledFreightPerUnit),
      evidencedDutyPerUnit: decimalString(term.evidencedDutyPerUnit),
      leadTimeMinDays: term.leadTimeMinDays,
      leadTimeMaxDays: term.leadTimeMaxDays,
      availableQuantity: decimalString(term.availableQuantity),
      availableAt: safeIso(term.availableAt),
    })),
    equivalenceRules: [...latestRules.values()].map((rule) => ({
      ...rule,
      approvedAt: safeIso(rule.approvedAt),
    })),
    fccProfiles: snapshot.fccProfiles,
  };
  result.currentState.workspaceSupply = boundSupplyStateValue(state, {
    maxArray: SUPPLY_STATE_MAX_COLLECTION,
    maxString: 3_000,
  });
  result.evidenceRefs.push(snapshotEvidence);
  result.dependencies.push(
    makeSupplyStateDependency({
      key: `workspace.current_snapshot:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplySnapshot",
      entityRef: workspaceId,
      value: currentSnapshotFactValue(snapshot),
      version: snapshot.id,
      policy: "STRICT",
      reason: "The current published snapshot changed.",
      evidenceRefs: [snapshotEvidence],
    }),
    makeSupplyStateDependency({
      key: `workspace.snapshot_hash:${snapshot.id}`,
      source: "APP_DB",
      entityType: "SupplySnapshot",
      entityRef: snapshot.id,
      value: { sourceHash, schemaVersion: snapshot.schemaVersion },
      version: sourceHash,
      policy: "STRICT",
      reason: "The immutable published snapshot hash no longer matches.",
      evidenceRefs: [snapshotEvidence],
    }),
  );
  for (const rule of latestRules.values()) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `workspace.equivalence_rule:${workspaceId}:${encodeURIComponent(rule.ruleKey)}`,
      source: "APP_DB",
      entityType: "SupplyEquivalenceRule",
      entityRef: rule.id,
      value: { ruleHash: rule.ruleHash, status: rule.status },
      version: rule.ruleHash,
      policy: "ADVISORY",
      reason: "An item equivalence rule changed.",
      evidenceRefs: [],
    }));
  }
  const boundedCollections = [
    { name: "locations", included: snapshot.locations.length, total: snapshot._count.locations },
    { name: "items", included: snapshot.items.length, total: snapshot._count.items },
    {
      name: "bomLines",
      included: snapshot.bomVersions.reduce((count, version) => count + version.lines.length, 0),
      total: snapshot._count.bomLines,
    },
    { name: "inventory", included: snapshot.inventory.length, total: snapshot._count.inventory },
    { name: "demands", included: snapshot.demands.length, total: snapshot._count.demands },
    { name: "supplierTerms", included: snapshot.supplierTerms.length, total: snapshot._count.supplierTerms },
    { name: "fccProfiles", included: snapshot.fccProfiles.length, total: snapshot._count.fccProfiles },
  ].filter((collection) => collection.total > collection.included);
  if (boundedCollections.length || equivalenceRows.length === MAX_EQUIVALENCE_RULES * 2) {
    result.uncertainties.push({
      kind: "workspace_snapshot_collections_bounded",
      collections: boundedCollections,
      equivalenceRulesMayBeBounded: equivalenceRows.length === MAX_EQUIVALENCE_RULES * 2,
    });
  }
  const nullInventoryFacts = snapshot.inventory.reduce((count, position) => count + [
    position.quantityOnHand,
    position.quantityAllocated,
    position.quantityInTransit,
    position.quantityOnOrder,
  ].filter((value) => value === null).length, 0);
  const nullSupplierFacts = snapshot.supplierTerms.reduce((count, term) => count + [
    term.currency,
    term.unitPrice,
    term.modeledFreightPerUnit,
    term.evidencedDutyPerUnit,
    term.leadTimeMinDays,
    term.leadTimeMaxDays,
    term.availableQuantity,
  ].filter((value) => value === null).length, 0);
  if (nullInventoryFacts || nullSupplierFacts) {
    result.uncertainties.push({
      kind: "explicit_supply_unknowns",
      inventoryUnknownFieldCount: nullInventoryFacts,
      supplierTermUnknownFieldCount: nullSupplierFacts,
    });
  }
  result.openLoops.push(...snapshot.demands
    .filter((demand) => demand.status === "OPEN")
    .slice(0, 40)
    .map((demand) => ({
      kind: "open_supply_demand",
      demandKey: demand.demandKey,
      itemKey: itemKeyById.get(demand.itemId) ?? null,
      quantity: decimalString(demand.quantity),
      unitOfMeasure: demand.unitOfMeasure,
      dueAt: safeIso(demand.dueAt),
    })));
  result.sourceCounts = {
    supplySnapshots: 1,
    supplyItems: snapshot.items.length,
    supplyBomLines: snapshot.bomVersions.reduce((count, version) => count + version.lines.length, 0),
    supplyInventoryPositions: snapshot.inventory.length,
    supplyDemands: snapshot.demands.length,
    supplySupplierTerms: snapshot.supplierTerms.length,
    supplyEquivalenceRules: latestRules.size,
    supplyFccProfiles: snapshot.fccProfiles.length,
  };
  return result;
}
