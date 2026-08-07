import type {
  SupplyCaseDashboard,
  SupplyCoordinate,
  SupplyResearchClaim,
} from "./supply-os-case-model";

export type SupplyOptimizationBasis = "official" | "public" | "customer_stated" | "inferred";
export type SupplyOptimizationConfidence = "high" | "medium" | "low";
export type SupplyOptimizationWorkstreamId =
  | "procurement"
  | "supplier_outreach"
  | "shipment_planning"
  | "customs"
  | "fulfillment";

export type SupplyOptimizationNode = {
  id: string;
  sequence: number;
  kind: "supplier_cluster" | "processing_site" | "distribution" | "customer_cluster";
  label: string;
  location: string;
  coordinates: SupplyCoordinate | null;
  basis: SupplyOptimizationBasis;
  confidence: SupplyOptimizationConfidence;
  detail: string;
  cargo: string;
  confirmNext: string;
  qualificationTargets: SupplyOptimizationTarget[];
};

export type SupplyOptimizationTarget = {
  name: string;
  fit: string;
  url?: string;
};

export type SupplyOptimizationEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  stage: "inbound" | "processing" | "outbound";
  mode: string;
  cargo: string;
  basis: "customer_stated" | "inferred";
  confidence: SupplyOptimizationConfidence;
  detail: string;
};

export type SupplyOptimizationAction = {
  id: string;
  priority: number;
  workstreamId: SupplyOptimizationWorkstreamId;
  title: string;
  currentCondition: string;
  recommendation: string;
  decision: string;
  requiredInput: string;
};

export type SupplyOptimizationWorkspace = {
  id: SupplyOptimizationWorkstreamId;
  label: string;
  shortLabel: string;
  description: string;
  route: string;
};

export type SupplyOptimizationModel = {
  profile: string;
  networkSummary: string;
  nodes: SupplyOptimizationNode[];
  edges: SupplyOptimizationEdge[];
  actions: SupplyOptimizationAction[];
  workspaces: SupplyOptimizationWorkspace[];
  customerSegments: string[];
  assumptions: string[];
};

type Cluster = {
  label: string;
  location: string;
  coordinates: SupplyCoordinate;
  detail: string;
  cargo: string;
  mode: string;
  confidence: SupplyOptimizationConfidence;
  confirmNext: string;
  qualificationTargets?: SupplyOptimizationTarget[];
};

type OptimizationProfile = {
  id: "metals" | "robotics" | "additive" | "aerospace" | "medical" | "chemicals" | "automotive" | "industrial";
  label: string;
  facilityActivity: string;
  sourceClusters: Cluster[];
  customerClusters: Cluster[];
  customerSegments: string[];
};

export const SUPPLY_OPTIMIZATION_WORKSPACES: SupplyOptimizationWorkspace[] = [
  {
    id: "procurement",
    label: "Procurement and supplier selection",
    shortLabel: "Procurement",
    description: "Build the source market, compare landed cost, qualify alternates, and return supplier awards for approval.",
    route: "/dashboard/supply-os/workstreams/procurement",
  },
  {
    id: "supplier_outreach",
    label: "Supplier contact and readiness",
    shortLabel: "Supplier contact",
    description: "Run quote requests, production follow-ups, document collection, and cargo-ready confirmation.",
    route: "/dashboard/supply-os/workstreams/supplier-outreach",
  },
  {
    id: "shipment_planning",
    label: "Shipment planning and execution",
    shortLabel: "Shipments",
    description: "Compare modes and providers, consolidate releases, tender one scope, and manage every handoff.",
    route: "/dashboard/supply-os/workstreams/shipment-planning",
  },
  {
    id: "customs",
    label: "Customs scope and broker coordination",
    shortLabel: "Customs",
    description: "Build the product and transaction packet, compare brokers, close document gaps, and coordinate release.",
    route: "/dashboard/supply-os/workstreams/customs",
  },
  {
    id: "fulfillment",
    label: "Fulfillment, 3PL, and final delivery",
    shortLabel: "Fulfillment / 3PL",
    description: "Select the right storage and delivery model, coordinate appointments, and retain proof of delivery.",
    route: "/dashboard/supply-os/workstreams/fulfillment",
  },
];

