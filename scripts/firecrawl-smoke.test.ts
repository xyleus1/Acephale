import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { FirecrawlClient, normalizeFirecrawlScrapeResponse, normalizeFirecrawlSearchResponse } from "../src/lib/market-intelligence/firecrawl-client";
import { ingestFirecrawlMarketSource } from "../src/lib/market-intelligence/ingest-firecrawl-source";
import type { MarketIntelligenceSourceDefinition } from "../src/lib/market-intelligence/source-registry";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

const fixtureUrl = "https://example.com/research/asia-europe-rate-surge";
const searchResponse = {
  success: true,
  id: "fc-search-fixture",
  creditsUsed: 1,
  data: {
    web: [
      {
        title: "Asia-Europe ocean spot rates rising on China to Northern Europe lane",
        description: "Forwarders report a significant surge from Shanghai and Ningbo to Hamburg and Rotterdam.",
        url: fixtureUrl,
        metadata: { title: "Asia-Europe rates", sourceURL: fixtureUrl },
      },
    ],
  },
};
const scrapeResponse = {
  success: true,
  creditsUsed: 1,
  data: {
    markdown: [
      "# Asia-Europe ocean spot rates rising on China to Northern Europe lane",
      "Asia-Europe ocean spot rates are in a significant surge this week as capacity tightens.",
      "Forwarders report pressure from China ports including Shanghai and Ningbo into Northern Europe, especially Hamburg and Rotterdam.",
      "Several carriers announced blank sailings and rate increases.",
      "Operators should review active CN -> EU RFQs before sending customer pricing.",
    ].join("\n\n"),
    metadata: {
      title: "Asia-Europe ocean spot rates rising on China to Northern Europe lane",
      description: "Mock Firecrawl scrape for Derya market intelligence.",
      sourceURL: fixtureUrl,
      articlePublishedTime: "2026-06-22T08:00:00.000Z",
      statusCode: 200,
      contentType: "text/html",
    },
  },
};

