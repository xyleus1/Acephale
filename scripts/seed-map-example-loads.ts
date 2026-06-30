import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

type DemoLoad = {
  reference: string;
  companyName: string;
  companyMeta: {
    product: string;
    lane: string;
    direction: string;
  };
  subject: string;
  title: string;
  fromEmail: string;
  fromCompany: string;
  status: "QUOTED" | "BOOKED" | "IN_TRANSIT";
  mode: string;
  origin: string;
  destination: string;
  commodity: string;
  incoterms: string;
  containerCount: number;
  containerType: string;
  weight: number;
  volume: number;
  targetPrice: number;
  revenue: number;
  cost: number;
  etdOffsetDays: number;
  etaOffsetDays: number;
  quotes: {
    carrier: string;
    service: string;
    total40HC: number;
    transitDays: number;
    status: "PENDING" | "RECEIVED";
  }[];
};

const loads: DemoLoad[] = [
  {
    reference: "DEMO-MAP-001",
    companyName: "DEMO · Port Klang Plastics",
    companyMeta: { product: "Sea", lane: "Asia → Türkiye", direction: "Import" },
    subject: "DEMO MAP · Port Klang resin pallets to Istanbul",
    title: "Port Klang resin pallets",
    fromEmail: "ops@portklangplastics.example",
    fromCompany: "Port Klang Plastics",
    status: "BOOKED",
    mode: "SEA-FCL",
    origin: "Port Klang, MY",
    destination: "Istanbul, TR",
    commodity: "Plastic resin pallets",
    incoterms: "FOB",
    containerCount: 1,
    containerType: "40HC",
    weight: 18500,
    volume: 67,
    targetPrice: 6400,
    revenue: 6950,
    cost: 5150,
    etdOffsetDays: 5,
    etaOffsetDays: 29,
    quotes: [
      { carrier: "MSC", service: "Port Klang - Istanbul via Singapore", total40HC: 5150, transitDays: 24, status: "RECEIVED" },
      { carrier: "CMA CGM", service: "Asia Med Turkey", total40HC: 5380, transitDays: 27, status: "RECEIVED" },
      { carrier: "Maersk", service: "AE to Türkiye", total40HC: 5520, transitDays: 26, status: "RECEIVED" },
    ],
  },
  {
    reference: "DEMO-MAP-002",
    companyName: "DEMO · Shanghai Machine Works",
    companyMeta: { product: "Sea", lane: "China → Türkiye", direction: "Import" },
    subject: "DEMO MAP · Shanghai CNC parts to Mersin",
    title: "Shanghai CNC parts",
    fromEmail: "export@shanghaimachineworks.example",
    fromCompany: "Shanghai Machine Works",
    status: "QUOTED",
    mode: "SEA-FCL",
    origin: "Shanghai, CN",
    destination: "Mersin, TR",
    commodity: "CNC machine spare parts",
    incoterms: "EXW",
    containerCount: 1,
    containerType: "20GP",
    weight: 7200,
    volume: 24,
    targetPrice: 4800,
    revenue: 5350,
    cost: 3920,
    etdOffsetDays: 9,
    etaOffsetDays: 35,
    quotes: [
      { carrier: "COSCO", service: "Shanghai - Mersin direct string", total40HC: 3920, transitDays: 26, status: "RECEIVED" },
      { carrier: "ONE", service: "China Med via Piraeus", total40HC: 4140, transitDays: 29, status: "RECEIVED" },
      { carrier: "Hapag-Lloyd", service: "Far East Turkey", total40HC: 4310, transitDays: 31, status: "PENDING" },
    ],
  },
];

function addDays(days: number) {
  return new Date(Date.now() + days * DAY_MS);
}

async function getDemoOffice() {
  const demoUser = await prisma.user.findFirst({
    where: { email: "admin@demo.local" },
    select: { officeId: true, office: { select: { name: true } } },
  });
  if (demoUser) return { id: demoUser.officeId, name: demoUser.office.name };

  const office = await prisma.office.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!office) throw new Error("No office found. Seed demo auth/office data first.");
  return office;
}

async function upsertCompany(officeId: string, load: DemoLoad) {
  return prisma.company.upsert({
    where: { officeId_name: { officeId, name: load.companyName } },
    create: {
      officeId,
      name: load.companyName,
      status: "WORKED",
      class1: "Active",
      class2: "B",
      product: load.companyMeta.product,
      lane: load.companyMeta.lane,
      direction: load.companyMeta.direction,
    },
    update: {
      status: "WORKED",
      class1: "Active",
      class2: "B",
      product: load.companyMeta.product,
      lane: load.companyMeta.lane,
      direction: load.companyMeta.direction,
    },
    select: { id: true },
  });
}