const PROFILES: OptimizationProfile[] = [
  {
    id: "metals",
    label: "Metals service center and processor",
    facilityActivity: "Inventory, receive mill stock, cut material to size, retain certifications, and release customer orders",
    sourceClusters: [
      {
        label: "Domestic aerospace plate mills",
        location: "Iowa, West Virginia, and Washington",
        coordinates: { latitude: 40.6, longitude: -94.7 },
        detail: "NOX stocks 7050, 7075, 6061, and heavy 5000-series plate. The closest product-capability match starts with U.S. rolling mills that publicly make aerospace, defense, and industrial plate, but actual mill approvals and allocations are not public.",
        cargo: "Mill-certified 7050, 7075, 6061, and 5000-series plate",
        mode: "Flatbed, dedicated truck, or scheduled LTL",
        confidence: "medium",
        confirmNext: "Match every alloy, temper, thickness, and domestic-origin promise to the approved mill, allocation, minimum order, lead time, and inbound lane.",
        qualificationTargets: [
          {
            name: "Arconic Davenport Works",
            fit: "Iowa mill producing aluminum sheet and plate for aerospace, automotive, and industrial applications.",
            url: "https://www.arconic.com/about-us/-/asset_publisher/qkwp/content/arconic-celebrates-commissioning-of-57.5-million-project-to-expand-high-purity-aluminum-production-for-defense-aerospace-applications",
          },
          {
            name: "Constellium Ravenswood",
            fit: "West Virginia rolled-products facility producing aerospace, defense, marine, transportation, and industrial plate.",
            url: "https://www.constellium.com/locations/ravenswood",
          },
          {
            name: "Kaiser Aluminum Trentwood",
            fit: "U.S. aerospace and general-engineering plate mill with public 7050 plate capability.",
            url: "https://www.kaiseraluminum.com/end-markets/aerospace-and-high-strength/",
          },
        ],
      },
      {
        label: "Great Lakes service-center buffer stock",
        location: "Ohio, Michigan, and Western Pennsylvania",
        coordinates: { latitude: 41.3139, longitude: -81.6851 },
        detail: "Regional service centers are plausible shortage-fill and low-volume sources when a direct mill release cannot protect NOX's next-day promise. They should be compared against direct-mill economics, cert traceability, and duplicate handling.",
        cargo: "Spot and buffer inventory in 6061, 7075, 7050, and 5000-series plate",
        mode: "Regional LTL, flatbed, or dedicated truck",
        confidence: "medium",
        confirmNext: "Identify which grades are bought mill-direct, which use distributor buffer stock, and where double-margin or extra handling erodes service-center economics.",
        qualificationTargets: [
          {
            name: "ICI Metals",
            fit: "Ohio supplier publicly stocking 6061 and 7075 plate for Midwest manufacturers.",
            url: "https://www.icimetals.com/metals/aluminum-plate",
          },
          {
            name: "Yarde Metals",
            fit: "Service-center coverage for Ohio, Michigan, and Western Pennsylvania with aerospace plate capability.",
            url: "https://www.yarde.com/",
          },
          {
            name: "Samuel Service Center",
            fit: "North American service-center network listing 5000, 6061, 7050, and 7075 plate products.",
            url: "https://www.samuelservicecenter.com/en/service-center-products/aluminum",
          },
        ],
      },
      {
        label: "Southern Ontario cross-border supply",
        location: "Hamilton and Southern Ontario",
        coordinates: { latitude: 43.2557, longitude: -79.8711 },
        detail: "A nearby alternate market worth testing for grade availability and lead-time protection, subject to origin and import treatment.",
        cargo: "Aluminum plate, block, specialty stock, and certified mill material",
        mode: "Cross-border truck or LTL",
        confidence: "low",
        confirmNext: "Verify supplier capability, melt and cast origin, tariff exposure, broker setup, and delivered cost before using this path.",
        qualificationTargets: [
          {
            name: "Samuel Service Center Canada",
            fit: "Canadian service-center network with a published alloy range matching several NOX stock families.",
            url: "https://www.samuelservicecenter.com/en/service-center-products/aluminum",
          },
          {
            name: "Southern Ontario plate distributors",
            fit: "Emergency and alternate inventory pool to qualify only after origin, Section 232, broker, and delivered-cost review.",
          },
        ],
      },
    ],
    customerClusters: [
      {
        label: "Southeast Michigan production customers",
        location: "Detroit manufacturing corridor",
        coordinates: { latitude: 42.3314, longitude: -83.0458 },
        detail: "Likely demand from precision machining, mobility, automation, tooling, and tier suppliers that buy cut-to-size material on short lead times.",
        cargo: "Cut plate, remnants, stock releases, and replenishment orders",
        mode: "Local courier, dedicated truck, flatbed, or LTL",
        confidence: "medium",
        confirmNext: "Confirm the top customer industries, ship-to ZIP codes, order sizes, delivery windows, and unloading constraints.",
        qualificationTargets: [
          { name: "Michigan precision machine shops", fit: "Small and mid-sized buyers of cut plate that value instant quotes and next-day availability." },
          { name: "Tool-and-die and automation integrators", fit: "Buyers of 6061 and cast tool plate for fixtures, jigs, index tables, and prototypes." },
          { name: "Automotive and defense tier suppliers", fit: "Programs that require cert packages, traceability, scheduled replenishment, and reliable delivery." },
        ],
      },
      {
        label: "National aerospace, defense, and new-space buyers",
        location: "United States aerospace and advanced-manufacturing markets",
        coordinates: { latitude: 39.8283, longitude: -98.5795 },
        detail: "NOX publishes nationwide shipping, DFARS and domestic options, mill certs, full traceability, and deep 7050/7075 coverage. That product and compliance posture points to national aerospace, defense, satellite, launch, and advanced-manufacturing demand.",
        cargo: "Certified cut-to-size aerospace plate, thick-section stock, tooling material, and replenishment orders",
        mode: "LTL, dedicated truck, flatbed, or expedited air for shortages",
        confidence: "medium",
        confirmNext: "Use CRM and order history to separate real national demand from target-market positioning, then identify recurring lanes, promised lead times, and cert requirements.",
        qualificationTargets: [
          { name: "Aerospace machine shops and contract manufacturers", fit: "Buyers machining 7050 and 7075 fittings, ribs, spars, tooling, and structural components." },
          { name: "Commercial launch and satellite manufacturers", fit: "New-space programs competing for high-strength plate and short production lead times." },
          { name: "Defense and UAS suppliers", fit: "Domestic programs where traceability, origin evidence, and resilient stock positions matter." },
        ],
      },
    ],
    customerSegments: [
      "Precision machine shops and tool-and-die suppliers",
      "Aerospace and defense manufacturing suppliers",
      "Automotive, mobility, and industrial automation manufacturers",
      "Prototype and low-volume hardware teams needing certified cut material",
    ],
  },
  {
    id: "robotics",
    label: "Robotics and industrial hardware manufacturer",
    facilityActivity: "Receive components, assemble and test systems, hold service parts, and release finished equipment",
    sourceClusters: [
      {
        label: "Pearl River Delta component supply",
        location: "Shenzhen and Dongguan, China",
        coordinates: { latitude: 22.5431, longitude: 114.0579 },
        detail: "A likely discovery market for motors, sensors, machine vision, cable assemblies, electronics, and contract manufacturing.",
        cargo: "Motors, sensors, electronics, cable assemblies, and machined components",
        mode: "Air freight for shortages, ocean consolidation for planned replenishment",
        confidence: "medium",
        confirmNext: "Map every critical BOM item to the actual supplier, production site, Incoterm, and approved alternate.",
      },
      {
        label: "North American industrial component supply",
        location: "Great Lakes manufacturing corridor",
        coordinates: { latitude: 41.8781, longitude: -87.6298 },
        detail: "A practical alternate market for machined structures, controls, enclosures, and urgent service components.",
        cargo: "Machined structures, controls, enclosures, and replacement parts",
        mode: "Parcel, LTL, or dedicated truck",
        confidence: "low",
        confirmNext: "Test capability, tooling ownership, certifications, lead time, and cost against the current BOM.",
      },
    ],
    customerClusters: [
      {
        label: "U.S. industrial deployment sites",
        location: "Midwest manufacturing markets",
        coordinates: { latitude: 40.0, longitude: -89.0 },
        detail: "Likely delivery to factories, warehouses, integrators, or construction sites where appointments and install sequencing matter.",
        cargo: "Robotic systems, cells, spares, batteries, and installation equipment",
        mode: "Dedicated truck, liftgate LTL, air for service parts",
        confidence: "medium",
        confirmNext: "Confirm ship-to sites, install dates, packaging, battery status, and on-site receiving capability.",
      },
    ],
    customerSegments: [
      "Factories and industrial automation teams",
      "Warehouses and fulfillment operators",
      "System integrators and deployment partners",
      "Service teams requiring urgent replacement parts",
    ],
  },
  {
    id: "additive",
    label: "Industrial additive-manufacturing company",
    facilityActivity: "Receive precision components, assemble and test machines, manage consumables, and deliver installed equipment",
    sourceClusters: [
      {
        label: "Asian motion-control and electronics supply",
        location: "Shenzhen, China and Taiwan",
        coordinates: { latitude: 23.5, longitude: 120.9 },
        detail: "A likely source market for motors, controllers, heaters, power electronics, displays, and machine subassemblies.",
        cargo: "Motion-control components, industrial electronics, heaters, and subassemblies",
        mode: "Air freight or consolidated ocean freight",
        confidence: "medium",
        confirmNext: "Resolve the actual supplier and country for each critical part before treating this as a live lane.",
      },
      {
        label: "North American fabricated-component supply",
        location: "Great Lakes and Quebec manufacturing corridor",
        coordinates: { latitude: 44.5, longitude: -77.0 },
        detail: "A plausible market for frames, sheet metal, machined parts, enclosures, and service inventory near final assembly.",
        cargo: "Frames, enclosures, machined parts, and service inventory",
        mode: "Regional truck or LTL",
        confidence: "low",
        confirmNext: "Compare local fabrication lead time and quality against current imported parts.",
      },
    ],
    customerClusters: [
      {
        label: "North American advanced manufacturing customers",
        location: "United States industrial markets",
        coordinates: { latitude: 39.8283, longitude: -98.5795 },
        detail: "Likely delivery to aerospace, research, tooling, and industrial customers that need installation planning and service-parts continuity.",
        cargo: "Industrial printers, accessories, consumables, and service parts",
        mode: "Dedicated truck, air, LTL, or white-glove delivery",
        confidence: "medium",
        confirmNext: "Confirm the actual install base, machine dimensions, declared value, and site-delivery requirements.",
      },
    ],
    customerSegments: [
      "Aerospace and defense production teams",
      "Research laboratories and universities",
      "Industrial prototyping and tooling groups",
      "Service organizations managing installed machines",
    ],
  },
  {
    id: "aerospace",
    label: "Aerospace and defense hardware company",
    facilityActivity: "Receive controlled and traceable components, assemble and test hardware, and release systems or service parts",
    sourceClusters: [
      {
        label: "U.S. aerospace precision-supply network",
        location: "Wichita and central U.S. aerospace corridor",
        coordinates: { latitude: 37.6872, longitude: -97.3301 },
        detail: "A likely qualified market for precision machining, structures, tooling, and documented aerospace materials.",
        cargo: "Traceable machined parts, structures, tooling, and controlled material",
        mode: "Dedicated truck, air, or security-controlled parcel",
        confidence: "medium",
        confirmNext: "Confirm quality approvals, export-control eligibility, traceability, and alternate-source status by part number.",
      },
    ],
    customerClusters: [
      {
        label: "U.S. aerospace integration and test sites",
        location: "Southern California aerospace corridor",
        coordinates: { latitude: 34.0522, longitude: -118.2437 },
        detail: "Likely movement to integrators, launch and test programs, depots, or contract manufacturers with strict custody requirements.",
        cargo: "Flight hardware, test equipment, spares, and controlled technical material",
        mode: "Dedicated truck, air freight, or approved secure courier",
        confidence: "low",
        confirmNext: "Confirm end user, classification, value, custody rules, and required delivery appointment before tender.",
      },
    ],
    customerSegments: [
      "Prime contractors and subsystem integrators",
      "Launch, test, and mission operations teams",
      "Aerospace machine shops and contract manufacturers",
      "Field service and depot organizations",
    ],
  },
  {
    id: "medical",
    label: "Medical-device manufacturer",
    facilityActivity: "Receive controlled components, assemble or package devices, retain lot evidence, and release regulated products",
    sourceClusters: [
      {
        label: "North American medical-component supply",
        location: "Minneapolis medical-device corridor",
        coordinates: { latitude: 44.9778, longitude: -93.265 },
        detail: "A likely discovery market for precision components, contract manufacturing, electronics, and validated packaging.",
        cargo: "Precision parts, medical electronics, packaging, and validated subassemblies",
        mode: "Parcel, air, or controlled LTL",
        confidence: "low",
        confirmNext: "Confirm approved suppliers, lot traceability, change control, and regulatory establishment details.",
      },
    ],
    customerClusters: [
      {
        label: "Clinical and distribution customers",
        location: "United States healthcare markets",
        coordinates: { latitude: 39.8283, longitude: -98.5795 },
        detail: "Likely delivery to distributors, hospitals, clinics, laboratories, or field-service depots with product and receiving controls.",
        cargo: "Devices, accessories, sterile or validated packaging, and service parts",
        mode: "Parcel, air, controlled LTL, or white-glove delivery",
        confidence: "medium",
        confirmNext: "Confirm destination type, temperature or handling rules, device listing, and proof-of-delivery requirements.",
      },
    ],
    customerSegments: [
      "Hospitals, clinics, and laboratories",
      "Medical distributors and field-service depots",
      "Research and clinical-trial sites",
      "Contract manufacturers and packaging partners",
    ],
  },
  {
    id: "chemicals",
    label: "Chemical and advanced-materials company",
    facilityActivity: "Receive feedstocks, process or blend material, retain batch evidence, and release packaged product",
    sourceClusters: [
      {
        label: "U.S. Gulf Coast chemical supply",
        location: "Houston and Gulf Coast chemical corridor",
        coordinates: { latitude: 29.7604, longitude: -95.3698 },
        detail: "A likely domestic market for commodity and specialty feedstocks, packaging, and dangerous-goods capable logistics.",
        cargo: "Chemical feedstocks, additives, packaging, and batch-testing material",
        mode: "Bulk truck, ISO tank, dry van, LTL, or parcel by classification",
        confidence: "medium",
        confirmNext: "Map each material to supplier, CAS number, SDS, UN classification, packaging, and storage constraints.",
      },
    ],
    customerClusters: [
      {
        label: "Industrial and specialty-material customers",
        location: "U.S. manufacturing markets",
        coordinates: { latitude: 39.8283, longitude: -98.5795 },
        detail: "Likely demand from manufacturers, laboratories, formulators, and distributors with batch and dangerous-goods controls.",
        cargo: "Finished formulations, samples, packaged chemicals, and replenishment orders",
        mode: "DG parcel, LTL, dry van, bulk, or temperature-controlled service",
        confidence: "medium",
        confirmNext: "Confirm product classification, package format, customer handling rules, and recurring delivery lanes.",
      },
    ],
    customerSegments: [
      "Industrial manufacturers and formulators",
      "Laboratories and research organizations",
      "Specialty-chemical distributors",
      "Contract packagers and toll manufacturers",
    ],
  },
  {
    id: "automotive",
    label: "Automotive and mobility manufacturer",
    facilityActivity: "Receive production parts, sequence inventory, assemble or integrate systems, and release finished products or service parts",
    sourceClusters: [
      {
        label: "Great Lakes automotive supply",
        location: "Detroit and Great Lakes corridor",
        coordinates: { latitude: 42.3314, longitude: -83.0458 },
        detail: "A likely source market for machined parts, electronics, tooling, and tier-supplier production capacity.",
        cargo: "Production parts, electronics, tooling, and service inventory",
        mode: "Milk run, dedicated truck, LTL, or expedited air",
        confidence: "medium",
        confirmNext: "Map every production-critical part to supplier, release cadence, line-stop exposure, and approved alternate.",
      },
      {
        label: "Northern Mexico industrial supply",
        location: "Monterrey manufacturing corridor",
        coordinates: { latitude: 25.6866, longitude: -100.3161 },
        detail: "A plausible nearshore option for fabricated parts and assemblies, subject to border, origin, and capacity validation.",
        cargo: "Fabricated components, harnesses, assemblies, and tooling",
        mode: "Cross-border truck",
        confidence: "low",
        confirmNext: "Confirm actual supplier sites, origin, customs program, crossing, security, and delivered lead time.",
      },
    ],
    customerClusters: [
      {
        label: "North American customer and service network",
        location: "United States and Canada",
        coordinates: { latitude: 43.0, longitude: -92.0 },
        detail: "Likely movement to plants, distributors, test sites, dealers, or service depots with scheduled receiving.",
        cargo: "Production parts, finished systems, prototypes, and service parts",
        mode: "Dedicated truck, LTL, parcel, or expedited air",
        confidence: "low",
        confirmNext: "Confirm ship-to locations, delivery windows, packaging return loops, and service-level commitments.",
      },
    ],
    customerSegments: [
      "Vehicle and mobility manufacturers",
      "Tier suppliers and contract manufacturers",
      "Prototype and test programs",
      "Service-parts distributors and depots",
    ],
  },
  {
    id: "industrial",
    label: "Industrial hardware company",
    facilityActivity: "Receive components, manufacture or assemble products, hold inventory, and release customer orders",
    sourceClusters: [
      {
        label: "North American industrial supply",
        location: "Great Lakes manufacturing corridor",
        coordinates: { latitude: 41.8781, longitude: -87.6298 },
        detail: "A practical first source market for fabricated parts, industrial electronics, packaging, and urgent replenishment.",
        cargo: "Fabricated parts, electronics, packaging, and service inventory",
        mode: "Truck, LTL, parcel, or expedited air",
        confidence: "low",
        confirmNext: "Match the actual BOM or purchase history to suppliers, sites, lead times, and alternates.",
      },
    ],
    customerClusters: [
      {
        label: "Industrial customer markets",
        location: "United States manufacturing corridor",
        coordinates: { latitude: 39.8283, longitude: -98.5795 },
        detail: "A placeholder customer-market shape for factories, distributors, integrators, and service locations.",
        cargo: "Finished equipment, replacement parts, and replenishment orders",
        mode: "Truck, LTL, parcel, or white-glove delivery",
        confidence: "low",
        confirmNext: "Connect customer and shipment history to replace this hypothesis with actual destinations and service requirements.",
      },
    ],
    customerSegments: [
      "Industrial manufacturers",
      "Distributors and integrators",
      "Field-service organizations",
      "Prototype and production hardware teams",
    ],
  },
];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "node";
}

