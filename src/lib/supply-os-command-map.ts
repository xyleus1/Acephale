import type { SupplyCaseDashboard, SupplyCoordinate } from "./supply-os-case-model";
import type {
  SupplyOptimizationBasis,
  SupplyOptimizationAction,
  SupplyOptimizationConfidence,
  SupplyOptimizationEdge,
  SupplyOptimizationModel,
  SupplyOptimizationNode,
  SupplyOptimizationWorkstreamId,
} from "./supply-os-optimization-engine";

export type SupplyCommandObjectKind =
  | "supplier"
  | "factory"
  | "distribution"
  | "customer"
  | "movement"
  | "customs";

export type SupplyCommandContact = {
  id: string;
  name: string;
  role: string;
  fit: string;
  url?: string;
  phone?: string;
  location?: string;
  sourceLabel?: string;
  proximity?: string;
};

export type SupplyCommandPriority = Pick<
  SupplyOptimizationAction,
  "id" | "priority" | "title" | "workstreamId"
>;

export type SupplyCommandRateEstimate = {
  currency: "USD";
  distanceMiles: number;
  low: number;
  high: number;
  ratePerMileLow: number;
  ratePerMileHigh: number;
  basis: string;
  sourceLabel: string;
  sourceUrl: string;
  exclusions: string[];
};

export type SupplyCommandCheck = {
  label: string;
  status: "ready" | "review" | "missing";
};

export type SupplyCommandObject = {
  id: string;
  kind: SupplyCommandObjectKind;
  label: string;
  location: string;
  coordinates: SupplyCoordinate;
  detail: string;
  cargo: string;
  basis: SupplyOptimizationBasis;
  confidence: SupplyOptimizationConfidence;
  status: "verified" | "review" | "unassigned";
  statusLabel: string;
  nextAction: string;
  workstreamId: SupplyOptimizationWorkstreamId;
  contacts: SupplyCommandContact[];
  checks: SupplyCommandCheck[];
  priority: SupplyCommandPriority | null;
  optimizationIds: string[];
  rateEstimate?: SupplyCommandRateEstimate | null;
  nodeId?: string;
  edgeId?: string;
};

export type SupplyCommandRoute = {
  id: string;
  edgeId: string;
  from: SupplyCoordinate;
  to: SupplyCoordinate;
  fromLabel: string;
  toLabel: string;
  label: string;
  mode: string;
  cargo: string;
  stage: SupplyOptimizationEdge["stage"];
  basis: SupplyOptimizationEdge["basis"];
  confidence: SupplyOptimizationConfidence;
  priority: SupplyCommandPriority | null;
  rateEstimate: SupplyCommandRateEstimate | null;
  segments: SupplyCommandRouteSegment[];
};

export type SupplyCommandTransportMode = "road" | "ocean" | "air" | "customs";

export type SupplyCommandRouteSegment = {
  id: string;
  sequence: number;
  mode: SupplyCommandTransportMode;
  label: string;
  from: SupplyCoordinate;
  to: SupplyCoordinate;
  fromLabel: string;
  toLabel: string;
  status: "inferred";
};

export type SupplyCommandMap = {
  objects: SupplyCommandObject[];
  routes: SupplyCommandRoute[];
};

const DHL_GLOBAL_FORWARDING: SupplyCommandContact = {
  id: "dhl-global-forwarding",
  name: "DHL Global Forwarding",
  role: "International forwarder",
  fit: "Air, ocean, road, customs coordination, and shipment visibility for international lanes.",
  url: "https://www.dhl.com/us-en/home/global-forwarding.html",
  sourceLabel: "Official service page",
};

const MAERSK_OCEAN: SupplyCommandContact = {
  id: "maersk-ocean",
  name: "Maersk",
  role: "Ocean carrier",
  fit: "Compare FCL, LCL, contract, and spot ocean options for planned production replenishment.",
  url: "https://www.maersk.com/transportation-services/ocean-transport",
  sourceLabel: "Official ocean-service page",
};

const MSC_OCEAN: SupplyCommandContact = {
  id: "msc-ocean",
  name: "MSC",
  role: "Ocean carrier",
  fit: "Compare dry-container capacity, equipment fit, sailing schedule, and inland handoff scope.",
  url: "https://www.msc.com/en/solutions/dry-cargo",
  sourceLabel: "Official dry-cargo page",
};

const CMA_CGM_OCEAN: SupplyCommandContact = {
  id: "cma-cgm-ocean",
  name: "CMA CGM",
  role: "Ocean carrier",
  fit: "Compare port-to-port service plus container and special-cargo equipment for industrial machinery and components.",
  url: "https://www.cma-cgm.com/offers/maritime-solutions",
  sourceLabel: "Official maritime-service page",
};

const KUEHNE_NAGEL: SupplyCommandContact = {
  id: "kuehne-nagel",
  name: "Kuehne+Nagel",
  role: "Air and ocean forwarder",
  fit: "Compare consolidated ocean, air, and sea-air options with one door-to-door operating scope.",
  url: "https://home.kuehne-nagel.com/en/-/services/sea-freight",
  sourceLabel: "Official sea-freight page",
};

