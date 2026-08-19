import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type OpenAI from "openai";
import { validatePublicSupplierLeadReceipts } from "../src/lib/supply-os/exa-supplier-research";
import {
  defaultOpenAiPageTransport,
  isPublicSupplierResearchAddress,
  OpenAiPageRetrievalError,
  OpenAiSupplierResearchError,
  retrieveOpenAiPublicPage,
  searchOpenAiComponentSuppliers,
  type OpenAiSupplierResearchDependencies,
} from "../src/lib/supply-os/openai-supplier-research";
import { isSupplierDiscoveryUrl } from "../src/lib/supply-os/supplier-discovery-url";

const now = new Date("2026-08-13T12:00:00.000Z");
const sourceUrl = "https://acmeindustrial.example/catalog/dp420";
const secondSourceUrl = "https://secondindustrial.example/catalog/dp420";
const thirdSourceUrl = "https://thirdindustrial.example/catalog/dp420";
const nationalSourceUrl = "https://nationalaa.com/products/aluminum-plate/";
const trackedNationalSourceUrl = `${nationalSourceUrl}?utm_source=openai&srsltid=tracking-token`;
const identityEvidence = "Acme Industrial operates this public product catalog.";
const roleEvidence = "Stocking distributor for industrial adhesives.";
const capabilityEvidence = "Supplies 3M Scotch-Weld DP420 structural epoxy.";
const pageHtml = `<html><head><title>Acme DP420</title></head><body>${identityEvidence} ${roleEvidence} ${capabilityEvidence}</body></html>`;

const input = {
  officeId: "office-test",
  workspaceId: "workspace-test",
  componentItemKey: "GUILD-011",
  componentName: "Bonding epoxy",
  manufacturer: "3M",
  mpn: "DP420",
  specification: "3M Scotch-Weld DP420 two-part structural epoxy",
  requiredProvider: "OPENAI" as const,
};

function lead(source = sourceUrl) {
  return {
    sourceUrl: source,
    companyName: "Acme Industrial",
    supplierRole: "DISTRIBUTOR",
    itemIdentity: "3M Scotch-Weld DP420 structural epoxy",
    companyIdentityEvidence: identityEvidence,
    supplierRoleEvidence: roleEvidence,
    productCapabilityEvidence: capabilityEvidence,
  };
}

function nativeResponse(args: {
  leads?: unknown[];
  sourceUrls?: string[];
  citations?: string[];
  badRange?: boolean;
  callCount?: number;
} = {}) {
  const leads = args.leads ?? [lead()];
  const sourceUrls = args.sourceUrls ?? [sourceUrl];
  const citationUrls = args.citations ?? [sourceUrl];
  const outputText = JSON.stringify({ leads, warnings: [] });
  const output = Array.from({ length: args.callCount ?? 1 }, (_, index) => ({
    id: `web-search-${index + 1}`,
    type: "web_search_call",
    status: "completed",
    action: {
      type: "search",
      query: "3M DP420 distributor",
      queries: ["3M DP420 distributor"],
      sources: sourceUrls.map((url) => ({ type: "url", url })),
    },
  }));
  output.push({
    id: "message-1",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{
      type: "output_text",
      text: outputText,
      annotations: citationUrls.map((url) => ({
        type: "url_citation",
        start_index: 0,
        end_index: args.badRange ? outputText.length + 1 : 1,
        title: "Supplier page",
        url,
      })),
    }],
  });
  return {
    id: "response-1",
    object: "response",
    created_at: 1_786_622_400,
    status: "completed",
    error: null,
    incomplete_details: null,
    model: "gpt-5.6",
    output_text: outputText,
    output,
  };
}

function htmlResponse(html: string, status = 200, extraHeaders: Record<string, string> = {}) {
  const body = new TextEncoder().encode(html);
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "content-length": String(body.byteLength), ...extraHeaders },
    body,
  };
}

function dependencies(response: unknown, htmlByUrl: Record<string, string> = { [sourceUrl]: pageHtml }) {
  const requested: Array<{ url: string; address: string }> = [];
  const value: OpenAiSupplierResearchDependencies = {
    apiKey: "fixture-key",
    createResponse: async (request, signal) => {
      assert.equal(signal.aborted, false);
      assert.equal((request as { store?: boolean }).store, false);
      assert.equal((request as { max_tool_calls?: number }).max_tool_calls, 1);
      assert.equal((request as { parallel_tool_calls?: boolean }).parallel_tool_calls, false);
      return response;
    },
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    transport: async ({ url, address }) => {
      requested.push({ url: url.toString(), address: address.address });
      return htmlResponse(htmlByUrl[url.toString()] ?? pageHtml);
    },
    now: () => now,
  };
  return { value, requested };
}

