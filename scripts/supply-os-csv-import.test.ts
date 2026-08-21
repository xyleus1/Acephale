import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { supplyDataAdapters } from "../src/lib/supply-os/adapters";
import {
  adaptSupplyPartsCsv,
  detectSupplyCsvKind,
  mergeSupplyPartsIntoSnapshot,
  normalizeSupplyCsvBundle,
  SUPPLY_CSV_KINDS,
  supplyCsvTemplate,
  supplyPartsCsvTemplate,
} from "../src/lib/supply-os/csv-import";
import { snapshotResponseToSourcingItems } from "../src/lib/supply-os/snapshot-sourcing";
import { resolveSupplyWorkspaceId } from "../src/lib/supply-os/workspace-selection";

const now = new Date("2026-08-08T12:00:00.000Z");
const validBundle = {
  locations: [
    "location_key,name,kind,country_code,latitude,longitude",
    "AUS,\"Austin, Assembly\",FACTORY,US,30.2672,-97.7431",
  ].join("\n"),
  items: [
    "item_key,external_id,sku,name,item_type,unit,manufacturer,mpn,gtin,approved_aliases,compliance_tags",
    "RADIO-1,ERP-2,RADIO-1,\"Radio \"\"Pro\"\" Module\",COMPONENT,each,Acme,RM-9,000123,legacy-radio|rm9,FCC|RoHS",
    "ROBOT-1,ERP-1,ROBOT-1,Warehouse Robot,PRODUCT,EA,Derya Robotics,DR-1,000111,,",
  ].join("\n"),
  bom: "parent_item_key,component_item_key,quantity,unit,scrap_rate,make_or_buy\nROBOT-1,RADIO-1,1,EA,,BUY",
  inventory: "position_key,item_key,location_key,on_hand,allocated,in_transit,on_order,unit,as_of\nINV-1,RADIO-1,AUS,24,,,,EA,2026-08-07",
  demand: "demand_key,item_key,location_key,quantity,unit,due_at,priority\nDEM-1,ROBOT-1,AUS,30,EA,2026-09-01,",
  purchase_orders: "purchase_order_key,line_key,item_key,location_key,supplier_name,quantity,unit,expected_at,status\nPO-1,1,RADIO-1,AUS,Acme,10,EA,2026-08-20,OPEN",
  supplier_terms: "term_key,item_key,supplier_name,supplier_website,supplier_role,country_code,price,currency,moq,lead_time_days,evidence_url,observed_at\nTERM-1,RADIO-1,Acme,https://acme.example,manufacturer,US,42.5,USD,10,21,https://acme.example/rm9,2026-08-01",
  compliance_records: "record_key,item_key,authority,standard,authorization_reference,integration_constraints,evidence_url,observed_at,review_state\nFCC-1,RADIO-1,FCC,Part 15,ABC-123,Host testing required,https://fcc.example/rule,2026-08-01,review_required",
} as const;

const valid = normalizeSupplyCsvBundle(validBundle, { now });
assert.deepEqual(valid.issues, []);
assert.equal(valid.schemaVersion, 2);
assert.equal(valid.items[0]?.itemKey, "RADIO-1", "normalized rows must have deterministic key ordering");
assert.equal(valid.items[0]?.name, 'Radio "Pro" Module');
assert.equal(valid.locations[0]?.name, "Austin, Assembly");
assert.equal(valid.locations[0]?.longitude, -97.7431);
assert.equal(valid.inventory[0]?.quantityOnHand, 24);
assert.equal(valid.inventory[0]?.quantityAllocated, null, "blank inventory quantities must remain unknown");
assert.equal(valid.bom[0]?.scrapRate, null, "blank scrap rates must remain unknown");
assert.equal(valid.supplierTerms[0]?.price, 42.5);
assert.equal(valid.supplierTerms[0]?.supplierRole, "MANUFACTURER");
assert.equal(valid.complianceRecords[0]?.reviewState, "REVIEW_REQUIRED");

