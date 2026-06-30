"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { createPortalToken } from "./portal-token";

// Build a minimal one-page PDF with the given title and body lines, returned
// as a data: URL. Used to seed demo documents that the inline viewer can
// render and the PDF text extractor can read. Pure ASCII, no fonts embedded —
// uses the standard Helvetica that every PDF reader has built in.
function makeDemoPdfDataUrl(title: string, lines: string[]): string {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c);
  const safeTitle = escape(title);
  const safeLines = lines.map(escape);

  // Build the content stream. Position starts near the top of an A4 page.
  let content = "BT\n/F1 16 Tf\n72 760 Td\n(" + safeTitle + ") Tj\nET\n";
  let y = 720;
  for (const ln of safeLines) {
    content += `BT\n/F1 11 Tf\n72 ${y} Td\n(${ln}) Tj\nET\n`;
    y -= 18;
  }

  const objs: string[] = [];
  // 1: Catalog
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  // 2: Pages
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  // 3: Page
  objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>");
  // 4: Content stream
  const contentLen = Buffer.byteLength(content, "latin1");
  objs.push(`<< /Length ${contentLen} >>\nstream\n${content}endstream`);
  // 5: Font
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 " + (objs.length + 1) + "\n";
  pdf += "0000000000 65535 f \n";
  for (const off of offsets) {
    pdf += String(off).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const b64 = Buffer.from(pdf, "latin1").toString("base64");
  return `data:application/pdf;base64,${b64}`;
}

