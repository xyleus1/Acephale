import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { CONNECTED_GMAIL_ACCOUNT_FILTER } from "@/lib/email-account-connection";
import { SHARED_SENDER_POOL_FILTER } from "@/lib/email-account-pool";
import { listEmailSenderPoolAccounts } from "@/lib/email-sender-pool";
import { selectEmailSenderPoolCandidate } from "@/lib/email-sender-pool-policy";
import {
  procurementSupplierSenderVouched,
  type ProcurementConversation,
} from "@/lib/procurement-conversation-model";
import { supplierInboundNotice, supplierWrittenMessages } from "@/lib/procurement-inbound-triage";
import { ProcurementReplySenderUnavailableError } from "@/lib/procurement-reply-errors";
import { PROCUREMENT_REPLY_EMAIL_TASK_TYPE } from "@/lib/procurement-reply-record";
import { chasesSentAfterLastReply, supplierChaseDecision } from "@/lib/procurement-supplier-chase";
import {
  getProcurementCommunicationMessages,
  type ProcurementOrderDetail,
  type ProcurementOrderVendor,
} from "@/lib/procurement-workflow";
import { prisma } from "@/lib/prisma";
import { createProcurementVendorDraftStateRead } from "@/lib/procurement-state-runtime";
import { requireSupplyWorkspace, SupplyPersistenceError, type SupplyAccessContext } from "@/lib/supply-os/persistence";
import {
  assertProcurementVendorActionMatchesStatePacket,
  assertProcurementVendorStateReadBinding,
} from "@/lib/supply-os/state-runtime/autopilot";
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
import {
  summarizeSupplyStateConflict,
  validateSupplyStateAssertionForAction,
  validateSupplyStateReadForAction,
} from "@/lib/supply-os/state-runtime/enforcement";

export { PROCUREMENT_REPLY_EMAIL_TASK_TYPE };

export class ProcurementReplyStaleStateError extends SupplyPersistenceError {
  constructor(message: string) {
    super(message, "conflict");
    this.name = "ProcurementReplyStaleStateError";
  }
}

export class ProcurementReplyPriorDeliveryReconciledError extends SupplyPersistenceError {
  readonly delivery: ProcurementReplyDelivery;

  constructor(delivery: ProcurementReplyDelivery) {
    super(
      "A previous supplier reply was reconciled as sent. The current draft remains unsent and must be reviewed again.",
      "conflict",
    );
    this.name = "ProcurementReplyPriorDeliveryReconciledError";
    this.delivery = delivery;
  }
}

const RECONCILABLE_REPLY_STATES = ["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"] as const;

type ExistingReplyDisposition = "RETURN_SENT" | "RECONCILE" | "CREATE_SUCCESSOR" | "CONFLICT";

export function procurementReplyExistingTaskDisposition(input: {
  status: string;
  existingMessageHash: unknown;
  nextMessageHash: string;
  result: unknown;
}): ExistingReplyDisposition {
  if (input.status === "RUNNING") return "RECONCILE";
  if (input.status === "SUCCEEDED") return "RETURN_SENT";
  if (input.status !== "FAILED") return "CONFLICT";
  // A proven failed attempt may be retried with regenerated wording. Unknown
  // deliveries stay RUNNING and must be reconciled before any successor exists.
  return "CREATE_SUCCESSOR";
}

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
  // Only an exact content match may finalize the currently selected draft.
  matchesExpectedInput?: boolean;
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

// A chase is sent on a thread whose newest message is ours, so it anchors on
// the supplier's newest reply instead. It is only allowed once the thread has
// been quiet long enough, which keeps a loop pass from mailing a supplier that
// was answered minutes ago.
function requireQuietThread(args: {
  conversation: ProcurementConversation;
  vendor: ProcurementOrderVendor;
  sourceMessageId: string;
  now?: number;
}) {
  // An out of office note or a bounce report is not the supplier answering, so
  // the follow up is judged against the thread as the people on it wrote it.
  // Otherwise a notice arriving after our answer would hold a due follow up
  // forever, and a follow up would anchor on a message no supplier reads.
  const messages = supplierWrittenMessages(args.conversation.messages);
  const latest = messages.at(-1);
  if (!args.conversation.available || !latest || latest.direction !== "OUTBOUND") {
    throw new SupplyPersistenceError("This supplier thread is not waiting on the supplier, so no follow up is sent.", "conflict");
  }
  const inbound = [...messages].reverse().find((message) => message.direction === "INBOUND") ?? null;
  if (!inbound || inbound.id !== args.sourceMessageId) {
    throw new SupplyPersistenceError("The supplier reply this follow up answers is no longer the newest one. Refresh before sending.", "conflict");
  }
  const decision = supplierChaseDecision({
    lastDirection: "OUTBOUND",
    lastMessageAt: latest.sentAt,
    chasesSent: chasesSentAfterLastReply(messages, {
      // Notices are already out of this thread view, so the newest inbound
      // message is a reply the supplier wrote and the first outbound message
      // after it is the answer to it rather than a follow up.
      answeredReply: true,
    }),
    hasQuote: false,
    now: args.now,
  });
  if (!decision.chase) {
    throw new SupplyPersistenceError(`No follow up is sent: ${decision.reason}`, "conflict");
  }
  if (!procurementSupplierSenderVouched({
    conversation: args.conversation,
    contactEmail: args.vendor.contact?.email ?? null,
    senderEmail: inbound.fromEmail,
  })) {
    throw new SupplyPersistenceError("The supplier sender could not be verified for this thread.", "conflict");
  }
  return { inbound, latest };
}

