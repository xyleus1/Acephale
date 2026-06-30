import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { ingestMarketSource } from "../src/lib/market-intelligence/ingest-market-source";
import { getMarketIntelligenceSource } from "../src/lib/market-intelligence/source-registry";
import {
  acknowledgeMarketImpactReview,
  dismissMarketImpactReview,
  generateMarketImpactReviews,
  listMarketImpactReviews,
  markMarketImpactActioned,
  recordMarketSignalFeedback,
} from "../src/lib/market-intelligence/market-impact-review";
import { generateMorningBrief } from "../src/lib/memory/morning-brief";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function reviewCount(officeId: string) {
  return prisma.marketImpactReview.count({ where: { officeId } });
}

async function main() {
  const runId = `market-impact-${Date.now()}`;
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

    const before = {
      company: await prisma.company.findUnique({ where: { id: company.id }, select: { id: true, status: true, name: true, lane: true } }),
      inquiry: await prisma.inquiry.findUnique({ where: { id: inquiry.id }, select: { id: true, status: true, subject: true, targetPrice: true } }),
      job: await prisma.job.findUnique({ where: { id: job.id }, select: { id: true, status: true, reference: true, targetPrice: true } }),
    };

    const source = getMarketIntelligenceSource("manual-market-intel");
    const fixture = {
      externalId: `${runId}:fixture`,
      url: `fixture:///${runId}/asia-europe-rates`,
      title: "Asia-Europe ocean spot rates rising on China to Northern Europe lane",
      content: [
        "Published June 22, 2026.",
        "",
        "Asia-Europe ocean spot rates are in a significant surge this week as capacity tightens on China to Northern Europe sailings. Forwarders report sharp freight rate increases from Shanghai and Ningbo into Hamburg and Rotterdam, with several carriers quoting shorter validity windows.",
        "",
        "Carrier advisories cite blank sailings, vessel space constraints, and peak-season surcharge pressure. Operators handling CN -> EU RFQs should refresh buy rates before sending customer pricing, especially where the latest carrier quote predates this rate update.",
        "",
        "Pricing teams should review margin guardrails and customer validity language for active ocean quotes on the China to Northern Europe lane. The update does not change operational records by itself; it is advisory context for rate review.",
      ].join("\n"),
      publishedAt: new Date(),
    };

    await ingestMarketSource({
      officeId: office.id,
      source,
      items: [fixture],
      strict: true,
    });

    const signal = await prisma.marketSignal.findFirst({
      where: { officeId: office.id },
      include: { links: true, impactReviews: true },
    });
    assert(signal, "Expected a market signal.");
    assert(signal.links.length >= 3, "Expected signal links to RFQ/job/customer.");
    assert(signal.impactReviews.length === signal.links.length, `Expected one review per link, got ${signal.impactReviews.length} reviews for ${signal.links.length} links.`);

    const firstCount = await reviewCount(office.id);
    await generateMarketImpactReviews({ officeId: office.id, marketSignalId: signal.id, strict: true });
    const secondCount = await reviewCount(office.id);
    assert(firstCount === secondCount, `Review generation is not idempotent: ${firstCount} -> ${secondCount}`);

    const listed = await listMarketImpactReviews({ officeId: office.id, status: "pending", minImpactLevel: "high", limit: 20 });
    assert(listed.reviews.length > 0, "Expected pending high-impact reviews.");
    assert(listed.evidence.length > 0, "Expected evidence refs on listed reviews.");

    const brief = await generateMorningBrief({ officeId: office.id, limit: 10 });
    assert(brief.market_impact_reviews.length > 0, "Morning brief missing pending market impact reviews.");

    const jobReview = listed.reviews.find((review) => review.linkedEntityType === "job") ?? listed.reviews[0];
    const acknowledged = await acknowledgeMarketImpactReview({ officeId: office.id, reviewId: jobReview.id, userId: "market-impact-test" });
    assert(acknowledged?.status === "acknowledged", "Expected acknowledged review status.");

    const inquiryReview = listed.reviews.find((review) => review.linkedEntityType === "inquiry" && review.id !== jobReview.id) ?? listed.reviews.find((review) => review.id !== jobReview.id);
    assert(inquiryReview, "Expected a second review for status transition testing.");
    const actioned = await markMarketImpactActioned({
      officeId: office.id,
      reviewId: inquiryReview.id,
      userId: "market-impact-test",
      feedbackNote: "Carrier quote refreshed outside this test.",
    });
    assert(actioned?.status === "actioned", "Expected actioned review status.");
    assert(actioned?.feedbackKind === "useful", "Expected actioned review to mark useful feedback on review row.");

    const dismissable = listed.reviews.find((review) => ![jobReview.id, inquiryReview.id].includes(review.id));
    assert(dismissable, "Expected a third review for dismissal testing.");
    const dismissed = await dismissMarketImpactReview({
      officeId: office.id,
      reviewId: dismissable.id,
      userId: "market-impact-test",
      feedbackKind: "wrong_link",
      feedbackNote: "Lane-level link was too broad for this operator queue.",
    });
    assert(dismissed?.status === "dismissed", "Expected dismissed review status.");
    assert(dismissed?.feedbackKind === "wrong_link", "Expected dismissal feedback kind to be stored.");

    const feedback = await recordMarketSignalFeedback({
      officeId: office.id,
      marketSignalId: signal.id,
      marketImpactReviewId: dismissed.id,
      userId: "market-impact-test",
      feedbackKind: "wrong_link",
      note: "This should train lane matching quality later.",
    });
    assert(feedback?.feedbackKind === "wrong_link", "Expected feedback row.");

    const after = {
      company: await prisma.company.findUnique({ where: { id: company.id }, select: { id: true, status: true, name: true, lane: true } }),
      inquiry: await prisma.inquiry.findUnique({ where: { id: inquiry.id }, select: { id: true, status: true, subject: true, targetPrice: true } }),
      job: await prisma.job.findUnique({ where: { id: job.id }, select: { id: true, status: true, reference: true, targetPrice: true } }),
    };
    assert(JSON.stringify(before) === JSON.stringify(after), "Market impact review actions mutated business records.");

    const feedbackCount = await prisma.marketSignalFeedback.count({ where: { officeId: office.id } });
    const reviewStatusCounts = await prisma.marketImpactReview.groupBy({
      by: ["status"],
      where: { officeId: office.id },
      _count: { _all: true },
    });

    console.log(JSON.stringify({
      ok: true,
      officeId: office.id,
      signal: {
        id: signal.id,
        category: signal.category,
        severity: signal.severity,
        summary: signal.summary,
      },
      reviewExample: listed.reviews[0],
      feedbackExample: feedback,
      morningBriefMarketImpact: brief.market_impact_reviews.slice(0, 2),
      idempotency: { firstCount, secondCount },
      statusCounts: reviewStatusCounts.map((row) => ({ status: row.status, count: row._count._all })),
      feedbackCount,
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
