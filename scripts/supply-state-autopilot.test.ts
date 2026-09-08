import assert from "node:assert/strict";
import {
  autopilotDraftBindingMatches,
} from "../src/lib/procurement-autopilot-plan";
import {
  assertProcurementVendorActionMatchesStatePacket,
  assertProcurementVendorStateReadBinding,
  autopilotVendorStatesFromPacket,
  procurementVendorPacketWithSavedDraft,
  procurementVendorStatePacket,
} from "../src/lib/supply-os/state-runtime/autopilot";
import {
  hashSupplyStateDependencies,
  hashSupplyStateValue,
  hashSupplyWorldStatePacket,
} from "../src/lib/supply-os/state-runtime/canonicalize";
import {
  supplyStateScopeRef,
  type SupplyStateDependency,
  type SupplyWorldEvidenceRef,
  type SupplyWorldStatePacket,
} from "../src/lib/supply-os/state-runtime/types";
import { procurementReplyExistingTaskDisposition } from "../src/lib/procurement-reply-send";
import type { ProcurementConversationMessage } from "../src/lib/procurement-conversation-model";
import { createSupplyStateFactRegistry, readSupplyStateDependency } from "../src/lib/supply-os/state-runtime/fact-registry";
import { readProcurementOrderState } from "../src/lib/supply-os/state-runtime/readers/procurement-order";
import { readSupplierState } from "../src/lib/supply-os/state-runtime/readers/supplier";
import { procurementConversationMessageState } from "../src/lib/supply-os/state-runtime/readers/selectors";

const customerId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const vendorAId = "33333333-3333-4333-8333-333333333333";
const vendorBId = "44444444-4444-4444-8444-444444444444";
const supplierAId = "55555555-5555-4555-8555-555555555555";
const supplierBId = "66666666-6666-4666-8666-666666666666";

function dependency(input: {
  key: string;
  value: unknown;
  source?: SupplyStateDependency["source"];
  entityType?: string;
  entityRef?: string;
  policy?: SupplyStateDependency["policy"];
  evidenceRefs?: SupplyWorldEvidenceRef[];
}): SupplyStateDependency {
  const valueHash = hashSupplyStateValue(input.value);
  return {
    key: input.key,
    source: input.source ?? "WORKFLOW_DB",
    entityType: input.entityType ?? "workflow_fact",
    entityRef: input.entityRef ?? input.key,
    version: valueHash,
    valueHash,
    policy: input.policy ?? "STRICT",
    reason: `${input.key} changed.`,
    evidenceRefs: input.evidenceRefs ?? [],
  };
}

function seal(packet: Omit<SupplyWorldStatePacket, "sourceFingerprint" | "packetHash">): SupplyWorldStatePacket {
  const sourceFingerprint = hashSupplyStateDependencies(packet.dependencies);
  const unsealed = { ...packet, sourceFingerprint, packetHash: "" } satisfies SupplyWorldStatePacket;
  return { ...unsealed, packetHash: hashSupplyWorldStatePacket(unsealed) };
}

