import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  autopilotEscalations,
  autopilotFailures,
  autopilotRequestStage,
  planAutopilotVendorAction,
  type AutopilotVendorState,
} from "../src/lib/procurement-autopilot-plan";
import {
  chasesSentAfterLastReply,
  MAX_SUPPLIER_CHASES,
} from "../src/lib/procurement-supplier-chase";

// The loop may only act for a reason written into the plan, so every branch is
// pinned here: bounces and wrong contacts reach a human, commercial questions
// reach a human, saved drafts wait unless sending was explicitly turned on, and
// a request is never called PO ready without enough real quotes.

function state(overrides: Partial<AutopilotVendorState>): AutopilotVendorState {
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

const draftOnly = { autoSend: false };
const sending = { autoSend: true };

assert.equal(planAutopilotVendorAction(state({}), draftOnly).kind, "DRAFT_REPLY");
assert.equal(planAutopilotVendorAction(state({ hasDraft: true }), draftOnly).kind, "AWAIT_APPROVAL");
assert.equal(planAutopilotVendorAction(state({ hasDraft: true }), sending).kind, "SEND_DRAFT");

assert.equal(
  planAutopilotVendorAction(state({ inboundKind: "BOUNCE", triageDecision: "NO_REPLY_NEEDED" }), sending).kind,
  "ESCALATE",
  "A bounce needs a new address from an operator, never another send.",
);
assert.equal(
  planAutopilotVendorAction(state({ inboundKind: "AUTO_REPLY", triageDecision: "NO_REPLY_NEEDED" }), sending).kind,
  "NONE",
  "An out of office notice is not a supplier answer.",
);
assert.equal(
  planAutopilotVendorAction(state({ inboundKind: "WRONG_RECIPIENT", triageDecision: "NEEDS_HUMAN" }), sending).kind,
  "ESCALATE",
);
assert.equal(
  planAutopilotVendorAction(state({ triageDecision: "NEEDS_HUMAN" }), sending).kind,
  "ESCALATE",
  "Price, terms, dates and legal questions stay with the operator even while sending is on.",
);
assert.equal(
  planAutopilotVendorAction(state({ hasDraft: true, triageDecision: "NEEDS_HUMAN" }), sending).kind,
  "ESCALATE",
  "A saved draft never overrides an escalation.",
);
assert.equal(
  planAutopilotVendorAction(state({ hasQuote: true, hasDraft: true }), sending).kind,
  "NONE",
  "A quoted supplier is done being chased.",
);
assert.equal(planAutopilotVendorAction(state({ lastDirection: "OUTBOUND", inboundKind: null, triageDecision: null }), sending).kind, "NONE");
assert.equal(planAutopilotVendorAction(state({ lastDirection: null, inboundKind: null, triageDecision: null }), sending).kind, "NONE");

assert.equal(autopilotRequestStage({ quotes: 0 }), "COLLECTING_REPLIES");
assert.equal(autopilotRequestStage({ quotes: 2 }), "COLLECTING_REPLIES");
assert.equal(autopilotRequestStage({ quotes: 3 }), "QUOTES_READY_FOR_PO");
assert.equal(autopilotRequestStage({ quotes: 1, required: 1 }), "QUOTES_READY_FOR_PO");

const plan = [
  { vendorId: "a", vendorName: "A", action: planAutopilotVendorAction(state({ inboundKind: "BOUNCE" }), draftOnly) },
  { vendorId: "b", vendorName: "B", action: planAutopilotVendorAction(state({}), draftOnly) },
];
const escalations = autopilotEscalations(plan);
assert.equal(escalations.length, 1);
assert.equal(escalations[0]?.vendorId, "a");
assert.ok(escalations[0]?.reason.length);

// A supplier that answered once and then went quiet is followed up on the same
// thread, but only after the thread has been quiet and only a bounded number of
// times, so nobody is mailed twice a day and nobody is mailed forever.
const now = Date.parse("2026-09-01T12:00:00.000Z");
const quiet = (overrides: Partial<AutopilotVendorState>) => planAutopilotVendorAction(
  state({
    lastDirection: "OUTBOUND",
    inboundKind: null,
    triageDecision: null,
    hasDraft: false,
    lastMessageAt: "2026-08-20T12:00:00.000Z",
    chasesSent: 0,
    ...overrides,
  }),
  { autoSend: true, now },
);

assert.equal(quiet({}).kind, "CHASE", "A supplier quiet for 12 days is chased.");
assert.match(quiet({}).reason, /quiet for 12 days/);
assert.equal(
  quiet({ lastMessageAt: "2026-08-31T12:00:00.000Z" }).kind,
  "NONE",
  "A supplier answered yesterday is not chased.",
);
assert.equal(
  quiet({ chasesSent: MAX_SUPPLIER_CHASES }).kind,
  "NONE",
  "The follow ups a request allows are bounded.",
);
assert.equal(
  quiet({ hasQuote: true }).kind,
  "NONE",
  "A quoted supplier is never chased.",
);
assert.equal(
  quiet({ lastMessageAt: null }).kind,
  "NONE",
  "A thread with no known last message is left alone.",
);
assert.equal(
  planAutopilotVendorAction(state({ lastDirection: "OUTBOUND", inboundKind: null, triageDecision: null }), draftOnly).kind,
  "NONE",
  "A caller that reports a plan without thread timings never proposes a chase.",
);

// Only the outbound messages after the supplier's newest reply count, and the
// first of those is the answer they asked for rather than a chase.
assert.equal(chasesSentAfterLastReply([]), 0);
assert.equal(chasesSentAfterLastReply([{ direction: "OUTBOUND" }]), 0, "An RFQ with no reply is not a chase.");
assert.equal(chasesSentAfterLastReply([{ direction: "INBOUND" }]), 0);
assert.equal(chasesSentAfterLastReply([{ direction: "INBOUND" }, { direction: "OUTBOUND" }]), 0);
assert.equal(
  chasesSentAfterLastReply([
    { direction: "INBOUND" },
    { direction: "OUTBOUND" },
    { direction: "OUTBOUND" },
  ]),
  1,
);
assert.equal(
  chasesSentAfterLastReply([
    { direction: "OUTBOUND" },
    { direction: "INBOUND" },
    { direction: "OUTBOUND" },
    { direction: "OUTBOUND" },
    { direction: "INBOUND" },
    { direction: "OUTBOUND" },
  ]),
  0,
  "A newer supplier reply resets the follow up count.",
);

// A quote the workflow database refuses to write leaves a priced reply unusable
// to the request, so the pass names the supplier it happened to instead of
// reporting a clean run.
assert.deepEqual(
  autopilotFailures({
    chase: [],
    quote: [
      {
        vendorId: "vendor-7",
        vendorName: "Saturn Electronics",
        state: "FAILED",
        error: "The supplier quote could not be recorded.",
      },
      { vendorId: "vendor-8", vendorName: "Telan Circuits", state: "RECORDED", error: null },
    ],
  }),
  [
    {
      vendorId: "vendor-7",
      vendorName: "Saturn Electronics",
      error: "The supplier quote could not be recorded.",
    },
  ],
  "A failed quote write reaches the operator with the supplier it belongs to.",
);

assert.deepEqual(
  autopilotFailures({
    chase: [],
    quote: [{ vendorId: "vendor-9", vendorName: "Bay Area Circuits", state: "FAILED" }],
  }),
  [{ vendorId: "vendor-9", vendorName: "Bay Area Circuits", error: "The supplier quote could not be recorded." }],
  "A failure carrying no message still reports an opaque reason rather than nothing.",
);

assert.deepEqual(
  autopilotFailures({
    chase: [{ vendorId: "vendor-1", vendorName: "Arctic Circuits", error: "The supplier chase failed." }],
    nudge: [{ vendorId: "vendor-2", vendorName: "Xpress", state: "SENT", error: null }],
    send: [{ vendorId: "vendor-3", vendorName: "ubersmt", state: "SENT", error: null }],
    quote: [{ vendorId: "vendor-4", vendorName: "Polymer Laboratories", state: "ALREADY_RECORDED", error: null }],
  }),
  [{ vendorId: "vendor-1", vendorName: "Arctic Circuits", error: "The supplier chase failed." }],
  "Work that succeeded is never reported as a failure.",
);

// The capture pass is the only writer of a supplier quote, so the loop has to
// hand its failures on rather than counting them and dropping them.
const autopilotSource = readFileSync(resolve(__dirname, "../src/lib/procurement-autopilot.ts"), "utf8");
assert.ok(
  /quote:\s*quoteRun\?\.outcomes/.test(autopilotSource),
  "The loop passes quote capture outcomes into its failure report.",
);
assert.ok(
  /quoteRun\?\.failed \?\? 0/.test(autopilotSource),
  "A failed quote write counts toward the failure total of the pass.",
);

console.log("procurement autopilot plan checks passed");
