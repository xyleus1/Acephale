import assert from "node:assert/strict";
import {
  billOfMaterialsFacts,
  billOfMaterialsFactsText,
  stlPartFactsText,
} from "../src/lib/supply-os/context-document-facts";

const BOM_CSV = [
  '"Reference","Qty","Value","Footprint","Datasheet","DigiKey_Part_Number","MP"',
  '"+HV1,CS1,SCL1","3","TestPoint","TestPoint:TestPoint_Pad_1.0x1.0mm","~","",""',
  '"ACC1","1","BMA400","mods:QFN_BMA400_BOS","https://example.com/bma400.pdf","828-1081-2-ND","BMA400"',
  '"C13,C15","2","1uF-0201","Capacitor_SMD:C_0201_0603Metric","https://example.com/gmc.pdf","2571-ND","GMC02X5R104K10NT"',
  '"C19","1","4.7uF","Capacitor_SMD:C_0402_1005Metric","https://example.com/cl05.pdf","1276-ND","CL05A475KQ5NRNC"',
  '"J1","1","JST SH 4 pin","Connector_JST:SH_4pin","https://example.com/jst.pdf","455-ND","SM04B-SRSS-TB"',
  '"MEM1","1","W25Q128","Package_SON:WSON-8_5.2x6mm","https://example.com/w25q.pdf","W25Q-ND","W25Q128JVSIQ"',
  '"MCU1","1","XIAO nRF52840","module:Seeed_XIAO","https://example.com/xiao.pdf","","XIAO-NRF52840"',
  '"M1","1","Vibration motor","leads:Motor_2wire","~","","LRA-0832"',
].join("\n");

function main() {
  const facts = billOfMaterialsFacts(BOM_CSV);
  assert.ok(facts, "the header should be recognized as a bill of materials");
  assert.equal(facts.componentLines, 8);
  assert.equal(facts.placements, 11, "quantities are summed, not the row count");
  assert.equal(facts.distinctPartNumbers, 7, "empty and tilde part numbers are ignored");
  assert.deepEqual(
    facts.passivePackages,
    ["0201", "0402"],
    "the metric twin in C_0201_0603Metric is not a second imperial size",
  );
  assert.equal(facts.passivePackages[0], "0201", "the smallest passive drives assembly difficulty");
  assert.deepEqual(facts.finePitchPackages, ["QFN", "SON", "WSON"]);
  assert.equal(facts.connectorLines, 1);
  assert.deepEqual(facts.moduleLines, ["ACC1", "MCU1"]);
  assert.deepEqual(facts.handAttachedLines, ["M1"]);
  assert.equal(facts.testPointLines, 1);

  const text = billOfMaterialsFactsText(BOM_CSV) ?? "";
  assert.match(text, /Component lines: 8/);
  assert.match(text, /Smallest passive package: 0201/);
  assert.match(text, /Fine pitch or bottom terminated package families present: QFN, SON, WSON/);
  assert.match(text, /Lines with a custom or module footprint[^:]*: ACC1, MCU1/);

  assert.equal(
    billOfMaterialsFactsText("name,city\nAcme,Detroit\n"),
    null,
    "a plain table must not be described as a bill of materials",
  );
  assert.equal(billOfMaterialsFactsText('"Reference","Qty","Footprint"'), null, "a header with no rows yields no facts");

  const gluedHeaderFacts = billOfMaterialsFacts([
    '"Reference","Qty","Value","Footprint","Manufacturer_Part_Number"',
    '"C1","2","1uF","Capacitor_SMD:C_0402_1005Metric","CL05A475KQ5NRNC"',
    '"U1","1","W25Q128","Package_SON:WSON-8_5.2x6mm","W25Q128JVSIQ"',
  ].join("\n"));
  assert.equal(
    gluedHeaderFacts?.distinctPartNumbers,
    2,
    "an underscore glued part number column, as KiCad and DigiKey export it, still counts part numbers",
  );
  assert.equal(gluedHeaderFacts?.partNumberSource, "MANUFACTURER");

  const distributorOnly = [
    '"Reference","Qty","Value","Footprint","DigiKey_Part_Number"',
    '"C1","2","1uF","Capacitor_SMD:C_0402_1005Metric","1276-1052-1-ND"',
    '"U1","1","W25Q128","Package_SON:WSON-8_5.2x6mm","W25Q128JVSIQ-ND"',
  ].join("\n");
  assert.equal(billOfMaterialsFacts(distributorOnly)?.partNumberSource, "DISTRIBUTOR");
  assert.match(
    billOfMaterialsFactsText(distributorOnly) ?? "",
    /Distinct distributor part numbers: 2/,
    "a distributor only column must not be reported as manufacturer part numbers",
  );

  const part = stlPartFactsText({ dimensions: [280, 105, 11.83], triangles: 17_184 }) ?? "";
  assert.match(part, /Bounding box: 280 x 105 x 11\.83 in model units/);
  assert.match(part, /Smallest dimension, usually the part thickness: 11\.83/);
  assert.match(part, /allowance per side: 300 x 125 x 31\.83/);
  assert.equal(stlPartFactsText({ dimensions: [0, 0, 0], triangles: 0 }), null);

  console.log("Context document facts contract passed.");
}

main();
