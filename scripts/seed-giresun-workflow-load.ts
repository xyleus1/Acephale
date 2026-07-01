import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SEED_KEY = "giresun-workflow-load";
const RFQ_SOURCE_EMAIL = "rfq@usederya.com";
const CUSTOMER_EMAIL = "esat@avliahome.com";
const COMPANY_NAME = "Avlia Home";
const CONTACT_NAME = "Esat Avli";
const JOB_TITLE = "Avlia Home - Giresun to Ancona booking";

type CarrierSeed = {
  carrier: string;
  email: string;
  service: string;
  total40HC: number;
  transitDays: number;
  validity: string;
};

const carriers: CarrierSeed[] = [
  {
    carrier: "Arkas Line",
    email: "adriatic.rates@arkas.example",
    service: "Black Sea feeder via Istanbul / Adriatic service",
    total40HC: 3620,
    transitDays: 8,
    validity: "Valid through 10 Jul 2026",
  },
  {
    carrier: "Medkon Lines",
    email: "pricing@medkon.example",
    service: "Giresun to Ancona via Marmara transshipment",
    total40HC: 3740,
    transitDays: 9,
    validity: "Valid through 12 Jul 2026",
  },
  {
    carrier: "MSC Short Sea",
    email: "turkey.shortsea@msc.example",
    service: "Turkey Adriatic short-sea service",
    total40HC: 3910,
    transitDays: 11,
    validity: "Valid through 11 Jul 2026",
  },
];

const quoteLines = [
  { desc: "Ocean freight and carrier surcharges - Arkas Line", amount: 4500, currency: "USD" },
  { desc: "Origin THC and export documentation", amount: 360, currency: "USD" },
  { desc: "Destination coordination and customs support", amount: 340, currency: "USD" },
];

function addDays(days: number) {
  return new Date(Date.now() + days * DAY_MS);
}

function addHours(hours: number) {
  return new Date(Date.now() + hours * HOUR_MS);
}

function escapePdfText(value: string) {
  return value.replace(/[\\()]/g, (char) => `\\${char}`);
}

function makePdfDataUrl(title: string, lines: string[]) {
  let content = `BT\n/F1 16 Tf\n72 760 Td\n(${escapePdfText(title)}) Tj\nET\n`;
  let y = 724;
  for (const line of lines) {
    content += `BT\n/F1 11 Tf\n72 ${y} Td\n(${escapePdfText(line)}) Tj\nET\n`;
    y -= 18;
  }

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return `data:application/pdf;base64,${Buffer.from(pdf, "latin1").toString("base64")}`;
}

async function getOffice() {
  const admin = await prisma.user.findFirst({
    where: { email: "admin@demo.local" },
    select: { officeId: true, office: { select: { name: true } } },
  });
  if (admin) return { id: admin.officeId, name: admin.office.name };

  const office = await prisma.office.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (!office) throw new Error("No office exists. Seed or create an office first.");
  return office;
}

async function getOfficeById(officeId: string) {
  const office = await prisma.office.findUnique({
    where: { id: officeId },
    select: { id: true, name: true },
  });
  if (!office) throw new Error(`Office ${officeId} not found.`);
  return office;
}

async function nextJobReference(officeId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `JOB-${year}-`;
  const existing = await prisma.job.findMany({
    where: { officeId, reference: { startsWith: prefix } },
    select: { reference: true },
  });

  let max = 0;
  for (const job of existing) {
    const n = Number.parseInt(job.reference.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

async function existingSeededLoad(officeId: string) {
  return prisma.job.findFirst({
    where: {
      officeId,
      title: JOB_TITLE,
      origin: "Giresun, Turkey",
      destination: "Ancona, Italy",
      company: { name: COMPANY_NAME },
    },
    select: { id: true, reference: true, inquiryId: true },
  });
}

async function removeExistingSeededLoad(officeId: string) {
  const jobs = await prisma.job.findMany({
    where: {
      officeId,
      OR: [
        {
          title: JOB_TITLE,
          origin: "Giresun, Turkey",
          destination: "Ancona, Italy",
          company: { name: COMPANY_NAME },
        },
        { emailThreads: { some: { externalThreadId: { startsWith: `seed:${SEED_KEY}:` } } } },
        { inquiry: { parsedData: { contains: SEED_KEY } } },
      ],
    },
    select: { id: true, reference: true, inquiryId: true },
  });
  const inquiryIds = jobs.map((job) => job.inquiryId).filter((id): id is string => Boolean(id));
  const threads = await prisma.emailThread.findMany({
    where: {
      officeId,
      OR: [
        { externalThreadId: { startsWith: `seed:${SEED_KEY}:` } },
        { jobId: { in: jobs.map((job) => job.id) } },
        { inquiryId: { in: inquiryIds } },
      ],
    },
    select: { id: true },
  });

  if (threads.length > 0) {
    await prisma.emailThread.deleteMany({ where: { id: { in: threads.map((thread) => thread.id) } } });
  }
  if (jobs.length > 0) {
    await prisma.job.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } });
  }
  if (inquiryIds.length > 0) {
    await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  }

  return { jobs: jobs.map((job) => job.reference), threads: threads.length, inquiries: inquiryIds.length };
}

