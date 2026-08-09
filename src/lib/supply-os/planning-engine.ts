import { createHash } from "node:crypto";

export const SUPPLY_PLANNING_ENGINE_VERSION = "1.0.0";

export const SUPPLY_SCENARIO_FAMILIES = [
  "current_purchasing_plan",
  "alternate_supplier",
  "assembled_subassembly",
  "approved_equivalence",
] as const;

export type SupplyScenarioFamily = (typeof SUPPLY_SCENARIO_FAMILIES)[number];
export type FccDisposition = "evidence_complete" | "review_required" | "blocked";

export type PlanningItem = {
  itemKey: string;
  name: string;
  itemType: "PRODUCT" | "SUBASSEMBLY" | "COMPONENT" | "MATERIAL" | "SERVICE";
  unitOfMeasure: string;
  requiresFccReview?: boolean;
  evidenceRefs?: string[];
};

export type PlanningBomLine = {
  lineKey: string;
  parentItemKey: string;
  componentItemKey: string;
  quantity: number;
  unitOfMeasure: string;
  scrapRate: number;
  isOptional: boolean;
  evidenceRefs?: string[];
};

export type PlanningInventoryPosition = {
  positionKey: string;
  itemKey: string;
  facilityKey: string;
  unitOfMeasure: string;
  onHand: number | null;
  allocated: number | null;
  inTransit: number | null;
  onOrder: number | null;
  expectedReceiptAt: string | null;
  evidenceRefs?: string[];
};

export type PlanningDemand = {
  demandKey: string;
  itemKey: string;
  facilityKey: string;
  quantity: number;
  unitOfMeasure: string;
  dueAt: string;
  priority: number;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  evidenceRefs?: string[];
};

export type PlanningSupplierTerm = {
  termKey: string;
  itemKey: string;
  facilityKey: string | null;
  supplierKey: string;
  supplierName: string;
  isCurrent: boolean;
  unitOfMeasure: string;
  currency: string | null;
  unitPrice: number | null;
  modeledFreightPerUnit: number | null;
  evidencedDutyPerUnit: number | null;
  dutyEvidenceRefs: string[];
  leadTimeMinDays: number | null;
  leadTimeMaxDays: number | null;
  availableQuantity: number | null;
  availableAt: string | null;
  evidenceRefs: string[];
};

export type PlanningEquivalenceRule = {
  ruleKey: string;
  fromItemKey: string;
  toItemKey: string | null;
  action: "REPLACE" | "REMOVE";
  status: "DRAFT" | "APPROVED" | "REVOKED";
  constraints: Record<string, unknown> | null;
  evidenceRefs: string[];
};

export type PlanningFccProfile = {
  itemKey: string;
  moduleAuthorization: "EVIDENCED" | "MISSING" | "BLOCKED" | "NOT_APPLICABLE";
  moduleAuthorizationEvidenceRefs: string[];
  hostIntegrationConstraints: string[] | null;
  labeling: "EVIDENCED" | "MISSING" | "NOT_APPLICABLE";
  labelingEvidenceRefs: string[];
  rfExposure: "EVIDENCED" | "MISSING" | "NOT_APPLICABLE";
  rfExposureEvidenceRefs: string[];
  testing: "EVIDENCED" | "GAPS" | "NOT_APPLICABLE";
  testingEvidenceRefs: string[];
  testingGaps: string[];
  reviewRequirements: string[];
  blockedReasons: string[];
};

export type PlanningCanonicalInput = {
  snapshotId: string;
  snapshotHash: string;
  snapshotPublishedAt: string;
  productItemKey: string;
  items: PlanningItem[];
  bomLines: PlanningBomLine[];
  inventory: PlanningInventoryPosition[];
  demands: PlanningDemand[];
  supplierTerms: PlanningSupplierTerm[];
  equivalenceRules: PlanningEquivalenceRule[];
  fccProfiles: PlanningFccProfile[];
};

export type PlanningScenarioRequest =
  | { scenarioKey: string; family: "current_purchasing_plan" }
  | { scenarioKey: string; family: "alternate_supplier"; itemKey: string; supplierTermKey: string }
  | { scenarioKey: string; family: "assembled_subassembly"; subassemblyItemKey: string; supplierTermKey: string }
  | { scenarioKey: string; family: "approved_equivalence"; equivalenceRuleKey: string };

export type UnknownInput = {
  code: string;
  itemKey?: string;
  facilityKey?: string;
  supplierTermKey?: string;
  detail: string;
};

export type PlanningScenarioResult = {
  scenarioKey: string;
  family: SupplyScenarioFamily;
  blocked: boolean;
  complianceBlockers: string[];
  materialCost: number | null;
  modeledFreight: number | null;
  evidencedDutyEstimate: number | null;
  landedCost: number | null;
  currency: string | null;
  leadTimeRange: { minDays: number; maxDays: number } | null;
  buildableUnits: number | null;
  buildableQuantityByDemandDate: Array<{
    demandKey: string;
    dueAt: string;
    requiredQuantity: number;
    buildableQuantity: number | null;
    coverage: number | null;
  }>;
  netAvailableInventory: Array<{
    itemKey: string;
    facilityKey: string;
    onHand: number | null;
    allocated: number | null;
    inTransit: number | null;
    onOrder: number | null;
    netAvailable: number | null;
  }>;
  shortages: Array<{
    demandKey: string;
    dueAt: string;
    itemKey: string;
    facilityKey: string;
    shortageQuantity: number;
  }>;
  earliestAffectedDemand: { demandKey: string; dueAt: string } | null;
  demandDateCoverage: number | null;
  supplierConcentration: {
    basis: "required_component_count";
    supplierCount: number;
    maxShare: number;
    hhi: number;
  } | null;
  evidenceCompleteness: { complete: boolean; evidenced: number; required: number; missing: string[] };
  landedCostCompleteness: { complete: boolean; known: number; required: number; missing: string[] };
  cashExposure: number | null;
  fcc: {
    status: FccDisposition;
    moduleAuthorizationEvidence: string[];
    hostIntegrationConstraints: string[];
    labelingEvidence: string[];
    rfExposureEvidence: string[];
    testingEvidence: string[];
    testingGaps: string[];
    reviewRequirements: string[];
  };
  assumptions: string[];
  unknowns: UnknownInput[];
  evidenceReferences: string[];
  recommendationReasons: string[];
};

