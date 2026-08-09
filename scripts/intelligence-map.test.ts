import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { getIntelligenceMapData } from "../src/lib/market-intelligence/intelligence-map";
import { ingestMarketSource } from "../src/lib/market-intelligence/ingest-market-source";
import { getMarketIntelligenceSource } from "../src/lib/market-intelligence/source-registry";
import { toMemoryJson } from "../src/lib/memory/record-event";
import { WORLD_MAP_ASSET_SOURCE, WORLD_MAP_LAND_PATHS } from "../src/lib/market-intelligence/world-map-asset";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const mapComponentSource = readFileSync("src/components/intelligence/world-intelligence-map.tsx", "utf8");
  assert(WORLD_MAP_ASSET_SOURCE.name === "Natural Earth 1:110m land", "Expected Natural Earth world map asset.");
  assert(WORLD_MAP_LAND_PATHS.length > 100, "Expected a real world map asset with many land paths, not handmade continent blobs.");
  assert(mapComponentSource.includes("REFERENCE_CHOKEPOINTS"), "Expected visible chokepoint reference markers on the intelligence map.");
  assert(mapComponentSource.includes("REFERENCE_PORTS"), "Expected visible port reference markers on the intelligence map.");
  for (const label of ["Suez Canal", "Panama Canal", "Strait of Hormuz", "Bab el-Mandeb", "Strait of Malacca", "Bosporus", "Gibraltar"]) {
    assert(mapComponentSource.includes(label), `Expected visible ${label} chokepoint marker.`);
  }
  for (const label of ["Shanghai", "Singapore", "Hamburg", "Rotterdam", "Los Angeles", "Long Beach", "Istanbul"]) {
    assert(mapComponentSource.includes(label), `Expected visible ${label} port marker.`);
  }
  for (const label of ["Maersk", "Drewry", "CBP", "Port of LA"]) {
    assert(mapComponentSource.includes(label), `Expected empty-state source button for ${label}.`);
  }
  assert(mapComponentSource.includes("No market data loaded"), "Expected explicit empty-state copy for manual ingestion.");

  const runId = `intelligence-map-${Date.now()}`;
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

    await ingestMarketSource({
      officeId: office.id,
      source: getMarketIntelligenceSource("manual-market-intel"),
      strict: true,
      items: [{
        externalId: `${runId}:map-fixture`,
        url: `fixture:///${runId}/asia-europe-capacity`,
        title: "Asia-Europe ocean capacity pressure affects Shanghai to Hamburg freight",
        content: [
          "Published June 22, 2026.",
          "Asia-Europe ocean freight rates and capacity are under pressure this week on China to Northern Europe sailings.",
          "Carrier advisories cite blank sailings, shorter validity windows, and limited allocation from Shanghai and Ningbo into Hamburg and Rotterdam.",
          "Operators should refresh buy rates before sending customer pricing on CN -> EU RFQs.",
          "Pricing teams should review margin guardrails for active Shanghai to Hamburg quotes and avoid stale carrier quotes.",
        ].join("\n\n"),
        publishedAt: new Date(),
      }],
    });

    await prisma.marketSignal.create({
      data: {
        officeId: office.id,
        category: "carrier_advisory",
        severity: "low",
        confidence: 0.7,
        affectedModes: toMemoryJson(["ocean"]),
        affectedOrigins: toMemoryJson([]),
        affectedDestinations: toMemoryJson([]),
        affectedPorts: toMemoryJson([]),
        affectedLanes: toMemoryJson([]),
        affectedCarriers: toMemoryJson(["Fixture Carrier"]),
        summary: "Fixture carrier published a global advisory without lane-specific location evidence.",
        operatorImplication: "Treat as global carrier context until a lane is identified.",
        pricingImplication: null,
        customerImpact: null,
        recommendedActions: toMemoryJson(["Review only if active work overlaps after human triage."]),
        sourceRefs: toMemoryJson([]),
        dedupeKey: `${runId}:global-fallback`,
        provenance: toMemoryJson({ source: "intelligence-map.test" }),
      },
    });
    const badSignal = await prisma.marketSignal.create({
      data: {
        officeId: office.id,
        category: "customs",
        severity: "critical",
        confidence: 0.8,
        affectedModes: toMemoryJson(["ocean", "air", "road", "rail"]),
        affectedOrigins: toMemoryJson([]),
        affectedDestinations: toMemoryJson(["US"]),
        affectedPorts: toMemoryJson([]),
        affectedLanes: toMemoryJson(["Countdown -> America", "Welcome -> U.S. Customs and Border"]),
        affectedCarriers: toMemoryJson([]),
        summary: "Fixture CBP boilerplate should not become freight lanes.",
        operatorImplication: "Review customs context only.",
        pricingImplication: null,
        customerImpact: null,
        recommendedActions: toMemoryJson(["Review customs/document requirements."]),
        sourceRefs: toMemoryJson([]),
        dedupeKey: `${runId}:bad-cbp-boilerplate`,
        provenance: toMemoryJson({ source: "intelligence-map.test" }),
      },
    });
    await prisma.marketSignalLink.create({
      data: {
        officeId: office.id,
        signalId: badSignal.id,
        entityType: "lane",
        entityId: "Countdown -> America",
        matchType: "signal_lane",
        confidence: 0.8,
        reason: "Fixture bad CBP pseudo-lane.",
      },
    });
    await prisma.marketSignal.create({
      data: {
        officeId: office.id,
        category: "customs",
        severity: "high",
        confidence: 0.82,
        affectedModes: toMemoryJson(["ocean"]),
        affectedOrigins: toMemoryJson(["Los Angeles"]),
        affectedDestinations: toMemoryJson(["Long Beach"]),
        affectedPorts: toMemoryJson([]),
        affectedLanes: toMemoryJson(["Los Angeles -> Long Beach"]),
        affectedCarriers: toMemoryJson([]),
        summary: "Fixture customs advisory should render as U.S. compliance context, not a lane arc.",
        operatorImplication: "Review customs/document requirements.",
        pricingImplication: null,
        customerImpact: null,
        recommendedActions: toMemoryJson(["Check customs documentation before advising customers."]),
        sourceRefs: toMemoryJson([]),
        dedupeKey: `${runId}:valid-customs-lane-context`,
        provenance: toMemoryJson({ source: "intelligence-map.test", sourceId: "cbp-csms" }),
      },
    });

    const data = await getIntelligenceMapData(office.id);
    assert(data.hotspots.length > 0, "Expected map hotspots.");
    assert(data.researchItems.length > 0, "Expected research items.");
    assert(data.impactReviews.length > 0, "Expected impact review items.");
    assert(data.metrics.pendingImpactReviews > 0, "Expected pending impact reviews metric.");
    assert(data.metrics.affectedJobs > 0, "Expected affected job metric.");
    assert(data.metrics.affectedRfqs > 0, "Expected affected RFQ metric.");
    assert(data.hotspots.some((hotspot) => ["Shanghai", "China", "Europe", "Hamburg", "Northern Europe"].includes(hotspot.label)), "Expected deterministic freight geocoding hotspot.");
    assert(data.hotspots.some((hotspot) => hotspot.label === "Global Market"), "Expected unknown geography to map to Global Market fallback.");
    assert(data.hotspots.some((hotspot) => hotspot.label === "US" && hotspot.type === "country" && hotspot.category === "customs"), "Expected customs/CBP signals to render as a U.S. compliance hotspot.");
    assert(data.hotspots.some((hotspot) => hotspot.evidenceRefs.some((ref) => ref.startsWith("MarketSignal:"))), "Expected MarketSignal evidence refs.");
    assert(data.hotspots.some((hotspot) => hotspot.affectedEntities.some((entity) => entity.id === job.id || entity.id === inquiry.id || entity.id === company.id)), "Expected linked CRM entities in hotspot data.");
    assert(!data.lanes.some((lane) => /Countdown|Welcome|America|Customs/.test(lane.label)), "Bad CBP pseudo-lanes should not render as map lanes.");
    assert(!data.lanes.some((lane) => lane.label === "Los Angeles -> Long Beach"), "Customs/CBP signals should not render as lane arcs.");
    assert(data.hotspots.some((hotspot) => hotspot.suppressedEntities.some((entity) => entity.id === "Countdown -> America")), "Expected invalid CBP lane link to be visible only as suppressed/rejected audit data.");

    console.log(JSON.stringify({
      ok: true,
      metrics: data.metrics,
      hotspots: data.hotspots.slice(0, 5).map((hotspot) => ({
        id: hotspot.id,
        label: hotspot.label,
        type: hotspot.type,
        severity: hotspot.severity,
        signalCount: hotspot.signalCount,
        pendingReviewCount: hotspot.pendingReviewCount,
        evidenceRefs: hotspot.evidenceRefs.slice(0, 3),
      })),
      lanes: data.lanes.slice(0, 5),
      research: data.researchItems.slice(0, 2),
      impactReviews: data.impactReviews.slice(0, 2),
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