async function seedSourceAccount(officeId: string, createSeedInbox: boolean) {
  const existing = await prisma.emailAccount.findFirst({
    where: { officeId, email: { equals: RFQ_SOURCE_EMAIL, mode: "insensitive" } },
    select: { id: true, email: true, provider: true },
  });
  if (existing) return existing;

  if (createSeedInbox) {
    return prisma.emailAccount.create({
      data: { officeId, email: RFQ_SOURCE_EMAIL, provider: "GMAIL", isActive: true },
      select: { id: true, email: true, provider: true },
    });
  }

  return prisma.emailAccount.findFirst({
    where: { officeId, provider: "GMAIL", isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, provider: true },
  });
}

function quoteLinesRaw() {
  return quoteLines.map((line) => `${line.desc}|${line.amount}|${line.currency}`).join("\n");
}

function quoteTotal() {
  return quoteLines.reduce((total, line) => total + line.amount, 0);
}

async function seedWorkflowLoad(officeId: string, accountId: string | null) {
  const company = await prisma.company.upsert({
    where: { officeId_name: { officeId, name: COMPANY_NAME } },
    create: {
      officeId,
      name: COMPANY_NAME,
      status: "WORKED",
      class1: "Active",
      class2: "A",
      product: "Sea",
      lane: "Turkey to Adriatic",
      direction: "Export",
    },
    update: {
      status: "WORKED",
      class1: "Active",
      class2: "A",
      product: "Sea",
      lane: "Turkey to Adriatic",
      direction: "Export",
    },
    select: { id: true },
  });

  await prisma.contact.upsert({
    where: { id: `${company.id}:giresun-esat-avli` },
    create: {
      id: `${company.id}:giresun-esat-avli`,
      companyId: company.id,
      fullName: CONTACT_NAME,
      email: CUSTOMER_EMAIL,
      title: "Operations",
      isApprovedForInbox: true,
      approvedForInboxAt: new Date(),
    },
    update: {
      fullName: CONTACT_NAME,
      email: CUSTOMER_EMAIL,
      title: "Operations",
      isApprovedForInbox: true,
      approvedForInboxAt: new Date(),
    },
  });

  const receivedAt = addHours(-6);
  const cargoReadyDate = addDays(2);
  const etd = addDays(4);
  const eta = addDays(13);
  const reference = await nextJobReference(officeId);
  const subject = "New shipment inquiry - Derya: Giresun to Ancona";
  const rawEmailBody = [
    "Forwarded RFQ from Esat Avli <esat@avliahome.com>",
    "",
    "Customer: Avlia Home",
    "Lane: Giresun, Turkey to Ancona, Italy",
    "Mode: Sea FCL",
    "Cargo: Home textile cartons",
    "Equipment: 1 x 40HC",
    "Gross weight: 24,000 kg",
    "Volume: 68 CBM",
    "Incoterms: FOB Giresun",
    "Cargo ready: two business days",
    "Target: USD 5,400 all-in",
    "",
    "Please price the same Adriatic routing and confirm booking availability.",
  ].join("\n");

  const inquiry = await prisma.inquiry.create({
    data: {
      officeId,
      companyId: company.id,
      subject,
      fromEmail: CUSTOMER_EMAIL,
      fromCompany: COMPANY_NAME,
      origin: "Giresun, Turkey",
      destination: "Ancona, Italy",
      mode: "SEA-FCL",
      containerCount: 1,
      containerType: "40HC",
      packages: 960,
      stackable: "YES",
      topLoad: "NO",
      dangerousGoods: "NO",
      customsBy: "US",
      commodity: "Home textile cartons",
      weight: 24000,
      volume: 68,
      incoterms: "FOB",
      targetPrice: 5400,
      targetCurrency: "USD",
      targetPriceStatus: "PROVIDED",
      targetPriceSource: "Customer target in forwarded RFQ",
      cargoReadyDate,
      type: "FORWARDING",
      status: "WON",
      rawEmailBody,
      parsedData: JSON.stringify({
        seedKey: SEED_KEY,
        source: RFQ_SOURCE_EMAIL,
        customer: CUSTOMER_EMAIL,
        extractedFields: ["origin", "destination", "mode", "commodity", "equipment", "weight", "targetPrice", "cargoReadyDate"],
      }),
      notes: "Forwarded customer RFQ; all core freight facts are available and source-linked to the inbox thread.",
      receivedAt,
      createdAt: receivedAt,
    },
  });

  const job = await prisma.job.create({
    data: {
      officeId,
      companyId: company.id,
      inquiryId: inquiry.id,
      reference,
      title: JOB_TITLE,
      cadence: "ONE_OFF",
      status: "BOOKED",
      type: "FORWARDING",
      mode: "SEA-FCL",
      origin: "Giresun, Turkey",
      destination: "Ancona, Italy",
      commodity: "Home textile cartons",
      incoterms: "FOB",
      weight: 24000,
      volume: 68,
      packages: 960,
      stackable: "YES",
      topLoad: "NO",
      dangerousGoods: "NO",
      customsBy: "US",
      containerCount: 1,
      containerType: "40HC",
      targetPrice: 5400,
      targetCurrency: "USD",
      targetPriceStatus: "PROVIDED",
      targetPriceSource: "Customer target in forwarded RFQ",
      quoteLines: quoteLinesRaw(),
      etd,
      eta,
      revenue: quoteTotal(),
      cost: carriers[0].total40HC,
      currency: "USD",
      notifyCustomer: false,
      customerEmail: CUSTOMER_EMAIL,
      notes: "Customer confirmed the Arkas option. Cargo facts are complete; final bill of lading copy is pending carrier release.",
    },
    select: { id: true, reference: true },
  });

  const rfqThread = await prisma.emailThread.create({
    data: {
      officeId,
      jobId: job.id,
      inquiryId: inquiry.id,
      subject,
      participants: JSON.stringify([RFQ_SOURCE_EMAIL, CUSTOMER_EMAIL]),
      externalThreadId: `seed:${SEED_KEY}:rfq:${job.reference}`,
      autoLinkedAt: addHours(-5.9),
      lastMessageAt: addHours(-3.6),
      messageCount: 4,
    },
    select: { id: true },
  });

  await prisma.emailMessage.createMany({
    data: [
      {
        threadId: rfqThread.id,
        accountId,
        externalId: `seed:${SEED_KEY}:${job.reference}:rfq-forward`,
        direction: "INBOUND",
        fromEmail: RFQ_SOURCE_EMAIL,
        fromName: "Derya RFQ Inbox",
        toEmails: JSON.stringify(["ops@usederya.com"]),
        subject,
        bodyText: rawEmailBody,
        sentAt: receivedAt,
        isRead: true,
        classification: "RFQ",
        classificationReason: "Inbound source alias carried a complete freight RFQ for Avlia Home.",
        classificationAt: addHours(-5.9),
      },
      {
        threadId: rfqThread.id,
        accountId,
        externalId: `seed:${SEED_KEY}:${job.reference}:customer-clarification`,
        direction: "OUTBOUND",
        fromEmail: "ops@usederya.com",
        fromName: "Derya Desk",
        toEmails: JSON.stringify([CUSTOMER_EMAIL]),
        subject: `Re: ${subject}`,
        bodyText: [
          "Esat, we have the Giresun to Ancona RFQ in the system.",
          "We are checking Adriatic carrier coverage now and will come back with the best option and validity.",
        ].join("\n"),
        sentAt: addHours(-5.5),
        isRead: true,
        classification: "RELATED_NOTE",
        classificationReason: "Operator acknowledged receipt and started pricing.",
        classificationAt: addHours(-5.5),
      },
      {
        threadId: rfqThread.id,
        accountId,
        externalId: `seed:${SEED_KEY}:${job.reference}:customer-quote`,
        direction: "OUTBOUND",
        fromEmail: "ops@usederya.com",
        fromName: "Derya Desk",
        toEmails: JSON.stringify([CUSTOMER_EMAIL]),
        subject: `Re: ${subject}`,
        bodyText: [
          "Best current option is Arkas Line at USD 5,200 all-in.",
          "Transit is 8 days, ETD is available in four days, and validity runs through 10 Jul.",
          "If approved today, we can place the booking and start document collection.",
        ].join("\n"),
        sentAt: addHours(-4.4),
        isRead: true,
        classification: "RELATED_NOTE",
        classificationReason: "Customer-facing quote sent after forwarder pricing was received.",
        classificationAt: addHours(-4.4),
      },
      {
        threadId: rfqThread.id,
        accountId,
        externalId: `seed:${SEED_KEY}:${job.reference}:customer-approval`,
        direction: "INBOUND",
        fromEmail: CUSTOMER_EMAIL,
        fromName: CONTACT_NAME,
        toEmails: JSON.stringify([RFQ_SOURCE_EMAIL]),
        subject: `Re: ${subject}`,
        bodyText: "Approved. Please book Arkas and send the booking confirmation and document checklist.",
        sentAt: addHours(-3.6),
        isRead: false,
        classification: "CUSTOMER_REPLY",
        classificationReason: "Customer accepted the quoted rate and requested booking.",
        classificationAt: addHours(-3.6),
      },
    ],
  });

  for (const [index, carrier] of carriers.entries()) {
    await prisma.carrierQuote.create({
      data: {
        inquiryId: inquiry.id,
        carrier: carrier.carrier,
        service: carrier.service,
        total40HC: carrier.total40HC,
        transitDays: carrier.transitDays,
        validity: carrier.validity,
        transshipments: carrier.carrier === "Arkas Line" ? "Istanbul" : "Marmara hub",
        status: "RECEIVED",
        createdAt: addHours(-5 + index * 0.35),
      },
    });

    const quoteThread = await prisma.emailThread.create({
      data: {
        officeId,
        jobId: job.id,
        inquiryId: inquiry.id,
        subject: `Rate reply - ${carrier.carrier} Giresun to Ancona`,
        participants: JSON.stringify([carrier.email, RFQ_SOURCE_EMAIL]),
        externalThreadId: `seed:${SEED_KEY}:rate:${carrier.carrier.toLowerCase().replace(/\W+/g, "-")}:${job.reference}`,
        autoLinkedAt: addHours(-4.8 + index * 0.25),
        lastMessageAt: addHours(-4.8 + index * 0.25),
        messageCount: 1,
      },
      select: { id: true },
    });

    await prisma.emailMessage.create({
      data: {
        threadId: quoteThread.id,
        accountId,
        externalId: `seed:${SEED_KEY}:${job.reference}:rate-${index}`,
        direction: "INBOUND",
        fromEmail: carrier.email,
        fromName: carrier.carrier,
        toEmails: JSON.stringify([RFQ_SOURCE_EMAIL]),
        subject: `Re: Giresun to Ancona 1x40HC - ${carrier.carrier}`,
        bodyText: [
          `Carrier: ${carrier.carrier}`,
          `Service: ${carrier.service}`,
          `Buy cost: USD ${carrier.total40HC.toLocaleString()}`,
          `Transit: ${carrier.transitDays} days`,
          carrier.validity,
        ].join("\n"),
        sentAt: addHours(-4.8 + index * 0.25),
        isRead: true,
        classification: "CARRIER_REPLY",
        classificationReason: "Forwarder replied with usable buy cost and transit.",
        classificationAt: addHours(-4.7 + index * 0.25),
      },
    });
  }

  await prisma.jobMilestone.createMany({
    data: [
      { jobId: job.id, type: "BOOKING", plannedAt: addHours(-4), actualAt: addHours(-3.1), note: "Arkas option accepted and booking placed." },
      { jobId: job.id, type: "CARGO_READY", plannedAt: cargoReadyDate, note: "Customer says cargo is ready in two business days." },
      { jobId: job.id, type: "ETD", plannedAt: etd, note: "Booked sailing from Giresun." },
      { jobId: job.id, type: "ETA", plannedAt: eta, note: "Estimated Ancona arrival." },
      { jobId: job.id, type: "CUSTOMS_ENTRY", plannedAt: addDays(14), note: "Prepare entry pack before arrival." },
      { jobId: job.id, type: "CUSTOMS_RELEASE", plannedAt: addDays(15), note: "Release target if documents stay clean." },
      { jobId: job.id, type: "DELIVERY", plannedAt: addDays(16), note: "Final delivery after release." },
    ],
  });

  await prisma.targetPriceHistory.create({
    data: {
      officeId,
      inquiryId: inquiry.id,
      jobId: job.id,
      amount: 5400,
      currency: "USD",
      status: "PROVIDED",
      source: "Forwarded customer RFQ",
      note: "Customer target captured before forwarder pricing; accepted sell rate is USD 5,200.",
      createdAt: receivedAt,
    },
  });

  const baseDocLines = [
    `Derya reference: ${job.reference}`,
    "Customer: Avlia Home",
    "Route: Giresun, Turkey to Ancona, Italy",
    "Cargo: Home textile cartons",
    "Equipment: 1 x 40HC",
    "Gross weight: 24,000 kg",
  ];

  await prisma.jobDocument.createMany({
    data: [
      {
        jobId: job.id,
        officeId,
        name: `Booking_Confirmation_${job.reference}.pdf`,
        docType: "BOOKING",
        status: "APPROVED",
        url: makePdfDataUrl("Booking Confirmation", [
          ...baseDocLines,
          "Carrier: Arkas Line",
          `ETD: ${etd.toISOString().slice(0, 10)}`,
          `ETA: ${eta.toISOString().slice(0, 10)}`,
          "Booking status: Confirmed",
        ]),
        aiSummary: "Booking confirmation matches the quoted Arkas option, 1x40HC, Giresun to Ancona.",
        aiFlags: JSON.stringify([]),
        aiKeyFields: JSON.stringify({ carrier: "Arkas Line", equipment: "1x40HC", etd: etd.toISOString().slice(0, 10), eta: eta.toISOString().slice(0, 10) }),
        aiAnalyzedAt: addHours(-2.7),
      },
      {
        jobId: job.id,
        officeId,
        name: `Commercial_Invoice_${job.reference}.pdf`,
        docType: "INVOICE",
        status: "APPROVED",
        url: makePdfDataUrl("Commercial Invoice", [
          ...baseDocLines,
          "Invoice value: USD 42,800",
          "Incoterms: FOB Giresun",
          "Consignee: Avlia Home Italy receiving partner",
        ]),
        aiSummary: "Commercial invoice is consistent with the RFQ commodity, FOB terms, and customer record.",
        aiFlags: JSON.stringify([]),
        aiKeyFields: JSON.stringify({ invoiceValue: "USD 42,800", incoterms: "FOB", commodity: "Home textile cartons" }),
        aiAnalyzedAt: addHours(-2.5),
      },
      {
        jobId: job.id,
        officeId,
        name: `Packing_List_${job.reference}.pdf`,
        docType: "PACKING_LIST",
        status: "APPROVED",
        url: makePdfDataUrl("Packing List", [
          ...baseDocLines,
          "Cartons: 960",
          "Volume: 68 CBM",
          "Stackable: yes",
          "Dangerous goods: no",
        ]),
        aiSummary: "Packing list confirms 960 cartons, 68 CBM, 24,000 kg, non-DG cargo.",
        aiFlags: JSON.stringify([]),
        aiKeyFields: JSON.stringify({ packages: 960, volumeCbm: 68, weightKg: 24000, dangerousGoods: "NO" }),
        aiAnalyzedAt: addHours(-2.4),
      },
      {
        jobId: job.id,
        officeId,
        name: `Draft_BL_${job.reference}.pdf`,
        docType: "BL",
        status: "UPLOADED",
        url: makePdfDataUrl("Draft Bill of Lading", [
          ...baseDocLines,
          "Carrier: Arkas Line",
          "Port of loading: Giresun",
          "Port of discharge: Ancona",
          "Draft status: awaiting final carrier stamp",
        ]),
        aiSummary: "Draft BL route and cargo fields match the booking; final carrier-stamped copy is still pending.",
        aiFlags: JSON.stringify(["Final carrier-stamped BL copy pending."]),
        aiKeyFields: JSON.stringify({ pol: "Giresun", pod: "Ancona", carrier: "Arkas Line", status: "draft" }),
        aiAnalyzedAt: addHours(-2.2),
      },
      {
        jobId: job.id,
        officeId,
        name: `Certificate_of_Origin_${job.reference}.pdf`,
        docType: "COO",
        status: "APPROVED",
        url: makePdfDataUrl("Certificate of Origin", [
          ...baseDocLines,
          "Country of origin: Turkey",
          "Issuer: Giresun Chamber of Commerce",
        ]),
        aiSummary: "Certificate of origin identifies Turkey and matches the exporter route.",
        aiFlags: JSON.stringify([]),
        aiKeyFields: JSON.stringify({ countryOfOrigin: "Turkey", issuer: "Giresun Chamber of Commerce" }),
        aiAnalyzedAt: addHours(-2.1),
      },
      {
        jobId: job.id,
        officeId,
        name: `Customs_Instructions_${job.reference}.pdf`,
        docType: "CUSTOMS",
        status: "UPLOADED",
        url: makePdfDataUrl("Customs Instructions", [
          ...baseDocLines,
          "HS family: home textile goods",
          "Customs owner: Derya coordination",
          "Entry pack: invoice, packing list, COO, draft BL",
        ]),
        aiSummary: "Customs instruction pack is present; entry can be prepared once final BL is released.",
        aiFlags: JSON.stringify(["Confirm final HS code before customs entry."]),
        aiKeyFields: JSON.stringify({ customsBy: "US", hsFamily: "home textile goods", missing: ["final HS code", "final BL"] }),
        aiAnalyzedAt: addHours(-1.9),
      },
    ],
  });

  return { job, inquiryId: inquiry.id, threadId: rfqThread.id, accountId };
}

