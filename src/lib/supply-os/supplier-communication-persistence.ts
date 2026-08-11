import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { stripEmDashes } from "@/lib/no-em-dash";
import { prisma } from "@/lib/prisma";
import { SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import { sourcingSystemWorkspace } from "./sourcing-research-persistence";
import { currentSupplierQualification } from "./supplier-qualification";
import {
  gmailSupplierEmailProvider,
  type SupplierEmailProvider,
  type SupplierEmailSent,
} from "./supplier-email-provider";

export const SUPPLIER_EMAIL_DRAFT_TASK_TYPE = "SUPPLIER_QUOTE_EMAIL_DRAFT";
export const SUPPLIER_EMAIL_ACTION_TASK_TYPE = "SUPPLIER_QUOTE_EMAIL_ACTION";
const QUOTE_CYCLE_TASK_TYPE = "SUPPLIER_QUOTE_CYCLE";
const PROCUREMENT_CASE_TASK_TYPE = "PROCUREMENT_CASE";
const EMAIL_CAPABILITY = "contact.supplier_quote_email";
const REQUIRED_ROLE = "MANAGER";

const procurementQualificationSelect = {
  id: true,
  result: true,
} satisfies Prisma.SupplyExecutionTaskSelect;

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function inputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== "string") throw new SupplyPersistenceError(`${label} is required.`, "invalid_input");
  const normalized = stripEmDashes(value).replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > max) throw new SupplyPersistenceError(`${label} must contain 1 to ${max} characters.`, "invalid_input");
  return normalized;
}

function messageBody(value: unknown) {
  if (typeof value !== "string") throw new SupplyPersistenceError("Email body is required.", "invalid_input");
  const normalized = stripEmDashes(value).replace(/\r\n/g, "\n").trim();
  if (!normalized || normalized.length > 8_000) throw new SupplyPersistenceError("Email body must contain 1 to 8,000 characters.", "invalid_input");
  return normalized;
}

function singleEmail(value: unknown, label: string) {
  const email = requiredText(value, label, 320).toLowerCase();
  if (!/^[^\s@,;:"<>()[\]]+@[^\s@,;:"<>()[\]]+\.[A-Za-z]{2,}$/.test(email)) {
    throw new SupplyPersistenceError(`${label} must be one email address.`, "invalid_input");
  }
  return email;
}

function nonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SupplyPersistenceError(`${label} must be a non-negative integer.`, "invalid_input");
  }
  return value;
}

function requireCurrentSupplierQualification(value: unknown, message: string) {
  if (!currentSupplierQualification(value)) {
    throw new SupplyPersistenceError(message, "conflict");
  }
}

function qualificationFromProcurementResult(value: unknown) {
  return record(record(value).reviews).sourceEvidence;
}

function retryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (
      error.code === "P2002"
      || error.code === "P2034"
      || (error.code === "P2010" && record(error.meta).code === "40001")
    );
}

async function withSerializableRetry<T>(operation: () => Promise<T>, conflictMessage: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) throw new SupplyPersistenceError(conflictMessage, "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError(conflictMessage, "conflict");
}

async function currentAccessContext(context: SupplyAccessContext): Promise<SupplyAccessContext> {
  const user = await prisma.user.findFirst({
    where: { id: context.userId, officeId: context.officeId, isActive: true },
    select: { role: true, canViewWholeOffice: true },
  });
  if (!user) throw new SupplyPersistenceError("Your current user no longer has access to this office.", "forbidden");
  return { ...context, role: user.role, canViewWholeOffice: user.canViewWholeOffice };
}

async function appendEvent(args: {
  tx: Prisma.TransactionClient;
  taskId: string;
  officeId: string;
  workspaceId: string;
  actorUserId: string;
  eventType: string;
  status: string;
  message: string;
  payload: Prisma.InputJsonObject;
}) {
  const aggregate = await args.tx.supplyExecutionEvent.aggregate({
    where: { executionTaskId: args.taskId },
    _max: { sequence: true },
  });
  const sequence = (aggregate._max.sequence ?? 0) + 1;
  await args.tx.supplyExecutionEvent.create({
    data: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      executionTaskId: args.taskId,
      actorUserId: args.actorUserId,
      sequence,
      eventType: args.eventType,
      status: args.status,
      message: args.message,
      payload: args.payload,
      payloadHash: digest(args.payload),
      idempotencyKey: `${args.eventType.toLowerCase()}:${sequence}:${digest(args.payload)}`,
    },
  });
}

const communicationTaskSelect = {
  id: true,
  parentTaskId: true,
  status: true,
  taskKey: true,
  taskType: true,
  capabilityKey: true,
  input: true,
  inputHash: true,
  result: true,
  resultHash: true,
  externalSystem: true,
  externalRef: true,
  createdAt: true,
  updatedAt: true,
  approvals: {
    orderBy: { requestedAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      requiredRole: true,
      scopeHash: true,
      requestReason: true,
      requestedByUserId: true,
      decidedByUserId: true,
      decisionNote: true,
      requestedAt: true,
      decidedAt: true,
      expiresAt: true,
    },
  },
} satisfies Prisma.SupplyExecutionTaskSelect;

export type SupplierCommunicationTask = Prisma.SupplyExecutionTaskGetPayload<{ select: typeof communicationTaskSelect }>;

export async function listSupplierSenderAccounts(context: SupplyAccessContext) {
  const accessContext = await currentAccessContext(context);
  await sourcingSystemWorkspace(accessContext, "view");
  return prisma.emailAccount.findMany({
    where: {
      officeId: context.officeId,
      provider: "GMAIL",
      isActive: true,
      OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
    },
    orderBy: { email: "asc" },
    select: { id: true, email: true, provider: true },
  });
}

