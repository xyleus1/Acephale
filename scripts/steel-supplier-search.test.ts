import assert from "node:assert/strict";
import {
  countSupportedEvidence,
  normalizeSteelSupplierSearch,
  normalizeSteelSupplierSearchInput,
  normalizeSteelSupplierVisuals,
} from "../src/lib/steel-supplier-search";

const official = "https://mill.example/products/hrc";
const registry = "https://registry.example/mill-company";
const result = normalizeSteelSupplierSearch({
  summary: "One attributable candidate found\u2014with open checks.",
  candidates: [
    {
      companyName: "Mill Company",
      website: "https://mill.example/",
      country: "Türkiye",
      roles: ["producer", "invented_role"],
      productFit: "Official product page lists hot-rolled coil.",
      evidenceSummary: "Identity and product capability have public support.",
      evidence: [
        { gate: "official_identity", status: "supported", detail: "Official site and registry agree.", sourceUrls: [official, registry] },
        { gate: "producer_status", status: "supported", detail: "Claim has no attributable source.", sourceUrls: ["https://invented.example/source"] },
        { gate: "product_capability", status: "supported", detail: "HRC is listed.", sourceUrls: [official] },
        { gate: "quality_system", status: "not_found", detail: "No current certificate found.", sourceUrls: [] },
        { gate: "export_market", status: "partial", detail: "Export evidence is indirect.", sourceUrls: [registry] },
      ],
      cautions: ["Capacity is not public."],
      nextVerification: "Request a current mill certificate and allocation evidence.",
      sourceUrls: [official, registry, "https://invented.example/source"],
    },
    {
      companyName: "Unsourced Supplier",
      website: "https://unsourced.example/",
      country: "Unknown",
      roles: ["trader"],
      productFit: "Unattributed.",
      evidenceSummary: "Unattributed.",
      evidence: [],
      cautions: [],
      nextVerification: "Verify.",
      sourceUrls: ["https://unsourced.example/"],
    },
  ],
  gaps: ["Commercial references remain private."],
  warnings: ["Candidates are not approved."],
}, [official, registry], "2026-08-07T12:00:00.000Z");

assert.equal(result.candidates.length, 1, "candidates without provider-attributed sources must be removed");
assert.equal(result.summary.includes("\u2014"), false, "model text must respect the repository character policy");
assert.deepEqual(result.candidates[0]?.roles, ["producer"], "unknown supplier roles must be discarded");
assert.deepEqual(result.candidates[0]?.sourceUrls, [official, registry], "invented citations must not survive normalization");
assert.equal(result.candidates[0]?.evidence.length, 5, "every candidate must expose the complete public evidence gate");
assert.equal(
  result.candidates[0]?.evidence.find((item) => item.gate === "producer_status")?.status,
  "partial",
  "a supported claim without an attributable source must be downgraded",
);
assert.equal(countSupportedEvidence(result.candidates[0]!), 2);
assert.deepEqual(result.visuals, [], "text-only normalization must remain compatible when image search returns nothing");

const visuals = normalizeSteelSupplierVisuals([
  {
    type: "image_result",
    image_url: "https://cdn.mill.example/factory.jpg",
    thumbnail_url: "https://cdn.mill.example/factory-thumb.jpg",
    source_website_url: "https://mill.example/about/factory",
    caption: "Mill Company hot rolling factory and production line",
  },
  {
    type: "image_result",
    image_url: "https://cdn.mill.example/factory-copy.jpg",
    thumbnail_url: "https://cdn.mill.example/factory-thumb.jpg",
    source_website_url: "https://mill.example/about/factory",
    caption: "Duplicate thumbnail for the same factory",
  },
  {
    type: "image_result",
    image_url: "https://images.example/iron-ore.jpg",
    thumbnail_url: "https://images.example/iron-ore-thumb.jpg",
    source_website_url: "https://geology.example/commodities/iron-ore",
    caption: "Iron ore fines ready for bulk handling",
  },
  {
    type: "image_result",
    image_url: "http://localhost/private.jpg",
    source_website_url: "https://mill.example/private",
    caption: "Invalid private image target",
  },
  {
    type: "image_result",
    image_url: "http://127.0.0.1/private.jpg",
    source_website_url: "https://mill.example/private",
    caption: "Invalid loopback image target",
  },
], result.candidates, "Iron ore");

assert.equal(visuals.length, 2, "duplicate and non-public image URLs must be removed");
assert.equal(visuals[0]?.candidateId, result.candidates[0]?.id, "official-domain factory images must attach to the candidate");
assert.equal(visuals[0]?.kind, "facility");
assert.equal(visuals[0]?.sourceDomain, "mill.example");
assert.equal(visuals[1]?.candidateId, null, "independent product images must stay separate from company ownership claims");
assert.equal(visuals[1]?.kind, "product");
assert.equal(visuals[1]?.subject, "Iron ore");

const publicInput = normalizeSteelSupplierSearchInput({
  segment: "raw_material",
  product: "Hot-rolled coil",
  specification: "S355JR",
  quantity: "40,000 mt",
  targetMarket: "Türkiye",
  preferredRegions: "",
  commercialModel: "trade_or_representation",
  requirements: "Mill test certificate",
  confidentialOriginNotes: "Private supplier and origin relationship",
});

assert.equal("confidentialOriginNotes" in publicInput, false, "private origin context must not enter the public search contract");
assert.equal(publicInput.product, "Hot-rolled coil");

console.log("steel supplier search checks passed");
