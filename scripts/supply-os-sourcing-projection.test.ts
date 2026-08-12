import assert from "node:assert/strict";
import {
  snapshotResponseToSourcingItems,
} from "../src/lib/supply-os/snapshot-sourcing";
import type {
  SupplyWorkspaceSnapshotResponse,
} from "../src/lib/supply-os/snapshot-twin";
import { resolveSupplyWorkspaceId } from "../src/lib/supply-os/workspace-selection";

type Snapshot = SupplyWorkspaceSnapshotResponse["workspace"]["snapshots"][number];

function response(snapshot: Snapshot, workspaceId = "workspace-a"): SupplyWorkspaceSnapshotResponse {
  return {
    workspace: {
      id: workspaceId,
      name: "Acme production",
      snapshots: [snapshot],
    },
  };
}

function emptySnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: "snapshot-1",
    version: 12,
    items: [],
    bomVersions: [],
    inventory: [],
    demands: [],
    locations: [],
    mediaAssets: [],
    ...overrides,
  };
}

const rolledUp = snapshotResponseToSourcingItems(response(emptySnapshot({
  items: [{ id: "bearing", itemKey: "BEARING", sku: "BRG-1", name: "Bearing", itemType: "COMPONENT" }],
  locations: [
    { id: "line", name: "Line-side store" },
    { id: "overflow", name: "Overflow store" },
  ],
  inventory: [
    {
      itemId: "bearing",
      locationId: "line",
      quantityOnHand: "10.5",
      quantityAllocated: 2,
      quantityInTransit: "3",
      quantityOnOrder: 4,
    },
    {
      itemId: "bearing",
      locationId: "overflow",
      quantityOnHand: 5,
      quantityAllocated: -4,
      quantityInTransit: "invalid",
      quantityOnOrder: "2.5",
    },
    {
      itemId: "bearing",
      locationId: "missing-location",
      quantityOnHand: 1,
      quantityAllocated: 1,
      quantityInTransit: -8,
      quantityOnOrder: 0,
    },
  ],
})));
assert.equal(rolledUp.length, 1);
assert.deepEqual({
  onHand: rolledUp[0]?.onHand,
  allocated: rolledUp[0]?.allocated,
  inbound: rolledUp[0]?.confirmedInbound,
  location: rolledUp[0]?.location,
}, {
  onHand: 16.5,
  allocated: 3,
  inbound: 9.5,
  location: "Line-side store, Overflow store",
}, "inventory, allocation, and both inbound buckets must roll up across positions");

const fallbackItems = snapshotResponseToSourcingItems(response(emptySnapshot({
  items: [
    {
      id: "demand-spec",
      itemKey: "DEMAND-SPEC",
      sku: "A-DEMAND-SPEC",
      name: "Demand-specified part",
      description: "  Exact released specification  ",
      manufacturer: "Ignored maker",
      mpn: "IGNORED-MPN",
      itemType: "COMPONENT",
      unitOfMeasure: "EA",
      metadata: { request: { source: "PARTS_CSV", quantity: 2, unitOfMeasure: "M" } },
    },
    {
      id: "request-spec",
      itemKey: "REQUEST-SPEC",
      sku: "B-REQUEST-SPEC",
      name: "Request-specified part",
      description: "   ",
      manufacturer: "Maker",
      mpn: "MPN-7",
      itemType: "COMPONENT",
      unitOfMeasure: "EA",
      metadata: {
        request: {
          source: "PARTS_CSV",
          quantity: "6",
          unitOfMeasure: " M ",
          deliveryLocation: " Dock 4 ",
          needByDate: "2026-09-14T18:30:00.000Z",
        },
      },
    },
    {
      id: "unknown-request",
      itemKey: "UNKNOWN-REQUEST",
      sku: "C-UNKNOWN-REQUEST",
      name: "Unknown request",
      itemType: "COMPONENT",
      unitOfMeasure: "EA",
      metadata: {
        request: {
          source: "PARTS_CSV",
          quantity: "not supplied",
          unitOfMeasure: " ",
          deliveryLocation: " ",
          needByDate: "invalid",
        },
      },
    },
    {
      id: "item-unit",
      itemKey: "ITEM-UNIT",
      sku: "D-ITEM-UNIT",
      name: "Published unit",
      itemType: "COMPONENT",
      unitOfMeasure: "L",
      metadata: { request: { source: "OTHER", quantity: 3, unitOfMeasure: "KG" } },
    },
    {
      id: "default-unit",
      itemKey: "DEFAULT-UNIT",
      sku: "E-DEFAULT-UNIT",
      name: "Default unit",
      itemType: "COMPONENT",
      metadata: [],
    },
  ],
  demands: [{
    itemId: "demand-spec",
    quantity: 3,
    unitOfMeasure: "KG",
    status: "OPEN",
  }],
})));
const fallbackBySku = new Map(fallbackItems.map((item) => [item.sku, item]));
assert.deepEqual({
  specification: fallbackBySku.get("A-DEMAND-SPEC")?.specification,
  unit: fallbackBySku.get("A-DEMAND-SPEC")?.unitOfMeasure,
  required: fallbackBySku.get("A-DEMAND-SPEC")?.requiredQuantity,
}, {
  specification: "Exact released specification",
  unit: "KG",
  required: 3,
}, "published demand must outrank request metadata, and description must outrank identity fields");
assert.deepEqual({
  specification: fallbackBySku.get("B-REQUEST-SPEC")?.specification,
  unit: fallbackBySku.get("B-REQUEST-SPEC")?.unitOfMeasure,
  required: fallbackBySku.get("B-REQUEST-SPEC")?.requiredQuantity,
  location: fallbackBySku.get("B-REQUEST-SPEC")?.deliveryLocation,
  needBy: fallbackBySku.get("B-REQUEST-SPEC")?.needByDate,
}, {
  specification: "Maker MPN-7",
  unit: "M",
  required: 6,
  location: "Dock 4",
  needBy: "2026-09-14",
}, "parts metadata must fill missing demand facts without overriding stronger snapshot facts");
assert.deepEqual({
  specification: fallbackBySku.get("C-UNKNOWN-REQUEST")?.specification,
  unit: fallbackBySku.get("C-UNKNOWN-REQUEST")?.unitOfMeasure,
  required: fallbackBySku.get("C-UNKNOWN-REQUEST")?.requiredQuantity,
  location: fallbackBySku.get("C-UNKNOWN-REQUEST")?.deliveryLocation,
  needBy: fallbackBySku.get("C-UNKNOWN-REQUEST")?.needByDate,
}, {
  specification: "No technical specification was supplied in the published snapshot.",
  unit: undefined,
  required: null,
  location: null,
  needBy: null,
}, "unknown request facts must stay unknown instead of inheriting storage defaults");
assert.equal(fallbackBySku.get("D-ITEM-UNIT")?.unitOfMeasure, "L", "non-parts metadata must not suppress a published unit");
assert.equal(fallbackBySku.get("E-DEFAULT-UNIT")?.unitOfMeasure, "EA", "ordinary items without a unit must use the display fallback");

