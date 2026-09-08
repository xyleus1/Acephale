export const SUPPLY_STATE_SCHEMA_VERSION = 1 as const;

export const SUPPLY_STATE_PROJECTION_TYPES = [
  "company_context_v1",
  "procurement_request_v1",
  "supplier_relationship_v1",
  "item_supply_v1",
  "workspace_supply_v1",
] as const;

export type SupplyStateProjectionType = (typeof SUPPLY_STATE_PROJECTION_TYPES)[number];

export type SupplyStateScope =
  | {
      type: "company";
      officeId: string;
      companyId: string;
      workspaceId?: string | null;
    }
  | {
      type: "procurement_request";
      officeId: string;
      companyId: string;
      customerId: string;
      orderId: string;
      workspaceId?: string | null;
    }
  | {
      type: "supplier";
      officeId: string;
      companyId?: string | null;
      workspaceId?: string | null;
      supplierId?: string | null;
      supplierKey?: string | null;
      orderId?: string | null;
      vendorId?: string | null;
    }
  | {
      type: "item";
      officeId: string;
      companyId: string;
      workspaceId: string;
      itemId?: string | null;
      itemKey?: string | null;
    }
  | {
      type: "workspace";
      officeId: string;
      workspaceId: string;
    };

export type SupplyStateSource =
  | "APP_DB"
  | "WORKFLOW_DB"
  | "EMAIL_LEDGER"
  | "COMPANY_BRAIN";

export type SupplyWorldEvidenceRef =
  | { kind: "company_context"; id: string; contentHash?: string | null }
  | { kind: "supply_snapshot"; id: string; sourceHash: string }
  | { kind: "supply_evidence"; id: string; contentHash: string }
  | { kind: "supply_profile_fact"; id: string; contentHash: string }
  | { kind: "supply_price_observation"; id: string; contentHash: string }
  | { kind: "planning_result"; id: string; outputHash: string }
  | { kind: "supply_decision"; id: string; proposalHash?: string | null }
  | { kind: "execution_task"; id: string; inputHash: string }
  | { kind: "execution_event"; id: string; payloadHash: string }
  | { kind: "procurement_order"; id: string; valueHash: string }
  | { kind: "procurement_vendor"; id: string; valueHash: string }
  | { kind: "procurement_message"; id: string; valueHash: string }
  | { kind: "email_message"; id: string; providerMessageId?: string | null }
  | { kind: "knowledge_object"; id: string }
  | { kind: "knowledge_chunk"; id: string }
  | { kind: "memory_event"; id: string };

export type SupplyStateDependency = {
  key: string;
  source: SupplyStateSource;
  entityType: string;
  entityRef: string;
  version: string;
  valueHash: string;
  policy: "STRICT" | "ADVISORY";
  reason: string;
  evidenceRefs: SupplyWorldEvidenceRef[];
};

export type SupplyWorldStatePacket = {
  schemaVersion: 1;
  compilerVersion: string;
  scope: SupplyStateScope;
  objective: string;
  compiledAt: string;
  currentState: Record<string, unknown>;
  derivedState: Record<string, unknown>;
  openLoops: Array<Record<string, unknown>>;
  uncertainties: Array<Record<string, unknown>>;
  evidenceRefs: SupplyWorldEvidenceRef[];
  dependencies: SupplyStateDependency[];
  sourceFingerprint: string;
  packetHash: string;
  diagnostics: {
    projectionHit: boolean;
    sourceCounts: Record<string, number>;
    timingsMs: Record<string, number>;
  };
};

export type SupplyStateDependencyChange = {
  key: string;
  oldVersion: string;
  newVersion: string;
  oldHash: string;
  newHash: string;
  reason: string;
};

export type SupplyStateValidationResult = {
  valid: boolean;
  checkedAt: string;
  changedStrict: SupplyStateDependencyChange[];
  changedAdvisory: SupplyStateDependencyChange[];
};

function requiredScopeSegment(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\r\n\0]/.test(normalized)) {
    throw new Error(`${label} must contain 1 to 512 characters.`);
  }
  return encodeURIComponent(normalized);
}

function optionalScopeSegment(value: string | null | undefined, label: string) {
  return value == null || !value.trim() ? "_" : requiredScopeSegment(value, label);
}

function boundedScopeRef(parts: Array<[string, string]>) {
  const value = parts.map(([key, part]) => `${key}=${part}`).join(";");
  if (value.length > 2_000) throw new Error("Supply state scope reference is too long.");
  return value;
}

export function supplyStateScopeRef(scope: SupplyStateScope) {
  if (scope.type === "company") {
    return boundedScopeRef([
      ["company", requiredScopeSegment(scope.companyId, "Company ID")],
      ["workspace", optionalScopeSegment(scope.workspaceId, "Workspace ID")],
    ]);
  }
  if (scope.type === "procurement_request") {
    return boundedScopeRef([
      ["company", requiredScopeSegment(scope.companyId, "Company ID")],
      ["customer", requiredScopeSegment(scope.customerId, "Workflow customer ID")],
      ["order", requiredScopeSegment(scope.orderId, "Procurement order ID")],
      ["workspace", optionalScopeSegment(scope.workspaceId, "Workspace ID")],
    ]);
  }
  if (scope.type === "supplier") {
    if (!scope.supplierId?.trim() && !scope.supplierKey?.trim() && !scope.vendorId?.trim()) {
      throw new Error("Supplier state scope requires a supplier or request vendor identity.");
    }
    if (scope.supplierKey?.trim() && !scope.workspaceId?.trim()) {
      throw new Error("A workspace supplier key requires its exact workspace identity.");
    }
    if (Boolean(scope.orderId?.trim()) !== Boolean(scope.vendorId?.trim())) {
      throw new Error("A request-specific supplier scope requires both order and vendor identity.");
    }
    return boundedScopeRef([
      ["company", optionalScopeSegment(scope.companyId, "Company ID")],
      ["workspace", optionalScopeSegment(scope.workspaceId, "Workspace ID")],
      ["supplier", optionalScopeSegment(scope.supplierId, "Supplier ID")],
      ["supplierKey", optionalScopeSegment(scope.supplierKey, "Supplier key")],
      ["order", optionalScopeSegment(scope.orderId, "Procurement order ID")],
      ["vendor", optionalScopeSegment(scope.vendorId, "Procurement vendor ID")],
    ]);
  }
  if (scope.type === "item") {
    if (!scope.itemId?.trim() && !scope.itemKey?.trim()) {
      throw new Error("Item state scope requires an item identity.");
    }
    return boundedScopeRef([
      ["company", requiredScopeSegment(scope.companyId, "Company ID")],
      ["workspace", requiredScopeSegment(scope.workspaceId, "Workspace ID")],
      ["item", optionalScopeSegment(scope.itemId, "Item ID")],
      ["itemKey", optionalScopeSegment(scope.itemKey, "Item key")],
    ]);
  }
  return boundedScopeRef([
    ["workspace", requiredScopeSegment(scope.workspaceId, "Workspace ID")],
  ]);
}

export function supplyStateWorkspaceId(scope: SupplyStateScope) {
  if (scope.type === "workspace" || scope.type === "item") return scope.workspaceId;
  return scope.workspaceId?.trim() || null;
}