export async function runGiresunWorkflowSeed(options: {
  apply: boolean;
  reset?: boolean;
  createSeedInbox?: boolean;
  officeId?: string;
}) {
  const apply = options.apply;
  const reset = Boolean(options.reset);
  const createSeedInbox = Boolean(options.createSeedInbox);
  const office = options.officeId ? await getOfficeById(options.officeId) : await getOffice();
  const existing = await existingSeededLoad(office.id);

  if (!apply) {
    return {
      mode: "dry-run",
      office,
      existing,
      wouldCreate: !existing || reset,
      reset,
      createSeedInbox,
      customer: COMPANY_NAME,
      route: "Giresun, Turkey -> Ancona, Italy",
      status: "BOOKED",
      documents: ["BOOKING", "INVOICE", "PACKING_LIST", "BL", "COO", "CUSTOMS"],
      quoteTotal: quoteTotal(),
      buyCost: carriers[0].total40HC,
    };
  }

  if (existing && !reset) {
    return {
      ok: true,
      skipped: true,
      reason: "Seeded Giresun workflow load already exists. Use --reset to replace it.",
      job: existing,
      urls: {
        job: `/dashboard/jobs/${existing.id}`,
        inboxThreads: `/dashboard/inbox?job=${existing.id}`,
        todayRfqs: "/dashboard/inbox?filter=_TODAY&view=rfqs",
      },
    };
  }

  const removed = reset ? await removeExistingSeededLoad(office.id) : { jobs: [], threads: 0, inquiries: 0 };
  const account = await seedSourceAccount(office.id, createSeedInbox);
  const seeded = await seedWorkflowLoad(office.id, account?.id ?? null);

  return {
    ok: true,
    office,
    removed,
    sourceAccount: account,
    job: seeded.job,
    inquiryId: seeded.inquiryId,
    threadId: seeded.threadId,
    urls: {
      job: `/dashboard/jobs/${seeded.job.id}`,
      inboxThreads: `/dashboard/inbox?job=${seeded.job.id}`,
      todayRfqs: "/dashboard/inbox?filter=_TODAY&view=rfqs",
    },
  };
}

async function main() {
  const result = await runGiresunWorkflowSeed({
    apply: process.argv.includes("--apply"),
    reset: process.argv.includes("--reset"),
    createSeedInbox: process.argv.includes("--create-seed-inbox"),
  });
  console.log(JSON.stringify(result, null, 2));
  if ("mode" in result && result.mode === "dry-run") {
    console.log("Run with --apply to write. Add --reset to replace the existing seeded copy.");
  }
}

if (process.argv[1]?.endsWith("seed-giresun-workflow-load.ts") || process.argv[1]?.endsWith("seed-giresun-workflow-load.js")) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
