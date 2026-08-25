import assert from "node:assert/strict";
import {
  localRfqConversationFor,
  overlayRequestOutreach,
  overlayVendorOutreach,
  rfqSubjectReference,
  summarizeLocalRfqOutreach,
  type LocalRfqMessage,
} from "../src/lib/procurement-local-outreach-model";

const orderId = "e3f6cacc-ca34-4d01-a787-c09da6805bce";
const reference = rfqSubjectReference(orderId);

function message(overrides: Partial<LocalRfqMessage>): LocalRfqMessage {
  return {
    id: "message-1",
    direction: "OUTBOUND",
    fromEmail: "desk@derya.ai",
    fromName: "Derya Desk",
    toEmails: ["sales@fefl.com.my"],
    ccEmails: [],
    subject: `${reference} Custom memory foam parts, 100 units`,
    body: "Request for quotation.",
    sentAt: "2026-08-20T10:00:00.000Z",
    accountEmail: "desk@derya.ai",
    externalThreadId: "thread-1",
    ...overrides,
  };
}

assert.equal(reference, "[RFQ e3f6cacc]");

const messages: LocalRfqMessage[] = [
  message({}),
  message({ id: "message-2", toEmails: ["Sales Team <quotes@example.com>"] }),
  message({
    id: "message-3",
    direction: "INBOUND",
    fromEmail: "Sales@FEFL.com.my",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "We can mold that part.",
    sentAt: "2026-08-21T09:00:00.000Z",
  }),
  message({
    id: "message-4",
    direction: "INBOUND",
    fromEmail: "desk@derya.ai",
    toEmails: ["desk@derya.ai"],
    body: "Synced copy of our own send.",
  }),
];

const outreach = summarizeLocalRfqOutreach(messages);
assert.equal(outreach.contacted, 2, "both recipients count as contacted");
assert.equal(outreach.responded, 1, "our own account is not a supplier response");
assert.deepEqual(outreach.contactedEmails.sort(), ["quotes@example.com", "sales@fefl.com.my"]);
assert.deepEqual(outreach.respondedEmails, ["sales@fefl.com.my"]);

const overlaid = overlayRequestOutreach(
  { id: orderId, contactedCount: 3, responseCount: 0 },
  { contacted: 100, responded: 2, contactedEmails: [], respondedEmails: [] },
);
assert.equal(overlaid.contactedCount, 100, "local ledger raises a stale workflow count");
assert.equal(overlaid.responseCount, 2);

const keptWorkflowCount = overlayRequestOutreach(
  { contactedCount: 165, responseCount: 4 },
  { contacted: 2, responded: 0, contactedEmails: [], respondedEmails: [] },
);
assert.equal(keptWorkflowCount.contactedCount, 165, "the workflow count is never lowered");
assert.equal(keptWorkflowCount.responseCount, 4);

const vendor = overlayVendorOutreach(
  { contacted: false, responseCount: 0, contact: { email: "SALES@fefl.com.my" } },
  outreach,
);
assert.equal(vendor.contacted, true, "a sent RFQ marks the supplier contacted");
assert.equal(vendor.responseCount, 1);

const untouched = overlayVendorOutreach(
  { contacted: false, responseCount: 0, contact: null },
  outreach,
);
assert.equal(untouched.contacted, false, "a supplier without an email stays uncontacted");

const conversation = localRfqConversationFor(messages, "sales@fefl.com.my");
assert.ok(conversation, "the sent RFQ and its reply resolve into a conversation");
assert.equal(conversation.available, true);
assert.equal(conversation.source, "DERYA_EMAIL_RECORD");
assert.equal(conversation.messages.length, 2);
assert.deepEqual(conversation.messages.map((entry) => entry.direction), ["OUTBOUND", "INBOUND"]);
assert.equal(conversation.accountEmail, "desk@derya.ai");
assert.ok(conversation.sourceUrl?.includes("thread-1"));

assert.equal(
  localRfqConversationFor(messages, "nobody@example.com"),
  null,
  "an uncontacted supplier has no conversation",
);

console.log("procurement-local-outreach: all assertions passed");
