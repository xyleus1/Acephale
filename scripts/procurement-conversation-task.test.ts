import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { prioritizeAutopilotQueue } from "../src/lib/procurement-autopilot-plan";
import {
  CONVERSATION_TASK_BACKOFF_MS,
  conversationTaskBackoffMs,
  conversationTaskDue,
  conversationTaskEntries,
  nextConversationTaskState,
} from "../src/lib/procurement-conversation-task";

const now = new Date("2026-09-04T12:00:00.000Z");

// A failed send is the case that kept leaking: it was reported once and then
// forgotten. It has to stay owed, with a growing delay so it cannot eat every
// pass, and it must never be reported as settled.
let state = nextConversationTaskState(
  null,
  {
    stage: "ANSWER_READY",
    action: "SEND_DRAFT",
    attempted: true,
    progressed: false,
    failure: "The supplier send failed.",
  },
  now,
);
assert.equal(state.attempts, 1);
assert.equal(state.settledAt, null);
assert.equal(state.lastSuccessAt, null);
assert.equal(state.nextAttemptAt.getTime(), now.getTime() + CONVERSATION_TASK_BACKOFF_MS[0]);
assert.equal(conversationTaskDue(state, now), false, "A thread that just failed waits out its backoff.");
assert.equal(conversationTaskDue(state, new Date(state.nextAttemptAt.getTime())), true);

state = nextConversationTaskState(
  state,
  { stage: "ANSWER_READY", action: "SEND_DRAFT", attempted: true, progressed: false, failure: "again" },
  now,
);
assert.equal(state.attempts, 2);
assert.equal(state.nextAttemptAt.getTime(), now.getTime() + CONVERSATION_TASK_BACKOFF_MS[1]);

// The last delay repeats rather than growing without bound or giving up, so a
// thread blocked by an exhausted sender pool is retried daily forever.
assert.equal(
  conversationTaskBackoffMs(CONVERSATION_TASK_BACKOFF_MS.length + 5),
  CONVERSATION_TASK_BACKOFF_MS[CONVERSATION_TASK_BACKOFF_MS.length - 1],
);
assert.equal(conversationTaskBackoffMs(0), CONVERSATION_TASK_BACKOFF_MS[0]);

// Progress clears the backoff, so a long conversation that failed once early is
// not left on an hours long delay for the rest of its life.
const progressed = nextConversationTaskState(
  state,
  { stage: "AWAITING_QUOTE", action: "SEND_DRAFT", attempted: true, progressed: true, failure: null },
  now,
);
assert.equal(progressed.attempts, 0);
assert.equal(progressed.nextAttemptAt.getTime(), now.getTime());
assert.equal(progressed.lastSuccessAt?.getTime(), now.getTime());
assert.equal(progressed.settledAt, null, "A quote has not been recorded yet, so the thread is still owed.");

// A recorded quote is the only settled state, and a supplier with no address is
// unreachable, so neither is retried.
for (const stage of ["QUOTED", "NO_CONTACT_METHOD"] as const) {
  const settled = nextConversationTaskState(
    state,
    { stage, action: stage, attempted: true, progressed: false },
    now,
  );
  assert.equal(settled.attempts, 0);
  assert.ok(settled.settledAt, `${stage} stops being retried.`);
  assert.equal(conversationTaskDue(settled, new Date(now.getTime() + 86_400_000)), false);
}

// A thread waiting on a supplier has not failed, so it stays due for the next
// scheduled pass instead of backing off.
const waiting = nextConversationTaskState(
  null,
  { stage: "AWAITING_FIRST_REPLY", action: "NONE", attempted: true, progressed: false, failure: null },
  now,
);
assert.equal(
  waiting.attempts,
  0,
  "Waiting on a supplier is not a failed attempt, so it never looks stuck.",
);
assert.equal(waiting.nextAttemptAt.getTime(), now.getTime());
assert.equal(conversationTaskDue(waiting, now), true);

// A thread that failed and is then only waiting stops carrying the old failure
// count, so the next real failure starts its backoff from the short delay.
const recovered = nextConversationTaskState(
  {
    attempts: 4,
    lastSuccessAt: null,
    lastError: "The supplier send failed.",
    lastAttemptAt: new Date(now.getTime() - 3_600_000),
    nextAttemptAt: new Date(now.getTime() - 60_000),
  },
  { stage: "AWAITING_QUOTE", action: "NONE", attempted: true, progressed: false, failure: null },
  now,
);
assert.equal(recovered.attempts, 0);
assert.equal(recovered.lastError, null);

