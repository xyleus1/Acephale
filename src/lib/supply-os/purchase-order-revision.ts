import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { SupplyPersistenceError } from "./persistence";
import { appendSupplierCommunicationEvent as appendEvent } from "./supplier-communication-shared";

const PURCHASE_DRAFT_TASK_TYPE = "PURCHASE_ORDER_DRAFT";
const PURCHASE_ACTION_TASK_TYPE = "PURCHASE_ORDER_ACTION";
const PURCHASE_ACTION_CAPABILITY = "authorize.purchase_order";
const PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE = "PURCHASE_ORDER_EMAIL_DRAFT";
const PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE = "PURCHASE_ORDER_EMAIL_ACTION";

export type ReplacementFreshnessGate = "SOURCE_EVIDENCE" | "COMMERCIAL_TERMS" | "QUALITY_PLAN";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== "string") throw new SupplyPersistenceError(`${label} is required.`, "conflict");
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > max) throw new SupplyPersistenceError(`${label} is invalid.`, "conflict");
  return normalized;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function inputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

export async function returnStaleReplacementToSourcing(args: {
  tx: Prisma.TransactionClient;
  officeId: string;
  workspaceId: string;
  procurementCaseId: string;
  actorUserId: string;
  revisionContext: unknown;
  replacementDraftId?: string | null;
  replacementActionId?: string | null;
  staleGate: ReplacementFreshnessGate;
}) {
  const revisionContext = record(args.revisionContext);
  const replacesPurchaseActionId = requiredText(revisionContext.replacesPurchaseActionId, "Released purchase action ID", 220);
  const supplierExceptionHash = requiredText(revisionContext.supplierExceptionHash, "Supplier exception hash", 128);
  const reasonCode = args.staleGate === "SOURCE_EVIDENCE"
    ? "SOURCE_EVIDENCE_EXPIRED"
    : args.staleGate === "COMMERCIAL_TERMS"
      ? "COMMERCIAL_TERMS_EXPIRED"
      : "QUALITY_PLAN_EXPIRED";
  const reason = args.staleGate === "SOURCE_EVIDENCE"
    ? "Supplier qualification expired before the replacement order could be released."
    : args.staleGate === "COMMERCIAL_TERMS"
      ? "The supplier's commercial terms expired before the replacement order could be released."
      : "The approved quality plan expired before the replacement order could be released.";
  const now = new Date();

  await args.tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.procurementCaseId} AND "officeId" = ${args.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
  await args.tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${replacesPurchaseActionId} AND "officeId" = ${args.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
  if (args.replacementDraftId) {
    await args.tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.replacementDraftId} AND "officeId" = ${args.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
  }
  if (args.replacementActionId) {
    await args.tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.replacementActionId} AND "officeId" = ${args.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
  }

  const [procurementCase, releasedAction] = await Promise.all([
    args.tx.supplyExecutionTask.findFirst({
      where: { id: args.procurementCaseId, officeId: args.officeId, workspaceId: args.workspaceId, taskType: "PROCUREMENT_CASE", status: "PLANNED" },
      select: { id: true, workspaceId: true, status: true, taskKey: true, input: true, result: true, createdAt: true, updatedAt: true },
    }),
    args.tx.supplyExecutionTask.findFirst({
      where: { id: replacesPurchaseActionId, officeId: args.officeId, workspaceId: args.workspaceId, taskType: PURCHASE_ACTION_TASK_TYPE, capabilityKey: PURCHASE_ACTION_CAPABILITY, status: "RUNNING" },
      select: { id: true, result: true },
    }),
  ]);
  if (!procurementCase || !releasedAction) {
    throw new SupplyPersistenceError("The released order awaiting replacement could not be found.", "conflict");
  }
  const caseResult = record(procurementCase.result);
  const existingReturn = record(caseResult.sourcingReturn);
  if (existingReturn.state === "REQUIRED"
    && existingReturn.supplierExceptionHash === supplierExceptionHash
    && existingReturn.reasonCode === reasonCode) {
    return procurementCase;
  }

  const releasedResult = record(releasedAction.result);
  const supplierOrderExceptions = Array.isArray(releasedResult.supplierOrderExceptions)
    ? releasedResult.supplierOrderExceptions.map((value) => record(value))
    : [];
  const target = supplierOrderExceptions.find((value) => value.exceptionHash === supplierExceptionHash);
  if (!target || !["REVISION_REQUIRED", "REVISION_DRAFTED", "REVISION_AUTHORIZED"].includes(String(target.status))) {
    throw new SupplyPersistenceError("The supplier exception no longer supports stale replacement recovery.", "conflict");
  }

  const communicationDrafts = args.replacementDraftId ? await args.tx.supplyExecutionTask.findMany({
    where: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      parentTaskId: args.replacementDraftId,
      taskType: PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE,
      status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] },
    },
    select: { id: true, status: true },
  }) : [];
  const communicationActions = args.replacementDraftId ? await args.tx.supplyExecutionTask.findMany({
    where: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      parentTaskId: args.replacementDraftId,
      taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE,
      status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] },
    },
    select: { id: true, status: true, result: true },
  }) : [];
  if (communicationActions.some((task) => task.status === "RUNNING" && ["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"].includes(String(record(task.result).state)))) {
    throw new SupplyPersistenceError("Purchase order email delivery is unresolved. Reconcile it before returning to sourcing.", "conflict");
  }

  const replacementActionIds = new Set<string>();
  if (args.replacementActionId) replacementActionIds.add(args.replacementActionId);
  if (args.replacementDraftId) {
    const actions = await args.tx.supplyExecutionTask.findMany({
      where: {
        officeId: args.officeId,
        workspaceId: args.workspaceId,
        parentTaskId: args.replacementDraftId,
        taskType: PURCHASE_ACTION_TASK_TYPE,
        status: { in: ["PLANNED", "BLOCKED", "READY"] },
      },
      select: { id: true },
    });
    for (const action of actions) replacementActionIds.add(action.id);
  }
  const cancelledTaskIds = [
    ...replacementActionIds,
    ...communicationDrafts.map((task) => task.id),
    ...communicationActions.map((task) => task.id),
  ];
  if (cancelledTaskIds.length) {
    await args.tx.supplyApproval.updateMany({
      where: { officeId: args.officeId, workspaceId: args.workspaceId, executionTaskId: { in: cancelledTaskIds }, status: "PENDING" },
      data: { status: "EXPIRED", decidedAt: now, decisionNote: reason },
    });
    await args.tx.supplyExecutionTask.updateMany({
      where: { id: { in: cancelledTaskIds }, officeId: args.officeId, workspaceId: args.workspaceId, status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] } },
      data: { status: "CANCELLED", cancelledAt: now },
    });
  }
  if (args.replacementDraftId) {
    await args.tx.supplyExecutionTask.updateMany({
      where: { id: args.replacementDraftId, officeId: args.officeId, workspaceId: args.workspaceId, status: { in: ["PLANNED", "BLOCKED", "READY"] } },
      data: { status: "CANCELLED", cancelledAt: now },
    });
  }

  const resolution = {
    disposition: "RETURN_TO_SOURCING",
    reasonCode,
    note: reason,
    decidedByUserId: args.actorUserId,
    decidedAt: now.toISOString(),
  };
  const updatedExceptions = supplierOrderExceptions.map((value) => {
    if (value.exceptionHash !== supplierExceptionHash) return value;
    const next: Record<string, unknown> = {
      ...value,
      status: "RETURNED_TO_SOURCING",
      resolution,
      staleRevision: {
        staleGate: args.staleGate,
        replacementDraftTaskId: args.replacementDraftId ?? null,
        replacementPurchaseActionId: args.replacementActionId ?? null,
        detectedAt: now.toISOString(),
      },
    };
    delete next.replacementDraft;
    delete next.replacementAuthorization;
    return next;
  });
  const nextReleasedResult = {
    ...releasedResult,
    supplierOrderExceptions: updatedExceptions,
    openSupplierExceptionCount: updatedExceptions.filter((value) => value.status === "OPEN_REVIEW").length,
    revisionRequiredCount: updatedExceptions.filter((value) => ["REVISION_REQUIRED", "REVISION_DRAFTED", "REVISION_AUTHORIZED"].includes(String(value.status))).length,
    updatedAt: now.toISOString(),
  };
  await args.tx.supplyExecutionTask.update({
    where: { id: releasedAction.id },
    data: { result: inputJson(nextReleasedResult), resultHash: digest(nextReleasedResult) },
  });

  const purchaseRelease = record(caseResult.purchaseRelease);
  const purchaseRevision = record(caseResult.purchaseRevision);
  const nextCaseResult: Record<string, unknown> = {
    ...caseResult,
    sourcingReturn: {
      state: "REQUIRED",
      purchaseActionId: releasedAction.id,
      supplierExceptionHash,
      reasonCode,
      reason,
      recordedByUserId: args.actorUserId,
      recordedAt: now.toISOString(),
    },
    purchaseRelease: {
      ...purchaseRelease,
      openSupplierExceptionCount: nextReleasedResult.openSupplierExceptionCount,
      revisionRequiredCount: nextReleasedResult.revisionRequiredCount,
      updatedAt: now.toISOString(),
    },
    ...(Object.keys(purchaseRevision).length ? {
      purchaseRevision: {
        ...purchaseRevision,
        state: "RETURNED_TO_SOURCING",
        staleGate: args.staleGate,
        updatedAt: now.toISOString(),
      },
    } : {}),
    updatedAt: now.toISOString(),
  };
  delete nextCaseResult.purchasePreparation;
  delete nextCaseResult.purchaseAuthorization;
  const updatedCase = await args.tx.supplyExecutionTask.update({
    where: { id: procurementCase.id },
    data: { result: inputJson(nextCaseResult), resultHash: digest(nextCaseResult) },
    select: { id: true, workspaceId: true, status: true, taskKey: true, input: true, result: true, createdAt: true, updatedAt: true },
  });
  const payload = inputJson({
    purchaseActionId: releasedAction.id,
    supplierExceptionHash,
    staleGate: args.staleGate,
    replacementDraftTaskId: args.replacementDraftId ?? null,
    replacementPurchaseActionId: args.replacementActionId ?? null,
  });
  await appendEvent({
    tx: args.tx,
    taskId: procurementCase.id,
    officeId: args.officeId,
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId,
    eventType: "REVISED_PURCHASE_RETURNED_TO_SOURCING",
    status: "PLANNED",
    message: reason,
    payload,
  });
  await appendEvent({
    tx: args.tx,
    taskId: releasedAction.id,
    officeId: args.officeId,
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId,
    eventType: "REVISED_PURCHASE_RETURNED_TO_SOURCING",
    status: "RUNNING",
    message: reason,
    payload,
  });
  return updatedCase;
}

