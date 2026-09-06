import assert from "node:assert/strict";
import { replyContextInput, replyModeInput } from "../src/lib/outreach-campaign-reply-settings";

assert.equal(replyModeInput("AUTO"), "AUTO");
assert.equal(replyModeInput(undefined, true), undefined);
assert.throws(() => replyModeInput("auto"), /AUTO, DRAFT, or OFF/);

assert.deepEqual(replyContextInput({
  pitch: "A clear pitch",
  facts: ["Fact"],
  faqs: [{ question: "Q", answer: "A" }],
}, false), {
  pitch: "A clear pitch",
  offer: undefined,
  facts: ["Fact"],
  faqs: [{ question: "Q", answer: "A" }],
  limits: undefined,
  escalate: undefined,
  signature: undefined,
});
assert.equal(replyContextInput(undefined, true), undefined);
assert.equal(replyContextInput(null, true), null);
assert.throws(() => replyContextInput({ pitch: "" }), /non-empty string/);
assert.throws(() => replyContextInput({ pitch: "x", facts: ["ok", 1] }), /array of strings/);
assert.throws(() => replyContextInput({ pitch: "x", faqs: [{ question: "Q" }] }), /question and answer/);

console.log("outreach campaign reply-settings tests passed");