const reordered = normalizeSupplyCsvBundle({
  ...validBundle,
  items: [validBundle.items.split("\n")[0]!, ...validBundle.items.split("\n").slice(1).reverse()].join("\n"),
}, { now });
assert.deepEqual(reordered, valid, "normalization must not depend on input row order");

const mapped = normalizeSupplyCsvBundle({
  locations: "Site ID,Site Name\nAUS,Austin",
  items: "Part ID,Part Name,UOM\nA,Assembly,EA",
}, {
  now,
  columnMappings: {
    locations: { location_key: "Site ID", name: "Site Name" },
    items: { item_key: "Part ID", name: "Part Name", unit: "UOM" },
  },
});
assert.deepEqual(mapped.issues, []);
assert.equal(mapped.items[0]?.itemKey, "A");

assert.equal(detectSupplyCsvKind(validBundle.bom), "bom");
assert.equal(detectSupplyCsvKind("foo,bar\n1,2"), null);
for (const kind of SUPPLY_CSV_KINDS) {
  assert.ok(supplyCsvTemplate(kind).startsWith(kind === "bom" ? "parent_item_key" : supplyCsvTemplate(kind).split(",")[0]));
  assert.equal(supplyCsvTemplate(kind).endsWith("\n"), true);
}
assert.equal(
  supplyPartsCsvTemplate(),
  "Item,Procurement description,Example specification,Qty,Supplier deliverable / QA\n",
);
assert.equal(resolveSupplyWorkspaceId({
  workspaces: [{ id: "customer-a" }, { id: "customer-b" }],
  fixedWorkspaceId: "customer-a",
  currentWorkspaceId: "customer-b",
}), "customer-a", "embedded import must stay pinned to the selected customer workspace");
assert.throws(() => resolveSupplyWorkspaceId({
  workspaces: [{ id: "customer-b" }],
  fixedWorkspaceId: "customer-a",
}), /no longer available/, "an inaccessible fixed workspace must fail closed instead of selecting another company");

const adaptedParts = adaptSupplyPartsCsv([
  "Item,Procurement description,Example specification,Qty,Supplier deliverable / QA",
  "001,Main cylindrical structural skin stock,6061-T6 sheet 2.0 mm,4 blanks,Material certificate",
  "017,Electrical hookup wire,22 AWG stranded copper wire with ETFE insulation,300 m total,Manufacturer/date code + CoC",
  "027,Inert subsystem mass simulator,Machined aluminum/steel ballast blocks,As req.,Actual measured mass + serial number",
].join("\n"));
assert.deepEqual(adaptedParts.issues, []);
const normalizedParts = normalizeSupplyCsvBundle(adaptedParts.files, { now });
assert.deepEqual(normalizedParts.issues, []);
assert.equal(normalizedParts.items.length, 3);
assert.equal(normalizedParts.locations.length, 0, "a parts list must not invent a delivery location");
assert.equal(normalizedParts.demand.length, 0, "a missing need-by date must remain a clarification, not a synthetic demand date");
assert.deepEqual(normalizedParts.items[0]?.request, {
  source: "PARTS_CSV",
  rawQuantity: "4 blanks",
  quantity: 4,
  unitOfMeasure: "EA",
  supplierDeliverable: "Material certificate",
  deliveryLocation: null,
  needByDate: null,
});
assert.equal(normalizedParts.items[1]?.request?.quantity, 300);
assert.equal(normalizedParts.items[1]?.request?.unitOfMeasure, "M");
assert.equal(normalizedParts.items[2]?.request?.quantity, null, "As req. must remain an unknown request quantity");
assert.equal(normalizedParts.items[2]?.request?.unitOfMeasure, null);
const ordinaryCounts = normalizeSupplyCsvBundle(adaptSupplyPartsCsv([
  "Item,Procurement description,Example specification,Qty,Supplier deliverable / QA",
  "007,Fasteners,Stainless screws,100 assorted,CoC",
  "023,Connectors,Matched circular connectors,8 mating pairs,Mating identification",
  "037,Caps,Protective caps,30,CoC",
  "040,Inspection,First article report,1 package,Signed report",
].join("\n")).files, { now });
assert.deepEqual(ordinaryCounts.issues, []);
assert.deepEqual(ordinaryCounts.items.map((item) => item.request?.unitOfMeasure), ["EA", "SET", "EA", "SET"]);
assert.match(normalizedParts.items[0]?.description ?? "", /Supplier deliverable: Material certificate/);
const incompleteParts = adaptSupplyPartsCsv("item_key,name,quantity\n001,Plate,4");
assert.deepEqual(incompleteParts.issues, [], "delivery location, need-by date, and unit are clarification fields");
const enrichedParts = normalizeSupplyCsvBundle(adaptSupplyPartsCsv([
  "item_key,name,quantity,unit,location_key,delivery_location,need_by_date",
  "001,Plate,4,EA,AUS,Austin TX,2026-09-05",
].join("\n")).files, { now });
assert.deepEqual(enrichedParts.issues, []);
assert.equal(enrichedParts.locations[0]?.name, "Austin TX");
assert.equal(enrichedParts.demand[0]?.quantity, 4, "complete optional delivery facts must still create normalized demand");