const DSV_AIR: SupplyCommandContact = {
  id: "dsv-air",
  name: "DSV",
  role: "Air freight forwarder",
  fit: "Compare consolidation, direct, time-critical, and charter options for urgent production parts and service inventory.",
  url: "https://www.dsv.com/en-gb/our-solutions/modes-of-transport/air-freight",
  sourceLabel: "Official air-freight page",
};

const UBER_FREIGHT: SupplyCommandContact = {
  id: "uber-freight",
  name: "Uber Freight",
  role: "Domestic truck capacity",
  fit: "Instant FTL and LTL quoting, booking, and tracking for U.S. pickup and delivery legs.",
  url: "https://www.uberfreight.com/en-US/technology/instant-freight-quote",
  sourceLabel: "Official quote product page",
};

const SCHNEIDER_FREIGHT: SupplyCommandContact = {
  id: "schneider-freight",
  name: "Schneider",
  role: "Truckload and intermodal network",
  fit: "National truckload, intermodal, brokerage, and dedicated-capacity alternative for repeat plant and customer lanes.",
  url: "https://schneider.com/freight-shipping",
  sourceLabel: "Official shipper service page",
};

const JB_HUNT: SupplyCommandContact = {
  id: "jb-hunt-shippers",
  name: "J.B. Hunt",
  role: "Truckload and intermodal network",
  fit: "National truckload, intermodal, final-mile, and managed transportation alternative for scheduled production freight.",
  url: "https://www.jbhunt.com/shippers",
  sourceLabel: "Official shipper service page",
};

const ARCBEST: SupplyCommandContact = {
  id: "arcbest",
  name: "ArcBest",
  role: "LTL and managed transportation",
  fit: "ABF LTL capacity plus truckload, expedited, and managed transportation for mixed shipment sizes and time-critical exceptions.",
  url: "https://arcb.com/solutions",
  sourceLabel: "Official solutions page",
};

const MELTON_TULSA: SupplyCommandContact = {
  id: "melton-tulsa",
  name: "Melton Truck Lines",
  role: "Tulsa flatbed carrier",
  fit: "Tulsa-based flatbed specialist for machinery, fabricated assemblies, and over-dimensional or securement-sensitive freight.",
  url: "https://meltontruck.com/ship-with-us/",
  location: "808 N 161st E Ave, Tulsa, OK",
  sourceLabel: "Official shipper page",
};

const SWIFT_PHOENIX: SupplyCommandContact = {
  id: "swift-phoenix",
  name: "Swift Transportation",
  role: "Phoenix truckload network",
  fit: "Phoenix-headquartered dry van, refrigerated, flatbed, intermodal, and dedicated capacity for regional and national moves.",
  url: "https://www.swifttrans.com/",
  location: "2200 S 75th Ave, Phoenix, AZ",
  sourceLabel: "Official company site",
};

const PORT_X_LOS_ANGELES: SupplyCommandContact = {
  id: "port-x-los-angeles",
  name: "Port X Logistics",
  role: "Los Angeles and Long Beach drayage",
  fit: "Port-focused drayage, transload, and final-mile coordination candidate for container freight moving through Los Angeles or Long Beach.",
  url: "https://portxlogistics.com/",
  sourceLabel: "Official company site",
};

const GROUPE_ROBERT: SupplyCommandContact = {
  id: "groupe-robert",
  name: "Groupe Robert",
  role: "Quebec transport and distribution network",
  fit: "Quebec-based truckload, LTL, specialized transport, distribution, and cross-border alternative for Montreal operating lanes.",
  url: "https://www.robert.ca/en/",
  sourceLabel: "Official company site",
};

const CHALLENGER: SupplyCommandContact = {
  id: "challenger-motor-freight",
  name: "Challenger Motor Freight",
  role: "Ontario cross-border carrier",
  fit: "Ontario-based truckload, LTL, intermodal, and logistics alternative for Canada-United States plant and customer movements.",
  url: "https://challenger.com/",
  sourceLabel: "Official company site",
};

const STEWART_TRANSPORT: SupplyCommandContact = {
  id: "stewart-transport-phoenix",
  name: "Stewart Transport",
  role: "Phoenix fleet and brokerage",
  fit: "Phoenix-based dry van, refrigerated, dedicated, and auto or aviation-kit transportation. The company advertises a dedicated Phoenix-to-Southern-California lane.",
  url: "https://www.stewarttransport.com/",
  phone: "(602) 242-1800",
  location: "8164 W Buckeye Rd, Phoenix, AZ",
  sourceLabel: "Official company site",
};

