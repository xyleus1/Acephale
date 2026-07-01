import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;
const VIDEO_MARKER = "[VIDEO_DEMO_LOAD]";
const DEMO_INBOX = "demo-inbox@usederya.com";

type VideoLoadSeed = {
  companyName: string;
  company: {
    product: string;
    lane: string;
    direction: string;
  };
  subject: string;
  title: string;
  fromEmail: string;
  fromName: string;
  fromCompany: string;
  status: "INQUIRY" | "BOOKED";
  mode: string;
  origin: string;
  destination: string;
  commodity: string;
  incoterms: string;
  containerCount: number;
  containerType: string;
  weight: number;
  volume: number;
  packages: number;
  targetPrice: number;
  revenue: number | null;
  cost: number | null;
  etdOffsetDays: number;
  etaOffsetDays: number;
  quotes: Array<{
    carrier: string;
    service: string;
    total40HC?: number;
    total40?: number;
    total20?: number;
    transitDays: number;
    status: "PENDING" | "RECEIVED";
  }>;
  emailBody: string;
};

const loads: VideoLoadSeed[] = [
  {
    companyName: "DEMO · Port Klang Plastics",
    company: { product: "Sea", lane: "Asia to Turkiye", direction: "Import" },
    subject: "DEMO · RFQ Port Klang resin pallets to Istanbul",
    title: "Port Klang resin pallets",
    fromEmail: "ops@portklangplastics.example",
    fromName: "Aisha Rahman",
    fromCompany: "Port Klang Plastics",
    status: "INQUIRY",
    mode: "SEA-FCL",
    origin: "Port Klang, MY",
    destination: "Istanbul, TR",
    commodity: "Plastic resin pallets",
    incoterms: "FOB",
    containerCount: 1,
    containerType: "40HC",
    weight: 18500,
    volume: 67,
    packages: 24,
    targetPrice: 6400,
    revenue: null,
    cost: null,
    etdOffsetDays: 7,
    etaOffsetDays: 31,
    quotes: [
      { carrier: "MSC", service: "Port Klang to Istanbul via Singapore", total40HC: 5150, transitDays: 24, status: "RECEIVED" },
      { carrier: "CMA CGM", service: "Asia Med Turkey", total40HC: 5380, transitDays: 27, status: "RECEIVED" },
      { carrier: "Maersk", service: "AE to Turkiye", total40HC: 5520, transitDays: 26, status: "PENDING" },
    ],
    emailBody: [
      "Hi Derya team,",
      "",
      "Can you quote 1x40HC from Port Klang to Istanbul for plastic resin pallets?",
      "Cargo is ready next week, FOB Port Klang. Gross weight around 18.5 tons.",
      "Target is USD 6,400 all-in if possible. Please include transit time and validity.",
      "",
      "Thanks,",
      "Aisha",
    ].join("\n"),
  },
  {
    companyName: "DEMO · Shanghai Machine Works",
    company: { product: "Sea", lane: "China to Turkiye", direction: "Import" },
    subject: "DEMO · RFQ Shanghai CNC parts to Mersin",
    title: "Shanghai CNC spare parts",
    fromEmail: "export@shanghaimachineworks.example",
    fromName: "Li Wei",
    fromCompany: "Shanghai Machine Works",
    status: "BOOKED",
    mode: "SEA-FCL",
    origin: "Shanghai, CN",
    destination: "Mersin, TR",
    commodity: "CNC machine spare parts",
    incoterms: "EXW",
    containerCount: 1,
    containerType: "20GP",
    weight: 7200,
    volume: 24,
    packages: 18,
    targetPrice: 4800,
    revenue: 5350,
    cost: 3920,
    etdOffsetDays: 5,
    etaOffsetDays: 35,
    quotes: [
      { carrier: "COSCO", service: "Shanghai to Mersin direct string", total20: 3920, transitDays: 26, status: "RECEIVED" },
      { carrier: "ONE", service: "China Med via Piraeus", total20: 4140, transitDays: 29, status: "RECEIVED" },
      { carrier: "Hapag-Lloyd", service: "Far East Turkey", total20: 4310, transitDays: 31, status: "RECEIVED" },
    ],
    emailBody: [
      "Hello Derya,",
      "",
      "Please arrange the same Mersin lane as our last order: 1x20GP CNC spare parts from Shanghai.",
      "EXW pickup. Cargo is packed in 18 crates, 7.2 tons, about 24 cbm.",
      "We need a booking this week and target is USD 4,800.",
      "",
      "Regards,",
      "Li Wei",
    ].join("\n"),
  },
];

function addDays(days: number) {
  return new Date(Date.now() + days * DAY_MS);
}

