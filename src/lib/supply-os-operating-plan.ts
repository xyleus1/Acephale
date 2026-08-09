import type {
  SupplyCaseDashboard,
  SupplyCoordinate,
  SupplyRouteNode,
  SupplyRouteSegment,
} from "./supply-os-case-model";
import { resolveSupplyCustomsTerritory } from "./supply-os-case-model";

export type PlanningClaimStatus = "modeled" | "verify" | "connection_required";

export type SupplyEvidenceRef = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  use: string;
  status: "verify";
};

export type SupplyPlanningScenario = {
  equipment: string;
  cargoProfile: string;
  commercialTerm: string;
  quantityBasis: string;
  exclusions: string;
  status: "modeled" | "verify";
};

export type SupplyMovementEndpoint = {
  nodeId: string;
  label: string;
  coordinates: SupplyCoordinate | null;
  status: PlanningClaimStatus;
};

export type SupplySourceRequirement = {
  id: string;
  label: string;
  url: string;
  freshnessTarget: string;
  status: "connection_required";
};

export type SupplyPortOption = {
  id: string;
  rank: number;
  port: string;
  bestFor: string;
  tradeoffs: string;
  inlandPlan: string;
  checksBeforeSelection: string[];
  evidenceRefIds: string[];
  status: "modeled";
};

export type SupplyLiveIntelligenceCheck = {
  id: string;
  title: string;
  question: string;
  whyItChangesThePlan: string;
  relatedNodeIds: string[];
  commodities: string[];
  sourceRequirements: SupplySourceRequirement[];
  freshnessTarget: string;
  decisionRule: string;
  currentFinding: string;
  status: "connection_required";
};

export type SupplyCustomsWorkflowStep = {
  sequence: number;
  title: string;
  owner: "shipper" | "Derya" | "licensed_broker" | "carrier";
  gate: string;
  output: string;
  evidenceRefIds: string[];
  status: PlanningClaimStatus;
};

export type SupplyInvoiceGuidance = {
  id: string;
  field: string;
  instruction: string;
  validation: string;
  evidenceRefIds: string[];
  status: "verify";
};

export type SupplyBrokerOption = {
  id: string;
  firm: string;
  service: string;
  selectionReason: string;
  qualificationChecks: string[];
  url: string;
  status: "verify";
};

export type SupplyCustomsConnector = {
  id: string;
  name: string;
  category: "classification" | "declaration" | "landed_cost" | "document_automation" | "trade_content";
  integrationMode: string;
  useInDerya: string;
  approvalBoundary: string;
  url: string;
  status: "connection_required";
};

export type SupplyCustomsPlan = {
  importRequired: boolean | null;
  recommendedEntryGateway: string | null;
  workflow: SupplyCustomsWorkflowStep[];
  invoiceGuidance: SupplyInvoiceGuidance[];
  brokerOptions: SupplyBrokerOption[];
  connectorIds: string[];
  note: string;
  status: PlanningClaimStatus;
};

export type SupplyProviderCandidate = {
  id: string;
  provider: string;
  service: string;
  request: string;
  verification: string;
  url: string;
  status: "verify" | "connection_required";
};

export type SupplyCostRange = {
  currency: "USD";
  low: number;
  high: number;
  basis: string;
  exclusions: string[];
  status: "modeled";
};

export type SupplyExecutionLeg = {
  sequence: number;
  id: string;
  segmentIds: string[];
  type: "origin_pickup" | "origin_handling" | "international_linehaul" | "border_clearance" | "destination_handling" | "drayage" | "inland_transport" | "last_mile" | "domestic_linehaul";
  from: string;
  to: string;
  mode: string;
  instruction: string;
  providers: SupplyProviderCandidate[];
  transitAssumption: string;
  costRange: SupplyCostRange | null;
  quoteInputs: string[];
  handoff: string;
  status: PlanningClaimStatus;
};

export type SupplyExecutionPlan = {
  scenario: SupplyPlanningScenario | null;
  legs: SupplyExecutionLeg[];
  total: SupplyCostRange | null;
  totalLabel: string;
  status: PlanningClaimStatus;
};

export type SupplyQuoteBlocker = {
  id: string;
  field: string;
  reason: string;
  owner: "shipper" | "supplier" | "Derya" | "licensed_broker";
  status: "verify";
};

export type SupplyMovementScope = "import" | "domestic" | "intra_eu" | "unknown";

export type SupplyMovementPlan = {
  movementId: string;
  source: SupplyMovementEndpoint | null;
  originGateway: SupplyMovementEndpoint;
  receivingGateway: SupplyMovementEndpoint | null;
  customsNode: SupplyMovementEndpoint | null;
  destination: SupplyMovementEndpoint | null;
  scope: SupplyMovementScope;
  geographyKnown: boolean;
  pathSegmentIds: string[];
  portOptions: SupplyPortOption[];
  intelligenceChecks: SupplyLiveIntelligenceCheck[];
  customsPlan: SupplyCustomsPlan;
  executionPlan: SupplyExecutionPlan;
  quoteBlockers: SupplyQuoteBlocker[];
  evidenceRefs: SupplyEvidenceRef[];
  status: PlanningClaimStatus;
};

export type SupplyOperatingPlan = {
  schemaVersion: 1;
  caseId: string;
  generatedAt: string;
  scenario: SupplyPlanningScenario;
  customsConnectors: SupplyCustomsConnector[];
  movements: SupplyMovementPlan[];
  status: PlanningClaimStatus;
};

const STANDARD_SCENARIO: SupplyPlanningScenario = {
  equipment: "Full-load movement, equipment to confirm",
  cargoProfile: "Standard non-hazardous general cargo",
  commercialTerm: "Incoterm to confirm",
  quantityBasis: "One full-load movement",
  exclusions: "Duties, taxes, insurance, storage, demurrage, detention, exams, and accessorials excluded",
  status: "modeled",
};

function hasUnresolvedDangerousGoods(dashboard: SupplyCaseDashboard): boolean {
  const text = [dashboard.companyDescription, ...dashboard.sourcingNeeds].join(" ");
  return /\b(?:battery|batteries|chemical|resin|solvent|aerosol|hazardous|dangerous goods|lithium|paint|adhesive|acid|propane|ethanol|alcohol|corrosive|oxidizer|pesticide|explosive|ammonia|chlorine|flammable|radioactive|peroxide|nitrate|fertilizer|dry ice)\b/i.test(text);
}

function scenarioForDashboard(dashboard: SupplyCaseDashboard): SupplyPlanningScenario {
  if (!hasUnresolvedDangerousGoods(dashboard)) return { ...STANDARD_SCENARIO };
  return {
    ...STANDARD_SCENARIO,
    cargoProfile: "Cargo profile blocked pending SDS and dangerous-goods transport classification",
    status: "verify",
  };
}

const EVIDENCE: Record<string, SupplyEvidenceRef> = {
  cbpInvoice: {
    id: "cbp-commercial-invoice",
    title: "Commercial invoice requirements",
    publisher: "US Customs and Border Protection",
    url: "https://www.help.cbp.gov/s/article/Article-1175?language=en_US",
    use: "Invoice data requirements for a US entry packet.",
    status: "verify",
  },
  cbpBrokers: {
    id: "cbp-broker-listing",
    title: "Permitted customs brokers by port",
    publisher: "US Customs and Border Protection",
    url: "https://www.cbp.gov/about/contact/brokers-listing",
    use: "Confirm that a broker is licensed and permitted for the intended port.",
    status: "verify",
  },
  cbpClassificationBoundary: {
    id: "cbp-h350722",
    title: "HQ H350722",
    publisher: "US Customs and Border Protection",
    url: "https://rulings.cbp.gov/api/getdoc/hq/2026/H350722.pdf",
    use: "Boundary for automated classification support and broker-controlled filing.",
    status: "verify",
  },
  screening: {
    id: "ita-consolidated-screening-list",
    title: "Consolidated Screening List",
    publisher: "US International Trade Administration",
    url: "https://www.trade.gov/consolidated-screening-list",
    use: "Restricted-party screening source, subject to legal review.",
    status: "verify",
  },
  fmcsa: {
    id: "fmcsa-qcmobile",
    title: "QCMobile API",
    publisher: "Federal Motor Carrier Safety Administration",
    url: "https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi",
    use: "Carrier authority and safety checks for US motor carriers.",
    status: "verify",
  },
  usda: {
    id: "usda-export-sales",
    title: "Export Sales Reporting Program",
    publisher: "US Department of Agriculture",
    url: "https://www.fas.usda.gov/programs/export-sales-reporting-program",
    use: "Commodity-specific demand and shipment context, including soybeans.",
    status: "verify",
  },
  portOptimizer: {
    id: "pola-port-optimizer",
    title: "Port Optimizer API Store",
    publisher: "Port of Los Angeles",
    url: "https://apistore.portoptimizer.com/",
    use: "Terminal, vessel, and cargo-event data for Los Angeles operations.",
    status: "verify",
  },
  polbTrack: {
    id: "polb-track-trace",
    title: "Public Track and Trace",
    publisher: "Port of Long Beach",
    url: "https://www.polb.com/publictrackandtrace/",
    use: "Long Beach cargo and terminal visibility.",
    status: "verify",
  },
  apmTerminal: {
    id: "apm-pier-400-api",
    title: "Pier 400 Terminal Container API",
    publisher: "APM Terminals",
    url: "https://developer.apmterminals.com/node/56",
    use: "Container-level availability and terminal event integration.",
    status: "verify",
  },
  maersk: {
    id: "maersk-developer-api",
    title: "Maersk Developer API",
    publisher: "Maersk",
    url: "https://developer.maersk.com/support/getting-started-api",
    use: "Schedules, shipment events, and carrier data after provisioning.",
    status: "verify",
  },
  cma: {
    id: "cma-cgm-schedules",
    title: "Schedules API",
    publisher: "CMA CGM",
    url: "https://api-portal.cma-cgm.com/products/schedules?summaryId=vesseloperation.route.v2",
    use: "Point-to-point vessel schedule candidates.",
    status: "verify",
  },
  hapag: {
    id: "hapag-schedules",
    title: "Operational Vessel Schedule API",
    publisher: "Hapag-Lloyd",
    url: "https://doc.api-portal.hlag.com/02.products/operational-vessel-schedule/",
    use: "Operational sailing and service candidates.",
    status: "verify",
  },
  drayAlliance: {
    id: "dray-alliance-api",
    title: "Quote API",
    publisher: "Dray Alliance",
    url: "https://developer.drayalliance.com/",
    use: "Drayage quote requests and response normalization.",
    status: "verify",
  },
  portPro: {
    id: "portpro-api",
    title: "PortPro API Documentation",
    publisher: "PortPro",
    url: "https://documentation.app.portpro.io/",
    use: "Drayage workflow and carrier integration.",
    status: "verify",
  },
};

