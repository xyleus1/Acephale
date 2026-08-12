import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ExaResearchError,
  parseStoredExaRetrievalCapture,
  parseStoredPublicListingReceipt,
  searchExaComponentSuppliers,
  validateExaPublicListingReceipts,
  type ExaOfferProposal,
  type ExaRetrievalCapture,
  type ExaSourceStatus,
  type ExaSupplierResearchInput,
} from "../src/lib/supply-os/exa-supplier-research";

const procurementWorkspace = readFileSync(resolve(process.cwd(), "src/app/dashboard/supply-os/supply-os-procurement-workspace.tsx"), "utf8");
assert.doesNotMatch(procurementWorkspace, /candidate\.website \? "Official"/, "an Exa marketplace listing must remain a public New source in the UI");
assert.match(procurementWorkspace, /source\.sourceType === "OFFICIAL"/, "the UI may call a source official only when the result explicitly classifies it that way");

const input: ExaSupplierResearchInput = {
  officeId: "office-test",
  workspaceId: "workspace-test",
  componentItemKey: "part:rm-9",
  componentName: "RM-9 radio module",
  manufacturer: "Acme",
  mpn: "RM-9",
  requestedQuantity: 4,
  requestedUnit: "EA",
};

const sourceUrl = "https://supplier.example/catalog/rm-9";
const failedSourceUrl = "https://supplier.example/catalog/rm-9-unavailable";
const retrievedAt = new Date(Date.now() - 60_000).toISOString();
const successText = "Example Supplier lists the Acme RM-9 radio module for 42.50 USD per each.";
const successProposal: ExaOfferProposal = {
  supplierName: "Example Supplier",
  supplierRole: "DISTRIBUTOR",
  itemIdentity: "Acme RM-9 radio module",
  manufacturer: "Acme",
  mpn: "RM-9",
  priceAmount: 42.5,
  currency: "USD",
  unitOfMeasure: "each",
  packageQuantity: null,
  evidenceText: successText,
};

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function status(overrides: Partial<ExaSourceStatus> = {}): ExaSourceStatus {
  return {
    id: sourceUrl,
    status: "success",
    errorTag: null,
    httpStatusCode: null,
    cacheState: null,
    cacheAgeHours: null,
    ...overrides,
  };
}

function capture(records: ExaRetrievalCapture["records"]): ExaRetrievalCapture {
  return {
    provider: "EXA",
    freshnessPolicy: "FORCED_LIVE",
    searchRequestId: "search-request-1",
    contentsRequestId: "contents-request-1",
    searchHttpStatus: 200,
    contentsHttpStatus: 200,
    searchResponseHash: "a".repeat(64),
    contentsResponseHash: "b".repeat(64),
    retrievedAt,
    records,
  };
}

function sourceRecord(args: {
  url?: string;
  sourceText?: string;
  proposal?: ExaOfferProposal | null;
  sourceStatus?: ExaSourceStatus | null;
} = {}): ExaRetrievalCapture["records"][number] {
  const sourceText = args.sourceText ?? successText;
  const url = args.url ?? sourceUrl;
  return {
    searchRank: 1,
    sourceId: "source-1",
    sourceUrl: url,
    sourceTitle: "RM-9 listing",
    status: args.sourceStatus === undefined ? status({ id: url }) : args.sourceStatus,
    publishedDate: "1999-01-01T00:00:00.000Z",
    text: sourceText,
    highlights: [],
    proposal: args.proposal === undefined ? successProposal : args.proposal,
    sourceTextHash: digest(sourceText),
  };
}

const success = validateExaPublicListingReceipts(input, capture([sourceRecord()]));
assert.equal(success.length, 1, "one exact forced-live record should emit one receipt");
assert.equal(success[0]?.retrievedAt, retrievedAt, "server retrieval time must record capture time without asserting commercial freshness");
assert.equal(success[0]?.amount, 42.5);
assert.equal(success[0]?.currency, "USD");
assert.equal(success[0]?.unitOfMeasure, "each");
assert.equal(parseStoredPublicListingReceipt(success[0])?.receiptHash, success[0]?.receiptHash);
assert.equal(parseStoredPublicListingReceipt({ ...success[0], amount: 99 }), null, "receipt hash must bind the exact tuple");
assert.equal(parseStoredPublicListingReceipt({ ...success[0], retrievedAt: "2999-01-01T00:00:00.000Z" }), null, "implausible future retrieval time must fail closed");

