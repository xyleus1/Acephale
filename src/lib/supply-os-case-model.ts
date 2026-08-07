export const SUPPLY_CASE_SCHEMA_VERSION = 1 as const;
export const SUPPLY_CASE_STORAGE_KEY = "derya:supply-case-dashboards:v1";

export const SAMPLE_SUPPLY_CASE_PROMPT =
  "Company: Atlas Robotics\nLocated: Austin, Texas\nSources: servo motors, machine-vision cameras, and aluminum housings from Shenzhen, China\nShips to: factories in Detroit, Michigan and Nashville, Tennessee";

export type SupplyCaseStatus = "ready" | "verify" | "needs_confirmation";
export type SupplyEvidenceStatus = SupplyCaseStatus;

export type SupplyCaseFact<T> = {
  value: T | null;
  status: SupplyEvidenceStatus;
  evidence: string;
};

export type SupplyCoordinate = {
  latitude: number;
  longitude: number;
};

export type SupplyRouteNode = {
  id: string;
  kind: "headquarters" | "source" | "origin_gateway" | "receiving_gateway" | "customs" | "destination";
  label: string;
  detail: string;
  coordinates: SupplyCoordinate | null;
  lat: number | null;
  lng: number | null;
  status: SupplyEvidenceStatus;
  note: string;
};

export type SupplyRouteSegment = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  mode: "road" | "ocean" | "air" | "air_or_ocean" | "last_mile" | "to_confirm";
  label: string;
  status: "verify";
  note: string;
};

export type SupplySupplierOption = {
  id: string;
  title: string;
  region: string;
  capability: string;
  fitReason: string;
  leadTime: "Needs supplier confirmation";
  basis: string;
  status: "verify" | "needs_confirmation";
};

export type SupplyShippingOption = {
  id: string;
  provider: "DHL Global Forwarding" | "Kuehne+Nagel" | "DSV";
  service: string;
  route: string;
  mode: "Air freight" | "Air or ocean, to confirm" | "Road, to confirm" | "Mode to confirm";
  transit: "Live schedule required";
  indicativeCost: "Live quote required";
  reliability: "Live service data required";
  bestFor: string;
  basis: string;
  status: "verify";
};

export type SupplyRiskItem = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  category: "supply" | "transport" | "customs" | "compliance";
  why: string;
  check: string;
  status: "needs_confirmation";
  relatedNodeIds: string[];
};

export type SupplyCustomsCheck = {
  id: string;
  label: string;
  detail: string;
  needed: string[];
  owner: "shipper" | "customs_broker" | "shipper_and_broker";
  status: "needs_confirmation";
};

export type SupplyCaseDashboard = {
  schemaVersion: typeof SUPPLY_CASE_SCHEMA_VERSION;
  id: string;
  status: SupplyCaseStatus;
  title: string;
  sourcePrompt: string;
  createdAt: string;
  generatedAt: string;
  updatedAt: string;
  archivedAt?: string;
  companyName: string | null;
  companyDescription: string;
  companyLocation: string | null;
  sourcingNeeds: string[];
  sourceRegions: string[];
  destinations: string[];
  company: {
    name: SupplyCaseFact<string>;
    headquarters: SupplyCaseFact<string>;
    industry: SupplyCaseFact<string>;
    sourcingNeeds: Array<SupplyCaseFact<string>>;
    sourceRegions: Array<SupplyCaseFact<string>>;
    destinations: Array<SupplyCaseFact<string>>;
  };
  summary: {
    primaryLane: string;
    supplyPattern: string;
    recommendedAction: string;
    openCheckCount: number;
  };
  overview: string;
  route: {
    nodes: SupplyRouteNode[];
    segments: SupplyRouteSegment[];
  };
  routeNodes: SupplyRouteNode[];
  routeSegments: SupplyRouteSegment[];
  supplierOptions: SupplySupplierOption[];
  shippingOptions: SupplyShippingOption[];
  risks: SupplyRiskItem[];
  customsChecks: SupplyCustomsCheck[];
  openQuestions: string[];
  bestNextStep: string;
};

type IndustryProfile = {
  label: string;
  keywords: readonly string[];
  suggestedNeeds: readonly string[];
  supplierChecks: readonly string[];
  risks: ReadonlyArray<Pick<SupplyRiskItem, "severity" | "title" | "why" | "check">>;
  customs: ReadonlyArray<Pick<SupplyCustomsCheck, "label" | "detail" | "needed" | "owner">>;
};

const INDUSTRY_PROFILES: readonly IndustryProfile[] = [
  {
    label: "Aerospace and defense",
    keywords: ["aerospace", "defense", "defence", "satellite", "spacecraft", "drone", "avionics", "missile"],
    suggestedNeeds: ["precision machined parts", "avionics", "composite structures"],
    supplierChecks: ["Quality certification and traceability", "Export-control eligibility", "Counterfeit-part controls"],
    risks: [
      {
        severity: "high",
        title: "Export-control scope",
        why: "Defense articles, technical data, or dual-use goods can require controlled-party and license review.",
        check: "Confirm the governing export-control jurisdiction and classification, then screen every party before sharing specifications or shipping.",
      },
    ],
    customs: [
      {
        label: "Export-control classification",
        detail: "The product description indicates possible defense or dual-use controls under one or more jurisdictions.",
        needed: ["Technical specification", "End use", "End user", "Jurisdictions involved"],
        owner: "shipper_and_broker",
      },
    ],
  },
  {
    label: "Medical devices",
    keywords: ["medtech", "medical device", "medical devices", "diagnostic", "surgical", "implant", "clinical"],
    suggestedNeeds: ["precision components", "medical-grade electronics", "sterile packaging"],
    supplierChecks: ["ISO 13485 status", "Lot traceability", "Change-control process", "Sterilization validation where applicable"],
    risks: [
      {
        severity: "high",
        title: "Medical-device import admissibility",
        why: "Device, manufacturer, approval, and listing details can determine whether a destination authority holds an entry for review.",
        check: "Confirm the destination authority, product classification, manufacturer registration, approval or listing, and intended use with the broker.",
      },
    ],
    customs: [
      {
        label: "Health-authority entry data",
        detail: "Medical-device imports can require destination health-authority data beyond the customs entry.",
        needed: ["Destination product classification", "Manufacturer registration", "Approval or listing", "Intended use"],
        owner: "shipper_and_broker",
      },
    ],
  },
  {
    label: "Chemicals",
    keywords: ["chemical", "chemicals", "coating", "resin", "solvent", "reagent", "polymer", "adhesive"],
    suggestedNeeds: ["industrial chemicals", "specialty formulations", "compliant packaging"],
    supplierChecks: ["Current safety data sheet", "Composition and CAS disclosure", "Batch certificate", "Dangerous-goods packing capability"],
    risks: [
      {
        severity: "high",
        title: "Dangerous-goods classification",
        why: "A chemical can trigger carrier restrictions, packaging rules, documentation, and route limits.",
        check: "Obtain a current SDS and confirm UN number, hazard class, packing group, flash point, and transport mode rules.",
      },
    ],
    customs: [
      {
        label: "Chemical substance and agency review",
        detail: "Composition and intended use can trigger destination-country chemical inventory and agency requirements.",
        needed: ["SDS", "CAS numbers", "Composition statement", "Intended use", "Country of origin"],
        owner: "shipper_and_broker",
      },
    ],
  },
  {
    label: "Metals and minerals",
    keywords: ["metal", "metals", "mineral", "minerals", "steel", "aluminum", "aluminium", "copper", "nickel", "lithium", "rare earth"],
    suggestedNeeds: ["processed metal inputs", "cast or forged parts", "material certificates"],
    supplierChecks: ["Mill test certificate", "Smelter and melt origin", "Sanctions screening", "Dimensional inspection"],
    risks: [
      {
        severity: "high",
        title: "Trade-remedy exposure",
        why: "Metal products can be subject to safeguard measures, antidumping, or countervailing duties in the destination market.",
        check: "Confirm destination tariff classification, product scope, smelt and cast origin, and any applicable exclusions or case numbers.",
      },
    ],
    customs: [
      {
        label: "Metal origin and trade-remedy scope",
        detail: "Duty treatment can depend on material, dimensions, manufacturing process, and origin beyond the export country.",
        needed: ["Mill certificate", "Smelt and cast country", "Dimensions and grade", "Manufacturer identity"],
        owner: "shipper_and_broker",
      },
    ],
  },
  {
    label: "Automotive and industrial manufacturing",
    keywords: ["automotive", "auto parts", "vehicle", "car parts", "manufacturing", "factory", "industrial equipment"],
    suggestedNeeds: ["production components", "tooling", "service parts"],
    supplierChecks: ["Production part approval process", "Capacity and lead time", "Lot traceability", "Business-continuity plan"],
    risks: [
      {
        severity: "medium",
        title: "Production-line interruption",
        why: "Late or nonconforming components can stop an assembly line and create costs far above the freight charge.",
        check: "Confirm safety stock, lead-time variance, recovery capacity, and an expedited routing option for critical parts.",
      },
    ],
    customs: [
      {
        label: "Part-level tariff classification",
        detail: "Automotive and machinery parts are often classified by function, material, and principal use.",
        needed: ["Part drawing", "Material composition", "Machine or vehicle application", "Country of origin"],
        owner: "customs_broker",
      },
    ],
  },
  {
    label: "Robotics",
    keywords: ["robot", "robotics", "automation system", "autonomous machine"],
    suggestedNeeds: ["servo motors", "machine-vision components", "sensors", "machined housings"],
    supplierChecks: ["Specification match", "Lifecycle and obsolescence plan", "Capacity and lead time", "Quality traceability"],
    risks: [
      {
        severity: "medium",
        title: "Electronics and motor dependency",
        why: "Single-source controls, motors, or sensors can constrain production even when lower-value parts are available.",
        check: "Identify sole-source parts, approved alternates, minimum order quantities, and current lead-time variance.",
      },
    ],
    customs: [
      {
        label: "Machine and component classification",
        detail: "Complete robots, controllers, motors, cameras, and parts can fall under different tariff provisions.",
        needed: ["Bill of materials", "Part function", "Technical specification", "Country of origin"],
        owner: "customs_broker",
      },
    ],
  },
  {
    label: "Electronics",
    keywords: ["electronics", "semiconductor", "circuit board", "pcb", "sensor", "computer hardware", "battery"],
    suggestedNeeds: ["electronic assemblies", "semiconductors", "connectors and sensors"],
    supplierChecks: ["Authorized supply status", "Counterfeit-part controls", "Lifecycle notice process", "Electrical test records"],
    risks: [
      {
        severity: "medium",
        title: "Counterfeit and obsolescence exposure",
        why: "Brokered or end-of-life components can create quality failures and unplanned redesign work.",
        check: "Confirm authorized channel, date codes, traceability, inspection method, and lifecycle status.",
      },
    ],
    customs: [
      {
        label: "Electronics classification and origin",
        detail: "Function, assembly state, and substantial transformation can change tariff treatment.",
        needed: ["Datasheet", "Assembly steps", "Bill of materials", "Manufacturer and country of origin"],
        owner: "customs_broker",
      },
    ],
  },
];

