import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSupplyWorkspace, SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import {
  runSupplyPlanningEngine,
  SUPPLY_PLANNING_ENGINE_VERSION,
  SUPPLY_SCENARIO_FAMILIES,
  supplyPlanningHash,
  type PlanningCanonicalInput,
  type PlanningEquivalenceRule,
  type PlanningFccProfile,
  type PlanningItem,
  type PlanningScenarioRequest,
  type SupplyPlanningOutput,
} from "./planning-engine";

type JsonObject = Record<string, unknown>;

export type ComputeSupplyPlanningInput = {
  workspaceId: string;
  snapshotId: string;
  productItemKey: string;
  scenarios: PlanningScenarioRequest[];
};

function invalid(message: string): never {
  throw new SupplyPersistenceError(message, "invalid_input");
}

function plainObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as JsonObject;
}

function exactKeys(value: JsonObject, allowed: string[], label: string) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) invalid(`${label} contains unsupported fields: ${extras.sort().join(", ")}.`);
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) invalid(`${label} is required.`);
  return value.trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))].sort();
}

function nullableStringArray(value: unknown): string[] | null {
  return value === null ? null : stringArray(value);
}

function referenceArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const references = value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) return [entry.trim()];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const object = entry as JsonObject;
    const fields = ["evidenceKey", "sourceUri", "sourceRecordId", "contentHash", "sourceName", "source"];
    const selected = fields.find((field) => typeof object[field] === "string" && Boolean((object[field] as string).trim()));
    return selected ? [`${selected}:${(object[selected] as string).trim()}`] : [];
  });
  return [...new Set(references)].sort();
}

function metadataFlag(value: unknown, key: string) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as JsonObject)[key] === true);
}

function numeric(value: { toString(): string } | number | null) {
  return value === null ? null : Number(value.toString());
}

function normalizeScenario(value: unknown, index: number): PlanningScenarioRequest {
  const scenario = plainObject(value, `Scenario ${index + 1}`);
  const family = requiredText(scenario.family, `Scenario ${index + 1} family`);
  if (!SUPPLY_SCENARIO_FAMILIES.includes(family as (typeof SUPPLY_SCENARIO_FAMILIES)[number])) {
    invalid(`Scenario ${index + 1} family is not supported.`);
  }
  const scenarioKey = requiredText(scenario.scenarioKey, `Scenario ${index + 1} key`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(scenarioKey)) invalid(`Scenario ${index + 1} key contains unsupported characters.`);
  if (family === "current_purchasing_plan") {
    exactKeys(scenario, ["scenarioKey", "family"], `Scenario ${index + 1}`);
    return { scenarioKey, family };
  }
  if (family === "alternate_supplier") {
    exactKeys(scenario, ["scenarioKey", "family", "itemKey", "supplierTermKey"], `Scenario ${index + 1}`);
    return {
      scenarioKey,
      family,
      itemKey: requiredText(scenario.itemKey, `Scenario ${index + 1} item`),
      supplierTermKey: requiredText(scenario.supplierTermKey, `Scenario ${index + 1} supplier term`),
    };
  }
  if (family === "assembled_subassembly") {
    exactKeys(scenario, ["scenarioKey", "family", "subassemblyItemKey", "supplierTermKey"], `Scenario ${index + 1}`);
    return {
      scenarioKey,
      family,
      subassemblyItemKey: requiredText(scenario.subassemblyItemKey, `Scenario ${index + 1} subassembly`),
      supplierTermKey: requiredText(scenario.supplierTermKey, `Scenario ${index + 1} supplier term`),
    };
  }
  exactKeys(scenario, ["scenarioKey", "family", "equivalenceRuleKey"], `Scenario ${index + 1}`);
  return {
    scenarioKey,
    family: "approved_equivalence",
    equivalenceRuleKey: requiredText(scenario.equivalenceRuleKey, `Scenario ${index + 1} equivalence rule`),
  };
}

