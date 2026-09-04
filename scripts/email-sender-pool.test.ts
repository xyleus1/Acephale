import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_EMAIL_DAILY_SEND_LIMIT,
  pinnedSenderUnavailableReason,
  rankEmailSenderPoolCandidates,
  selectEmailSenderPoolCandidate,
  utcDayBounds,
  validEmailDailySendLimit,
} from "../src/lib/email-sender-pool-policy";

const base = [
  { id: "a", email: "a@example.test", dailySendLimit: 30, sentToday: 2, reservedToday: 0 },
  { id: "b", email: "b@example.test", dailySendLimit: 30, sentToday: 1, reservedToday: 1 },
  { id: "c", email: "c@example.test", dailySendLimit: 30, sentToday: 1, reservedToday: 0 },
];
assert.deepEqual(rankEmailSenderPoolCandidates(base).map((row) => row.id), ["c", "a", "b"]);
assert.equal(selectEmailSenderPoolCandidate(base)?.id, "c");
assert.equal(selectEmailSenderPoolCandidate([
  { id: "small", email: "small@example.test", dailySendLimit: 10, sentToday: 5, reservedToday: 0 },
  { id: "large", email: "large@example.test", dailySendLimit: 30, sentToday: 10, reservedToday: 0 },
])?.id, "large", "allocation must balance utilization, not raw counts");
assert.equal(selectEmailSenderPoolCandidate([
  { id: "full", email: "full@example.test", dailySendLimit: 30, sentToday: 29, reservedToday: 1 },
]), null);
assert.equal(validEmailDailySendLimit(1), true);
assert.equal(validEmailDailySendLimit(MAX_EMAIL_DAILY_SEND_LIMIT), true);
assert.equal(validEmailDailySendLimit(0), false);
assert.equal(validEmailDailySendLimit(31), false);
assert.equal(validEmailDailySendLimit(4.5), false);
assert.deepEqual(utcDayBounds(new Date("2026-08-23T23:30:00-07:00")), {
  start: new Date("2026-08-24T00:00:00.000Z"),
  end: new Date("2026-08-25T00:00:00.000Z"),
});

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260823000200_email_sender_pool/migration.sql", "utf8");
const verification = readFileSync("scripts/sql/production-verification/20260823000200_email_sender_pool.sql", "utf8");
const page = readFileSync("src/app/dashboard/settings/connected-emails/page.tsx", "utf8");
const component = readFileSync("src/components/email-sender-pool.tsx", "utf8");
const actions = readFileSync("src/app/dashboard/settings/email/actions.ts", "utf8");
const settings = readFileSync("src/lib/email-sender-pool-settings.ts", "utf8");
const allocator = readFileSync("src/lib/email-sender-pool.ts", "utf8");
const gmailSend = readFileSync("src/lib/gmail-send.ts", "utf8");
const supplierCommunication = readFileSync("src/lib/supply-os/supplier-communication-persistence.ts", "utf8");
const nudge = readFileSync("src/lib/procurement-supplier-nudge.ts", "utf8");
const bulkRfq = readFileSync("src/lib/procurement-bulk-rfq.ts", "utf8");
const campaignSend = readFileSync("src/lib/outreach-campaign-send.ts", "utf8");
const campaignFollowUps = readFileSync("src/lib/outreach-campaign-follow-ups.ts", "utf8");
const diagnostics = readFileSync("src/lib/procurement-inbox-diagnostics.ts", "utf8");

