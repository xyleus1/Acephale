import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  autopilotEscalations,
  autopilotFailures,
  autopilotRequestStage,
  planAutopilotVendorAction,
  rotateAutopilotOrderIds,
  rotateAutopilotQueue,
  AUTOPILOT_ROTATION_WINDOW_MS,
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
const quoteSource = readFileSync(resolve(__dirname, "../src/lib/procurement-supplier-quote.ts"), "utf8");
const draftBatchSource = readFileSync(
  resolve(__dirname, "../src/lib/procurement-file-draft-batch.ts"),
  "utf8",
);
assert.ok(
  /quote:\s*quoteRun\?\.outcomes/.test(autopilotSource),
  "The loop passes quote capture outcomes into its failure report.",
);
assert.ok(
  /quoteRun\?\.failed \?\? 0/.test(autopilotSource),
  "A failed quote write counts toward the failure total of the pass.",
);

// The scheduled pass answers the replies it finds and stops before the
// invocation limit, so a queue longer than one pass rotates instead of leaving
// the requests at its end permanently unworked.
assert.deepEqual(
  rotateAutopilotOrderIds(["a", "b", "c"], AUTOPILOT_ROTATION_WINDOW_MS * 4),
  ["b", "c", "a"],
  "Each window starts the queue one request further along.",
);
assert.deepEqual(
  rotateAutopilotOrderIds(["a"], AUTOPILOT_ROTATION_WINDOW_MS * 7),
  ["a"],
  "A single request queue is unchanged.",
);
assert.deepEqual(
  rotateAutopilotOrderIds(["a", "b"], Number.NaN),
  ["a", "b"],
  "An unusable clock leaves the queue order alone rather than throwing.",
);
const cronSource = readFileSync(
  resolve(__dirname, "../src/app/api/cron/procurement-autopilot/route.ts"),
  "utf8",
);
assert.ok(
  /autoSend: true/.test(cronSource) && /bestEffort: true/.test(cronSource),
  "The scheduled pass answers supplier replies instead of waiting for an operator command.",
);
// Answering a reply is what the supplier is waiting for. A quiet thread chase
// and a first contact nudge are unsolicited mail, so an unattended pass plans
// and reports them and an operator confirms them.
assert.ok(
  /sendFollowUps: false/.test(cronSource),
  "The scheduled pass must not deliver chases or nudges.",
);
assert.ok(
  /const sendFollowUps = autoSend && args\.sendFollowUps !== false/.test(autopilotSource),
  "Follow up sending is a separate control that defaults to the send instruction.",
);
assert.ok(
  /const nudgeRun = sendFollowUps/.test(autopilotSource),
  "Nudges are delivered only when follow up sending is on.",
);
assert.ok(
  /entry\.action\.kind === "CHASE" && sendFollowUps/.test(autopilotSource),
  "A chase draft is not even written when follow up sending is off, or a later pass would send it as a ready draft.",
);
assert.ok(
  /sendFollowUps\s*\|\| entry\.state\.lastDirection === "INBOUND"/.test(autopilotSource),
  "Without follow up sending, delivery is restricted to threads whose newest message is the supplier's, or to a saved ask for a missing commercial fact.",
);
assert.ok(
  /const deadlineAt = startedAt \+ PASS_BUDGET_MS/.test(cronSource)
    && /Date\.now\(\) >= deadlineAt/.test(cronSource),
  "The scheduled pass stops before the invocation limit so it can still report.",
);
// Starting a request in time does not finish it: one request runs a quote
// sweep, a draft batch, a thread scan per respondent and a send batch, so the
// deadline has to reach inside the pass or a slow request still runs the
// invocation out and the whole response is discarded.
assert.ok(
  /deadlineAt,/.test(cronSource),
  "The invocation deadline is passed into the pass, not only checked between requests.",
);
assert.ok(
  /const outOfTime = \(\) => deadlineAt !== null && Date\.now\(\) >= deadlineAt/.test(autopilotSource),
  "A pass knows when to stop starting work.",
);
for (const phase of [
  /const quoteRun = outOfScanTime\(\)/,
  /const draftRun = outOfScanTime\(\) \? null :/,
  /if \(args\.outOfTime\?\.\(\)\) return \{ states, anchors, stopped: true \}/,
  /if \(args\.outOfTime\?\.\(\)\) return \{ drafted, failures, stopped: true \}/,
  /const nudgeRun = sendFollowUps && !outOfScanTime\(\)/,
  /const sendRun = autoSend && deliverable\.length && !outOfTime\(\)/,
]) {
  assert.ok(phase.test(autopilotSource), `Every phase of a pass checks the deadline: ${String(phase)}`);
}
// A phase long enough to outlast the deadline on its own would lose the report
// even when it started in time, so the deadline reaches inside the phases too.
assert.ok(
  /outOfTime: outOfScanTime/.test(autopilotSource)
    && /if \(page > 0 && input\.outOfTime\?\.\(\)\) break;/.test(quoteSource)
    && /if \(args\.outOfTime\?\.\(\)\) break;/.test(draftBatchSource),
  "The quote sweep and the draft batch stop between their own units of work.",
);
// A scan that spent the whole budget and then had no time to send would answer
// nobody, and a request too large for one pass would send nothing forever.
assert.ok(
  /const scanDeadlineAt = deadlineAt === null \? null : deadlineAt - AUTOPILOT_SEND_RESERVE_MS/
    .test(autopilotSource),
  "Reading stops early enough that the answers it collected are still sent.",
);
assert.ok(
  /rotateAutopilotQueue\(scanned\.vendors, args\.rotateFrom\)/.test(autopilotSource),
  "Respondents rotate, so a request whose scan cannot finish still reaches every thread.",
);
// A target that fails on every attempt would hold the front of the batch for
// good, so the eligible drafts rotate too, and a draft that cannot be written
// is named rather than counted.
// The expensive part of the batch is reading a conversation per replier, so
// that read rotates too: rotating only the targets it produced would reread the
// same prefix every pass and never draft the repliers past a deadline cut.
assert.ok(
  /rotateAutopilotQueue\(replied\.vendors, rotateFrom\)/.test(draftBatchSource),
  "The draft batch rotates the repliers it reads, not only the targets it read.",
);
assert.ok(
  !/rotateAutopilotQueue\(eligible/.test(draftBatchSource)
    && /rotateFrom: deadlineAt === null \? undefined : Date\.now\(\)/.test(autopilotSource),
  "The batch rotates once, so two rotations of the same window cannot cancel out.",
);
// One rotation per window, applied once, has to reach every replier: a batch
// that writes a single draft a pass still leads with each supplier in turn.
for (const size of [2, 3, 4, 5, 8]) {
  const repliers = Array.from({ length: size }, (_, index) => `vendor-${index}`);
  const led = new Set<string>();
  for (let window = 0; window < size; window += 1) {
    const ordered = rotateAutopilotQueue(repliers, window * AUTOPILOT_ROTATION_WINDOW_MS);
    led.add(ordered.slice(0, 1)[0]);
  }
  assert.equal(led.size, size, `every one of ${size} repliers leads a pass within one queue length`);
}
assert.deepEqual(
  autopilotFailures({
    chase: [],
    draft: [{ vendorId: "v1", vendorName: "Arctic Circuits", state: "FAILED", error: null }],
  }),
  [{ vendorId: "v1", vendorName: "Arctic Circuits", error: "The supplier reply draft failed." }],
  "A reply that could not be drafted reaches the operator.",
);
// A count that disagrees with the named failures reads as a clean pass, so
// every path that can fail feeds the same total.
assert.ok(
  /\(draftRun\?\.failed \?\? 0\)/.test(autopilotSource)
    && /\+ chaseRun\.failures\.length/.test(autopilotSource),
  "The failure count covers the drafts a reply needs before it can be delivered.",
);
{
  // One pass consumes the whole remaining budget: the units it did not begin
  // are left for the next pass, and the rotation makes them lead it.
  const respondents = ["a", "b", "c", "d"];
  const startedAt = 5 * AUTOPILOT_ROTATION_WINDOW_MS;
  const deadlineAt = startedAt + 240_000;
  const scanDeadlineAt = deadlineAt - 60_000;
  let now = startedAt;
  const read: string[] = [];
  for (const respondent of rotateAutopilotQueue(respondents, startedAt)) {
    if (now >= scanDeadlineAt) break;
    read.push(respondent);
    now += 100_000;
  }
  assert.deepEqual(read, ["b", "c"], "A pass reads what it can afford and stops before its deadline.");
  assert.ok(read.length < respondents.length, "A pass that ran out of budget leaves the rest deferred.");
  assert.ok(now < deadlineAt, "The reserve leaves time to send what the partial scan collected.");
  const next = rotateAutopilotQueue(respondents, startedAt + 2 * AUTOPILOT_ROTATION_WINDOW_MS);
  assert.equal(next[0], "d", "A respondent the pass could not reach leads a later pass.");
}
assert.ok(
  /stoppedAtDeadline: scanStopped \|\| chaseRun\.stopped \|\| outOfTime\(\)/.test(autopilotSource)
    && /if \(run\.stoppedAtDeadline\) deferred \+= 1/.test(cronSource),
  "A request the pass could not finish is reported as deferred rather than looking complete.",
);
// Every request has to lead a pass eventually, whatever a pass managed to
// work, so a window step larger than one is never taken: it would skip what
// the pass did not reach, and a step sharing a factor with the queue length
// would visit only part of the queue forever.
const leaders = new Set(
  Array.from({ length: 10 }, (_value, window) => rotateAutopilotOrderIds(
    ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    AUTOPILOT_ROTATION_WINDOW_MS * window,
  )[0]),
);
assert.equal(leaders.size, 10, "Every request in the queue leads a pass within one queue length of windows.");
assert.ok(
  /const startedAt = Date\.now\(\);[\s\S]{0,400}runDueBackgroundJobs/.test(cronSource),
  "The pass deadline covers the sourcing slice, which can spend most of the invocation.",
);
assert.ok(
  /queue\.slice\(0, AUTOPILOT_MAX_ORDERS_PER_RUN\)/.test(cronSource)
    && /rotateAutopilotOrderIds\(await listAutopilotOrderIds\(\), startedAt\)/.test(cronSource),
  "Rotation covers the whole eligible queue before the pass takes the requests it can work.",
);
assert.ok(
  /listAutopilotOrderIds\(limit = AUTOPILOT_MAX_QUEUE\)/.test(autopilotSource)
    && /AUTOPILOT_MAX_QUEUE = \d+/.test(autopilotSource),
  "The eligible queue is read past the requests one pass can work.",
);

// A failed attempt delivered nothing, and its sender can since have been
// paused or disconnected, so the replacement sender must not be refused as a
// changed message.
const replySendSource = readFileSync(resolve(__dirname, "../src/lib/procurement-reply-send.ts"), "utf8");
assert.ok(
  /existingInput\.messageHash !== messageHash && !sameReplyFromAnotherMailbox/.test(replySendSource),
  "An attempt may be retried or reconciled from another mailbox.",
);
assert.ok(
  /replyContentHash\(record\(existingInput\.message\)\) === replyContentHash\(message\)/.test(replySendSource),
  "The retry has to carry the reply the earlier attempt was made with, only from another sender.",
);
assert.ok(
  /accountId: claimed\.reconcileSender\?\.accountId \?\? sender\.id/.test(replySendSource),
  "An unresolved delivery is reconciled through the mailbox that was handed the message.",
);
assert.ok(
  /sendPausedAt: null/.test(replySendSource),
  "A mailbox paused by sender protection is not chosen as the thread sender.",
);

console.log("procurement autopilot plan checks passed");
