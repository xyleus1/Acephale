import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  normalizeOpenAiSupplierResponse,
  SupplierResearchError,
} from "../src/lib/supply-os/component-supplier-research";
import {
  evaluatePublicSupplierLeadReceipts,
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
import { GUILD_SOURCING_LINES } from "./fixtures/legacy-supply-os/guild-sourcing-items";

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
assert.doesNotMatch(materialPlan.variants[0]?.query ?? "", /material certificate|lot traceability/i, "exact supplier discovery must not be narrowed by downstream QA paperwork");
assert.doesNotMatch(materialPlan.variants[1]?.query ?? "", /material certificate|lot traceability/i, "catalog discovery must not be narrowed by downstream QA paperwork");
assert.match(materialPlan.variants[2]?.query ?? "", /required supplier evidence material certificate/i, "only the capability and QA variant should carry request-specific evidence terms");

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
assert.equal(supplierCompanyMatchesDomain("3M", "https://www.3m.com/catalog"), true, "short registered brands must bind to their exact domain label");
assert.equal(supplierCompanyMatchesDomain("TE Connectivity", "https://www.te.com/connectors"), true, "short company abbreviations must bind to their exact domain label");
assert.equal(supplierCompanyMatchesDomain("Dow", "https://www.dow.com/adhesives"), true, "three-letter company domains must remain reachable");
assert.equal(supplierCompanyMatchesDomain("RS Components", "https://uk.rs-online.com/catalog"), true, "known short brand plus domain-tail naming must bind without fuzzy matching");
assert.equal(supplierCompanyMatchesDomain("HBK", "https://www.hbkworld.com/strain-gauges"), true, "known acronym plus domain-tail naming must bind without fuzzy matching");
assert.equal(supplierCompanyMatchesDomain("Fake 3M", "https://www.3m.com/catalog"), false, "a prefixed company must not steal a short registered brand domain");
assert.equal(supplierCompanyMatchesDomain("Fake HBK", "https://www.hbkworld.com/strain-gauges"), false, "a prefixed company must not steal an acronym brand domain");
assert.equal(supplierCompanyMatchesDomain("Fake Texas Alloys", "https://www.texasalloys.com/aluminum.html"), false, "a prefixed company name must not steal a matching trailing domain alias");

const openRequestRoleUrl = "https://processor.example/capability";
const openRequestRole = normalizeSupplierResearch({
  officeId: "office-test",
  workspaceId: "workspace-test",
  componentItemKey: "request:machined-enclosure",
  providerSources: [{ url: openRequestRoleUrl, sourceType: "PUBLIC" }],
  validatedSupplierLeadSourceUrls: [openRequestRoleUrl],
  raw: {
    candidates: [{
      id: "processor-1",
      companyName: "Guild Processor",
      website: openRequestRoleUrl,
      roles: ["PROCESSOR"],
      sourceUrls: [openRequestRoleUrl],
      productCapability: { value: "Machined enclosure", state: "SUPPORTED", confidence: 1, sourceUrls: [openRequestRoleUrl], observedAt: null },
      cautions: [],
    }],
    warnings: [],
  },
});
assert.deepEqual(openRequestRole.candidates[0]?.roles, ["PROCESSOR"], "custom requests must preserve validated open supplier roles");

const openAiInput = {
  officeId: "office-test",
  workspaceId: "workspace-test",
  componentItemKey: "request:bonding-epoxy",
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
const acceptedEvaluation = evaluatePublicSupplierLeadReceipts(exaInput, capture);
assert.deepEqual(
  acceptedEvaluation.receipts,
  leadReceipts,
  "diagnostic evaluation must preserve the exact receipt admitted by the compatibility wrapper",
);
assert.deepEqual(
  acceptedEvaluation.decisions.map(({ code, accepted }) => ({ code, accepted })),
  [{ code: "ACCEPTED", accepted: true }],
  "an admitted source must produce one explicit accepted decision",
);
assert.equal(acceptedEvaluation.decisions[0]?.queryProfile, "BRANDED_COTS");
assert.equal(acceptedEvaluation.decisions[0]?.sourceHostname, "acmeindustrial.example");

function supplierLeadDecisionCodes(candidateCapture: ExaRetrievalCapture) {
  return evaluatePublicSupplierLeadReceipts(exaInput, candidateCapture).decisions.map((decision) => decision.code);
}

assert.deepEqual(
  supplierLeadDecisionCodes({ ...capture, records: [] }),
  ["CAPTURE_NO_RECORDS"],
  "a successful retrieval with no bound records must expose a capture-level diagnostic",
);

const disallowedDomainUrl = "https://en.wikipedia.org/wiki/DP420?tracking=private#section";
assert.deepEqual(supplierLeadDecisionCodes({
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    sourceUrl: disallowedDomainUrl,
    status: record.status ? { ...record.status, id: disallowedDomainUrl } : null,
  })),
}), ["SOURCE_DOMAIN_DISALLOWED"], "reference domains must expose a deterministic domain rejection");
const domainDecision = evaluatePublicSupplierLeadReceipts(exaInput, {
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    sourceUrl: disallowedDomainUrl,
    status: record.status ? { ...record.status, id: disallowedDomainUrl } : null,
  })),
}).decisions[0];
assert.equal(domainDecision?.sourceUrl, "https://en.wikipedia.org/wiki/DP420", "diagnostics must remove query strings and fragments from source URLs");
assert.doesNotMatch(JSON.stringify(domainDecision), /tracking|private|section|operates this|structural epoxy/i, "diagnostics must not emit URL secrets or raw page evidence");

