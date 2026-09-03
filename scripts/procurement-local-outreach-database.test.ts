import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  loadLocalRfqMessages,
  localRfqOutreachByOrder,
} from "../src/lib/procurement-local-outreach";
import { rfqSubjectReference } from "../src/lib/procurement-local-outreach-model";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.startsWith("derya_supply_reply_verify")) {
  throw new Error("Local RFQ outreach tests require an explicit disposable derya_supply_reply_verify database.");
}

const orderId = randomUUID();
const otherOrderId = randomUUID();
const unlistedOrderId = randomUUID();
const reference = rfqSubjectReference(orderId);
const otherReference = rfqSubjectReference(otherOrderId);
const unlistedReference = rfqSubjectReference(unlistedOrderId);

async function thread(officeId: string, subject: string) {
  return prisma.emailThread.create({
    data: { officeId, subject, participants: "[]" },
  });
}

async function message(
  threadId: string,
  direction: "INBOUND" | "OUTBOUND",
  fromEmail: string,
  subject: string | null,
  sentAt: string,
) {
  return prisma.emailMessage.create({
    data: {
      threadId,
      direction,
      fromEmail,
      toEmails: JSON.stringify(direction === "OUTBOUND" ? [fromEmail === "desk@derya.ai" ? "sales@supplier.test" : "desk@derya.ai"] : ["desk@derya.ai"]),
      subject,
      bodyText: "body",
      sentAt: new Date(sentAt),
    },
  });
}