async function validLeadTest() {
  const fixture = dependencies(nativeResponse());
  const result = await searchOpenAiComponentSuppliers(input, fixture.value);
  assert.equal(result.retrieval.provider, "OPENAI");
  assert.equal(result.retrieval.freshnessPolicy, "SERVER_RETRIEVED");
  assert.equal(result.retrieval.searchHttpStatus, 200);
  assert.equal(result.retrieval.contentsHttpStatus, 200);
  assert.match(result.retrieval.searchResponseHash, /^[a-f0-9]{64}$/);
  assert.match(result.retrieval.contentsResponseHash, /^[a-f0-9]{64}$/);
  assert.equal(result.retrieval.records.length, 1);
  assert.equal(result.retrieval.records[0]?.status.id, sourceUrl);
  assert.equal(result.retrieval.records[0]?.sourceTextHash, createHash("sha256").update(result.retrieval.records[0]!.text).digest("hex"));
  assert.equal(result.publicSupplierLeadReceipts.length, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.candidates[0]?.roles, ["DISTRIBUTOR"]);
  assert.equal(result.candidates[0]?.productCapability.state, "SUPPORTED");
  assert.equal(result.candidates[0]?.productCapability.sources[0]?.sourceType, "PUBLIC");
  assert.equal(result.candidates[0]?.price.state, "UNKNOWN");
  assert.equal(fixture.requested[0]?.address, "93.184.216.34", "retrieval must use only the vetted resolved address");
  const tamperedCapture = structuredClone(result.retrieval);
  tamperedCapture.records[0]!.text = "Tampered after retrieval.";
  assert.equal(validatePublicSupplierLeadReceipts(input, tamperedCapture).length, 0, "stored source text must remain bound to its capture hash");
}

async function sourceBindingTests() {
  const structuredOutputWithoutAnnotations = dependencies(nativeResponse({ citations: [] }));
  const structuredOutputWithoutAnnotationsResult = await searchOpenAiComponentSuppliers(input, structuredOutputWithoutAnnotations.value);
  assert.equal(structuredOutputWithoutAnnotationsResult.candidates.length, 1, "a provider source may be validated when structured JSON has no citation annotation");
  assert.equal(structuredOutputWithoutAnnotations.requested.length, 1, "provider-returned source URLs must still be independently retrieved");

  const sourceOutsideProviderResults = dependencies(nativeResponse({
    leads: [lead(secondSourceUrl)],
    sourceUrls: [sourceUrl],
    citations: [sourceUrl],
  }));
  const sourceOutsideProviderResultsResult = await searchOpenAiComponentSuppliers(input, sourceOutsideProviderResults.value);
  assert.equal(sourceOutsideProviderResultsResult.candidates.length, 0, "a proposal outside the provider source set cannot admit a lead");
  assert.equal(sourceOutsideProviderResults.requested.length, 0, "model-proposed URLs outside the provider source set must not be fetched");

  const trackedCitation = dependencies(nativeResponse({
    leads: [lead(nationalSourceUrl)],
    sourceUrls: [nationalSourceUrl, trackedNationalSourceUrl],
    citations: [trackedNationalSourceUrl],
  }));
  const trackedCitationResult = await searchOpenAiComponentSuppliers(input, trackedCitation.value);
  assert.equal(trackedCitation.requested.length, 1, "known tracking parameters must not prevent independently retrieving a natively cited supplier page");
  assert.equal(trackedCitation.requested[0]?.url, nationalSourceUrl);
  assert.deepEqual(trackedCitationResult.sources.map((source) => source.url), [nationalSourceUrl], "tracking-only URL variants must collapse to one discovered source");
  assert.equal(trackedCitationResult.retrieval.records.length, 1);

  await assert.rejects(
    () => searchOpenAiComponentSuppliers(input, dependencies(nativeResponse({ badRange: true })).value),
    /INVALID_STRUCTURED_RESPONSE/,
    "invalid native citation offsets must fail closed",
  );
  await assert.rejects(
    () => searchOpenAiComponentSuppliers(input, dependencies(nativeResponse({ callCount: 2 })).value),
    /INVALID_STRUCTURED_RESPONSE/,
    "more than one web search call must fail closed even if a fixture bypasses max_tool_calls",
  );
  const oversized = nativeResponse();
  oversized.output_text = "x".repeat(64_001);
  await assert.rejects(
    () => searchOpenAiComponentSuppliers(input, dependencies(oversized).value),
    (error: unknown) => error instanceof OpenAiSupplierResearchError && error.code === "PROVIDER_RESPONSE_TOO_LARGE",
  );
}

