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
  singleEmail,
  supplierCommunicationTaskSelect as communicationTaskSelect,
  withSerializableRetry,
} from "./supplier-communication-shared";
import {
  gmailSupplierEmailProvider,
  type SupplierEmailProvider,
  type SupplierEmailSent,
} from "./supplier-email-provider";

export const PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE = "PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT";
export const PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE = "PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION";
const PROCUREMENT_CASE_TASK_TYPE = "PROCUREMENT_CASE";
const PURCHASE_DRAFT_TASK_TYPE = "PURCHASE_ORDER_DRAFT";
const PURCHASE_ACTION_TASK_TYPE = "PURCHASE_ORDER_ACTION";
const PURCHASE_ACTION_CAPABILITY = "authorize.purchase_order";
const FOLLOWUP_CAPABILITY = "contact.supplier_purchase_order_followup_email";
const REQUIRED_ROLE = "MANAGER";
const UNRESOLVED_DELIVERY_STATES = ["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"];
const SENDING_RECONCILIATION_DELAY_MS = 60_000;

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function normalizedDraft(input: unknown) {
  const body = record(input);
  return {
    expectedActionScopeHash: requiredText(body.expectedActionScopeHash, "Authorized order scope hash", 128),
    expectedReleaseHash: requiredText(body.expectedReleaseHash, "Purchase order release hash", 128),
    expectedRevision: nonNegativeInteger(body.expectedRevision, "Expected follow-up revision"),
    senderAccountId: requiredText(body.senderAccountId, "Sender account", 220),
    recipient: singleEmail(body.recipient, "Supplier recipient"),
    subject: requiredText(body.subject, "Email subject", 180),
    body: messageBody(body.body),
    note: optionalText(body.note, "Supplier follow-up note", 2_000),
  };
}

async function releasedOrderScope(tx: Prisma.TransactionClient, args: {
  officeId: string;
  workspaceId: string;
  procurementCaseId: string;
  purchaseActionId: string;
  expectedScopeHash: string;
  expectedReleaseHash: string;
  allowCompletedAfterClaim?: boolean;
}) {
  const action = await tx.supplyExecutionTask.findFirst({
    where: {
      id: args.purchaseActionId,
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      taskType: PURCHASE_ACTION_TASK_TYPE,
      capabilityKey: PURCHASE_ACTION_CAPABILITY,
      status: args.allowCompletedAfterClaim ? { in: ["RUNNING", "SUCCEEDED"] } : "RUNNING",
      inputHash: args.expectedScopeHash,
    },
    select: { id: true, parentTaskId: true, input: true, inputHash: true, result: true, status: true },
  });
  if (!action?.parentTaskId) throw new SupplyPersistenceError("The released purchase order was not found.", "not_found");
  const actionResult = record(action.result);
  if (!args.allowCompletedAfterClaim && !["RELEASED", "PARTIALLY_ACKNOWLEDGED"].includes(String(actionResult.state))) {
    throw new SupplyPersistenceError("The purchase order is not awaiting supplier acknowledgment.", "conflict");
  }
  const release = record(actionResult.release);
  if (release.releaseHash !== args.expectedReleaseHash || release.actionScopeHash !== action.inputHash) {
    throw new SupplyPersistenceError("The supplier follow-up does not match the current purchase order release.", "conflict");
  }
  const procurementCase = await tx.supplyExecutionTask.findFirst({
    where: { id: args.procurementCaseId, officeId: args.officeId, workspaceId: args.workspaceId, taskType: PROCUREMENT_CASE_TASK_TYPE },
    select: { id: true, result: true },
  });
  if (!procurementCase) throw new SupplyPersistenceError("The procurement case was not found.", "not_found");
  const caseResult = record(procurementCase.result);
  const authorization = record(caseResult.purchaseAuthorization);
  const projectedRelease = record(caseResult.purchaseRelease);
  if (authorization.actionTaskId !== action.id
    || authorization.scopeHash !== action.inputHash
    || record(projectedRelease.release).releaseHash !== release.releaseHash) {
    throw new SupplyPersistenceError("The procurement case no longer points to this released order.", "conflict");
  }
  if (!args.allowCompletedAfterClaim && record(caseResult.sourcingReturn).state === "REQUIRED") {
    throw new SupplyPersistenceError("This order returned to sourcing and cannot receive another supplier follow-up.", "conflict");
  }
  const exceptions = Array.isArray(actionResult.supplierOrderExceptions)
    ? actionResult.supplierOrderExceptions.map(record)
    : [];
  if (!args.allowCompletedAfterClaim && exceptions.some((entry) => ["OPEN_REVIEW", "REVISION_REQUIRED", "REVISION_DRAFTED", "REVISION_AUTHORIZED"].includes(String(entry.status)))) {
    throw new SupplyPersistenceError("Resolve the supplier order exception before sending an acknowledgment follow-up.", "conflict");
  }
  const acknowledgmentDueOn = requiredText(release.acknowledgmentDueOn, "Stored acknowledgment due date", 10);
  if (!args.allowCompletedAfterClaim && acknowledgmentDueOn > todayUtc()) {
    throw new SupplyPersistenceError(`Supplier acknowledgment is not due until ${acknowledgmentDueOn}.`, "conflict");
  }
  let remainingQuantity: Prisma.Decimal;
  try {
    remainingQuantity = new Prisma.Decimal(requiredText(actionResult.remainingQuantity, "Remaining order quantity", 80));
  } catch {
    throw new SupplyPersistenceError("The remaining purchase order quantity is invalid.", "conflict");
  }
  if (!args.allowCompletedAfterClaim && !remainingQuantity.isPositive()) {
    throw new SupplyPersistenceError("The purchase order is already fully acknowledged.", "conflict");
  }
  const followUps = Array.isArray(actionResult.followUps) ? actionResult.followUps.map(record) : [];
  const input = record(action.input);
  return { action, actionResult, release, followUps, input, procurementCase, caseResult, remainingQuantity };
}

export async function listPurchaseOrderFollowUpTasks(args: {
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
      taskType: { in: [PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE, PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE] },
      status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING", "SUCCEEDED"] },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: communicationTaskSelect,
  });
}

