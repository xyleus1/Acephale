import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAiContactPageFinder, createOpenAiProspectingSearch } from "../src/lib/leadgen/openai-discovery";
import { createOpenAiLeadQualifier, verifyQualificationQuotes } from "../src/lib/leadgen/openai-qualify";
import { OLYMPIAN_PROFILE } from "../src/lib/leadgen/profile-olympian";
import { buildQueryPlan } from "../src/lib/leadgen/query-plan";
import { runProspectingBatch } from "../src/lib/leadgen/run";
import type { FetchedPage } from "../src/lib/leadgen/harvest";

function response(value: unknown, status = "completed") {
  return { status, output_text: JSON.stringify(value) };
}

function discoveryResponse(companies: unknown[], sourceUrls: string[] = []) {
  return {
    ...response({ companies, warnings: [] }),
    output: sourceUrls.map((url) => ({
      type: "web_search_call",
      action: { sources: [{ url }] },
    })),
  };
}

const query = buildQueryPlan(OLYMPIAN_PROFILE, { limit: 1 })[0]!;

test("OpenAI discovery parses, filters, deduplicates, and passes known domains", async () => {
  const requests: string[] = [];
  const search = createOpenAiProspectingSearch({
    profile: OLYMPIAN_PROFILE,
    supplementThreshold: 5,
    dependencies: {
      apiKey: "test",
      createResponse: async (request) => {
        requests.push(String(request.input));
        return discoveryResponse([
          { name: "Good Hotel", homepageUrl: "https://example.com/hotel", country: "US", reason: "A resort hotel.", sourceUrl: "https://example.com/source" },
          { name: "Duplicate Hotel", homepageUrl: "https://www.example.com/other", country: "US", reason: "Same domain.", sourceUrl: "https://example.com/source" },
          { name: "IP", homepageUrl: "https://93.184.216.34/", country: "US", reason: "IP.", sourceUrl: "https://example.com/source" },
          { name: "Social", homepageUrl: "https://www.facebook.com/hotel", country: "US", reason: "Social.", sourceUrl: "https://example.com/source" },
          { name: "Bad URL", homepageUrl: "not-a-url", country: "US", reason: "Bad.", sourceUrl: "https://example.com/source" },
        ], ["HTTPS://EXAMPLE.COM/source/#result"]);
      },
    },
    supplement: async () => ({ hits: [], pagesFetched: 0, providersUsed: ["html:brave"] }),
  });
  const first = await search(query);
  assert.equal(first.hits.length, 1);
  assert.equal(first.hits[0]?.engine, "openai");
  assert.equal(first.hits[0]?.provider, "openai");
  assert.equal(first.hits[0]?.domain, "example.com");
  assert.equal(first.hits[0]?.sourceUrl, "https://example.com/source");
  assert.ok(requests[0]?.includes('"knownDomainsToSkip":[]'));
  const second = await search(query);
  assert.equal(second.hits.length, 0);
  assert.ok(requests[1]?.includes('"knownDomainsToSkip":["example.com"]'));
  assert.equal(search.warnings().length, 0);
});

test("OpenAI discovery drops source URLs absent from provider results", async () => {
  const search = createOpenAiProspectingSearch({
    profile: OLYMPIAN_PROFILE,
    supplementThreshold: 0,
    dependencies: {
      apiKey: "test",
      createResponse: async () => discoveryResponse([
        { name: "Good Hotel", homepageUrl: "https://example.com/hotel", country: "US", reason: "A resort hotel.", sourceUrl: "https://example.com/model-source" },
      ], ["https://example.com/provider-source"]),
    },
  });
  const result = await search(query);
  assert.equal(result.hits[0]?.sourceUrl, undefined);
});

test("OpenAI discovery supplements sparse or failed responses", async () => {
  let supplementCalls = 0;
  const search = createOpenAiProspectingSearch({
    profile: OLYMPIAN_PROFILE,
    supplementThreshold: 2,
    dependencies: {
      apiKey: "test",
      createResponse: async () => {
        throw new Error("provider unavailable");
      },
    },
    supplement: async () => {
      supplementCalls += 1;
      return { hits: [{ url: "https://example.org/", domain: "example.org", engine: "brave", rank: 1 }], pagesFetched: 1, providersUsed: ["html:brave"] };
    },
  });
  const result = await search(query);
  assert.equal(result.hits.length, 1);
  assert.equal(supplementCalls, 1);
  assert.equal(result.pagesFetched, 1);
  assert.ok(search.warnings()[0]?.includes("provider unavailable"));
});