// Seed one fully-populated FORWARDING job for demo purposes:
// - Customer (creates one named "Black Sea Trading Co" if missing)
// - Inquiry with parsed shipment fields
// - Job with revenue/cost/margin set, status BOOKED
// - 3 carrier rates received, one selected
// - Milestones: BOOKING confirmed, ETD planned, ETA planned, others pending
// - 3 documents (BL, INVOICE, PACKING_LIST) with placeholder data: URLs and
//   pre-baked AI analysis so the workbench shows "AI commented" right away
// - Portal token populated
//
// Idempotent — returns the existing demo job if one already exists.
// Upgrade an already-seeded demo job to the richer state: IN_TRANSIT,
// all 5 docs APPROVED with AI commentary, more milestones marked done.
// Idempotent — safe to call repeatedly.
async function upgradeExistingDemoLoad(jobId: string, officeId: string): Promise<void> {
  // Bump status
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "IN_TRANSIT" },
  });

  // Push milestones forward — BOOKING / CARGO_READY / ETD all done
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { eta: true, milestones: { select: { id: true, type: true, actualAt: true } } },
  });
  const eta = job?.eta ?? new Date(Date.now() + 16 * 86400000);
  const milestoneTargets: Record<string, { actualAt?: Date; plannedAt?: Date }> = {
    BOOKING:    { plannedAt: new Date(Date.now() - 8 * 86400000), actualAt: new Date(Date.now() - 7 * 86400000) },
    CARGO_READY:{ plannedAt: new Date(Date.now() - 5 * 86400000), actualAt: new Date(Date.now() - 5 * 86400000) },
    ETD:        { plannedAt: new Date(Date.now() - 3 * 86400000), actualAt: new Date(Date.now() - 3 * 86400000) },
    ETA:        { plannedAt: eta },
    CUSTOMS_ENTRY:   { plannedAt: new Date(eta.getTime() + 86400000) },
    CUSTOMS_RELEASE: { plannedAt: new Date(eta.getTime() + 2 * 86400000) },
    DELIVERY:        { plannedAt: new Date(eta.getTime() + 3 * 86400000) },
  };
  for (const [type, target] of Object.entries(milestoneTargets)) {
    const existing = job?.milestones.find((m) => m.type === type);
    if (existing) {
      const update: Record<string, unknown> = {};
      if (target.actualAt && !existing.actualAt) update.actualAt = target.actualAt;
      if (target.plannedAt) update.plannedAt = target.plannedAt;
      if (Object.keys(update).length > 0) {
        await prisma.jobMilestone.update({ where: { id: existing.id }, data: update });
      }
    } else {
      await prisma.jobMilestone.create({ data: { jobId, type, ...target } });
    }
  }

  // Promote any pending/uploaded demo doc, and add the missing COO + CUSTOMS
  // with the same AI commentary the new seed produces.
  const docs = await prisma.jobDocument.findMany({
    where: { jobId },
    select: { id: true, docType: true, status: true, url: true },
  });
  // Approve packing list if it's still UPLOADED.
  for (const d of docs) {
    if (d.docType === "PACKING_LIST" && d.status !== "APPROVED" && d.url) {
      await prisma.jobDocument.update({ where: { id: d.id }, data: { status: "APPROVED" } });
    }
  }

  // Add COO and Customs Declaration if they don't have URLs yet.
  const cooDoc = docs.find((d) => d.docType === "COO");
  if (!cooDoc || !cooDoc.url) {
    const cooData = {
      jobId,
      officeId,
      name: "COO_RO-2026-04781.pdf",
      docType: "COO",
      status: "APPROVED",
      url: makeDemoPdfDataUrl("Certificate of Origin — RO-2026-04781", [
        "CERTIFICATE OF ORIGIN",
        "Certificate No: RO-2026-04781",
        "Issuing authority: Romanian Chamber of Commerce, Constanta",
        "Country of origin: ROMANIA",
        "Exporter: Black Sea Trading Co · Constanta, RO",
        "Consignee: Hamburg Cold Storage GmbH · Hamburg, DE",
        "Goods: Cold-rolled steel coils, 18 MT",
        "HS Code: 7209.16   Invoice ref: BST-2104",
        "Container: MEDU2891744 (40HC)",
        "Issued: 02 May 2026   Valid: 30 days",
      ]),
      aiSummary: "EUR.1 / Romanian Chamber of Commerce Certificate of Origin RO-2026-04781 confirming Romanian origin for the steel coils. Matches invoice BST-2104 and BL container MEDU2891744. HS code 7209.16.",
      aiFlags: JSON.stringify([]),
      aiKeyFields: JSON.stringify({
        certificate_no: "RO-2026-04781",
        country_of_origin: "Romania",
        exporter: "Black Sea Trading Co",
        consignee: "Hamburg Cold Storage GmbH",
        hs_codes: ["7209.16"],
        invoice_ref: "BST-2104",
        issued: "2026-05-02",
        validity_days: 30,
      }),
      aiAnalyzedAt: new Date(),
    };
    if (cooDoc) await prisma.jobDocument.update({ where: { id: cooDoc.id }, data: cooData });
    else await prisma.jobDocument.create({ data: cooData });
  }

  const customsDoc = docs.find((d) => d.docType === "CUSTOMS");
  if (!customsDoc || !customsDoc.url) {
    const customsData = {
      jobId,
      officeId,
      name: "Customs_Declaration_DE-IM-2026-91102.pdf",
      docType: "CUSTOMS",
      status: "APPROVED",
      url: makeDemoPdfDataUrl("Customs Declaration — DE/IM/2026/91102", [
        "CUSTOMS DECLARATION (Import)",
        "Declaration No: DE/IM/2026/91102",
        "Filed by: Hamburg Customs Broker AG (broker code HB-2241)",
        "Importer: Hamburg Cold Storage GmbH",
        "Goods: Cold-rolled steel coils",
        "HS Code: 7209.16",
        "Customs value: USD 20,700",
        "Duty rate: 0% (EUR.1 preference)",
        "VAT: 19% on landed value (paid)",
        "Container: MEDU2891744   Vessel: MSC ARIADNE / Voy 21W",
        "Filed: 18 May 2026 (pre-arrival)",
      ]),
      aiSummary: "Pre-arrival customs declaration DE/IM/2026/91102 filed by Hamburg Customs Broker AG. Duty 0% under EUR.1 preference (matches the COO). VAT 19% paid on landed value of USD 20,700. Container/vessel match the BL.",
      aiFlags: JSON.stringify([]),
      aiKeyFields: JSON.stringify({
        declaration_no: "DE/IM/2026/91102",
        broker: "Hamburg Customs Broker AG",
        importer: "Hamburg Cold Storage GmbH",
        hs_code: "7209.16",
        customs_value: 20700,
        currency: "USD",
        duty_rate: "0%",
        vat_rate: "19%",
        container: "MEDU2891744",
        filed: "2026-05-18",
      }),
      aiAnalyzedAt: new Date(),
    };
    if (customsDoc) await prisma.jobDocument.update({ where: { id: customsDoc.id }, data: customsData });
    else await prisma.jobDocument.create({ data: customsData });
  }

  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
}

