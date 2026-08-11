import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import { sourcingSystemWorkspace } from "./sourcing-research-persistence";
import { SUPPLIER_EMAIL_ACTION_TASK_TYPE } from "./supplier-communication-persistence";
import { PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE } from "./purchase-order-communication-persistence";
import { PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE } from "./purchase-order-followup-persistence";

const QUOTE_CYCLE_TASK_TYPE = "SUPPLIER_QUOTE_CYCLE";
const PROCUREMENT_CASE_TASK_TYPE = "PROCUREMENT_CASE";
const PURCHASE_ACTION_TASK_TYPE = "PURCHASE_ORDER_ACTION";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function inputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function retryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (
    error.code === "P2002"
    || error.code === "P2034"
    || (error.code === "P2010" && ["40001", "40P01"].includes(String(record(error.meta).code)))
  );
}

async function withSerializableRetry<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) throw new SupplyPersistenceError("Connected supplier replies changed concurrently. Reload and retry.", "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Connected supplier replies could not be saved.", "conflict");
}

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== "string") throw new SupplyPersistenceError(`${label} is required.`, "invalid_input");
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > max) throw new SupplyPersistenceError(`${label} must contain 1 to ${max} characters.`, "invalid_input");
  return normalized;
}

function parseAttachments(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 25).flatMap((entry) => {
      const attachment = record(entry);
      const name = typeof attachment.filename === "string"
        ? attachment.filename
        : typeof attachment.name === "string"
          ? attachment.name
          : null;
      if (!name) return [];
      return [{
        name: name.slice(0, 300),
        mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType.slice(0, 160) : null,
        size: typeof attachment.size === "number" && Number.isFinite(attachment.size) ? attachment.size : null,
      }];
    });
  } catch {
    return [];
  }
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

export type SupplierReplySync = (input: { accountId: string; officeId: string; query: string }) => Promise<
  | { ok: true; processed: number; created: number; threadsTouched: number }
  | { error: string }
>;

async function syncConnectedAccount(input: { accountId: string; officeId: string; query: string }) {
  const { syncEmailAccountWindowInternal } = await import("@/lib/gmail-sync");
  return syncEmailAccountWindowInternal({
    accountId: input.accountId,
    officeId: input.officeId,
    query: input.query,
    threadFetchLimit: 5,
  });
}