const existingSnapshot = {
  ...valid,
  locations: valid.locations.map((location) => ({
    ...location,
    timezone: "America/Chicago",
    sourceRefs: [{ source: "ERP", recordId: "location:AUS" }],
  })),
  items: [
    ...valid.items.map((item) => ({
      ...item,
      sku: item.itemKey === "RADIO-1" ? "ERP-RADIO-9" : item.sku,
      metadata: { lifecycle: "qualified" },
      sourceRefs: [{ source: "ERP", recordId: `item:${item.itemKey}` }],
    })),
    {
      ...valid.items[0]!,
      itemKey: "CABLE-1",
      sku: "CABLE-1",
      name: "Existing cable",
      unitOfMeasure: "M",
      metadata: { lifecycle: "qualified" },
      sourceRefs: [{ source: "ERP", recordId: "item:CABLE-1" }],
    },
  ],
  bom: valid.bom.map((line, index) => ({
    ...line,
    quantity: "1.000000",
    revision: "C",
    bomStatus: "ACTIVE",
    sourceSystem: "ERP",
    lineNumber: index + 10,
    bomSourceRefs: [{ source: "ERP", recordId: "bom:ROBOT-1:C" }],
    sourceRefs: [{ source: "ERP", recordId: `bom-line:${index + 10}` }],
  })),
  inventory: valid.inventory.map((position) => ({
    ...position,
    quantityOnHand: "24.000000",
    expectedReceiptAt: "2026-08-20T00:00:00.000Z",
    sourceRefs: [{ source: "ERP", recordId: `inventory:${position.positionKey}` }],
  })),
  demand: valid.demand.map((line) => ({
    ...line,
    quantity: "30.000000",
    status: "OPEN",
    sourceRefs: [{ source: "ERP", recordId: `demand:${line.demandKey}` }],
  })),
  snapshotMetadata: { sourceName: "ERP snapshot", correlationId: "erp-42" },
  snapshotSupplierTerms: [{
    termKey: "RADIO-1-current",
    itemKey: "RADIO-1",
    facilityKey: "AUS",
    supplierKey: "ACME",
    supplierName: "Acme",
    isCurrent: true,
    unitOfMeasure: "EA",
    currency: "USD",
    unitPrice: "42.000000",
    modeledFreightPerUnit: "1.000000",
    evidencedDutyPerUnit: "0.500000",
    dutyEvidenceRefs: [{ source: "broker", recordId: "duty-1" }],
    leadTimeMinDays: 2,
    leadTimeMaxDays: 4,
    availableQuantity: "10.000000",
    availableAt: "2026-08-15T00:00:00.000Z",
    evidenceRefs: [{ source: "quote", recordId: "quote-1" }],
    sourceRefs: [{ source: "ERP", recordId: "term-1" }],
  }],
  fccProfiles: [{
    itemKey: "RADIO-1",
    moduleAuthorization: "EVIDENCED",
    moduleAuthorizationEvidenceRefs: ["fcc-grant"],
    hostIntegrationConstraints: ["Host testing required"],
    labeling: "EVIDENCED",
    labelingEvidenceRefs: ["fcc-label"],
    rfExposure: "EVIDENCED",
    rfExposureEvidenceRefs: ["fcc-rf"],
    testing: "EVIDENCED",
    testingEvidenceRefs: ["fcc-test"],
    testingGaps: [],
    reviewRequirements: ["Review final host"],
    blockedReasons: [],
    sourceRefs: [{ source: "FCC", recordId: "profile-1" }],
  }],
  mediaAssets: [{
    mediaKey: "robot-photo-1",
    itemKey: "ROBOT-1",
    locationKey: "AUS",
    kind: "product-image",
    url: "https://media.example/robot.jpg",
    sourceUrl: "https://media.example/robot",
    sourcePageUrl: "https://media.example/catalog",
    creator: "Example Media",
    license: "licensed",
    attribution: "Example Media",
    contentHash: "robot-photo-1",
    width: 1600,
    height: 900,
    isPrimary: true,
    capturedAt: "2026-08-08T00:00:00.000Z",
  }],
};
const incomingParts = normalizeSupplyCsvBundle(adaptSupplyPartsCsv([
  "Item,Procurement description,Example specification,Qty,Supplier deliverable / QA",
  "ROBOT-1,Updated robot assembly,Existing product assembly,As req.,Assembly CoC",
  "RADIO-1,Updated radio module,Revision B qualified module,6 pcs,Updated CoC",
  "CABLE-1,Updated cable,Existing cable specification,As req.,Cable CoC",
  "FASTENER-1,Structural fastener,A2 stainless M5 cap screw,100 pcs,Lot CoC",
].join("\n")).files, { now });
const expandedSnapshot = mergeSupplyPartsIntoSnapshot(existingSnapshot, incomingParts, "parts-2026-08-12.csv");
assert.equal(expandedSnapshot.locations.length, 1, "parts must retain published locations");
assert.equal(expandedSnapshot.locations[0]?.timezone, "America/Chicago");
assert.equal(expandedSnapshot.items.length, 4, "parts must overlay stable itemKeys and add a new item");
assert.ok(expandedSnapshot.items.some((item) => item.itemKey === "ROBOT-1"), "unrelated published items must remain present");
const overlaidRadio = expandedSnapshot.items.find((item) => item.itemKey === "RADIO-1");
assert.equal(overlaidRadio?.name, "Updated radio module", "incoming item facts must overlay the same stable itemKey");
assert.equal(overlaidRadio?.manufacturer, "Acme", "an omitted parts field must not erase prior identity data");
assert.equal(overlaidRadio?.sku, "ERP-RADIO-9", "the adapter's copied item key must not replace a published SKU");
const overlaidRobot = expandedSnapshot.items.find((item) => item.itemKey === "ROBOT-1");
assert.equal(overlaidRobot?.itemType, "PRODUCT", "the adapter's default component type must not replace the published item type");
assert.equal((overlaidRadio?.metadata as { lifecycle?: string } | undefined)?.lifecycle, "qualified", "item metadata must survive an overlay");
assert.equal(overlaidRadio?.request?.quantity, 6);
const overlaidSourceRefs = Array.isArray(overlaidRadio?.sourceRefs) ? overlaidRadio.sourceRefs : [];
assert.ok(overlaidSourceRefs.some((ref) => (ref as { source?: string }).source === "ERP"), "the prior item source must remain attributable");
assert.ok(overlaidSourceRefs.some((ref) => (ref as { source?: string }).source === "CSV"), "the new parts source must be attributable");
const unknownUnitCable = expandedSnapshot.items.find((item) => item.itemKey === "CABLE-1");
assert.equal(unknownUnitCable?.request?.unitOfMeasure, null);
assert.equal(unknownUnitCable?.unitOfMeasure, "M", "an unknown requested unit must not replace a published unit with the adapter's EA storage fallback");
assert.equal(expandedSnapshot.bom.length, 1, "parts must retain published BOM lines");
assert.equal(expandedSnapshot.bom[0]?.revision, "C");
assert.equal(expandedSnapshot.bom[0]?.quantity, "1.000000", "retained decimal quantities must not lose precision during snapshot expansion");
assert.equal(expandedSnapshot.inventory.length, 1, "parts must retain published inventory");
assert.equal(expandedSnapshot.inventory[0]?.quantityOnHand, "24.000000");
assert.equal(expandedSnapshot.inventory[0]?.expectedReceiptAt, "2026-08-20T00:00:00.000Z");
assert.equal(expandedSnapshot.demand.length, 1, "parts must retain published demand");
assert.equal(expandedSnapshot.demand[0]?.quantity, "30.000000");
assert.equal(expandedSnapshot.demand[0]?.status, "OPEN");
assert.equal(expandedSnapshot.purchaseOrders.length, 1, "parts must retain published purchase orders");
assert.equal(expandedSnapshot.supplierTerms.length, 1, "parts must retain published supplier metadata");
assert.equal(expandedSnapshot.complianceRecords.length, 1, "parts must retain published compliance metadata");
assert.equal(expandedSnapshot.snapshotSupplierTerms?.length, 1, "parts must retain relational supplier terms used by planning");
assert.equal(expandedSnapshot.snapshotSupplierTerms?.[0]?.facilityKey, "AUS", "supplier facilities must retain stable location references");
assert.deepEqual(expandedSnapshot.snapshotSupplierTerms?.[0]?.sourceRefs, [{ source: "ERP", recordId: "term-1" }]);
assert.equal(expandedSnapshot.fccProfiles?.length, 1, "parts must retain FCC profiles used by planning");
assert.equal(expandedSnapshot.fccProfiles?.[0]?.itemKey, "RADIO-1");
assert.deepEqual(expandedSnapshot.fccProfiles?.[0]?.sourceRefs, [{ source: "FCC", recordId: "profile-1" }]);
assert.equal(expandedSnapshot.mediaAssets?.length, 1, "parts must retain snapshot media used by the product twin");
assert.equal(expandedSnapshot.mediaAssets?.[0]?.itemKey, "ROBOT-1");
assert.equal(expandedSnapshot.mediaAssets?.[0]?.locationKey, "AUS");
assert.equal(expandedSnapshot.mediaAssets?.[0]?.attribution, "Example Media");
assert.equal((expandedSnapshot.snapshotMetadata as { correlationId?: string }).correlationId, "erp-42");
const expandedItemKeys = new Set(expandedSnapshot.items.map((item) => item.itemKey));
const expandedLocationKeys = new Set(expandedSnapshot.locations.map((location) => location.locationKey));
assert.ok(expandedSnapshot.bom.every((line) => expandedItemKeys.has(line.parentItemKey) && expandedItemKeys.has(line.componentItemKey)), "retained BOM references must resolve in the expanded snapshot");
assert.ok(expandedSnapshot.inventory.every((position) => expandedItemKeys.has(position.itemKey) && expandedLocationKeys.has(position.locationKey)), "retained inventory references must resolve in the expanded snapshot");
assert.ok(expandedSnapshot.demand.every((line) => expandedItemKeys.has(line.itemKey) && (!line.locationKey || expandedLocationKeys.has(line.locationKey))), "retained demand references must resolve in the expanded snapshot");