export const SUPPLY_CUSTOMS_CONNECTORS: readonly SupplyCustomsConnector[] = [
  {
    id: "digicust",
    name: "Digicust",
    category: "classification",
    integrationMode: "REST, OpenAPI, SFTP, email, EDI, or webhooks after provisioning",
    useInDerya: "Extract customs data, propose HS-6 candidates with alternatives, and return reviewable reasoning.",
    approvalBoundary: "A licensed broker must approve destination tariff mapping and filing. Derya must not label an AI result entry-ready.",
    url: "https://www.digicust.com/en/api-reference/",
    status: "connection_required",
  },
  {
    id: "customs4trade",
    name: "Customs4trade CAS",
    category: "declaration",
    integrationMode: "Provisioned JSON API and lifecycle notifications",
    useInDerya: "Prepare and monitor supported European declaration workflows.",
    approvalBoundary: "Country coverage, declarant authority, and production submission rights require contracted setup.",
    url: "https://api.customs4trade.com/",
    status: "connection_required",
  },
  {
    id: "raft",
    name: "Raft",
    category: "document_automation",
    integrationMode: "Partner integration with freight, customs, and inbox systems",
    useInDerya: "Extract documents and orchestrate exception review before broker handoff.",
    approvalBoundary: "Public documentation does not establish filing authority or an unprovisioned production API.",
    url: "https://raft.ai/customs",
    status: "connection_required",
  },
  {
    id: "klearnow",
    name: "KlearNow.AI",
    category: "declaration",
    integrationMode: "Contracted API or EDI integration",
    useInDerya: "Coordinate customs documents, transaction status, and port-to-door handoffs where supported.",
    approvalBoundary: "Broker relationship, country coverage, and production submission must be verified during onboarding.",
    url: "https://www.klearnow.ai/en-gb/customs-engine/",
    status: "connection_required",
  },
  {
    id: "zonos",
    name: "Zonos",
    category: "landed_cost",
    integrationMode: "Supply-chain APIs after account provisioning",
    useInDerya: "Enrich classification and estimate cross-border duty and tax scenarios.",
    approvalBoundary: "Estimates do not replace broker classification, customs valuation, or a filed entry.",
    url: "https://zonos.com/docs/supply-chain",
    status: "connection_required",
  },
  {
    id: "avalara",
    name: "Avalara Cross-Border",
    category: "landed_cost",
    integrationMode: "Cross-border APIs after account provisioning",
    useInDerya: "Calculate modeled duty and tax exposure from reviewed product facts.",
    approvalBoundary: "Classification and landed-cost output remains advisory until importer and broker approval.",
    url: "https://developer.avalara.com/products/crossborder",
    status: "connection_required",
  },
  {
    id: "descartes-customsinfo",
    name: "Descartes CustomsInfo",
    category: "trade_content",
    integrationMode: "Contracted trade-content integration",
    useInDerya: "Provide tariff, regulatory, and trade-content research inputs.",
    approvalBoundary: "Content assists research but does not authorize filing or determine final legal treatment.",
    url: "https://www.descartes.com/resources/knowledge-center/descartes-customsinfotm",
    status: "connection_required",
  },
];

type ResolvedMovement = {
  origin: SupplyRouteNode;
  source: SupplyRouteNode | null;
  receiving: SupplyRouteNode | null;
  customs: SupplyRouteNode | null;
  destination: SupplyRouteNode | null;
  segments: SupplyRouteSegment[];
};

function endpoint(node: SupplyRouteNode | null, fallbackStatus: PlanningClaimStatus = "modeled"): SupplyMovementEndpoint | null {
  if (!node) return null;
  return {
    nodeId: node.id,
    label: node.label,
    coordinates: node.coordinates,
    status: node.status === "needs_confirmation" ? "verify" : fallbackStatus,
  };
}

function findMovement(dashboard: SupplyCaseDashboard, origin: SupplyRouteNode): ResolvedMovement {
  const nodes = new Map(dashboard.route.nodes.map((node) => [node.id, node]));
  const incoming = dashboard.route.segments.filter((segment) => segment.toNodeId === origin.id);
  const pickup = incoming.find((segment) => nodes.get(segment.fromNodeId)?.kind === "source") ?? null;
  const main = dashboard.route.segments.find((segment) =>
    segment.fromNodeId === origin.id && nodes.get(segment.toNodeId)?.kind === "receiving_gateway"
  ) ?? null;
  const receiving = main ? nodes.get(main.toNodeId) ?? null : null;
  const afterReceiving = receiving
    ? dashboard.route.segments.find((segment) => segment.fromNodeId === receiving.id) ?? null
    : null;
  const firstDownstream = afterReceiving ? nodes.get(afterReceiving.toNodeId) ?? null : null;
  const customs = firstDownstream?.kind === "customs" ? firstDownstream : null;
  const finalSegment = customs
    ? dashboard.route.segments.find((segment) => segment.fromNodeId === customs.id) ?? null
    : afterReceiving;
  const destination = finalSegment && nodes.get(finalSegment.toNodeId)?.kind === "destination"
    ? nodes.get(finalSegment.toNodeId) ?? null
    : null;
  return {
    origin,
    source: pickup ? nodes.get(pickup.fromNodeId) ?? null : null,
    receiving,
    customs,
    destination,
    segments: [pickup, main, customs ? afterReceiving : null, finalSegment].filter(
      (segment): segment is SupplyRouteSegment => Boolean(segment),
    ),
  };
}

function movementScope(movement: ResolvedMovement): SupplyMovementScope {
  const linehaul = movement.segments.find((segment) => segment.fromNodeId === movement.origin.id);
  if (linehaul?.label === "Intra-EU freight") return "intra_eu";
  if (linehaul?.label === "Domestic freight") return "domestic";
  if (movement.customs || linehaul?.label === "International freight" || linehaul?.label === "International air freight" || linehaul?.label === "Cross-border road freight") return "import";
  return "unknown";
}

function hasKnownGeography(movement: ResolvedMovement): boolean {
  const required = [movement.source, movement.origin, movement.receiving, movement.destination];
  return required.every((node) => Boolean(node?.coordinates))
    && required.every((node) => !/confirm|needed/i.test(node?.label ?? ""));
}

function portOptions(movement: ResolvedMovement, scope: SupplyMovementScope, known: boolean): SupplyPortOption[] {
  if (!known || scope !== "import" || !movement.receiving) return [];
  const linehaul = movement.segments.find((segment) => segment.fromNodeId === movement.origin.id);
  if (linehaul?.label === "Cross-border road freight" || linehaul?.mode === "air") return [];
  const label = movement.receiving.label;
  const authorityRefs = isUnitedStatesDestination(movement.destination?.label) ? [EVIDENCE.fmcsa.id] : [];
  const common = {
    checksBeforeSelection: ["Live vessel schedule and capacity", "Terminal free time and appointment availability", "Customs broker coverage", "Inland capacity and delivered cost"],
    status: "modeled" as const,
  };
  if (/Los Angeles and Long Beach/i.test(label)) {
    return [
      {
        id: `${movement.origin.id}-port-la`, rank: 1, port: "Port of Los Angeles",
        bestFor: "Transpacific FCL with strong terminal-data coverage and multiple inland options.",
        tradeoffs: "Terminal choice, appointment availability, dwell, and inland capacity can reverse the modeled ranking.",
        inlandPlan: "Compare on-dock rail against transload plus truck for the final destination.",
        evidenceRefIds: [EVIDENCE.portOptimizer.id, EVIDENCE.apmTerminal.id, ...authorityRefs], ...common,
      },
      {
        id: `${movement.origin.id}-port-lb`, rank: 2, port: "Port of Long Beach",
        bestFor: "Transpacific FCL where the selected carrier and terminal produce a better all-in schedule.",
        tradeoffs: "Do not select on ocean rate alone. Compare terminal availability, free time, drayage, rail, and final delivery.",
        inlandPlan: "Use public track and trace, then price drayage and intermodal as one delivered route.",
        evidenceRefIds: [EVIDENCE.polbTrack.id, ...authorityRefs], ...common,
      },
      {
        id: `${movement.origin.id}-port-oakland`, rank: 3, port: "Port of Oakland",
        bestFor: "A disruption alternative when a live carrier schedule and inland quote beat Southern California.",
        tradeoffs: "A longer or less frequent ocean service can erase any congestion advantage.",
        inlandPlan: "Request a fully delivered intermodal quote before treating Oakland as viable.",
        evidenceRefIds: [EVIDENCE.maersk.id, EVIDENCE.cma.id, EVIDENCE.hapag.id, ...authorityRefs], ...common,
      },
    ];
  }
  if (/New York and New Jersey/i.test(label)) {
    return [
      {
        id: `${movement.origin.id}-port-nynj`, rank: 1, port: "Port of New York and New Jersey",
        bestFor: "Atlantic services with a shorter modeled inland move to eastern and Midwest destinations.",
        tradeoffs: "Bridge limits, terminal appointment rules, chassis, dwell, and rail availability need live confirmation.",
        inlandPlan: "Compare direct truck, rail, and transload options using a single delivered-cost request.",
        evidenceRefIds: [EVIDENCE.maersk.id, EVIDENCE.cma.id, EVIDENCE.hapag.id, ...authorityRefs], ...common,
      },
      {
        id: `${movement.origin.id}-port-savannah`, rank: 2, port: "Port of Savannah",
        bestFor: "A carrier-schedule or disruption alternative when the all-in inland quote remains competitive.",
        tradeoffs: "Extra inland distance can outweigh a favorable port or ocean condition.",
        inlandPlan: "Require a rail or truck quote to the actual receiver before switching gateways.",
        evidenceRefIds: [EVIDENCE.maersk.id, EVIDENCE.cma.id, EVIDENCE.hapag.id, ...authorityRefs], ...common,
      },
    ];
  }
  if (/Savannah/i.test(label)) {
    return [
      {
        id: `${movement.origin.id}-port-savannah`, rank: 1, port: "Port of Savannah",
        bestFor: "An all-water Asia service with a shorter inland move to Southeast destinations.",
        tradeoffs: "The longer ocean transit can outweigh the inland advantage, so compare exact services, transshipments, and delivered cost.",
        inlandPlan: "Compare direct truck against rail only after the receiver, terminal, and final delivery address are known.",
        evidenceRefIds: [EVIDENCE.maersk.id, EVIDENCE.cma.id, EVIDENCE.hapag.id, ...authorityRefs], ...common,
      },
      {
        id: `${movement.origin.id}-port-charleston`, rank: 2, port: "Port of Charleston",
        bestFor: "A second Southeast gateway when its carrier service, terminal conditions, and inland rate beat Savannah.",
        tradeoffs: "Broker coverage, product-agency handling, terminal capacity, and final-mile price need separate confirmation.",
        inlandPlan: "Request the same door-to-door charge template as Savannah so the two gateways are comparable.",
        evidenceRefIds: [EVIDENCE.maersk.id, EVIDENCE.cma.id, EVIDENCE.hapag.id, ...authorityRefs], ...common,
      },
      {
        id: `${movement.origin.id}-port-san-pedro`, rank: 3, port: "Ports of Los Angeles and Long Beach",
        bestFor: "A faster transpacific crossing when the long inland move still supports the required delivery date.",
        tradeoffs: "More inland distance and handoffs can erase the ocean-time advantage and create terminal, rail, and final-mile exposure.",
        inlandPlan: "Price terminal, drayage, transload or IPI, rail, and final delivery before treating the West Coast as faster or cheaper.",
        evidenceRefIds: [EVIDENCE.portOptimizer.id, EVIDENCE.polbTrack.id, EVIDENCE.maersk.id, ...authorityRefs], ...common,
      },
    ];
  }
  return [{
    id: `${movement.origin.id}-port-primary`, rank: 1, port: label,
    bestFor: "The shortest modeled gateway path in the generated route.",
    tradeoffs: "This is a geographic model, not a live service, capacity, customs, or cost recommendation.",
    inlandPlan: "Obtain a single all-in quote through final delivery and compare one alternate gateway.",
    evidenceRefIds: [EVIDENCE.maersk.id, EVIDENCE.cma.id, EVIDENCE.hapag.id, ...authorityRefs], ...common,
  }];
}

