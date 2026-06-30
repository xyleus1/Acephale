"use server";

import { requireSession } from "./auth";
import { prisma } from "./prisma";

export type LatestEvent = {
  at: string; // ISO
  kind: "rfq" | "carrier-reply" | "milestone" | "doc" | "job";
  title: string;
  sub?: string;
  href: string;
};

export async function getLatestEvent(): Promise<LatestEvent | null> {
  const session = await requireSession();
  const officeId = session.officeId;

  // Pull a few candidates and pick the newest
  const [inq, cq, ms, doc, job] = await Promise.all([
    prisma.inquiry.findFirst({
      where: { officeId },
      orderBy: { receivedAt: "desc" },
      select: { id: true, receivedAt: true, subject: true },
    }),
    prisma.carrierQuote.findFirst({
      where: { inquiry: { officeId }, status: "RECEIVED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, carrier: true, total40HC: true, total40: true, total20: true, inquiry: { select: { id: true } } },
    }),
    prisma.jobMilestone.findFirst({
      where: { actualAt: { not: null }, job: { officeId } },
      orderBy: { actualAt: "desc" },
      select: { actualAt: true, type: true, job: { select: { id: true, reference: true } } },
    }),
    prisma.jobDocument.findFirst({
      where: { officeId, status: { in: ["UPLOADED", "APPROVED"] } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true, name: true, status: true, job: { select: { id: true, reference: true } } },
    }),
    prisma.job.findFirst({
      where: { officeId },
      orderBy: { createdAt: "desc" },
      select: { id: true, reference: true, createdAt: true, company: { select: { name: true } } },
    }),
  ]);

  const candidates: LatestEvent[] = [];
  if (inq) candidates.push({
    at: inq.receivedAt.toISOString(), kind: "rfq",
    title: "Inbound RFQ captured", sub: inq.subject,
    href: `/dashboard/rfq/${inq.id}`,
  });
  if (cq) {
    const total = cq.total40HC ?? cq.total40 ?? cq.total20;
    candidates.push({
      at: cq.createdAt.toISOString(), kind: "carrier-reply",
      title: `${cq.carrier} replied with rate`,
      sub: total ? `$${total.toLocaleString()}` : undefined,
      href: cq.inquiry?.id ? `/dashboard/rfq/${cq.inquiry.id}` : "/dashboard/rfq",
    });
  }
  if (ms) candidates.push({
    at: ms.actualAt!.toISOString(), kind: "milestone",
    title: `${ms.type.replace(/_/g, " ").toLowerCase()} confirmed`,
    sub: ms.job.reference,
    href: `/dashboard/jobs/${ms.job.id}`,
  });
  if (doc) candidates.push({
    at: doc.updatedAt.toISOString(), kind: "doc",
    title: `${doc.name} ${doc.status.toLowerCase()}`,
    sub: doc.job.reference,
    href: `/dashboard/jobs/${doc.job.id}`,
  });
  if (job) candidates.push({
    at: job.createdAt.toISOString(), kind: "job",
    title: `New job ${job.reference}`,
    sub: job.company?.name ?? undefined,
    href: `/dashboard/jobs/${job.id}`,
  });

  candidates.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return candidates[0] ?? null;
}
