import "server-only";

import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { procurementVendorConversation } from "@/lib/procurement-conversation";
import {
  getProcurementFileDeliveryDraft,
  markProcurementFileDeliveryDraftSent,
} from "@/lib/procurement-file-delivery-draft";
import { procurementOperatorAccess } from "@/lib/procurement-operator-access";
import { sendProcurementSupplierReply } from "@/lib/procurement-reply-send";
import { getProcurementRequest } from "@/lib/procurement-workflow";

// Saved file bearing drafts are delivered from an operator command here. The
// command carries the operator confirmation that the dashboard Send Reply
// button carries, so it only ever sends a draft a human already asked for, and
// the underlying send path still refuses anything the thread does not support.

export const FILE_SEND_MAX_PER_RUN = 25;
export const FILE_SEND_CONFIRMATION = "SEND SUPPLIER FILES";

export type FileSendOutcome = {
  vendorId: string;
  vendorName: string;
  recipient: string;
  state: "SENT" | "ALREADY_SENT" | "FAILED";
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
  failed: number;
  remaining: number;
  outcomes: FileSendOutcome[];
};

export async function runProcurementFileDraftSendBatch(args: {
  orderId: string;
  limit?: number;
  // When present, only these suppliers may be delivered to. The sourcing loop
  // uses it so a thread it decided to escalate is never answered automatically.
  vendorIds?: readonly string[];
}): Promise<FileSendRunResult | null> {
  const summary = await loadBulkRfqOrder(args.orderId);
  if (!summary) return null;
  const order = await getProcurementRequest(summary.customerId, args.orderId);
  if (!order) return null;
  const access = await procurementOperatorAccess(summary.officeId);
  const limit = Math.min(FILE_SEND_MAX_PER_RUN, Math.max(1, Math.trunc(args.limit ?? FILE_SEND_MAX_PER_RUN)));
  const outcomes: FileSendOutcome[] = [];
  let drafts = 0;
  const allowed = args.vendorIds ? new Set(args.vendorIds) : null;
  for (const vendor of order.vendors) {
    if (allowed && !allowed.has(vendor.id)) continue;
    const draft = await getProcurementFileDeliveryDraft({
      officeId: summary.officeId,
      order,
      vendorId: vendor.id,
    });
    if (!draft) continue;
    drafts += 1;
    if (outcomes.length >= limit) continue;
    const attachments = draft.attachments.map((attachment) => attachment.name);
    try {
      const conversation = await procurementVendorConversation({
        officeId: summary.officeId,
        customerId: summary.customerId,
        orderId: order.id,
        vendorId: vendor.id,
      });
      const delivery = await sendProcurementSupplierReply({
        context: access,
        customerId: summary.customerId,
        order,
        vendor,
        conversation,
        input: {
          sourceMessageId: draft.sourceMessageId,
          recipient: draft.recipient,
          subject: draft.subject,
          body: draft.body,
          attachmentDocumentIds: draft.attachments.map((attachment) => attachment.documentId),
        },
      });
      await markProcurementFileDeliveryDraftSent({
        context: access,
        order,
        vendorId: vendor.id,
        sourceMessageId: draft.sourceMessageId,
        providerMessageId: delivery.providerMessageId,
      });
      outcomes.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        recipient: draft.recipient,
        state: delivery.alreadySent ? "ALREADY_SENT" : "SENT",
        attachments,
        providerMessageId: delivery.providerMessageId,
        error: null,
      });
    } catch (error) {
      outcomes.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        recipient: draft.recipient,
        state: "FAILED",
        attachments,
        providerMessageId: null,
        error: error instanceof Error ? error.message : "The supplier reply send failed.",
      });
    }
  }
  const sent = outcomes.filter((outcome) => outcome.state === "SENT").length;
  const alreadySent = outcomes.filter((outcome) => outcome.state === "ALREADY_SENT").length;
  const failed = outcomes.filter((outcome) => outcome.state === "FAILED").length;
  return {
    orderId: summary.orderId,
    material: summary.material,
    drafts,
    sent,
    alreadySent,
    failed,
    remaining: Math.max(0, drafts - sent - alreadySent),
    outcomes,
  };
}
