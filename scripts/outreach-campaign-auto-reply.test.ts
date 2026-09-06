import assert from "node:assert/strict";
import { decideAutoReply } from "../src/lib/outreach-campaign-auto-reply";

const context = {
  pitch: "Pre-sliced cakes for cafes.",
  offer: "Samples are available.",
  facts: ["Thaw and serve."],
};

for (const intent of ["INTERESTED", "QUESTION", "NOT_NOW", "NOT_INTERESTED", "WRONG_PERSON"]) {
  const decision = decideAutoReply({
    replyMode: "AUTO",
    intent,
    confidence: 0.9,
    needsHuman: false,
    reply: "Thanks for getting back to me.",
    replyContext: context,
  });
  assert.equal(decision.action, "SENT", intent);
}

assert.equal(decideAutoReply({
  replyMode: "AUTO",
  intent: "UNSUBSCRIBE",
  confidence: 1,
  needsHuman: false,
  reply: null,
  replyContext: context,
}).action, "SUPPRESSED");

for (const intent of ["COMPLAINT", "NEGOTIATION", "OTHER"]) {
  assert.equal(decideAutoReply({
    replyMode: "AUTO",
    intent,
    confidence: 1,
    needsHuman: false,
    reply: null,
    replyContext: context,
  }).action, "ESCALATED", intent);
}

assert.equal(decideAutoReply({
  replyMode: "AUTO",
  intent: "OUT_OF_OFFICE",
  confidence: 1,
  needsHuman: false,
  reply: null,
  replyContext: context,
}).action, "SKIPPED");

assert.equal(decideAutoReply({
  replyMode: "DRAFT",
  intent: "QUESTION",
  confidence: 0.9,
  needsHuman: false,
  reply: "I can help.",
  replyContext: context,
}).reason, "draft_mode");

assert.equal(decideAutoReply({
  replyMode: "AUTO",
  intent: "QUESTION",
  confidence: 0.69,
  needsHuman: false,
  reply: "I can help.",
  replyContext: context,
}).reason, "low_confidence");

assert.equal(decideAutoReply({
  replyMode: "AUTO",
  intent: "QUESTION",
  confidence: 0.9,
  needsHuman: true,
  reply: "I can help.",
  replyContext: context,
}).reason, "needs_human");

assert.equal(decideAutoReply({
  replyMode: "AUTO",
  intent: "QUESTION",
  confidence: 0.9,
  needsHuman: false,
  reply: "I can help - safely.",
  replyContext: context,
}).draft, "I can help - safely.");

assert.equal(decideAutoReply({
  replyMode: "AUTO",
  intent: "QUESTION",
  confidence: 0.9,
  needsHuman: false,
  reply: "The price is £99.",
  replyContext: context,
}).reason, "draft_guard");

assert.equal(decideAutoReply({
  replyMode: "AUTO",
  intent: "QUESTION",
  confidence: 0.9,
  needsHuman: false,
  reply: "The price is £99.",
  replyContext: { ...context, facts: ["The price is £99."] },
}).action, "SENT");

assert.equal(decideAutoReply({
  replyMode: "AUTO",
  intent: "QUESTION",
  confidence: 0.9,
  needsHuman: false,
  reply: "x".repeat(1501),
  replyContext: context,
}).reason, "draft_guard");

assert.equal(decideAutoReply({
  replyMode: "AUTO",
  intent: "QUESTION",
  confidence: 0.9,
  needsHuman: false,
  reply: "I can help.",
  replyContext: context,
  priorAutoReplies: 3,
}).reason, "max_auto_replies");

console.log("outreach campaign auto-reply pure tests passed");
