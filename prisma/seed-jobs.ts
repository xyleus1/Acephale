import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RFQ_EMAILS = [
  {
    subject: "FCL Rate Request – Shanghai to Hamburg",
    fromEmail: "logistics@techprime.de",
    fromCompany: "TechPrime GmbH",
    origin: "Shanghai, CN", destination: "Hamburg, DE",
    mode: "SEA-FCL", containerType: "40HC", commodity: "Electronics",
    weight: 18500, volume: 67, incoterms: "FOB",
    status: "INGESTED",
    rawEmailBody: `Dear Team,

We have an urgent FCL shipment we need rates for. Details below:

Origin: Shanghai, China (port: CNSHA)
Destination: Hamburg, Germany (port: DEHAM)
Cargo: Consumer electronics (laptops, tablets)
Volume: 2 x 40HC containers
Weight: approx. 18,500 kg total
Incoterms: FOB Shanghai
Cargo ready: within 2 weeks
Commodity value: USD 2.4M (we will need cargo insurance quote separately)

Please confirm if you can handle this and send your best all-in rates.
Transit time expectations: under 32 days preferred.

Best regards,
Klaus Fischer
TechPrime GmbH`,
  },
  {
    subject: "LCL Shipment – Istanbul to New York",
    fromEmail: "purchasing@denimco.com",
    fromCompany: "Denim Co. USA",
    origin: "Istanbul, TR", destination: "New York, US",
    mode: "SEA-LCL", containerType: "LCL", commodity: "Textiles",
    weight: 4200, volume: 22, incoterms: "CIF",
    status: "INGESTED",
    rawEmailBody: `Hi,

Looking for an LCL rate from Istanbul to New York for a textile shipment.

CBM: approximately 22 cbm
Weight: 4,200 kg
Cargo: Denim fabric rolls, not hazardous
Delivery: door-to-door preferred (CIF NYC port is also ok)
Ready date: 10 days from today

Can you also confirm customs clearance service at destination?

Thanks,
Maria Santos
Purchasing – Denim Co.`,
  },
  {
    subject: "Air Freight Urgent – Automotive Parts to Detroit",
    fromEmail: "supply@autopart.tr",
    fromCompany: "AutoPart TR",
    origin: "Bursa, TR", destination: "Detroit, US",
    mode: "AIR", containerType: null, commodity: "Automotive Parts",
    weight: 850, volume: 4.2, incoterms: "DAP",
    status: "PARSED",
    rawEmailBody: `URGENT – Production line stoppage risk

We need to ship replacement automotive parts from our factory in Bursa to our client in Detroit ASAP.

Weight: 850 kg
Dims: 4 pallets, approx 1.2 x 0.8 x 1.1m each
Airport of departure: IST or SAW
Airport of arrival: DTW
Incoterms: DAP Detroit
Commodity: Engine components (HS 8409)

Need departure no later than Thursday. Please quote and confirm availability IMMEDIATELY.

Erhan Güneş
Supply Chain Manager`,
  },
  {
    subject: "FCL Quote – Rotterdam to Mersin",
    fromEmail: "import@atlanticmachinery.nl",
    fromCompany: "Atlantic Machinery BV",
    origin: "Rotterdam, NL", destination: "Mersin, TR",
    mode: "SEA-FCL", containerType: "40HC", commodity: "Industrial Machinery",
    weight: 24000, volume: 68, incoterms: "CIF",
    status: "PARSED",
    rawEmailBody: `Good morning,

We are importing industrial machinery from our Dutch supplier. We need a CIF rate to Mersin port.

Cargo: Industrial printing press (2 units, crated)
Container: 1 x 40HC (OOG possible if needed)
Weight: 24,000 kg
CBM: ~68 cbm
Departure: Rotterdam (NLRTM)
Arrival: Mersin (TRMER)
Incoterms: CIF Mersin

Do you handle oversized cargo? What is the transit time?

Best,
Jan van der Berg`,
  },
  {
    subject: "RFQ – Guangzhou to Istanbul, Consumer Goods",
    fromEmail: "trade@silkroute.hk",
    fromCompany: "Silk Route Trading HK",
    origin: "Guangzhou, CN", destination: "Istanbul, TR",
    mode: "SEA-FCL", containerType: "40HC", commodity: "Consumer Goods",
    weight: 21000, volume: 66, incoterms: "FOB",
    status: "PRICED",
    rawEmailBody: `Hi Derya team,

Please provide an FCL rate for the below:

Shipper: Our factory in Guangzhou (CNCAN)
Consignee: Istanbul warehouse (TRIST)
Goods: Mixed consumer goods (plastic household items, HS 3924)
Containers: 2 x 40HC
Incoterms: FOB Guangzhou
Ready: 15 days
No hazmat, no temp control required

Please include THC both ends, B/L fee, and any local charges.

Looking forward to your competitive rates.

Rachel Chen`,
  },
  {
    subject: "Urgent – Road Freight TIR to Germany",
    fromEmail: "ops@kargom.tr",
    fromCompany: "Kargom Lojistik",
    origin: "Istanbul, TR", destination: "Munich, DE",
    mode: "ROAD", containerType: null, commodity: "Machine Parts",
    weight: 12000, volume: 45, incoterms: "DAP",
    status: "PRICED",
    rawEmailBody: `Merhaba,

We need a TIR truck from Istanbul to Munich.

Cargo: Steel machine parts (not oversized)
Weight: 12,000 kg
Loading: Istanbul Tuzla factory
Delivery: Munich warehouse
Incoterms: DAP Munich
Date: Flexible, this week if possible

Do you have your own trucks or do you use partners?

Teşekkürler,
Sercan Boz`,
  },
  {
    subject: "FCL Booking – Felixstowe to Izmir",
    fromEmail: "shipping@ukwholesale.co.uk",
    fromCompany: "UK Wholesale Ltd",
    origin: "Felixstowe, GB", destination: "Izmir, TR",
    mode: "SEA-FCL", containerType: "20GP", commodity: "Retail Goods",
    weight: 16000, volume: 28, incoterms: "EXW",
    status: "QUOTED",
    rawEmailBody: `Hi,

Following our call last week – please find below the confirmed booking details.

Cargo: Mixed retail goods (clothing, accessories)
Container: 1 x 20GP
Weight: 16,000 kg
Origin: Felixstowe, UK
Destination: Izmir, Turkey
Incoterms: EXW UK warehouse
We accept your quoted rate of USD 1,450 all-in.

Please send the booking confirmation when ready.

David Hughes`,
  },
];

