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

assert.match(sender, /throw new ProcurementReplySenderUnavailableError\(anchor\.accountEmail\)/);
assert.match(handlers, /error instanceof ProcurementReplySenderUnavailableError/);
assert.match(handlers, /reason: error\.reason/);
assert.match(active, /payload\?\.reason \?\? null/);
assert.match(active, /replyDraftErrorReason === PROCUREMENT_REPLY_SENDER_UNAVAILABLE/);
assert.match(active, /href="\/dashboard\/settings\/connected-emails"/);
assert.match(active, /Manage connected emails/);

console.log("Procurement reply sender recovery passed.");