const sourcingItems = snapshotResponseToSourcingItems({
  workspace: {
    id: "workspace-1",
    name: "GUILD",
    snapshots: [{
      id: "snapshot-1",
      version: 3,
      publishedAt: "2026-08-12T12:00:00.000Z",
      items: [
        { id: "product", itemKey: "PRODUCT", name: "Test article", itemType: "PRODUCT", unitOfMeasure: "EA" },
        {
          id: "plate",
          itemKey: "001",
          sku: "001",
          name: "6061-T6 plate",
          description: "2 mm mill finish",
          itemType: "COMPONENT",
          unitOfMeasure: "EA",
          metadata: {
            request: {
              source: "PARTS_CSV",
              quantity: 4,
              unitOfMeasure: "EA",
              deliveryLocation: null,
              needByDate: null,
            },
          },
        },
      ],
      bomVersions: [{
        id: "bom-1",
        productItemId: "product",
        revision: "1",
        lines: [{ id: "line-1", componentItemId: "plate", quantity: 4, unitOfMeasure: "EA" }],
      }],
      inventory: [{ itemId: "plate", locationId: "austin", quantityOnHand: 3, quantityAllocated: 0, quantityInTransit: 0, quantityOnOrder: 0 }],
      demands: [{ itemId: "product", locationId: "austin", quantity: 2, unitOfMeasure: "EA", dueAt: "2026-09-05T12:00:00.000Z" }],
      locations: [{ id: "austin", name: "Austin, TX" }],
      mediaAssets: [],
    }],
  },
});
assert.equal(sourcingItems[0]?.sku, "001");
assert.equal(sourcingItems[0]?.requiredQuantity, 8, "published BOM demand must become a sourceable component requirement");
assert.equal(sourcingItems[0]?.needByDate, "2026-09-05");
assert.equal(sourcingItems[0]?.deliveryLocation, "Austin, TX");