export async function seedDemoLoad(args: { officeId: string }): Promise<{ ok: true; jobId: string; reference: string; created: boolean } | { error: string }> {
  // Check if a previous seed exists by looking for the marker in notes.
  const existing = await prisma.job.findFirst({
    where: { officeId: args.officeId, notes: { contains: "[DEMO_LOAD_SEED]" } },
    select: { id: true, reference: true },
  });
  if (existing) {
    // Upgrade the existing demo to richer state (IN_TRANSIT, all 5 docs
    // approved, more milestones confirmed). Useful when the seed shipped
    // earlier and we now have new content to layer on.
    await upgradeExistingDemoLoad(existing.id, args.officeId);
    return { ok: true, jobId: existing.id, reference: existing.reference, created: false };
  }

  // Look for orphaned demo state from a previous half-completed run:
  // an inquiry whose subject starts with "DEMO ·" but has no Job linked.
  // If we find one, finish the job creation against THAT inquiry instead of
  // creating duplicates.
  const orphanInquiry = await prisma.inquiry.findFirst({
    where: {
      officeId: args.officeId,
      subject: { startsWith: "DEMO ·" },
      job: null,
    },
    select: { id: true, companyId: true, mode: true, origin: true, destination: true, commodity: true, incoterms: true, weight: true, volume: true },
  });

  // Customer — name starts with "DEMO" so it's visually obvious this is a
  // staged record vs the operator's real customers.
  const demoCompanyName = "DEMO · Black Sea Trading Co";
  let company = await prisma.company.findFirst({
    where: { officeId: args.officeId, name: demoCompanyName },
    select: { id: true },
  });
  if (!company) {
    company = await prisma.company.create({
      data: {
        officeId: args.officeId,
        name: demoCompanyName,
        status: "WORKED",
        class1: "Active",
        class2: "B",
        product: "Sea",
        lane: "Mediterranean",
        direction: "Export",
      },
      select: { id: true },
    });
  }

  // Inquiry (the source RFQ) — reuse orphan from previous failed run if found
  const inquiry = orphanInquiry
    ? await prisma.inquiry.update({
        where: { id: orphanInquiry.id },
        data: { companyId: company.id },
      })
    : await prisma.inquiry.create({
        data: {
          officeId: args.officeId,
          companyId: company.id,
          subject: "DEMO · Steel coils — Constanta to Hamburg, 1x40HC",
          fromEmail: "ops@blackseatrading.example",
          fromCompany: "Black Sea Trading Co",
          type: "FORWARDING",
          status: "QUOTED",
          origin: "Constanta, RO",
          destination: "Hamburg, DE",
          mode: "SEA-FCL",
          containerType: "40HC",
          incoterms: "FOB",
          commodity: "Cold-rolled steel coils, 18 MT",
          weight: 18000,
          volume: 28,
          cargoReadyDate: new Date(Date.now() + 4 * 86400000),
          receivedAt: new Date(Date.now() - 6 * 86400000),
          notes: "Customer is repeat shipper — 4 prior loads on this lane.",
          rawEmailBody: "[Demo seed] Original RFQ from Black Sea Trading Co requesting rate Constanta → Hamburg, 1x40HC steel coils.",
        },
      });

  // Job — set up like a mid-pipeline shipment.
  // Reference must be next-available (not count+1) — see nextJobReference.
  const { nextJobReference } = await import("./job-actions");
  const reference = await nextJobReference(args.officeId);
  const portalToken = createPortalToken();
  const etd = new Date(Date.now() + 6 * 86400000);
  const eta = new Date(Date.now() + 16 * 86400000);

  const job = await prisma.job.create({
    data: {
      officeId: args.officeId,
      companyId: company.id,
      inquiryId: inquiry.id,
      reference,
      status: "IN_TRANSIT",
      type: "FORWARDING",
      mode: "SEA-FCL",
      origin: "Constanta, RO",
      destination: "Hamburg, DE",
      commodity: "Cold-rolled steel coils, 18 MT",
      incoterms: "FOB",
      weight: 18000,
      volume: 28,
      packages: 12,
      etd,
      eta,
      revenue: 4250,
      cost: 3120,
      currency: "USD",
      portalToken,
      notifyCustomer: true,
      customerEmail: "ops@blackseatrading.example",
      notes: "Refrigerated trailer to port — operator handed off to carrier on day 2. [DEMO_LOAD_SEED]",
    },
  });

  // 3 carrier rates received, one selected
  await prisma.carrierQuote.createMany({
    data: [
      { inquiryId: inquiry.id, carrier: "MSC",   service: "Constanta-Hamburg Express", total40HC: 3120, transitDays: 11, validity: "30 days", status: "RECEIVED" },
      { inquiryId: inquiry.id, carrier: "Maersk", service: "Adriatic Med",              total40HC: 3380, transitDays: 12, validity: "21 days", status: "RECEIVED" },
      { inquiryId: inquiry.id, carrier: "CMA CGM", service: "Med Direct",               total40HC: 3290, transitDays: 13, validity: "14 days", status: "RECEIVED" },
    ],
  });

  // Milestones
  const ms = [
    // Job is mid-shipment (IN_TRANSIT) — booking + cargo ready + ETD all hit;
    // ETA still upcoming, customs + delivery pending.
    { type: "BOOKING",          plannedAt: new Date(Date.now() - 8 * 86400000), actualAt: new Date(Date.now() - 7 * 86400000) },
    { type: "CARGO_READY",      plannedAt: new Date(Date.now() - 5 * 86400000), actualAt: new Date(Date.now() - 5 * 86400000) },
    { type: "ETD",              plannedAt: new Date(Date.now() - 3 * 86400000), actualAt: new Date(Date.now() - 3 * 86400000) },
    { type: "ETA",              plannedAt: eta, actualAt: null },
    { type: "CUSTOMS_ENTRY",    plannedAt: new Date(eta.getTime() + 86400000), actualAt: null },
    { type: "CUSTOMS_RELEASE",  plannedAt: new Date(eta.getTime() + 2 * 86400000), actualAt: null },
    { type: "DELIVERY",         plannedAt: new Date(eta.getTime() + 3 * 86400000), actualAt: null },
  ];
  for (const m of ms) {
    await prisma.jobMilestone.create({ data: { jobId: job.id, type: m.type, plannedAt: m.plannedAt, actualAt: m.actualAt ?? undefined } });
  }

  // Documents — 3 demo PDFs with pre-baked AI analysis (so the workbench
  // shows "AI commented" without needing real PDF bytes).
  const docs = [
    {
      name: "BL_HAMB-2026-04781.pdf",
      docType: "BL",
      status: "APPROVED",
      url: makeDemoPdfDataUrl("BL — HAMB-2026-04781", [
        "BILL OF LADING (Master)",
        "BL Number: HAMB-2026-04781",
        "Vessel: MSC ARIADNE   Voyage: 21W",
        "Container: MEDU2891744 (40HC)",
        "Gross weight: 18,000 kg   Packages: 12 wooden crates",
        "Shipper: Black Sea Trading Co (Constanta, RO)",
        "Consignee: Hamburg Cold Storage GmbH (Hamburg, DE)",
        "Port of loading: Constanta   Port of discharge: Hamburg",
        "Vessel ETD: 09 May 2026   ETA: 20 May 2026",
        "Freight: prepaid   Carrier: MSC",
      ]),
      aiSummary: "Master Bill of Lading from MSC for the Constanta → Hamburg leg. Container MEDU2891744 listed, 40HC, 18,000 kg gross. Shipper Black Sea Trading Co, consignee Hamburg Cold Storage GmbH.",
      aiFlags: JSON.stringify(["Vessel ETD on BL (May 9) is one day later than the booked ETD — not blocking, but adjust customer comms if needed."]),
      aiKeyFields: JSON.stringify({ bl_number: "HAMB-2026-04781", vessel: "MSC ARIADNE", voyage: "21W", container_no: "MEDU2891744", gross_weight_kg: 18000, shipper: "Black Sea Trading Co", consignee: "Hamburg Cold Storage GmbH", port_of_loading: "Constanta", port_of_discharge: "Hamburg" }),
    },
    {
      name: "Commercial_Invoice_BST-2104.pdf",
      docType: "INVOICE",
      status: "APPROVED",
      url: makeDemoPdfDataUrl("Commercial Invoice — BST-2104", [
        "COMMERCIAL INVOICE",
        "Invoice No: BST-2104   Date: 01 May 2026",
        "Seller: Black Sea Trading Co — Constanta, RO",
        "Buyer:  Hamburg Cold Storage GmbH — Hamburg, DE",
        "Item: Cold-rolled steel coils",
        "Quantity: 18 MT × USD 1,150 / MT = USD 20,700",
        "Currency: USD   Incoterms: FOB Constanta",
        "Payment terms: 30% TT advance + 70% LC at sight",
        "Buyer reference: HCS-PO-2026-91",
      ]),
      aiSummary: "Commercial invoice #BST-2104 for steel coils, total 18 MT × $1,150/MT = $20,700. Buyer Hamburg Cold Storage GmbH. Payment terms 30% TT advance + 70% LC at sight.",
      aiFlags: JSON.stringify([]),
      aiKeyFields: JSON.stringify({ invoice_no: "BST-2104", invoice_date: "2026-05-01", currency: "USD", total: 20700, qty: 18, unit_price: 1150, payment_terms: "30% TT + 70% LC at sight", seller: "Black Sea Trading Co", buyer: "Hamburg Cold Storage GmbH" }),
    },
    {
      name: "Packing_List_BST-2104.pdf",
      docType: "PACKING_LIST",
      status: "APPROVED",
      url: makeDemoPdfDataUrl("Packing List — BST-2104", [
        "PACKING LIST",
        "Reference: BST-2104",
        "Total packages: 12 wooden crates",
        "Gross weight: 18,200 kg",
        "Net weight: 18,000 kg",
        "Crate dimensions (avg): 120 × 80 × 60 cm",
        "Marks & numbers: BST/HCS/2026/01-12",
        "Container: MEDU2891744 (40HC)",
      ]),
      aiSummary: "Packing list for invoice BST-2104. 12 wooden crates, gross 18,200 kg, net 18,000 kg. Crate dimensions averaging 120×80×60 cm.",
      aiFlags: JSON.stringify(["Net weight (18,000 kg) matches the invoice but gross (18,200 kg) is 200 kg above what the BL records — confirm with shipper before customs entry."]),
      aiKeyFields: JSON.stringify({ total_packages: 12, gross_weight_kg: 18200, net_weight_kg: 18000, dimensions: "120×80×60 cm avg", package_type: "Wooden crate" }),
    },
    {
      name: "COO_RO-2026-04781.pdf",
      docType: "COO",
      status: "APPROVED",
      url: makeDemoPdfDataUrl("Certificate of Origin — RO-2026-04781", [
        "CERTIFICATE OF ORIGIN",
        "Certificate No: RO-2026-04781",
        "Issuing authority: Romanian Chamber of Commerce, Constanta",
        "Country of origin: ROMANIA",
        "Exporter: Black Sea Trading Co · Constanta, RO",
        "Consignee: Hamburg Cold Storage GmbH · Hamburg, DE",
        "Goods: Cold-rolled steel coils, 18 MT",
        "HS Code: 7209.16   Invoice ref: BST-2104",
        "Container: MEDU2891744 (40HC)",
        "Issued: 02 May 2026   Valid: 30 days",
      ]),
      aiSummary: "EUR.1 / Romanian Chamber of Commerce Certificate of Origin RO-2026-04781 confirming Romanian origin for the steel coils. Matches invoice BST-2104 and BL container MEDU2891744. HS code 7209.16.",
      aiFlags: JSON.stringify([]),
      aiKeyFields: JSON.stringify({
        certificate_no: "RO-2026-04781",
        country_of_origin: "Romania",
        exporter: "Black Sea Trading Co",
        consignee: "Hamburg Cold Storage GmbH",
        hs_codes: ["7209.16"],
        invoice_ref: "BST-2104",
        issued: "2026-05-02",
        validity_days: 30,
      }),
    },
    {
      name: "Customs_Declaration_DE-IM-2026-91102.pdf",
      docType: "CUSTOMS",
      status: "APPROVED",
      url: makeDemoPdfDataUrl("Customs Declaration — DE/IM/2026/91102", [
        "CUSTOMS DECLARATION (Import)",
        "Declaration No: DE/IM/2026/91102",
        "Filed by: Hamburg Customs Broker AG (broker code HB-2241)",
        "Importer: Hamburg Cold Storage GmbH",
        "Goods: Cold-rolled steel coils",
        "HS Code: 7209.16",
        "Customs value: USD 20,700",
        "Duty rate: 0% (EUR.1 preference)",
        "VAT: 19% on landed value (paid)",
        "Container: MEDU2891744   Vessel: MSC ARIADNE / Voy 21W",
        "Filed: 18 May 2026 (pre-arrival)",
      ]),
      aiSummary: "Pre-arrival customs declaration DE/IM/2026/91102 filed by Hamburg Customs Broker AG. Duty 0% under EUR.1 preference (matches the COO). VAT 19% paid on landed value of USD 20,700. Container/vessel match the BL.",
      aiFlags: JSON.stringify([]),
      aiKeyFields: JSON.stringify({
        declaration_no: "DE/IM/2026/91102",
        broker: "Hamburg Customs Broker AG",
        importer: "Hamburg Cold Storage GmbH",
        hs_code: "7209.16",
        customs_value: 20700,
        currency: "USD",
        duty_rate: "0%",
        vat_rate: "19%",
        container: "MEDU2891744",
        filed: "2026-05-18",
      }),
    },
  ];
  for (const d of docs) {
    await prisma.jobDocument.create({
      data: {
        jobId: job.id,
        officeId: args.officeId,
        name: d.name,
        url: d.url,
        docType: d.docType,
        status: d.status,
        aiSummary: d.aiSummary,
        aiFlags: d.aiFlags,
        aiKeyFields: d.aiKeyFields,
        aiAnalyzedAt: d.aiSummary ? new Date() : null,
      },
    });
  }

  revalidatePath("/dashboard/jobs");
  revalidatePath(`/dashboard/jobs/${job.id}`);
  revalidatePath(`/dashboard/rfq/${inquiry.id}`);

  return { ok: true, jobId: job.id, reference, created: true };
}
