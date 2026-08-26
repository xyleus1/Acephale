import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { CONNECTED_GMAIL_ACCOUNT_FILTER } from "@/lib/email-account-connection";
import type { ProcurementConversation } from "@/lib/procurement-conversation-model";
import { ProcurementReplySenderUnavailableError } from "@/lib/procurement-reply-errors";
import {
  getProcurementCommunicationMessages,
  type ProcurementOrderDetail,
  type ProcurementOrderVendor,
} from "@/lib/procurement-workflow";
import { prisma } from "@/lib/prisma";
import { requireSupplyWorkspace, SupplyPersistenceError, type SupplyAccessContext } from "@/lib/supply-os/persistence";
import {
  appendSupplierCommunicationEvent,
  currentAccessContext,
  digest,
  inputJson,
  messageBody,
  record,
  requiredText,
  singleEmail,
  withSerializableRetry,
} from "@/lib/supply-os/supplier-communication-shared";
import { procurementRequestDocuments } from "@/lib/procurement-file-delivery-draft";
import {
  baseContentType,
  outboundAttachmentMetadataJson,
  sanitizeAttachmentFilename,
  type OutboundEmailAttachment,
} from "@/lib/outbound-email-attachments";
import { loadRequestDocumentAttachments } from "@/lib/supply-os/request-document-attachments";
import {
  gmailSupplierEmailProvider,
  type SupplierEmailProvider,
  type SupplierEmailSendResult,
  type SupplierEmailSent,
} from "@/lib/supply-os/supplier-email-provider";

export const PROCUREMENT_REPLY_EMAIL_TASK_TYPE = "PROCUREMENT_SUPPLIER_REPLY_EMAIL";

export type ProcurementReplySendInput = {
  sourceMessageId: string;
  recipient: string;
  subject: string;
  body: string;
  attachmentDocumentIds?: readonly string[];
};

export type ProcurementReplyDelivery = {
  state: "SENT";
  accountEmail: string;
  recipient: string;
  providerMessageId: string;
  providerThreadId: string;
  sourceUrl: string;
  sentAt: string;
  alreadySent: boolean;
};

type ReplyAnchor = {
  accountEmail: string;
  recipient: string;
  providerThreadId: string | null;
  inReplyToRfcMessageId: string | null;
  localThreadId: string | null;
};

type SendDependencies = {
  communicationMessages: typeof getProcurementCommunicationMessages;
  provider: SupplierEmailProvider;
  requestDocumentAttachments: typeof loadRequestDocumentAttachments;
};

const defaultDependencies: SendDependencies = {
  communicationMessages: getProcurementCommunicationMessages,
  provider: gmailSupplierEmailProvider,
  requestDocumentAttachments: loadRequestDocumentAttachments,
};

function requestWorkspaceId(order: ProcurementOrderDetail) {
  const source = record(record(order.requestContext).source);
  const workspaceId = typeof source.workspace_id === "string" ? source.workspace_id.trim() : "";
  if (!workspaceId) {
    throw new SupplyPersistenceError("This sourcing request is not linked to a Derya workspace, so supplier sending is blocked.", "conflict");
  }
  return workspaceId;
}

function normalizeInput(input: ProcurementReplySendInput) {
  return {
    sourceMessageId: requiredText(input.sourceMessageId, "Displayed supplier message", 512),
    recipient: singleEmail(input.recipient, "Supplier recipient"),
    subject: requiredText(input.subject, "Email subject", 180),
    body: messageBody(input.body),
  };
}

// Only files already stored against this request and company can be attached.
// Operator input is limited to choosing among those document ids. Identity is
// resolved from the request itself, without reading storage, so the delivery
// claim and its message hash do not depend on a storage read.
function plannedReplyAttachments(args: {
  companyId: string | null;
  order: ProcurementOrderDetail;
  requestedDocumentIds: readonly string[];
}) {
  if (!args.requestedDocumentIds.length) return [];
  if (!args.companyId) {
    throw new SupplyPersistenceError("This sourcing request is not linked to a company profile, so its files cannot be attached.", "conflict");
  }
  const documents = new Map(procurementRequestDocuments(args.order).map((document) => [document.documentId, document.name]));
  const requested = [...new Set(args.requestedDocumentIds)];
  return requested.map((documentId) => {
    const name = documents.get(documentId);
    if (!name) {
      throw new SupplyPersistenceError("A selected file does not belong to this sourcing request.", "invalid_input");
    }
    return { documentId, name: sanitizeAttachmentFilename(name) };
  });
}

