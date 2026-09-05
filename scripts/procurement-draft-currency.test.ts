import assert from "node:assert/strict";
import {
  PROCUREMENT_DRAFT_ANSWERED_REASON,
  PROCUREMENT_DRAFT_CHASE_ANSWERED_REASON,
  PROCUREMENT_DRAFT_OVERTAKEN_REASON,
  PROCUREMENT_DRAFT_UNREADABLE_REASON,
  procurementDraftCurrency,
  procurementDraftCurrencyConversation,
} from "../src/lib/procurement-draft-currency";

// A saved draft is only worth delivering while the thread still stands where it
// was saved. These cases pin which drafts are dropped, which are delivered, and
// which are left alone, because a draft that is neither delivered nor dropped is
// refused by the send path on every pass and its supplier is never answered.

function conversation(
  messages: readonly { id: string; direction: "INBOUND" | "OUTBOUND"; notice?: boolean }[],
  available = true,
) {
  return {
    available,
    messages: messages.map((message) => ({ ...message, notice: message.notice === true })),
  };
}

// The same transcript as the app reads it, so the classification of a notice is
// exercised on real supplier text rather than a hand set flag.
function transcript(
  messages: readonly { id: string; direction: "INBOUND" | "OUTBOUND"; subject?: string; body: string }[],
) {
  return procurementDraftCurrencyConversation({ available: true, messages });
}

// The reply the draft answers is still the newest message, so it goes out.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([
      { id: "out-1", direction: "OUTBOUND" },
      { id: "in-1", direction: "INBOUND" },
    ]),
    sourceMessageId: "in-1",
    variant: "REPLY",
  }),
  { deliverable: true },
);

// The answer already left, from this mailbox or a pooled one, so the draft is
// retired instead of being refused by the send path forever.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([
      { id: "in-1", direction: "INBOUND" },
      { id: "out-2", direction: "OUTBOUND" },
    ]),
    sourceMessageId: "in-1",
    variant: "REPLY",
  }),
  { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_ANSWERED_REASON },
);

// The supplier wrote again, so this draft answers a message that is no longer
// the live question and the thread is drafted afresh.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([
      { id: "in-1", direction: "INBOUND" },
      { id: "in-2", direction: "INBOUND" },
    ]),
    sourceMessageId: "in-1",
    variant: "REPLY",
  }),
  { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_OVERTAKEN_REASON },
);

// A follow up belongs on a thread the supplier left quiet.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([
      { id: "in-1", direction: "INBOUND" },
      { id: "out-2", direction: "OUTBOUND" },
    ]),
    sourceMessageId: "in-1",
    variant: "CHASE",
  }),
  { deliverable: true },
);

assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([
      { id: "in-1", direction: "INBOUND" },
      { id: "out-2", direction: "OUTBOUND" },
      { id: "in-3", direction: "INBOUND" },
    ]),
    sourceMessageId: "in-1",
    variant: "CHASE",
  }),
  { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_CHASE_ANSWERED_REASON },
);

// An out of office note is not a supplier answer and is never answered itself,
// so the question behind it is still owed this reply and the draft goes out.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: transcript([
      { id: "out-1", direction: "OUTBOUND", subject: "RFQ", body: "Our drawings are attached." },
      { id: "in-1", direction: "INBOUND", subject: "Re: RFQ", body: "What tolerance do you need on the board edge?" },
      { id: "in-2", direction: "INBOUND", subject: "Automatic reply: Re: RFQ", body: "I am out of the office until Monday with limited access to email." },
    ]),
    sourceMessageId: "in-1",
    variant: "REPLY",
  }),
  { deliverable: true },
);

// A bounce report is not a supplier message either.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: transcript([
      { id: "in-1", direction: "INBOUND", subject: "Re: RFQ", body: "Please confirm the annual volume." },
      { id: "in-2", direction: "INBOUND", subject: "Undelivered Mail Returned to Sender", body: "Delivery to the following recipient failed permanently: 550 5.1.1 user unknown." },
    ]),
    sourceMessageId: "in-1",
    variant: "REPLY",
  }),
  { deliverable: true },
);

// The supplier wrote again and that newer reply was answered, so this follow up
// answers a message the send path no longer accepts as the newest reply.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([
      { id: "in-1", direction: "INBOUND" },
      { id: "in-2", direction: "INBOUND" },
      { id: "out-3", direction: "OUTBOUND" },
    ]),
    sourceMessageId: "in-1",
    variant: "CHASE",
  }),
  { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_CHASE_ANSWERED_REASON },
);

