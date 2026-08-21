import type { SupplyInventoryItem } from "./inventory-item";
import type { SupplyWorkspaceSnapshotResponse } from "./snapshot-twin";

function quantity(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? ""));
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function calendarDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

type PartsRequestMetadata = {
  source: "PARTS_CSV";
  quantity: number | null;
  unitOfMeasure: string | null;
  deliveryLocation: string | null;
  needByDate: string | null;
};

function partsRequestMetadata(value: unknown): PartsRequestMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = (value as { request?: unknown }).request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const record = request as Record<string, unknown>;
  if (record.source !== "PARTS_CSV") return null;
  const parsedQuantity = typeof record.quantity === "number" ? record.quantity : Number(record.quantity);
  return {
    source: "PARTS_CSV",
    quantity: Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : null,
    unitOfMeasure: typeof record.unitOfMeasure === "string" && record.unitOfMeasure.trim() ? record.unitOfMeasure.trim() : null,
    deliveryLocation: typeof record.deliveryLocation === "string" && record.deliveryLocation.trim() ? record.deliveryLocation.trim() : null,
    needByDate: typeof record.needByDate === "string" ? calendarDate(record.needByDate) : null,
  };
}

export function snapshotResponseToSourcingItems(
  input: SupplyWorkspaceSnapshotResponse,
): SupplyInventoryItem[] {
  const workspace = input.workspace;
  const snapshot = workspace?.snapshots?.[0];
  if (!workspace?.id || !snapshot) return [];

  const locationsById = new Map(snapshot.locations.map((location) => [location.id, location.name]));
  const inventoryByItem = new Map<string, {
    onHand: number;
    allocated: number;
    inbound: number;
    locations: Set<string>;
  }>();
  for (const position of snapshot.inventory) {
    const current = inventoryByItem.get(position.itemId) ?? {
      onHand: 0,
      allocated: 0,
      inbound: 0,
      locations: new Set<string>(),
    };
    current.onHand += quantity(position.quantityOnHand);
    current.allocated += quantity(position.quantityAllocated);
    current.inbound += quantity(position.quantityInTransit) + quantity(position.quantityOnOrder);
    const location = locationsById.get(position.locationId);
    if (location) current.locations.add(location);
    inventoryByItem.set(position.itemId, current);
  }

  const demandByItem = new Map<string, {
    required: number;
    hasDemand: boolean;
    unit: string | null;
    needByDate: string | null;
    deliveryLocations: Set<string>;
  }>();
  for (const demand of snapshot.demands) {
    if ((demand.status ?? "OPEN") !== "OPEN") continue;
    const required = quantity(demand.quantity);
    if (required <= 0) continue;
    const current = demandByItem.get(demand.itemId) ?? {
      required: 0,
      hasDemand: false,
      unit: null,
      needByDate: null,
      deliveryLocations: new Set<string>(),
    };
    current.required += required;
    current.hasDemand = true;
    current.unit = current.unit ?? demand.unitOfMeasure ?? null;
    const dueAt = calendarDate(demand.dueAt);
    if (dueAt && (!current.needByDate || dueAt < current.needByDate)) current.needByDate = dueAt;
    const location = demand.locationId ? locationsById.get(demand.locationId) : null;
    if (location) current.deliveryLocations.add(location);
    demandByItem.set(demand.itemId, current);
  }

  const bomByParent = new Map(
    snapshot.bomVersions.map((version) => [version.productItemId, version.lines] as const),
  );
  const propagateBomDemand = (
    parentItemId: string,
    parentQuantity: number,
    deliveryLocation: string | null,
    needByDate: string | null,
    visiting: Set<string>,
  ) => {
    if (visiting.has(parentItemId)) return;
    const lines = bomByParent.get(parentItemId) ?? [];
    const nextVisiting = new Set(visiting).add(parentItemId);
    for (const line of lines) {
      if (nextVisiting.has(line.componentItemId)) continue;
      const lineQuantity = quantity(line.quantity);
      if (lineQuantity <= 0) continue;
      const required = parentQuantity * lineQuantity;
      const current = demandByItem.get(line.componentItemId) ?? {
        required: 0,
        hasDemand: false,
        unit: null,
        needByDate: null,
        deliveryLocations: new Set<string>(),
      };
      current.required += required;
      current.hasDemand = true;
      current.unit = current.unit ?? line.unitOfMeasure ?? null;
      if (needByDate && (!current.needByDate || needByDate < current.needByDate)) current.needByDate = needByDate;
      if (deliveryLocation) current.deliveryLocations.add(deliveryLocation);
      demandByItem.set(line.componentItemId, current);
      propagateBomDemand(line.componentItemId, required, deliveryLocation, needByDate, nextVisiting);
    }
  };
  for (const demand of snapshot.demands) {
    if ((demand.status ?? "OPEN") !== "OPEN") continue;
    const required = quantity(demand.quantity);
    if (required <= 0) continue;
    propagateBomDemand(
      demand.itemId,
      required,
      demand.locationId ? locationsById.get(demand.locationId) ?? null : null,
      calendarDate(demand.dueAt),
      new Set(),
    );
  }

  const bomComponentIds = new Set(
    snapshot.bomVersions.flatMap((version) => version.lines.map((line) => line.componentItemId)),
  );
  return snapshot.items
    .filter((item) => {
      const itemDemand = demandByItem.get(item.id);
      return bomComponentIds.has(item.id) || Boolean(itemDemand?.hasDemand) || item.itemType !== "PRODUCT";
    })
    .map((item): SupplyInventoryItem => {
      const inventory = inventoryByItem.get(item.id) ?? {
        onHand: 0,
        allocated: 0,
        inbound: 0,
        locations: new Set<string>(),
      };
      const demand = demandByItem.get(item.id);
      const request = partsRequestMetadata(item.metadata);
      const requiredQuantity = demand?.hasDemand ? demand.required : request?.quantity ?? null;
      const unitOfMeasure = demand?.unit ?? request?.unitOfMeasure ?? (request ? null : item.unitOfMeasure ?? null);
      const deliveryLocation = demand?.deliveryLocations.size
        ? [...demand.deliveryLocations].join(", ")
        : request?.deliveryLocation ?? null;
      const specification = item.description?.trim()
        || [item.manufacturer, item.mpn].filter(Boolean).join(" ")
        || "No technical specification was supplied in the published snapshot.";
      return {
        sku: item.sku || item.itemKey,
        name: item.name,
        specification,
        quantityPerRobot: 1,
        onHand: inventory.onHand,
        allocated: inventory.allocated,
        confirmedInbound: inventory.inbound,
        location: [...inventory.locations].join(", ") || deliveryLocation || "No location published",
        targetStock: requiredQuantity ?? 0,
        candidates: [],
        source: "published-snapshot",
        unitOfMeasure,
        requiredQuantity,
        needByDate: demand?.needByDate ?? request?.needByDate ?? null,
        deliveryLocation,
        manufacturer: item.manufacturer ?? null,
        mpn: item.mpn ?? null,
        snapshotVersion: snapshot.version,
      };
    })
    .sort((left, right) => {
      const leftOpen = left.requiredQuantity !== null ? 1 : 0;
      const rightOpen = right.requiredQuantity !== null ? 1 : 0;
      return rightOpen - leftOpen || left.sku.localeCompare(right.sku);
    });
}
