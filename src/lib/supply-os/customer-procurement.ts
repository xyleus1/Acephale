import type { ProcurementRequestInput } from "@/lib/procurement-contract";
import type { AtlasInventoryItem } from "./atlas-robotics-inventory";
import type { Guild2ProcurementOrderState } from "./guild2-procurement";
import type { SourcingRequestDraft } from "./sourcing-request-contract";

export const CUSTOMER_PROCUREMENT_CAMPAIGN = "CUSTOM";

export type CustomerProcurementListItem = {
  id: string;
  status: string;
  progress: string | null;
  neededBy: string | null;
  quantity: number;
  unit: string;
  material: string;
  specification: string | null;
  requestContext: Record<string, unknown>;
  supplierCount: number;
  contactedCount: number;
  responseCount: number;
  updatedAt: string;
};

function boundedIdempotencyKey(requestId: string) {
  return `supply-os-procurement:v1:${requestId}`.slice(0, 200);
}

export function customerProcurementRequest(args: {
  requestId: string;
  requestText: string;
  draft: SourcingRequestDraft;
  workspaceId?: string | null;
  companyName?: string | null;
}): ProcurementRequestInput {
  if (!args.draft.productName || !args.draft.quantity || !args.draft.unit) {
    throw new Error("The sourcing request is missing its item, quantity, or unit.");
  }
  const specification = [
    args.draft.specification,
    args.draft.manufacturer ? `Manufacturer: ${args.draft.manufacturer}` : null,
    args.draft.partNumber ? `Part number: ${args.draft.partNumber}` : null,
  ].filter(Boolean).join(". ") || null;
  return {
    bomId: null,
    material: args.draft.productName,
    specification,
    lineItemPreferences: {
      schema_version: 1,
      technical: {
        manufacturer: args.draft.manufacturer,
        part_number: args.draft.partNumber,
        source_region: args.draft.sourceRegion,
      },
    },
    quantity: args.draft.quantity,
    unit: args.draft.unit,
    neededBy: args.draft.needByDate,
    notes: args.requestText,
    requestContext: {
      schema_version: 1,
      source: {
        system: "Derya Supply OS",
        campaign: CUSTOMER_PROCUREMENT_CAMPAIGN,
        request_id: args.requestId,
        workspace_id: args.workspaceId ?? null,
        company_name: args.companyName ?? null,
      },
      logistics: {
        destination: args.draft.deliveryLocation,
      },
    },
    idempotencyKey: boundedIdempotencyKey(args.requestId),
  };
}

export function customerProcurementItem(order: CustomerProcurementListItem): AtlasInventoryItem {
  const source = order.requestContext.source;
  const requestId = source && typeof source === "object" && !Array.isArray(source)
    && typeof (source as Record<string, unknown>).request_id === "string"
    ? (source as Record<string, unknown>).request_id as string
    : order.id;
  const logistics = order.requestContext.logistics;
  const destination = logistics && typeof logistics === "object" && !Array.isArray(logistics)
    && typeof (logistics as Record<string, unknown>).destination === "string"
    ? (logistics as Record<string, unknown>).destination as string
    : null;
  return {
    sku: `REQ-${requestId.slice(0, 8).toUpperCase()}`,
    name: order.material,
    specification: order.specification ?? "Specification not provided",
    quantityPerRobot: 0,
    onHand: 0,
    allocated: 0,
    confirmedInbound: 0,
    location: destination ?? "Delivery location not provided",
    targetStock: 0,
    candidates: [],
    requirementLabel: `${order.quantity.toLocaleString("en-US")} ${order.unit}`,
    requestedQuantity: order.quantity,
    requestedUnit: order.unit,
    source: "published-snapshot",
    unitOfMeasure: order.unit,
    requiredQuantity: order.quantity,
    needByDate: order.neededBy,
    deliveryLocation: destination,
  };
}

export function customerProcurementDraftItem(
  requestId: string,
  draft: SourcingRequestDraft,
): AtlasInventoryItem {
  return customerProcurementItem({
    id: requestId,
    status: "new",
    progress: "Order received from dashboard",
    neededBy: draft.needByDate,
    quantity: draft.quantity ?? 0,
    unit: draft.unit ?? "units",
    material: draft.productName ?? "Sourcing request",
    specification: draft.specification ?? draft.partNumber,
    requestContext: {
      source: { campaign: CUSTOMER_PROCUREMENT_CAMPAIGN, request_id: requestId },
      logistics: { destination: draft.deliveryLocation },
    },
    supplierCount: 0,
    contactedCount: 0,
    responseCount: 0,
    updatedAt: new Date().toISOString(),
  });
}

export function customerProcurementOrderState(order: CustomerProcurementListItem): Guild2ProcurementOrderState {
  return {
    orderId: order.id,
    status: order.status,
    progress: order.progress,
    error: null,
    workflowWakeRequested: null,
    vendors: [],
  };
}

export function customerProcurementMatchesWorkspace(
  order: CustomerProcurementListItem,
  workspaceId: string | null | undefined,
  companyName: string,
) {
  const source = order.requestContext.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  const record = source as Record<string, unknown>;
  if (workspaceId) return record.workspace_id === workspaceId;
  return record.campaign === CUSTOMER_PROCUREMENT_CAMPAIGN
    && record.workspace_id === null
    && record.company_name === companyName;
}