// Bytes are loaded and screened after the delivery claim, so a storage failure
// cannot block reconciliation of a send whose outcome is still unknown.
async function loadReplyAttachments(args: {
  officeId: string;
  companyId: string;
  documentIds: readonly string[];
  load: typeof loadRequestDocumentAttachments;
}) {
  const selection = await args.load({
    officeId: args.officeId,
    companyId: args.companyId,
    documentIds: args.documentIds,
  });
  if (selection.attachments.length !== args.documentIds.length) {
    const reason = selection.skipped[0]?.reason ?? "a selected file is unavailable";
    throw new SupplyPersistenceError(`The reply was not sent because ${reason}.`, "conflict");
  }
  return selection.attachments;
}

function storedAttachmentsJson(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  return JSON.stringify(value.map((entry) => {
    const attachment = record(entry);
    const mimeType = baseContentType(String(attachment.mimeType ?? ""));
    const size = Number(attachment.size ?? 0);
    const name = sanitizeAttachmentFilename(String(attachment.name ?? ""));
    // A reconciled delivery may only know which files it carried, not their
    // exact bytes, so the type and size stay out rather than reading as zero.
    return mimeType && size > 0 ? { name, mimeType, size } : { name };
  }));
}

function requireCurrentInbound(args: {
  conversation: ProcurementConversation;
  vendor: ProcurementOrderVendor;
  sourceMessageId: string;
}) {
  const latest = args.conversation.messages.at(-1);
  if (!args.conversation.available || !latest || latest.direction !== "INBOUND") {
    throw new SupplyPersistenceError("The latest supplier message is not awaiting a reply. Refresh the conversation before sending.", "conflict");
  }
  if (latest.id !== args.sourceMessageId) {
    throw new SupplyPersistenceError("A newer supplier message arrived. Review the refreshed conversation before sending.", "conflict");
  }
  const expectedSupplier = args.vendor.contact?.email?.trim().toLowerCase() ?? null;
  if (args.conversation.source !== "BOURNE_LEDGER" && (!expectedSupplier || latest.fromEmail.trim().toLowerCase() !== expectedSupplier)) {
    throw new SupplyPersistenceError("The supplier sender could not be verified for this thread.", "conflict");
  }
  return latest;
}

async function resolveReplyAnchor(args: {
  officeId: string;
  customerId: string;
  orderId: string;
  vendorId: string;
  conversation: ProcurementConversation;
  sourceMessageId: string;
  communicationMessages: typeof getProcurementCommunicationMessages;
}): Promise<ReplyAnchor> {
  if (args.conversation.source === "BOURNE_LEDGER") {
    const messages = await args.communicationMessages(args.customerId, args.orderId, args.vendorId);
    const source = messages?.find((message) => message.id === args.sourceMessageId) ?? null;
    if (!source || source.direction !== "INBOUND" || source.provider !== "GMAIL") {
      throw new SupplyPersistenceError("The exact Gmail reply receipt is missing from the supplier communication ledger.", "conflict");
    }
    return {
      accountEmail: singleEmail(source.accountEmail, "Connected Gmail sender"),
      recipient: singleEmail(source.fromEmail, "Supplier recipient"),
      providerThreadId: source.providerThreadId,
      inReplyToRfcMessageId: source.rfcMessageId ?? null,
      localThreadId: null,
    };
  }

  if (args.conversation.source === "DERYA_EMAIL_RECORD") {
    const source = await prisma.emailMessage.findFirst({
      where: {
        id: args.sourceMessageId,
        direction: "INBOUND",
        thread: { officeId: args.officeId },
      },
      select: {
        fromEmail: true,
        rfcMessageId: true,
        threadId: true,
        account: { select: { email: true } },
        thread: { select: { externalThreadId: true } },
      },
    });
    const accountEmail = source?.account?.email ?? args.conversation.accountEmail;
    if (!source || !accountEmail) {
      throw new SupplyPersistenceError("The exact connected Gmail reply is not stored in Derya. Sync the inbox before sending.", "conflict");
    }
    return {
      accountEmail: singleEmail(accountEmail, "Connected Gmail sender"),
      recipient: singleEmail(source.fromEmail, "Supplier recipient"),
      providerThreadId: source.thread.externalThreadId,
      inReplyToRfcMessageId: source.rfcMessageId,
      localThreadId: source.threadId,
    };
  }

  throw new SupplyPersistenceError("Sync this Gmail thread into Derya before sending a supplier reply.", "conflict");
}

