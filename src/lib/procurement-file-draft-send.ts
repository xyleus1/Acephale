import "server-only";

import { listSuppressedEmails } from "@/lib/email-delivery-events";
import { prisma } from "@/lib/prisma";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { procurementVendorConversation } from "@/lib/procurement-conversation";
import {
  procurementDraftCurrency,
  procurementDraftCurrencyConversation,
} from "@/lib/procurement-draft-currency";
import {
  cancelStaleProcurementFileDeliveryDraft,
  getProcurementFileDeliveryDraft,
  markProcurementFileDeliveryDraftSent,
  procurementFileDraftSendDecision,
  retireProcurementFileDeliveryDraft,
} from "@/lib/procurement-file-delivery-draft";
import { procurementOperatorAccess } from "@/lib/procurement-operator-access";
import { procurementRepliedVendors } from "@/lib/procurement-reply-scope";
import {
  ProcurementReplyPriorDeliveryReconciledError,
  ProcurementReplyStaleStateError,
  reconcilePendingProcurementSupplierReply,
  sendProcurementSupplierReply,
} from "@/lib/procurement-reply-send";
import { getProcurementRequest } from "@/lib/procurement-workflow";
import { PROCUREMENT_REPLY_EMAIL_TASK_TYPE } from "@/lib/procurement-reply-record";
import { record } from "@/lib/supply-os/supplier-communication-shared";
import {
  summarizeSupplyStateConflict,
  validateSupplyStateReadForAction,
} from "@/lib/supply-os/state-runtime/enforcement";
import { procurementVendorPacketWithSavedDraft } from "@/lib/supply-os/state-runtime/autopilot";
import { persistSupplyStateRead } from "@/lib/supply-os/state-runtime/persist-read";
import type { SupplyWorldStatePacket } from "@/lib/supply-os/state-runtime/types";

// Saved file bearing drafts are delivered from an operator command here. The
// command carries the operator confirmation that the dashboard Send Reply
// button carries, so it only ever sends a draft a human already asked for, and
// the underlying send path still refuses anything the thread does not support.
// A draft repeats the request state it was built from, so the request state is
// rechecked here before delivery and a draft whose inputs moved is refused
// instead of telling a supplier something the request no longer says.

export const FILE_SEND_MAX_PER_RUN = 25;
export const FILE_SEND_CONFIRMATION = "SEND SUPPLIER FILES";

export type FileSendOutcome = {
  vendorId: string;
  vendorName: string;
  recipient: string;
  // SUPERSEDED is a draft the thread moved past, which is retired here rather
  // than refused by the send path on every pass for good.
  state: "SENT" | "ALREADY_SENT" | "STALE" | "SUPERSEDED" | "FAILED";
  sender: string | null;
  attachments: string[];
  providerMessageId: string | null;
  error: string | null;
};

export type FileSendRunResult = {
  orderId: string;
  material: string;
  drafts: number;
  sent: number;
  alreadySent: number;
  stale: number;
  superseded: number;
  failed: number;
  remaining: number;
  outcomes: FileSendOutcome[];
};

type StateReadReference = {
  id: string;
  packetHash: string;
  sourceFingerprint: string;
};

type DraftBoundStateReadReference = StateReadReference & {
  expectedTaskId: string;
  expectedInputHash: string;
};

const fileSendDependencies = {
  loadOrder: loadBulkRfqOrder,
  getRequest: getProcurementRequest,
  operatorAccess: procurementOperatorAccess,
  repliedVendors: procurementRepliedVendors,
  getDraft: getProcurementFileDeliveryDraft,
  reconcile: reconcilePendingProcurementSupplierReply,
  send: sendProcurementSupplierReply,
};