const directPartsSourcing = snapshotResponseToSourcingItems({
  workspace: {
    id: "workspace-2",
    name: "GUILD parts",
    snapshots: [{
      id: "snapshot-2",
      version: 1,
      items: normalizedParts.items.map((item, index) => ({
        id: `item-${index}`,
        itemKey: item.itemKey,
        sku: item.sku,
        name: item.name,
        description: item.description,
        itemType: item.itemType,
        unitOfMeasure: item.unitOfMeasure,
        metadata: { request: item.request },
      })),
      bomVersions: [],
      inventory: [],
      demands: [],
      locations: [],
      mediaAssets: [],
    }],
  },
});
assert.equal(directPartsSourcing[0]?.requiredQuantity, 4);
assert.equal(directPartsSourcing[0]?.unitOfMeasure, "EA");
assert.equal(directPartsSourcing[0]?.deliveryLocation, null);
assert.equal(directPartsSourcing[0]?.needByDate, null);
assert.equal(directPartsSourcing[1]?.requiredQuantity, 300);
assert.equal(directPartsSourcing[1]?.unitOfMeasure, "M");
assert.equal(directPartsSourcing[2]?.requiredQuantity, null);
assert.equal(directPartsSourcing[2]?.unitOfMeasure, null, "As req. must not inherit the storage fallback unit");