function normalizeRequest(value: unknown): ComputeSupplyPlanningInput {
  const input = plainObject(value, "Planning request");
  exactKeys(input, ["workspaceId", "snapshotId", "productItemKey", "scenarios"], "Planning request");
  if (!Array.isArray(input.scenarios) || !input.scenarios.length) invalid("At least one scenario is required.");
  const scenarios = input.scenarios.map(normalizeScenario);
  if (scenarios.filter((scenario) => scenario.family === "current_purchasing_plan").length !== 1) {
    invalid("Planning requires exactly one current purchasing plan baseline.");
  }
  return {
    workspaceId: requiredText(input.workspaceId, "Workspace ID"),
    snapshotId: requiredText(input.snapshotId, "Snapshot ID"),
    productItemKey: requiredText(input.productItemKey, "Product item key"),
    scenarios,
  };
}

async function canonicalPlanningInput(
  context: SupplyAccessContext,
  request: ComputeSupplyPlanningInput,
): Promise<PlanningCanonicalInput> {
  const snapshot = await prisma.supplySnapshot.findFirst({
    where: {
      id: request.snapshotId,
      officeId: context.officeId,
      workspaceId: request.workspaceId,
      status: "PUBLISHED",
    },
    include: {
      items: true,
      bomVersions: { where: { status: "ACTIVE" }, include: { lines: true } },
      inventory: { include: { location: { select: { locationKey: true } } } },
      demands: { include: { location: { select: { locationKey: true } } } },
      supplierTerms: {
        include: {
          item: { select: { itemKey: true } },
          facility: { select: { locationKey: true } },
        },
      },
      fccProfiles: { include: { item: { select: { itemKey: true } } } },
    },
  });
  if (!snapshot?.publishedAt) throw new SupplyPersistenceError("Published supply snapshot not found.", "not_found");
  const equivalenceRows = await prisma.supplyEquivalenceRule.findMany({
    where: { officeId: context.officeId, workspaceId: request.workspaceId },
    orderBy: [{ ruleKey: "asc" }, { version: "desc" }],
  });
  const latestRules = new Map<string, (typeof equivalenceRows)[number]>();
  for (const rule of equivalenceRows) if (!latestRules.has(rule.ruleKey)) latestRules.set(rule.ruleKey, rule);

  const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
  const items: PlanningItem[] = snapshot.items.map((item) => ({
    itemKey: item.itemKey,
    name: item.name,
    itemType: (["PRODUCT", "SUBASSEMBLY", "COMPONENT", "MATERIAL", "SERVICE"].includes(item.itemType)
      ? item.itemType
      : "COMPONENT") as PlanningItem["itemType"],
    unitOfMeasure: item.unitOfMeasure,
    requiresFccReview: metadataFlag(item.metadata, "requiresFccReview"),
    evidenceRefs: referenceArray(item.sourceRefs),
  }));
  const selectedBomVersions = new Map<string, (typeof snapshot.bomVersions)[number]>();
  for (const version of [...snapshot.bomVersions].sort((left, right) => {
    const effective = (right.effectiveAt?.getTime() ?? 0) - (left.effectiveAt?.getTime() ?? 0);
    return effective || right.revision.localeCompare(left.revision) || left.id.localeCompare(right.id);
  })) {
    const product = itemById.get(version.productItemId);
    if (product && !selectedBomVersions.has(product.itemKey)) selectedBomVersions.set(product.itemKey, version);
  }
  const baseWithoutHash = {
    snapshotId: snapshot.id,
    snapshotPublishedAt: snapshot.publishedAt.toISOString(),
    productItemKey: request.productItemKey,
    items,
    bomLines: [...selectedBomVersions.values()].flatMap((version) => version.lines.map((line) => {
      if (line.scrapRate === null) invalid(`BOM line ${line.id} has an unknown scrap rate.`);
      return {
        lineKey: line.id,
        parentItemKey: itemById.get(line.parentItemId)?.itemKey ?? line.parentItemId,
        componentItemKey: itemById.get(line.componentItemId)?.itemKey ?? line.componentItemId,
        quantity: Number(line.quantity.toString()),
        unitOfMeasure: line.unitOfMeasure,
        scrapRate: Number(line.scrapRate.toString()),
        isOptional: line.isOptional,
        evidenceRefs: referenceArray(line.sourceRefs),
      };
    })),
    inventory: snapshot.inventory.map((position) => ({
      positionKey: position.positionKey,
      itemKey: itemById.get(position.itemId)?.itemKey ?? position.itemId,
      facilityKey: position.location.locationKey,
      unitOfMeasure: position.unitOfMeasure,
      onHand: numeric(position.quantityOnHand),
      allocated: numeric(position.quantityAllocated),
      inTransit: numeric(position.quantityInTransit),
      onOrder: numeric(position.quantityOnOrder),
      expectedReceiptAt: position.expectedReceiptAt?.toISOString() ?? null,
      evidenceRefs: referenceArray(position.sourceRefs),
    })),
    demands: snapshot.demands.map((demand) => ({
      demandKey: demand.demandKey,
      itemKey: itemById.get(demand.itemId)?.itemKey ?? demand.itemId,
      facilityKey: demand.location?.locationKey ?? "UNASSIGNED",
      quantity: Number(demand.quantity.toString()),
      unitOfMeasure: demand.unitOfMeasure,
      dueAt: demand.dueAt.toISOString(),
      priority: demand.priority,
      status: (["OPEN", "CLOSED", "CANCELLED"].includes(demand.status) ? demand.status : "OPEN") as "OPEN" | "CLOSED" | "CANCELLED",
      evidenceRefs: referenceArray(demand.sourceRefs),
    })),
    supplierTerms: snapshot.supplierTerms.map((term) => ({
      termKey: term.termKey,
      itemKey: term.item.itemKey,
      facilityKey: term.facility?.locationKey ?? null,
      supplierKey: term.supplierKey,
      supplierName: term.supplierName,
      isCurrent: term.isCurrent,
      unitOfMeasure: term.unitOfMeasure,
      currency: term.currency,
      unitPrice: numeric(term.unitPrice),
      modeledFreightPerUnit: numeric(term.modeledFreightPerUnit),
      evidencedDutyPerUnit: numeric(term.evidencedDutyPerUnit),
      dutyEvidenceRefs: referenceArray(term.dutyEvidenceRefs),
      leadTimeMinDays: term.leadTimeMinDays,
      leadTimeMaxDays: term.leadTimeMaxDays,
      availableQuantity: numeric(term.availableQuantity),
      availableAt: term.availableAt?.toISOString() ?? null,
      evidenceRefs: referenceArray(term.evidenceRefs),
    })),
    equivalenceRules: [...latestRules.values()].map((rule): PlanningEquivalenceRule => ({
      ruleKey: rule.ruleKey,
      fromItemKey: rule.fromItemKey,
      toItemKey: rule.toItemKey,
      action: rule.action === "REMOVE" ? "REMOVE" : "REPLACE",
      status: (["DRAFT", "APPROVED", "REVOKED"].includes(rule.status) ? rule.status : "DRAFT") as PlanningEquivalenceRule["status"],
      constraints: rule.constraints && typeof rule.constraints === "object" && !Array.isArray(rule.constraints) ? rule.constraints as JsonObject : null,
      evidenceRefs: referenceArray(rule.evidenceRefs),
    })),
    fccProfiles: snapshot.fccProfiles.map((profile): PlanningFccProfile => ({
      itemKey: profile.item.itemKey,
      moduleAuthorization: (["EVIDENCED", "MISSING", "BLOCKED", "NOT_APPLICABLE"].includes(profile.moduleAuthorization) ? profile.moduleAuthorization : "MISSING") as PlanningFccProfile["moduleAuthorization"],
      moduleAuthorizationEvidenceRefs: stringArray(profile.moduleAuthorizationEvidenceRefs),
      hostIntegrationConstraints: nullableStringArray(profile.hostIntegrationConstraints),
      labeling: (["EVIDENCED", "MISSING", "NOT_APPLICABLE"].includes(profile.labeling) ? profile.labeling : "MISSING") as PlanningFccProfile["labeling"],
      labelingEvidenceRefs: stringArray(profile.labelingEvidenceRefs),
      rfExposure: (["EVIDENCED", "MISSING", "NOT_APPLICABLE"].includes(profile.rfExposure) ? profile.rfExposure : "MISSING") as PlanningFccProfile["rfExposure"],
      rfExposureEvidenceRefs: stringArray(profile.rfExposureEvidenceRefs),
      testing: (["EVIDENCED", "GAPS", "NOT_APPLICABLE"].includes(profile.testing) ? profile.testing : "GAPS") as PlanningFccProfile["testing"],
      testingEvidenceRefs: stringArray(profile.testingEvidenceRefs),
      testingGaps: stringArray(profile.testingGaps),
      reviewRequirements: stringArray(profile.reviewRequirements),
      blockedReasons: stringArray(profile.blockedReasons),
    })),
  };
  const normalizedBase = {
    ...baseWithoutHash,
    items: [...baseWithoutHash.items].sort((left, right) => left.itemKey.localeCompare(right.itemKey)),
    bomLines: [...baseWithoutHash.bomLines].sort((left, right) => left.lineKey.localeCompare(right.lineKey)),
    inventory: [...baseWithoutHash.inventory].sort((left, right) => left.positionKey.localeCompare(right.positionKey)),
    demands: [...baseWithoutHash.demands].sort((left, right) => left.demandKey.localeCompare(right.demandKey)),
    supplierTerms: [...baseWithoutHash.supplierTerms].sort((left, right) => left.termKey.localeCompare(right.termKey)),
    equivalenceRules: [...baseWithoutHash.equivalenceRules].sort((left, right) => left.ruleKey.localeCompare(right.ruleKey)),
    fccProfiles: [...baseWithoutHash.fccProfiles].sort((left, right) => left.itemKey.localeCompare(right.itemKey)),
  };
  return { ...normalizedBase, snapshotHash: supplyPlanningHash(normalizedBase) };
}