export async function listSupplierCommunicationTasks(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  quoteCycleIds: string[];
}) {
  if (!args.quoteCycleIds.length) return [];
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "view");
  if (workspace.id !== args.workspaceId) throw new SupplyPersistenceError("Supply workspace was not found.", "not_found");
  return prisma.supplyExecutionTask.findMany({
    where: {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      parentTaskId: { in: args.quoteCycleIds },
      taskType: { in: [SUPPLIER_EMAIL_DRAFT_TASK_TYPE, SUPPLIER_EMAIL_ACTION_TASK_TYPE] },
      status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING", "SUCCEEDED"] },
    },
    orderBy: { updatedAt: "desc" },
    select: communicationTaskSelect,
  });
}

function normalizeDraft(input: unknown) {
  const body = record(input);
  return {
    expectedRequestHash: requiredText(body.expectedRequestHash, "Quote request hash", 128),
    expectedRevision: nonNegativeInteger(body.expectedRevision, "Expected email revision"),
    senderAccountId: requiredText(body.senderAccountId, "Sender account", 220),
    recipient: singleEmail(body.recipient, "Supplier recipient"),
    subject: requiredText(body.subject, "Email subject", 180),
    body: messageBody(body.body),
  };
}

export async function saveSupplierEmailDraft(args: {
  context: SupplyAccessContext;
  quoteCycleId: string;
  input: unknown;
}) {
  const draftInput = normalizeDraft(args.input);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  const sender = await prisma.emailAccount.findFirst({
    where: {
      id: draftInput.senderAccountId,
      officeId: args.context.officeId,
      provider: "GMAIL",
      isActive: true,
      OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
    },
    select: { id: true, email: true },
  });
  if (!sender) throw new SupplyPersistenceError("The selected Gmail sender is missing, inactive, or disconnected.", "invalid_input");
  const quoteLookup = await prisma.supplyExecutionTask.findFirst({
    where: {
      id: args.quoteCycleId,
      officeId: args.context.officeId,
      workspaceId: workspace.id,
      taskType: QUOTE_CYCLE_TASK_TYPE,
    },
    select: { parentTaskId: true },
  });
  if (!quoteLookup?.parentTaskId) throw new SupplyPersistenceError("An editable supplier quote request was not found.", "not_found");
  const procurementCaseId = quoteLookup.parentTaskId;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.quoteCycleId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${args.quoteCycleId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: {
            id: procurementCaseId,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            taskType: PROCUREMENT_CASE_TASK_TYPE,
            status: "PLANNED",
          },
          select: procurementQualificationSelect,
        });
        const quoteCycle = await tx.supplyExecutionTask.findFirst({
          where: { id: args.quoteCycleId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: QUOTE_CYCLE_TASK_TYPE, status: "PLANNED" },
          select: { id: true, parentTaskId: true, input: true, result: true },
        });
        if (!quoteCycle?.parentTaskId || !procurementCase) throw new SupplyPersistenceError("An editable supplier quote request was not found.", "not_found");
        requireCurrentSupplierQualification(
          qualificationFromProcurementResult(procurementCase.result),
          "Supplier qualification is missing or expired. Requalify the supplier before drafting contact.",
        );
        const quoteResult = record(quoteCycle.result);
        if (quoteResult.requestHash !== draftInput.expectedRequestHash || record(quoteResult.release).releaseHash) {
          throw new SupplyPersistenceError("The quote request changed or was already released. Reload before editing the email.", "conflict");
        }
        let existing = await tx.supplyExecutionTask.findFirst({
          where: { officeId: args.context.officeId, workspaceId: workspace.id, parentTaskId: quoteCycle.id, taskType: SUPPLIER_EMAIL_DRAFT_TASK_TYPE, status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] } },
          orderBy: { updatedAt: "desc" },
          select: communicationTaskSelect,
        });
        if (existing?.status === "RUNNING") throw new SupplyPersistenceError("Email delivery is unresolved. Reconcile it before editing the message.", "conflict");
        const current = record(existing?.result);
        const revision = typeof current.revision === "number" ? current.revision : 0;
        if (draftInput.expectedRevision !== revision) throw new SupplyPersistenceError("The email draft changed in another session. Reload before saving.", "conflict");
        const message = {
          senderAccountId: sender.id,
          senderEmail: sender.email,
          recipient: draftInput.recipient,
          subject: draftInput.subject,
          body: draftInput.body,
        };
        const messageHash = digest(message);
        const taskInput = { procurementCaseId: quoteCycle.parentTaskId, quoteCycleId: quoteCycle.id, requestHash: draftInput.expectedRequestHash, supplier: record(quoteCycle.input).supplier };
        if (existing && current.messageHash === messageHash && record(existing.input).requestHash === draftInput.expectedRequestHash) return existing;
        const activeActions = await tx.supplyExecutionTask.findMany({
          where: { officeId: args.context.officeId, workspaceId: workspace.id, parentTaskId: quoteCycle.id, taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE, status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] } },
          select: { id: true, status: true, result: true },
        });
        if (activeActions.some((action) => action.status === "RUNNING" || ["SENDING", "NOT_FOUND_REVIEW_REQUIRED"].includes(String(record(action.result).state)))) {
          throw new SupplyPersistenceError("Email delivery is unresolved. Reconcile it before editing the message.", "conflict");
        }
        const now = new Date();
        if (activeActions.length) {
          const actionIds = activeActions.filter((action) => action.status !== "BLOCKED").map((action) => action.id);
          await tx.supplyApproval.updateMany({ where: { executionTaskId: { in: actionIds }, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: now, decisionNote: "Supplier email draft changed." } });
          await tx.supplyExecutionTask.updateMany({ where: { id: { in: actionIds }, status: { in: ["PLANNED", "READY"] } }, data: { status: "CANCELLED", cancelledAt: now } });
        }
        if (existing && existing.status !== "PLANNED") {
          await tx.supplyExecutionTask.update({ where: { id: existing.id }, data: { status: "CANCELLED", cancelledAt: now } });
          existing = null;
        }
        const result = { revision: revision + 1, message, messageHash, approval: null, updatedAt: now.toISOString() };
        const draft = existing
          ? await tx.supplyExecutionTask.update({ where: { id: existing.id }, data: { result: inputJson(result), resultHash: digest(result) }, select: communicationTaskSelect })
          : await tx.supplyExecutionTask.create({
              data: {
                officeId: args.context.officeId,
                workspaceId: workspace.id,
                createdByUserId: args.context.userId,
                parentTaskId: quoteCycle.id,
                taskKey: `supplier-email-draft:${quoteCycle.id}:${draftInput.expectedRequestHash}:${result.revision}`,
                taskType: SUPPLIER_EMAIL_DRAFT_TASK_TYPE,
                capabilityKey: EMAIL_CAPABILITY,
                requiresApproval: false,
                input: inputJson(taskInput),
                inputHash: digest(taskInput),
                result: inputJson(result),
                resultHash: digest(result),
              },
              select: communicationTaskSelect,
            });
        await appendEvent({ tx, taskId: draft.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: existing ? "SUPPLIER_EMAIL_DRAFT_UPDATED" : "SUPPLIER_EMAIL_DRAFT_CREATED", status: "PLANNED", message: existing ? "Supplier email draft was updated." : "Supplier email draft was created.", payload: inputJson({ quoteCycleId: quoteCycle.id, revision: result.revision, messageHash }) });
        return draft;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) throw new SupplyPersistenceError("The supplier email draft changed concurrently. Reload and retry.", "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("The supplier email draft could not be saved.", "conflict");
}