async function confirmedDraftStateRead(args: {
  officeId: string;
  customerId: string;
  orderId: string;
  vendorId: string;
  draft: { stateReadId?: string | null; taskId?: string; inputHash?: string };
  provided?: DraftBoundStateReadReference | null;
}): Promise<DraftBoundStateReadReference | null> {
  if (args.provided) {
    if (!args.draft.taskId || !args.draft.inputHash
      || args.provided.expectedTaskId !== args.draft.taskId
      || args.provided.expectedInputHash !== args.draft.inputHash) {
      throw new Error(
        "The commercial state read belongs to a superseded supplier draft. The current draft was left unchanged.",
      );
    }
    const key = `procurement.vendor_saved_draft:${args.customerId}:${args.orderId}:${args.vendorId}`;
    const read = await prisma.supplyStateRead.findFirst({
      where: {
        id: args.provided.id,
        officeId: args.officeId,
        packetHash: args.provided.packetHash,
        sourceFingerprint: args.provided.sourceFingerprint,
      },
      select: { dependencyManifest: true },
    });
    const dependency = Array.isArray(read?.dependencyManifest)
      ? read.dependencyManifest.find((value) => (
          value && typeof value === "object" && !Array.isArray(value)
            && (value as { key?: unknown }).key === key
        )) as Record<string, unknown> | undefined
      : undefined;
    if (!dependency
      || dependency.entityRef !== args.draft.taskId
      || dependency.version !== args.draft.inputHash
      || dependency.policy !== "STRICT") {
      throw new Error(
        "The commercial state read does not bind the exact current supplier draft. The current draft was left unchanged.",
      );
    }
    return args.provided;
  }
  if (!args.draft.stateReadId || !args.draft.taskId || !args.draft.inputHash) return null;
  const original = await prisma.supplyStateRead.findFirst({
    where: { id: args.draft.stateReadId, officeId: args.officeId },
    select: { packet: true },
  });
  if (!original) {
    throw new Error("The supplier draft commercial state record is unavailable.");
  }
  const packet = procurementVendorPacketWithSavedDraft({
    packet: original.packet as unknown as SupplyWorldStatePacket,
    customerId: args.customerId,
    orderId: args.orderId,
    vendorId: args.vendorId,
    draft: { id: args.draft.taskId, inputHash: args.draft.inputHash, status: "PLANNED" },
    objective: `Validate and deliver the operator-confirmed supplier draft for vendor ${args.vendorId}.`,
  });
  const read = await persistSupplyStateRead({ officeId: args.officeId, packet });
  return {
    id: read.id,
    packetHash: read.packetHash,
    sourceFingerprint: read.sourceFingerprint,
    expectedTaskId: args.draft.taskId,
    expectedInputHash: args.draft.inputHash,
  };
}