const sharedWorkspaceSource = readFileSync(new URL("../src/app/dashboard/supply-os/supply-os-shared-workspace.tsx", import.meta.url), "utf8");
const supplyOsPageSource = readFileSync(new URL("../src/app/dashboard/supply-os/page.tsx", import.meta.url), "utf8");
const operatingShellSource = readFileSync(new URL("../src/app/dashboard/supply-os/supply-os-operating-shell.tsx", import.meta.url), "utf8");
const inventorySource = readFileSync(new URL("../src/app/dashboard/supply-os/supply-os-inventory-sourcing.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/app/dashboard/supply-os/supply-os-dashboard.tsx", import.meta.url), "utf8");
const persistenceSource = readFileSync(new URL("../src/lib/supply-os/persistence.ts", import.meta.url), "utf8");
assert.match(sharedWorkspaceSource, /One parts CSV/);
assert.match(sharedWorkspaceSource, /\/api\/supply-os\/templates\/parts/);
assert.match(supplyOsPageSource, /canImportSupplyData=\{currentUser\.role === "ADMIN" \|\| currentUser\.role === "MANAGER"\}/);
assert.match(operatingShellSource, /canImportSupplyData=\{canImportSupplyData\}/);
assert.match(inventorySource, /Import parts CSV/);
assert.match(inventorySource, /workspaceId && canImportSupplyData/);
assert.match(inventorySource, /<SupplyOsSharedWorkspace/);
assert.match(dashboardSource, /canImportSupplyData=\{canImportSupplyData\}/);
assert.match(dashboardSource, /snapshotResponseToSourcingItems/);
assert.match(dashboardSource, /items=\{inventoryItems\}/);
assert.match(persistenceSource, /item\.request \? \{ request: item\.request \}/, "parts request metadata must be persisted on SupplyItem");
assert.match(persistenceSource, /schemaVersion: normalized\.schemaVersion/, "import validation must report the schema version actually normalized");
assert.match(persistenceSource, /const partsListImport = input\.mode === "PARTS_CSV"/, "only the explicit one-file mode may expand a prior snapshot");
assert.match(persistenceSource, /latestPublishedSnapshotForParts\(context, workspaceId\)/, "parts staging must expand the latest authorized published snapshot");
assert.match(persistenceSource, /tx\.supplySupplierTerm\.create/, "expanded drafts must persist retained relational supplier terms");
assert.match(persistenceSource, /tx\.supplyFccProfile\.create/, "expanded drafts must persist retained FCC profiles");
assert.match(persistenceSource, /tx\.supplyMediaAsset\.create/, "expanded drafts must persist retained product-twin media");
assert.match(persistenceSource, /pg_advisory_xact_lock/, "snapshot version allocation and identical import creation must be serialized per workspace");
assert.match(persistenceSource, /partsMergeBaseSnapshotId/, "a stale staged parts merge must fail instead of hiding a newer published snapshot");
assert.match(persistenceSource, /maxWait: 5_000, timeout: 45_000/, "snapshot expansion must not use Prisma's five-second transaction default");
assert.equal(supplyDataAdapters.csv.status.available, true);
assert.equal(supplyDataAdapters.sap.status.available, false);
assert.equal(supplyDataAdapters.oracle.status.available, false);
async function verifyUnavailableAdapters() {
  await assert.rejects(() => supplyDataAdapters.sap.normalize(undefined as never), /no live connector/i);
}

