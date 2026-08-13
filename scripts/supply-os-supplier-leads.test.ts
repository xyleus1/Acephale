import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  normalizeOpenAiSupplierResponse,
  SupplierResearchError,
} from "../src/lib/supply-os/component-supplier-research";
import {
  searchExaComponentSuppliers,
  validateExaPublicSupplierLeadReceipts,
  type ExaRetrievalCapture,
  type ExaSupplierResearchInput,
} from "../src/lib/supply-os/exa-supplier-research";
import {
  buildSupplierResearchQueryPlan,
  normalizeSupplierResearch,
  selectedSupplierResearchQueryVariant,
  supplierCompanyMatchesDomain,
} from "../src/lib/supply-os/research";
import { GUILD_SOURCING_LINES } from "../src/lib/supply-os/guild-sourcing-items";

const materialPlan = buildSupplierResearchQueryPlan({
  componentName: "Main cylindrical structural skin stock",
  specification: "6061-T6 aluminum sheet, 2.0 mm, cut-to-size blanks. Supplier QA: material certificate",
  sourceRegion: "Any region",
});
assert.equal(materialPlan.profile, "MATERIAL_STOCK");
assert.deepEqual(materialPlan.variants.map((variant) => variant.id), [
  "exact-identity",
  "official-catalog",
  "capability-qa",
]);
assert.match(materialPlan.variants[0]?.query ?? "", /service center stockist processor cut to size/i);
assert.match(materialPlan.variants[2]?.query ?? "", /material certificate lot traceability/i);

assert.equal(buildSupplierResearchQueryPlan({
  componentName: "Bonding epoxy",
  specification: "3M Scotch-Weld DP420 two-part structural epoxy",
}).profile, "BRANDED_COTS");
assert.equal(buildSupplierResearchQueryPlan({
  componentName: "Ground data-acquisition harness",
  specification: "Bench-test harness assembly with pin-to-pin report",
}).profile, "ASSEMBLY_SERVICE");
assert.equal(buildSupplierResearchQueryPlan({
  componentName: "Temperature instrumentation",
  specification: "PT100 RTD, 3-wire, calibration certificate",
}).profile, "CALIBRATED_INSTRUMENT");
assert.equal(buildSupplierResearchQueryPlan({
  componentName: "Shipping protection",
  specification: "Closed-cell foam, antistatic bags, humidity indicators, reusable shipping case",
}).profile, "PACKAGING");
const guildLineProfiles = new Map(GUILD_SOURCING_LINES.map((line) => [
  line.sku,
  buildSupplierResearchQueryPlan({
    componentName: line.name,
    specification: `${line.specification}. Supplier QA: ${line.deliverable}.`,
  }).profile,
]));
assert.equal(guildLineProfiles.size, 40, "every GUILD line must have a deterministic query profile");
assert.equal(guildLineProfiles.get("GUILD-002"), "MATERIAL_STOCK", "QA inspection wording must not turn aluminum stock into an inspection service");
assert.equal(guildLineProfiles.get("GUILD-024"), "CUSTOM_FABRICATION", "a machined enclosure remains fabrication work even when its QA deliverable is an inspection report");
assert.equal(guildLineProfiles.get("GUILD-040"), "INSPECTION_SERVICE", "the standalone first-article package is an inspection service");
assert.equal(selectedSupplierResearchQueryVariant({
  componentName: "Bonding epoxy",
  specification: "3M Scotch-Weld DP420 structural epoxy",
  queryVariant: "official-catalog",
}).selected?.id, "official-catalog");
assert.equal(selectedSupplierResearchQueryVariant({
  componentName: "Bonding epoxy",
  queryVariant: "browser-invented-variant",
}).selected, null, "unknown scheduler variants must fail closed");
assert.equal(supplierCompanyMatchesDomain("TCI Precision Metals", "https://tciprecision.com/materials/aluminum"), true);
assert.equal(supplierCompanyMatchesDomain("Texas Alloys & Tool Co.", "https://www.texasalloys.com/aluminum.html"), true);
assert.equal(supplierCompanyMatchesDomain("National Aluminum & Alloy", "https://nationalaa.com/products/aluminum-plate"), true);
assert.equal(supplierCompanyMatchesDomain("Fake Texas Alloys", "https://www.texasalloys.com/aluminum.html"), false, "a prefixed company name must not steal a matching trailing domain alias");

