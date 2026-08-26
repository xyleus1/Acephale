import { PrismaClient, EmailDirection } from "@prisma/client";
const prisma = new PrismaClient();
const OFFICE_ID = "office-demo-testing";
async function main() {
  const account = await prisma.emailAccount.findFirstOrThrow({ where: { officeId: OFFICE_ID } });
  const salesCompany = await prisma.company.findFirstOrThrow({ where: { id: "company-local-sales-demo" } });
  const anadolu = await prisma.company.upsert({
    where: { id: "company-local-anadolu" },
    update: { name: "Anadolu Kalip Ltd" },
    create: { id: "company-local-anadolu", officeId: OFFICE_ID, name: "Anadolu Kalip Ltd" },
  });
  const existing = await prisma.emailThread.findFirst({ where: { officeId: OFFICE_ID, subject: { contains: "Istanbul to Hamburg" } } });
  if (!existing) throw new Error("sales thread missing");
  const t1 = await prisma.emailThread.upsert({
    where: { id: "thread-local-rfq-12345678" },
    update: {},
    create: {
      id: "thread-local-rfq-12345678",
      officeId: OFFICE_ID,
      companyId: anadolu.id,
      subject: "Quotation request: CNC machined brackets [RFQ 12345678]",
      participants: JSON.stringify(["rfq@usederya.com", "quotes@anadolukalip.example"]),
      lastMessageAt: new Date("2026-08-24T11:00:00Z"),
      messageCount: 1,
    },
  });
  await prisma.emailMessage.deleteMany({ where: { threadId: t1.id } });
  await prisma.emailMessage.createMany({ data: [
    {
      threadId: t1.id,
      accountId: account.id,
      officeId: OFFICE_ID,
      direction: EmailDirection.OUTBOUND,
      fromEmail: "rfq@usederya.com",
      toEmails: JSON.stringify(["quotes@anadolukalip.example"]),
      subject: "Quotation request: CNC machined brackets [RFQ 12345678]",
      bodyText: "Hello,\n\nPlease quote 500 CNC machined brackets, 6061 aluminium, drawing attached.\n\nDerya sourcing desk",
      sentAt: new Date("2026-08-24T11:00:00Z"),
    },
    {
      threadId: existing.id,
      accountId: account.id,
      officeId: OFFICE_ID,
      direction: EmailDirection.INBOUND,
      fromEmail: "ops@kayserilojistik.example",
      toEmails: JSON.stringify(["rfq@usederya.com"]),
      subject: "RE: Istanbul to Hamburg FCL rate confirmation",
      bodyText: "Merhaba,\n\nRate accepted, please book for next Tuesday sailing.\n\nKayseri Lojistik",
      sentAt: new Date("2026-08-24T08:30:00Z"),
    },
  ]});
  const rows = await prisma.emailMessage.findMany({ where: { thread: { officeId: OFFICE_ID } }, orderBy: { sentAt: "desc" }, select: { direction: true, subject: true } });
  console.log(rows.length, "rows");
  for (const r of rows) console.log(r.direction, r.subject);
}
main().finally(() => prisma.$disconnect());