function packet(overrides: {
  officeId?: string;
  companyId?: string;
  vendorBName?: string;
  vendorBDependencyValue?: unknown;
} = {}): SupplyWorldStatePacket {
  const officeId = overrides.officeId ?? "office-a";
  const companyId = overrides.companyId ?? "company-a";
  const vendorBName = overrides.vendorBName ?? "Beta Components";
  const orderEvidence: SupplyWorldEvidenceRef = {
    kind: "procurement_order",
    id: orderId,
    valueHash: hashSupplyStateValue({ status: "sourcing" }),
  };
  const vendorAEvidence: SupplyWorldEvidenceRef = {
    kind: "procurement_vendor",
    id: vendorAId,
    valueHash: hashSupplyStateValue({ name: "Alpha Components" }),
  };
  const vendorBEvidence: SupplyWorldEvidenceRef = {
    kind: "procurement_vendor",
    id: vendorBId,
    valueHash: hashSupplyStateValue({ name: vendorBName }),
  };
  const messageAEvidence: SupplyWorldEvidenceRef = {
    kind: "procurement_message",
    id: "message-a",
    valueHash: hashSupplyStateValue({ direction: "INBOUND" }),
  };
  const messageBEvidence: SupplyWorldEvidenceRef = {
    kind: "procurement_message",
    id: "message-b",
    valueHash: hashSupplyStateValue({ direction: "OUTBOUND" }),
  };
  const prefixA = `${customerId}:${orderId}:${vendorAId}`;
  const prefixB = `${customerId}:${orderId}:${vendorBId}`;
  const dependencies = [
    dependency({
      key: `procurement.order:${customerId}:${orderId}`,
      value: { status: "sourcing", material: "6061 aluminum", quantity: 100 },
      entityType: "orders",
      entityRef: orderId,
      evidenceRefs: [orderEvidence],
    }),
    dependency({
      key: `procurement.order_request_context:${customerId}:${orderId}`,
      value: { documentIds: ["document-a"], version: "context-v1" },
      entityType: "orders.request_context",
      entityRef: orderId,
      evidenceRefs: [orderEvidence, { kind: "company_context", id: "document-a", contentHash: "doc-hash" }],
    }),
    dependency({
      key: `procurement.vendor:${prefixA}`,
      value: { name: "Alpha Components", recipient: "alpha@example.test" },
      entityType: "order_vendor",
      entityRef: vendorAId,
      evidenceRefs: [vendorAEvidence],
    }),
    dependency({
      key: `procurement.vendor_quote:${prefixA}`,
      value: null,
      entityType: "order_vendor_quote",
      entityRef: vendorAId,
      evidenceRefs: [vendorAEvidence],
    }),
    dependency({
      key: `procurement.vendor_latest_message:${prefixA}`,
      value: { id: "message-a", direction: "INBOUND", fromEmail: "Alpha@Example.Test" },
      source: "EMAIL_LEDGER",
      entityType: "procurement_communication_message",
      entityRef: vendorAId,
      evidenceRefs: [messageAEvidence],
    }),
    dependency({
      key: `procurement.vendor_triage:${prefixA}`,
      value: { kind: "QUESTION", decision: "AUTO_ANSWER" },
      entityType: "procurement_inbound_triage",
      entityRef: vendorAId,
      evidenceRefs: [messageAEvidence],
    }),
    dependency({
      key: `procurement.vendor_saved_draft:${prefixA}`,
      value: { id: "draft-old", inputHash: "old-input-hash", status: "PLANNED" },
      source: "APP_DB",
      entityType: "SupplyExecutionTask",
      entityRef: "draft-old",
    }),
    dependency({
      key: `procurement.vendor:${prefixB}`,
      value: overrides.vendorBDependencyValue ?? { name: vendorBName, recipient: "beta@example.test" },
      entityType: "order_vendor",
      entityRef: vendorBId,
      evidenceRefs: [vendorBEvidence],
    }),
    dependency({
      key: `procurement.vendor_quote:${prefixB}`,
      value: { amount: "8250", currency: "USD" },
      entityType: "order_vendor_quote",
      entityRef: vendorBId,
      evidenceRefs: [vendorBEvidence],
    }),
    dependency({
      key: `procurement.vendor_latest_message:${prefixB}`,
      value: { id: "message-b", direction: "OUTBOUND" },
      source: "EMAIL_LEDGER",
      entityType: "procurement_communication_message",
      entityRef: vendorBId,
      evidenceRefs: [messageBEvidence],
    }),
    dependency({
      key: `procurement.vendor_triage:${prefixB}`,
      value: null,
      entityType: "procurement_inbound_triage",
      entityRef: vendorBId,
      evidenceRefs: [messageBEvidence],
    }),
    dependency({
      key: `procurement.order_stage:${customerId}:${orderId}`,
      value: { stage: "COLLECTING_REPLIES", quotes: 1, vendorCount: 2 },
      entityType: "procurement_order_stage",
      entityRef: orderId,
      policy: "ADVISORY",
      evidenceRefs: [orderEvidence],
    }),
  ];
  return seal({
    schemaVersion: 1,
    compilerVersion: "supply-state-runtime-v1",
    scope: {
      type: "procurement_request",
      officeId,
      companyId,
      customerId,
      orderId,
      workspaceId: "workspace-a",
    },
    objective: "Plan the next safe supplier action.",
    compiledAt: "2026-08-26T12:00:00.000Z",
    currentState: {
      procurementRequest: {
        id: orderId,
        status: "sourcing",
        vendorCount: 2,
        vendors: [
          {
            id: vendorAId,
            supplierRegistryId: supplierAId,
            name: "Alpha Components",
            website: "https://alpha.example.test",
            contact: { name: "Alex", email: "alpha@example.test", phone: null },
            status: "RESPONDED",
            contacted: true,
            quote: null,
            conversation: {
              latestMessage: { id: "message-a", direction: "INBOUND", fromEmail: "Alpha@Example.Test" },
            },
            triage: { kind: "QUESTION", decision: "AUTO_ANSWER" },
            savedDraft: { id: "draft-old", inputHash: "old-input-hash", status: "PLANNED" },
          },
          {
            id: vendorBId,
            supplierRegistryId: supplierBId,
            name: vendorBName,
            quote: { amount: "8250", currency: "USD" },
            conversation: {
              latestMessage: { id: "message-b", direction: "OUTBOUND" },
            },
            triage: null,
            savedDraft: null,
          },
        ],
      },
    },
    derivedState: {},
    openLoops: [
      { kind: "supplier_reply_pending", vendorId: vendorAId },
      { kind: "supplier_quote_pending", vendorId: vendorBId },
      { kind: "request_review" },
    ],
    uncertainties: [
      { kind: "conversation_truncated", vendorId: vendorAId },
      { kind: "conversation_unavailable", vendorId: vendorBId },
    ],
    evidenceRefs: [
      orderEvidence,
      vendorAEvidence,
      vendorBEvidence,
      messageAEvidence,
      messageBEvidence,
      { kind: "company_context", id: "document-a", contentHash: "doc-hash" },
    ],
    dependencies,
    diagnostics: {
      projectionHit: false,
      sourceCounts: { procurementOrders: 1, procurementVendors: 2, procurementMessages: 2 },
      timingsMs: { procurementOrder: 4 },
    },
  });
}