const KNIGHT_PHOENIX: SupplyCommandContact = {
  id: "knight-phoenix",
  name: "Knight Transportation",
  role: "Phoenix truckload terminal",
  fit: "Phoenix-based dry van, refrigerated, and port capacity with a published Arizona-to-California operating lane.",
  url: "https://www.knighttrans.com/locations/phoenix-az/",
  phone: "(602) 512-3284",
  location: "5601 W Buckeye Rd, Phoenix, AZ",
  sourceLabel: "Official Phoenix terminal page",
};

const DEPENDABLE_PHOENIX: SupplyCommandContact = {
  id: "dependable-phoenix",
  name: "Dependable Supply Chain Services",
  role: "Phoenix 3PL and truckload office",
  fit: "Goodyear office offering full truckload, expedited ground, warehousing, cross-dock, air and ocean handoffs, and supply-chain management.",
  url: "https://www.godependable.com/contact/find-a-location/",
  phone: "(602) 278-4401",
  location: "250 N Litchfield Rd, Goodyear, AZ",
  sourceLabel: "Official location directory",
};

const DEPENDABLE_LOS_ANGELES: SupplyCommandContact = {
  id: "dependable-los-angeles",
  name: "Dependable Supply Chain Services",
  role: "Los Angeles drayage and distribution office",
  fit: "Commerce and Los Angeles locations offering harbor drayage, intermodal, transload, cross-dock, full truckload, air and ocean, and warehouse services.",
  url: "https://www.godependable.com/contact/find-a-location/",
  phone: "(310) 522-4111",
  location: "5950 S Eastern Ave, Commerce, CA",
  sourceLabel: "Official location directory",
};

const UNIVERSAL_MICHIGAN: SupplyCommandContact = {
  id: "universal-logistics-michigan",
  name: "Universal Logistics",
  role: "Detroit-area transportation network",
  fit: "Warren-based truckload, brokerage, intermodal, dedicated, and value-added logistics candidate for Michigan plant and customer moves.",
  url: "https://www.universallogistics.com/en-US/contact",
  phone: "(586) 920-0100",
  location: "12755 E 9 Mile Rd, Warren, MI",
  sourceLabel: "Official contact page",
};

const OLD_DOMINION_DETROIT: SupplyCommandContact = {
  id: "old-dominion-detroit",
  name: "Old Dominion Freight Line",
  role: "Detroit LTL service center",
  fit: "Troy service center covering Detroit-area manufacturers and acting as a gateway for freight moving across the Canadian border into Ontario.",
  url: "https://www.odfl.com/us/en/tools/service-center-locator/MI/DET.html",
  phone: "(248) 457-0498",
  location: "1310 E Big Beaver Rd, Troy, MI",
  sourceLabel: "Official Detroit service-center page",
};

const CAT_QUEBEC: SupplyCommandContact = {
  id: "cat-quebec",
  name: "C.A.T. Inc.",
  role: "Quebec cross-border truckload fleet",
  fit: "Quebec-based truckload and logistics network serving domestic and cross-border Canada, United States, and Mexico lanes.",
  url: "https://cat.ca/contact/",
  phone: "(800) 363-5313",
  location: "4 Rue du Transport, Coteau-du-Lac, QC",
  sourceLabel: "Official contact page",
};

const LIVINGSTON: SupplyCommandContact = {
  id: "livingston",
  name: "Livingston International",
  role: "U.S.-Canada customs broker",
  fit: "Brokerage and clearance support across U.S.-Canada border points, including shipment status support.",
  url: "https://www.livingstonintl.com/contact-us/",
  sourceLabel: "Official contact page",
};

const FARROW: SupplyCommandContact = {
  id: "farrow",
  name: "Farrow",
  role: "Windsor-Detroit customs broker",
  fit: "Windsor-based customs brokerage, trade consulting, PAPS support, and cross-border logistics.",
  url: "https://farrow.com/customs-brokerage/",
  sourceLabel: "Official customs-service page",
};

const EXPEDITORS: SupplyCommandContact = {
  id: "expeditors-customs",
  name: "Expeditors",
  role: "International customs broker and forwarder",
  fit: "Customs brokerage, trade compliance, air and ocean forwarding, and handoff coordination for international production and service movements.",
  url: "https://www.expeditors.com/services/customs-and-compliance",
  sourceLabel: "Official customs-service page",
};

function nodeKind(node: SupplyOptimizationNode): SupplyCommandObjectKind {
  if (node.kind === "supplier_cluster") return "supplier";
  if (node.kind === "processing_site") return "factory";
  if (node.kind === "distribution") return "distribution";
  return "customer";
}

function nodeWorkstream(node: SupplyOptimizationNode): SupplyOptimizationWorkstreamId {
  if (node.kind === "supplier_cluster") return "procurement";
  if (node.kind === "processing_site") return "shipment_planning";
  return "fulfillment";
}

function statusForBasis(basis: SupplyOptimizationBasis) {
  if (basis === "official") return { status: "verified" as const, label: "Official evidence" };
  if (basis === "public") return { status: "verified" as const, label: "Public evidence" };
  if (basis === "customer_stated") return { status: "verified" as const, label: "Customer input" };
  return { status: "review" as const, label: "Inferred, verify" };
}