export type PlanningComparison = {
  baselineScenarioKey: string;
  candidateScenarioKey: string;
  materialCostDelta: number | null;
  landedCostDelta: number | null;
  buildableUnitsDelta: number | null;
  leadTimeMaxDaysDelta: number | null;
  supplierConcentrationMaxShareDelta: number | null;
  candidateBlocked: boolean;
  unknowns: UnknownInput[];
};

export type SupplyPlanningOutput = {
  engineVersion: string;
  snapshotId: string;
  snapshotHash: string;
  productItemKey: string;
  assumptions: string[];
  scenarios: PlanningScenarioResult[];
  comparisons: PlanningComparison[];
  recommendationOrder: string[];
  normalizedInputHash: string;
  deterministicOutputHash: string;
};

export class SupplyPlanningError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_input" | "cycle" | "unit_mismatch" | "not_found",
  ) {
    super(message);
    this.name = "SupplyPlanningError";
  }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonicalize(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SupplyPlanningError("Planning inputs must contain finite numbers.", "invalid_input");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  throw new SupplyPlanningError("Planning inputs must be JSON serializable.", "invalid_input");
}

export function supplyPlanningHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function normalizedUnit(value: string) {
  return value.trim().toUpperCase();
}

function finiteNonnegative(value: number | null, label: string) {
  if (value === null) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new SupplyPlanningError(`${label} must be a finite nonnegative number or null.`, "invalid_input");
  }
}

function timestamp(value: string, label: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new SupplyPlanningError(`${label} must be an ISO date.`, "invalid_input");
  return parsed;
}

function sortedUnique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function unknownKey(value: UnknownInput) {
  return [value.code, value.itemKey ?? "", value.facilityKey ?? "", value.supplierTermKey ?? "", value.detail].join(":");
}

function sortedUnknowns(values: UnknownInput[]) {
  return [...new Map(values.map((value) => [unknownKey(value), value])).values()]
    .sort((left, right) => unknownKey(left).localeCompare(unknownKey(right)));
}

function assertUnique<T>(rows: T[], key: (row: T) => string, label: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (!value || seen.has(value)) throw new SupplyPlanningError(`${label} keys must be nonempty and unique.`, "invalid_input");
    seen.add(value);
  }
}

function validateInput(input: PlanningCanonicalInput, requests: PlanningScenarioRequest[]) {
  assertUnique(input.items, (row) => row.itemKey, "Item");
  assertUnique(input.bomLines, (row) => row.lineKey, "BOM line");
  assertUnique(input.inventory, (row) => row.positionKey, "Inventory position");
  assertUnique(input.demands, (row) => row.demandKey, "Demand");
  assertUnique(input.supplierTerms, (row) => row.termKey, "Supplier term");
  assertUnique(input.equivalenceRules, (row) => row.ruleKey, "Equivalence rule");
  assertUnique(requests, (row) => row.scenarioKey, "Scenario");
  timestamp(input.snapshotPublishedAt, "Snapshot publication date");
  const itemByKey = new Map(input.items.map((item) => [item.itemKey, item]));
  if (!itemByKey.has(input.productItemKey)) throw new SupplyPlanningError("Product item was not found in the snapshot.", "not_found");

  for (const line of input.bomLines) {
    const parent = itemByKey.get(line.parentItemKey);
    const child = itemByKey.get(line.componentItemKey);
    if (!parent || !child) throw new SupplyPlanningError(`BOM line ${line.lineKey} references an unknown item.`, "not_found");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.scrapRate) || line.scrapRate < 0 || line.scrapRate > 1) {
      throw new SupplyPlanningError(`BOM line ${line.lineKey} has an invalid quantity or scrap rate.`, "invalid_input");
    }
    if (normalizedUnit(line.unitOfMeasure) !== normalizedUnit(child.unitOfMeasure)) {
      throw new SupplyPlanningError(`BOM line ${line.lineKey} uses ${line.unitOfMeasure}, but ${child.itemKey} uses ${child.unitOfMeasure}.`, "unit_mismatch");
    }
  }
  for (const position of input.inventory) {
    const item = itemByKey.get(position.itemKey);
    if (!item) throw new SupplyPlanningError(`Inventory ${position.positionKey} references an unknown item.`, "not_found");
    if (normalizedUnit(position.unitOfMeasure) !== normalizedUnit(item.unitOfMeasure)) {
      throw new SupplyPlanningError(`Inventory ${position.positionKey} is not unit-compatible with ${item.itemKey}.`, "unit_mismatch");
    }
    finiteNonnegative(position.onHand, `${position.positionKey} on-hand`);
    finiteNonnegative(position.allocated, `${position.positionKey} allocated`);
    finiteNonnegative(position.inTransit, `${position.positionKey} in-transit`);
    finiteNonnegative(position.onOrder, `${position.positionKey} on-order`);
    if (position.expectedReceiptAt) timestamp(position.expectedReceiptAt, `${position.positionKey} receipt date`);
  }
  for (const demand of input.demands) {
    const item = itemByKey.get(demand.itemKey);
    if (!item) throw new SupplyPlanningError(`Demand ${demand.demandKey} references an unknown item.`, "not_found");
    if (normalizedUnit(demand.unitOfMeasure) !== normalizedUnit(item.unitOfMeasure)) {
      throw new SupplyPlanningError(`Demand ${demand.demandKey} is not unit-compatible with ${item.itemKey}.`, "unit_mismatch");
    }
    if (!Number.isFinite(demand.quantity) || demand.quantity < 0) throw new SupplyPlanningError(`Demand ${demand.demandKey} has invalid quantity.`, "invalid_input");
    timestamp(demand.dueAt, `${demand.demandKey} due date`);
  }
  for (const term of input.supplierTerms) {
    const item = itemByKey.get(term.itemKey);
    if (!item) throw new SupplyPlanningError(`Supplier term ${term.termKey} references an unknown item.`, "not_found");
    if (normalizedUnit(term.unitOfMeasure) !== normalizedUnit(item.unitOfMeasure)) {
      throw new SupplyPlanningError(`Supplier term ${term.termKey} is not unit-compatible with ${item.itemKey}.`, "unit_mismatch");
    }
    finiteNonnegative(term.unitPrice, `${term.termKey} unit price`);
    finiteNonnegative(term.modeledFreightPerUnit, `${term.termKey} freight`);
    finiteNonnegative(term.evidencedDutyPerUnit, `${term.termKey} duty`);
    finiteNonnegative(term.leadTimeMinDays, `${term.termKey} minimum lead time`);
    finiteNonnegative(term.leadTimeMaxDays, `${term.termKey} maximum lead time`);
    finiteNonnegative(term.availableQuantity, `${term.termKey} available quantity`);
    if (term.leadTimeMinDays !== null && term.leadTimeMaxDays !== null && term.leadTimeMinDays > term.leadTimeMaxDays) {
      throw new SupplyPlanningError(`Supplier term ${term.termKey} has an inverted lead-time range.`, "invalid_input");
    }
    if (term.availableAt) timestamp(term.availableAt, `${term.termKey} availability date`);
  }

  const children = new Map<string, string[]>();
  for (const line of input.bomLines) {
    const values = children.get(line.parentItemKey) ?? [];
    values.push(line.componentItemKey);
    children.set(line.parentItemKey, values);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (itemKey: string, path: string[]) => {
    if (active.has(itemKey)) {
      throw new SupplyPlanningError(`BOM cycle detected: ${[...path, itemKey].join(" -> ")}.`, "cycle");
    }
    if (visited.has(itemKey)) return;
    active.add(itemKey);
    for (const child of [...(children.get(itemKey) ?? [])].sort()) visit(child, [...path, itemKey]);
    active.delete(itemKey);
    visited.add(itemKey);
  };
  for (const item of [...input.items].sort((left, right) => left.itemKey.localeCompare(right.itemKey))) visit(item.itemKey, []);
}