export async function computeAndPersistSupplyPlanning(
  context: SupplyAccessContext,
  rawInput: unknown,
) {
  const request = normalizeRequest(rawInput);
  await requireSupplyWorkspace(context, request.workspaceId, "edit");
  const canonicalInput = await canonicalPlanningInput(context, request);
  const output = runSupplyPlanningEngine(canonicalInput, request.scenarios);
  const existing = await prisma.supplyPlanningResult.findFirst({
    where: {
      officeId: context.officeId,
      workspaceId: request.workspaceId,
      normalizedInputHash: output.normalizedInputHash,
    },
  });
  if (existing) return existing;
  const unknowns = output.scenarios.flatMap((scenario) => scenario.unknowns);
  const evidenceReferences = [...new Set(output.scenarios.flatMap((scenario) => scenario.evidenceReferences))].sort();
  try {
    return await prisma.supplyPlanningResult.create({
      data: {
        officeId: context.officeId,
        workspaceId: request.workspaceId,
        snapshotId: request.snapshotId,
        createdByUserId: context.userId,
        engineVersion: SUPPLY_PLANNING_ENGINE_VERSION,
        snapshotHash: output.snapshotHash,
        normalizedInputHash: output.normalizedInputHash,
        assumptions: output.assumptions as Prisma.InputJsonValue,
        unknowns: unknowns as Prisma.InputJsonValue,
        evidenceReferences: evidenceReferences as Prisma.InputJsonValue,
        output: output as unknown as Prisma.InputJsonValue,
        outputHash: output.deterministicOutputHash,
      },
    });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
    return prisma.supplyPlanningResult.findFirstOrThrow({
      where: { officeId: context.officeId, workspaceId: request.workspaceId, normalizedInputHash: output.normalizedInputHash },
    });
  }
}

export async function listSupplyPlanningResults(context: SupplyAccessContext, workspaceId: string) {
  await requireSupplyWorkspace(context, workspaceId, "view");
  const [latest, results] = await Promise.all([
    prisma.supplySnapshot.findFirst({
      where: { officeId: context.officeId, workspaceId, status: "PUBLISHED" },
      orderBy: { version: "desc" },
      select: { id: true, sourceHash: true, version: true, publishedAt: true },
    }),
    prisma.supplyPlanningResult.findMany({
      where: { officeId: context.officeId, workspaceId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return results.map((result) => ({
    ...result,
    output: result.output as unknown as SupplyPlanningOutput,
    isStale: !latest || result.snapshotId !== latest.id,
    currentSnapshot: latest,
  }));
}