// A follow up anchors on a supplier reply, so a transcript carrying none of them
// proves nothing and the draft waits.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([{ id: "out-1", direction: "OUTBOUND" }]),
    sourceMessageId: "in-1",
    variant: "CHASE",
  }),
  { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON },
);

// A reply whose stored source is one of our own messages answers nothing, and
// dropping it on that alone would risk dropping a draft on a misread thread.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([
      { id: "in-1", direction: "INBOUND" },
      { id: "out-2", direction: "OUTBOUND" },
    ]),
    sourceMessageId: "out-2",
    variant: "REPLY",
  }),
  { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON },
);

// A thread that could not be read proves nothing, so the draft waits rather
// than being dropped on a conversation the sources failed to return.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([{ id: "in-1", direction: "INBOUND" }], false),
    sourceMessageId: "in-1",
    variant: "REPLY",
  }),
  { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON },
);

assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([]),
    sourceMessageId: "in-1",
    variant: "REPLY",
  }),
  { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON },
);

// The transcript does not carry the message this draft answers, so an outbound
// last message is not proof that this draft was the one delivered.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([
      { id: "in-9", direction: "INBOUND" },
      { id: "out-9", direction: "OUTBOUND" },
    ]),
    sourceMessageId: "in-1",
    variant: "REPLY",
  }),
  { deliverable: false, retire: false, reason: PROCUREMENT_DRAFT_UNREADABLE_REASON },
);

// The source message is the last one on the thread and nothing followed it, so
// the draft is still owed to the supplier.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: conversation([
      { id: "out-1", direction: "OUTBOUND" },
      { id: "in-1", direction: "INBOUND" },
      { id: "in-2", direction: "INBOUND" },
    ]),
    sourceMessageId: "in-2",
    variant: "REPLY",
  }),
  { deliverable: true },
);

// An out of office note landing after our answer neither answers the follow up
// nor moves its anchor, so a due follow up still goes out on that thread.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: transcript([
      { id: "in-1", direction: "INBOUND", subject: "Re: RFQ", body: "We will review and come back to you." },
      { id: "out-2", direction: "OUTBOUND", subject: "Re: RFQ", body: "Thank you, the drawings are attached." },
      {
        id: "in-3",
        direction: "INBOUND",
        subject: "Automatic reply: Re: RFQ",
        body: "I am out of the office until Monday.",
      },
    ]),
    sourceMessageId: "in-1",
    variant: "CHASE",
  }),
  { deliverable: true },
);

// A bounce report after our answer is not the supplier writing either, so the
// follow up saved against their real reply is still the one owed.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: transcript([
      { id: "in-1", direction: "INBOUND", subject: "Re: RFQ", body: "Received, we will quote shortly." },
      { id: "out-2", direction: "OUTBOUND", subject: "Re: RFQ", body: "Thanks, here is the package." },
      {
        id: "in-3",
        direction: "INBOUND",
        subject: "Undelivered Mail Returned to Sender",
        body: "This is the mail delivery subsystem. Delivery to the following recipients failed.",
      },
    ]),
    sourceMessageId: "in-1",
    variant: "CHASE",
  }),
  { deliverable: true },
);

// A supplier who wrote again and was answered leaves the older follow up with
// nothing to chase, even though a notice sits on top of the thread.
assert.deepEqual(
  procurementDraftCurrency({
    conversation: transcript([
      { id: "in-1", direction: "INBOUND", subject: "Re: RFQ", body: "Received, we will quote shortly." },
      { id: "in-2", direction: "INBOUND", subject: "Re: RFQ", body: "What thickness do you need?" },
      { id: "out-3", direction: "OUTBOUND", subject: "Re: RFQ", body: "1.6 mm, as in the drawing." },
      {
        id: "in-4",
        direction: "INBOUND",
        subject: "Automatic reply: Re: RFQ",
        body: "I am on annual leave with no access to email.",
      },
    ]),
    sourceMessageId: "in-1",
    variant: "CHASE",
  }),
  { deliverable: false, retire: true, reason: PROCUREMENT_DRAFT_CHASE_ANSWERED_REASON },
);

console.log("procurement draft currency contract holds");
