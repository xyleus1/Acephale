import type { SourcingRequestDraft } from "./sourcing-request-contract";

export type SupplyInventoryStatus = "covered" | "watch" | "shortage";

export type SupplySourcingCandidate = {
  id: string;
  name: string;
  location: string;
  coordinates: { longitude: number; latitude: number };
  role: "Manufacturer" | "Distributor" | "Contract manufacturer";
  leadTimeDays: number;
  minimumOrderQuantity: number;
  modeledUnitCostUsd: number;
  fit: string;
};

export type SupplyInventoryItem = {
  sku: string;
  name: string;
  specification: string;
  quantityPerRobot: number;
  onHand: number;
  allocated: number;
  confirmedInbound: number;
  location: string;
  targetStock: number;
  candidates: SupplySourcingCandidate[];
  requirementLabel?: string;
  requestedQuantity?: number;
  requestedUnit?: string;
  supplierDeliverable?: string;
  source?: "published-snapshot";
  unitOfMeasure?: string | null;
  requiredQuantity?: number | null;
  needByDate?: string | null;
  deliveryLocation?: string | null;
  manufacturer?: string | null;
  mpn?: string | null;
  snapshotVersion?: number;
};

export function projectedAvailable(item: SupplyInventoryItem) {
  return Math.max(0, item.onHand - item.allocated + item.confirmedInbound);
}

export function requiredForDemand(item: SupplyInventoryItem) {
  if (typeof item.requestedQuantity === "number") return item.requestedQuantity;
  if (typeof item.requiredQuantity === "number") return item.requiredQuantity;
  return 0;
}

export function shortageQuantity(item: SupplyInventoryItem) {
  if (typeof item.requestedQuantity === "number") return item.requestedQuantity;
  if (item.requiredQuantity === null || item.requiredQuantity === undefined) return 0;
  return Math.max(0, requiredForDemand(item) - projectedAvailable(item));
}

export function sourcingRequestQuantity(item: SupplyInventoryItem) {
  if (typeof item.requestedQuantity === "number" && item.requestedQuantity > 0) return item.requestedQuantity;
  const shortage = shortageQuantity(item);
  if (shortage > 0) return shortage;
  return typeof item.requiredQuantity === "number" && item.requiredQuantity > 0
    ? item.requiredQuantity
    : null;
}

export function sourcingNeedByDate(item: SupplyInventoryItem) {
  return item.needByDate ?? null;
}

export function sourcingDeliveryLocation(item: SupplyInventoryItem) {
  return item.deliveryLocation ?? null;
}

export function inventoryItemSourcingDraft(item: SupplyInventoryItem): SourcingRequestDraft {
  return {
    productName: item.name,
    quantity: sourcingRequestQuantity(item),
    unit: item.requestedUnit ?? item.unitOfMeasure ?? null,
    manufacturer: item.manufacturer ?? null,
    partNumber: item.mpn ?? null,
    specification: item.specification,
    sourceRegion: null,
    deliveryLocation: sourcingDeliveryLocation(item),
    needByDate: sourcingNeedByDate(item),
  };
}

export function inventoryStatus(item: SupplyInventoryItem): SupplyInventoryStatus {
  const shortage = shortageQuantity(item);
  if (shortage > 0) return "shortage";
  if (projectedAvailable(item) < item.targetStock) return "watch";
  return "covered";
}

export function inventorySummary(items: SupplyInventoryItem[]) {
  const shortageItems = items.filter((item) => shortageQuantity(item) > 0);
  return {
    itemCount: items.length,
    shortageCount: shortageItems.length,
  };
}