const invalid = normalizeSupplyCsvBundle({
  locations: "location_key,name,latitude,longitude\nAUS,Austin,91,-181\nAUS,Duplicate,,",
  items: "item_key,external_id,sku,name,unit\nA,ERP-1,SKU-1,Assembly,EA\nB,ERP-1,SKU-2,Board,bananas",
  bom: "parent_item_key,component_item_key,quantity,unit\nA,B,1,EA\nB,A,-1,EA",
  inventory: "position_key,item_key,location_key,on_hand,unit,as_of\nI-1,MISSING,NOWHERE,-2,EA,2025-01-01",
  demand: "demand_key,item_key,quantity,unit,due_at\nD-1,A,0,EA,not-a-date",
  purchase_orders: "purchase_order_key,line_key,item_key,quantity,unit\nPO-1,1,MISSING,1,EA",
}, { now, staleInventoryAfterDays: 30 });

const codes = new Set(invalid.issues.map((value) => value.code));
for (const code of [
  "duplicate_id",
  "identity_collision",
  "bom_cycle",
  "broken_reference",
  "invalid_number",
  "invalid_unit",
  "invalid_coordinate",
  "invalid_date",
  "stale_inventory",
]) assert.ok(codes.has(code as never), `expected ${code}`);

const malformed = normalizeSupplyCsvBundle({
  locations: "location_key,name\nA,\"unclosed",
  items: "item_key,name,unit\nA,Assembly,EA,EXTRA",
}, { now });
assert.ok(malformed.issues.some((value) => value.code === "malformed_row" && value.file === "locations"));
assert.ok(malformed.issues.some((value) => value.code === "malformed_row" && value.file === "items"));

const missingHeaders = normalizeSupplyCsvBundle({ locations: "foo,bar\nA,Austin" }, { now });
assert.ok(missingHeaders.issues.some((value) => value.code === "missing_header"));

verifyUnavailableAdapters().then(() => {
  console.log("Supply OS CSV import contract passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