const wrongMpnProposal = { ...successProposal, itemIdentity: "Acme RM-8 radio module", mpn: "RM-8", evidenceText: "Acme RM-8 radio module. Current price: 42.50 USD per each." };
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceText: wrongMpnProposal.evidenceText, proposal: wrongMpnProposal }),
])).length, 0, "wrong MPN must fail closed");

const otherProductText = "Acme RM-9 radio module is listed. Acme ZX-1 radio module costs 42.50 USD per each.";
const otherProductProposal = { ...successProposal, itemIdentity: "Acme ZX-1 radio module", mpn: "ZX-1", evidenceText: "Acme ZX-1 radio module costs 42.50 USD per each." };
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceText: otherProductText, proposal: otherProductProposal }),
])).length, 0, "a price for another product on the same page must not bind to the requested item");
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({
    sourceText: otherProductText,
    proposal: { ...successProposal, evidenceText: otherProductText },
  }),
])).length, 0, "a summary that names the requested item must not steal a nearby cross-product price");

const genericInput = { ...input, componentItemKey: "request:aluminum", componentName: "6061-T6 aluminum sheet", manufacturer: undefined, mpn: undefined, specification: "6061-T6 aluminum sheet, 2.0 mm mill finish" };
const genericPriceText = "Aluminum sheet for 42.50 USD per sheet.";
assert.equal(validateExaPublicListingReceipts(genericInput, capture([
  sourceRecord({
    sourceText: genericPriceText,
    proposal: { ...successProposal, itemIdentity: "6061-T6 aluminum sheet, 2.0 mm mill finish", manufacturer: null, mpn: null, unitOfMeasure: "sheet", evidenceText: genericPriceText },
  }),
])).length, 0, "a hallucinated no-MPN identity must not bind a generic source excerpt");
const wrongGradeText = "5052-H32 steel sheet, 2.0 mm mill finish for 42.50 USD per sheet.";
assert.equal(validateExaPublicListingReceipts({ ...genericInput, specification: "2.0 mm mill finish" }, capture([
  sourceRecord({
    sourceText: wrongGradeText,
    proposal: { ...successProposal, itemIdentity: "5052-H32 steel sheet, 2.0 mm mill finish", manufacturer: null, mpn: null, unitOfMeasure: "sheet", evidenceText: wrongGradeText },
  }),
])).length, 0, "matching dimensions must not let the wrong no-MPN grade or material bind");
const genericSuccessText = "6061-T6 aluminum sheet, 2.0 mm mill finish for 42.50 USD per sheet.";
assert.equal(validateExaPublicListingReceipts(genericInput, capture([
  sourceRecord({
    sourceText: genericSuccessText,
    proposal: { ...successProposal, itemIdentity: "6061-T6 aluminum sheet, 2.0 mm mill finish", manufacturer: null, mpn: null, unitOfMeasure: "sheet", evidenceText: genericSuccessText },
  }),
])).length, 1, "an exact no-MPN material variant with thickness and unit should bind");

const primerInput = {
  ...genericInput,
  componentItemKey: "request:primer",
  componentName: "Primer system",
  specification: "Two-part corrosion-resistant epoxy primer compatible with aluminum, aerospace industrial grade",
};
const wrongPrimerText = "Primer system: Two-part corrosion-resistant urethane primer for wood, 42.50 USD per kit.";
assert.equal(validateExaPublicListingReceipts(primerInput, capture([
  sourceRecord({
    sourceText: wrongPrimerText,
    proposal: { ...successProposal, itemIdentity: "Two-part corrosion-resistant urethane primer for wood", manufacturer: null, mpn: null, unitOfMeasure: "kit", evidenceText: wrongPrimerText },
  }),
])).length, 0, "generic validation must retain every requested material discriminator");

