import type {
  SupplierConversationInput,
  SupplierConversationStage,
} from "@/lib/procurement-conversation-stage";
import {
  conversationOwesAction,
  supplierConversationStage,
} from "@/lib/procurement-conversation-stage";

// Durable ownership of a supplier conversation. Every earlier fix made one pass
// of the loop better, but the state of a thread was recomputed each pass and
// nothing survived it, so a failed draft, a failed send or a quote that could
// not be written was reported once and then forgotten: the next pass had no
// record that the thread was behind, and a supplier stalled until somebody swept
// the request by hand.
//
// A task is one supplier conversation of one request. It records what the loop
// owes that thread, how many times it has tried, when it may try again, what
// last failed and when it last got somewhere. That is what lets a scheduled
// pass keep carrying a thread toward a quote without being asked, and what lets
// a permanently failing thread back off instead of eating every pass.

export type ConversationTaskAttempt = {
  stage: SupplierConversationStage;
  // Whether this pass actually worked the thread. A pass is bounded by its
  // deadline and its batch limits, so it projects a stage for every supplier of
  // the request while only attempting some of them. Without this flag a thread
  // the pass never touched looked exactly like one that succeeded, and its
  // failure count, its error and its backoff were wiped by the next pass that
  // ran out of time before reaching it.
  attempted: boolean;
  // What the pass tried to do for this thread, kept as the planned action so an
  // operator reading a stuck task sees the work, not just the stage.
  action: string;
  // Set when the pass moved this thread forward: a reply answered, a draft
  // saved, a follow up delivered, a quote recorded. Progress clears the backoff,
  // because the next step is worth trying immediately.
  progressed: boolean;
  // The failure this thread hit in this pass, if any.
  failure?: string | null;
};

export type ConversationTaskState = {
  stage: SupplierConversationStage;
  action: string;
  attempts: number;
  nextAttemptAt: Date;
  lastAttemptAt: Date;
  lastError: string | null;
  lastSuccessAt: Date | null;
  settledAt: Date | null;
};

// Retry delays for a thread that keeps failing. A supplier conversation is not
// urgent by the second, and the failures that actually happen here are a paused
// mailbox, an exhausted sender pool or a database write refused, all of which
// clear on their own in minutes to hours. The last delay repeats, so a thread is
// never abandoned: it keeps being retried daily until it settles or an operator
// closes it.
export const CONVERSATION_TASK_BACKOFF_MS: readonly number[] = [
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
  24 * 60 * 60_000,
];

// A failure that says nothing about this conversation: every mailbox in the
// sender pool is at its daily cap, paused, or the pool read empty. The thread
// is ready, the request has the answer written, and only a sender is missing,
// so it is queued rather than backed off: capacity returns on its own (a daily
// cap resets, a protection pause expires) and the next pass should try it
// again instead of pushing it hours out and calling it stuck. This is the
// difference between a thread that refuses to work and one nobody could send
// for.
// A pinned thread mailbox that is disconnected or disabled is not in this
// class: that one needs an operator to reconnect it, so it keeps its backoff.
const CAPACITY_FAILURE = /daily pooled-send limit|no connected email account is enabled in the sender pool|no mailbox in the shared sender pool is currently able|sender pool (is )?(empty|exhausted)|paused or (has|have) sending turned off|mailboxes? in the sender pool (is|are) paused/i;

export function conversationFailureIsCapacity(failure: string | null | undefined): boolean {
  return CAPACITY_FAILURE.test(failure ?? "");
}

export function conversationTaskBackoffMs(attempts: number) {
  const index = Math.max(0, Math.trunc(attempts) - 1);
  return CONVERSATION_TASK_BACKOFF_MS[Math.min(index, CONVERSATION_TASK_BACKOFF_MS.length - 1)];
}