test("OpenAI qualification verifies quotes and requires surviving must-have evidence", async () => {
  const qualifier = createOpenAiLeadQualifier({
    apiKey: "test",
    createResponse: async () => response({
      verdict: "qualified",
      companyType: "hotel operator",
      confidence: 0.9,
      summary: "Operates a qualifying resort.",
      disqualifiedBy: null,
      evidence: OLYMPIAN_PROFILE.qualification!.mustHave.map((criterion, index) => ({
        criterion,
        status: "met",
        quote: index === 0 ? "fabricated quote" : "Nevada resort with 200 rooms and a guest shuttle",
      })),
    }),
  });
  const result = await qualifier({
    profile: OLYMPIAN_PROFILE,
    companyName: "Example Resort",
    domain: "example.com",
    pageText: "Example Resort operates a Nevada resort with 200 rooms and a guest shuttle.",
  });
  assert.equal(result?.verdict, "needs_review");
  assert.equal(result?.evidence[0]?.quote, "");
  const missingProfile = await qualifier({
    profile: { ...OLYMPIAN_PROFILE, qualification: undefined },
    companyName: "Example",
    domain: "example.com",
    pageText: "Example",
  });
  assert.equal(missingProfile, null);
});

test("OpenAI qualification normalizes must-have criteria", async () => {
  const qualifier = createOpenAiLeadQualifier({
    apiKey: "test",
    createResponse: async () => response({
      verdict: "qualified",
      companyType: "hotel operator",
      confidence: 0.9,
      summary: "Operates a qualifying resort.",
      disqualifiedBy: null,
      evidence: OLYMPIAN_PROFILE.qualification!.mustHave.map((criterion, index) => ({
        criterion: index === 0 ? criterion.toUpperCase() : criterion,
        status: "met",
        quote: index === 0 ? "Example resort operator" : "Nevada resort with 200 rooms and a guest shuttle",
      })),
    }),
  });
  const result = await qualifier({
    profile: OLYMPIAN_PROFILE,
    companyName: "Example Resort",
    domain: "example.com",
    pageText: "Example resort operator. Nevada resort with 200 rooms and a guest shuttle.",
  });
  assert.equal(result?.verdict, "qualified");
});

test("OpenAI qualification lets proven disqualifiers override a qualified verdict", async () => {
  const disqualifier = OLYMPIAN_PROFILE.qualification!.disqualifiers[0]!;
  const qualifier = createOpenAiLeadQualifier({
    apiKey: "test",
    createResponse: async () => response({
      verdict: "qualified",
      companyType: "hotel operator",
      confidence: 0.9,
      summary: "The page also identifies a booking directory.",
      disqualifiedBy: null,
      evidence: [
        ...OLYMPIAN_PROFILE.qualification!.mustHave.map((criterion) => ({
          criterion,
          status: "met",
          quote: "Example resort operator in Nevada with 200 rooms and a guest shuttle",
        })),
        {
          criterion: disqualifier,
          status: "met",
          quote: "Example booking directory",
        },
      ],
    }),
  });
  const result = await qualifier({
    profile: OLYMPIAN_PROFILE,
    companyName: "Example Resort",
    domain: "example.com",
    pageText: "Example resort operator in Nevada with 200 rooms and a guest shuttle. Example booking directory.",
  });
  assert.equal(result?.verdict, "disqualified");
  assert.equal(result?.disqualifiedBy, disqualifier);
});