export async function requestSupplierEmailApproval(args: { context: SupplyAccessContext; draftId: string; input: unknown }) {
  const body = record(args.input);
  const expectedResultHash = requiredText(body.expectedResultHash, "Email draft result hash", 128);
  const reason = requiredText(body.reason, "Approval reason", 2_000);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");

  for (let retry = 0; retry < 3; retry += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const draftLookup = await tx.supplyExecutionTask.findFirst({ where: { id: args.draftId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: SUPPLIER_EMAIL_DRAFT_TASK_TYPE }, select: { parentTaskId: true } });
        if (!draftLookup?.parentTaskId) throw new SupplyPersistenceError("Supplier email draft was not found.", "not_found");
        const quoteLookup = await tx.supplyExecutionTask.findFirst({ where: { id: draftLookup.parentTaskId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: QUOTE_CYCLE_TASK_TYPE }, select: { parentTaskId: true } });
        if (!quoteLookup?.parentTaskId) throw new SupplyPersistenceError("Supplier email draft was not found.", "not_found");
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${quoteLookup.parentTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${draftLookup.parentTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${draftLookup.parentTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
        const draft = await tx.supplyExecutionTask.findFirst({ where: { id: args.draftId, officeId: args.context.officeId, workspaceId: workspace.id, parentTaskId: draftLookup.parentTaskId, taskType: SUPPLIER_EMAIL_DRAFT_TASK_TYPE, status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] } }, select: communicationTaskSelect });
        const quoteCycle = await tx.supplyExecutionTask.findFirst({ where: { id: draftLookup.parentTaskId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: QUOTE_CYCLE_TASK_TYPE, status: "PLANNED" }, select: { id: true, parentTaskId: true, input: true, result: true } });
        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: { id: quoteLookup.parentTaskId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: PROCUREMENT_CASE_TASK_TYPE, status: "PLANNED" },
          select: procurementQualificationSelect,
        });
        if (!draft || !quoteCycle?.parentTaskId || !procurementCase) throw new SupplyPersistenceError("The supplier email draft changed. Reload before requesting approval.", "conflict");
        const draftResult = record(draft.result);
        const quoteResult = record(quoteCycle.result);
        if (record(draft.input).requestHash !== quoteResult.requestHash) throw new SupplyPersistenceError("The quote request changed after the email was drafted.", "conflict");
        const supplierQualification = record(qualificationFromProcurementResult(procurementCase.result));
        requireCurrentSupplierQualification(
          supplierQualification,
          "Supplier qualification is missing or expired. Requalify the supplier before requesting email approval.",
        );
        const communicationActions = await tx.supplyExecutionTask.findMany({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            parentTaskId: quoteCycle.id,
            taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE,
            status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] },
          },
          select: communicationTaskSelect,
        });
        const legacyActions = communicationActions.filter((action) => typeof record(action.input).supplierQualificationHash !== "string");
        const unresolvedLegacyAction = legacyActions.some((action) => [
          "SENDING",
          "DELIVERY_UNKNOWN",
          "NOT_FOUND_REVIEW_REQUIRED",
        ].includes(String(record(action.result).state)));
        if (unresolvedLegacyAction) {
          throw new SupplyPersistenceError("Legacy supplier email delivery is unresolved. Reconcile it before requesting a newly scoped approval.", "conflict");
        }
        if (draft.status === "RUNNING" && legacyActions.length === 0) {
          throw new SupplyPersistenceError("Supplier email delivery is unresolved. Reconcile it before requesting approval.", "conflict");
        }
        if (legacyActions.length && draft.resultHash !== expectedResultHash) {
          throw new SupplyPersistenceError("The supplier email draft changed. Reload before replacing its legacy approval.", "conflict");
        }
        if (legacyActions.length) {
          const legacyActionIds = legacyActions.map((action) => action.id);
          const now = new Date();
          await tx.supplyApproval.updateMany({
            where: { executionTaskId: { in: legacyActionIds }, status: "PENDING" },
            data: { status: "CANCELLED", decidedAt: now, decisionNote: "Supplier qualification was added to the email approval scope." },
          });
          await tx.supplyExecutionTask.updateMany({
            where: { id: { in: legacyActionIds }, status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] } },
            data: { status: "CANCELLED", cancelledAt: now },
          });
        }
        const immutableInput = {
          action: "SEND_SUPPLIER_QUOTE_REQUEST",
          procurementCaseId: quoteCycle.parentTaskId,
          quoteCycleId: quoteCycle.id,
          quoteRequestHash: quoteResult.requestHash,
          quoteRequest: quoteResult.request,
          supplier: record(quoteCycle.input).supplier,
          draftId: draft.id,
          draftRevision: draftResult.revision,
          draftMessageHash: draftResult.messageHash,
          requestedDraftResultHash: expectedResultHash,
          message: draftResult.message,
          supplierQualificationHash: requiredText(supplierQualification.reviewHash, "Supplier qualification hash", 128),
          supplierQualificationValidUntil: requiredText(supplierQualification.validUntil, "Supplier qualification validity", 10),
        };
        const scopeHash = digest(immutableInput);
        const terminal = await tx.supplyApproval.findFirst({
          where: { officeId: args.context.officeId, workspaceId: workspace.id, scopeHash, status: { in: ["APPROVED", "REJECTED"] }, executionTask: { taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE } },
          select: { status: true },
        });
        if (terminal) throw new SupplyPersistenceError(terminal.status === "APPROVED" ? "This exact supplier email was already approved." : "This exact supplier email was rejected. Edit the draft before requesting another approval.", "conflict");
        const pending = await tx.supplyApproval.findFirst({
          where: { officeId: args.context.officeId, workspaceId: workspace.id, scopeHash, status: "PENDING", executionTask: { taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE } },
          include: { executionTask: { select: communicationTaskSelect } },
        });
        if (pending?.executionTask) return { draft, action: pending.executionTask, approval: pending };
        if (draft.resultHash !== expectedResultHash) throw new SupplyPersistenceError("The supplier email draft changed. Reload before requesting approval.", "conflict");
        const attempts = await tx.supplyApproval.count({ where: { officeId: args.context.officeId, workspaceId: workspace.id, scopeHash, executionTask: { taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE } } });
        const attempt = attempts + 1;
        const action = await tx.supplyExecutionTask.create({
          data: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            createdByUserId: args.context.userId,
            parentTaskId: quoteCycle.id,
            taskKey: `supplier-email-action:${quoteCycle.id}:${scopeHash}:${attempt}`,
            taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE,
            capabilityKey: EMAIL_CAPABILITY,
            externalSystem: "GMAIL",
            requiresApproval: true,
            input: inputJson(immutableInput),
            inputHash: scopeHash,
            idempotencyKey: `supplier-email-action:${quoteCycle.id}:${scopeHash}:${attempt}`,
          },
          select: communicationTaskSelect,
        });
        const approval = await tx.supplyApproval.create({
          data: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            executionTaskId: action.id,
            requestedByUserId: args.context.userId,
            requiredRole: REQUIRED_ROLE,
            scopeHash,
            requestReason: reason,
            requestContext: inputJson({ procurementCaseId: quoteCycle.parentTaskId, quoteCycleId: quoteCycle.id, draftId: draft.id }),
            idempotencyKey: `supplier-email:${quoteCycle.id}:${scopeHash}:${attempt}`,
          },
        });
        const now = new Date();
        const nextDraftResult = { ...draftResult, approval: { id: approval.id, actionId: action.id, status: "PENDING", scopeHash, requestedAt: approval.requestedAt.toISOString() }, updatedAt: now.toISOString() };
        const updatedDraft = await tx.supplyExecutionTask.update({ where: { id: draft.id }, data: { status: "BLOCKED", result: inputJson(nextDraftResult), resultHash: digest(nextDraftResult) }, select: communicationTaskSelect });
        await appendEvent({ tx, taskId: action.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: "SUPPLIER_EMAIL_APPROVAL_REQUESTED", status: "BLOCKED", message: "The exact supplier email was submitted for approval.", payload: inputJson({ draftId: draft.id, scopeHash }) });
        return { draft: updatedDraft, action, approval };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || retry === 2) {
        if (retryableTransactionError(error)) throw new SupplyPersistenceError("Supplier email approval changed concurrently. Reload and retry.", "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Supplier email approval could not be requested.", "conflict");
}

