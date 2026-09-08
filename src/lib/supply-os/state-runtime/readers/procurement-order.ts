import "server-only";

import { autopilotRequestStage } from "@/lib/procurement-autopilot-plan";
import { PROCUREMENT_REPLY_DRAFT_TASK_TYPE } from "@/lib/procurement-file-delivery-draft";
import { procurementReplyFacts, triageSupplierInbound } from "@/lib/procurement-inbound-triage";
import { prisma } from "@/lib/prisma";
import {
  getProcurementRequest,
  getProcurementWorkflowAccount,
  procurementOfficeIdFromServerMetadata,
  type ProcurementWorkflowAccountLookup,
  type ProcurementOrderDetail,
  type ProcurementOrderVendor,
} from "@/lib/procurement-workflow";
import { hashSupplyStateValue } from "@/lib/supply-os/state-runtime/canonicalize";
import type { SupplyWorldEvidenceRef } from "@/lib/supply-os/state-runtime/types";
import { procurementConversationMessageState } from "./selectors";
import {
  boundSupplyStateValue,
  boundedText,
  emptySupplyStateReaderResult,
  isRecord,
  makeSupplyStateDependency,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "./types";

const MAX_VENDOR_CONCURRENCY = 6;
const MAX_MESSAGE_EXCERPT = 1_000;
const MAX_PROCUREMENT_VENDORS = 25;
type ProcurementConversationReader = typeof import("@/lib/procurement-conversation")["procurementVendorConversation"];

type ProcurementOrderReaderDependencies = {
  getRequest: typeof getProcurementRequest;
  resolveOfficeId: typeof procurementOfficeIdFromServerMetadata;
  getConversation: ProcurementConversationReader;
  findDraftTasks: typeof prisma.supplyExecutionTask.findMany;
  findContextDocuments: typeof prisma.companyContext.findMany;
  findWorkflowAccount: ProcurementWorkflowAccountLookup;
  findWorkspace: typeof prisma.supplyWorkspace.findFirst;
};

const defaultDependencies: ProcurementOrderReaderDependencies = {
  getRequest: getProcurementRequest,
  resolveOfficeId: procurementOfficeIdFromServerMetadata,
  getConversation: async (...args) => {
    const { procurementVendorConversation } = await import("@/lib/procurement-conversation");
    return procurementVendorConversation(...args);
  },
  findDraftTasks: (args) => prisma.supplyExecutionTask.findMany(args),
  findContextDocuments: (args) => prisma.companyContext.findMany(args),
  findWorkflowAccount: getProcurementWorkflowAccount,
  findWorkspace: (args) => prisma.supplyWorkspace.findFirst(args),
};

function record(value: unknown) {
  return isRecord(value) ? value : {};
}

function workspaceIdFromOrder(order: ProcurementOrderDetail) {
  const source = record(record(order.requestContext).source);
  return typeof source.workspace_id === "string" && source.workspace_id.trim()
    ? source.workspace_id.trim()
    : null;
}

function selectedRequestContext(requestContext: Record<string, unknown>) {
  return boundSupplyStateValue({
    source: requestContext.source ?? null,
    procurementContext: requestContext.procurement_context ?? null,
    companyContext: requestContext.company_context ?? null,
    logistics: requestContext.logistics ?? null,
  }, { maxArray: 50, maxString: 8_000 });
}

function requestDocumentIds(requestContext: Record<string, unknown>) {
  const contexts = [record(requestContext.procurement_context), record(requestContext.company_context)];
  const ids = new Set<string>();
  for (const context of contexts) {
    if (!Array.isArray(context.documents)) continue;
    for (const entry of context.documents) {
      const citation = record(entry).citation_id;
      if (typeof citation === "string" && citation.startsWith("document:") && citation.length > 9) {
        ids.add(citation.slice("document:".length));
      }
    }
  }
  return [...ids].sort().slice(0, 50);
}

function orderFactValue(order: ProcurementOrderDetail) {
  return {
    id: order.id,
    status: order.status,
    neededBy: order.neededBy,
    quantity: order.quantity,
    unit: order.unit,
    material: order.material,
    specification: order.specification,
  };
}

function orderDecisionStateValue(order: ProcurementOrderDetail) {
  return {
    progress: order.progress,
    approvalRequestedAt: order.approvalRequestedAt,
    decisionSnapshot: boundSupplyStateValue(order.decisionSnapshot, { maxArray: 30, maxString: 2_000 }),
  };
}

function orderCurrentStateValue(order: ProcurementOrderDetail) {
  return { ...orderFactValue(order), ...orderDecisionStateValue(order) };
}

function vendorIdentityValue(vendor: ProcurementOrderVendor) {
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

async function mapConcurrent<T, U>(values: T[], worker: (value: T) => Promise<U>) {
  const output = new Array<U>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(MAX_VENDOR_CONCURRENCY, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index]!);
    }
  }));
  return output;
}