type Requirement = { itemKey: string; facilityKey: string; quantity: number; evidenceRefs: string[] };

function scenarioRequirements(
  input: PlanningCanonicalInput,
  demand: PlanningDemand,
  forcedLeaf: Set<string>,
  equivalence: PlanningEquivalenceRule | null,
) {
  const linesByParent = new Map<string, PlanningBomLine[]>();
  for (const line of input.bomLines) {
    const values = linesByParent.get(line.parentItemKey) ?? [];
    values.push(line);
    linesByParent.set(line.parentItemKey, values);
  }
  const requirements = new Map<string, Requirement>();
  const add = (itemKey: string, quantity: number, evidenceRefs: string[]) => {
    const mapKey = `${itemKey}\u0000${demand.facilityKey}`;
    const current = requirements.get(mapKey) ?? { itemKey, facilityKey: demand.facilityKey, quantity: 0, evidenceRefs: [] };
    current.quantity += quantity;
    current.evidenceRefs.push(...evidenceRefs);
    requirements.set(mapKey, current);
  };
  const explode = (itemKey: string, factor: number, evidenceRefs: string[]) => {
    if (forcedLeaf.has(itemKey)) {
      add(itemKey, factor, evidenceRefs);
      return;
    }
    const lines = [...(linesByParent.get(itemKey) ?? [])].sort((left, right) => left.lineKey.localeCompare(right.lineKey));
    if (!lines.length) {
      add(itemKey, factor, evidenceRefs);
      return;
    }
    for (const line of lines) {
      if (line.isOptional) continue;
      let componentItemKey: string | null = line.componentItemKey;
      const lineEvidence = [...evidenceRefs, ...(line.evidenceRefs ?? [])];
      if (equivalence?.fromItemKey === componentItemKey) {
        componentItemKey = equivalence.action === "REMOVE" ? null : equivalence.toItemKey;
        lineEvidence.push(...equivalence.evidenceRefs);
      }
      if (!componentItemKey) continue;
      explode(componentItemKey, factor * line.quantity * (1 + line.scrapRate), lineEvidence);
    }
  };
  explode(demand.itemKey, 1, demand.evidenceRefs ?? []);
  return [...requirements.values()]
    .map((row) => ({ ...row, evidenceRefs: sortedUnique(row.evidenceRefs) }))
    .sort((left, right) => `${left.itemKey}:${left.facilityKey}`.localeCompare(`${right.itemKey}:${right.facilityKey}`));
}

function scenarioTerm(
  input: PlanningCanonicalInput,
  request: PlanningScenarioRequest,
  itemKey: string,
  facilityKey: string,
) {
  let selectedKey: string | null = null;
  if (request.family === "alternate_supplier" && request.itemKey === itemKey) selectedKey = request.supplierTermKey;
  if (request.family === "assembled_subassembly" && request.subassemblyItemKey === itemKey) selectedKey = request.supplierTermKey;
  const applicable = input.supplierTerms
    .filter((term) => term.itemKey === itemKey && (term.facilityKey === null || term.facilityKey === facilityKey))
    .sort((left, right) => left.termKey.localeCompare(right.termKey));
  if (selectedKey) return applicable.find((term) => term.termKey === selectedKey) ?? null;
  return applicable.find((term) => term.isCurrent) ?? null;
}

function numericSum(values: Array<number | null>) {
  return values.some((value) => value === null) ? null : (values as number[]).reduce((total, value) => total + value, 0);
}