function makeDemoPdfDataUrl(title: string, lines: string[]) {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c);
  let content = `BT\n/F1 16 Tf\n72 760 Td\n(${escape(title)}) Tj\nET\n`;
  let y = 720;
  for (const line of lines) {
    content += `BT\n/F1 11 Tf\n72 ${y} Td\n(${escape(line)}) Tj\nET\n`;
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
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return `data:application/pdf;base64,${Buffer.from(pdf, "latin1").toString("base64")}`;
}

async function nextDemoJobReference(officeId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `JOB-${year}-`;
  const existing = await prisma.job.findMany({
    where: { officeId, reference: { startsWith: prefix } },
    select: { reference: true },
  });
  let max = 0;
  for (const job of existing) {
    const n = parseInt(job.reference.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

async function getOffice() {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { officeId: true, office: { select: { name: true } } },
  });
  if (admin) return { id: admin.officeId, name: admin.office.name };
  const office = await prisma.office.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!office) throw new Error("No office exists. Seed or create an office first.");
  return office;
}

async function cleanupDemoData(officeId: string, apply: boolean) {
  const demoJobs = await prisma.job.findMany({
    where: {
      officeId,
      OR: [
        { reference: { startsWith: "DEMO-" } },
        { notes: { contains: "[DEMO_LOAD_SEED]" } },
        { notes: { contains: "[DEMO_MAP_LOAD]" } },
        { notes: { contains: VIDEO_MARKER } },
        { company: { name: { startsWith: "DEMO ·" } } },
        { inquiry: { subject: { startsWith: "DEMO" } } },
      ],
    },
    select: { id: true, reference: true, inquiryId: true },
  });
  const demoInquiries = await prisma.inquiry.findMany({
    where: {
      officeId,
      OR: [
        { subject: { startsWith: "DEMO" } },
        { rawEmailBody: { contains: VIDEO_MARKER } },
        { notes: { contains: VIDEO_MARKER } },
        { company: { name: { startsWith: "DEMO ·" } } },
      ],
    },
    select: { id: true },
  });
  const inquiryIds = new Set<string>([
    ...demoJobs.map((job) => job.inquiryId).filter((id): id is string => !!id),
    ...demoInquiries.map((inquiry) => inquiry.id),
  ]);
  const demoThreads = await prisma.emailThread.findMany({
    where: {
      officeId,
      OR: [
        { externalThreadId: { startsWith: "demo:" } },
        { subject: { startsWith: "DEMO" } },
        { jobId: { in: demoJobs.map((job) => job.id) } },
        { inquiryId: { in: [...inquiryIds] } },
      ],
    },
    select: { id: true },
  });

  const summary = {
    jobs: demoJobs.length,
    inquiries: inquiryIds.size,
    threads: demoThreads.length,
    references: demoJobs.map((job) => job.reference),
  };
  if (!apply) return summary;

  await prisma.emailThread.deleteMany({ where: { id: { in: demoThreads.map((thread) => thread.id) } } });
  await prisma.job.deleteMany({ where: { id: { in: demoJobs.map((job) => job.id) } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: [...inquiryIds] } } });

  const demoCompanies = await prisma.company.findMany({
    where: { officeId, name: { startsWith: "DEMO ·" } },
    select: { id: true },
  });
  let companiesDeleted = 0;
  for (const company of demoCompanies) {
    const counts = await prisma.company.findUnique({
      where: { id: company.id },
      select: { _count: { select: { jobs: true, inquiries: true, shipments: true } } },
    });
    if (!counts || counts._count.jobs || counts._count.inquiries || counts._count.shipments) continue;
    await prisma.company.delete({ where: { id: company.id } });
    companiesDeleted++;
  }
  return { ...summary, companiesDeleted };
}

async function ensureDemoInbox(officeId: string) {
  return prisma.emailAccount.upsert({
    where: { officeId_email: { officeId, email: DEMO_INBOX } },
    create: { officeId, email: DEMO_INBOX, provider: "GMAIL", isActive: true },
    update: { provider: "GMAIL", isActive: true },
    select: { id: true, email: true },
  });
}

