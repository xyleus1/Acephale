import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { planAutopilotVendorAction } from "../src/lib/procurement-autopilot-plan";
import {
  bulkRfqAddressHash,
  bulkRfqIdempotencyKey,
  bulkRfqKeyIdentity,
  bulkRfqRfcMessageId,
  bulkRfqSupplierAlreadyMailed,
} from "../src/lib/procurement-bulk-rfq";
import {
  conversationFunnel,
  supplierConversationStage,
} from "../src/lib/procurement-conversation-stage";
import {
  conversationFailureIsCapacity,
  nextConversationTaskState,
} from "../src/lib/procurement-conversation-task";
import { ProcurementReplySenderUnavailableError } from "../src/lib/procurement-reply-errors";
import {
  nudgeIdempotencyKey,
  nudgeKeyIdentity,
  nudgeRfcMessageId,
} from "../src/lib/procurement-supplier-nudge";
import {
  planWrongContactRecovery,
  recoverProcurementWrongContact,
  wrongContactReplacements,
  WRONG_CONTACT_FADED_STATUS,
} from "../src/lib/procurement-wrong-contact";

const supplierDomains = ["https://www.niltronix.com", "sales@niltronix.com"];

// The reply itself is the recovery: the shop read the RFQ and named where it
// belongs, so that address is tried instead of an operator being asked.
assert.deepEqual(
  wrongContactReplacements({
    body: "Wrong person, please write to quotes@niltronix.com instead. Do not reply to no-reply@niltronix.com.",
    mailedEmails: ["sales@niltronix.com"],
    supplierDomains,
  }),
  ["quotes@niltronix.com"],
);

// A named address that is not the supplier's would send the request's files and
// its brief to a stranger, so only the shop's own domain counts.
assert.deepEqual(
  wrongContactReplacements({
    body: "Not us. Try purchasing@some-customer.com or our own team at rfq@niltronix.com.",
    mailedEmails: ["sales@niltronix.com"],
    supplierDomains,
  }),
  ["rfq@niltronix.com"],
);

// Writing again to the address that told us it is wrong is what produced this
// reply, so it is never a candidate.
assert.deepEqual(
  wrongContactReplacements({
    body: "You have the wrong contact, this is sales@niltronix.com.",
    mailedEmails: ["sales@niltronix.com"],
    supplierDomains,
  }),
  [],
);

// A forwarded wrong contact carries the mail it was forwarded from, and the
// addresses in that history are whoever wrote it, not the desk the RFQ belongs
// at, so only what this reply itself wrote can name a replacement.
assert.deepEqual(
  wrongContactReplacements({
    body: [
      "Wrong department here.",
      "",
      "-------- Original Message --------",
      "From: peter.hall@niltronix.com",
      "Please quote the attached.",
    ].join("\n"),
    mailedEmails: ["sales@niltronix.com"],
    supplierDomains,
  }),
  [],
  "A quoted history is not a referral, so a wrong contact with nothing to move to fades instead.",
);
assert.deepEqual(
  wrongContactReplacements({
    body: [
      "Wrong department, please write to rfq@niltronix.com.",
      "> Please quote the attached.",
      "> peter.hall@niltronix.com",
    ].join("\n"),
    mailedEmails: ["sales@niltronix.com"],
    supplierDomains,
  }),
  ["rfq@niltronix.com"],
  "The address the reply itself names is the replacement, not one in the mail it quotes.",
);

// A quoting inbox is preferred over a personal one, and what sourcing already
// found is tried after what the supplier named.
assert.deepEqual(
  wrongContactReplacements({
    body: "Please contact peter.hall@niltronix.com or rfq@niltronix.com.",
    mailedEmails: ["sales@niltronix.com"],
    alternateEmails: ["info@niltronix.com", "sales@niltronix.com"],
    supplierDomains,
  }),
  ["rfq@niltronix.com", "peter.hall@niltronix.com", "info@niltronix.com"],
);

assert.equal(planWrongContactRecovery(["rfq@niltronix.com"]).kind, "REPLACE_CONTACT");
assert.equal(planWrongContactRecovery([]).kind, "FADE");

type WriteCall = {
  status: string;
  contactEmail: string | null;
  reopenOutreach: boolean;
  note: Record<string, unknown>;
};

