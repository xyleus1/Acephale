import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  conversationTaskBacklog,
  listBackingOffConversationVendorIds,
  listDueConversationTaskOrderIds,
  recordConversationTasks,
  settleAbsentConversationTasks,
} from "../src/lib/procurement-conversation-task-store";

// The point of a stored conversation task is that it outlives a pass, so it can
// only be trusted against a migrated database: the uniqueness that stops one
// thread being owned twice, the office scoping that stops one tenant seeing
// another's work, and the backoff a failing thread waits out are all database
// state.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.startsWith("derya_supply_reply_verify")) {
  throw new Error("Conversation task tests require an explicit disposable derya_supply_reply_verify database.");
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const office = await prisma.office.create({ data: { name: `Conversation task ${suffix}` } });
  const otherOffice = await prisma.office.create({ data: { name: `Other task office ${suffix}` } });
  const orderId = `order-${suffix}`;
  const otherOrderId = `order-other-${suffix}`;
  try {
    const now = new Date("2026-09-04T12:00:00.000Z");
    await recordConversationTasks({
      officeId: office.id,
      orderId,
      now,
      entries: [
        {
          vendorId: "vendor-failed",
          vendorName: "Failed sender",
          stage: "ANSWER_READY",
          action: "SEND_DRAFT",
          attempted: true,
          progressed: false,
          failure: "The supplier send failed.",
        },
        {
          vendorId: "vendor-waiting",
          vendorName: "Quiet supplier",
          stage: "AWAITING_FIRST_REPLY",
          action: "NONE",
          attempted: true,
          progressed: false,
          failure: null,
        },
        {
          vendorId: "vendor-quoted",
          vendorName: "Quoted supplier",
          stage: "QUOTED",
          action: "NONE",
          attempted: true,
          progressed: true,
          failure: null,
        },
      ],
    });

    const backlog = await conversationTaskBacklog({ officeId: office.id, orderId, now });
    assert.equal(backlog.owed, 2, "A recorded quote settles its thread and stops being owed.");
    assert.equal(backlog.due, 1, "The failed thread waits out its backoff, the quiet one is due.");
    assert.equal(backlog.backingOff, 1);
    assert.equal(backlog.stuck.length, 0, "One failure is not yet a thread that needs a person.");

    // Recording the same failure again is one task, not a second one, so a
    // retried thread cannot be worked twice in one pass.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await recordConversationTasks({
        officeId: office.id,
        orderId,
        now,
        entries: [{
          vendorId: "vendor-failed",
          vendorName: "Failed sender",
          stage: "ANSWER_READY",
          action: "SEND_DRAFT",
          attempted: true,
          progressed: false,
          failure: "The supplier send failed.",
        }],
      });
    }
    const stored = await prisma.procurementConversationTask.findMany({
      where: { officeId: office.id, orderId, vendorId: "vendor-failed" },
    });
    assert.equal(stored.length, 1, "One supplier conversation of one request is one task.");
    assert.equal(stored[0].attempts, 3);
    const stuckBacklog = await conversationTaskBacklog({ officeId: office.id, orderId, now });
    assert.deepEqual(
      stuckBacklog.stuck.map((task) => task.vendorId),
      ["vendor-failed"],
      "A thread that keeps failing is named, not just counted.",
    );

    // Another office writing the same request and supplier identifiers keeps
    // its own task, and neither office can see the other's work.
    await recordConversationTasks({
      officeId: otherOffice.id,
      orderId,
      now,
      entries: [{
        vendorId: "vendor-failed",
        vendorName: "Failed sender",
        stage: "REPLY_UNANSWERED",
        action: "DRAFT_REPLY",
        attempted: true,
        progressed: false,
        failure: null,
      }],
    });
    const isolated = await conversationTaskBacklog({ officeId: otherOffice.id, orderId, now });
    assert.equal(isolated.owed, 1);
    assert.equal(isolated.due, 1);
    assert.equal(
      (await conversationTaskBacklog({ officeId: office.id, orderId, now })).owed,
      2,
      "One office's task never lands in another office's backlog.",
    );

    // A pass picks requests by what is due, so the request whose only task is
    // still backing off is not offered work it cannot do.
    await recordConversationTasks({
      officeId: office.id,
      orderId: otherOrderId,
      now,
      entries: [{
        vendorId: "vendor-backoff",
        vendorName: "Backing off",
        stage: "ANSWER_READY",
        action: "SEND_DRAFT",
        attempted: true,
        progressed: false,
        failure: "The supplier send failed.",
      }],
    });
    const due = await listDueConversationTaskOrderIds({ now });
    assert.ok(due.includes(orderId));
    assert.ok(!due.includes(otherOrderId), "A request whose work is backing off is not offered as due.");
    const laterDue = await listDueConversationTaskOrderIds({
      now: new Date(now.getTime() + 24 * 60 * 60_000),
    });
    assert.ok(laterDue.includes(otherOrderId), "Once the backoff passes the request is retried.");

    // Progress clears the retry state that a failure left behind, so a thread
    // that recovered is not held on an hours long delay.
    await recordConversationTasks({
      officeId: office.id,
      orderId,
      now,
      entries: [{
        vendorId: "vendor-failed",
        vendorName: "Failed sender",
        stage: "AWAITING_QUOTE",
        action: "SEND_DRAFT",
        attempted: true,
        progressed: true,
        failure: null,
      }],
    });
    const recovered = await prisma.procurementConversationTask.findFirstOrThrow({
      where: { officeId: office.id, orderId, vendorId: "vendor-failed" },
    });
    assert.equal(recovered.attempts, 0);
    assert.equal(recovered.lastError, null);
    assert.equal(recovered.settledAt, null);
    assert.equal(recovered.lastSuccessAt?.getTime(), now.getTime());

    // A pass bounded by its deadline still projects a stage for the thread it
    // never worked. Recording that projection must not read as a success, or a
    // failing supplier would be retried immediately, every pass, forever.
    await recordConversationTasks({
      officeId: office.id,
      orderId: otherOrderId,
      now,
      entries: [{
        vendorId: "vendor-backoff",
        vendorName: "Backing off",
        stage: "ANSWER_READY",
        action: "SEND_DRAFT",
        attempted: false,
        progressed: false,
        failure: null,
      }],
    });
    const untouched = await prisma.procurementConversationTask.findFirstOrThrow({
      where: { officeId: office.id, orderId: otherOrderId, vendorId: "vendor-backoff" },
    });
    assert.equal(untouched.attempts, 1, "A thread the pass never worked keeps its failure count.");
    assert.ok(untouched.lastError, "And keeps the reason it is waiting.");
    assert.ok(
      !(await listDueConversationTaskOrderIds({ now })).includes(otherOrderId),
      "So it is still backing off rather than due again.",
    );

    // A request whose one conversation is due must not drag the conversations
    // that are backing off into the same pass, so the pass reads which of its
    // own threads may not be worked yet.
    const backingOff = await listBackingOffConversationVendorIds({
      officeId: office.id,
      orderId,
      now,
    });
    assert.deepEqual(backingOff, [], "Nothing of this request is backing off after the recovery.");
    assert.deepEqual(
      await listBackingOffConversationVendorIds({ officeId: office.id, orderId: otherOrderId, now }),
      ["vendor-backoff"],
    );

    // A supplier the request stopped pursuing leaves the backlog, so it cannot
    // keep its request in the due queue for work nobody wants done.
    const settled = await settleAbsentConversationTasks({
      officeId: office.id,
      orderId,
      activeVendorIds: ["vendor-failed", "vendor-quoted"],
      now,
    });
    assert.equal(settled, 1, "Only the supplier that left the funnel is settled.");
    const afterClose = await conversationTaskBacklog({ officeId: office.id, orderId, now });
    assert.ok(
      !afterClose.stuck.some((task) => task.vendorId === "vendor-waiting"),
      "A closed supplier is no longer owed.",
    );
    assert.equal(afterClose.owed, 1);
    assert.equal(
      (await conversationTaskBacklog({ officeId: otherOffice.id, orderId, now })).owed,
      1,
      "Reconciling one office's request never touches another office's task.",
    );

    // Reopening the supplier gives it its task back, so closing a thread by
    // mistake is not a one way door.
    await recordConversationTasks({
      officeId: office.id,
      orderId,
      now,
      entries: [{
        vendorId: "vendor-waiting",
        vendorName: "Quiet supplier",
        stage: "AWAITING_FIRST_REPLY",
        action: "NONE",
        attempted: true,
        progressed: false,
        failure: null,
      }],
    });
    assert.equal((await conversationTaskBacklog({ officeId: office.id, orderId, now })).owed, 2);

    // One request with a long tail of old due threads used to fill the sample
    // the due queue was read from and hide every other request behind it.
    const crowdedOrderId = `order-crowded-${suffix}`;
    const olderNow = new Date(now.getTime() - 60 * 60_000);
    await recordConversationTasks({
      officeId: office.id,
      orderId: crowdedOrderId,
      now: olderNow,
      entries: Array.from({ length: 60 }, (_unused, index) => ({
        vendorId: `crowd-${index}`,
        vendorName: `Crowd ${index}`,
        stage: "AWAITING_FIRST_REPLY" as const,
        action: "NONE",
        attempted: true,
        progressed: false,
        failure: null,
      })),
    });
    const fair = await listDueConversationTaskOrderIds({ officeId: office.id, now, limit: 2 });
    assert.equal(fair.length, 2);
    assert.equal(fair[0], crowdedOrderId, "The request waiting longest still leads.");
    assert.ok(
      fair.includes(orderId),
      "A request behind one with many due threads still reaches the pass.",
    );

    // A request that reached an order or was cancelled keeps its unsettled
    // tasks and they are the oldest due rows, so a limit spent before the
    // caller discarded them hid the live requests behind them.
    const eligible = await listDueConversationTaskOrderIds({
      officeId: office.id,
      now,
      limit: 1,
      orderIds: [orderId],
    });
    assert.deepEqual(
      eligible,
      [orderId],
      "The due read is limited after the eligible requests are intersected, so a closed request cannot take the pass.",
    );
    assert.deepEqual(
      await listDueConversationTaskOrderIds({ officeId: office.id, now, orderIds: [] }),
      [],
      "An empty eligible queue reads as nothing due rather than as every due request.",
    );

    // Two passes can overlap, and a transition that read the attempt count
    // outside a transaction let the later write overwrite the earlier one, so a
    // failing thread looked less stuck than it was and backed off too little.
    const raceOrderId = `order-race-${suffix}`;
    const failure = (label: string) => ({
      officeId: office.id,
      orderId: raceOrderId,
      entries: [{
        vendorId: "vendor-race",
        vendorName: "Racing supplier",
        stage: "REPLY_UNANSWERED" as const,
        action: "SEND_DRAFT",
        attempted: true,
        progressed: false,
        failure: label,
      }],
    });
    await recordConversationTasks(failure("first failure"));
    await Promise.all([
      recordConversationTasks(failure("concurrent failure a")),
      recordConversationTasks(failure("concurrent failure b")),
    ]);
    const raced = await prisma.procurementConversationTask.findFirst({
      where: { officeId: office.id, orderId: raceOrderId, vendorId: "vendor-race" },
      select: { attempts: true },
    });
    assert.equal(
      raced?.attempts,
      3,
      "Two concurrent failures both count, so the backoff and the stuck report stay honest.",
    );
  } finally {
    await prisma.procurementConversationTask.deleteMany({
      where: { officeId: { in: [office.id, otherOffice.id] } },
    });
    await prisma.office.deleteMany({ where: { id: { in: [office.id, otherOffice.id] } } });
    await prisma.$disconnect();
  }
  console.log("procurement conversation task database checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
