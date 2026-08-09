import assert from "node:assert/strict";
import { supplyDataAdapters } from "../src/lib/supply-os/adapters";
import {
  detectSupplyCsvKind,
  normalizeSupplyCsvBundle,
  SUPPLY_CSV_KINDS,
  supplyCsvTemplate,
} from "../src/lib/supply-os/csv-import";

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