function deliveryFromTask(task: { input: unknown; result: unknown }, alreadySent: boolean): ProcurementReplyDelivery {
  const input = record(task.input);
  const message = record(input.message);
  const result = record(task.result);
  return {
    state: "SENT",
    accountEmail: requiredText(message.senderEmail, "Stored Gmail sender", 320),
    recipient: requiredText(message.recipient, "Stored supplier recipient", 320),
    providerMessageId: requiredText(result.providerMessageId, "Stored provider message", 1_000),
    providerThreadId: requiredText(result.providerThreadId, "Stored provider thread", 1_000),
    sourceUrl: requiredText(result.sourceUrl, "Stored Gmail URL", 2_000),
    sentAt: requiredText(result.sentAt, "Stored sent time", 100),
    alreadySent,
  };
}

async function finalizeSent(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  taskId: string;
  receipt: SupplierEmailSent;
  rfcMessageId: string;
  deliveredAttachments?: readonly OutboundEmailAttachment[];
}) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.taskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
    const task = await tx.supplyExecutionTask.findFirst({
      where: {
        id: args.taskId,
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
      },
      select: { id: true, status: true, input: true, result: true },
    });
    if (!task) throw new SupplyPersistenceError("The supplier reply delivery record was not found.", "not_found");
    if (task.status === "SUCCEEDED") return deliveryFromTask(task, true);
    const currentResult = record(task.result);
    if (currentResult.rfcMessageId !== args.rfcMessageId || !["SENDING", "DELIVERY_UNKNOWN"].includes(String(currentResult.state))) {
      throw new SupplyPersistenceError("Supplier reply delivery changed concurrently. Refresh before retrying.", "conflict");
    }

    const message = record(record(task.input).message);
    const senderEmail = requiredText(message.senderEmail, "Stored Gmail sender", 320);
    const recipient = requiredText(message.recipient, "Stored supplier recipient", 320);
    const subject = requiredText(message.subject, "Stored email subject", 180);
    const now = new Date();
    const existingMessage = await tx.emailMessage.findFirst({
      where: {
        thread: { officeId: args.context.officeId },
        OR: [{ gmailMessageId: args.receipt.providerMessageId }, { externalId: args.rfcMessageId }],
      },
      select: { threadId: true },
    });
    let localThreadId = existingMessage?.threadId ?? null;
    if (!localThreadId) {
      const preferredThreadId = typeof record(task.input).localThreadId === "string"
        ? String(record(task.input).localThreadId)
        : null;
      const thread = preferredThreadId
        ? await tx.emailThread.findFirst({ where: { id: preferredThreadId, officeId: args.context.officeId } })
        : await tx.emailThread.findFirst({
            where: { officeId: args.context.officeId, externalThreadId: args.receipt.providerThreadId },
            orderBy: { updatedAt: "desc" },
          });
      if (thread) {
        localThreadId = thread.id;
        await tx.emailThread.update({
          where: { id: thread.id },
          data: {
            externalThreadId: args.receipt.providerThreadId,
            subject,
            lastMessageAt: now,
            messageCount: { increment: 1 },
          },
        });
      } else {
        const created = await tx.emailThread.create({
          data: {
            officeId: args.context.officeId,
            subject,
            participants: JSON.stringify([senderEmail, recipient]),
            externalThreadId: args.receipt.providerThreadId,
            lastMessageAt: now,
            messageCount: 1,
          },
        });
        localThreadId = created.id;
      }
      await tx.emailMessage.create({
        data: {
          threadId: localThreadId,
          accountId: requiredText(message.senderAccountId, "Stored sender account", 220),
          externalId: args.rfcMessageId,
          gmailMessageId: args.receipt.providerMessageId,
          rfcMessageId: args.rfcMessageId,
          direction: "OUTBOUND",
          fromEmail: senderEmail,
          toEmails: JSON.stringify([recipient]),
          subject,
          bodyText: messageBody(message.body),
          attachments: args.deliveredAttachments?.length
            ? outboundAttachmentMetadataJson(args.deliveredAttachments)
            : storedAttachmentsJson(message.attachments),
          sentAt: now,
        },
      });
    }

    const result = {
      state: "SENT",
      rfcMessageId: args.rfcMessageId,
      provider: args.receipt.provider,
      providerMessageId: args.receipt.providerMessageId,
      providerThreadId: args.receipt.providerThreadId,
      sourceUrl: args.receipt.sourceUrl,
      localThreadId,
      sentAt: now.toISOString(),
    };
    const updated = await tx.supplyExecutionTask.update({
      where: { id: task.id },
      data: {
        status: "SUCCEEDED",
        result: inputJson(result),
        resultHash: digest(result),
        completedAt: now,
        error: Prisma.DbNull,
      },
      select: { input: true, result: true },
    });
    await appendSupplierCommunicationEvent({
      tx,
      taskId: task.id,
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      actorUserId: args.context.userId,
      eventType: "PROCUREMENT_SUPPLIER_REPLY_SENT",
      status: "SUCCEEDED",
      message: "Gmail returned a supplier reply delivery receipt.",
      payload: inputJson(result),
    });
    return deliveryFromTask(updated, false);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier reply delivery changed concurrently. Refresh before retrying.");
}