function clean(values: readonly string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function naturalList(values: readonly string[], fallback: string) {
  const items = clean(values).slice(0, 4);
  if (!items.length) return fallback;
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function researchText(dashboard: SupplyCaseDashboard) {
  const research = dashboard.research;
  const evidenceText = [
    dashboard.sourcePrompt,
    dashboard.companyName,
    research?.company.description.value,
    research?.company.industry.value,
    ...(research?.company.products.map((item) => item.value) ?? []),
    ...(research?.company.customerMarkets.map((item) => item.value) ?? []),
    ...(research?.company.likelyInputs.map((item) => item.value) ?? []),
  ].filter(Boolean).join(" ").trim();
  const fallbackText = [dashboard.companyDescription, ...dashboard.sourcingNeeds].filter(Boolean).join(" ");
  return (evidenceText || fallbackText).toLowerCase();
}

function profileFor(dashboard: SupplyCaseDashboard) {
  const text = researchText(dashboard);
  const id: OptimizationProfile["id"] = /metal|aluminum|aluminium|steel|plate|alloy|mill cert/.test(text)
    ? "metals"
    : /3d print|additive manufactur/.test(text)
      ? "additive"
      : /robot|autonomous|automation/.test(text)
        ? "robotics"
        : /aerospace|satellite|spacecraft|defen[cs]e|avionics/.test(text)
          ? "aerospace"
          : /medical|medtech|surgical|diagnostic|clinical/.test(text)
            ? "medical"
            : /chemical|polymer|coating|resin|solvent|reagent/.test(text)
              ? "chemicals"
              : /automotive|vehicle|mobility|ev\b/.test(text)
                ? "automotive"
                : "industrial";
  return PROFILES.find((profile) => profile.id === id) ?? PROFILES.at(-1)!;
}

function matchingResearchClaim(
  claims: readonly SupplyResearchClaim[],
  value: string,
) {
  const normalized = value.toLowerCase();
  return claims.find((claim) => claim.value.toLowerCase() === normalized) ?? null;
}

function basisForClaim(claim: SupplyResearchClaim | null): Pick<SupplyOptimizationNode, "basis" | "confidence"> {
  if (!claim) return { basis: "customer_stated", confidence: "medium" };
  if (claim.basis === "inferred") return { basis: "inferred", confidence: claim.confidence };
  if (claim.basis === "public") return { basis: "public", confidence: claim.confidence };
  return { basis: "official", confidence: claim.confidence };
}

function routeNodeFor(dashboard: SupplyCaseDashboard, kind: "headquarters" | "source" | "destination", label?: string) {
  if (label) {
    const normalized = label.toLowerCase();
    const exact = dashboard.routeNodes.find((node) => node.kind === kind && node.label.toLowerCase() === normalized);
    if (exact) return exact;
  }
  return dashboard.routeNodes.find((node) => node.kind === kind) ?? null;
}

function facilityNode(dashboard: SupplyCaseDashboard, profile: OptimizationProfile): SupplyOptimizationNode {
  const researchLocation = dashboard.research?.company.locations.find((location) =>
    ["manufacturing", "assembly", "warehouse"].includes(location.role),
  ) ?? dashboard.research?.company.locations[0] ?? null;
  const label = dashboard.productionLocation
    ?? researchLocation?.value
    ?? dashboard.companyLocation
    ?? "Operating site to confirm";
  const routeNode = routeNodeFor(dashboard, "headquarters", label);
  const researchBasis = researchLocation ? basisForClaim(researchLocation) : null;
  return {
    id: "processing-site",
    sequence: 3,
    kind: "processing_site",
    label: dashboard.companyName ? `${dashboard.companyName} operating site` : "Company operating site",
    location: label,
    coordinates: researchLocation?.coordinates ?? routeNode?.coordinates ?? null,
    basis: researchBasis?.basis ?? (dashboard.productionLocation || dashboard.companyLocation ? "customer_stated" : "inferred"),
    confidence: researchBasis?.confidence ?? (routeNode?.coordinates ? "medium" : "low"),
    detail: profile.facilityActivity,
    cargo: naturalList(dashboard.sourcingNeeds, "Production inputs and finished goods to confirm"),
    confirmNext: "Confirm which products, inventory, suppliers, and customer shipments actually move through this site.",
    qualificationTargets: [],
  };
}

function explicitNodes(
  dashboard: SupplyCaseDashboard,
  kind: "source" | "destination",
  startSequence: number,
): SupplyOptimizationNode[] {
  const values = kind === "source" ? dashboard.sourceRegions : dashboard.destinations;
  const claims = kind === "source"
    ? dashboard.research?.company.likelySourceRegions ?? []
    : dashboard.research?.company.likelyDestinations ?? [];
  return clean(values).map((value, index) => {
    const claim = matchingResearchClaim(claims, value);
    const basis = basisForClaim(claim);
    const routeNode = routeNodeFor(dashboard, kind, value);
    return {
      id: `${kind}-${slug(value)}-${index + 1}`,
      sequence: startSequence + index,
      kind: kind === "source" ? "supplier_cluster" as const : "customer_cluster" as const,
      label: kind === "source" ? `${value} suppliers` : `${value} customers`,
      location: value,
      coordinates: routeNode?.coordinates ?? null,
      ...basis,
      detail: kind === "source"
        ? `Supplier geography carried from the customer brief or public research for ${naturalList(dashboard.sourcingNeeds, "inputs to confirm")}.`
        : "Delivery geography carried from the customer brief or public research. Actual customers and service requirements remain unconfirmed.",
      cargo: kind === "source"
        ? naturalList(dashboard.sourcingNeeds, "Inputs to confirm")
        : "Finished goods, spares, or replenishment orders to confirm",
      confirmNext: kind === "source"
        ? "Confirm supplier name, production site, part allocation, Incoterm, and cargo-ready cadence."
        : "Confirm customer, ship-to site, order profile, receiving rules, and required delivery date.",
      qualificationTargets: [],
    };
  });
}

function inferredClusterNodes(
  clusters: readonly Cluster[],
  kind: "supplier_cluster" | "customer_cluster",
  startSequence: number,
): SupplyOptimizationNode[] {
  return clusters.map((cluster, index) => ({
    id: `${kind}-${slug(cluster.label)}-${index + 1}`,
    sequence: startSequence + index,
    kind,
    label: cluster.label,
    location: cluster.location,
    coordinates: cluster.coordinates,
    basis: "inferred",
    confidence: cluster.confidence,
    detail: cluster.detail,
    cargo: cluster.cargo,
    confirmNext: cluster.confirmNext,
    qualificationTargets: cluster.qualificationTargets ?? [],
  }));
}

function edgeBasis(left: SupplyOptimizationNode, right: SupplyOptimizationNode) {
  return left.basis === "customer_stated" && right.basis === "customer_stated"
    ? "customer_stated" as const
    : "inferred" as const;
}

function edgeConfidence(left: SupplyOptimizationNode, right: SupplyOptimizationNode): SupplyOptimizationConfidence {
  if (left.confidence === "low" || right.confidence === "low") return "low";
  if (left.confidence === "medium" || right.confidence === "medium") return "medium";
  return "high";
}

function buildEdges(
  sources: readonly SupplyOptimizationNode[],
  facility: SupplyOptimizationNode,
  customers: readonly SupplyOptimizationNode[],
  profile: OptimizationProfile,
): SupplyOptimizationEdge[] {
  const edges: SupplyOptimizationEdge[] = [];
  for (const [index, source] of sources.entries()) {
    const cluster = profile.sourceClusters[index] ?? profile.sourceClusters[0];
    edges.push({
      id: `inbound-${index + 1}`,
      fromNodeId: source.id,
      toNodeId: facility.id,
      stage: "inbound",
      mode: cluster?.mode ?? "Mode and provider to confirm",
      cargo: source.cargo,
      basis: edgeBasis(source, facility),
      confidence: edgeConfidence(source, facility),
      detail: "This is an operating hypothesis for supplier-to-site movement, not an observed shipment or awarded route.",
    });
  }
  for (const [index, customer] of customers.entries()) {
    const cluster = profile.customerClusters[index] ?? profile.customerClusters[0];
    edges.push({
      id: `outbound-${index + 1}`,
      fromNodeId: facility.id,
      toNodeId: customer.id,
      stage: "outbound",
      mode: cluster?.mode ?? "Delivery mode and provider to confirm",
      cargo: customer.cargo,
      basis: edgeBasis(facility, customer),
      confidence: edgeConfidence(facility, customer),
      detail: "This is a likely customer-delivery pattern. Connect order and shipment history before using it as an operating lane.",
    });
  }
  return edges;
}

function actionsFor(
  dashboard: SupplyCaseDashboard,
  profile: OptimizationProfile,
  facility: SupplyOptimizationNode,
): SupplyOptimizationAction[] {
  const company = dashboard.companyName ?? "The company";
  const materials = naturalList(dashboard.sourcingNeeds, "critical production inputs");
  const customerSegments = naturalList(profile.customerSegments.slice(0, 3), "customer segments to confirm");
  const location = facility.location;

  if (profile.id === "metals") {
    return [
      {
        id: "metals-source-matrix",
        priority: 1,
        workstreamId: "procurement",
        title: "Build a grade-by-grade source matrix",
        currentCondition: `${company} publicly shows a broad aluminum offer, but the source mix for critical grades, thicknesses, and mill certifications is not visible. One constrained grade can break the next-day promise even when total inventory looks healthy.`,
        recommendation: "Map the top SKUs to current mills and distributors, then qualify one alternate for each critical grade and thickness. Compare availability, mill certs, melt and cast origin, MOQ, lead time, and delivered cost.",
        decision: "Approve a primary and alternate source for every high-volume or production-critical SKU.",
        requiredInput: "Top 20 SKUs or 90 days of purchase orders and stockouts",
      },
      {
        id: "metals-release-control",
        priority: 2,
        workstreamId: "supplier_outreach",
        title: "Turn mill and distributor follow-up into a release schedule",
        currentCondition: `The public picture does not show one view of allocation, cut date, certification packet, pickup readiness, or shortages for material entering ${location}.`,
        recommendation: "Have Derya contact each supplier against the same readiness checklist, surface short allocations early, and combine compatible releases into one pickup plan.",
        decision: "Set the next two replenishment windows and escalate any uncovered grade before customer demand consumes stock.",
        requiredInput: "Open purchase orders, supplier contacts, target receipt dates, and current forwarder or carrier",
      },
      {
        id: "metals-inbound-consolidation",
        priority: 3,
        workstreamId: "shipment_planning",
        title: "Separate urgent stock from planned replenishment",
        currentCondition: "Cut plate and stock replenishment have different urgency, dimensions, and damage exposure. Treating every release as ad hoc LTL creates avoidable expedite cost and handling risk.",
        recommendation: "Create two service rules: scheduled consolidated replenishment by region, plus an urgent lane for production or customer shortages. Tender flatbed, dedicated, and LTL on the same all-in scope.",
        decision: "Choose a weekly inbound cadence and the exact trigger for an expedite.",
        requiredInput: "Shipment history with origin ZIP, weight, dimensions, accessorials, and required receipt date",
      },
      {
        id: "metals-cross-border",
        priority: 4,
        workstreamId: "customs",
        title: "Pre-clear the Canadian alternate before relying on it",
        currentCondition: "Southern Ontario may improve access to metal supply, but tariff classification, Section 232 treatment, mill origin, and broker readiness can erase the lead-time benefit.",
        recommendation: "Build a broker-reviewed product packet for each candidate alloy and form. Capture HTS, country of origin, melt and cast evidence, commercial value, and any trade-remedy scope before the first urgent order.",
        decision: "Decide which Canadian sources are approved for normal replenishment, emergency use only, or not economical.",
        requiredInput: "Product descriptions, alloy and form, origin evidence, values, Incoterm, and importer details",
      },
      {
        id: "metals-delivery-policy",
        priority: 5,
        workstreamId: "fulfillment",
        title: "Match delivery method to plate size and customer promise",
        currentCondition: `${company} likely serves ${customerSegments}. Small cut pieces, full plate, and time-critical replenishment should not share one delivery rule.`,
        recommendation: "Segment orders by size, value, damage exposure, and promised lead time. Pre-qualify local courier, LTL, dedicated, and flatbed options with packaging and proof-of-delivery standards.",
        decision: "Publish the service level and carrier class for each order profile.",
        requiredInput: "Customer ship-to history, order dimensions, delivery promises, claims, and receiving constraints",
      },
    ];
  }

  const regulated = profile.id === "medical" || profile.id === "aerospace" || profile.id === "chemicals";
  return [
    {
      id: `${profile.id}-source-control`,
      priority: 1,
      workstreamId: "procurement",
      title: `Map critical ${materials} to approved alternates`,
      currentCondition: `${company}'s public product picture suggests dependence on ${materials}, but it does not show part-level supplier ownership, lead-time concentration, or a qualified second source.`,
      recommendation: "Build a part-to-supplier matrix with site, capability, MOQ, lead time, quality evidence, landed cost, and alternate status. Prioritize parts that can stop production or delay a customer deployment.",
      decision: "Approve the first supplier search and the parts that require a second source now.",
      requiredInput: "BOM, approved-vendor list, open purchase orders, and the next production deadline",
    },
    {
      id: `${profile.id}-supplier-control`,
      priority: 2,
      workstreamId: "supplier_outreach",
      title: "Create one supplier-readiness view",
      currentCondition: `The public picture cannot show whether suppliers have accepted orders, completed production, prepared documents, or booked pickup into ${location}.`,
      recommendation: "Let Derya run the readiness cadence, normalize every response, flag late or incomplete items, and assemble one pickup and document plan.",
      decision: "Confirm which suppliers Derya should contact directly and which relationships the customer retains.",
      requiredInput: "Supplier contacts, open POs, expected ready dates, and communication authority",
    },
    {
      id: `${profile.id}-movement-control`,
      priority: 3,
      workstreamId: "shipment_planning",
      title: "Plan the movement around the production deadline",
      currentCondition: "Without part-level readiness and one delivery deadline, forwarder quotes compare different scopes and urgent components get mixed with planned replenishment.",
      recommendation: "Group compatible releases, compare air, ocean, parcel, and truck against the same door-to-door scope, then choose the cheapest plan that protects the production or install date.",
      decision: "Approve the consolidation window, service level, and provider tender list.",
      requiredInput: "Pickup sites, packages, dimensions, weight, ready dates, Incoterm, and required delivery date",
    },
    {
      id: `${profile.id}-customs-control`,
      priority: 4,
      workstreamId: "customs",
      title: regulated ? "Close product and regulatory gaps before tender" : "Build a reusable customs packet before the next import",
      currentCondition: regulated
        ? "Product identity, origin, classification, agency or export-control scope, and transport status can change routing and provider acceptance before price matters."
        : "Classification, origin, value, importer setup, and product-agency questions are not visible in the public company picture, so a quote can look complete while the entry packet is not.",
      recommendation: "Build a product-level evidence packet, compare licensed brokers, record open questions, and require broker approval before filing or promising clearance.",
      decision: "Assign the importer and broker, approve the product packet, and close the entry blockers.",
      requiredInput: "Product specifications, proposed HTS, origin, value, parties, Incoterm, and expected entry date",
    },
    {
      id: `${profile.id}-delivery-control`,
      priority: 5,
      workstreamId: "fulfillment",
      title: "Design delivery around the real customer handoff",
      currentCondition: `${company} likely serves ${customerSegments}, but the public record does not reveal install dates, receiving rules, service-parts urgency, or return flows.`,
      recommendation: "Segment finished-goods and service-part deliveries, pre-qualify the required carrier or 3PL service, and manage appointments, proof of delivery, returns, and exceptions in one workflow.",
      decision: "Approve the customer service levels and the facilities that need special handling.",
      requiredInput: "Customer ship-to list, product dimensions and value, receiving rules, delivery promises, and returns policy",
    },
  ];
}

export function buildSupplyOptimizationModel(dashboard: SupplyCaseDashboard): SupplyOptimizationModel {
  const profile = profileFor(dashboard);
  const facility = facilityNode(dashboard, profile);
  const explicitSources = explicitNodes(dashboard, "source", 1);
  const explicitCustomers = explicitNodes(dashboard, "destination", 10);
  const sources = explicitSources.length
    ? explicitSources
    : inferredClusterNodes(profile.sourceClusters, "supplier_cluster", 1);
  const customers = explicitCustomers.length
    ? explicitCustomers
    : inferredClusterNodes(profile.customerClusters, "customer_cluster", 10);
  const nodes = [...sources, facility, ...customers];
  const edges = buildEdges(sources, facility, customers, profile);
  const company = dashboard.companyName ?? "This company";
  const networkSummary = profile.id === "metals"
    ? `${company} likely combines direct U.S. aerospace-mill supply, Great Lakes buffer stock, and Southern Ontario alternates, cuts plate and retains material records in ${facility.location}, then serves Michigan and nationwide machining, aerospace, defense, and new-space buyers.`
    : `${company} likely brings ${(sources[0]?.cargo ?? "critical inputs").toLowerCase()} into ${facility.location}, runs ${profile.facilityActivity.toLowerCase()}, then delivers to ${naturalList(profile.customerSegments.slice(0, 2), "customer segments to confirm")}.`;
  const assumptions = [
    explicitSources.length
      ? "Supplier geography comes from the customer brief or public research. The specific suppliers and part allocation still need confirmation."
      : `Supplier clusters are inferred from ${company}'s products, inputs, and operating location. They are discovery targets, not observed vendors.`,
    explicitCustomers.length
      ? "Customer geography comes from the customer brief or public research. The exact customers, volumes, and service rules still need confirmation."
      : "Customer clusters describe likely end-customer profiles and regional demand. They are not a list of known customers or shipments.",
    "Every route shown is a planning hypothesis until purchase orders, supplier records, shipment history, or customer orders establish the endpoints and movement.",
  ];
  return {
    profile: profile.label,
    networkSummary,
    nodes,
    edges,
    actions: actionsFor(dashboard, profile, facility),
    workspaces: SUPPLY_OPTIMIZATION_WORKSPACES,
    customerSegments: profile.customerSegments,
    assumptions,
  };
}

export function supplyOptimizationWorkspace(id: string) {
  const normalized = id.replace(/-/g, "_");
  return SUPPLY_OPTIMIZATION_WORKSPACES.find((workspace) => workspace.id === normalized) ?? null;
}