const wrongBasisText = "Acme RM-9 radio module uses each packaging while the comparison price is 42.50 USD per case.";
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceText: wrongBasisText, proposal: { ...successProposal, evidenceText: wrongBasisText } }),
])).length, 0, "a unit mention elsewhere in the sentence must not override the explicit price basis");

const fakeCurrencyText = "Acme RM-9 radio module for 42.50 ABC per each.";
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceText: fakeCurrencyText, proposal: { ...successProposal, currency: "ABC", evidenceText: fakeCurrencyText } }),
])).length, 0, "a three-letter token outside ISO 4217 must not become currency");

const wrongManufacturerText = "Acme RM-9 radio module for 42.50 USD per each.";
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceText: wrongManufacturerText, proposal: { ...successProposal, manufacturer: "Contoso", evidenceText: wrongManufacturerText } }),
])).length, 0, "proposal metadata must not replace the source-bound requested manufacturer");

const mismatchedStatusCapture = capture([
  sourceRecord({ sourceStatus: status({ id: "https://other.example/catalog/rm-9" }) }),
]);
assert.equal(validateExaPublicListingReceipts(input, mismatchedStatusCapture).length, 0, "another URL's success status must not authorize this record");
assert.equal(parseStoredExaRetrievalCapture(mismatchedStatusCapture), null, "stored status IDs must bind to their source URL");

const multilineSourceText = "Example Supplier lists the Acme RM-9 radio module for\n42.50 USD per each.";
const multilineEvidenceClaim = "Example Supplier lists the Acme RM-9 radio module for 42.50 USD per each.";
const multilineReceipt = validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceText: multilineSourceText, proposal: { ...successProposal, evidenceText: multilineEvidenceClaim } }),
]));
assert.equal(multilineReceipt.length, 1, "source-derived table or line-break whitespace must not discard an otherwise exact tuple");
assert.match(multilineReceipt[0]?.evidenceExcerpt ?? "", /for\n42\.50/, "the saved excerpt must retain raw source text rather than model-normalized spacing");
assert.equal(parseStoredPublicListingReceipt(multilineReceipt[0])?.receiptHash, multilineReceipt[0]?.receiptHash, "stored receipt parsing must preserve source whitespace bound by its hash");

const crossRowText = "Acme RM-9 radio module technical specifications\nContoso ZX-1 radio module costs 42.50 USD per each";
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceText: crossRowText, proposal: { ...successProposal, evidenceText: crossRowText } }),
])).length, 0, "identity from one logical row must not bind a different row's price tuple");

const misleadingBridgeText = "Acme RM-9 radio module price\nContoso ZX-1 radio module 42.50 USD per each";
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceText: misleadingBridgeText, proposal: { ...successProposal, evidenceText: misleadingBridgeText } }),
])).length, 0, "a connector at the end of one row must not bridge through another product name");

const sameRowCrossProductText = "Acme RM-9 radio module compared with Contoso ZX-1 radio module at 42.50 USD per each";
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceText: sameRowCrossProductText, proposal: { ...successProposal, evidenceText: sameRowCrossProductText } }),
])).length, 0, "same-sentence co-occurrence must not replace an explicit identity-to-price relation");

const wrongPriceBoundMpnText = "Acme RM-9 radio module compared with Contoso ZX-1 radio module for 42.50 USD per each";
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({
    sourceText: wrongPriceBoundMpnText,
    proposal: { ...successProposal, itemIdentity: "Contoso ZX-1 radio module", evidenceText: wrongPriceBoundMpnText },
  }),
])).length, 0, "requested manufacturer and MPN must be inside the item identity that is directly price-bound");

const genericSameRowCrossProductText = "6061-T6 aluminum sheet compared with 5052-H32 steel sheet at 42.50 USD per sheet";
assert.equal(validateExaPublicListingReceipts(genericInput, capture([
  sourceRecord({
    sourceText: genericSameRowCrossProductText,
    proposal: { ...successProposal, itemIdentity: "5052-H32 steel sheet", manufacturer: null, mpn: null, unitOfMeasure: "sheet", evidenceText: genericSameRowCrossProductText },
  }),
])).length, 0, "requested generic attributes must bind to the priced item identity, not merely co-occur in its row");