const requestPacket = packet();
const vendorStates = autopilotVendorStatesFromPacket(requestPacket);
assert.deepEqual(vendorStates, [
  {
    vendorId: vendorAId,
    vendorName: "Alpha Components",
    lastDirection: "INBOUND",
    inboundKind: "QUESTION",
    triageDecision: "AUTO_ANSWER",
    hasDraft: true,
    hasQuote: false,
    draftBinding: { taskId: "draft-old", inputHash: "old-input-hash" },
  },
  {
    vendorId: vendorBId,
    vendorName: "Beta Components",
    lastDirection: "OUTBOUND",
    inboundKind: null,
    triageDecision: null,
    hasDraft: false,
    hasQuote: true,
    draftBinding: null,
  },
]);
assert.equal(
  autopilotDraftBindingMatches(vendorStates[0]!, {
    taskId: "draft-old",
    inputHash: "old-input-hash",
  }),
  true,
);
assert.equal(
  autopilotDraftBindingMatches(vendorStates[0]!, {
    taskId: "draft-replacement",
    inputHash: "replacement-input-hash",
  }),
  false,
  "A replacement draft must not inherit confirmation from the packet's originally planned draft.",
);

const vendorAState = procurementVendorStatePacket({
  packet: requestPacket,
  vendorId: vendorAId,
  objective: "Send Alpha's confirmed draft if its state is still current.",
});
const directReplyState = procurementVendorStatePacket({
  packet: requestPacket,
  vendorId: vendorAId,
  objective: "Validate a newly confirmed direct supplier reply.",
  includeSavedDraftDependency: false,
});
if (directReplyState.scope.type !== "procurement_request") {
  throw new Error("Expected a procurement request scope.");
}
assert.doesNotThrow(() => assertProcurementVendorStateReadBinding({
  stateRead: {
    scopeType: directReplyState.scope.type,
    scopeRef: supplyStateScopeRef(directReplyState.scope),
    dependencyManifest: directReplyState.dependencies,
  },
  scope: directReplyState.scope,
  vendorId: vendorAId,
  requireSavedDraft: false,
}));
const vendorAAction = {
  id: vendorAId,
  supplierRegistryId: supplierAId,
  name: "Alpha Components",
  website: "https://alpha.example.test",
  contact: { name: "Alex", email: "alpha@example.test", phone: null },
  status: "RESPONDED",
  contacted: true,
};
assert.doesNotThrow(() => assertProcurementVendorActionMatchesStatePacket({
  packet: directReplyState,
  vendorId: vendorAId,
  vendor: vendorAAction,
  sourceMessageId: "message-a",
  recipient: " alpha@EXAMPLE.test ",
}));
assert.throws(() => assertProcurementVendorActionMatchesStatePacket({
  packet: directReplyState,
  vendorId: vendorAId,
  vendor: vendorAAction,
  sourceMessageId: "message-before-refresh",
  recipient: "alpha@example.test",
}), /not the latest message/i, "An old conversation must not be paired with a newly compiled state read.");
assert.throws(() => assertProcurementVendorActionMatchesStatePacket({
  packet: directReplyState,
  vendorId: vendorAId,
  vendor: vendorAAction,
  sourceMessageId: "message-a",
  recipient: "previous-alpha@example.test",
}), /does not match the latest inbound sender/i);
assert.throws(() => assertProcurementVendorActionMatchesStatePacket({
  packet: directReplyState,
  vendorId: vendorAId,
  vendor: { ...vendorAAction, name: "Alpha Components Renamed" },
  sourceMessageId: "message-a",
  recipient: "alpha@example.test",
}), /supplier identity changed/i);
assert.throws(() => assertProcurementVendorActionMatchesStatePacket({
  packet: directReplyState,
  vendorId: vendorAId,
  vendor: { ...vendorAAction, supplierRegistryId: supplierBId },
  sourceMessageId: "message-a",
  recipient: "alpha@example.test",
}), /supplier identity changed/i, "A request vendor cannot be rebound to a different canonical supplier after compilation.");
const outboundLatestState = structuredClone(directReplyState);
const outboundRequest = outboundLatestState.currentState.procurementRequest as {
  vendors: Array<{ conversation: { latestMessage: { direction: string } } }>;
};
outboundRequest.vendors[0]!.conversation.latestMessage.direction = "OUTBOUND";
assert.throws(() => assertProcurementVendorActionMatchesStatePacket({
  packet: outboundLatestState,
  vendorId: vendorAId,
  vendor: vendorAAction,
  sourceMessageId: "message-a",
  recipient: "alpha@example.test",
}), /not inbound/i);
const chaseState = structuredClone(directReplyState);
const chaseRequest = chaseState.currentState.procurementRequest as {
  vendors: Array<{ conversation: {
    latestMessage: { id: string; direction: string; fromEmail: string };
    latestInboundMessage?: { id: string; direction: string; fromEmail: string };
  } }>;
};
chaseRequest.vendors[0]!.conversation = {
  latestMessage: { id: "our-answer", direction: "OUTBOUND", fromEmail: "buyer@example.test" },
  latestInboundMessage: { id: "message-a", direction: "INBOUND", fromEmail: "alpha@example.test" },
};
const chaseAction = {
  packet: chaseState,
  vendorId: vendorAId,
  vendor: vendorAAction,
  sourceMessageId: "message-a",
  recipient: "alpha@example.test",
  variant: "CHASE" as const,
};
assert.doesNotThrow(() => assertProcurementVendorActionMatchesStatePacket(chaseAction));
assert.throws(() => assertProcurementVendorActionMatchesStatePacket({
  ...chaseAction, sourceMessageId: "obsolete-question",
}), /not the latest message/i, "A chase must use the current supplier anchor.");
assert.throws(() => assertProcurementVendorActionMatchesStatePacket({
  ...chaseAction, recipient: "other@example.test",
}), /does not match the latest inbound sender/i, "Chasing does not relax recipient binding.");
assert.throws(() => assertProcurementVendorActionMatchesStatePacket({
  ...chaseAction, variant: "REPLY",
}), /not the latest message/i, "An old inbound anchor cannot be used to bypass reply freshness.");
chaseRequest.vendors[0]!.conversation.latestMessage.direction = "INBOUND";
assert.throws(() => assertProcurementVendorActionMatchesStatePacket(chaseAction), /latest human message to be outbound/i);
assert.throws(() => assertProcurementVendorStateReadBinding({
  stateRead: {
    scopeType: directReplyState.scope.type,
    scopeRef: supplyStateScopeRef(directReplyState.scope),
    dependencyManifest: directReplyState.dependencies,
  },
  scope: directReplyState.scope,
  vendorId: vendorAId,
  requireSavedDraft: true,
}), /vendor_saved_draft dependency/i);
const selectedRequest = vendorAState.currentState.procurementRequest as {
  vendors: Array<{ id: string }>;
  vendorCount: number;
};
assert.deepEqual(selectedRequest.vendors.map((vendor) => vendor.id), [vendorAId]);
assert.equal(selectedRequest.vendorCount, 1);
assert(vendorAState.dependencies.some((entry) => entry.key === `procurement.vendor:${customerId}:${orderId}:${vendorAId}`));
assert(!vendorAState.dependencies.some((entry) => entry.key.includes(vendorBId)));
assert(!vendorAState.evidenceRefs.some((entry) => entry.kind === "procurement_vendor" && entry.id === vendorBId));
assert(!vendorAState.evidenceRefs.some((entry) => entry.kind === "procurement_message" && entry.id === "message-b"));
assert(vendorAState.openLoops.every((entry) => typeof entry.vendorId !== "string" || entry.vendorId === vendorAId));
assert(vendorAState.uncertainties.every((entry) => typeof entry.vendorId !== "string" || entry.vendorId === vendorAId));