assert.deepEqual(supplierLeadDecisionCodes({
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    status: record.status ? { ...record.status, cacheAgeHours: 1 } : null,
  })),
}), ["SOURCE_STATUS_NOT_FRESH"], "cached source content must expose a deterministic freshness rejection");
assert.deepEqual(supplierLeadDecisionCodes({
  ...capture,
  records: capture.records.map((record) => ({ ...record, sourceTextHash: "0".repeat(64) })),
}), ["SOURCE_HASH_MISMATCH"], "mutated source content must expose a deterministic integrity rejection");
assert.deepEqual(supplierLeadDecisionCodes({
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    proposal: record.proposal ? { ...record.proposal, supplierName: null } : null,
  })),
}), ["COMPANY_MISSING"], "missing company identity must expose a deterministic company rejection");
assert.deepEqual(supplierLeadDecisionCodes({
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    proposal: record.proposal ? { ...record.proposal, supplierRole: "RESELLER" } : null,
  })),
}), ["ROLE_INVALID"], "an unsupported proposed role must expose a deterministic role rejection");
assert.deepEqual(supplierLeadDecisionCodes({
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    proposal: record.proposal ? { ...record.proposal, productCapabilityEvidence: "Model-only capability claim" } : null,
  })),
}), ["CAPABILITY_EXCERPT_NOT_VERBATIM"], "a model-only excerpt must expose a deterministic verbatim-evidence rejection");
const genericCapability = "Acme Industrial distributes and supplies generic industrial epoxy.";
const genericCapabilityText = [companyIdentityEvidence, supplierRoleEvidence, genericCapability].join(" ");
assert.deepEqual(supplierLeadDecisionCodes({
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    text: genericCapabilityText,
    proposal: record.proposal ? { ...record.proposal, productCapabilityEvidence: genericCapability } : null,
    sourceTextHash: createHash("sha256").update(genericCapabilityText).digest("hex"),
  })),
}), ["CAPABILITY_PROFILE_MISMATCH"], "generic product evidence must expose a deterministic profile mismatch");
const normalCatalogCopy = "Acme Industrial operates this official product catalog. Stocking distributor for industrial adhesives. Supplies 3M Scotch-Weld DP420 structural epoxy.";
assert.equal(validateExaPublicSupplierLeadReceipts(exaInput, {
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    text: normalCatalogCopy,
    proposal: record.proposal ? {
      ...record.proposal,
      companyIdentityEvidence: "Acme Industrial operates this official product catalog.",
      supplierRoleEvidence: "Stocking distributor for industrial adhesives.",
      productCapabilityEvidence: "Supplies 3M Scotch-Weld DP420 structural epoxy.",
    } : null,
    sourceTextHash: createHash("sha256").update(normalCatalogCopy).digest("hex"),
  })),
}).length, 1, "identity-bound role and capability excerpts must not repeat the company name");
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
const catalogOnlyRoleText = [companyIdentityEvidence, "Industrial adhesive product catalog.", productCapabilityEvidence].join(" ");
assert.equal(validateExaPublicSupplierLeadReceipts(exaInput, {
  ...capture,
  records: capture.records.map((record) => ({
    ...record,
    text: catalogOnlyRoleText,
    proposal: record.proposal ? { ...record.proposal, supplierRoleEvidence: "Industrial adhesive product catalog." } : null,
    sourceTextHash: createHash("sha256").update(catalogOnlyRoleText).digest("hex"),
  })),
}).length, 0, "a product catalog label alone must not be treated as an explicit distributor role");