type VendorCompiledState = {
  current: Record<string, unknown>;
  dependencies: SupplyStateReaderResult["dependencies"];
  evidenceRefs: SupplyWorldEvidenceRef[];
  uncertainty: Record<string, unknown> | null;
  openLoop: Record<string, unknown> | null;
};

async function compileVendor(args: {
  input: SupplyStateReaderInput & { scope: Extract<SupplyStateReaderInput["scope"], { type: "procurement_request" }> };
  order: ProcurementOrderDetail;
  vendor: ProcurementOrderVendor;
  draft: { id: string; inputHash: string; status: string; input: unknown } | null;
  dependencies: ProcurementOrderReaderDependencies;
}): Promise<VendorCompiledState> {
  const prefix = `${args.input.scope.customerId}:${args.order.id}:${args.vendor.id}`;
  const identityEvidence: SupplyWorldEvidenceRef = {
    kind: "procurement_vendor",
    id: args.vendor.id,
    valueHash: hashSupplyStateValue(vendorIdentityValue(args.vendor)),
  };
  const evidenceRefs: SupplyWorldEvidenceRef[] = [identityEvidence];
  const dependencies: SupplyStateReaderResult["dependencies"] = [
    makeSupplyStateDependency({
      key: `procurement.vendor:${prefix}`,
      source: "WORKFLOW_DB",
      entityType: "order_vendor",
      entityRef: args.vendor.id,
      value: vendorIdentityValue(args.vendor),
      policy: "STRICT",
      reason: "The supplier identity, recipient, request status, or contact state changed.",
      evidenceRefs: [identityEvidence],
    }),
    makeSupplyStateDependency({
      key: `procurement.vendor_quote:${prefix}`,
      source: "WORKFLOW_DB",
      entityType: "order_vendor_quote",
      entityRef: args.vendor.id,
      value: args.vendor.quote,
      policy: "STRICT",
      reason: "The supplier quote state changed after the action was planned.",
      evidenceRefs: [identityEvidence],
    }),
  ];

  // A thrown conversation read is source unavailability, not evidence that no
  // message exists. Let the projection builder turn it into a bounded reader
  // failure so normal reads can fall back, while durable reads fail closed.
  const conversation = await args.dependencies.getConversation({
    officeId: args.input.scope.officeId,
    customerId: args.input.scope.customerId,
    orderId: args.order.id,
    vendorId: args.vendor.id,
  });

  const { latest, latestInbound, value: latestValue, evidenceRefs: messageEvidence } =
    procurementConversationMessageState(conversation.messages);
  evidenceRefs.push(...messageEvidence);
  const facts = procurementReplyFacts(args.order);
  const triage = latest?.direction === "INBOUND"
    ? triageSupplierInbound({ subject: latest.subject, body: latest.body, facts })
    : null;
  dependencies.push(
    makeSupplyStateDependency({
      key: `procurement.vendor_latest_message:${prefix}`,
      source: "EMAIL_LEDGER",
      entityType: "procurement_communication_message",
      entityRef: args.vendor.id,
      value: latestValue,
      version: latest?.id ?? undefined,
      policy: "STRICT",
      reason: "The latest supplier message or its direction changed.",
      evidenceRefs: messageEvidence,
    }),
    makeSupplyStateDependency({
      key: `procurement.vendor_triage:${prefix}`,
      source: "WORKFLOW_DB",
      entityType: "procurement_inbound_triage",
      entityRef: args.vendor.id,
      value: triage,
      policy: "STRICT",
      reason: "Deterministic inbound triage changed for the supplier reply.",
      evidenceRefs: messageEvidence,
    }),
    makeSupplyStateDependency({
      key: `procurement.vendor_saved_draft:${prefix}`,
      source: "APP_DB",
      entityType: "SupplyExecutionTask",
      entityRef: args.draft?.id ?? `${args.order.id}:${args.vendor.id}`,
      version: args.draft?.inputHash,
      value: args.draft ? { id: args.draft.id, inputHash: args.draft.inputHash, status: args.draft.status } : null,
      policy: "STRICT",
      reason: "The current saved supplier draft changed or was replaced.",
      evidenceRefs: [],
    }),
  );
  const openLoop = args.vendor.quote
    ? null
    : latest?.direction === "INBOUND"
      ? { kind: "supplier_reply_pending", vendorId: args.vendor.id, triageDecision: triage?.decision ?? null }
      : { kind: "supplier_quote_pending", vendorId: args.vendor.id, lastDirection: latest?.direction ?? null };
  return {
    current: {
      ...vendorIdentityValue(args.vendor),
      responseCount: args.vendor.responseCount,
      quote: boundSupplyStateValue(args.vendor.quote, { maxArray: 30, maxString: 2_000 }),
      conversation: {
        available: conversation.available,
        source: conversation.source,
        accountEmail: conversation.accountEmail,
        messageCount: conversation.messages.length,
        routing: {
          basis: "EXPLICIT_REQUEST_VENDOR",
          ambiguousIncluded: false,
        },
        latestMessage: latest ? {
          id: latest.id,
          direction: latest.direction,
          fromEmail: latest.fromEmail,
          toEmails: latest.toEmails,
          ccEmails: latest.ccEmails,
          subject: boundedText(latest.subject, 500) || null,
          bodyExcerpt: boundedText(latest.body, MAX_MESSAGE_EXCERPT),
          sentAt: latest.sentAt,
          truncated: latest.truncated || latest.body.length > MAX_MESSAGE_EXCERPT,
        } : null,
        latestInboundMessage: latestInbound ? {
          id: latestInbound.id,
          direction: latestInbound.direction,
          fromEmail: latestInbound.fromEmail,
          sentAt: latestInbound.sentAt,
          bodyHash: hashSupplyStateValue(latestInbound.body),
        } : null,
      },
      triage: boundSupplyStateValue(triage, { maxArray: 20, maxString: 1_000 }),
      savedDraft: args.draft ? { id: args.draft.id, inputHash: args.draft.inputHash, status: args.draft.status } : null,
    },
    dependencies,
    evidenceRefs,
    uncertainty: conversation.available ? null : {
      kind: "procurement_vendor_conversation_unavailable",
      vendorId: args.vendor.id,
      reason: conversation.unavailableReason,
    },
    openLoop,
  };
}