function inventorySummary(input: PlanningCanonicalInput, requirements: Requirement[], unknowns: UnknownInput[]) {
  const pairs = new Map(requirements.map((row) => [`${row.itemKey}\u0000${row.facilityKey}`, row]));
  return [...pairs.values()].sort((left, right) => `${left.itemKey}:${left.facilityKey}`.localeCompare(`${right.itemKey}:${right.facilityKey}`)).map((pair) => {
    const positions = input.inventory.filter((row) => row.itemKey === pair.itemKey && row.facilityKey === pair.facilityKey);
    if (!positions.length) {
      unknowns.push({ code: "inventory_missing", itemKey: pair.itemKey, facilityKey: pair.facilityKey, detail: "No facility inventory position was published." });
      return { itemKey: pair.itemKey, facilityKey: pair.facilityKey, onHand: null, allocated: null, inTransit: null, onOrder: null, netAvailable: null };
    }
    const onHand = numericSum(positions.map((row) => row.onHand));
    const allocated = numericSum(positions.map((row) => row.allocated));
    const inTransit = numericSum(positions.map((row) => row.inTransit));
    const onOrder = numericSum(positions.map((row) => row.onOrder));
    for (const [field, value] of Object.entries({ onHand, allocated, inTransit, onOrder })) {
      if (value === null) unknowns.push({ code: `inventory_${field}_unknown`, itemKey: pair.itemKey, facilityKey: pair.facilityKey, detail: `Published ${field} quantity is unknown.` });
    }
    return {
      itemKey: pair.itemKey,
      facilityKey: pair.facilityKey,
      onHand,
      allocated,
      inTransit,
      onOrder,
      netAvailable: onHand === null || allocated === null || inTransit === null || onOrder === null
        ? null
        : Math.max(0, onHand - allocated + inTransit + onOrder),
    };
  });
}

function availableForDate(
  input: PlanningCanonicalInput,
  request: PlanningScenarioRequest,
  itemKey: string,
  facilityKey: string,
  dueAt: string,
  consumed: number,
  unknowns: UnknownInput[],
) {
  const positions = input.inventory.filter((row) => row.itemKey === itemKey && row.facilityKey === facilityKey);
  let known = 0;
  let uncertain = positions.length === 0;
  if (!positions.length) unknowns.push({ code: "inventory_missing", itemKey, facilityKey, detail: "No facility inventory position was published." });
  for (const position of positions) {
    if (position.onHand === null || position.allocated === null) {
      uncertain = true;
    } else {
      known += Math.max(0, position.onHand - position.allocated);
    }
    for (const [kind, quantity] of [["in_transit", position.inTransit], ["on_order", position.onOrder]] as const) {
      if (quantity === null) {
        uncertain = true;
        unknowns.push({ code: `${kind}_quantity_unknown`, itemKey, facilityKey, detail: `${position.positionKey} has unknown ${kind.replace("_", "-")} quantity.` });
      } else if (quantity > 0 && !position.expectedReceiptAt) {
        uncertain = true;
        unknowns.push({ code: `${kind}_receipt_date_unknown`, itemKey, facilityKey, detail: `${position.positionKey} has no expected receipt date.` });
      } else if (quantity > 0 && timestamp(position.expectedReceiptAt!, "Inventory receipt date") <= timestamp(dueAt, "Demand due date")) {
        known += quantity;
      }
    }
  }

  const term = scenarioTerm(input, request, itemKey, facilityKey);
  if (term) {
    let arrivalAt: number | null = term.availableAt ? timestamp(term.availableAt, "Supplier availability date") : null;
    if (arrivalAt === null && term.leadTimeMaxDays !== null) {
      arrivalAt = timestamp(input.snapshotPublishedAt, "Snapshot date") + term.leadTimeMaxDays * 86_400_000;
    }
    if (term.availableQuantity === null) {
      uncertain = true;
      unknowns.push({ code: "supplier_capacity_unknown", itemKey, facilityKey, supplierTermKey: term.termKey, detail: "Supplier available quantity is unknown." });
    } else if (arrivalAt === null) {
      uncertain = true;
      unknowns.push({ code: "supplier_arrival_unknown", itemKey, facilityKey, supplierTermKey: term.termKey, detail: "Supplier lead time and availability date are unknown." });
    } else if (arrivalAt <= timestamp(dueAt, "Demand due date")) {
      known += term.availableQuantity;
    }
  } else {
    uncertain = true;
    unknowns.push({ code: "supplier_term_missing", itemKey, facilityKey, detail: "No canonical supplier term exists for dated coverage." });
  }
  return { known: Math.max(0, known - consumed), uncertain, term };
}

