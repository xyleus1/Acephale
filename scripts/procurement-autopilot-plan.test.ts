import assert from "node:assert/strict";
import {
  autopilotEscalations,
  autopilotRequestStage,
  planAutopilotVendorAction,
  type AutopilotVendorState,
} from "../src/lib/procurement-autopilot-plan";

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

console.log("procurement autopilot plan checks passed");