// A pass bounded by its deadline or its batch limit projects a stage for a
// thread it never worked. That is not a success, so the failure count, the
// error and the backoff of that thread survive it: this is what used to erase
// the retry history of a supplier the pass simply did not reach.
const untouchedCurrent = {
  attempts: 3,
  lastSuccessAt: null,
  lastError: "The shared sender pool is exhausted.",
  lastAttemptAt: new Date(now.getTime() - 7_200_000),
  nextAttemptAt: new Date(now.getTime() + 3_600_000),
};
const untouched = nextConversationTaskState(
  untouchedCurrent,
  { stage: "ANSWER_READY", action: "SEND_DRAFT", attempted: false, progressed: false, failure: null },
  now,
);
assert.equal(untouched.attempts, 3, "A thread the pass never worked keeps its failure count.");
assert.equal(untouched.lastError, untouchedCurrent.lastError);
assert.equal(untouched.nextAttemptAt.getTime(), untouchedCurrent.nextAttemptAt.getTime());
assert.equal(untouched.lastAttemptAt.getTime(), untouchedCurrent.lastAttemptAt.getTime());
assert.equal(untouched.settledAt, null);
assert.equal(conversationTaskDue(untouched, now), false, "Its own backoff still holds.");

// A thread with no stored task yet is written as owed rather than skipped, so a
// supplier first seen by a pass that could not reach it is still owned.
const untouchedNew = nextConversationTaskState(
  null,
  { stage: "AWAITING_FIRST_REPLY", action: "NONE", attempted: false, progressed: false, failure: null },
  now,
);
assert.equal(untouchedNew.attempts, 0);
assert.equal(conversationTaskDue(untouchedNew, now), true);

// A quote recorded elsewhere settles the thread even on a pass that did not
// work it, since that is a fact about the conversation, not about the pass.
const untouchedQuoted = nextConversationTaskState(
  untouchedCurrent,
  { stage: "QUOTED", action: "NONE", attempted: false, progressed: false, failure: null },
  now,
);
assert.ok(untouchedQuoted.settledAt);
assert.equal(conversationTaskDue(untouchedQuoted, now), false);

// An operator state is still owed work, since nothing clears it on its own and
// a request that reports it as finished is exactly the leak being fixed.
const operator = nextConversationTaskState(
  null,
  { stage: "NEEDS_OPERATOR", action: "ESCALATE", attempted: true, progressed: false, failure: null },
  now,
);
assert.equal(operator.settledAt, null);

const entries = conversationTaskEntries({
  entries: [
    {
      input: {
        vendorId: "v1",
        vendorName: "One",
        lastDirection: "INBOUND",
        inboundKind: "QUESTION",
        triageDecision: null,
        hasDraft: true,
        hasQuote: false,
        repliedEver: true,
      },
      action: { kind: "SEND_DRAFT" },
      attempted: false,
    },
    {
      input: {
        vendorId: "v2",
        vendorName: "Two",
        lastDirection: "OUTBOUND",
        inboundKind: null,
        triageDecision: null,
        hasDraft: false,
        hasQuote: false,
        repliedEver: false,
      },
    },
  ],
  failures: new Map([["v1", "The supplier send failed."]]),
  progressed: new Set(["v1", "v2"]),
});
assert.equal(entries.length, 2);
assert.equal(
  entries[0].progressed,
  false,
  "A thread that failed this pass keeps owning its task even when another phase touched it.",
);
assert.equal(entries[0].failure, "The supplier send failed.");
assert.equal(entries[0].action, "SEND_DRAFT");
assert.equal(entries[1].action, "AWAITING_FIRST_REPLY", "Without a planned action the stage names the work.");
assert.equal(entries[1].progressed, true);
assert.equal(
  entries[0].attempted,
  true,
  "A thread that failed was worked, whatever the caller projected for it.",
);
assert.equal(entries[1].attempted, true, "A thread that moved forward was worked too.");

// A supplier the pass only projected a stage for is recorded as unattempted, so
// the store keeps what it already knew about that thread.
const projected = conversationTaskEntries({
  entries: [
    {
      input: {
        vendorId: "v3",
        vendorName: "Three",
        lastDirection: "OUTBOUND",
        inboundKind: null,
        triageDecision: null,
        hasDraft: false,
        hasQuote: false,
        repliedEver: false,
      },
      attempted: false,
    },
  ],
  failures: new Map(),
  progressed: new Set(),
});
assert.equal(projected[0].attempted, false);

