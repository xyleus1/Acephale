import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import {
  classifyMarketContentPageType,
  extractCleanEvidenceText,
  isCleanLaneCandidate,
  isSignalEligibleContent,
  sanitizeMarketMarkdown,
  scoreMarketContentQuality,
} from "../src/lib/market-intelligence/content-hygiene";
import { extractMarketSignals } from "../src/lib/market-intelligence/extract-market-signals";
import { ingestMarketSource } from "../src/lib/market-intelligence/ingest-market-source";
import { getMarketIntelligenceSource } from "../src/lib/market-intelligence/source-registry";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const badFixture = JSON.parse(readFileSync("scripts/fixtures/market-intelligence/port-long-beach-news-index.bad.json", "utf8")) as {
  sourceId: string;
  url: string;
  title: string;
  markdown: string;
  expectedPageType: string;
};

async function main() {
  const source = getMarketIntelligenceSource(badFixture.sourceId);
  const badInput = {
    title: badFixture.title,
    content: badFixture.markdown,
    url: badFixture.url,
    source,
    publishedAt: null,
  };
  const pageType = classifyMarketContentPageType(badInput);
  const quality = scoreMarketContentQuality(badInput);
  const eligible = isSignalEligibleContent(badInput);
  const cleanText = extractCleanEvidenceText(badInput);
  const sanitized = sanitizeMarketMarkdown(badFixture.markdown);
  const badSignals = extractMarketSignals({
    title: badFixture.title,
    content: cleanText,
    defaultCategory: source.defaultCategory,
    defaultAffectedModes: source.defaultAffectedModes,
    sourceRefs: ["fixture:port-long-beach-index"],
  });

  assert(pageType === "index_page" || pageType === "navigation_page", `Expected index/navigation page, got ${pageType}.`);
  assert(quality.contentQualityScore < 60, `Expected low quality score, got ${quality.contentQualityScore}.`);
  assert(!eligible.eligible, "Port of Long Beach index fixture should not be signal eligible.");
  assert(badSignals.length === 0, "Port of Long Beach index fixture should not produce MarketSignals.");
  assert(!isCleanLaneCandidate("FlickrLinks -> Port of Long Beach Flickr"), "Social link lane should be blocked.");
  assert(!isCleanLaneCandidate("InstagramLinks -> Port of Long Beach"), "Instagram link lane should be blocked.");
  assert(!/facebooklinks|instagramlinks|twitterlinks|flickrlinks/i.test(sanitized), "Sanitized text still contains social-link boilerplate.");

  const runId = `market-hygiene-${Date.now()}`;
  const office = await prisma.office.create({ data: { name: runId } });
  try {
    const before = await Promise.all([
      prisma.marketSignal.count({ where: { officeId: office.id } }),
      prisma.marketSignalLink.count({ where: { officeId: office.id } }),
      prisma.marketImpactReview.count({ where: { officeId: office.id } }),
    ]);
    const result = await ingestMarketSource({
      officeId: office.id,
      source,
      items: [{
        externalId: `${runId}:polb-index`,
        url: badFixture.url,
        title: badFixture.title,
        content: badFixture.markdown,
        publishedAt: null,
      }],
      strict: true,
    });
    const after = await Promise.all([
      prisma.marketSignal.count({ where: { officeId: office.id } }),
      prisma.marketSignalLink.count({ where: { officeId: office.id } }),
      prisma.marketImpactReview.count({ where: { officeId: office.id } }),
    ]);
    const researchObject = await prisma.knowledgeObject.findFirst({
      where: { officeId: office.id, sourceType: "MARKET", canonicalType: "market_update" },
      include: { events: true },
    });

    assert(result.signals === 0, "Low-quality index ingest should report zero signals.");
    assert(JSON.stringify(before) === JSON.stringify(after), `Low-quality index created market records: ${JSON.stringify({ before, after })}`);
    assert(researchObject, "Low-quality index should still be stored as a Research Feed item.");
    const payload = researchObject.payload as Record<string, unknown>;
    assert(payload.extractionStatus === "rejected_low_quality", `Expected rejected_low_quality, got ${String(payload.extractionStatus)}.`);
    assert(researchObject.events.some((event) => event.eventType === "market.update.extraction_skipped"), "Expected extraction skipped MemoryEvent.");

    const validSource = getMarketIntelligenceSource("manual-market-intel");
    const valid = await ingestMarketSource({
      officeId: office.id,
      source: validSource,
      items: [{
        externalId: `${runId}:valid-article`,
        url: `fixture:///${runId}/asia-europe-rates`,
        title: "Asia-Europe ocean spot rates rising on China to Northern Europe lane",
        content: [
          "Published June 22, 2026.",
          "Asia-Europe ocean spot rates are rising sharply this week as capacity tightens.",
          "Forwarders report rate pressure from China ports including Shanghai and Ningbo into Northern Europe, especially Hamburg and Rotterdam.",
          "Several carriers announced blank sailings and surcharge increases on the China to Europe lane.",
          "Operators should review active CN -> EU RFQs before sending customer pricing.",
        ].join("\n\n"),
        publishedAt: new Date(),
      }],
      strict: true,
    });
    assert(valid.signals > 0, "Valid article fixture should produce a MarketSignal.");

    console.log(JSON.stringify({
      ok: true,
      failedPilotFixture: {
        pageType,
        contentQualityScore: quality.contentQualityScore,
        rejectionReason: quality.rejectionReason,
        eligibleForSignals: eligible.eligible,
        generatedSignals: badSignals.length,
      },
      researchOnlyIngest: {
        objectId: researchObject.id,
        extractionStatus: payload.extractionStatus,
        events: researchObject.events.map((event) => event.eventType),
      },
      validArticle: {
        signals: valid.signals,
        links: valid.links,
      },
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