async function upsertLoad(officeId: string, load: DemoLoad) {
  const company = await upsertCompany(officeId, load);
  const existingJob = await prisma.job.findUnique({
    where: { officeId_reference: { officeId, reference: load.reference } },
    select: { id: true, inquiryId: true },
  });

  const inquiryData = {
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
    dangerousGoods: "NO",
    customsBy: "US",
    commodity: load.commodity,
    weight: load.weight,
    volume: load.volume,
    incoterms: load.incoterms,
    targetPrice: load.targetPrice,
    targetCurrency: "USD",
    targetPriceStatus: "PROVIDED",
    targetPriceSource: "demo map seed",
    cargoReadyDate: addDays(load.etdOffsetDays - 2),
    type: "FORWARDING",
    status: "QUOTED",
    notes: "Seeded map example load. Safe to overwrite by rerunning scripts/seed-map-example-loads.ts.",
    rawEmailBody: `[Demo map seed] ${load.subject}`,
  };

  const inquiry = existingJob?.inquiryId
    ? await prisma.inquiry.update({
        where: { id: existingJob.inquiryId },
        data: inquiryData,
        select: { id: true },
      })
    : await prisma.inquiry.create({
        data: inquiryData,
        select: { id: true },
      });

  const etd = addDays(load.etdOffsetDays);
  const eta = addDays(load.etaOffsetDays);
  const jobData = {
    officeId,
    companyId: company.id,
    inquiryId: inquiry.id,
    reference: load.reference,
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
    containerCount: load.containerCount,
    containerType: load.containerType,
    dangerousGoods: "NO",
    customsBy: "US",
    targetPrice: load.targetPrice,
    targetCurrency: "USD",
    targetPriceStatus: "PROVIDED",
    targetPriceSource: "demo map seed",
    etd,
    eta,
    revenue: load.revenue,
    cost: load.cost,
    currency: "USD",
    notifyCustomer: false,
    customerEmail: load.fromEmail,
    notes: "[DEMO_MAP_LOAD] Seeded route-map verification load.",
  };

  const job = existingJob
    ? await prisma.job.update({
        where: { id: existingJob.id },
        data: jobData,
        select: { id: true, reference: true },
      })
    : await prisma.job.create({
        data: jobData,
        select: { id: true, reference: true },
      });

  await prisma.carrierQuote.deleteMany({ where: { inquiryId: inquiry.id } });
  await prisma.carrierQuote.createMany({
    data: load.quotes.map((quote) => ({
      inquiryId: inquiry.id,
      carrier: quote.carrier,
      service: quote.service,
      total40HC: quote.total40HC,
      transitDays: quote.transitDays,
      validity: "14 days",
      status: quote.status,
    })),
  });

  await prisma.jobMilestone.deleteMany({ where: { jobId: job.id } });
  await prisma.jobMilestone.createMany({
    data: [
      { jobId: job.id, type: "BOOKING", plannedAt: addDays(load.etdOffsetDays - 4), actualAt: load.status === "QUOTED" ? null : addDays(load.etdOffsetDays - 4) },
      { jobId: job.id, type: "ETD", plannedAt: etd, actualAt: load.status === "IN_TRANSIT" ? etd : null },
      { jobId: job.id, type: "ETA", plannedAt: eta },
      { jobId: job.id, type: "CUSTOMS_ENTRY", plannedAt: addDays(load.etaOffsetDays + 1) },
      { jobId: job.id, type: "CUSTOMS_RELEASE", plannedAt: addDays(load.etaOffsetDays + 2) },
      { jobId: job.id, type: "DELIVERY", plannedAt: addDays(load.etaOffsetDays + 3) },
    ],
  });

  await prisma.targetPriceHistory.deleteMany({
    where: {
      officeId,
      OR: [{ inquiryId: inquiry.id }, { jobId: job.id }],
    },
  });
  await prisma.targetPriceHistory.create({
    data: {
      officeId,
      inquiryId: inquiry.id,
      jobId: job.id,
      amount: load.targetPrice,
      currency: "USD",
      status: "PROVIDED",
      source: "demo map seed",
      note: `Customer target for ${load.origin} to ${load.destination}.`,
    },
  });

  return job;
}

async function main() {
  const office = await getDemoOffice();
  const results = [];
  for (const load of loads) {
    results.push(await upsertLoad(office.id, load));
  }
  console.log(`Seeded ${results.length} map example loads in ${office.name}:`);
  for (const result of results) {
    console.log(`- ${result.reference} (${result.id})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