const guildOpenRoleUrl = "https://guildprocessor.example/capability";
const guildOpenRole = normalizeSupplierResearch({
  officeId: "office-test",
  workspaceId: "workspace-test",
  componentItemKey: "GUILD-024",
  providerSources: [{ url: guildOpenRoleUrl, sourceType: "PUBLIC" }],
  validatedSupplierLeadSourceUrls: [guildOpenRoleUrl],
  raw: {
    candidates: [{
      id: "processor-1",
      companyName: "Guild Processor",
      website: guildOpenRoleUrl,
      roles: ["PROCESSOR"],
      sourceUrls: [guildOpenRoleUrl],
      productCapability: { value: "Machined enclosure", state: "SUPPORTED", confidence: 1, sourceUrls: [guildOpenRoleUrl], observedAt: null },
      cautions: [],
    }],
    warnings: [],
  },
});
assert.deepEqual(guildOpenRole.candidates[0]?.roles, ["PROCESSOR"], "canonical GUILD requests must preserve validated open supplier roles");

const openAiInput = {
  officeId: "office-test",
  workspaceId: "workspace-test",
  componentItemKey: "GUILD-011",
  componentName: "Bonding epoxy",
};
const degraded = normalizeOpenAiSupplierResponse(openAiInput, {
  output_text: "not valid JSON",
  output: [{
    type: "web_search_call",
    action: {
      sources: [
        { type: "url", url: "https://acmeindustrial.example/catalog/dp420" },
        { type: "url", url: "https://en.wikipedia.org/wiki/Epoxy" },
        { type: "url", url: "https://www.reddit.com/r/adhesives/comments/example" },
        { type: "url", url: "http://127.0.0.1/private" },
      ],
    },
  }],
});
assert.equal(degraded.degraded, true);
assert.equal(degraded.sources.length, 1, "attributable public URLs must survive invalid final JSON");
assert.equal(degraded.sources[0]?.url, "https://acmeindustrial.example/catalog/dp420", "reference and community URLs must not survive degraded supplier discovery");
assert.equal(degraded.sources[0]?.sourceType, "PUBLIC");
assert.equal(degraded.candidates[0]?.status, "UNSUPPORTED");
assert.deepEqual(degraded.candidates[0]?.roles, []);
assert.equal(degraded.candidates[0]?.productCapability.state, "UNKNOWN");
assert.match(degraded.warnings.join(" "), /structured enrichment was invalid/i);
assert.throws(
  () => normalizeOpenAiSupplierResponse(openAiInput, { output_text: "{}", output: [] }),
  (error: unknown) => error instanceof SupplierResearchError && error.code === "INVALID_STRUCTURED_RESPONSE",
);

