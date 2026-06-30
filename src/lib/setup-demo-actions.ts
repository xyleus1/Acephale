"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { mergeAllOpenInquiriesIntoOne } from "./merge-actions";
import { ensureProposedJobsForOpenInquiries, confirmProposedJob } from "./job-actions";
import { extractSourcingOffersForInquiry } from "./sourcing-offers";
import { prewarmInquirySummary } from "./prewarm-summary";
import { seedDemoLoad } from "./seed-demo-load";

// Consolidate every open SOURCING-type inquiry in this office into ONE
// real (non-PROPOSED) Job titled the way the user expects: "Soybean meal —
// 300 MT to Ashgabat". After consolidation:
//  - Title/commodity/destination/weight set
//  - All linked email threads moved onto the keeper inquiry
//  - PROPOSED job upgraded to INQUIRY status (a real load on the kanban)
//  - Supplier offers re-extracted so the comparison table populates
//
// Uses mergeAllOpenInquiriesIntoOne(type=SOURCING, ...overrides) under the
// hood. Idempotent — running it twice on a single-inquiry office does nothing.
// Operator-specified consolidation: customer = Hyzmettaslar, destination =
// Ashgabat, Turkmenistan, sourcing 300MT soybean meal. Plus duplicate-demo
// cleanup: keep the most-progressed demo job, delete the rest.
export async function fullDemoCleanup(): Promise<{
  ok: true;
  soybean: { jobId: string; reference: string; mergedCount: number };
  demosDeleted: { reference: string; status: string }[];
  customer: string;
} | { error: string }> {
  const session = await requireSession();
  const officeId = session.officeId;

  // Step 1: Consolidate soybean — same as before, but with customer set to
  // "Hyzmettaslar" (Turkmenistan-side buyer).
  const soybean = await consolidateAshgabatSoybeanLoad({
    customerName: "Hyzmettaslar",
  });
  if ("error" in soybean) return { error: `Soybean consolidate failed: ${soybean.error}` };

  // Step 2: Find every DEMO job. We can't rely on the [DEMO_LOAD_SEED]
  // marker alone — earlier partial runs created demos without it. Broader
  // detection: notes contain the marker, OR the linked Company name starts
  // with "DEMO ·", OR the linked Inquiry subject starts with "DEMO ·".
  const demos = await prisma.job.findMany({
    where: {
      officeId,
      OR: [
        { notes: { contains: "[DEMO_LOAD_SEED]" } },
        { company: { name: { startsWith: "DEMO ·" } } },
        { inquiry: { subject: { startsWith: "DEMO ·" } } },
      ],
    },
    select: { id: true, reference: true, status: true, inquiryId: true },
  });
  const STATUS_ORDER = ["PROPOSED", "INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"];
  const sorted = [...demos].sort((a, b) => STATUS_ORDER.indexOf(b.status) - STATUS_ORDER.indexOf(a.status));
  const keeper = sorted[0];
  const losers = sorted.slice(1);
  const demosDeleted: { reference: string; status: string }[] = [];
  for (const loser of losers) {
    // Delete the demo's job, its inquiry, and orphan the threads (they shouldn't have any).
    if (loser.inquiryId) {
      await prisma.emailThread.updateMany({ where: { inquiryId: loser.inquiryId }, data: { inquiryId: null } });
      await prisma.carrierQuote.deleteMany({ where: { inquiryId: loser.inquiryId } }).catch(() => {});
    }
    await prisma.job.delete({ where: { id: loser.id } }).catch(() => {});
    if (loser.inquiryId) {
      await prisma.inquiry.delete({ where: { id: loser.inquiryId } }).catch(() => {});
    }
    demosDeleted.push({ reference: loser.reference, status: loser.status });
  }

  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/inbox");
  return {
    ok: true,
    soybean: { jobId: soybean.jobId, reference: soybean.reference, mergedCount: soybean.mergedCount },
    demosDeleted,
    customer: "Hyzmettaslar",
  };
}

export async function consolidateAshgabatSoybeanLoad(opts: {
  customerName?: string;
} = {}): Promise<
  | { ok: true; jobId: string; reference: string; mergedCount: number }
  | { error: string }
