import assert from "node:assert/strict";
import {
  PROCUREMENT_DRAFT_ANSWERED_REASON,
  PROCUREMENT_DRAFT_CHASE_ANSWERED_REASON,
  PROCUREMENT_DRAFT_OVERTAKEN_REASON,
  PROCUREMENT_DRAFT_UNREADABLE_REASON,
  procurementDraftCurrency,
} from "../src/lib/procurement-draft-currency";

// A saved draft is only worth delivering while the thread still stands where it
// was saved. These cases pin which drafts are dropped, which are delivered, and
// which are left alone, because a draft that is neither delivered nor dropped is
// refused by the send path on every pass and its supplier is never answered.

function conversation(
  messages: readonly { id: string; direction: "INBOUND" | "OUTBOUND" }[],
  available = true,
) {
  return { available, messages };
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

console.log("procurement draft currency contract holds");