test("OpenAI qualification downgrades disqualification without a valid quote", async () => {
  const qualifier = createOpenAiLeadQualifier({
    apiKey: "test",
    createResponse: async () => response({
      verdict: "disqualified",
      companyType: "directory",
      confidence: 0.8,
      summary: "The page does not prove a disqualifying company type.",
      disqualifiedBy: "Online travel agency, booking aggregator, review or directory site",
      evidence: [{
        criterion: "Online travel agency, booking aggregator, review or directory site",
        status: "met",
        quote: "fabricated directory quote",
      }],
    }),
  });
  const result = await qualifier({
    profile: OLYMPIAN_PROFILE,
    companyName: "Example",
    domain: "example.com",
    pageText: "Example hotel homepage",
  });
  assert.equal(result?.verdict, "needs_review");
  assert.equal(result?.disqualifiedBy, null);
});

test("OpenAI qualification rejects unsupported disqualifiers", async () => {
  const qualifier = createOpenAiLeadQualifier({
    apiKey: "test",
    createResponse: async () => response({
      verdict: "disqualified",
      companyType: "directory",
      confidence: 0.8,
      summary: "Unsupported disqualifier.",
      disqualifiedBy: "Unsupported criterion",
      evidence: [{
        criterion: OLYMPIAN_PROFILE.qualification!.mustHave[0]!,
        status: "met",
        quote: "Example hotel operator",
      }, {
        criterion: "Unsupported criterion",
        status: "met",
        quote: "Example directory",
      }],
    }),
  });
  const result = await qualifier({
    profile: OLYMPIAN_PROFILE,
    companyName: "Example",
    domain: "example.com",
    pageText: "Example hotel operator. Example directory",
  });
  assert.equal(result?.verdict, "needs_review");
  assert.equal(result?.disqualifiedBy, null);
});

test("Qualification quote verification requires a configured disqualifier", () => {
  const qualification = {
    verdict: "disqualified" as const,
    companyType: "directory",
    confidence: 0.8,
    summary: "Directory.",
    disqualifiedBy: "Unsupported criterion",
    evidence: [{
      criterion: "Unsupported criterion",
      status: "met" as const,
      quote: "Example directory",
    }],
    model: "test",
    qualifiedAt: "2026-01-01T00:00:00.000Z",
  };
  const result = verifyQualificationQuotes(
    qualification,
    "Example directory",
    OLYMPIAN_PROFILE.qualification!.disqualifiers,
  );
  assert.equal(result.verdict, "needs_review");
  assert.equal(result.disqualifiedBy, null);
});

test("Qualification disqualifier matching ignores capitalization and whitespace", () => {
  const configured = OLYMPIAN_PROFILE.qualification!.disqualifiers[0]!;
  const result = verifyQualificationQuotes({
    verdict: "disqualified",
    companyType: "directory",
    confidence: 0.8,
    summary: "Directory.",
    disqualifiedBy: `  ${configured.toUpperCase()}  `,
    evidence: [{
      criterion: configured.toUpperCase(),
      status: "met",
      quote: "Example directory",
    }],
    model: "test",
    qualifiedAt: "2026-01-01T00:00:00.000Z",
  }, "Example directory", OLYMPIAN_PROFILE.qualification!.disqualifiers);
  assert.equal(result.verdict, "disqualified");
  assert.equal(result.disqualifiedBy, configured);
});

test("OpenAI contact finder keeps only same-domain public URLs", async () => {
  const finder = createOpenAiContactPageFinder({
    apiKey: "test",
    createResponse: async () => response({
      urls: ["https://example.com/contact", "https://other.example/contact", "https://93.184.216.34/"],
    }),
  });
  assert.deepEqual(await finder({ companyName: "Example", domain: "example.com" }), ["https://example.com/contact"]);
});

