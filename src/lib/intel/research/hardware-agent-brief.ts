import {
  buildChinaWestCoastCorridorWatch,
  buildOceanHardwareRoutingResearchBrief,
} from "./corridor-watch";
import type { CensusPublicHardwareSnapshot } from "./census-public-hardware";
import { dedupeIntelSourceUses } from "../sources";

function percentageFromBasisPoints(value: number | null): number | null {
  return value == null ? null : Number((value / 100).toFixed(2));
}

export function buildHardwareImportAgentBrief(
  snapshot: CensusPublicHardwareSnapshot
) {
  const watch = buildChinaWestCoastCorridorWatch(snapshot);
  const routing = buildOceanHardwareRoutingResearchBrief(watch);
  const westCoast = watch.currentYtd.westCoastGateways;
  const california = watch.currentYtd.californiaDestination;
  const sources = dedupeIntelSourceUses(watch.sources);

  return {
    kind: "hardware_import_report",
    title: "China to U.S. West Coast hardware imports",
    fullReportPath: "/dashboard/intel",
    shipmentReviewPath: "/dashboard/intel/load",
    asOfMonth: watch.asOfMonth,
    evidenceStatus: "official_aggregate_customs_data",
    routeReadiness: watch.routeReadiness,
    directFindings: routing.findings,
    currentYtd: {
      westCoastVesselValueUsd:
        westCoast.status === "observed"
          ? westCoast.metrics?.vesselValueUsd ?? null
          : null,
      westCoastOriginSharePct: percentageFromBasisPoints(
        westCoast.originShareBps
      ),
      californiaDestinationVesselValueUsd:
        california.status === "observed"
          ? california.metrics?.vesselValueUsd ?? null
          : null,
      californiaOriginSharePct: percentageFromBasisPoints(
        california.originShareBps
      ),
      positiveCategoryGatewaySegments:
        watch.currentCategoryGatewaySegmentCount,
    },
    gatewayDistricts: watch.currentGatewaySignals.slice(0, 5).map((signal) => ({
      district: signal.gatewayDistrictLabel,
      vesselValueUsd: signal.metrics.vesselValueUsd,
      originSharePct: percentageFromBasisPoints(signal.originShareBps),
      containerizedSharePct: percentageFromBasisPoints(
        signal.metrics.containerizedShareBps
      ),
    })),
    categoryResearch: routing.categoryResearch.map((category) => ({
      category: category.categoryLabel,
      observedStartingPoint:
        category.observedPrimaryGateway.gatewayDistrictLabel,
      vesselValueUsd:
        category.observedPrimaryGateway.vesselValueUsd,
      categorySharePct: percentageFromBasisPoints(
        category.observedPrimaryGateway.categoryShareBps
      ),
      comparisonDistricts: category.comparisonGateways.map(
        (gateway) => gateway.gatewayDistrictLabel
      ),
    })),
    fixedBasketHistory:
      watch.fixedBasketOriginHistory?.completeYears.map((period) => ({
        year: period.year,
        westCoastVesselValueUsd:
          period.westCoastGateways.metrics?.vesselValueUsd ?? null,
        westCoastOriginSharePct: percentageFromBasisPoints(
          period.westCoastGateways.originShareBps
        ),
        californiaDestinationVesselValueUsd:
          period.californiaDestination.metrics?.vesselValueUsd ?? null,
        californiaOriginSharePct: percentageFromBasisPoints(
          period.californiaDestination.originShareBps
        ),
      })) ?? [],
    providerStatus: [
      {
        provider: "ImportGenius",
        connection: "not_connected",
        use: "licensed bill-of-lading and company-level shipment evidence",
      },
      {
        provider: "TradeAtlas",
        connection: "not_connected",
        use: "company and shipment research sample evaluation",
      },
      {
        provider: "Trademo",
        connection: "not_connected",
        use: "global trade shipment API sample evaluation",
      },
    ],
    limitations: watch.limitations,
    requiredEvidence: watch.requiredEvidence,
    sourceCount: sources.length,
    sourceRefs: sources.slice(0, 12).map((source) => ({
      name: source.displayName,
      url: source.sourceUrl,
      asOf: source.asOf,
      fetchedAt: source.fetchedAt,
      reviewedAt: source.reviewedAt,
    })),
    answerInstruction:
      "Answer the question directly from these facts, name the data period, preserve the California destination versus West Coast gateway distinction, and tell the operator the full cited report is attached below the answer. Do not claim a route recommendation, exact duty, qualified lead, provider connection, or shipment-level evidence.",
  };
}
