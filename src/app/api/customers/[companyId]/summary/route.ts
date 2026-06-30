import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const session = await requireSession();
  const { companyId } = await params;

  const company = await prisma.company.findFirst({
    where: { id: companyId, officeId: session.officeId },
    include: {
      contacts: { orderBy: { createdAt: "asc" }, take: 5 },
      jobs: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  if (!company) return new NextResponse("Not found", { status: 404 });

  return NextResponse.json({
    id: company.id,
    name: company.name,
    status: company.status,
    contacts: company.contacts.map((c) => ({
      id: c.id,
      name: c.fullName ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
    })),
    jobsCount: company.jobs.length,
    recentJobs: company.jobs.map((j) => ({
      id: j.id,
      reference: j.reference,
      route: j.origin && j.destination ? `${j.origin} → ${j.destination}` : null,
      status: j.status,
    })),
  });
}