assert.match(schema, /dailySendLimit\s+Int\s+@default\(30\)/);
assert.match(schema, /model EmailSenderReservation/);
assert.match(schema, /@@unique\(\[officeId, idempotencyKey\]\)/);
assert.match(schema, /requestHash\s+String/);
assert.match(schema, /@@unique\(\[messageId, accountId, officeId\]\)/);
assert.match(schema, /@@unique\(\[id, accountId, officeId\]\)/);
assert.match(schema, /@@unique\(\[id, officeId\]\)/);
assert.match(migration, /CHECK \("dailySendLimit" BETWEEN 1 AND 30\)/);
assert.match(migration, /FOREIGN KEY \("accountId", "officeId"\)/);
assert.match(migration, /FOREIGN KEY \("messageId", "accountId", "officeId"\)/);
assert.match(migration, /FOREIGN KEY \("threadId", "officeId"\)/);
assert.match(migration, /EmailSenderReservation_requestHash_check/);
assert.match(verification, /BEGIN READ ONLY/);
assert.match(page, /<EmailSenderPool/);
assert.match(page, /Sent today<\/span><strong>\{sentTodayTotal\} \/ \{dailyCapacity\}/);
assert.doesNotMatch(page, /<EmailAccountControls|<SyncAccountButton|<DisconnectAccountButton/);
assert.match(component, /type="checkbox"/);
assert.match(component, /role="switch"/);
assert.match(component, /Turn on/);
assert.match(component, /Turn off/);
assert.match(component, /Set limit/);
assert.match(component, /account\.sentToday\} \/ \{account\.dailySendLimit/);
assert.match(actions, /updateSharedEmailSenderPoolAccounts/);
assert.match(actions, /officeId: session\.officeId/);
assert.match(settings, /validEmailDailySendLimit/);
assert.match(settings, /await prisma\.\$transaction/);
assert.match(settings, /No accounts were changed/);
assert.doesNotMatch(
  settings,
  /officeId: input\.officeId/,
  "the mailbox pool is shared, so settings must not scope mailboxes to one office",
);
assert.match(settings, /CONNECTED_GMAIL_ACCOUNT_FILTER/);
assert.match(allocator, /pg_advisory_xact_lock/);
assert.match(
  allocator,
  /SHARED_SENDER_POOL_LOCK = "email-sender-pool:shared"/,
  "offices must serialize on one lock or two of them hand out the same mailbox capacity",
);
assert.match(allocator, /SHARED_SENDER_POOL_FILTER/);
assert.match(
  allocator,
  /by: \["accountId"\]/,
  "a mailbox daily limit counts every office that used the mailbox",
);
assert.match(allocator, /EmailSenderReservationStatus\.RESERVED/);
assert.match(allocator, /selectEmailSenderPoolCandidate/);
assert.match(allocator, /idempotencyKey/);
assert.match(allocator, /existing\.requestHash !== args\.requestHash/);
assert.match(allocator, /IDEMPOTENCY_CONFLICT/);
assert.match(allocator, /officeId: args\.officeId/);
assert.match(supplierCommunication, /listEmailSenderPoolAccounts\(\)/);
assert.match(supplierCommunication, /reserveEmailSender/);
assert.match(supplierCommunication, /releaseEmailSenderReservation/);
assert.match(supplierCommunication, /messageId: localMessageId/);
assert.match(supplierCommunication, /state: "RECONCILING"/);
assert.match(supplierCommunication, /SUPPLIER_EMAIL_RECONCILIATION_LEASE_MS/);

for (const [name, source] of Object.entries({ migration, verification, page, component, actions, settings, allocator, gmailSend, supplierCommunication })) {
  assert.equal(source.includes("\u2014"), false, `${name} must not contain U+2014.`);
}

// A send that must leave from one named mailbox fails for a reason an operator
// can act on: resume that mailbox, not connect a mailbox to an empty pool.
assert.match(
  pinnedSenderUnavailableReason({
    isActive: true,
    sendEnabled: true,
    sendPausedAt: new Date("2026-09-04T00:00:00Z"),
    sendPausedReason: "Permanent bounces spiked",
  }),
  /paused by sender protection: Permanent bounces spiked/,
);
assert.match(
  pinnedSenderUnavailableReason({ isActive: true, sendEnabled: true, sendPausedAt: new Date(), sendPausedReason: null }),
  /paused by sender protection\.$/,
);
assert.match(
  pinnedSenderUnavailableReason({ isActive: true, sendEnabled: false, sendPausedAt: null, sendPausedReason: null }),
  /Sending is turned off/,
);
assert.match(
  pinnedSenderUnavailableReason({ isActive: false, sendEnabled: true, sendPausedAt: null, sendPausedReason: null }),
  /is disabled/,
);
assert.match(pinnedSenderUnavailableReason(null), /no longer exists/);
assert.match(
  allocator,
  /code: "SENDER_UNAVAILABLE"/,
  "a pinned mailbox that cannot send must not be reported as an empty pool",
);
assert.match(
  allocator,
  /attempt < PINNED_SENDER_STATE_READS/,
  "a mailbox resumed mid reservation must be read again, not deferred on a stale reason",
);
assert.match(
  allocator,
  /const PINNED_SENDER_STATE_READS = \d+;/,
  "those rechecks must be bounded so a mailbox flipping state cannot hold the pool lock",
);
// A paused mailbox can be resumed, so every sender that pins one has to keep
// the recipient retryable instead of settling it as refused.
for (const [name, source] of Object.entries({ nudge, bulkRfq, campaignSend, campaignFollowUps })) {
  assert.match(
    source,
    /SENDER_UNAVAILABLE/,
    `${name} must defer a send whose pinned mailbox is paused instead of refusing it`,
  );
}
assert.match(
  diagnostics,
  /pausedMailboxes/,
  "the read only diagnostic must name the mailboxes sender protection paused",
);
assert.match(diagnostics, /sendPausedReason/);

console.log("Email sender pool policy and UI contracts passed.");