const exaInput: ExaSupplierResearchInput = {
  ...openAiInput,
  manufacturer: "3M",
  mpn: "DP420",
  specification: "3M Scotch-Weld DP420 two-part structural epoxy",
};
const sourceUrl = "https://acmeindustrial.example/catalog/dp420";
const companyIdentityEvidence = "Acme Industrial operates this official product catalog.";
const supplierRoleEvidence = "Acme Industrial is a distributor of industrial adhesives.";
const productCapabilityEvidence = "Acme Industrial distributes and supplies the 3M Scotch-Weld DP420 structural epoxy.";
const sourceText = [companyIdentityEvidence, supplierRoleEvidence, productCapabilityEvidence].join(" ");
const capture: ExaRetrievalCapture = {
  provider: "EXA",
  freshnessPolicy: "FORCED_LIVE",
  searchRequestId: "search-request-lead",
  contentsRequestId: "contents-request-lead",
  searchHttpStatus: 200,
  contentsHttpStatus: 200,
  searchResponseHash: "a".repeat(64),
  contentsResponseHash: "b".repeat(64),
  retrievedAt: new Date(Date.now() - 60_000).toISOString(),
  records: [{
    searchRank: 1,
    sourceId: "source-lead",
    sourceUrl,
    sourceTitle: "Acme Industrial DP420",
    status: {
      id: sourceUrl,
      status: "success",
      errorTag: null,
      httpStatusCode: 200,
      cacheState: null,
      cacheAgeHours: null,
    },
    publishedDate: null,
    text: sourceText,
    highlights: [],
    proposal: {
      supplierName: "Acme Industrial",
      supplierRole: "DISTRIBUTOR",
      companyIdentityEvidence,
      supplierRoleEvidence,
      productCapabilityEvidence,
      itemIdentity: "3M Scotch-Weld DP420 structural epoxy",
      manufacturer: "3M",
      mpn: "DP420",
      priceAmount: null,
      currency: null,
      unitOfMeasure: null,
      packageQuantity: null,
      evidenceText: null,
    },
    sourceTextHash: createHash("sha256").update(sourceText).digest("hex"),
  }],
};
function genericDistributorReceiptCount(input: ExaSupplierResearchInput, companyName: string, productCapability: string) {
  const hostname = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const url = `https://${hostname}.example/catalog`;
  const identity = `${companyName} operates this company catalog.`;
  const role = `${companyName} is a distributor.`;
  const source = [identity, role, productCapability].join(" ");
  return validateExaPublicSupplierLeadReceipts(input, {
    ...capture,
    records: [{
      ...capture.records[0]!,
      sourceUrl: url,
      status: { ...capture.records[0]!.status!, id: url },
      text: source,
      proposal: {
        supplierName: companyName,
        supplierRole: "DISTRIBUTOR",
        companyIdentityEvidence: identity,
        supplierRoleEvidence: role,
        productCapabilityEvidence: productCapability,
        itemIdentity: productCapability.replace(new RegExp(`^${companyName}\\s+(?:distributes|supplies)\\s+`, "i"), ""),
        manufacturer: null,
        mpn: null,
        priceAmount: null,
        currency: null,
        unitOfMeasure: null,
        packageQuantity: null,
        evidenceText: null,
      },
      sourceTextHash: createHash("sha256").update(source).digest("hex"),
    }],
  }).length;
}
const leadReceipts = validateExaPublicSupplierLeadReceipts(exaInput, capture);
assert.equal(leadReceipts.length, 1, "one forced-live page with all supplier gates should create one lead receipt");
assert.equal(leadReceipts[0]?.companyName, "Acme Industrial");
assert.equal(leadReceipts[0]?.role, "DISTRIBUTOR");
assert.equal(leadReceipts[0]?.productCapability, "3M Scotch-Weld DP420 structural epoxy");
assert.equal(validateExaPublicSupplierLeadReceipts(exaInput, {
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    sourceUrl: "https://unrelated.example/catalog/dp420",
    status: record.status ? { ...record.status, id: "https://unrelated.example/catalog/dp420" } : null,
  })),
}).length, 0, "explicit claims on a different company domain must not create a lead");
assert.equal(validateExaPublicSupplierLeadReceipts(exaInput, {
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    proposal: record.proposal ? { ...record.proposal, supplierRoleEvidence: "Acme Industrial sells many products." } : null,
  })),
}).length, 0, "a role proposal without an explicit role excerpt must fail closed");

const inspectionInput: ExaSupplierResearchInput = {
  ...openAiInput,
  componentItemKey: "request:guild-040",
  componentName: "First-article inspection package",
  specification: "Measurement report against released drawing for first production unit",
};
const inspectionUrl = "https://precisionmetrology.example/first-article-inspection";
const inspectionIdentity = "Precision Metrology operates this service website.";
const inspectionRole = "Precision Metrology is an inspection laboratory.";
const inspectionCapability = "Precision Metrology provides first-article inspection and measurement reports against released drawings.";
const inspectionText = [inspectionIdentity, inspectionRole, inspectionCapability].join(" ");
const inspectionCapture: ExaRetrievalCapture = {
  ...capture,
  records: [{
    ...capture.records[0]!,
    sourceUrl: inspectionUrl,
    sourceTitle: "Precision Metrology first-article inspection",
    status: { ...capture.records[0]!.status!, id: inspectionUrl },
    text: inspectionText,
    proposal: {
      supplierName: "Precision Metrology",
      supplierRole: "SERVICE_PROVIDER",
      companyIdentityEvidence: inspectionIdentity,
      supplierRoleEvidence: inspectionRole,
      productCapabilityEvidence: inspectionCapability,
      itemIdentity: "first-article inspection and measurement report",
      manufacturer: null,
      mpn: null,
      priceAmount: null,
      currency: null,
      unitOfMeasure: null,
      packageQuantity: null,
      evidenceText: null,
    },
    sourceTextHash: createHash("sha256").update(inspectionText).digest("hex"),
  }],
};
const inspectionReceipts = validateExaPublicSupplierLeadReceipts(inspectionInput, inspectionCapture);
assert.equal(inspectionReceipts.length, 1, "an explicit public inspection laboratory and exact capability page must support GUILD-040");
assert.equal(inspectionReceipts[0]?.role, "SERVICE_PROVIDER");

