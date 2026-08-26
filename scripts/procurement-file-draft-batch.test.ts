import assert from "node:assert/strict";
import {
  eligibleFileDraftTargets,
  fileDraftSkipReason,
  type FileDraftTarget,
} from "../src/lib/procurement-file-draft-selection";

// The operator command walks every supplier that replied, so the selection has
// to skip bounces and auto replies and must not redraft a saved draft unless it
// was asked to.

function target(overrides: Partial<FileDraftTarget>): FileDraftTarget {
  return {
    vendorId: "vendor-1",
    vendorName: "Arctic Circuits",
    recipient: "rfq@example.com",
    sourceMessageId: "message-1",
    conversationSubject: "Re: [RFQ 24cb31bd] PCBA",
    inboundKind: "QUESTION",
    hasDraft: false,
    skipReason: null,
    ...overrides,
  };
}

const targets: FileDraftTarget[] = [
  target({ vendorId: "wants-files" }),
  target({ vendorId: "statement", inboundKind: "STATEMENT" }),
  target({ vendorId: "already-drafted", hasDraft: true }),
  target({ vendorId: "bounced", inboundKind: "BOUNCE", skipReason: fileDraftSkipReason("BOUNCE") }),
  target({ vendorId: "away", inboundKind: "AUTO_REPLY", skipReason: fileDraftSkipReason("AUTO_REPLY") }),
  target({ vendorId: "wrong-desk", inboundKind: "WRONG_RECIPIENT", skipReason: fileDraftSkipReason("WRONG_RECIPIENT") }),
];

assert.equal(fileDraftSkipReason("QUESTION"), null);
assert.equal(fileDraftSkipReason("STATEMENT"), null);
assert.match(fileDraftSkipReason("AUTO_REPLY") ?? "", /auto reply/);

assert.deepEqual(
  eligibleFileDraftTargets(targets).map((entry) => entry.vendorId),
  ["wants-files", "statement"],
);

assert.deepEqual(
  eligibleFileDraftTargets(targets, { redraft: true }).map((entry) => entry.vendorId),
  ["wants-files", "statement", "already-drafted"],
);

console.log("Procurement file draft batch selection passed.");
