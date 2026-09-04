import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  conversationFunnel,
  conversationOwesAction,
  supplierConversationStage,
  unreadConversationInput,
  type SupplierConversationInput,
} from "../src/lib/procurement-conversation-stage";
import { chasesSentAfterLastReply, MAX_SUPPLIER_CHASES, supplierChaseDecision } from "../src/lib/procurement-supplier-chase";
import { planAutopilotVendorAction } from "../src/lib/procurement-autopilot-plan";
import {
  supplierQuoteMissingFacts,
  SUPPLIER_QUOTE_MISSING_FACT_ASK,
} from "../src/lib/procurement-supplier-quote-reading";

// A request only reaches a purchase order if no supplier thread quietly stops,
// so every stage is pinned here: what a thread is waiting on, whether it still
// owes an action, and what the loop does next about it.

function input(overrides: Partial<SupplierConversationInput>): SupplierConversationInput {
  return {
    vendorId: "vendor-1",
    vendorName: "Arctic Circuits",
    lastDirection: "INBOUND",
    inboundKind: "QUESTION",
    triageDecision: "AUTO_ANSWER",
    hasDraft: false,
    hasQuote: false,
    ...overrides,
  };
}

assert.equal(supplierConversationStage(input({ lastDirection: null, inboundKind: null })), "NOT_CONTACTED");
assert.equal(supplierConversationStage(input({})), "REPLY_UNANSWERED");
assert.equal(supplierConversationStage(input({ hasDraft: true })), "ANSWER_READY");
assert.equal(
  supplierConversationStage(input({ lastDirection: "OUTBOUND", inboundKind: null })),
  "AWAITING_QUOTE",
);
assert.equal(supplierConversationStage(input({ hasQuote: true })), "QUOTED");
assert.equal(
  supplierConversationStage(input({ inboundKind: "BOUNCE", triageDecision: "NEEDS_HUMAN" })),
  "NEEDS_OPERATOR",
);
assert.equal(
  supplierConversationStage(input({ inboundKind: "WRONG_RECIPIENT", triageDecision: "NEEDS_HUMAN" })),
  "NEEDS_OPERATOR",
);
assert.equal(
  supplierConversationStage(input({ triageDecision: "NEEDS_HUMAN" })),
  "NEEDS_OPERATOR",
  "A question the request cannot answer waits on a person, not on the loop.",
);
// An out of office notice used to read as a settled thread, which is how a
// supplier who never came back was left alone forever.
assert.equal(
  supplierConversationStage(input({ inboundKind: "AUTO_REPLY", triageDecision: "NO_REPLY_NEEDED" })),
  "AWAITING_QUOTE",
);
assert.equal(
  supplierConversationStage(input({
    lastDirection: "OUTBOUND",
    inboundKind: null,
    missingQuoteFacts: ["LEAD_TIME"],
  })),
  "QUOTE_INCOMPLETE",
);
assert.equal(
  supplierConversationStage(input({ hasQuote: true, missingQuoteFacts: ["PRICE"] })),
  "QUOTED",
  "A recorded quote is what the request buys on, whatever an earlier reading was short of.",
);

// Only a recorded quote owes nobody anything. A supplier who was never mailed
// owes a first contact, and one waiting on a person owes an action the loop may
// not take, so neither may be counted as finished.
assert.equal(conversationOwesAction("QUOTED"), false);
for (const stage of [
  "NOT_CONTACTED",
  "AWAITING_FIRST_REPLY",
  "REPLY_UNANSWERED",
  "ANSWER_READY",
  "AWAITING_QUOTE",
  "QUOTE_INCOMPLETE",
  "NEEDS_OPERATOR",
] as const) {
  assert.equal(conversationOwesAction(stage), true, `${stage} still owes an action.`);
}

