import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSupplyWorkspace, SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import { sourcingWorkspaceForTask } from "./sourcing-research-persistence";
import {
  appendSupplierCommunicationEvent as appendEvent,
  currentAccessContext,
  digest,
  inputJson,
  messageBody,
  nonNegativeInteger,
  optionalText,
  record,
  requiredText,
  retryableTransactionError,
  singleEmail,
  supplierCommunicationTaskSelect as communicationTaskSelect,
  withSerializableRetry,
} from "./supplier-communication-shared";
import {
  gmailSupplierEmailProvider,
  type SupplierEmailProvider,
  type SupplierEmailSent,
} from "./supplier-email-provider";
import { currentSupplierQualification, supplierQualificationValidOn } from "./supplier-qualification";
import {
  finalizeReplacementSupersession,
  returnStaleReplacementToSourcing,
  type ReplacementFreshnessGate,
} from "./purchase-order-revision";

export const PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE = "PURCHASE_ORDER_EMAIL_DRAFT";
export const PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE = "PURCHASE_ORDER_EMAIL_ACTION";
const PROCUREMENT_CASE_TASK_TYPE = "PROCUREMENT_CASE";
const PURCHASE_DRAFT_TASK_TYPE = "PURCHASE_ORDER_DRAFT";
const PURCHASE_ACTION_TASK_TYPE = "PURCHASE_ORDER_ACTION";
const PURCHASE_ACTION_CAPABILITY = "authorize.purchase_order";

function passingQualityEvidence(value: unknown) {
  const quality = record(value);
  return quality.outcome === "PASS"
    && typeof quality.evidenceId === "string"
    && quality.evidenceId.length > 0
    && typeof quality.evidenceUrl === "string"
    && quality.evidenceUrl.length > 0
    && typeof quality.observedOn === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(quality.observedOn)
    && quality.observedOn <= todayUtc();
}
const EMAIL_CAPABILITY = "contact.supplier_purchase_order_email";
const REQUIRED_ROLE = "MANAGER";

function isoDate(value: unknown, label: string) {
  const date = requiredText(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
    throw new SupplyPersistenceError(`${label} must be a valid YYYY-MM-DD date.`, "invalid_input");
  }
  return date;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function normalizedOrderDraft(input: unknown) {
  const body = record(input);
  return {
    expectedActionScopeHash: requiredText(body.expectedActionScopeHash, "Authorized order scope hash", 128),
    expectedRevision: nonNegativeInteger(body.expectedRevision, "Expected email revision"),
    senderAccountId: requiredText(body.senderAccountId, "Sender account", 220),
    recipient: singleEmail(body.recipient, "Supplier recipient"),
    subject: requiredText(body.subject, "Email subject", 180),
    body: messageBody(body.body),
    purchaseOrderReference: requiredText(body.purchaseOrderReference, "Purchase order reference", 300),
    acknowledgmentDueOn: isoDate(body.acknowledgmentDueOn, "Acknowledgment due date"),
    note: optionalText(body.note, "Purchase order release note", 2_000),
  };
}

async function activeOrderScope(tx: Prisma.TransactionClient, args: {
  officeId: string;
  workspaceId: string;
  purchaseActionId: string;
  expectedScopeHash: string;
  allowStaleReplacement?: boolean;
}) {
  const action = await tx.supplyExecutionTask.findFirst({
    where: {
      id: args.purchaseActionId,
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      taskType: PURCHASE_ACTION_TASK_TYPE,
      capabilityKey: PURCHASE_ACTION_CAPABILITY,
      status: "READY",
      inputHash: args.expectedScopeHash,
    },
    select: {
      id: true,
      parentTaskId: true,
      input: true,
      inputHash: true,
      result: true,
      approvals: {
        where: { status: "APPROVED", scopeHash: args.expectedScopeHash, requiredRole: "ADMIN" },
        orderBy: { requestedAt: "desc" },
        take: 1,
        include: { decidedBy: { select: { role: true, isActive: true } } },
      },
    },
  });
  if (!action?.parentTaskId || record(action.result).state !== "AUTHORIZED") {
    throw new SupplyPersistenceError("The exact purchase order is no longer authorized for delivery.", "conflict");
  }
  const approval = action.approvals[0];
  if (!approval || approval.scopeHash !== action.inputHash || !approval.decidedBy?.isActive || approval.decidedBy.role !== "ADMIN") {
    throw new SupplyPersistenceError("The purchase authorization no longer has an active admin decision.", "conflict");
  }
  const input = record(action.input);
  const commercial = record(input.commercial);
  const qualityPlan = record(input.qualityPlan);
  const sourceExpired = !currentSupplierQualification(input.sourceEvidenceReview);
  const quoteExpired = isoDate(commercial.quoteValidUntil, "Authorized quote validity date") < todayUtc();
  const qualityExpired = !passingQualityEvidence(qualityPlan) || typeof qualityPlan.targetDate !== "string" || qualityPlan.targetDate < todayUtc();
  const staleGate: ReplacementFreshnessGate | null = sourceExpired
    ? "SOURCE_EVIDENCE"
    : quoteExpired
      ? "COMMERCIAL_TERMS"
      : qualityExpired
        ? "QUALITY_PLAN"
        : null;
  if (staleGate && (!args.allowStaleReplacement || !Object.keys(record(input.revisionContext)).length)) {
    throw new SupplyPersistenceError(
      sourceExpired
        ? "Supplier qualification is missing or expired. Requalify before sending the order."
        : quoteExpired
          ? "The authorized quote expired before order delivery."
          : "The approved quality plan expired before order delivery.",
      "conflict",
    );
  }
  const order = record(input.order);
  return { action, approval, input, commercial, order, staleGate };
}

export async function listPurchaseOrderCommunicationTasks(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  purchaseDraftIds: string[];
}) {
  if (!args.purchaseDraftIds.length) return [];
  const accessContext = await currentAccessContext(args.context);
  const workspace = await requireSupplyWorkspace(accessContext, args.workspaceId, "view");
  return prisma.supplyExecutionTask.findMany({
    where: {
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      parentTaskId: { in: args.purchaseDraftIds },
      taskType: { in: [PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE, PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE] },
      status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING", "SUCCEEDED"] },
    },
    orderBy: { updatedAt: "desc" },
    select: communicationTaskSelect,
  });
}