const GENERIC_INDUSTRIAL_PROFILE: IndustryProfile = {
  label: "Industrial company, type to confirm",
  keywords: [],
  suggestedNeeds: ["critical production inputs", "packaging or service parts"],
  supplierChecks: ["Specification match", "Capacity and lead time", "Quality controls", "Financial and compliance screening"],
  risks: [
    {
      severity: "medium",
      title: "Unverified supplier and lane assumptions",
      why: "The current description does not yet identify enough product or shipment detail to validate a sourcing plan.",
      check: "Confirm the exact item, annual volume, origin, destination, and required delivery date before requesting offers.",
    },
  ],
  customs: [
    {
      label: "Tariff classification and origin",
      detail: "A broker needs the product function, composition, value, and origin before confirming entry requirements.",
      needed: ["Product description", "Material composition", "Country of origin", "Commercial value"],
      owner: "shipper_and_broker",
    },
  ],
};

type LocationEntry = {
  aliases: readonly string[];
  label: string;
  coordinates: SupplyCoordinate;
  exportGateway: string;
  exportGatewayCoordinates: SupplyCoordinate;
  importGateway: string;
  importGatewayCoordinates: SupplyCoordinate;
};

const LOCATIONS: readonly LocationEntry[] = [
  {
    aliases: ["shenzhen"],
    label: "Shenzhen, China",
    coordinates: { latitude: 22.5431, longitude: 114.0579 },
    exportGateway: "Yantian Port",
    exportGatewayCoordinates: { latitude: 22.577, longitude: 114.272 },
    importGateway: "Yantian Port",
    importGatewayCoordinates: { latitude: 22.577, longitude: 114.272 },
  },
  {
    aliases: ["shanghai"],
    label: "Shanghai, China",
    coordinates: { latitude: 31.2304, longitude: 121.4737 },
    exportGateway: "Port of Shanghai",
    exportGatewayCoordinates: { latitude: 31.354, longitude: 121.692 },
    importGateway: "Port of Shanghai",
    importGatewayCoordinates: { latitude: 31.354, longitude: 121.692 },
  },
  {
    aliases: ["china", "prc"],
    label: "China",
    coordinates: { latitude: 35.8617, longitude: 104.1954 },
    exportGateway: "China export gateway to confirm",
    exportGatewayCoordinates: { latitude: 30.6, longitude: 121.2 },
    importGateway: "China receiving gateway to confirm",
    importGatewayCoordinates: { latitude: 30.6, longitude: 121.2 },
  },
  {
    aliases: ["taiwan"],
    label: "Taiwan",
    coordinates: { latitude: 23.6978, longitude: 120.9605 },
    exportGateway: "Port of Kaohsiung",
    exportGatewayCoordinates: { latitude: 22.6163, longitude: 120.2897 },
    importGateway: "Port of Kaohsiung",
    importGatewayCoordinates: { latitude: 22.6163, longitude: 120.2897 },
  },
  {
    aliases: ["vietnam", "ho chi minh city"],
    label: "Vietnam",
    coordinates: { latitude: 14.0583, longitude: 108.2772 },
    exportGateway: "Cat Lai Terminal",
    exportGatewayCoordinates: { latitude: 10.761, longitude: 106.785 },
    importGateway: "Cat Lai Terminal",
    importGatewayCoordinates: { latitude: 10.761, longitude: 106.785 },
  },
  {
    aliases: ["malaysia", "kuala lumpur"],
    label: "Malaysia",
    coordinates: { latitude: 4.2105, longitude: 101.9758 },
    exportGateway: "Port Klang",
    exportGatewayCoordinates: { latitude: 3.0, longitude: 101.4 },
    importGateway: "Port Klang",
    importGatewayCoordinates: { latitude: 3.0, longitude: 101.4 },
  },
  {
    aliases: ["south korea", "korea", "busan"],
    label: "South Korea",
    coordinates: { latitude: 35.9078, longitude: 127.7669 },
    exportGateway: "Port of Busan",
    exportGatewayCoordinates: { latitude: 35.1028, longitude: 129.0403 },
    importGateway: "Port of Busan",
    importGatewayCoordinates: { latitude: 35.1028, longitude: 129.0403 },
  },
  {
    aliases: ["japan", "yokohama", "tokyo"],
    label: "Japan",
    coordinates: { latitude: 36.2048, longitude: 138.2529 },
    exportGateway: "Port of Yokohama",
    exportGatewayCoordinates: { latitude: 35.4437, longitude: 139.638 },
    importGateway: "Port of Yokohama",
    importGatewayCoordinates: { latitude: 35.4437, longitude: 139.638 },
  },
  {
    aliases: ["india", "mumbai"],
    label: "India",
    coordinates: { latitude: 20.5937, longitude: 78.9629 },
    exportGateway: "Nhava Sheva",
    exportGatewayCoordinates: { latitude: 18.949, longitude: 72.95 },
    importGateway: "Nhava Sheva",
    importGatewayCoordinates: { latitude: 18.949, longitude: 72.95 },
  },
  {
    aliases: ["mexico", "monterrey"],
    label: "Mexico",
    coordinates: { latitude: 23.6345, longitude: -102.5528 },
    exportGateway: "Laredo border crossing",
    exportGatewayCoordinates: { latitude: 27.5064, longitude: -99.5075 },
    importGateway: "Laredo border crossing",
    importGatewayCoordinates: { latitude: 27.5064, longitude: -99.5075 },
  },
  {
    aliases: ["germany", "hamburg"],
    label: "Germany",
    coordinates: { latitude: 51.1657, longitude: 10.4515 },
    exportGateway: "Port of Hamburg",
    exportGatewayCoordinates: { latitude: 53.5461, longitude: 9.9661 },
    importGateway: "Port of Hamburg",
    importGatewayCoordinates: { latitude: 53.5461, longitude: 9.9661 },
  },
  {
    aliases: ["netherlands", "rotterdam"],
    label: "Netherlands",
    coordinates: { latitude: 52.1326, longitude: 5.2913 },
    exportGateway: "Port of Rotterdam",
    exportGatewayCoordinates: { latitude: 51.9244, longitude: 4.4777 },
    importGateway: "Port of Rotterdam",
    importGatewayCoordinates: { latitude: 51.9244, longitude: 4.4777 },
  },
  {
    aliases: ["united states", "the us", "us", "usa", "u.s.", "u.s.a."],
    label: "United States",
    coordinates: { latitude: 39.8283, longitude: -98.5795 },
    exportGateway: "US export gateway to confirm",
    exportGatewayCoordinates: { latitude: 39.8283, longitude: -98.5795 },
    importGateway: "US receiving gateway to confirm",
    importGatewayCoordinates: { latitude: 39.8283, longitude: -98.5795 },
  },
  {
    aliases: ["austin", "texas"],
    label: "Austin, Texas",
    coordinates: { latitude: 30.2672, longitude: -97.7431 },
    exportGateway: "Port Houston",
    exportGatewayCoordinates: { latitude: 29.7305, longitude: -95.2651 },
    importGateway: "Port Houston",
    importGatewayCoordinates: { latitude: 29.7305, longitude: -95.2651 },
  },
  {
    aliases: ["detroit", "michigan"],
    label: "Detroit, Michigan",
    coordinates: { latitude: 42.3314, longitude: -83.0458 },
    exportGateway: "Detroit intermodal ramp",
    exportGatewayCoordinates: { latitude: 42.3314, longitude: -83.0458 },
    importGateway: "Port of Los Angeles and Long Beach",
    importGatewayCoordinates: { latitude: 33.7361, longitude: -118.2637 },
  },
  {
    aliases: ["nashville", "tennessee"],
    label: "Nashville, Tennessee",
    coordinates: { latitude: 36.1627, longitude: -86.7816 },
    exportGateway: "Savannah gateway",
    exportGatewayCoordinates: { latitude: 32.0809, longitude: -81.0912 },
    importGateway: "Savannah gateway",
    importGatewayCoordinates: { latitude: 32.0809, longitude: -81.0912 },
  },
  {
    aliases: ["los angeles", "long beach", "california"],
    label: "Los Angeles, California",
    coordinates: { latitude: 34.0522, longitude: -118.2437 },
    exportGateway: "Port of Los Angeles and Long Beach",
    exportGatewayCoordinates: { latitude: 33.7361, longitude: -118.2637 },
    importGateway: "Port of Los Angeles and Long Beach",
    importGatewayCoordinates: { latitude: 33.7361, longitude: -118.2637 },
  },
  {
    aliases: ["new york", "new jersey"],
    label: "New York and New Jersey",
    coordinates: { latitude: 40.7128, longitude: -74.006 },
    exportGateway: "Port of New York and New Jersey",
    exportGatewayCoordinates: { latitude: 40.6681, longitude: -74.0451 },
    importGateway: "Port of New York and New Jersey",
    importGatewayCoordinates: { latitude: 40.6681, longitude: -74.0451 },
  },
  {
    aliases: ["san francisco", "oakland"],
    label: "San Francisco Bay Area",
    coordinates: { latitude: 37.7749, longitude: -122.4194 },
    exportGateway: "Port of Oakland",
    exportGatewayCoordinates: { latitude: 37.7955, longitude: -122.2787 },
    importGateway: "Port of Oakland",
    importGatewayCoordinates: { latitude: 37.7955, longitude: -122.2787 },
  },
  {
    aliases: ["boston", "massachusetts"],
    label: "Boston, Massachusetts",
    coordinates: { latitude: 42.3601, longitude: -71.0589 },
    exportGateway: "Port of Boston",
    exportGatewayCoordinates: { latitude: 42.36, longitude: -71.05 },
    importGateway: "Port of Boston",
    importGatewayCoordinates: { latitude: 42.36, longitude: -71.05 },
  },
  {
    aliases: ["chicago", "illinois"],
    label: "Chicago, Illinois",
    coordinates: { latitude: 41.8781, longitude: -87.6298 },
    exportGateway: "Chicago rail ramp",
    exportGatewayCoordinates: { latitude: 41.8781, longitude: -87.6298 },
    importGateway: "Chicago rail ramp",
    importGatewayCoordinates: { latitude: 41.8781, longitude: -87.6298 },
  },
];

