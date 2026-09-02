// Local-only app-side fixtures for the supplier follow up (nudge) tests.
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();
const OFFICE = "office-demo-testing";
const PCBA_ORDER = "11111111-1111-4111-8111-111111111111";
const FOAM_ORDER = "22222222-2222-4222-8222-222222222222";
const CLOSED_ORDER = "33333333-3333-4333-8333-333333333333";
const DAY = 24 * 60 * 60_000;

function encryptSecret(plaintext: string) {
  const raw = process.env.TOKEN_ENCRYPTION_KEY!.trim();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes base64");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("derya:oauth-token:v1", "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["enc:v1", iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(":");
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function mailbox(email: string) {
  const existing = await prisma.emailAccount.findFirst({ where: { email } });
  const data = {
    officeId: OFFICE,
    email,
    provider: "GMAIL_APP_PASSWORD",
    isActive: true,
    sendEnabled: true,
    dailySendLimit: 30,
    credentialSecret: encryptSecret("abcdefghijklmnop"),
    displayName: "Derya Sourcing Desk",
  };
  if (existing) {
    return prisma.emailAccount.update({ where: { id: existing.id }, data });
  }
  return prisma.emailAccount.create({ data });
}

type VendorFixture = {
  vendorId: string;
  vendor: string;
  orderId: string;
  material: string;
  recipient: string;
  ownerEmail: string;
  /** Days since our RFQ went out. */
  quietDays: number;
  inbound?: boolean;
  /** Leave the reservation out so the vendor has no recorded first send. */
  noReservation?: boolean;
  /** Round count already spent on follow ups. */
  spentNudges?: number;
};

const VENDORS: VendorFixture[] = [
  { vendorId: "aa000001-0000-4000-8000-000000000001", vendor: "Coldcast Circuits", orderId: PCBA_ORDER, material: "PCBA controller boards for the pump line", recipient: "sales@coldcast.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 6 },
  { vendorId: "aa000002-0000-4000-8000-000000000002", vendor: "Freshmail Assembly", orderId: PCBA_ORDER, material: "PCBA controller boards for the pump line", recipient: "quotes@freshmail.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 0 },
  { vendorId: "aa000003-0000-4000-8000-000000000003", vendor: "Replied Electronics", orderId: PCBA_ORDER, material: "PCBA controller boards for the pump line", recipient: "sales@replied.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 6, inbound: true },
  { vendorId: "aa000004-0000-4000-8000-000000000004", vendor: "Quoted Circuits", orderId: PCBA_ORDER, material: "PCBA controller boards for the pump line", recipient: "sales@quotedcircuits.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 6 },
  { vendorId: "aa000005-0000-4000-8000-000000000005", vendor: "Nevermailed Boards", orderId: PCBA_ORDER, material: "PCBA controller boards for the pump line", recipient: "sales@nevermailed.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 6, noReservation: true },
  { vendorId: "aa000006-0000-4000-8000-000000000006", vendor: "Nullreceipt Boards", orderId: PCBA_ORDER, material: "PCBA controller boards for the pump line", recipient: "sales@nullreceipt.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 7 },
  { vendorId: "aa000007-0000-4000-8000-000000000007", vendor: "Maxedout Assembly", orderId: PCBA_ORDER, material: "PCBA controller boards for the pump line", recipient: "sales@maxedout.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 9, spentNudges: 2 },
  { vendorId: "aa000008-0000-4000-8000-000000000008", vendor: "Rejected Circuits", orderId: PCBA_ORDER, material: "PCBA controller boards for the pump line", recipient: "sales@rejectedcircuits.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 6 },
  { vendorId: "aa000009-0000-4000-8000-000000000009", vendor: "Unknownfate Circuits", orderId: PCBA_ORDER, material: "PCBA controller boards for the pump line", recipient: "unknown-outcome@unknownfate.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 6 },
  { vendorId: "aa000010-0000-4000-8000-000000000010", vendor: "Rejectsender Circuits", orderId: PCBA_ORDER, material: "PCBA controller boards for the pump line", recipient: "sales@rejectsender.example", ownerEmail: "rfq-reject@usederya.com", quietDays: 6 },
  { vendorId: "bb000001-0000-4000-8000-000000000001", vendor: "Coldfoam Molders", orderId: FOAM_ORDER, material: "Molded viscoelastic foam seat cushions", recipient: "sales@coldfoam.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 8 },
  { vendorId: "cc000001-0000-4000-8000-000000000001", vendor: "Closedorder Circuits", orderId: CLOSED_ORDER, material: "PCBA controller boards for the pump line", recipient: "sales@closedorder.example", ownerEmail: "rfq-desk@usederya.com", quietDays: 6 },
];

async function main() {
  const decoy = await mailbox("rfq@usederya.com");
  const desk = await mailbox("rfq-desk@usederya.com");
  const reject = await mailbox("rfq-reject@usederya.com");
  const accounts = new Map([[decoy.email, decoy], [desk.email, desk], [reject.email, reject]]);

  // Clean out anything a previous run of these fixtures left behind.
  const staleThreads = await prisma.emailThread.findMany({
    where: { officeId: OFFICE, subject: { contains: "[FIXTURE]" } },
    select: { id: true },
  });
  const staleIds = staleThreads.map((thread) => thread.id);
  await prisma.emailSenderReservation.deleteMany({
    where: {
      officeId: OFFICE,
      OR: [
        { idempotencyKey: { contains: PCBA_ORDER } },
        { idempotencyKey: { contains: FOAM_ORDER } },
        { idempotencyKey: { contains: CLOSED_ORDER } },
        { localThreadId: { in: staleIds } },
      ],
    },
  });
  await prisma.emailMessage.deleteMany({ where: { threadId: { in: staleIds } } });
  await prisma.emailThread.deleteMany({ where: { id: { in: staleIds } } });

  for (const fixture of VENDORS) {
    const owner = accounts.get(fixture.ownerEmail)!;
    const reference = fixture.orderId.slice(0, 8);
    const sentAt = new Date(Date.now() - fixture.quietDays * DAY);
    const thread = await prisma.emailThread.create({
      data: {
        officeId: OFFICE,
        subject: `[FIXTURE] Quotation request: ${fixture.material} [RFQ ${reference}]`,
        participants: JSON.stringify([owner.email, fixture.recipient]),
        lastMessageAt: sentAt,
        messageCount: fixture.inbound ? 2 : 1,
      },
    });
    const rfqRfcId = `<rfq-${fixture.vendorId.slice(0, 8)}@derya.ai>`;
    const outbound = await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        accountId: owner.id,
        officeId: OFFICE,
        externalId: rfqRfcId,
        gmailMessageId: `provider-${fixture.vendorId.slice(0, 8)}`,
        rfcMessageId: rfqRfcId,
        direction: "OUTBOUND",
        fromEmail: owner.email,
        toEmails: JSON.stringify([fixture.recipient]),
        subject: `[FIXTURE] Quotation request: ${fixture.material} [RFQ ${reference}]`,
        bodyText: "Original request for quotation, local fixture.",
        sentAt,
      },
    });
    if (fixture.inbound) {
      await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          accountId: owner.id,
          officeId: OFFICE,
          externalId: `<reply-${fixture.vendorId.slice(0, 8)}@vendor.example>`,
          rfcMessageId: `<reply-${fixture.vendorId.slice(0, 8)}@vendor.example>`,
          direction: "INBOUND",
          fromEmail: fixture.recipient,
          toEmails: JSON.stringify([owner.email]),
          subject: `Re: [FIXTURE] Quotation request: ${fixture.material} [RFQ ${reference}]`,
          bodyText: "We received your enquiry and will respond with pricing.",
          sentAt: new Date(sentAt.getTime() + DAY),
        },
      });
    }
    if (!fixture.noReservation) {
      const key = `procurement-bulk-rfq:${fixture.orderId}:${fixture.vendorId}`;
      await prisma.emailSenderReservation.create({
        data: {
          officeId: OFFICE,
          accountId: owner.id,
          usageDate: new Date(sentAt.toISOString().slice(0, 10)),
          idempotencyKey: key,
          requestHash: hash(key),
          status: "RECORDED",
          providerMessageId: `provider-${fixture.vendorId.slice(0, 8)}`,
          localThreadId: thread.id,
          messageId: outbound.id,
        },
      });
    }
    for (let round = 1; round <= (fixture.spentNudges ?? 0); round += 1) {
      const key = `procurement-rfq-nudge:${fixture.orderId}:${round}:${fixture.vendorId}`;
      await prisma.emailSenderReservation.create({
        data: {
          officeId: OFFICE,
          accountId: owner.id,
          usageDate: new Date(sentAt.toISOString().slice(0, 10)),
          idempotencyKey: key,
          requestHash: hash(key),
          status: "RECORDED",
          providerMessageId: `provider-nudge-${round}-${fixture.vendorId.slice(0, 8)}`,
          localThreadId: thread.id,
        },
      });
    }
    console.log(`seeded ${fixture.vendor} thread=${thread.id} owner=${owner.email} quietDays=${fixture.quietDays}`);
  }

  // Sender pool skew: the decoy mailbox has sent nothing today while the mailbox
  // that owns every thread has, so a run that picked "the best pool mailbox"
  // instead of the thread owner would visibly use the decoy.
  const skewThread = await prisma.emailThread.create({
    data: {
      officeId: OFFICE,
      subject: "[FIXTURE] Sender pool usage skew",
      participants: JSON.stringify([desk.email, "filler@example.com"]),
      lastMessageAt: new Date(),
      messageCount: 5,
    },
  });
  for (let index = 0; index < 5; index += 1) {
    await prisma.emailMessage.create({
      data: {
        threadId: skewThread.id,
        accountId: desk.id,
        officeId: OFFICE,
        externalId: `<skew-${index}@derya.ai>`,
        direction: "OUTBOUND",
        fromEmail: desk.email,
        toEmails: JSON.stringify(["filler@example.com"]),
        subject: "[FIXTURE] usage skew",
        bodyText: "filler",
        sentAt: new Date(),
      },
    });
  }

  await prisma.user.updateMany({
    where: { officeId: OFFICE, email: "mert@usederya.com" },
    data: { passwordHash: await hashPassword("LocalTest!2345") },
  });
  console.log("login password for mert@usederya.com set to LocalTest!2345");
}

main().finally(() => prisma.$disconnect());