async function recordNonDelivery(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  taskId: string;
  rfcMessageId: string;
  receipt: Exclude<SupplierEmailSendResult, SupplierEmailSent>;
}) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.taskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
    const task = await tx.supplyExecutionTask.findFirst({
      where: { id: args.taskId, officeId: args.context.officeId, workspaceId: args.workspaceId, taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE },
      select: { id: true, result: true },
    });
    if (!task) throw new SupplyPersistenceError("The supplier reply delivery record was not found.", "not_found");
    if (record(task.result).rfcMessageId !== args.rfcMessageId) {
      throw new SupplyPersistenceError("Supplier reply delivery changed concurrently. Refresh before retrying.", "conflict");
    }
    const unknown = args.receipt.state === "UNKNOWN";
    const result = {
      ...record(task.result),
      state: unknown ? "DELIVERY_UNKNOWN" : "SEND_FAILED",
      error: args.receipt.error,
      needsReauth: args.receipt.needsReauth ?? false,
      updatedAt: new Date().toISOString(),
    };
    await tx.supplyExecutionTask.update({
      where: { id: task.id },
      data: {
        status: unknown ? "RUNNING" : "FAILED",
        result: inputJson(result),
        resultHash: digest(result),
        error: inputJson({ message: args.receipt.error, state: result.state }),
        ...(unknown ? {} : { failedAt: new Date() }),
      },
    });
    await appendSupplierCommunicationEvent({
      tx,
      taskId: task.id,
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      actorUserId: args.context.userId,
      eventType: unknown ? "PROCUREMENT_SUPPLIER_REPLY_DELIVERY_UNKNOWN" : "PROCUREMENT_SUPPLIER_REPLY_REJECTED",
      status: unknown ? "RUNNING" : "FAILED",
      message: unknown
        ? "Gmail delivery is unknown. Another send is blocked until reconciliation."
        : "Gmail rejected the supplier reply before returning a delivery receipt.",
      payload: inputJson(result),
    });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier reply delivery changed concurrently. Refresh before retrying.");
}