const funnel = conversationFunnel([
  { input: input({ vendorId: "a", hasQuote: true }) },
  { input: input({ vendorId: "b" }) },
  { input: input({ vendorId: "c", hasDraft: true }) },
  {
    input: input({ vendorId: "d", vendorName: "Semipcb", lastDirection: "OUTBOUND", inboundKind: null, missingQuoteFacts: ["LEAD_TIME"] }),
  },
  {
    input: input({ vendorId: "e", vendorName: "Dallas Foam", inboundKind: "BOUNCE", triageDecision: "NEEDS_HUMAN" }),
    action: { kind: "ESCALATE", reason: "The RFQ bounced, so the address needs replacing." },
  },
]);
assert.equal(funnel.suppliers, 5);
assert.equal(funnel.stages.QUOTED, 1);
assert.equal(funnel.stages.REPLY_UNANSWERED, 1);
assert.equal(funnel.stages.ANSWER_READY, 1);
assert.equal(funnel.stages.QUOTE_INCOMPLETE, 1);
assert.equal(funnel.stages.NEEDS_OPERATOR, 1);
assert.equal(funnel.owed, 4, "Every thread short of a recorded quote is still owed work.");
assert.deepEqual(funnel.needsOperator, [{
  vendorId: "e",
  vendorName: "Dallas Foam",
  reason: "The RFQ bounced, so the address needs replacing.",
}]);
assert.deepEqual(funnel.quoteIncomplete, [{ vendorId: "d", vendorName: "Semipcb", missing: ["LEAD_TIME"] }]);
assert.equal(
  conversationFunnel([{ input: input({ inboundKind: "BOUNCE", triageDecision: "NEEDS_HUMAN" }) }])
    .needsOperator[0].reason.length > 0,
  true,
  "A thread waiting on a person is always named with a reason.",
);

// What a reading is short of is exactly what the follow up asks for, so a
// thread never gets the brief repeated when the missing fact is known.
assert.deepEqual(
  supplierQuoteMissingFacts({ unitPrice: null, totalPrice: null, leadTimeDays: null }),
  ["PRICE", "LEAD_TIME"],
);
assert.deepEqual(
  supplierQuoteMissingFacts({ unitPrice: null, totalPrice: 10_800, leadTimeDays: null }),
  ["LEAD_TIME"],
);
assert.deepEqual(
  supplierQuoteMissingFacts({ unitPrice: 20.8, totalPrice: null, leadTimeDays: 10 }),
  [],
);

// A thread that has gone quiet holding a partial reading is asked for the fact
// itself. The quiet period and the chase cap still apply, so the ask cannot
// become a stream of mail.
const quiet = new Date("2026-08-20T09:00:00.000Z").toISOString();
const now = new Date("2026-08-31T09:00:00.000Z").getTime();
const askPlan = planAutopilotVendorAction(
  input({
    lastDirection: "OUTBOUND",
    inboundKind: null,
    lastMessageAt: quiet,
    chasesSent: 0,
    missingQuoteFacts: ["LEAD_TIME"],
  }),
  { autoSend: true, now },
);
assert.equal(askPlan.kind, "ASK_QUOTE_FACTS");
assert.deepEqual(askPlan.kind === "ASK_QUOTE_FACTS" ? askPlan.missing : [], ["LEAD_TIME"]);
assert.ok(
  askPlan.reason.includes(SUPPLIER_QUOTE_MISSING_FACT_ASK.LEAD_TIME),
  "The plan says which fact the thread is short of.",
);
assert.equal(
  planAutopilotVendorAction(
    input({
      lastDirection: "OUTBOUND",
      inboundKind: null,
      lastMessageAt: new Date("2026-08-30T09:00:00.000Z").toISOString(),
      chasesSent: 0,
      missingQuoteFacts: ["LEAD_TIME"],
    }),
    { autoSend: true, now },
  ).kind,
  "NONE",
  "A thread inside the quiet period is left alone, missing fact or not.",
);
assert.equal(
  planAutopilotVendorAction(
    input({ lastDirection: "OUTBOUND", inboundKind: null, lastMessageAt: quiet, chasesSent: 0, hasQuote: true }),
    { autoSend: true, now },
  ).kind,
  "NONE",
  "A recorded quote ends the follow ups.",
);

