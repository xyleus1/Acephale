"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { createLoadFromRfqReview, getRfqLoadDraft } from "./rfq-load-review";

// Promote an Inquiry (RFQ) to a real INQUIRY-stage Job. If the inquiry has a
// PROPOSED job already, we just confirm it. If it has no job, we create one
// then confirm. The result is always a non-PROPOSED job.
export async function confirmRfqAsJob(inquiryId: string): Promise<{ ok: true; jobId: string } | { error: string }> {
  const draft = await getRfqLoadDraft(inquiryId);
  if ("error" in draft) return { error: draft.error };
  const result = await createLoadFromRfqReview(inquiryId, draft.values);
  if ("error" in result) return { error: result.error };
  return { ok: true, jobId: result.jobId };
}

// Move every email thread off the source inquiry onto the target job's
// inquiry, delete the source inquiry's PROPOSED job (if any) + the inquiry
// itself. Used when an RFQ is actually about an existing active deal.
export async function mergeRfqIntoExistingJob(args: { sourceInquiryId: string; targetJobId: string }): Promise<{ ok: true; threadsMoved: number; targetJobReference: string } | { error: string }> {
  const session = await requireSession();
  const [src, target] = await Promise.all([
    prisma.inquiry.findFirst({
      where: { id: args.sourceInquiryId, officeId: session.officeId },
      include: { job: { select: { id: true, status: true } }, _count: { select: { emailThreads: true } } },
    }),
    prisma.job.findFirst({
      where: { id: args.targetJobId, officeId: session.officeId },
      select: { id: true, reference: true, inquiryId: true },
    }),
  ]);
  if (!src) return { error: "Source RFQ not found" };
  if (!target) return { error: "Target job not found" };
  if (!target.inquiryId) return { error: "Target job has no underlying inquiry to merge into" };
  if (src.id === target.inquiryId) return { error: "Source and target are the same inquiry" };

  // Move email threads onto the target inquiry.
  const moved = await prisma.emailThread.updateMany({
    where: { inquiryId: src.id, officeId: session.officeId },
    data: { inquiryId: target.inquiryId, autoLinkedAt: new Date() },
  });

  // Delete the source's PROPOSED-only job (real jobs not touched).
  if (src.job?.id && src.job.status === "PROPOSED") {
    await prisma.job.deleteMany({ where: { id: src.job.id, officeId: session.officeId } }).catch(() => {});
  }
  // Drop the source inquiry's carrier quotes (would have been duplicates) and inquiry itself.
  await prisma.carrierQuote.deleteMany({ where: { inquiryId: src.id, inquiry: { officeId: session.officeId } } }).catch(() => {});
  await prisma.inquiry.deleteMany({ where: { id: src.id, officeId: session.officeId } }).catch(() => {});

  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  revalidatePath(`/dashboard/jobs/${target.id}`);

  return { ok: true, threadsMoved: moved.count, targetJobReference: target.reference };
}