function sourceRequirement(id: string, label: string, url: string, freshnessTarget: string): SupplySourceRequirement {
  return { id, label, url, freshnessTarget, status: "connection_required" };
}

function commoditiesForMovement(dashboard: SupplyCaseDashboard): string[] {
  if (!dashboard.sourcingNeeds.length) return ["Commodity to confirm"];
  if (dashboard.sourcingNeeds.length > 1 && dashboard.sourceRegions.length > 1) {
    return ["Commodity allocation to this source must be confirmed"];
  }
  return dashboard.sourcingNeeds;
}

function intelligenceChecks(
  dashboard: SupplyCaseDashboard,
  movement: ResolvedMovement,
  scope: SupplyMovementScope,
): SupplyLiveIntelligenceCheck[] {
  const commodities = commoditiesForMovement(dashboard);
  const commodityText = commodities.join(", ");
  const receiving = movement.receiving?.label ?? "receiving gateway to confirm";
  const linehaul = movement.segments.find((segment) => segment.fromNodeId === movement.origin.id);
  const crossBorderRoad = linehaul?.label === "Cross-border road freight";
  const airMovement = scope === "import" && linehaul?.mode === "air";
  const oceanMovement = scope === "import" && !crossBorderRoad && !airMovement;
  const sourceTerritory = resolveSupplyCustomsTerritory(movement.source?.label ?? null);
  const supplierRequirement = sourceRequirement(
    "supplier-erp",
    "Supplier confirmation plus ERP or procurement events",
    "internal://supplier-and-procurement",
    "Event-driven, with daily stale-data alert",
  );
  const agriculturalRequirements = /soy|grain|agricultur/i.test(commodityText)
    ? sourceTerritory === "United States"
      ? [supplierRequirement, sourceRequirement(EVIDENCE.usda.id, EVIDENCE.usda.title, EVIDENCE.usda.url, "Daily event feed plus weekly official release")]
      : [supplierRequirement, sourceRequirement(`${movement.origin.id}-local-agriculture`, `${sourceTerritory ?? "Source-country"} official agricultural market and trade data`, "connection://source-country-agriculture", "Daily market data plus official release cadence")]
    : [supplierRequirement];
  const sourceNodeIds = movement.source ? [movement.source.id] : [movement.origin.id];
  const gatewayNodeIds = movement.receiving ? [movement.receiving.id] : [movement.origin.id];
  const linehaulNodeIds = [movement.origin, movement.receiving].flatMap((node) => node ? [node.id] : []);
  const customsAndDeliveryNodeIds = [movement.customs ?? movement.receiving, movement.destination]
    .flatMap((node) => node ? [node.id] : []);
  const result: SupplyLiveIntelligenceCheck[] = [
    {
      id: `${movement.origin.id}-commodity`,
      title: "Commodity availability and disruption",
      question: `Is supply of ${commodityText} disrupted near ${movement.source?.label ?? "the source"}, and will it change the cargo-ready date or quantity?`,
      whyItChangesThePlan: "A supply delay changes booking timing, consolidation, inventory exposure, and whether an expedited mode is rational.",
      relatedNodeIds: sourceNodeIds,
      commodities,
      sourceRequirements: agriculturalRequirements,
      freshnessTarget: "Confirm at planning, booking, and cargo-ready milestones",
      decisionRule: "If confirmed quantity or cargo-ready date moves outside the booking window, reprice the sailing and inventory impact before approval.",
      currentFinding: "Unknown. Supplier confirmations, procurement events, ERP records, and relevant market sources are not connected.",
      status: "connection_required",
    },
    {
      id: `${movement.origin.id}-gateway`,
      title: oceanMovement ? "Gateway and terminal conditions" : airMovement ? "Air-cargo gateway conditions" : "Ground gateway and corridor conditions",
      question: oceanMovement
        ? `Are the relevant terminals at ${receiving} accepting the container without a material dwell, appointment, chassis, labor, or closure constraint?`
        : airMovement
          ? `Is ${receiving} accepting the cargo without a material flight, warehouse, screening, breakdown, storage, labor, or closure constraint?`
        : crossBorderRoad
          ? `Is ${receiving} operating without a material crossing wait, bridge restriction, transfer, inspection, labor, or commercial-hours constraint?`
          : `Is the road or rail corridor through ${receiving} operating without a material capacity, closure, labor, weather, or transfer constraint?`,
      whyItChangesThePlan: oceanMovement
        ? "Terminal-level constraints determine the usable carrier service, free-time exposure, drayage plan, and true gateway ranking."
        : airMovement
          ? "Airline capacity, cargo acceptance, handling cutoffs, screening, and warehouse recovery determine whether the stated air plan is executable."
        : "Ground-network constraints determine the usable carrier, transfer plan, appointment, and delivered cost.",
      relatedNodeIds: gatewayNodeIds,
      commodities,
      sourceRequirements: oceanMovement && /Los Angeles and Long Beach/i.test(receiving)
        ? [
            sourceRequirement(EVIDENCE.portOptimizer.id, EVIDENCE.portOptimizer.title, EVIDENCE.portOptimizer.url, "15 minutes or provider event cadence"),
            sourceRequirement(EVIDENCE.polbTrack.id, EVIDENCE.polbTrack.title, EVIDENCE.polbTrack.url, "15 minutes or provider event cadence"),
            sourceRequirement(EVIDENCE.apmTerminal.id, EVIDENCE.apmTerminal.title, EVIDENCE.apmTerminal.url, "Provider event cadence"),
          ]
        : oceanMovement
          ? [sourceRequirement("port-terminal-feed", `${receiving} terminal and port feed`, "connection://port-terminal-feed", "15 minutes or provider event cadence")]
          : airMovement
            ? [
                sourceRequirement("airline-capacity-response", "Authenticated airline or forwarder capacity response", "connection://airline-capacity", "At quote, tender, and flight-change events"),
                sourceRequirement("air-cargo-terminal-feed", `${receiving} air-cargo handling and availability feed`, "connection://air-cargo-terminal-feed", "15 minutes or provider event cadence"),
              ]
          : [
              sourceRequirement("tms-movement-events", "TMS carrier and movement events", "internal://tms-movement-events", "Event-driven"),
              sourceRequirement("ground-corridor-feed", `${receiving} road, rail, crossing, and disruption feed`, "connection://ground-corridor-feed", "15 minutes during handoff, daily during planning"),
            ],
      freshnessTarget: oceanMovement ? "15 minutes during terminal handoff, daily before vessel arrival" : airMovement ? "15 minutes during air-cargo handoff, daily before flight departure" : "15 minutes during handoff, daily during planning",
      decisionRule: oceanMovement
        ? "Re-rank gateways when expected delay plus accessorial exposure exceeds the cost of the best live alternative."
        : airMovement
          ? "Retender the service when capacity, cargo acceptance, cutoff, or expected handling delay breaks the required delivery date or delivered-cost threshold."
        : "Retender the route when confirmed delay, closure, or transfer exposure exceeds the delivered cost of the best live alternative.",
      currentFinding: oceanMovement
        ? "Unknown. No terminal, port, chassis, appointment, or container-level callback has succeeded."
        : airMovement
          ? "Unknown. No airline capacity, handling-facility, screening, flight, or air-waybill callback has succeeded."
        : "Unknown. No TMS event, carrier response, road, rail, crossing, or corridor callback has succeeded.",
      status: "connection_required",
    },
    {
      id: `${movement.origin.id}-schedule-rate`,
      title: "Service, capacity, and rate",
      question: oceanMovement
        ? `Which bookable service moves one 40HC from ${movement.origin.label} to ${receiving}, with the best delivered cost and acceptable schedule risk?`
        : airMovement
          ? `Which bookable air service moves the confirmed chargeable weight from ${movement.origin.label} to ${receiving}, with the best delivered cost and acceptable cutoff and recovery risk?`
        : `Which qualified carrier can move the planned full load from ${movement.origin.label} to ${receiving}, with the best delivered cost and acceptable schedule risk?`,
      whyItChangesThePlan: oceanMovement
        ? "A nominal port pair is not executable until a carrier returns a service, cutoff, capacity, free time, and rate validity."
        : airMovement
          ? "A nominal airport pair is not executable until a forwarder or airline confirms routing, chargeable weight, cargo acceptance, cutoff, capacity, handling, and rate validity."
        : "A modeled ground lane is not executable until a carrier returns equipment, handoffs, capacity, schedule, accessorials, and quote validity.",
      relatedNodeIds: linehaulNodeIds,
      commodities,
      sourceRequirements: oceanMovement
        ? [
            sourceRequirement(EVIDENCE.maersk.id, EVIDENCE.maersk.title, EVIDENCE.maersk.url, "On request plus daily refresh"),
            sourceRequirement(EVIDENCE.cma.id, EVIDENCE.cma.title, EVIDENCE.cma.url, "On request plus daily refresh"),
            sourceRequirement(EVIDENCE.hapag.id, EVIDENCE.hapag.title, EVIDENCE.hapag.url, "On request plus daily refresh"),
          ]
        : airMovement
          ? [
              sourceRequirement("dhl-air-offer", "Authenticated DHL Air Freight offer", "connection://dhl-air-freight", "On request plus expiry-based refresh"),
              sourceRequirement("air-forwarder-offers", "Authenticated air-forwarder and airline offers", "connection://air-freight-offers", "On request plus expiry-based refresh"),
            ]
          : [
            sourceRequirement("tms-rate-network", "TMS, broker, and contracted carrier quote network", "connection://ground-rate-network", "On request plus expiry-based refresh"),
            sourceRequirement("carrier-capacity-response", "Authenticated carrier capacity response", "connection://carrier-capacity", "At quote, tender, and carrier-change events"),
          ],
      freshnessTarget: oceanMovement ? "At quote, booking, rollover, and schedule-change events" : airMovement ? "At quote, tender, flight-change, and cargo-acceptance events" : "At quote, tender, dispatch, and carrier-change events",
      decisionRule: oceanMovement
        ? "Do not recommend a carrier until the quote response includes service identity, validity, inclusions, free time, and capacity status."
        : airMovement
          ? "Do not recommend an air service until the response includes operating carrier, routing, chargeable weight, cutoff, cargo acceptance, capacity, inclusions, and expiry."
        : "Do not recommend a carrier until the response includes operating entity, equipment, handoffs, validity, inclusions, accessorials, and capacity status.",
      currentFinding: oceanMovement
        ? "Unknown. Published schedules do not prove capacity, and no authenticated offer with a quote ID and expiry is connected."
        : airMovement
          ? "Unknown. No authenticated air-freight offer with routing, chargeable weight, cargo acceptance, capacity, quote ID, and expiry is connected."
        : "Unknown. No authenticated ground-carrier offer with operating entity, equipment, capacity, quote ID, and expiry is connected.",
      status: "connection_required",
    },
  ];
  if (scope === "import") {
    const usDestination = isUnitedStatesDestination(movement.destination?.label);
    result.push({
      id: `${movement.origin.id}-customs-drayage`,
      title: oceanMovement ? "Customs release and post-port capacity" : airMovement ? "Customs release and post-airport capacity" : "Customs release and import-side capacity",
      question: oceanMovement
        ? `Can the broker pre-clear this ${commodityText} entry and can a qualified carrier recover it from ${receiving} inside free time?`
        : airMovement
          ? `Can the broker pre-clear this ${commodityText} entry and can a qualified carrier recover it from ${receiving} before storage exposure begins?`
        : `Can the broker pre-clear this ${commodityText} entry and can a qualified import-side carrier accept it at ${receiving} after release?`,
      whyItChangesThePlan: "Broker readiness, holds, exams, carrier authority, and appointment capacity can dominate the final delivered cost.",
      relatedNodeIds: customsAndDeliveryNodeIds,
      commodities,
      sourceRequirements: [
        sourceRequirement(EVIDENCE.screening.id, EVIDENCE.screening.title, EVIDENCE.screening.url, "Daily list refresh plus transaction-time screening"),
        ...(usDestination && oceanMovement
          ? [
              sourceRequirement(EVIDENCE.fmcsa.id, EVIDENCE.fmcsa.title, EVIDENCE.fmcsa.url, "At selection and dispatch"),
              sourceRequirement(EVIDENCE.drayAlliance.id, EVIDENCE.drayAlliance.title, EVIDENCE.drayAlliance.url, "On quote and dispatch events"),
            ]
          : usDestination
            ? [
                sourceRequirement(EVIDENCE.fmcsa.id, EVIDENCE.fmcsa.title, EVIDENCE.fmcsa.url, "At selection and dispatch"),
                sourceRequirement(airMovement ? "air-recovery-capacity" : "cross-border-capacity", airMovement ? "Airport recovery and final-mile capacity network" : "Cross-border carrier and import-side capacity network", airMovement ? "connection://air-recovery-capacity" : "connection://cross-border-capacity", "On quote, release, and dispatch events"),
              ]
            : [
              sourceRequirement("destination-carrier-authority", "Destination carrier authority and insurance registry", "connection://destination-carrier-authority", "At selection and dispatch"),
              sourceRequirement("destination-drayage-network", "Destination drayage quote and capacity network", "connection://destination-drayage-network", "On quote and dispatch events"),
            ]),
      ],
      freshnessTarget: "At document receipt, pre-arrival, release, and dispatch",
      decisionRule: "Hold booking approval if broker setup, admissibility facts, or a qualified recovery plan is missing.",
      currentFinding: oceanMovement
        ? "Unknown. No licensed-broker acceptance, authority response, terminal release, or authenticated drayage quote is connected."
        : airMovement
          ? "Unknown. No licensed-broker acceptance, air-cargo release, storage-clock event, or authenticated recovery quote is connected."
        : "Unknown. No licensed-broker acceptance, authority response, customs release, or authenticated import-side carrier quote is connected.",
      status: "connection_required",
    });
  }
  return result;
}