const machineShopInput: ExaSupplierResearchInput = {
  ...openAiInput,
  componentItemKey: "request:machined-enclosure",
  componentName: "Internal electronics enclosure",
  specification: "Machined 6061-T6 aluminum enclosure, removable lid, conductive gasket provision",
};
const machineShopIdentity = "Enclosure Works operates this official company website.";
const machineShopRole = "CNC machine shop and enclosure fabricator.";
const machineShopCapability = "CNC machining for 6061-T6 aluminum enclosure with removable lid and conductive gasket provision.";
const machineShopText = [machineShopIdentity, machineShopRole, machineShopCapability].join(" ");
const machineShopUrl = "https://enclosureworks.example/cnc-enclosures";
const machineShopReceipts = validateExaPublicSupplierLeadReceipts(machineShopInput, {
  ...capture,
  records: [{
    ...capture.records[0]!,
    sourceUrl: machineShopUrl,
    status: { ...capture.records[0]!.status!, id: machineShopUrl },
    text: machineShopText,
    proposal: {
      supplierName: "Enclosure Works",
      supplierRole: "MACHINE SHOP",
      companyIdentityEvidence: machineShopIdentity,
      supplierRoleEvidence: machineShopRole,
      productCapabilityEvidence: machineShopCapability,
      itemIdentity: "6061-T6 aluminum enclosure",
      manufacturer: null,
      mpn: null,
      priceAmount: null,
      currency: null,
      unitOfMeasure: null,
      packageQuantity: null,
      evidenceText: null,
    },
    sourceTextHash: createHash("sha256").update(machineShopText).digest("hex"),
  }],
});
assert.equal(machineShopReceipts[0]?.role, "PROCESSOR", "normal machine-shop profile language must normalize to the evidence-checked processor role");

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
const annualReportCapability = "Provides annual reports to customers.";
const annualReportText = [inspectionIdentity, inspectionRole, annualReportCapability].join(" ");
assert.equal(validateExaPublicSupplierLeadReceipts(inspectionInput, {
  ...inspectionCapture,
  records: inspectionCapture.records.map((record) => ({
    ...record,
    text: annualReportText,
    proposal: record.proposal ? {
      ...record.proposal,
      productCapabilityEvidence: annualReportCapability,
      itemIdentity: "first article inspection measurement report",
    } : null,
    sourceTextHash: createHash("sha256").update(annualReportText).digest("hex"),
  })),
}).length, 0, "GUILD-040 must reject generic annual reports when only model-controlled item identity claims first-article inspection");

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

