import assert from "node:assert/strict";
import { buildLoadIntelBrief, type LoadIntelBriefRecord } from "./load-intel-brief";

const record: LoadIntelBriefRecord = {
  reference: "OM-O1-AUG2026-SHA-LAX",
  title: "Olympian Motors: 2 Model O1 prototype EVs",
  status: "QUOTED",
  mode: "SEA-FCL",
  origin: "Shanghai, China",
  destination: "Irvine, California, United States",
  commodity: "2 prototype Model O1 Coupe electric vehicles",
  incoterms: null,
  weight: null,
  volume: null,
  packages: null,
  dimensions: null,
  stackable: "UNKNOWN",
  dangerousGoods: "YES",
  customsBy: "UNKNOWN",
  containerCount: 1,
  containerType: "40HC",
  quantity: 2,
  quantityUnit: "UNITS",
  declaredValue: null,
  declaredValueCurrency: null,
  etd: null,
  eta: null,
  company: { name: "Olympian Motors" },
  inquiry: {
    reference: "OM-O1-AUG2026-SHA-LAX",
    mode: "SEA-FCL",
    origin: "Shanghai, China",
    destination: "Irvine, California, United States",
    commodity: "2 prototype Model O1 Coupe electric vehicles",
    incoterms: null,
    weight: null,
    volume: null,
    packages: null,
    dimensions: null,
    stackable: "UNKNOWN",
    dangerousGoods: "YES",
    customsBy: "UNKNOWN",
    containerCount: 1,
    containerType: "40HC",
    declaredValue: null,
    declaredValueCurrency: null,
    cargoReadyDate: "2026-08-27T00:00:00.000Z",
    parsedData: JSON.stringify({
      facts: {
        countryOfExport: "China",
        portOfLoading: "Shanghai",
        portOfUnlading: "Los Angeles",
        finalDelivery: "Irvine, California",
        intendedUse:
          "Demo and display, planned return to China. Tax ID 12-3456789",
        batteriesInstalled: "Yes",
        packaging: "Supplier says bare; forwarder requests wrap and foam",
        manufacturer: "Factory contact jane@example.com",
        returnPlan: "No ATA. Portal https://private.example.test",
        proposedHts10: "8703800090",
      },
      rawEmailBody: "This raw email must never appear.",
      contactPhone: "+1 (949) 555-0142",
      taxId: "12-3456789",
      credentials: "api_key=do-not-copy",
    }),
  },
};

const brief = buildLoadIntelBrief(record);

for (const expected of [
  "Shipment: OM-O1-AUG2026-SHA-LAX",
  "Customer: Olympian Motors",
  "Port of loading: Shanghai",
  "Port of unlading: Los Angeles",
  "Container: 1 x 40HC",
  "Quantity: 2 UNITS",
  "Cargo ready: 2026-08-27",
  "Batteries installed: Yes",
  "Proposed HTS: 8703800090",
]) {
  assert.ok(brief.includes(expected), `brief contains ${expected}`);
}

for (const forbidden of [
  "This raw email must never appear.",
  "+1 (949) 555-0142",
  "12-3456789",
  "do-not-copy",
  "jane@example.com",
  "https://private.example.test",
]) {
  assert.equal(brief.includes(forbidden), false, `brief omits ${forbidden}`);
}

assert.ok(brief.includes("[email omitted]"));
assert.ok(brief.includes("[link omitted]"));
assert.equal(brief.includes("\u2014"), false);

const dossierArrayBrief = buildLoadIntelBrief({
  ...record,
  inquiry: {
    ...record.inquiry!,
    parsedData: JSON.stringify({
      source: "manual_email_dossier",
      loadDossier: {
        version: 1,
        sourceKey: "OM-O1-AUG2026-SHA-LAX",
        portOfLoading: "Shanghai",
        portOfDischarge: "Los Angeles",
        finalDelivery: "Irvine, California",
        facts: [
          { key: "intendedUse", value: "Demo and display, return to China" },
          { key: "batteriesInstalled", value: "Yes" },
          { key: "packaging", value: "Packaging method unresolved" },
        ],
      },
    }),
  },
});

assert.ok(dossierArrayBrief.includes("Port of loading: Shanghai"));
assert.ok(dossierArrayBrief.includes("Port of unlading: Los Angeles"));
assert.ok(dossierArrayBrief.includes("Final delivery: Irvine, California"));
assert.ok(dossierArrayBrief.includes("Intended use: Demo and display, return to China"));
assert.ok(dossierArrayBrief.includes("Batteries installed: Yes"));

console.log("Load Intel brief checks passed");