const vendorBChanged = packet({
  vendorBName: "Beta Components Updated",
  vendorBDependencyValue: { name: "Beta Components Updated", recipient: "new-beta@example.test" },
});
assert.notEqual(vendorBChanged.packetHash, requestPacket.packetHash);
const vendorAAfterUnrelatedChange = procurementVendorStatePacket({
  packet: vendorBChanged,
  vendorId: vendorAId,
  objective: vendorAState.objective,
});
assert.equal(
  vendorAAfterUnrelatedChange.sourceFingerprint,
  vendorAState.sourceFingerprint,
  "A strict change for another supplier must not enter this supplier's dependency fingerprint.",
);
assert.equal(
  vendorAAfterUnrelatedChange.packetHash,
  vendorAState.packetHash,
  "A strict change for another supplier must not alter this supplier's durable state packet.",
);

const draft = { id: "draft-new", inputHash: "draft-input-hash-1", status: "PLANNED" };
const withDraft = procurementVendorPacketWithSavedDraft({
  packet: requestPacket,
  customerId,
  orderId,
  vendorId: vendorAId,
  draft,
  objective: "Validate the exact saved draft before sending.",
});
const savedDraftKey = `procurement.vendor_saved_draft:${customerId}:${orderId}:${vendorAId}`;
const savedDraftDependency = withDraft.dependencies.find((entry) => entry.key === savedDraftKey);
assert(savedDraftDependency);
assert.equal(savedDraftDependency.policy, "STRICT");
assert.equal(savedDraftDependency.source, "APP_DB");
assert.equal(savedDraftDependency.version, draft.inputHash);
assert.equal(savedDraftDependency.valueHash, hashSupplyStateValue(draft));
assert.deepEqual(savedDraftDependency.evidenceRefs, [{
  kind: "execution_task",
  id: draft.id,
  inputHash: draft.inputHash,
}]);
assert.equal(withDraft.sourceFingerprint, hashSupplyStateDependencies(withDraft.dependencies));
assert.equal(withDraft.packetHash, hashSupplyWorldStatePacket(withDraft));
const withDraftRequest = withDraft.currentState.procurementRequest as {
  vendors: Array<{ savedDraft: typeof draft }>;
};
assert.deepEqual(withDraftRequest.vendors[0]?.savedDraft, draft);
if (withDraft.scope.type !== "procurement_request") {
  throw new Error("Expected a procurement request scope.");
}
assert.doesNotThrow(() => assertProcurementVendorStateReadBinding({
  stateRead: {
    scopeType: withDraft.scope.type,
    scopeRef: supplyStateScopeRef(withDraft.scope),
    dependencyManifest: withDraft.dependencies,
  },
  scope: withDraft.scope,
  vendorId: vendorAId,
  requireSavedDraft: true,
}));
assert.throws(() => assertProcurementVendorStateReadBinding({
  stateRead: {
    scopeType: withDraft.scope.type,
    scopeRef: supplyStateScopeRef(withDraft.scope),
    dependencyManifest: withDraft.dependencies.filter((entry) => (
      entry.key !== `procurement.order_request_context:${customerId}:${orderId}`
    )),
  },
  scope: withDraft.scope,
  vendorId: vendorAId,
  requireSavedDraft: true,
}), /order_request_context dependency/i);

