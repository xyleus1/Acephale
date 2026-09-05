// A saved supplier draft answers one message on one thread. The thread keeps
// moving after it is saved: the answer can leave from a pooled mailbox, the
// supplier can write again, or an operator can answer by hand. A draft the
// thread has moved past can never be delivered, since the send path refuses it,
// so it is retired rather than retried until someone looks. This rule is pure
// so both the draft scan and the send batch judge a draft the same way.

export type ProcurementDraftCurrencyVariant = "REPLY" | "CHASE";

export type ProcurementDraftCurrency =
  | { deliverable: true }
  // `retire` separates a draft that can never be delivered from one whose
  // thread simply could not be read: the first is dropped, the second is
  // retried on the next pass.
  | { deliverable: false; retire: boolean; reason: string };

export const PROCUREMENT_DRAFT_ANSWERED_REASON =
  "This supplier reply was already answered on the thread, so the saved draft is dropped.";
export const PROCUREMENT_DRAFT_OVERTAKEN_REASON =
  "The supplier wrote again after this draft was saved, so it is dropped and answered afresh.";
export const PROCUREMENT_DRAFT_CHASE_ANSWERED_REASON =
  "The supplier replied after this follow up was saved, so the follow up is dropped.";
export const PROCUREMENT_DRAFT_UNREADABLE_REASON =
  "The supplier conversation could not be read, so the saved draft waits for the next pass.";

export function procurementDraftCurrency(args: {
  conversation: {
    available: boolean;
    messages: readonly { id: string; direction: "INBOUND" | "OUTBOUND" }[];
  };
  sourceMessageId: string;
  variant: ProcurementDraftCurrencyVariant;
}): ProcurementDraftCurrency {
  const messages = args.conversation.messages;
  const latest = messages.at(-1);
  if (!args.conversation.available || !latest) {
    return { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON };
  }
  if (args.variant === "CHASE") {
    // A follow up only belongs on a thread the supplier left quiet. Once the
    // supplier has written again, the reply path owns the thread instead.
    return latest.direction === "INBOUND"
      ? { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_CHASE_ANSWERED_REASON }
      : { deliverable: true };
  }
  if (latest.direction === "INBOUND") {
    return latest.id === args.sourceMessageId
      ? { deliverable: true }
      : { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_OVERTAKEN_REASON };
  }
  // The thread ends with our own message. It is only proof that this draft was
  // answered when its own source message is still on the thread before that
  // answer: a transcript that does not carry the source at all proves nothing,
  // so such a draft is left for the next pass rather than dropped.
  const source = messages.findIndex((message) => message.id === args.sourceMessageId);
  if (source < 0) {
    return { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON };
  }
  const answered = messages
    .slice(source + 1)
    .some((message) => message.direction === "OUTBOUND");
  return answered
    ? { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_ANSWERED_REASON }
    : { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON };
}
