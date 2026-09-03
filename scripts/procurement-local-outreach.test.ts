import assert from "node:assert/strict";
import {
  localRfqConversationFor,
  overlayRequestOutreach,
  overlayVendorOutreach,
  rfqSubjectReference,
  rfqSubjectReferenceToken,
  summarizeLocalRfqOutreach,
  summarizeLocalRfqOutreachByOrder,
  type LocalRfqMessage,
} from "../src/lib/procurement-local-outreach-model";

const orderId = "e3f6cacc-ca34-4d01-a787-c09da6805bce";
const reference = rfqSubjectReference(orderId);

function message(overrides: Partial<LocalRfqMessage>): LocalRfqMessage {
  return {
    id: "message-1",
    threadId: "thread-1",
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

// A shop answers from whoever picks the enquiry up, so the reply carries a
// different address than the one we mailed while staying on our thread.
const colleagueReply = [
  message({ threadId: "thread-2", toEmails: ["sales@mfg-one.com"] }),
  message({
    id: "message-8",
    threadId: "thread-2",
    direction: "INBOUND",
    fromEmail: "mluna@mfg-one.com",
    toEmails: ["desk@derya.ai"],
    subject: "Re: HypnoDreamz Manufacturing Opportunity",
    body: "We can build this.",
    sentAt: "2026-08-22T09:00:00.000Z",
  }),
];
const colleague = summarizeLocalRfqOutreach(colleagueReply);
assert.deepEqual(
  [...colleague.respondedEmails].sort(),
  ["mluna@mfg-one.com", "sales@mfg-one.com"],
  "a reply from another address at the shop we mailed answers for that shop",
);
assert.equal(colleague.responded, 1, "one shop answering once is one response");
assert.equal(
  overlayVendorOutreach(
    { contacted: false, responseCount: 0, contact: { email: "sales@mfg-one.com" } },
    colleague,
  ).responseCount,
  1,
);
const colleagueConversation = localRfqConversationFor(colleagueReply, "sales@mfg-one.com");
assert.deepEqual(
  colleagueConversation?.messages.map((entry) => [entry.direction, entry.fromEmail]),
  [["OUTBOUND", "desk@derya.ai"], ["INBOUND", "mluna@mfg-one.com"]],
  "the reply reaches the supplier's conversation so it can be read for a quote",
);
assert.deepEqual(
  colleagueConversation?.attributedSenders,
  ["mluna@mfg-one.com"],
  "the conversation vouches for the colleague address so the answer can be sent to it",
);
assert.deepEqual(
  localRfqConversationFor(colleagueReply, "mluna@mfg-one.com")?.attributedSenders,
  [],
  "a supplier recorded under the address that wrote to us needs no vouching",
);

const bounced = [
  message({ threadId: "thread-3", toEmails: ["sales@closedshop.com"] }),
  message({
    id: "message-9",
    threadId: "thread-3",
    direction: "INBOUND",
    fromEmail: "mailer-daemon@googlemail.com",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery Status Notification (Failure)",
    body: "Address not found.",
    sentAt: "2026-08-22T10:00:00.000Z",
  }),
];
const bounce = summarizeLocalRfqOutreach(bounced);
assert.equal(bounce.responded, 0, "a bounce is the mail system speaking, not the supplier");
assert.deepEqual(bounce.respondedEmails, []);
assert.equal(
  localRfqConversationFor(bounced, "sales@closedshop.com")?.messages.length,
  1,
  "only our own send belongs to a supplier that never answered",
);

// A provider reports the failure in its own words from its own address, and a
// pooled mailbox with no account row still syncs a copy of our own send back.
const providerBounce = summarizeLocalRfqOutreach([
  message({ threadId: "thread-6", accountEmail: null, toEmails: ["sales@goneshop.com"] }),
  message({
    id: "message-12",
    threadId: "thread-6",
    direction: "INBOUND",
    accountEmail: null,
    fromEmail: "postmaster@mailrelay.example",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery failure",
    body: "Address not found for sales@goneshop.com.",
    sentAt: "2026-08-22T13:00:00.000Z",
  }),
  message({
    id: "message-13",
    threadId: "thread-6",
    direction: "INBOUND",
    accountEmail: null,
    fromEmail: "desk@derya.ai",
    toEmails: ["sales@goneshop.com"],
    body: "Synced copy of our own send from a mailbox with no account row.",
    sentAt: "2026-08-22T14:00:00.000Z",
  }),
]);
assert.equal(providerBounce.responded, 0, "a bounce and our own synced send are not answers");
assert.deepEqual(providerBounce.respondedEmails, []);
assert.equal(
  localRfqConversationFor(
    [
      message({ threadId: "thread-6", accountEmail: null, toEmails: ["sales@goneshop.com"] }),
      message({
        id: "message-12",
        threadId: "thread-6",
        direction: "INBOUND",
        accountEmail: null,
        fromEmail: "postmaster@mailrelay.example",
        toEmails: ["desk@derya.ai"],
        subject: "Delivery failure",
        body: "Address not found for sales@goneshop.com.",
        sentAt: "2026-08-22T13:00:00.000Z",
      }),
    ],
    "sales@goneshop.com",
  )?.messages.length,
  1,
  "a bounce never enters the supplier's conversation",
);

// A supplier writing about failed inspections uses the same words a bounce
// does, so wording only counts where a mail system puts it.
const commercial = summarizeLocalRfqOutreach([
  message({ threadId: "thread-7", toEmails: ["sales@realshop.com"] }),
  message({
    id: "message-14",
    threadId: "thread-7",
    direction: "INBOUND",
    fromEmail: "sales@realshop.com",
    toEmails: ["desk@derya.ai"],
    subject: "Re: your enquiry",
    body: "Unit price USD 41.20, and delivery failed inspections are re-worked at our cost.",
    sentAt: "2026-08-22T15:00:00.000Z",
  }),
]);
assert.equal(commercial.responded, 1, "commercial prose about failed inspections is a real answer");

// A service that reports the failure in its own words, from an address that
// looks like anyone else's, is still the mail system speaking.
const wordedBounce = summarizeLocalRfqOutreach([
  message({ threadId: "thread-8", toEmails: ["sales@deadshop.com"] }),
  message({
    id: "message-15",
    threadId: "thread-8",
    direction: "INBOUND",
    fromEmail: "noreply@mailservice.test",
    toEmails: ["desk@derya.ai"],
    subject: "Re: your enquiry",
    body: "Your message wasn't delivered to sales@deadshop.com because the domain does not exist.",
    sentAt: "2026-08-22T16:00:00.000Z",
  }),
]);
assert.equal(wordedBounce.responded, 0, "a provider failure report is never an answer");

const forwarded = summarizeLocalRfqOutreach([
  message({ threadId: "thread-4", toEmails: ["sales@moldshop.com"] }),
  message({
    id: "message-10",
    threadId: "thread-4",
    direction: "INBOUND",
    fromEmail: "tickets@helpdesk.example",
    toEmails: ["desk@derya.ai"],
    subject: "Your enquiry",
    body: "Our molder will follow up.",
    sentAt: "2026-08-22T11:00:00.000Z",
  }),
]);
assert.deepEqual(
  [...forwarded.respondedEmails].sort(),
  ["sales@moldshop.com", "tickets@helpdesk.example"],
  "a forwarder answering for the single shop we mailed answers for it",
);

const shared = summarizeLocalRfqOutreach([
  message({ threadId: "thread-5", toEmails: ["sales@shopone.com", "sales@shoptwo.com"] }),
  message({
    id: "message-11",
    threadId: "thread-5",
    direction: "INBOUND",
    fromEmail: "tickets@helpdesk.example",
    toEmails: ["desk@derya.ai"],
    subject: "Your enquiry",
    body: "Noted.",
    sentAt: "2026-08-22T12:00:00.000Z",
  }),
]);
assert.deepEqual(
  shared.respondedEmails,
  ["tickets@helpdesk.example"],
  "a thread mailed to two unrelated shops answers for neither",
);

const otherOrderId = "24cb31bd-d974-4040-939c-cd8e76dd8967";
const otherReference = rfqSubjectReference(otherOrderId);
const batched = summarizeLocalRfqOutreachByOrder(
  [
    ...messages,
    message({
      id: "message-5",
      subject: `${otherReference} PCBA quote request`,
      toEmails: ["rfq@boardshop.com"],
    }),
    message({ id: "message-6", subject: "Unrelated sales outreach", toEmails: ["lead@example.com"] }),
  ],
  [orderId, otherOrderId],
);
assert.deepEqual([...batched.keys()], [orderId, otherOrderId]);
assert.equal(batched.get(orderId)?.contacted, 2, "batch grouping matches the foam order only");
assert.deepEqual(batched.get(otherOrderId)?.contactedEmails, ["rfq@boardshop.com"]);
assert.equal(batched.get(otherOrderId)?.responded, 0);

const missingOrder = summarizeLocalRfqOutreachByOrder([], [orderId]);
assert.equal(missingOrder.get(orderId)?.contacted, 0, "an order with no local mail reports zero");


assert.equal(rfqSubjectReferenceToken(orderId.toUpperCase()), "e3f6cacc");

const mixedCase = summarizeLocalRfqOutreachByOrder(
  [message({ subject: `RE: ${reference.toUpperCase()} quote`, fromEmail: "sales@fefl.com.my", direction: "INBOUND", toEmails: ["desk@derya.ai"] })],
  [orderId],
);
assert.equal(mixedCase.get(orderId)?.responded, 1, "reference matching ignores subject case");

console.log("procurement-local-outreach: all assertions passed");
