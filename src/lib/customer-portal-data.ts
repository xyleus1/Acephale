import "server-only";

import { prisma } from "@/lib/prisma";
import { buildCustomerPortalShipment } from "@/lib/customer-portal-view";

export type CustomerPortalPrincipal = {
  id: string;
  officeId: string;
  email: string;
  fullName: string | null;
  memberships: Array<{
    id: string;
    companyId: string;
    role: string;
    company: { id: string; name: string };
  }>;
};

const portalJobSelect = {
  id: true,
  reference: true,
  title: true,
  status: true,
  mode: true,
  origin: true,
  destination: true,
  commodity: true,
  incoterms: true,
  weight: true,
  volume: true,
  packages: true,
  containerCount: true,
  containerType: true,
  etd: true,
  eta: true,
  currency: true,
  quoteLines: true,
  createdAt: true,
  updatedAt: true,
  milestones: {
    select: { id: true, type: true, plannedAt: true, actualAt: true },
    orderBy: { createdAt: "asc" as const },
  },
  documents: {
    where: {
      OR: [
        { status: "APPROVED", customerVisible: true },
        { customerRequested: true },
      ],
    },
    select: {
      id: true,
      name: true,
      docType: true,
      status: true,
      customerVisible: true,
      customerRequested: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  customerPortalActions: {
    where: { type: { in: ["QUOTE_ACCEPTED", "QUOTE_CHANGES_REQUESTED"] } },
    select: {
      id: true,
      type: true,
      status: true,
      message: true,
      createdAt: true,
      portalUser: { select: { fullName: true, email: true } },
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
};

export async function loadCustomerPortalWorkspace(
  principal: CustomerPortalPrincipal,
  requestedCompanyId?: string | null,
) {
  const membership = principal.memberships.find((item) => item.companyId === requestedCompanyId)
    ?? principal.memberships[0];
  if (!membership) return null;

  const [office, jobs, inquiries] = await Promise.all([
    prisma.office.findUnique({
      where: { id: principal.officeId },
      select: { name: true },
    }),
    prisma.job.findMany({
      where: {
        officeId: principal.officeId,
        companyId: membership.companyId,
      },
      select: portalJobSelect,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.inquiry.findMany({
      where: {
        officeId: principal.officeId,
        companyId: membership.companyId,
        job: null,
      },
      select: {
        id: true,
        reference: true,
        subject: true,
        status: true,
        origin: true,
        destination: true,
        mode: true,
        receivedAt: true,
        updatedAt: true,
      },
      orderBy: { receivedAt: "desc" },
      take: 30,
    }),
  ]);

  const shipments = jobs.map(buildCustomerPortalShipment);
  const quoteActions = shipments.filter((job) =>
    job.status === "QUOTED"
    && job.quoteLines.length > 0
    && (!job.latestQuoteResponse || job.latestQuoteResponse.status === "REJECTED")
  );
  const documentActions = shipments.flatMap((job) =>
    job.documentRequests
      .filter((document) => document.status === "NEEDED")
      .map((document) => ({ shipment: job, document }))
  );
  return {
    officeName: office?.name ?? "Derya",
    membership,
    company: membership.company,
    shipments,
    activeShipments: shipments.filter((job) => !["DELIVERED", "CANCELLED"].includes(job.status)),
    completedShipments: shipments.filter((job) => job.status === "DELIVERED"),
    cancelledShipments: shipments.filter((job) => job.status === "CANCELLED"),
    inTransitShipments: shipments.filter((job) => ["IN_TRANSIT", "CUSTOMS"].includes(job.status)),
    quoteActions,
    documentActions,
    actionCount: quoteActions.length + documentActions.length,
    inquiries,
  };
}

export async function loadCustomerPortalShipment(
  principal: CustomerPortalPrincipal,
  jobId: string,
) {
  const companyIds = principal.memberships.map((membership) => membership.companyId);
  if (companyIds.length === 0) return null;

  const [office, job] = await Promise.all([
    prisma.office.findUnique({
      where: { id: principal.officeId },
      select: { name: true },
    }),
    prisma.job.findFirst({
      where: {
        id: jobId,
        officeId: principal.officeId,
        companyId: { in: companyIds },
      },
      select: {
        ...portalJobSelect,
        companyId: true,
      },
    }),
  ]);
  if (!job?.companyId) return null;

  const membership = principal.memberships.find((item) => item.companyId === job.companyId);
  if (!membership) return null;

  return {
    officeName: office?.name ?? "Derya",
    membership,
    company: membership.company,
    shipment: buildCustomerPortalShipment(job),
  };
}