function isUnitedStatesDestination(label: string | undefined): boolean {
  return resolveSupplyCustomsTerritory(label ?? null) === "United States";
}

function brokerOptions(movement: ResolvedMovement): SupplyBrokerOption[] {
  const destination = movement.destination?.label ?? "the destination";
  const shared = [
    {
      id: `${movement.origin.id}-broker-dhl`, firm: "DHL Global Forwarding Customs Services", service: `Brokerage coordination for entry into ${destination}`,
      selectionReason: "Useful when forwarding and customs handoffs should sit with one provider.",
      qualificationChecks: ["Destination license and port permit", "Commodity and agency experience", "POA and bond readiness", "Entry and exception response SLA"],
      url: "https://www.dhl.com/global-en/home/our-divisions/global-forwarding.html", status: "verify",
    },
    {
      id: `${movement.origin.id}-broker-expeditors`, firm: "Expeditors", service: `Customs brokerage and trade-compliance support for ${destination}`,
      selectionReason: "Candidate for broker-led entries that require close forwarding and compliance coordination.",
      qualificationChecks: ["Destination license and port permit", "Commodity and agency experience", "Electronic filing coverage", "Escalation ownership"],
      url: "https://www.expeditors.com/services/customs-and-compliance", status: "verify",
    },
  ] satisfies SupplyBrokerOption[];
  if (isUnitedStatesDestination(movement.destination?.label)) {
    return [
      ...shared,
      {
        id: `${movement.origin.id}-broker-livingston`, firm: "Livingston International", service: `Customs brokerage candidate for ${destination}`,
        selectionReason: "Candidate when North American brokerage depth and cross-border support matter.",
        qualificationChecks: ["Destination license and port permit", "Commodity and agency experience", "POA and bond readiness", "Fee schedule and disbursement terms"],
        url: "https://www.livingstonintl.com/customs-brokerage/", status: "verify",
      },
    ];
  }
  return [
    shared[0],
    {
      id: `${movement.origin.id}-broker-kuehne-nagel`, firm: "Kuehne+Nagel", service: `Destination customs-clearance candidate for ${destination}`,
      selectionReason: "Candidate for an import workflow that needs local forwarding and customs coordination.",
      qualificationChecks: ["Destination declarant or broker authority", "Commodity and agency experience", "Port coverage", "Entry and exception response SLA"],
      url: "https://home.kuehne-nagel.com/en/-/services/customs-clearance", status: "verify",
    },
    {
      id: `${movement.origin.id}-broker-dsv`, firm: "DSV Customs Clearance", service: `Destination customs-clearance candidate for ${destination}`,
      selectionReason: "Candidate when customs and inland handoffs should be evaluated in one operating chain.",
      qualificationChecks: ["Destination declarant or broker authority", "Commodity and agency experience", "Port coverage", "Fee schedule and escalation ownership"],
      url: "https://www.dsv.com/en/our-solutions/value-added-services/customs-clearance", status: "verify",
    },
  ];
}