export async function readProcurementOrderState(
  input: SupplyStateReaderInput,
  dependencies: ProcurementOrderReaderDependencies = defaultDependencies,
): Promise<SupplyStateReaderResult> {
  if (input.scope.type !== "procurement_request") return emptySupplyStateReaderResult();
  const scope = input.scope;
  const mappedOfficeId = dependencies.resolveOfficeId(scope.customerId);
  if (mappedOfficeId !== scope.officeId) {
    throw new Error("The procurement customer mapping does not match the state scope office.");
  }
  const workflowAccount = await dependencies.findWorkflowAccount({
    customerId: scope.customerId,
    officeId: scope.officeId,
    companyId: scope.companyId,
  });
  if (!workflowAccount) {
    throw new Error("The procurement customer does not belong to the state scope company.");
  }
  const order = await dependencies.getRequest(input.scope.customerId, input.scope.orderId);
  if (!order) {
    const missing = emptySupplyStateReaderResult();
    missing.currentState.procurementRequest = null;
    missing.uncertainties.push({ kind: "procurement_request_missing", orderId: input.scope.orderId });
    missing.dependencies.push(makeSupplyStateDependency({
      key: `procurement.order:${input.scope.customerId}:${input.scope.orderId}`,
      source: "WORKFLOW_DB",
      entityType: "orders",
      entityRef: input.scope.orderId,
      value: null,
      policy: "STRICT",
      reason: "The procurement request no longer exists or is not readable in this tenant.",
    }));
    return missing;
  }

  const result = emptySupplyStateReaderResult();
  const requestContext = selectedRequestContext(order.requestContext);
  const orderWorkspaceId = workspaceIdFromOrder(order);
  if (input.scope.workspaceId && input.scope.workspaceId !== orderWorkspaceId) {
    throw new Error("The procurement request is linked to a different workspace.");
  }
  const workspaceId = orderWorkspaceId;
  if (workspaceId) {
    const workspace = await dependencies.findWorkspace({
      where: { id: workspaceId, officeId: scope.officeId, status: "ACTIVE" },
      select: { companyId: true },
    });
    if (!workspace || workspace.companyId !== scope.companyId) {
      throw new Error("The procurement request workspace does not belong to the state scope company.");
    }
  }
  const documentIds = requestDocumentIds(order.requestContext);
  const documentRows = documentIds.length ? await dependencies.findContextDocuments({
    where: {
      officeId: input.scope.officeId,
      companyId: input.scope.companyId,
      id: { in: documentIds },
      kind: "DOCUMENT",
    },
    select: { id: true, contentHash: true, processingState: true },
  }) : [];
  const documentById = new Map(documentRows.map((row) => [row.id, row]));
  const documentEvidence: SupplyWorldEvidenceRef[] = documentIds.map((id) => ({
    kind: "company_context" as const,
    id,
    contentHash: documentById.get(id)?.contentHash ?? null,
  }));
  const orderEvidence: SupplyWorldEvidenceRef = {
    kind: "procurement_order",
    id: order.id,
    valueHash: hashSupplyStateValue(orderFactValue(order)),
  };
  result.evidenceRefs.push(orderEvidence, ...documentEvidence);
  result.dependencies.push(
    makeSupplyStateDependency({
      key: `procurement.order:${input.scope.customerId}:${order.id}`,
      source: "WORKFLOW_DB",
      entityType: "orders",
      entityRef: order.id,
      value: orderFactValue(order),
      policy: "STRICT",
      reason: "The request material, quantity, unit, timing, specification, or status changed.",
      evidenceRefs: [orderEvidence],
    }),
    makeSupplyStateDependency({
      key: `procurement.order_decision_state:${input.scope.customerId}:${order.id}`,
      source: "WORKFLOW_DB",
      entityType: "orders.decision_state",
      entityRef: order.id,
      value: orderDecisionStateValue(order),
      policy: "ADVISORY",
      reason: "The request aggregate progress, approval request, or PO decision state changed.",
      evidenceRefs: [orderEvidence],
    }),
    makeSupplyStateDependency({
      key: `procurement.order_request_context:${input.scope.customerId}:${order.id}`,
      source: "WORKFLOW_DB",
      entityType: "orders.request_context",
      entityRef: order.id,
      value: { requestContext, documents: documentIds.map((id) => ({
        id,
        contentHash: documentById.get(id)?.contentHash ?? null,
        processingState: documentById.get(id)?.processingState ?? "MISSING",
      })) },
      policy: "STRICT",
      reason: "The frozen request context or one of its linked source documents changed.",
      evidenceRefs: [orderEvidence, ...documentEvidence],
    }),
  );
  for (const documentId of documentIds) {
    const document = documentById.get(documentId);
    result.dependencies.push(makeSupplyStateDependency({
      key: `company.context_document:${input.scope.companyId}:${documentId}`,
      source: "APP_DB",
      entityType: "CompanyContext",
      entityRef: documentId,
      value: document ? { contentHash: document.contentHash, processingState: document.processingState } : null,
      version: document?.contentHash,
      policy: "STRICT",
      reason: "A source document frozen into the procurement request changed or disappeared.",
      evidenceRefs: documentEvidence.filter((reference) => reference.id === documentId),
    }));
    if (!document || document.processingState !== "READY") {
      result.uncertainties.push({
        kind: "procurement_request_document_unavailable",
        documentId,
        processingState: document?.processingState ?? "MISSING",
      });
    }
  }

  const requestedVendorIds = input.procurementVendorIds
    ? [...new Set(input.procurementVendorIds.map((vendorId) => vendorId.trim()).filter(Boolean))]
    : null;
  if (requestedVendorIds && requestedVendorIds.length > MAX_PROCUREMENT_VENDORS) {
    throw new Error(`A procurement state page may include at most ${MAX_PROCUREMENT_VENDORS} suppliers.`);
  }
  const requestedVendorSet = requestedVendorIds ? new Set(requestedVendorIds) : null;
  const boundedVendors = requestedVendorSet
    ? order.vendors.filter((vendor) => requestedVendorSet.has(vendor.id))
    : [...order.vendors]
        .sort((left, right) => Number(Boolean(left.quote)) - Number(Boolean(right.quote)))
        .slice(0, MAX_PROCUREMENT_VENDORS);
  if (requestedVendorIds && boundedVendors.length !== requestedVendorIds.length) {
    throw new Error("One or more requested suppliers no longer belong to the procurement request.");
  }
  const draftRows = workspaceId && boundedVendors.length ? await dependencies.findDraftTasks({
    where: {
      officeId: input.scope.officeId,
      workspaceId,
      taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE,
      status: { in: ["PLANNED", "BLOCKED", "READY"] },
      OR: boundedVendors.map((vendor) => ({
        taskKey: { startsWith: `procurement-reply-draft:${order.id}:${vendor.id}:` },
      })),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, taskKey: true, inputHash: true, status: true, input: true, createdAt: true },
  }) : [];
  const draftByVendor = new Map<string, (typeof draftRows)[number]>();
  for (const row of draftRows) {
    const vendor = boundedVendors.find((candidate) => row.taskKey.startsWith(`procurement-reply-draft:${order.id}:${candidate.id}:`));
    if (vendor && !draftByVendor.has(vendor.id)) draftByVendor.set(vendor.id, row);
  }
  const vendorStates = await mapConcurrent(boundedVendors, (vendor) => compileVendor({
    input: { ...input, scope },
    order,
    vendor,
    draft: draftByVendor.get(vendor.id) ?? null,
    dependencies,
  }));
  for (const state of vendorStates) {
    result.dependencies.push(...state.dependencies);
    result.evidenceRefs.push(...state.evidenceRefs);
    if (state.uncertainty) result.uncertainties.push(state.uncertainty);
    if (state.openLoop) result.openLoops.push(state.openLoop);
  }
  const quotes = order.vendors.filter((vendor) => Boolean(vendor.quote)).length;
  const stage = autopilotRequestStage({ quotes });
  result.dependencies.push(makeSupplyStateDependency({
    key: `procurement.order_stage:${input.scope.customerId}:${order.id}`,
    source: "WORKFLOW_DB",
    entityType: "procurement_order_stage",
    entityRef: order.id,
    value: { stage, quotes, vendorCount: order.vendors.length },
    policy: "ADVISORY",
    reason: "The request response counts or PO-readiness stage changed.",
    evidenceRefs: [orderEvidence],
  }));
  result.currentState.procurementRequest = {
    ...orderCurrentStateValue(order),
    workspaceId,
    requestContext,
    requestDocuments: documentIds.map((id) => ({
      id,
      contentHash: documentById.get(id)?.contentHash ?? null,
      processingState: documentById.get(id)?.processingState ?? "MISSING",
    })),
    vendors: vendorStates.map((state) => state.current),
    vendorCount: order.vendors.length,
    responseCount: order.vendors.reduce((sum, vendor) => sum + vendor.responseCount, 0),
    quoteCount: order.vendors.filter((vendor) => Boolean(vendor.quote)).length,
    poReadinessStage: stage,
  };
  if (!requestedVendorIds && order.vendors.length > boundedVendors.length) {
    result.uncertainties.push({
      kind: "procurement_vendor_list_bounded",
      included: boundedVendors.length,
      total: order.vendors.length,
    });
  }
  result.sourceCounts = {
    procurementOrders: 1,
    procurementVendors: boundedVendors.length,
    procurementMessages: vendorStates.filter((state) => isRecord(state.current.conversation)
      && isRecord(state.current.conversation.latestMessage)).length,
    procurementRequestDocuments: documentIds.length,
    procurementDrafts: draftByVendor.size,
  };
  return result;
}
