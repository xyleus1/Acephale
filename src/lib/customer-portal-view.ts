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
    updatedAt: Date;
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
      .map(({ id, name, docType, status, updatedAt }) => ({
        id,
        name,
        docType,
        status: status === "UPLOADED" ? "UNDER_REVIEW" as const : "NEEDED" as const,
        updatedAt,
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

export type CustomerPortalMilestoneWatch = {
  id: string;
  shipmentId: string;
  reference: string;
  route: string;
  label: string;
  plannedAt: Date;
  daysFromToday: number;
};

export type CustomerPortalPublishedUpdate = {
  id: string;
  shipmentId: string;
  reference: string;
  route: string;
  label: string;
  detail: string;
  occurredAt: Date;
  kind: "MILESTONE" | "DOCUMENT" | "DOCUMENT_REVIEW" | "QUOTE_RESPONSE";
};

export type CustomerPortalOperationsBrief = {
  overdueMilestones: CustomerPortalMilestoneWatch[];
  upcomingMilestones: CustomerPortalMilestoneWatch[];
  recentUpdates: CustomerPortalPublishedUpdate[];
  documents: {
    published: number;
    needed: number;
    underReview: number;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function buildCustomerPortalOperationsBrief(
  shipments: CustomerPortalShipment[],
  now: Date,
  horizonDays = 21,
): CustomerPortalOperationsBrief {
  const today = utcDay(now);
  const activeShipments = shipments.filter((shipment) =>
    !["DELIVERED", "CANCELLED"].includes(shipment.status)
  );
  const milestoneWatch = activeShipments.flatMap((shipment) =>
    shipment.milestones.flatMap((milestone) => {
      if (milestone.actualAt || !milestone.plannedAt) return [];
      return [{
        id: milestone.id,
        shipmentId: shipment.id,
        reference: shipment.reference,
        route: shipment.route,
        label: milestone.label,
        plannedAt: milestone.plannedAt,
        daysFromToday: Math.round((utcDay(milestone.plannedAt) - today) / DAY_MS),
      }];
    })
  );

  const recentUpdates = shipments.flatMap((shipment) => {
    const milestoneUpdates: CustomerPortalPublishedUpdate[] = shipment.milestones.flatMap((milestone) =>
      milestone.actualAt ? [{
        id: `milestone-${milestone.id}`,
        shipmentId: shipment.id,
        reference: shipment.reference,
        route: shipment.route,
        label: `${milestone.label} confirmed`,
        detail: shipment.route,
        occurredAt: milestone.actualAt,
        kind: "MILESTONE" as const,
      }] : []
    );
    const documentUpdates: CustomerPortalPublishedUpdate[] = shipment.documents.map((document) => ({
      id: `document-${document.id}`,
      shipmentId: shipment.id,
      reference: shipment.reference,
      route: shipment.route,
      label: `${document.name} published`,
      detail: `Approved file for ${shipment.route}`,
      occurredAt: document.updatedAt,
      kind: "DOCUMENT" as const,
    }));
    const documentReviewUpdates: CustomerPortalPublishedUpdate[] = shipment.documentRequests.flatMap((document) =>
      document.status === "UNDER_REVIEW" ? [{
        id: `document-review-${document.id}`,
        shipmentId: shipment.id,
        reference: shipment.reference,
        route: shipment.route,
        label: `${document.name} received`,
        detail: "Derya review in progress",
        occurredAt: document.updatedAt,
        kind: "DOCUMENT_REVIEW" as const,
      }] : []
    );
    const quoteUpdates: CustomerPortalPublishedUpdate[] = shipment.latestQuoteResponse ? [{
      id: `quote-${shipment.latestQuoteResponse.id}`,
      shipmentId: shipment.id,
      reference: shipment.reference,
      route: shipment.route,
      label: shipment.latestQuoteResponse.type === "QUOTE_ACCEPTED"
        ? "Quote approval submitted"
        : "Quote change requested",
      detail: `Submitted by ${shipment.latestQuoteResponse.submittedBy}`,
      occurredAt: shipment.latestQuoteResponse.createdAt,
      kind: "QUOTE_RESPONSE" as const,
    }] : [];
    return [...milestoneUpdates, ...documentUpdates, ...documentReviewUpdates, ...quoteUpdates];
  }).sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());

  return {
    overdueMilestones: milestoneWatch
      .filter((milestone) => milestone.daysFromToday < 0)
      .sort((left, right) => left.daysFromToday - right.daysFromToday),
    upcomingMilestones: milestoneWatch
      .filter((milestone) => milestone.daysFromToday >= 0 && milestone.daysFromToday <= horizonDays)
      .sort((left, right) => left.daysFromToday - right.daysFromToday),
    recentUpdates,
    documents: {
      published: shipments.reduce((total, shipment) => total + shipment.documents.length, 0),
      needed: shipments.reduce(
        (total, shipment) => total + shipment.documentRequests.filter((document) => document.status === "NEEDED").length,
        0,
      ),
      underReview: shipments.reduce(
        (total, shipment) => total + shipment.documentRequests.filter((document) => document.status === "UNDER_REVIEW").length,
        0,
      ),
    },
  };
}
