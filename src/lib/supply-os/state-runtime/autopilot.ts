import "server-only";

import type { AutopilotVendorState } from "@/lib/procurement-autopilot-plan";
import type { ProcurementOrderVendor } from "@/lib/procurement-workflow";
import {
  hashSupplyStateDependencies,
  hashSupplyStateValue,
  hashSupplyWorldStatePacket,
} from "./canonicalize";
import type {
  SupplyStateDependency,
  SupplyStateScope,
  SupplyWorldEvidenceRef,
  SupplyWorldStatePacket,
} from "./types";
import { supplyStateScopeRef } from "./types";

const PROCUREMENT_VENDOR_PREFIXES = [
  "procurement.vendor:",
  "procurement.vendor_quote:",
  "procurement.vendor_latest_message:",
  "procurement.vendor_triage:",
  "procurement.vendor_saved_draft:",
] as const;

const REQUIRED_VENDOR_STATE_PREFIXES = [
  "procurement.vendor:",
  "procurement.vendor_quote:",
  "procurement.vendor_latest_message:",
  "procurement.vendor_triage:",
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function packetVendorIdentity(vendor: Record<string, unknown>) {
  return {
    id: vendor.id,
    supplierRegistryId: vendor.supplierRegistryId,
    name: vendor.name,
    website: vendor.website,
    contact: vendor.contact,
    status: vendor.status,
    contacted: vendor.contacted,
  };
}

function actionVendorIdentity(vendor: Pick<
  ProcurementOrderVendor,
  "id" | "supplierRegistryId" | "name" | "website" | "contact" | "status" | "contacted"
>) {
  return {
    id: vendor.id,
    supplierRegistryId: vendor.supplierRegistryId,
    name: vendor.name,
    website: vendor.website,
    contact: vendor.contact,
    status: vendor.status,
    contacted: vendor.contacted,
  };
}

function vendorIdFromDependency(dependency: SupplyStateDependency) {
  if (!PROCUREMENT_VENDOR_PREFIXES.some((prefix) => dependency.key.startsWith(prefix))) return null;
  const separator = dependency.key.lastIndexOf(":");
  return separator >= 0 ? dependency.key.slice(separator + 1) : null;
}

function belongsToVendor(dependency: SupplyStateDependency, vendorId: string) {
  const dependencyVendorId = vendorIdFromDependency(dependency);
  return dependencyVendorId === null || dependencyVendorId === vendorId;
}

function evidenceIdentity(reference: SupplyWorldEvidenceRef) {
  return `${reference.kind}:${reference.id}`;
}

function evidenceForDependencies(
  packet: SupplyWorldStatePacket,
  dependencies: SupplyStateDependency[],
  vendorId: string,
) {
  const selected = new Map<string, SupplyWorldEvidenceRef>();
  for (const dependency of dependencies) {
    for (const reference of dependency.evidenceRefs) selected.set(evidenceIdentity(reference), reference);
  }
  for (const reference of packet.evidenceRefs) {
    if (reference.kind === "procurement_vendor" && reference.id !== vendorId) continue;
    if (reference.kind === "procurement_message" && !selected.has(evidenceIdentity(reference))) continue;
    selected.set(evidenceIdentity(reference), reference);
  }
  return [...selected.values()];
}

function scopedVendorRecords(values: Array<Record<string, unknown>>, vendorId: string) {
  return values.filter((value) => typeof value.vendorId !== "string" || value.vendorId === vendorId);
}

function rehashPacket(packet: SupplyWorldStatePacket): SupplyWorldStatePacket {
  const sourceFingerprint = hashSupplyStateDependencies(packet.dependencies);
  const next = { ...packet, sourceFingerprint, packetHash: "" };
  return { ...next, packetHash: hashSupplyWorldStatePacket(next) };
}

export function assertProcurementVendorStateReadBinding(input: {
  stateRead: {
    scopeType: string;
    scopeRef: string;
    dependencyManifest: unknown;
  };
  scope: Extract<SupplyStateScope, { type: "procurement_request" }>;
  vendorId: string;
  requireSavedDraft: boolean;
}) {
  const expectedScopeRef = supplyStateScopeRef(input.scope);
  if (input.stateRead.scopeType !== "procurement_request" || input.stateRead.scopeRef !== expectedScopeRef) {
    throw new Error("The commercial state read is bound to a different procurement request.");
  }
  if (!Array.isArray(input.stateRead.dependencyManifest)) {
    throw new Error("The commercial state read dependency manifest is invalid.");
  }
  const suffix = `${input.scope.customerId}:${input.scope.orderId}:${input.vendorId}`;
  const dependencies = input.stateRead.dependencyManifest.filter((value): value is SupplyStateDependency => (
    Boolean(value) && typeof value === "object" && !Array.isArray(value)
      && typeof (value as { key?: unknown }).key === "string"
  ));
  const requestDependencies = [
    `procurement.order:${input.scope.customerId}:${input.scope.orderId}`,
    `procurement.order_request_context:${input.scope.customerId}:${input.scope.orderId}`,
  ];
  for (const key of requestDependencies) {
    const dependency = dependencies.find((candidate) => candidate.key === key);
    if (!dependency || dependency.policy !== "STRICT") {
      throw new Error(`The commercial state read is missing the exact ${key.split(":")[0]} dependency.`);
    }
  }
  const required = [
    ...REQUIRED_VENDOR_STATE_PREFIXES,
    ...(input.requireSavedDraft ? ["procurement.vendor_saved_draft:" as const] : []),
  ];
  for (const prefix of required) {
    const dependency = dependencies.find((candidate) => candidate.key === `${prefix}${suffix}`);
    if (!dependency || dependency.policy !== "STRICT") {
      throw new Error(`The commercial state read is missing the exact ${prefix.slice(0, -1)} dependency.`);
    }
  }
  const foreignVendorDependency = dependencies.find((dependency) => (
    PROCUREMENT_VENDOR_PREFIXES.some((prefix) => dependency.key.startsWith(prefix))
      && !dependency.key.endsWith(`:${input.vendorId}`)
  ));
  if (foreignVendorDependency) {
    throw new Error("The commercial state read contains a different supplier's dependencies.");
  }
}

export function assertProcurementVendorActionMatchesStatePacket(input: {
  packet: unknown;
  vendorId: string;
  vendor: Pick<
    ProcurementOrderVendor,
    "id" | "supplierRegistryId" | "name" | "website" | "contact" | "status" | "contacted"
  >;
  sourceMessageId: string;
  recipient: string;
  variant?: "REPLY" | "CHASE";
}) {
  const packet = record(input.packet);
  const currentState = record(packet.currentState);
  const request = record(currentState.procurementRequest);
  const vendors = Array.isArray(request.vendors) ? request.vendors.map(record) : [];
  const selected = vendors.filter((vendor) => vendor.id === input.vendorId);
  if (selected.length !== 1) {
    throw new Error("The commercial state packet does not contain the selected supplier exactly once.");
  }
  const packetVendor = selected[0]!;
  if (input.vendor.id !== input.vendorId
      || hashSupplyStateValue(packetVendorIdentity(packetVendor)) !== hashSupplyStateValue(actionVendorIdentity(input.vendor))) {
    throw new Error("The selected supplier identity changed after the commercial state packet was compiled.");
  }
  const conversation = record(packetVendor.conversation);
  const latest = record(conversation.latestMessage);
  const anchor = input.variant === "CHASE" ? record(conversation.latestInboundMessage) : latest;
  const sourceMessageId = input.sourceMessageId.trim();
  if (!sourceMessageId || anchor.id !== sourceMessageId) {
    throw new Error("The selected supplier message is not the latest message in the commercial state packet.");
  }
  if (anchor.direction !== "INBOUND") {
    throw new Error("The latest supplier message in the commercial state packet is not inbound.");
  }
  if (input.variant === "CHASE" && latest.direction !== "OUTBOUND") {
    throw new Error("A supplier follow up requires the latest human message to be outbound.");
  }
  const sender = normalizedEmail(anchor.fromEmail);
  const recipient = normalizedEmail(input.recipient);
  if (!sender || !recipient || sender !== recipient) {
    throw new Error("The supplier recipient does not match the latest inbound sender in the commercial state packet.");
  }
}

export function autopilotVendorStatesFromPacket(packet: SupplyWorldStatePacket): AutopilotVendorState[] {
  if (packet.scope.type !== "procurement_request") {
    throw new Error("Autopilot vendor state requires a procurement request packet.");
  }
  const request = record(packet.currentState.procurementRequest);
  const vendors = Array.isArray(request.vendors) ? request.vendors : [];
  return vendors.flatMap((value) => {
    const vendor = record(value);
    const vendorId = typeof vendor.id === "string" ? vendor.id : "";
    const vendorName = typeof vendor.name === "string" ? vendor.name : "";
    if (!vendorId || !vendorName) return [];
    const conversation = record(vendor.conversation);
    const latest = record(conversation.latestMessage);
    const triage = record(vendor.triage);
    const savedDraft = record(vendor.savedDraft);
    const draftTaskId = typeof savedDraft.id === "string" ? savedDraft.id : "";
    const draftInputHash = typeof savedDraft.inputHash === "string" ? savedDraft.inputHash : "";
    return [{
      vendorId,
      vendorName,
      lastDirection: latest.direction === "INBOUND" || latest.direction === "OUTBOUND"
        ? latest.direction
        : null,
      inboundKind: typeof triage.kind === "string"
        ? triage.kind as AutopilotVendorState["inboundKind"]
        : null,
      triageDecision: typeof triage.decision === "string"
        ? triage.decision as AutopilotVendorState["triageDecision"]
        : null,
      hasDraft: Boolean(vendor.savedDraft),
      hasQuote: Boolean(vendor.quote),
      draftBinding: draftTaskId && draftInputHash
        ? { taskId: draftTaskId, inputHash: draftInputHash }
        : null,
    }];
  });
}

export function mergeAutopilotVendorStates(
  packetStates: readonly AutopilotVendorState[],
  completeStates: readonly AutopilotVendorState[],
) {
  const packetByVendor = new Map(packetStates.map((state) => [state.vendorId, state]));
  return completeStates.map((state) => packetByVendor.get(state.vendorId) ?? state);
}

export function procurementVendorStatePacket(input: {
  packet: SupplyWorldStatePacket;
  vendorId: string;
  objective: string;
  includeSavedDraftDependency?: boolean;
}): SupplyWorldStatePacket {
  if (input.packet.scope.type !== "procurement_request") {
    throw new Error("Vendor state reads require a procurement request packet.");
  }
  const request = record(input.packet.currentState.procurementRequest);
  const vendors = Array.isArray(request.vendors) ? request.vendors : [];
  const selectedVendor = vendors.find((value) => record(value).id === input.vendorId);
  if (!selectedVendor) throw new Error("The vendor is not present in the compiled procurement request state.");
  const dependencies = input.packet.dependencies.filter((dependency) => (
    belongsToVendor(dependency, input.vendorId)
      && (input.includeSavedDraftDependency !== false
        || !dependency.key.startsWith("procurement.vendor_saved_draft:"))
  ));
  return rehashPacket({
    ...input.packet,
    objective: input.objective.trim().slice(0, 2_000),
    currentState: {
      ...input.packet.currentState,
      procurementRequest: { ...request, vendors: [selectedVendor], vendorCount: 1 },
    },
    openLoops: scopedVendorRecords(input.packet.openLoops, input.vendorId),
    uncertainties: scopedVendorRecords(input.packet.uncertainties, input.vendorId),
    evidenceRefs: evidenceForDependencies(input.packet, dependencies, input.vendorId),
    dependencies,
    sourceFingerprint: "",
    packetHash: "",
  });
}

export function procurementVendorPacketWithSavedDraft(input: {
  packet: SupplyWorldStatePacket;
  customerId: string;
  orderId: string;
  vendorId: string;
  draft: { id: string; inputHash: string; status: string };
  objective: string;
}): SupplyWorldStatePacket {
  if (input.packet.scope.type !== "procurement_request"
    || input.packet.scope.customerId !== input.customerId
    || input.packet.scope.orderId !== input.orderId) {
    throw new Error("The saved draft identity does not match the procurement request packet.");
  }
  const base = procurementVendorStatePacket({
    packet: input.packet,
    vendorId: input.vendorId,
    objective: input.objective,
    includeSavedDraftDependency: false,
  });
  const key = `procurement.vendor_saved_draft:${input.customerId}:${input.orderId}:${input.vendorId}`;
  const value = {
    id: input.draft.id,
    inputHash: input.draft.inputHash,
    status: input.draft.status,
  };
  const reference: SupplyWorldEvidenceRef = {
    kind: "execution_task",
    id: input.draft.id,
    inputHash: input.draft.inputHash,
  };
  const dependency: SupplyStateDependency = {
    key,
    source: "APP_DB",
    entityType: "SupplyExecutionTask",
    entityRef: input.draft.id,
    version: input.draft.inputHash,
    valueHash: hashSupplyStateValue(value),
    policy: "STRICT",
    reason: "The current saved supplier draft changed or was replaced.",
    evidenceRefs: [reference],
  };
  const request = record(base.currentState.procurementRequest);
  const vendor = record(Array.isArray(request.vendors) ? request.vendors[0] : null);
  return rehashPacket({
    ...base,
    currentState: {
      ...base.currentState,
      procurementRequest: {
        ...request,
        vendors: [{ ...vendor, savedDraft: value }],
      },
    },
    dependencies: [...base.dependencies, dependency].sort((left, right) => left.key.localeCompare(right.key)),
    evidenceRefs: [...base.evidenceRefs, reference],
    sourceFingerprint: "",
    packetHash: "",
  });
}
