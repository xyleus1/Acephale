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
  /procurement-rfq-nudge:\$\{args\.orderId\}:\$\{args\.round\}:\$\{identity\}/,
  "One reservation key per order, vendor, round and address is what stops a repeat run from mailing twice.",
);
assert.match(
  module,
  /contactEmail: target\.recipient,\s*\}\);\s*if \(!await nudgeStillEligible/,
  "A follow up's reservation names the address it is being sent to.",
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
// Suppression is decided inside the plan, before the run limit counts a
// supplier, so suppressed rows at the front of the list never starve the
// eligible ones behind them.
const planBlock = module.slice(
  module.indexOf("export async function listSupplierNudgeTargets"),
  module.indexOf("async function recordSentNudge"),
);
const planSuppressionIndex = planBlock.indexOf("listSuppressedEmails(args.order.officeId");
assert.ok(planSuppressionIndex >= 0, "The plan checks the office's suppression list.");
assert.ok(
  planSuppressionIndex < planBlock.indexOf("targets.push({"),
  "Suppression is known before any supplier is counted against the limit.",
);
const loopBlock = planBlock.slice(planBlock.indexOf("for (const row of contacted)"));
assert.ok(
  loopBlock.indexOf("suppressionSkipMessage(suppressionReason)") < loopBlock.indexOf("targets.push({"),
  "A suppressed supplier is skipped before it would occupy a target slot.",
);
assert.match(
  loopBlock,
  /reason: suppressionSkipMessage\(suppressionReason\)/,
  "A suppressed supplier shows up in the skipped list with the deterministic reason.",
);
const runBlock = module.slice(module.indexOf("export async function runProcurementSupplierNudges"));
assert.ok(
  runBlock.indexOf("listSupplierNudgeTargets({") < runBlock.indexOf("reserveEmailSender("),
  "The plan, and with it suppression, is settled before any sender is reserved.",
);
assert.doesNotMatch(
  runBlock,
  /planned\.targets\.filter/,
  "The run does not re-filter a limited plan, which would let suppressed rows consume the limit.",
);
// A suppression written between planning and sending, including while the
// sender was being reserved, must still stop the send.
const sendLoop = runBlock.slice(runBlock.indexOf("for (const target of targets)"));
const lateCheck = sendLoop.indexOf("listSuppressedEmails(order.officeId, [target.recipient])");
const nudgeProviderSend = sendLoop.indexOf("provider.send(");
assert.ok(lateCheck >= 0, "Each target is rechecked against the office suppression list inside the send loop.");
assert.ok(
  lateCheck > sendLoop.indexOf("reserveEmailSender(") && lateCheck < nudgeProviderSend,
  "The recheck happens after the sender is reserved and before the provider call.",
);
const lateBlock = sendLoop.slice(lateCheck, nudgeProviderSend);
assert.match(
  lateBlock,
  /releaseEmailSenderReservation\(\{ officeId: order\.officeId, reservationId: reservation\.reservationId \}\)/,
  "A late suppression releases the reservation it just took.",
);
assert.match(
  lateBlock,
  /reason: suppressionSkipMessage\(lateSuppression\)/,
  "A late suppression is recorded as a deterministic skip.",
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
  /nudge: nudgeRun\?\.outcomes,/,
  "A failed follow up is named among the failures of the pass.",
);
assert.match(
  autopilot,
  /failed: failures\.length,/,
  "Failed follow ups count toward the autopilot failure total, which is the failures it names.",
);

// An unknown delivery must not park a supplier forever: every run settles the
// reserved follow ups first, a confirmed one is recorded and a send the mailbox
// never saw releases the slot.
assert.match(
  module,
  /export async function reconcileProcurementSupplierNudges/,
  "Reserved follow ups have a reconcile path of their own.",
);
assert.match(
  module,
  /await reconcileProcurementSupplierNudges\(\{\s*orderId: order\.orderId/,
  "A run reconciles before it reads the plan.",
);
assert.match(
  module,
  /receipt\.state === "NOT_FOUND"[\s\S]{0,200}releaseEmailSenderReservation/,
  "A follow up the mailbox never saw frees the reservation again.",
);
assert.match(
  module,
  /nudgeRfcMessageId\(\{ orderId: order\.orderId, vendorId, round, addressHash \}\)/,
  "Reconcile asks the provider about the exact message the round sent to that address.",
);
// A follow up left uncertain has to be settled on the thread it actually rode.
// A supplier re-sourced after a wrong contact has one RFQ thread per address, so
// picking the newest one would have filed the old delivery on the replacement
// conversation and shown the supplier an outbound message it never received.
assert.match(
  module,
  /idempotencyKey: `procurement-bulk-rfq:\$\{order\.orderId\}:\$\{addressHash\}:\$\{vendorId\}`/,
  "A reserved follow up is settled on the RFQ thread of the address it was sent to.",
);
assert.match(
  module,
  /orderBy: \{ createdAt: "asc" \},\s*select: \{ localThreadId: true \}/,
  "An older addressless follow up predates re-sourcing, so it belongs to the first RFQ thread.",
);
assert.match(
  module,
  /const recipient = addressHash\s*\? known\.find\(\(email\) => bulkRfqAddressHash\(email\) === addressHash\)\s*: retired\.at\(0\) \?\? current \?\? undefined;/,
  "A settled follow up names the address it was reserved for, retired or not.",
);

// Eligibility is re-read immediately before each send, so a request cancelled
// mid run stops mailing the suppliers still in the plan.
assert.match(
  module,
  /if \(!await nudgeStillEligible\(/,
  "A target whose request or supplier closed mid run is skipped, not mailed.",
);

const postBlock = route.slice(route.indexOf("export async function POST"));
assert.match(
  postBlock,
  /payload\.action === "reconcile"/,
  "An operator can settle unknown deliveries without mailing anyone.",
);
assert.doesNotMatch(getBlock, /reconcileProcurementSupplierNudges/, "GET stays free of side effects.");

// A reservation young enough to belong to a send still in flight is left alone,
// so a concurrent run cannot have its slot released and mail the supplier twice.
assert.match(
  module,
  /updatedAt: \{ lt: new Date\(Date\.now\(\) - NUDGE_RECONCILE_MIN_AGE_MS\) \}/,
  "Only slots untouched long enough to be settled are reconciled, so a reused reservation keeps the same protection.",
);
// A slot that stays uncertain rotates to the back of the queue, so ten stuck
// deliveries cannot hold every pass and starve newer ones.
assert.match(module, /orderBy: \{ updatedAt: "asc" \}/, "Least recently checked slots are reconciled first.");
assert.match(
  module,
  /if \(receipt\.state !== "SENT"\) \{\s*await touchReservation\(/,
  "An uncertain slot is touched so the next pass moves on to newer deliveries.",
);
// A pass with nothing old enough to check still reports the outstanding work.
assert.match(
  module,
  /reconciled: 0,\s*remaining: await countReservedNudges\(/,
  "An empty pass still counts every unresolved follow up slot.",
);
// A provider check can spend its own timeout, so the pass is small and stops at
// its own deadline instead of being killed by the route.
assert.match(
  module,
  /NUDGE_MAX_RECONCILE_PER_RUN = 10;/,
  "A reconcile pass stays small enough for the route budget.",
);
assert.match(
  module,
  /if \(Date\.now\(\) >= deadline\) break;/,
  "A reconcile pass gives up its remaining work at its own deadline.",
);
// A supplier that answered while the run was working belongs to the reply path.
assert.match(
  module,
  /direction: "INBOUND"[\s\S]{0,80}\}\);\s*if \(inbound > 0\) return false;/,
  "A reply that lands mid run stops the queued follow up.",
);

console.log("procurement supplier nudge policy and command contracts passed");