const filtered = snapshotResponseToSourcingItems(response(emptySnapshot({
  items: [
    { id: "root", itemKey: "ROOT", sku: "Z-ROOT", name: "Unused root", itemType: "PRODUCT" },
    { id: "action-b", itemKey: "ACTION-B", sku: "B-ACTION", name: "Requested B", itemType: "COMPONENT", metadata: { request: { source: "PARTS_CSV", quantity: 2, unitOfMeasure: "EA" } } },
    { id: "action-a", itemKey: "ACTION-A", sku: "A-ACTION", name: "Requested A", itemType: "PRODUCT" },
    { id: "product-component", itemKey: "PRODUCT-COMPONENT", sku: "C-COMPONENT", name: "Nested product", itemType: "PRODUCT" },
    { id: "ordinary", itemKey: "ORDINARY", sku: "D-ORDINARY", name: "Ordinary component", itemType: "COMPONENT" },
    { id: "unused-product", itemKey: "UNUSED", sku: "E-UNUSED", name: "Unused product", itemType: "PRODUCT" },
  ],
  bomVersions: [{
    id: "root-bom",
    productItemId: "root",
    lines: [{ id: "nested-product-line", componentItemId: "product-component", quantity: 1 }],
  }],
  demands: [{ itemId: "action-a", quantity: 1, status: "OPEN" }],
})));
assert.deepEqual(
  filtered.map((item) => item.sku),
  ["A-ACTION", "B-ACTION", "C-COMPONENT", "D-ORDINARY"],
  "actionable items must sort first, products must require demand or BOM membership, and each group must sort by SKU",
);

assert.equal(resolveSupplyWorkspaceId({
  workspaces: [{ id: "first" }, { id: "preferred" }, { id: "current" }],
  preferredWorkspaceId: "preferred",
  currentWorkspaceId: "current",
}), "preferred", "an accessible preferred workspace must win");
assert.equal(resolveSupplyWorkspaceId({
  workspaces: [{ id: "first" }, { id: "current" }],
  preferredWorkspaceId: "stale",
  currentWorkspaceId: "current",
}), "current", "a stale preferred workspace must fall through to the accessible current workspace");
assert.equal(resolveSupplyWorkspaceId({
  workspaces: [{ id: "first" }, { id: "second" }],
  preferredWorkspaceId: "stale",
  currentWorkspaceId: "also-stale",
}), "first", "the first authorized workspace must be the final non-fixed fallback");
assert.equal(resolveSupplyWorkspaceId({ workspaces: [] }), "", "an empty workspace list must produce no selection");
assert.equal(resolveSupplyWorkspaceId({
  workspaces: [{ id: "first" }, { id: "fixed" }],
  fixedWorkspaceId: "fixed",
  preferredWorkspaceId: "first",
}), "fixed", "a valid fixed workspace must remain pinned");
assert.throws(() => resolveSupplyWorkspaceId({
  workspaces: [{ id: "first" }],
  fixedWorkspaceId: "missing",
}), /no longer available/, "an inaccessible fixed workspace must fail closed");