// The next persisted state of a thread after a pass worked it. Pure, so the
// retry rule is testable without a database and identical for every caller.
export function nextConversationTaskState(
  current: Pick<
    ConversationTaskState,
    "attempts" | "lastSuccessAt" | "nextAttemptAt" | "lastAttemptAt" | "lastError"
  > | null,
  attempt: ConversationTaskAttempt,
  now: Date,
): ConversationTaskState {
  const settled = !conversationOwesAction(attempt.stage);
  const failure = attempt.failure?.trim() ? attempt.failure.trim().slice(0, 500) : null;
  // A thread the pass did not work keeps the retry history it already had: only
  // the stage it projects is refreshed, and a thread that reached a settled
  // stage is still settled, since that is a fact about the thread rather than
  // about this pass.
  if (!attempt.attempted && !failure && current) {
    return {
      stage: attempt.stage,
      action: attempt.action,
      attempts: Math.max(0, Math.trunc(current.attempts)),
      nextAttemptAt: settled ? now : current.nextAttemptAt,
      lastAttemptAt: current.lastAttemptAt,
      lastError: current.lastError,
      lastSuccessAt: settled ? now : current.lastSuccessAt,
      settledAt: settled ? now : null,
    };
  }
  // A thread nobody had a mailbox for is queued: it keeps whatever attempt
  // count it already had, so a capacity shortage cannot back a ready thread off
  // to a daily retry or make it read as stuck, and it stays due so the next
  // pass sends it the moment a mailbox is free again. The failure is still
  // recorded, so why it waited is not lost.
  const queued = !settled && !attempt.progressed && conversationFailureIsCapacity(failure);
  // Attempts count failures only. A settled thread, a thread that moved forward
  // and a thread simply waiting on its supplier are all at zero, so the count
  // means "how many times this has refused to work" and an operator reading a
  // high count is reading a real blockage.
  const attempts = settled || attempt.progressed || !failure
    ? 0
    : queued
      ? Math.max(0, Math.trunc(current?.attempts ?? 0))
      : Math.max(0, Math.trunc(current?.attempts ?? 0)) + 1;
  const nextAttemptAt = attempts === 0 || queued
    // Without a failure the thread is simply waiting on the next pass, which is
    // scheduled work rather than a retry, so it stays due. A queued thread is
    // due for the same reason: the work is ready and only a sender is missing.
    ? now
    : new Date(now.getTime() + conversationTaskBackoffMs(attempts));
  return {
    stage: attempt.stage,
    action: attempt.action,
    attempts,
    nextAttemptAt,
    lastAttemptAt: now,
    lastError: failure,
    lastSuccessAt: attempt.progressed || settled ? now : (current?.lastSuccessAt ?? null),
    settledAt: settled ? now : null,
  };
}

export type ConversationTaskEntry = {
  vendorId: string;
  vendorName: string;
} & ConversationTaskAttempt;

// What a pass owes every supplier conversation it covered, built from the same
// entries the funnel is built from so the stored work and the reported funnel
// can never disagree. Pure, so what a pass persists is testable without a
// database.
export function conversationTaskEntries(args: {
  entries: readonly {
    input: SupplierConversationInput;
    action?: { kind: string };
    // False for a supplier the pass only projected a stage for: one it had no
    // time to read, one held back by its own backoff, or one outside the batch
    // it could afford.
    attempted?: boolean;
  }[];
  // Failures of this pass by supplier: a draft, send, follow up or quote write
  // that did not happen. These are what make a task back off and stay owed.
  failures: ReadonlyMap<string, string>;
  // Suppliers this pass moved forward.
  progressed: ReadonlySet<string>;
}): ConversationTaskEntry[] {
  return args.entries.map((entry) => {
    const stage = supplierConversationStage(entry.input);
    const failure = args.failures.get(entry.input.vendorId) ?? null;
    const progressed = !failure && args.progressed.has(entry.input.vendorId);
    return {
      vendorId: entry.input.vendorId,
      vendorName: entry.input.vendorName,
      stage,
      action: entry.action?.kind ?? stage,
      // A supplier that failed or moved was worked by definition, whatever the
      // caller projected.
      attempted: entry.attempted === true || Boolean(failure) || progressed,
      // A failed thread never counts as progressed, even when another phase of
      // the same pass touched it, so the failure keeps owning the task.
      progressed,
      failure,
    };
  });
}

// Whether a pass should work this thread now. A task that is not due is one
// that failed recently and is waiting out its backoff.
export function conversationTaskDue(
  task: Pick<ConversationTaskState, "nextAttemptAt" | "settledAt">,
  now: Date,
) {
  if (task.settledAt) return false;
  return task.nextAttemptAt.getTime() <= now.getTime();
}