const changedDraft = procurementVendorPacketWithSavedDraft({
  packet: requestPacket,
  customerId,
  orderId,
  vendorId: vendorAId,
  draft: { ...draft, inputHash: "draft-input-hash-2" },
  objective: withDraft.objective,
});
assert.notEqual(changedDraft.sourceFingerprint, withDraft.sourceFingerprint);
assert.notEqual(changedDraft.packetHash, withDraft.packetHash);

assert.deepEqual(vendorAState.scope, requestPacket.scope, "Vendor derivation must retain the exact tenant scope.");
const foreignRequestPacket = packet({ officeId: "office-b", companyId: "company-b" });
const foreignVendorState = procurementVendorStatePacket({
  packet: foreignRequestPacket,
  vendorId: vendorAId,
  objective: vendorAState.objective,
});
assert.equal(foreignVendorState.scope.officeId, "office-b");
assert.equal(foreignVendorState.scope.type, "procurement_request");
if (foreignVendorState.scope.type !== "procurement_request") {
  throw new Error("Expected a procurement request scope.");
}
assert.equal(foreignVendorState.scope.companyId, "company-b");
assert.notEqual(foreignVendorState.packetHash, vendorAState.packetHash);
assert.throws(
  () => procurementVendorStatePacket({ packet: requestPacket, vendorId: "foreign-vendor", objective: "No access" }),
  /not present in the compiled procurement request state/i,
);
assert.throws(
  () => autopilotVendorStatesFromPacket({
    ...requestPacket,
    scope: { type: "workspace", officeId: "office-a", workspaceId: "workspace-a" },
  }),
  /requires a procurement request packet/i,
);