function fccDisposition(input: PlanningCanonicalInput, requiredItemKeys: Set<string>, unknowns: UnknownInput[]) {
  const profileByItem = new Map(input.fccProfiles.map((profile) => [profile.itemKey, profile]));
  const itemByKey = new Map(input.items.map((item) => [item.itemKey, item]));
  const authorization: string[] = [];
  const constraints: string[] = [];
  const labels: string[] = [];
  const exposure: string[] = [];
  const testingGaps: string[] = [];
  const testingEvidence: string[] = [];
  const review: string[] = [];
  const blocked: string[] = [];
  const evidenceMissing: string[] = [];
  let evidenceRequired = 0;
  let evidenceCount = 0;
  for (const itemKey of [...requiredItemKeys].sort()) {
    const item = itemByKey.get(itemKey);
    if (!item?.requiresFccReview) continue;
    const profile = profileByItem.get(itemKey);
    if (!profile) {
      review.push(`${itemKey}: FCC evidence profile is missing.`);
      unknowns.push({ code: "fcc_profile_missing", itemKey, detail: "FCC evidence profile is missing." });
      evidenceRequired += 5;
      evidenceMissing.push(...["module_authorization", "host_integration", "labeling", "rf_exposure", "testing"].map((kind) => `${itemKey}:${kind}`));
      continue;
    }
    authorization.push(...profile.moduleAuthorizationEvidenceRefs);
    constraints.push(...(profile.hostIntegrationConstraints ?? []));
    labels.push(...profile.labelingEvidenceRefs);
    exposure.push(...profile.rfExposureEvidenceRefs);
    testingEvidence.push(...profile.testingEvidenceRefs);
    testingGaps.push(...profile.testingGaps.map((gap) => `${itemKey}: ${gap}`));
    review.push(...profile.reviewRequirements.map((requirement) => `${itemKey}: ${requirement}`));
    blocked.push(...profile.blockedReasons.map((reason) => `${itemKey}: ${reason}`));
    if (profile.moduleAuthorization === "BLOCKED") blocked.push(`${itemKey}: module authorization evidence is blocked.`);
    if (profile.moduleAuthorization === "MISSING") review.push(`${itemKey}: module authorization evidence is missing.`);
    if (profile.hostIntegrationConstraints === null) review.push(`${itemKey}: host integration constraints are unknown.`);
    if (profile.labeling === "MISSING") review.push(`${itemKey}: labeling evidence is missing.`);
    if (profile.rfExposure === "MISSING") review.push(`${itemKey}: RF exposure evidence is missing.`);
    if (profile.testing === "GAPS") review.push(`${itemKey}: testing gaps require review.`);
    const checks = [
      ["module_authorization", profile.moduleAuthorization === "NOT_APPLICABLE" || (profile.moduleAuthorization === "EVIDENCED" && profile.moduleAuthorizationEvidenceRefs.length > 0)],
      ["host_integration", profile.hostIntegrationConstraints !== null],
      ["labeling", profile.labeling === "NOT_APPLICABLE" || (profile.labeling === "EVIDENCED" && profile.labelingEvidenceRefs.length > 0)],
      ["rf_exposure", profile.rfExposure === "NOT_APPLICABLE" || (profile.rfExposure === "EVIDENCED" && profile.rfExposureEvidenceRefs.length > 0)],
      ["testing", profile.testing === "NOT_APPLICABLE" || (profile.testing === "EVIDENCED" && profile.testingEvidenceRefs.length > 0)],
    ] as const;
    for (const [kind, complete] of checks) {
      evidenceRequired += 1;
      if (complete) evidenceCount += 1;
      else evidenceMissing.push(`${itemKey}:${kind}`);
    }
  }
  return {
    status: (blocked.length ? "blocked" : review.length || testingGaps.length ? "review_required" : "evidence_complete") as FccDisposition,
    blocked: sortedUnique(blocked),
    result: {
      status: (blocked.length ? "blocked" : review.length || testingGaps.length ? "review_required" : "evidence_complete") as FccDisposition,
      moduleAuthorizationEvidence: sortedUnique(authorization),
      hostIntegrationConstraints: sortedUnique(constraints),
      labelingEvidence: sortedUnique(labels),
      rfExposureEvidence: sortedUnique(exposure),
      testingEvidence: sortedUnique(testingEvidence),
      testingGaps: sortedUnique(testingGaps),
      reviewRequirements: sortedUnique(review),
    },
    evidence: { required: evidenceRequired, evidenced: evidenceCount, missing: sortedUnique(evidenceMissing) },
  };
}

function costAndSupplierMetrics(
  input: PlanningCanonicalInput,
  request: PlanningScenarioRequest,
  requirements: Requirement[],
  unknowns: UnknownInput[],
) {
  const costRows: Array<{ requirement: Requirement; term: PlanningSupplierTerm | null }> = requirements.map((requirement) => ({
    requirement,
    term: scenarioTerm(input, request, requirement.itemKey, requirement.facilityKey),
  }));
  const currencies = sortedUnique(costRows.map((row) => row.term?.currency ?? "").filter(Boolean));
  if (currencies.length > 1) unknowns.push({ code: "currency_mismatch", detail: `Scenario uses multiple currencies: ${currencies.join(", ")}.` });
  const missingCost: string[] = [];
  let knownCostFields = 0;
  let requiredCostFields = 0;
  let material = 0;
  let freight = 0;
  let duty = 0;
  const evidence: string[] = [];
  const supplierItems = new Map<string, Set<string>>();
  const leadMins: number[] = [];
  const leadMaxes: number[] = [];
  let leadComplete = true;
  let supplierComplete = true;
  for (const row of costRows) {
    const { requirement, term } = row;
    evidence.push(...requirement.evidenceRefs);
    if (!term) {
      supplierComplete = false;
      leadComplete = false;
      missingCost.push(`${requirement.itemKey}:supplier_term`, `${requirement.itemKey}:unit_price`, `${requirement.itemKey}:freight`, `${requirement.itemKey}:duty`);
      requiredCostFields += 3;
      unknowns.push({ code: "supplier_term_missing", itemKey: requirement.itemKey, facilityKey: requirement.facilityKey, detail: "No current or selected canonical supplier term exists." });
      continue;
    }
    evidence.push(...term.evidenceRefs, ...term.dutyEvidenceRefs);
    const supplierSet = supplierItems.get(term.supplierKey) ?? new Set<string>();
    supplierSet.add(requirement.itemKey);
    supplierItems.set(term.supplierKey, supplierSet);
    requiredCostFields += 3;
    if (term.unitPrice === null) {
      missingCost.push(`${term.termKey}:unit_price`);
      unknowns.push({ code: "unit_price_unknown", itemKey: requirement.itemKey, supplierTermKey: term.termKey, detail: "Unit price is unknown." });
    } else {
      material += requirement.quantity * term.unitPrice;
      knownCostFields += 1;
    }
    if (term.modeledFreightPerUnit === null) {
      missingCost.push(`${term.termKey}:modeled_freight`);
      unknowns.push({ code: "freight_unknown", itemKey: requirement.itemKey, supplierTermKey: term.termKey, detail: "Modeled freight is unknown." });
    } else {
      freight += requirement.quantity * term.modeledFreightPerUnit;
      knownCostFields += 1;
    }
    if (term.evidencedDutyPerUnit === null || !term.dutyEvidenceRefs.length) {
      missingCost.push(`${term.termKey}:evidenced_duty`);
      unknowns.push({ code: term.evidencedDutyPerUnit === null ? "duty_unknown" : "duty_evidence_missing", itemKey: requirement.itemKey, supplierTermKey: term.termKey, detail: "Duty estimate or its evidence is missing." });
    } else {
      duty += requirement.quantity * term.evidencedDutyPerUnit;
      knownCostFields += 1;
    }
    if (term.leadTimeMinDays === null || term.leadTimeMaxDays === null) {
      leadComplete = false;
      unknowns.push({ code: "lead_time_unknown", itemKey: requirement.itemKey, supplierTermKey: term.termKey, detail: "Lead-time range is unknown." });
    } else {
      leadMins.push(term.leadTimeMinDays);
      leadMaxes.push(term.leadTimeMaxDays);
    }
  }
  const costComplete = requiredCostFields > 0 && knownCostFields === requiredCostFields && currencies.length === 1;
  const totalComponents = [...supplierItems.values()].reduce((total, values) => total + values.size, 0);
  const shares = totalComponents
    ? [...supplierItems.values()].map((values) => values.size / totalComponents)
    : [];
  return {
    materialCost: costRows.every((row) => row.term?.unitPrice !== null && row.term !== null) && currencies.length === 1 ? material : null,
    freight: costRows.every((row) => row.term?.modeledFreightPerUnit !== null && row.term !== null) && currencies.length === 1 ? freight : null,
    duty: costRows.every((row) => row.term?.evidencedDutyPerUnit !== null && Boolean(row.term?.dutyEvidenceRefs.length)) && currencies.length === 1 ? duty : null,
    landedCost: costComplete ? material + freight + duty : null,
    currency: currencies.length === 1 ? currencies[0]! : null,
    leadTimeRange: leadComplete && leadMins.length === costRows.length
      ? { minDays: Math.max(...leadMins), maxDays: Math.max(...leadMaxes) }
      : null,
    concentration: supplierComplete && shares.length
      ? { basis: "required_component_count" as const, supplierCount: shares.length, maxShare: Math.max(...shares), hhi: shares.reduce((total, share) => total + share * share, 0) }
      : null,
    completeness: { complete: costComplete, known: knownCostFields, required: requiredCostFields, missing: sortedUnique(missingCost) },
    evidence: sortedUnique(evidence),
  };
}