export async function savePurchaseOrderEmailDraft(args: {
  context: SupplyAccessContext;
  purchaseActionId: string;
  input: unknown;
}) {
  const draftInput = normalizedOrderDraft(args.input);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingWorkspaceForTask(accessContext, args.purchaseActionId, "edit", [PURCHASE_ACTION_TASK_TYPE]);
  const sender = await prisma.emailAccount.findFirst({
    where: {
      id: draftInput.senderAccountId,
      officeId: accessContext.officeId,
      provider: "GMAIL",
      isActive: true,
      sendEnabled: true,
      OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
    },
    select: { id: true, email: true },
  });
  if (!sender) throw new SupplyPersistenceError("The selected Gmail sender is missing, inactive, disconnected, or disabled for sending.", "invalid_input");
  const lookup = await prisma.supplyExecutionTask.findFirst({
    where: { id: args.purchaseActionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ACTION_TASK_TYPE },
    select: { parentTaskId: true, parentTask: { select: { parentTaskId: true } } },
  });
  const purchaseDraftId = lookup?.parentTaskId;
  const procurementCaseId = lookup?.parentTask?.parentTaskId;
  if (!purchaseDraftId || !procurementCaseId) throw new SupplyPersistenceError("Authorized purchase action was not found.", "not_found");

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${purchaseDraftId}, ${args.purchaseActionId}) AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${purchaseDraftId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const scope = await activeOrderScope(tx, { officeId: accessContext.officeId, workspaceId: workspace.id, purchaseActionId: args.purchaseActionId, expectedScopeHash: draftInput.expectedActionScopeHash });
    const procurementCase = await tx.supplyExecutionTask.findFirst({ where: { id: procurementCaseId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PROCUREMENT_CASE_TASK_TYPE }, select: { result: true } });
    if (!procurementCase || record(record(procurementCase.result).purchaseAuthorization).actionTaskId !== scope.action.id || record(record(procurementCase.result).purchaseAuthorization).status !== "APPROVED") {
      throw new SupplyPersistenceError("The procurement case no longer points to this authorized order.", "conflict");
    }
    if (draftInput.acknowledgmentDueOn < todayUtc()) throw new SupplyPersistenceError("Acknowledgment due date cannot be in the past.", "invalid_input");
    const needBy = isoDate(scope.order.needBy, "Authorized need-by date");
    if (draftInput.acknowledgmentDueOn > needBy) throw new SupplyPersistenceError("Acknowledgment due date cannot be after the authorized need-by date.", "invalid_input");
    const purchaseResult = record(scope.action.result);
    if (record(purchaseResult.release).releaseHash) throw new SupplyPersistenceError("The purchase order was already released.", "conflict");

    let existing = await tx.supplyExecutionTask.findFirst({
      where: { officeId: accessContext.officeId, workspaceId: workspace.id, parentTaskId: purchaseDraftId, taskType: PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE, status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] } },
      orderBy: { updatedAt: "desc" },
      select: communicationTaskSelect,
    });
    if (existing?.status === "RUNNING") throw new SupplyPersistenceError("Order email delivery is unresolved. Reconcile it before editing the message.", "conflict");
    const current = record(existing?.result);
    const revision = typeof current.revision === "number" ? current.revision : 0;
    if (draftInput.expectedRevision !== revision) throw new SupplyPersistenceError("The order email draft changed in another session. Reload before saving.", "conflict");
    const message = { senderAccountId: sender.id, senderEmail: sender.email, recipient: draftInput.recipient, subject: draftInput.subject, body: draftInput.body };
    const issuance = { purchaseOrderReference: draftInput.purchaseOrderReference, acknowledgmentDueOn: draftInput.acknowledgmentDueOn, note: draftInput.note };
    const messageHash = digest({ message, issuance });
    if (existing && current.messageHash === messageHash && record(existing.input).purchaseActionScopeHash === scope.action.inputHash) return existing;
    const activeActions = await tx.supplyExecutionTask.findMany({
      where: { officeId: accessContext.officeId, workspaceId: workspace.id, parentTaskId: purchaseDraftId, taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE, status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] } },
      select: { id: true, status: true, result: true },
    });
    if (activeActions.some((action) => action.status === "RUNNING" || ["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"].includes(String(record(action.result).state)))) {
      throw new SupplyPersistenceError("Order email delivery is unresolved. Reconcile it before editing the message.", "conflict");
    }
    const now = new Date();
    const actionIds = activeActions
      .filter((action) => !(action.status === "BLOCKED" && record(action.result).state === "NOT_FOUND_REVIEW_REQUIRED"))
      .map((action) => action.id);
    if (actionIds.length) {
      await tx.supplyApproval.updateMany({ where: { executionTaskId: { in: actionIds }, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: now, decisionNote: "Purchase order email draft changed." } });
      await tx.supplyExecutionTask.updateMany({ where: { id: { in: actionIds }, status: { in: ["PLANNED", "BLOCKED", "READY"] } }, data: { status: "CANCELLED", cancelledAt: now } });
    }
    if (existing && existing.status !== "PLANNED") {
      await tx.supplyExecutionTask.update({ where: { id: existing.id }, data: { status: "CANCELLED", cancelledAt: now } });
      existing = null;
    }
    const taskInput = { procurementCaseId, purchaseDraftId, purchaseActionId: scope.action.id, purchaseActionScopeHash: scope.action.inputHash, supplier: scope.input.supplier };
    const result = { revision: revision + 1, message, issuance, messageHash, approval: null, updatedAt: now.toISOString() };
    const draft = existing
      ? await tx.supplyExecutionTask.update({ where: { id: existing.id }, data: { input: inputJson(taskInput), inputHash: digest(taskInput), result: inputJson(result), resultHash: digest(result) }, select: communicationTaskSelect })
      : await tx.supplyExecutionTask.create({
          data: { officeId: accessContext.officeId, workspaceId: workspace.id, createdByUserId: accessContext.userId, parentTaskId: purchaseDraftId, taskKey: `purchase-order-email-draft:${purchaseDraftId}:${scope.action.inputHash}:${result.revision}`, taskType: PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE, capabilityKey: EMAIL_CAPABILITY, requiresApproval: false, input: inputJson(taskInput), inputHash: digest(taskInput), result: inputJson(result), resultHash: digest(result) },
          select: communicationTaskSelect,
        });
    await appendEvent({ tx, taskId: draft.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: existing ? "PURCHASE_ORDER_EMAIL_DRAFT_UPDATED" : "PURCHASE_ORDER_EMAIL_DRAFT_CREATED", status: "PLANNED", message: existing ? "Purchase order email draft was updated." : "Purchase order email draft was created.", payload: inputJson({ purchaseActionId: scope.action.id, revision: result.revision, messageHash }) });
    return draft;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "The purchase order email draft changed concurrently. Reload and retry.");
}