async function main() {
  const normalizedSearch = normalizeFirecrawlSearchResponse(searchResponse);
  assert(normalizedSearch.items.length === 1, "Expected one normalized search result.");
  assert(normalizedSearch.items[0]?.url === fixtureUrl, "Search result URL normalization failed.");
  const normalizedScrape = normalizeFirecrawlScrapeResponse(scrapeResponse);
  assert(normalizedScrape.item?.markdown?.includes("significant surge"), "Scrape markdown normalization failed.");
  const broadClient = new FirecrawlClient({
    apiKey: "test-firecrawl-key",
    baseUrl: "https://firecrawl.test/v2",
    fetchImpl: (async () => {
      throw new Error("Broad Firecrawl search should not call fetch.");
    }) as typeof fetch,
  });
  await broadClient.search({ query: "ocean rates", includeDomains: [] })
    .then(() => {
      throw new Error("Broad Firecrawl search without includeDomains should be rejected.");
    })
    .catch((error) => {
      assert(error instanceof Error && error.message.includes("Broad web search is blocked"), "Expected broad Firecrawl search rejection.");
    });

  const runId = `firecrawl-smoke-${Date.now()}`;
  const office = await prisma.office.create({ data: { name: runId } });
  const source: MarketIntelligenceSourceDefinition = {
    id: `${runId}-source`,
    name: "Mock Firecrawl Freight Research",
    sourceType: "MARKET",
    trustLevel: "NEWS",
    url: "https://example.com/research",
    homepage: "https://example.com",
    sourceCategory: "research",
    allowedDomains: ["example.com"],
    fetchType: "firecrawl_search",
    defaultCategory: "rate",
    defaultCategories: ["rate"],
    defaultAffectedModes: ["ocean"],
    maxResultsPerRun: 5,
    maxPagesPerRun: 5,
    articleUrlPatterns: ["/research/.+"],
    enabled: true,
    notes: "Fixture-only source.",
  };

  try {
    const company = await prisma.company.create({
      data: {
        officeId: office.id,
        name: `${runId} Customer`,
        status: "IN_PROGRESS",
        lane: "China -> Northern Europe",
      },
    });
    const inquiry = await prisma.inquiry.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        subject: `${runId} Shanghai to Hamburg RFQ`,
        fromEmail: "buyer@example.com",
        fromCompany: company.name,
        origin: "Shanghai",
        destination: "Hamburg",
        mode: "SEA-FCL",
        commodity: "Machinery",
        containerCount: 1,
        containerType: "40HC",
        targetPriceStatus: "PROVIDED",
        targetPrice: 4200,
        targetCurrency: "USD",
        status: "PARSED",
      },
    });
    const job = await prisma.job.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        inquiryId: inquiry.id,
        reference: `${runId}-JOB`,
        title: `${runId} Shanghai Hamburg machinery`,
        status: "INQUIRY",
        mode: "SEA-FCL",
        origin: "Shanghai",
        destination: "Hamburg",
        commodity: "Machinery",
        containerCount: 1,
        containerType: "40HC",
        targetPriceStatus: "PROVIDED",
        targetPrice: 4200,
        targetCurrency: "USD",
      },
    });
    const before = {
      company: await prisma.company.findUnique({ where: { id: company.id }, select: { status: true, lane: true } }),
      inquiry: await prisma.inquiry.findUnique({ where: { id: inquiry.id }, select: { status: true, targetPrice: true } }),
      job: await prisma.job.findUnique({ where: { id: job.id }, select: { status: true, targetPrice: true } }),
    };

    const firecrawlBodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url);
      if (init?.body && typeof init.body === "string") {
        firecrawlBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      if (value.endsWith("/search")) return jsonResponse(searchResponse);
      if (value.endsWith("/scrape")) return jsonResponse(scrapeResponse);
      throw new Error(`Unexpected Firecrawl fixture URL: ${value}`);
    }) as typeof fetch;

    const first = await ingestFirecrawlMarketSource({
      officeId: office.id,
      source,
      query: "Asia Europe ocean rates",
      strict: true,
      clientOptions: {
        apiKey: "test-firecrawl-key",
        baseUrl: "https://firecrawl.test/v2",
        fetchImpl,
      },
    });
    const objectCountAfterFirst = await prisma.knowledgeObject.count({ where: { officeId: office.id, sourceType: "MARKET" } });
    const second = await ingestFirecrawlMarketSource({
      officeId: office.id,
      source,
      query: "Asia Europe ocean rates",
      strict: true,
      clientOptions: {
        apiKey: "test-firecrawl-key",
        baseUrl: "https://firecrawl.test/v2",
        fetchImpl,
      },
    });
    const objectCountAfterSecond = await prisma.knowledgeObject.count({ where: { officeId: office.id, sourceType: "MARKET" } });
    assert(objectCountAfterFirst === objectCountAfterSecond, "Repeated Firecrawl ingest duplicated KnowledgeObjects.");

    const [signal, review, runs, after] = await Promise.all([
      prisma.marketSignal.findFirst({ where: { officeId: office.id }, include: { links: true } }),
      prisma.marketImpactReview.findFirst({ where: { officeId: office.id, status: "pending" } }),
      prisma.marketIngestionRun.findMany({ where: { officeId: office.id }, orderBy: { createdAt: "asc" } }),
      Promise.all([
        prisma.company.findUnique({ where: { id: company.id }, select: { status: true, lane: true } }),
        prisma.inquiry.findUnique({ where: { id: inquiry.id }, select: { status: true, targetPrice: true } }),
        prisma.job.findUnique({ where: { id: job.id }, select: { status: true, targetPrice: true } }),
      ]),
    ]);

    assert(first.ok && second.ok, "Expected both Firecrawl ingestion runs to succeed.");
    assert(signal, "Expected MarketSignal from mocked Firecrawl content.");
    assert(signal.links.some((link) => link.entityType === "job" && link.entityId === job.id), "Expected signal linked to job.");
    assert(review, "Expected pending MarketImpactReview from Firecrawl signal link.");
    assert(runs.length === 2 && runs.every((run) => run.status === "succeeded"), "Expected succeeded ingestion runs.");
    assert(JSON.stringify(before.company) === JSON.stringify(after[0]), "Company mutated during Firecrawl ingest.");
    assert(JSON.stringify(before.inquiry) === JSON.stringify(after[1]), "Inquiry mutated during Firecrawl ingest.");
    assert(JSON.stringify(before.job) === JSON.stringify(after[2]), "Job mutated during Firecrawl ingest.");
    const scrapeBody = firecrawlBodies.find((body) => body.url === fixtureUrl);
    assert(scrapeBody?.onlyMainContent === true, "Firecrawl scrape should request onlyMainContent.");
    assert(scrapeBody?.removeBase64Images === true, "Firecrawl scrape should remove base64 images.");
    assert(scrapeBody?.blockAds === true, "Firecrawl scrape should block ads.");
    assert(Array.isArray(scrapeBody?.excludeTags) && (scrapeBody.excludeTags as string[]).includes("nav"), "Firecrawl scrape should exclude chrome tags.");

    const researchObject = await prisma.knowledgeObject.findFirst({
      where: { officeId: office.id, canonicalType: "market_update" },
      include: { source: true },
    });
    assert(researchObject, "Expected market_update KnowledgeObject.");

    console.log(JSON.stringify({
      ok: true,
      normalizedSearch: normalizedSearch.items[0],
      normalizedScrape: normalizedScrape.item,
      ingestion: {
        first: { runId: first.runId, objectCount: first.objectCount, signalCount: first.signalCount, reviewCount: first.reviewCount },
        second: { runId: second.runId, objectCount: second.objectCount, signalCount: second.signalCount, reviewCount: second.reviewCount },
        objectCountAfterFirst,
        objectCountAfterSecond,
      },
      researchFeedItem: {
        id: researchObject.id,
        title: researchObject.title,
        url: researchObject.rawRef,
        canonicalType: researchObject.canonicalType,
        source: researchObject.source?.label,
      },
      marketSignal: {
        id: signal.id,
        category: signal.category,
        severity: signal.severity,
        confidence: signal.confidence,
        links: signal.links.length,
      },
      marketImpactReview: {
        id: review.id,
        status: review.status,
        impactLevel: review.impactLevel,
        linkedEntityType: review.linkedEntityType,
        linkedEntityId: review.linkedEntityId,
        recommendedAction: review.recommendedAction,
      },
      businessRecordsUnchanged: true,
    }, null, 2));
  } finally {
    await prisma.office.delete({ where: { id: office.id } }).catch(() => null);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