function requireCurrentInbound(args: {
  conversation: ProcurementConversation;
  vendor: ProcurementOrderVendor;
  sourceMessageId: string;
}) {
  const messages = args.conversation.messages;
  if (!args.conversation.available) {
    throw new SupplyPersistenceError("The latest supplier message is not awaiting a reply. Refresh the conversation before sending.", "conflict");
  }
  const index = messages.findIndex((message) => message.id === args.sourceMessageId);
  const source = index >= 0 ? messages[index]! : null;
  if (!source) {
    // The thread does not carry the message this reply answers at all, so what
    // it answers cannot be judged and the operator refreshes before sending.
    throw new SupplyPersistenceError("A newer supplier message arrived. Review the refreshed conversation before sending.", "conflict");
  }
  if (source.direction !== "INBOUND") {
    throw new SupplyPersistenceError("The latest supplier message is not awaiting a reply. Refresh the conversation before sending.", "conflict");
  }
  const after = messages.slice(index + 1);
  if (after.some((message) => message.direction === "OUTBOUND")) {
    throw new SupplyPersistenceError("The latest supplier message is not awaiting a reply. Refresh the conversation before sending.", "conflict");
  }
  // An out of office note or a bounce report answers nothing and is never
  // answered itself, so it does not take the question away from the reply that
  // answers it. Only a real supplier message does.
  if (after.some((message) => (
    message.direction === "INBOUND"
    && !supplierInboundNotice(message.subject ?? "", message.body)
  ))) {
    throw new SupplyPersistenceError("A newer supplier message arrived. Review the refreshed conversation before sending.", "conflict");
  }
  if (!procurementSupplierSenderVouched({
    conversation: args.conversation,
    contactEmail: args.vendor.contact?.email ?? null,
    senderEmail: source.fromEmail,
  })) {
    throw new SupplyPersistenceError("The supplier sender could not be verified for this thread.", "conflict");
  }
  return source;
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

// A thread whose original mailbox is no longer connected, or is paused by
// sender protection, cannot be answered from that address. The caller can allow
// a mailbox from the shared pool instead: the supplier gets the same message
// and files from a new sender,
// threaded through the supplier's own message id rather than a Gmail thread
// that belongs to another mailbox.
async function pooledReplySender(args: { officeId: string; workspaceId: string; taskScopeKey: string }) {
  // A retry or reconciliation has to reuse the mailbox the first attempt
  // claimed: the sender identity is part of the delivery hash, and pool load
  // shifts constantly, so re-picking would make the attempt unresolvable.
  const existing = await prisma.supplyExecutionTask.findFirst({
    where: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
      taskKey: { startsWith: `${args.taskScopeKey}:` },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { input: true },
  });
  const claimedSender = record(record(existing?.input).message).senderEmail;
  if (typeof claimedSender === "string" && claimedSender.trim()) {
    // tenant-scope:ignore EmailAccount is shared provider provenance, not mailbox tenancy; the office-scoped task above owns this retry.
    const previous = await prisma.emailAccount.findFirst({
      where: { email: { equals: claimedSender.trim(), mode: "insensitive" }, ...SHARED_SENDER_POOL_FILTER },
      select: { id: true, email: true },
    });
    if (previous) return previous;
  }
  const candidate = selectEmailSenderPoolCandidate(await listEmailSenderPoolAccounts());
  if (!candidate) return null;
  return { id: candidate.id, email: candidate.email };
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

type StoredReplyTask = {
  id: string;
  status: string;
  input: unknown;
  result: unknown;
};

function vendorReplyTaskScope(orderId: string, vendorId: string) {
  return {
    OR: [
      { taskKey: { startsWith: `procurement-reply:${orderId}:${vendorId}:` } },
      { taskKey: { startsWith: `procurement-chase:${orderId}:${vendorId}:` } },
    ],
  };
}

function storedReplyMatchesRequestedInput(task: StoredReplyTask, requested: ProcurementReplySendInput) {
  const input = record(task.input);
  const message = record(input.message);
  const normalized = normalizeInput(requested);
  const storedAttachments = Array.isArray(message.attachments)
    ? message.attachments.map((value) => String(record(value).documentId ?? ""))
    : [];
  const requestedAttachments = [...new Set((requested.attachmentDocumentIds ?? []).map((value) => String(value)))];
  return input.sourceMessageId === normalized.sourceMessageId
    && message.recipient === normalized.recipient
    && message.subject === normalized.subject
    && message.body === normalized.body
    && JSON.stringify(storedAttachments) === JSON.stringify(requestedAttachments);
}

async function findPendingReplyTask(args: {
  officeId: string;
  workspaceId: string;
  orderId: string;
  vendorId: string;
}): Promise<StoredReplyTask | null> {
  return prisma.supplyExecutionTask.findFirst({
    where: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
      ...vendorReplyTaskScope(args.orderId, args.vendorId),
      status: "RUNNING",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, status: true, input: true, result: true },
  });
}

function assertStoredReplyScope(args: {
  task: StoredReplyTask;
  customerId: string;
  orderId: string;
  vendorId: string;
}) {
  const input = record(args.task.input);
  if (input.customerId !== args.customerId || input.orderId !== args.orderId || input.vendorId !== args.vendorId) {
    throw new SupplyPersistenceError(
      "The unresolved supplier delivery is bound to a different procurement request.",
      "conflict",
    );
  }
}

async function reconcileStoredReplyTask(args: {
  context: SupplyAccessContext;
  companyId: string | null;
  workspaceId: string;
  customerId: string;
  orderId: string;
  vendorId: string;
  task: StoredReplyTask;
  provider: SupplierEmailProvider;
  expectedInput?: ProcurementReplySendInput;
}) {
  assertStoredReplyScope(args);
  const taskInput = record(args.task.input);
  const message = record(taskInput.message);
  const result = record(args.task.result);
  const rfcMessageId = requiredText(result.rfcMessageId, "Stored supplier reply message ID", 500);
  if (!RECONCILABLE_REPLY_STATES.includes(String(result.state) as (typeof RECONCILABLE_REPLY_STATES)[number])) {
    throw new SupplyPersistenceError("The supplier reply no longer needs reconciliation.", "conflict");
  }
  const reconciled = await args.provider.reconcile({
    officeId: args.context.officeId,
    accountId: requiredText(message.senderAccountId, "Stored sender account", 220),
    senderEmail: requiredText(message.senderEmail, "Stored Gmail sender", 320),
    rfcMessageId,
  });
  if (reconciled.state !== "SENT") {
    await recordReplyReconciliationPending({
      context: args.context,
      workspaceId: args.workspaceId,
      taskId: args.task.id,
      rfcMessageId,
      result: reconciled,
    });
    throw new SupplyPersistenceError(
      reconciled.state === "NOT_FOUND"
        ? "Gmail did not find the unresolved supplier reply. Human non-delivery review is required before another send."
        : "Gmail delivery is still unresolved. Check Sent Mail before attempting another reply.",
      "conflict",
    );
  }
  const delivery = await finalizeSent({
    context: args.context,
    companyId: args.companyId,
    workspaceId: args.workspaceId,
    customerId: args.customerId,
    orderId: args.orderId,
    vendorId: args.vendorId,
    taskId: args.task.id,
    receipt: reconciled,
    rfcMessageId,
  });
  return {
    delivery,
    taskId: args.task.id,
    sourceMessageId: requiredText(taskInput.sourceMessageId, "Stored supplier source message", 512),
    matchesExpectedInput: args.expectedInput
      ? storedReplyMatchesRequestedInput(args.task, args.expectedInput)
      : null,
  };
}

export async function reconcilePendingProcurementSupplierReply(args: {
  context: SupplyAccessContext;
  customerId: string;
  order: ProcurementOrderDetail;
  vendor: Pick<ProcurementOrderVendor, "id">;
  expectedInput?: ProcurementReplySendInput;
  provider?: SupplierEmailProvider;
}) {
  const access = await currentAccessContext(args.context);
  const workspaceId = requestWorkspaceId(args.order);
  const workspace = await requireSupplyWorkspace(access, workspaceId, "edit");
  const task = await findPendingReplyTask({
    officeId: access.officeId,
    workspaceId,
    orderId: args.order.id,
    vendorId: args.vendor.id,
  });
  if (!task) return null;
  return reconcileStoredReplyTask({
    context: access,
    companyId: workspace.companyId,
    workspaceId,
    customerId: args.customerId,
    orderId: args.order.id,
    vendorId: args.vendor.id,
    task,
    provider: args.provider ?? gmailSupplierEmailProvider,
    expectedInput: args.expectedInput,
  });
}

async function invalidateSupplierReplyState(officeId: string, workspaceId: string) {
  try {
    const { invalidateWorkspaceControlStateProjection } = await import(
      "@/lib/supply-os/state-runtime/projections/invalidate"
    );
    await invalidateWorkspaceControlStateProjection({ officeId, workspaceId });
  } catch {
    // Execution events are canonical. Projection invalidation is best effort
    // and read-time fingerprints still reject stale cache rows.
  }
}

async function invalidateSupplierConversationState(args: {
  officeId: string;
  companyId: string;
  workspaceId: string;
  customerId: string;
  orderId: string;
  vendorId: string;
}) {
  try {
    const {
      invalidateSupplyStateProjectionsByDependency,
      invalidateWorkspaceControlStateProjection,
      invalidateCompanyContextStateProjections,
    } = await import("@/lib/supply-os/state-runtime/projections/invalidate");
    const prefix = `${args.customerId}:${args.orderId}:${args.vendorId}`;
    await Promise.all([
      invalidateWorkspaceControlStateProjection({
        officeId: args.officeId,
        workspaceId: args.workspaceId,
      }),
      invalidateCompanyContextStateProjections({
        officeId: args.officeId,
        companyId: args.companyId,
      }),
      invalidateSupplyStateProjectionsByDependency({
        officeId: args.officeId,
        workspaceId: args.workspaceId,
        projectionTypes: ["procurement_request_v1", "supplier_relationship_v1"],
        dependencyKeys: [
          `procurement.vendor_latest_message:${prefix}`,
          `procurement.vendor_triage:${prefix}`,
        ],
      }),
    ]);
  } catch {
    // Canonical ledgers already committed; read-time semantic fingerprints are
    // the fallback when a derived-cache invalidation cannot be recorded.
  }
}

async function finalizeSent(args: {
  context: SupplyAccessContext;
  companyId: string | null;
  workspaceId: string;
  customerId: string;
  orderId: string;
  vendorId: string;
  taskId: string;
  receipt: SupplierEmailSent;
  rfcMessageId: string;
  deliveredAttachments?: readonly OutboundEmailAttachment[];
}) {
  const delivery = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
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
    if (currentResult.rfcMessageId !== args.rfcMessageId
      || !RECONCILABLE_REPLY_STATES.includes(String(currentResult.state) as (typeof RECONCILABLE_REPLY_STATES)[number])) {
      throw new SupplyPersistenceError("Supplier reply delivery changed concurrently. Refresh before retrying.", "conflict");
    }

    const message = record(record(task.input).message);
    const senderEmail = requiredText(message.senderEmail, "Stored Gmail sender", 320);
    const recipient = requiredText(message.recipient, "Stored supplier recipient", 320);
    const subject = requiredText(message.subject, "Stored email subject", 180);
    const now = new Date();
    const senderAccountId = requiredText(message.senderAccountId, "Stored sender account", 220);
    const existingMessage = await tx.emailMessage.findFirst({
      where: {
        accountId: senderAccountId,
        thread: {
          officeId: args.context.officeId,
          hiddenAt: null,
          AND: [
            { OR: [{ companyId: args.companyId }, { companyId: null }] },
            { OR: [
              { autoLinkSkipReason: null },
              { autoLinkSkipReason: { not: "UNROUTED_SHARED_MAILBOX" } },
            ] },
          ],
        },
        OR: [{ gmailMessageId: args.receipt.providerMessageId }, { externalId: args.rfcMessageId }],
      },
      select: { threadId: true },
    });
    let localThreadId = existingMessage?.threadId ?? null;
    if (localThreadId && args.companyId) {
      await tx.emailThread.updateMany({
        where: { id: localThreadId, officeId: args.context.officeId, companyId: null },
        data: { companyId: args.companyId },
      });
    }
    if (!localThreadId) {
      const preferredThreadId = typeof record(task.input).localThreadId === "string"
        ? String(record(task.input).localThreadId)
        : null;
      const thread = preferredThreadId
        ? await tx.emailThread.findFirst({
            where: {
              id: preferredThreadId,
              officeId: args.context.officeId,
              hiddenAt: null,
              AND: [
                { OR: [{ companyId: args.companyId }, { companyId: null }] },
                { OR: [
                  { autoLinkSkipReason: null },
                  { autoLinkSkipReason: { not: "UNROUTED_SHARED_MAILBOX" } },
                ] },
              ],
            },
          })
        : await tx.emailThread.findFirst({
            where: {
              officeId: args.context.officeId,
              externalThreadId: args.receipt.providerThreadId,
              hiddenAt: null,
              AND: [
                { OR: [{ companyId: args.companyId }, { companyId: null }] },
                { OR: [
                  { autoLinkSkipReason: null },
                  { autoLinkSkipReason: { not: "UNROUTED_SHARED_MAILBOX" } },
                ] },
              ],
              messages: { some: { accountId: senderAccountId } },
            },
            orderBy: { updatedAt: "desc" },
          });
      if (thread) {
        localThreadId = thread.id;
        await tx.emailThread.update({
          where: { id: thread.id },
          data: {
            companyId: args.companyId,
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
            companyId: args.companyId,
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
          accountId: senderAccountId,
          officeId: args.context.officeId,
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
  if (args.companyId) {
    await invalidateSupplierConversationState({
      officeId: args.context.officeId,
      companyId: args.companyId,
      workspaceId: args.workspaceId,
      customerId: args.customerId,
      orderId: args.orderId,
      vendorId: args.vendorId,
    });
  } else {
    // Historical companyless tasks remain reconcilable, but their mail is not
    // assigned to a company projection or admitted into Company Brain.
    await invalidateSupplierReplyState(args.context.officeId, args.workspaceId);
  }
  return delivery;
}

async function recordNonDelivery(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  taskId: string;
  rfcMessageId: string;
  receipt: Exclude<SupplierEmailSendResult, SupplierEmailSent>;
}) {
  const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
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
  await invalidateSupplierReplyState(args.context.officeId, args.workspaceId);
  return result;
}

async function recordReplyReconciliationPending(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  taskId: string;
  rfcMessageId: string;
  result: { state: "NOT_FOUND" | "UNKNOWN"; error?: string };
}) {
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.taskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
    const task = await tx.supplyExecutionTask.findFirst({
      where: {
        id: args.taskId,
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
        status: "RUNNING",
      },
      select: { id: true, result: true },
    });
    if (!task) return;
    const current = record(task.result);
    if (current.rfcMessageId !== args.rfcMessageId
      || !RECONCILABLE_REPLY_STATES.includes(String(current.state) as (typeof RECONCILABLE_REPLY_STATES)[number])) {
      return;
    }
    const next = {
      ...current,
      state: args.result.state === "NOT_FOUND" ? "NOT_FOUND_REVIEW_REQUIRED" : "DELIVERY_UNKNOWN",
      error: args.result.error ?? null,
      lastCheckedAt: new Date().toISOString(),
    };
    await tx.supplyExecutionTask.update({
      where: { id: task.id },
      data: {
        result: inputJson(next),
        resultHash: digest(next),
        error: inputJson({ message: next.error, state: next.state }),
      },
    });
    await appendSupplierCommunicationEvent({
      tx,
      taskId: task.id,
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      actorUserId: args.context.userId,
      eventType: args.result.state === "NOT_FOUND"
        ? "PROCUREMENT_SUPPLIER_REPLY_NOT_FOUND_REVIEW_REQUIRED"
        : "PROCUREMENT_SUPPLIER_REPLY_RECONCILIATION_UNKNOWN",
      status: "RUNNING",
      message: args.result.state === "NOT_FOUND"
        ? "Gmail did not find the stable supplier reply message ID. Human review is required before another send."
        : "Gmail reconciliation did not return a definitive supplier reply result.",
      payload: inputJson(next),
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier reply reconciliation changed concurrently. Retry the check.");
  await invalidateSupplierReplyState(args.context.officeId, args.workspaceId);
}

async function recordCommercialStateBlock(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  taskId: string;
  rfcMessageId: string;
  reason: string;
}) {
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.taskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} FOR UPDATE`);
    const task = await tx.supplyExecutionTask.findFirst({
      where: {
        id: args.taskId,
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
      },
      select: { id: true, result: true },
    });
    if (!task || record(task.result).rfcMessageId !== args.rfcMessageId) {
      throw new SupplyPersistenceError("Supplier reply delivery changed concurrently. Refresh before retrying.", "conflict");
    }
    const result = {
      ...record(task.result),
      state: "COMMERCIAL_STATE_STALE",
      error: args.reason,
      providerCalled: false,
      updatedAt: new Date().toISOString(),
    };
    await tx.supplyExecutionTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        result: inputJson(result),
        resultHash: digest(result),
        error: inputJson({ message: args.reason, state: result.state, providerCalled: false }),
        failedAt: new Date(),
      },
    });
    await appendSupplierCommunicationEvent({
      tx,
      taskId: task.id,
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      actorUserId: args.context.userId,
      eventType: "PROCUREMENT_SUPPLIER_REPLY_COMMERCIAL_STATE_STALE",
      status: "FAILED",
      message: "Supplier delivery was blocked by semantic state validation before the email provider was called.",
      payload: inputJson({ reason: args.reason, providerCalled: false }),
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier reply delivery changed concurrently. Refresh before retrying.");
  await invalidateSupplierReplyState(args.context.officeId, args.workspaceId);
}

export async function sendProcurementSupplierReply(args: {
  context: SupplyAccessContext;
  customerId: string;
  order: ProcurementOrderDetail;
  vendor: ProcurementOrderVendor;
  conversation: ProcurementConversation;
  input: ProcurementReplySendInput;
  // A chase repeats the answer on a thread the supplier left quiet. It anchors
  // on the supplier's newest reply and is bounded by the chase policy.
  mode?: "REPLY" | "CHASE";
  // Set only by an operator command: it changes who the supplier hears from.
  allowPooledSender?: boolean;
  stateRead?: {
    id: string;
    packetHash: string;
    sourceFingerprint: string;
    expectedTaskId?: string;
    expectedInputHash?: string;
  } | null;
  dependencies?: Partial<SendDependencies>;
}): Promise<ProcurementReplyDelivery> {
  const dependencies = { ...defaultDependencies, ...args.dependencies };
  const access = await currentAccessContext(args.context);
  const workspaceId = requestWorkspaceId(args.order);
  const workspace = await requireSupplyWorkspace(access, workspaceId, "edit");
  const companyId = workspace.companyId;
  const input = normalizeInput(args.input);

  // Reconciliation observes a provider call that may already have happened. It
  // therefore precedes semantic gating, current-thread checks, sender selection,
  // attachment reads, and any attempt to claim a new delivery.
  const pending = await findPendingReplyTask({
    officeId: access.officeId,
    workspaceId,
    orderId: args.order.id,
    vendorId: args.vendor.id,
  });
  if (pending) {
    const reconciled = await reconcileStoredReplyTask({
      context: access,
      companyId,
      workspaceId,
      customerId: args.customerId,
      orderId: args.order.id,
      vendorId: args.vendor.id,
      task: pending,
      provider: dependencies.provider,
      expectedInput: args.input,
    });
    if (!reconciled.matchesExpectedInput && reconciled.sourceMessageId !== input.sourceMessageId) {
      throw new ProcurementReplyPriorDeliveryReconciledError(reconciled.delivery);
    }
    return { ...reconciled.delivery, matchesExpectedInput: reconciled.matchesExpectedInput === true };
  }

  const chasing = args.mode === "CHASE";
  const quiet = chasing
    ? requireQuietThread({
        conversation: args.conversation,
        vendor: args.vendor,
        sourceMessageId: input.sourceMessageId,
      })
    : null;
  // Each chase follows a specific outbound message; the original reply and a
  // later chase must never share a delivery key.
  const sourceHash = createHash("sha256")
    .update(quiet ? `${input.sourceMessageId}:chase:${quiet.latest.id}` : input.sourceMessageId)
    .digest("hex")
    .slice(0, 20);
  const taskScopeKey = `procurement-${chasing ? "chase" : "reply"}:${args.order.id}:${args.vendor.id}:${sourceHash}`;

  // A completed replay is idempotent even if mailbox availability or the live
  // conversation changed after Gmail accepted the exact message.
  const completed = await prisma.supplyExecutionTask.findFirst({
    where: {
      officeId: access.officeId,
      workspaceId,
      taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
      taskKey: { startsWith: `${taskScopeKey}:` },
      status: "SUCCEEDED",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true, input: true, result: true },
  });
  if (completed) {
    return {
      ...deliveryFromTask(completed, true),
      matchesExpectedInput: storedReplyMatchesRequestedInput(completed, args.input),
    };
  }

  const effectiveStateRead: NonNullable<typeof args.stateRead> | null = args.stateRead
    ?? await createProcurementVendorDraftStateRead({
      officeId: access.officeId,
      customerId: args.customerId,
      order: args.order,
      vendorId: args.vendor.id,
      objective: `Validate the operator-confirmed supplier reply for vendor ${args.vendor.id}.`,
    });
  let stateRead = effectiveStateRead ? await prisma.supplyStateRead.findFirst({
    where: {
      id: effectiveStateRead.id,
      officeId: access.officeId,
      workspaceId,
      packetHash: effectiveStateRead.packetHash,
      sourceFingerprint: effectiveStateRead.sourceFingerprint,
    },
    select: {
      id: true,
      packetHash: true,
      sourceFingerprint: true,
      scopeType: true,
      scopeRef: true,
      packet: true,
      dependencyManifest: true,
    },
  }) : null;
  if (effectiveStateRead && !stateRead) {
    throw new SupplyPersistenceError("The commercial state read does not belong to this supplier send scope.", "conflict");
  }
  if (stateRead && effectiveStateRead) {
    const boundStateRead = stateRead;
    if (!companyId) {
      throw new SupplyPersistenceError(
        "This sourcing request is not linked to a company profile, so its commercial state read cannot be routed safely.",
        "conflict",
      );
    }
    try {
      assertProcurementVendorStateReadBinding({
        stateRead: boundStateRead,
        scope: {
          type: "procurement_request",
          officeId: access.officeId,
          companyId,
          customerId: args.customerId,
          orderId: args.order.id,
          workspaceId,
        },
        vendorId: args.vendor.id,
        requireSavedDraft: Boolean(
          effectiveStateRead.expectedTaskId && effectiveStateRead.expectedInputHash,
        ),
      });
      if (effectiveStateRead.expectedTaskId || effectiveStateRead.expectedInputHash) {
        const expectedTaskId = requiredText(effectiveStateRead.expectedTaskId, "Expected supplier draft task", 512);
        const expectedInputHash = requiredText(effectiveStateRead.expectedInputHash, "Expected supplier draft hash", 128);
        const key = `procurement.vendor_saved_draft:${args.customerId}:${args.order.id}:${args.vendor.id}`;
        const dependency = Array.isArray(boundStateRead.dependencyManifest)
          ? boundStateRead.dependencyManifest.find((value) => (
              value && typeof value === "object" && !Array.isArray(value)
                && (value as { key?: unknown }).key === key
            )) as Record<string, unknown> | undefined
          : undefined;
        if (!dependency || dependency.entityRef !== expectedTaskId || dependency.version !== expectedInputHash) {
          throw new Error("The commercial state read does not bind the exact supplier draft being delivered.");
        }
      }
    } catch (error) {
      throw new SupplyPersistenceError(
        error instanceof Error ? error.message : "The commercial state read is bound to a different supplier send.",
        "conflict",
      );
    }
    const actionBinding = validateSupplyStateAssertionForAction({
      officeId: access.officeId,
      action: "procurement_supplier_reply.bind_state_read",
      assertion: () => assertProcurementVendorActionMatchesStatePacket({
        packet: boundStateRead.packet,
        vendorId: args.vendor.id,
        vendor: args.vendor,
        sourceMessageId: input.sourceMessageId,
        recipient: input.recipient,
        variant: args.mode,
      }),
    });
    if (!actionBinding.valid) {
      if (actionBinding.blocked) {
        throw new SupplyPersistenceError(
          actionBinding.error?.message ?? "The supplier send no longer matches its commercial state read.",
          "conflict",
        );
      }
      stateRead = null;
    }
  }
  const plannedAttachments = plannedReplyAttachments({
    companyId,
    order: args.order,
    requestedDocumentIds: args.input.attachmentDocumentIds ?? [],
  });
  const inbound = quiet?.inbound ?? requireCurrentInbound({
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
  // A mailbox paused by sender protection refuses the send at the provider, so
  // treating it as the thread sender turns an answerable reply into a permanent
  // failure. It is left out here instead, which lets the pooled sender answer
  // the supplier from a mailbox that can still send.
  // tenant-scope:ignore EmailAccount is shared provider provenance, not mailbox tenancy; resolveReplyAnchor already proved routed office/order/vendor ownership.
  const threadSender = await prisma.emailAccount.findFirst({
    where: {
      email: { equals: anchor.accountEmail, mode: "insensitive" },
      isActive: true,
      sendEnabled: true,
      sendPausedAt: null,
      ...CONNECTED_GMAIL_ACCOUNT_FILTER,
    },
    select: { id: true, email: true },
  });
  const sender = threadSender
    ?? (args.allowPooledSender ? await pooledReplySender({ officeId: access.officeId, workspaceId, taskScopeKey }) : null);
  if (!sender) {
    // An attempt whose outcome is unknown still has to be reconciled, and the
    // mailbox that holds the answer is the one no longer offered as a sender,
    // so the stored attempt is settled from its own sender instead of asking
    // for one it cannot get.
    const unresolved = await prisma.supplyExecutionTask.findFirst({
      where: {
        officeId: access.officeId,
        workspaceId,
        taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
        taskKey: { startsWith: `${taskScopeKey}:` },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, input: true, result: true },
    });
    if (unresolved?.status === "SUCCEEDED") {
      return {
        ...deliveryFromTask(unresolved, true),
        matchesExpectedInput: storedReplyMatchesRequestedInput(unresolved, args.input),
      };
    }
    if (unresolved?.status === "RUNNING") {
      const reconciled = await reconcileStoredReplyTask({
        context: access,
        companyId,
        workspaceId,
        customerId: args.customerId,
        orderId: args.order.id,
        vendorId: args.vendor.id,
        task: unresolved,
        provider: dependencies.provider,
        expectedInput: args.input,
      });
      return { ...reconciled.delivery, matchesExpectedInput: reconciled.matchesExpectedInput === true };
    }
    // A caller that allowed the pooled fallback and still has no sender is not
    // blocked by the thread's mailbox but by the pool itself, and telling an
    // operator to reconnect the thread mailbox would not fix that.
    throw new ProcurementReplySenderUnavailableError(
      anchor.accountEmail,
      args.allowPooledSender ? "SENDER_POOL" : "THREAD_MAILBOX",
    );
  }
  // A Gmail thread id belongs to the mailbox that holds it, so a pooled sender
  // starts a new provider thread and relies on the reply headers instead. The
  // stored thread stays pointed at the original mailbox, so the pooled send is
  // filed on its own thread rather than repointing the supplier's history.
  const threadedFromOriginalMailbox = Boolean(threadSender);
  const providerThreadId = threadedFromOriginalMailbox ? anchor.providerThreadId : null;
  const localThreadId = threadedFromOriginalMailbox ? anchor.localThreadId : null;

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
  const claimed = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const vendorLock = `${workspaceId}:procurement-reply-vendor:${args.order.id}:${args.vendor.id}`;
    await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${vendorLock}, 0))) AS reply_lock`);
    const unresolved = await tx.supplyExecutionTask.findFirst({
      where: {
        officeId: access.officeId,
        workspaceId,
        taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
        ...vendorReplyTaskScope(args.order.id, args.vendor.id),
        status: "RUNNING",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, status: true, input: true, result: true },
    });
    if (unresolved) return { kind: "RECONCILE" as const, task: unresolved };
    const existing = await tx.supplyExecutionTask.findFirst({
      where: {
        officeId: access.officeId,
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
    if (existing) {
      const disposition = procurementReplyExistingTaskDisposition({
        status: existing.status,
        existingMessageHash: existingInput.messageHash,
        nextMessageHash: messageHash,
        result: existing.result,
      });
      if (disposition === "RETURN_SENT") {
        return {
          kind: "SENT" as const,
          delivery: {
            ...deliveryFromTask(existing, true),
            matchesExpectedInput: storedReplyMatchesRequestedInput(existing, args.input),
          },
        };
      }
      if (disposition === "RECONCILE") {
        return { kind: "RECONCILE" as const, task: existing };
      }
      if (disposition === "CONFLICT") {
        throw new SupplyPersistenceError(
          "A supplier reply for this message is already being handled. Refresh before retrying.",
          "conflict",
        );
      }
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
      providerThreadId,
      inReplyToRfcMessageId: anchor.inReplyToRfcMessageId,
      localThreadId,
      operatorConfirmation: {
        confirmed: true,
        userId: access.userId,
        confirmedAt: new Date().toISOString(),
      },
      ...(stateRead ? {
        stateReadId: stateRead.id,
        statePacketHash: stateRead.packetHash,
        sourceFingerprint: stateRead.sourceFingerprint,
      } : {}),
    };
    const planned = { state: "PLANNED", attempt, rfcMessageId };
    const sending = { state: "SENDING", attempt, rfcMessageId, startedAt: new Date().toISOString() };
    await tx.supplyExecutionTask.create({
      data: {
        id: taskId,
        officeId: access.officeId,
        workspaceId,
        stateReadId: stateRead?.id ?? null,
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
    return { kind: "CLAIMED" as const, taskId, rfcMessageId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier reply delivery changed concurrently. Refresh before retrying.");

  if (claimed.kind === "SENT") return claimed.delivery;
  if (claimed.kind === "RECONCILE") {
    const reconciled = await reconcileStoredReplyTask({
      context: access,
      companyId,
      workspaceId,
      customerId: args.customerId,
      orderId: args.order.id,
      vendorId: args.vendor.id,
      task: claimed.task,
      provider: dependencies.provider,
      expectedInput: args.input,
    });
    if (!reconciled.matchesExpectedInput && reconciled.sourceMessageId !== input.sourceMessageId) {
      throw new ProcurementReplyPriorDeliveryReconciledError(reconciled.delivery);
    }
    return { ...reconciled.delivery, matchesExpectedInput: reconciled.matchesExpectedInput === true };
  }

  // The claim already marked this attempt RUNNING, so a file that cannot be read
  // or screened has to fail the attempt. Leaving it RUNNING would send the
  // operator into reconciliation for a message Gmail never saw.
  let attachments: readonly OutboundEmailAttachment[] = [];
  try {
    if (plannedAttachments.length) {
      if (!companyId) {
        throw new SupplyPersistenceError(
          "This sourcing request is not linked to a company profile, so its files cannot be attached.",
          "conflict",
        );
      }
      attachments = await loadReplyAttachments({
        officeId: access.officeId,
        companyId,
        documentIds: plannedAttachments.map((attachment) => attachment.documentId),
        load: dependencies.requestDocumentAttachments,
      });
    }
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
  const validation = await validateSupplyStateReadForAction({
    officeId: access.officeId,
    stateReadId: stateRead?.id,
    action: "procurement_supplier_reply.provider_send",
  });
  if (validation.blocked) {
    const reason = `Supplier reply delivery was blocked because strict commercial state changed: ${summarizeSupplyStateConflict(validation)}.`;
    await recordCommercialStateBlock({
      context: access,
      workspaceId,
      taskId: claimed.taskId,
      rfcMessageId: claimed.rfcMessageId,
      reason,
    });
    throw new ProcurementReplyStaleStateError(reason);
  }
  const receipt = await dependencies.provider.send({
    officeId: access.officeId,
    accountId: sender.id,
    senderEmail: message.senderEmail,
    recipient: message.recipient,
    subject: message.subject,
    body: message.body,
    rfcMessageId: claimed.rfcMessageId,
    providerThreadId,
    inReplyToRfcMessageId: anchor.inReplyToRfcMessageId,
    attachments,
  });
  if (receipt.state === "SENT") {
    return finalizeSent({
      context: access,
      companyId,
      workspaceId,
      customerId: args.customerId,
      orderId: args.order.id,
      vendorId: args.vendor.id,
      taskId: claimed.taskId,
      receipt,
      rfcMessageId: claimed.rfcMessageId,
      deliveredAttachments: attachments,
    });
  }
  await recordNonDelivery({ context: access, workspaceId, taskId: claimed.taskId, rfcMessageId: claimed.rfcMessageId, receipt });
  throw new SupplyPersistenceError(receipt.error, "conflict");
}