export async function decideSupplierEmailApproval(args: { context: SupplyAccessContext; approvalId: string; input: unknown }) {
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) throw new SupplyPersistenceError("Only an admin or manager can decide supplier email approvals.", "forbidden");
  const body = record(args.input);
  const decision = body.decision;
  if (decision !== "APPROVE" && decision !== "REJECT") throw new SupplyPersistenceError("Decision must be APPROVE or REJECT.", "invalid_input");
  const note = typeof body.note === "string" && body.note.trim() ? requiredText(body.note, "Approval note", 2_000) : null;
  const found = await prisma.supplyApproval.findFirst({ where: { id: args.approvalId, officeId: args.context.officeId }, include: { executionTask: true } });
  if (!found?.executionTask || found.executionTask.taskType !== SUPPLIER_EMAIL_ACTION_TASK_TYPE || !found.executionTask.parentTaskId) throw new SupplyPersistenceError("Supplier email approval was not found.", "not_found");
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  if (workspace.id !== found.workspaceId) throw new SupplyPersistenceError("Supplier email approval was not found.", "not_found");
  const actionInput = record(found.executionTask.input);
  const draftId = requiredText(actionInput.draftId, "Supplier email draft ID", 220);
  const procurementCaseId = requiredText(actionInput.procurementCaseId, "Procurement case ID", 220);
  const targetStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${found.executionTask!.parentTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${draftId}, ${found.executionTask!.id}) AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyApproval" WHERE "id" = ${args.approvalId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    const approval = await tx.supplyApproval.findFirst({ where: { id: args.approvalId, officeId: args.context.officeId, workspaceId: workspace.id }, include: { executionTask: true } });
    const draft = await tx.supplyExecutionTask.findFirst({ where: { id: draftId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: SUPPLIER_EMAIL_DRAFT_TASK_TYPE }, select: communicationTaskSelect });
    const quoteCycle = await tx.supplyExecutionTask.findFirst({ where: { id: found.executionTask!.parentTaskId!, officeId: args.context.officeId, workspaceId: workspace.id, taskType: QUOTE_CYCLE_TASK_TYPE, status: "PLANNED" }, select: { result: true } });
    const procurementCase = await tx.supplyExecutionTask.findFirst({ where: { id: procurementCaseId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: PROCUREMENT_CASE_TASK_TYPE, status: "PLANNED" }, select: procurementQualificationSelect });
    if (!approval?.executionTask || !draft || !quoteCycle || !procurementCase || approval.executionTask.inputHash !== approval.scopeHash || approval.scopeHash !== found.scopeHash) throw new SupplyPersistenceError("Supplier email approval scope is invalid.", "conflict");
    const currentDraftResult = record(draft.result);
    if (
      currentDraftResult.messageHash !== actionInput.draftMessageHash
      || currentDraftResult.revision !== actionInput.draftRevision
      || record(quoteCycle.result).requestHash !== actionInput.quoteRequestHash
    ) throw new SupplyPersistenceError("The supplier email or quote request changed after approval was requested.", "conflict");
    if (approval.status !== "PENDING") {
      if (approval.status === targetStatus && approval.decidedByUserId === args.context.userId) return { draft, action: approval.executionTask, approval };
      throw new SupplyPersistenceError("This supplier email approval has already been decided.", "conflict");
    }
    if (decision === "APPROVE") {
      const supplierQualification = record(qualificationFromProcurementResult(procurementCase.result));
      requireCurrentSupplierQualification(
        supplierQualification,
        "Supplier qualification is missing or expired. Requalify the supplier before approving contact.",
      );
      if (supplierQualification.reviewHash !== actionInput.supplierQualificationHash) {
        throw new SupplyPersistenceError("Supplier qualification changed after email approval was requested. Request a new approval.", "conflict");
      }
    }
    if (approval.requestedByUserId === args.context.userId) {
      const alternatives = await tx.user.count({
        where: {
          officeId: args.context.officeId,
          id: { not: args.context.userId },
          isActive: true,
          role: { in: ["ADMIN", "MANAGER"] },
          OR: [
            { canViewWholeOffice: true },
            { supplyWorkspaceMembers: { some: { workspaceId: workspace.id } } },
          ],
        },
      });
      if (alternatives > 0) throw new SupplyPersistenceError("A different eligible approver is available, so self-approval is blocked.", "forbidden");
    }
    const decidedAt = new Date();
    const decided = await tx.supplyApproval.update({ where: { id: approval.id }, data: { status: targetStatus, decidedByUserId: args.context.userId, decidedAt, decisionNote: note } });
    const actionResult = { state: decision === "APPROVE" ? "APPROVED" : "REJECTED", approvalId: approval.id, scopeHash: approval.scopeHash, decidedByUserId: args.context.userId, decidedAt: decidedAt.toISOString(), note, attempt: 0 };
    const action = await tx.supplyExecutionTask.update({ where: { id: approval.executionTask.id }, data: { status: decision === "APPROVE" ? "READY" : "BLOCKED", result: inputJson(actionResult), resultHash: digest(actionResult) }, select: communicationTaskSelect });
    const draftResult = currentDraftResult;
    const nextDraftResult = { ...draftResult, approval: { ...record(draftResult.approval), status: targetStatus, decidedByUserId: args.context.userId, decidedAt: decidedAt.toISOString(), decisionNote: note }, updatedAt: decidedAt.toISOString() };
    const updatedDraft = await tx.supplyExecutionTask.update({ where: { id: draft.id }, data: { status: decision === "APPROVE" ? "READY" : "BLOCKED", result: inputJson(nextDraftResult), resultHash: digest(nextDraftResult) }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: action.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: decision === "APPROVE" ? "SUPPLIER_EMAIL_APPROVED" : "SUPPLIER_EMAIL_REJECTED", status: action.status, message: decision === "APPROVE" ? "The exact supplier email was approved for delivery." : "The supplier email was rejected.", payload: inputJson(actionResult) });
    return { draft: updatedDraft, action, approval: decided };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier email approval changed concurrently. Reload and retry.");
}