export async function captureConnectedSupplierReplies(args: {
  context: SupplyAccessContext;
  quoteCycleId: string;
  sync?: SupplierReplySync;
}) {
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  const cycle = await prisma.supplyExecutionTask.findFirst({
    where: {
      id: args.quoteCycleId,
      officeId: args.context.officeId,
      workspaceId: workspace.id,
      taskType: QUOTE_CYCLE_TASK_TYPE,
      status: "RUNNING",
    },
    select: {
      id: true,
      parentTaskId: true,
      childTasks: {
        where: { taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE, status: "SUCCEEDED", externalSystem: "GMAIL" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true, input: true, result: true },
      },
    },
  });
  const action = cycle?.childTasks[0];
  if (!cycle?.parentTaskId || !action) {
    throw new SupplyPersistenceError("A delivered connected Gmail quote request was not found.", "conflict");
  }
  const actionInput = record(action.input);
  const actionResult = record(action.result);
  const message = record(actionInput.message);
  if (actionResult.state !== "SENT") throw new SupplyPersistenceError("The connected supplier email has no final delivery receipt.", "conflict");
  const senderAccountId = requiredText(message.senderAccountId, "Connected sender account", 220);
  const senderEmail = requiredText(message.senderEmail, "Approved sender email", 320).toLowerCase();
  const supplierEmail = requiredText(message.recipient, "Approved supplier email", 320).toLowerCase();
  const localThreadId = requiredText(actionResult.localThreadId, "Connected email thread", 220);
  const rfcMessageId = requiredText(actionResult.rfcMessageId, "Connected email message ID", 500);
  const sentAt = new Date(requiredText(actionResult.sentAt, "Connected email sent time", 100));
  if (Number.isNaN(sentAt.getTime())) throw new SupplyPersistenceError("The connected email delivery time is invalid.", "conflict");
  const senderAccount = await prisma.emailAccount.findFirst({
    where: {
      id: senderAccountId,
      officeId: args.context.officeId,
      provider: "GMAIL",
      isActive: true,
      OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
    },
    select: { email: true },
  });
  if (!senderAccount || senderAccount.email.trim().toLowerCase() !== senderEmail) {
    throw new SupplyPersistenceError("The approved Gmail sender changed, disconnected, or became inactive.", "conflict");
  }

  const syncResult = await (args.sync ?? syncConnectedAccount)({
    accountId: senderAccountId,
    officeId: args.context.officeId,
    query: `rfc822msgid:${rfcMessageId}`,
  });
  if ("error" in syncResult) throw new SupplyPersistenceError(`Connected Gmail sync failed: ${syncResult.error}`, "conflict");
  if (syncResult.threadsTouched < 1) {
    throw new SupplyPersistenceError("Connected Gmail did not return the delivered quote-request thread. Retry after checking the sender connection.", "conflict");
  }

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${cycle.parentTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" IN (${cycle.id}, ${action.id}) AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    const [currentCase, currentCycle, currentAction] = await Promise.all([
      tx.supplyExecutionTask.findFirst({ where: { id: cycle.parentTaskId!, officeId: args.context.officeId, workspaceId: workspace.id, taskType: PROCUREMENT_CASE_TASK_TYPE, status: "PLANNED" } }),
      tx.supplyExecutionTask.findFirst({ where: { id: cycle.id, officeId: args.context.officeId, workspaceId: workspace.id, taskType: QUOTE_CYCLE_TASK_TYPE, status: "RUNNING" } }),
      tx.supplyExecutionTask.findFirst({ where: { id: action.id, officeId: args.context.officeId, workspaceId: workspace.id, taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE, status: "SUCCEEDED" } }),
    ]);
    if (!currentCase || !currentCycle || !currentAction || record(currentAction.result).state !== "SENT") {
      throw new SupplyPersistenceError("The connected quote cycle changed during inbox sync. Reload and retry.", "conflict");
    }
    const inbound = await tx.emailMessage.findMany({
      where: {
        threadId: localThreadId,
        accountId: senderAccountId,
        thread: { officeId: args.context.officeId },
        direction: "INBOUND",
        sentAt: { gte: sentAt },
      },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      select: { id: true, externalId: true, gmailMessageId: true, fromEmail: true, fromName: true, subject: true, bodyText: true, attachments: true, sentAt: true },
    });
    const matching = inbound.filter((entry) => entry.fromEmail.trim().toLowerCase() === supplierEmail);
    const cycleResult = record(currentCycle.result);
    const existingReplies = Array.isArray(cycleResult.connectedReplies)
      ? cycleResult.connectedReplies.map((entry) => record(entry))
      : [];
    const knownSourceIds = new Set(existingReplies.flatMap((entry) => typeof entry.sourceRecordId === "string" ? [entry.sourceRecordId] : []));
    const sourceUrl = requiredText(record(currentAction.result).sourceUrl, "Connected Gmail evidence URL", 2_000);
    const captured = [] as Record<string, unknown>[];

    for (const email of matching) {
      const sourceRecordId = email.gmailMessageId ?? email.externalId ?? `local:${email.id}`;
      if (knownSourceIds.has(sourceRecordId)) continue;
      const attachments = parseAttachments(email.attachments);
      const evidencePayload = {
        localMessageId: email.id,
        providerMessageId: email.gmailMessageId,
        externalMessageId: email.externalId,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        subject: email.subject,
        bodyText: (email.bodyText ?? "").slice(0, 50_000),
        attachments,
        receivedAt: email.sentAt.toISOString(),
      };
      const contentHash = digest(evidencePayload);
      const evidenceKey = `supplier_quote_reply:${currentCycle.id}:${sourceRecordId}`;
      const existingEvidence = await tx.supplyEvidence.findUnique({
        where: { workspaceId_evidenceKey: { workspaceId: workspace.id, evidenceKey } },
        select: { id: true, officeId: true, executionTaskId: true, sourceRecordId: true, contentHash: true },
      });
      if (existingEvidence && (
        existingEvidence.officeId !== args.context.officeId
        || existingEvidence.executionTaskId !== currentCycle.id
        || existingEvidence.sourceRecordId !== sourceRecordId
        || existingEvidence.contentHash !== contentHash
      )) throw new SupplyPersistenceError("Connected supplier reply evidence conflicts with an existing record.", "conflict");
      const evidence = existingEvidence ?? await tx.supplyEvidence.create({
        data: {
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          executionTaskId: currentCycle.id,
          createdByUserId: args.context.userId,
          evidenceKey,
          kind: "SUPPLIER_QUOTE_REPLY_EMAIL",
          sourceType: "CONNECTED_PROVIDER",
          sourceUri: sourceUrl,
          sourceRecordId,
          sourceVersion: contentHash,
          title: `Supplier reply from ${email.fromEmail}`,
          excerpt: (email.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || null,
          payload: inputJson(evidencePayload),
          contentHash,
          observedAt: email.sentAt,
        },
        select: { id: true },
      });
      const reply = {
        evidenceId: evidence.id,
        evidenceClass: "CONNECTED_PROVIDER",
        sourceRecordId,
        localMessageId: email.id,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        subject: email.subject,
        excerpt: (email.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 2_000),
        attachments,
        receivedAt: email.sentAt.toISOString(),
        sourceUrl,
        reviewState: "REVIEW_REQUIRED",
      };
      captured.push(reply);
      knownSourceIds.add(sourceRecordId);
    }
    const now = new Date();
    if (!captured.length) {
      const checkedResult = { ...cycleResult, lastReplySyncAt: now.toISOString(), updatedAt: now.toISOString() };
      const checkedCycle = await tx.supplyExecutionTask.update({
        where: { id: currentCycle.id },
        data: { result: inputJson(checkedResult), resultHash: digest(checkedResult) },
      });
      return { captured: 0, total: existingReplies.length, quoteCycle: checkedCycle };
    }

    const connectedReplies = [...existingReplies, ...captured];
    const nextCycleResult = { ...cycleResult, connectedReplies, lastReplySyncAt: now.toISOString(), updatedAt: now.toISOString() };
    const updatedCycle = await tx.supplyExecutionTask.update({
      where: { id: currentCycle.id },
      data: { result: inputJson(nextCycleResult), resultHash: digest(nextCycleResult) },
    });
    const caseResult = record(currentCase.result);
    const projectedCycle = record(caseResult.quoteCycle);
    const nextCaseResult = {
      ...caseResult,
      quoteCycle: { ...projectedCycle, connectedReplyCount: connectedReplies.length, updatedAt: now.toISOString() },
      updatedAt: now.toISOString(),
    };
    await tx.supplyExecutionTask.update({ where: { id: currentCase.id }, data: { result: inputJson(nextCaseResult), resultHash: digest(nextCaseResult) } });
    const payload = inputJson({ quoteCycleId: currentCycle.id, captured: captured.map((reply) => ({ evidenceId: reply.evidenceId, sourceRecordId: reply.sourceRecordId })) });
    await appendEvent({ tx, taskId: currentCycle.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: "SUPPLIER_QUOTE_REPLIES_CAPTURED", status: "RUNNING", message: `${captured.length} connected supplier reply${captured.length === 1 ? " was" : " replies were"} captured for review.`, payload });
    await appendEvent({ tx, taskId: currentCase.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: "SUPPLIER_QUOTE_REPLIES_CAPTURED", status: "PLANNED", message: "Connected supplier replies are ready for commercial review.", payload });
    return { captured: captured.length, total: connectedReplies.length, quoteCycle: updatedCycle };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function captureConnectedPurchaseOrderReplies(args: {
  context: SupplyAccessContext;
  purchaseActionId: string;
  sync?: SupplierReplySync;
}) {
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  const purchaseAction = await prisma.supplyExecutionTask.findFirst({
    where: {
      id: args.purchaseActionId,
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      taskType: PURCHASE_ACTION_TASK_TYPE,
      status: "RUNNING",
    },
    select: {
      id: true,
      parentTaskId: true,
      input: true,
      inputHash: true,
      result: true,
      parentTask: { select: { parentTaskId: true } },
    },
  });
  const purchaseDraftId = purchaseAction?.parentTaskId;
  const procurementCaseId = purchaseAction?.parentTask?.parentTaskId;
  const purchaseResult = record(purchaseAction?.result);
  const release = record(purchaseResult.release);
  if (!purchaseAction || !purchaseDraftId || !procurementCaseId
    || !["RELEASED", "PARTIALLY_ACKNOWLEDGED"].includes(String(purchaseResult.state))
    || typeof release.releaseHash !== "string") {
    throw new SupplyPersistenceError("A released purchase order awaiting supplier acknowledgment was not found.", "conflict");
  }

  const candidateActions = await prisma.supplyExecutionTask.findMany({
    where: {
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      parentTaskId: purchaseDraftId,
      taskType: { in: [PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE, PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE] },
      status: "SUCCEEDED",
      externalSystem: "GMAIL",
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, input: true, result: true },
  });
  const emailAction = candidateActions.find((candidate) => {
    const input = record(candidate.input);
    const result = record(candidate.result);
    return input.purchaseActionId === purchaseAction.id
      && input.purchaseActionScopeHash === purchaseAction.inputHash
      && result.releaseHash === release.releaseHash
      && result.state === "SENT";
  });
  if (!emailAction) throw new SupplyPersistenceError("A connected purchase order or follow-up delivery receipt was not found.", "conflict");

  const emailInput = record(emailAction.input);
  const emailResult = record(emailAction.result);
  const message = record(emailInput.message);
  const senderAccountId = requiredText(message.senderAccountId, "Connected sender account", 220);
  const senderEmail = requiredText(message.senderEmail, "Approved sender email", 320).toLowerCase();
  const supplierEmail = requiredText(message.recipient, "Approved supplier email", 320).toLowerCase();
  const localThreadId = requiredText(emailResult.localThreadId, "Connected purchase order thread", 220);
  const rfcMessageId = requiredText(emailResult.rfcMessageId, "Connected purchase order message ID", 500);
  const sentAt = new Date(requiredText(emailResult.sentAt, "Connected purchase order sent time", 100));
  if (Number.isNaN(sentAt.getTime())) throw new SupplyPersistenceError("The connected purchase order delivery time is invalid.", "conflict");
  const senderAccount = await prisma.emailAccount.findFirst({
    where: {
      id: senderAccountId,
      officeId: accessContext.officeId,
      provider: "GMAIL",
      isActive: true,
      OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
    },
    select: { email: true },
  });
  if (!senderAccount || senderAccount.email.trim().toLowerCase() !== senderEmail) {
    throw new SupplyPersistenceError("The approved Gmail sender changed, disconnected, or became inactive.", "conflict");
  }

  const syncResult = await (args.sync ?? syncConnectedAccount)({
    accountId: senderAccountId,
    officeId: accessContext.officeId,
    query: `rfc822msgid:${rfcMessageId}`,
  });
  if ("error" in syncResult) throw new SupplyPersistenceError(`Connected Gmail sync failed: ${syncResult.error}`, "conflict");
  if (syncResult.threadsTouched < 1) {
    throw new SupplyPersistenceError("Connected Gmail did not return the delivered purchase order thread. Retry after checking the sender connection.", "conflict");
  }

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${purchaseDraftId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${purchaseAction.id} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${emailAction.id} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    const [currentCase, currentPurchaseAction, currentEmailAction] = await Promise.all([
      tx.supplyExecutionTask.findFirst({ where: { id: procurementCaseId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PROCUREMENT_CASE_TASK_TYPE, status: "PLANNED" } }),
      tx.supplyExecutionTask.findFirst({ where: { id: purchaseAction.id, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PURCHASE_ACTION_TASK_TYPE, status: "RUNNING" } }),
      tx.supplyExecutionTask.findFirst({ where: { id: emailAction.id, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: { in: [PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE, PURCHASE_ORDER_FOLLOWUP_EMAIL_ACTION_TASK_TYPE] }, status: "SUCCEEDED" } }),
    ]);
    const currentResult = record(currentPurchaseAction?.result);
    const currentRelease = record(currentResult.release);
    if (!currentCase || !currentPurchaseAction || !currentEmailAction
      || !["RELEASED", "PARTIALLY_ACKNOWLEDGED"].includes(String(currentResult.state))
      || currentRelease.releaseHash !== release.releaseHash
      || record(currentEmailAction.result).releaseHash !== release.releaseHash
      || record(currentEmailAction.result).state !== "SENT") {
      throw new SupplyPersistenceError("The connected purchase order changed during inbox sync. Reload and retry.", "conflict");
    }
    const inbound = await tx.emailMessage.findMany({
      where: {
        threadId: localThreadId,
        accountId: senderAccountId,
        thread: { officeId: accessContext.officeId },
        direction: "INBOUND",
        sentAt: { gte: sentAt },
      },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      select: { id: true, externalId: true, gmailMessageId: true, fromEmail: true, fromName: true, subject: true, bodyText: true, attachments: true, sentAt: true },
    });
    const matching = inbound.filter((entry) => entry.fromEmail.trim().toLowerCase() === supplierEmail);
    const existingReplies = Array.isArray(currentResult.connectedAcknowledgmentReplies)
      ? currentResult.connectedAcknowledgmentReplies.map((entry) => record(entry))
      : [];
    const knownSourceIds = new Set(existingReplies.flatMap((entry) => typeof entry.sourceRecordId === "string" ? [entry.sourceRecordId] : []));
    const sourceUrl = requiredText(record(currentEmailAction.result).sourceUrl, "Connected Gmail evidence URL", 2_000);
    const captured = [] as Record<string, unknown>[];

    for (const email of matching) {
      const sourceRecordId = email.gmailMessageId ?? email.externalId ?? `local:${email.id}`;
      if (knownSourceIds.has(sourceRecordId)) continue;
      const attachments = parseAttachments(email.attachments);
      const evidencePayload = {
        purchaseActionId: currentPurchaseAction.id,
        purchaseOrderEmailActionId: currentEmailAction.id,
        purchaseOrderCommunicationActionId: currentEmailAction.id,
        releaseHash: currentRelease.releaseHash,
        localMessageId: email.id,
        providerMessageId: email.gmailMessageId,
        externalMessageId: email.externalId,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        subject: email.subject,
        bodyText: (email.bodyText ?? "").slice(0, 50_000),
        attachments,
        receivedAt: email.sentAt.toISOString(),
      };
      const contentHash = digest(evidencePayload);
      const evidenceKey = `supplier_order_reply:${currentPurchaseAction.id}:${sourceRecordId}`;
      const existingEvidence = await tx.supplyEvidence.findUnique({
        where: { workspaceId_evidenceKey: { workspaceId: workspace.id, evidenceKey } },
        select: { id: true, officeId: true, executionTaskId: true, sourceRecordId: true, contentHash: true },
      });
      if (existingEvidence && (
        existingEvidence.officeId !== accessContext.officeId
        || existingEvidence.executionTaskId !== currentPurchaseAction.id
        || existingEvidence.sourceRecordId !== sourceRecordId
        || existingEvidence.contentHash !== contentHash
      )) throw new SupplyPersistenceError("Connected supplier order reply evidence conflicts with an existing record.", "conflict");
      const evidence = existingEvidence ?? await tx.supplyEvidence.create({
        data: {
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          executionTaskId: currentPurchaseAction.id,
          createdByUserId: accessContext.userId,
          evidenceKey,
          kind: "SUPPLIER_ORDER_ACKNOWLEDGMENT_REPLY_EMAIL",
          sourceType: "CONNECTED_PROVIDER",
          sourceUri: sourceUrl,
          sourceRecordId,
          sourceVersion: contentHash,
          title: `Supplier order reply from ${email.fromEmail}`,
          excerpt: (email.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || null,
          payload: inputJson(evidencePayload),
          contentHash,
          observedAt: email.sentAt,
        },
        select: { id: true },
      });
      const reply = {
        evidenceId: evidence.id,
        evidenceClass: "CONNECTED_PROVIDER",
        sourceRecordId,
        localMessageId: email.id,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        subject: email.subject,
        excerpt: (email.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 2_000),
        attachments,
        receivedAt: email.sentAt.toISOString(),
        sourceUrl,
        reviewState: "REVIEW_REQUIRED",
      };
      captured.push(reply);
      knownSourceIds.add(sourceRecordId);
    }
    const now = new Date();
    const connectedAcknowledgmentReplies = [...existingReplies, ...captured];
    const unreviewedConnectedReplyCount = connectedAcknowledgmentReplies.filter((reply) => reply.reviewState === "REVIEW_REQUIRED").length;
    const nextResult = {
      ...currentResult,
      connectedAcknowledgmentReplies,
      lastAcknowledgmentSyncAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const updatedAction = await tx.supplyExecutionTask.update({
      where: { id: currentPurchaseAction.id },
      data: { result: inputJson(nextResult), resultHash: digest(nextResult) },
    });
    const caseResult = record(currentCase.result);
    const purchaseRelease = record(caseResult.purchaseRelease);
    const nextCaseResult = {
      ...caseResult,
      purchaseRelease: {
        ...purchaseRelease,
        connectedReplyCount: connectedAcknowledgmentReplies.length,
        unreviewedConnectedReplyCount,
        lastAcknowledgmentSyncAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      updatedAt: now.toISOString(),
    };
    await tx.supplyExecutionTask.update({ where: { id: currentCase.id }, data: { result: inputJson(nextCaseResult), resultHash: digest(nextCaseResult) } });
    if (captured.length) {
      const payload = inputJson({ purchaseActionId: currentPurchaseAction.id, captured: captured.map((reply) => ({ evidenceId: reply.evidenceId, sourceRecordId: reply.sourceRecordId })) });
      await appendEvent({ tx, taskId: currentPurchaseAction.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: "SUPPLIER_ORDER_REPLIES_CAPTURED", status: "RUNNING", message: `${captured.length} connected supplier order reply${captured.length === 1 ? " was" : " replies were"} captured for review.`, payload });
      await appendEvent({ tx, taskId: currentCase.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: "SUPPLIER_ORDER_REPLIES_CAPTURED", status: "PLANNED", message: "Connected supplier order replies are ready for acknowledgment review.", payload });
    }
    return { captured: captured.length, total: connectedAcknowledgmentReplies.length, purchaseAction: updatedAction };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
