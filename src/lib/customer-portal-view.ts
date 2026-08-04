import { parsePipeLines, type QuoteLine } from "@/lib/quote-lines";

export const CUSTOMER_PORTAL_STATUS_ORDER = [
  "INQUIRY",
  "QUOTED",
  "BOOKED",
  "IN_TRANSIT",
  "DELIVERED",
] as const;

export const CUSTOMER_PORTAL_STATUS_SHORT_LABEL: Record<string, string> = {
  INQUIRY: "Request",
  QUOTED: "Quote",
  BOOKED: "Booked",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
};

export const CUSTOMER_PORTAL_STATUS_LABEL: Record<string, string> = {
  PROPOSED: "Request received",
  INQUIRY: "RFQ review",
  QUOTED: "Quote ready",
  BOOKED: "Booked",
  IN_TRANSIT: "In transit",
  CUSTOMS: "Customs",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const CUSTOMER_PORTAL_MILESTONE_LABEL: Record<string, string> = {
  BOOKING: "Booking confirmed",
  CARGO_READY: "Cargo ready",
  ETD: "Estimated departure",
  ETA: "Estimated arrival",
  CUSTOMS_ENTRY: "Customs entry",
  CUSTOMS_RELEASE: "Customs release",
  DELIVERY: "Delivery",
};

const CUSTOMER_MILESTONE_ORDER = Object.keys(CUSTOMER_PORTAL_MILESTONE_LABEL);
const CUSTOMER_MILESTONES = new Set(CUSTOMER_MILESTONE_ORDER);

function statusProgressIndex(status: string) {
  if (status === "PROPOSED" || status === "INQUIRY") return 0;
  if (status === "QUOTED") return 1;
  if (status === "BOOKED") return 2;
  if (status === "IN_TRANSIT" || status === "CUSTOMS") return 3;
  if (status === "DELIVERED") return 4;
  return 0;
}

type PortalJobInput = {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  mode: string | null;
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  incoterms: string | null;
  weight: number | null;
  volume: number | null;
  packages: number | null;
  containerCount: number | null;
  containerType: string | null;
  etd: Date | null;
  eta: Date | null;
  currency: string;
  quoteLines: string | null;
  createdAt: Date;
  updatedAt: Date;
  milestones: Array<{
    id: string;
    type: string;
    plannedAt: Date | null;
    actualAt: Date | null;
  }>;
  documents: Array<{
    id: string;
    name: string;
    docType: string;
    status: string;
    customerVisible: boolean;
    customerRequested: boolean;
    updatedAt: Date;
  }>;
  customerPortalActions: Array<{
    id: string;
    type: string;
    status: string;
    message: string | null;
    createdAt: Date;
    portalUser: { fullName: string | null; email: string };
  }>;
};

export type CustomerPortalShipment = {
  id: string;
  reference: string;
  title: string;
  status: string;
  statusLabel: string;
  mode: string | null;
  route: string;
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  incoterms: string | null;
  weight: number | null;
  volume: number | null;
  packages: number | null;
  containerCount: number | null;
  containerType: string | null;
  etd: Date | null;
  eta: Date | null;
  currency: string;
  quoteLines: QuoteLine[];
  createdAt: Date;
  updatedAt: Date;
  progressIndex: number;
  progressPercent: number;
  completedMilestones: number;
  nextMilestone: {
    id: string;
    label: string;
    plannedAt: Date | null;
  } | null;
  milestones: Array<{
    id: string;
    type: string;
    label: string;
    plannedAt: Date | null;
    actualAt: Date | null;
  }>;
  documents: Array<{
    id: string;
    name: string;
    docType: string;
    updatedAt: Date;
  }>;
  documentRequests: Array<{
    id: string;
    name: string;
    docType: string;
    status: "NEEDED" | "UNDER_REVIEW";
  }>;
  latestQuoteResponse: {
    id: string;
    type: string;
    status: string;
    message: string | null;
    createdAt: Date;
    submittedBy: string;
  } | null;
};

export function buildCustomerPortalShipment(job: PortalJobInput): CustomerPortalShipment {
  const latestQuoteResponse = job.customerPortalActions.find((action) =>
    action.type === "QUOTE_ACCEPTED" || action.type === "QUOTE_CHANGES_REQUESTED"
  );
  const milestones = job.milestones
    .filter((milestone) => CUSTOMER_MILESTONES.has(milestone.type))
    .sort((left, right) =>
      CUSTOMER_MILESTONE_ORDER.indexOf(left.type) - CUSTOMER_MILESTONE_ORDER.indexOf(right.type)
    )
    .map((milestone) => ({
      ...milestone,
      label: CUSTOMER_PORTAL_MILESTONE_LABEL[milestone.type] ?? milestone.type,
    }));
  const progressIndex = statusProgressIndex(job.status);
  const nextMilestone = milestones.find((milestone) => !milestone.actualAt) ?? null;
  return {
    id: job.id,
    reference: job.reference,
    title: job.title?.trim() || job.reference,
    status: job.status,
    statusLabel: CUSTOMER_PORTAL_STATUS_LABEL[job.status] ?? job.status,
    mode: job.mode,
    route: job.origin && job.destination ? `${job.origin} to ${job.destination}` : "Route pending",
    origin: job.origin,
    destination: job.destination,
    commodity: job.commodity,
    incoterms: job.incoterms,
    weight: job.weight,
    volume: job.volume,
    packages: job.packages,
    containerCount: job.containerCount,
    containerType: job.containerType,
    etd: job.etd,
    eta: job.eta,
    currency: job.currency,
    quoteLines: parsePipeLines(job.quoteLines),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progressIndex,
    progressPercent: Math.round((progressIndex / (CUSTOMER_PORTAL_STATUS_ORDER.length - 1)) * 100),
    completedMilestones: milestones.filter((milestone) => milestone.actualAt).length,
    nextMilestone: nextMilestone
      ? { id: nextMilestone.id, label: nextMilestone.label, plannedAt: nextMilestone.plannedAt }
      : null,
    milestones,
    documents: job.documents
      .filter((document) => document.status === "APPROVED" && document.customerVisible)
      .map(({ id, name, docType, updatedAt }) => ({ id, name, docType, updatedAt })),
    documentRequests: job.documents
      .filter((document) => document.customerRequested && document.status !== "APPROVED")
      .map(({ id, name, docType, status }) => ({
        id,
        name,
        docType,
        status: status === "UPLOADED" ? "UNDER_REVIEW" as const : "NEEDED" as const,
      })),
    latestQuoteResponse: latestQuoteResponse ? {
      id: latestQuoteResponse.id,
      type: latestQuoteResponse.type,
      status: latestQuoteResponse.status,
      message: latestQuoteResponse.message,
      createdAt: latestQuoteResponse.createdAt,
      submittedBy: latestQuoteResponse.portalUser.fullName ?? latestQuoteResponse.portalUser.email,
    } : null,
  };
}

export function customerPortalCanRespondToQuote(shipment: CustomerPortalShipment) {
  return shipment.status === "QUOTED" && shipment.quoteLines.length > 0;
}