export async function requestPurchaseOrderEmailApproval(args: { context: SupplyAccessContext; draftId: string; input: unknown }) {
  const body = record(args.input);
  const expectedResultHash = requiredText(body.expectedResultHash, "Order email draft result hash", 128);
  const reason = requiredText(body.reason, "Approval reason", 2_000);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingWorkspaceForTask(accessContext, args.draftId, "edit", [PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE]);
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const draftLookup = await tx.supplyExecutionTask.findFirst({ where: { id: args.draftId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE }, select: { parentTaskId: true, input: true } });
    if (!draftLookup?.parentTaskId) throw new SupplyPersistenceError("Purchase order email draft was not found.", "not_found");
    const draftInput = record(draftLookup.input);
    const procurementCaseId = requiredText(draftInput.procurementCaseId, "Procurement case ID", 220);
    const purchaseActionId = requiredText(draftInput.purchaseActionId, "Purchase action ID", 220);
    const expectedScopeHash = requiredText(draftInput.purchaseActionScopeHash, "Authorized order scope hash", 128);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${draftLookup.parentTaskId}, ${purchaseActionId}, ${args.draftId}) AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${draftLookup.parentTaskId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const scope = await activeOrderScope(tx, { officeId: accessContext.officeId, workspaceId: workspace.id, purchaseActionId, expectedScopeHash });
    const draft = await tx.supplyExecutionTask.findFirst({ where: { id: args.draftId, officeId: accessContext.officeId, workspaceId: workspace.id, parentTaskId: draftLookup.parentTaskId, taskType: PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE, status: { in: ["PLANNED", "BLOCKED", "READY"] } }, select: communicationTaskSelect });
    if (!draft || draft.resultHash !== expectedResultHash) throw new SupplyPersistenceError("The purchase order email draft changed. Reload before requesting approval.", "conflict");
    const draftResult = record(draft.result);
    if (record(scope.action.result).release && record(record(scope.action.result).release).releaseHash) throw new SupplyPersistenceError("The purchase order was already released.", "conflict");
    const immutableInput = {
      action: "SEND_PURCHASE_ORDER",
      procurementCaseId,
      purchaseDraftId: draftLookup.parentTaskId,
      purchaseActionId,
      purchaseActionScopeHash: scope.action.inputHash,
      order: scope.order,
      commercial: scope.commercial,
      supplier: scope.input.supplier,
      sourceEvidenceReview: scope.input.sourceEvidenceReview,
      draftId: draft.id,
      draftRevision: draftResult.revision,
      draftMessageHash: draftResult.messageHash,
      requestedDraftResultHash: expectedResultHash,
      message: draftResult.message,
      issuance: draftResult.issuance,
    };
    const scopeHash = digest(immutableInput);
    const terminal = await tx.supplyApproval.findFirst({ where: { officeId: accessContext.officeId, workspaceId: workspace.id, scopeHash, status: { in: ["APPROVED", "REJECTED"] }, executionTask: { taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE } }, select: { status: true, executionTask: { select: { status: true } } } });
    if (terminal && (terminal.status === "REJECTED" || terminal.executionTask?.status !== "CANCELLED")) {
      throw new SupplyPersistenceError(terminal.status === "APPROVED" ? "This exact purchase order email was already approved." : "This exact purchase order email was rejected. Edit the draft before requesting another approval.", "conflict");
    }
    const pending = await tx.supplyApproval.findFirst({ where: { officeId: accessContext.officeId, workspaceId: workspace.id, scopeHash, status: "PENDING", executionTask: { taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE } }, include: { executionTask: { select: communicationTaskSelect } } });
    if (pending?.executionTask) return { draft, action: pending.executionTask, approval: pending };
    const attempts = await tx.supplyApproval.count({ where: { officeId: accessContext.officeId, workspaceId: workspace.id, scopeHash, executionTask: { taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE } } });
    const attempt = attempts + 1;
    const action = await tx.supplyExecutionTask.create({
      data: { officeId: accessContext.officeId, workspaceId: workspace.id, createdByUserId: accessContext.userId, parentTaskId: draftLookup.parentTaskId, taskKey: `purchase-order-email-action:${draftLookup.parentTaskId}:${scopeHash}:${attempt}`, taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE, capabilityKey: EMAIL_CAPABILITY, externalSystem: "GMAIL", requiresApproval: true, input: inputJson(immutableInput), inputHash: scopeHash, idempotencyKey: `purchase-order-email-action:${draftLookup.parentTaskId}:${scopeHash}:${attempt}` },
      select: communicationTaskSelect,
    });
    const approval = await tx.supplyApproval.create({ data: { officeId: accessContext.officeId, workspaceId: workspace.id, executionTaskId: action.id, requestedByUserId: accessContext.userId, requiredRole: REQUIRED_ROLE, scopeHash, requestReason: reason, requestContext: inputJson({ procurementCaseId, purchaseDraftId: draftLookup.parentTaskId, purchaseActionId, draftId: draft.id }), idempotencyKey: `purchase-order-email:${draftLookup.parentTaskId}:${scopeHash}:${attempt}` } });
    const now = new Date();
    const nextDraftResult = { ...draftResult, approval: { id: approval.id, actionId: action.id, status: "PENDING", scopeHash, requestedAt: approval.requestedAt.toISOString() }, updatedAt: now.toISOString() };
    const updatedDraft = await tx.supplyExecutionTask.update({ where: { id: draft.id }, data: { status: "BLOCKED", result: inputJson(nextDraftResult), resultHash: digest(nextDraftResult) }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: action.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: "PURCHASE_ORDER_EMAIL_APPROVAL_REQUESTED", status: "BLOCKED", message: "The exact purchase order email was submitted for approval.", payload: inputJson({ purchaseActionId, draftId: draft.id, scopeHash }) });
    return { draft: updatedDraft, action, approval };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Purchase order email approval changed concurrently. Reload and retry.");
}

