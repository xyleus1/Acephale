import { PrismaClient, EmailDirection } from "@prisma/client";
const prisma = new PrismaClient();
const OFFICE_ID = "office-demo-testing";
const OTHER = "office-other-testing";

async function otherOffice() {
  await prisma.office.upsert({ where: { id: OTHER }, update: { name: "Other Office" }, create: { id: OTHER, name: "Other Office" } });
  const acc = await prisma.emailAccount.upsert({
    where: { officeId_email: { officeId: OTHER, email: "ops@otheroffice.example" } },
    update: { isActive: true },
    create: { officeId: OTHER, email: "ops@otheroffice.example", provider: "GMAIL_APP_PASSWORD", isActive: true },
  });
  const t = await prisma.emailThread.upsert({
    where: { id: "thread-other-office-zeppelin" },
    update: {},
    create: {
      id: "thread-other-office-zeppelin",
      officeId: OTHER,
      subject: "Archive check ZEPPELINWIDGET rate sheet",
      participants: JSON.stringify(["ops@otheroffice.example", "buyer@zeppelin.example"]),
      lastMessageAt: new Date("2026-08-24T12:00:00Z"),
      messageCount: 1,
    },
  });
  await prisma.emailMessage.deleteMany({ where: { threadId: t.id } });
  await prisma.emailMessage.create({ data: {
    threadId: t.id, accountId: acc.id, officeId: OTHER, direction: EmailDirection.OUTBOUND,
    fromEmail: "ops@otheroffice.example", toEmails: JSON.stringify(["buyer@zeppelin.example"]),
    subject: "Archive check ZEPPELINWIDGET rate sheet",
    bodyText: "This row belongs to another office and must never appear in the Demo Testing mail log.",
    sentAt: new Date("2026-08-24T12:00:00Z"),
  }});
  console.log("other office row seeded");
}

async function bulk() {
  const acc = await prisma.emailAccount.findFirstOrThrow({ where: { officeId: OFFICE_ID } });
  // one OLD row, older than everything else, carrying the unique term
  const old = await prisma.emailThread.upsert({
    where: { id: "thread-old-zeppelin" },
    update: {},
    create: {
      id: "thread-old-zeppelin", officeId: OFFICE_ID,
      subject: "Archive check ZEPPELINWIDGET rate sheet",
      participants: JSON.stringify(["rfq@usederya.com", "buyer@zeppelin.example"]),
      lastMessageAt: new Date("2025-01-02T08:00:00Z"), messageCount: 1,
    },
  });
  await prisma.emailMessage.deleteMany({ where: { threadId: old.id } });
  await prisma.emailMessage.create({ data: {
    threadId: old.id, accountId: acc.id, officeId: OFFICE_ID, direction: EmailDirection.OUTBOUND,
    fromEmail: "rfq@usederya.com", toEmails: JSON.stringify(["buyer@zeppelin.example"]),
    subject: "Archive check ZEPPELINWIDGET rate sheet",
    bodyText: "Oldest message in the office ledger, far outside the newest 150 rows.",
    sentAt: new Date("2025-01-02T08:00:00Z"),
  }});
  // 160 filler rows, all NEWER than the old row
  const filler = await prisma.emailThread.upsert({
    where: { id: "thread-filler-bulk" },
    update: {},
    create: {
      id: "thread-filler-bulk", officeId: OFFICE_ID,
      subject: "Filler traffic", participants: JSON.stringify(["rfq@usederya.com", "noise@filler.example"]),
      lastMessageAt: new Date("2026-08-23T00:00:00Z"), messageCount: 160,
    },
  });
  await prisma.emailMessage.deleteMany({ where: { threadId: filler.id } });
  await prisma.emailMessage.createMany({ data: Array.from({ length: 160 }, (_, i) => ({
    threadId: filler.id, accountId: acc.id, officeId: OFFICE_ID, direction: EmailDirection.OUTBOUND,
    fromEmail: "rfq@usederya.com", toEmails: JSON.stringify(["noise@filler.example"]),
    subject: `Filler traffic ${i + 1}`,
    bodyText: "Filler row to push the archive row outside the newest 150 messages.",
    sentAt: new Date(Date.UTC(2026, 7, 20, 0, i)),
  })) });
  const total = await prisma.emailMessage.count({ where: { thread: { officeId: OFFICE_ID } } });
  const newer = await prisma.emailMessage.count({ where: { thread: { officeId: OFFICE_ID }, sentAt: { gt: new Date("2025-01-02T08:00:00Z") } } });
  console.log("office rows", total, "rows newer than archive row", newer);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "scope") await otherOffice();
  else if (mode === "bulk") await bulk();
  else throw new Error("mode required: scope|bulk");
}
main().finally(() => prisma.$disconnect());