test("batch qualification keeps disqualified rows and finds contact pages for qualified rows", async () => {
  const pages: Record<string, FetchedPage> = {
    "https://disqualified.example/": {
      url: "https://disqualified.example/",
      status: 200,
      contentType: "text/html",
      body: "<title>Example Hotel</title><p>Nevada resort with 200 rooms and a guest shuttle.</p>",
      isPdf: false,
    },
    "https://qualified.example/": {
      url: "https://qualified.example/",
      status: 200,
      contentType: "text/html",
      body: "<title>Qualified Resort</title><p>Nevada hotel resort with 200 rooms and a guest shuttle.</p>",
      isPdf: false,
    },
    "https://qualified.example/contact": {
      url: "https://qualified.example/contact",
      status: 200,
      contentType: "text/html",
      body: "<p>sales@qualified.example</p>",
      isPdf: false,
    },
  };
  let enrichCalls = 0;
  let contactCalls = 0;
  const qualifier = async ({ companyName }: { companyName: string }) => ({
    verdict: companyName === "Example Hotel" ? "disqualified" as const : "qualified" as const,
    companyType: "hotel operator",
    confidence: 0.9,
    summary: companyName,
    disqualifiedBy: companyName === "Example Hotel" ? "Booking site" : null,
    evidence: [{ criterion: "criterion", status: "met" as const, quote: "Nevada resort" }],
    model: "test",
    qualifiedAt: new Date().toISOString(),
  });
  const result = await runProspectingBatch({
    profile: OLYMPIAN_PROFILE,
    maxQueries: 1,
    maxPages: 6,
    budgetMs: 10_000,
    enricher: {
      name: "fake",
      async enrichDomain() {
        enrichCalls += 1;
        return [];
      },
      usage: () => ({ provider: "fake", calls: enrichCalls, billable: enrichCalls, contacts: 0, failures: 0, exhausted: false }),
    },
    verifier: null,
    qualifier,
    contactFinder: async () => {
      contactCalls += 1;
      return ["https://qualified.example/contact"];
    },
    search: async () => [
      { url: "https://disqualified.example/", domain: "disqualified.example", engine: "openai", provider: "openai", rank: 1 },
      { url: "https://qualified.example/", domain: "qualified.example", engine: "openai", provider: "openai", rank: 2, sourceUrl: "https://source.example/result" },
    ],
    fetchPage: async (url) => pages[url] ?? pages[`${url}/`] ?? null,
    resolveMx: async () => [{ exchange: "mx.example", priority: 10 }],
  });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0]?.candidate.qualification?.verdict, "disqualified");
  assert.equal(result.candidates[1]?.candidate.emails[0], "sales@qualified.example");
  assert.equal(result.candidates[1]?.candidate.discoverySourceUrl, "https://source.example/result");
  assert.equal(result.candidates[1]?.candidate.website, "https://qualified.example/");
  assert.equal(result.candidates[0]?.candidate.pageText, undefined);
  assert.equal(result.candidates[1]?.candidate.pageText, undefined);
  assert.equal(enrichCalls, 1);
  assert.equal(contactCalls, 1);
  assert.deepEqual(result.stats.qualification, { calls: 2, qualified: 1, needsReview: 0, disqualified: 1, failures: 0, skippedByCap: 0 });
  assert.deepEqual(result.stats.contactLookups, { calls: 1, pagesFetched: 1, emailsFound: 1, failures: 0 });
});

test("batch ignores contact pages whose fetched URL changes registrable domain", async () => {
  const result = await runProspectingBatch({
    profile: OLYMPIAN_PROFILE,
    maxQueries: 1,
    maxPages: 4,
    budgetMs: 10_000,
    enricher: null,
    verifier: null,
    qualifier: async () => ({
      verdict: "qualified" as const,
      companyType: "hotel operator",
      confidence: 0.9,
      summary: "Qualified.",
      disqualifiedBy: null,
      evidence: [],
      model: "test",
      qualifiedAt: new Date().toISOString(),
    }),
    contactFinder: async () => ["https://qualified.example/contact"],
    search: async () => [{
      url: "https://qualified.example/",
      domain: "qualified.example",
      engine: "openai",
      provider: "openai",
      rank: 1,
    }],
    fetchPage: async (url) => ({
      url: url.endsWith("/contact") ? "https://other.example/contact" : url,
      status: 200,
      contentType: "text/html",
      body: url.endsWith("/contact") ? "<p>sales@other.example</p>" : "<p>Nevada hotel resort with 200 rooms.</p>",
      isPdf: false,
    }),
  });
  const candidate = result.candidates[0]?.candidate;
  assert.equal(candidate?.emails.length, 0);
  assert.equal(candidate?.evidence.some((item) => item.kind === "contact"), false);
});