function addContact(contacts: SupplyCommandContact[], contact: SupplyCommandContact) {
  if (!contacts.some((candidate) => candidate.id === contact.id)) contacts.push(contact);
}

function actionPriority(
  model: SupplyOptimizationModel,
  workstreamId: SupplyOptimizationWorkstreamId,
): SupplyCommandPriority | null {
  const action = [...model.actions]
    .sort((left, right) => left.priority - right.priority)
    .find((candidate) => candidate.workstreamId === workstreamId);
  if (!action) return null;
  return {
    id: action.id,
    priority: action.priority,
    title: action.title,
    workstreamId: action.workstreamId,
  };
}

function optimizationIds(
  model: SupplyOptimizationModel,
  workstreamIds: readonly SupplyOptimizationWorkstreamId[],
) {
  const included = new Set(workstreamIds);
  return model.actions
    .filter((action) => included.has(action.workstreamId))
    .sort((left, right) => left.priority - right.priority)
    .map((action) => action.id);
}

function nodeWorkstreams(node: SupplyOptimizationNode): SupplyOptimizationWorkstreamId[] {
  if (node.kind === "supplier_cluster") return ["procurement", "supplier_outreach"];
  if (node.kind === "processing_site") return ["shipment_planning", "procurement"];
  if (node.kind === "distribution") return ["fulfillment", "shipment_planning"];
  return ["fulfillment"];
}

function regionalContactsForLocation(location: string): SupplyCommandContact[] {
  const value = location.toLowerCase();
  const contacts: SupplyCommandContact[] = [];
  if (/phoenix|arizona|goodyear/.test(value)) {
    contacts.push(STEWART_TRANSPORT, KNIGHT_PHOENIX, SWIFT_PHOENIX, DEPENDABLE_PHOENIX);
  }
  if (/tulsa|oklahoma/.test(value)) {
    contacts.push(MELTON_TULSA);
  }
  if (/los angeles|long beach|southern california|commerce, ca/.test(value)) {
    contacts.push(PORT_X_LOS_ANGELES, DEPENDABLE_LOS_ANGELES);
  }
  if (/ferndale|detroit|michigan|troy, mi|warren, mi/.test(value)) {
    contacts.push(UNIVERSAL_MICHIGAN, OLD_DOMINION_DETROIT);
  }
  if (/quebec|montreal|coteau-du-lac/.test(value)) {
    contacts.push(GROUPE_ROBERT, CAT_QUEBEC);
  }
  if (/ontario|toronto|hamilton|windsor|cambridge/.test(value)) {
    contacts.push(CHALLENGER);
  }
  return contacts;
}

function regionalContactsForLane(
  from: SupplyOptimizationNode,
  to: SupplyOptimizationNode,
): SupplyCommandContact[] {
  const contacts: SupplyCommandContact[] = [];
  for (const contact of regionalContactsForLocation(from.location)) {
    addContact(contacts, { ...contact, proximity: `Origin-area terminal, ${from.location}` });
  }
  for (const contact of regionalContactsForLocation(to.location)) {
    addContact(contacts, { ...contact, proximity: `Destination-area terminal, ${to.location}` });
  }
  return contacts;
}

function haversineMiles(from: SupplyCoordinate, to: SupplyCoordinate) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const left = Math.sin(latitudeDelta / 2) ** 2;
  const right = Math.cos(radians(from.latitude))
    * Math.cos(radians(to.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(left + right));
}

function roundedDollars(value: number) {
  return Math.max(50, Math.round(value / 50) * 50);
}

function rateEstimateFor(
  edge: SupplyOptimizationEdge,
  from: SupplyOptimizationNode,
  to: SupplyOptimizationNode,
): SupplyCommandRateEstimate | null {
  const mode = edge.mode.toLowerCase();
  if (!/truck|road|ltl|flatbed|courier/.test(mode)) return null;

  const distanceMiles = Math.max(1, Math.round(haversineMiles(from.coordinates!, to.coordinates!) * 1.18));
  let ratePerMileLow = distanceMiles < 75 ? 3.75 : distanceMiles < 250 ? 2.95 : 2.55;
  let ratePerMileHigh = distanceMiles < 75 ? 5.75 : distanceMiles < 250 ? 4.25 : 3.45;
  if (/flatbed|dedicated/.test(mode)) {
    ratePerMileLow += 0.25;
    ratePerMileHigh += 0.5;
  }
  const crossBorderBufferLow = isCrossBorder(from, to) ? 350 : 0;
  const crossBorderBufferHigh = isCrossBorder(from, to) ? 900 : 0;

  return {
    currency: "USD",
    distanceMiles,
    low: roundedDollars(Math.max(350, distanceMiles * ratePerMileLow) + crossBorderBufferLow),
    high: roundedDollars(Math.max(650, distanceMiles * ratePerMileHigh) + crossBorderBufferHigh),
    ratePerMileLow,
    ratePerMileHigh,
    basis: isCrossBorder(from, to)
      ? "One full-truckload planning case with a cross-border handoff allowance. Road miles are estimated from straight-line distance and require routing confirmation."
      : "One full-truckload planning case. Road miles are estimated from straight-line distance and require routing confirmation.",
    sourceLabel: "2026 ATRI operating-cost benchmark",
    sourceUrl: "https://truckingresearch.org/",
    exclusions: [
      "Duties, taxes, insurance, storage, exams, and unquoted accessorials",
      "Live capacity, fuel program, equipment, exact addresses, and appointments",
    ],
  };
}