export async function finalizeReplacementSupersession(args: {
  tx: Prisma.TransactionClient;
  officeId: string;
  workspaceId: string;
  procurementCaseId: string;
  replacementActionId: string;
  replacementActionInput: unknown;
  replacementScopeHash: string;
  replacementReleaseHash: string;
  releasedAt: Date;
}) {
  const revisionContext = record(record(args.replacementActionInput).revisionContext);
  if (!Object.keys(revisionContext).length) return null;
  const replacesPurchaseActionId = requiredText(revisionContext.replacesPurchaseActionId, "Superseded purchase action ID", 220);
  const replacesPurchaseDraftId = requiredText(revisionContext.replacesPurchaseDraftId, "Superseded purchase draft ID", 220);
  const supersededReleaseHash = requiredText(revisionContext.supersededReleaseHash, "Superseded release hash", 128);
  const supplierExceptionHash = requiredText(revisionContext.supplierExceptionHash, "Supplier exception hash", 128);
  await args.tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${replacesPurchaseDraftId} AND "officeId" = ${args.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
  await args.tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${replacesPurchaseActionId} AND "officeId" = ${args.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
  const [supersededDraft, supersededAction] = await Promise.all([
    args.tx.supplyExecutionTask.findFirst({
      where: { id: replacesPurchaseDraftId, officeId: args.officeId, workspaceId: args.workspaceId, parentTaskId: args.procurementCaseId, taskType: PURCHASE_DRAFT_TASK_TYPE, status: "RUNNING" },
      select: { id: true },
    }),
    args.tx.supplyExecutionTask.findFirst({
      where: { id: replacesPurchaseActionId, officeId: args.officeId, workspaceId: args.workspaceId, parentTaskId: replacesPurchaseDraftId, taskType: PURCHASE_ACTION_TASK_TYPE, capabilityKey: PURCHASE_ACTION_CAPABILITY, status: "RUNNING" },
      select: { id: true, result: true },
    }),
  ]);
  if (!supersededDraft || !supersededAction) {
    throw new SupplyPersistenceError("The released order awaiting replacement could not be found.", "conflict");
  }
  const supersededResult = record(supersededAction.result);
  const supersededRelease = record(supersededResult.release);
  const supplierOrderExceptions = Array.isArray(supersededResult.supplierOrderExceptions)
    ? supersededResult.supplierOrderExceptions.map((value) => record(value))
    : [];
  const targetException = supplierOrderExceptions.find((value) => value.exceptionHash === supplierExceptionHash);
  const replacementAuthorization = record(targetException?.replacementAuthorization);
  const unresolvedExceptions = supplierOrderExceptions.filter((value) => [
    "OPEN_REVIEW",
    "RETURNED_TO_SOURCING",
    "REVISION_REQUIRED",
    "REVISION_DRAFTED",
    "REVISION_AUTHORIZED",
  ].includes(String(value.status)));
  if (!["RELEASED", "PARTIALLY_ACKNOWLEDGED"].includes(String(supersededResult.state))
    || supersededRelease.releaseHash !== supersededReleaseHash
    || targetException?.status !== "REVISION_AUTHORIZED"
    || unresolvedExceptions.length !== 1
    || unresolvedExceptions[0]?.exceptionHash !== supplierExceptionHash
    || replacementAuthorization.purchaseActionTaskId !== args.replacementActionId
    || replacementAuthorization.scopeHash !== args.replacementScopeHash) {
    throw new SupplyPersistenceError("The revised order release no longer matches the supplier exception authorization.", "conflict");
  }
  const releasedExceptions = supplierOrderExceptions.map((value) => value.exceptionHash === supplierExceptionHash
    ? {
        ...value,
        status: "REVISION_RELEASED",
        replacementRelease: {
          purchaseActionTaskId: args.replacementActionId,
          scopeHash: args.replacementScopeHash,
          releaseHash: args.replacementReleaseHash,
          releasedAt: args.releasedAt.toISOString(),
        },
      }
    : value);
  const nextResult = {
    ...supersededResult,
    state: "SUPERSEDED",
    supplierOrderExceptions: releasedExceptions,
    openSupplierExceptionCount: releasedExceptions.filter((value) => value.status === "OPEN_REVIEW").length,
    revisionRequiredCount: releasedExceptions.filter((value) => ["REVISION_REQUIRED", "REVISION_DRAFTED", "REVISION_AUTHORIZED"].includes(String(value.status))).length,
    supersededBy: {
      purchaseActionTaskId: args.replacementActionId,
      scopeHash: args.replacementScopeHash,
      replacementReleaseHash: args.replacementReleaseHash,
      supplierExceptionHash,
      supersededAt: args.releasedAt.toISOString(),
    },
    updatedAt: args.releasedAt.toISOString(),
  };
  await args.tx.supplyExecutionTask.update({
    where: { id: supersededAction.id },
    data: { status: "SUCCEEDED", completedAt: args.releasedAt, result: inputJson(nextResult), resultHash: digest(nextResult) },
  });
  await args.tx.supplyExecutionTask.update({
    where: { id: supersededDraft.id },
    data: { status: "SUCCEEDED", completedAt: args.releasedAt },
  });
  return { supersededActionId: supersededAction.id, supersededDraftId: supersededDraft.id, supplierExceptionHash };
}
