import "server-only";

import { prisma } from "@/lib/prisma";
import type { SupplyWorldEvidenceRef } from "@/lib/supply-os/state-runtime/types";
import {
  boundSupplyStateValue,
  decimalString,
  emptySupplyStateReaderResult,
  makeSupplyStateDependency,
  safeIso,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "./types";
import {
  canonicalItemIdentityValue,
  currentSnapshotFactValue,
  equivalenceRuleListValue,
  planningMentionsItem,
  planningResultListValue,
  snapshotSourceHash,
  workspaceIdentityValue,
  workspacePresentationValue,
} from "./selectors";
import { resolveSnapshotItemIdentity } from "./item-identity";

type ItemSupplyReaderDependencies = {
  findWorkspace: typeof prisma.supplyWorkspace.findFirst;
  findCanonicalItem: typeof prisma.item.findFirst;
  findSnapshot: typeof prisma.supplySnapshot.findFirst;
  resolveItemIdentity: typeof resolveSnapshotItemIdentity;
  findBomLines: typeof prisma.supplyBomLine.findMany;
  findInventory: typeof prisma.supplyInventoryPosition.findMany;
  findDemands: typeof prisma.supplyDemand.findMany;
  findSupplierTerms: typeof prisma.supplySupplierTerm.findMany;
  findFccProfile: typeof prisma.supplyFccProfile.findFirst;
  findEquivalenceRules: typeof prisma.supplyEquivalenceRule.findMany;
  findPlanningResults: typeof prisma.supplyPlanningResult.findMany;
};

const defaultDependencies: ItemSupplyReaderDependencies = {
  findWorkspace: (args) => prisma.supplyWorkspace.findFirst(args),
  findCanonicalItem: (args) => prisma.item.findFirst(args),
  findSnapshot: (args) => prisma.supplySnapshot.findFirst(args),
  resolveItemIdentity: resolveSnapshotItemIdentity,
  findBomLines: (args) => prisma.supplyBomLine.findMany(args),
  findInventory: (args) => prisma.supplyInventoryPosition.findMany(args),
  findDemands: (args) => prisma.supplyDemand.findMany(args),
  findSupplierTerms: (args) => prisma.supplySupplierTerm.findMany(args),
  findFccProfile: (args) => prisma.supplyFccProfile.findFirst(args),
  findEquivalenceRules: (args) => prisma.supplyEquivalenceRule.findMany(args),
  // tenant-scope:ignore dependency adapter only; readItemSupplyState always supplies officeId and workspaceId.
  findPlanningResults: (args) => prisma.supplyPlanningResult.findMany(args),
};

function snapshotItemState(item: NonNullable<Awaited<ReturnType<typeof resolveSnapshotItemIdentity>>["supplyItem"]>) {
  return {
    id: item.id,
    itemKey: item.itemKey,
    externalId: item.externalId,
    sku: item.sku,
    manufacturer: item.manufacturer,
    mpn: item.mpn,
    gtin: item.gtin,
    name: item.name,
    description: item.description,
    category: item.category,
    itemType: item.itemType,
    unitOfMeasure: item.unitOfMeasure,
    metadata: item.metadata,
    sourceRefs: item.sourceRefs,
  };
}

export async function readItemSupplyState(
  input: SupplyStateReaderInput,
  dependencies: ItemSupplyReaderDependencies = defaultDependencies,
): Promise<SupplyStateReaderResult> {
  if (input.scope.type !== "item") return emptySupplyStateReaderResult();
  if (!input.scope.itemId && !input.scope.itemKey) {
    throw new Error("Item state scope requires itemId or itemKey.");
  }
  const result = emptySupplyStateReaderResult();
  const workspace = await dependencies.findWorkspace({
    where: {
      id: input.scope.workspaceId,
      officeId: input.scope.officeId,
      companyId: input.scope.companyId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      companyId: true,
      externalKey: true,
      name: true,
      status: true,
      version: true,
      archivedAt: true,
    },
  });
  if (!workspace) {
    result.currentState.itemSupply = null;
    result.uncertainties.push({ kind: "item_workspace_missing", workspaceId: input.scope.workspaceId });
    result.dependencies.push(makeSupplyStateDependency({
      key: `workspace.identity:${input.scope.workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: input.scope.workspaceId,
      value: null,
      policy: "STRICT",
      reason: "The item workspace is missing or inactive.",
    }));
    return result;
  }
  result.dependencies.push(
    makeSupplyStateDependency({
      key: `workspace.identity:${workspace.id}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspace.id,
      value: workspaceIdentityValue(workspace),
      policy: "STRICT",
      reason: "The item workspace ownership or lifecycle changed.",
    }),
    makeSupplyStateDependency({
      key: `workspace.presentation:${workspace.id}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspace.id,
      value: workspacePresentationValue(workspace),
      policy: "ADVISORY",
      reason: "The item workspace presentation changed.",
    }),
  );
  const canonicalItemRow = input.scope.itemId ? await dependencies.findCanonicalItem({
    where: {
      id: input.scope.itemId,
      officeId: input.scope.officeId,
      companyId: input.scope.companyId,
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
  }) : null;
  const canonicalItem = canonicalItemIdentityValue(canonicalItemRow);
  if (input.scope.itemId) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `item.identity:${input.scope.companyId}:${input.scope.itemId}`,
      source: "APP_DB",
      entityType: "Item",
      entityRef: input.scope.itemId,
      value: canonicalItem,
      policy: "STRICT",
      reason: "The canonical item identity or requirement changed.",
    }));
    if (!canonicalItemRow) {
      result.currentState.itemSupply = {
        workspace,
        currentSnapshot: null,
        canonicalItem: null,
        item: null,
      };
      result.uncertainties.push({
        kind: "canonical_item_missing_or_out_of_scope",
        itemId: input.scope.itemId,
      });
      result.sourceCounts = { canonicalItems: 0 };
      return result;
    }
  }
  const snapshot = await dependencies.findSnapshot({
    where: { officeId: input.scope.officeId, workspaceId: workspace.id, status: "PUBLISHED" },
    orderBy: [{ version: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
    select: { id: true, version: true, schemaVersion: true, sourceHash: true, publishedAt: true },
  });
  if (!snapshot) {
    result.currentState.itemSupply = { workspace, currentSnapshot: null, canonicalItem, item: null };
    result.uncertainties.push({ kind: "published_supply_snapshot_missing", workspaceId: workspace.id });
    result.dependencies.push(makeSupplyStateDependency({
      key: `workspace.current_snapshot:${workspace.id}`,
      source: "APP_DB",
      entityType: "SupplySnapshot",
      entityRef: workspace.id,
      value: null,
      policy: "STRICT",
      reason: "The item has no current published supply snapshot.",
    }));
    return result;
  }
  const identity = await dependencies.resolveItemIdentity({
    officeId: input.scope.officeId,
    companyId: input.scope.companyId,
    workspaceId: workspace.id,
    snapshotId: snapshot.id,
    itemId: input.scope.itemId,
    itemKey: input.scope.itemKey,
    canonicalItem: canonicalItemRow,
  });
  const item = identity.supplyItem;
  const sourceHash = snapshotSourceHash(snapshot);
  const snapshotEvidence: SupplyWorldEvidenceRef = { kind: "supply_snapshot", id: snapshot.id, sourceHash };
  result.evidenceRefs.push(snapshotEvidence);
  result.dependencies.push(
    makeSupplyStateDependency({
      key: `workspace.current_snapshot:${workspace.id}`,
      source: "APP_DB",
      entityType: "SupplySnapshot",
      entityRef: workspace.id,
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
  if (input.scope.itemId) {
    if (identity.method === "APPROVED_ALIAS" && item) {
      result.dependencies.push(makeSupplyStateDependency({
        key: `item.approved_alias_mapping:${workspace.id}:${input.scope.companyId}:${input.scope.itemId}:${encodeURIComponent(item.itemKey)}`,
        source: "APP_DB",
        entityType: "SupplyItemAlias",
        entityRef: `${workspace.id}:${input.scope.itemId}:${item.itemKey}`,
        value: {
          canonicalItemId: input.scope.itemId,
          itemKey: item.itemKey,
          method: "APPROVED_ALIAS",
        },
        policy: "STRICT",
        reason: "The approved canonical-to-snapshot item mapping changed.",
      }));
    }
  }
  if (!item) {
    result.currentState.itemSupply = {
      workspace,
      currentSnapshot: { ...snapshot, sourceHash },
      canonicalItem,
      identityResolution: {
        status: identity.status,
        method: identity.method,
        reason: identity.reason,
        candidateItemKeys: identity.candidateItemKeys,
      },
      item: null,
    };
    result.uncertainties.push({
      kind: identity.status === "AMBIGUOUS" ? "supply_item_identity_ambiguous" : "supply_item_missing",
      itemId: input.scope.itemId ?? null,
      itemKey: input.scope.itemKey ?? null,
      reason: identity.reason,
      candidateItemKeys: identity.candidateItemKeys,
    });
    return result;
  }

  const [bomLines, inventory, demands, supplierTerms, fccProfile, equivalenceRows, planningRows] = await Promise.all([
    dependencies.findBomLines({
      where: {
        officeId: input.scope.officeId,
        workspaceId: workspace.id,
        snapshotId: snapshot.id,
        OR: [{ parentItemId: item.id }, { componentItemId: item.id }],
      },
      orderBy: [{ bomVersionId: "asc" }, { lineNumber: "asc" }],
      take: 100,
      select: {
        id: true,
        bomVersionId: true,
        parentItemId: true,
        componentItemId: true,
        lineNumber: true,
        quantity: true,
        unitOfMeasure: true,
        scrapRate: true,
        isOptional: true,
        alternativeGroup: true,
        parentItem: { select: { itemKey: true } },
        componentItem: { select: { itemKey: true } },
        bomVersion: { select: { revision: true, status: true, effectiveAt: true } },
      },
    }),
    dependencies.findInventory({
      where: { officeId: input.scope.officeId, workspaceId: workspace.id, snapshotId: snapshot.id, itemId: item.id },
      orderBy: [{ asOf: "desc" }, { positionKey: "asc" }],
      take: 100,
      select: {
        id: true,
        positionKey: true,
        lotNumber: true,
        unitOfMeasure: true,
        quantityOnHand: true,
        quantityAllocated: true,
        quantityInTransit: true,
        quantityOnOrder: true,
        expectedReceiptAt: true,
        asOf: true,
        location: { select: { locationKey: true, name: true } },
      },
    }),
    dependencies.findDemands({
      where: { officeId: input.scope.officeId, workspaceId: workspace.id, snapshotId: snapshot.id, itemId: item.id },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { demandKey: "asc" }],
      take: 100,
      select: {
        id: true,
        demandKey: true,
        sourceType: true,
        externalId: true,
        quantity: true,
        unitOfMeasure: true,
        dueAt: true,
        status: true,
        priority: true,
        location: { select: { locationKey: true, name: true } },
      },
    }),
    dependencies.findSupplierTerms({
      where: { officeId: input.scope.officeId, workspaceId: workspace.id, snapshotId: snapshot.id, itemId: item.id },
      orderBy: [{ isCurrent: "desc" }, { termKey: "asc" }],
      take: 100,
      select: {
        id: true,
        termKey: true,
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
        facility: { select: { locationKey: true, name: true } },
      },
    }),
    dependencies.findFccProfile({
      where: { officeId: input.scope.officeId, workspaceId: workspace.id, snapshotId: snapshot.id, itemId: item.id },
      select: {
        id: true,
        moduleAuthorization: true,
        moduleAuthorizationEvidenceRefs: true,
        hostIntegrationConstraints: true,
        labeling: true,
        labelingEvidenceRefs: true,
        rfExposure: true,
        rfExposureEvidenceRefs: true,
        testing: true,
        testingEvidenceRefs: true,
        testingGaps: true,
        reviewRequirements: true,
        blockedReasons: true,
      },
    }),
    dependencies.findEquivalenceRules({
      where: {
        officeId: input.scope.officeId,
        workspaceId: workspace.id,
        OR: [{ fromItemKey: item.itemKey }, { toItemKey: item.itemKey }],
      },
      orderBy: [{ ruleKey: "asc" }, { version: "desc" }],
      take: 100,
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
    }),
    dependencies.findPlanningResults({
      where: { officeId: input.scope.officeId, workspaceId: workspace.id, snapshotId: snapshot.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: {
        id: true,
        snapshotId: true,
        engineVersion: true,
        snapshotHash: true,
        normalizedInputHash: true,
        unknowns: true,
        evidenceReferences: true,
        output: true,
        outputHash: true,
        createdAt: true,
      },
    }),
  ]);
  const latestRules = new Map<string, (typeof equivalenceRows)[number]>();
  for (const rule of equivalenceRows) if (!latestRules.has(rule.ruleKey)) latestRules.set(rule.ruleKey, rule);
  const planningResults = planningRows.filter((row) => planningMentionsItem(row.output, item.itemKey)).slice(0, 5);
  const planningEvidence: SupplyWorldEvidenceRef[] = planningResults.map((row) => ({
    kind: "planning_result" as const,
    id: row.id,
    outputHash: row.outputHash,
  }));
  result.evidenceRefs.push(...planningEvidence);
  result.dependencies.push(
    makeSupplyStateDependency({
      key: `item.equivalence_rules:${workspace.id}:${encodeURIComponent(item.itemKey)}`,
      source: "APP_DB",
      entityType: "SupplyEquivalenceRuleList",
      entityRef: `${workspace.id}:${item.itemKey}`,
      value: equivalenceRuleListValue([...latestRules.values()]),
      policy: "STRICT",
      reason: "The item-specific equivalence-rule list changed.",
    }),
    makeSupplyStateDependency({
      key: `item.planning_results:${workspace.id}:${encodeURIComponent(item.itemKey)}`,
      source: "APP_DB",
      entityType: "SupplyPlanningResultList",
      entityRef: `${workspace.id}:${item.itemKey}`,
      value: planningResultListValue(planningResults),
      policy: "ADVISORY",
      reason: "The bounded item-specific planning-result list changed.",
      evidenceRefs: planningEvidence,
    }),
  );
  for (const row of planningResults) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `planning.result:${row.id}`,
      source: "APP_DB",
      entityType: "SupplyPlanningResult",
      entityRef: row.id,
      value: { outputHash: row.outputHash, snapshotHash: row.snapshotHash, normalizedInputHash: row.normalizedInputHash },
      version: row.outputHash,
      policy: "ADVISORY",
      reason: "A relevant deterministic planning result changed or disappeared.",
      evidenceRefs: planningEvidence.filter((reference) => reference.id === row.id),
    }));
  }
  for (const rule of latestRules.values()) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `workspace.equivalence_rule:${workspace.id}:${encodeURIComponent(rule.ruleKey)}`,
      source: "APP_DB",
      entityType: "SupplyEquivalenceRule",
      entityRef: rule.id,
      value: { ruleHash: rule.ruleHash, status: rule.status },
      version: rule.ruleHash,
      policy: "STRICT",
      reason: "An item equivalence rule used for supply planning changed.",
      evidenceRefs: [],
    }));
  }
  result.currentState.itemSupply = boundSupplyStateValue({
    workspace,
    currentSnapshot: { ...snapshot, sourceHash },
    canonicalItem,
    identityResolution: {
      status: identity.status,
      method: identity.method,
      reason: identity.reason,
      canonicalItemId: identity.canonicalItem?.id ?? null,
      snapshotItemId: item.id,
      itemKey: item.itemKey,
    },
    item: snapshotItemState(item),
    bomLines: bomLines.map((line) => ({
      id: line.id,
      revision: line.bomVersion.revision,
      bomStatus: line.bomVersion.status,
      effectiveAt: safeIso(line.bomVersion.effectiveAt),
      parentItemKey: line.parentItem.itemKey,
      componentItemKey: line.componentItem.itemKey,
      lineNumber: line.lineNumber,
      quantity: decimalString(line.quantity),
      unitOfMeasure: line.unitOfMeasure,
      scrapRate: decimalString(line.scrapRate),
      isOptional: line.isOptional,
      alternativeGroup: line.alternativeGroup,
    })),
    inventory: inventory.map((position) => ({
      id: position.id,
      positionKey: position.positionKey,
      location: position.location,
      lotNumber: position.lotNumber,
      unitOfMeasure: position.unitOfMeasure,
      quantityOnHand: decimalString(position.quantityOnHand),
      quantityAllocated: decimalString(position.quantityAllocated),
      quantityInTransit: decimalString(position.quantityInTransit),
      quantityOnOrder: decimalString(position.quantityOnOrder),
      expectedReceiptAt: safeIso(position.expectedReceiptAt),
      asOf: safeIso(position.asOf),
    })),
    demands: demands.map((demand) => ({
      id: demand.id,
      demandKey: demand.demandKey,
      location: demand.location,
      sourceType: demand.sourceType,
      externalId: demand.externalId,
      quantity: decimalString(demand.quantity),
      unitOfMeasure: demand.unitOfMeasure,
      dueAt: safeIso(demand.dueAt),
      status: demand.status,
      priority: demand.priority,
    })),
    supplierTerms: supplierTerms.map((term) => ({
      id: term.id,
      termKey: term.termKey,
      supplierKey: term.supplierKey,
      supplierName: term.supplierName,
      facility: term.facility,
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
    equivalenceRules: [...latestRules.values()].map((rule) => ({ ...rule, approvedAt: safeIso(rule.approvedAt) })),
    fccProfile,
  }, { maxArray: 100, maxString: 3_000 });
  result.derivedState.itemPlanning = planningResults.map((row) => ({
    id: row.id,
    engineVersion: row.engineVersion,
    snapshotHash: row.snapshotHash,
    normalizedInputHash: row.normalizedInputHash,
    outputHash: row.outputHash,
    unknowns: boundSupplyStateValue(row.unknowns, { maxArray: 40, maxString: 1_000 }),
    output: boundSupplyStateValue(row.output, { maxArray: 40, maxString: 2_000 }),
    createdAt: safeIso(row.createdAt),
  }));
  result.openLoops.push(...demands.filter((demand) => demand.status === "OPEN").slice(0, 40).map((demand) => ({
    kind: "open_item_demand",
    demandKey: demand.demandKey,
    quantity: decimalString(demand.quantity),
    unitOfMeasure: demand.unitOfMeasure,
    dueAt: safeIso(demand.dueAt),
  })));
  const unknownInventory = inventory.reduce((count, position) => count + [
    position.quantityOnHand,
    position.quantityAllocated,
    position.quantityInTransit,
    position.quantityOnOrder,
  ].filter((value) => value === null).length, 0);
  const unknownTerms = supplierTerms.reduce((count, term) => count + [
    term.currency,
    term.unitPrice,
    term.modeledFreightPerUnit,
    term.evidencedDutyPerUnit,
    term.leadTimeMinDays,
    term.leadTimeMaxDays,
    term.availableQuantity,
  ].filter((value) => value === null).length, 0);
  if (unknownInventory || unknownTerms) {
    result.uncertainties.push({
      kind: "explicit_item_supply_unknowns",
      inventoryUnknownFieldCount: unknownInventory,
      supplierTermUnknownFieldCount: unknownTerms,
    });
  }
  result.sourceCounts = {
    canonicalItems: identity.canonicalItem ? 1 : 0,
    supplySnapshots: 1,
    supplyItems: 1,
    supplyBomLines: bomLines.length,
    supplyInventoryPositions: inventory.length,
    supplyDemands: demands.length,
    supplySupplierTerms: supplierTerms.length,
    supplyEquivalenceRules: latestRules.size,
    supplyFccProfiles: fccProfile ? 1 : 0,
    supplyPlanningResults: planningResults.length,
  };
  return result;
}