function scenarioResult(input: PlanningCanonicalInput, request: PlanningScenarioRequest): PlanningScenarioResult {
  const unknowns: UnknownInput[] = [];
  const blockers: string[] = [];
  let equivalence: PlanningEquivalenceRule | null = null;
  const forcedLeaf = new Set<string>();
  if (request.family === "approved_equivalence") {
    equivalence = input.equivalenceRules.find((rule) => rule.ruleKey === request.equivalenceRuleKey) ?? null;
    if (!equivalence) blockers.push(`Equivalence rule ${request.equivalenceRuleKey} was not found.`);
    else if (equivalence.status !== "APPROVED") blockers.push(`Equivalence rule ${equivalence.ruleKey} is not approved.`);
    else if (equivalence.action === "REPLACE" && !equivalence.toItemKey) blockers.push(`Equivalence rule ${equivalence.ruleKey} has no replacement item.`);
    if (equivalence?.status === "APPROVED") {
      const from = input.items.find((item) => item.itemKey === equivalence!.fromItemKey);
      const to = equivalence.toItemKey ? input.items.find((item) => item.itemKey === equivalence!.toItemKey) : null;
      if (!from) blockers.push(`Equivalence rule ${equivalence.ruleKey} source item is not in the snapshot.`);
      if (equivalence.action === "REPLACE" && !to) blockers.push(`Equivalence rule ${equivalence.ruleKey} replacement item is not in the snapshot.`);
      if (from && to && normalizedUnit(from.unitOfMeasure) !== normalizedUnit(to.unitOfMeasure)) {
        blockers.push(`Equivalence rule ${equivalence.ruleKey} is not unit-compatible.`);
      }
    }
  }
  if (request.family === "assembled_subassembly") forcedLeaf.add(request.subassemblyItemKey);

  const openDemands = input.demands
    .filter((demand) => demand.status === "OPEN" && demand.itemKey === input.productItemKey)
    .sort((left, right) => timestamp(left.dueAt, "Demand date") - timestamp(right.dueAt, "Demand date")
      || right.priority - left.priority
      || left.demandKey.localeCompare(right.demandKey));
  const perDemand = new Map(openDemands.map((demand) => [demand.demandKey, scenarioRequirements(input, demand, forcedLeaf, equivalence?.status === "APPROVED" ? equivalence : null)]));
  const totalRequirements = new Map<string, Requirement>();
  for (const demand of openDemands) {
    for (const perUnit of perDemand.get(demand.demandKey) ?? []) {
      const key = `${perUnit.itemKey}\u0000${perUnit.facilityKey}`;
      const current = totalRequirements.get(key) ?? { ...perUnit, quantity: 0, evidenceRefs: [] };
      current.quantity += perUnit.quantity * demand.quantity;
      current.evidenceRefs.push(...perUnit.evidenceRefs);
      totalRequirements.set(key, current);
    }
  }
  const requirements = [...totalRequirements.values()]
    .map((row) => ({ ...row, evidenceRefs: sortedUnique(row.evidenceRefs) }))
    .sort((left, right) => `${left.itemKey}:${left.facilityKey}`.localeCompare(`${right.itemKey}:${right.facilityKey}`));

  if (request.family === "alternate_supplier") {
    const term = input.supplierTerms.find((row) => row.termKey === request.supplierTermKey);
    if (!term || term.itemKey !== request.itemKey) blockers.push("The alternate supplier term does not belong to the requested component.");
    if (!requirements.some((row) => row.itemKey === request.itemKey)) blockers.push("The alternate supplier component is not required by this product scenario.");
  }
  if (request.family === "assembled_subassembly") {
    const item = input.items.find((row) => row.itemKey === request.subassemblyItemKey);
    const term = input.supplierTerms.find((row) => row.termKey === request.supplierTermKey);
    if (!item || item.itemType !== "SUBASSEMBLY") blockers.push("The assembled replacement must reference a canonical subassembly.");
    if (!term || term.itemKey !== request.subassemblyItemKey) blockers.push("The assembled subassembly supplier term does not match the subassembly.");
    if (!requirements.some((row) => row.itemKey === request.subassemblyItemKey)) blockers.push("The selected subassembly is not required by this product scenario.");
  }

  const inventory = inventorySummary(input, requirements, unknowns);
  const consumed = new Map<string, number>();
  const facilityUncertain = new Set<string>();
  const coverageRows: PlanningScenarioResult["buildableQuantityByDemandDate"] = [];
  const shortages: PlanningScenarioResult["shortages"] = [];
  for (const demand of openDemands) {
    if (facilityUncertain.has(demand.facilityKey)) {
      coverageRows.push({ demandKey: demand.demandKey, dueAt: demand.dueAt, requiredQuantity: demand.quantity, buildableQuantity: null, coverage: null });
      continue;
    }
    const perUnit = perDemand.get(demand.demandKey) ?? [];
    let maxBuildable = demand.quantity;
    let isUnknown = false;
    const availability = perUnit.map((requirement) => {
      const key = `${requirement.itemKey}\u0000${requirement.facilityKey}`;
      const result = availableForDate(input, request, requirement.itemKey, requirement.facilityKey, demand.dueAt, consumed.get(key) ?? 0, unknowns);
      const supported = Math.floor((result.known + 1e-9) / requirement.quantity);
      maxBuildable = Math.min(maxBuildable, supported);
      if (result.uncertain && supported < demand.quantity) isUnknown = true;
      return { requirement, key, ...result };
    });
    if (isUnknown) {
      facilityUncertain.add(demand.facilityKey);
      coverageRows.push({ demandKey: demand.demandKey, dueAt: demand.dueAt, requiredQuantity: demand.quantity, buildableQuantity: null, coverage: null });
      continue;
    }
    const buildable = Math.max(0, maxBuildable);
    coverageRows.push({ demandKey: demand.demandKey, dueAt: demand.dueAt, requiredQuantity: demand.quantity, buildableQuantity: buildable, coverage: demand.quantity ? buildable / demand.quantity : 1 });
    for (const row of availability) {
      consumed.set(row.key, (consumed.get(row.key) ?? 0) + buildable * row.requirement.quantity);
      const required = demand.quantity * row.requirement.quantity;
      if (row.known + 1e-9 < required) shortages.push({
        demandKey: demand.demandKey,
        dueAt: demand.dueAt,
        itemKey: row.requirement.itemKey,
        facilityKey: row.requirement.facilityKey,
        shortageQuantity: required - row.known,
      });
    }
  }

  const requiredItemKeys = new Set(requirements.map((row) => row.itemKey));
  requiredItemKeys.add(input.productItemKey);
  const fcc = fccDisposition(input, requiredItemKeys, unknowns);
  blockers.push(...fcc.blocked);
  const costs = costAndSupplierMetrics(input, request, requirements, unknowns);
  const evidenceMissing: string[] = [];
  let evidenceRequired = 0;
  let evidenceCount = 0;
  for (const requirement of requirements) {
    evidenceRequired += 1;
    const term = scenarioTerm(input, request, requirement.itemKey, requirement.facilityKey);
    if (requirement.evidenceRefs.length || term?.evidenceRefs.length) evidenceCount += 1;
    else evidenceMissing.push(`${requirement.itemKey}:${requirement.facilityKey}`);
  }
  const knownCoverage = coverageRows.every((row) => row.buildableQuantity !== null);
  const buildableUnits = knownCoverage ? coverageRows.reduce((total, row) => total + (row.buildableQuantity ?? 0), 0) : null;
  const requiredUnits = coverageRows.reduce((total, row) => total + row.requiredQuantity, 0);
  const affected = coverageRows.find((row) => row.buildableQuantity !== null && row.buildableQuantity < row.requiredQuantity) ?? null;
  const assumptions = [
    "Optional BOM lines do not constrain buildability.",
    "Scrap is applied multiplicatively at each BOM edge.",
    "Facility inventory is not transferred between facilities.",
    "Supplier availability counts by a demand date only when capacity and a conservative arrival date are known.",
    "Landed cost is comparable only when price, modeled freight, evidenced duty, and currency are complete for every required leaf item.",
  ];
  const recommendationReasons = [
    blockers.length ? "Rejected because the scenario has compliance or approval blockers." : "No blocking compliance or approval condition was found.",
    buildableUnits === null ? "Units available by the required dates remain unknown." : `Units available by the required dates: ${buildableUnits}.`,
    costs.landedCost === null ? "Landed cost is not used for ranking because required inputs are incomplete." : `Complete landed cost is ${costs.landedCost} ${costs.currency}.`,
    costs.leadTimeRange ? `Conservative lead-time range ends at ${costs.leadTimeRange.maxDays} days.` : "Lead time remains unknown and cannot improve ranking.",
    costs.concentration ? `Largest supplier share is ${costs.concentration.maxShare}.` : "Supplier concentration remains unknown.",
  ];
  return {
    scenarioKey: request.scenarioKey,
    family: request.family,
    blocked: blockers.length > 0,
    complianceBlockers: sortedUnique(blockers),
    materialCost: costs.materialCost,
    modeledFreight: costs.freight,
    evidencedDutyEstimate: costs.duty,
    landedCost: costs.landedCost,
    currency: costs.currency,
    leadTimeRange: costs.leadTimeRange,
    buildableUnits,
    buildableQuantityByDemandDate: coverageRows,
    netAvailableInventory: inventory,
    shortages: shortages.sort((left, right) => `${left.dueAt}:${left.demandKey}:${left.itemKey}`.localeCompare(`${right.dueAt}:${right.demandKey}:${right.itemKey}`)),
    earliestAffectedDemand: affected ? { demandKey: affected.demandKey, dueAt: affected.dueAt } : null,
    demandDateCoverage: knownCoverage ? (requiredUnits ? buildableUnits! / requiredUnits : 1) : null,
    supplierConcentration: costs.concentration,
    evidenceCompleteness: {
      complete: evidenceRequired + fcc.evidence.required === evidenceCount + fcc.evidence.evidenced,
      evidenced: evidenceCount + fcc.evidence.evidenced,
      required: evidenceRequired + fcc.evidence.required,
      missing: sortedUnique([...evidenceMissing, ...fcc.evidence.missing]),
    },
    landedCostCompleteness: costs.completeness,
    cashExposure: costs.landedCost,
    fcc: fcc.result,
    assumptions,
    unknowns: sortedUnknowns(unknowns),
    evidenceReferences: sortedUnique([...costs.evidence, ...fcc.result.moduleAuthorizationEvidence, ...fcc.result.labelingEvidence, ...fcc.result.rfExposureEvidence, ...fcc.result.testingEvidence]),
    recommendationReasons,
  };
}

