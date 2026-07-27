import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  IMPORTGENIUS_PUBLIC_PREVIEW_CHECKED_DATE,
  IMPORTGENIUS_PUBLIC_PREVIEW_EVIDENCE,
  getImportGeniusPublicPreviewEvidence,
} from "../src/lib/intel/research/company-evidence";
import { resolveIntelSourceUse } from "../src/lib/intel/sources";

assert.equal(IMPORTGENIUS_PUBLIC_PREVIEW_CHECKED_DATE, "2026-07-22");
assert.equal(IMPORTGENIUS_PUBLIC_PREVIEW_EVIDENCE.length, 3);
assert.deepEqual(
  IMPORTGENIUS_PUBLIC_PREVIEW_EVIDENCE.map((evidence) => evidence.companyName),
  ["Relativity Space", "Joby Aviation", "Figure AI"]
);

for (const evidence of IMPORTGENIUS_PUBLIC_PREVIEW_EVIDENCE) {
  assert.equal(evidence.observationType, "company_profile");
  assert.equal(evidence.companyQualification, "not_assessed");
  assert.equal(evidence.leadQualification, "not_assessed");
  assert.ok(evidence.caveats.some((caveat) => caveat.includes("Manually reviewed public provider preview")));
  assert.ok(evidence.caveats.some((caveat) => caveat.includes("not complete shipment history")));
  assert.ok(evidence.caveats.some((caveat) => caveat.includes("Source checked 2026-07-22")));
  assert.equal(evidence.sources.length, 1);
  assert.equal(evidence.sources[0].sourceId, "importgenius");
  assert.equal(evidence.sources[0].fetchedAt, null);
  assert.equal(evidence.sources[0].reviewedAt, "2026-07-22T00:00:00.000Z");
  assert.equal(new URL(evidence.sources[0].sourceUrl).searchParams.has("key"), false);
  assert.doesNotThrow(() => resolveIntelSourceUse(evidence.sources[0]));
}

const relativity = IMPORTGENIUS_PUBLIC_PREVIEW_EVIDENCE.find(
  (evidence) => evidence.companyName === "Relativity Space"
);
assert.equal(relativity?.shipmentDate, "2025-02-16");
assert.equal(relativity?.weightKg, 9_886);
assert.equal(relativity?.containerCount, 1);
assert.deepEqual(relativity?.hsCodes, ["7604291090"]);

const figure = IMPORTGENIUS_PUBLIC_PREVIEW_EVIDENCE.find(
  (evidence) => evidence.companyName === "Figure AI"
);
assert.equal(figure?.originCountry, null, "conflicting preview origin is not presented as fact");
assert.equal(figure?.supplierName, null, "conflicting preview supplier detail is omitted");
assert.ok(figure?.caveats.some((caveat) => caveat.includes("conflicting")));

const joby = IMPORTGENIUS_PUBLIC_PREVIEW_EVIDENCE.find(
  (evidence) => evidence.companyName === "Joby Aviation"
);
assert.equal(joby?.supplierName, "Shimadzu Corporation");

const firstCopy = getImportGeniusPublicPreviewEvidence();
const secondCopy = getImportGeniusPublicPreviewEvidence();
firstCopy[0].caveats.push("test mutation");
firstCopy[0].sources[0].asOf = "changed";
assert.notEqual(firstCopy[0].caveats.length, secondCopy[0].caveats.length);
assert.equal(secondCopy[0].sources[0].asOf, secondCopy[0].shipmentDate);

for (const file of [
  "src/lib/intel/research/company-evidence.ts",
  "scripts/intel-company-evidence.test.ts",
]) {
  assert.equal(
    fs.readFileSync(path.join(process.cwd(), file), "utf8").includes("\u2014"),
    false,
    `${file} contains no em dash character`
  );
}

console.log("All Intel company-evidence checks passed");