async function sourceQualityTests() {
  const blockedUrls = [
    "https://www.reddit.com/r/Machinists/comments/example",
    "https://en.wikipedia.org/wiki/6061_aluminium_alloy",
    "https://www.youtube.com/watch?v=example",
    "https://arxiv.org/abs/1507.06938",
    "https://materialsdata.nist.gov/example.pdf",
    "https://engineering.example.edu/materials/aluminum",
  ];
  for (const url of blockedUrls) {
    assert.equal(isSupplierDiscoveryUrl(url), false, `${url} is reference material, not a supplier lead`);
  }
  for (const url of [nationalSourceUrl, "https://www.mcmaster.com/products/made-to-order-6061-aluminum-sheets/"]) {
    assert.equal(isSupplierDiscoveryUrl(url), true, `${url} is a legitimate supplier catalog`);
  }

  const mixed = dependencies(nativeResponse({
    leads: [...blockedUrls.slice(0, 5).map((url) => lead(url)), lead()],
    sourceUrls: [...blockedUrls, sourceUrl],
    citations: [...blockedUrls, sourceUrl],
  }));
  const mixedResult = await searchOpenAiComponentSuppliers(input, mixed.value);
  assert.deepEqual(mixedResult.sources.map((source) => source.url), [sourceUrl], "reference and community URLs must be removed before sources reach the result");
  assert.deepEqual(mixed.requested.map((request) => request.url), [sourceUrl], "reference and community URLs must never consume independent retrieval slots");

  const blockedOnly = dependencies(nativeResponse({
    leads: blockedUrls.map((url) => lead(url)),
    sourceUrls: blockedUrls,
    citations: blockedUrls,
  }));
  const blockedOnlyResult = await searchOpenAiComponentSuppliers(input, blockedOnly.value);
  assert.equal(blockedOnlyResult.sources.length, 0, "a junk-only search response must expose no supplier discovery URLs");
  assert.equal(blockedOnly.requested.length, 0, "a junk-only search response must trigger no page retrieval");
  assert.ok(blockedOnlyResult.warnings.includes("Public supplier lead pipeline: 0 discovered URLs, 0 eligible proposals, 0 retrieval attempts, 0 retrieved pages, 0 validated leads."));
}

async function evidenceForgeryTests() {
  const forged = dependencies(nativeResponse(), { [sourceUrl]: "<html><body>Unrelated page text.</body></html>" });
  const forgedResult = await searchOpenAiComponentSuppliers(input, forged.value);
  assert.equal(forgedResult.publicSupplierLeadReceipts.length, 0);
  assert.equal(forgedResult.candidates.length, 0, "structured model claims cannot survive without exact page evidence");
  assert.ok(forgedResult.warnings.includes("Public supplier lead pipeline: 1 discovered URLs, 1 eligible proposals, 1 retrieval attempts, 1 retrieved pages, 0 validated leads."));

  const emptyLeadsResult = await searchOpenAiComponentSuppliers(input, dependencies(nativeResponse({ leads: [] })).value);
  assert.ok(emptyLeadsResult.warnings.includes("Public supplier lead pipeline: 1 discovered URLs, 0 eligible proposals, 0 retrieval attempts, 0 retrieved pages, 0 validated leads."));

  const wrongCompanyLead = { ...lead(), companyName: "Different Company" };
  const wrongCompany = dependencies(nativeResponse({ leads: [wrongCompanyLead] }));
  assert.equal((await searchOpenAiComponentSuppliers(input, wrongCompany.value)).candidates.length, 0, "company and source domain must bind deterministically");
}