function providerContactsForNode(
  node: SupplyOptimizationNode,
  model: SupplyOptimizationModel,
): SupplyCommandContact[] {
  if (node.kind === "supplier_cluster") {
    return node.qualificationTargets.slice(0, 3).map((target, index) => ({
      id: `${node.id}-target-${index}`,
      name: target.name,
      role: "Supplier candidate",
      fit: target.fit,
      url: target.url,
      sourceLabel: target.url ? "Public capability source" : undefined,
    }));
  }

  const contacts: SupplyCommandContact[] = regionalContactsForLocation(node.location);
  if (countryFor(node.location) === "US") addContact(contacts, UBER_FREIGHT);
  const nodes = new Map(model.nodes.map((candidate) => [candidate.id, candidate]));
  for (const edge of model.edges) {
    if (edge.fromNodeId !== node.id && edge.toNodeId !== node.id) continue;
    const from = nodes.get(edge.fromNodeId);
    const to = nodes.get(edge.toNodeId);
    if (!from || !to) continue;
    for (const contact of movementContacts(edge, from, to)) addContact(contacts, contact);
  }
  return contacts.slice(0, 3);
}

function countryFor(location: string): "US" | "CA" | "CN" | "TW" | "MX" | "GB" | "EU" | "OM" | "FJ" | null {
  const value = location.toLowerCase();
  if (/taiwan|taipei|taoyuan|kaohsiung/.test(value)) return "TW";
  if (/china|shenzhen|dongguan|guangzhou|shanghai|pearl river/.test(value)) return "CN";
  if (/canada|canadian|ontario|toronto|hamilton|windsor|montreal|edmonton|vancouver/.test(value)) return "CA";
  if (/united states|u\.s\.|usa|detroit|michigan|ohio|iowa|west virginia|washington|pennsylvania|texas|california|austin|chicago|midwest|great lakes|nationwide|national/.test(value)) return "US";
  if (/mexico|mexican|monterrey|tijuana|juarez|laredo/.test(value)) return "MX";
  if (/united kingdom|\buk\b|england|britain|british|birmingham|coventry/.test(value)) return "GB";
  if (/europe|european|\beu\b|frankfurt|germany|france|netherlands/.test(value)) return "EU";
  if (/oman|muscat|\bgcc\b|gulf/.test(value)) return "OM";
  if (/fiji|suva|pacific operating|island operating/.test(value)) return "FJ";
  return null;
}

function isCrossBorder(from: SupplyOptimizationNode, to: SupplyOptimizationNode) {
  const fromCountry = countryFor(from.location);
  const toCountry = countryFor(to.location);
  return Boolean(fromCountry && toCountry && fromCountry !== toCountry);
}

function borderContacts(from: SupplyOptimizationNode, to: SupplyOptimizationNode) {
  const countries = new Set([countryFor(from.location), countryFor(to.location)]);
  if (countries.has("CA") && countries.has("US")) return [LIVINGSTON, FARROW];
  if (countries.has("US") && countries.size > 1 && !countries.has(null)) return [EXPEDITORS];
  if (countries.size > 1 && !countries.has(null)) return [DHL_GLOBAL_FORWARDING];
  return [];
}

function midpoint(from: SupplyCoordinate, to: SupplyCoordinate): SupplyCoordinate {
  return {
    latitude: (from.latitude + to.latitude) / 2,
    longitude: (from.longitude + to.longitude) / 2,
  };
}

type PlanningGateway = {
  label: string;
  coordinates: SupplyCoordinate;
};