const JOBS_DATA = [
  {
    reference: "JOB-2025-001",
    status: "DELIVERED",
    mode: "SEA-FCL",
    origin: "Shanghai, CN", destination: "Hamburg, DE",
    commodity: "Electronics", incoterms: "FOB",
    weight: 18500, volume: 67,
    revenue: 4200, cost: 2800, currency: "USD",
    etdDaysAgo: 42, etaDaysAgo: 10,
    notes: "Delivered without issues. Customer very satisfied.",
  },
  {
    reference: "JOB-2025-002",
    status: "IN_TRANSIT",
    mode: "SEA-FCL",
    origin: "Guangzhou, CN", destination: "Mersin, TR",
    commodity: "Consumer Goods", incoterms: "FOB",
    weight: 21000, volume: 66,
    revenue: 5100, cost: 3400, currency: "USD",
    etdDaysAgo: 12, etaFromNow: 18,
    notes: "On board MSC ANNA – vessel on schedule.",
  },
  {
    reference: "JOB-2025-003",
    status: "CUSTOMS",
    mode: "AIR",
    origin: "Istanbul, TR", destination: "Detroit, US",
    commodity: "Automotive Parts", incoterms: "DAP",
    weight: 850, volume: 4.2,
    revenue: 3800, cost: 2600, currency: "USD",
    etdDaysAgo: 5, etaFromNow: 1,
    notes: "Arrived DTW – awaiting customs clearance. ISF filed.",
  },
  {
    reference: "JOB-2025-004",
    status: "BOOKED",
    mode: "SEA-FCL",
    origin: "Felixstowe, GB", destination: "Izmir, TR",
    commodity: "Retail Goods", incoterms: "EXW",
    weight: 16000, volume: 28,
    revenue: 1950, cost: 1320, currency: "USD",
    etdFromNow: 8, etaFromNow: 28,
    notes: "Booked on Maersk AURORA. BL draft to be approved.",
  },
  {
    reference: "JOB-2025-005",
    status: "QUOTED",
    mode: "SEA-LCL",
    origin: "Istanbul, TR", destination: "New York, US",
    commodity: "Textiles", incoterms: "CIF",
    weight: 4200, volume: 22,
    revenue: 2400, cost: null, currency: "USD",
    etdFromNow: 14, etaFromNow: 42,
    notes: "Quote sent to customer 2 days ago. Following up.",
  },
  {
    reference: "JOB-2025-006",
    status: "INQUIRY",
    mode: "ROAD",
    origin: "Istanbul, TR", destination: "Munich, DE",
    commodity: "Machine Parts", incoterms: "DAP",
    weight: 12000, volume: 45,
    revenue: null, cost: null, currency: "USD",
    etdFromNow: 5, etaFromNow: 10,
    notes: "TIR request — need to check truck availability with partner.",
  },
  {
    reference: "JOB-2025-007",
    status: "BOOKED",
    mode: "SEA-FCL",
    origin: "Rotterdam, NL", destination: "Mersin, TR",
    commodity: "Industrial Machinery", incoterms: "CIF",
    weight: 24000, volume: 68,
    revenue: 3600, cost: 2450, currency: "USD",
    etdFromNow: 12, etaFromNow: 30,
    notes: "Heavy lift confirmed. Pre-sling required at origin.",
  },
  {
    reference: "JOB-2025-008",
    status: "IN_TRANSIT",
    mode: "SEA-FCL",
    origin: "Izmir, TR", destination: "Jeddah, SA",
    commodity: "Ceramics", incoterms: "CFR",
    weight: 19000, volume: 52,
    revenue: 2900, cost: 1950, currency: "USD",
    etdDaysAgo: 8, etaFromNow: 6,
    notes: "ETA Jeddah confirmed. Customs agent notified.",
  },
];

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function daysAgo(n: number) {
  return daysFromNow(-n);
}

