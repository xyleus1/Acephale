import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  customerBaseIsReady,
  customerBaseHasManagedProvenance,
  normalizeCustomerBase,
  removeSupplyItemFromSnapshot,
  validCalendarDate,
} from "../src/lib/supply-os/workspace-management";
import type { NormalizedSupplyCsvBundle } from "../src/lib/supply-os/csv-import";

assert.equal(customerBaseIsReady(null), false);
assert.equal(customerBaseIsReady({ name: "Plant", addressLine: "1 Main St", city: "Austin", countryCode: "US" }), true);
assert.equal(customerBaseHasManagedProvenance([{ source: "CSV", kind: "base" }]), false);
assert.equal(customerBaseHasManagedProvenance([{ source: "CUSTOMER_MANAGED", kind: "base" }]), true);
assert.equal(validCalendarDate("2026-09-30"), true);
assert.equal(validCalendarDate("2026-02-30"), false);
assert.equal(validCalendarDate("2026-99-99"), false);
assert.deepEqual(normalizeCustomerBase({
  name: "  Main   plant ",
  addressLine: " 1 Main St ",
  city: " Austin ",
  region: " TX ",
  postalCode: " 78701 ",
  countryCode: "us",
}), {
  name: "Main plant",
  addressLine: "1 Main St",
  city: "Austin",
  region: "TX",
  postalCode: "78701",
  countryCode: "US",
});
assert.throws(
  () => normalizeCustomerBase({ name: "Plant", addressLine: "", city: "Austin", countryCode: "US" }),
  /required/i,
);

const snapshot: NormalizedSupplyCsvBundle = {
  schemaVersion: 2,
  locations: [{ locationKey: "base", name: "Base", kind: "FACTORY" }],
  items: [
    { itemKey: "KEEP", name: "Keep", itemType: "COMPONENT", unitOfMeasure: "EA", approvedAliases: [], complianceTags: [] },
    { itemKey: "DROP", name: "Drop", itemType: "COMPONENT", unitOfMeasure: "EA", approvedAliases: [], complianceTags: [] },
  ],
  bom: [{ parentItemKey: "KEEP", componentItemKey: "DROP", quantity: 1, unitOfMeasure: "EA", scrapRate: null, isOptional: false }],
  inventory: [{ positionKey: "drop-stock", itemKey: "DROP", locationKey: "base", unitOfMeasure: "EA", quantityOnHand: 1, quantityAllocated: 0, quantityInTransit: 0, quantityOnOrder: 0, asOf: "2026-08-23" }],
  demand: [{ demandKey: "drop-demand", itemKey: "DROP", quantity: 1, unitOfMeasure: "EA", dueAt: "2026-09-01", priority: null }],
  purchaseOrders: [{ purchaseOrderKey: "po", lineKey: "1", itemKey: "DROP", quantity: 1, unitOfMeasure: "EA" }],
  supplierTerms: [{ termKey: "term", itemKey: "DROP", supplierName: "Supplier", price: null, minimumOrderQuantity: null, leadTimeDays: null }],
  complianceRecords: [{ recordKey: "record", itemKey: "DROP", authority: "FCC", reviewState: "REVIEW_REQUIRED" }],
  issues: [],
  snapshotSupplierTerms: [{ termKey: "saved-term", itemKey: "DROP", supplierKey: "supplier", supplierName: "Supplier", isCurrent: true, unitOfMeasure: "EA", unitPrice: null, modeledFreightPerUnit: null, evidencedDutyPerUnit: null, leadTimeMinDays: null, leadTimeMaxDays: null, availableQuantity: null }],
  fccProfiles: [{ itemKey: "DROP", moduleAuthorization: "unknown", labeling: "unknown", rfExposure: "unknown", testing: "unknown" }],
  mediaAssets: [{ mediaKey: "media", itemKey: "DROP", kind: "image", url: "https://example.test/image", sourceUrl: "https://example.test", isPrimary: true }],
};
const revised = removeSupplyItemFromSnapshot(snapshot, "DROP");
assert.deepEqual(revised.items.map((item) => item.itemKey), ["KEEP"]);
assert.equal(revised.locations.length, 1);
assert.equal(revised.bom.length, 0);
assert.equal(revised.inventory.length, 0);
assert.equal(revised.demand.length, 0);
assert.equal(revised.purchaseOrders.length, 0);
assert.equal(revised.supplierTerms.length, 0);
assert.equal(revised.complianceRecords.length, 0);
assert.equal(revised.snapshotSupplierTerms?.length, 0);
assert.equal(revised.fccProfiles?.length, 0);
assert.equal(revised.mediaAssets?.length, 0);

const settingsPage = readFileSync("src/app/dashboard/settings/page.tsx", "utf8");
const customerSettings = readFileSync("src/app/dashboard/settings/customer-settings.tsx", "utf8");
const dashboard = readFileSync("src/app/dashboard/supply-os/supply-os-dashboard.tsx", "utf8");
assert.match(settingsPage, /session\.accessKind === "customer"/);
assert.match(settingsPage, /restrictedWorkspaceIds\?\.includes\(query\.workspaceId\)/);
assert.doesNotMatch(customerSettings, /SettingsHeader|Connected emails|Integrations|Customer management/);
assert.match(dashboard, /Public company research cannot unlock it/);
assert.match(dashboard, /!logisticsSettings\.logisticsReady/);

console.log("Supply OS workspace management test passed.");