function originGatewayFor(node: SupplyOptimizationNode, mode: "ocean" | "air"): PlanningGateway {
  const country = countryFor(node.location);
  const value = node.location.toLowerCase();
  if (country === "TW" && mode === "ocean") {
    return { label: "Port of Kaohsiung, confirm terminal", coordinates: { latitude: 22.6163, longitude: 120.2923 } };
  }
  if (country === "TW") {
    return { label: "Taiwan Taoyuan Airport, confirm handling", coordinates: { latitude: 25.0797, longitude: 121.2342 } };
  }
  if (country === "CN" && mode === "ocean") {
    return { label: "Yantian Port, confirm terminal", coordinates: { latitude: 22.576, longitude: 114.272 } };
  }
  if (country === "CN") {
    return { label: "Shenzhen Bao'an Airport, confirm handling", coordinates: { latitude: 22.6393, longitude: 113.8107 } };
  }
  if (country === "CA") {
    return mode === "ocean"
      ? { label: "Port of Montreal, confirm terminal", coordinates: { latitude: 45.56, longitude: -73.52 } }
      : { label: "Montreal Trudeau Airport, confirm handling", coordinates: { latitude: 45.4706, longitude: -73.7408 } };
  }
  if (country === "US") {
    if (/los angeles|california/.test(value)) {
      return mode === "ocean"
        ? { label: "Port of Los Angeles, confirm terminal", coordinates: { latitude: 33.7405, longitude: -118.271 } }
        : { label: "Los Angeles International Airport", coordinates: { latitude: 33.9416, longitude: -118.4085 } };
    }
    return mode === "ocean"
      ? { label: "U.S. export port to confirm", coordinates: node.coordinates! }
      : { label: "U.S. cargo airport to confirm", coordinates: node.coordinates! };
  }
  if (country === "EU") {
    return mode === "ocean"
      ? { label: "Port of Hamburg, confirm terminal", coordinates: { latitude: 53.5461, longitude: 9.9661 } }
      : { label: "Frankfurt Airport, confirm handling", coordinates: { latitude: 50.0379, longitude: 8.5622 } };
  }
  return { label: `${mode === "ocean" ? "Origin port" : "Origin airport"} to confirm`, coordinates: node.coordinates! };
}

function receivingGatewayFor(node: SupplyOptimizationNode, mode: "ocean" | "air"): PlanningGateway {
  const country = countryFor(node.location);
  const value = node.location.toLowerCase();
  if (country === "CA") {
    return mode === "ocean"
      ? { label: "Port of Montreal, confirm terminal", coordinates: { latitude: 45.56, longitude: -73.52 } }
      : { label: "Montreal Trudeau Airport, confirm handling", coordinates: { latitude: 45.4706, longitude: -73.7408 } };
  }
  if (country === "US") {
    if (/detroit|michigan|great lakes|midwest/.test(value)) {
      return mode === "ocean"
        ? { label: "Port of Detroit, confirm terminal", coordinates: { latitude: 42.318, longitude: -83.071 } }
        : { label: "Detroit Metro Airport, confirm handling", coordinates: { latitude: 42.2162, longitude: -83.3554 } };
    }
    return mode === "ocean"
      ? { label: "U.S. receiving port to confirm", coordinates: node.coordinates! }
      : { label: "U.S. cargo airport to confirm", coordinates: node.coordinates! };
  }
  if (country === "EU") {
    return mode === "ocean"
      ? { label: "Port of Hamburg, confirm terminal", coordinates: { latitude: 53.5461, longitude: 9.9661 } }
      : { label: "Frankfurt Airport, confirm handling", coordinates: { latitude: 50.0379, longitude: 8.5622 } };
  }
  return { label: `${mode === "ocean" ? "Receiving port" : "Receiving airport"} to confirm`, coordinates: node.coordinates! };
}

function customsPoint(gateway: PlanningGateway, destination: SupplyCoordinate): PlanningGateway {
  const longitudeDirection = destination.longitude >= gateway.coordinates.longitude ? 1 : -1;
  return {
    label: "Customs release, broker to confirm",
    coordinates: {
      latitude: gateway.coordinates.latitude + 0.12,
      longitude: gateway.coordinates.longitude + 0.16 * longitudeDirection,
    },
  };
}

function routeSegmentsFor(
  edge: SupplyOptimizationEdge,
  from: SupplyOptimizationNode,
  to: SupplyOptimizationNode,
): SupplyCommandRouteSegment[] {
  const mode = edge.mode.toLowerCase();
  const international = isCrossBorder(from, to);
  const primaryMode: "ocean" | "air" | "road" = /ocean/.test(mode)
    ? "ocean"
    : /air/.test(mode) && international
      ? "air"
      : "road";

  if (primaryMode === "road") {
    const profile = international ? customsProfile(from, to, midpoint(from.coordinates!, to.coordinates!)) : null;
    if (!profile) {
      return [{
        id: `${edge.id}:road`,
        sequence: 1,
        mode: "road",
        label: edge.stage === "inbound" ? "Supplier pickup and linehaul" : "Customer delivery",
        from: from.coordinates!,
        to: to.coordinates!,
        fromLabel: from.label,
        toLabel: to.label,
        status: "inferred",
      }];
    }
    return [
      {
        id: `${edge.id}:road-origin`, sequence: 1, mode: "road", label: "Cross-border linehaul",
        from: from.coordinates!, to: profile.coordinates, fromLabel: from.label, toLabel: profile.label, status: "inferred",
      },
      {
        id: `${edge.id}:road-destination`, sequence: 2, mode: "road", label: "Released delivery",
        from: profile.coordinates, to: to.coordinates!, fromLabel: profile.label, toLabel: to.label, status: "inferred",
      },
    ];
  }

  const originGateway = originGatewayFor(from, primaryMode);
  const receivingGateway = receivingGatewayFor(to, primaryMode);
  const clearance = customsPoint(receivingGateway, to.coordinates!);
  return [
    {
      id: `${edge.id}:pickup`, sequence: 1, mode: "road", label: "Supplier pickup",
      from: from.coordinates!, to: originGateway.coordinates, fromLabel: from.label, toLabel: originGateway.label, status: "inferred",
    },
    {
      id: `${edge.id}:main`, sequence: 2, mode: primaryMode, label: primaryMode === "ocean" ? "Ocean main carriage" : "Air main carriage",
      from: originGateway.coordinates, to: receivingGateway.coordinates, fromLabel: originGateway.label, toLabel: receivingGateway.label, status: "inferred",
    },
    {
      id: `${edge.id}:customs`, sequence: 3, mode: "customs", label: "Customs release",
      from: receivingGateway.coordinates, to: clearance.coordinates, fromLabel: receivingGateway.label, toLabel: clearance.label, status: "inferred",
    },
    {
      id: `${edge.id}:delivery`, sequence: 4, mode: "road", label: "Final-mile delivery",
      from: clearance.coordinates, to: to.coordinates!, fromLabel: clearance.label, toLabel: to.label, status: "inferred",
    },
  ];
}