async function pinnedRetrievalTests() {
  assert.equal(isPublicSupplierResearchAddress("93.184.216.34", 4), true);
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "203.0.113.5", "255.255.255.255"]) {
    assert.equal(isPublicSupplierResearchAddress(address, 4), false, address);
  }
  for (const address of [
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:0:127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1::a9fe:a9fe",
    "100::1",
    "100:0:0:1::1",
    "2001:2::1",
    "2001:10::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "5f00::1",
    "fc00::1",
    "fe80::1",
  ]) {
    assert.equal(isPublicSupplierResearchAddress(address, 6), false, address);
  }
  assert.equal(isPublicSupplierResearchAddress("2606:4700:4700::1111", 6), true);
  assert.equal(isPublicSupplierResearchAddress("4000::1", 6), false, "unallocated IPv6 outside 2000::/3 must fail closed");
  await assert.rejects(
    () => retrieveOpenAiPublicPage(sourceUrl, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }],
      transport: async () => htmlResponse(pageHtml),
    }),
    (error: unknown) => error instanceof OpenAiPageRetrievalError && error.code === "PAGE_DNS_REJECTED",
    "mixed public/private DNS answers must fail closed",
  );
  await assert.rejects(
    () => retrieveOpenAiPublicPage(sourceUrl, {
      resolve: async () => new Promise<never>(() => undefined),
      pageTimeoutMs: 25,
    }),
    (error: unknown) => error instanceof OpenAiPageRetrievalError && error.code === "PAGE_TIMEOUT",
    "the page deadline must include DNS resolution rather than starting only after DNS returns",
  );
  await assert.rejects(
    () => retrieveOpenAiPublicPage(sourceUrl, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async () => htmlResponse("", 302, { location: "https://other.example" }),
    }),
    (error: unknown) => error instanceof OpenAiPageRetrievalError && error.code === "PAGE_REDIRECT_REJECTED",
  );
  await assert.rejects(
    () => retrieveOpenAiPublicPage("https://supplier.example/login", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async () => htmlResponse("<html><body>Sign in to continue</body></html>"),
    }),
    (error: unknown) => error instanceof OpenAiPageRetrievalError && error.code === "PAGE_LOGIN_OR_PAYWALL",
  );
  await assert.rejects(
    () => retrieveOpenAiPublicPage(sourceUrl, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async () => ({
        status: 200,
        headers: { "content-type": "text/html", "content-length": "1000001" },
        body: new Uint8Array(),
      }),
    }),
    (error: unknown) => error instanceof OpenAiPageRetrievalError && error.code === "PAGE_RESPONSE_TOO_LARGE",
  );

}

async function defaultTransportRegressionTest() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("supplier page");
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return;
    throw error;
  }
  try {
    const address = server.address() as AddressInfo;
    const response = await defaultOpenAiPageTransport({
      url: new URL(`http://supplier.example:${address.port}/catalog`),
      address: { address: "127.0.0.1", family: 4 },
      timeoutMs: 1_000,
      maxBytes: 1_024,
    });
    assert.equal(response.status, 200);
    assert.equal(new TextDecoder().decode(response.body), "supplier page");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function defaultTransportAbsoluteDeadlineTest() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    const interval = setInterval(() => response.write("x"), 10);
    response.once("close", () => clearInterval(interval));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return;
    throw error;
  }
  try {
    const address = server.address() as AddressInfo;
    const startedAt = Date.now();
    await assert.rejects(
      () => defaultOpenAiPageTransport({
        url: new URL(`http://supplier.example:${address.port}/slow`),
        address: { address: "127.0.0.1", family: 4 },
        timeoutMs: 80,
        maxBytes: 1_024,
      }),
      (error: unknown) => error instanceof OpenAiPageRetrievalError && error.code === "PAGE_TIMEOUT",
      "slow-drip responses must hit an absolute wall-clock deadline instead of resetting an idle timer forever",
    );
    assert.ok(Date.now() - startedAt < 500, "the absolute deadline must end a slow-drip response promptly");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function boundedConcurrencyTest() {
  const sources = [sourceUrl, secondSourceUrl, thirdSourceUrl];
  const leads = sources.map((url) => ({ ...lead(url), companyName: new URL(url).hostname.split(".")[0] }));
  const response = nativeResponse({ leads, sourceUrls: sources, citations: sources });
  let active = 0;
  let peak = 0;
  const fixture = dependencies(response);
  fixture.value.transport = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return htmlResponse("<html><body>Not enough evidence for a receipt.</body></html>");
  };
  await searchOpenAiComponentSuppliers(input, fixture.value);
  assert.equal(peak, 3, "page retrieval must use bounded concurrency three rather than six sequential timeouts");
}

async function main() {
  await validLeadTest();
  await sourceBindingTests();
  await sourceQualityTests();
  await evidenceForgeryTests();
  await pinnedRetrievalTests();
  await defaultTransportRegressionTest();
  await defaultTransportAbsoluteDeadlineTest();
  await boundedConcurrencyTest();
  console.log("Supply OS OpenAI retrieval contract passed.");
}

void main();
