import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeSourcingRequestDraft, missingSourcingFields, normalizeSourcingRequestDraft } from "../src/lib/supply-os/sourcing-request-contract";
import { adaptSupplyPartsCsv, normalizeSupplyCsvBundle } from "../src/lib/supply-os/csv-import";
import { GUILD_PROCUREMENT_BOM, REPRESENTATIVE_LIVE_RESEARCH_IDS } from "./fixtures/guild-procurement-bom";

assert.equal(GUILD_PROCUREMENT_BOM.length, 40, "the acceptance catalog must retain all 40 BOM lines");
assert.deepEqual(GUILD_PROCUREMENT_BOM.map((item) => item.id), Array.from({ length: 40 }, (_, index) => String(index + 1).padStart(3, "0")));
assert.equal(new Set(GUILD_PROCUREMENT_BOM.map((item) => item.id)).size, 40);

const csvCell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const suppliedShape = [
  ["Item", "Procurement description", "Example specification", "Qty", "Supplier deliverable / QA"],
  ...GUILD_PROCUREMENT_BOM.map((item) => [
    item.id,
    item.description,
    item.specification,
    item.quantity === null ? "As req." : `${item.quantity} ${item.unit ?? ""}`.trim(),
    item.supplierDeliverable,
  ]),
].map((row) => row.map(csvCell).join(",")).join("\n");
const importedCatalog = normalizeSupplyCsvBundle(adaptSupplyPartsCsv(suppliedShape).files, {
  now: new Date("2026-08-12T12:00:00.000Z"),
});
assert.deepEqual(importedCatalog.issues, [], "the complete 40-line customer table must import without a file-wide rejection");
assert.equal(importedCatalog.items.length, 40);
assert.deepEqual(
  importedCatalog.items.filter((item) => item.request?.quantity === null).map((item) => item.itemKey),
  ["027"],
  "only the explicit As req. row may retain an unknown quantity",
);
assert.deepEqual(
  importedCatalog.items.filter((item) => item.request?.unitOfMeasure === null).map((item) => item.itemKey),
  ["027"],
  "ordinary count, length, set, pair, lot, and package quantities must keep a usable unit",
);

const preservedDraft = mergeSourcingRequestDraft(
  normalizeSourcingRequestDraft({
    productName: "6061-T6 sheet",
    quantity: 4,
    unit: "blanks",
    specification: "2.0 mm nominal thickness",
    deliveryLocation: "Austin, TX",
    needByDate: "2026-10-15",
  }),
  normalizeSourcingRequestDraft({ productName: "6061-T6 aluminum sheet", sourceRegion: "United States" }),
);
assert.equal(preservedDraft.quantity, 4, "intake extraction must not erase a known quantity");
assert.equal(preservedDraft.specification, "2.0 mm nominal thickness", "intake extraction must not erase a known specification");
assert.equal(preservedDraft.needByDate, "2026-10-15", "intake extraction must not erase a known need-by date");
assert.equal(preservedDraft.productName, "6061-T6 aluminum sheet", "newly extracted facts should replace prior values");

for (const item of GUILD_PROCUREMENT_BOM) {
  assert.ok(item.description.length > 5 && item.description.length <= 240, `${item.id} description must fit the research API`);
  assert.ok(item.specification.length > 10 && item.specification.length <= 1_000, `${item.id} specification must fit the research API`);
  assert.ok(item.supplierDeliverable.length > 5, `${item.id} must define supplier QA evidence`);
  const missing = missingSourcingFields(normalizeSourcingRequestDraft({
    productName: item.description,
    quantity: item.quantity,
    unit: item.unit,
    specification: `${item.specification}. Supplier deliverable: ${item.supplierDeliverable}.`,
    sourceRegion: "Any region",
    deliveryLocation: "Austin, TX, United States",
    needByDate: "2026-10-15",
  }));
  if (item.expectedOutcome === "RESEARCHABLE") {
    assert.deepEqual(missing, [], `${item.id} should enter supplier research without clarification`);
  } else {
    assert.ok(missing.includes("quantity") && missing.includes("unit"), `${item.id} must ask for quantity and unit before research`);
  }
}

for (const id of REPRESENTATIVE_LIVE_RESEARCH_IDS) {
  const item = GUILD_PROCUREMENT_BOM.find((candidate) => candidate.id === id);
  assert.equal(item?.expectedOutcome, "RESEARCHABLE", `${id} must be runnable in the live acceptance batch`);
}

const liveRunnerSource = readFileSync(new URL("./supply-os-live-research-acceptance.ts", import.meta.url), "utf8");
assert.match(liveRunnerSource, /hasAttributableListingClaim/);
assert.match(liveRunnerSource, /attributable unverified listing claim with price, currency, unit, and one common source/);
assert.match(liveRunnerSource, /candidate\.price\.freshness !== "UNKNOWN"/);

console.log("Supply OS 40-line procurement BOM acceptance contract passed.");