export async function sendProcurementSupplierReply(args: {
  context: SupplyAccessContext;
  customerId: string;
  order: ProcurementOrderDetail;
  vendor: ProcurementOrderVendor;
  conversation: ProcurementConversation;
  input: ProcurementReplySendInput;
  dependencies?: Partial<SendDependencies>;
}): Promise<ProcurementReplyDelivery> {
  const dependencies = { ...defaultDependencies, ...args.dependencies };
  const access = await currentAccessContext(args.context);
  const workspaceId = requestWorkspaceId(args.order);
  const workspace = await requireSupplyWorkspace(access, workspaceId, "edit");
  const input = normalizeInput(args.input);
  const plannedAttachments = plannedReplyAttachments({
    companyId: workspace.companyId,
    order: args.order,
    requestedDocumentIds: args.input.attachmentDocumentIds ?? [],
  });
  const inbound = requireCurrentInbound({
    conversation: args.conversation,
    vendor: args.vendor,
    sourceMessageId: input.sourceMessageId,
  });
  const anchor = await resolveReplyAnchor({
    officeId: access.officeId,
    customerId: args.customerId,
    orderId: args.order.id,
    vendorId: args.vendor.id,
    conversation: args.conversation,
    sourceMessageId: input.sourceMessageId,
    communicationMessages: dependencies.communicationMessages,
  });
  if (input.recipient !== anchor.recipient || inbound.fromEmail.trim().toLowerCase() !== anchor.recipient) {
    throw new SupplyPersistenceError("The supplier recipient changed. Refresh and generate a new reply draft.", "conflict");
  }
  const sender = await prisma.emailAccount.findFirst({
    where: {
      officeId: access.officeId,
      email: { equals: anchor.accountEmail, mode: "insensitive" },
      isActive: true,
      sendEnabled: true,
      ...CONNECTED_GMAIL_ACCOUNT_FILTER,
    },
    select: { id: true, email: true },
  });
  if (!sender) {
    throw new ProcurementReplySenderUnavailableError(anchor.accountEmail);
  }

  const message = {
    senderAccountId: sender.id,
    senderEmail: sender.email.trim().toLowerCase(),
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    // Only a reply that carries files adds this key, so an attachment free
    // reply keeps the hash it had before attachments existed and a delivery
    // left unresolved across the deploy can still be reconciled.
    ...(plannedAttachments.length ? { attachments: plannedAttachments } : {}),
  };
  const messageHash = digest(message);
  const sourceHash = createHash("sha256").update(input.sourceMessageId).digest("hex").slice(0, 20);
  const taskScopeKey = `procurement-reply:${args.order.id}:${args.vendor.id}:${sourceHash}`;
  const claimed = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${taskScopeKey}`}, 0))) AS reply_lock`);
    const existing = await tx.supplyExecutionTask.findFirst({
      where: {
        workspaceId,
        taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
        taskKey: { startsWith: `${taskScopeKey}:` },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, officeId: true, status: true, input: true, result: true },
    });
    if (existing && existing.officeId !== access.officeId) {
      throw new SupplyPersistenceError("The supplier reply delivery scope conflicts with another office.", "conflict");
    }
    const existingInput = record(existing?.input);
    const existingResult = record(existing?.result);
    if (existing && existingInput.messageHash !== messageHash) {
      throw new SupplyPersistenceError("A different reply attempt already exists for this supplier message. Refresh before retrying.", "conflict");
    }
    if (existing?.status === "SUCCEEDED") return { sent: deliveryFromTask(existing, true), taskId: null, rfcMessageId: null, reconcile: false };
    if (existing && existing.status === "RUNNING") {
      return {
        sent: null,
        taskId: existing.id,
        rfcMessageId: requiredText(existingResult.rfcMessageId, "Stored supplier reply message ID", 500),
        reconcile: true,
      };
    }
    if (existing && existing.status !== "FAILED") {
      throw new SupplyPersistenceError("A supplier reply for this message is already being handled. Refresh before retrying.", "conflict");
    }
    const taskId = randomUUID();
    const attempt = typeof existingResult.attempt === "number" ? existingResult.attempt + 1 : 1;
    const rfcMessageId = `<procurement-reply-${taskId}-${attempt}@derya.ai>`;
    const taskKey = `${taskScopeKey}:${attempt}`;
    const taskInput = {
      customerId: args.customerId,
      orderId: args.order.id,
      vendorId: args.vendor.id,
      sourceMessageId: input.sourceMessageId,
      source: args.conversation.source,
      message,
      messageHash,
      providerThreadId: anchor.providerThreadId,
      inReplyToRfcMessageId: anchor.inReplyToRfcMessageId,
      localThreadId: anchor.localThreadId,
      operatorConfirmation: {
        confirmed: true,
        userId: access.userId,
        confirmedAt: new Date().toISOString(),
      },
    };
    const planned = { state: "PLANNED", attempt, rfcMessageId };
    const sending = { state: "SENDING", attempt, rfcMessageId, startedAt: new Date().toISOString() };
    await tx.supplyExecutionTask.create({
      data: {
        id: taskId,
        officeId: access.officeId,
        workspaceId,
        createdByUserId: access.userId,
        taskKey,
        taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
        capabilityKey: "reply.procurement_supplier_email",
        status: "PLANNED",
        requiresApproval: false,
        input: inputJson(taskInput),
        inputHash: digest(taskInput),
        result: inputJson(planned),
        resultHash: digest(planned),
        externalSystem: "GMAIL",
        idempotencyKey: taskKey,
      },
    });
    await tx.supplyExecutionTask.update({ where: { id: taskId }, data: { status: "READY" } });
    await tx.supplyExecutionTask.update({
      where: { id: taskId },
      data: {
        status: "RUNNING",
        result: inputJson(sending),
        resultHash: digest(sending),
        startedAt: new Date(),
      },
    });
    await appendSupplierCommunicationEvent({
      tx,
      taskId,
      officeId: access.officeId,
      workspaceId,
      actorUserId: access.userId,
      eventType: "PROCUREMENT_SUPPLIER_REPLY_SEND_STARTED",
      status: "RUNNING",
      message: "An operator confirmed supplier reply delivery through connected Gmail.",
      payload: inputJson({ orderId: args.order.id, vendorId: args.vendor.id, sourceMessageId: input.sourceMessageId, messageHash, attempt, rfcMessageId }),
    });
    return { sent: null, taskId, rfcMessageId, reconcile: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier reply delivery changed concurrently. Refresh before retrying.");

  if (claimed.sent) return claimed.sent;
  if (!claimed.taskId || !claimed.rfcMessageId) {
    throw new SupplyPersistenceError("The supplier reply delivery claim is incomplete.", "conflict");
  }
  if (claimed.reconcile) {
    // Reconciliation asks Gmail what happened to a message that was already
    // handed over, so it must never depend on reading the files again.
    const reconciled = await dependencies.provider.reconcile({
      officeId: access.officeId,
      accountId: sender.id,
      senderEmail: message.senderEmail,
      rfcMessageId: claimed.rfcMessageId,
    });
    if (reconciled.state === "SENT") {
      return finalizeSent({ context: access, workspaceId, taskId: claimed.taskId, receipt: reconciled, rfcMessageId: claimed.rfcMessageId });
    }
    throw new SupplyPersistenceError("Gmail delivery is still unresolved. Check Sent Mail before attempting another reply.", "conflict");
  }

  // The claim already marked this attempt RUNNING, so a file that cannot be read
  // or screened has to fail the attempt. Leaving it RUNNING would send the
  // operator into reconciliation for a message Gmail never saw.
  let attachments: readonly OutboundEmailAttachment[] = [];
  try {
    attachments = plannedAttachments.length && workspace.companyId
      ? await loadReplyAttachments({
        officeId: access.officeId,
        companyId: workspace.companyId,
        documentIds: plannedAttachments.map((attachment) => attachment.documentId),
        load: dependencies.requestDocumentAttachments,
      })
      : [];
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The selected files could not be prepared.";
    await recordNonDelivery({
      context: access,
      workspaceId,
      taskId: claimed.taskId,
      rfcMessageId: claimed.rfcMessageId,
      receipt: { state: "REJECTED", error: reason },
    });
    throw error instanceof SupplyPersistenceError ? error : new SupplyPersistenceError(reason, "conflict");
  }
  const receipt = await dependencies.provider.send({
    officeId: access.officeId,
    accountId: sender.id,
    senderEmail: message.senderEmail,
    recipient: message.recipient,
    subject: message.subject,
    body: message.body,
    rfcMessageId: claimed.rfcMessageId,
    providerThreadId: anchor.providerThreadId,
    inReplyToRfcMessageId: anchor.inReplyToRfcMessageId,
    attachments,
  });
  if (receipt.state === "SENT") {
    return finalizeSent({
      context: access,
      workspaceId,
      taskId: claimed.taskId,
      receipt,
      rfcMessageId: claimed.rfcMessageId,
      deliveredAttachments: attachments,
    });
  }
  await recordNonDelivery({ context: access, workspaceId, taskId: claimed.taskId, rfcMessageId: claimed.rfcMessageId, receipt });
  throw new SupplyPersistenceError(receipt.error, "conflict");
}
