import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Auth-required snapshot of the calling user's office. Use this to confirm
// you're acting on the office you think you are, and to see exactly what
// jobs / inquiries / customers / threads exist after a setup action.
export async function GET() {
  let session;
  try { session = await requireSession(); } catch { return new NextResponse("Unauthorized", { status: 401 }); }

  const [office, jobs, inquiries, companies, threadCount, accountCount] = await Promise.all([
    prisma.office.findUnique({ where: { id: session.officeId }, select: { id: true, name: true, createdAt: true } }),
    prisma.job.findMany({
      where: { officeId: session.officeId },
      select: { id: true, reference: true, status: true, type: true, origin: true, destination: true, commodity: true, company: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.inquiry.findMany({
      where: { officeId: session.officeId },
      select: { id: true, subject: true, type: true, status: true, commodity: true, destination: true, _count: { select: { emailThreads: true } }, job: { select: { reference: true, status: true } } },
      orderBy: { receivedAt: "desc" },
    }),
    prisma.company.findMany({
      where: { officeId: session.officeId },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.emailThread.count({ where: { officeId: session.officeId } }),
    prisma.emailAccount.count({ where: { officeId: session.officeId, isActive: true } }),
  ]);

  return NextResponse.json({
    you: { userId: session.userId, officeId: session.officeId },
    office,
    counts: {
      jobs: jobs.length,
      inquiries: inquiries.length,
      companies: companies.length,
      emailThreads: threadCount,
      activeEmailAccounts: accountCount,
    },
    jobs: jobs.map((j) => ({
      ref: j.reference, status: j.status, type: j.type,
      route: `${j.origin ?? "?"} → ${j.destination ?? "?"}`,
      commodity: j.commodity, customer: j.company?.name ?? null,
    })),
    inquiries: inquiries.map((i) => ({
      subject: i.subject, type: i.type, status: i.status, commodity: i.commodity,
      destination: i.destination, threadCount: i._count.emailThreads,
      jobRef: i.job?.reference ?? null, jobStatus: i.job?.status ?? null,
    })),
    companies: companies.map((c) => c.name),
  });
}