const identityOnly = "Acme RM-9 radio module technical specifications.";
const priceOnly = "Current price: 42.50 USD per each.";
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceText: identityOnly, proposal: { ...successProposal, priceAmount: null, currency: null, unitOfMeasure: null, evidenceText: identityOnly } }),
  sourceRecord({
    url: "https://supplier.example/prices",
    sourceText: priceOnly,
    sourceStatus: status({ id: "https://supplier.example/prices" }),
    proposal: { ...successProposal, itemIdentity: "price list", mpn: null, evidenceText: priceOnly },
  }),
])).length, 0, "identity and price from different records must never be stitched together");

assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ proposal: { ...successProposal, currency: null } }),
])).length, 0, "missing ISO currency must fail closed");
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ proposal: { ...successProposal, unitOfMeasure: null } }),
])).length, 0, "missing unit or package basis must fail closed");
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({
    sourceText: "Example Supplier lists the Acme RM-9 radio module for 42.1234567 USD per each.",
    proposal: { ...successProposal, priceAmount: 42.1234567, evidenceText: "Example Supplier lists the Acme RM-9 radio module for 42.1234567 USD per each." },
  }),
])).length, 0, "prices outside database decimal precision must fail closed instead of being rounded");
assert.equal(validateExaPublicListingReceipts(input, capture([
  sourceRecord({ sourceStatus: status({ cacheState: "cached", cacheAgeHours: 1 }) }),
])).length, 0, "cached content must not create a forced-live receipt");
assert.equal(validateExaPublicListingReceipts(input, {
  ...capture([sourceRecord()]),
  freshnessPolicy: "FORCED_LIVE",
  records: [{ ...sourceRecord(), status: status({ status: "stale" }) }],
}).length, 0, "non-success per-URL status must fail closed");