function invoiceGuidance(movement: ResolvedMovement): SupplyInvoiceGuidance[] {
  const ref = isUnitedStatesDestination(movement.destination?.label) ? [EVIDENCE.cbpInvoice.id] : [];
  const rows: Array<[string, string, string, string]> = [
    ["parties", "Seller, buyer, consignee, and importer", "Use legal names, full addresses, and tax or importer identifiers. Do not substitute a carrier address for the actual transaction party.", "Match PO, contract, importer setup, and broker POA."],
    ["description", "Product description", "Describe what each item is, what it is made from, and its principal use. Internal part numbers alone are inadequate.", "Broker can classify from the description and supporting technical facts."],
    ["quantity", "Quantity and units", "State line-level quantity, commercial unit, package count, net weight, and gross weight.", "Totals reconcile to packing list and transport document."],
    ["value", "Value, currency, and payment", "Show unit price, extended value, currency, discounts, assists, tooling, royalties, and payment terms where applicable.", "Invoice total reconciles to the purchase record and valuation method."],
    ["origin", "Country of origin", "State manufacturing origin by line and retain the supplier basis. Export country is not automatically country of origin.", "Origin evidence supports marking, tariff, preference, and trade-remedy review."],
    ["classification", "Classification reference", "Provide Derya's HS-6 candidates and alternatives as research only. The licensed broker approves destination tariff mapping.", "Approved code, rationale, and product facts are versioned before filing."],
    ["terms", "Incoterm and charge allocation", "State the named Incoterm location and separately identify freight, insurance, packing, and other charges.", "Commercial terms match the routing and customs-value treatment."],
  ];
  return rows.map(([id, field, instruction, validation]) => ({
    id: `${movement.origin.id}-invoice-${id}`, field, instruction, validation, evidenceRefIds: ref, status: "verify",
  }));
}

function customsPlan(movement: ResolvedMovement, scope: SupplyMovementScope, ports: SupplyPortOption[]): SupplyCustomsPlan {
  if (scope === "domestic" || scope === "intra_eu") {
    return {
      importRequired: false,
      recommendedEntryGateway: null,
      workflow: [],
      invoiceGuidance: [],
      brokerOptions: [],
      connectorIds: [],
      note: scope === "intra_eu"
        ? "No import declaration is modeled for this intra-EU movement. Confirm VAT, statistical reporting, product, and transport obligations separately."
        : "No import declaration is modeled because the route is within one customs territory. Confirm commodity-specific domestic obligations separately.",
      status: "modeled",
    };
  }
  if (scope === "unknown") {
    return {
      importRequired: null, recommendedEntryGateway: null, workflow: [], invoiceGuidance: [], brokerOptions: [], connectorIds: [],
      note: "Exact source and destination customs territories are required before generating an import workflow.", status: "verify",
    };
  }
  const us = isUnitedStatesDestination(movement.destination?.label);
  const refs = us ? [EVIDENCE.cbpBrokers.id, EVIDENCE.cbpClassificationBoundary.id] : [];
  return {
    importRequired: true,
    recommendedEntryGateway: ports[0]?.port ?? movement.receiving?.label ?? null,
    workflow: [
      { sequence: 1, title: "Build source-fact packet", owner: "shipper", gate: "Exact product, composition, use, value, origin, parties, and transport documents received", output: "Versioned item and shipment facts", evidenceRefIds: us ? [EVIDENCE.cbpInvoice.id] : [], status: "verify" },
      { sequence: 2, title: "Generate classification candidates", owner: "Derya", gate: "Source facts pass completeness checks", output: "HS-6 suggestion, alternatives, reasoning, and unresolved questions", evidenceRefIds: refs, status: "connection_required" },
      { sequence: 3, title: "Establish importer and broker authority", owner: "licensed_broker", gate: "Direct importer-broker POA, account, bond or guarantee, and port coverage confirmed", output: "Broker acceptance and filing authority", evidenceRefIds: us ? [EVIDENCE.cbpBrokers.id] : [], status: "verify" },
      { sequence: 4, title: "Approve entry treatment", owner: "licensed_broker", gate: "Broker approves destination classification, valuation, origin, admissibility, agencies, duties, and trade remedies", output: "Approved entry instructions and pre-arrival exception list", evidenceRefIds: refs, status: "verify" },
      { sequence: 5, title: "Submit through provisioned filing rail", owner: "licensed_broker", gate: "Submission occurs only on a real authenticated callback from the broker-controlled production system", output: "Acceptance, rejection, or hold reference from the filing system", evidenceRefIds: refs, status: "connection_required" },
      { sequence: 6, title: "Control release and recovery", owner: "Derya", gate: "Customs and agency release plus destination handoff availability confirmed", output: "Released freight and approved destination dispatch", evidenceRefIds: us ? [EVIDENCE.fmcsa.id] : [], status: "connection_required" },
    ],
    invoiceGuidance: invoiceGuidance(movement),
    brokerOptions: brokerOptions(movement),
    connectorIds: us
      ? ["zonos", "digicust", "descartes-customsinfo", "avalara", "raft", "klearnow"]
      : ["zonos", "digicust", "customs4trade", "descartes-customsinfo", "avalara", "raft"],
    note: "Derya prepares facts and orchestrates approvals. A licensed broker controls destination classification approval and any customs submission.",
    status: "verify",
  };
}

function provider(
  id: string,
  name: string,
  service: string,
  request: string,
  verification: string,
  url: string,
  status: SupplyProviderCandidate["status"] = "connection_required",
): SupplyProviderCandidate {
  return { id, provider: name, service, request, verification, url, status };
}

function modeledCost(low: number, high: number, basis: string): SupplyCostRange {
  return {
    currency: "USD", low, high, basis,
    exclusions: ["Duties and taxes", "Insurance", "Storage, demurrage, and detention", "Customs exams", "Unquoted accessorials"],
    status: "modeled",
  };
}

function isPortLocalDelivery(receiving: string, destination: string): boolean {
  const localPairs = [
    [/Los Angeles|Long Beach/i, /Los Angeles, California/i],
    [/Port of Oakland/i, /San Francisco Bay Area/i],
    [/Port of Boston/i, /Boston, Massachusetts/i],
    [/Port of New York and New Jersey/i, /New York and New Jersey/i],
  ] as const;
  return localPairs.some(([gatewayPattern, destinationPattern]) =>
    gatewayPattern.test(receiving) && destinationPattern.test(destination));
}

