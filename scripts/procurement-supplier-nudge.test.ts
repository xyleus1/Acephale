import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_SUPPLIER_NUDGES,
  NUDGE_QUIET_MS,
  supplierNudgeDecision,
} from "../src/lib/procurement-supplier-nudge-policy";

// A cold campaign is mostly suppliers that never answered, so this rule decides
// whether we may write to one again. Every branch is pinned: a recorded quote,
// an unrecorded first send, a supplier that did reply, a spent allowance, an
// unknown send time, and a thread that is simply not old enough.

const now = Date.parse("2026-08-31T12:00:00.000Z");
const quiet = now - NUDGE_QUIET_MS - 60_000;
const fresh = now - 60_000;

function decision(overrides: Parameters<typeof supplierNudgeDecision>[0]) {
  return supplierNudgeDecision({ now, ...overrides });
}

const eligible = decision({
  hasQuote: false,
  hasInboundReply: false,
  rfqRecorded: true,
  lastOutboundAt: quiet,
  nudgesSent: 0,
});
assert.equal(eligible.nudge, true);
assert.equal(eligible.nudge === true ? eligible.round : 0, 1, "The first follow up is round one.");
assert.match(
  eligible.reason,
  /never answered/,
  "The reason has to say why we are writing again, so an operator can audit it.",
);

const second = decision({
  hasQuote: false,
  hasInboundReply: false,
  rfqRecorded: true,
  lastOutboundAt: quiet,
  nudgesSent: 1,
});
assert.equal(second.nudge === true ? second.round : 0, 2, "A second follow up keeps its own round.");

assert.equal(
  decision({
    hasQuote: false,
    hasInboundReply: false,
    rfqRecorded: true,
    lastOutboundAt: quiet,
    nudgesSent: MAX_SUPPLIER_NUDGES,
  }).nudge,
  false,
  "A supplier never receives more follow ups than the request allows.",
);

assert.equal(
  decision({
    hasQuote: true,
    hasInboundReply: false,
    rfqRecorded: true,
    lastOutboundAt: quiet,
    nudgesSent: 0,
  }).nudge,
  false,
  "A quoted supplier is finished with follow ups.",
);

assert.equal(
  decision({
    hasQuote: false,
    hasInboundReply: true,
    rfqRecorded: true,
    lastOutboundAt: quiet,
    nudgesSent: 0,
  }).nudge,
  false,
  "A supplier that replied belongs to the reply path, so it is never nudged twice over.",
);

assert.equal(
  decision({
    hasQuote: false,
    hasInboundReply: false,
    rfqRecorded: false,
    lastOutboundAt: quiet,
    nudgesSent: 0,
  }).nudge,
  false,
  "Without a recorded first send there is no thread to follow up on.",
);

assert.equal(
  decision({
    hasQuote: false,
    hasInboundReply: false,
    rfqRecorded: true,
    lastOutboundAt: null,
    nudgesSent: 0,
  }).nudge,
  false,
  "An unknown send time cannot be measured against the quiet period.",
);

assert.equal(
  decision({
    hasQuote: false,
    hasInboundReply: false,
    rfqRecorded: true,
    lastOutboundAt: fresh,
    nudgesSent: 0,
  }).nudge,
  false,
  "A supplier mailed an hour ago is not quiet, it is busy.",
);

const boundary = decision({
  hasQuote: false,
  hasInboundReply: false,
  rfqRecorded: true,
  lastOutboundAt: now - NUDGE_QUIET_MS,
  nudgesSent: 0,
});
assert.equal(boundary.nudge, true, "Exactly the quiet period is quiet enough.");

// The send path itself is server-only, so its guarantees are read from source:
// the confirmation phrase, the sender that owns the thread, the reply anchor on
// our own RFQ, the request scoped files, and the reservation lifecycle.
const root = process.cwd();
const module = readFileSync(resolve(root, "src/lib/procurement-supplier-nudge.ts"), "utf8");
const route = readFileSync(resolve(root, "src/app/api/admin/procurement-supplier-nudges/route.ts"), "utf8");

assert.match(
  module,
  /procurement-rfq-nudge:\$\{args\.orderId\}:\$\{args\.round\}:\$\{args\.vendorId\}/,
  "One reservation key per order, vendor, and round is what stops a repeat run from mailing twice.",
);
assert.match(
  module,
  /accountId: target\.accountId/,
  "The follow up goes out from the mailbox that owns the thread, not from any pooled sender.",
);
assert.match(
  module,
  /inReplyToRfcMessageId: target\.rfqRfcMessageId/,
  "With no supplier reply to answer, our own RFQ is the reply anchor.",
);
assert.match(
  module,
  /loadProcurementRfqAttachmentPackage/,
  "Files come from the request package, which is what keeps a category from sending another category's drawings.",
);
assert.match(
  module,
  /releaseEmailSenderReservation/,
  "A rejected send has to release the reservation, and an unknown one has to keep it.",
);
assert.doesNotMatch(
  module,
  /allowPooledSender|reserveEmailSender\(\{\s*officeId[^}]*\}\)\s*;\s*\/\/ any/,
  "Nothing in this path may quietly switch the supplier to a different sender.",
);

assert.match(
  route,
  /payload\.confirm !== NUDGE_CONFIRMATION/,
  "The send route needs the confirmation phrase in the body.",
);
assert.match(route, /operatorSecretAuthorized/, "Both methods are operator only.");
const getBlock = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
assert.match(getBlock, /listSupplierNudgeTargets/, "GET reports the plan.");
assert.doesNotMatch(getBlock, /runProcurementSupplierNudges/, "GET must not be able to mail anyone.");

// A plan an operator approves has to cover the same suppliers a send would, so
// an absent limit means the whole run instead of a single recipient.
assert.match(
  getBlock,
  /limitParam === null \? undefined : Number\(limitParam\)/,
  "GET without a limit plans the whole run, not one supplier.",
);

// A follow up whose delivery is unknown stays reserved, so the next round must
// wait for reconciliation instead of mailing the same supplier again.
assert.match(
  module,
  /unconfirmedNudges/,
  "An unconfirmed follow up blocks the next round for that supplier.",
);
assert.match(
  module,
  /reservation\.status === "RESERVED"/,
  "Only a recorded follow up is treated as delivered.",
);

// A finished request and a supplier ruled out of the request are both closed to
// further outreach.
assert.match(
  module,
  /NUDGE_CLOSED_ORDER_STATUSES\.includes\(orderStatus\)/,
  "An ordered or cancelled request contacts nobody.",
);
assert.match(
  module,
  /lower\(coalesce\(order_vendors\.status, ''\)\) <> ALL/,
  "A rejected or excluded supplier is not followed up.",
);

// One failure total covers both delivery paths, so a run where only follow ups
// failed cannot report zero failures.
const autopilot = readFileSync(resolve(root, "src/lib/procurement-autopilot.ts"), "utf8");
assert.match(
  autopilot,
  /failed: \(sendRun\?\.failed \?\? 0\) \+ \(nudgeRun\?\.failed \?\? 0\)/,
  "Failed follow ups count toward the autopilot failure total.",
);

console.log("procurement supplier nudge policy and command contracts passed");