assert.deepEqual(
  snapshotResponseToSourcingItems({ workspace: undefined } as unknown as SupplyWorkspaceSnapshotResponse),
  [],
  "a missing workspace payload must not project unrelated data",
);
assert.deepEqual(snapshotResponseToSourcingItems({
  workspace: { id: "workspace-a", name: "Acme production", snapshots: [] },
}), [], "a workspace without a published snapshot must project no items");
assert.deepEqual(snapshotResponseToSourcingItems(response(emptySnapshot(), "")), [], "a workspace without an ID must fail closed");

const ignoredDemand = snapshotResponseToSourcingItems(response(emptySnapshot({
  items: [
    { id: "closed", itemKey: "CLOSED", sku: "A-CLOSED", name: "Closed demand product", itemType: "PRODUCT" },
    { id: "zero", itemKey: "ZERO", sku: "B-ZERO", name: "Zero demand product", itemType: "PRODUCT" },
    { id: "invalid", itemKey: "INVALID", sku: "C-INVALID", name: "Invalid demand product", itemType: "PRODUCT" },
    { id: "negative", itemKey: "NEGATIVE", sku: "D-NEGATIVE", name: "Negative demand product", itemType: "PRODUCT" },
    { id: "ordinary", itemKey: "ORDINARY", sku: "E-ORDINARY", name: "Ordinary component", itemType: "COMPONENT" },
  ],
  demands: [
    { itemId: "closed", quantity: 9, status: "CLOSED" },
    { itemId: "zero", quantity: 0, status: "OPEN" },
    { itemId: "invalid", quantity: "not-a-number", status: "OPEN" },
    { itemId: "negative", quantity: -4, status: "OPEN" },
  ],
})));
assert.deepEqual(ignoredDemand.map((item) => item.sku), ["E-ORDINARY"], "closed, zero, invalid, and negative demand must not create actionable product requirements");
assert.equal(ignoredDemand[0]?.requiredQuantity, null);

const recursive = snapshotResponseToSourcingItems(response(emptySnapshot({
  items: [
    { id: "assembly", itemKey: "ASSEMBLY", sku: "A-ASSEMBLY", name: "Assembly", itemType: "PRODUCT" },
    { id: "module", itemKey: "MODULE", sku: "B-MODULE", name: "Module", itemType: "SUBASSEMBLY" },
    { id: "chip", itemKey: "CHIP", sku: "C-CHIP", name: "Chip", itemType: "COMPONENT" },
    { id: "ignored", itemKey: "IGNORED", sku: "D-IGNORED", name: "Ignored line", itemType: "COMPONENT" },
  ],
  locations: [{ id: "plant", name: "Austin plant" }],
  bomVersions: [
    {
      id: "assembly-bom",
      productItemId: "assembly",
      lines: [
        { id: "module-line", componentItemId: "module", quantity: 2, unitOfMeasure: "EA" },
        { id: "zero-line", componentItemId: "ignored", quantity: 0, unitOfMeasure: "EA" },
      ],
    },
    {
      id: "module-bom",
      productItemId: "module",
      lines: [{ id: "chip-line", componentItemId: "chip", quantity: 3, unitOfMeasure: "EA" }],
    },
    {
      id: "chip-bom",
      productItemId: "chip",
      lines: [
        { id: "cycle-line", componentItemId: "assembly", quantity: 5, unitOfMeasure: "EA" },
        { id: "invalid-line", componentItemId: "ignored", quantity: "invalid", unitOfMeasure: "EA" },
      ],
    },
  ],
  demands: [{
    itemId: "assembly",
    locationId: "plant",
    quantity: 4,
    unitOfMeasure: "SET",
    dueAt: "2026-10-03T23:30:00.000Z",
    status: "OPEN",
  }],
})));
const recursiveBySku = new Map(recursive.map((item) => [item.sku, item]));
assert.deepEqual({
  assembly: recursiveBySku.get("A-ASSEMBLY")?.requiredQuantity,
  module: recursiveBySku.get("B-MODULE")?.requiredQuantity,
  chip: recursiveBySku.get("C-CHIP")?.requiredQuantity,
  ignored: recursiveBySku.get("D-IGNORED")?.requiredQuantity,
}, {
  assembly: 4,
  module: 8,
  chip: 24,
  ignored: null,
}, "nested BOM demand must multiply through each level, skip invalid lines, and break cycles before double counting");
for (const sku of ["A-ASSEMBLY", "B-MODULE", "C-CHIP"]) {
  assert.equal(recursiveBySku.get(sku)?.deliveryLocation, "Austin plant");
  assert.equal(recursiveBySku.get(sku)?.needByDate, "2026-10-03");
}

console.log("Supply OS sourcing projection behavior passed.");