export async function cancelSafePurchaseOrderFollowUps(args: {
  tx: Prisma.TransactionClient;
  officeId: string;
  workspaceId: string;
  purchaseDraftId: string;
  reason: string;
}) {
  const actions = await args.tx.supplyExecutionTask.findMany({
    where: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      parentTaskId: args.purchaseDraftId,
      taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE,
      status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] },
    },
    select: { id: true, result: true },
  });
  if (actions.some((action) => UNRESOLVED_DELIVERY_STATES.includes(String(record(action.result).state)))) {
    throw new SupplyPersistenceError("Supplier follow-up delivery is unresolved. Reconcile it before recording the supplier response.", "conflict");
  }
  const now = new Date();
  const actionIds = actions.map((action) => action.id);
  if (actionIds.length) {
    await args.tx.supplyApproval.updateMany({
      where: { officeId: args.officeId, workspaceId: args.workspaceId, executionTaskId: { in: actionIds }, status: "PENDING" },
      data: { status: "CANCELLED", decidedAt: now, decisionNote: args.reason },
    });
    await args.tx.supplyExecutionTask.updateMany({
      where: { id: { in: actionIds }, officeId: args.officeId, workspaceId: args.workspaceId, status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] } },
      data: { status: "CANCELLED", cancelledAt: now },
    });
  }
  await args.tx.supplyExecutionTask.updateMany({
    where: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      parentTaskId: args.purchaseDraftId,
      taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE,
      status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] },
    },
    data: { status: "CANCELLED", cancelledAt: now },
  });
}

export async function savePurchaseOrderFollowUpDraft(args: {
  context: SupplyAccessContext;
  purchaseActionId: string;
  input: unknown;
}) {
  const draftInput = normalizedDraft(args.input);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingWorkspaceForTask(accessContext, args.purchaseActionId, "edit", [PURCHASE_ACTION_TASK_TYPE]);
  const sender = await prisma.emailAccount.findFirst({
    where: {
      id: draftInput.senderAccountId,
      officeId: accessContext.officeId,
      provider: "GMAIL",
      isActive: true,
      OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
    },
    select: { id: true, email: true },
  });
  if (!sender) throw new SupplyPersistenceError("The selected Gmail sender is missing, inactive, or disconnected.", "invalid_input");
  const lookup = await prisma.supplyExecutionTask.findFirst({
    where: { id: args.purchaseActionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ACTION_TASK_TYPE },
    select: { parentTaskId: true, parentTask: { select: { parentTaskId: true } } },
  });
  const purchaseDraftId = lookup?.parentTaskId;
  const procurementCaseId = lookup?.parentTask?.parentTaskId;
  if (!purchaseDraftId || !procurementCaseId) throw new SupplyPersistenceError("Released purchase action was not found.", "not_found");

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${purchaseDraftId}, ${args.purchaseActionId}) AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${purchaseDraftId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const scope = await releasedOrderScope(tx, {
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      procurementCaseId,
      purchaseActionId: args.purchaseActionId,
      expectedScopeHash: draftInput.expectedActionScopeHash,
      expectedReleaseHash: draftInput.expectedReleaseHash,
    });
    const followUpNumber = scope.followUps.length + 1;
    let existing = await tx.supplyExecutionTask.findFirst({
      where: {
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        parentTaskId: purchaseDraftId,
        taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE,
        status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: communicationTaskSelect,
    });
    if (existing?.status === "RUNNING") throw new SupplyPersistenceError("Supplier follow-up delivery is unresolved. Reconcile it before editing the message.", "conflict");
    const current = record(existing?.result);
    const revision = typeof current.revision === "number" ? current.revision : 0;
    const lastFollowUp = scope.followUps.at(-1);
    const message = {
      senderAccountId: sender.id,
      senderEmail: sender.email,
      recipient: draftInput.recipient,
      subject: draftInput.subject,
      body: draftInput.body,
      providerThreadId: typeof lastFollowUp?.providerThreadId === "string"
        ? lastFollowUp.providerThreadId
        : typeof scope.release.providerThreadId === "string"
          ? scope.release.providerThreadId
          : null,
      inReplyToRfcMessageId: typeof lastFollowUp?.rfcMessageId === "string"
        ? lastFollowUp.rfcMessageId
        : typeof scope.release.rfcMessageId === "string"
          ? scope.release.rfcMessageId
          : null,
    };
    const followUp = {
      releaseHash: draftInput.expectedReleaseHash,
      followUpNumber,
      purchaseOrderReference: requiredText(scope.release.purchaseOrderReference, "Stored purchase order reference", 300),
      acknowledgmentDueOn: requiredText(scope.release.acknowledgmentDueOn, "Stored acknowledgment due date", 10),
      remainingQuantity: scope.remainingQuantity.toString(),
      unitOfMeasure: requiredText(scope.actionResult.unitOfMeasure, "Stored order unit", 20),
      note: draftInput.note,
    };
    const messageHash = digest({ message, followUp });
    if (existing && current.messageHash === messageHash && record(existing.input).releaseHash === scope.release.releaseHash) return existing;
    if (draftInput.expectedRevision !== revision) throw new SupplyPersistenceError("The supplier follow-up draft changed in another session. Reload before saving.", "conflict");
    const activeActions = await tx.supplyExecutionTask.findMany({
      where: {
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        parentTaskId: purchaseDraftId,
        taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE,
        status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] },
      },
      select: { id: true, status: true, result: true },
    });
    if (activeActions.some((action) => action.status === "RUNNING" || UNRESOLVED_DELIVERY_STATES.includes(String(record(action.result).state)))) {
      throw new SupplyPersistenceError("Supplier follow-up delivery is unresolved. Reconcile it before editing the message.", "conflict");
    }
    const now = new Date();
    const actionIds = activeActions.map((action) => action.id);
    if (actionIds.length) {
      await tx.supplyApproval.updateMany({ where: { officeId: accessContext.officeId, workspaceId: workspace.id, executionTaskId: { in: actionIds }, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: now, decisionNote: "Supplier follow-up draft changed." } });
      await tx.supplyExecutionTask.updateMany({ where: { id: { in: actionIds }, officeId: accessContext.officeId, workspaceId: workspace.id, status: { in: ["PLANNED", "BLOCKED", "READY"] } }, data: { status: "CANCELLED", cancelledAt: now } });
    }
    if (existing && existing.status !== "PLANNED") {
      await tx.supplyExecutionTask.update({ where: { id: existing.id }, data: { status: "CANCELLED", cancelledAt: now } });
      existing = null;
    }
    const taskInput = {
      procurementCaseId,
      purchaseDraftId,
      purchaseActionId: scope.action.id,
      purchaseActionScopeHash: scope.action.inputHash,
      releaseHash: scope.release.releaseHash,
      followUpNumber,
      supplier: scope.input.supplier,
    };
    const result = { revision: revision + 1, message, followUp, messageHash, approval: null, updatedAt: now.toISOString() };
    const draft = existing
      ? await tx.supplyExecutionTask.update({ where: { id: existing.id }, data: { input: inputJson(taskInput), inputHash: digest(taskInput), result: inputJson(result), resultHash: digest(result) }, select: communicationTaskSelect })
      : await tx.supplyExecutionTask.create({
          data: {
            officeId: accessContext.officeId,
            workspaceId: workspace.id,
            createdByUserId: accessContext.userId,
            parentTaskId: purchaseDraftId,
            taskKey: `purchase-order-followup-email-draft:${purchaseDraftId}:${scope.release.releaseHash}:${followUpNumber}:${result.revision}`,
            taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE,
            capabilityKey: FOLLOWUP_CAPABILITY,
            requiresApproval: false,
            input: inputJson(taskInput),
            inputHash: digest(taskInput),
            result: inputJson(result),
            resultHash: digest(result),
          },
          select: communicationTaskSelect,
        });
    await appendEvent({
      tx,
      taskId: draft.id,
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      actorUserId: accessContext.userId,
      eventType: existing ? "PURCHASE_ORDER_FOLLOWUP_DRAFT_UPDATED" : "PURCHASE_ORDER_FOLLOWUP_DRAFT_CREATED",
      status: "PLANNED",
      message: existing ? "Supplier follow-up draft was updated." : "Supplier follow-up draft was created.",
      payload: inputJson({ purchaseActionId: scope.action.id, releaseHash: scope.release.releaseHash, followUpNumber, revision: result.revision, messageHash }),
    });
    return draft;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "The supplier follow-up draft changed concurrently. Reload and retry.");
}