function executionPlan(
  movement: ResolvedMovement,
  scope: SupplyMovementScope,
  known: boolean,
  baseScenario: SupplyPlanningScenario,
): SupplyExecutionPlan {
  const source = movement.source?.label ?? "source to confirm";
  const origin = movement.origin.label;
  const receiving = movement.receiving?.label ?? "gateway to confirm";
  const destination = movement.destination?.label ?? "destination to confirm";
  const mainLinehaul = movement.segments.find((item) => item.fromNodeId === movement.origin.id);
  const crossBorderRoad = movement.segments.some((item) => item.label === "Cross-border road freight");
  const airImport = scope === "import" && mainLinehaul?.mode === "air";
  const oceanImport = scope === "import" && !crossBorderRoad && !airImport;
  const usDestination = isUnitedStatesDestination(movement.destination?.label);
  const canModelCost = known && scope !== "unknown" && baseScenario.status === "modeled";
  const segment = (label: string) => movement.segments.filter((item) => item.label === label).map((item) => item.id);
  const movementScenario: SupplyPlanningScenario = {
    ...baseScenario,
    equipment: oceanImport ? "1 x 40HC" : airImport ? "Air cargo unitization and chargeable weight to confirm" : "Full truckload or container equivalent to confirm",
    quantityBasis: oceanImport ? "One full-container movement" : airImport ? "One air-freight consignment" : "One full-load movement",
  };
  const legs: SupplyExecutionLeg[] = [];
  let sequence = 1;
  const roadProvidersForLeg = (legId: string, from: string, to: string): SupplyProviderCandidate[] => [
    provider(`${movement.origin.id}-${legId}-dsv-road`, "DSV Road", "Road or intermodal capacity candidate", `Quote transport from ${from} to ${to} with equipment, handoffs, schedule, and accessorials itemized.`, "Verify the local operating entity, authority, insurance, equipment, route, inclusions, and quote validity.", "https://www.dsv.com/en/our-solutions/modes-of-transport/road-transport", "verify"),
    provider(`${movement.origin.id}-${legId}-road-network`, "Qualified carrier from the awarded TMS or broker network", "Lane-specific road capacity", `Return live capacity and a complete quote from ${from} to ${to}.`, "Verify authority in each operating jurisdiction, insurance, equipment, subcontractors, schedule, and accessorials.", "connection://road-carrier-network"),
  ];
  const maerskService = /Shenzhen|Yantian/i.test(source) && /Los Angeles/i.test(receiving)
    ? "TP6 candidate via Yantian to Los Angeles"
    : "FCL carrier service to verify";
  const oceanProviders = [
    provider(`${movement.origin.id}-dhl-ocean`, "DHL Global Forwarding", "DHL Ocean Freight FCL port-to-port coordination", `Return an itemized FCL offer from ${origin} to ${receiving}, naming the ocean carrier, service string, voyage, terminals, port-to-port charges, free time, quote ID, and expiry. Exclude pickup, terminal handling, drayage, inland transport, and final delivery, or state any bundled charge separately.`, "DHL is the forwarder, not the vessel operator. Verify every subcontracted carrier, included charge, service commitment, and booking acceptance.", "https://www.dhl.com/gb-en/home/global-forwarding/products-and-solutions/ocean-freight/full-container-load.html", "verify"),
    provider(`${movement.origin.id}-maersk`, "Maersk", maerskService, `Return a bookable 40HC service from ${origin} to ${receiving}, including cutoff, free time, validity, and capacity.`, "TP6 is a published candidate only when the route matches. Verify exact loop, vessel, transshipment, schedule reliability, inclusions, and capacity from the callback.", EVIDENCE.maersk.url),
    provider(`${movement.origin.id}-cma`, "CMA CGM", "FCL vessel schedule and rate candidate", `Return a bookable 40HC route from ${origin} to ${receiving}.`, "Verify exact service identity, cutoff, transshipment, rate validity, free time, and capacity.", EVIDENCE.cma.url),
    provider(`${movement.origin.id}-hapag`, "Hapag-Lloyd", "FCL operational schedule candidate", `Return a bookable 40HC route from ${origin} to ${receiving}.`, "Verify operational schedule, exact service, rate, validity, free time, and capacity.", EVIDENCE.hapag.url),
  ];
  const airProviders = [
    provider(`${movement.origin.id}-dhl-air`, "DHL Global Forwarding", "DHL Air Freight airport-to-airport coordination", `Return an itemized airport-to-airport linehaul only offer from ${origin} to ${receiving}, including operating airline, service level, flight routing, chargeable weight, cutoffs, security surcharges, quote ID, and expiry. Exclude pickup, origin warehouse handling, destination breakdown, handling and storage, customs, and final recovery. State any mandatory bundled charge separately so it can replace, not duplicate, another leg.`, "Verify the operating airline, routing, capacity, cargo acceptance, screening, included charges, and service commitment.", "https://www.dhl.com/global-en/home/our-divisions/global-forwarding/air-freight.html", "verify"),
    provider(`${movement.origin.id}-kn-air`, "Kuehne+Nagel", "Air Logistics service candidate", `Return a bookable airport-to-airport linehaul only offer from ${origin} to ${receiving}, including service level, routing, chargeable weight, cutoffs, validity, and capacity. Exclude pickup, origin warehouse handling, destination breakdown, handling and storage, customs, and final recovery. State any mandatory bundled charge separately so it can replace, not duplicate, another leg.`, "Verify the operating airline, service identity, capacity, cargo acceptance, inclusions, and quote validity.", "https://home.kuehne-nagel.com/en/services/air-freight", "verify"),
    provider(`${movement.origin.id}-dsv-air`, "DSV Air Freight", "Air-freight service candidate", `Return a bookable airport-to-airport linehaul only offer from ${origin} to ${receiving}, including service level, routing, chargeable weight, cutoffs, validity, and capacity. Exclude pickup, origin warehouse handling, destination breakdown, handling and storage, customs, and final recovery. State any mandatory bundled charge separately so it can replace, not duplicate, another leg.`, "Verify the operating airline, service identity, capacity, cargo acceptance, inclusions, and quote validity.", "https://www.dsv.com/en/our-solutions/modes-of-transport/air-freight", "verify"),
  ];

  legs.push({
    sequence: sequence++, id: `${movement.origin.id}-pickup`, segmentIds: segment("Supplier pickup"), type: "origin_pickup", from: source, to: origin, mode: "Road pickup",
    instruction: oceanImport
      ? "Book supplier pickup against the cargo-ready date and terminal cutoff, with equipment and loading responsibility confirmed."
      : airImport
        ? "Book supplier pickup against the cargo-ready date and air-cargo warehouse cutoff, with packaging, screening readiness, and loading responsibility confirmed."
      : "Book supplier pickup against the cargo-ready date and linehaul handoff, with equipment and loading responsibility confirmed.",
    providers: [
      provider(`${movement.origin.id}-dhl-origin`, "DHL Global Forwarding", "Origin pickup and forwarding candidate", `Quote pickup from ${source} to ${origin}.`, "Confirm local operating entity, equipment, pickup window, scope, inclusions, and validity.", "https://www.dhl.com/global-en/home/our-divisions/global-forwarding.html", "verify"),
      provider(`${movement.origin.id}-dsv-origin`, "DSV", "Origin haulage and forwarding candidate", `Quote pickup from ${source} to ${origin}.`, "Confirm equipment, cargo acceptance, handoff, inclusions, and validity.", "https://www.dsv.com/en/our-solutions/modes-of-transport/road-transport", "verify"),
    ],
    transitAssumption: "1 to 3 days after confirmed cargo readiness",
    costRange: canModelCost ? modeledCost(350, 950, oceanImport ? "Modeled origin pickup for one 40HC" : airImport ? "Modeled pickup for one air-freight consignment" : "Modeled full-load origin pickup") : null,
    quoteInputs: ["Pickup address", "Cargo-ready date and hours", "Package count, dimensions, weight", "Loading equipment and appointment rules"],
    handoff: "Loaded equipment accepted at origin gateway", status: "connection_required",
  });

  if (oceanImport || airImport) {
    legs.push({
      sequence: sequence++, id: `${movement.origin.id}-origin-handling`, segmentIds: [], type: "origin_handling", from: origin, to: origin, mode: airImport ? "Export and air-cargo handling" : "Export and terminal handling",
      instruction: airImport
        ? "Confirm export filing responsibility, cargo acceptance, security screening, warehouse cutoff, chargeable weight, and included origin handling."
        : "Confirm export filing responsibility, documentation cutoff, terminal receiving window, verified gross mass, and included origin charges.",
      providers: [provider(`${movement.origin.id}-dhl-export`, "DHL Global Forwarding", airImport ? "Air export and origin handling" : "Export forwarding and origin handling", `Quote export handling at ${origin} with every origin charge itemized.`, "Confirm filing authority, handling facility, carrier service, cutoff, cargo acceptance, and excluded charges.", "https://www.dhl.com/global-en/home/our-divisions/global-forwarding.html", "verify")],
      transitAssumption: airImport ? "1 to 2 days before flight departure" : "1 to 4 days before vessel departure",
      costRange: canModelCost ? modeledCost(airImport ? 250 : 450, airImport ? 750 : 950, airImport ? "Modeled air export and origin handling charges" : "Modeled export documentation and origin terminal charges") : null,
      quoteInputs: ["Exporter legal name", "Commercial invoice and packing list", "Export-control status", airImport ? "Dimensions, actual weight, and chargeable weight" : "Verified gross mass"],
      handoff: "Carrier acceptance and export release", status: "connection_required",
    });
  }

  const crossBorderFrom = crossBorderRoad ? `${origin} export side` : origin;
  const crossBorderTo = crossBorderRoad ? `${receiving} import side` : receiving;
  const linehaulType: SupplyExecutionLeg["type"] = scope === "domestic" || scope === "intra_eu" ? "domestic_linehaul" : "international_linehaul";
  const linehaulCost = oceanImport
    ? modeledCost(2800, 6200, "Modeled ocean FCL linehaul for one 40HC")
    : airImport
      ? modeledCost(2500, 9500, "Modeled air-freight linehaul pending confirmed chargeable weight")
    : crossBorderRoad
      ? modeledCost(600, 1800, "Modeled border transfer and cross-border road leg")
      : modeledCost(900, 4200, "Modeled domestic or intra-EU full-load linehaul");
  legs.push({
    sequence: sequence++, id: `${movement.origin.id}-linehaul`, segmentIds: movement.segments.filter((item) => item.fromNodeId === movement.origin.id).map((item) => item.id),
    type: linehaulType, from: crossBorderFrom, to: crossBorderTo,
    mode: oceanImport ? "Ocean FCL" : airImport ? "Air freight" : crossBorderRoad ? "Cross-border truck" : scope === "unknown" ? "Mode to confirm" : "Road or rail to confirm",
    instruction: oceanImport
      ? "Compare bookable carrier services on delivered cost, not the base ocean rate."
      : airImport
        ? "Compare bookable air services on delivered cost, chargeable weight, routing, cutoff, cargo acceptance, and recovery time."
      : crossBorderRoad
        ? "Tender the border transfer with the crossing, customs handoff, transfer model, and import-side carrier stated."
        : "Tender a lane-specific road or rail move with equipment, handoffs, delivery terminal, and accessorials stated.",
    providers: oceanImport
      ? oceanProviders
      : airImport
        ? airProviders
      : crossBorderRoad
        ? [
            provider(`${movement.origin.id}-dhl-road`, "DHL Global Forwarding", "Cross-border road forwarding", `Quote the transfer from ${crossBorderFrom} to ${crossBorderTo}.`, "Verify carrier authority on both sides, equipment, crossing, transfer model, insurance, schedule, and all-in price.", "https://www.dhl.com/global-en/home/our-divisions/global-forwarding.html", "verify"),
            ...roadProvidersForLeg("cross-border-linehaul", crossBorderFrom, crossBorderTo),
          ]
        : roadProvidersForLeg("linehaul", crossBorderFrom, crossBorderTo),
    transitAssumption: oceanImport ? "16 to 40 days port to port, route dependent" : airImport ? "2 to 7 days airport to airport, service dependent" : crossBorderRoad ? "Same day to 2 days at the border without holds" : "1 to 9 days, lane dependent",
    costRange: canModelCost ? linehaulCost : null,
    quoteInputs: oceanImport
      ? ["Exact origin and destination terminals", "Cargo-ready date", "Commodity and HS-6 candidates", "Weight", "Required free time"]
      : airImport
        ? ["Exact origin and destination air-cargo gateways", "Cargo-ready date", "Commodity and HS-6 candidates", "Package dimensions", "Actual and chargeable weight", "Service level"]
      : ["Exact handoff locations", "Cargo-ready date", "Commodity", "Weight", "Equipment", "Delivery requirement"],
    handoff: oceanImport ? "Arrival at receiving gateway" : airImport ? "Air cargo available at receiving gateway" : crossBorderRoad ? "Freight accepted on the import side of the crossing" : "Freight at destination delivery terminal",
    status: "connection_required",
  });

  if (scope === "import") {
    legs.push({
      sequence: sequence++, id: `${movement.origin.id}-clearance`, segmentIds: segment("Customs entry"), type: "border_clearance", from: crossBorderRoad ? crossBorderTo : receiving, to: movement.customs?.label ?? receiving, mode: crossBorderRoad ? "Land-border customs entry" : "Customs entry",
      instruction: "Pre-clear through the licensed broker using the approved source-fact packet. Continue only after a real release response.",
      providers: brokerOptions(movement).map((item) => provider(`${item.id}-provider`, item.firm, item.service, "Return acceptance, document gaps, entry fee, agency scope, and response SLA.", item.qualificationChecks.join("; "), item.url, "verify")),
      transitAssumption: "Pre-arrival filing targeted; holds and exams are not modeled",
      costRange: canModelCost ? modeledCost(175, 550, "Modeled routine brokerage fee only") : null,
      quoteInputs: ["Importer and direct broker authorization", "Bond or guarantee", "Approved classification", "Invoice and packing list", "Agency and admissibility facts"],
      handoff: "Customs and agency release reference", status: "verify",
    });
  }

  if (airImport) {
    legs.push(
      {
        sequence: sequence++, id: `${movement.origin.id}-air-destination-handling`, segmentIds: [], type: "destination_handling", from: receiving, to: receiving, mode: "Air-cargo terminal handling",
        instruction: "Track flight arrival, breakdown, availability, holds, storage clock, release, and pickup eligibility as separate gates.",
        providers: [provider(`${movement.origin.id}-air-terminal-feed`, receiving, "Air-cargo availability feed", `Return flight arrival, breakdown, availability, holds, storage clock, release, and pickup state at ${receiving}.`, "Verify facility identity, shipment identity, source timestamp, event semantics, and release authority.", "connection://air-cargo-terminal-feed")],
        transitAssumption: "Same day to 2 days without holds or storage delay", costRange: canModelCost ? modeledCost(250, 900, "Modeled destination air-cargo handling charges") : null,
        quoteInputs: ["Air waybill", "Operating flight", "Handling facility", "Storage terms", "Release reference"], handoff: "Released cargo available for recovery", status: "connection_required",
      },
      {
        sequence: sequence++, id: `${movement.origin.id}-air-final`, segmentIds: segment("Inland delivery"), type: "last_mile", from: receiving, to: destination, mode: "Airport recovery and appointment delivery",
        instruction: "Tender airport recovery and final delivery only after customs release, cargo availability, receiver hours, equipment, and proof-of-delivery rules are confirmed.",
        providers: roadProvidersForLeg("air-final", receiving, destination),
        transitAssumption: "Same day to 2 days after release and availability", costRange: canModelCost ? modeledCost(450, 1800, "Modeled air-gateway recovery and final delivery") : null,
        quoteInputs: ["Handling facility", "Release and availability", "Package count, dimensions, and weight", "Delivery address and appointment", "Equipment and proof-of-delivery rules"], handoff: "Signed proof of delivery", status: "connection_required",
      },
    );
  } else if (oceanImport) {
    const originHandoff = `Transload or inland ramp near ${receiving}`;
    const destinationHandoff = `Destination freight terminal near ${destination}`;
    const portLocalDelivery = isPortLocalDelivery(receiving, destination);
    const finalMileHandoff = portLocalDelivery ? originHandoff : destinationHandoff;
    const destinationHandlingProviders = /Los Angeles and Long Beach/i.test(receiving)
      ? [provider(`${movement.origin.id}-port-optimizer-provider`, "Port Optimizer", "Port and terminal event feed", "Return vessel, discharge, availability, and terminal events for the booked unit.", "Accept events only from the provisioned source and retain provider timestamps.", EVIDENCE.portOptimizer.url)]
      : [provider(`${movement.origin.id}-terminal-feed`, receiving, "Terminal availability feed", "Return discharge, availability, holds, last free day, and appointment state.", "Verify terminal identity, source timestamp, container identity, and event semantics.", "connection://port-terminal-feed")];
    const drayageProviders = usDestination
      ? [
          provider(`${movement.origin.id}-dray-alliance`, "Dray Alliance carrier network", "API-based drayage quote", `Quote recovery from ${receiving} to ${originHandoff}, including chassis, fuel, pre-pull, wait, storage, and detention terms.`, "Verify the awarded motor carrier in FMCSA, plus insurance and terminal access.", EVIDENCE.drayAlliance.url),
          provider(`${movement.origin.id}-imc`, "IMC Logistics", `Port drayage candidate at ${receiving}`, `Return terminal coverage, appointment capacity, chassis plan, and quote to ${originHandoff}.`, "Verify exact operating entity, FMCSA authority, insurance, terminal access, and dispatch capacity.", "https://www.imccompanies.com/", "verify"),
          provider(`${movement.origin.id}-roadone`, "RoadOne IntermodaLogistics", `Port and intermodal drayage candidate at ${receiving}`, `Return recovery capacity, equipment plan, and quote to ${originHandoff}.`, "Verify exact operating entity, FMCSA authority, insurance, terminal access, and dispatch capacity.", "https://www.roadone.com/", "verify"),
        ]
      : [
          provider(`${movement.origin.id}-dsv-dray`, "DSV", `Destination port haulage candidate at ${receiving}`, `Return terminal coverage, recovery capacity, equipment plan, and quote to ${originHandoff}.`, "Verify the local operating entity, authority, insurance, terminal access, and dispatch capacity.", "https://www.dsv.com/en/our-solutions/modes-of-transport/road-transport", "verify"),
          provider(`${movement.origin.id}-local-dray`, "Qualified destination drayage carrier", `Port recovery at ${receiving}`, `Return live capacity and a complete quote to ${originHandoff}.`, "Verify authority in the destination jurisdiction, insurance, terminal access, equipment, and dispatch capacity.", "connection://destination-drayage-network"),
        ];
    const inlandProviders = usDestination
      ? [
          provider(`${movement.origin.id}-jb-hunt`, "J.B. Hunt Intermodal", "Hub-to-hub inland intermodal candidate", `Quote inland transport from ${originHandoff} to ${destinationHandoff}, excluding final delivery.`, "Verify ramp pair, schedule, equipment, accessorials, and exact terminal handoff.", "https://www.jbhunt.com/our-services/intermodal", "verify"),
          provider(`${movement.origin.id}-schneider`, "Schneider", "Hub-to-hub intermodal or truckload candidate", `Quote inland transport from ${originHandoff} to ${destinationHandoff}, excluding final delivery.`, "Verify mode, operating authority, equipment, transit, accessorials, and exact terminal handoff.", "https://schneider.com/freight-shipping-solutions/intermodal", "verify"),
        ]
      : [
          provider(`${movement.origin.id}-dsv-inland`, "DSV Road", "Destination inland linehaul candidate", `Quote inland transport from ${originHandoff} to ${destinationHandoff}, excluding final delivery.`, "Verify local operating entity, authority, equipment, transit, accessorials, and exact terminal handoff.", "https://www.dsv.com/en/our-solutions/modes-of-transport/road-transport", "verify"),
          provider(`${movement.origin.id}-dhl-inland`, "DHL Global Forwarding", "Destination inland coordination candidate", `Quote inland transport from ${originHandoff} to ${destinationHandoff}, excluding final delivery.`, "Verify the operating carrier, jurisdiction authority, equipment, transit, accessorials, and terminal handoff.", "https://www.dhl.com/global-en/home/our-divisions/global-forwarding.html", "verify"),
        ];
    legs.push(
      {
        sequence: sequence++, id: `${movement.origin.id}-destination-handling`, segmentIds: [], type: "destination_handling", from: receiving, to: receiving, mode: "Terminal handling",
        instruction: "Track discharge, availability, holds, last free day, appointment eligibility, and required terminal payment as separate gates.", providers: destinationHandlingProviders,
        transitAssumption: "1 to 5 days without holds or congestion", costRange: canModelCost ? modeledCost(650, 1450, "Modeled destination terminal and documentation charges") : null,
        quoteInputs: ["Booked terminal and vessel", "Container number", "Carrier free time", "Terminal fee schedule"], handoff: "Available container inside free time", status: "connection_required",
      },
      {
        sequence: sequence++, id: `${movement.origin.id}-drayage`, segmentIds: [], type: "drayage", from: receiving, to: originHandoff, mode: "Port drayage",
        instruction: "Tender port recovery to the first inland handoff only. A direct port-to-door alternative must replace, not duplicate, the inland and final-mile legs.", providers: drayageProviders,
        transitAssumption: "Same day to 2 days after release and appointment", costRange: canModelCost ? modeledCost(550, 1650, "Modeled port-to-handoff drayage only") : null,
        quoteInputs: ["Terminal", "Container and chassis type", "Availability and last free day", "Handoff address", "Live load, drop, or transload"], handoff: `Container accepted at ${originHandoff}`, status: "connection_required",
      },
    );
    if (!portLocalDelivery) {
      legs.push({
        sequence: sequence++, id: `${movement.origin.id}-inland`, segmentIds: segment("Inland delivery"), type: "inland_transport", from: originHandoff, to: destinationHandoff, mode: "Hub-to-hub rail or truck",
        instruction: "Price only the hub-to-hub inland leg. Keep final delivery separate so the same miles are not charged twice.", providers: inlandProviders,
        transitAssumption: "2 to 9 days, gateway and destination dependent", costRange: canModelCost ? modeledCost(900, 5200, "Modeled hub-to-hub inland move") : null,
        quoteInputs: ["Origin handoff", "Destination handoff", "Weight", "Equipment", "Required delivery-terminal date"], handoff: `Freight available at ${destinationHandoff}`, status: "connection_required",
      });
    }
    legs.push({
      sequence: sequence++, id: `${movement.origin.id}-last-mile`, segmentIds: segment("Inland delivery"), type: "last_mile", from: finalMileHandoff, to: destination, mode: "Appointment delivery",
      instruction: "Schedule only the final terminal-to-door delivery after the receiver confirms address, hours, equipment, unloading, and proof-of-delivery rules.",
      providers: [
        provider(`${movement.origin.id}-dsv-final`, "DSV Road", "Final-mile freight delivery candidate", `Quote scheduled delivery from ${finalMileHandoff} to ${destination}.`, "Verify local operating carrier, authority, insurance, equipment, appointment, and accessorials.", "https://www.dsv.com/en/our-solutions/modes-of-transport/road-transport", "verify"),
        provider(`${movement.origin.id}-local-final`, "Qualified local carrier from the awarded TMS or broker network", "Terminal-to-door appointment delivery", `Return live capacity and a final-mile quote from ${finalMileHandoff} to ${destination}.`, usDestination ? "Verify FMCSA authority, insurance, equipment, appointment acceptance, and proof-of-delivery process." : "Verify local authority, insurance, equipment, appointment acceptance, and proof-of-delivery process.", usDestination ? EVIDENCE.fmcsa.url : "connection://destination-carrier-authority"),
      ],
      transitAssumption: "Same day to 2 days after local availability", costRange: canModelCost ? modeledCost(450, 1800, "Modeled terminal-to-door final-mile delivery") : null,
      quoteInputs: ["Exact delivery address", "Appointment window", "Equipment and unloading", "Contact and proof-of-delivery rules"], handoff: "Signed proof of delivery and equipment disposition", status: "connection_required",
    });
  } else if (crossBorderRoad) {
    const destinationHandoff = `Destination freight terminal near ${destination}`;
    legs.push(
      {
        sequence: sequence++, id: `${movement.origin.id}-cross-border-inland`, segmentIds: segment("Inland delivery"), type: "inland_transport", from: crossBorderTo, to: destinationHandoff, mode: "Import-side truck or intermodal",
        instruction: "Tender the import-side linehaul from the released crossing handoff to a named destination terminal, excluding final delivery.", providers: roadProvidersForLeg("cross-border-inland", crossBorderTo, destinationHandoff),
        transitAssumption: "1 to 7 days after customs release", costRange: canModelCost ? modeledCost(1400, 4200, "Modeled import-side hub-to-hub linehaul") : null,
        quoteInputs: ["Released border handoff", "Destination terminal", "Weight", "Equipment", "Required arrival date"], handoff: `Freight available at ${destinationHandoff}`, status: "connection_required",
      },
      {
        sequence: sequence++, id: `${movement.origin.id}-cross-border-final`, segmentIds: segment("Inland delivery"), type: "last_mile", from: destinationHandoff, to: destination, mode: "Appointment delivery",
        instruction: "Schedule the destination terminal-to-door delivery and retain proof of delivery.", providers: roadProvidersForLeg("cross-border-final", destinationHandoff, destination),
        transitAssumption: "Same day to 2 days after local availability", costRange: canModelCost ? modeledCost(350, 1200, "Modeled terminal-to-door final-mile delivery") : null,
        quoteInputs: ["Exact delivery address", "Appointment window", "Equipment and unloading", "Proof-of-delivery rules"], handoff: "Signed proof of delivery", status: "connection_required",
      },
    );
  } else if (scope === "domestic" || scope === "intra_eu") {
    legs.push({
      sequence: sequence++, id: `${movement.origin.id}-domestic-final`, segmentIds: segment("Domestic delivery"), type: "last_mile", from: receiving, to: destination, mode: "Appointment delivery",
      instruction: "Schedule the receiving-terminal-to-door delivery with equipment, unloading, appointment, and proof-of-delivery rules confirmed.", providers: roadProvidersForLeg("domestic-final", receiving, destination),
      transitAssumption: "Same day to 2 days after local availability", costRange: canModelCost ? modeledCost(350, 1500, "Modeled receiving-terminal-to-door delivery") : null,
      quoteInputs: ["Exact delivery address", "Appointment window", "Equipment and unloading", "Proof-of-delivery rules"], handoff: "Signed proof of delivery", status: "connection_required",
    });
  }

  const priced = legs.flatMap((leg) => leg.costRange ? [leg.costRange] : []);
  const total = canModelCost && priced.length === legs.length
    ? modeledCost(
        priced.reduce((sum, cost) => sum + cost.low, 0),
        priced.reduce((sum, cost) => sum + cost.high, 0),
        "Sum of non-overlapping modeled leg ranges for one movement. This is a planning envelope, not an authenticated quote.",
      )
    : null;
  return {
    scenario: known ? { ...movementScenario } : null,
    legs,
    total,
    totalLabel: total
      ? "Modeled non-overlapping door-to-door planning envelope, duties and taxes excluded"
      : baseScenario.status === "verify"
        ? "Numeric total withheld until dangerous-goods classification and carrier acceptance are confirmed"
        : known
          ? "Numeric total withheld until this movement has a complete pricing scenario"
          : "Numeric total withheld until source, gateway, and destination geography are known",
    status: !known || baseScenario.status === "verify" ? "verify" : "connection_required",
  };
}