// A pass that withholds unsolicited follow ups still finishes this one, and a
// saved ask is delivered rather than being stranded behind that rule.
const autopilotSource = readFileSync(resolve(__dirname, "../src/lib/procurement-autopilot.ts"), "utf8");
assert.ok(
  /entry\.action\.kind === "ASK_QUOTE_FACTS" && \(sendFollowUps \|\| askQuoteFacts\)/.test(autopilotSource),
  "An ask for a missing commercial fact is drafted even when chases are withheld.",
);
assert.ok(
  /entry\.action\.kind === "CHASE" && sendFollowUps/.test(autopilotSource),
  "A chase that only repeats the brief still waits for a confirmation.",
);
assert.ok(
  /askQuoteFacts && Boolean\(entry\.state\.missingQuoteFacts\?\.length\)/.test(autopilotSource),
  "A saved ask is delivered by the same pass rule that delivers an answer.",
);
assert.ok(
  /missingQuoteFacts: new Map\(\s*\(quoteRun\?\.partials \?\? \[\]\)/.test(autopilotSource),
  "What each thread is short of comes from this pass own quote sweep.",
);
assert.ok(
  /const funnelEntries = \[/.test(autopilotSource)
    && /funnel: conversationFunnel\(funnelEntries\)/.test(autopilotSource)
    && /order\.vendors\s*\.filter\(\(vendor\) => !plan\.some/.test(autopilotSource)
    && /unreadConversationInput\(vendor\)/.test(autopilotSource),
  "The funnel covers the whole request, not only the threads this pass read.",
);
assert.ok(
  /procurementVendorOutreachClosed\(vendor\.status\)/.test(autopilotSource)
    && /\.filter\(\(entry\) => !procurementVendorOutreachClosed\(/.test(autopilotSource),
  "A supplier the request stopped pursuing is not counted as owing an action, replied or not.",
);
assert.ok(
  /answeredReply: newestReply/.test(autopilotSource),
  "An automatic notice is not treated as a reply we answered when counting follow ups.",
);
const cronSource = readFileSync(
  resolve(__dirname, "../src/app/api/cron/procurement-autopilot/route.ts"),
  "utf8",
);
assert.ok(
  /conversations: \{\s*stages: run\.funnel\.stages,\s*owed: run\.funnel\.owed/.test(cronSource),
  "The scheduled response shows the funnel, so a stalled request does not need a manual sweep.",
);

// A pass reads a thread only for the suppliers that answered, so the rest of
// the request is staged from what the request already records. Without this a
// request with hundreds of silent suppliers reported nothing owed.
assert.equal(
  supplierConversationStage(unreadConversationInput({
    id: "v1",
    name: "Witmold",
    contacted: false,
    responseCount: 0,
    quote: null,
  })),
  "NOT_CONTACTED",
);
assert.equal(
  supplierConversationStage(unreadConversationInput({
    id: "v2",
    name: "Witmold",
    contacted: true,
    responseCount: 0,
    quote: null,
  })),
  "AWAITING_FIRST_REPLY",
);
assert.equal(
  supplierConversationStage(unreadConversationInput({
    id: "v3",
    name: "Witmold",
    contacted: true,
    responseCount: 2,
    quote: null,
  })),
  "REPLY_UNANSWERED",
  "A supplier who answered and whose thread was not read is assumed to be waiting on us,"
    + " since calling it AWAITING_QUOTE would hide exactly the reply this funnel exists to catch.",
);
assert.equal(
  supplierConversationStage(unreadConversationInput({
    id: "v4",
    name: "Prototype PCB",
    contacted: true,
    responseCount: 1,
    quote: { unitPrice: 20.8, leadTimeDays: 10 },
  })),
  "QUOTED",
);
// Sourcing keeps a shop it found without a published address. No pass can mail
// it, so counting it as owed made a request look permanently behind while the
// threads that were genuinely stalled were buried in the same number.
assert.equal(
  supplierConversationStage(unreadConversationInput({
    id: "v5",
    name: "No address foam shop",
    contacted: false,
    responseCount: 0,
    quote: null,
    contact: null,
  })),
  "NO_CONTACT_METHOD",
);
assert.equal(
  supplierConversationStage(unreadConversationInput({
    id: "v6",
    name: "Phone only shop",
    contacted: false,
    responseCount: 0,
    quote: null,
    contact: { email: null },
  })),
  "NO_CONTACT_METHOD",
);
assert.equal(
  supplierConversationStage(unreadConversationInput({
    id: "v7",
    name: "Mailable shop",
    contacted: false,
    responseCount: 0,
    quote: null,
    contact: { email: "sales@mailable.test" },
  })),
  "NOT_CONTACTED",
  "A supplier we hold an address for owes a first contact, so it stays owed work.",
);
const unreachable = conversationFunnel([
  {
    input: unreadConversationInput({
      id: "u1",
      name: "No address foam shop",
      contacted: false,
      responseCount: 0,
      quote: null,
      contact: null,
    }),
  },
  {
    input: unreadConversationInput({
      id: "u2",
      name: "Mailable shop",
      contacted: false,
      responseCount: 0,
      quote: null,
      contact: { email: "sales@mailable.test" },
    }),
  },
]);
assert.equal(unreachable.suppliers, 2);
assert.equal(unreachable.stages.NO_CONTACT_METHOD, 1);
assert.equal(
  unreachable.owed,
  1,
  "An unreachable supplier stays visible in the funnel without inflating the work owed.",
);
assert.ok(
  conversationOwesAction("NOT_CONTACTED") && !conversationOwesAction("NO_CONTACT_METHOD"),
);

// The first RFQ stamps last_email_message_id, so a projection that only read
// the legacy gmail_message_id reported every mailed supplier as uncontacted.
const workflowSource = readFileSync(resolve(__dirname, "../src/lib/procurement-workflow.ts"), "utf8");
assert.ok(
  /VENDOR_SENT_MESSAGE_ID_SQL = `COALESCE\(\s*NULLIF\(to_jsonb\(order_vendors\)->>'last_email_message_id', ''\),\s*NULLIF\(to_jsonb\(order_vendors\)->>'gmail_message_id', ''\)/
    .test(workflowSource),
  "A supplier is contacted when either the current or the legacy sent message id is stamped.",
);
assert.equal(
  workflowSource.split("NULLIF(to_jsonb(order_vendors)->>'gmail_message_id', '')").length - 1,
  1,
  "Nothing reads the legacy sent message id on its own, which is what made contacted counts wrong.",
);

const wholeRequest = conversationFunnel([
  { input: input({ vendorId: "read", hasQuote: true }) },
  ...["s1", "s2", "s3"].map((id) => ({
    input: unreadConversationInput({ id, name: "Silent shop", contacted: true, responseCount: 0, quote: null }),
  })),
]);
assert.equal(wholeRequest.suppliers, 4);
assert.equal(wholeRequest.stages.AWAITING_FIRST_REPLY, 3);
assert.equal(
  wholeRequest.owed,
  3,
  "A request whose only read thread is quoted still owes every silent supplier an action.",
);

// An out of office thread is chased, and because we never answered the notice,
// every message after it counts against the cap: it used to be mailed one more
// time than a request allows.
const afterAutoReply = [
  { direction: "OUTBOUND" as const },
  { direction: "INBOUND" as const },
  { direction: "OUTBOUND" as const },
  { direction: "OUTBOUND" as const },
];
assert.equal(chasesSentAfterLastReply(afterAutoReply, { answeredReply: false }), 2);
assert.equal(
  chasesSentAfterLastReply(afterAutoReply),
  1,
  "On a thread we did answer, the first message after the reply is that answer.",
);
assert.equal(
  supplierChaseDecision({
    lastDirection: "OUTBOUND",
    lastMessageAt: quiet,
    chasesSent: chasesSentAfterLastReply(afterAutoReply, { answeredReply: false }),
    hasQuote: false,
    now,
  }).chase,
  false,
  `An out of office thread stops at ${MAX_SUPPLIER_CHASES} follow ups like any other.`,
);

console.log("procurement conversation stage checks passed");
