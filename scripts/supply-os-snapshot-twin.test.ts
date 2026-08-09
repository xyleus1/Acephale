import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateTwinBuildability,
  snapshotResponseToTwinModel,
  type SupplyWorkspaceSnapshotResponse,
} from "../src/lib/supply-os/snapshot-twin";

const fixture: SupplyWorkspaceSnapshotResponse = {
  workspace: {
    id: "workspace-1",
    name: "Acme Factory",
    snapshots: [{
      id: "snapshot-7",
      version: 7,
      publishedAt: "2026-08-08T12:00:00.000Z",
      items: [
        { id: "robot", itemKey: "robot", sku: "R-100", name: "Warehouse robot", itemType: "PRODUCT" },
        { id: "camera", itemKey: "camera", mpn: "CAM-2", name: "Vision camera", category: "sensor" },
        { id: "guard", itemKey: "guard", name: "Optional safety guard", category: "frame" },
        { id: "subassembly", itemKey: "subassembly", name: "Nested vision assembly", itemType: "SUBASSEMBLY" },
      ],
      bomVersions: [
        {
          id: "root-bom",
          productItemId: "robot",
          revision: "D",
          lines: [
            { id: "camera-line", componentItemId: "camera", quantity: "2.000000", isOptional: false },
            { id: "guard-line", componentItemId: "guard", quantity: "1.000000", isOptional: true },
          ],
        },
        {
          id: "nested-bom",
          productItemId: "subassembly",
          revision: "1",
          lines: [{ id: "nested-camera-line", componentItemId: "camera", quantity: "1", isOptional: false }],
        },
      ],
      inventory: [
        {
          itemId: "camera",
          locationId: "austin",
          quantityOnHand: "18",
          quantityAllocated: "2",
          quantityInTransit: "1",
          quantityOnOrder: "1",
        },
        {
          itemId: "camera",
          locationId: "overflow",
          quantityOnHand: "2",
          quantityAllocated: "0",
          quantityInTransit: "0",
          quantityOnOrder: "0",
        },
      ],
      demands: [
        { itemId: "robot", quantity: "10", status: "OPEN" },
        { itemId: "robot", quantity: "99", status: "CLOSED" },
        { itemId: "subassembly", quantity: "50", status: "OPEN" },
      ],
      locations: [
        { id: "austin", name: "Austin plant" },
        { id: "overflow", name: "Overflow warehouse" },
      ],
      mediaAssets: [
        { itemId: "robot", kind: "PRODUCT_IMAGE", url: "https://assets.example.com/robot.png" },
      ],
    }],
  },
};

const model = snapshotResponseToTwinModel(fixture);
assert.ok(model, "a published top-level BOM must produce a product twin model");
assert.equal(model.productName, "Warehouse robot");
assert.equal(model.productPartNumber, "R-100");
assert.equal(model.productRevision, "D");
assert.equal(model.demandUnits, 10, "only open demand for the selected top-level product must count");
assert.equal(model.productImageUrl, "https://assets.example.com/robot.png");
assert.equal(model.items.length, 2, "only direct BOM components must appear in the first product view");

const camera = model.items.find((item) => item.id === "camera");
assert.ok(camera);
assert.equal(camera.quantityPerRobot, 2);
assert.equal(camera.onHand, 20, "inventory positions must aggregate across locations");
assert.equal(camera.allocated, 2);
assert.equal(camera.confirmedInbound, 2, "in-transit and on-order quantities must remain visibly combined");
assert.equal(camera.location, "Austin plant, Overflow warehouse");
assert.match(camera.recommendation, /published quantities cover/, "recommendations must follow quantity math, not fixture copy");

const guard = model.items.find((item) => item.id === "guard");
assert.equal(guard?.isOptional, true, "optional BOM lines must not silently constrain buildability");

const buildability = calculateTwinBuildability(model.items, model.demandUnits);
assert.deepEqual(buildability, {
  buildableNow: 9,
  buildableWithInbound: 10,
  gapToDemand: 0,
}, "buildability must use persisted demand, required BOM quantity, inventory, allocation, and inbound quantities");

const noBom = structuredClone(fixture);
noBom.workspace.snapshots[0].bomVersions = [];
assert.equal(snapshotResponseToTwinModel(noBom), null, "snapshots without a BOM must use the explicit fallback path");

const root = process.cwd();
const adapter = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-snapshot-twin.tsx"), "utf8");
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const shared = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-shared-workspace.tsx"), "utf8");
const twin = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.tsx"), "utf8");
const surface = `${adapter}\n${shell}\n${shared}\n${twin}`;

assert.match(adapter, /\/api\/supply-os\/workspaces\//, "the adapter must use the existing authenticated workspace endpoint");
assert.match(adapter, /body\.workspace\.id !== workspaceId/, "the adapter must reject a mismatched workspace response");
assert.match(shell, /onSelectionChange={handleWorkspaceSelection}/, "the selected shared workspace must drive the twin");
assert.match(twin, /Costs, lead times, and alternatives are not inferred/, "published snapshots must not invent unavailable decision inputs");
assert.match(twin, /item\.isOptional/, "optional parts must not constrain buildability");
assert.equal(surface.includes("\u2014"), false, "the snapshot twin surface must not contain an em dash");

console.log("Supply OS published snapshot twin contract passed.");