export async function requestPurchaseOrderFollowUpApproval(args: {
  context: SupplyAccessContext;
  draftId: string;
  input: unknown;
}) {
  const body = record(args.input);
  const expectedResultHash = requiredText(body.expectedResultHash, "Supplier follow-up draft result hash", 128);
  const reason = requiredText(body.reason, "Approval reason", 2_000);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingWorkspaceForTask(accessContext, args.draftId, "edit", [PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE]);
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const lookup = await tx.supplyExecutionTask.findFirst({
      where: { id: args.draftId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE },
      select: { parentTaskId: true, input: true },
    });
    if (!lookup?.parentTaskId) throw new SupplyPersistenceError("Supplier follow-up draft was not found.", "not_found");
    const draftInput = record(lookup.input);
    const procurementCaseId = requiredText(draftInput.procurementCaseId, "Procurement case ID", 220);
    const purchaseActionId = requiredText(draftInput.purchaseActionId, "Purchase action ID", 220);
    const expectedScopeHash = requiredText(draftInput.purchaseActionScopeHash, "Authorized order scope hash", 128);
    const expectedReleaseHash = requiredText(draftInput.releaseHash, "Purchase order release hash", 128);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${lookup.parentTaskId}, ${purchaseActionId}, ${args.draftId}) AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${lookup.parentTaskId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const scope = await releasedOrderScope(tx, {
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      procurementCaseId,
      purchaseActionId,
      expectedScopeHash,
      expectedReleaseHash,
    });
    const draft = await tx.supplyExecutionTask.findFirst({
      where: {
        id: args.draftId,
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        parentTaskId: lookup.parentTaskId,
        taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE,
        status: { in: ["PLANNED", "BLOCKED", "READY"] },
      },
      select: communicationTaskSelect,
    });
    if (!draft || draft.resultHash !== expectedResultHash) throw new SupplyPersistenceError("The supplier follow-up draft changed. Reload before requesting approval.", "conflict");
    const draftResult = record(draft.result);
    const followUp = record(draftResult.followUp);
    const followUpNumber = nonNegativeInteger(followUp.followUpNumber, "Supplier follow-up number");
    if (followUpNumber !== scope.followUps.length + 1 || followUp.releaseHash !== scope.release.releaseHash) {
      throw new SupplyPersistenceError("The supplier follow-up no longer matches the active order release.", "conflict");
    }
    const immutableInput = {
      action: "SEND_PURCHASE_ORDER_FOLLOWUP",
      procurementCaseId,
      purchaseDraftId: lookup.parentTaskId,
      purchaseActionId,
      purchaseActionScopeHash: scope.action.inputHash,
      releaseHash: scope.release.releaseHash,
      release: scope.release,
      supplier: scope.input.supplier,
      order: scope.input.order,
      remainingQuantity: scope.remainingQuantity.toString(),
      followUpNumber,
      draftId: draft.id,
      draftRevision: draftResult.revision,
      draftMessageHash: draftResult.messageHash,
      requestedDraftResultHash: expectedResultHash,
      message: draftResult.message,
      followUp,
    };
    const scopeHash = digest(immutableInput);
    const terminal = await tx.supplyApproval.findFirst({
      where: {
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        scopeHash,
        status: { in: ["APPROVED", "REJECTED"] },
        executionTask: { taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE },
      },
      select: { status: true, executionTask: { select: { status: true } } },
    });
    if (terminal && (terminal.status === "REJECTED" || terminal.executionTask?.status !== "CANCELLED")) {
      throw new SupplyPersistenceError(terminal.status === "APPROVED" ? "This exact supplier follow-up was already approved." : "This exact supplier follow-up was rejected. Edit the draft before requesting another approval.", "conflict");
    }
    const pending = await tx.supplyApproval.findFirst({
      where: { officeId: accessContext.officeId, workspaceId: workspace.id, scopeHash, status: "PENDING", executionTask: { taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE } },
      include: { executionTask: { select: communicationTaskSelect } },
    });
    if (pending?.executionTask) return { draft, action: pending.executionTask, approval: pending };
    const attempts = await tx.supplyApproval.count({
      where: { officeId: accessContext.officeId, workspaceId: workspace.id, scopeHash, executionTask: { taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE } },
    });
    const attempt = attempts + 1;
    const action = await tx.supplyExecutionTask.create({
      data: {
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        createdByUserId: accessContext.userId,
        parentTaskId: lookup.parentTaskId,
        taskKey: `purchase-order-followup-email-action:${lookup.parentTaskId}:${scopeHash}:${attempt}`,
        taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE,
        capabilityKey: FOLLOWUP_CAPABILITY,
        externalSystem: "GMAIL",
        requiresApproval: true,
        input: inputJson(immutableInput),
        inputHash: scopeHash,
        idempotencyKey: `purchase-order-followup-email-action:${lookup.parentTaskId}:${scopeHash}:${attempt}`,
      },
      select: communicationTaskSelect,
    });
    const approval = await tx.supplyApproval.create({
      data: {
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        executionTaskId: action.id,
        requestedByUserId: accessContext.userId,
        requiredRole: REQUIRED_ROLE,
        scopeHash,
        requestReason: reason,
        requestContext: inputJson({ procurementCaseId, purchaseActionId, releaseHash: scope.release.releaseHash, followUpNumber, draftId: draft.id }),
        idempotencyKey: `purchase-order-followup-email:${lookup.parentTaskId}:${scopeHash}:${attempt}`,
      },
    });
    const now = new Date();
    const nextDraftResult = {
      ...draftResult,
      approval: { id: approval.id, actionId: action.id, status: "PENDING", scopeHash, requestedAt: approval.requestedAt.toISOString() },
      updatedAt: now.toISOString(),
    };
    const updatedDraft = await tx.supplyExecutionTask.update({
      where: { id: draft.id },
      data: { status: "BLOCKED", result: inputJson(nextDraftResult), resultHash: digest(nextDraftResult) },
      select: communicationTaskSelect,
    });
    await appendEvent({
      tx,
      taskId: action.id,
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      actorUserId: accessContext.userId,
      eventType: "PURCHASE_ORDER_FOLLOWUP_APPROVAL_REQUESTED",
      status: "BLOCKED",
      message: "The exact supplier follow-up was submitted for approval.",
      payload: inputJson({ purchaseActionId, releaseHash: scope.release.releaseHash, followUpNumber, draftId: draft.id, scopeHash }),
    });
    return { draft: updatedDraft, action, approval };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier follow-up approval changed concurrently. Reload and retry.");
}

