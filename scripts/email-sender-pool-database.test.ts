import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { releaseEmailSenderReservation, reserveEmailSender } from "../src/lib/email-sender-pool";
import { updateSharedEmailSenderPoolAccounts } from "../src/lib/email-sender-pool-settings";

const suffix = randomUUID().slice(0, 8);
let officeId = "";
let otherOfficeId = "";
let trafficOfficeId = "";

function requestHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function cleanup() {
  const officeIds = [officeId, otherOfficeId, trafficOfficeId].filter(Boolean);
  if (officeIds.length > 0) await prisma.office.deleteMany({ where: { id: { in: officeIds } } }).catch(() => undefined);
}

async function main() {
  const office = await prisma.office.create({ data: { name: `Sender pool ${suffix}` } });
  const otherOffice = await prisma.office.create({ data: { name: `Other sender pool ${suffix}` } });
  const trafficOffice = await prisma.office.create({ data: { name: `Traffic sender pool ${suffix}` } });
  officeId = office.id;
  otherOfficeId = otherOffice.id;
  trafficOfficeId = trafficOffice.id;
  const accounts = await Promise.all(["a", "b", "c"].map((label) => prisma.emailAccount.create({
    data: {
      officeId,
      email: `${label}-${suffix}@example.test`,
      displayName: `Sender ${label.toUpperCase()}`,
      provider: "GMAIL_APP_PASSWORD",
      credentialSecret: "encrypted-test-secret",
      isActive: true,
      sendEnabled: true,
      dailySendLimit: 2,
    },
  })));

  await assert.rejects(
    () => prisma.emailAccount.update({ where: { id: accounts[0].id }, data: { dailySendLimit: 31 } }),
    /constraint|check/i,
    "the database must reject an unsafe daily limit",
  );

  const reservations = await Promise.all(Array.from({ length: 6 }, (_, index) => reserveEmailSender({
    officeId,
    idempotencyKey: `sender-pool-db-${suffix}-${index}`,
    requestHash: requestHash(`delivery-${index}`),
  })));
  assert.equal(reservations.every((reservation) => "ok" in reservation), true);
  const accountCounts = new Map<string, number>();
  for (const reservation of reservations) {
    if (!("ok" in reservation)) continue;
    accountCounts.set(reservation.accountId, (accountCounts.get(reservation.accountId) ?? 0) + 1);
  }
  assert.deepEqual([...accountCounts.values()].sort(), [2, 2, 2]);

  const exhausted = await reserveEmailSender({
    officeId,
    idempotencyKey: `sender-pool-db-${suffix}-full`,
    requestHash: requestHash("full"),
  });
  assert.deepEqual(exhausted, {
    error: "Every enabled email account has reached its daily pooled-send limit.",
    code: "POOL_EXHAUSTED",
  });

  const first = reservations[0];
  assert.ok("ok" in first);
  const thread = await prisma.emailThread.create({
    data: {
      officeId,
      subject: "Sender pool idempotency check",
      participants: JSON.stringify([first.senderEmail, "supplier@example.test"]),
    },
  });
  const recordedMessage = await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      accountId: first.accountId,
      officeId,
      externalId: `sender-pool-${suffix}`,
      direction: "OUTBOUND",
      fromEmail: first.senderEmail,
      toEmails: JSON.stringify(["supplier@example.test"]),
      subject: "Sender pool idempotency check",
      bodyText: "Test only.",
    },
  });
  await prisma.emailSenderReservation.update({
    where: { id: first.reservationId },
    data: {
      messageId: recordedMessage.id,
      status: "RECORDED",
      localThreadId: thread.id,
    },
  });
  const repeated = await reserveEmailSender({
    officeId,
    idempotencyKey: `sender-pool-db-${suffix}-0`,
    requestHash: requestHash("delivery-0"),
  });
  assert.ok("ok" in repeated);
  assert.equal(repeated.completed, true);
  assert.equal(repeated.accountId, first.accountId);

  const conflicting = await reserveEmailSender({
    officeId,
    idempotencyKey: `sender-pool-db-${suffix}-0`,
    requestHash: requestHash("different delivery"),
  });
  assert.equal("code" in conflicting ? conflicting.code : null, "IDEMPOTENCY_CONFLICT");

  const second = reservations[1];
  assert.ok("ok" in second);
  await releaseEmailSenderReservation({ officeId, reservationId: second.reservationId });
  const replacement = await reserveEmailSender({
    officeId,
    idempotencyKey: `sender-pool-db-${suffix}-replacement`,
    requestHash: requestHash("replacement"),
  });
  assert.ok("ok" in replacement);

  // Mailboxes are one shared pool, so an office may reserve a mailbox that
  // another office connected, and that reservation still belongs to the office
  // that sent the mail.
  const pooledReservation = await prisma.emailSenderReservation.create({
    data: {
      officeId: otherOfficeId,
      accountId: accounts[0].id,
      usageDate: new Date(),
      idempotencyKey: `cross-office-${suffix}`,
      requestHash: requestHash("cross office"),
    },
  });
  assert.equal(pooledReservation.officeId, otherOfficeId);
  await prisma.emailSenderReservation.delete({ where: { id: pooledReservation.id } });

  const otherAccount = await prisma.emailAccount.create({
    data: {
      officeId: otherOfficeId,
      email: `other-${suffix}@example.test`,
      provider: "GMAIL_APP_PASSWORD",
      credentialSecret: "encrypted-test-secret",
      isActive: true,
      sendEnabled: true,
      dailySendLimit: 2,
    },
  });
  const rejectedBulkUpdate = await updateSharedEmailSenderPoolAccounts({
    accountIds: [accounts[0].id, `missing-account-${suffix}`],
    dailySendLimit: 10,
  });
  assert.equal(rejectedBulkUpdate.ok, false, "a bulk update naming an unknown account must be rejected atomically");
  assert.equal((await prisma.emailAccount.findUniqueOrThrow({ where: { id: accounts[0].id } })).dailySendLimit, 2, "a rejected bulk update must not partially change an account");
  // The pool is shared, so mailboxes connected through different offices change together.
  const acceptedBulkUpdate = await updateSharedEmailSenderPoolAccounts({
    accountIds: [accounts[0].id, otherAccount.id],
    dailySendLimit: 10,
    sendEnabled: false,
  });
  assert.deepEqual(acceptedBulkUpdate, { ok: true, count: 2 });
  const bulkUpdatedAccounts = await prisma.emailAccount.findMany({ where: { id: { in: [accounts[0].id, otherAccount.id] } }, orderBy: { id: "asc" } });
  assert.equal(bulkUpdatedAccounts.every((account) => account.dailySendLimit === 10 && !account.sendEnabled), true, "a valid bulk update must apply every selected change");
  await prisma.emailAccount.updateMany({
    where: { id: { in: [accounts[0].id, otherAccount.id] } },
    data: { sendEnabled: true, dailySendLimit: 2 },
  });
  const concurrentKey = `sender-pool-db-${suffix}-concurrent`;
  const concurrent = await Promise.all(Array.from({ length: 20 }, () => reserveEmailSender({
    officeId: otherOfficeId,
    idempotencyKey: concurrentKey,
    requestHash: requestHash("concurrent delivery"),
  })));
  assert.equal(concurrent.filter((result) => "ok" in result).length, 1);
  assert.equal(concurrent.filter((result) => "code" in result && result.code === "DELIVERY_UNCERTAIN").length, 19);
  assert.equal(await prisma.emailSenderReservation.count({ where: { officeId: otherOfficeId, idempotencyKey: concurrentKey } }), 1);
  const nextDayRetry = await reserveEmailSender({
    officeId: otherOfficeId,
    idempotencyKey: concurrentKey,
    requestHash: requestHash("concurrent delivery"),
    now: new Date(Date.now() + 24 * 60 * 60 * 1_000),
  });
  assert.equal("code" in nextDayRetry ? nextDayRetry.code : null, "DELIVERY_UNCERTAIN");
  const otherReservation = await prisma.emailSenderReservation.create({
    data: {
      officeId: otherOfficeId,
      accountId: otherAccount.id,
      usageDate: new Date(),
      idempotencyKey: `other-${suffix}`,
      requestHash: requestHash("other delivery"),
    },
  });
  await assert.rejects(
    () => prisma.emailSenderReservation.create({
      data: {
        officeId: otherOfficeId,
        accountId: otherAccount.id,
        usageDate: new Date(),
        idempotencyKey: `invalid-hash-${suffix}`,
        requestHash: "not-a-sha-256-hash",
      },
    }),
    /constraint|check/i,
    "the database must reject a malformed sender request hash",
  );
  await assert.rejects(
    async () => {
      const crossAccountMessage = await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          accountId: first.accountId,
          officeId,
          externalId: `cross-message-${suffix}`,
          direction: "OUTBOUND",
          fromEmail: first.senderEmail,
          toEmails: JSON.stringify(["supplier@example.test"]),
        },
      });
      await prisma.emailSenderReservation.update({ where: { id: otherReservation.id }, data: { messageId: crossAccountMessage.id } });
    },
    /foreign key|constraint/i,
    "the database must reject a cross-account reservation message link",
  );
  await assert.rejects(
    async () => {
      const nullAccountMessage = await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          accountId: null,
          officeId: null,
          externalId: `null-account-message-${suffix}`,
          direction: "OUTBOUND",
          fromEmail: first.senderEmail,
          toEmails: JSON.stringify(["supplier@example.test"]),
        },
      });
      await prisma.emailSenderReservation.update({ where: { id: otherReservation.id }, data: { messageId: nullAccountMessage.id } });
    },
    /foreign key|constraint/i,
    "the database must reject a reservation link with a null account",
  );
  await assert.rejects(
    () => prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        accountId: otherAccount.id,
        officeId: otherOfficeId,
        externalId: `cross-office-thread-${suffix}`,
        direction: "OUTBOUND",
        fromEmail: otherAccount.email,
        toEmails: JSON.stringify(["supplier@example.test"]),
      },
    }),
    /foreign key|constraint/i,
    "the database must reject a message linked to another office's thread",
  );

  const trafficAccounts = await Promise.all(["used", "free"].map((label) => prisma.emailAccount.create({
    data: {
      officeId: trafficOfficeId,
      email: `${label}-${suffix}@example.test`,
      provider: "GMAIL_APP_PASSWORD",
      credentialSecret: "encrypted-test-secret",
      isActive: true,
      sendEnabled: true,
      dailySendLimit: 2,
    },
  })));
  const trafficThread = await prisma.emailThread.create({
    data: {
      officeId: trafficOfficeId,
      subject: "Existing outbound traffic",
      participants: JSON.stringify([trafficAccounts[0].email, "supplier@example.test"]),
    },
  });
  await prisma.emailMessage.createMany({
    data: [0, 1].map((index) => ({
      threadId: trafficThread.id,
      accountId: trafficAccounts[0].id,
      officeId: trafficOfficeId,
      externalId: `existing-traffic-${suffix}-${index}`,
      direction: "OUTBOUND" as const,
      fromEmail: trafficAccounts[0].email,
      toEmails: JSON.stringify(["supplier@example.test"]),
    })),
  });
  const skipsUsedAccount = await reserveEmailSender({
    officeId: trafficOfficeId,
    idempotencyKey: `existing-traffic-${suffix}`,
    requestHash: requestHash("existing traffic"),
  });
  assert.ok("ok" in skipsUsedAccount);
  assert.equal(skipsUsedAccount.accountId, trafficAccounts[1].id, "ordinary outbound traffic must consume daily capacity before pool allocation");
  const exactUsedAccount = await reserveEmailSender({
    officeId: trafficOfficeId,
    accountId: trafficAccounts[0].id,
    idempotencyKey: `existing-traffic-exact-${suffix}`,
    requestHash: requestHash("existing traffic exact"),
  });
  assert.equal("code" in exactUsedAccount ? exactUsedAccount.code : null, "POOL_EXHAUSTED");

  console.log("Email sender pool database behavior passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
