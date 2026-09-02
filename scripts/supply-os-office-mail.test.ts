import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  getOfficeMailThread,
  listOfficeMailThreads,
} from "../src/lib/supply-os/office-mail";
import type { SupplyAccessContext } from "../src/lib/supply-os/persistence";

const suffix = randomUUID().slice(0, 8);
let officeId = "";
let foreignOfficeId = "";

async function cleanup() {
  const officeIds = [officeId, foreignOfficeId].filter(Boolean);
  if (officeIds.length > 0) {
    await prisma.office.deleteMany({ where: { id: { in: officeIds } } }).catch(() => undefined);
  }
  await prisma.$disconnect();
}

async function main() {
  try {
    const office = await prisma.office.create({ data: { name: `Office mail ${suffix}` } });
    officeId = office.id;
    const foreignOffice = await prisma.office.create({ data: { name: `Foreign mail ${suffix}` } });
    foreignOfficeId = foreignOffice.id;
    const operatorUser = await prisma.user.create({
      data: {
        id: `operator-${suffix}`,
        officeId,
        email: `operator-${suffix}@example.test`,
        passwordHash: "test",
        fullName: "Mail Operator",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const employeeUser = await prisma.user.create({
      data: {
        id: `employee-${suffix}`,
        officeId,
        email: `employee-${suffix}@example.test`,
        passwordHash: "test",
        fullName: "Mail Employee",
        role: "EMPLOYEE",
        canViewWholeOffice: true,
      },
    });
    const restrictedSalesUser = await prisma.user.create({
      data: {
        id: `sales-restricted-${suffix}`,
        officeId,
        email: `sales-restricted-${suffix}@example.test`,
        passwordHash: "test",
        fullName: "Restricted Sales",
        role: "SALES",
        canViewWholeOffice: false,
      },
    });
    const wholeOfficeSalesUser = await prisma.user.create({
      data: {
        id: `sales-wide-${suffix}`,
        officeId,
        email: `sales-wide-${suffix}@example.test`,
        passwordHash: "test",
        fullName: "Whole Office Sales",
        role: "SALES",
        canViewWholeOffice: true,
      },
    });
    const restrictedAdminUser = await prisma.user.create({
      data: {
        id: `admin-restricted-${suffix}`,
        officeId,
        email: `admin-restricted-${suffix}@example.test`,
        passwordHash: "test",
        fullName: "Restricted Admin",
        role: "ADMIN",
        canViewWholeOffice: false,
      },
    });
    const inactiveAdminUser = await prisma.user.create({
      data: {
        id: `admin-inactive-${suffix}`,
        officeId,
        email: `admin-inactive-${suffix}@example.test`,
        passwordHash: "test",
        fullName: "Inactive Admin",
        role: "ADMIN",
        isActive: false,
        canViewWholeOffice: true,
      },
    });
    const forbiddenCustomer: SupplyAccessContext = {
      officeId: "office-customer",
      userId: "customer",
      role: "ADMIN",
      canViewWholeOffice: true,
      accessKind: "customer",
    };
    await assert.rejects(
      () => listOfficeMailThreads(forbiddenCustomer),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "forbidden",
    );
    const forbiddenEmployee: SupplyAccessContext = {
      officeId,
      userId: employeeUser.id,
      role: "EMPLOYEE",
      canViewWholeOffice: true,
      accessKind: "operator",
    };
    await assert.rejects(
      () => listOfficeMailThreads(forbiddenEmployee),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "forbidden",
    );

    const company = await prisma.company.create({
      data: { officeId, name: `Mail company ${suffix}` },
    });
    const contact = await prisma.contact.create({
      data: { companyId: company.id, fullName: "Mail Contact" },
    });
    const context: SupplyAccessContext = {
      officeId,
      userId: operatorUser.id,
      role: "ADMIN",
      canViewWholeOffice: true,
      accessKind: "operator",
    };
    await assert.rejects(
      () => listOfficeMailThreads({
        officeId,
        userId: restrictedSalesUser.id,
        role: "SALES",
        canViewWholeOffice: false,
        accessKind: "operator",
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "forbidden",
    );
    const salesWideThreads = await listOfficeMailThreads({
      officeId,
      userId: wholeOfficeSalesUser.id,
      role: "SALES",
      canViewWholeOffice: true,
      accessKind: "operator",
    });
    assert.deepEqual(salesWideThreads.threads, []);
    const restrictedAdminThreads = await listOfficeMailThreads({
      officeId,
      userId: restrictedAdminUser.id,
      role: "ADMIN",
      canViewWholeOffice: false,
      accessKind: "operator",
    });
    assert.deepEqual(restrictedAdminThreads.threads, []);
    await assert.rejects(
      () => listOfficeMailThreads({
        officeId,
        userId: inactiveAdminUser.id,
        role: "ADMIN",
        canViewWholeOffice: true,
        accessKind: "operator",
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "forbidden",
    );

    const newest = await prisma.emailThread.create({
      data: {
        officeId,
        companyId: company.id,
        contactId: contact.id,
        subject: `Newest ${suffix}`,
        participants: JSON.stringify(["ops@derya.test", "contact@example.test"]),
        externalThreadId: null,
        lastMessageAt: new Date("2026-09-03T12:00:00Z"),
        messageCount: 2,
      },
    });
    const older = await prisma.emailThread.create({
      data: {
        officeId,
        subject: `Older ${suffix}`,
        participants: JSON.stringify(["ops@derya.test", "older@example.test"]),
        autoLinkSkipReason: "NOT_FREIGHT_RELATED",
        lastMessageAt: new Date("2026-09-02T12:00:00Z"),
        messageCount: 1,
      },
    });
    const foreign = await prisma.emailThread.create({
      data: {
        officeId: foreignOfficeId,
        subject: `Foreign ${suffix}`,
        participants: JSON.stringify(["foreign@example.test"]),
        lastMessageAt: new Date("2026-09-04T12:00:00Z"),
        messageCount: 1,
      },
    });
    const whatsapp = await prisma.emailThread.create({
      data: {
        officeId,
        subject: `WhatsApp ${suffix}`,
        participants: JSON.stringify(["whatsapp:905321112233"]),
        externalThreadId: `whatsapp:${suffix}`,
        lastMessageAt: new Date("2026-09-05T12:00:00Z"),
        messageCount: 0,
      },
    });
    const unrouted = await prisma.emailThread.create({
      data: {
        officeId,
        subject: `Unrouted ${suffix}`,
        participants: JSON.stringify(["unrouted@example.test"]),
        autoLinkSkipReason: "UNROUTED_SHARED_MAILBOX",
        lastMessageAt: new Date("2026-09-07T12:00:00Z"),
        messageCount: 0,
      },
    });
    const longThread = await prisma.emailThread.create({
      data: {
        officeId,
        subject: `Long ${suffix}`,
        participants: JSON.stringify(["ops@derya.test", "long@example.test"]),
        lastMessageAt: new Date("2026-09-01T12:00:00Z"),
        messageCount: 205,
      },
    });
    await prisma.emailMessage.createMany({
      data: [
        {
          threadId: newest.id,
          officeId,
          direction: "OUTBOUND",
          fromEmail: "old-pool@derya.test",
          toEmails: JSON.stringify(["contact@example.test"]),
          subject: "Old",
          bodyText: "Old body",
          sentAt: new Date("2026-09-03T10:00:00Z"),
        },
        {
          threadId: newest.id,
          officeId,
          direction: "OUTBOUND",
          fromEmail: "new-pool@derya.test",
          toEmails: JSON.stringify(["contact@example.test"]),
          subject: "New",
          bodyText: "New body",
          sentAt: new Date("2026-09-03T11:00:00Z"),
        },
        {
          threadId: newest.id,
          officeId,
          direction: "INBOUND",
          fromEmail: "contact@example.test",
          toEmails: JSON.stringify(["new-pool@derya.test"]),
          subject: "Reply",
          bodyText: null,
          sentAt: new Date("2026-09-03T12:00:00Z"),
        },
        {
          threadId: older.id,
          officeId,
          direction: "OUTBOUND",
          fromEmail: "older-pool@derya.test",
          toEmails: JSON.stringify(["older@example.test"]),
          subject: "Older",
          bodyText: "Older body",
          sentAt: new Date("2026-09-02T12:00:00Z"),
        },
        {
          threadId: foreign.id,
          officeId: foreignOfficeId,
          direction: "OUTBOUND",
          fromEmail: "foreign-pool@derya.test",
          toEmails: JSON.stringify(["foreign@example.test"]),
          subject: "Foreign",
          bodyText: "Foreign body",
          sentAt: new Date("2026-09-04T12:00:00Z"),
        },
      ],
    });
    await prisma.emailMessage.createMany({
      data: Array.from({ length: 205 }, (_, index) => ({
        threadId: longThread.id,
        officeId,
        direction: index % 2 === 0 ? "OUTBOUND" as const : "INBOUND" as const,
        fromEmail: index % 2 === 0 ? "ops@derya.test" : "long@example.test",
        toEmails: JSON.stringify([index % 2 === 0 ? "long@example.test" : "ops@derya.test"]),
        subject: `Long message ${index}`,
        bodyText: `Long body ${index}`,
        sentAt: new Date(Date.UTC(2026, 8, 6, 0, index)),
      })),
    });

    const firstPage = await listOfficeMailThreads(context, { limit: 1 });
    assert.deepEqual(firstPage.threads.map((thread) => thread.id), [newest.id]);
    assert.equal(firstPage.threads[0]?.mailbox, "new-pool@derya.test");
    assert.equal(firstPage.threads[0]?.companyName, company.name);
    assert.equal(firstPage.threads[0]?.contactName, contact.fullName);
    assert.ok(firstPage.nextCursor);
    const secondPage = await listOfficeMailThreads(context, {
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    assert.deepEqual(secondPage.threads.map((thread) => thread.id), [older.id]);
    assert.ok(secondPage.nextCursor);
    const thirdPage = await listOfficeMailThreads(context, {
      limit: 1,
      cursor: secondPage.nextCursor,
    });
    assert.deepEqual(thirdPage.threads.map((thread) => thread.id), [longThread.id]);
    assert.equal(thirdPage.nextCursor, null);

    const allThreads = await listOfficeMailThreads(context, { limit: 100 });
    assert.ok(allThreads.threads.some((thread) => thread.id === newest.id));
    assert.ok(!allThreads.threads.some((thread) => thread.id === whatsapp.id));
    assert.ok(!allThreads.threads.some((thread) => thread.id === unrouted.id));

    const detail = await getOfficeMailThread(context, newest.id);
    assert.deepEqual(detail.messages.map((message) => message.id), [
      (await prisma.emailMessage.findFirstOrThrow({
        where: { threadId: newest.id, fromEmail: "old-pool@derya.test" },
        select: { id: true },
      })).id,
      (await prisma.emailMessage.findFirstOrThrow({
        where: { threadId: newest.id, fromEmail: "new-pool@derya.test" },
        select: { id: true },
      })).id,
      (await prisma.emailMessage.findFirstOrThrow({
        where: { threadId: newest.id, direction: "INBOUND" },
        select: { id: true },
      })).id,
    ]);
    assert.equal(detail.mailbox, "new-pool@derya.test");
    assert.equal(detail.messages[2]?.bodyText, null);
    const longDetail = await getOfficeMailThread(context, longThread.id);
    assert.equal(longDetail.truncated, true);
    assert.equal(longDetail.messages.length, 200);
    assert.equal(longDetail.messages[0]?.bodyText, "Long body 5");
    assert.equal(longDetail.messages[199]?.bodyText, "Long body 204");
    await assert.rejects(
      () => getOfficeMailThread(context, whatsapp.id),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "not_found",
    );
    await assert.rejects(
      () => getOfficeMailThread(context, unrouted.id),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "not_found",
    );
    await assert.rejects(
      () => getOfficeMailThread(context, foreign.id),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "not_found",
    );
    console.log("Supply OS office mail contract passed.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
