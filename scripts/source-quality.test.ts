import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { ingestMarketSource } from "../src/lib/market-intelligence/ingest-market-source";
import type { MarketIntelligenceSourceDefinition } from "../src/lib/market-intelligence/source-registry";
import { getMarketIntelligenceSource, getMarketIntelligenceSourceRegistry } from "../src/lib/market-intelligence/source-registry";
import { listSourcePolicyIssues } from "../src/lib/market-intelligence/source-policy";
import {
  buildSourceQualityLookup,
  listSourceQualitySummaries,
  rankMarketImpactReviews,
  rankMarketSignals,
  rankResearchFeedItems,
} from "../src/lib/market-intelligence/source-quality";
import {
  acknowledgeMarketImpactReview,
  recordMarketSignalFeedback,
} from "../src/lib/market-intelligence/market-impact-review";
import { generateMorningBrief } from "../src/lib/memory/morning-brief";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const policyIssues = listSourcePolicyIssues(getMarketIntelligenceSourceRegistry());
  assert(policyIssues.length === 0, `Curated source registry has policy issues: ${JSON.stringify(policyIssues)}`);

  const runId = `source-quality-${Date.now()}`;
  const office = await prisma.office.create({ data: { name: runId } });
  const trustedSource: MarketIntelligenceSourceDefinition = getMarketIntelligenceSource("port-of-los-angeles-latest-news");
  const noisySource: MarketIntelligenceSourceDefinition = getMarketIntelligenceSource("freightwaves-maritime");

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

    await ingestMarketSource({
      officeId: office.id,
      source: trustedSource,
      items: [{
        externalId: `${runId}:trusted`,
        url: `fixture:///${runId}/trusted`,
        title: "Official port update: Asia-Europe ocean rates surge on Shanghai to Hamburg lane",
        content: [
          "Published June 22, 2026.",
          "Official port update reports a significant surge in Asia-Europe ocean rates.",
          "Shanghai and Ningbo cargo to Hamburg and Rotterdam is affected by vessel capacity pressure.",
          "Operators should review active CN -> EU RFQs before sending customer pricing.",
          "Carriers have announced blank sailings and surcharge pressure on westbound services from China to Northern Europe.",
          "The update says forwarders should refresh buy rates before confirming customer validity windows.",
        ].join("\n\n"),
        publishedAt: new Date(),
      }],
      strict: true,
    });
    await ingestMarketSource({
      officeId: office.id,
      source: noisySource,
      items: [{
        externalId: `${runId}:noisy`,
        url: `fixture:///${runId}/noisy`,
        title: "Context blog: ocean surcharge chatter on an unrelated lane",
        content: [
          "Published June 22, 2026.",
          "A low-confidence ocean rate rumor mentions bunker surcharge changes but no active Derya lane, customer, port, or carrier.",
          "The article does not identify a confirmed port, carrier, affected lane, or operational advisory.",
          "It is included as weak context for source quality ranking tests, not as operational truth.",
          "The report repeats generic freight rate language, capacity pressure, and surcharge chatter without naming an affected shipment.",
          "Operators should treat this as background market noise unless another source confirms the lane, carrier, and effective date.",
        ].join("\n\n"),
        publishedAt: new Date(),
      }],
      strict: true,
    });

    const trustedSignal = await prisma.marketSignal.findFirst({
      where: { officeId: office.id, sourceObject: { sourceExternalId: { startsWith: `market:${trustedSource.id}:` } } },
      include: { links: true, impactReviews: true, sourceObject: true },
    });
    const noisySignal = await prisma.marketSignal.findFirst({
      where: { officeId: office.id, sourceObject: { sourceExternalId: { startsWith: `market:${noisySource.id}:` } } },
      include: { links: true, impactReviews: true, sourceObject: true },
    });
    assert(trustedSignal, "Expected trusted source signal.");
    assert(noisySignal, "Expected noisy source signal.");
    assert(trustedSignal.links.some((link) => link.entityType === "job" && link.entityId === job.id), "Trusted signal should link to active job.");

    const trustedReview = trustedSignal.impactReviews[0];
    assert(trustedReview, "Expected trusted source MarketImpactReview.");
    await acknowledgeMarketImpactReview({
      officeId: office.id,
      reviewId: trustedReview.id,
    });
    await recordMarketSignalFeedback({
      officeId: office.id,
      marketSignalId: trustedSignal.id,
      feedbackKind: "useful",
      note: "Fixture: useful signal.",
    });
    await recordMarketSignalFeedback({
      officeId: office.id,
      marketSignalId: noisySignal.id,
      feedbackKind: "wrong_link",
      note: "Fixture: wrong source/link quality.",
    });
    await recordMarketSignalFeedback({
      officeId: office.id,
      marketSignalId: noisySignal.id,
      feedbackKind: "irrelevant",
      note: "Fixture: irrelevant signal.",
    });

    const summaries = await listSourceQualitySummaries({ officeId: office.id });
    const trustedSummary = summaries.find((summary) => summary.sourceId === trustedSource.id);
    const noisySummary = summaries.find((summary) => summary.sourceId === noisySource.id);
    assert(trustedSummary && noisySummary, "Expected source quality summaries.");
    assert(trustedSummary.score > noisySummary.score, `Trusted source should outrank noisy source: ${trustedSummary.score} <= ${noisySummary.score}`);
    assert(trustedSummary.usefulFeedbackCount > 0, "Trusted source should record useful feedback.");
    assert(noisySummary.wrongLinkFeedbackCount > 0 && noisySummary.irrelevantFeedbackCount > 0, "Noisy source should record negative feedback.");

    const lookup = buildSourceQualityLookup(summaries);
    const [signals, reviews, feed, brief] = await Promise.all([
      prisma.marketSignal.findMany({
        where: { officeId: office.id },
        include: { links: true, impactReviews: true, sourceObject: true },
      }),
      prisma.marketImpactReview.findMany({
        where: { officeId: office.id },
        include: {
          marketSignal: true,
          marketSignalLink: true,
        },
      }),
      prisma.knowledgeObject.findMany({
        where: { officeId: office.id, sourceType: "MARKET", canonicalType: "market_update" },
        include: { marketSignals: { include: { links: true, impactReviews: true } } },
      }),
      generateMorningBrief({ officeId: office.id, limit: 5 }),
    ]);

    const rankedSignals = rankMarketSignals(signals, lookup);
    const rankedReviews = rankMarketImpactReviews(reviews, lookup);
    const rankedFeed = rankResearchFeedItems(feed, lookup);
    assert(rankedSignals[0]?.sourceObjectId === trustedSignal.sourceObjectId, "Trusted signal should rank first.");
    assert(rankedFeed[0]?.id === trustedSignal.sourceObjectId, "Trusted research item should rank first.");
    assert(brief.market_intelligence[0]?.sourceQuality?.sourceId === trustedSource.id, "Morning Brief should carry trusted source quality.");

    console.log(JSON.stringify({
      ok: true,
      summaries: summaries.map((summary) => ({
        sourceId: summary.sourceId,
        score: summary.score,
        band: summary.scoreBand,
        useful: summary.usefulFeedbackCount,
        actioned: summary.actionedReviewCount,
        wrongLink: summary.wrongLinkFeedbackCount,
        irrelevant: summary.irrelevantFeedbackCount,
      })),
      rankedResearchFeedItem: {
        id: rankedFeed[0]?.id,
        title: rankedFeed[0]?.title,
        sourceObjectId: rankedFeed[0]?.id,
      },
      rankedMarketSignal: {
        id: rankedSignals[0]?.id,
        summary: rankedSignals[0]?.summary,
        sourceObjectId: rankedSignals[0]?.sourceObjectId,
      },
      rankedMarketImpactReview: {
        id: rankedReviews[0]?.id,
        impactLevel: rankedReviews[0]?.impactLevel,
        status: rankedReviews[0]?.status,
        sourceObjectId: rankedReviews[0]?.marketSignal.sourceObjectId,
      },
      morningBriefMarket: brief.market_intelligence.slice(0, 1),
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
