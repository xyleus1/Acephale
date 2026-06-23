import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  runManualMarketIngestion,
  validateManualMarketIngestionRequest,
} from "../src/lib/market-intelligence/manual-ingestion";

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

async function main() {
  const nonAdmin = validateManualMarketIngestionRequest({
    role: "SALES",
    sourceId: "maersk-news-advisories",
    mode: "live",
    env: {
      MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED: "true",
      MARKET_INTELLIGENCE_CRON_ENABLED: "false",
      FIRECRAWL_API_KEY: "test-firecrawl-key",
    } as NodeJS.ProcessEnv,
  });
  assert(!nonAdmin.ok && nonAdmin.error?.includes("ADMIN"), "Non-admin manual ingestion should be rejected.");

  const blockedSource = validateManualMarketIngestionRequest({
    role: "ADMIN",
    sourceId: "freightwaves-maritime",
    mode: "live",
    env: {
      MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED: "true",
      MARKET_INTELLIGENCE_CRON_ENABLED: "false",
      FIRECRAWL_API_KEY: "test-firecrawl-key",
    } as NodeJS.ProcessEnv,
  });
  assert(!blockedSource.ok && blockedSource.error?.includes("allowlist"), "FreightWaves/manual media source should be rejected by allowlist.");

  const cronEnabled = validateManualMarketIngestionRequest({
    role: "ADMIN",
    sourceId: "maersk-news-advisories",
    mode: "live",
    env: {
      MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED: "true",
      MARKET_INTELLIGENCE_CRON_ENABLED: "true",
      FIRECRAWL_API_KEY: "test-firecrawl-key",
    } as NodeJS.ProcessEnv,
  });
  assert(!cronEnabled.ok && cronEnabled.error?.includes("cron"), "Manual ingestion should refuse to run while cron is enabled.");

  const liveFlagMissing = validateManualMarketIngestionRequest({
    role: "ADMIN",
    sourceId: "maersk-news-advisories",
    mode: "live",
    env: {
      MARKET_INTELLIGENCE_CRON_ENABLED: "false",
      FIRECRAWL_API_KEY: "test-firecrawl-key",
    } as NodeJS.ProcessEnv,
  });
  assert(!liveFlagMissing.ok && liveFlagMissing.error?.includes("LIVE_INGESTION"), "Live manual ingestion should require explicit live flag.");

  const runId = `manual-market-${Date.now()}`;
  const originalEnv = {
    firecrawl: process.env.FIRECRAWL_API_KEY,
    live: process.env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED,
    cron: process.env.MARKET_INTELLIGENCE_CRON_ENABLED,
    provider: process.env.MARKET_INTELLIGENCE_PROVIDER,
    maxResults: process.env.MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN,
    maxPages: process.env.MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN,
  };
  process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";
  process.env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED = "true";
  process.env.MARKET_INTELLIGENCE_CRON_ENABLED = "false";
  process.env.MARKET_INTELLIGENCE_PROVIDER = "firecrawl";
  process.env.MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN = "3";
  process.env.MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN = "3";

  const office = await prisma.office.create({ data: { name: runId } });
  const fixtureUrl = "https://www.maersk.com/news/articles/2026/06/22/asia-europe-capacity-pressure";
  const searchResponse = {
    success: true,
    data: {
      web: [{
        title: "Maersk advisory: Asia-Europe capacity pressure",
        description: "Carrier advisory covering China to Northern Europe allocation and rate pressure.",
        url: fixtureUrl,
        metadata: {
          title: "Maersk advisory: Asia-Europe capacity pressure",
          sourceURL: fixtureUrl,
          articlePublishedTime: "2026-06-22T08:00:00.000Z",
        },
      }],
    },
  };
  const scrapeResponse = {
    success: true,
    data: {
      url: fixtureUrl,
      title: "Maersk advisory: Asia-Europe capacity pressure",
      markdown: [
        "# Maersk advisory: Asia-Europe capacity pressure",
        "Published June 22, 2026.",
        "",
        "Maersk reports ocean capacity pressure on China to Northern Europe services this week.",
        "Shanghai and Ningbo export bookings into Hamburg and Rotterdam face shorter validity windows, limited allocation, and higher freight rate pressure.",
        "Blank sailings and vessel space constraints may affect customer RFQs on CN -> EU lanes.",
        "Operators should refresh carrier quotes before sending customer pricing and should review margin guardrails where quotes are stale.",
        "This advisory is external context only and does not change operational records.",
      ].join("\n\n"),
      metadata: {
        title: "Maersk advisory: Asia-Europe capacity pressure",
        description: "Mock Maersk scrape for manual ingestion.",
        sourceURL: fixtureUrl,
        articlePublishedTime: "2026-06-22T08:00:00.000Z",
      },
    },
  };
  const firecrawlBodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === "string") firecrawlBodies.push(JSON.parse(init.body) as Record<string, unknown>);
    const value = String(url);
    if (value.endsWith("/search")) return jsonResponse(searchResponse);
    if (value.endsWith("/scrape")) return jsonResponse(scrapeResponse);
    throw new Error(`Unexpected Firecrawl fixture URL: ${value}`);
  }) as typeof fetch;

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

    const summary = await runManualMarketIngestion({
      officeId: office.id,
      role: "ADMIN",
      sourceId: "maersk-news-advisories",
      mode: "live",
      clientOptions: {
        apiKey: "test-firecrawl-key",
        baseUrl: "https://firecrawl.test/v2",
        fetchImpl,
      },
    });

    const after = {
      company: await prisma.company.findUnique({ where: { id: company.id }, select: { status: true, lane: true } }),
      inquiry: await prisma.inquiry.findUnique({ where: { id: inquiry.id }, select: { status: true, targetPrice: true } }),
      job: await prisma.job.findUnique({ where: { id: job.id }, select: { status: true, targetPrice: true } }),
    };
    const signal = await prisma.marketSignal.findFirst({ where: { officeId: office.id }, include: { links: true } });

    assert(summary.ok, `Expected mocked manual ingestion to succeed: ${JSON.stringify(summary)}`);
    assert(summary.sourceId === "maersk-news-advisories", "Manual ingestion should run only the selected source.");
    assert(summary.researchItemsCreated >= 1, "Expected Research Feed item from manual ingestion.");
    assert(summary.marketSignalsCreated >= 1, "Expected MarketSignal from manual ingestion.");
    assert(summary.marketImpactReviewsCreated >= 1, "Expected MarketImpactReview from linked manual ingestion.");
    assert(signal?.links.some((link) => link.entityType === "job" && link.entityId === job.id), "Expected signal linked to job.");
    assert(JSON.stringify(before) === JSON.stringify(after), "Manual ingestion mutated operational CRM records.");
    const searchBody = firecrawlBodies.find((body) => Array.isArray(body.includeDomains));
    const scrapeBody = firecrawlBodies.find((body) => body.url === fixtureUrl);
    assert(Array.isArray(searchBody?.includeDomains) && (searchBody.includeDomains as string[]).includes("maersk.com"), "Manual ingestion should constrain Firecrawl search to Maersk domains.");
    assert(searchBody?.limit === 3, "Manual ingestion search should clamp results to 3.");
    assert(scrapeBody?.onlyMainContent === true, "Manual ingestion scrape should request main content only.");

    console.log(JSON.stringify({
      ok: true,
      rejectedCases: {
        nonAdmin: nonAdmin.error,
        blockedSource: blockedSource.error,
        cronEnabled: cronEnabled.error,
        liveFlagMissing: liveFlagMissing.error,
      },
      summary: {
        sourceId: summary.sourceId,
        mode: summary.mode,
        runIds: summary.runIds,
        researchItemsCreated: summary.researchItemsCreated,
        marketSignalsCreated: summary.marketSignalsCreated,
        marketSignalLinksCreated: summary.marketSignalLinksCreated,
        marketImpactReviewsCreated: summary.marketImpactReviewsCreated,
        extractionSkips: summary.extractionSkips,
      },
      businessRecordsUnchanged: true,
    }, null, 2));
  } finally {
    if (originalEnv.firecrawl === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalEnv.firecrawl;
    if (originalEnv.live === undefined) delete process.env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED;
    else process.env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED = originalEnv.live;
    if (originalEnv.cron === undefined) delete process.env.MARKET_INTELLIGENCE_CRON_ENABLED;
    else process.env.MARKET_INTELLIGENCE_CRON_ENABLED = originalEnv.cron;
    if (originalEnv.provider === undefined) delete process.env.MARKET_INTELLIGENCE_PROVIDER;
    else process.env.MARKET_INTELLIGENCE_PROVIDER = originalEnv.provider;
    if (originalEnv.maxResults === undefined) delete process.env.MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN;
    else process.env.MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN = originalEnv.maxResults;
    if (originalEnv.maxPages === undefined) delete process.env.MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN;
    else process.env.MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN = originalEnv.maxPages;
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