function quoteBlockers(dashboard: SupplyCaseDashboard, movement: ResolvedMovement, known: boolean): SupplyQuoteBlocker[] {
  const blockers: SupplyQuoteBlocker[] = [
    { id: `${movement.origin.id}-blocker-addresses`, field: "Exact pickup and delivery addresses", reason: "Required for origin, drayage, inland, accessorial, and appointment pricing.", owner: "shipper", status: "verify" },
    { id: `${movement.origin.id}-blocker-ready-date`, field: "Cargo-ready date and required delivery date", reason: "Required to return real services, cutoffs, capacity, and rate validity.", owner: "supplier", status: "verify" },
    { id: `${movement.origin.id}-blocker-cargo`, field: "Package count, dimensions, net weight, and gross weight", reason: "Required to validate the planned equipment, payload, handling, and capacity request.", owner: "supplier", status: "verify" },
    { id: `${movement.origin.id}-blocker-value`, field: "Commercial value, currency, and Incoterm", reason: "Required for customs valuation, charge ownership, insurance, and landed-cost work.", owner: "shipper", status: "verify" },
    { id: `${movement.origin.id}-blocker-classification`, field: "Technical description, material, use, and origin", reason: "Required for HS-6 research and licensed-broker destination classification approval.", owner: "licensed_broker", status: "verify" },
  ];
  if (!known) {
    blockers.unshift({
      id: `${movement.origin.id}-blocker-geography`, field: "Resolvable source and destination geography",
      reason: "Port selection and numeric cost totals would be fabricated without exact route geography.", owner: "shipper", status: "verify",
    });
  }
  if (dashboard.sourcingNeeds.length > 1 && dashboard.sourceRegions.length > 1) {
    blockers.push({
      id: `${movement.origin.id}-blocker-source-allocation`, field: "Commodity assigned to this source",
      reason: "The prompt lists several commodities and source regions but does not prove which item belongs to this movement.", owner: "shipper", status: "verify",
    });
  }
  if (hasUnresolvedDangerousGoods(dashboard)) {
    blockers.push({
      id: `${movement.origin.id}-blocker-dangerous-goods`, field: "Current SDS and transport classification",
      reason: "The standard non-hazardous scenario cannot be used until UN number, hazard class, packing group, and carrier acceptance are confirmed.", owner: "supplier", status: "verify",
    });
  }
  return blockers;
}