const flameRetardantInput: ExaSupplierResearchInput = {
  ...materialInput,
  componentItemKey: "request:laminate",
  componentName: "Non-flight nose-shell/mockup laminate",
  specification: "G10/FR-4 glass-epoxy laminate, 2.4 mm nominal, flame-retardant grade",
};
function laminateReceipt(capability: string) {
  const identity = "Panel Plastics operates this official materials catalog.";
  const role = "Industrial laminate stockist and distributor.";
  const source = [identity, role, capability].join(" ");
  return validateExaPublicSupplierLeadReceipts(flameRetardantInput, {
    ...capture,
    records: [{
      ...capture.records[0]!,
      sourceUrl: "https://panelplastics.example/laminates",
      status: { ...capture.records[0]!.status!, id: "https://panelplastics.example/laminates" },
      text: source,
      proposal: {
        supplierName: "Panel Plastics",
        supplierRole: "DISTRIBUTOR",
        companyIdentityEvidence: identity,
        supplierRoleEvidence: role,
        productCapabilityEvidence: capability,
        itemIdentity: capability.replace(/[.]$/u, ""),
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
  })[0] ?? null;
}
assert.equal(laminateReceipt("Stocks G10 glass-epoxy laminate."), null, "G10-only evidence must not satisfy the explicitly flame-retardant GUILD-005 request");
assert.ok(laminateReceipt("Stocks FR-4 flame-retardant glass-epoxy laminate."), "FR-4 evidence may satisfy the flame-retardant laminate capability gate");

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

function brandedEquivalentReceipt(args: {
  input: ExaSupplierResearchInput;
  companyName: string;
  sourceUrl: string;
  itemIdentity: string;
  capability: string;
}) {
  const identity = `${args.companyName} operates this official product catalog.`;
  const role = "Stocking distributor for industrial adhesives and sealants.";
  const source = [identity, role, args.capability].join(" ");
  return validateExaPublicSupplierLeadReceipts(args.input, {
    ...capture,
    records: [{
      ...capture.records[0]!,
      sourceUrl: args.sourceUrl,
      status: { ...capture.records[0]!.status!, id: args.sourceUrl },
      text: source,
      proposal: {
        supplierName: args.companyName,
        supplierRole: "DISTRIBUTOR",
        companyIdentityEvidence: identity,
        supplierRoleEvidence: role,
        productCapabilityEvidence: args.capability,
        itemIdentity: args.itemIdentity,
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
  })[0] ?? null;
}

const dp420EquivalentInput: ExaSupplierResearchInput = {
  ...exaInput,
  specification: "3M Scotch-Weld DP420 two-part structural epoxy or equivalent, room-temperature curing",
};
assert.ok(brandedEquivalentReceipt({
  input: dp420EquivalentInput,
  companyName: "Bondline Materials",
  sourceUrl: "https://bondlinematerials.example/structural-epoxy",
  itemIdentity: "two-part room-temperature curing structural epoxy",
  capability: "Supplies two-part room-temperature curing structural epoxy.",
}), "a permitted functional equivalent may pass when every critical epoxy qualifier is page-backed");
assert.equal(brandedEquivalentReceipt({
  input: dp420EquivalentInput,
  companyName: "Bondline Materials",
  sourceUrl: "https://bondlinematerials.example/general-epoxy",
  itemIdentity: "two-part structural epoxy",
  capability: "Supplies two-part structural epoxy.",
}), null, "a proposed DP420 equivalent missing room-temperature cure evidence must fail closed");

const dowsilEquivalentInput: ExaSupplierResearchInput = {
  ...exaInput,
  componentItemKey: "request:flexible-electronics-adhesive",
  componentName: "Flexible electronics adhesive",
  manufacturer: undefined,
  mpn: undefined,
  specification: "DOWSIL 3145 RTV silicone adhesive or sealant, or equivalent electronics-grade neutral-cure material",
};
assert.ok(brandedEquivalentReceipt({
  input: dowsilEquivalentInput,
  companyName: "Circuit Sealants",
  sourceUrl: "https://circuitsealants.example/neutral-cure",
  itemIdentity: "electronics-grade neutral-cure RTV silicone adhesive",
  capability: "Offers electronics-grade neutral-cure RTV silicone adhesive.",
}), "a permitted DOWSIL equivalent may pass only with page-backed electronics and cure qualifiers");
assert.equal(brandedEquivalentReceipt({
  input: dowsilEquivalentInput,
  companyName: "Circuit Sealants",
  sourceUrl: "https://circuitsealants.example/acetoxy-cure",
  itemIdentity: "electronics-grade RTV silicone adhesive",
  capability: "Offers electronics-grade acetoxy-cure RTV silicone adhesive.",
}), null, "the wrong cure chemistry must not pass as a DOWSIL 3145 equivalent");

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

type RealisticGuildSupplierLanguage = {
  companyName: string;
  role: "MANUFACTURER" | "DISTRIBUTOR" | "PROCESSOR" | "SERVICE_PROVIDER";
  roleEvidence: string;
  itemIdentity: string;
  capabilityEvidence: string;
};

// These are sanitized fixture pages, not claims that any real supplier offers the item.
// The capability excerpts deliberately use catalog rows and capability blurbs instead of request prose.
const REALISTIC_GUILD_SUPPLIER_LANGUAGE: Record<string, RealisticGuildSupplierLanguage> = {
  "GUILD-001": { companyName: "Metro Metals", role: "DISTRIBUTOR", roleEvidence: "Full-line metal service center and stockist.", itemIdentity: "6061-T6 aluminum sheet", capabilityEvidence: "Inventory table | 6061-T6 aluminum | sheet form | mill-stock condition." },
  "GUILD-002": { companyName: "Metro Metals", role: "DISTRIBUTOR", roleEvidence: "Full-line metal service center and stockist.", itemIdentity: "6061-T651 aluminum plate", capabilityEvidence: "Saw-cut stock program: 6061-T651 aluminum plate blanks." },
  "GUILD-003": { companyName: "Metro Metals", role: "DISTRIBUTOR", roleEvidence: "Full-line metal service center and stockist.", itemIdentity: "5052-H32 aluminum sheet", capabilityEvidence: "Service-center inventory includes 5052-H32 aluminum sheet with deburring available." },
  "GUILD-004": { companyName: "Metro Metals", role: "PROCESSOR", roleEvidence: "Metal service center with cut-to-size processing.", itemIdentity: "6061-T6 aluminum extrusion machining stock", capabilityEvidence: "Cut-length 6061-T6 aluminum extrusion machining stock is available from the service center." },
  "GUILD-005": { companyName: "Panel Plastics", role: "DISTRIBUTOR", roleEvidence: "Industrial laminate stockist and distributor.", itemIdentity: "FR-4 flame-retardant glass-epoxy laminate", capabilityEvidence: "Laminate catalog | NEMA FR-4 flame-retardant glass-epoxy sheet." },
  "GUILD-006": { companyName: "Motion Isolators", role: "MANUFACTURER", roleEvidence: "Manufacturer of vibration-control components.", itemIdentity: "silicone elastomer vibration isolator mounts with stainless inserts, 50 Shore A", capabilityEvidence: "Series V50 catalog lists vibration isolator mounts with silicone elastomer bodies, stainless inserts, and 50 Shore A hardness." },
  "GUILD-007": { companyName: "Metric Fasteners", role: "DISTRIBUTOR", roleEvidence: "Stocking distributor for metric hardware.", itemIdentity: "A2 stainless socket-head cap screws in M4 and M5, passivated", capabilityEvidence: "Fastener catalog lists passivated A2 stainless M4 and M5 socket-head cap screws." },
  "GUILD-008": { companyName: "Metric Fasteners", role: "DISTRIBUTOR", roleEvidence: "Stocking distributor for metric hardware.", itemIdentity: "304 stainless flat washers for M4 and M5", capabilityEvidence: "Hardware table lists M4 and M5 flat washers in 304 stainless." },
  "GUILD-009": { companyName: "Metric Fasteners", role: "DISTRIBUTOR", roleEvidence: "Stocking distributor for metric hardware.", itemIdentity: "304 stainless prevailing-torque locknuts in M4 and M5", capabilityEvidence: "Catalog lists M4 and M5 prevailing-torque locknuts made from 304 stainless." },
  "GUILD-010": { companyName: "Metric Fasteners", role: "DISTRIBUTOR", roleEvidence: "Stocking distributor for metric hardware.", itemIdentity: "stainless helical-thread inserts for M4 and M5", capabilityEvidence: "Thread-repair catalog lists stainless helical-thread inserts for M4 and M5 tapped holes." },
  "GUILD-011": { companyName: "Bondline Materials", role: "DISTRIBUTOR", roleEvidence: "Stocking distributor for industrial adhesives.", itemIdentity: "3M Scotch-Weld DP420 structural epoxy", capabilityEvidence: "The distributor catalog lists 3M Scotch-Weld DP420 structural epoxy." },
  "GUILD-012": { companyName: "Circuit Sealants", role: "DISTRIBUTOR", roleEvidence: "Stocking distributor for electronics sealants.", itemIdentity: "DOWSIL 3145 RTV silicone adhesive", capabilityEvidence: "The electronics catalog lists DOWSIL 3145 RTV silicone adhesive." },
  "GUILD-013": { companyName: "Process Chemicals", role: "DISTRIBUTOR", roleEvidence: "Industrial chemical supplier and distributor.", itemIdentity: "high-purity 99 percent electronics-grade isopropyl alcohol solvent", capabilityEvidence: "Solvent catalog lists high-purity isopropyl alcohol, 99 percent, electronics-grade." },
  "GUILD-014": { companyName: "Coating Systems", role: "DISTRIBUTOR", roleEvidence: "Industrial coatings supplier and distributor.", itemIdentity: "corrosion-resistant epoxy primer compatible with aluminum", capabilityEvidence: "Coatings guide offers an aluminum-compatible, corrosion-resistant epoxy primer system." },
  "GUILD-015": { companyName: "Coating Systems", role: "DISTRIBUTOR", roleEvidence: "Industrial coatings supplier and distributor.", itemIdentity: "matte polyurethane topcoat", capabilityEvidence: "Finish catalog offers a matte polyurethane topcoat for industrial coating systems." },
  "GUILD-016": { companyName: "Precision Rails", role: "PROCESSOR", roleEvidence: "CNC machine shop and metal fabricator.", itemIdentity: "6061 aluminum instrumentation rail", capabilityEvidence: "Capabilities include CNC machining 6061 aluminum instrumentation rails followed by hard anodizing." },
  "GUILD-017": { companyName: "Aero Wire Supply", role: "DISTRIBUTOR", roleEvidence: "Stocking distributor for high-performance wire.", itemIdentity: "22 AWG stranded copper wire with ETFE insulation, 600 V", capabilityEvidence: "Wire table lists 22 AWG stranded copper conductors, ETFE insulation, and a 600 V rating." },
  "GUILD-018": { companyName: "Aero Wire Supply", role: "DISTRIBUTOR", roleEvidence: "Stocking distributor for high-performance wire.", itemIdentity: "18 AWG stranded copper wire with ETFE insulation", capabilityEvidence: "Wire table lists 18 AWG stranded copper conductors with ETFE insulation." },
  "GUILD-019": { companyName: "Signal Cable", role: "MANUFACTURER", roleEvidence: "Manufacturer of shielded instrumentation cable.", itemIdentity: "2-conductor twisted shielded cable with 24 AWG conductors and fluoropolymer jacket", capabilityEvidence: "Cable data row: 2-conductor twisted shielded cable, 24 AWG, fluoropolymer jacket; manufactured to order." },
  "GUILD-020": { companyName: "Harness Marking", role: "DISTRIBUTOR", roleEvidence: "Identification-products supplier and distributor.", itemIdentity: "heat-shrink printable identification sleeves in polyolefin for thermal-transfer marking", capabilityEvidence: "Identification catalog lists printable polyolefin heat-shrink sleeves for permanent thermal-transfer marking." },
  "GUILD-021": { companyName: "Harness Protection", role: "DISTRIBUTOR", roleEvidence: "Stocking distributor for cable-management products.", itemIdentity: "abrasion-resistant braided expandable sleeving in 6 mm, 10 mm, and 15 mm diameters", capabilityEvidence: "Cable-management catalog lists abrasion-resistant braided expandable sleeving in 6 mm, 10 mm, and 15 mm sizes." },
  "GUILD-022": { companyName: "Harness Protection", role: "DISTRIBUTOR", roleEvidence: "Stocking distributor for cable-management products.", itemIdentity: "dual-wall adhesive-lined heat shrink with 3:1 shrink ratio", capabilityEvidence: "Tubing data row lists dual-wall, adhesive-lined heat shrink with a 3:1 recovery ratio." },
  "GUILD-023": { companyName: "Circular Interconnect", role: "DISTRIBUTOR", roleEvidence: "Connector supplier and authorized distributor.", itemIdentity: "10-contact multipole circular connector with metallic shell and positive locking", capabilityEvidence: "Connector catalog lists a 10-contact multipole circular connector with metallic shell and positive locking." },
  "GUILD-024": { companyName: "Enclosure Works", role: "PROCESSOR", roleEvidence: "CNC machine shop and enclosure fabricator.", itemIdentity: "6061-T6 aluminum enclosure with removable lid and conductive gasket provision", capabilityEvidence: "Capabilities include CNC machining a 6061-T6 aluminum enclosure with removable lid and conductive-gasket land." },
  "GUILD-025": { companyName: "Board Fabrication", role: "MANUFACTURER", roleEvidence: "Contract manufacturer and printed circuit board fabricator.", itemIdentity: "1.6 mm FR-4 printed circuit board carrier fabrication", capabilityEvidence: "Board shop provides 1.6 mm FR-4 printed circuit board carrier fabrication." },
  "GUILD-026": { companyName: "Metric Supports", role: "DISTRIBUTOR", roleEvidence: "Electronic hardware supplier and distributor.", itemIdentity: "M3 threaded PEEK standoff, 18 mm height", capabilityEvidence: "Electronic hardware catalog lists an M3 threaded PEEK standoff at 18 mm height." },
  "GUILD-028": { companyName: "Temperature Instruments", role: "MANUFACTURER", roleEvidence: "Instrumentation manufacturer and calibration supplier.", itemIdentity: "100 ohm PT100 RTD", capabilityEvidence: "Sensor catalog lists a 100 ohm PT100 RTD in a 3-wire surface-mount package." },
  "GUILD-029": { companyName: "Strain Instruments", role: "MANUFACTURER", roleEvidence: "Manufacturer of strain measurement sensors.", itemIdentity: "350 ohm foil strain gauge", capabilityEvidence: "Gauge catalog lists a 350 ohm foil strain gauge with self-temperature compensation for aluminum." },
  "GUILD-030": { companyName: "Motion Instruments", role: "MANUFACTURER", roleEvidence: "Manufacturer of industrial vibration sensors.", itemIdentity: "triaxial accelerometer", capabilityEvidence: "Vibration catalog lists a triaxial IEPE accelerometer with 100 mV/g output." },
  "GUILD-031": { companyName: "Test Harness Works", role: "SERVICE_PROVIDER", roleEvidence: "Wire harness assembler and cable assembly service.", itemIdentity: "bench-test data-acquisition wire harness", capabilityEvidence: "Harness shop provides build-to-print bench data-acquisition harness assembly with continuity and pin-to-pin testing." },
  "GUILD-032": { companyName: "Grounding Products", role: "MANUFACTURER", roleEvidence: "Manufacturer of electrical grounding hardware.", itemIdentity: "tinned-copper braided grounding straps with crimped ring terminals", capabilityEvidence: "Grounding catalog lists tinned-copper braided grounding straps terminated with crimped ring terminals." },
  "GUILD-033": { companyName: "Trim Products", role: "DISTRIBUTOR", roleEvidence: "Industrial rubber-products supplier and distributor.", itemIdentity: "silicone edge trim", capabilityEvidence: "Trim catalog lists EPDM edge trim profiles for panel openings." },
  "GUILD-034": { companyName: "Thermal Materials", role: "DISTRIBUTOR", roleEvidence: "Thermal-management materials supplier.", itemIdentity: "electrically insulating silicone thermal pad, 1.5 mm thick", capabilityEvidence: "Thermal catalog lists a 1.5 mm electrically insulating silicone thermal pad." },
  "GUILD-035": { companyName: "Industrial Nameplates", role: "PROCESSOR", roleEvidence: "Nameplate fabricator and engraving shop.", itemIdentity: "laser-etched anodized-aluminum nameplates", capabilityEvidence: "The nameplate shop fabricates anodized aluminum nameplates and laser-etches legends." },
  "GUILD-036": { companyName: "Inspection Marking", role: "DISTRIBUTOR", roleEvidence: "Industrial inspection-products supplier.", itemIdentity: "torque-seal witness lacquer", capabilityEvidence: "Inspection-supplies catalog lists industrial witness lacquer." },
  "GUILD-037": { companyName: "Connector Protection", role: "DISTRIBUTOR", roleEvidence: "Connector accessory supplier and distributor.", itemIdentity: "antistatic polymer caps and connector dust covers", capabilityEvidence: "Catalog lists polymer caps with antistatic construction; connector accessories include dust covers." },
  "GUILD-038": { companyName: "Transit Packaging", role: "DISTRIBUTOR", roleEvidence: "Industrial packaging supplier and custom case distributor.", itemIdentity: "closed-cell polyethylene foam, ESD bags, humidity indicator cards, and reusable transit cases", capabilityEvidence: "Packaging catalog supplies closed-cell polyethylene foam, ESD bags, humidity indicator cards, and reusable transit cases." },
  "GUILD-040": { companyName: "Precision Metrology", role: "SERVICE_PROVIDER", roleEvidence: "First-article inspection service and metrology laboratory.", itemIdentity: "first-article inspection measurement report", capabilityEvidence: "Metrology services provide first-article measurement reports against released drawings." },
};

const researchableGuildLines = GUILD_SOURCING_LINES.filter((candidate) => candidate.classification === "SUPPLIER_SEARCH");
const researchableGuildIds = researchableGuildLines.map((line) => line.sku).sort();
const CRITICAL_NEAR_MISS_CAPABILITY: Record<string, string> = {
  "GUILD-001": "Stocks 6061-T651 aluminum sheet.",
  "GUILD-002": "Stocks 6061-T6 aluminum plate.",
  "GUILD-003": "Stocks 5052-H34 aluminum sheet.",
  "GUILD-004": "Stocks 6063-T6 aluminum extrusion machining stock.",
  "GUILD-005": "Stocks G10 flame-retardant glass-epoxy laminate.",
  "GUILD-006": "Manufactures silicone elastomer vibration isolator mounts with stainless inserts, 70 Shore A.",
  "GUILD-007": "Supplies A2 stainless socket-head cap screws in M4 and M5, black oxide finish.",
  "GUILD-008": "Supplies 316 stainless flat washers for M4 and M5.",
  "GUILD-009": "Supplies 304 stainless plain hex nuts in M4 and M5.",
  "GUILD-010": "Supplies stainless solid threaded inserts for M4 and M5.",
  "GUILD-011": "Supplies BondPro 420 two-part structural epoxy for elevated-temperature curing.",
  "GUILD-012": "Supplies SealFlex 3105 electronics-grade acid-cure silicone adhesive.",
  "GUILD-013": "Supplies high-purity 95 percent electronics-grade isopropyl alcohol solvent.",
  "GUILD-014": "Offers two-part corrosion-resistant acrylic primer for aluminum.",
  "GUILD-015": "Offers gloss polyurethane topcoat.",
  "GUILD-016": "CNC machining and powder coating for 6061 aluminum instrumentation rail.",
  "GUILD-017": "Supplies 24 AWG stranded copper wire with ETFE insulation, 600 V.",
  "GUILD-018": "Supplies 20 AWG stranded copper wire with ETFE insulation.",
  "GUILD-019": "Manufactures 2-conductor twisted shielded cable with 26 AWG conductors and fluoropolymer jacket.",
  "GUILD-020": "Supplies heat-shrink printable identification sleeves in polyolefin for inkjet marking.",
  "GUILD-021": "Supplies abrasion-resistant braided expandable sleeving in 6 mm, 10 mm, and 12 mm diameters.",
  "GUILD-022": "Supplies dual-wall adhesive-lined heat shrink with 2:1 shrink ratio.",
  "GUILD-023": "Supplies 16-contact multipole circular connector with metallic shell and positive locking.",
  "GUILD-024": "CNC machining for aluminum enclosure with removable lid and conductive gasket provision.",
  "GUILD-025": "Provides 2.0 mm FR-4 printed circuit board carrier fabrication.",
  "GUILD-026": "Supplies M3 threaded PEEK standoff, 30 mm height.",
  "GUILD-028": "Manufactures 100 ohm PT100 RTD in a 2-wire surface-mount configuration.",
  "GUILD-029": "Manufactures 350 ohm foil strain gauge with self-temperature compensation for steel.",
  "GUILD-030": "Manufactures triaxial charge-mode accelerometer.",
  "GUILD-031": "Build-to-print cable assemblies with continuity and pin-to-pin testing.",
  "GUILD-032": "Manufactures bare-copper braided grounding straps with crimped ring terminals.",
  "GUILD-033": "Supplies nitrile edge trim for access openings.",
  "GUILD-034": "Supplies electrically insulating silicone thermal pad, 3 mm thick.",
  "GUILD-035": "Fabricates laser-etched bare-aluminum nameplates.",
  "GUILD-036": "Supplies UV inspection lacquer.",
  "GUILD-037": "Supplies standard polymer caps and connector dust covers.",
  "GUILD-038": "Supplies closed-cell polyethylene foam, ESD bags, and reusable transit cases.",
  "GUILD-040": "Provides annual reports to customers.",
};
assert.deepEqual(
  Object.keys(REALISTIC_GUILD_SUPPLIER_LANGUAGE).sort(),
  researchableGuildIds,
  "the supplier-language matrix key set must exactly equal every sourceable GUILD line",
);
assert.deepEqual(
  Object.keys(CRITICAL_NEAR_MISS_CAPABILITY).sort(),
  researchableGuildIds,
  "the wrong-fit matrix key set must exactly equal every sourceable GUILD line",
);
const MODEL_IDENTITY_ONLY_NEAR_MISS: Record<string, string> = {
  "GUILD-026": "Supplies M3 threaded PEEK parts in 18 mm height.",
  "GUILD-029": "Manufactures 350 ohm sensors with self-temperature compensation for aluminum.",
};
const NUMERIC_SUBSTRING_NEAR_MISS: Record<string, string> = {
  "GUILD-026": "Supplies M30 threaded PEEK standoff, 18 mm height.",
  "GUILD-029": "Manufactures 1350 ohm foil strain gauge with self-temperature compensation for aluminum.",
};
const modelIdentityNearMissReceiptCounts = new Map<string, number>();
const numericSubstringNearMissReceiptCounts = new Map<string, number>();

function supplierFixturePage(
  lineItem: string,
  identityEvidence: string,
  roleEvidence: string,
  capabilityEvidence: string,
) {
  const sections = Number(lineItem) % 4;
  if (sections === 0) return [identityEvidence, "Product catalog", capabilityEvidence, "About the supplier", roleEvidence].join("\n");
  if (sections === 1) return [identityEvidence, "Company profile", roleEvidence, "Technical data", capabilityEvidence].join("\n");
  if (sections === 2) return [identityEvidence, "Capabilities", capabilityEvidence, "Who we are", roleEvidence].join("\n");
  return [identityEvidence, "About", roleEvidence, "Catalog row", capabilityEvidence].join("\n");
}

function normalizedFixtureText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

for (const line of researchableGuildLines) {
  const language = REALISTIC_GUILD_SUPPLIER_LANGUAGE[line.sku];
  assert.ok(language, `${line.sku} is missing a realistic supplier-language fixture`);
  const hostname = language.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const sourceUrl = `https://${hostname}.example/capability/${line.item}`;
  const identityEvidence = `${language.companyName} operates this official company website.`;
  const sourceText = supplierFixturePage(line.item, identityEvidence, language.roleEvidence, language.capabilityEvidence);
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
      sourceTitle: `${language.companyName} capability`,
      status: { ...capture.records[0]!.status!, id: sourceUrl },
      text: sourceText,
      proposal: {
        supplierName: language.companyName,
        supplierRole: language.role,
        companyIdentityEvidence: identityEvidence,
        supplierRoleEvidence: language.roleEvidence,
        productCapabilityEvidence: language.capabilityEvidence,
        itemIdentity: language.itemIdentity,
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
  const normalizedCapability = normalizedFixtureText(language.capabilityEvidence);
  const normalizedSpecification = normalizedFixtureText(line.specification);
  const normalizedFullRequest = normalizedFixtureText(`${line.name} ${line.specification}`);
  assert.notEqual(normalizedCapability, normalizedSpecification, `${line.sku} fixture capability must not copy the full specification`);
  assert.equal(normalizedCapability.includes(normalizedSpecification), false, `${line.sku} fixture capability must not contain the full specification`);
  assert.equal(normalizedCapability.includes(normalizedFullRequest), false, `${line.sku} fixture capability must not contain the normalized full request`);
  assert.equal(
    validateExaPublicSupplierLeadReceipts(lineInput, lineCapture).length,
    1,
    `${line.sku} supplier-style fixture must retain exactly one source-bound receipt`,
  );
  const nearMissCapability = CRITICAL_NEAR_MISS_CAPABILITY[line.sku];
  assert.ok(nearMissCapability, `${line.sku} must have a wrong-fit capability fixture`);
  const nearMissText = supplierFixturePage(line.item, identityEvidence, language.roleEvidence, nearMissCapability);
  const nearMissCapture: ExaRetrievalCapture = {
    ...lineCapture,
    records: lineCapture.records.map((record) => ({
      ...record,
      text: nearMissText,
      proposal: record.proposal ? {
        ...record.proposal,
        itemIdentity: nearMissCapability.replace(/[.]$/u, ""),
        productCapabilityEvidence: nearMissCapability,
      } : null,
      sourceTextHash: createHash("sha256").update(nearMissText).digest("hex"),
    })),
  };
  assert.equal(
    validateExaPublicSupplierLeadReceipts(lineInput, nearMissCapture).length,
    0,
    `${line.sku} materially wrong supplier fit must fail closed`,
  );
  const modelIdentityOnlyCapability = MODEL_IDENTITY_ONLY_NEAR_MISS[line.sku];
  if (modelIdentityOnlyCapability) {
    const modelIdentityOnlyText = supplierFixturePage(line.item, identityEvidence, language.roleEvidence, modelIdentityOnlyCapability);
    const modelIdentityOnlyCapture: ExaRetrievalCapture = {
      ...lineCapture,
      records: lineCapture.records.map((record) => ({
        ...record,
        text: modelIdentityOnlyText,
        proposal: record.proposal ? {
          ...record.proposal,
          productCapabilityEvidence: modelIdentityOnlyCapability,
        } : null,
        sourceTextHash: createHash("sha256").update(modelIdentityOnlyText).digest("hex"),
      })),
    };
    modelIdentityNearMissReceiptCounts.set(
      line.sku,
      validateExaPublicSupplierLeadReceipts(lineInput, modelIdentityOnlyCapture).length,
    );
  }
  const numericSubstringCapability = NUMERIC_SUBSTRING_NEAR_MISS[line.sku];
  if (numericSubstringCapability) {
    const numericSubstringText = supplierFixturePage(line.item, identityEvidence, language.roleEvidence, numericSubstringCapability);
    const numericSubstringCapture: ExaRetrievalCapture = {
      ...lineCapture,
      records: lineCapture.records.map((record) => ({
        ...record,
        text: numericSubstringText,
        proposal: record.proposal ? {
          ...record.proposal,
          itemIdentity: numericSubstringCapability.replace(/[.]$/u, ""),
          productCapabilityEvidence: numericSubstringCapability,
        } : null,
        sourceTextHash: createHash("sha256").update(numericSubstringText).digest("hex"),
      })),
    };
    numericSubstringNearMissReceiptCounts.set(
      line.sku,
      validateExaPublicSupplierLeadReceipts(lineInput, numericSubstringCapture).length,
    );
  }
}
assert.equal(
  modelIdentityNearMissReceiptCounts.get("GUILD-026"),
  0,
  "GUILD-026 must reject generic M3 threaded PEEK parts when only model-controlled item identity says standoff",
);
assert.equal(
  modelIdentityNearMissReceiptCounts.get("GUILD-029"),
  0,
  "GUILD-029 must reject generic 350 ohm sensors when only model-controlled item identity says strain gauge",
);
assert.equal(
  numericSubstringNearMissReceiptCounts.get("GUILD-026"),
  0,
  "GUILD-026 must not treat M30 as an M3 thread",
);
assert.equal(
  numericSubstringNearMissReceiptCounts.get("GUILD-029"),
  0,
  "GUILD-029 must not treat 1350 ohm as 350 ohm",
);

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