export async function decidePurchaseOrderFollowUpApproval(args: {
  context: SupplyAccessContext;
  approvalId: string;
  input: unknown;
}) {
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) throw new SupplyPersistenceError("Only an admin or manager can decide supplier follow-up approvals.", "forbidden");
  const body = record(args.input);
  const decision = body.decision;
  if (decision !== "APPROVE" && decision !== "REJECT") throw new SupplyPersistenceError("Decision must be APPROVE or REJECT.", "invalid_input");
  const note = optionalText(body.note, "Approval note", 2_000);
  const found = await prisma.supplyApproval.findFirst({ where: { id: args.approvalId, officeId: accessContext.officeId }, include: { executionTask: true } });
  if (!found?.executionTask || found.executionTask.taskType !== PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE || !found.executionTask.parentTaskId) {
    throw new SupplyPersistenceError("Supplier follow-up approval was not found.", "not_found");
  }
  const workspace = await requireSupplyWorkspace(accessContext, found.workspaceId, "edit");
  const actionInput = record(found.executionTask.input);
  const draftId = requiredText(actionInput.draftId, "Supplier follow-up draft ID", 220);
  const purchaseActionId = requiredText(actionInput.purchaseActionId, "Purchase action ID", 220);
  const procurementCaseId = requiredText(actionInput.procurementCaseId, "Procurement case ID", 220);
  const targetStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${found.executionTask!.parentTaskId}, ${purchaseActionId}, ${draftId}, ${found.executionTask!.id}) AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyApproval" WHERE "id" = ${args.approvalId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    const approval = await tx.supplyApproval.findFirst({ where: { id: args.approvalId, officeId: accessContext.officeId, workspaceId: workspace.id }, include: { executionTask: true } });
    const draft = await tx.supplyExecutionTask.findFirst({ where: { id: draftId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE }, select: communicationTaskSelect });
    const scope = await releasedOrderScope(tx, {
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      procurementCaseId,
      purchaseActionId,
      expectedScopeHash: requiredText(actionInput.purchaseActionScopeHash, "Authorized order scope hash", 128),
      expectedReleaseHash: requiredText(actionInput.releaseHash, "Purchase order release hash", 128),
    });
    if (!approval?.executionTask || !draft || approval.executionTask.inputHash !== approval.scopeHash || approval.scopeHash !== found.scopeHash) {
      throw new SupplyPersistenceError("Supplier follow-up approval scope is invalid.", "conflict");
    }
    const draftResult = record(draft.result);
    if (draftResult.messageHash !== actionInput.draftMessageHash
      || draftResult.revision !== actionInput.draftRevision
      || scope.action.inputHash !== actionInput.purchaseActionScopeHash
      || scope.release.releaseHash !== actionInput.releaseHash
      || nonNegativeInteger(actionInput.followUpNumber, "Supplier follow-up number") !== scope.followUps.length + 1) {
      throw new SupplyPersistenceError("The released order or follow-up message changed after approval was requested.", "conflict");
    }
    if (approval.status !== "PENDING") {
      if (approval.status === targetStatus && approval.decidedByUserId === accessContext.userId) return { draft, action: approval.executionTask, approval };
      throw new SupplyPersistenceError("This supplier follow-up approval has already been decided.", "conflict");
    }
    if (approval.requestedByUserId === accessContext.userId) {
      const alternatives = await tx.user.count({
        where: {
          officeId: accessContext.officeId,
          id: { not: accessContext.userId },
          isActive: true,
          role: { in: ["ADMIN", "MANAGER"] },
          OR: [{ canViewWholeOffice: true }, { supplyWorkspaceMembers: { some: { workspaceId: workspace.id } } }],
        },
      });
      if (alternatives > 0) throw new SupplyPersistenceError("A different eligible approver is available, so self-approval is blocked.", "forbidden");
    }
    const decidedAt = new Date();
    const decided = await tx.supplyApproval.update({ where: { id: approval.id }, data: { status: targetStatus, decidedByUserId: accessContext.userId, decidedAt, decisionNote: note } });
    const actionResult = { state: decision === "APPROVE" ? "APPROVED" : "REJECTED", approvalId: approval.id, scopeHash: approval.scopeHash, decidedByUserId: accessContext.userId, decidedAt: decidedAt.toISOString(), note, attempt: 0 };
    const action = await tx.supplyExecutionTask.update({ where: { id: approval.executionTask.id }, data: { status: decision === "APPROVE" ? "READY" : "BLOCKED", result: inputJson(actionResult), resultHash: digest(actionResult) }, select: communicationTaskSelect });
    const nextDraftResult = { ...draftResult, approval: { ...record(draftResult.approval), status: targetStatus, decidedByUserId: accessContext.userId, decidedAt: decidedAt.toISOString(), decisionNote: note }, updatedAt: decidedAt.toISOString() };
    const updatedDraft = await tx.supplyExecutionTask.update({ where: { id: draft.id }, data: { status: decision === "APPROVE" ? "READY" : "BLOCKED", result: inputJson(nextDraftResult), resultHash: digest(nextDraftResult) }, select: communicationTaskSelect });
    await appendEvent({
      tx,
      taskId: action.id,
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      actorUserId: accessContext.userId,
      eventType: decision === "APPROVE" ? "PURCHASE_ORDER_FOLLOWUP_APPROVED" : "PURCHASE_ORDER_FOLLOWUP_REJECTED",
      status: action.status,
      message: decision === "APPROVE" ? "The exact supplier follow-up was approved for delivery." : "The supplier follow-up was rejected.",
      payload: inputJson(actionResult),
    });
    return { draft: updatedDraft, action, approval: decided };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier follow-up approval changed concurrently. Reload and retry.");
}