async function seedLoad(officeId: string, accountId: string, load: VideoLoadSeed) {
  const company = await prisma.company.upsert({
    where: { officeId_name: { officeId, name: load.companyName } },
    create: {
      officeId,
      name: load.companyName,
      status: "WORKED",
      class1: "Active",
      class2: "A",
      product: load.company.product,
      lane: load.company.lane,
      direction: load.company.direction,
    },
    update: {
      status: "WORKED",
      class1: "Active",
      class2: "A",
      product: load.company.product,
      lane: load.company.lane,
      direction: load.company.direction,
    },
    select: { id: true },
  });
  await prisma.contact.upsert({
    where: { id: `${company.id}:demo-contact` },
    create: {
      id: `${company.id}:demo-contact`,
      companyId: company.id,
      fullName: load.fromName,
      email: load.fromEmail,
      title: "Operations",
      isApprovedForInbox: true,
      approvedForInboxAt: new Date(),
    },
    update: {
      fullName: load.fromName,
      email: load.fromEmail,
      title: "Operations",
      isApprovedForInbox: true,
      approvedForInboxAt: new Date(),
    },
  });

  const inquiry = await prisma.inquiry.create({
    data: {
      officeId,
      companyId: company.id,
      subject: load.subject,
      fromEmail: load.fromEmail,
      fromCompany: load.fromCompany,
      origin: load.origin,
      destination: load.destination,
      mode: load.mode,
      containerCount: load.containerCount,
      containerType: load.containerType,
      packages: load.packages,
      stackable: "YES",
      topLoad: "NO",
      dangerousGoods: "NO",
      customsBy: "US",
      commodity: load.commodity,
      weight: load.weight,
      volume: load.volume,
      incoterms: load.incoterms,
      targetPrice: load.targetPrice,
      targetCurrency: "USD",
      targetPriceStatus: "PROVIDED",
      targetPriceSource: "Customer RFQ email in video demo inbox",
      cargoReadyDate: addDays(load.etdOffsetDays - 2),
      type: "FORWARDING",
      status: load.status === "INQUIRY" ? "PARSED" : "QUOTED",
      rawEmailBody: `${VIDEO_MARKER}\n${load.emailBody}`,
      parsedData: JSON.stringify({ source: "video-demo", marker: VIDEO_MARKER }),
      notes: `${VIDEO_MARKER} Video demo RFQ. Fully seeded for inbox walkthrough.`,
      receivedAt: addDays(-1),
    },
  });

  const reference = await nextDemoJobReference(officeId);
  const etd = addDays(load.etdOffsetDays);
  const eta = addDays(load.etaOffsetDays);
  const job = await prisma.job.create({
    data: {
      officeId,
      companyId: company.id,
      inquiryId: inquiry.id,
      reference,
      title: load.title,
      cadence: "ONE_OFF",
      status: load.status,
      type: "FORWARDING",
      mode: load.mode,
      origin: load.origin,
      destination: load.destination,
      commodity: load.commodity,
      incoterms: load.incoterms,
      weight: load.weight,
      volume: load.volume,
      packages: load.packages,
      stackable: "YES",
      topLoad: "NO",
      dangerousGoods: "NO",
      customsBy: "US",
      containerCount: load.containerCount,
      containerType: load.containerType,
      targetPrice: load.targetPrice,
      targetCurrency: "USD",
      targetPriceStatus: "PROVIDED",
      targetPriceSource: "Customer RFQ email in video demo inbox",
      etd,
      eta,
      revenue: load.revenue,
      cost: load.cost,
      currency: "USD",
      notifyCustomer: false,
      customerEmail: load.fromEmail,
      notes: `${VIDEO_MARKER} Seeded for video inbox walkthrough.`,
    },
    select: { id: true, reference: true },
  });

  const thread = await prisma.emailThread.create({
    data: {
      officeId,
      jobId: job.id,
      inquiryId: inquiry.id,
      subject: load.subject,
      participants: JSON.stringify([load.fromEmail, DEMO_INBOX]),
      externalThreadId: `demo:video:${job.reference}:rfq`,
      autoLinkedAt: new Date(),
      lastMessageAt: addDays(-1),
      messageCount: load.status === "BOOKED" ? 3 : 1,
    },
    select: { id: true },
  });
  await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      accountId,
      externalId: `demo:video:${job.reference}:customer-rfq`,
      direction: "INBOUND",
      fromEmail: load.fromEmail,
      fromName: load.fromName,
      toEmails: JSON.stringify([DEMO_INBOX]),
      subject: load.subject,
      bodyText: load.emailBody,
      sentAt: addDays(-1),
      isRead: false,
      classification: "RFQ",
      classificationReason: "Video demo customer RFQ seeded for inbox walkthrough.",
      classificationAt: new Date(),
    },
  });
  if (load.status === "BOOKED") {
    await prisma.emailMessage.createMany({
      data: [
        {
          threadId: thread.id,
          accountId,
          externalId: `demo:video:${job.reference}:operator-reply`,
          direction: "OUTBOUND",
          fromEmail: DEMO_INBOX,
          fromName: "Derya Desk",
          toEmails: JSON.stringify([load.fromEmail]),
          subject: `Re: ${load.subject}`,
          bodyText: "Thanks, we have rates back and will proceed with COSCO unless you prefer another option.",
          sentAt: addDays(-0.8),
          isRead: true,
          classification: "RELATED_NOTE",
          classificationReason: "Seeded outbound reply for booked demo load.",
          classificationAt: new Date(),
        },
        {
          threadId: thread.id,
          accountId,
          externalId: `demo:video:${job.reference}:customer-approval`,
          direction: "INBOUND",
          fromEmail: load.fromEmail,
          fromName: load.fromName,
          toEmails: JSON.stringify([DEMO_INBOX]),
          subject: `Re: ${load.subject}`,
          bodyText: "Approved, please book the COSCO option and keep us updated on ETD.",
          sentAt: addDays(-0.5),
          isRead: false,
          classification: "CUSTOMER_REPLY",
          classificationReason: "Customer accepted the quote; load is booked.",
          classificationAt: new Date(),
        },
      ],
    });
  }

  await prisma.carrierQuote.createMany({
    data: load.quotes.map((quote) => ({
      inquiryId: inquiry.id,
      carrier: quote.carrier,
      service: quote.service,
      total20: quote.total20 ?? null,
      total40: quote.total40 ?? null,
      total40HC: quote.total40HC ?? null,
      transitDays: quote.transitDays,
      validity: "14 days",
      status: quote.status,
    })),
  });

  await prisma.jobMilestone.createMany({
    data: [
      { jobId: job.id, type: "BOOKING", plannedAt: addDays(load.etdOffsetDays - 4), actualAt: load.status === "BOOKED" ? addDays(-0.4) : null },
      { jobId: job.id, type: "CARGO_READY", plannedAt: addDays(load.etdOffsetDays - 2) },
      { jobId: job.id, type: "ETD", plannedAt: etd },
      { jobId: job.id, type: "ETA", plannedAt: eta },
      { jobId: job.id, type: "CUSTOMS_ENTRY", plannedAt: addDays(load.etaOffsetDays + 1) },
      { jobId: job.id, type: "CUSTOMS_RELEASE", plannedAt: addDays(load.etaOffsetDays + 2) },
      { jobId: job.id, type: "DELIVERY", plannedAt: addDays(load.etaOffsetDays + 3) },
    ],
  });

  await prisma.targetPriceHistory.create({
    data: {
      officeId,
      inquiryId: inquiry.id,
      jobId: job.id,
      amount: load.targetPrice,
      currency: "USD",
      status: "PROVIDED",
      source: "Video demo RFQ email",
      note: `Customer target for ${load.origin} to ${load.destination}.`,
    },
  });

  const bookingUrl = makeDemoPdfDataUrl(`Booking ${job.reference}`, [
    `Reference: ${job.reference}`,
    `Carrier: ${load.quotes[0].carrier}`,
    `Route: ${load.origin} to ${load.destination}`,
    `Container: ${load.containerCount}x${load.containerType}`,
    `ETD: ${etd.toISOString().slice(0, 10)}`,
    `ETA: ${eta.toISOString().slice(0, 10)}`,
  ]);
  await prisma.jobDocument.createMany({
    data: [
      {
        jobId: job.id,
        officeId,
        name: `Booking_${job.reference}.pdf`,
        docType: "BOOKING",
        status: load.status === "BOOKED" ? "APPROVED" : "UPLOADED",
        url: bookingUrl,
        aiSummary: `Booking document for ${load.origin} to ${load.destination}.`,
        aiFlags: JSON.stringify([]),
        aiKeyFields: JSON.stringify({ reference: job.reference, carrier: load.quotes[0].carrier, container: `${load.containerCount}x${load.containerType}` }),
        aiAnalyzedAt: new Date(),
      },
      {
        jobId: job.id,
        officeId,
        name: `Commercial_Invoice_${job.reference}.pdf`,
        docType: "INVOICE",
        status: "PENDING",
      },
      {
        jobId: job.id,
        officeId,
        name: `Packing_List_${job.reference}.pdf`,
        docType: "PACKING_LIST",
        status: "PENDING",
      },
      {
        jobId: job.id,
        officeId,
        name: `Customs_${job.reference}.pdf`,
        docType: "CUSTOMS",
        status: "PENDING",
      },
    ],
  });

  return { job, inquiryId: inquiry.id, threadId: thread.id };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const office = await getOffice();
  const cleanup = await cleanupDemoData(office.id, apply);
  if (!apply) {
    console.log(`Dry run for ${office.name}`);
    console.log(JSON.stringify(cleanup, null, 2));
    console.log("Run with --apply to delete demo data and seed the two video loads.");
    return;
  }

  const account = await ensureDemoInbox(office.id);
  const seeded = [];
  for (const load of loads) {
    seeded.push(await seedLoad(office.id, account.id, load));
  }

  console.log(`Reset demo data in ${office.name}`);
  console.log(`Deleted demo jobs: ${cleanup.jobs}; demo inquiries: ${cleanup.inquiries}; demo threads: ${cleanup.threads}`);
  for (const item of seeded) {
    console.log(`Seeded ${item.job.reference}: job=${item.job.id} inquiry=${item.inquiryId} thread=${item.threadId}`);
  }
  console.log(`Open /dashboard/inbox?filter=_DEMO to show the video demo inbox.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