function recovery(args: {
  body: string;
  contactEmail?: string | null;
  handledMessageId?: string | null;
  handledState?: string | null;
  alternateEmails?: string[] | null;
  retiredEmails?: string[] | null;
  mailedEmails?: string[];
  writes: WriteCall[];
}) {
  return recoverProcurementWrongContact({
    orderId: "order-1",
    vendorId: "vendor-1",
    vendorName: "Niltronix Circuits",
    replyBody: args.body,
    sourceMessageId: "message-1",
    mailedEmails: args.mailedEmails ?? ["sales@niltronix.com"],
    loadVendor: async () => ({
      website: "https://niltronix.com",
      contactEmail: args.contactEmail ?? "sales@niltronix.com",
      alternateEmails: args.alternateEmails ?? null,
      retiredEmails: args.retiredEmails ?? null,
      handledMessageId: args.handledMessageId ?? null,
      handledState: args.handledState ?? null,
    }),
    writeVendor: async (write) => {
      args.writes.push({
        status: write.status,
        contactEmail: write.contactEmail,
        reopenOutreach: write.reopenOutreach,
        note: write.note,
      });
    },
  });
}

async function main() {
  // Re-sourced: the supplier row now points at the address the shop named, its
  // status puts it back in front of the RFQ send, and the retired address is kept
  // so the history is readable.
  const resourced: WriteCall[] = [];
  const resourcedOutcome = await recovery({
    body: "Wrong department. Send it to rfq@niltronix.com.",
    writes: resourced,
  });
  assert.equal(resourcedOutcome.state, "RESOURCED");
  assert.equal(resourcedOutcome.resolved, "RESOURCED");
  assert.equal(resourcedOutcome.email, "rfq@niltronix.com");
  assert.equal(resourced.length, 1);
  assert.equal(resourced[0].contactEmail, "rfq@niltronix.com");
  assert.equal(resourced[0].status, "researched");
  assert.equal(
    resourced[0].reopenOutreach,
    true,
    "A replacement address is only mailed once the send receipt of the refused address is cleared.",
  );
  assert.deepEqual(resourced[0].note.retired, ["sales@niltronix.com"]);
  assert.equal(resourced[0].note.sourceMessageId, "message-1");

  // Nothing to move to: the shop leaves the funnel with the reason recorded, and
  // its row and thread are kept rather than deleted.
  const faded: WriteCall[] = [];
  const fadedOutcome = await recovery({
    body: "We do not handle this. Please remove us from your list.",
    writes: faded,
  });
  assert.equal(fadedOutcome.state, "FADED");
  assert.equal(faded[0].status, WRONG_CONTACT_FADED_STATUS);
  assert.equal(faded[0].contactEmail, null, "Fading retires the address that turned us away.");
  // The write is what has to retire it, so a `COALESCE` that quietly kept the
  // old address would leave a faded supplier reachable at it again.
  const recoveryWriteSource = readFileSync(resolve(__dirname, "../src/lib/procurement-wrong-contact.ts"), "utf8");
  assert.ok(
    /contact_email = \$4,/.test(recoveryWriteSource),
    "A null contact clears the column instead of preserving the refused address.",
  );
  assert.deepEqual(faded[0].note.retired, ["sales@niltronix.com"], "The retired address stays readable on the row.");
  assert.equal(faded[0].reopenOutreach, false, "A faded supplier is not put back in front of the RFQ send.");
  assert.equal(faded[0].note.state, "FADED");

  // The reply naming the wrong contact stays the newest message on the thread, so
  // without this every pass would move the supplier to yet another address.
  const repeat: WriteCall[] = [];
  const repeatOutcome = await recovery({
    body: "Wrong department. Send it to rfq@niltronix.com.",
    contactEmail: "rfq@niltronix.com",
    handledMessageId: "message-1",
    handledState: "RESOURCED",
    writes: repeat,
  });
  assert.equal(repeatOutcome.state, "ALREADY_HANDLED");
  assert.equal(repeatOutcome.resolved, "RESOURCED");
  assert.equal(repeat.length, 0, "An already recovered reply is not recovered again.");

  // A supplier that turns us away twice: the address the first recovery retired
  // sits in the row's own sourcing addresses, so without carrying the retired
  // list forward the second recovery would offer it again and mail the desk that
  // already said no. Every address the supplier has refused stays retired.
  const second: WriteCall[] = [];
  const secondOutcome = await recovery({
    body: "Not the right contact either. Try quotes@niltronix.com.",
    contactEmail: "rfq@niltronix.com",
    retiredEmails: ["sales@niltronix.com"],
    alternateEmails: ["sales@niltronix.com"],
    mailedEmails: ["rfq@niltronix.com"],
    writes: second,
  });
  assert.equal(secondOutcome.state, "RESOURCED");
  assert.equal(
    secondOutcome.email,
    "quotes@niltronix.com",
    "A second wrong contact is not moved back to an address the supplier already refused.",
  );
  assert.deepEqual(
    second[0].note.retired,
    ["sales@niltronix.com", "rfq@niltronix.com"],
    "Both refused addresses stay retired, oldest first, so a reconciled send still names the one it went to.",
  );

  // With nothing left to try, the same accumulated history is what the faded row
  // keeps, so the send to either refused address can still be settled.
  const secondFaded: WriteCall[] = [];
  await recovery({
    body: "Not the right contact either. Please remove us.",
    contactEmail: "rfq@niltronix.com",
    retiredEmails: ["sales@niltronix.com"],
    mailedEmails: ["rfq@niltronix.com"],
    writes: secondFaded,
  });
  assert.deepEqual(secondFaded[0].note.retired, ["sales@niltronix.com", "rfq@niltronix.com"]);

  // A recovery that could not be written leaves the thread owed, so it is retried
  // and, if it keeps failing, reaches a person.
  const failedOutcome = await recoverProcurementWrongContact({
    orderId: "order-1",
    vendorId: "vendor-1",
    vendorName: "Niltronix Circuits",
    replyBody: "Wrong contact, use rfq@niltronix.com.",
    sourceMessageId: "message-1",
    mailedEmails: [],
    loadVendor: async () => ({
      website: "https://niltronix.com",
      contactEmail: "sales@niltronix.com",
      alternateEmails: null,
      retiredEmails: null,
      handledMessageId: null,
      handledState: null,
    }),
    writeVendor: async () => {
      throw new Error("The supplier row could not be updated.");
    },
  });
  assert.equal(failedOutcome.state, "FAILED");
  assert.equal(failedOutcome.resolved, "FAILED");

  // The loop, not a person, owns a wrong contact now.
  const state = {
    vendorId: "vendor-1",
    vendorName: "Niltronix Circuits",
    lastDirection: "INBOUND" as const,
    inboundKind: "WRONG_RECIPIENT" as const,
    triageDecision: null,
    hasDraft: false,
    hasQuote: false,
  };
  assert.equal(
    planAutopilotVendorAction({ ...state, wrongContactRecovery: "RESOURCED" }, { autoSend: true }).kind,
    "RESOURCE_CONTACT",
  );
  assert.equal(
    planAutopilotVendorAction({ ...state, wrongContactRecovery: "FADED" }, { autoSend: true }).kind,
    "RESOURCE_CONTACT",
  );
  assert.equal(
    planAutopilotVendorAction({ ...state, wrongContactRecovery: "FAILED" }, { autoSend: true }).kind,
    "ESCALATE",
    "Only a recovery the loop could not write reaches an operator.",
  );

  // A supplier moved to another address is waiting for its RFQ, and one that
  // faded is out of the funnel instead of sitting in an operator list forever.
  assert.equal(supplierConversationStage({ ...state, wrongContactRecovery: "RESOURCED" }), "NOT_CONTACTED");
  assert.equal(supplierConversationStage({ ...state, wrongContactRecovery: "FADED" }), "SUPPLIER_FADED");
  assert.equal(supplierConversationStage({ ...state, wrongContactRecovery: "FAILED" }), "NEEDS_OPERATOR");

  const fadedFunnel = conversationFunnel([{ input: { ...state, wrongContactRecovery: "FADED" as const } }]);
  assert.equal(fadedFunnel.stages.SUPPLIER_FADED, 1);
  assert.equal(fadedFunnel.owed, 0, "A faded supplier owes nobody an action.");
  assert.deepEqual(fadedFunnel.needsOperator, [], "A faded supplier is not work for a person.");

  // A send nobody had a mailbox for is queued, not backed off: the thread keeps
  // its attempt count, stays due, and the next pass sends it as soon as a mailbox
  // is free.
  const queued = nextConversationTaskState(
    null,
    {
      stage: "ANSWER_READY",
      action: "SEND_DRAFT",
      attempted: true,
      progressed: false,
      failure: "Every enabled email account has reached its daily pooled-send limit.",
    },
    new Date("2026-09-05T12:00:00.000Z"),
  );
  assert.equal(queued.attempts, 0, "A capacity stop is not this conversation failing.");
  assert.equal(queued.nextAttemptAt.getTime(), new Date("2026-09-05T12:00:00.000Z").getTime());
  assert.equal(queued.settledAt, null, "A queued conversation is never dropped.");
  assert.match(queued.lastError ?? "", /daily pooled-send limit/);

  // Repeated capacity stops must not accumulate into a stuck thread, and a real
  // failure on the same thread still counts.
  const queuedAgain = nextConversationTaskState(
    queued,
    {
      stage: "ANSWER_READY",
      action: "SEND_DRAFT",
      attempted: true,
      progressed: false,
      failure: "The only connected mailbox in the sender pool is paused or has sending turned off.",
    },
    new Date("2026-09-05T13:00:00.000Z"),
  );
  assert.equal(queuedAgain.attempts, 0);
  assert.equal(queuedAgain.nextAttemptAt.getTime(), new Date("2026-09-05T13:00:00.000Z").getTime());

  const realFailure = nextConversationTaskState(
    queuedAgain,
    {
      stage: "ANSWER_READY",
      action: "SEND_DRAFT",
      attempted: true,
      progressed: false,
      failure: "The supplier address was rejected.",
    },
    new Date("2026-09-05T14:00:00.000Z"),
  );
  assert.equal(realFailure.attempts, 1);
  assert.ok(realFailure.nextAttemptAt.getTime() > new Date("2026-09-05T14:00:00.000Z").getTime());

  // The recovery writes to columns the sourcing insert already creates, and the
  // send receipt is what the RFQ send reads, so clearing it is what actually
  // mails the replacement address.
  const recoverySource = readFileSync(resolve(__dirname, "../src/lib/procurement-wrong-contact.ts"), "utf8");
  assert.ok(
    /last_email_message_id = CASE WHEN \$6 THEN NULL/.test(recoverySource),
    "Re-sourcing clears the send receipt so the RFQ send picks the supplier up again.",
  );
  assert.ok(
    /email_thread_id = CASE WHEN \$6 THEN NULL/.test(recoverySource),
    "A replacement address starts its own thread instead of answering the refusal.",
  );
  const sourcingSource = readFileSync(resolve(__dirname, "../src/lib/procurement-supplier-sourcing.ts"), "utf8");
  const sendSource = readFileSync(resolve(__dirname, "../src/lib/procurement-bulk-rfq.ts"), "utf8");
  for (const column of ["contact_email", "status", "research", "website"]) {
    assert.ok(sourcingSource.includes(column), `The recovery writes ${column}, which the supplier row must have.`);
  }
  for (const column of ["last_email_message_id", "email_thread_id"]) {
    assert.ok(sendSource.includes(column), `The recovery clears ${column}, which the RFQ send owns.`);
  }

  // A replacement address must actually be mailed, which means the RFQ send
  // identity is the supplier plus the address: keyed by the supplier alone, the
  // recorded reservation of the address that turned us away would keep this
  // supplier out of every later batch.
  const orderId = "1f0c0d9e-1111-4222-8333-444455556666";
  const vendorId = "9a8b7c6d-5555-4666-8777-888899990000";
  const retiredKey = bulkRfqIdempotencyKey({ orderId, vendorId, contactEmail: "Sales@Niltronix.com" });
  const replacementKey = bulkRfqIdempotencyKey({ orderId, vendorId, contactEmail: "rfq@niltronix.com" });
  assert.notEqual(retiredKey, replacementKey, "Each supplier address is its own send.");
  assert.equal(
    retiredKey,
    bulkRfqIdempotencyKey({ orderId, vendorId, contactEmail: " sales@niltronix.com " }),
    "The same address is never mailed twice, whatever its casing.",
  );
  assert.equal(retiredKey.split(":").at(-1), vendorId, "Callers read the supplier id back off the key.");
  assert.ok(retiredKey.startsWith(`procurement-bulk-rfq:${orderId}:`), "The request prefix still selects its sends.");

  assert.equal(
    bulkRfqSupplierAlreadyMailed({
      orderId,
      vendorId,
      contactEmail: "sales@niltronix.com",
      resourcedEmail: null,
      mailedKeys: [retiredKey],
    }),
    true,
    "A supplier already mailed at its address is not mailed again.",
  );
  assert.equal(
    bulkRfqSupplierAlreadyMailed({
      orderId,
      vendorId,
      contactEmail: "rfq@niltronix.com",
      resourcedEmail: "rfq@niltronix.com",
      mailedKeys: [retiredKey],
    }),
    false,
    "The replacement address enters the next RFQ batch.",
  );
  // Sends recorded before addresses were part of the identity.
  const legacyKey = `procurement-bulk-rfq:${orderId}:${vendorId}`;
  assert.equal(
    bulkRfqSupplierAlreadyMailed({
      orderId,
      vendorId,
      contactEmail: "sales@niltronix.com",
      resourcedEmail: null,
      mailedKeys: [legacyKey],
    }),
    true,
    "An older send still counts, so no supplier is mailed twice by this change.",
  );
  assert.equal(
    bulkRfqSupplierAlreadyMailed({
      orderId,
      vendorId,
      contactEmail: "rfq@niltronix.com",
      resourcedEmail: "rfq@niltronix.com",
      mailedKeys: [legacyKey],
    }),
    false,
    "An older send covers the retired address, not the one the supplier was moved to.",
  );

  // A retired address keeps its recorded send, which is what stops a faded or
  // re-sourced supplier from being mailed there a second time.
  assert.equal(
    bulkRfqSupplierAlreadyMailed({
      orderId,
      vendorId,
      contactEmail: "sales@niltronix.com",
      resourcedEmail: "rfq@niltronix.com",
      mailedKeys: [retiredKey],
    }),
    true,
    "The address that turned us away is never mailed again, whatever the row says.",
  );

  // A send is found again by its Message-ID when the provider left the outcome
  // uncertain, and the stored copy is filed under it, so the RFQ to a
  // replacement address must not carry the id of the send it replaces.
  assert.notEqual(
    bulkRfqRfcMessageId({ orderId, vendorId, contactEmail: "sales@niltronix.com" }),
    bulkRfqRfcMessageId({ orderId, vendorId, contactEmail: "rfq@niltronix.com" }),
    "Each address-specific send is its own message and its own thread.",
  );
  assert.equal(
    bulkRfqRfcMessageId({ orderId, vendorId, contactEmail: "rfq@niltronix.com" }),
    bulkRfqRfcMessageId({ orderId, ...bulkRfqKeyIdentity(replacementKey) }),
    "Reconciliation rebuilds the id from the key it reserved, not from the row.",
  );
  assert.equal(
    bulkRfqRfcMessageId({ orderId, ...bulkRfqKeyIdentity(legacyKey) }),
    `<procurement-rfq-${orderId.slice(0, 8)}-${vendorId}@derya.ai>`,
    "An older send keeps the id it went out with, so it stays reconcilable.",
  );

  // The failure the reply path actually raises when pooled sending has nothing
  // left is capacity, while a thread mailbox an operator must reconnect is not.
  assert.equal(
    conversationFailureIsCapacity(new ProcurementReplySenderUnavailableError("ops@derya.ai", "SENDER_POOL").message),
    true,
    "An exhausted shared sender pool queues the conversation.",
  );
  assert.equal(
    conversationFailureIsCapacity(new ProcurementReplySenderUnavailableError("ops@derya.ai", "THREAD_MAILBOX").message),
    false,
    "A disconnected thread mailbox needs an operator, so it keeps its backoff.",
  );

  // A recovery that could not be written is a failure of the pass, so it cannot
  // be reported next to a zero failure count.
  const autopilotSource = readFileSync(resolve(__dirname, "../src/lib/procurement-autopilot.ts"), "utf8");
  assert.ok(
    /\.filter\(\(outcome\) => outcome\.state === "FAILED"\)/.test(autopilotSource)
      && /failed: failures\.length,/.test(autopilotSource),
    "Failed wrong contact recoveries are named as failures, which is what the pass total counts.",
  );

  // A send left uncertain is reconciled against the address it was reserved
  // for, read back off its key, so a supplier moved in the meantime is not
  // recorded as written to at the replacement address it never received.
  assert.ok(
    /bulkRfqAddressHash\(email\) === addressHash/.test(sendSource)
      && /markContacted: recipient === current/.test(sendSource),
    "A reconciled delivery names the retired address and does not stamp the row contacted.",
  );

  // A faded supplier keeps no current address, so its uncertain send is settled
  // from the addresses it retired instead of staying reserved forever.
  assert.ok(
    /if \(!target\) \{/.test(sendSource)
      && /const known = \[\.\.\.\(current \? \[current\] : \[\]\), \.\.\.retired\]/.test(sendSource),
    "Reconciliation resolves a faded supplier's send from its retired addresses.",
  );

  // An older send names no address, so reading the row's current address would
  // attribute it to the replacement a recovery has since written there, stamp
  // that address contacted, and hold the replacement RFQ out of every batch.
  // The address it retired first is where that send actually went.
  assert.ok(
    /: retired\.at\(0\) \?\? current \?\? undefined;/.test(sendSource),
    "An addressless send is attributed to the first retired address, never to the replacement.",
  );

  // The receipt write back is the marker that holds an address out of later
  // batches, so a recovery landing between the send and the write back must not
  // let it stamp the replacement address.
  assert.ok(
    /AND lower\(trim\(COALESCE\(\$\{BULK_RFQ_VENDOR_EMAIL_SQL\}, ''\)\)\) = \$5/.test(sendSource),
    "The contacted write back only stamps the row while it still holds the address mailed.",
  );

  // Re-sourcing clears the send receipt, which is the same marker the queue
  // selects requests by, so the request has to stay queued on the recovery
  // itself until the replacement RFQ goes out.
  assert.ok(
    /'research'->'wrongContact'->>'state' = 'RESOURCED'/.test(autopilotSource),
    "A request owing a re-sourced supplier its first contact stays in the queue.",
  );

  // The follow up has to answer on the thread of the address the supplier is
  // reachable at now, never the one it turned us away from.
  const nudgeSource = readFileSync(resolve(__dirname, "../src/lib/procurement-supplier-nudge.ts"), "utf8");
  assert.ok(
    /rfqByKey\.get\(bulkRfqIdempotencyKey\(\{/.test(nudgeSource),
    "A follow up picks the send that matches the supplier's current address.",
  );
  assert.ok(
    /orderBy: \{ createdAt: "asc" \}/.test(nudgeSource),
    "With no address match the first send wins, not whichever row came last.",
  );

  // A follow up left uncertain is settled on the thread of the address it was
  // sent to. Reading the supplier's newest RFQ thread instead would have filed
  // a delivery to the retired address on the replacement conversation, showing
  // that supplier an outbound message it never received.
  const nudgeRound = 2;
  const legacyNudgeKey = nudgeIdempotencyKey({ orderId, vendorId, round: nudgeRound });
  const addressedNudgeKey = nudgeIdempotencyKey({
    orderId,
    vendorId,
    round: nudgeRound,
    contactEmail: "RFQ@Niltronix.com",
  });
  assert.equal(legacyNudgeKey, `procurement-rfq-nudge:${orderId}:${nudgeRound}:${vendorId}`);
  assert.notEqual(addressedNudgeKey, legacyNudgeKey);
  assert.deepEqual(
    nudgeKeyIdentity(legacyNudgeKey),
    { vendorId, round: nudgeRound, addressHash: null },
    "An addressless follow up key still reads back its supplier and round.",
  );
  assert.deepEqual(
    nudgeKeyIdentity(addressedNudgeKey),
    { vendorId, round: nudgeRound, addressHash: bulkRfqAddressHash("rfq@niltronix.com") },
    "An addressed follow up key reads back the address it was reserved for.",
  );
  assert.notEqual(
    nudgeRfcMessageId({ orderId, vendorId, round: nudgeRound }),
    nudgeRfcMessageId({ orderId, vendorId, round: nudgeRound, contactEmail: "rfq@niltronix.com" }),
    "A follow up to a replacement address is its own message, not the retired one's.",
  );
  assert.equal(
    nudgeRfcMessageId({ orderId, vendorId, round: nudgeRound, contactEmail: "rfq@niltronix.com" }),
    nudgeRfcMessageId({ orderId, round: nudgeRound, ...nudgeKeyIdentity(addressedNudgeKey) }),
    "Reconciliation rebuilds the follow up id from the key it reserved.",
  );
  assert.ok(
    /idempotencyKey: `procurement-bulk-rfq:\$\{order\.orderId\}:\$\{addressHash\}:\$\{vendorId\}`/.test(nudgeSource),
    "A settled follow up is filed on the RFQ thread of the address it was sent to.",
  );
  assert.ok(
    /: retired\.at\(0\) \?\? current \?\? undefined;/.test(nudgeSource),
    "An addressless follow up is settled against the first retired address.",
  );

  console.log("procurement wrong contact and capacity queue checks passed");
}

void main();
