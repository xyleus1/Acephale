export type SnapshotTwinEvidence = {
  label: string;
  detail: string;
  basis: "Published snapshot" | "Rule";
};

export type SnapshotTwinItem = {
  id: string;
  name: string;
  partNumber: string;
  category: "drive" | "vision" | "control" | "battery" | "frame" | "other";
  quantityPerRobot: number;
  onHand: number;
  allocated: number;
  confirmedInbound: number;
  location: string;
  sourceCountry: string;
  leadTimeDays: number;
  unitCostUsd: number;
  isOptional: boolean;
  recommendation: string;
  decision: string;
  evidence: SnapshotTwinEvidence[];
};

export type SupplyOsSnapshotTwinModel = {
  source: "published-snapshot";
  workspaceId: string;
  workspaceName: string;
  snapshotId: string;
  snapshotVersion: number;
  publishedAt: string | null;
  productName: string;
  productPartNumber: string;
  productRevision: string;
  productImageUrl: string | null;
  demandUnits: number;
  items: SnapshotTwinItem[];
};

type BuildabilityItem = Pick<SnapshotTwinItem, "quantityPerRobot" | "onHand" | "allocated" | "confirmedInbound"> & {
  isOptional?: boolean;
};

export function calculateTwinBuildability(items: BuildabilityItem[], demandUnits: number) {
  const constrained = items.filter((item) => !item.isOptional && item.quantityPerRobot > 0);
  const supported = (item: BuildabilityItem, includeInbound: boolean) => Math.floor(Math.max(
    0,
    item.onHand - item.allocated + (includeInbound ? item.confirmedInbound : 0),
  ) / item.quantityPerRobot);
  const buildableNow = constrained.length ? Math.min(...constrained.map((item) => supported(item, false))) : demandUnits;
  const buildableWithInbound = constrained.length ? Math.min(...constrained.map((item) => supported(item, true))) : demandUnits;
  return {
    buildableNow,
    buildableWithInbound,
    gapToDemand: Math.max(0, demandUnits - buildableWithInbound),
  };
}

type ApiItem = {
  id: string;
  itemKey: string;
  sku?: string | null;
  mpn?: string | null;
  name: string;
  category?: string | null;
  itemType?: string | null;
};

type ApiBomLine = {
  id: string;
  componentItemId: string;
  quantity: unknown;
  isOptional?: boolean;
};

type ApiBomVersion = {
  id: string;
  productItemId: string;
  revision?: string | null;
  lines: ApiBomLine[];
};

type ApiInventory = {
  itemId: string;
  locationId: string;
  quantityOnHand: unknown;
  quantityAllocated: unknown;
  quantityInTransit: unknown;
  quantityOnOrder: unknown;
};

type ApiDemand = {
  itemId: string;
  quantity: unknown;
  status?: string | null;
};

type ApiLocation = {
  id: string;
  name: string;
};

type ApiMediaAsset = {
  itemId?: string | null;
  kind?: string | null;
  url?: string | null;
};

export type SupplyWorkspaceSnapshotResponse = {
  workspace: {
    id: string;
    name: string;
    snapshots: Array<{
      id: string;
      version: number;
      publishedAt?: string | null;
      items: ApiItem[];
      bomVersions: ApiBomVersion[];
      inventory: ApiInventory[];
      demands: ApiDemand[];
      locations: ApiLocation[];
      mediaAssets: ApiMediaAsset[];
    }>;
  };
};

function finiteQuantity(value: unknown) {
  const quantity = typeof value === "number" ? value : Number(String(value ?? ""));
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
}

function itemCategory(item: ApiItem): SnapshotTwinItem["category"] {
  const value = `${item.category ?? ""} ${item.itemType ?? ""} ${item.name}`.toLowerCase();
  if (/drive|motor|servo|wheel/.test(value)) return "drive";
  if (/vision|camera|sensor|lidar|radio/.test(value)) return "vision";
  if (/control|compute|controller|pcb|circuit/.test(value)) return "control";
  if (/battery|cell|power/.test(value)) return "battery";
  if (/frame|chassis|housing|enclosure/.test(value)) return "frame";
  return "other";
}

function safePublishedImage(mediaAssets: ApiMediaAsset[], productItemId: string) {
  for (const asset of mediaAssets) {
    if (asset.itemId !== productItemId || !asset.url) continue;
    if (asset.kind && !/image|photo|product/i.test(asset.kind)) continue;
    try {
      const parsed = new URL(asset.url);
      if (parsed.protocol === "https:") return parsed.toString();
    } catch {
      continue;
    }
  }
  return null;
}

function demandForProduct(demands: ApiDemand[], productItemId: string) {
  return demands
    .filter((demand) => demand.itemId === productItemId && (demand.status ?? "OPEN") === "OPEN")
    .reduce((total, demand) => total + finiteQuantity(demand.quantity), 0);
}