assert.equal(procurementReplyExistingTaskDisposition({
  status: "RUNNING",
  existingMessageHash: "old-message",
  nextMessageHash: "new-message",
  result: { state: "DELIVERY_UNKNOWN", providerCalled: true },
}), "RECONCILE", "An uncertain provider attempt must be reconciled before comparing a new draft hash.");
assert.equal(procurementReplyExistingTaskDisposition({
  status: "SUCCEEDED",
  existingMessageHash: "same-message",
  nextMessageHash: "same-message",
  result: { state: "SENT" },
}), "RETURN_SENT");
assert.equal(procurementReplyExistingTaskDisposition({
  status: "SUCCEEDED",
  existingMessageHash: "old-message",
  nextMessageHash: "new-message",
  result: { state: "SENT" },
}), "RETURN_SENT", "A delivered reply is reported from its receipt and is not sent again.");
assert.equal(procurementReplyExistingTaskDisposition({
  status: "FAILED",
  existingMessageHash: "old-message",
  nextMessageHash: "new-message",
  result: { state: "COMMERCIAL_STATE_STALE", providerCalled: false },
}), "CREATE_SUCCESSOR", "A proven local stale-state block must permit a newly confirmed immutable successor.");
assert.equal(procurementReplyExistingTaskDisposition({
  status: "FAILED",
  existingMessageHash: "old-message",
  nextMessageHash: "new-message",
  result: { state: "SEND_FAILED", providerCalled: true },
}), "CREATE_SUCCESSOR", "A confirmed failed attempt may be retried with the current reply text.");