function nullableDelta(left: number | null, right: number | null) {
  return left === null || right === null ? null : right - left;
}

function recommendationComparator(left: PlanningScenarioResult, right: PlanningScenarioResult) {
  if (left.blocked !== right.blocked) return left.blocked ? 1 : -1;
  const leftBuildable = left.buildableUnits ?? -1;
  const rightBuildable = right.buildableUnits ?? -1;
  if (leftBuildable !== rightBuildable) return rightBuildable - leftBuildable;
  const leftComplete = left.landedCostCompleteness.complete && left.landedCost !== null;
  const rightComplete = right.landedCostCompleteness.complete && right.landedCost !== null;
  if (leftComplete && rightComplete && left.landedCost !== right.landedCost) return left.landedCost! - right.landedCost!;
  if (leftComplete !== rightComplete) return leftComplete ? -1 : 1;
  const leftLead = left.leadTimeRange?.maxDays ?? Number.POSITIVE_INFINITY;
  const rightLead = right.leadTimeRange?.maxDays ?? Number.POSITIVE_INFINITY;
  if (leftLead !== rightLead) return leftLead - rightLead;
  const leftConcentration = left.supplierConcentration?.maxShare ?? Number.POSITIVE_INFINITY;
  const rightConcentration = right.supplierConcentration?.maxShare ?? Number.POSITIVE_INFINITY;
  if (leftConcentration !== rightConcentration) return leftConcentration - rightConcentration;
  return left.scenarioKey.localeCompare(right.scenarioKey);
}