function chooseProduct(snapshot: SupplyWorkspaceSnapshotResponse["workspace"]["snapshots"][number]) {
  const componentIds = new Set(snapshot.bomVersions.flatMap((version) => version.lines.map((line) => line.componentItemId)));
  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));
  return [...snapshot.bomVersions]
    .filter((version) => version.lines.length > 0)
    .sort((left, right) => {
      const leftTopLevel = componentIds.has(left.productItemId) ? 0 : 1;
      const rightTopLevel = componentIds.has(right.productItemId) ? 0 : 1;
      if (leftTopLevel !== rightTopLevel) return rightTopLevel - leftTopLevel;
      const leftIsProduct = itemsById.get(left.productItemId)?.itemType === "PRODUCT" ? 1 : 0;
      const rightIsProduct = itemsById.get(right.productItemId)?.itemType === "PRODUCT" ? 1 : 0;
      if (leftIsProduct !== rightIsProduct) return rightIsProduct - leftIsProduct;
      const demandDelta = demandForProduct(snapshot.demands, right.productItemId) - demandForProduct(snapshot.demands, left.productItemId);
      if (demandDelta !== 0) return demandDelta;
      if (left.lines.length !== right.lines.length) return right.lines.length - left.lines.length;
      return left.productItemId.localeCompare(right.productItemId);
    })[0] ?? null;
}

export function snapshotResponseToTwinModel(input: SupplyWorkspaceSnapshotResponse): SupplyOsSnapshotTwinModel | null {
  const workspace = input.workspace;
  const snapshot = workspace?.snapshots?.[0];
  if (!workspace?.id || !snapshot) return null;

  const bom = chooseProduct(snapshot);
  if (!bom) return null;
  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));
  const product = itemsById.get(bom.productItemId);
  if (!product) return null;

  const locationsById = new Map(snapshot.locations.map((location) => [location.id, location.name]));
  const inventoryByItem = new Map<string, { onHand: number; allocated: number; inbound: number; locations: Set<string> }>();
  for (const position of snapshot.inventory) {
    const current = inventoryByItem.get(position.itemId) ?? { onHand: 0, allocated: 0, inbound: 0, locations: new Set<string>() };
    current.onHand += finiteQuantity(position.quantityOnHand);
    current.allocated += finiteQuantity(position.quantityAllocated);
    current.inbound += finiteQuantity(position.quantityInTransit) + finiteQuantity(position.quantityOnOrder);
    const location = locationsById.get(position.locationId);
    if (location) current.locations.add(location);
    inventoryByItem.set(position.itemId, current);
  }

  const combinedLines = new Map<string, { quantity: number; isOptional: boolean }>();
  for (const line of bom.lines) {
    const current = combinedLines.get(line.componentItemId) ?? { quantity: 0, isOptional: true };
    current.quantity += finiteQuantity(line.quantity);
    current.isOptional = current.isOptional && Boolean(line.isOptional);
    combinedLines.set(line.componentItemId, current);
  }

  const demandUnits = demandForProduct(snapshot.demands, product.id);
  const components: SnapshotTwinItem[] = [];
  for (const [componentItemId, line] of combinedLines) {
    const component = itemsById.get(componentItemId);
    if (!component || line.quantity <= 0) continue;
    const inventory = inventoryByItem.get(componentItemId) ?? { onHand: 0, allocated: 0, inbound: 0, locations: new Set<string>() };
    const available = Math.max(0, inventory.onHand - inventory.allocated + inventory.inbound);
    const supported = Math.floor(available / line.quantity);
    const missingParts = Math.max(0, demandUnits * line.quantity - available);
    const covered = line.isOptional || supported >= demandUnits;
    components.push({
      id: component.id,
      name: component.name,
      partNumber: component.sku || component.mpn || component.itemKey,
      category: itemCategory(component),
      quantityPerRobot: line.quantity,
      onHand: inventory.onHand,
      allocated: inventory.allocated,
      confirmedInbound: inventory.inbound,
      location: [...inventory.locations].slice(0, 2).join(", ") || "No inventory location published",
      sourceCountry: "Not supplied in snapshot",
      leadTimeDays: 0,
      unitCostUsd: 0,
      isOptional: line.isOptional,
      recommendation: covered
        ? "The published quantities cover the current demand. Keep the snapshot current before releasing a buy."
        : `Review ${missingParts.toLocaleString()} required part${missingParts === 1 ? "" : "s"} for the published demand before committing the build plan.`,
      decision: covered
        ? "No quantity intervention is indicated by this snapshot."
        : "A planner must choose a supply response before external execution.",
      evidence: [
        {
          label: `Published snapshot v${snapshot.version}`,
          detail: "BOM, inventory, inbound, allocation, and demand quantities came from the selected immutable workspace snapshot.",
          basis: "Published snapshot",
        },
        {
          label: "Buildability rule",
          detail: line.isOptional
            ? "This BOM line is marked optional and does not constrain the buildable quantity."
            : "Available quantity is on-hand minus allocated plus in-transit and on-order, divided by the BOM quantity.",
          basis: "Rule",
        },
      ],
    });
  }
  if (!components.length) return null;

  return {
    source: "published-snapshot",
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    publishedAt: snapshot.publishedAt ?? null,
    productName: product.name,
    productPartNumber: product.sku || product.mpn || product.itemKey,
    productRevision: bom.revision || "Not supplied",
    productImageUrl: safePublishedImage(snapshot.mediaAssets, product.id),
    demandUnits,
    items: components,
  };
}
