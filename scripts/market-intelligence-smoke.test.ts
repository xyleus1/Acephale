import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { assessCommercialStrategy } from "../src/lib/commercial-strategy";
import { getCustomerMarketExposure, getLaneIntelligence, searchMarketIntelligence } from "../src/lib/market-intelligence/market-tools";
import { ingestMarketSource } from "../src/lib/market-intelligence/ingest-market-source";
import { getMarketSignalsForStrategyContext } from "../src/lib/market-intelligence/link-market-signals";
import { getMarketIntelligenceSource } from "../src/lib/market-intelligence/source-registry";
import { generateMorningBrief } from "../src/lib/memory/morning-brief";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function counts(officeId: string) {
  const [objects, events, signals, links] = await Promise.all([
    prisma.knowledgeObject.count({ where: { officeId, sourceType: "MARKET" } }),
    prisma.memoryEvent.count({ where: { officeId, sourceType: "MARKET" } }),
    prisma.marketSignal.count({ where: { officeId } }),
    prisma.marketSignalLink.count({ where: { officeId } }),
  ]);
  return { objects, events, signals, links };
}

async function main() {
  const runId = `market-intel-${Date.now()}`;
  const office = await prisma.office.create({ data: { name: runId } });

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

    const source = getMarketIntelligenceSource("manual-market-intel");
    const fixture = {
      externalId: `${runId}:fixture`,
      url: `fixture:///${runId}/asia-europe-rates`,
      title: "Asia-Europe ocean spot rates rising on China to Northern Europe lane",
      content: [
        "Published June 22, 2026.",
        "Asia-Europe ocean spot rates are in a significant surge this week as capacity tightens.",
        "Forwarders report pressure from China ports including Shanghai and Ningbo into Northern Europe, especially Hamburg and Rotterdam.",
        "Several carriers announced blank sailings and rate increases.",
        "Operators should review active CN -> EU RFQs before sending customer pricing.",
        "The advisory says carriers are limiting allocation on westbound sailings and asking forwarders to refresh buy rates before accepting new validity windows.",
        "Derya operators should treat this as pricing context only and keep customer commitments tied to fresh carrier quotes.",
      ].join("\n\n"),
      publishedAt: new Date(),
    };

    const first = await ingestMarketSource({
      officeId: office.id,
      source,
      items: [fixture],
      strict: true,
    });
    const afterFirst = await counts(office.id);
    const second = await ingestMarketSource({
      officeId: office.id,
      source,
      items: [fixture],
      strict: true,
    });
    const afterSecond = await counts(office.id);
    assert(JSON.stringify(afterFirst) === JSON.stringify(afterSecond), `Market ingestion is not idempotent: ${JSON.stringify({ afterFirst, afterSecond })}`);

    const signal = await prisma.marketSignal.findFirst({
      where: { officeId: office.id },
      include: { links: { orderBy: { entityType: "asc" } } },
    });
    assert(signal, "Expected a MarketSignal.");
    assert(signal.category === "rate", `Expected rate signal, got ${signal.category}`);
    assert(signal.links.some((link) => link.entityType === "job" && link.entityId === job.id), "Expected signal linked to job.");
    assert(signal.links.some((link) => link.entityType === "inquiry" && link.entityId === inquiry.id), "Expected signal linked to inquiry.");
    assert(signal.links.some((link) => link.entityType === "company" && link.entityId === company.id), "Expected signal linked to company.");

    const [search, lane, exposure, brief, strategyMarketSignals] = await Promise.all([
      searchMarketIntelligence({ officeId: office.id, query: "Asia Europe rates", limit: 5 }),
      getLaneIntelligence({ officeId: office.id, origin: "Shanghai", destination: "Hamburg", mode: "SEA-FCL", limit: 5 }),
      getCustomerMarketExposure({ officeId: office.id, companyId: company.id, limit: 5 }),
      generateMorningBrief({ officeId: office.id, limit: 5 }),
      getMarketSignalsForStrategyContext({
        officeId: office.id,
        jobId: job.id,
        companyId: company.id,
        origin: job.origin,
        destination: job.destination,
        mode: job.mode,
      }),
    ]);
    const strategy = assessCommercialStrategy({
      entityType: "JOB",
      id: job.id,
      subject: job.title,
      status: job.status,
      companyId: company.id,
      companyName: company.name,
      origin: job.origin,
      destination: job.destination,
      mode: job.mode,
      commodity: job.commodity,
      containerCount: job.containerCount,
      containerType: job.containerType,
      targetPrice: job.targetPrice,
      targetCurrency: job.targetCurrency,
      targetPriceStatus: job.targetPriceStatus,
      asOf: new Date(),
      marketSignals: strategyMarketSignals,
      marginPolicy: { targetMarginPct: 18, minMarginPct: 12, stretchMarginPct: 25 },
    });

    assert(search.signals.length > 0, "search_market_intelligence returned no signals.");
    assert(lane.signals.length > 0, "get_lane_intelligence returned no signals.");
    assert(exposure.found && exposure.signals.length > 0, "get_customer_market_exposure returned no exposure.");
    assert(brief.market_intelligence.length > 0, "Morning brief missing market intelligence section.");
    assert((strategy.evidence.marketSignals?.length ?? 0) > 0, "Strategy context missing linked market signals.");

    console.log(JSON.stringify({
      ok: true,
      officeId: office.id,
      ingestion: {
        first: { items: first.items, signals: first.signals, links: first.links },
        second: { items: second.items, signals: second.signals, links: second.links },
        counts: afterSecond,
      },
      marketUpdate: {
        title: fixture.title,
        url: fixture.url,
      },
      marketSignal: {
        id: signal.id,
        category: signal.category,
        severity: signal.severity,
        confidence: signal.confidence,
        summary: signal.summary,
      },
      affected: signal.links.map((link) => ({
        entityType: link.entityType,
        entityId: link.entityId,
        matchType: link.matchType,
        confidence: link.confidence,
      })),
      laneIntelligence: lane.signals.slice(0, 2).map((item) => ({
        summary: item.summary,
        laneMatch: item.laneMatch,
      })),
      customerExposure: exposure.signals.slice(0, 2).map((item) => ({
        summary: item.summary,
        severity: item.severity,
        links: item.links.length,
      })),
      morningBriefMarket: brief.market_intelligence.slice(0, 2),
      strategyMarketContext: strategy.evidence.marketSignals?.slice(0, 2),
      evidenceForAgent: search.evidence_for_agent.split("\n").slice(0, 3),
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