const connectorInput: ExaSupplierResearchInput = {
  ...openAiInput,
  componentItemKey: "request:guild-023",
  componentName: "Ground-test circular connectors",
  specification: "Industrial or aerospace-quality multipole circular connectors, metallic shell, positive locking, 8 to 12 contacts",
};
const connectorUrl = "https://acmeconnector.example/connectors";
const connectorIdentity = "Acme Connector operates this company website.";
const connectorRole = "Acme Connector is a distributor.";
const connectorCapability = "Acme Connector supplies connectors.";
const connectorText = [connectorIdentity, connectorRole, connectorCapability].join(" ");
assert.equal(validateExaPublicSupplierLeadReceipts(connectorInput, {
  ...capture,
  records: [{
    ...capture.records[0]!,
    sourceUrl: connectorUrl,
    status: { ...capture.records[0]!.status!, id: connectorUrl },
    text: connectorText,
    proposal: {
      supplierName: "Acme Connector",
      supplierRole: "DISTRIBUTOR",
      companyIdentityEvidence: connectorIdentity,
      supplierRoleEvidence: connectorRole,
      productCapabilityEvidence: connectorCapability,
      itemIdentity: "connectors",
      manufacturer: null,
      mpn: null,
      priceAmount: null,
      currency: null,
      unitOfMeasure: null,
      packageQuantity: null,
      evidenceText: null,
    },
    sourceTextHash: createHash("sha256").update(connectorText).digest("hex"),
  }],
}).length, 0, "a generic connector catalog must not count for the qualified GUILD-023 connector specification");

const materialInput: ExaSupplierResearchInput = {
  ...openAiInput,
  componentItemKey: "request:guild-001",
  componentName: "Main cylindrical structural skin stock",
  specification: "Aluminum alloy 6061-T6 sheet, 2.0 mm nominal thickness, mill finish",
};
const materialUrl = "https://genericmetal.example/aluminum";
const materialIdentity = "Generic Metal operates this company website.";
const materialRole = "Generic Metal is a distributor.";
const materialCapability = "Generic Metal supplies aluminum sheet.";
const materialText = [materialIdentity, materialRole, materialCapability].join(" ");
assert.equal(validateExaPublicSupplierLeadReceipts(materialInput, {
  ...capture,
  records: [{
    ...capture.records[0]!,
    sourceUrl: materialUrl,
    status: { ...capture.records[0]!.status!, id: materialUrl },
    text: materialText,
    proposal: {
      supplierName: "Generic Metal",
      supplierRole: "DISTRIBUTOR",
      companyIdentityEvidence: materialIdentity,
      supplierRoleEvidence: materialRole,
      productCapabilityEvidence: materialCapability,
      itemIdentity: "aluminum sheet",
      manufacturer: null,
      mpn: null,
      priceAmount: null,
      currency: null,
      unitOfMeasure: null,
      packageQuantity: null,
      evidenceText: null,
    },
    sourceTextHash: createHash("sha256").update(materialText).digest("hex"),
  }],
}).length, 0, "generic aluminum sheet evidence must not count for a 6061-T6 2.0 mm material request");

function materialSupplierReceipt(args: {
  companyName: string;
  sourceUrl: string;
  supplierRoleEvidence: string;
  productCapabilityEvidence: string;
  itemIdentity: string;
}) {
  const companyIdentityEvidence = `${args.companyName} operates this official company website.`;
  const sourceText = [companyIdentityEvidence, args.supplierRoleEvidence, args.productCapabilityEvidence].join(" ");
  const result = validateExaPublicSupplierLeadReceipts(materialInput, {
    ...capture,
    records: [{
      ...capture.records[0]!,
      sourceUrl: args.sourceUrl,
      status: { ...capture.records[0]!.status!, id: args.sourceUrl },
      text: sourceText,
      proposal: {
        supplierName: args.companyName,
        supplierRole: "DISTRIBUTOR",
        companyIdentityEvidence,
        supplierRoleEvidence: args.supplierRoleEvidence,
        productCapabilityEvidence: args.productCapabilityEvidence,
        itemIdentity: args.itemIdentity,
        manufacturer: null,
        mpn: null,
        priceAmount: null,
        currency: null,
        unitOfMeasure: null,
        packageQuantity: null,
        evidenceText: null,
      },
      sourceTextHash: createHash("sha256").update(sourceText).digest("hex"),
    }],
  });
  return result[0] ?? null;
}