function evidenceForMovement(
  movement: ResolvedMovement,
  scope: SupplyMovementScope,
  ports: readonly SupplyPortOption[],
): SupplyEvidenceRef[] {
  const ids = new Set<string>(ports.flatMap((port) => port.evidenceRefIds));
  const linehaul = movement.segments.find((segment) => segment.fromNodeId === movement.origin.id);
  const oceanImport = scope === "import" && linehaul?.label !== "Cross-border road freight" && linehaul?.mode !== "air";
  const usDestination = isUnitedStatesDestination(movement.destination?.label);
  if (oceanImport) {
    ids.add(EVIDENCE.maersk.id);
    ids.add(EVIDENCE.cma.id);
    ids.add(EVIDENCE.hapag.id);
  }
  if (usDestination) ids.add(EVIDENCE.fmcsa.id);
  if (oceanImport && usDestination) {
    ids.add(EVIDENCE.drayAlliance.id);
    ids.add(EVIDENCE.portPro.id);
  }
  if (/Los Angeles and Long Beach/i.test(movement.receiving?.label ?? "")) {
    ids.add(EVIDENCE.portOptimizer.id);
    ids.add(EVIDENCE.polbTrack.id);
    ids.add(EVIDENCE.apmTerminal.id);
  }
  if (scope === "import") {
    ids.add(EVIDENCE.screening.id);
    if (isUnitedStatesDestination(movement.destination?.label)) {
      ids.add(EVIDENCE.cbpInvoice.id);
      ids.add(EVIDENCE.cbpBrokers.id);
      ids.add(EVIDENCE.cbpClassificationBoundary.id);
    }
  }
  return Object.values(EVIDENCE).filter((ref) => ids.has(ref.id));
}

export function buildSupplyOperatingPlan(dashboard: SupplyCaseDashboard): SupplyOperatingPlan {
  const origins = dashboard.route.nodes.filter((node) => node.kind === "origin_gateway");
  const scenario = scenarioForDashboard(dashboard);
  const movements = origins.map((origin): SupplyMovementPlan => {
    const resolved = findMovement(dashboard, origin);
    const scope = movementScope(resolved);
    const geographyKnown = hasKnownGeography(resolved);
    const ports = portOptions(resolved, scope, geographyKnown);
    const execution = executionPlan(resolved, scope, geographyKnown, scenario);
    return {
      movementId: `movement-${origin.id}`,
      source: endpoint(resolved.source),
      originGateway: endpoint(resolved.origin) as SupplyMovementEndpoint,
      receivingGateway: endpoint(resolved.receiving),
      customsNode: endpoint(resolved.customs, "verify"),
      destination: endpoint(resolved.destination),
      scope,
      geographyKnown,
      pathSegmentIds: [...new Set(resolved.segments.map((segment) => segment.id))],
      portOptions: ports,
      intelligenceChecks: intelligenceChecks(dashboard, resolved, scope),
      customsPlan: customsPlan(resolved, scope, ports),
      executionPlan: execution,
      quoteBlockers: quoteBlockers(dashboard, resolved, geographyKnown),
      evidenceRefs: evidenceForMovement(resolved, scope, ports),
      status: !geographyKnown || scenario.status === "verify" ? "verify" : "connection_required",
    };
  });
  return {
    schemaVersion: 1,
    caseId: dashboard.id,
    generatedAt: dashboard.generatedAt,
    scenario: { ...scenario },
    customsConnectors: [...SUPPLY_CUSTOMS_CONNECTORS]
      .sort((left, right) => {
        const order = ["zonos", "digicust", "descartes-customsinfo", "customs4trade", "avalara", "raft", "klearnow"];
        return order.indexOf(left.id) - order.indexOf(right.id);
      })
      .map((connector) => ({ ...connector })),
    movements,
    status: movements.length === 0
      ? "verify"
      : movements.some((movement) => movement.status === "verify")
      ? "verify"
      : movements.some((movement) => movement.status === "connection_required")
        ? "connection_required"
        : "modeled",
  };
}
