import assert from "node:assert/strict";

async function main() {
  const {
    deriveSupplierSourcingCategory,
    isSourcingCategoryKey,
    parseSourcingProfileEnrichment,
    resolveSupplierSourcingCategory,
  } = await import("../src/lib/supply-os/supplier-sourcing-profile");
  const { qualifySupplierSite } = await import("../src/lib/supply-os/supplier-sourcing-category");

  const derived = deriveSupplierSourcingCategory({
    material: "Custom stainless steel hydraulic fittings, DIN 2353, 5000 pcs",
    specification: "DIN 2353 tube fittings",
    targetCountry: "Germany",
  });
  assert.ok(derived);
  assert.equal(derived.key, "derived:custom-stainless-steel-hydraulic-fitting");
  assert.equal(derived.source, "derived");
  assert.equal(derived.queries.length, 8);
  assert.ok(derived.queries.every((query) => /stainless steel hydraulic fittings/i.test(query)));
  assert.equal(derived.regions[0], "Germany");

  const curated = resolveSupplierSourcingCategory({
    material: "Turnkey 4-layer PCBA",
    specification: null,
    notes: null,
  });
  assert.equal(curated?.key, "pcba");
  assert.equal(curated?.source, "curated");
  assert.equal(deriveSupplierSourcingCategory({ material: "" }), null);
  assert.equal(deriveSupplierSourcingCategory({ material: "12345" }), null);

  const unicodeMaterial = deriveSupplierSourcingCategory({ material: "Stahlrohre für Möbel" });
  assert.ok(unicodeMaterial);
  assert.ok(isSourcingCategoryKey(unicodeMaterial.key));

  const specificationDerived = deriveSupplierSourcingCategory({
    material: "custom part",
    specification: "stainless steel hydraulic fittings DIN 2353",
  });
  assert.ok(specificationDerived);
  assert.ok(specificationDerived.queries.every((query) => /hydraulic fittings/i.test(query)));
  assert.ok(specificationDerived.request.test("stainless steel hydraulic fittings"));

  const evidence = [
    "Hydraulic Fittings Manufacturing produces stainless steel hydraulic fittings and tube adapters.",
    "Our factory is an OEM manufacturer with production capacity for metric and imperial assemblies.",
    "Customers can request a quote and submit drawings for prototype and production run work.",
    "Our ISO 9001 quality system supports traceability, inspection, and export documentation.",
    "Sales engineers discuss lead time, minimum order quantities, and worldwide shipping.",
  ].join(" ").padEnd(600, " ");
  assert.equal(
    qualifySupplierSite(derived!, {
      text: evidence,
      emails: ["sales@hydraulic-fittings.example"],
    }).state,
    "QUALIFIED",
  );
  assert.equal(
    qualifySupplierSite(derived!, {
      text: `${evidence} Add to cart for immediate checkout.`,
      emails: ["sales@hydraulic-fittings.example"],
    }).state,
    "REJECTED",
  );
  const missingProduct = qualifySupplierSite(derived!, {
    text: [
      "Our factory is an OEM manufacturer. Request a quote for your production run.",
      "ISO 9001 certified quality system and worldwide shipping are available.",
      "This published capability overview includes engineering and customer support details.",
    ].join(" ").repeat(8),
    emails: ["sales@hydraulic-fittings.example"],
  });
  assert.equal(missingProduct.state, "REJECTED");
  assert.match(missingProduct.reason, /no published evidence of product match/);

  const long = "x".repeat(81);
  const enrichment = parseSourcingProfileEnrichment({
    queries: Array.from({ length: 10 }, (_, index) => `query ${index}`),
    synonyms: ["tube adapter", "ignored\u2014term", long],
    disqualifierTerms: Array.from({ length: 10 }, (_, index) => `blocked ${index}`),
  });
  assert.ok(enrichment);
  assert.equal(enrichment.queries.length, 8);
  assert.equal(enrichment.synonyms.length, 1);
  assert.ok(enrichment.synonyms.every((value) => value.length <= 80 && !value.includes("\u2014")));
  assert.equal(enrichment.disqualifierTerms.length, 8);
  assert.equal(parseSourcingProfileEnrichment(null), null);
  assert.deepEqual(
    parseSourcingProfileEnrichment({ queries: [], synonyms: [], disqualifierTerms: [] }),
    { queries: [], synonyms: [], disqualifierTerms: [] },
  );

  const enriched = deriveSupplierSourcingCategory({
    material: "stainless steel fittings",
    enrichment: {
      queries: ["custom fitting search", "stainless steel fittings manufacturer"],
      synonyms: ["tube adapters"],
      disqualifierTerms: [],
    },
  });
  assert.ok(enriched);
  assert.deepEqual(
    enriched.queries.slice(8),
    ["custom fitting search", "stainless steel fittings manufacturer"],
  );
  assert.equal(new Set(enriched.queries).size, enriched.queries.length);

  console.log("supplier sourcing profile contract passed");
}

void main();
