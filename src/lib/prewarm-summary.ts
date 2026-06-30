"use server";

import { prisma } from "./prisma";
import { extractSourcingOffersForInquiry } from "./sourcing-offers";

// Pre-warms an inquiry's summary cache so the agent's first query returns
// in <100ms instead of doing the full extract+sort+shape pipeline.
//
// Steps:
// 1. Run extractSourcingOffersForInquiry (parallel batch extractor; skips
//    threads already parsed with a real price).
// 2. Read the parsed offers, build the summary shape, write to
//    Inquiry.summaryCache + summaryCacheAt.
//
// Designed to be called fire-and-forget after Gmail sync, link_threads_to_job,
// or merge — anywhere that adds/changes threads on an inquiry. Per-inquiry
// failures are swallowed so one bad inquiry doesn't block the rest.
export async function prewarmInquirySummary(inquiryId: string): Promise<void> {
  try {
    // Step 1: extraction (no-op for threads with a real price already cached).
    const inq = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: { id: true, officeId: true, type: true, commodity: true, destination: true },
    });
    if (!inq || inq.type !== "SOURCING") return;

    await extractSourcingOffersForInquiry(inquiryId).catch(() => {});

    // Step 2: rebuild summary from updated thread data.
    const threads = await prisma.emailThread.findMany({
      where: { inquiryId, officeId: inq.officeId },
      select: { id: true, subject: true, supplierOffer: true, awardedAt: true, messages: { orderBy: { sentAt: "desc" }, take: 1 } },
    });
    const offers = threads.map((t) => {
      let o: any = {};
      try { if (t.supplierOffer) o = JSON.parse(t.supplierOffer); } catch {}
      return {
        thread_id: t.id,
        supplier: o.supplierName ?? t.subject,
        price: o.pricePerUnit ?? null,
        currency: o.currency ?? null,
        unit: o.unit ?? null,
        qty: o.qtyAvailable ?? null,
        incoterms: o.incoterms ?? null,
        origin: o.origin ?? null,
        lead_time: o.leadTime ?? null,
        payment_terms: o.paymentTerms ?? null,
        awarded: !!t.awardedAt,
      };
    });
    offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    const summary = {
      commodity: inq.commodity,
      destination: inq.destination,
      offers,
      stats: {
        total: offers.length,
        with_price: offers.filter((o) => o.price != null).length,
        cheapest: offers.find((o) => o.price != null) ?? null,
      },
    };
    await prisma.inquiry.updateMany({
      where: { id: inquiryId, officeId: inq.officeId },
      data: { summaryCache: JSON.stringify(summary), summaryCacheAt: new Date() },
    }).catch(() => {});
  } catch { /* swallow */ }
}

// Pre-warm every open SOURCING inquiry in an office. Used by the daily cron
// + after major data changes.
export async function prewarmAllOpenInquiries(officeId: string): Promise<{ count: number }> {
  const inquiries = await prisma.inquiry.findMany({
    where: { officeId, type: "SOURCING", status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] } },
    select: { id: true },
  });
  // Don't parallelize across inquiries (each one already parallelizes its
  // threads). Sequential keeps memory bounded.
  for (const i of inquiries) {
    await prewarmInquirySummary(i.id);
  }
  return { count: inquiries.length };
}
