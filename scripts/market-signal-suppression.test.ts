import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { ingestMarketSource } from "../src/lib/market-intelligence/ingest-market-source";
import { getMarketSignalsForStrategyContext } from "../src/lib/market-intelligence/link-market-signals";
import { recordMarketSignalFeedback } from "../src/lib/market-intelligence/market-impact-review";
import {
  getMarketSignalSuppressionReason,
  shouldShowMarketSignalInMorningBrief,
} from "../src/lib/market-intelligence/signal-suppression";
import { listSourceQualitySummaries } from "../src/lib/market-intelligence/source-quality";
import { getMarketIntelligenceSource } from "../src/lib/market-intelligence/source-registry";
import { generateMorningBrief } from "../src/lib/memory/morning-brief";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const runId = `market-suppression-${Date.now()}`;
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

    const badSource = getMarketIntelligenceSource("port-of-long-beach-news");
    const goodSource = getMarketIntelligenceSource("port-of-los-angeles-latest-news");

    await ingestMarketSource({
      officeId: office.id,
      source: badSource,
      items: [{
        externalId: `${runId}:bad`,
        url: `https://polb.com/port-info/news-and-press/bad-but-article-like-06-22-2026/`,
        title: "Port advisory: China to Northern Europe ocean rate and terminal delay alert",
        content: [
          "Published June 22, 2026.",
          "The port advisory reports terminal congestion and vessel queue delays affecting China to Northern Europe cargo.",
          "Ocean spot rates and surcharges are rising because carriers announced blank sailings from Shanghai to Hamburg.",
          "Operators should review active China to Northern Europe RFQs before sending customer pricing.",
        ].join("\n\n"),
        publishedAt: new Date(),
      }],
      strict: true,
    });
    const badSignal = await prisma.marketSignal.findFirst({
      where: { officeId: office.id, sourceObject: { sourceExternalId: { startsWith: `market:${badSource.id}:` } } },
      include: { links: true, impactReviews: true, feedback: true, sourceObject: true },
    });
    assert(badSignal, "Expected bad-source signal before suppression feedback.");
    for (const review of badSignal.impactReviews) {
      await prisma.marketImpactReview.update({
        where: { id: review.id },
        data: {
          status: "dismissed",
          feedbackKind: review.linkedEntityType === "lane" ? "wrong_link" : "irrelevant",
          reviewedAt: new Date(),
        },
      });
      await recordMarketSignalFeedback({
        officeId: office.id,
        marketSignalId: badSignal.id,
        marketImpactReviewId: review.id,
        feedbackKind: review.linkedEntityType === "lane" ? "wrong_link" : "irrelevant",
        note: "Fixture: dismissed pilot-quality signal.",
      });
    }

    await ingestMarketSource({
      officeId: office.id,
      source: goodSource,
      items: [{
        externalId: `${runId}:good`,
        url: `https://portoflosangeles.org/news/latest-news/asia-europe-rate-update-2026-06-22`,
        title: "Official advisory: Asia-Europe ocean spot rates surge from Shanghai to Hamburg",
        content: [
          "Published June 22, 2026.",
          "Official advisory reports a significant surge in Asia-Europe ocean spot rates as container capacity tightens.",
          "Shanghai and Ningbo cargo to Hamburg and Rotterdam is affected by blank sailings and higher surcharges.",
          "Operators should refresh buy rates and review active CN -> EU RFQs before sending customer pricing.",
        ].join("\n\n"),
        publishedAt: new Date(),
      }],
      strict: true,
    });
    const goodSignal = await prisma.marketSignal.findFirst({
      where: { officeId: office.id, sourceObject: { sourceExternalId: { startsWith: `market:${goodSource.id}:` } } },
      include: { links: true, impactReviews: true, feedback: true, sourceObject: true },
    });
    assert(goodSignal, "Expected trusted signal.");

    const sourceQuality = await listSourceQualitySummaries({ officeId: office.id });
    const badQuality = sourceQuality.find((summary) => summary.sourceId === badSource.id);
    const goodQuality = sourceQuality.find((summary) => summary.sourceId === goodSource.id);
    const refreshedBadSignal = await prisma.marketSignal.findUnique({
      where: { id: badSignal.id },
      include: { links: true, impactReviews: true, feedback: true, sourceObject: true },
    });
    assert(refreshedBadSignal, "Expected refreshed bad signal.");

    const suppressionReason = getMarketSignalSuppressionReason({
      signal: refreshedBadSignal,
      sourceQuality: badQuality,
      requirePendingReview: true,
    });
    assert(suppressionReason, "Bad signal should have a suppression reason.");
    assert(!shouldShowMarketSignalInMorningBrief({ signal: refreshedBadSignal, sourceQuality: badQuality }), "Bad signal should not show in Morning Brief.");
    assert(shouldShowMarketSignalInMorningBrief({ signal: goodSignal, sourceQuality: goodQuality }), "Good pending signal should show in Morning Brief.");

    const [brief, strategyContext] = await Promise.all([
      generateMorningBrief({ officeId: office.id, limit: 10 }),
      getMarketSignalsForStrategyContext({ officeId: office.id, jobId: job.id, inquiryId: inquiry.id, companyId: company.id, limit: 10 }),
    ]);
    assert(!brief.market_intelligence.some((signal) => signal.id === badSignal.id), "Morning Brief included suppressed bad signal.");
    assert(brief.market_intelligence.some((signal) => signal.id === goodSignal.id), "Morning Brief omitted trusted pending signal.");
    assert(!brief.recommended_actions.some((action) => JSON.stringify(action.sources).includes(badSignal.id)), "Recommended actions referenced suppressed bad signal.");
    assert(strategyContext.some((signal) => signal.signalId === goodSignal.id), "Strategy context omitted trusted signal.");
    assert(!strategyContext.some((signal) => signal.signalId === badSignal.id), "Strategy context included suppressed bad signal.");

    console.log(JSON.stringify({
      ok: true,
      badSignal: {
        id: badSignal.id,
        suppressionReason,
        sourceQuality: badQuality ? { score: badQuality.score, band: badQuality.scoreBand, wrongLink: badQuality.wrongLinkFeedbackCount, irrelevant: badQuality.irrelevantFeedbackCount } : null,
      },
      goodSignal: {
        id: goodSignal.id,
        sourceQuality: goodQuality ? { score: goodQuality.score, band: goodQuality.scoreBand } : null,
      },
      morningBriefMarketIds: brief.market_intelligence.map((signal) => signal.id),
      strategySignalIds: strategyContext.map((signal) => signal.signalId),
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