async function main() {
  const office = await prisma.office.create({ data: { name: `RFQ outreach ${randomUUID().slice(0, 8)}` } });
  const foreign = await prisma.office.create({ data: { name: `RFQ foreign ${randomUUID().slice(0, 8)}` } });

  const rfqThread = await thread(office.id, `${reference} Custom memory foam parts`);
  await message(rfqThread.id, "OUTBOUND", "desk@derya.ai", `${reference} Custom memory foam parts`, "2026-08-20T10:00:00.000Z");
  // The supplier's helpdesk rewrote the subject, so only the thread ties this
  // answer to the request.
  const stranded = await message(rfqThread.id, "INBOUND", "sales@supplier.test", "Your Support Request Has Been Received", "2026-08-21T10:00:00.000Z");
  const subjectless = await message(rfqThread.id, "INBOUND", "quotes@supplier.test", null, "2026-08-22T10:00:00.000Z");
  // A reply that kept another request's reference belongs to that request.
  const otherRfqThread = await thread(office.id, `${otherReference} Printed circuit boards`);
  await message(otherRfqThread.id, "INBOUND", "mixed@supplier.test", `${otherReference} Printed circuit boards`, "2026-08-23T10:00:00.000Z");

  // A reply whose client lowercased another request's reference still belongs
  // to that request, and the thread it landed on then answers for neither.
  const mixedThread = await thread(office.id, `${reference} Custom memory foam parts`);
  await message(mixedThread.id, "OUTBOUND", "desk@derya.ai", `${reference} Custom memory foam parts`, "2026-08-23T09:00:00.000Z");
  await message(mixedThread.id, "INBOUND", "lowercase@supplier.test", `Re: ${otherReference.toLowerCase()} Printed circuit boards`, "2026-08-23T11:00:00.000Z");
  await message(mixedThread.id, "INBOUND", "ambiguous@supplier.test", "Re: your enquiry", "2026-08-23T12:00:00.000Z");

  // The competing reference belongs to a request this call never asks about,
  // and a subject can name two requests at once. Both make the thread answer
  // for neither.
  const unlistedThread = await thread(office.id, `${reference} Custom memory foam parts`);
  await message(unlistedThread.id, "OUTBOUND", "desk@derya.ai", `${reference} Custom memory foam parts`, "2026-08-23T13:00:00.000Z");
  await message(unlistedThread.id, "INBOUND", "unlisted@supplier.test", `Re: ${unlistedReference} Other work`, "2026-08-23T14:00:00.000Z");
  await message(unlistedThread.id, "INBOUND", "hidden@supplier.test", "Re: your enquiry", "2026-08-23T15:00:00.000Z");

  const dualThread = await thread(office.id, `${reference} Custom memory foam parts`);
  await message(dualThread.id, "OUTBOUND", "desk@derya.ai", `${reference} Custom memory foam parts`, "2026-08-23T16:00:00.000Z");
  await message(dualThread.id, "INBOUND", "both@supplier.test", `Re: ${reference} ${otherReference} combined enquiry`, "2026-08-23T17:00:00.000Z");
  await message(dualThread.id, "INBOUND", "dual@supplier.test", "Re: your enquiry", "2026-08-23T18:00:00.000Z");

  const otherThread = await thread(office.id, "Newsletter");
  await message(otherThread.id, "INBOUND", "news@supplier.test", "Newsletter", "2026-08-24T10:00:00.000Z");

  const foreignThread = await thread(foreign.id, `${reference} Custom memory foam parts`);
  await message(foreignThread.id, "OUTBOUND", "desk@derya.ai", `${reference} Custom memory foam parts`, "2026-08-25T09:00:00.000Z");
  await message(foreignThread.id, "INBOUND", "foreign@supplier.test", "Re: quote", "2026-08-25T10:00:00.000Z");

  try {
    const messages = await loadLocalRfqMessages(office.id, orderId);
    const ids = messages.map((entry) => entry.id);
    assert.ok(ids.includes(stranded.id), "a stranded reply on the RFQ thread is read");
    assert.ok(ids.includes(subjectless.id), "a subjectless reply on the RFQ thread is read");
    const senders = messages.map((entry) => entry.fromEmail);
    assert.ok(!senders.includes("news@supplier.test"), "an unrelated thread stays out");
    assert.ok(!senders.includes("foreign@supplier.test"), "another office's thread stays out");
    assert.ok(!senders.includes("mixed@supplier.test"), "a reply tagged for another request stays out");
    assert.ok(
      !senders.includes("lowercase@supplier.test"),
      "a lower case reference still belongs to the request that owns it",
    );
    assert.ok(
      !senders.includes("ambiguous@supplier.test"),
      "a thread carrying two references answers for neither",
    );
    assert.ok(
      !senders.includes("hidden@supplier.test"),
      "a competing reference counts even when its request was never asked about",
    );
    assert.ok(
      !senders.includes("dual@supplier.test"),
      "one subject naming two requests makes its thread ambiguous",
    );
    assert.deepEqual(
      messages.map((entry) => entry.sentAt),
      [...messages.map((entry) => entry.sentAt)].sort(),
      "messages stay in send order",
    );

    const outreach = await localRfqOutreachByOrder(office.id, [orderId, otherOrderId]);
    const summary = outreach.get(orderId);
    assert.ok(summary, "the request has an outreach summary");
    assert.deepEqual(
      [...summary.respondedEmails].sort(),
      ["both@supplier.test", "quotes@supplier.test", "sales@supplier.test"],
      "stranded replies count as responses for the request that owns the thread",
    );
    assert.equal(summary.contacted, 1, "contacted still counts only the suppliers written to");

    const otherSummary = outreach.get(otherOrderId);
    assert.deepEqual(
      [...(otherSummary?.respondedEmails ?? [])].sort(),
      ["both@supplier.test", "lowercase@supplier.test", "mixed@supplier.test"],
      "a tagged reply stays with its own request however it is cased",
    );

    const foreignOutreach = await localRfqOutreachByOrder(foreign.id, [orderId]);
    assert.deepEqual(
      foreignOutreach.get(orderId)?.respondedEmails,
      ["foreign@supplier.test"],
      "office scoping holds on both sides",
    );

    console.log("procurement local outreach database contracts passed");
  } finally {
    await prisma.office.deleteMany({ where: { id: { in: [office.id, foreign.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