assert.equal(materialSupplierReceipt({
  companyName: "Wikipedia",
  sourceUrl: "https://en.wikipedia.org/wiki/6061_aluminium_alloy",
  supplierRoleEvidence: "Wikipedia is a distributor of aluminum reference information.",
  productCapabilityEvidence: "6061 aluminum sheet uses the T6 temper.",
  itemIdentity: "6061-T6 aluminum sheet",
}), null, "a stored reference-domain capture must fail receipt revalidation even when its text mimics supplier evidence");

const tciMaterialReceipt = materialSupplierReceipt({
  companyName: "TCI Precision Metals",
  sourceUrl: "https://tciprecision.com/materials/aluminum/aluminum-sheet-stock/",
  supplierRoleEvidence: "TCI Precision Metals is a value-add aluminum sheet distributor.",
  productCapabilityEvidence: "6061 Aluminum T6 Sheet. Standard thickness ranges from 0.032 to 0.190 inches.",
  itemIdentity: "6061-T6 aluminum sheet, 2.0 mm nominal, mill finish, cut-to-size blanks",
});
assert.ok(tciMaterialReceipt, "a true 6061 Aluminum T6 Sheet supplier must remain a lead when exact 2.0 mm availability requires RFQ confirmation");
assert.equal(tciMaterialReceipt.productCapability, "6061-T6 aluminum sheet", "unsupported thickness, finish, and cutting claims must not enter the supported capability");

const stockistMaterialReceipt = materialSupplierReceipt({
  companyName: "Texas Alloys & Tool Co.",
  sourceUrl: "https://www.texasalloys.com/aluminum.html",
  supplierRoleEvidence: "An independent metal service center serving Texas industry.",
  productCapabilityEvidence: "Aluminum 6061 sheet is available in T6 temper.",
  itemIdentity: "6061 T6 aluminum sheet",
});
assert.ok(stockistMaterialReceipt, "an exact company-domain-bound metal service center can support a distributor lead without synthetic company repetition in every excerpt");
assert.equal(stockistMaterialReceipt.productCapability, "6061-T6 aluminum sheet");

assert.equal(materialSupplierReceipt({
  companyName: "Generic Metal",
  sourceUrl: "https://genericmetal.example/aluminum",
  supplierRoleEvidence: "An independent metal service center.",
  productCapabilityEvidence: "Aluminum sheet in many thicknesses.",
  itemIdentity: "6061-T6 aluminum sheet",
}), null, "model-added grade or temper text must not turn generic aluminum sheet evidence into a lead");

const brandedGeneric = structuredClone(capture) as ExaRetrievalCapture;
const brandedText = "Acme Industrial operates this official catalog. Acme Industrial is a distributor. Acme Industrial distributes 3M structural epoxy.";
if (brandedGeneric.stage !== "SEARCH_ONLY") {
  brandedGeneric.records[0] = {
    ...brandedGeneric.records[0]!,
    text: brandedText,
    sourceTextHash: createHash("sha256").update(brandedText).digest("hex"),
    proposal: {
      ...brandedGeneric.records[0]!.proposal!,
      companyIdentityEvidence: "Acme Industrial operates this official catalog.",
      supplierRoleEvidence: "Acme Industrial is a distributor.",
      productCapabilityEvidence: "Acme Industrial distributes 3M structural epoxy.",
      itemIdentity: "3M structural epoxy",
    },
  };
}
assert.equal(validateExaPublicSupplierLeadReceipts(exaInput, brandedGeneric).length, 0, "brand-only epoxy evidence must not count for the exact DP420 request");

