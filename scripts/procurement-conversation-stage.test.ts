import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  conversationFunnel,
  conversationOwesAction,
  supplierConversationStage,
  type SupplierConversationInput,
} from "../src/lib/procurement-conversation-stage";
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
  /funnel: conversationFunnel\(/.test(autopilotSource),
  "Every pass reports where the threads it read stand.",
);
const cronSource = readFileSync(
  resolve(__dirname, "../src/app/api/cron/procurement-autopilot/route.ts"),
  "utf8",
);
assert.ok(
  /conversations: \{\s*stages: run\.funnel\.stages,\s*owed: run\.funnel\.owed/.test(cronSource),
  "The scheduled response shows the funnel, so a stalled request does not need a manual sweep.",
);

console.log("procurement conversation stage checks passed");
