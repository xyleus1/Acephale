"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { createWithFileReference } from "./references";

// Run a job create that retries with a fresh reference if two creates race
// into the same number (unique constraint violation). Loads share the DRY
// file-number sequence with incoming RFQs (see src/lib/references.ts).
export async function createJobWithReference<T>(
  officeId: string,
  create: (reference: string) => Promise<T>
): Promise<T> {
  return createWithFileReference(officeId, create);
}

// Create a PROPOSED-stage Job for an Inquiry that doesn't have one yet.
// Only called on explicit operator action (RFQ → load review) and demo setup;
// loads are never auto-created from ingestion anymore. The job carries the
// inquiry's DRY file number so the RFQ and the load share one reference.
// IMPORTANT: caller must have already verified office ownership of the inquiry.
export async function createProposedJobForInquiry(inquiryId: string): Promise<string | null> {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    include: { job: { select: { id: true } } },
  });
  if (!inquiry) return null;
  if (inquiry.job) return inquiry.job.id;

  const createJob = (reference: string) => prisma.job.create({
    data: {
      officeId: inquiry.officeId,
      companyId: inquiry.companyId ?? null,
      inquiryId: inquiry.id,
      reference,
      status: "PROPOSED",
      type: inquiry.type,
      mode: inquiry.mode ?? null,
      origin: inquiry.origin ?? null,
      destination: inquiry.destination ?? null,
      commodity: inquiry.commodity ?? null,
      incoterms: inquiry.incoterms ?? null,
      weight: inquiry.weight ?? null,
      volume: inquiry.volume ?? null,
      dimensions: inquiry.dimensions ?? null,
      stackable: inquiry.stackable ?? null,
      topLoad: inquiry.topLoad ?? null,
      dangerousGoods: inquiry.dangerousGoods ?? null,
      customsBy: inquiry.customsBy ?? null,
      containerCount: inquiry.containerCount ?? null,
      containerType: inquiry.containerType ?? null,
      targetPrice: inquiry.targetPrice ?? null,
      targetCurrency: inquiry.targetCurrency ?? null,
      targetPriceStatus: inquiry.targetPriceStatus ?? null,
      targetPriceSource: inquiry.targetPriceSource ?? null,
      currency: "USD",
    },
  });

  let job;
  if (inquiry.reference) {
    try {
      job = await createJob(inquiry.reference);
    } catch (e) {
      // Another load already holds this file number (sheet import, legacy
      // data). Issue a fresh number instead of leaving the RFQ unconvertible.
      if ((e as { code?: string })?.code !== "P2002") throw e;
      job = await createJobWithReference(inquiry.officeId, createJob);
    }
  } else {
    job = await createJobWithReference(inquiry.officeId, createJob);
  }
  return job.id;
}

// For every open Inquiry in this office that doesn't have a Job yet, create a
// PROPOSED-stage Job. Idempotent: skips inquiries that already have a job.
// Used by sync / reclassify / merge so existing inquiries always show up on
// the kanban board, even ones created before the PROPOSED-job feature existed.
export async function ensureProposedJobsForOpenInquiries(officeId: string): Promise<number> {
  const inquiries = await prisma.inquiry.findMany({
    where: {
      officeId,
      status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] },
      job: null,
    },
    select: { id: true },
  });
  let created = 0;
  for (const i of inquiries) {
    const id = await createProposedJobForInquiry(i.id);
    if (id) created++;
  }
  return created;
}

// Promote a PROPOSED job to a real INQUIRY-stage job (operator confirms it).
export async function confirmProposedJob(jobId: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: { id: true, status: true, inquiryId: true },
  });
  if (!job) return { error: "Job not found" };
  if (job.status !== "PROPOSED") return { error: "Job is not in proposed stage" };

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "INQUIRY" },
  });
  if (job.inquiryId) {
    await prisma.inquiry.update({
      where: { id: job.inquiryId },
      data: { status: "PARSED" },
    });
  }
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/inbox");
  revalidatePath(`/dashboard/jobs/${jobId}`);
  return { ok: true };
}

export async function discardProposedJob(jobId: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId, status: "PROPOSED" },
    select: { id: true, inquiryId: true },
  });
  if (!job) return { error: "Job not found or not proposed" };
  // Detach the inquiry's threads from the inquiry, then delete the job and inquiry stub.
  if (job.inquiryId) {
    await prisma.emailThread.updateMany({
      where: { inquiryId: job.inquiryId, officeId: session.officeId },
      data: { inquiryId: null, autoLinkedAt: null, autoLinkSkipReason: "Proposed job discarded" },
    });
  }
  await prisma.job.deleteMany({ where: { id: jobId, officeId: session.officeId } });
  if (job.inquiryId) {
    await prisma.inquiry.deleteMany({ where: { id: job.inquiryId, officeId: session.officeId } }).catch(() => {});
  }
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/inbox");
  return { ok: true };
}
