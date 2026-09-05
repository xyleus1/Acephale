// A saved supplier draft answers one message on one thread. The thread keeps
// moving after it is saved: the answer can leave from a pooled mailbox, the
// supplier can write again, or an operator can answer by hand. A draft the
// thread has moved past can never be delivered, since the send path refuses it,
// so it is retired rather than retried until someone looks. This rule is pure
// so both the draft scan and the send batch judge a draft the same way.

import { supplierInboundNotice } from "@/lib/procurement-inbound-triage";

export type ProcurementDraftCurrencyVariant = "REPLY" | "CHASE";

export type ProcurementDraftCurrency =
  | { deliverable: true }
  // `retire` separates a draft that can never be delivered from one whose
  // thread simply could not be read: the first is dropped, the second is
  // retried on the next pass.
  | { deliverable: false; retire: boolean; reason: string };

// An out of office note or a bounce report carries nothing to answer and is
// never itself answered, so it does not take a supplier question away from the
// draft that answers it.
export type ProcurementDraftCurrencyMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  notice: boolean;
};

export type ProcurementDraftCurrencyConversation = {
  available: boolean;
  messages: readonly ProcurementDraftCurrencyMessage[];
};

export const PROCUREMENT_DRAFT_ANSWERED_REASON =
  "This supplier reply was already answered on the thread, so the saved draft is dropped.";
export const PROCUREMENT_DRAFT_OVERTAKEN_REASON =
  "The supplier wrote again after this draft was saved, so it is dropped and answered afresh.";
export const PROCUREMENT_DRAFT_CHASE_ANSWERED_REASON =
  "The supplier replied after this follow up was saved, so the follow up is dropped.";
export const PROCUREMENT_DRAFT_UNREADABLE_REASON =
  "The supplier conversation could not be read, so the saved draft waits for the next pass.";

// The one place a transcript becomes currency input, so the draft scan and the
// send batch cannot disagree about which inbound messages are notices.
export function procurementDraftCurrencyConversation(conversation: {
  available: boolean;
  messages: readonly { id: string; direction: "INBOUND" | "OUTBOUND"; subject?: string | null; body: string }[];
}): ProcurementDraftCurrencyConversation {
  return {
    available: conversation.available,
    messages: conversation.messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      notice: message.direction === "INBOUND"
        && supplierInboundNotice(message.subject ?? "", message.body),
    })),
  };
}

export function procurementDraftCurrency(args: {
  conversation: ProcurementDraftCurrencyConversation;
  sourceMessageId: string;
  variant: ProcurementDraftCurrencyVariant;
}): ProcurementDraftCurrency {
  const messages = args.conversation.messages;
  const latest = messages.at(-1);
  if (!args.conversation.available || !latest) {
    return { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON };
  }
  if (args.variant === "CHASE") {
    // A follow up only belongs on a thread the supplier left quiet, and the
    // send path anchors it on the supplier's newest reply, notices aside. Once
    // the supplier has written again, the reply path owns the thread instead,
    // and a notice neither answers the follow up nor moves its anchor.
    const written = messages.filter((message) => !message.notice);
    const newest = written.at(-1);
    if (!newest) {
      return { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON };
    }
    if (newest.direction === "INBOUND") {
      return { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_CHASE_ANSWERED_REASON };
    }
    const newestInbound = [...written].reverse().find((message) => message.direction === "INBOUND") ?? null;
    if (!newestInbound) {
      return { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON };
    }
    return newestInbound.id === args.sourceMessageId
      ? { deliverable: true }
      : { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_CHASE_ANSWERED_REASON };
  }
  // A reply is deliverable while its own source message is still the message
  // the thread waits on. A transcript that does not carry the source at all
  // proves nothing, so such a draft is left for the next pass rather than
  // dropped.
  const source = messages.findIndex((message) => message.id === args.sourceMessageId);
  if (source < 0 || messages[source]?.direction !== "INBOUND") {
    return { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON };
  }
  const after = messages.slice(source + 1);
  if (after.some((message) => message.direction === "OUTBOUND")) {
    return { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_ANSWERED_REASON };
  }
  return after.some((message) => message.direction === "INBOUND" && !message.notice)
    ? { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_OVERTAKEN_REASON }
    : { deliverable: true };
}