export function runSupplyPlanningEngine(
  canonicalInput: PlanningCanonicalInput,
  requests: PlanningScenarioRequest[],
): SupplyPlanningOutput {
  validateInput(canonicalInput, requests);
  const normalizedRequests = [...requests].sort((left, right) => left.scenarioKey.localeCompare(right.scenarioKey));
  const normalizedInput = {
    engineVersion: SUPPLY_PLANNING_ENGINE_VERSION,
    canonicalInput: {
      ...canonicalInput,
      items: [...canonicalInput.items].sort((left, right) => left.itemKey.localeCompare(right.itemKey)),
      bomLines: [...canonicalInput.bomLines].sort((left, right) => left.lineKey.localeCompare(right.lineKey)),
      inventory: [...canonicalInput.inventory].sort((left, right) => left.positionKey.localeCompare(right.positionKey)),
      demands: [...canonicalInput.demands].sort((left, right) => left.demandKey.localeCompare(right.demandKey)),
      supplierTerms: [...canonicalInput.supplierTerms].sort((left, right) => left.termKey.localeCompare(right.termKey)),
      equivalenceRules: [...canonicalInput.equivalenceRules].sort((left, right) => left.ruleKey.localeCompare(right.ruleKey)),
      fccProfiles: [...canonicalInput.fccProfiles].sort((left, right) => left.itemKey.localeCompare(right.itemKey)),
    },
    requests: normalizedRequests,
  };
  const normalizedInputHash = supplyPlanningHash(normalizedInput);
  const scenarios = normalizedRequests.map((request) => scenarioResult(canonicalInput, request));
  const baseline = scenarios.find((scenario) => scenario.family === "current_purchasing_plan") ?? null;
  const comparisons: PlanningComparison[] = baseline ? scenarios.filter((scenario) => scenario.scenarioKey !== baseline.scenarioKey).map((candidate) => ({
    baselineScenarioKey: baseline.scenarioKey,
    candidateScenarioKey: candidate.scenarioKey,
    materialCostDelta: nullableDelta(baseline.materialCost, candidate.materialCost),
    landedCostDelta: nullableDelta(baseline.landedCost, candidate.landedCost),
    buildableUnitsDelta: nullableDelta(baseline.buildableUnits, candidate.buildableUnits),
    leadTimeMaxDaysDelta: nullableDelta(baseline.leadTimeRange?.maxDays ?? null, candidate.leadTimeRange?.maxDays ?? null),
    supplierConcentrationMaxShareDelta: nullableDelta(baseline.supplierConcentration?.maxShare ?? null, candidate.supplierConcentration?.maxShare ?? null),
    candidateBlocked: candidate.blocked,
    unknowns: candidate.unknowns,
  })).sort((left, right) => left.candidateScenarioKey.localeCompare(right.candidateScenarioKey)) : [];
  const recommendationOrder = [...scenarios].sort(recommendationComparator).map((scenario) => scenario.scenarioKey);
  const assumptions = sortedUnique(scenarios.flatMap((scenario) => scenario.assumptions));
  const withoutOutputHash = {
    engineVersion: SUPPLY_PLANNING_ENGINE_VERSION,
    snapshotId: canonicalInput.snapshotId,
    snapshotHash: canonicalInput.snapshotHash,
    productItemKey: canonicalInput.productItemKey,
    assumptions,
    scenarios,
    comparisons,
    recommendationOrder,
    normalizedInputHash,
  };
  return { ...withoutOutputHash, deterministicOutputHash: supplyPlanningHash(withoutOutputHash) };
}
