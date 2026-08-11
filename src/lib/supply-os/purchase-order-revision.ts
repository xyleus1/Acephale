import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { SupplyPersistenceError } from "./persistence";

const PURCHASE_DRAFT_TASK_TYPE = "PURCHASE_ORDER_DRAFT";
const PURCHASE_ACTION_TASK_TYPE = "PURCHASE_ORDER_ACTION";
const PURCHASE_ACTION_CAPABILITY = "authorize.purchase_order";

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