export async function decidePurchaseOrderEmailApproval(args: { context: SupplyAccessContext; approvalId: string; input: unknown }) {
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) throw new SupplyPersistenceError("Only an admin or manager can decide purchase order email approvals.", "forbidden");
  const body = record(args.input);
  const decision = body.decision;
  if (decision !== "APPROVE" && decision !== "REJECT") throw new SupplyPersistenceError("Decision must be APPROVE or REJECT.", "invalid_input");
  const note = optionalText(body.note, "Approval note", 2_000);
  const found = await prisma.supplyApproval.findFirst({ where: { id: args.approvalId, officeId: accessContext.officeId }, include: { executionTask: true } });
  if (!found?.executionTask || found.executionTask.taskType !== PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE || !found.executionTask.parentTaskId) throw new SupplyPersistenceError("Purchase order email approval was not found.", "not_found");
  const workspace = await requireSupplyWorkspace(accessContext, found.workspaceId, "edit");
  const actionInput = record(found.executionTask.input);
  const draftId = requiredText(actionInput.draftId, "Purchase order email draft ID", 220);
  const purchaseActionId = requiredText(actionInput.purchaseActionId, "Purchase action ID", 220);
  const procurementCaseId = requiredText(actionInput.procurementCaseId, "Procurement case ID", 220);
  const targetStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${found.executionTask!.parentTaskId}, ${purchaseActionId}, ${draftId}, ${found.executionTask!.id}) AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyApproval" WHERE "id" = ${args.approvalId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    const approval = await tx.supplyApproval.findFirst({ where: { id: args.approvalId, officeId: accessContext.officeId, workspaceId: workspace.id }, include: { executionTask: true } });
    const draft = await tx.supplyExecutionTask.findFirst({ where: { id: draftId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE }, select: communicationTaskSelect });
    const scope = await activeOrderScope(tx, { officeId: accessContext.officeId, workspaceId: workspace.id, purchaseActionId, expectedScopeHash: requiredText(actionInput.purchaseActionScopeHash, "Authorized order scope hash", 128) });
    if (!approval?.executionTask || !draft || approval.executionTask.inputHash !== approval.scopeHash || approval.scopeHash !== found.scopeHash) throw new SupplyPersistenceError("Purchase order email approval scope is invalid.", "conflict");
    const draftResult = record(draft.result);
    if (draftResult.messageHash !== actionInput.draftMessageHash || draftResult.revision !== actionInput.draftRevision || scope.action.inputHash !== actionInput.purchaseActionScopeHash) {
      throw new SupplyPersistenceError("The purchase order or email changed after approval was requested.", "conflict");
    }
    if (approval.status !== "PENDING") {
      if (approval.status === targetStatus && approval.decidedByUserId === accessContext.userId) return { draft, action: approval.executionTask, approval };
      throw new SupplyPersistenceError("This purchase order email approval has already been decided.", "conflict");
    }
    if (approval.requestedByUserId === accessContext.userId) {
      const alternatives = await tx.user.count({ where: { officeId: accessContext.officeId, id: { not: accessContext.userId }, isActive: true, role: { in: ["ADMIN", "MANAGER"] }, OR: [{ canViewWholeOffice: true }, { supplyWorkspaceMembers: { some: { workspaceId: workspace.id } } }] } });
      if (alternatives > 0) throw new SupplyPersistenceError("A different eligible approver is available, so self-approval is blocked.", "forbidden");
    }
    const decidedAt = new Date();
    const decided = await tx.supplyApproval.update({ where: { id: approval.id }, data: { status: targetStatus, decidedByUserId: accessContext.userId, decidedAt, decisionNote: note } });
    const actionResult = { state: decision === "APPROVE" ? "APPROVED" : "REJECTED", approvalId: approval.id, scopeHash: approval.scopeHash, decidedByUserId: accessContext.userId, decidedAt: decidedAt.toISOString(), note, attempt: 0 };
    const action = await tx.supplyExecutionTask.update({ where: { id: approval.executionTask.id }, data: { status: decision === "APPROVE" ? "READY" : "BLOCKED", result: inputJson(actionResult), resultHash: digest(actionResult) }, select: communicationTaskSelect });
    const nextDraftResult = { ...draftResult, approval: { ...record(draftResult.approval), status: targetStatus, decidedByUserId: accessContext.userId, decidedAt: decidedAt.toISOString(), decisionNote: note }, updatedAt: decidedAt.toISOString() };
    const updatedDraft = await tx.supplyExecutionTask.update({ where: { id: draft.id }, data: { status: decision === "APPROVE" ? "READY" : "BLOCKED", result: inputJson(nextDraftResult), resultHash: digest(nextDraftResult) }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: action.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: decision === "APPROVE" ? "PURCHASE_ORDER_EMAIL_APPROVED" : "PURCHASE_ORDER_EMAIL_REJECTED", status: action.status, message: decision === "APPROVE" ? "The exact purchase order email was approved for delivery." : "The purchase order email was rejected.", payload: inputJson(actionResult) });
    return { draft: updatedDraft, action, approval: decided };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Purchase order email approval changed concurrently. Reload and retry.");
}

