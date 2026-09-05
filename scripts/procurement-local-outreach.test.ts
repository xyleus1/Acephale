import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  attributeLocalRfqThread,
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

// Reading a conversation per supplier row is what pushed a large campaign past
// its invocation limit and left real replies unanswered, so the reply passes
// scan the repliers this overlay identifies, not the whole request.
const replyScopeSource = readFileSync(resolve(__dirname, "../src/lib/procurement-reply-scope.ts"), "utf8");
assert.ok(
  /localRfqRespondentEmails/.test(replyScopeSource)
    && /responseCount > 0/.test(replyScopeSource),
  "the reply scope counts a locally synced reply as a reply",
);
// The presentation summary keeps only the newest messages of an order, so a
// reply older than that window would drop its supplier out of processing
// altogether. Respondents are read across the whole order history instead.
const outreachSource = readFileSync(resolve(__dirname, "../src/lib/procurement-local-outreach.ts"), "utf8");
assert.ok(
  !/localRfqOutreach\(/.test(replyScopeSource)
    && /export async function localRfqRespondentEmails/.test(outreachSource)
    && /message\."direction" = 'INBOUND'/.test(outreachSource),
  "respondents are read from the whole order history, not the capped summary",
);
assert.ok(
  /LOCAL_RFQ_RESPONDENT_PAGE/.test(outreachSource)
    && /message\."sentAt", message\."id"\) < /.test(outreachSource),
  "the respondent read pages through the history rather than capping it",
);
// A history long enough to outlast a scheduled pass must not spend the whole
// invocation before a single answer is sent, so the read stops at the caller's
// deadline, newest mail first, and says the set is a prefix.
assert.ok(
  /options\?\: \{ outOfTime\?\: \(\) => boolean \}/.test(outreachSource)
    && /if \(options\?\.outOfTime\?\.\(\)\) \{/.test(outreachSource)
    && /complete: false/.test(outreachSource)
    && /ORDER BY message\."sentAt" DESC/.test(outreachSource),
  "the respondent read stops at the caller deadline and reads the newest mail first",
);
assert.ok(
  /outOfTime\?\: \(\) => boolean/.test(replyScopeSource)
    && /complete: respondents\.complete/.test(replyScopeSource),
  "the reply scope carries the deadline in and the completeness out",
);
for (const [moduleName, expected] of [
  ["procurement-autopilot", /const stopped = !scanned\.complete;/],
  ["procurement-file-draft-batch", /outOfTime,/],
  ["procurement-supplier-quote", /outOfTime: input\.outOfTime,/],
] as const) {
  const source = readFileSync(resolve(__dirname, `../src/lib/${moduleName}.ts`), "utf8");
  assert.ok(
    expected.test(source),
    `${moduleName} treats a respondent read cut short as unfinished work`,
  );
}
for (const moduleName of ["procurement-autopilot", "procurement-file-draft-batch"]) {
  const source = readFileSync(resolve(__dirname, `../src/lib/${moduleName}.ts`), "utf8");
  assert.ok(
    /procurementRepliedVendors/.test(source),
    `${moduleName} walks the suppliers that replied instead of every supplier row`,
  );
  assert.ok(
    !/for \(const vendor of (context\.order|args\.order)\.vendors\)/.test(source),
    `${moduleName} does not read a conversation for every supplier row`,
  );
}

// One anchored thread, read the way the stored email record path reads it: the
// shop answered from a colleague address, so that reply is the supplier's own
// message. Reading such a thread by the mailed address alone left it with our
// sends only, which every pass then reported as a conversation it could not
// read while the supplier waited for an answer forever.
const anchoredThread: LocalRfqMessage[] = [
  message({ id: "anchor-1", threadId: "thread-9", toEmails: ["sales@mfg-one.com"], externalThreadId: "thread-9" }),
  message({
    id: "anchor-2",
    threadId: "thread-9",
    externalThreadId: "thread-9",
    direction: "INBOUND",
    fromEmail: "helpdesk@mfg-one.com",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "Which finish do you need?",
    sentAt: "2026-08-23T09:00:00.000Z",
    rfcMessageId: "<reply-9@mfg-one.com>",
  }),
  message({
    id: "anchor-3",
    threadId: "thread-9",
    externalThreadId: "thread-9",
    direction: "INBOUND",
    fromEmail: "mailer-daemon@googlemail.com",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery Status Notification (Failure)",
    body: "Address not found.",
    sentAt: "2026-08-23T09:05:00.000Z",
  }),
];
const anchoredAttribution = attributeLocalRfqThread(anchoredThread, "sales@mfg-one.com");
assert.deepEqual(
  [...anchoredAttribution.inboundIds],
  ["anchor-2"],
  "a colleague reply on the thread we mailed is the supplier's own inbound message",
);
assert.deepEqual(
  anchoredAttribution.attributedSenders,
  ["helpdesk@mfg-one.com"],
  "the address that wrote the reply is vouched for so the answer can be sent to it",
);
const anchoredConversation = localRfqConversationFor(anchoredThread, "sales@mfg-one.com");
assert.deepEqual(
  anchoredConversation?.messages.map((entry) => [entry.direction, entry.id]),
  [["OUTBOUND", "anchor-1"], ["INBOUND", "anchor-2"]],
  "the anchored thread yields an answerable supplier conversation and drops the bounce",
);
assert.equal(
  anchoredConversation?.messages.find((entry) => entry.id === "anchor-2")?.rfcMessageId,
  "<reply-9@mfg-one.com>",
  "the RFC id is carried so an answer already on the thread is not recorded twice",
);

// A shop whose ticketing system answers from another domain keeps its thread
// after we answer that address: our own answer puts the ticketing address on
// the thread, and letting it claim the thread as a contact of its own dropped
// every ticketing message out of the supplier's conversation from the second
// message onwards, which is the same unanswerable transcript all over again.
const ticketingThread: LocalRfqMessage[] = [
  message({ id: "ticket-1", threadId: "thread-7", toEmails: ["sales@supplier.com"], externalThreadId: "thread-7" }),
  message({
    id: "ticket-2",
    threadId: "thread-7",
    externalThreadId: "thread-7",
    direction: "INBOUND",
    fromEmail: "tickets@helpdesk.example",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "Ticket 4821 opened. Which finish do you need?",
    sentAt: "2026-08-24T09:00:00.000Z",
  }),
  message({
    id: "ticket-3",
    threadId: "thread-7",
    externalThreadId: "thread-7",
    toEmails: ["tickets@helpdesk.example"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "Matte finish, 100 units.",
    sentAt: "2026-08-24T10:00:00.000Z",
  }),
  message({
    id: "ticket-4",
    threadId: "thread-7",
    externalThreadId: "thread-7",
    direction: "INBOUND",
    fromEmail: "tickets@helpdesk.example",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "USD 6.20 per unit, 3 weeks.",
    sentAt: "2026-08-25T09:00:00.000Z",
  }),
];
const ticketingConversation = localRfqConversationFor(ticketingThread, "sales@supplier.com");
assert.deepEqual(
  ticketingConversation?.messages.map((entry) => entry.id),
  ["ticket-1", "ticket-2", "ticket-3", "ticket-4"],
  "answering a ticketing address does not take the thread away from the supplier we mailed",
);
assert.deepEqual(
  ticketingConversation?.attributedSenders,
  ["tickets@helpdesk.example"],
  "the ticketing address stays vouched for after we have answered it",
);
assert.equal(
  summarizeLocalRfqOutreach(ticketingThread).responded,
  1,
  "the shop still counts as having answered once",
);

// A thread we opened to two unrelated shops still attributes nothing, since the
// reply could belong to either of them.
const ambiguousThread: LocalRfqMessage[] = [
  message({
    id: "ambiguous-1",
    threadId: "thread-8",
    externalThreadId: "thread-8",
    toEmails: ["sales@one.com", "quotes@two.com"],
  }),
  message({
    id: "ambiguous-2",
    threadId: "thread-8",
    externalThreadId: "thread-8",
    direction: "INBOUND",
    fromEmail: "estimating@three.com",
    toEmails: ["desk@derya.ai"],
    body: "We can quote this.",
    sentAt: "2026-08-26T09:00:00.000Z",
  }),
];
assert.deepEqual(
  [...attributeLocalRfqThread(ambiguousThread, "sales@one.com").inboundIds],
  [],
  "a stranger on a thread mailed to two unrelated shops is attributed to neither",
);

// An RFQ that bounced and was resent to a corrected address still anchors on
// the corrected one: a delivery notice is not the supplier's reply, so it must
// not close the anchoring window before the corrected send.
const correctedThread: LocalRfqMessage[] = [
  message({ id: "corrected-1", threadId: "thread-6", externalThreadId: "thread-6", toEmails: ["old@wrongdomain.com"] }),
  message({
    id: "corrected-2",
    threadId: "thread-6",
    externalThreadId: "thread-6",
    direction: "INBOUND",
    fromEmail: "mailer-daemon@googlemail.com",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery Status Notification (Failure)",
    body: "Your message to old@wrongdomain.com could not be delivered. Address not found.",
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  message({
    id: "corrected-3",
    threadId: "thread-6",
    externalThreadId: "thread-6",
    toEmails: ["sales@corrected.com"],
    sentAt: "2026-08-27T10:00:00.000Z",
  }),
  message({
    id: "corrected-4",
    threadId: "thread-6",
    externalThreadId: "thread-6",
    direction: "INBOUND",
    fromEmail: "quotes@corrected.com",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "What density do you need?",
    sentAt: "2026-08-28T09:00:00.000Z",
  }),
];
assert.deepEqual(
  [...attributeLocalRfqThread(correctedThread, "sales@corrected.com").inboundIds],
  ["corrected-4"],
  "a colleague reply after a bounce and a corrected send belongs to the corrected supplier",
);

// The bounced address stops anchoring the thread, so a forwarder answering for
// the corrected supplier from an unrelated domain is not read as ambiguous
// between one live address and one dead one.
const forwardedAfterBounce: LocalRfqMessage[] = [
  ...correctedThread.slice(0, 3),
  message({
    id: "corrected-5",
    threadId: "thread-6",
    externalThreadId: "thread-6",
    direction: "INBOUND",
    fromEmail: "desk@forwarder.example",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "We handle quotes for them. What density do you need?",
    sentAt: "2026-08-28T11:00:00.000Z",
  }),
];
assert.deepEqual(
  [...attributeLocalRfqThread(forwardedAfterBounce, "sales@corrected.com").inboundIds],
  ["corrected-5"],
  "a forwarder reply is attributed to the address still live on the thread",
);

// A delay or a full mailbox is not proof an address is dead, so it keeps its
// claim on the thread.
const delayedThread: LocalRfqMessage[] = [
  correctedThread[0],
  message({
    id: "delayed-2",
    threadId: "thread-6",
    externalThreadId: "thread-6",
    direction: "INBOUND",
    fromEmail: "mailer-daemon@googlemail.com",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery Status Notification (Delay)",
    body: "Your message to old@wrongdomain.com has been delayed. Will try again later.",
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  message({
    id: "delayed-3",
    threadId: "thread-6",
    externalThreadId: "thread-6",
    direction: "INBOUND",
    fromEmail: "orders@wrongdomain.com",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "Got it late, what density do you need?",
    sentAt: "2026-08-28T09:00:00.000Z",
  }),
];
assert.deepEqual(
  [...attributeLocalRfqThread(delayedThread, "old@wrongdomain.com").inboundIds],
  ["delayed-3"],
  "a delayed delivery does not take the thread away from the address we mailed",
);

// A report naming several recipients only retires the ones it reports as
// permanently failed, so the recipient whose mailbox was merely full still
// claims the thread.
const mixedReportThread: LocalRfqMessage[] = [
  message({
    id: "mixed-1",
    threadId: "thread-8",
    externalThreadId: "thread-8",
    toEmails: ["dead@wrongdomain.com", "sales@supplier.com"],
  }),
  message({
    id: "mixed-2",
    threadId: "thread-8",
    externalThreadId: "thread-8",
    direction: "INBOUND",
    fromEmail: "mailer-daemon@googlemail.com",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery Status Notification (Failure)",
    body: [
      "Final-Recipient: rfc822; dead@wrongdomain.com",
      "Action: failed",
      "Status: 5.1.1",
      "",
      "Final-Recipient: rfc822; sales@supplier.com",
      "Action: failed",
      "Status: 4.2.2",
    ].join("\n"),
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  message({
    id: "mixed-3",
    threadId: "thread-8",
    externalThreadId: "thread-8",
    direction: "INBOUND",
    fromEmail: "desk@forwarder.example",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "We handle their quotes. What density do you need?",
    sentAt: "2026-08-28T09:00:00.000Z",
  }),
];
assert.deepEqual(
  [...attributeLocalRfqThread(mixedReportThread, "sales@supplier.com").inboundIds],
  ["mixed-3"],
  "only the permanently failed recipient of a mixed report loses its claim on the thread",
);

// A provider that reports a dead address in its own wording, with no delivery
// status fields, still retires that address and only that address.
const nonStandardNoticeThread: LocalRfqMessage[] = [
  correctedThread[0],
  message({
    id: "nonstandard-2",
    threadId: "thread-6",
    externalThreadId: "thread-6",
    direction: "INBOUND",
    fromEmail: "mail-router@wrongdomain.com",
    toEmails: ["desk@derya.ai"],
    subject: "Notice",
    body: [
      "Delivery failure",
      "To: old@wrongdomain.com",
      "old@wrongdomain.com: user unknown",
      "Questions? Write to support@wrongdomain.com",
    ].join("\n"),
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  correctedThread[2],
  message({
    id: "nonstandard-4",
    threadId: "thread-6",
    externalThreadId: "thread-6",
    direction: "INBOUND",
    fromEmail: "desk@forwarder.example",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "We handle their quotes. What density do you need?",
    sentAt: "2026-08-28T09:00:00.000Z",
  }),
];
assert.deepEqual(
  [...attributeLocalRfqThread(nonStandardNoticeThread, "sales@corrected.com").inboundIds],
  ["nonstandard-4"],
  "a notice in a provider's own wording still retires the address it gave up on",
);

const heldNoticeThread: LocalRfqMessage[] = [
  correctedThread[0],
  message({
    id: "held-2",
    threadId: "thread-6",
    externalThreadId: "thread-6",
    direction: "INBOUND",
    fromEmail: "mail-router@wrongdomain.com",
    toEmails: ["desk@derya.ai"],
    subject: "Notice",
    body: "Delivery failure\nold@wrongdomain.com: delivery failed, mailbox full, we will try again later.",
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  message({
    id: "held-3",
    threadId: "thread-6",
    externalThreadId: "thread-6",
    direction: "INBOUND",
    fromEmail: "orders@wrongdomain.com",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "Cleared the inbox, what density do you need?",
    sentAt: "2026-08-28T09:00:00.000Z",
  }),
];
assert.deepEqual(
  [...attributeLocalRfqThread(heldNoticeThread, "old@wrongdomain.com").inboundIds],
  ["held-3"],
  "a full mailbox in a provider's own wording keeps the address we mailed",
);

const mixedNonStandardThread: LocalRfqMessage[] = [
  message({
    id: "mixed-ns-1",
    threadId: "thread-9",
    externalThreadId: "thread-9",
    toEmails: ["dead@wrongdomain.com", "sales@supplier.com"],
  }),
  message({
    id: "mixed-ns-2",
    threadId: "thread-9",
    externalThreadId: "thread-9",
    direction: "INBOUND",
    fromEmail: "mail-router@wrongdomain.com",
    toEmails: ["desk@derya.ai"],
    subject: "Notice",
    body: [
      "Delivery failure",
      "dead@wrongdomain.com: user unknown",
      "sales@supplier.com: mailbox full, we will try again later",
    ].join("\n"),
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  message({
    id: "mixed-ns-3",
    threadId: "thread-9",
    externalThreadId: "thread-9",
    direction: "INBOUND",
    fromEmail: "desk@forwarder.example",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "We handle their quotes. What density do you need?",
    sentAt: "2026-08-28T09:00:00.000Z",
  }),
];
assert.deepEqual(
  [...attributeLocalRfqThread(mixedNonStandardThread, "sales@supplier.com").inboundIds],
  ["mixed-ns-3"],
  "a nonstandard report retires the address it gave up on and keeps the one it retries",
);

const delayedSubjectThread: LocalRfqMessage[] = [
  message({
    id: "delayed-subject-1",
    threadId: "thread-10",
    externalThreadId: "thread-10",
    toEmails: ["sales@supplier.com", "orders@supplier.com"],
  }),
  message({
    id: "delayed-subject-2",
    threadId: "thread-10",
    externalThreadId: "thread-10",
    direction: "INBOUND",
    fromEmail: "mail-router@supplier.com",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery delayed",
    body: "sales@supplier.com: delivery failed",
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  message({
    id: "delayed-subject-3",
    threadId: "thread-10",
    externalThreadId: "thread-10",
    direction: "INBOUND",
    fromEmail: "desk@forwarder.example",
    toEmails: ["desk@derya.ai"],
    subject: `Re: ${reference} Custom memory foam parts, 100 units`,
    body: "We handle their quotes. What density do you need?",
    sentAt: "2026-08-28T09:00:00.000Z",
  }),
];
assert.deepEqual(
  [...attributeLocalRfqThread(delayedSubjectThread, "orders@supplier.com").inboundIds],
  [],
  "a report calling itself delayed keeps both recipients, so a stranger stays ambiguous",
);

const delayedPermanentThread: LocalRfqMessage[] = [
  delayedSubjectThread[0],
  message({
    id: "delayed-permanent-2",
    threadId: "thread-10",
    externalThreadId: "thread-10",
    direction: "INBOUND",
    fromEmail: "mail-router@supplier.com",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery delayed",
    body: "sales@supplier.com: delivery failed, 550 5.1.1",
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  delayedSubjectThread[2],
];
assert.deepEqual(
  [...attributeLocalRfqThread(delayedPermanentThread, "orders@supplier.com").inboundIds],
  ["delayed-subject-3"],
  "a permanent status on a recipient's line retires it even under a delay report",
);

const quotedQuantityThread: LocalRfqMessage[] = [
  delayedSubjectThread[0],
  message({
    id: "quoted-quantity-2",
    threadId: "thread-10",
    externalThreadId: "thread-10",
    direction: "INBOUND",
    fromEmail: "mail-router@supplier.com",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery delayed",
    body: [
      "sales@supplier.com: delivery failed, 421 service unavailable",
      "> sales@supplier.com we need 550 units of the foam insert",
    ].join("\n"),
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  delayedSubjectThread[2],
];
assert.deepEqual(
  [...attributeLocalRfqThread(quotedQuantityThread, "orders@supplier.com").inboundIds],
  [],
  "a quoted quantity reading like a code retires nobody without failure wording",
);

const bareCodeThread: LocalRfqMessage[] = [
  delayedSubjectThread[0],
  message({
    id: "bare-code-2",
    threadId: "thread-10",
    externalThreadId: "thread-10",
    direction: "INBOUND",
    fromEmail: "mail-router@supplier.com",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery delayed",
    body: "sales@supplier.com: delivery failed, 550",
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  delayedSubjectThread[2],
];
assert.deepEqual(
  [...attributeLocalRfqThread(bareCodeThread, "orders@supplier.com").inboundIds],
  ["delayed-subject-3"],
  "a bare 550 beside failure wording retires that address under a delay report",
);

const authCodeThread: LocalRfqMessage[] = [
  delayedSubjectThread[0],
  message({
    id: "auth-code-2",
    threadId: "thread-10",
    externalThreadId: "thread-10",
    direction: "INBOUND",
    fromEmail: "mail-router@supplier.com",
    toEmails: ["desk@derya.ai"],
    subject: "Delivery delayed",
    body: "sales@supplier.com: delivery failed, 535 authentication failed",
    sentAt: "2026-08-27T09:00:00.000Z",
  }),
  delayedSubjectThread[2],
];
assert.deepEqual(
  [...attributeLocalRfqThread(authCodeThread, "orders@supplier.com").inboundIds],
  [],
  "a code outside the rejected recipient range retires nobody",
);

const conversationSource = readFileSync(resolve(__dirname, "../src/lib/procurement-conversation.ts"), "utf8");
assert.ok(
  /localRfqConversationFor\(rows, reference\.contactEmail\)/.test(conversationSource),
  "the stored email record path reads a thread with the shared attribution rule",
);
assert.ok(
  /if \(stored\?\.messages\.some\(\(message\) => message\.direction === "INBOUND"\)\) return stored;/
    .test(conversationSource),
  "an anchored thread with no supplier message does not hide a reply on another thread",
);

console.log("procurement-local-outreach: all assertions passed");
