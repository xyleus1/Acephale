import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CHINA_HARDWARE_EXTRACTION_MODEL,
  extractChinaHardwareLoad,
  parseLabeledChinaHardwareLoadFallback,
} from "../src/lib/intel/preflight/extract-china-import";

const extractorSource = fs.readFileSync(
  new URL(
    "../src/lib/intel/preflight/extract-china-import.ts",
    import.meta.url
  ),
  "utf8"
);

assert.equal(CHINA_HARDWARE_EXTRACTION_MODEL, "gpt-5.6");
assert.match(extractorSource, /process\.env\.OPENAI_API_KEY/);
assert.match(extractorSource, /client\.responses\.parse/);
assert.match(extractorSource, /zodTextFormat/);
assert.match(extractorSource, /store: false/);
assert.match(extractorSource, /timeout: 45_000/);
assert.match(extractorSource, /maxRetries: 1/);
assert.doesNotMatch(extractorSource, /ANTHROPIC_API_KEY/);
assert.doesNotMatch(extractorSource, /claude-haiku/);

const fullBrief = `Shipment: CN-ROUTER-0726
Product: industrial edge router with Wi-Fi and LTE
Model: XR-500
Manufacturer: Shenzhen Example Networks Co.
Principal function: routes industrial network traffic
Intended use: factory automation gateway
Country of export: China
Claimed customs origin: China
Port of loading: Yantian
Port of unlading: Long Beach
Final destination: Fremont, California
Container: 1 x 40HC
Gross weight: 8,400 kg
Invoice value: USD 285,000.50
Incoterm: FOB Yantian
Expected entry: 2026-07-31T10:00:00-04:00
Actual entry: 2026-08-01T11:30:00-04:00
Entry event: entry for consumption
Proposed HTS: 8517.62.0090
Importer: Example Robotics, Inc.
Broker: Example Customs Brokerage
Contains lithium backup batteries and uses solid wood pallets.`;

const parsed = parseLabeledChinaHardwareLoadFallback(fullBrief);

assert.equal(parsed.shipmentReference, "CN-ROUTER-0726");
assert.equal(
  parsed.product.description,
  "industrial edge router with Wi-Fi and LTE"
);
assert.equal(parsed.product.model, "XR-500");
assert.equal(
  parsed.product.manufacturer,
  "Shenzhen Example Networks Co."
);
assert.equal(
  parsed.product.principalFunction,
  "routes industrial network traffic"
);
assert.equal(
  parsed.product.intendedUse,
  "factory automation gateway"
);
assert.equal(parsed.route.countryOfExport, "China");
assert.equal(parsed.route.customsCountryOfOrigin, "China");
assert.equal(parsed.route.portOfLoading, "Yantian");
assert.equal(parsed.route.portOfUnlading, "Long Beach");
assert.equal(parsed.route.finalDestination, "Fremont, California");
assert.equal(parsed.route.containerType, "1 x 40HC");
assert.equal(parsed.route.grossWeightKg, 8400);
assert.equal(parsed.route.incoterm, "FOB Yantian");
assert.equal(parsed.valuation.invoiceValue, 285000.5);
assert.equal(parsed.valuation.currency, "USD");
assert.equal(
  parsed.timing.expectedEntryAt,
  "2026-07-31T10:00:00-04:00"
);
assert.equal(
  parsed.timing.actualEntryAt,
  "2026-08-01T11:30:00-04:00"
);
assert.equal(parsed.timing.entryEvent, "entry_for_consumption");
assert.equal(parsed.product.proposedHts10, "8517620090");
assert.equal(parsed.parties.importerOfRecord, "Example Robotics, Inc.");
assert.equal(
  parsed.parties.customsBroker,
  "Example Customs Brokerage"
);
assert.equal(parsed.agencyScreens.lithium_battery, "yes");
assert.equal(parsed.agencyScreens.solid_wood_packaging, "yes");
assert.equal(
  Object.values(parsed.fieldProvenance).every(
    (provenance) => provenance.basis === "supplier_statement"
  ),
  true,
  "every locally parsed fact remains a supplier statement"
);
assert.equal(
  Object.values(parsed.fieldProvenance).some(
    (provenance) =>
      provenance.basis === "operator_confirmed" ||
      provenance.basis === "ai_extracted"
  ),
  false
);

const negativeFeatures = parseLabeledChinaHardwareLoadFallback(
  `Product: benchtop power supply
Lithium batteries: No
Solid wood pallets: No
The shipment does not contain lithium batteries and is packed without solid wood pallets.`
);
assert.equal(
  Object.values(negativeFeatures.agencyScreens).every(
    (value) => value === "unknown"
  ),
  true,
  "explicit negatives remain unknown instead of becoming inferred no values"
);
assert.equal(
  Object.keys(negativeFeatures.fieldProvenance).some((path) =>
    path.startsWith("agencyScreens.")
  ),
  false
);

const contractedNegative = parseLabeledChinaHardwareLoadFallback(
  "The shipment doesn't contain lithium batteries."
);
assert.equal(contractedNegative.agencyScreens.lithium_battery, "unknown");

const exportOnly = parseLabeledChinaHardwareLoadFallback(
  `Country of export: China
Product: motor controller`
);
assert.equal(exportOnly.route.countryOfExport, "China");
assert.equal(
  exportOnly.route.customsCountryOfOrigin,
  null,
  "country of export never fills customs origin"
);

const unlabeled = parseLabeledChinaHardwareLoadFallback(
  "Please move one container of controllers from Shenzhen to California."
);
assert.equal(unlabeled.product.description, null);
assert.equal(unlabeled.route.countryOfExport, null);
assert.equal(
  Object.keys(unlabeled.fieldProvenance).length,
  0,
  "unlabeled prose does not become a shipment fact"
);

const unsafeWeightUnit = parseLabeledChinaHardwareLoadFallback(
  `Product: machine vision camera
Gross weight: 18,500 lb
Invoice value: 95000
Currency: CNY`
);
assert.equal(
  unsafeWeightUnit.route.grossWeightKg,
  null,
  "the local parser does not silently convert pounds to kilograms"
);
assert.equal(unsafeWeightUnit.valuation.invoiceValue, 95000);
assert.equal(unsafeWeightUnit.valuation.currency, "CNY");

async function main() {
  const priorApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const localResult = await extractChinaHardwareLoad(fullBrief);
    assert.equal(localResult.input.shipmentReference, "CN-ROUTER-0726");
    assert.match(localResult.note ?? "", /No model was used/);
    assert.match(localResult.note ?? "", /parsed locally/);
    assert.match(localResult.note ?? "", /No shipment text or assessment was persisted/);
  } finally {
    if (priorApiKey == null) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = priorApiKey;
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      parsedFields: Object.keys(parsed.fieldProvenance).length,
      positiveScreens: [
        parsed.agencyScreens.lithium_battery,
        parsed.agencyScreens.solid_wood_packaging,
      ],
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