async function finalizePurchaseOrderFollowUp(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  actionId: string;
  receipt: SupplierEmailSent;
  rfcMessageId: string;
}) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const lookup = await tx.supplyExecutionTask.findFirst({
      where: { id: args.actionId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE },
      select: { parentTaskId: true, input: true },
    });
    if (!lookup?.parentTaskId) throw new SupplyPersistenceError("Supplier follow-up action was not found.", "not_found");
    const actionInput = record(lookup.input);
    const purchaseDraftId = lookup.parentTaskId;
    const purchaseActionId = requiredText(actionInput.purchaseActionId, "Purchase action ID", 220);
    const procurementCaseId = requiredText(actionInput.procurementCaseId, "Procurement case ID", 220);
    const draftId = requiredText(actionInput.draftId, "Supplier follow-up draft ID", 220);
    const expectedScopeHash = requiredText(actionInput.purchaseActionScopeHash, "Authorized order scope hash", 128);
    const expectedReleaseHash = requiredText(actionInput.releaseHash, "Purchase order release hash", 128);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${purchaseDraftId}, ${purchaseActionId}, ${draftId}, ${args.actionId}) AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} ORDER BY "id" FOR UPDATE`);
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE }, select: communicationTaskSelect });
    const draft = await tx.supplyExecutionTask.findFirst({ where: { id: draftId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE }, select: communicationTaskSelect });
    if (!action || !draft) throw new SupplyPersistenceError("Supplier follow-up delivery scope is incomplete.", "conflict");
    if (action.status === "SUCCEEDED" && record(action.result).providerMessageId === args.receipt.providerMessageId) return action;
    const currentDelivery = record(action.result);
    if (currentDelivery.rfcMessageId !== args.rfcMessageId || currentDelivery.state !== "SENDING") {
      throw new SupplyPersistenceError("Supplier follow-up delivery changed concurrently.", "conflict");
    }
    const scope = await releasedOrderScope(tx, {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      procurementCaseId,
      purchaseActionId,
      expectedScopeHash,
      expectedReleaseHash,
      allowCompletedAfterClaim: true,
    });
    const message = record(actionInput.message);
    const followUpNumber = nonNegativeInteger(actionInput.followUpNumber, "Supplier follow-up number");
    if (scope.followUps.some((entry) => entry.followUpNumber === followUpNumber)) {
      throw new SupplyPersistenceError("This supplier follow-up number is already recorded on the released order.", "conflict");
    }
    if (followUpNumber !== scope.followUps.length + 1) throw new SupplyPersistenceError("Supplier follow-up history changed before delivery completed.", "conflict");
    const now = new Date();
    let localThread = await tx.emailThread.findFirst({
      where: { officeId: args.context.officeId, externalThreadId: args.receipt.providerThreadId },
      select: { id: true },
    });
    if (!localThread) {
      localThread = await tx.emailThread.create({
        data: {
          officeId: args.context.officeId,
          subject: requiredText(message.subject, "Stored email subject", 180),
          participants: JSON.stringify([message.senderEmail, message.recipient]),
          externalThreadId: args.receipt.providerThreadId,
          lastMessageAt: now,
          messageCount: 0,
        },
        select: { id: true },
      });
    }
    const senderAccountId = requiredText(message.senderAccountId, "Stored sender account", 220);
    const existingMessage = await tx.emailMessage.findFirst({
      where: {
        accountId: senderAccountId,
        thread: { officeId: args.context.officeId },
        OR: [{ gmailMessageId: args.receipt.providerMessageId }, { externalId: args.rfcMessageId }],
      },
      select: { id: true },
    });
    if (!existingMessage) {
      await tx.emailMessage.create({
        data: {
          threadId: localThread.id,
          accountId: senderAccountId,
          externalId: args.rfcMessageId,
          gmailMessageId: args.receipt.providerMessageId,
          direction: "OUTBOUND",
          fromEmail: requiredText(message.senderEmail, "Stored sender email", 320),
          toEmails: JSON.stringify([requiredText(message.recipient, "Stored recipient", 320)]),
          subject: requiredText(message.subject, "Stored email subject", 180),
          bodyText: messageBody(message.body),
          sentAt: now,
        },
      });
      await tx.emailThread.update({ where: { id: localThread.id }, data: { lastMessageAt: now, messageCount: { increment: 1 } } });
    }
    const normalizedFollowUp = {
      purchaseActionScopeHash: expectedScopeHash,
      releaseHash: expectedReleaseHash,
      followUpNumber,
      remainingQuantity: requiredText(actionInput.remainingQuantity, "Approved remaining quantity", 80),
      messageHash: requiredText(actionInput.draftMessageHash, "Approved follow-up message hash", 128),
      provider: args.receipt.provider,
      providerMessageId: args.receipt.providerMessageId,
      providerThreadId: args.receipt.providerThreadId,
      rfcMessageId: args.rfcMessageId,
      sourceUrl: args.receipt.sourceUrl,
      sentAt: now.toISOString(),
    };
    const followUpHash = digest(normalizedFollowUp);
    const evidenceKey = `purchase_order_followup:${args.actionId}:${followUpHash}`;
    const existingEvidence = await tx.supplyEvidence.findUnique({ where: { workspaceId_evidenceKey: { workspaceId: args.workspaceId, evidenceKey } }, select: { id: true, officeId: true, executionTaskId: true, sourceRecordId: true } });
    if (existingEvidence && (existingEvidence.officeId !== args.context.officeId || existingEvidence.executionTaskId !== args.actionId || existingEvidence.sourceRecordId !== args.receipt.providerMessageId)) {
      throw new SupplyPersistenceError("Supplier follow-up evidence identity conflicted with an existing record.", "conflict");
    }
    const evidence = existingEvidence ?? await tx.supplyEvidence.create({
      data: {
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        executionTaskId: args.actionId,
        createdByUserId: args.context.userId,
        evidenceKey,
        kind: "PURCHASE_ORDER_FOLLOWUP",
        sourceType: "CONNECTED_PROVIDER",
        sourceUri: args.receipt.sourceUrl,
        sourceRecordId: args.receipt.providerMessageId,
        sourceVersion: followUpHash,
        title: `Purchase order follow-up ${followUpNumber}`,
        payload: inputJson(normalizedFollowUp),
        contentHash: followUpHash,
        observedAt: now,
      },
      select: { id: true },
    });
    const recordedFollowUp = {
      ...normalizedFollowUp,
      evidenceId: evidence.id,
      evidenceClass: "CONNECTED_PROVIDER",
      followUpHash,
      localThreadId: localThread.id,
      recordedByUserId: args.context.userId,
      recordedAt: now.toISOString(),
    };
    const nextFollowUps = [...scope.followUps, recordedFollowUp];
    const nextActionResult = { ...scope.actionResult, followUps: nextFollowUps, lastFollowUpAt: now.toISOString(), updatedAt: now.toISOString() };
    await tx.supplyExecutionTask.update({ where: { id: purchaseActionId }, data: { result: inputJson(nextActionResult), resultHash: digest(nextActionResult) } });
    const projectedRelease = record(scope.caseResult.purchaseRelease);
    const nextCaseResult = {
      ...scope.caseResult,
      purchaseRelease: { ...projectedRelease, followUps: nextFollowUps, lastFollowUpAt: now.toISOString(), updatedAt: now.toISOString() },
      updatedAt: now.toISOString(),
    };
    await tx.supplyExecutionTask.update({ where: { id: procurementCaseId }, data: { result: inputJson(nextCaseResult), resultHash: digest(nextCaseResult) } });
    const deliveryResult = {
      state: "SENT",
      attempt: currentDelivery.attempt,
      rfcMessageId: args.rfcMessageId,
      provider: args.receipt.provider,
      providerMessageId: args.receipt.providerMessageId,
      providerThreadId: args.receipt.providerThreadId,
      sourceUrl: args.receipt.sourceUrl,
      localThreadId: localThread.id,
      evidenceId: evidence.id,
      releaseHash: expectedReleaseHash,
      followUpNumber,
      followUpHash,
      sentAt: now.toISOString(),
    };
    const sentAction = await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { status: "SUCCEEDED", result: inputJson(deliveryResult), resultHash: digest(deliveryResult), completedAt: now, error: Prisma.DbNull }, select: communicationTaskSelect });
    await tx.supplyExecutionTask.update({ where: { id: draft.id }, data: { status: "SUCCEEDED", completedAt: now } });
    const payload = inputJson({ procurementCaseId, purchaseActionId, releaseHash: expectedReleaseHash, followUp: recordedFollowUp, followUpActionId: action.id });
    await appendEvent({ tx, taskId: action.id, officeId: args.context.officeId, workspaceId: args.workspaceId, actorUserId: args.context.userId, eventType: "PURCHASE_ORDER_FOLLOWUP_SENT", status: "SUCCEEDED", message: "Gmail returned a supplier follow-up delivery receipt.", payload });
    await appendEvent({ tx, taskId: purchaseActionId, officeId: args.context.officeId, workspaceId: args.workspaceId, actorUserId: args.context.userId, eventType: "PURCHASE_ORDER_FOLLOWUP_SENT", status: scope.action.status, message: "A supplier acknowledgment follow-up was sent through connected Gmail.", payload });
    await appendEvent({ tx, taskId: procurementCaseId, officeId: args.context.officeId, workspaceId: args.workspaceId, actorUserId: args.context.userId, eventType: "PURCHASE_ORDER_FOLLOWUP_SENT", status: "PLANNED", message: "The released order remains open after supplier follow-up.", payload });
    return sentAction;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier follow-up delivery changed concurrently. Reconcile before retrying.");
}

export async function sendPurchaseOrderFollowUpAction(args: { context: SupplyAccessContext; actionId: string; provider?: SupplierEmailProvider }) {
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingWorkspaceForTask(accessContext, args.actionId, "edit", [PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE]);
  const claimed = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const lookup = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE }, select: { parentTaskId: true, input: true } });
    if (!lookup?.parentTaskId) throw new SupplyPersistenceError("Supplier follow-up action was not found.", "not_found");
    const actionInput = record(lookup.input);
    const purchaseActionId = requiredText(actionInput.purchaseActionId, "Purchase action ID", 220);
    const draftId = requiredText(actionInput.draftId, "Supplier follow-up draft ID", 220);
    const procurementCaseId = requiredText(actionInput.procurementCaseId, "Procurement case ID", 220);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${lookup.parentTaskId}, ${purchaseActionId}, ${draftId}, ${args.actionId}) AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE }, select: communicationTaskSelect });
    if (!action) throw new SupplyPersistenceError("Supplier follow-up action was not found.", "not_found");
    if (action.status === "SUCCEEDED") return { alreadySent: action, input: null, rfcMessageId: null };
    const scope = await releasedOrderScope(tx, {
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      procurementCaseId,
      purchaseActionId,
      expectedScopeHash: requiredText(actionInput.purchaseActionScopeHash, "Authorized order scope hash", 128),
      expectedReleaseHash: requiredText(actionInput.releaseHash, "Purchase order release hash", 128),
    });
    if (nonNegativeInteger(actionInput.followUpNumber, "Supplier follow-up number") !== scope.followUps.length + 1) throw new SupplyPersistenceError("Supplier follow-up history changed. Reload before sending.", "conflict");
    const prior = record(action.result);
    const retryableRunning = action.status === "RUNNING" && ["RETRY_READY", "SEND_FAILED"].includes(String(prior.state));
    if ((action.status === "RUNNING" && !retryableRunning) || action.status === "BLOCKED" || prior.state === "SENDING") throw new SupplyPersistenceError("Supplier follow-up delivery is unresolved or blocked. Reconcile it before another send.", "conflict");
    const approval = action.approvals[0];
    if (!["READY", "RUNNING"].includes(action.status) || !approval || approval.status !== "APPROVED" || approval.scopeHash !== action.inputHash) throw new SupplyPersistenceError("The exact supplier follow-up is not approved for delivery.", "conflict");
    const draft = await tx.supplyExecutionTask.findFirst({ where: { id: draftId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT_TASK_TYPE }, select: { status: true, result: true } });
    if (!draft || record(draft.result).messageHash !== actionInput.draftMessageHash) throw new SupplyPersistenceError("The approved supplier follow-up draft changed.", "conflict");
    const attempt = typeof prior.attempt === "number" ? prior.attempt + 1 : 1;
    const rfcMessageId = `<purchase-followup-${action.id}-${attempt}@derya.ai>`;
    const sending = { state: "SENDING", attempt, rfcMessageId, startedAt: new Date().toISOString() };
    await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { status: "RUNNING", startedAt: action.status === "READY" ? new Date() : undefined, result: inputJson(sending), resultHash: digest(sending), error: Prisma.DbNull } });
    if (draft.status === "READY") {
      await tx.supplyExecutionTask.update({ where: { id: draftId }, data: { status: "RUNNING", startedAt: new Date() } });
    }
    await appendEvent({ tx, taskId: action.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: "PURCHASE_ORDER_FOLLOWUP_SEND_STARTED", status: "RUNNING", message: "Supplier follow-up delivery started.", payload: inputJson({ attempt, rfcMessageId }) });
    return { alreadySent: null, input: actionInput, rfcMessageId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier follow-up delivery changed concurrently. Reload before sending.");
  if (claimed.alreadySent) return claimed.alreadySent;
  const message = record(claimed.input?.message);
  const provider = args.provider ?? gmailSupplierEmailProvider;
  const receipt = await provider.send({
    officeId: accessContext.officeId,
    accountId: requiredText(message.senderAccountId, "Sender account", 220),
    senderEmail: singleEmail(message.senderEmail, "Approved sender email"),
    recipient: singleEmail(message.recipient, "Supplier recipient"),
    subject: requiredText(message.subject, "Email subject", 180),
    body: messageBody(message.body),
    rfcMessageId: claimed.rfcMessageId!,
    providerThreadId: typeof message.providerThreadId === "string" ? message.providerThreadId : null,
    inReplyToRfcMessageId: typeof message.inReplyToRfcMessageId === "string" ? message.inReplyToRfcMessageId : null,
  });
  if (receipt.state === "SENT") return finalizePurchaseOrderFollowUp({ context: accessContext, workspaceId: workspace.id, actionId: args.actionId, receipt, rfcMessageId: claimed.rfcMessageId! });
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE }, select: communicationTaskSelect });
    if (!action) throw new SupplyPersistenceError("Supplier follow-up action was not found.", "not_found");
    const current = record(action.result);
    if (action.status === "SUCCEEDED" && current.state === "SENT") return action;
    if (current.rfcMessageId !== claimed.rfcMessageId) throw new SupplyPersistenceError("Supplier follow-up delivery changed concurrently.", "conflict");
    if (current.state !== "SENDING") return action;
    const state = receipt.state === "UNKNOWN" ? "DELIVERY_UNKNOWN" : "SEND_FAILED";
    const result = { ...current, state, error: receipt.error, needsReauth: receipt.needsReauth ?? false, updatedAt: new Date().toISOString() };
    const updated = await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { status: receipt.state === "UNKNOWN" ? "RUNNING" : action.status, result: inputJson(result), resultHash: digest(result), error: inputJson({ message: receipt.error, state }) }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: action.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: receipt.state === "UNKNOWN" ? "PURCHASE_ORDER_FOLLOWUP_DELIVERY_UNKNOWN" : "PURCHASE_ORDER_FOLLOWUP_SEND_REJECTED", status: updated.status, message: receipt.state === "UNKNOWN" ? "Gmail delivery is unknown. A retry is blocked until reconciliation." : "Gmail rejected the supplier follow-up before returning a delivery receipt.", payload: inputJson(result) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier follow-up delivery changed concurrently. Reconcile before retrying.");
}

export async function reconcilePurchaseOrderFollowUpAction(args: { context: SupplyAccessContext; actionId: string; provider?: SupplierEmailProvider }) {
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingWorkspaceForTask(accessContext, args.actionId, "edit", [PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE]);
  const action = await prisma.supplyExecutionTask.findFirst({
    where: {
      id: args.actionId,
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE,
      status: { in: ["READY", "RUNNING", "BLOCKED"] },
    },
    select: communicationTaskSelect,
  });
  if (!action) throw new SupplyPersistenceError("An unresolved supplier follow-up action was not found.", "not_found");
  const result = record(action.result);
  if (!UNRESOLVED_DELIVERY_STATES.includes(String(result.state))) throw new SupplyPersistenceError("This supplier follow-up does not need reconciliation.", "conflict");
  const sendingStartedAt = typeof result.startedAt === "string" ? Date.parse(result.startedAt) : Number.NaN;
  if (result.state === "SENDING" && (!Number.isFinite(sendingStartedAt) || Date.now() - sendingStartedAt < SENDING_RECONCILIATION_DELAY_MS)) {
    throw new SupplyPersistenceError("Supplier follow-up delivery is still in progress. Wait before reconciling it.", "conflict");
  }
  const message = record(record(action.input).message);
  const rfcMessageId = requiredText(result.rfcMessageId, "Supplier follow-up message ID", 500);
  const provider = args.provider ?? gmailSupplierEmailProvider;
  const receipt = await provider.reconcile({ officeId: accessContext.officeId, accountId: requiredText(message.senderAccountId, "Sender account", 220), senderEmail: singleEmail(message.senderEmail, "Approved sender email"), rfcMessageId });
  if (receipt.state === "SENT") return finalizePurchaseOrderFollowUp({ context: accessContext, workspaceId: workspace.id, actionId: action.id, receipt, rfcMessageId });
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const current = await tx.supplyExecutionTask.findFirst({ where: { id: action.id, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE }, select: communicationTaskSelect });
    if (!current) throw new SupplyPersistenceError("Supplier follow-up delivery changed concurrently.", "conflict");
    const currentResult = record(current.result);
    if (current.status === "SUCCEEDED" && currentResult.state === "SENT") return current;
    if (currentResult.rfcMessageId !== rfcMessageId) throw new SupplyPersistenceError("Supplier follow-up delivery changed concurrently.", "conflict");
    if (!UNRESOLVED_DELIVERY_STATES.includes(String(currentResult.state))) return current;
    const nextResult = { ...currentResult, state: receipt.state === "NOT_FOUND" ? "NOT_FOUND_REVIEW_REQUIRED" : "DELIVERY_UNKNOWN", error: receipt.error ?? null, lastCheckedAt: new Date().toISOString() };
    const updated = await tx.supplyExecutionTask.update({ where: { id: current.id }, data: { status: "RUNNING", result: inputJson(nextResult), resultHash: digest(nextResult) }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: current.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: receipt.state === "NOT_FOUND" ? "PURCHASE_ORDER_FOLLOWUP_NOT_FOUND" : "PURCHASE_ORDER_FOLLOWUP_RECONCILIATION_UNKNOWN", status: updated.status, message: receipt.state === "NOT_FOUND" ? "Gmail did not find the stable supplier follow-up message ID. Human review is required before retry." : "Gmail reconciliation did not return a definitive supplier follow-up result.", payload: inputJson(nextResult) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier follow-up reconciliation changed concurrently. Reload and retry.");
}

export async function resetPurchaseOrderFollowUpForRetry(args: { context: SupplyAccessContext; actionId: string; input: unknown }) {
  const body = record(args.input);
  if (body.confirmedNotSent !== true) throw new SupplyPersistenceError("Confirm that the supplier follow-up was not sent before enabling a retry.", "invalid_input");
  const note = requiredText(body.note, "Recovery note", 2_000);
  if (note.length < 10) throw new SupplyPersistenceError("Recovery note must explain how non-delivery was verified.", "invalid_input");
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) throw new SupplyPersistenceError("Only an admin or manager can reset an uncertain supplier follow-up.", "forbidden");
  const workspace = await sourcingWorkspaceForTask(accessContext, args.actionId, "edit", [PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE]);
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE, status: "RUNNING" }, select: communicationTaskSelect });
    if (!action || record(action.result).state !== "NOT_FOUND_REVIEW_REQUIRED") throw new SupplyPersistenceError("A supplier follow-up awaiting non-delivery review was not found.", "conflict");
    const actionInput = record(action.input);
    const procurementCaseId = requiredText(actionInput.procurementCaseId, "Procurement case ID", 220);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await releasedOrderScope(tx, {
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      procurementCaseId,
      purchaseActionId: requiredText(actionInput.purchaseActionId, "Purchase action ID", 220),
      expectedScopeHash: requiredText(actionInput.purchaseActionScopeHash, "Authorized order scope hash", 128),
      expectedReleaseHash: requiredText(actionInput.releaseHash, "Purchase order release hash", 128),
    });
    const now = new Date();
    const recovery = { confirmedNotSent: true, note, confirmedByUserId: accessContext.userId, confirmedAt: now.toISOString() };
    const result = { ...record(action.result), state: "RETRY_READY", recovery };
    const updated = await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { result: inputJson(result), resultHash: digest(result), error: Prisma.DbNull }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: action.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: "PURCHASE_ORDER_FOLLOWUP_RETRY_ENABLED", status: "READY", message: "An operator confirmed non-delivery and enabled one new supplier follow-up attempt.", payload: inputJson(recovery) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier follow-up recovery changed concurrently. Reload and retry.");
}
