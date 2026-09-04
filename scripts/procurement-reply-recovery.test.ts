import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PROCUREMENT_REPLY_SENDER_UNAVAILABLE,
  ProcurementReplySenderUnavailableError,
} from "../src/lib/procurement-reply-errors";

const error = new ProcurementReplySenderUnavailableError("operator@example.com");
assert.equal(error.reason, PROCUREMENT_REPLY_SENDER_UNAVAILABLE);
assert.match(error.message, /operator@example\.com/);
assert.match(error.message, /this Derya office/);

const root = process.cwd();
const sender = readFileSync(resolve(root, "src/lib/procurement-reply-send.ts"), "utf8");
const handlers = readFileSync(resolve(root, "src/lib/procurement-route-handlers.ts"), "utf8");
const active = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-active-sourcing.tsx"), "utf8");

// A pooled fallback that found nothing is a pool problem, and an operator told
// to reconnect the thread's mailbox instead would fix nothing.
const pooled = new ProcurementReplySenderUnavailableError("operator@example.com", "SENDER_POOL");
assert.equal(pooled.reason, PROCUREMENT_REPLY_SENDER_UNAVAILABLE);
assert.match(pooled.message, /shared sender pool/);
// A pool can be empty for several reasons at once, so the message names the
// pool as the place to look instead of asserting one cause.
assert.match(pooled.message, /disconnected, disabled, paused, or at their daily send limit/);
assert.doesNotMatch(pooled.message, /this Derya office/);
assert.match(sender, /args\.allowPooledSender \? "SENDER_POOL" : "THREAD_MAILBOX"/);
assert.match(handlers, /error instanceof ProcurementReplySenderUnavailableError/);
assert.match(handlers, /reason: error\.reason/);
assert.match(active, /payload\?\.reason \?\? null/);
assert.match(active, /replyDraftErrorReason === PROCUREMENT_REPLY_SENDER_UNAVAILABLE/);
assert.match(active, /href="\/dashboard\/settings\/connected-emails"/);
assert.match(active, /Manage connected emails/);

// An operator seeing replies go unanswered has to be able to tell a thread
// mailbox that cannot send from a sender pool with nothing left, so the
// read-only diagnostic reports both.
const diagnostics = readFileSync(resolve(root, "src/lib/procurement-inbox-diagnostics.ts"), "utf8");
assert.match(diagnostics, /senders: SenderReach/);
assert.match(diagnostics, /listEmailSenderPoolAccounts\(\)/);
assert.match(diagnostics, /capacityRemaining/);
assert.match(diagnostics, /SHARED_SENDER_POOL_FILTER/);
assert.match(diagnostics, /sendPaused: Boolean\(row\?\.sendPausedAt\)/);

console.log("Procurement reply sender recovery passed.");
