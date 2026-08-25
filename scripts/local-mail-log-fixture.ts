import { PrismaClient, UserRole, EmailDirection } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();
const OFFICE_ID = "office-demo-testing";
const WORKSPACE_ID = "cmt6tpr3o0005qhh6j8b0n0eb";

async function main() {
  const password = process.env.LOCAL_TEST_PASSWORD;
  if (!password) throw new Error("LOCAL_TEST_PASSWORD is required.");

  await prisma.office.upsert({
    where: { id: OFFICE_ID },
    update: { name: "Demo Testing" },
    create: { id: OFFICE_ID, name: "Demo Testing" },
  });

  const user = await prisma.user.upsert({
    where: { officeId_email: { officeId: OFFICE_ID, email: "mert@usederya.com" } },
    update: { officeId: OFFICE_ID, role: UserRole.ADMIN, isActive: true, passwordHash: await hashPassword(password) },
    create: {
      officeId: OFFICE_ID,
      email: "mert@usederya.com",
      fullName: "Mert Turna",
      role: UserRole.ADMIN,
      canViewWholeOffice: true,
      isActive: true,
      passwordHash: await hashPassword(password),
    },
  });

  await prisma.supplyWorkspace.upsert({
    where: { id: WORKSPACE_ID },
    update: { officeId: OFFICE_ID, name: "Derya Demo Procurement Lab", status: "ACTIVE" },
    create: { id: WORKSPACE_ID, officeId: OFFICE_ID, name: "Derya Demo Procurement Lab", status: "ACTIVE", createdByUserId: user.id },
  });
  await prisma.supplyWorkspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: user.id } },
    update: { role: "OWNER", isActive: true },
    create: { officeId: OFFICE_ID, workspaceId: WORKSPACE_ID, userId: user.id, role: "OWNER", isActive: true },
  });

  const account = await prisma.emailAccount.upsert({
    where: { officeId_email: { officeId: OFFICE_ID, email: "rfq@usederya.com" } },
    update: { isActive: true },
    create: { officeId: OFFICE_ID, email: "rfq@usederya.com", provider: "GMAIL_APP_PASSWORD", isActive: true },
  });

  const salesCompany = await prisma.company.upsert({
    where: { id: "company-local-sales-demo" },
    update: { name: "Kayseri Lojistik AS" },
    create: { id: "company-local-sales-demo", officeId: OFFICE_ID, name: "Kayseri Lojistik AS" },
  });

  await prisma.emailMessage.deleteMany({ where: { thread: { officeId: OFFICE_ID } } });
  await prisma.emailThread.deleteMany({ where: { officeId: OFFICE_ID } });

  const procurementThread = await prisma.emailThread.create({
    data: {
      officeId: OFFICE_ID,
      subject: "Quotation request: Hydraulic external gear pumps [RFQ b21f1e6f]",
      participants: JSON.stringify(["rfq@usederya.com", "sales@ningbo-hydraulics.example"]),
      lastMessageAt: new Date("2026-08-24T10:20:00Z"),
      messageCount: 2,
    },
  });
  const unlinkedThread = await prisma.emailThread.create({
    data: {
      officeId: OFFICE_ID,
      subject: "Quotation request: mystery item [RFQ deadbeef]",
      participants: JSON.stringify(["rfq@usederya.com", "sales@unknown-vendor.example"]),
      lastMessageAt: new Date("2026-08-24T09:00:00Z"),
      messageCount: 1,
    },
  });
  const salesThread = await prisma.emailThread.create({
    data: {
      officeId: OFFICE_ID,
      companyId: salesCompany.id,
      subject: "Istanbul to Hamburg FCL rate confirmation",
      participants: JSON.stringify(["rfq@usederya.com", "ops@kayserilojistik.example"]),
      lastMessageAt: new Date("2026-08-24T08:00:00Z"),
      messageCount: 1,
    },
  });

  await prisma.emailMessage.createMany({
    data: [
      {
        threadId: procurementThread.id,
        accountId: account.id,
        officeId: OFFICE_ID,
        direction: EmailDirection.OUTBOUND,
        fromEmail: "rfq@usederya.com",
        toEmails: JSON.stringify(["sales@ningbo-hydraulics.example"]),
        subject: "Quotation request: Hydraulic external gear pumps [RFQ b21f1e6f]",
        bodyText: "Hello,\n\nWe are sourcing hydraulic external gear pumps for a European buyer.\nPlease quote unit price FOB, lead time, and MOQ.\n\nDerya sourcing desk",
        sentAt: new Date("2026-08-24T10:00:00Z"),
      },
      {
        threadId: procurementThread.id,
        accountId: account.id,
        officeId: OFFICE_ID,
        direction: EmailDirection.INBOUND,
        fromEmail: "sales@ningbo-hydraulics.example",
        toEmails: JSON.stringify(["rfq@usederya.com"]),
        subject: "RE: Quotation request: Hydraulic external gear pumps [RFQ b21f1e6f]",
        bodyText: "Dear Derya,\n\nOur price is 41.50 USD per unit FOB Ningbo, MOQ 200 pieces, lead time 25 days.\n\nBest regards,\nNingbo Hydraulics",
        sentAt: new Date("2026-08-24T10:20:00Z"),
      },
      {
        threadId: unlinkedThread.id,
        accountId: account.id,
        officeId: OFFICE_ID,
        direction: EmailDirection.OUTBOUND,
        fromEmail: "rfq@usederya.com",
        toEmails: JSON.stringify(["sales@unknown-vendor.example"]),
        subject: "Quotation request: mystery item [RFQ deadbeef]",
        bodyText: "Placeholder outreach with an RFQ reference that has no matching workflow order.",
        sentAt: new Date("2026-08-24T09:00:00Z"),
      },
      {
        threadId: salesThread.id,
        accountId: account.id,
        officeId: OFFICE_ID,
        direction: EmailDirection.OUTBOUND,
        fromEmail: "rfq@usederya.com",
        toEmails: JSON.stringify(["ops@kayserilojistik.example"]),
        subject: "Istanbul to Hamburg FCL rate confirmation",
        bodyText: "Hi team,\n\nConfirming 1x40HC Istanbul to Hamburg at 1,180 USD all in, valid 14 days.\n\nDerya",
        sentAt: new Date("2026-08-24T08:00:00Z"),
      },
    ],
  });

  console.log("office", OFFICE_ID, "user", user.email, "workspace", WORKSPACE_ID);
}

main().finally(() => prisma.$disconnect());