function movementContacts(
  edge: SupplyOptimizationEdge,
  from: SupplyOptimizationNode,
  to: SupplyOptimizationNode,
) {
  const mode = edge.mode.toLowerCase();
  const contacts: SupplyCommandContact[] = regionalContactsForLane(from, to);
  const crossBorder = isCrossBorder(from, to);
  if (/air|ocean|international|cross-border/.test(mode) || crossBorder) addContact(contacts, DHL_GLOBAL_FORWARDING);
  if (/ocean/.test(mode)) {
    addContact(contacts, MAERSK_OCEAN);
    addContact(contacts, MSC_OCEAN);
    addContact(contacts, CMA_CGM_OCEAN);
    addContact(contacts, KUEHNE_NAGEL);
  }
  if (/air/.test(mode)) {
    addContact(contacts, KUEHNE_NAGEL);
    addContact(contacts, DSV_AIR);
  }
  if (/truck|ltl|flatbed|road|courier/.test(mode) || !contacts.length) addContact(contacts, UBER_FREIGHT);
  if (/truck|ltl|flatbed|road|courier/.test(mode)) {
    addContact(contacts, SCHNEIDER_FREIGHT);
    addContact(contacts, JB_HUNT);
    addContact(contacts, ARCBEST);
  }
  if (/air|ocean|international/.test(mode)) {
    for (const contact of borderContacts(from, to)) addContact(contacts, contact);
  }
  return contacts.slice(0, 9);
}

function customsProfile(from: SupplyOptimizationNode, to: SupplyOptimizationNode, fallback: SupplyCoordinate) {
  const countries = new Set([countryFor(from.location), countryFor(to.location)]);
  if (countries.has("CA") && countries.has("US")) {
    return {
      label: "Windsor-Detroit customs",
      location: "Ambassador Bridge corridor",
      coordinates: { latitude: 42.3125, longitude: -83.0743 },
      detail: "The cross-border truck path needs a named broker, importer-of-record confirmation, origin support, classification, valuation, and PAPS acceptance before the carrier reaches the border.",
      contacts: [FARROW, LIVINGSTON],
    };
  }
  if (countries.has("CN") && countries.has("US")) {
    return {
      label: "U.S. import clearance",
      location: "Receiving gateway to confirm",
      coordinates: fallback,
      detail: "The receiving port is not confirmed. Select the gateway only after cargo readiness, mode, final destination, tariff treatment, broker coverage, and inland cost are compared.",
      contacts: [DHL_GLOBAL_FORWARDING, EXPEDITORS],
    };
  }
  if (countries.has("MX") && countries.has("US")) {
    return {
      label: "U.S.-Mexico customs",
      location: "Port of entry to confirm",
      coordinates: fallback,
      detail: "The road path needs a named U.S. broker, Mexican export coordination, commercial documents, classification, origin support, and pre-arrival release confirmation.",
      contacts: [DHL_GLOBAL_FORWARDING, EXPEDITORS],
    };
  }
  if (countries.has("US") && countries.size > 1 && !countries.has(null)) {
    return {
      label: "International customs handoff",
      location: "Export and import gateways to confirm",
      coordinates: fallback,
      detail: "Assign both export and import owners, confirm classification and licensing, choose the entry model, validate dangerous-goods or temporary-admission scope, and obtain broker acceptance before tender.",
      contacts: [DHL_GLOBAL_FORWARDING, EXPEDITORS],
    };
  }
  return {
    label: "Customs handoff",
    location: "Gateway to confirm",
    coordinates: fallback,
    detail: "Assign the importer, broker, port, classification, origin support, valuation method, and pre-arrival filing owner before tender.",
      contacts: [DHL_GLOBAL_FORWARDING, EXPEDITORS],
  };
}

