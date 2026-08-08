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
  measure: string;
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

function advancedAircraftProfile(text: string): OptimizationProfile {
  const customerClusters: Cluster[] = [
    {
      label: "U.S. certification and mission-program sites",
      location: "United States aerospace and defense corridor",
      coordinates: { latitude: 38.9072, longitude: -77.0369 },
      detail: "Likely movement to certification, flight-test, defense, and integration programs where configuration, custody, appointments, and export status matter as much as transit time.",
      cargo: "Aircraft, propulsion modules, mission kits, test equipment, and serialized spares",
      mode: "Dedicated truck, secure air freight, charter, or purpose-built transport fixture",
      confidence: "medium",
      confirmNext: "Separate firm program deliveries from demonstrations and provisional demand, then map configuration, custody, site access, and required-on-site dates.",
    },
  ];

  if (/oman|gcc|gulf/.test(text)) {
    customerClusters.push({
      label: "GCC deployment and support network",
      location: "Muscat and operating sites in Oman",
      coordinates: { latitude: 23.588, longitude: 58.3829 },
      detail: "Remote and offshore operations imply deployment kits, regional spares, controlled return flows, field support, and environmental packaging beyond the aircraft delivery itself.",
      cargo: "Aircraft, ground-control equipment, deployment kits, service parts, and repair returns",
      mode: "Ocean for planned ground equipment, air for aircraft-on-ground and build-critical material",
      confidence: "medium",
      confirmNext: "Confirm the actual operating bases, import party, temporary or permanent entry model, support stock, repair route, and target availability.",
    });
  }

  if (/fiji|pacific|island/.test(text)) {
    customerClusters.push({
      label: "Pacific operating and spares network",
      location: "Suva and remote operating sites in Fiji",
      coordinates: { latitude: -18.1248, longitude: 178.4501 },
      detail: "Island operations turn spare fill rate, dangerous-goods acceptance, return packaging, and replenishment frequency into mission-availability constraints.",
      cargo: "Aircraft deployment equipment, line-replaceable units, batteries, tools, and repair returns",
      mode: "Scheduled ocean replenishment with priority air recovery",
      confidence: "medium",
      confirmNext: "Confirm installed assets, failure-critical spares, local receiving capability, aviation dangerous-goods scope, and repair turnaround target.",
    });
  }

  if (/europe|european|eu\b|verti-go/.test(text)) {
    customerClusters.push({
      label: "European demonstration and regulatory programs",
      location: "Central European aerospace corridor",
      coordinates: { latitude: 50.1109, longitude: 8.6821 },
      detail: "Demonstration and regulatory programs need temporary-import planning, controlled technical equipment, return deadlines, and one owner for every handoff.",
      cargo: "Demonstration aircraft, payloads, ground equipment, tools, and temporary-import inventory",
      mode: "Air freight, charter, or dedicated road with temporary admission controls",
      confidence: "low",
      confirmNext: "Confirm demonstration country, consignee, temporary-import procedure, re-export date, carnet suitability, and local handling plan.",
    });
  }

  return {
    id: "aerospace",
    label: "Advanced aircraft and propulsion OEM",
    facilityActivity: "Control vehicle architecture, integrate propulsion and mission systems, assemble serialized aircraft, test configurations, and support deployed fleets",
    sourceClusters: [
      {
        label: "U.S. flight structures and special-process supply",
        location: "Southern California, Wichita, and central U.S. aerospace corridor",
        coordinates: { latitude: 37.6872, longitude: -97.3301 },
        detail: "A likely network for composite structures, machined hardpoints, sheet metal, landing gear, actuation, heat treatment, coatings, welding, and nondestructive inspection.",
        cargo: "Serialized structures, machined flight hardware, composite assemblies, actuation, and certified material",
        mode: "Scheduled dedicated truck, controlled LTL, or air for build-critical shortages",
        confidence: "medium",
        confirmNext: "Map every flight-critical part to the actual manufacturing site, special process, first-article status, tooling owner, capacity, and recovery plan.",
      },
      {
        label: "UK and European propulsion electronics",
        location: "United Kingdom and European aerospace technology corridor",
        coordinates: { latitude: 52.4862, longitude: -1.8904 },
        detail: "Hybrid aircraft can depend on tightly coupled inverters, silicon-carbide devices, motors, controllers, cooling interfaces, and proprietary software whose failure stops the build.",
        cargo: "Power electronics, inverters, controllers, motors, cooling hardware, and calibrated propulsion modules",
        mode: "Priority air for production modules, consolidated air or ocean for planned equipment and spares",
        confidence: "medium",
        confirmNext: "Confirm the actual supplier, site, interface baseline, repair path, obsolescence notice, support term, buffer policy, and future alternate design.",
      },
      {
        label: "North American avionics and mission-system supply",
        location: "Phoenix and U.S. aerospace electronics corridor",
        coordinates: { latitude: 33.4484, longitude: -112.074 },
        detail: "Mission-specific radios, sensors, EO/IR, radar, flight computers, data links, and ground-control equipment should remain modular rather than destabilize the baseline aircraft BOM.",
        cargo: "Avionics, mission sensors, communications, flight computers, and ground-control equipment",
        mode: "Secure parcel, air freight, or dedicated truck with serialized custody",
        confidence: "medium",
        confirmNext: "Separate baseline avionics from customer-furnished mission kits and confirm configuration, export status, custody, and required-on-dock date by serial number.",
      },
    ],
    customerClusters,
    customerSegments: [
      "Defense and government mission programs",
      "Cargo, offshore, and remote logistics operators",
      "Certification, demonstration, and integration partners",
      "Regional field-service and depot organizations",
    ],
  };
}

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
    ...(research?.findings.flatMap((item) => [item.title, item.detail, item.implication]) ?? []),
    ...(research?.warnings ?? []),
  ].filter(Boolean).join(" ").trim();
  const fallbackText = [dashboard.companyDescription, ...dashboard.sourcingNeeds].filter(Boolean).join(" ");
  return (evidenceText || fallbackText).toLowerCase();
}