// A request whose conversations owe work now leads the pass, and one with no
// stored task is still reached rather than starved.
assert.deepEqual(
  prioritizeAutopilotQueue(["a", "b", "c"], ["c", "c", "b"]),
  ["c", "b", "a"],
);
assert.deepEqual(
  prioritizeAutopilotQueue(["a", "b"], ["z"]),
  ["a", "b"],
  "A due request outside the eligible queue never enters the pass.",
);

// The stored task is only worth anything if the pass writes it and the
// scheduled pass reads it, which is the wiring that turns the retry rule into
// a conversation that carries itself to a quote.
const autopilotSource = readFileSync(resolve(__dirname, "../src/lib/procurement-autopilot.ts"), "utf8");
assert.ok(
  /await recordConversationTasks\(\{/.test(autopilotSource)
    && /entries: conversationTaskEntries\(\{\s*entries: funnelEntries/.test(autopilotSource),
  "Every thread the funnel covers is written back as a task, not only the ones that failed.",
);
assert.ok(
  /backlog,/.test(autopilotSource),
  "A pass reports the work that outlives it.",
);
assert.ok(
  /listBackingOffConversationVendorIds\(\{/.test(autopilotSource)
    && /skipVendorIds: backingOff/.test(autopilotSource)
    && /backingOff\.has\(entry\.vendorId\)/.test(autopilotSource),
  "A conversation waiting out its own backoff is not retried because another conversation of the same request is due.",
);
assert.ok(
  /await settleAbsentConversationTasks\(\{/.test(autopilotSource)
    && /activeVendorIds: funnelEntries\.map/.test(autopilotSource),
  "A supplier the request stopped pursuing does not keep its request in the due queue.",
);
assert.ok(
  /attempted: false \}\)\),/.test(autopilotSource),
  "A supplier the pass only projected is written as unattempted.",
);
assert.ok(
  /\$\{VENDOR_SENT_MESSAGE_ID_SQL\} IS NOT NULL/.test(autopilotSource),
  "Scheduled eligibility reads the same current or legacy contacted stamp as the rest of the loop.",
);
const taskStoreSource = readFileSync(
  resolve(__dirname, "../src/lib/procurement-conversation-task-store.ts"),
  "utf8",
);
assert.ok(
  /GROUP BY "orderId"/.test(taskStoreSource) && /ORDER BY MIN\("nextAttemptAt"\)/.test(taskStoreSource),
  "Due requests are grouped in the database, so one request with many old tasks cannot hide the others.",
);
assert.ok(
  /prisma\.\$transaction\(async \(tx\) => \{/.test(taskStoreSource)
    && /FOR UPDATE/.test(taskStoreSource)
    && /error\.code === "P2002"/.test(taskStoreSource),
  "A transition reads and writes one thread under a row lock, so two overlapping passes cannot lose a failure.",
);
assert.ok(
  new RegExp(
    "listBackingOffConversationVendorIds\\(\\{[\\s\\S]*?\\}\\)\\);[\\s\\S]*?sweepSupplierQuoteCapture\\(",
  ).test(autopilotSource)
    && /skipVendorIds: backingOff,\n\s*\}\);/.test(autopilotSource),
  "Backoff is read before the quote write and the draft, which are retries too.",
);
for (const [file, label] of [
  ["../src/lib/procurement-supplier-quote.ts", "quote write"],
  ["../src/lib/procurement-file-draft-batch.ts", "draft"],
] as const) {
  const source = readFileSync(resolve(__dirname, file), "utf8");
  assert.ok(
    /skipVendorIds/.test(source) && /!skipVendorIds/.test(source.replace(/input\.|args\./g, "")),
    `A conversation waiting out its backoff is left out of the ${label} batch.`,
  );
}
const cronSource = readFileSync(
  resolve(__dirname, "../src/app/api/cron/procurement-autopilot/route.ts"),
  "utf8",
);
assert.ok(
  /listDueConversationTaskOrderIds\(\{[\s\S]*?orderIds: rotated,/.test(cronSource)
    && /prioritizeAutopilotQueue\(rotated, dueOrderIds\)/.test(cronSource),
  "The scheduled pass leads with the requests whose conversations owe an action now, chosen from the queue it may work.",
);
assert.ok(
  /backlogReadFailed = true/.test(cronSource) && /stored: run\.backlogStored/.test(cronSource),
  "A store that cannot be read or written is reported, not read as nothing owed.",
);

console.log("procurement conversation task checks passed");
