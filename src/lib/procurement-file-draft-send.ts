import "server-only";

import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { procurementVendorConversation } from "@/lib/procurement-conversation";
import {
  getProcurementFileDeliveryDraft,
  markProcurementFileDeliveryDraftSent,
  procurementFileDraftSendDecision,
} from "@/lib/procurement-file-delivery-draft";
import { procurementOperatorAccess } from "@/lib/procurement-operator-access";
import { procurementRepliedVendors } from "@/lib/procurement-reply-scope";
import { sendProcurementSupplierReply } from "@/lib/procurement-reply-send";
import { getProcurementRequest } from "@/lib/procurement-workflow";

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
  state: "SENT" | "ALREADY_SENT" | "STALE" | "FAILED";
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
  // When the mailbox that owns a thread can no longer send, because it was
  // disconnected or paused by sender protection, deliver from a shared pool
  // mailbox instead of failing. The supplier reads the same answer with the
  // same files, threaded on its own message, from a different address.
  allowPooledSender?: boolean;
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
  // A draft only exists where a supplier replied, and rereading the request per
  // supplier row is what made a large campaign outlast its invocation limit, so
  // the run walks the repliers rather than every row.
  const candidates = await procurementRepliedVendors({
    officeId: summary.officeId,
    orderId: summary.orderId,
    vendors: order.vendors,
  });
  for (const listed of candidates.vendors) {
    if (allowed && !allowed.has(listed.id)) continue;
    // A run can hold a request open for several deliveries, so the request is
    // reread here rather than at the top: the recheck below has to compare the
    // draft with the request as it stands now, not as the run opened it.
    const live = await getProcurementRequest(summary.customerId, args.orderId);
    const vendor = live?.vendors.find((candidate) => candidate.id === listed.id) ?? null;
    const draft = live && vendor
      ? await getProcurementFileDeliveryDraft({ officeId: summary.officeId, order: live, vendorId: vendor.id })
      : null;
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
    if (!draft) continue;
    drafts += 1;
    if (outcomes.length >= limit) continue;
    const attachments = draft.attachments.map((attachment) => attachment.name);
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
      const conversation = await procurementVendorConversation({
        officeId: summary.officeId,
        customerId: summary.customerId,
        orderId: live.id,
        vendorId: vendor.id,
      });
      const delivery = await sendProcurementSupplierReply({
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
      });
      await markProcurementFileDeliveryDraftSent({
        context: access,
        order: live,
        vendorId: vendor.id,
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
      outcomes.push({
        vendorId: vendor.id,
        vendorName: vendor.name,
        recipient: draft.recipient,
        state: "FAILED",
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
  const failed = outcomes.filter((outcome) => outcome.state === "FAILED").length;
  return {
    orderId: summary.orderId,
    material: summary.material,
    drafts,
    sent,
    alreadySent,
    stale,
    failed,
    remaining: Math.max(0, drafts - sent - alreadySent),
    outcomes,
  };
}