async function main() {
const requests: Array<{ url: string; body: Record<string, unknown>; redirect: RequestRedirect | undefined; cache: RequestCache | undefined }> = [];
const fetchFixture = async (request: string | URL | Request, init?: RequestInit) => {
  const url = String(request);
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  requests.push({ url, body, redirect: init?.redirect, cache: init?.cache });
  if (url === "https://api.exa.ai/search") {
    return new Response(JSON.stringify({
      requestId: "search-request-1",
      results: [
        { id: "source-1", title: "RM-9 listing", url: sourceUrl, publishedDate: "1999-01-01T00:00:00.000Z" },
        { id: "source-private", title: "Private target", url: "http://127.0.0.1/internal" },
        { id: "source-2", title: "Unavailable RM-9 listing", url: failedSourceUrl },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  assert.equal(url, "https://api.exa.ai/contents");
  return new Response(JSON.stringify({
    requestId: "contents-request-1",
    results: [{ title: "RM-9 listing", url: sourceUrl, text: successText, highlights: [], summary: successProposal, publishedDate: "1999-01-01T00:00:00.000Z" }],
    statuses: [
      { id: sourceUrl, status: "success" },
      { id: failedSourceUrl, status: "error", error: { tag: "CRAWL_LIVECRAWL_TIMEOUT", httpStatusCode: 504 } },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const result = await searchExaComponentSuppliers(input, {
  apiKey: "fixture-key",
  fetchImpl: fetchFixture,
  now: () => new Date(retrievedAt),
});
assert.deepEqual(requests.map((request) => request.url), ["https://api.exa.ai/search", "https://api.exa.ai/contents"]);
assert.ok(requests.every((request) => request.redirect === "error" && request.cache === "no-store"), "managed requests must reject redirects and bypass HTTP caches");
assert.equal((requests[1]?.body as { maxAgeHours?: number }).maxAgeHours, 0, "contents retrieval must always force a live crawl");
assert.deepEqual((requests[1]?.body as { urls?: string[] }).urls, [sourceUrl, failedSourceUrl], "only public domain URLs returned by the current Exa search may be retrieved");
assert.equal(result.retrieval.records[0]?.status?.status, "success", "the exact per-URL status must remain in the saved capture");
assert.equal(result.retrieval.records[1]?.status?.errorTag, "CRAWL_LIVECRAWL_TIMEOUT", "failed URLs must remain in the saved capture even without content");
assert.equal(result.retrieval.records[0]?.publishedDate, "1999-01-01T00:00:00.000Z", "provider dates may be retained only as source metadata");
assert.equal(result.publicListingReceipts[0]?.retrievedAt, retrievedAt, "provider dates must not replace server-owned retrievedAt");
assert.equal(result.candidates[0]?.companyName, "supplier.example", "public listing identity must use the source domain, not a name proposed from page mentions");
assert.deepEqual(result.candidates[0]?.roles, [], "summary-proposed public supplier roles must not become trusted profile roles");
assert.equal(result.sources[0]?.sourceType, "PUBLIC", "search results must not be called official without separate proof");
assert.equal(result.candidates[0]?.price.freshness, "UNKNOWN", "forced-live retrieval does not invent an effective commercial date");
assert.equal(parseStoredPublicListingReceipt(result.publicListingReceipts[0])?.candidateId, result.candidates[0]?.id, "the UI receipt must bind to the normalized candidate");

const requestedCanonicalUrl = "https://arxiv.org/abs/2307.06435";
const returnedCanonicalUrl = "https://arxiv.org/pdf/2307.06435.pdf";
const canonicalizedResult = await searchExaComponentSuppliers(input, {
  apiKey: "fixture-key",
  now: () => new Date(retrievedAt),
  fetchImpl: async (request) => {
    if (String(request) === "https://api.exa.ai/search") {
      return new Response(JSON.stringify({
        requestId: "search-request-canonicalized",
        results: [{ id: requestedCanonicalUrl, title: "Canonicalized listing", url: requestedCanonicalUrl }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      requestId: "contents-request-canonicalized",
      results: [{
        id: requestedCanonicalUrl,
        url: returnedCanonicalUrl,
        title: "Canonicalized listing",
        text: successText,
        highlights: [],
        summary: successProposal,
      }],
      statuses: [{ id: requestedCanonicalUrl, status: "success" }],
    }), { status: 200 });
  },
});
assert.equal(canonicalizedResult.retrieval.records[0]?.sourceUrl, requestedCanonicalUrl, "the capture must stay bound to the URL Exa was asked to retrieve");
assert.equal(canonicalizedResult.retrieval.records[0]?.text, successText, "a result whose id is the requested URL must survive Exa URL canonicalization");
assert.equal(canonicalizedResult.publicListingReceipts.length, 1, "canonicalized result URLs must not erase an exact listing receipt");

await assert.rejects(
  () => searchExaComponentSuppliers(input, {
    apiKey: "fixture-key",
    fetchImpl: async (request) => {
      if (String(request) === "https://api.exa.ai/search") {
        return new Response(JSON.stringify({ requestId: "search-request-missing-content", results: [{ id: sourceUrl, title: "RM-9", url: sourceUrl }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        requestId: "contents-request-missing-content",
        results: [],
        statuses: [{ id: sourceUrl, status: "success" }],
      }), { status: 200 });
    },
  }),
  (error: unknown) => error instanceof ExaResearchError && error.code === "INVALID_STRUCTURED_RESPONSE",
  "a successful per-URL status without exactly one matching content result must fail closed",
);

const crossingSourceUrl = "https://supplier.example/catalog/rm-9-crossing";
await assert.rejects(
  () => searchExaComponentSuppliers(input, {
    apiKey: "fixture-key",
    fetchImpl: async (request) => {
      if (String(request) === "https://api.exa.ai/search") {
        return new Response(JSON.stringify({
          requestId: "search-request-crossing-content",
          results: [
            { id: sourceUrl, title: "RM-9 A", url: sourceUrl },
            { id: crossingSourceUrl, title: "RM-9 B", url: crossingSourceUrl },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        requestId: "contents-request-crossing-content",
        results: [{
          id: sourceUrl,
          url: crossingSourceUrl,
          title: "Crossing RM-9 result",
          text: successText,
          highlights: [],
          summary: successProposal,
        }],
        statuses: [
          { id: sourceUrl, status: "success" },
          { id: crossingSourceUrl, status: "success" },
        ],
      }), { status: 200 });
    },
  }),
  (error: unknown) => error instanceof ExaResearchError && error.code === "INVALID_STRUCTURED_RESPONSE",
  "one canonicalized content result must not satisfy two requested URLs",
);

const inventedNameResult = await searchExaComponentSuppliers(input, {
  apiKey: "fixture-key",
  now: () => new Date(retrievedAt),
  fetchImpl: async (request) => {
    if (String(request) === "https://api.exa.ai/search") {
      return new Response(JSON.stringify({ requestId: "search-request-2", results: [{ id: "source-1", title: "Acme RM-9 listing", url: sourceUrl }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      requestId: "contents-request-2",
      results: [{ title: "Acme RM-9 listing", url: sourceUrl, text: "Acme RM-9 radio module for 42.50 USD per each.", highlights: [], summary: { ...successProposal, supplierName: "Invented Holdings", evidenceText: "Acme RM-9 radio module for 42.50 USD per each." } }],
      statuses: [{ id: sourceUrl, status: "success" }],
    }), { status: 200 });
  },
});
assert.equal(inventedNameResult.candidates[0]?.companyName, "supplier.example", "invented supplier names and product titles must fall back to the source domain");

const allFailedResult = await searchExaComponentSuppliers(input, {
  apiKey: "fixture-key",
  now: () => new Date(retrievedAt),
  fetchImpl: async (request) => {
    if (String(request) === "https://api.exa.ai/search") {
      return new Response(JSON.stringify({ requestId: "search-request-failed", results: [{ id: "source-failed", title: "Blocked listing", url: failedSourceUrl }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      requestId: "contents-request-failed",
      results: [],
      statuses: [{ id: failedSourceUrl, status: "error", error: { tag: "CRAWL_NOT_FOUND", httpStatusCode: 404 } }],
    }), { status: 200 });
  },
});
assert.equal(allFailedResult.degraded, true, "all per-URL crawl failures must return a degraded result instead of erasing the run");
assert.equal(allFailedResult.retrieval.records[0]?.status?.errorTag, "CRAWL_NOT_FOUND", "all-failure runs must retain exact per-URL failure metadata");
assert.equal(allFailedResult.candidates.length, 0);

let oversizedCalls = 0;
await assert.rejects(
  () => searchExaComponentSuppliers(input, {
    apiKey: "fixture-key",
    fetchImpl: async (request) => {
      oversizedCalls += 1;
      if (String(request) === "https://api.exa.ai/search") {
        return new Response(JSON.stringify({ requestId: "search-request-1", results: [{ id: "source-1", title: "RM-9", url: sourceUrl }] }), { status: 200 });
      }
      return new Response("{}", { status: 200, headers: { "content-length": "1000001" } });
    },
  }),
  (error: unknown) => error instanceof ExaResearchError && error.code === "PROVIDER_RESPONSE_TOO_LARGE",
);
assert.equal(oversizedCalls, 2);

await assert.rejects(
  () => searchExaComponentSuppliers(input, {
    apiKey: "fixture-key",
    fetchImpl: async (request) => {
      if (String(request) === "https://api.exa.ai/search") {
        return new Response(JSON.stringify({ requestId: "search-request-1", results: [{ id: "source-1", title: "RM-9", url: sourceUrl }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ padding: "x".repeat(1_000_000) }), { status: 200 });
    },
  }),
  (error: unknown) => error instanceof ExaResearchError && error.code === "PROVIDER_RESPONSE_TOO_LARGE",
  "a streaming response without content-length must be stopped at the byte cap",
);

console.log("Supply OS Exa forced-live retrieval and evidence binding contract passed.");
}

void main();
