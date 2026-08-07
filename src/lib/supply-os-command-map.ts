import type { SupplyCaseDashboard, SupplyCoordinate } from "./supply-os-case-model";
import type {
  SupplyOptimizationBasis,
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
  nodeId?: string;
  edgeId?: string;
};

export type SupplyCommandRoute = {
  id: string;
  edgeId: string;
  from: SupplyCoordinate;
  to: SupplyCoordinate;
  stage: SupplyOptimizationEdge["stage"];
  basis: SupplyOptimizationEdge["basis"];
  confidence: SupplyOptimizationConfidence;
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
};

const UBER_FREIGHT: SupplyCommandContact = {
  id: "uber-freight",
  name: "Uber Freight",
  role: "Domestic truck capacity",
  fit: "Instant FTL and LTL quoting, booking, and tracking for U.S. pickup and delivery legs.",
  url: "https://www.uberfreight.com/en-US/technology/instant-freight-quote",
};

const LIVINGSTON: SupplyCommandContact = {
  id: "livingston",
  name: "Livingston International",
  role: "U.S.-Canada customs broker",
  fit: "Brokerage and clearance support across U.S.-Canada border points, including shipment status support.",
  url: "https://www.livingstonintl.com/contact-us/",
};

const FARROW: SupplyCommandContact = {
  id: "farrow",
  name: "Farrow",
  role: "Windsor-Detroit customs broker",
  fit: "Windsor-based customs brokerage, trade consulting, PAPS support, and cross-border logistics.",
  url: "https://farrow.com/customs-brokerage/",
};

const EXPEDITORS: SupplyCommandContact = {
  id: "expeditors-customs",
  name: "Expeditors",
  role: "International customs broker and forwarder",
  fit: "Customs brokerage, trade compliance, air and ocean forwarding, and handoff coordination for international production and service movements.",
  url: "https://www.expeditors.com/services/customs-and-compliance",
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
    }));
  }

  const contacts: SupplyCommandContact[] = countryFor(node.location) === "US" ? [UBER_FREIGHT] : [];
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

function countryFor(location: string): "US" | "CA" | "CN" | "MX" | "GB" | "EU" | "OM" | "FJ" | null {
  const value = location.toLowerCase();
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

function movementContacts(
  edge: SupplyOptimizationEdge,
  from: SupplyOptimizationNode,
  to: SupplyOptimizationNode,
) {
  const mode = edge.mode.toLowerCase();
  const contacts: SupplyCommandContact[] = [];
  const crossBorder = isCrossBorder(from, to);
  if (/air|ocean|international|cross-border/.test(mode) || crossBorder) contacts.push(DHL_GLOBAL_FORWARDING);
  if (/truck|ltl|flatbed|road|courier/.test(mode) || !contacts.length) addContact(contacts, UBER_FREIGHT);
  for (const contact of borderContacts(from, to)) addContact(contacts, contact);
  return contacts;
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
    const routeMidpoint = midpoint(from.coordinates, to.coordinates);
    const crossBorder = isCrossBorder(from, to);

    routes.push({
      id: `route:${edge.id}`,
      edgeId: edge.id,
      from: from.coordinates,
      to: to.coordinates,
      stage: edge.stage,
      basis: edge.basis,
      confidence: edge.confidence,
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
    });

    if (crossBorder) {
      const profile = customsProfile(from, to, routeMidpoint);
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