const wireInput: ExaSupplierResearchInput = {
  ...openAiInput,
  componentItemKey: "request:guild-017",
  componentName: "Electrical hookup wire",
  specification: "22 AWG stranded copper wire with ETFE insulation, 600 V class",
};
const wireUrl = "https://genericwire.example/catalog";
const wireIdentity = "Generic Wire operates this company catalog.";
const wireRole = "Generic Wire is a distributor.";
const wireCapability = "Generic Wire supplies 22 AWG stranded copper wire with PVC insulation.";
const wireText = [wireIdentity, wireRole, wireCapability].join(" ");
assert.equal(validateExaPublicSupplierLeadReceipts(wireInput, {
  ...capture,
  records: [{
    ...capture.records[0]!,
    sourceUrl: wireUrl,
    status: { ...capture.records[0]!.status!, id: wireUrl },
    text: wireText,
    proposal: {
      supplierName: "Generic Wire",
      supplierRole: "DISTRIBUTOR",
      companyIdentityEvidence: wireIdentity,
      supplierRoleEvidence: wireRole,
      productCapabilityEvidence: wireCapability,
      itemIdentity: "22 AWG stranded copper wire with PVC insulation",
      manufacturer: null,
      mpn: null,
      priceAmount: null,
      currency: null,
      unitOfMeasure: null,
      packageQuantity: null,
      evidenceText: null,
    },
    sourceTextHash: createHash("sha256").update(wireText).digest("hex"),
  }],
}).length, 0, "PVC wire must not count for the required ETFE 600 V wire specification");

assert.equal(genericDistributorReceiptCount({
  ...openAiInput,
  componentItemKey: "request:guild-007",
  componentName: "General removable fasteners",
  specification: "A2/304 stainless-steel socket-head cap screws, M4 x 0.7 and M5 x 0.8 families; passivated",
}, "Acme Fastener", "Acme Fastener supplies screws."), 0, "generic screws must not count for the A2/304 M4/M5 passivated fastener request");
assert.equal(genericDistributorReceiptCount({
  ...openAiInput,
  componentItemKey: "request:guild-008",
  componentName: "Structural washers",
  specification: "304 stainless flat washers matched to M4 and M5 hardware",
}, "Acme Washer", "Acme Washer supplies washers."), 0, "generic washers must not count for the 304 stainless M4/M5 flat-washer request");
assert.equal(genericDistributorReceiptCount({
  ...openAiInput,
  componentItemKey: "request:guild-029",
  componentName: "Structural test strain gauges",
  specification: "Foil strain gauges, 350 ohm nominal, general-purpose aluminum-compatible gauge",
}, "Acme Gauge", "Acme Gauge supplies strain gauges."), 0, "generic strain gauges must not count for the 350 ohm aluminum-compatible request");
assert.equal(genericDistributorReceiptCount({
  ...openAiInput,
  componentItemKey: "request:guild-030",
  componentName: "Ground-test accelerometer",
  specification: "Industrial triaxial accelerometer, low-voltage output",
}, "Acme Sensor", "Acme Sensor supplies accelerometers."), 0, "generic accelerometers must not count for the triaxial low-voltage request");
assert.equal(genericDistributorReceiptCount({
  ...openAiInput,
  componentItemKey: "request:guild-038",
  componentName: "Shipping protection",
  specification: "Closed-cell polyethylene foam, antistatic bags, humidity indicators, and reusable shipping case",
}, "Acme Packaging", "Acme Packaging supplies foam and antistatic bags."), 0, "a partial packaging catalog must not count for the four-part shipping-protection set");