function profileFor(dashboard: SupplyCaseDashboard) {
  const text = researchText(dashboard);
  const identityText = [
    dashboard.sourcePrompt,
    dashboard.companyName,
    dashboard.research?.company.description.value,
    dashboard.research?.company.industry.value,
    ...(dashboard.research?.company.products.map((item) => item.value) ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  if (/vtol|aircraft|aviation|hybrid[- ]electric propulsion|hybrid power system|unmanned aerial|\buav\b/.test(identityText)) {
    return advancedAircraftProfile(text);
  }
  const id: OptimizationProfile["id"] = /3d print|additive manufactur/.test(identityText)
      ? "additive"
      : /robot|autonomous|automation/.test(identityText)
        ? "robotics"
        : /aerospace|satellite|spacecraft|defen[cs]e|avionics/.test(identityText)
          ? "aerospace"
          : /medical|medtech|surgical|diagnostic|clinical/.test(identityText)
            ? "medical"
            : /chemical|polymer|coating|resin|solvent|reagent/.test(identityText)
              ? "chemicals"
              : /automotive|vehicle|mobility|ev\b/.test(identityText)
                ? "automotive"
                : /metal|aluminum|aluminium|steel|plate|alloy|mill cert/.test(identityText)
                  ? "metals"
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

const KNOWN_LOCATION_COORDINATES: ReadonlyArray<{
  aliases: RegExp;
  coordinates: SupplyCoordinate;
}> = [
  { aliases: /\bmontreal\b/i, coordinates: { latitude: 45.5019, longitude: -73.5674 } },
  { aliases: /\bphoenix\b|\bgoodyear,? arizona\b/i, coordinates: { latitude: 33.4484, longitude: -112.074 } },
  { aliases: /\btulsa\b|\boklahoma city\b/i, coordinates: { latitude: 36.154, longitude: -95.9928 } },
  { aliases: /\bwichita\b/i, coordinates: { latitude: 37.6872, longitude: -97.3301 } },
  { aliases: /\blos angeles\b|\blong beach\b|\bsouthern california\b/i, coordinates: { latitude: 33.7701, longitude: -118.1937 } },
  { aliases: /\bsan francisco\b|\bbay area\b/i, coordinates: { latitude: 37.7749, longitude: -122.4194 } },
  { aliases: /\bdetroit\b|\bferndale\b/i, coordinates: { latitude: 42.4606, longitude: -83.1346 } },
  { aliases: /\btoronto\b|\bsouthern ontario\b|\bhamilton\b/i, coordinates: { latitude: 43.2557, longitude: -79.8711 } },
  { aliases: /\baustin\b/i, coordinates: { latitude: 30.2672, longitude: -97.7431 } },
  { aliases: /\bboston\b/i, coordinates: { latitude: 42.3601, longitude: -71.0589 } },
  { aliases: /\bnew york\b|\bnew jersey\b/i, coordinates: { latitude: 40.7128, longitude: -74.006 } },
  { aliases: /\bnashville\b/i, coordinates: { latitude: 36.1627, longitude: -86.7816 } },
];

function knownCoordinates(location: string | null | undefined): SupplyCoordinate | null {
  if (!location) return null;
  return KNOWN_LOCATION_COORDINATES.find((candidate) => candidate.aliases.test(location))?.coordinates ?? null;
}

function provisionalCoordinateNear(coordinate: SupplyCoordinate | null | undefined, index = 0): SupplyCoordinate | null {
  if (!coordinate) return null;
  const latitudeOffset = 0.45 + (index % 3) * 0.16;
  const longitudeOffset = -0.65 - (index % 3) * 0.22;
  return {
    latitude: Math.max(-85, Math.min(85, coordinate.latitude + latitudeOffset)),
    longitude: Math.max(-175, Math.min(175, coordinate.longitude + longitudeOffset)),
  };
}

function provisionalFacilityCoordinates(profile: OptimizationProfile): SupplyCoordinate | null {
  return provisionalCoordinateNear(
    profile.customerClusters.find((cluster) => cluster.coordinates)?.coordinates
      ?? profile.sourceClusters.find((cluster) => cluster.coordinates)?.coordinates,
  );
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
  const resolvedCoordinates = researchLocation?.coordinates ?? routeNode?.coordinates ?? knownCoordinates(label);
  const coordinates = resolvedCoordinates ?? provisionalFacilityCoordinates(profile);
  const usesProvisionalPlacement = !resolvedCoordinates && Boolean(coordinates);
  return {
    id: "processing-site",
    sequence: 3,
    kind: "processing_site",
    label: dashboard.companyName ? `${dashboard.companyName} operating site` : "Company operating site",
    location: label,
    coordinates,
    basis: researchBasis?.basis ?? (dashboard.productionLocation || dashboard.companyLocation ? "customer_stated" : "inferred"),
    confidence: usesProvisionalPlacement ? "low" : researchBasis?.confidence ?? (routeNode?.coordinates ? "medium" : "low"),
    detail: usesProvisionalPlacement
      ? `${profile.facilityActivity}. The map placement is provisional until the operating address is confirmed.`
      : profile.facilityActivity,
    cargo: naturalList(dashboard.sourcingNeeds, "Production inputs and finished goods to confirm"),
    confirmNext: "Confirm which products, inventory, suppliers, and customer shipments actually move through this site.",
    qualificationTargets: [],
  };
}

function explicitNodes(
  dashboard: SupplyCaseDashboard,
  kind: "source" | "destination",
  startSequence: number,
  fallbackClusters: readonly Cluster[],
): SupplyOptimizationNode[] {
  const values = kind === "source" ? dashboard.sourceRegions : dashboard.destinations;
  const claims = kind === "source"
    ? dashboard.research?.company.likelySourceRegions ?? []
    : dashboard.research?.company.likelyDestinations ?? [];
  return clean(values).map((value, index) => {
    const claim = matchingResearchClaim(claims, value);
    const basis = basisForClaim(claim);
    const routeNode = routeNodeFor(dashboard, kind, value);
    const resolvedCoordinates = routeNode?.coordinates ?? knownCoordinates(value);
    const coordinates = resolvedCoordinates
      ?? provisionalCoordinateNear(fallbackClusters[index]?.coordinates ?? fallbackClusters[0]?.coordinates, index + 1);
    const usesProvisionalPlacement = !resolvedCoordinates && Boolean(coordinates);
    return {
      id: `${kind}-${slug(value)}-${index + 1}`,
      sequence: startSequence + index,
      kind: kind === "source" ? "supplier_cluster" as const : "customer_cluster" as const,
      label: kind === "source" ? `${value} suppliers` : `${value} customers`,
      location: value,
      coordinates,
      ...basis,
      confidence: usesProvisionalPlacement ? "low" : basis.confidence,
      detail: kind === "source"
        ? `Supplier geography carried from the customer brief or public research for ${naturalList(dashboard.sourcingNeeds, "inputs to confirm")}.${usesProvisionalPlacement ? " The map placement is provisional until the supplier city or address is confirmed." : ""}`
        : `Delivery geography carried from the customer brief or public research. Actual customers and service requirements remain unconfirmed.${usesProvisionalPlacement ? " The map placement is provisional until the ship-to city or address is confirmed." : ""}`,
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

  function countryForLocation(location: string): "US" | "CA" | "CN" | "MX" | "GB" | "EU" | null {
    const value = location.toLowerCase();
    if (/china|shenzhen|dongguan|guangzhou|shanghai|taiwan|pearl river/.test(value)) return "CN";
    if (/canada|canadian|ontario|toronto|hamilton|windsor|montreal|quebec/.test(value)) return "CA";
    if (/united states|u\.s\.|usa|arizona|california|michigan|oklahoma|texas|ohio|iowa|washington|pennsylvania|phoenix|tulsa|detroit|wichita|midwest|great lakes|nationwide|national/.test(value)) return "US";
    if (/mexico|mexican|monterrey|tijuana|juarez|laredo/.test(value)) return "MX";
    if (/united kingdom|\buk\b|england|britain|british/.test(value)) return "GB";
    if (/europe|european|\beu\b|germany|france|netherlands/.test(value)) return "EU";
    return null;
  }

  function modeForEndpoints(from: SupplyOptimizationNode, to: SupplyOptimizationNode, fallback: string) {
    const fromCountry = countryForLocation(from.location);
    const toCountry = countryForLocation(to.location);
    if (fromCountry && fromCountry === toCountry && (fromCountry === "US" || fromCountry === "CA")) {
      return /plate|metal|structure|equipment/i.test(from.cargo)
        ? "Dedicated truck, flatbed, or LTL"
        : "Regional truck, dedicated, or LTL";
    }
    if (new Set([fromCountry, toCountry]).has("US") && new Set([fromCountry, toCountry]).has("CA")) {
      return "Cross-border truck or LTL";
    }
    return fallback;
  }

  for (const [index, source] of sources.entries()) {
    const cluster = profile.sourceClusters[index] ?? profile.sourceClusters[0];
    edges.push({
      id: `inbound-${index + 1}`,
      fromNodeId: source.id,
      toNodeId: facility.id,
      stage: "inbound",
      mode: modeForEndpoints(source, facility, cluster?.mode ?? "Mode and provider to confirm"),
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
      mode: modeForEndpoints(facility, customer, cluster?.mode ?? "Delivery mode and provider to confirm"),
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
        measure: "Critical-SKU source coverage, sole-source exposure, stockout hours, and risk-weighted lead time",
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
        measure: "Supplier promise accuracy, purchase-order lateness, uncovered grades, and release-to-pickup time",
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
        measure: "Inbound cost per pound, premium-freight share, damage rate, and receipt-date variability",
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
        measure: "Broker-ready SKU coverage, release time, duty and remedy variance, and border exception rate",
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
        measure: "On-time delivery, claims, cost per order profile, and proof-of-delivery completion",
      },
    ];
  }

  if (profile.id === "aerospace") {
    const products = naturalList(
      dashboard.research?.company.products.map((item) => item.value) ?? [],
      "aircraft, propulsion modules, and mission systems",
    );
    const publicDemandNeedsGating = /firm|provisional|purchase interest|order book|backlog|orders?/.test(researchText(dashboard));
    return [
      {
        id: "aerospace-critical-bom",
        priority: 1,
        workstreamId: "procurement",
        title: "Control the critical BOM below Tier 1",
        currentCondition: `${company} appears to be an integration-led OEM for ${products}. The public picture names products and selected partners, but it cannot show the manufacturing site, Tier-2 source, tooling ownership, demonstrated lead time, first-article status, or recovery plan for each build-stopping part.`,
        recommendation: "Create a critical-parts control tower that links every red part to the supplier site, lower-tier source, country and export class, lead time, MOQ, capacity, tooling owner, quality status, shelf life, affected serial numbers, and approved alternate or repair path.",
        decision: "Approve the first 50 part families and define which missing alternate or continuity plans block a production release.",
        requiredInput: "Engineering BOM, approved-vendor list, open purchase orders, serial-number build plan, and shortage list",
        measure: "Critical BOM with Tier-2 visibility, sole-source exposure, risk-weighted lead time, and parts without a recovery plan",
      },
      {
        id: "aerospace-demand-gates",
        priority: 2,
        workstreamId: "supplier_outreach",
        title: "Gate supplier commitments against validated program demand",
        currentCondition: publicDemandNeedsGating
          ? `${company}'s public demand picture mixes firm programs with provisional or earlier-stage demand. Buying long-lead, configuration-sensitive material against the headline pipeline can strand inventory while still missing the parts required for the next aircraft.`
          : `${company}'s public product picture does not reveal which aircraft, propulsion, and customer configurations are firm enough to authorize non-cancelable material or reserved capacity.`,
        recommendation: "Maintain committed, probable, and upside build plans. Reserve supplier capacity early, but release non-cancelable material only against a named customer, certification, flight-test, or configuration-lock gate. Have Derya chase each supplier against that authorization matrix.",
        decision: "Set the material-authorization gate for standard, common long-lead, customer-specific, and proprietary modules.",
        requiredInput: "Program backlog by confidence, deposits or contractual gates, configuration status, long-lead list, and cancellation terms",
        measure: "Non-cancelable inventory versus firm demand, capacity reserved, expedite spend, and monthly schedule volatility",
      },
      {
        id: "aerospace-serial-kits",
        priority: 3,
        workstreamId: "procurement",
        title: "Pre-kit every aircraft by serial number and station",
        currentCondition: `A low-rate aircraft program can show enough total inventory while still missing one fastener, harness, certificate, or revision-correct LRU for the next build. The public picture cannot show whether material is allocated to the serial number and work station that actually needs it.`,
        recommendation: "Create serial-number shipsets and station kits with the exact parts, consumables, certificates, drawings, tools, shortage status, and revision effectivity. Run the completeness check before the kit reaches the line, and generate the field-spares kit from the same as-built configuration.",
        decision: "Choose the first aircraft or propulsion build for a kit-completeness pilot and set the no-release conditions.",
        requiredInput: "Manufacturing BOM, build sequence, serial numbers, station plan, inventory allocation, shortage list, and certificate requirements",
        measure: "Kit completeness at release, line stops, search time, wrong-revision discoveries, and shortages found before station need",
      },
      {
        id: "aerospace-production-lanes",
        priority: 4,
        workstreamId: "shipment_planning",
        title: "Separate prototype freight from production shipsets",
        currentCondition: `Fast engineering changes and low-rate production are likely sharing inbound parts, documents, and recovery freight into ${location}. Without serial-number shipsets, one late component or wrong revision can stop the line while unrelated inventory looks available.`,
        recommendation: "Create separate prototype, production, and service lanes. Pre-kit each aircraft by serial number and station, run a digital shortage check before release, consolidate planned inbound material by supplier region, and reserve air freight for explicit line-stop or aircraft-on-ground triggers.",
        decision: "Approve the production-kit release rule, shortage review horizon, consolidation cadence, and premium-freight authority.",
        requiredInput: "Serial-number build schedule, manufacturing BOM, station plan, part dimensions, ready dates, revision effectivity, and current inbound history",
        measure: "Kit completeness at release, line stops from shortages, late-change rework, premium-freight share, and inbound variability",
      },
      {
        id: "aerospace-supplier-industrialization",
        priority: 5,
        workstreamId: "supplier_outreach",
        title: "Gate flight-critical suppliers for production readiness",
        currentCondition: "A technically capable prototype supplier is not automatically ready for repeatable aerospace production. Capacity, tooling, special processes, first-article status, inspection data, and corrective-action closure can fail after the purchase order is already late.",
        recommendation: "Run a common launch gate for every flight-critical supplier: requirements, manufacturability, process flow, tooling and inspection readiness, first article, process qualification, rate demonstration, and ongoing surveillance. Collect the evidence against each part and supplier site, not in a disconnected document folder.",
        decision: "Approve the supplier gates that block production release and identify which suppliers need an on-site readiness review first.",
        requiredInput: "Critical supplier list, part families, quality clauses, first-article records, special-process approvals, capacity plan, and open corrective actions",
        measure: "First-article right-first-time rate, supplier escapes, incoming acceptance, corrective-action age, and demonstrated capacity versus build rate",
      },
      {
        id: "aerospace-product-passports",
        priority: 6,
        workstreamId: "customs",
        title: "Create part-level customs and export passports",
        currentCondition: "Aircraft programs combine commercial parts, controlled hardware, customer-furnished equipment, temporary demonstration assets, dangerous goods, and repair returns. A shipment-level document check is too late to decide classification, licensing, valuation, temporary admission, or broker scope.",
        recommendation: "Build a reusable passport for every internationally moved part family: engineering description, HTS, Schedule B, country of origin, export classification, value method, agency scope, dangerous-goods status, repair or return treatment, approved brokers, and supporting documents. Require broker review before tender.",
        decision: "Assign the importer, exporter, broker, and approval owner for production, demonstration, repair, and field-spares movements.",
        requiredInput: "Part master, technical descriptions, origin evidence, export classifications, values, parties, Incoterms, and known licenses or exemptions",
        measure: "Passport coverage, broker-approved classifications, pre-arrival acceptance, clearance exceptions, and temporary-entry closure",
      },
      {
        id: "aerospace-gateway-network",
        priority: 7,
        workstreamId: "shipment_planning",
        title: "Choose gateways and factory lanes on variability, not rate alone",
        currentCondition: `${company} may be moving from prototype integration toward a repeatable production footprint. A cheap average freight rate can still lose if the gateway, drayage, special handling, customs timing, or supplier distance creates line-stop variability.`,
        recommendation: "Model each credible factory and gateway combination against supplier ship-from sites, shipment dimensions, service frequency, flight-test access, customs path, special handling, drayage, damage exposure, and recovery options. Reserve air for build-critical parts, schedule consolidated inbound lanes, and route bulky or planned ground equipment by ocean or truck.",
        decision: "Select the lanes to validate first and the service-level threshold that outweighs a lower spot rate.",
        requiredInput: "Candidate facilities, supplier sites, 90 days of shipments, dimensions and weights, Incoterms, build dates, freight spend, and delay history",
        measure: "Total landed cost per build, receipt variability, premium-freight share, supplier distance, inventory days, and inbound damage",
      },
      {
        id: "aerospace-field-logistics",
        priority: 8,
        workstreamId: "fulfillment",
        title: "Stage deployment spares before aircraft delivery",
        currentCondition: `${company} appears to target defense, remote logistics, and international operating programs. Delivering the aircraft without the line-replaceable units, tools, return packaging, local import model, and repair route makes mission availability depend on emergency freight after failure.`,
        recommendation: "Design a field-level swap and depot-repair network before delivery. Generate each deployment kit from the as-built configuration, position critical spares near actual operating regions, define failed-unit return routes, and feed removal and repair data back into replenishment.",
        decision: "Approve the first deployment hubs, target availability, field-replaceable list, repair depots, and inventory ownership model.",
        requiredInput: "Installed-asset plan, failure-critical parts, service BOM, expected removal rates, repair locations, and customer response commitments",
        measure: "Mission availability, aircraft-on-ground response, spare fill rate, repair turnaround, and no-fault-found removals",
      },
    ];
  }

  const regulated = profile.id === "medical" || profile.id === "chemicals";
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
      measure: "Critical parts with site visibility, approved alternates, risk-weighted lead time, and landed-cost variance",
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
      measure: "Supplier response time, promise accuracy, late releases, missing documents, and confirmed pickup readiness",
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
      measure: "Door-to-door cost, transit variability, consolidation savings, premium-freight share, and on-time receipt",
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
      measure: "Broker-ready products, classification coverage, pre-arrival acceptance, clearance time, and exception rate",
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
      measure: "On-time delivery, appointment success, claims, proof-of-delivery completion, and return-cycle time",
    },
  ];
}

export function buildSupplyOptimizationModel(dashboard: SupplyCaseDashboard): SupplyOptimizationModel {
  const profile = profileFor(dashboard);
  const facility = facilityNode(dashboard, profile);
  const explicitSources = explicitNodes(dashboard, "source", 1, profile.sourceClusters);
  const explicitCustomers = explicitNodes(dashboard, "destination", 10, profile.customerClusters);
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
