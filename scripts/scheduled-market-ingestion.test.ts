import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runScheduledMarketIngestion } from "../src/lib/market-intelligence/scheduled-ingestion";
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

function source(runId: string, suffix: string, enabled: boolean): MarketIntelligenceSourceDefinition {
  return {
    id: `${runId}-${suffix}`,
    name: `${runId} ${suffix}`,
    sourceType: "MARKET",
    trustLevel: "OFFICIAL",
    url: `https://example.com/${suffix}`,
    homepage: "https://example.com",
    sourceCategory: "port",
    allowedDomains: ["example.com"],
    fetchType: "firecrawl_search",
    defaultCategory: "rate",
    defaultCategories: ["rate"],
    defaultAffectedModes: ["ocean"],
    articleUrlPatterns: ["/research/.+"],
    indexUrlPatterns: ["/$"],
    requirePublishedDate: true,
    maxResultsPerRun: 5,
    maxPagesPerRun: 5,
    enabled,
    notes: "Fixture-only Firecrawl source.",
    termsPolicyNotes: "Fixture content; no live web access.",
  };
}

async function main() {
  const runId = `scheduled-market-${Date.now()}`;
  const originalLiveEnabled = process.env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED;
  process.env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED = "false";
  const fixtureUrl = "https://example.com/research/asia-europe-rate-surge";
  const office = await prisma.office.create({ data: { name: runId } });
  const enabledSource = source(runId, "enabled", true);
  const disabledSource = source(runId, "disabled", false);
  const searchResponse = {
    success: true,
    data: {
      web: [{
        title: "Asia-Europe ocean spot rates rising on China to Northern Europe lane",
        description: "Forwarders report a significant surge from Shanghai and Ningbo to Hamburg and Rotterdam.",
        url: fixtureUrl,
        metadata: { title: "Asia-Europe rates", sourceURL: fixtureUrl, articlePublishedTime: "2026-06-22T08:00:00.000Z" },
      }],
    },
  };
  const scrapeResponse = {
    success: true,
    data: {
      markdown: [
        "# Asia-Europe ocean spot rates rising on China to Northern Europe lane",
        "Published June 22, 2026.",
        "",
        "Asia-Europe ocean spot rates are in a significant surge this week as capacity tightens on China to Northern Europe sailings. Forwarders report sharp freight rate increases from Shanghai and Ningbo into Hamburg and Rotterdam, with several carriers quoting shorter validity windows.",
        "",
        "Carrier advisories cite blank sailings, vessel space constraints, and peak-season surcharge pressure. Operators handling CN -> EU RFQs should refresh buy rates before sending customer pricing, especially where the latest carrier quote predates this rate update.",
        "",
        "Pricing teams should review margin guardrails and customer validity language for active ocean quotes on the China to Northern Europe lane. The update is advisory context for rate review and must not mutate operational records.",
      ].join("\n\n"),
      metadata: {
        title: "Asia-Europe ocean spot rates rising on China to Northern Europe lane",
        sourceURL: fixtureUrl,
        articlePublishedTime: "2026-06-22T08:00:00.000Z",
      },
    },
  };
  const fetchImpl = (async (url: RequestInfo | URL) => {
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

    const beforeDryRun = {
      runs: await prisma.marketIngestionRun.count({ where: { officeId: office.id } }),
      objects: await prisma.knowledgeObject.count({ where: { officeId: office.id, sourceType: "MARKET" } }),
      signals: await prisma.marketSignal.count({ where: { officeId: office.id } }),
    };
    const dryRun = await runScheduledMarketIngestion({
      officeId: office.id,
      dryRun: true,
      sources: [enabledSource, disabledSource],
      maxSources: 5,
      maxPagesPerRun: 10,
      dailyCreditBudget: 3,
    });
    const afterDryRun = {
      runs: await prisma.marketIngestionRun.count({ where: { officeId: office.id } }),
      objects: await prisma.knowledgeObject.count({ where: { officeId: office.id, sourceType: "MARKET" } }),
      signals: await prisma.marketSignal.count({ where: { officeId: office.id } }),
    };
    assert(JSON.stringify(beforeDryRun) === JSON.stringify(afterDryRun), "Dry run persisted market ingestion records.");
    assert(dryRun.results.length === 1 && dryRun.sources[0]?.id === enabledSource.id, "Dry run should include enabled source only by default.");
    assert(dryRun.results[0]?.status === "preview", "Dry run result should be preview.");
    assert((dryRun.results[0]?.estimatedPages ?? 99) <= 3, "Dry run should respect daily credit budget.");

    const liveBlocked = await runScheduledMarketIngestion({
      officeId: office.id,
      force: true,
      sources: [enabledSource],
      maxSources: 1,
    });
    assert(
      liveBlocked.skipped === true && "reason" in liveBlocked && liveBlocked.reason.includes("LIVE_INGESTION"),
      "Live scheduled ingestion should require explicit live enablement.",
    );

    const disabledPreview = await runScheduledMarketIngestion({
      officeId: office.id,
      dryRun: true,
      allowDisabled: true,
      sourceIds: [disabledSource.id],
      sources: [enabledSource, disabledSource],
      maxSources: 1,
    });
    assert(disabledPreview.sources[0]?.id === disabledSource.id, "Explicit disabled-source preview should be allowed.");

    const actual = await runScheduledMarketIngestion({
      officeId: office.id,
      force: true,
      sourceIds: [enabledSource.id],
      sources: [enabledSource, disabledSource],
      maxSources: 1,
      maxPagesPerRun: 5,
      clientOptions: {
        apiKey: "test-firecrawl-key",
        baseUrl: "https://firecrawl.test/v2",
        fetchImpl,
      },
    });
    assert(actual.ok, `Scheduled mocked ingestion failed: ${JSON.stringify(actual)}`);
    assert(actual.results[0]?.status === "succeeded", "Expected mocked scheduled ingestion to succeed.");

    const [run, signal, companyAfter, inquiryAfter, jobAfter] = await Promise.all([
      prisma.marketIngestionRun.findFirst({ where: { officeId: office.id, sourceId: enabledSource.id } }),
      prisma.marketSignal.findFirst({ where: { officeId: office.id }, include: { links: true } }),
      prisma.company.findUnique({ where: { id: company.id }, select: { status: true, lane: true } }),
      prisma.inquiry.findUnique({ where: { id: inquiry.id }, select: { status: true, targetPrice: true } }),
      prisma.job.findUnique({ where: { id: job.id }, select: { status: true, targetPrice: true } }),
    ]);
    assert(run?.status === "succeeded", "Expected MarketIngestionRun succeeded row.");
    assert(signal?.links.some((link) => link.entityType === "job" && link.entityId === job.id), "Expected scheduled signal linked to job.");
    assert(companyAfter?.status === "IN_PROGRESS" && companyAfter.lane === "China -> Northern Europe", "Company mutated during scheduled ingestion.");
    assert(inquiryAfter?.status === "PARSED" && inquiryAfter.targetPrice === 4200, "Inquiry mutated during scheduled ingestion.");
    assert(jobAfter?.status === "INQUIRY" && jobAfter.targetPrice === 4200, "Job mutated during scheduled ingestion.");

    console.log(JSON.stringify({
      ok: true,
      dryRun: {
        skipped: dryRun.skipped,
        sources: dryRun.sources,
        results: dryRun.results.map((result) => ({
          sourceId: result.sourceId,
          status: result.status,
          estimatedPages: result.estimatedPages,
        })),
      },
      disabledPreview: disabledPreview.results.map((result) => ({
        sourceId: result.sourceId,
        status: result.status,
        estimatedPages: result.estimatedPages,
      })),
      actual: {
        ok: actual.ok,
        sources: actual.sources,
        results: actual.results.map((result) => ({
          sourceId: result.sourceId,
          status: result.status,
          runId: "result" in result && result.result && typeof result.result === "object" && "runId" in result.result ? result.result.runId : null,
        })),
      },
      businessRecordsUnchanged: true,
    }, null, 2));
  } finally {
    if (originalLiveEnabled === undefined) delete process.env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED;
    else process.env.MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED = originalLiveEnabled;
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