for (const line of GUILD_SOURCING_LINES.filter((candidate) => candidate.classification === "SUPPLIER_SEARCH")) {
  const companyName = line.sku === "GUILD-040" ? "Guild Inspection 040" : `Guild Source ${line.item}`;
  const hostname = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const sourceUrl = `https://${hostname}.example/capability/${line.item}`;
  const role = line.sku === "GUILD-040" ? "SERVICE_PROVIDER" : "MANUFACTURER";
  const identityEvidence = `${companyName} operates this company capability website.`;
  const roleEvidence = role === "SERVICE_PROVIDER"
    ? `${companyName} is an inspection laboratory.`
    : `${companyName} is a manufacturer.`;
  const itemIdentity = `${line.name}: ${line.specification}`;
  const capabilityEvidence = role === "SERVICE_PROVIDER"
    ? `${companyName} provides and inspects ${itemIdentity}.`
    : `${companyName} manufactures and supplies ${itemIdentity}.`;
  const sourceText = [identityEvidence, roleEvidence, capabilityEvidence].join(" ");
  const lineInput: ExaSupplierResearchInput = {
    officeId: "office-test",
    workspaceId: "workspace-test",
    componentItemKey: `request:${line.sku.toLowerCase()}`,
    componentName: line.name,
    specification: `${line.specification}. Supplier QA: ${line.deliverable}.`,
    requestedQuantity: line.quantity ?? undefined,
    requestedUnit: line.unit ?? undefined,
  };
  const lineCapture: ExaRetrievalCapture = {
    ...capture,
    searchRequestId: `search-${line.item}`,
    contentsRequestId: `contents-${line.item}`,
    records: [{
      ...capture.records[0]!,
      sourceId: `source-${line.item}`,
      sourceUrl,
      sourceTitle: `${companyName} capability`,
      status: { ...capture.records[0]!.status!, id: sourceUrl },
      text: sourceText,
      proposal: {
        supplierName: companyName,
        supplierRole: role,
        companyIdentityEvidence: identityEvidence,
        supplierRoleEvidence: roleEvidence,
        productCapabilityEvidence: capabilityEvidence,
        itemIdentity,
        manufacturer: null,
        mpn: null,
        priceAmount: null,
        currency: null,
        unitOfMeasure: null,
        packageQuantity: null,
        evidenceText: null,
      },
      sourceTextHash: createHash("sha256").update(sourceText).digest("hex"),
    }],
  };
  assert.equal(
    validateExaPublicSupplierLeadReceipts(lineInput, lineCapture).length,
    1,
    `${line.sku} must be able to retain an exact source-bound supplier receipt`,
  );
}

async function verifyCandidatePromotion() {
  let searchQuery = "";
  const result = await searchExaComponentSuppliers({ ...exaInput, queryVariant: "official-catalog" }, {
    apiKey: "fixture-key",
    now: () => new Date(capture.retrievedAt),
    fetchImpl: async (request, init) => {
      if (String(request) === "https://api.exa.ai/search") {
        searchQuery = String((JSON.parse(String(init?.body)) as { query?: string }).query ?? "");
        return new Response(JSON.stringify({
          requestId: capture.searchRequestId,
          results: [{ id: sourceUrl, url: sourceUrl, title: "Acme Industrial DP420" }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        requestId: capture.contentsRequestId,
        results: [{
          id: sourceUrl,
          url: sourceUrl,
          title: "Acme Industrial DP420",
          text: sourceText,
          highlights: [],
          summary: capture.records[0]?.proposal,
        }],
        statuses: [{ id: sourceUrl, status: "success", httpStatusCode: 200 }],
      }), { status: 200 });
    },
  });
  assert.equal(searchQuery, buildSupplierResearchQueryPlan(exaInput).variants[1]?.query, "the trusted variant ID must select its deterministic Exa query");
  assert.equal(result.publicSupplierLeadReceipts.length, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.candidates[0]?.roles, ["DISTRIBUTOR"]);
  assert.equal(result.candidates[0]?.productCapability.state, "SUPPORTED");
  assert.equal(result.sources[0]?.sourceType, "PUBLIC", "validated public company evidence must not be relabeled as an official source class");
  assert.equal(result.publicListingReceipts.length, 0, "a legitimate lead does not imply a public price tuple");
}

const exploratoryPlan = buildSupplierResearchQueryPlan({
  componentName: "Bonding epoxy",
  specification: "3M Scotch-Weld DP420 structural epoxy",
  queryCycle: 2,
  excludeDomains: ["www.acmeindustrial.example", "acmeindustrial.example", "bad/path", "localhost"],
});
assert.match(exploratoryPlan.variants[0]?.query ?? "", /specialty supplier quality capability contract source/i);
assert.equal((exploratoryPlan.variants[0]?.query.match(/-site:acmeindustrial\.example/g) ?? []).length, 1, "exploration exclusions must be canonical and deduplicated");
assert.doesNotMatch(exploratoryPlan.variants[0]?.query ?? "", /bad\/path|localhost/);

verifyCandidatePromotion().then(() => {
  console.log("Supply OS supplier lead query and evidence contract passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