async function verifyHumanMessageState() {
  const question: ProcurementConversationMessage = {
    id: "question", direction: "INBOUND", fromEmail: "alpha@example.test", fromName: null,
    toEmails: ["buyer@example.test"], ccEmails: [], subject: "RFQ",
    body: "Please send the drawings.", sentAt: "2026-09-08T10:00:00.000Z", truncated: false,
  };
  const notice: ProcurementConversationMessage = {
    ...question, id: "notice", subject: "Automatic reply: out of office",
    body: "I am out of office and will return on Monday.", sentAt: "2026-09-08T10:01:00.000Z",
  };
  const answer: ProcurementConversationMessage = {
    ...question, id: "answer", direction: "OUTBOUND", fromEmail: "buyer@example.test",
    toEmails: ["alpha@example.test"], body: "The drawings are attached.", sentAt: "2026-09-08T10:02:00.000Z",
  };
  let messages = [question];
  const order = {
    id: orderId, status: "sourcing", material: "Components", quantity: 10, unit: "units",
    neededBy: null, specification: null, progress: null, approvalRequestedAt: null,
    decisionSnapshot: null, requestContext: {}, vendors: [{ ...vendorAAction, quote: null, responseCount: 1 }],
  };
  const getRequest = async () => order as never;
  const getConversation = async (args: { officeId: string; customerId: string; orderId: string; vendorId: string }) => {
    assert.deepEqual(args, { officeId: "office-a", customerId, orderId, vendorId: vendorAId });
    return { available: true, unavailableReason: null, source: "BOURNE_LEDGER", messages } as never;
  };
  const registry = createSupplyStateFactRegistry({
    appDb: {} as never,
    getProcurementRequest: getRequest,
    getProcurementConversation: getConversation,
    resolveWorkflowOffice: () => "office-a",
  });
  const key = `procurement.vendor_latest_message:${customerId}:${orderId}:${vendorAId}`;
  const compile = async () => {
    const result = await readProcurementOrderState({
      scope: { type: "procurement_request", officeId: "office-a", companyId: "company-a", customerId, orderId },
      objective: "Validate human message and chase anchor state.",
    }, {
      getRequest, getConversation,
      resolveOfficeId: () => "office-a",
      findWorkflowAccount: async () => ({ id: customerId, officeId: "office-a", companyId: "company-a" }),
      findWorkspace: async () => null, findDraftTasks: async () => [], findContextDocuments: async () => [],
    } as never);
    const compiled = result.dependencies.find((entry) => entry.key === key)!;
    const reread = await readSupplyStateDependency({ registry, key, context: { officeId: "office-a" } });
    assert.equal(compiled.valueHash, reread.valueHash, "Reader and semantic validator select identical human message facts.");
    assert.equal(compiled.version, reread.version);
    assert.equal(compiled.policy, "STRICT");
    const supplierResult = await readSupplierState({
      scope: { type: "supplier", officeId: "office-a", companyId: "company-a", orderId, vendorId: vendorAId },
      objective: "Validate explicitly linked supplier human messages and chase anchors.",
    }, {
      getRequest, getConversation,
      resolveCustomerId: () => customerId,
      findWorkflowAccount: async () => ({ id: customerId, officeId: "office-a", companyId: "company-a" }),
    } as never);
    const supplierFact = supplierResult.dependencies.find((entry) => entry.key === key)!;
    assert(supplierFact, "The linked supplier reader declares its current-message dependency.");
    assert.equal(supplierFact.valueHash, reread.valueHash, "Supplier and request readers declare the exact same human-message fact as the registry.");
    assert.equal(supplierFact.version, reread.version);
    assert.equal(supplierFact.policy, "STRICT");
    assert.deepEqual(supplierFact.evidenceRefs, compiled.evidenceRefs);
    return compiled;
  };
  const original = await compile();
  messages = [question, notice];
  assert.equal((await compile()).valueHash, original.valueHash, "An automatic notice does not supersede the human question.");
  messages = [question, notice, answer];
  const answered = await compile();
  assert.notEqual(answered.valueHash, original.valueHash, "A real answer changes the state the agent relied on.");
  const selected = procurementConversationMessageState(messages);
  assert.equal(selected.latest?.id, "answer");
  assert.equal(selected.latestInbound?.id, "question");
  assert.deepEqual(selected.evidenceRefs.map((entry) => entry.id), ["answer", "question"]);
  messages = [question, answer, { ...notice, sentAt: "2026-09-08T10:03:00.000Z" }];
  assert.equal((await compile()).valueHash, answered.valueHash, "An automatic notice after a real answer preserves both the answer and the human chase anchor.");
  messages = [{ ...question, body: "Please change the drawings to another specification." }, notice, answer];
  assert.notEqual((await compile()).valueHash, answered.valueHash, "Editing an earlier chase anchor invalidates the strict fact even when the latest outbound message is unchanged.");
  messages = [{ ...question, fromEmail: "replacement@example.test" }, notice, answer];
  assert.notEqual((await compile()).valueHash, answered.valueHash, "A changed chase recipient invalidates the original strict state.");
}

verifyHumanMessageState().then(() => console.log("Supply state autopilot checks passed.")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