async function main() {
  const office = await prisma.office.findFirst();
  if (!office) { console.error("No office found — run the main seed first."); process.exit(1); }

  const companies = await prisma.company.findMany({
    where: { officeId: office.id },
    take: 20,
    orderBy: { createdAt: "asc" },
  });
  if (companies.length === 0) { console.error("No companies found — run the main seed first."); process.exit(1); }

  const user = await prisma.user.findFirst({ where: { officeId: office.id, role: "SALES" } });

  // ── Clean previous seed-jobs data ───────────────────────────────────────
  console.log("Cleaning previous job seed data…");
  await prisma.jobMilestone.deleteMany({ where: { job: { officeId: office.id } } });
  await prisma.jobDocument.deleteMany({ where: { officeId: office.id } });
  await prisma.carrierQuote.deleteMany({ where: { inquiry: { officeId: office.id } } });
  await prisma.job.deleteMany({ where: { officeId: office.id } });
  await prisma.inquiry.deleteMany({ where: { officeId: office.id } });

  // ── Seed RFQs ────────────────────────────────────────────────────────────
  console.log("Seeding RFQs…");
  const inquiries: Array<{ id: string; status: string }> = [];
  for (const [i, rfq] of RFQ_EMAILS.entries()) {
    const company = companies[i % companies.length];
    const inq = await prisma.inquiry.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        subject: rfq.subject,
        fromEmail: rfq.fromEmail,
        fromCompany: rfq.fromCompany,
        origin: rfq.origin,
        destination: rfq.destination,
        mode: rfq.mode,
        containerType: rfq.containerType ?? undefined,
        commodity: rfq.commodity,
        weight: rfq.weight,
        volume: rfq.volume,
        incoterms: rfq.incoterms,
        status: rfq.status,
        rawEmailBody: rfq.rawEmailBody,
        receivedAt: daysAgo(Math.floor(Math.random() * 5) + 1),
      },
    });
    inquiries.push({ id: inq.id, status: rfq.status });

    // Add carrier quotes to PRICED ones
    if (rfq.status === "PRICED") {
      await prisma.carrierQuote.createMany({
        data: [
          {
            inquiryId: inq.id, carrier: "Maersk", service: "AE-1",
            total20: 980, total40: 1600, total40HC: 1750,
            transitDays: 28, validity: "2025-06-30", status: "RECEIVED",
          },
          {
            inquiryId: inq.id, carrier: "MSC", service: "SHOGUN",
            total20: 920, total40: 1520, total40HC: 1680,
            transitDays: 31, validity: "2025-06-30", status: "RECEIVED",
          },
          {
            inquiryId: inq.id, carrier: "CMA CGM", service: "FAL1",
            total20: 1050, total40: 1700, total40HC: 1820,
            transitDays: 26, validity: "2025-07-15", status: "RECEIVED",
          },
        ],
      });
    }
  }

  // ── Seed Jobs ─────────────────────────────────────────────────────────────
  console.log("Seeding jobs…");
  for (const [i, jd] of JOBS_DATA.entries()) {
    const company = companies[(i + 3) % companies.length];
    // Link last RFQ (QUOTED status) to last job
    const linkedInquiry = jd.status === "QUOTED" ? inquiries.find(x => x.status === "QUOTED") : null;

    const job = await prisma.job.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        assignedToUserId: user?.id ?? null,
        inquiryId: linkedInquiry?.id ?? null,
        reference: jd.reference,
        status: jd.status as never,
        mode: jd.mode,
        origin: jd.origin,
        destination: jd.destination,
        commodity: jd.commodity,
        incoterms: jd.incoterms,
        weight: jd.weight,
        volume: jd.volume,
        revenue: jd.revenue ?? null,
        cost: jd.cost ?? null,
        currency: jd.currency,
        notes: jd.notes,
        etd: (jd as { etdDaysAgo?: number; etdFromNow?: number }).etdDaysAgo
          ? daysAgo((jd as { etdDaysAgo: number }).etdDaysAgo)
          : (jd as { etdFromNow?: number }).etdFromNow
          ? daysFromNow((jd as { etdFromNow: number }).etdFromNow)
          : null,
        eta: (jd as { etaFromNow?: number }).etaFromNow
          ? daysFromNow((jd as { etaFromNow: number }).etaFromNow)
          : (jd as { etaDaysAgo?: number }).etaDaysAgo
          ? daysAgo((jd as { etaDaysAgo: number }).etaDaysAgo)
          : null,
      },
    });

    // Default documents
    const defaultDocs = [
      { name: "Booking Confirmation", docType: "BOOKING",       status: ["IN_TRANSIT","CUSTOMS","DELIVERED"].includes(jd.status) ? "APPROVED" : jd.status === "BOOKED" ? "UPLOADED" : "PENDING" },
      { name: "Commercial Invoice",   docType: "INVOICE",        status: ["CUSTOMS","DELIVERED"].includes(jd.status) ? "APPROVED" : ["IN_TRANSIT","BOOKED"].includes(jd.status) ? "UPLOADED" : "PENDING" },
      { name: "Packing List",         docType: "PACKING_LIST",   status: ["CUSTOMS","DELIVERED"].includes(jd.status) ? "APPROVED" : ["IN_TRANSIT","BOOKED"].includes(jd.status) ? "UPLOADED" : "PENDING" },
      { name: "Bill of Lading",       docType: "BL",             status: ["CUSTOMS","DELIVERED"].includes(jd.status) ? "APPROVED" : jd.status === "IN_TRANSIT" ? "UPLOADED" : "PENDING" },
      { name: "Certificate of Origin",docType: "COO",            status: jd.status === "DELIVERED" ? "APPROVED" : "PENDING" },
      { name: "Customs Declaration",  docType: "CUSTOMS",        status: jd.status === "DELIVERED" ? "APPROVED" : "PENDING" },
    ];
    await prisma.jobDocument.createMany({
      data: defaultDocs.map((d) => ({ ...d, jobId: job.id, officeId: office.id })),
    });

    // Milestones
    const milestoneTypes = ["BOOKING","CARGO_READY","ETD","ETA","CUSTOMS_ENTRY","CUSTOMS_RELEASE","DELIVERY"];
    const milestoneDoneCount: Record<string, number> = {
      INQUIRY: 0, QUOTED: 0, BOOKED: 1, IN_TRANSIT: 3, CUSTOMS: 4, DELIVERED: 7,
    };
    const doneCount = milestoneDoneCount[jd.status] ?? 0;
    await prisma.jobMilestone.createMany({
      data: milestoneTypes.map((type, idx) => ({
        jobId: job.id,
        type,
        plannedAt: daysFromNow((idx - 2) * 7),
        actualAt: idx < doneCount ? daysAgo((doneCount - idx) * 5) : null,
      })),
    });
  }

  const jobCount = await prisma.job.count({ where: { officeId: office.id } });
  const inqCount = await prisma.inquiry.count({ where: { officeId: office.id } });
  console.log(`✅ Seeded ${jobCount} jobs and ${inqCount} RFQs for office "${office.name}"`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
