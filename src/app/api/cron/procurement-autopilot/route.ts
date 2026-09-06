import { NextResponse } from "next/server";
import { runDueBackgroundJobs } from "@/lib/background-jobs";
import {
  AUTOPILOT_MAX_ORDERS_PER_RUN,
  listAutopilotOrderIds,
  prioritizeAutopilotQueue,
  rotateAutopilotOrderIds,
  runProcurementAutopilot,
} from "@/lib/procurement-autopilot";
import { listDueConversationTaskOrderIds } from "@/lib/procurement-conversation-task-store";
import { recoverPausedSenderAccounts } from "@/lib/email-delivery-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

// The scheduled pass answers replies, chases quiet threads, and nudges silent
// suppliers without an operator command. Chases are bounded by
// MAX_SUPPLIER_CHASES, the quiet period, the per-request send limit, and
// sender-pool pacing. Follow ups stop when the campaign quote goal is reached.
// Price, terms, dates, and legal issues still escalate for operator review.
const PASS_BUDGET_MS = 240_000;
const REQUEST_SEND_LIMIT = 8;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json({ error: "Cron secret is not configured." }, { status: 503, headers: responseHeaders });
  }
  const authorization = request.headers.get("authorization");
  const suppliedSecret = request.headers.get("x-cron-secret")
    ?? (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
  if (suppliedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  }
  try {
    // The budget covers the whole invocation, so it starts before the sourcing
    // slice: a wave can spend most of the invocation on its own, and a deadline
    // measured after it would let one request run past the function limit.
    const startedAt = Date.now();
    const deadlineAt = startedAt + PASS_BUDGET_MS;
    // A sourcing wave asked for from the context chat runs in slices, so this
    // pass carries it forward instead of leaving it for the hourly job sweep.
    const waves = await runDueBackgroundJobs({ limit: 2, onlyTypes: ["PROCUREMENT_SOURCING_WAVE"] })
      .catch(() => null);
    // Sender protection pauses a mailbox that bounced and nothing lifted the
    // pause, so the pool shrank with every bad day until no answer could be
    // sent at all. A paused mailbox whose cooldown has passed is judged on its
    // current window here, before senders are chosen, and resumed when it reads
    // clean. A recovery that cannot run leaves the pauses in place rather than
    // stopping the pass, since answering from the mailboxes that can still send
    // is better than answering from none.
    const senders = await recoverPausedSenderAccounts({ now: new Date(startedAt) })
      .catch(() => null);
    // Rotation covers the whole eligible queue, not the requests one pass can
    // work: taking the first requests of an oldest first list every time is how
    // a later request would never be worked at all.
    const rotated = rotateAutopilotOrderIds(await listAutopilotOrderIds(), startedAt);
    // A request whose supplier conversations owe an action now leads the pass,
    // so a failed send or an unanswered reply is retried on the next scheduled
    // pass rather than waiting for the rotation to come back around to it.
    // A task store that cannot be read falls back to the rotation, since a pass
    // that answers requests in the wrong order is better than one that answers
    // none, but it says so: a silent fallback here would look exactly like a
    // queue with nothing owed.
    let dueOrderIds: string[] = [];
    let backlogReadFailed = false;
    try {
      // The due read is intersected with the eligible queue in the database, so
      // the limit is spent on requests this pass can actually work. A request
      // that reached an order or was cancelled keeps its unsettled tasks, and
      // those are the oldest due rows, so limiting first let them fill the
      // whole result and leave a live failing request unled.
      dueOrderIds = rotated.length
        ? await listDueConversationTaskOrderIds({
          limit: AUTOPILOT_MAX_ORDERS_PER_RUN,
          orderIds: rotated,
        })
        : [];
    } catch (error) {
      backlogReadFailed = true;
      console.error("procurement autopilot due conversation tasks failed", error);
    }
    const queue = prioritizeAutopilotQueue(rotated, dueOrderIds);
    const orderIds = queue.slice(0, AUTOPILOT_MAX_ORDERS_PER_RUN);
    const runs = [];
    let failed = 0;
    let deferred = Math.max(0, queue.length - orderIds.length);
    for (const orderId of orderIds) {
      // A pass killed at the invocation limit reports nothing and answers
      // nothing, so it stops itself while it can still report, and the request
      // it did not reach is first in the next rotation.
      if (Date.now() >= deadlineAt) {
        deferred += 1;
        continue;
      }
      try {
        const run = await runProcurementAutopilot({
          orderId,
          autoSend: true,
          sendFollowUps: true,
          bestEffort: true,
          limit: REQUEST_SEND_LIMIT,
          // Starting a request in time is not the same as finishing it: one
          // request runs a quote sweep, a draft batch, a thread scan and a send
          // batch, so the deadline goes into the pass and stops it between
          // those units of work rather than after the invocation is already
          // over.
          deadlineAt,
        });
        if (run) {
          // A request the pass could not finish is still owed work, so it is
          // counted as deferred and led by a later rotation.
          if (run.stoppedAtDeadline) deferred += 1;
          runs.push({
            orderId: run.orderId,
            material: run.material,
            stage: run.stage,
            quotes: run.quotes,
            quoteGoal: run.quoteGoal,
            quoteGoalReadFailed: run.quoteGoalReadFailed,
            goalReached: run.goalReached,
            replied: run.replied,
            drafted: run.drafted,
            sent: run.sent,
            nudged: run.nudged,
            // Named so a pass that withheld follow ups is visible in the
            // response rather than looking like a queue with nothing to chase.
            chaseCandidates: run.plan.filter((entry) => entry.action.kind === "CHASE").length,
            nudgeCandidates: run.nudgeCandidates,
            quoteFactAsks: run.quoteFactAsks,
            failed: run.failed,
            stoppedAtDeadline: run.stoppedAtDeadline,
            escalations: run.escalations.length,
            // Where the threads this pass read stand, so a request whose
            // conversations stalled says so in the scheduled response instead
            // of waiting for somebody to sweep it by hand. Threads still owed
            // an action are led by a later pass; the ones only a person can
            // move are counted separately, because no pass will clear them.
            conversations: {
              stages: run.funnel.stages,
              owed: run.funnel.owed,
              needsOperator: run.funnel.needsOperator.length,
              quoteIncomplete: run.funnel.quoteIncomplete.length,
            },
            // The stored work that outlives this pass: what is retried next,
            // what is waiting out a backoff after a failure, and the threads
            // that keep failing and need a person.
            backlog: {
              owed: run.backlog.owed,
              due: run.backlog.due,
              backingOff: run.backlog.backingOff,
              stuck: run.backlog.stuck.length,
              // An unwritable or unreadable store reports zero owed, which is
              // indistinguishable from a request with nothing to do unless the
              // pass says which one it is.
              stored: run.backlogStored,
            },
          });
        }
      } catch (error) {
        failed += 1;
        console.error("procurement autopilot request failed", orderId, error);
      }
    }
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      sourcingWaves: waves?.scanned ?? 0,
      senders: senders
        ? {
          paused: senders.scanned,
          resumed: senders.resumed.map((account) => account.email),
          held: senders.held.map((account) => ({ email: account.email, reason: account.reason, eligibleAt: account.eligibleAt })),
        }
        : null,
      requests: runs.length,
      deferred,
      failed,
      backlogReadFailed,
      runs,
    }, { headers: responseHeaders });
  } catch (error) {
    console.error("procurement autopilot cron failed", error);
    return NextResponse.json({ error: "The sourcing autopilot pass failed." }, { status: 503, headers: responseHeaders });
  }
}