function nodeObjects(model: SupplyOptimizationModel): SupplyCommandObject[] {
  return model.nodes.flatMap((node) => {
    if (!node.coordinates) return [];
    const basisStatus = statusForBasis(node.basis);
    const workstreams = nodeWorkstreams(node);
    return [{
      id: `node:${node.id}`,
      nodeId: node.id,
      kind: nodeKind(node),
      label: node.label,
      location: node.location,
      coordinates: node.coordinates,
      detail: node.detail,
      cargo: node.cargo,
      basis: node.basis,
      confidence: node.confidence,
      status: basisStatus.status,
      statusLabel: basisStatus.label,
      nextAction: node.confirmNext,
      workstreamId: nodeWorkstream(node),
      contacts: providerContactsForNode(node, model),
      checks: [],
      priority: actionPriority(model, workstreams[0]),
      optimizationIds: optimizationIds(model, workstreams),
    } satisfies SupplyCommandObject];
  });
}

function edgeObjects(model: SupplyOptimizationModel): { objects: SupplyCommandObject[]; routes: SupplyCommandRoute[] } {
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const objects: SupplyCommandObject[] = [];
  const routes: SupplyCommandRoute[] = [];

  for (const edge of model.edges) {
    const from = nodes.get(edge.fromNodeId);
    const to = nodes.get(edge.toNodeId);
    if (!from?.coordinates || !to?.coordinates) continue;
    const segments = routeSegmentsFor(edge, from, to);
    const primaryTransport = segments.find((segment) => segment.mode === "ocean" || segment.mode === "air")
      ?? segments.find((segment) => segment.mode === "road")
      ?? segments[0];
    const routeMidpoint = primaryTransport
      ? midpoint(primaryTransport.from, primaryTransport.to)
      : midpoint(from.coordinates, to.coordinates);
    const crossBorder = isCrossBorder(from, to);
    const routePriority = actionPriority(model, "shipment_planning");
    const rateEstimate = rateEstimateFor(edge, from, to);

    routes.push({
      id: `route:${edge.id}`,
      edgeId: edge.id,
      from: from.coordinates,
      to: to.coordinates,
      fromLabel: from.label,
      toLabel: to.label,
      label: `${from.label} to ${to.label}`,
      mode: edge.mode,
      cargo: edge.cargo,
      stage: edge.stage,
      basis: edge.basis,
      confidence: edge.confidence,
      priority: routePriority,
      rateEstimate,
      segments,
    });

    objects.push({
      id: `movement:${edge.id}`,
      edgeId: edge.id,
      kind: "movement",
      label: `${from.label} to ${to.label}`,
      location: edge.mode,
      coordinates: routeMidpoint,
      detail: edge.detail,
      cargo: edge.cargo,
      basis: edge.basis,
      confidence: edge.confidence,
      status: "review",
      statusLabel: "Lane to quote",
      nextAction: "Confirm origin, destination, cargo dimensions, weight, readiness date, and delivery window, then request comparable door-to-door rates.",
      workstreamId: "shipment_planning",
      contacts: movementContacts(edge, from, to),
      checks: [
        { label: "Current rate", status: "missing" },
        { label: "Transit and capacity", status: "review" },
        { label: "Pickup and delivery constraints", status: "review" },
      ],
      priority: routePriority,
      optimizationIds: optimizationIds(model, ["shipment_planning"]),
      rateEstimate,
    });

    if (crossBorder) {
      const customsSegment = segments.find((segment) => segment.mode === "customs");
      const roadCustomsHandoff = segments.length > 1 && segments.every((segment) => segment.mode === "road")
        ? segments[0]?.to
        : undefined;
      const profile = customsProfile(from, to, customsSegment?.to ?? roadCustomsHandoff ?? routeMidpoint);
      objects.push({
        id: `customs:${edge.id}`,
        edgeId: edge.id,
        kind: "customs",
        label: profile.label,
        location: profile.location,
        coordinates: profile.coordinates,
        detail: profile.detail,
        cargo: edge.cargo,
        basis: "inferred",
        confidence: "low",
        status: "unassigned",
        statusLabel: "Broker not assigned",
        nextAction: "Choose the port and broker, then send the product, origin, seller, buyer, value, Incoterm, and transport documents for entry review.",
        workstreamId: "customs",
        contacts: profile.contacts,
        checks: [
          { label: "Customs broker", status: "missing" },
          { label: "HTS and country of origin", status: "review" },
          { label: "Commercial invoice", status: "review" },
          { label: "Pre-arrival acceptance", status: "missing" },
        ],
        priority: actionPriority(model, "customs"),
        optimizationIds: optimizationIds(model, ["customs"]),
      });
    }
  }

  return { objects, routes };
}

export function buildSupplyCommandMap(
  model: SupplyOptimizationModel,
  _dashboard: SupplyCaseDashboard,
): SupplyCommandMap {
  const edgeData = edgeObjects(model);
  return {
    objects: [...nodeObjects(model), ...edgeData.objects],
    routes: edgeData.routes,
  };
}
