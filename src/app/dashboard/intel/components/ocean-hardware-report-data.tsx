import {
  buildCensusPublicPrecomputedRollups,
  buildCensusPublicReportStatus,
  composeOceanHardwareResearchReport,
  createOceanHardwareResearchRequest,
  deriveOceanHardwareCoverage,
  manualSourceUse,
  type IntelSourceUse,
} from "@/lib/intel";
import {
  buildChinaWestCoastCorridorWatch,
  buildChinaUsCustomsDecisionGuide,
  buildOceanHardwareRoutingResearchBrief,
  getCensusPublicHardwareSnapshot,
  getImportGeniusPublicPreviewEvidence,
} from "@/lib/intel/server";
import {
  OceanHardwareReport,
  OceanHardwareReportUnavailable,
} from "./ocean-hardware-report";

const REPORT_METADATA = {
  question:
    "Which hardware imports matter for California and West Coast startups, and where can an AI freight system reduce shipment risk and create qualified leads?",
  providerReferencesReviewedAt: "2026-07-23T00:00:00.000Z",
} as const;

function reportProviderSources(): IntelSourceUse[] {
  return [
    {
      ...manualSourceUse(
        "census_trade",
        "https://www.census.gov/data/developers/data-sets/international-trade.html",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "International Trade Imports API",
    },
    {
      ...manualSourceUse(
        "census_trade_downloads",
        "https://www.census.gov/foreign-trade/data/dataproducts.html",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "International Trade data products",
    },
    {
      ...manualSourceUse(
        "census_trade_downloads",
        "https://www.census.gov/foreign-trade/reference/products/layouts/isths6.html",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "State Imports HS6 record layout",
    },
    {
      ...manualSourceUse(
        "census_trade_downloads",
        "https://www.census.gov/foreign-trade/reference/products/layouts/dporths6i.html",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "Port Imports HS6 record layout",
    },
    {
      ...manualSourceUse(
        "usitc_hts",
        "https://www.usitc.gov/press_room/archive/featured_news/update_2022_hts_basic_edition",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "HS 2022 revision notice",
    },
    {
      ...manualSourceUse(
        "cbp_manifest_public",
        "https://www.ecfr.gov/current/title-19/part-103/section-103.31",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "Vessel manifest disclosure rule",
    },
    {
      ...manualSourceUse(
        "importyeti",
        "https://www.importyeti.com/policies/terms",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "ImportYeti service terms",
    },
    {
      ...manualSourceUse(
        "importgenius",
        "https://w3.importgenius.com/pricing",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "ImportGenius pricing and plan limits",
    },
    {
      ...manualSourceUse(
        "importgenius",
        "https://w3.importgenius.com/how-it-works/our-datasets/us-imports",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "ImportGenius U.S. import field coverage",
    },
    {
      ...manualSourceUse(
        "importgenius",
        "https://w3.importgenius.com/trade-api",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "ImportGenius Trade API",
    },
    {
      ...manualSourceUse(
        "tradeatlas",
        "https://www.tradeatlas.com/en/pricing-data-and-ai-package",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "TradeAtlas Data and AI pricing",
    },
    {
      ...manualSourceUse(
        "tradeatlas",
        "https://www.tradeatlas.com/en",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "TradeAtlas free account, sample, and API path",
    },
    {
      ...manualSourceUse(
        "tradeatlas",
        "https://www.tradeatlas.com/files/TradeAtlas_User_Manual_Unlimited_2025_New_Search_Screen.pdf",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "TradeAtlas 2025 user manual",
    },
    {
      ...manualSourceUse(
        "trademo",
        "https://www.trademo.com/intel/pricing",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "Trademo Intel pricing",
    },
    {
      ...manualSourceUse(
        "trademo",
        "https://www.trademo.com/faqs",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "Trademo FAQ and trial terms",
    },
    {
      ...manualSourceUse(
        "trademo",
        "https://www.trademo.com/apis/global-trade-shipments-api",
        REPORT_METADATA.providerReferencesReviewedAt
      ),
      displayName: "Trademo Global Trade Shipments API",
    },
  ];
}

function coverageForScope(input: {
  sources: readonly IntelSourceUse[];
  hasCompanyEvidence: boolean;
  geographyNote: string;
  completeYears: readonly number[];
  asOfMonth: string;
}) {
  const [asOfYear, asOfMonthNumber] = input.asOfMonth.split("-").map(Number);
  const asOfLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(asOfYear, asOfMonthNumber - 1, 1)));
  const historyRange = `${input.completeYears[0]}-${input.completeYears.at(-1)}`;
  return deriveOceanHardwareCoverage({
    aggregateData: "complete",
    hasCompanyEvidence: input.hasCompanyEvidence,
    missingData: [
      "Official aggregate files do not identify importers, startups, suppliers, bills of lading, shipment counts, transit times, or delays.",
      "Company-level air waybill data is not available in the public Census downloads.",
    ],
    notes: [
      input.geographyNote,
      `December year-to-date files provide revised annual totals for ${historyRange}. The ${asOfLabel} file provides current year-to-date totals.`,
      "The 2021 proxy contains 43 applicable codes. The 2022 revision added headings 8485, 8806, and 8807, so full-basket 2021-to-2022 growth is not directly comparable.",
      "Country is Census country of origin, not supplier location, country of shipment, or foreign loading port.",
    ],
    sources: input.sources,
  });
}

export async function OceanHardwareReportData() {
  let snapshot;
  try {
    snapshot = getCensusPublicHardwareSnapshot();
  } catch {
    return <OceanHardwareReportUnavailable />;
  }
  const providerSources = reportProviderSources();
  const chinaWatch = buildChinaWestCoastCorridorWatch(snapshot);
  const chinaRoutingBrief =
    buildOceanHardwareRoutingResearchBrief(chinaWatch);
  const chinaCustomsGuide = buildChinaUsCustomsDecisionGuide();
  const evidenceMethodSources = providerSources.filter((source) => source.sourceId === "usitc_hts");
  const observedCompanies = getImportGeniusPublicPreviewEvidence();
  const generatedAt = new Date().toISOString();
  const californiaRollups = buildCensusPublicPrecomputedRollups(
    snapshot,
    "california_destination"
  );
  const gatewayRollups = buildCensusPublicPrecomputedRollups(snapshot, "west_coast_gateway");
  const commonRequest = {
    question: REPORT_METADATA.question,
    asOfMonth: snapshot.asOfMonth,
    objectives: ["process_optimization", "startup_support", "lead_generation"] as const,
  };
  const californiaRequest = createOceanHardwareResearchRequest({
    ...commonRequest,
    geographyScope: "california_destination",
  });
  const gatewayRequest = createOceanHardwareResearchRequest({
    ...commonRequest,
    geographyScope: "west_coast_gateway",
    westCoastBasis: "port_of_unlading",
  });
  const evidenceSourcesFor = (sources: readonly IntelSourceUse[]) => [
    ...sources,
    ...evidenceMethodSources,
  ];

  const california = composeOceanHardwareResearchReport({
    request: californiaRequest,
    precomputedRollups: californiaRollups,
    observedCompanies,
    coverage: coverageForScope({
      sources: evidenceSourcesFor(californiaRollups.sources),
      hasCompanyEvidence: observedCompanies.length > 0,
      geographyNote:
        "California values come from State Imports HS6 and represent state of ultimate destination. They do not prove the customs gateway or buyer.",
      completeYears: californiaRequest.window.completeYears,
      asOfMonth: snapshot.asOfMonth,
    }),
    generatedAt,
    sources: evidenceSourcesFor(californiaRollups.sources),
  });
  const gateways = composeOceanHardwareResearchReport({
    request: gatewayRequest,
    precomputedRollups: gatewayRollups,
    coverage: coverageForScope({
      sources: evidenceSourcesFor(gatewayRollups.sources),
      hasCompanyEvidence: false,
      geographyNote:
        "West Coast values come from Port Imports HS6 and represent ports of unlading within districts 25, 27, 28, 29, and 30. They do not identify the buyer or final destination.",
      completeYears: gatewayRequest.window.completeYears,
      asOfMonth: snapshot.asOfMonth,
    }),
    generatedAt,
    sources: evidenceSourcesFor(gatewayRollups.sources),
  });
  const census = buildCensusPublicReportStatus(snapshot);

  return (
    <OceanHardwareReport
      california={california}
      gateways={gateways}
      census={census}
      chinaWatch={chinaWatch}
      chinaRoutingBrief={chinaRoutingBrief}
      chinaCustomsGuide={chinaCustomsGuide}
      providerSources={providerSources}
    />
  );
}