async function finalizeSent(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  actionId: string;
  receipt: SupplierEmailSent;
  rfcMessageId: string;
}) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const lookup = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE }, select: { parentTaskId: true, input: true } });
    if (!lookup?.parentTaskId) throw new SupplyPersistenceError("Supplier email action was not found.", "not_found");
    const actionInput = record(lookup.input);
    const draftId = requiredText(actionInput.draftId, "Supplier email draft ID", 220);
    const procurementCaseId = requiredText(actionInput.procurementCaseId, "Procurement case ID", 220);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${lookup.parentTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${draftId}, ${args.actionId}) AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} ORDER BY "id" FOR UPDATE`);
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE }, select: communicationTaskSelect });
    const draft = await tx.supplyExecutionTask.findFirst({ where: { id: draftId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: SUPPLIER_EMAIL_DRAFT_TASK_TYPE }, select: communicationTaskSelect });
    const quoteCycle = await tx.supplyExecutionTask.findFirst({ where: { id: lookup.parentTaskId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: QUOTE_CYCLE_TASK_TYPE }, select: { id: true, status: true, input: true, result: true } });
    const procurementCase = await tx.supplyExecutionTask.findFirst({ where: { id: procurementCaseId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: PROCUREMENT_CASE_TASK_TYPE, status: "PLANNED" }, select: { id: true, result: true } });
    if (!action || !draft || !quoteCycle || !procurementCase) throw new SupplyPersistenceError("Supplier email delivery scope is incomplete.", "conflict");
    if (action.status === "SUCCEEDED" && record(action.result).providerMessageId === args.receipt.providerMessageId) return action;
    const quoteResult = record(quoteCycle.result);
    if (quoteCycle.status !== "PLANNED" || quoteResult.requestHash !== actionInput.quoteRequestHash || record(quoteResult.release).releaseHash) throw new SupplyPersistenceError("The quote request was already released or changed.", "conflict");
    const message = record(actionInput.message);
    const now = new Date();
    const releasedOn = now.toISOString().slice(0, 10);
    const releasePayload = {
      channel: "EMAIL",
      releasedOn,
      evidenceUrl: args.receipt.sourceUrl,
      note: null,
      provider: args.receipt.provider,
      providerMessageId: args.receipt.providerMessageId,
      providerThreadId: args.receipt.providerThreadId,
      rfcMessageId: args.rfcMessageId,
      messageHash: digest(message),
    };
    const releaseHash = digest(releasePayload);
    let localThreadId: string | null = null;
    const existingMessage = await tx.emailMessage.findFirst({
      where: {
        thread: { officeId: args.context.officeId },
        OR: [{ gmailMessageId: args.receipt.providerMessageId }, { externalId: args.rfcMessageId }],
      },
      select: { threadId: true },
    });
    if (existingMessage) {
      localThreadId = existingMessage.threadId;
    } else {
      const thread = await tx.emailThread.create({ data: { officeId: args.context.officeId, subject: requiredText(message.subject, "Stored email subject", 180), participants: JSON.stringify([message.senderEmail, message.recipient]), externalThreadId: args.receipt.providerThreadId, lastMessageAt: now, messageCount: 1 } });
      localThreadId = thread.id;
      await tx.emailMessage.create({ data: { threadId: thread.id, accountId: requiredText(message.senderAccountId, "Stored sender account", 220), externalId: args.rfcMessageId, gmailMessageId: args.receipt.providerMessageId, direction: "OUTBOUND", fromEmail: requiredText(message.senderEmail, "Stored sender email", 320), toEmails: JSON.stringify([requiredText(message.recipient, "Stored recipient", 320)]), subject: requiredText(message.subject, "Stored email subject", 180), bodyText: messageBody(message.body), sentAt: now } });
    }
    const evidenceKey = `supplier_quote_release:${quoteCycle.id}:${releaseHash}`;
    const existingEvidence = await tx.supplyEvidence.findUnique({
      where: { workspaceId_evidenceKey: { workspaceId: args.workspaceId, evidenceKey } },
      select: { id: true, officeId: true, executionTaskId: true, sourceRecordId: true },
    });
    if (
      existingEvidence
      && (existingEvidence.officeId !== args.context.officeId
        || existingEvidence.executionTaskId !== quoteCycle.id
        || existingEvidence.sourceRecordId !== args.receipt.providerMessageId)
    ) throw new SupplyPersistenceError("Supplier email evidence identity conflicted with an existing record.", "conflict");
    const evidence = existingEvidence ?? await tx.supplyEvidence.create({
      data: { officeId: args.context.officeId, workspaceId: args.workspaceId, executionTaskId: quoteCycle.id, createdByUserId: args.context.userId, evidenceKey, kind: "SUPPLIER_QUOTE_RELEASE", sourceType: "CONNECTED_PROVIDER", sourceUri: args.receipt.sourceUrl, sourceRecordId: args.receipt.providerMessageId, sourceVersion: releaseHash, title: `Quote request email to ${requiredText(message.recipient, "Stored recipient", 320)}`, payload: inputJson(releasePayload), contentHash: releaseHash, observedAt: now },
      select: { id: true },
    });
    const release = { ...releasePayload, evidenceId: evidence.id, evidenceClass: "CONNECTED_PROVIDER", releaseHash, recordedByUserId: args.context.userId, recordedAt: now.toISOString() };
    const nextQuoteResult = { ...quoteResult, state: "AWAITING_RESPONSE", release, externalSideEffect: "CONNECTED_PROVIDER", updatedAt: now.toISOString() };
    await tx.supplyExecutionTask.update({ where: { id: quoteCycle.id }, data: { status: "READY" } });
    await tx.supplyExecutionTask.update({ where: { id: quoteCycle.id }, data: { status: "RUNNING", startedAt: now, result: inputJson(nextQuoteResult), resultHash: digest(nextQuoteResult) } });
    const caseResult = record(procurementCase.result);
    const nextCaseResult = { ...caseResult, quoteCycle: { taskId: quoteCycle.id, state: "AWAITING_RESPONSE", revision: quoteResult.revision, requestHash: quoteResult.requestHash, responseCount: 0, releasedOn, updatedAt: now.toISOString() }, updatedAt: now.toISOString() };
    await tx.supplyExecutionTask.update({ where: { id: procurementCase.id }, data: { result: inputJson(nextCaseResult), resultHash: digest(nextCaseResult) } });
    const deliveryResult = { state: "SENT", attempt: record(action.result).attempt, rfcMessageId: args.rfcMessageId, provider: args.receipt.provider, providerMessageId: args.receipt.providerMessageId, providerThreadId: args.receipt.providerThreadId, sourceUrl: args.receipt.sourceUrl, localThreadId, evidenceId: evidence.id, sentAt: now.toISOString() };
    if (action.status === "READY") await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { status: "RUNNING", startedAt: now } });
    if (draft.status === "READY") await tx.supplyExecutionTask.update({ where: { id: draft.id }, data: { status: "RUNNING", startedAt: now } });
    const sentAction = await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { status: "SUCCEEDED", result: inputJson(deliveryResult), resultHash: digest(deliveryResult), completedAt: now, error: Prisma.DbNull }, select: communicationTaskSelect });
    await tx.supplyExecutionTask.update({ where: { id: draft.id }, data: { status: "SUCCEEDED", completedAt: now } });
    const payload = inputJson({ quoteCycleId: quoteCycle.id, release, actionId: action.id });
    await appendEvent({ tx, taskId: action.id, officeId: args.context.officeId, workspaceId: args.workspaceId, actorUserId: args.context.userId, eventType: "SUPPLIER_EMAIL_SENT", status: "SUCCEEDED", message: "Gmail returned a supplier email delivery receipt.", payload });
    await appendEvent({ tx, taskId: quoteCycle.id, officeId: args.context.officeId, workspaceId: args.workspaceId, actorUserId: args.context.userId, eventType: "SUPPLIER_QUOTE_REQUEST_SENT", status: "RUNNING", message: "The supplier quote request was sent through connected Gmail.", payload });
    await appendEvent({ tx, taskId: procurementCase.id, officeId: args.context.officeId, workspaceId: args.workspaceId, actorUserId: args.context.userId, eventType: "SUPPLIER_QUOTE_REQUEST_SENT", status: "PLANNED", message: "The quote request is awaiting a supplier response.", payload });
    return sentAction;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier email delivery changed concurrently. Reconcile before retrying.");
}

export async function sendSupplierEmailAction(args: { context: SupplyAccessContext; actionId: string; provider?: SupplierEmailProvider }) {
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  const claimed = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const lookup = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE }, select: { parentTaskId: true, input: true } });
    if (!lookup?.parentTaskId) throw new SupplyPersistenceError("Supplier email action was not found.", "not_found");
    const actionInput = record(lookup.input);
    const draftId = requiredText(actionInput.draftId, "Supplier email draft ID", 220);
    const procurementCaseId = requiredText(actionInput.procurementCaseId, "Procurement case ID", 220);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${lookup.parentTaskId}, ${draftId}, ${args.actionId}) AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE }, select: communicationTaskSelect });
    if (!action) throw new SupplyPersistenceError("Supplier email action was not found.", "not_found");
    if (action.status === "SUCCEEDED") return { alreadySent: action, action: null, input: null, rfcMessageId: null };
    const procurementCase = await tx.supplyExecutionTask.findFirst({
      where: { id: procurementCaseId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: PROCUREMENT_CASE_TASK_TYPE, status: "PLANNED" },
      select: procurementQualificationSelect,
    });
    if (!procurementCase) throw new SupplyPersistenceError("Supplier email procurement scope is no longer active.", "conflict");
    const supplierQualification = record(qualificationFromProcurementResult(procurementCase.result));
    requireCurrentSupplierQualification(
      supplierQualification,
      "Supplier qualification is missing or expired. Requalify the supplier before sending contact.",
    );
    if (supplierQualification.reviewHash !== actionInput.supplierQualificationHash) {
      throw new SupplyPersistenceError("Supplier qualification changed after this email was approved. Request a new approval.", "conflict");
    }
    const prior = record(action.result);
    const retryableRunning = action.status === "RUNNING" && ["RETRY_READY", "SEND_FAILED"].includes(String(prior.state));
    if ((action.status === "RUNNING" && !retryableRunning) || action.status === "BLOCKED" || prior.state === "SENDING") throw new SupplyPersistenceError("Email delivery is unresolved or blocked. Reconcile it before another send.", "conflict");
    const approval = action.approvals[0];
    if (!["READY", "RUNNING"].includes(action.status) || !approval || approval.status !== "APPROVED" || approval.scopeHash !== action.inputHash) throw new SupplyPersistenceError("The exact supplier email is not approved for delivery.", "conflict");
    const attempt = typeof prior.attempt === "number" ? prior.attempt + 1 : 1;
    const rfcMessageId = `<supply-${action.id}-${attempt}@derya.ai>`;
    const sending = { state: "SENDING", attempt, rfcMessageId, startedAt: new Date().toISOString() };
    const updated = await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { result: inputJson(sending), resultHash: digest(sending), error: Prisma.DbNull }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: action.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: "SUPPLIER_EMAIL_SEND_STARTED", status: "RUNNING", message: "Supplier email delivery started.", payload: inputJson({ attempt, rfcMessageId }) });
    return { alreadySent: null, action: updated, input: record(action.input), rfcMessageId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier email delivery changed concurrently. Reload before sending.");
  if (claimed.alreadySent) return claimed.alreadySent;
  const message = record(claimed.input?.message);
  const provider = args.provider ?? gmailSupplierEmailProvider;
  const receipt = await provider.send({ officeId: args.context.officeId, accountId: requiredText(message.senderAccountId, "Sender account", 220), senderEmail: singleEmail(message.senderEmail, "Approved sender email"), recipient: singleEmail(message.recipient, "Supplier recipient"), subject: requiredText(message.subject, "Email subject", 180), body: messageBody(message.body), rfcMessageId: claimed.rfcMessageId! });
  if (receipt.state === "SENT") return finalizeSent({ context: args.context, workspaceId: workspace.id, actionId: args.actionId, receipt, rfcMessageId: claimed.rfcMessageId! });
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const actionLookup = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: workspace.id }, select: { parentTaskId: true, input: true } });
    if (!actionLookup?.parentTaskId) throw new SupplyPersistenceError("Supplier email action was not found.", "not_found");
    const draftId = requiredText(record(actionLookup.input).draftId, "Supplier email draft ID", 220);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${actionLookup.parentTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${draftId}, ${args.actionId}) AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: workspace.id }, select: communicationTaskSelect });
    if (!action) throw new SupplyPersistenceError("Supplier email action was not found.", "not_found");
    const current = record(action.result);
    if (action.status === "SUCCEEDED" && current.state === "SENT") return action;
    if (current.rfcMessageId !== claimed.rfcMessageId) throw new SupplyPersistenceError("Supplier email delivery changed concurrently.", "conflict");
    if (current.state !== "SENDING") return action;
    const state = receipt.state === "UNKNOWN" ? "DELIVERY_UNKNOWN" : "SEND_FAILED";
    const result = { ...current, state, error: receipt.error, needsReauth: receipt.needsReauth ?? false, updatedAt: new Date().toISOString() };
    if (receipt.state === "UNKNOWN") {
      await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { status: "RUNNING", startedAt: new Date() } });
      await tx.supplyExecutionTask.update({ where: { id: draftId }, data: { status: "RUNNING", startedAt: new Date() } });
    }
    const updated = await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { result: inputJson(result), resultHash: digest(result), error: inputJson({ message: receipt.error, state }) }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: action.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: receipt.state === "UNKNOWN" ? "SUPPLIER_EMAIL_DELIVERY_UNKNOWN" : "SUPPLIER_EMAIL_SEND_REJECTED", status: updated.status, message: receipt.state === "UNKNOWN" ? "Gmail delivery is unknown. A retry is blocked until reconciliation." : "Gmail rejected the send before returning a delivery receipt.", payload: inputJson(result) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier email delivery changed concurrently. Reconcile before retrying.");
}

export async function reconcileSupplierEmailAction(args: { context: SupplyAccessContext; actionId: string; provider?: SupplierEmailProvider }) {
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  const action = await prisma.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE, status: { in: ["READY", "RUNNING", "BLOCKED"] } }, select: communicationTaskSelect });
  if (!action) throw new SupplyPersistenceError("An unresolved supplier email action was not found.", "not_found");
  const result = record(action.result);
  if (!["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"].includes(String(result.state))) throw new SupplyPersistenceError("This supplier email does not need reconciliation.", "conflict");
  const message = record(record(action.input).message);
  const rfcMessageId = requiredText(result.rfcMessageId, "Supplier email message ID", 500);
  const provider = args.provider ?? gmailSupplierEmailProvider;
  const receipt = await provider.reconcile({ officeId: args.context.officeId, accountId: requiredText(message.senderAccountId, "Sender account", 220), senderEmail: singleEmail(message.senderEmail, "Approved sender email"), rfcMessageId });
  if (receipt.state === "SENT") return finalizeSent({ context: args.context, workspaceId: workspace.id, actionId: action.id, receipt, rfcMessageId });
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const draftId = requiredText(record(action.input).draftId, "Supplier email draft ID", 220);
    if (!action.parentTaskId) throw new SupplyPersistenceError("Supplier email action parent was not found.", "conflict");
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${action.parentTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${draftId}, ${action.id}) AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const current = await tx.supplyExecutionTask.findFirst({ where: { id: action.id, officeId: args.context.officeId, workspaceId: workspace.id }, select: communicationTaskSelect });
    if (!current) throw new SupplyPersistenceError("Supplier email delivery changed concurrently.", "conflict");
    const currentResult = record(current.result);
    if (current.status === "SUCCEEDED" && currentResult.state === "SENT") return current;
    if (currentResult.rfcMessageId !== rfcMessageId) throw new SupplyPersistenceError("Supplier email delivery changed concurrently.", "conflict");
    if (!["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"].includes(String(currentResult.state))) return current;
    const now = new Date();
    const nextResult = { ...currentResult, state: receipt.state === "NOT_FOUND" ? "NOT_FOUND_REVIEW_REQUIRED" : "DELIVERY_UNKNOWN", error: receipt.error ?? null, lastCheckedAt: now.toISOString() };
    if (current.status === "READY") {
      await tx.supplyExecutionTask.update({ where: { id: current.id }, data: { status: "RUNNING", startedAt: now } });
      await tx.supplyExecutionTask.update({ where: { id: draftId }, data: { status: "RUNNING", startedAt: now } });
    }
    const updated = await tx.supplyExecutionTask.update({ where: { id: current.id }, data: { result: inputJson(nextResult), resultHash: digest(nextResult) }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: current.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: receipt.state === "NOT_FOUND" ? "SUPPLIER_EMAIL_NOT_FOUND" : "SUPPLIER_EMAIL_RECONCILIATION_UNKNOWN", status: updated.status, message: receipt.state === "NOT_FOUND" ? "Gmail did not find the stable message ID. Human review is required before retry." : "Gmail reconciliation did not return a definitive result.", payload: inputJson(nextResult) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier email reconciliation changed concurrently. Reload and retry.");
}

export async function resetSupplierEmailForRetry(args: { context: SupplyAccessContext; actionId: string; input: unknown }) {
  const body = record(args.input);
  if (body.confirmedNotSent !== true) throw new SupplyPersistenceError("Confirm that the email was not sent before enabling a retry.", "invalid_input");
  const note = requiredText(body.note, "Recovery note", 2_000);
  if (note.length < 10) throw new SupplyPersistenceError("Recovery note must explain how non-delivery was verified.", "invalid_input");
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) throw new SupplyPersistenceError("Only an admin or manager can reset an uncertain supplier email.", "forbidden");
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const lookup = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE }, select: { parentTaskId: true, input: true } });
    if (!lookup?.parentTaskId) throw new SupplyPersistenceError("Supplier email action was not found.", "not_found");
    const draftId = requiredText(record(lookup.input).draftId, "Supplier email draft ID", 220);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${lookup.parentTaskId}, ${draftId}, ${args.actionId}) AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const action = await tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE, status: "RUNNING" }, select: communicationTaskSelect });
    if (!action || record(action.result).state !== "NOT_FOUND_REVIEW_REQUIRED") throw new SupplyPersistenceError("A supplier email awaiting non-delivery review was not found.", "conflict");
    const now = new Date();
    const result = { ...record(action.result), state: "RETRY_READY", recovery: { confirmedNotSent: true, note, confirmedByUserId: args.context.userId, confirmedAt: now.toISOString() } };
    const updated = await tx.supplyExecutionTask.update({ where: { id: action.id }, data: { result: inputJson(result), resultHash: digest(result), error: Prisma.DbNull }, select: communicationTaskSelect });
    await appendEvent({ tx, taskId: action.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: "SUPPLIER_EMAIL_RETRY_ENABLED", status: "READY", message: "An operator confirmed non-delivery and enabled one new send attempt.", payload: inputJson(result.recovery) });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier email recovery changed concurrently. Reload and retry.");
}