function normalizeText(value: string): string {
  return value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function cleanPhrase(value: string): string {
  return value
    .trim()
    .replace(/^[,.:;\s]+|[,.:;\s]+$/g, "")
    .replace(/^(?:its|their|the)\s+/i, "")
    .replace(/^and\s+/i, "")
    .replace(/\s+/g, " ");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(cleanPhrase).filter(Boolean))];
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function slug(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return result || "supply-case";
}

function fact<T>(value: T | null, status: SupplyEvidenceStatus, evidence: string): SupplyCaseFact<T> {
  return { value, status, evidence };
}

function extractLabel(input: string, label: "Company" | "Located" | "Sources" | "Ships to"): string | null {
  const normalized = input.replace(/\s+(?=(?:Company|Located|Sources|Ships\s+to)\s*:)/gi, "\n");
  const escaped = label === "Ships to" ? "Ships\\s+to" : label;
  const match = normalized.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:\\s*([^\\n]+)`, "i"));
  return match ? cleanPhrase(match[1]) : null;
}

function extractCompanyName(input: string): SupplyCaseFact<string> {
  const labeled = extractLabel(input, "Company");
  if (labeled) return fact(labeled, "ready", "Provided in the Company field.");

  const sentence = input.match(/^\s*([A-Z][A-Za-z0-9&.' -]{1,70}?)(?=\s+(?:is|builds|makes|manufactures|designs|develops|produces)\b)/);
  if (sentence) return fact(cleanPhrase(sentence[1]), "ready", "Parsed from the company description.");
  return fact<string>(null, "needs_confirmation", "Company name was not provided.");
}

function extractHeadquarters(input: string): SupplyCaseFact<string> {
  const labeled = extractLabel(input, "Located");
  if (labeled) return fact(labeled, "ready", "Provided in the Located field.");

  const sentence = input.match(
    /\b(?:based|headquartered|located)\s+in\s+(.+?)(?=(?:,\s*(?:(?:and|then)\s+)?(?:sources?|procures?|imports?|buys?|needs?|requires?|ships?|exports?|delivers?)\b)|(?:\s+(?:and|that|which)\s+)|[.;\n]|$)/i,
  );
  if (sentence) return fact(cleanPhrase(sentence[1]), "ready", "Parsed from the company description.");

  const operatingSentence = input.match(
    /\b(?:builds?|makes?|manufactures?|designs?|develops?|produces?|operates?)\b[^.;\n]{0,100}?\s+in\s+(.+?)(?=(?:\s+(?:and\s+)?(?:sources?|procures?|imports?|buys?|needs?|requires?|ships?|exports?|delivers?)\b)|[.;\n]|$)/i,
  );
  if (operatingSentence) {
    return fact(cleanPhrase(operatingSentence[1]), "ready", "Parsed from the company description.");
  }
  return fact<string>(null, "needs_confirmation", "Headquarters or operating location was not provided.");
}

function detectIndustry(input: string): { fact: SupplyCaseFact<string>; profile: IndustryProfile } {
  const lower = input.toLowerCase();
  const profile = INDUSTRY_PROFILES
    .flatMap((candidate, profileIndex) => candidate.keywords.flatMap((keyword) => {
      const matchIndex = lower.indexOf(keyword);
      return matchIndex >= 0 ? [{ candidate, matchIndex, profileIndex }] : [];
    }))
    .sort((left, right) => left.matchIndex - right.matchIndex || left.profileIndex - right.profileIndex)[0]?.candidate;
  if (profile) return { fact: fact(profile.label, "ready", "Matched a stated product or industry keyword."), profile };
  return {
    fact: fact<string>(null, "needs_confirmation", "Industry could not be determined from the description."),
    profile: GENERIC_INDUSTRIAL_PROFILE,
  };
}

function splitNeeds(value: string): string[] {
  return unique(
    value
      .replace(/\s+from\s+.+$/i, "")
      .replace(/\b(?:suppliers?|vendors?)\s+(?:for|of)\s+/gi, "")
      .split(/\s*,\s*|\s+and\s+/i),
  );
}

function extractKnownLocations(value: string): string[] {
  const matches: Array<{ index: number; label: string }> = [];
  for (const entry of LOCATIONS) {
    const indexes = entry.aliases
      .map((alias) => entry.label === "South Korea" && alias === "korea" && /\bnorth\s+korea\b/i.test(value)
        ? -1
        : locationAliasIndex(value, alias))
      .filter((index) => index >= 0);
    if (!indexes.length) continue;
    matches.push({ index: Math.min(...indexes), label: entry.label });
  }
  const ordered = matches
    .sort((left, right) => left.index - right.index)
    .map((match) => match.label)
    .filter((label, _index, labels) => label !== "China" || !labels.some((candidate) => candidate.endsWith(", China")));
  return unique(ordered);
}

function cleanLocationCandidate(value: string): string {
  return cleanPhrase(value.replace(
    /^(?:factories|customers|warehouses|distributors|suppliers|vendors|ports?)\s+(?:in|across|near)\s+/i,
    "",
  ));
}

function extractLocationCandidates(value: string): string[] {
  const candidates: string[] = [];
  const groups = value.split(/\s+and\s+|\s*;\s*/i);
  for (const group of groups) {
    const knownInGroup = extractKnownLocations(group);
    if (knownInGroup.length === 0) {
      const candidate = cleanLocationCandidate(group);
      if (candidate) candidates.push(candidate);
      continue;
    }
    for (const component of group.split(/\s*,\s*/)) {
      const knownInComponent = extractKnownLocations(component);
      if (knownInComponent.length > 0) {
        candidates.push(...knownInComponent);
      } else {
        const candidate = cleanLocationCandidate(component);
        if (candidate) candidates.push(candidate);
      }
    }
  }
  const ordered = unique(candidates);
  return ordered.filter((label) => label !== "China" || !ordered.some((candidate) => candidate.endsWith(", China")));
}

function locationAliasIndex(value: string, alias: string): number {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return value.search(new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i"));
}

function locationAliasAppears(value: string, alias: string): boolean {
  return locationAliasIndex(value, alias) >= 0;
}

function extractSourcing(input: string, profile: IndustryProfile): {
  needs: Array<SupplyCaseFact<string>>;
  regions: Array<SupplyCaseFact<string>>;
} {
  const labeled = extractLabel(input, "Sources");
  const sentence = input.match(
    /\b(?:sources?|procures?|imports?|buys?|needs?|requires?)\s+(?:(?:to\s+)?(?:source|procure|import|buy)\s+)?(.+?)(?=(?:(?:,\s*|\s+)(?:(?:and|then)\s+)?(?:ships?|exports?|delivers?)\b)|[.;\n]|$)/i,
  )?.[1];
  const clause = labeled ?? (sentence ? cleanPhrase(sentence) : null);
  if (!clause) {
    return {
      needs: profile.suggestedNeeds.map((need) => fact(need, "verify", "Suggested from the industry profile, not stated by the user.")),
      regions: [fact<string>(null, "needs_confirmation", "No source region was provided.")],
    };
  }

  const fromMatch = clause.match(/^(.+?)\s+from\s+(.+)$/i);
  const needsText = fromMatch?.[1] ?? clause;
  const regionText = fromMatch?.[2] ?? clause;
  const needs = splitNeeds(needsText);
  const regions = extractLocationCandidates(regionText);

  return {
    needs: (needs.length ? needs : profile.suggestedNeeds).map((need) =>
      fact(need, needs.length ? "ready" : "verify", needs.length ? "Parsed from the stated sourcing need." : "Suggested from the industry profile."),
    ),
    regions: (regions.length ? regions : [null]).map((region) => {
      if (!region) return fact<string>(null, "needs_confirmation", "No source region was provided.");
      return resolveLocation(region)
        ? fact(region, "ready", "Parsed from the stated source region.")
        : fact(region, "needs_confirmation", "Location was preserved from the prompt but needs geographic normalization.");
    }),
  };
}

function extractDestinations(input: string): Array<SupplyCaseFact<string>> {
  const labeled = extractLabel(input, "Ships to");
  let clause = labeled;
  if (!clause) {
    const match = input.match(/\b(?:(?:might|may|could)\s+)?(?:ships?|exports?|delivers?)\s+(.+?)(?=[.;\n]|$)/i);
    if (match) {
      const lower = match[1].toLowerCase();
      const toIndex = lower.lastIndexOf(" to ");
      const acrossIndex = lower.lastIndexOf(" across ");
      if (lower.startsWith("to ")) clause = cleanPhrase(match[1].slice(3));
      else if (toIndex >= 0) clause = cleanPhrase(match[1].slice(toIndex + 4));
      else if (acrossIndex >= 0) clause = cleanPhrase(match[1].slice(acrossIndex + 8));
    }
  }
  if (!clause) return [fact<string>(null, "needs_confirmation", "No ship-to market or destination was provided.")];

  const destinations = extractLocationCandidates(clause);
  return destinations.map((destination) => resolveLocation(destination)
    ? fact(destination, "ready", "Parsed from the stated ship-to destination.")
    : fact(destination, "needs_confirmation", "Location was preserved from the prompt but needs geographic normalization."));
}

function resolveLocation(label: string | null): LocationEntry | null {
  if (!label) return null;
  if (/\bnorth\s+korea\b/i.test(label)) return null;
  return LOCATIONS.find((entry) =>
    entry.aliases.some((alias) => locationAliasAppears(label, alias)) || locationAliasAppears(label, entry.label)
  ) ?? null;
}

const UNITED_STATES_LOCATION_LABELS = new Set([
  "United States",
  "Austin, Texas",
  "Detroit, Michigan",
  "Nashville, Tennessee",
  "Los Angeles, California",
  "New York and New Jersey",
  "San Francisco Bay Area",
  "Boston, Massachusetts",
  "Chicago, Illinois",
]);

const ASIA_LOCATION_LABELS = new Set([
  "Shenzhen, China",
  "Shanghai, China",
  "China",
  "Taiwan",
  "Vietnam",
  "Malaysia",
  "South Korea",
  "Japan",
  "India",
]);

const EUROPEAN_UNION_LOCATION_LABELS = new Set(["Germany", "Netherlands"]);

type CustomsScope = "import" | "domestic" | "unknown";
type RequestedInternationalMode = "air" | "unspecified";

function requestedInternationalMode(input: string): RequestedInternationalMode {
  return /\b(?:by|via|using)\s+air(?:\s+(?:freight|cargo))?\b/i.test(input) ? "air" : "unspecified";
}

function customsTerritory(location: LocationEntry | null): string | null {
  if (!location) return null;
  if (UNITED_STATES_LOCATION_LABELS.has(location.label)) return "United States";
  if (location.label.endsWith(", China") || location.label === "China") return "China";
  if (EUROPEAN_UNION_LOCATION_LABELS.has(location.label)) return "European Union";
  return location.label;
}

export function resolveSupplyCustomsTerritory(label: string | null): string | null {
  return customsTerritory(resolveLocation(label));
}

function laneCustomsScope(source: LocationEntry | null, destination: LocationEntry | null): CustomsScope {
  const sourceTerritory = customsTerritory(source);
  const destinationTerritory = customsTerritory(destination);
  if (!sourceTerritory || !destinationTerritory) return "unknown";
  return sourceTerritory === destinationTerritory ? "domestic" : "import";
}

function modeledOriginGateway(
  source: LocationEntry | null,
  destination: LocationEntry | null,
  scope: CustomsScope,
  requestedMode: RequestedInternationalMode,
) {
  if (!source || scope === "unknown") return null;
  if (scope === "domestic") {
    return {
      label: `Origin hub near ${source.label}`,
      coordinates: source.coordinates,
    };
  }
  if (requestedMode === "air") {
    return {
      label: `Air cargo gateway near ${source.label}`,
      coordinates: source.coordinates,
    };
  }
  const sourceTerritory = customsTerritory(source);
  const destinationTerritory = customsTerritory(destination);
  if (
    (sourceTerritory === "Mexico" && destinationTerritory === "United States")
    || (sourceTerritory === "United States" && destinationTerritory === "Mexico")
  ) {
    return {
      label: "Laredo border crossing",
      coordinates: { latitude: 27.5064, longitude: -99.5075 },
    };
  }
  return {
    label: source.exportGateway,
    coordinates: source.exportGatewayCoordinates,
  };
}

function modeledReceivingGateway(
  source: LocationEntry | null,
  destination: LocationEntry | null,
  requestedMode: RequestedInternationalMode,
) {
  if (!destination) return null;
  const sourceTerritory = customsTerritory(source);
  const destinationTerritory = customsTerritory(destination);
  if (sourceTerritory && sourceTerritory === destinationTerritory) {
    return {
      label: `Destination hub near ${destination.label}`,
      coordinates: destination.coordinates,
    };
  }
  if (requestedMode === "air") {
    return {
      label: `Air cargo gateway near ${destination.label}`,
      coordinates: destination.coordinates,
    };
  }
  if (
    (sourceTerritory === "Mexico" && destinationTerritory === "United States")
    || (sourceTerritory === "United States" && destinationTerritory === "Mexico")
  ) {
    return {
      label: "Laredo border crossing",
      coordinates: { latitude: 27.5064, longitude: -99.5075 },
    };
  }
  if (destination.label === "United States") {
    return {
      label: destination.importGateway,
      coordinates: destination.importGatewayCoordinates,
    };
  }

  const isEuropeanSource = Boolean(source && EUROPEAN_UNION_LOCATION_LABELS.has(source.label));
  const isAsianSource = Boolean(source && ASIA_LOCATION_LABELS.has(source.label));
  if ((destination.label === "Detroit, Michigan" || destination.label === "Chicago, Illinois") && isEuropeanSource) {
    return {
      label: "Port of New York and New Jersey",
      coordinates: { latitude: 40.6681, longitude: -74.0451 },
    };
  }
  if ((destination.label === "Detroit, Michigan" || destination.label === "Chicago, Illinois") && isAsianSource) {
    return {
      label: "Port of Los Angeles and Long Beach",
      coordinates: { latitude: 33.7361, longitude: -118.2637 },
    };
  }
  if (destination.label === "Detroit, Michigan" || destination.label === "Chicago, Illinois") {
    return {
      label: "US receiving gateway to confirm",
      coordinates: destination.coordinates,
    };
  }
  return {
    label: destination.importGateway,
    coordinates: destination.importGatewayCoordinates,
  };
}

type SupplyRouteNodeInput = Omit<SupplyRouteNode, "detail" | "lat" | "lng"> &
  Partial<Pick<SupplyRouteNode, "detail" | "lat" | "lng">>;

function pushUniqueNode(nodes: SupplyRouteNode[], input: SupplyRouteNodeInput): SupplyRouteNode {
  const node: SupplyRouteNode = {
    ...input,
    detail: input.detail ?? input.note,
    lat: input.lat ?? input.coordinates?.latitude ?? null,
    lng: input.lng ?? input.coordinates?.longitude ?? null,
  };
  const existing = nodes.find((candidate) => candidate.id === node.id);
  if (existing) return existing;
  nodes.push(node);
  return node;
}

function buildRoute(
  headquarters: SupplyCaseFact<string>,
  sourceRegions: Array<SupplyCaseFact<string>>,
  destinations: Array<SupplyCaseFact<string>>,
  requestedMode: RequestedInternationalMode,
): SupplyCaseDashboard["route"] {
  const nodes: SupplyRouteNode[] = [];
  const segments: SupplyRouteSegment[] = [];

  if (headquarters.value) {
    const resolved = resolveLocation(headquarters.value);
    pushUniqueNode(nodes, {
      id: `hq-${slug(headquarters.value)}`,
      kind: "headquarters",
      label: headquarters.value,
      coordinates: resolved?.coordinates ?? null,
      status: headquarters.status,
      note: resolved ? "Company location supplied by the user." : "Location supplied by the user, coordinates need normalization.",
    });
  }

  const usableSources = sourceRegions.filter((item): item is SupplyCaseFact<string> & { value: string } => Boolean(item.value));
  const usableDestinations = destinations.filter((item): item is SupplyCaseFact<string> & { value: string } => Boolean(item.value));

  if (usableSources.length === 0) {
    pushUniqueNode(nodes, {
      id: "source-needed",
      kind: "source",
      label: "Source location needed",
      coordinates: null,
      status: "needs_confirmation",
      note: "Add the supplier city or country to build a route.",
    });
  }
  if (usableDestinations.length === 0) {
    pushUniqueNode(nodes, {
      id: "destination-needed",
      kind: "destination",
      label: "Destination needed",
      coordinates: null,
      status: "needs_confirmation",
      note: "Add a receiving city, port, warehouse, or customer market.",
    });
  }

  for (const source of usableSources) {
    const sourceLocation = resolveLocation(source.value);
    const sourceNode = pushUniqueNode(nodes, {
      id: `source-${slug(source.value)}`,
      kind: "source",
      label: source.value,
      coordinates: sourceLocation?.coordinates ?? null,
      status: source.status,
      note: sourceLocation ? "Source region supplied by the user." : "Source supplied by the user, coordinates need normalization.",
    });
    for (const destination of usableDestinations) {
      const destinationLocation = resolveLocation(destination.value);
      const sourceTerritory = customsTerritory(sourceLocation);
      const destinationTerritory = customsTerritory(destinationLocation);
      const scope = laneCustomsScope(sourceLocation, destinationLocation);
      const crossBorderRoad = scope === "import" && requestedMode !== "air" && (
        (sourceTerritory === "Mexico" && destinationTerritory === "United States")
        || (sourceTerritory === "United States" && destinationTerritory === "Mexico")
      );
      const intraEu = scope === "domestic"
        && sourceTerritory === "European Union"
        && sourceLocation?.label !== destinationLocation?.label;
      const originGatewayModel = modeledOriginGateway(sourceLocation, destinationLocation, scope, requestedMode);
      const originGateway = pushUniqueNode(nodes, {
        id: `origin-gateway-${slug(source.value)}-${slug(destination.value)}`,
        kind: "origin_gateway",
        label: originGatewayModel?.label ?? "Origin gateway to confirm",
        coordinates: originGatewayModel?.coordinates ?? null,
        status: originGatewayModel ? "verify" : "needs_confirmation",
        note: scope === "unknown"
          ? "Exact source and destination locations are needed before selecting an origin gateway."
          : "Modeled origin handoff only. Confirm routing with a carrier or forwarder before quoting or booking.",
      });
      segments.push({
        id: `segment-${sourceNode.id}-${originGateway.id}`,
        fromNodeId: sourceNode.id,
        toNodeId: originGateway.id,
        mode: "road",
        label: "Supplier pickup",
        status: "verify",
        note: "Modeled supplier pickup. Equipment, address, and cargo-ready date are not confirmed.",
      });
      const receivingGatewayModel = scope === "unknown" ? null : modeledReceivingGateway(sourceLocation, destinationLocation, requestedMode);
      const receivingGateway = pushUniqueNode(nodes, {
        id: `receiving-gateway-${slug(source.value)}-${slug(destination.value)}`,
        kind: "receiving_gateway",
        label: receivingGatewayModel?.label ?? "Receiving gateway to confirm",
        coordinates: receivingGatewayModel?.coordinates ?? null,
        status: receivingGatewayModel ? "verify" : "needs_confirmation",
        note: scope === "import"
          ? "Modeled receiving gateway only. Customs port and final route need a live routing review."
          : scope === "domestic"
            ? "Modeled transfer point within one customs territory. Carrier, equipment, and final route need confirmation."
            : "Exact source and destination locations are needed before selecting a receiving gateway or customs workflow.",
      });
      const destinationNode = pushUniqueNode(nodes, {
        id: `destination-${slug(destination.value)}`,
        kind: "destination",
        label: destination.value,
        coordinates: destinationLocation?.coordinates ?? null,
        status: destination.status,
        note: destinationLocation ? "Ship-to location supplied by the user." : "Destination supplied by the user, coordinates need normalization.",
      });
      segments.push({
        id: `segment-${originGateway.id}-${receivingGateway.id}`,
        fromNodeId: originGateway.id,
        toNodeId: receivingGateway.id,
        mode: scope === "unknown" ? "to_confirm" : requestedMode === "air" && scope === "import" ? "air" : scope === "import" && !crossBorderRoad ? "air_or_ocean" : "road",
        label: scope === "unknown"
          ? "Freight mode to confirm"
          : requestedMode === "air" && scope === "import"
            ? "International air freight"
          : crossBorderRoad
            ? "Cross-border road freight"
            : scope === "import"
              ? "International freight"
              : intraEu
                ? "Intra-EU freight"
                : "Domestic freight",
        status: "verify",
        note: requestedMode === "air" && scope === "import"
          ? "Modeled international air leg from the stated request. Airports, carrier, service, chargeable weight, schedule, rate, and capacity require live offers."
          : crossBorderRoad
          ? "Modeled cross-border road leg. Carrier, equipment, border crossing, schedule, and rate require live offers."
          : scope === "import"
            ? "Modeled international leg. Mode, carrier, schedule, rate, and capacity require live offers."
            : scope === "domestic"
              ? "Modeled same-territory leg. Carrier, equipment, schedule, and rate require live offers."
              : "Source, destination, mode, carrier, schedule, and rate all need confirmation.",
      });
      if (scope === "import") {
        const customsNode = pushUniqueNode(nodes, {
          id: `customs-${slug(source.value)}-${slug(destination.value)}`,
          kind: "customs",
          label: receivingGatewayModel
            ? `Customs clearance near ${receivingGatewayModel.label}`
            : "Customs checkpoint to confirm",
          coordinates: receivingGatewayModel
            ? {
                latitude: receivingGatewayModel.coordinates.latitude + 0.65,
                longitude: receivingGatewayModel.coordinates.longitude + 0.65,
              }
            : null,
          status: receivingGatewayModel ? "verify" : "needs_confirmation",
          note: "Modeled customs checkpoint. Importer, broker, entry port, agencies, and admissibility remain unconfirmed.",
        });
        segments.push({
          id: `segment-${receivingGateway.id}-${customsNode.id}`,
          fromNodeId: receivingGateway.id,
          toNodeId: customsNode.id,
          mode: "road",
          label: "Customs entry",
          status: "verify",
          note: "Modeled customs handoff. Broker acceptance, documents, holds, duties, and release are not confirmed.",
        });
        segments.push({
          id: `segment-${customsNode.id}-${destinationNode.id}`,
          fromNodeId: customsNode.id,
          toNodeId: destinationNode.id,
          mode: "to_confirm",
          label: "Inland delivery",
          status: "verify",
          note: "Modeled post-entry delivery. Inland mode, carrier, appointment, equipment, and receiving constraints need confirmation.",
        });
      } else {
        segments.push({
          id: `segment-${receivingGateway.id}-${destinationNode.id}`,
          fromNodeId: receivingGateway.id,
          toNodeId: destinationNode.id,
          mode: "last_mile",
          label: scope === "domestic" ? "Domestic delivery" : "Delivery path to confirm",
          status: "verify",
          note: scope === "domestic"
            ? "No import entry is modeled. Carrier, appointment, equipment, and receiving constraints need confirmation."
            : "Customs scope, carrier, appointment, equipment, and receiving constraints need confirmation.",
        });
      }
    }
  }

  return {
    nodes,
    segments: [...new Map(segments.map((segment) => [segment.id, segment])).values()],
  };
}

function buildSupplierProfiles(
  needs: Array<SupplyCaseFact<string>>,
  regions: Array<SupplyCaseFact<string>>,
  profile: IndustryProfile,
): SupplySupplierOption[] {
  const usableRegions = regions.flatMap((region) => (region.value ? [region.value] : []));
  return needs.flatMap((need, index) => {
    if (!need.value) return [];
    return [{
      id: `supplier-profile-${index + 1}-${slug(need.value)}`,
      title: `Supplier search: ${need.value}`,
      region: usableRegions.join(", ") || "Region to confirm",
      capability: `Manufacture or distribute ${need.value}`,
      fitReason: `Screen for ${profile.supplierChecks.join("; ").toLowerCase()}.`,
      leadTime: "Needs supplier confirmation",
      basis: need.status === "ready"
        ? "Built from the stated sourcing requirement. Candidate companies are not yet connected."
        : "Suggested from the industry profile. Confirm the requirement before finding candidates.",
      status: need.status === "ready" && usableRegions.length ? "verify" : "needs_confirmation",
    }];
  });
}

function buildShippingOptions(route: SupplyCaseDashboard["route"]): SupplyShippingOption[] {
  const source = route.nodes.find((node) => node.kind === "source")?.label ?? "source to confirm";
  const destination = route.nodes.find((node) => node.kind === "destination")?.label ?? "destination to confirm";
  const routeAssumption = `${source} to ${destination}`;
  const linehaul = route.segments.find((segment) =>
    segment.label === "International freight"
      || segment.label === "International air freight"
      || segment.label === "Cross-border road freight"
      || segment.label === "Intra-EU freight"
      || segment.label === "Domestic freight"
      || segment.label === "Freight mode to confirm"
  );
  const modeledMode: SupplyShippingOption["mode"] = linehaul?.mode === "road"
    ? "Road, to confirm"
    : linehaul?.mode === "air"
      ? "Air freight"
    : linehaul?.mode === "air_or_ocean" || linehaul?.mode === "ocean"
      ? "Air or ocean, to confirm"
      : "Mode to confirm";
  const basis = "Indicative modeled option only. No live rate, capacity, schedule, reliability, or service commitment has been received.";
  return [
    {
      id: "forwarder-dhl-global-forwarding",
      provider: "DHL Global Forwarding",
      service: "Multimodal forwarding and customs coordination",
      route: routeAssumption,
      mode: modeledMode,
      transit: "Live schedule required",
      indicativeCost: "Live quote required",
      reliability: "Live service data required",
      bestFor: "A broad international network and multimodal alternatives.",
      basis,
      status: "verify",
    },
    {
      id: "forwarder-kuehne-nagel",
      provider: "Kuehne+Nagel",
      service: "Multimodal forwarding with contract-logistics options",
      route: routeAssumption,
      mode: modeledMode,
      transit: "Live schedule required",
      indicativeCost: "Live quote required",
      reliability: "Live service data required",
      bestFor: "Complex supplier programs and shipment visibility requirements.",
      basis,
      status: "verify",
    },
    {
      id: "forwarder-dsv",
      provider: "DSV",
      service: "Air, sea, road, and project forwarding",
      route: routeAssumption,
      mode: modeledMode,
      transit: "Live schedule required",
      indicativeCost: "Live quote required",
      reliability: "Live service data required",
      bestFor: "Plans that may combine international freight and final-mile transportation.",
      basis,
      status: "verify",
    },
  ];
}

function buildRisks(
  profile: IndustryProfile,
  route: SupplyCaseDashboard["route"],
  regions: Array<SupplyCaseFact<string>>,
  destinations: Array<SupplyCaseFact<string>>,
): SupplyRiskItem[] {
  const sourceNodeIds = route.nodes.filter((node) => node.kind === "source").map((node) => node.id);
  const destinationNodeIds = route.nodes.filter((node) => node.kind === "destination").map((node) => node.id);
  const result: SupplyRiskItem[] = profile.risks.map((risk, index) => ({
    id: `risk-industry-${index + 1}`,
    ...risk,
    category: profile.label === "Chemicals" || profile.label === "Aerospace and defense" ? "compliance" : "supply",
    status: "needs_confirmation",
    relatedNodeIds: [...sourceNodeIds, ...destinationNodeIds],
  }));

  if (regions.some((region) => !region.value)) {
    result.unshift({
      id: "risk-source-unknown",
      severity: "high",
      title: "Source geography is unknown",
      category: "transport",
      why: "Routing, tariff exposure, sanctions screening, transit time, and supplier discovery depend on the actual source location.",
      check: "Add the supplier city and country, plus any alternate source locations.",
      status: "needs_confirmation",
      relatedNodeIds: ["source-needed"],
    });
  }
  if (destinations.some((destination) => !destination.value)) {
    result.unshift({
      id: "risk-destination-unknown",
      severity: "high",
      title: "Receiving location is unknown",
      category: "transport",
      why: "The entry port, customs workflow, inland route, delivery appointment, and total landed cost cannot yet be evaluated.",
      check: "Add the final delivery city, receiving facility type, and any required port or broker.",
      status: "needs_confirmation",
      relatedNodeIds: ["destination-needed"],
    });
  }

  const regionText = regions.map((region) => region.value ?? "").join(" ").toLowerCase();
  const hasUnitedStatesDestination = destinations.some((destination) =>
    customsTerritory(resolveLocation(destination.value)) === "United States"
  );
  if (/china|shenzhen|shanghai/.test(regionText)) {
    result.push({
      id: "risk-china-trade-policy",
      severity: "medium",
      title: hasUnitedStatesDestination ? "US-bound China tariff exposure" : "China origin and trade-policy exposure",
      category: "customs",
      why: "Product classification, origin rules, trade remedies, and changing policy can materially change landed cost.",
      check: hasUnitedStatesDestination
        ? "For US-bound lanes, have a broker confirm HTS, country of origin, Section 301 applicability, and any antidumping or countervailing scope."
        : "Have the destination broker confirm tariff classification, origin treatment, restricted-party requirements, and trade-remedy scope.",
      status: "needs_confirmation",
      relatedNodeIds: sourceNodeIds,
    });
  }
  return result;
}

function determineCustomsScope(
  sourceRegions: Array<SupplyCaseFact<string>>,
  destinations: Array<SupplyCaseFact<string>>,
): CustomsScope {
  const sources = sourceRegions.flatMap((item) => (item.value ? [item.value] : []));
  const shipTo = destinations.flatMap((item) => (item.value ? [item.value] : []));
  if (!sources.length || !shipTo.length) return "unknown";

  let hasUnknownPair = false;
  for (const source of sources) {
    for (const destination of shipTo) {
      const pairScope = laneCustomsScope(resolveLocation(source), resolveLocation(destination));
      if (pairScope === "unknown") {
        hasUnknownPair = true;
      } else if (pairScope === "import") {
        return "import";
      }
    }
  }
  return hasUnknownPair ? "unknown" : "domestic";
}

function buildCustomsChecks(
  profile: IndustryProfile,
  scope: CustomsScope,
  destinations: Array<SupplyCaseFact<string>>,
): SupplyCustomsCheck[] {
  if (scope === "domestic") {
    return [{
      id: "domestic-regulatory-review",
      label: "Domestic movement confirmation",
      detail: "No import entry is modeled because the source and destination share a customs territory.",
      needed: ["Confirm origin and destination", "Confirm commodity-specific transport rules"],
      owner: "shipper",
      status: "needs_confirmation",
    }];
  }
  if (scope === "unknown") {
    return [{
      id: "customs-scope-confirmation",
      label: "Customs scope to confirm",
      detail: "Source and destination customs territories are not complete enough to determine the entry workflow.",
      needed: ["Exact supplier country", "Port or border crossing", "Final delivery country", "Commodity description"],
      owner: "shipper_and_broker",
      status: "needs_confirmation",
    }];
  }
  const destinationTerritories = destinations
    .flatMap((destination) => (destination.value ? [customsTerritory(resolveLocation(destination.value))] : []))
    .filter((territory): territory is string => Boolean(territory));
  const allUnitedStates = destinationTerritories.length > 0
    && destinationTerritories.every((territory) => territory === "United States");
  const importerCheck: SupplyCustomsCheck = allUnitedStates
    ? {
        id: "customs-us-importer-and-broker",
        label: "US importer of record and broker setup",
        detail: "The US importer, broker, customs bond, and power of attorney determine whether the entry can be filed.",
        needed: ["Importer legal name", "Importer number", "Broker power of attorney", "Customs bond status"],
        owner: "shipper_and_broker",
        status: "needs_confirmation",
      }
    : {
        id: "customs-importer-and-broker",
        label: "Destination importer and broker setup",
        detail: "The destination importer, customs registration, broker authorization, and any required guarantee determine whether the entry can be filed.",
        needed: ["Importer legal name", "Customs registration", "Broker authorization", "Financial guarantee if required"],
        owner: "shipper_and_broker",
        status: "needs_confirmation",
      };
  const base: SupplyCustomsCheck[] = [
    importerCheck,
    {
      id: "customs-commercial-packet",
      label: "Commercial entry packet",
      detail: "Customs valuation and admissibility depend on complete and consistent transaction records.",
      needed: ["Commercial invoice", "Packing list", "Country of origin", "Incoterm", "Assists or related-party details"],
      owner: "shipper",
      status: "needs_confirmation",
    },
  ];
  return [
    ...profile.customs.map((check, index) => ({
      id: `customs-industry-${index + 1}`,
      ...check,
      status: "needs_confirmation" as const,
    })),
    ...base,
  ];
}

function buildOpenQuestions(
  name: SupplyCaseFact<string>,
  headquarters: SupplyCaseFact<string>,
  industry: SupplyCaseFact<string>,
  needs: Array<SupplyCaseFact<string>>,
  regions: Array<SupplyCaseFact<string>>,
  destinations: Array<SupplyCaseFact<string>>,
): string[] {
  const questions: string[] = [];
  if (!name.value) questions.push("What is the company name?");
  if (!headquarters.value) questions.push("Where is the company headquartered or operating?");
  if (!industry.value) questions.push("What does the company make or sell?");
  if (!needs.some((need) => need.status === "ready" && need.value)) {
    questions.push("Which exact materials, components, or finished goods need suppliers?");
  }
  if (!regions.some((region) => region.value)) {
    questions.push("Which supplier cities or countries should be evaluated?");
  } else {
    const unresolvedRegions = regions.filter((region) => region.status === "needs_confirmation" && region.value);
    if (unresolvedRegions.length > 0) {
      questions.push(`Confirm the exact supplier geography for: ${unresolvedRegions.map((region) => region.value).join(", ")}.`);
    }
  }
  if (!destinations.some((destination) => destination.value)) {
    questions.push("Where will the goods clear customs and be delivered?");
  } else {
    const unresolvedDestinations = destinations.filter((destination) => destination.status === "needs_confirmation" && destination.value);
    if (unresolvedDestinations.length > 0) {
      questions.push(`Confirm the exact delivery geography for: ${unresolvedDestinations.map((destination) => destination.value).join(", ")}.`);
    }
  }
  questions.push("What are the expected volume, dimensions, weight, shipment frequency, Incoterm, cargo-ready date, and required delivery date?");
  return questions;
}

function buildSummary(
  name: SupplyCaseFact<string>,
  industry: SupplyCaseFact<string>,
  needs: Array<SupplyCaseFact<string>>,
  regions: Array<SupplyCaseFact<string>>,
  destinations: Array<SupplyCaseFact<string>>,
): string {
  const company = name.value ?? "This company";
  const industryPhrase = industry.value ? ` operates in ${industry.value.toLowerCase()}` : " needs its industry confirmed";
  const confirmedNeeds = needs.filter((need) => need.status === "ready").flatMap((need) => (need.value ? [need.value] : []));
  const confirmedRegions = regions.flatMap((region) => (region.value ? [region.value] : []));
  const confirmedDestinations = destinations.flatMap((destination) => (destination.value ? [destination.value] : []));
  const sourcingPhrase = confirmedNeeds.length
    ? ` and sources ${confirmedNeeds.join(", ")}`
    : " and still needs its sourcing requirements confirmed";
  const regionPhrase = confirmedRegions.length ? ` from ${confirmedRegions.join(", ")}` : " from locations not yet provided";
  const destinationPhrase = confirmedDestinations.length
    ? ` for delivery to ${confirmedDestinations.join(", ")}.`
    : ", with receiving locations still to be confirmed.";
  return `${company}${industryPhrase}${sourcingPhrase}${regionPhrase}${destinationPhrase}`;
}

function bestNextStepFor(questions: string[]): string {
  if (questions.length > 1) {
    return `Complete the missing case inputs, starting with: ${questions[0]}`;
  }
  return "Confirm expected volume, dimensions, weight, Incoterm, cargo-ready date, and delivery date before requesting live offers.";
}

export function generateSupplyCase(prompt: string, now: Date = new Date()): SupplyCaseDashboard {
  const sourcePrompt = normalizeText(prompt);
  const timestamp = now.toISOString();
  const name = extractCompanyName(sourcePrompt);
  const headquarters = extractHeadquarters(sourcePrompt);
  const industryResult = detectIndustry(sourcePrompt);
  const sourcing = extractSourcing(sourcePrompt, industryResult.profile);
  const destinations = extractDestinations(sourcePrompt);
  const route = buildRoute(headquarters, sourcing.regions, destinations, requestedInternationalMode(sourcePrompt));
  const openQuestions = buildOpenQuestions(
    name,
    headquarters,
    industryResult.fact,
    sourcing.needs,
    sourcing.regions,
    destinations,
  );
  const requiredQuestions = openQuestions.slice(0, -1);
  const idBasis = sourcePrompt.toLowerCase() || `empty-${timestamp}`;
  const titleName = name.value ?? "Untitled company";
  const flatNeeds = sourcing.needs.flatMap((item) => (item.value ? [item.value] : []));
  const flatRegions = sourcing.regions.flatMap((item) => (item.value ? [item.value] : []));
  const flatDestinations = destinations.flatMap((item) => (item.value ? [item.value] : []));
  const risks = buildRisks(industryResult.profile, route, sourcing.regions, destinations);
  const customsChecks = buildCustomsChecks(
    industryResult.profile,
    determineCustomsScope(sourcing.regions, destinations),
    destinations,
  );
  const bestNextStep = bestNextStepFor(openQuestions);
  const overview = buildSummary(name, industryResult.fact, sourcing.needs, sourcing.regions, destinations);

  return {
    schemaVersion: SUPPLY_CASE_SCHEMA_VERSION,
    id: `supply-case-${slug(titleName)}-${stableHash(idBasis)}`,
    status: requiredQuestions.length ? "needs_confirmation" : "verify",
    title: `${titleName} supply case`,
    sourcePrompt,
    createdAt: timestamp,
    generatedAt: timestamp,
    updatedAt: timestamp,
    companyName: name.value,
    companyDescription: industryResult.fact.value ?? "Company activity needs confirmation",
    companyLocation: headquarters.value,
    sourcingNeeds: flatNeeds,
    sourceRegions: flatRegions,
    destinations: flatDestinations,
    company: {
      name,
      headquarters,
      industry: industryResult.fact,
      sourcingNeeds: sourcing.needs,
      sourceRegions: sourcing.regions,
      destinations,
    },
    summary: {
      primaryLane: `${flatRegions[0] ?? "Source to confirm"} to ${flatDestinations[0] ?? "destination to confirm"}`,
      supplyPattern: `${flatNeeds.length} sourcing ${flatNeeds.length === 1 ? "requirement" : "requirements"} across ${flatRegions.length} source ${flatRegions.length === 1 ? "region" : "regions"}`,
      recommendedAction: bestNextStep,
      openCheckCount: risks.length + customsChecks.length + openQuestions.length,
    },
    overview,
    route,
    routeNodes: route.nodes,
    routeSegments: route.segments,
    supplierOptions: buildSupplierProfiles(sourcing.needs, sourcing.regions, industryResult.profile),
    shippingOptions: buildShippingOptions(route),
    risks,
    customsChecks,
    openQuestions,
    bestNextStep,
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFact(value: unknown): value is SupplyCaseFact<string> {
  if (!isRecord(value)) return false;
  return (value.value === null || isString(value.value))
    && ["ready", "verify", "needs_confirmation"].includes(String(value.status))
    && isString(value.evidence);
}

function isCoordinate(value: unknown): value is SupplyCoordinate {
  return isRecord(value)
    && typeof value.latitude === "number"
    && Number.isFinite(value.latitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && typeof value.longitude === "number"
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180;
}

function isRouteNode(value: unknown): value is SupplyRouteNode {
  if (!isRecord(value)) return false;
  return isString(value.id)
    && ["headquarters", "source", "origin_gateway", "receiving_gateway", "customs", "destination"].includes(String(value.kind))
    && isString(value.label)
    && isString(value.detail)
    && (value.coordinates === null || isCoordinate(value.coordinates))
    && (value.lat === null || (typeof value.lat === "number" && Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90))
    && (value.lng === null || (typeof value.lng === "number" && Number.isFinite(value.lng) && value.lng >= -180 && value.lng <= 180))
    && ["ready", "verify", "needs_confirmation"].includes(String(value.status))
    && isString(value.note);
}

function isRouteSegment(value: unknown): value is SupplyRouteSegment {
  if (!isRecord(value)) return false;
  return isString(value.id)
    && isString(value.fromNodeId)
    && isString(value.toNodeId)
    && ["road", "ocean", "air", "air_or_ocean", "last_mile", "to_confirm"].includes(String(value.mode))
    && isString(value.label)
    && value.status === "verify"
    && isString(value.note);
}

function hasValidCoreArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isRecord);
}

function isSupplierOption(value: unknown): value is SupplySupplierOption {
  if (!isRecord(value)) return false;
  return [value.id, value.title, value.region, value.capability, value.fitReason, value.basis].every(isString)
    && value.leadTime === "Needs supplier confirmation"
    && ["verify", "needs_confirmation"].includes(String(value.status));
}

function isShippingOption(value: unknown): value is SupplyShippingOption {
  if (!isRecord(value)) return false;
  return isString(value.id)
    && ["DHL Global Forwarding", "Kuehne+Nagel", "DSV"].includes(String(value.provider))
    && [value.service, value.route, value.bestFor, value.basis].every(isString)
    && ["Air freight", "Air or ocean, to confirm", "Road, to confirm", "Mode to confirm"].includes(String(value.mode))
    && value.transit === "Live schedule required"
    && value.indicativeCost === "Live quote required"
    && value.reliability === "Live service data required"
    && value.status === "verify";
}

function isRiskItem(value: unknown): value is SupplyRiskItem {
  if (!isRecord(value)) return false;
  return [value.id, value.title, value.why, value.check].every(isString)
    && ["high", "medium", "low"].includes(String(value.severity))
    && ["supply", "transport", "customs", "compliance"].includes(String(value.category))
    && value.status === "needs_confirmation"
    && Array.isArray(value.relatedNodeIds)
    && value.relatedNodeIds.every(isString);
}

function isCustomsCheck(value: unknown): value is SupplyCustomsCheck {
  if (!isRecord(value)) return false;
  return [value.id, value.label, value.detail].every(isString)
    && Array.isArray(value.needed)
    && value.needed.every(isString)
    && ["shipper", "customs_broker", "shipper_and_broker"].includes(String(value.owner))
    && value.status === "needs_confirmation";
}

export function validateSupplyCaseDashboard(value: unknown): value is SupplyCaseDashboard {
  if (!isRecord(value) || value.schemaVersion !== SUPPLY_CASE_SCHEMA_VERSION) return false;
  if (!isString(value.id) || !isString(value.title) || !isString(value.sourcePrompt)) return false;
  if (!["ready", "verify", "needs_confirmation"].includes(String(value.status))) return false;
  if (!isString(value.createdAt) || !isString(value.generatedAt) || !isString(value.updatedAt)) return false;
  if (value.archivedAt !== undefined && !isString(value.archivedAt)) return false;
  if (value.companyName !== null && !isString(value.companyName)) return false;
  if (!isString(value.companyDescription) || (value.companyLocation !== null && !isString(value.companyLocation))) return false;
  if (![value.sourcingNeeds, value.sourceRegions, value.destinations, value.openQuestions].every(
    (items) => Array.isArray(items) && items.every(isString),
  )) return false;
  if (!isRecord(value.company)) return false;
  if (!isFact(value.company.name) || !isFact(value.company.headquarters) || !isFact(value.company.industry)) return false;
  if (![value.company.sourcingNeeds, value.company.sourceRegions, value.company.destinations].every(
    (items) => Array.isArray(items) && items.every(isFact),
  )) return false;
  if (!isRecord(value.summary)
    || !isString(value.summary.primaryLane)
    || !isString(value.summary.supplyPattern)
    || !isString(value.summary.recommendedAction)
    || typeof value.summary.openCheckCount !== "number"
    || !Number.isInteger(value.summary.openCheckCount)
    || value.summary.openCheckCount < 0
    || !isString(value.overview)
    || !isString(value.bestNextStep)) return false;
  if (!isRecord(value.route) || !Array.isArray(value.route.nodes) || !value.route.nodes.every(isRouteNode)) return false;
  if (!Array.isArray(value.route.segments) || !value.route.segments.every(isRouteSegment)) return false;
  const nestedRouteNodes = value.route.nodes;
  const nestedRouteSegments = value.route.segments;
  if (!Array.isArray(value.routeNodes) || !value.routeNodes.every(isRouteNode)) return false;
  if (!Array.isArray(value.routeSegments) || !value.routeSegments.every(isRouteSegment)) return false;
  const nodeIds = new Set(nestedRouteNodes.map((node) => node.id));
  const nestedSegmentIds = new Set(nestedRouteSegments.map((segment) => segment.id));
  if (nodeIds.size !== nestedRouteNodes.length || nestedSegmentIds.size !== nestedRouteSegments.length) return false;
  if (nestedRouteSegments.some((segment) => !nodeIds.has(segment.fromNodeId) || !nodeIds.has(segment.toNodeId))) return false;
  const flatNodeIds = new Set(value.routeNodes.map((node) => node.id));
  const flatSegmentIds = new Set(value.routeSegments.map((segment) => segment.id));
  if (flatNodeIds.size !== value.routeNodes.length || flatSegmentIds.size !== value.routeSegments.length) return false;
  if (value.routeSegments.some((segment) => !flatNodeIds.has(segment.fromNodeId) || !flatNodeIds.has(segment.toNodeId))) return false;
  if (value.routeNodes.length !== nestedRouteNodes.length || value.routeSegments.length !== nestedRouteSegments.length) return false;
  if (value.routeNodes.some((node, index) => node.id !== nestedRouteNodes[index]?.id)) return false;
  if (value.routeSegments.some((segment, index) => segment.id !== nestedRouteSegments[index]?.id)) return false;
  if (!Array.isArray(value.supplierOptions) || !value.supplierOptions.every(isSupplierOption)) return false;
  if (!Array.isArray(value.shippingOptions) || !value.shippingOptions.every(isShippingOption)) return false;
  if (!Array.isArray(value.risks) || !value.risks.every(isRiskItem)) return false;
  if (!Array.isArray(value.customsChecks) || !value.customsChecks.every(isCustomsCheck)) return false;
  if (value.risks.some((risk) => risk.relatedNodeIds.some((nodeId) => !nodeIds.has(nodeId)))) return false;
  return true;
}

type SupplyCaseEnvelope = {
  schemaVersion: typeof SUPPLY_CASE_SCHEMA_VERSION;
  cases: SupplyCaseDashboard[];
};

export function serializeSupplyCases(cases: readonly SupplyCaseDashboard[]): string {
  const validCases = cases.filter(validateSupplyCaseDashboard);
  const payload: SupplyCaseEnvelope = { schemaVersion: SUPPLY_CASE_SCHEMA_VERSION, cases: validCases };
  return JSON.stringify(payload);
}

export function parseStoredSupplyCases(raw: string | null | undefined): SupplyCaseDashboard[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schemaVersion !== SUPPLY_CASE_SCHEMA_VERSION || !Array.isArray(parsed.cases)) return [];
    return parsed.cases.filter(validateSupplyCaseDashboard);
  } catch {
    return [];
  }
}

export function upsertSupplyCase(
  cases: readonly SupplyCaseDashboard[],
  next: SupplyCaseDashboard,
): SupplyCaseDashboard[] {
  if (!validateSupplyCaseDashboard(next)) return [...cases];
  const index = cases.findIndex((candidate) => candidate.id === next.id);
  if (index < 0) return [next, ...cases];
  return cases.map((candidate, candidateIndex) => candidateIndex === index
    ? { ...next, createdAt: candidate.createdAt }
    : candidate);
}

export function archiveSupplyCase(
  cases: readonly SupplyCaseDashboard[],
  id: string,
  now: Date = new Date(),
): SupplyCaseDashboard[] {
  const archivedAt = now.toISOString();
  return cases.map((candidate) => candidate.id === id
    ? { ...candidate, archivedAt, updatedAt: archivedAt }
    : candidate);
}

export function resolveSelectedSupplyCase(
  cases: readonly SupplyCaseDashboard[],
  id: string | null | undefined,
): SupplyCaseDashboard | null {
  const exact = id ? cases.find((candidate) => candidate.id === id && !candidate.archivedAt) : undefined;
  if (exact) return exact;
  return cases.find((candidate) => !candidate.archivedAt) ?? null;
}