> {
  const session = await requireSession();

  // Pre-pass: any SOURCING inquiry currently linked to a JOB whose status is
  // NOT a real load (i.e. PROPOSED, or no job at all) gets demoted so the
  // merge below can pick it up. Also un-confirms any PROPOSED job that
  // was set as "active" by accident — only the keeper should remain a real
  // load. We treat anything in INGESTED/PARSED/PRICED/QUOTED as fair game.
  const presentInquiries = await prisma.inquiry.findMany({
    where: {
      officeId: session.officeId,
      type: "SOURCING",
      status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] },
    },
    select: { id: true, job: { select: { id: true, status: true } } },
  });
  for (const inq of presentInquiries) {
    if (inq.job && inq.job.status !== "PROPOSED") {
      // Demote to PROPOSED so it can merge cleanly.
      await prisma.job.update({ where: { id: inq.job.id }, data: { status: "PROPOSED" } });
    }
  }

  // First, run the AI-driven merge with explicit specs.
  const merge = await mergeAllOpenInquiriesIntoOne({
    type: "SOURCING",
    subject: "Soybean meal — 300 MT to Ashgabat",
    commodity: "Soybean meal",
    destination: "Ashgabat, TM",
    weightKg: 300_000,
  });
  if ("error" in merge) {
    // Fall back: pick the existing single open SOURCING inquiry (if there is
    // exactly one) and just update its specs + confirm it.
    const candidates = await prisma.inquiry.findMany({
      where: {
        officeId: session.officeId,
        type: "SOURCING",
        status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] },
      },
      select: { id: true },
    });
    if (candidates.length === 0) {
      // Nothing to consolidate — bail with the original error.
      return { error: merge.error };
    }
    // If there's exactly one we can still upgrade it.
    if (candidates.length === 1) {
      const inq = candidates[0];
      await prisma.inquiry.update({
        where: { id: inq.id },
        data: {
          subject: "Soybean meal — 300 MT to Ashgabat",
          commodity: "Soybean meal",
          destination: "Ashgabat, TM",
          weight: 300_000,
        },
      });
      await ensureProposedJobsForOpenInquiries(session.officeId);
      const job = await prisma.job.findFirst({ where: { inquiryId: inq.id }, select: { id: true, reference: true, status: true } });
      if (!job) return { error: "Couldn't ensure a job for the soybean inquiry" };
      if (job.status === "PROPOSED") {
        await confirmProposedJob(job.id);
      }
      try { await extractSourcingOffersForInquiry(inq.id); } catch {}
      revalidatePath("/dashboard/jobs");
      revalidatePath("/dashboard/inbox");
      revalidatePath(`/dashboard/jobs/${job.id}`);
      return { ok: true, jobId: job.id, reference: job.reference, mergedCount: 0 };
    }
    return { error: merge.error };
  }

  // Promote the keeper from PROPOSED to INQUIRY so it shows as a real load.
  const keeperInquiryId = merge.keeperInquiryId;
  let keeperJobId = merge.keeperJobId;
  if (!keeperJobId) {
    await ensureProposedJobsForOpenInquiries(session.officeId);
    const j = await prisma.job.findFirst({ where: { inquiryId: keeperInquiryId }, select: { id: true } });
    keeperJobId = j?.id ?? null;
  }
  if (keeperJobId) {
    const status = await prisma.job.findUnique({ where: { id: keeperJobId }, select: { status: true } });
    if (status?.status === "PROPOSED") {
      await confirmProposedJob(keeperJobId);
    }
  }

  // Re-extract supplier offers so the comparison table is populated.
  // Run extraction + prewarm summary cache so the agent's first read is fast.
  await prewarmInquirySummary(keeperInquiryId).catch(() => {});

  // Apply operator-specified customer if requested. Creates a Company by name
  // (case-insensitive) and links it to both the inquiry and the job.
  if (opts.customerName) {
    let company = await prisma.company.findFirst({
      where: { officeId: session.officeId, name: { equals: opts.customerName, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (!company) {
      try {
        company = await prisma.company.create({
          data: {
            officeId: session.officeId,
            name: opts.customerName,
            status: "WORKED",
            class1: "Active",
            direction: "Import",
            product: "Sea",
          },
          select: { id: true, name: true },
        });
      } catch {
        // unique race — re-fetch
        company = await prisma.company.findFirst({
          where: { officeId: session.officeId, name: opts.customerName },
          select: { id: true, name: true },
        });
      }
    }
    if (company) {
      await prisma.inquiry.update({ where: { id: keeperInquiryId }, data: { companyId: company.id } });
      if (keeperJobId) {
        await prisma.job.update({ where: { id: keeperJobId }, data: { companyId: company.id } });
      }
    }
  }

  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/rfq");
  if (keeperJobId) revalidatePath(`/dashboard/jobs/${keeperJobId}`);

  const finalJob = await prisma.job.findFirst({ where: { inquiryId: keeperInquiryId }, select: { id: true, reference: true } });
  return {
    ok: true,
    jobId: finalJob?.id ?? keeperJobId ?? "",
    reference: finalJob?.reference ?? "(unknown)",
    mergedCount: merge.mergedCount,
  };
}

// One-click setup that does both: consolidate soybean + seed steel-coils demo.
export async function setupDemoEnvironment(): Promise<{
  soybean: { ok: boolean; jobRef?: string; mergedCount?: number; error?: string };
  steelDemo: { ok: boolean; jobRef?: string; created?: boolean; error?: string };
}> {
  const session = await requireSession();

  const soybeanResult = await consolidateAshgabatSoybeanLoad();
  const seedResult = await seedDemoLoad({ officeId: session.officeId });

  return {
    soybean: "error" in soybeanResult
      ? { ok: false, error: soybeanResult.error }
      : { ok: true, jobRef: soybeanResult.reference, mergedCount: soybeanResult.mergedCount },
    steelDemo: "error" in seedResult
      ? { ok: false, error: seedResult.error }
      : { ok: true, jobRef: seedResult.reference, created: seedResult.created },
  };
}