export async function runProcurementFileDraftSendBatch(args: {
  orderId: string;
  limit?: number;
  // When present, only these suppliers may be delivered to. The sourcing loop
  // uses it so a thread it decided to escalate is never answered automatically.
  vendorIds?: readonly string[];
  // When the mailbox that owns a thread can no longer send, because it was
  // disconnected or paused by sender protection, deliver from a shared pool
  // mailbox instead of failing. The supplier reads the same answer with the
  // same files, threaded on its own message, from a different address.
  allowPooledSender?: boolean;
  vendorStateReads?: Readonly<Record<string, DraftBoundStateReadReference>>;
  outOfTime?: () => boolean;
  dependencies?: Partial<typeof fileSendDependencies>;
}): Promise<FileSendRunResult | null> {
  const dependencies = { ...fileSendDependencies, ...args.dependencies };
  const summary = await dependencies.loadOrder(args.orderId);
  if (!summary) return null;
  const order = await dependencies.getRequest(summary.customerId, args.orderId);
  if (!order) return null;
  const access = await dependencies.operatorAccess(summary.officeId);
  const limit = Math.min(FILE_SEND_MAX_PER_RUN, Math.max(1, Math.trunc(args.limit ?? FILE_SEND_MAX_PER_RUN)));
  const outcomes: FileSendOutcome[] = [];
  let drafts = 0;
  const allowed = args.vendorIds ? new Set(args.vendorIds) : null;
  // A draft only exists where a supplier replied, and rereading the request per
  // supplier row is what made a large campaign outlast its invocation limit, so
  // the run walks the repliers rather than every row.
  const pending = args.outOfTime?.() ? [] : await prisma.supplyExecutionTask.findMany({
    where: {
      officeId: summary.officeId,
      taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
      status: "RUNNING",
      OR: [
        { taskKey: { startsWith: `procurement-reply:${order.id}:` } },
        { taskKey: { startsWith: `procurement-chase:${order.id}:` } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { input: true },
  });
  // Pending attempts are canonical even when the supplier has since faded or
  // its visible thread changed. They are settled before fresh-send selection.
  const pendingVendors = pending.flatMap((task) => {
    const input = record(task.input);
    if (input.orderId !== order.id || typeof input.vendorId !== "string") return [];
    return [{
      id: input.vendorId,
      name: order.vendors.find((vendor) => vendor.id === input.vendorId)?.name ?? "Supplier",
    }];
  });
  async function* candidatesForRun() {
    yield* pendingVendors;
    if (args.outOfTime?.()) return;
    const selected = order!.vendors.filter((vendor) => !allowed || allowed.has(vendor.id));
    if (!selected.length) return;
    const replied = await dependencies.repliedVendors({
      officeId: summary!.officeId,
      orderId: summary!.orderId,
      vendors: selected,
      outOfTime: args.outOfTime,
    });
    yield* replied.vendors;
  }
  const seen = new Set<string>();
  for await (const listed of candidatesForRun()) {
    if (args.outOfTime?.()) break;
    if (seen.has(listed.id)) continue;
    seen.add(listed.id);
    // A run can hold a request open for several deliveries, so the request is
    // reread here rather than at the top: the recheck below has to compare the
    // draft with the request as it stands now, not as the run opened it.
    const live = await dependencies.getRequest(summary.customerId, args.orderId);
    const vendor = live?.vendors.find((candidate) => candidate.id === listed.id) ?? null;
    const draft = live && vendor
      ? await dependencies.getDraft({ officeId: summary.officeId, order: live, vendorId: vendor.id })
      : null;
    if (draft) drafts += 1;
    if (outcomes.length >= limit) continue;
    const attachments = draft?.attachments.map((attachment) => attachment.name) ?? [];
    if (args.outOfTime?.()) break;
    try {
      const reconciliation = await dependencies.reconcile({
        context: access,
        customerId: summary.customerId,
        order: live ?? order,
        vendor: { id: listed.id },
        ...(draft ? {
          expectedInput: {
            sourceMessageId: draft.sourceMessageId,
            recipient: draft.recipient,
            subject: draft.subject,
            body: draft.body,
            attachmentDocumentIds: draft.attachments.map((attachment) => attachment.documentId),
          },
        } : {}),
      });
      if (reconciliation) {
        if (live && vendor && draft && reconciliation.matchesExpectedInput) {
          await markProcurementFileDeliveryDraftSent({
            context: access,
            customerId: summary.customerId,
            order: live,
            vendorId: vendor.id,
            expectedTaskId: draft.taskId!,
            expectedInputHash: draft.inputHash!,
            sourceMessageId: draft.sourceMessageId,
            providerMessageId: reconciliation.delivery.providerMessageId,
          });
        }
        const matchesCurrentDraft = !draft || reconciliation.matchesExpectedInput === true;
        outcomes.push({
          vendorId: listed.id,
          vendorName: listed.name,
          recipient: reconciliation.delivery.recipient,
          state: matchesCurrentDraft ? "ALREADY_SENT" : "FAILED",
          sender: reconciliation.delivery.accountEmail,
          attachments,
          providerMessageId: reconciliation.delivery.providerMessageId,
          error: matchesCurrentDraft
            ? null
            : "A previous supplier reply was reconciled as sent. The current draft remains unsent and must be reviewed again.",
        });
        continue;
      }
    } catch (error) {
      outcomes.push({
        vendorId: listed.id,
        vendorName: listed.name,
        recipient: draft?.recipient ?? vendor?.contact?.email ?? "",
        state: "FAILED",
        sender: null,
        attachments,
        providerMessageId: null,
        error: error instanceof Error ? error.message : "The prior supplier reply could not be reconciled.",
      });
      continue;
    }
    if (!live || !vendor) {
      outcomes.push({
        vendorId: listed.id,
        vendorName: listed.name,
        recipient: "",
        state: "STALE",
        sender: null,
        attachments: [],
        providerMessageId: null,
        error: "The sourcing request or this supplier was removed after the run started.",
      });
      continue;
    }
    if ((allowed && !allowed.has(vendor.id)) || !draft) continue;
    if (args.outOfTime?.()) break;
    // Reconciliation settles an existing provider call before deciding whether
    // a new delivery is still allowed by suppression and request freshness.
    const lateSuppression = (await listSuppressedEmails(summary.officeId, [draft.recipient]))
      .get(draft.recipient.trim().toLowerCase());
    if (lateSuppression) {
      console.error("procurement supplier reply suppressed before send", {
        orderId: args.orderId,
        vendorId: vendor.id,
        recipient: draft.recipient,
        reason: lateSuppression,
      });
      outcomes.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        recipient: draft.recipient,
        state: "STALE",
        sender: null,
        attachments,
        providerMessageId: null,
        error: `Recipient suppressed: ${lateSuppression}.`,
      });
      continue;
    }
    const decision = await procurementFileDraftSendDecision({
      context: access,
      order: live,
      vendorId: vendor.id,
      draft,
    });
    if (!decision.deliver) {
      outcomes.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        recipient: draft.recipient,
        state: "STALE",
        sender: null,
        attachments,
        providerMessageId: null,
        error: decision.reason,
      });
      continue;
    }
    try {
      let stateRead = args.vendorStateReads?.[vendor.id] ?? null;
      const draftValidation = await validateSupplyStateReadForAction({
        officeId: summary.officeId,
        stateReadId: draft.stateReadId,
        action: "procurement_supplier_draft.validate_original_scope",
      });
      if (draftValidation.blocked) {
        const reason = summarizeSupplyStateConflict(draftValidation);
        await cancelStaleProcurementFileDeliveryDraft({
          context: access,
          customerId: summary.customerId,
          order: live,
          vendorId: vendor.id,
          expectedTaskId: draft.taskId!,
          expectedInputHash: draft.inputHash!,
          reason,
        });
        throw new ProcurementReplyStaleStateError(`Supplier draft send blocked because its original strict commercial state changed: ${reason}.`);
      }
      stateRead = await confirmedDraftStateRead({
        officeId: summary.officeId,
        customerId: summary.customerId,
        orderId: live.id,
        vendorId: vendor.id,
        draft,
        provided: stateRead,
      });
      const validation = await validateSupplyStateReadForAction({
        officeId: summary.officeId,
        stateReadId: stateRead?.id,
        action: "procurement_supplier_draft.select_for_send",
      });
      if (validation.blocked) {
        const reason = summarizeSupplyStateConflict(validation);
        await cancelStaleProcurementFileDeliveryDraft({
          context: access,
          customerId: summary.customerId,
          order: live,
          vendorId: vendor.id,
          expectedTaskId: draft.taskId!,
          expectedInputHash: draft.inputHash!,
          reason,
        });
        throw new ProcurementReplyStaleStateError(`Supplier draft send blocked because strict commercial state changed: ${reason}.`);
      }
      const conversation = await procurementVendorConversation({
        officeId: summary.officeId,
        customerId: summary.customerId,
        orderId: live.id,
        vendorId: vendor.id,
      });
      // The thread is judged against the draft before the provider is touched:
      // an answer that already went out, from this mailbox or a pooled one, or a
      // newer supplier message, makes this draft undeliverable for good, so it
      // is retired and the conversation moves on instead of failing every pass.
      const currency = procurementDraftCurrency({
        conversation: procurementDraftCurrencyConversation(conversation),
        sourceMessageId: draft.sourceMessageId,
        variant: draft.variant,
      });
      if (!currency.deliverable) {
        if (currency.retire) {
          await retireProcurementFileDeliveryDraft({
            context: access,
            order: live,
            vendorId: vendor.id,
            sourceMessageId: draft.sourceMessageId,
            reason: currency.reason,
          });
        }
        outcomes.push({
          vendorId: vendor.id,
          vendorName: vendor.name,
          recipient: draft.recipient,
          state: currency.retire ? "SUPERSEDED" : "FAILED",
          sender: null,
          attachments,
          providerMessageId: null,
          error: currency.reason,
        });
        continue;
      }
      if (args.outOfTime?.()) break;
      const delivery = await dependencies.send({
        context: access,
        customerId: summary.customerId,
        order: live,
        vendor,
        conversation,
        input: {
          sourceMessageId: draft.sourceMessageId,
          recipient: draft.recipient,
          subject: draft.subject,
          body: draft.body,
          attachmentDocumentIds: draft.attachments.map((attachment) => attachment.documentId),
        },
        // A chase draft is delivered on a thread whose newest message is ours,
        // so the send path anchors it on the supplier's newest reply instead.
        mode: draft.variant,
        allowPooledSender: args.allowPooledSender === true,
        stateRead,
      });
      if (delivery.matchesExpectedInput === false) {
        throw new ProcurementReplyPriorDeliveryReconciledError(delivery);
      }
      await markProcurementFileDeliveryDraftSent({
        context: access,
        order: live,
        customerId: summary.customerId,
        vendorId: vendor.id,
        expectedTaskId: draft.taskId!,
        expectedInputHash: draft.inputHash!,
        sourceMessageId: draft.sourceMessageId,
        providerMessageId: delivery.providerMessageId,
      });
      outcomes.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        recipient: draft.recipient,
        state: delivery.alreadySent ? "ALREADY_SENT" : "SENT",
        sender: delivery.accountEmail,
        attachments,
        providerMessageId: delivery.providerMessageId,
        error: null,
      });
    } catch (error) {
      if (error instanceof ProcurementReplyPriorDeliveryReconciledError) {
        outcomes.push({
          vendorId: vendor.id,
          vendorName: vendor.name,
          recipient: error.delivery.recipient,
          state: "FAILED",
          sender: error.delivery.accountEmail,
          attachments,
          providerMessageId: error.delivery.providerMessageId,
          error: error.message,
        });
        continue;
      }
      if (error instanceof ProcurementReplyStaleStateError && draft.taskId && draft.inputHash) {
        await cancelStaleProcurementFileDeliveryDraft({
          context: access,
          customerId: summary.customerId,
          order: live,
          vendorId: vendor.id,
          expectedTaskId: draft.taskId,
          expectedInputHash: draft.inputHash,
          reason: `${error.message} A new plan and confirmation are required.`,
        });
      }
      outcomes.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        recipient: draft.recipient,
        state: error instanceof ProcurementReplyStaleStateError ? "STALE" : "FAILED",
        sender: null,
        attachments,
        providerMessageId: null,
        error: error instanceof Error ? error.message : "The supplier reply send failed.",
      });
    }
  }
  const sent = outcomes.filter((outcome) => outcome.state === "SENT").length;
  const alreadySent = outcomes.filter((outcome) => outcome.state === "ALREADY_SENT").length;
  const stale = outcomes.filter((outcome) => outcome.state === "STALE").length;
  const superseded = outcomes.filter((outcome) => outcome.state === "SUPERSEDED").length;
  const failed = outcomes.filter((outcome) => outcome.state === "FAILED").length;
  return {
    orderId: summary.orderId,
    material: summary.material,
    drafts,
    sent,
    alreadySent,
    stale,
    superseded,
    failed,
    remaining: Math.max(0, drafts - sent - alreadySent - superseded),
    outcomes,
  };
}