async function finalizePurchaseOrderEmail(args: { context: SupplyAccessContext; workspaceId: string; actionId: string; receipt: SupplierEmailSent; rfcMessageId: string }) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const lookup = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE }, select: { parentTaskId: true, input: true } });
    if (!lookup?.parentTaskId) throw new SupplyPersistenceError("Purchase order email action was not found.", "not_found");
    const actionInput = record(lookup.input);
    const purchaseDraftId = lookup.parentTaskId;
    const purchaseActionId = requiredText(actionInput.purchaseActionId, "Purchase action ID", 220);
    const procurementCaseId = requiredText(actionInput.procurementCaseId, "Procurement case ID", 220);
    const draftId = requiredText(actionInput.draftId, "Purchase order email draft ID", 220);
    const expectedScopeHash = requiredText(actionInput.purchaseActionScopeHash, "Authorized order scope hash", 128);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${purchaseDraftId}, ${purchaseActionId}, ${draftId}, ${args.actionId}) AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} ORDER BY "id" FOR UPDATE`);
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE }, select: communicationTaskSelect });
    const draft = await tx.supplyExecutionTask.findFirst({ where: { id: draftId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE }, select: communicationTaskSelect });
    const procurementCase = await tx.supplyExecutionTask.findFirst({ where: { id: procurementCaseId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: PROCUREMENT_CASE_TASK_TYPE }, select: { id: true, result: true } });
    const purchaseDraft = await tx.supplyExecutionTask.findFirst({ where: { id: purchaseDraftId, officeId: args.context.officeId, workspaceId: args.workspaceId, parentTaskId: procurementCaseId, taskType: PURCHASE_DRAFT_TASK_TYPE, status: "READY" }, select: { id: true, status: true } });
    if (!action || !draft || !procurementCase || !purchaseDraft) throw new SupplyPersistenceError("Purchase order email delivery scope is incomplete.", "conflict");
    if (action.status === "SUCCEEDED" && record(action.result).providerMessageId === args.receipt.providerMessageId) return action;
    const scope = await activeOrderScope(tx, { officeId: args.context.officeId, workspaceId: args.workspaceId, purchaseActionId, expectedScopeHash });
    const caseResult = record(procurementCase.result);
    const authorization = record(caseResult.purchaseAuthorization);
    if (authorization.actionTaskId !== purchaseActionId || authorization.scopeHash !== expectedScopeHash || authorization.status !== "APPROVED") throw new SupplyPersistenceError("The procurement case no longer points to this authorized order.", "conflict");
    const currentPurchaseResult = record(scope.action.result);
    if (record(currentPurchaseResult.release).releaseHash) throw new SupplyPersistenceError("The purchase order was already released.", "conflict");
    const message = record(actionInput.message);
    const issuance = record(actionInput.issuance);
    const now = new Date();
    const releasedOn = now.toISOString().slice(0, 10);
    const acknowledgmentDueOn = isoDate(issuance.acknowledgmentDueOn, "Approved acknowledgment due date");
    const purchaseOrderReference = requiredText(issuance.purchaseOrderReference, "Approved purchase order reference", 300);
    if (acknowledgmentDueOn < releasedOn || acknowledgmentDueOn > isoDate(scope.order.needBy, "Authorized need-by date")) throw new SupplyPersistenceError("The approved acknowledgment due date is no longer valid.", "conflict");
    if (releasedOn > isoDate(scope.commercial.quoteValidUntil, "Authorized quote validity date") || !supplierQualificationValidOn(scope.input.sourceEvidenceReview, releasedOn)) throw new SupplyPersistenceError("The order cannot be sent because its quote or supplier qualification expired.", "conflict");
    const approvalDate = scope.approval.decidedAt?.toISOString().slice(0, 10) ?? null;
    if (!approvalDate || releasedOn < approvalDate) throw new SupplyPersistenceError("Purchase order delivery cannot precede final purchase authorization.", "conflict");
    const order = scope.order;
    const commercial = scope.commercial;
    let orderedQuantity: Prisma.Decimal;
    let unitPrice: Prisma.Decimal;
    try {
      orderedQuantity = new Prisma.Decimal(requiredText(order.quantity, "Authorized order quantity", 80));
      unitPrice = new Prisma.Decimal(requiredText(commercial.unitPrice, "Authorized unit price", 80));
    } catch {
      throw new SupplyPersistenceError("Authorized order quantity or price is invalid.", "conflict");
    }
    if (!orderedQuantity.isPositive() || !unitPrice.isPositive()) throw new SupplyPersistenceError("Authorized order quantity or price is invalid.", "conflict");
    const unitOfMeasure = requiredText(order.unitOfMeasure, "Authorized unit of measure", 20).toUpperCase();
    const currency = requiredText(commercial.currency, "Authorized currency", 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new SupplyPersistenceError("Authorized currency is invalid.", "conflict");
    let localThreadId: string | null = null;
    const existingMessage = await tx.emailMessage.findFirst({ where: { accountId: requiredText(message.senderAccountId, "Stored sender account", 220), thread: { officeId: args.context.officeId }, OR: [{ gmailMessageId: args.receipt.providerMessageId }, { externalId: args.rfcMessageId }] }, select: { threadId: true } });
    if (existingMessage) localThreadId = existingMessage.threadId;
    else {
      const thread = await tx.emailThread.create({ data: { officeId: args.context.officeId, subject: requiredText(message.subject, "Stored email subject", 180), participants: JSON.stringify([message.senderEmail, message.recipient]), externalThreadId: args.receipt.providerThreadId, lastMessageAt: now, messageCount: 1 } });
      localThreadId = thread.id;
      await tx.emailMessage.create({ data: { threadId: thread.id, accountId: requiredText(message.senderAccountId, "Stored sender account", 220), externalId: args.rfcMessageId, gmailMessageId: args.receipt.providerMessageId, direction: "OUTBOUND", fromEmail: requiredText(message.senderEmail, "Stored sender email", 320), toEmails: JSON.stringify([requiredText(message.recipient, "Stored recipient", 320)]), subject: requiredText(message.subject, "Stored email subject", 180), bodyText: messageBody(message.body), sentAt: now } });
    }
    const normalizedRelease = { actionScopeHash: scope.action.inputHash, channel: "EMAIL", releasedOn, acknowledgmentDueOn, purchaseOrderReference, evidenceUrl: args.receipt.sourceUrl, note: optionalText(issuance.note, "Stored purchase order release note", 2_000) };
    const releaseHash = digest(normalizedRelease);
    const evidenceKey = `purchase_order_release:${purchaseActionId}:${releaseHash}`;
    const existingEvidence = await tx.supplyEvidence.findUnique({ where: { workspaceId_evidenceKey: { workspaceId: args.workspaceId, evidenceKey } }, select: { id: true, officeId: true, executionTaskId: true, sourceRecordId: true } });
    if (existingEvidence && (existingEvidence.officeId !== args.context.officeId || existingEvidence.executionTaskId !== purchaseActionId || existingEvidence.sourceRecordId !== args.receipt.providerMessageId)) throw new SupplyPersistenceError("Purchase order email evidence identity conflicted with an existing record.", "conflict");
    const evidence = existingEvidence ?? await tx.supplyEvidence.create({ data: { officeId: args.context.officeId, workspaceId: args.workspaceId, executionTaskId: purchaseActionId, createdByUserId: args.context.userId, evidenceKey, kind: "PURCHASE_ORDER_RELEASE", sourceType: "CONNECTED_PROVIDER", sourceUri: args.receipt.sourceUrl, sourceRecordId: args.receipt.providerMessageId, sourceVersion: releaseHash, title: `Purchase order release ${purchaseOrderReference}`, payload: inputJson({ ...normalizedRelease, provider: args.receipt.provider, providerMessageId: args.receipt.providerMessageId, providerThreadId: args.receipt.providerThreadId, rfcMessageId: args.rfcMessageId, messageHash: digest(message) }), contentHash: releaseHash, observedAt: now }, select: { id: true } });
    const release = { ...normalizedRelease, evidenceId: evidence.id, evidenceClass: "CONNECTED_PROVIDER", provider: args.receipt.provider, providerMessageId: args.receipt.providerMessageId, providerThreadId: args.receipt.providerThreadId, rfcMessageId: args.rfcMessageId, messageHash: digest(message), releaseHash, recordedByUserId: args.context.userId, recordedAt: now.toISOString() };
    const supersession = await finalizeReplacementSupersession({
      tx,
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      procurementCaseId,
      replacementActionId: purchaseActionId,
      replacementActionInput: scope.action.input,
      replacementScopeHash: scope.action.inputHash,
      replacementReleaseHash: releaseHash,
      releasedAt: now,
    });
    const purchaseResult = { state: "RELEASED", authorization: { approvalId: scope.approval.id, scopeHash: scope.approval.scopeHash, decidedByUserId: scope.approval.decidedByUserId, decidedAt: scope.approval.decidedAt?.toISOString() ?? null }, release, orderedQuantity: orderedQuantity.toString(), acknowledgedQuantity: "0", remainingQuantity: orderedQuantity.toString(), unitOfMeasure, acknowledgments: [], totals: { acknowledgedMaterialValue: "0", currency }, externalSideEffect: "CONNECTED_PROVIDER", updatedAt: now.toISOString() };
    await tx.supplyExecutionTask.update({ where: { id: purchaseActionId }, data: { status: "RUNNING", startedAt: now, result: inputJson(purchaseResult), resultHash: digest(purchaseResult) } });
    await tx.supplyExecutionTask.update({ where: { id: purchaseDraftId }, data: { status: "RUNNING", startedAt: now } });
    const purchaseRevision = record(caseResult.purchaseRevision);
    const nextCaseResult = {
      ...caseResult,
      purchaseAuthorization: { ...authorization, status: "RELEASED" },
      ...(Object.keys(purchaseRevision).length ? { purchaseRevision: { ...purchaseRevision, state: "RELEASED", replacementReleaseHash: releaseHash, updatedAt: now.toISOString() } } : {}),
      purchaseRelease: { state: "RELEASED", orderedQuantity: orderedQuantity.toString(), acknowledgedQuantity: "0", remainingQuantity: orderedQuantity.toString(), unitOfMeasure, release, updatedAt: now.toISOString() },
      updatedAt: now.toISOString(),
    };
    await tx.supplyExecutionTask.update({ where: { id: procurementCaseId }, data: { result: inputJson(nextCaseResult), resultHash: digest(nextCaseResult) } });
    const deliveryResult = { state: "SENT", attempt: record(action.result).attempt, rfcMessageId: args.rfcMessageId, provider: args.receipt.provider, providerMessageId: args.receipt.providerMessageId, providerThreadId: args.receipt.providerThreadId, sourceUrl: args.receipt.sourceUrl, localThreadId, evidenceId: evidence.id, releaseHash, sentAt: now.toISOString() };
    if (action.status === "READY") await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { status: "RUNNING", startedAt: now } });
    if (draft.status === "READY") await tx.supplyExecutionTask.update({ where: { id: draft.id }, data: { status: "RUNNING", startedAt: now } });
    const sentAction = await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { status: "SUCCEEDED", result: inputJson(deliveryResult), resultHash: digest(deliveryResult), completedAt: now, error: Prisma.DbNull }, select: communicationTaskSelect });
    await tx.supplyExecutionTask.update({ where: { id: draft.id }, data: { status: "SUCCEEDED", completedAt: now } });
    const payload = inputJson({ procurementCaseId, purchaseActionId, release, emailActionId: action.id });
    await appendEvent({ tx, taskId: action.id, officeId: args.context.officeId, workspaceId: args.workspaceId, actorUserId: args.context.userId, eventType: "PURCHASE_ORDER_EMAIL_SENT", status: "SUCCEEDED", message: "Gmail returned a purchase order delivery receipt.", payload });
    await appendEvent({ tx, taskId: purchaseActionId, officeId: args.context.officeId, workspaceId: args.workspaceId, actorUserId: args.context.userId, eventType: "PURCHASE_ORDER_RELEASED", status: "RUNNING", message: "The authorized purchase order was sent through connected Gmail.", payload });
    await appendEvent({ tx, taskId: procurementCaseId, officeId: args.context.officeId, workspaceId: args.workspaceId, actorUserId: args.context.userId, eventType: "PURCHASE_ORDER_RELEASED", status: "RUNNING", message: "The purchase order is awaiting supplier acknowledgment.", payload });
    if (supersession) {
      await appendEvent({ tx, taskId: supersession.supersededActionId, officeId: args.context.officeId, workspaceId: args.workspaceId, actorUserId: args.context.userId, eventType: "PURCHASE_ORDER_SUPERSEDED", status: "SUCCEEDED", message: "The revised order was sent and superseded the earlier supplier-facing scope.", payload: inputJson({ replacementPurchaseActionId: purchaseActionId, releaseHash, supplierExceptionHash: supersession.supplierExceptionHash }) });
    }
    return sentAction;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Purchase order email delivery changed concurrently. Reconcile before retrying.");
}

export async function sendPurchaseOrderEmailAction(args: { context: SupplyAccessContext; actionId: string; provider?: SupplierEmailProvider }) {
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingWorkspaceForTask(accessContext, args.actionId, "edit", [PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE]);
  const claimed = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const lookup = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE }, select: { parentTaskId: true, input: true } });
    if (!lookup?.parentTaskId) throw new SupplyPersistenceError("Purchase order email action was not found.", "not_found");
    const actionInput = record(lookup.input);
    const purchaseActionId = requiredText(actionInput.purchaseActionId, "Purchase action ID", 220);
    const draftId = requiredText(actionInput.draftId, "Purchase order email draft ID", 220);
    const procurementCaseId = requiredText(actionInput.procurementCaseId, "Procurement case ID", 220);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${lookup.parentTaskId}, ${purchaseActionId}, ${draftId}, ${args.actionId}) AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE }, select: communicationTaskSelect });
    if (!action) throw new SupplyPersistenceError("Purchase order email action was not found.", "not_found");
    if (action.status === "SUCCEEDED") return { alreadySent: action, input: null, rfcMessageId: null };
    const scope = await activeOrderScope(tx, {
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      purchaseActionId,
      expectedScopeHash: requiredText(actionInput.purchaseActionScopeHash, "Authorized order scope hash", 128),
      allowStaleReplacement: true,
    });
    if (record(record(scope.action.result).release).releaseHash) throw new SupplyPersistenceError("The purchase order was already released.", "conflict");
    if (scope.staleGate) {
      await returnStaleReplacementToSourcing({
        tx,
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        procurementCaseId,
        actorUserId: accessContext.userId,
        revisionContext: record(scope.input.revisionContext),
        replacementDraftId: scope.action.parentTaskId,
        replacementActionId: scope.action.id,
        staleGate: scope.staleGate,
      });
      const cancelledAction = await tx.supplyExecutionTask.findUniqueOrThrow({
        where: { id: action.id },
        select: communicationTaskSelect,
      });
      return { alreadySent: cancelledAction, input: null, rfcMessageId: null };
    }
    const prior = record(action.result);
    const retryableRunning = action.status === "RUNNING" && ["RETRY_READY", "SEND_FAILED"].includes(String(prior.state));
    if ((action.status === "RUNNING" && !retryableRunning) || action.status === "BLOCKED" || prior.state === "SENDING") throw new SupplyPersistenceError("Order email delivery is unresolved or blocked. Reconcile it before another send.", "conflict");
    const approval = action.approvals[0];
    if (!["READY", "RUNNING"].includes(action.status) || !approval || approval.status !== "APPROVED" || approval.scopeHash !== action.inputHash) throw new SupplyPersistenceError("The exact purchase order email is not approved for delivery.", "conflict");
    const attempt = typeof prior.attempt === "number" ? prior.attempt + 1 : 1;
    const rfcMessageId = `<purchase-${action.id}-${attempt}@derya.ai>`;
    const sending = { state: "SENDING", attempt, rfcMessageId, startedAt: new Date().toISOString() };
    await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { result: inputJson(sending), resultHash: digest(sending), error: Prisma.DbNull } });
    await appendEvent({ tx, taskId: action.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: "PURCHASE_ORDER_EMAIL_SEND_STARTED", status: "RUNNING", message: "Purchase order email delivery started.", payload: inputJson({ attempt, rfcMessageId }) });
    return { alreadySent: null, input: actionInput, rfcMessageId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Purchase order email delivery changed concurrently. Reload before sending.");
  if (claimed.alreadySent) return claimed.alreadySent;
  const message = record(claimed.input?.message);
  const provider = args.provider ?? gmailSupplierEmailProvider;
  const receipt = await provider.send({ officeId: accessContext.officeId, accountId: requiredText(message.senderAccountId, "Sender account", 220), senderEmail: singleEmail(message.senderEmail, "Approved sender email"), recipient: singleEmail(message.recipient, "Supplier recipient"), subject: requiredText(message.subject, "Email subject", 180), body: messageBody(message.body), rfcMessageId: claimed.rfcMessageId! });
  if (receipt.state === "SENT") return finalizePurchaseOrderEmail({ context: accessContext, workspaceId: workspace.id, actionId: args.actionId, receipt, rfcMessageId: claimed.rfcMessageId! });
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE }, select: communicationTaskSelect });
    if (!action) throw new SupplyPersistenceError("Purchase order email action was not found.", "not_found");
    const current = record(action.result);
    if (action.status === "SUCCEEDED" && current.state === "SENT") return action;
    if (current.rfcMessageId !== claimed.rfcMessageId) throw new SupplyPersistenceError("Purchase order email delivery changed concurrently.", "conflict");
    if (current.state !== "SENDING") return action;
    const state = receipt.state === "UNKNOWN" ? "DELIVERY_UNKNOWN" : "SEND_FAILED";
    const result = { ...current, state, error: receipt.error, needsReauth: receipt.needsReauth ?? false, updatedAt: new Date().toISOString() };
    const updated = await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { status: receipt.state === "UNKNOWN" ? "RUNNING" : action.status, startedAt: receipt.state === "UNKNOWN" ? new Date() : undefined, result: inputJson(result), resultHash: digest(result), error: inputJson({ message: receipt.error, state }) }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: action.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: receipt.state === "UNKNOWN" ? "PURCHASE_ORDER_EMAIL_DELIVERY_UNKNOWN" : "PURCHASE_ORDER_EMAIL_SEND_REJECTED", status: updated.status, message: receipt.state === "UNKNOWN" ? "Gmail delivery is unknown. A retry is blocked until reconciliation." : "Gmail rejected the purchase order before returning a delivery receipt.", payload: inputJson(result) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Purchase order email delivery changed concurrently. Reconcile before retrying.");
}

export async function reconcilePurchaseOrderEmailAction(args: { context: SupplyAccessContext; actionId: string; provider?: SupplierEmailProvider }) {
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingWorkspaceForTask(accessContext, args.actionId, "edit", [PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE]);
  const action = await prisma.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE, status: { in: ["READY", "RUNNING", "BLOCKED"] } }, select: communicationTaskSelect });
  if (!action) throw new SupplyPersistenceError("An unresolved purchase order email action was not found.", "not_found");
  const result = record(action.result);
  if (!["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"].includes(String(result.state))) throw new SupplyPersistenceError("This purchase order email does not need reconciliation.", "conflict");
  const message = record(record(action.input).message);
  const rfcMessageId = requiredText(result.rfcMessageId, "Purchase order email message ID", 500);
  const provider = args.provider ?? gmailSupplierEmailProvider;
  const receipt = await provider.reconcile({ officeId: accessContext.officeId, accountId: requiredText(message.senderAccountId, "Sender account", 220), senderEmail: singleEmail(message.senderEmail, "Approved sender email"), rfcMessageId });
  if (receipt.state === "SENT") return finalizePurchaseOrderEmail({ context: accessContext, workspaceId: workspace.id, actionId: action.id, receipt, rfcMessageId });
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.supplyExecutionTask.findFirst({ where: { id: action.id, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE }, select: communicationTaskSelect });
    if (!current) throw new SupplyPersistenceError("Purchase order email delivery changed concurrently.", "conflict");
    const currentResult = record(current.result);
    if (current.status === "SUCCEEDED" && currentResult.state === "SENT") return current;
    if (currentResult.rfcMessageId !== rfcMessageId) throw new SupplyPersistenceError("Purchase order email delivery changed concurrently.", "conflict");
    if (!["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"].includes(String(currentResult.state))) return current;
    const nextResult = { ...currentResult, state: receipt.state === "NOT_FOUND" ? "NOT_FOUND_REVIEW_REQUIRED" : "DELIVERY_UNKNOWN", error: receipt.error ?? null, lastCheckedAt: new Date().toISOString() };
    const updated = await tx.supplyExecutionTask.update({ where: { id: current.id }, data: { status: "RUNNING", startedAt: new Date(), result: inputJson(nextResult), resultHash: digest(nextResult) }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: current.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: receipt.state === "NOT_FOUND" ? "PURCHASE_ORDER_EMAIL_NOT_FOUND" : "PURCHASE_ORDER_EMAIL_RECONCILIATION_UNKNOWN", status: updated.status, message: receipt.state === "NOT_FOUND" ? "Gmail did not find the stable purchase order message ID. Human review is required before retry." : "Gmail reconciliation did not return a definitive purchase order result.", payload: inputJson(nextResult) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Purchase order email reconciliation changed concurrently. Reload and retry.");
}

export async function resetPurchaseOrderEmailForRetry(args: { context: SupplyAccessContext; actionId: string; input: unknown }) {
  const body = record(args.input);
  if (body.confirmedNotSent !== true) throw new SupplyPersistenceError("Confirm that the purchase order email was not sent before enabling a retry.", "invalid_input");
  const note = requiredText(body.note, "Recovery note", 2_000);
  if (note.length < 10) throw new SupplyPersistenceError("Recovery note must explain how non-delivery was verified.", "invalid_input");
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) throw new SupplyPersistenceError("Only an admin or manager can reset an uncertain purchase order email.", "forbidden");
  const workspace = await sourcingWorkspaceForTask(accessContext, args.actionId, "edit", [PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE]);
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE, status: "RUNNING" }, select: communicationTaskSelect });
    if (!action || record(action.result).state !== "NOT_FOUND_REVIEW_REQUIRED") throw new SupplyPersistenceError("A purchase order email awaiting non-delivery review was not found.", "conflict");
    const now = new Date();
    const recovery = { confirmedNotSent: true, note, confirmedByUserId: accessContext.userId, confirmedAt: now.toISOString() };
    const result = { ...record(action.result), state: "RETRY_READY", recovery };
    const updated = await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { result: inputJson(result), resultHash: digest(result), error: Prisma.DbNull }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: action.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: "PURCHASE_ORDER_EMAIL_RETRY_ENABLED", status: "READY", message: "An operator confirmed non-delivery and enabled one new purchase order send attempt.", payload: inputJson(recovery) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Purchase order email recovery changed concurrently. Reload and retry.");
}
