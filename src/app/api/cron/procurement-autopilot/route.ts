import { NextResponse } from "next/server";
import { runDueBackgroundJobs } from "@/lib/background-jobs";
import {
  AUTOPILOT_MAX_ORDERS_PER_RUN,
  listAutopilotOrderIds,
  rotateAutopilotOrderIds,
  runProcurementAutopilot,
} from "@/lib/procurement-autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

// The scheduled pass keeps every live sourcing request moving between operator
// commands, and answers the supplier replies it finds: a reply that only an
// operator command could answer stayed unanswered for as long as nobody ran
// one. Commercial commitments are still not automated, because a question about
// price, payment terms, or legal wording is escalated rather than answered.
// Only replies that currently await an answer are delivered. A quiet thread
// chase and a first contact nudge are unsolicited mail nobody asked us to
// send, so this pass plans and reports them and an operator confirms them.
// The exception is a supplier who already answered with part of a quote: the
// one question standing between their reply and a purchase order is asked on
// their own thread, because leaving that for an operator command is what left
// partial readings sitting untouched between commands.
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
    // Rotation covers the whole eligible queue, not the requests one pass can
    // work: taking the first requests of an oldest first list every time is how
    // a later request would never be worked at all.
    const queue = rotateAutopilotOrderIds(await listAutopilotOrderIds(), startedAt);
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
          sendFollowUps: false,
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
      requests: runs.length,
      deferred,
      failed,
      runs,
    }, { headers: responseHeaders });
  } catch (error) {
    console.error("procurement autopilot cron failed", error);
    return NextResponse.json({ error: "The sourcing autopilot pass failed." }, { status: 503, headers: responseHeaders });
  }
}
