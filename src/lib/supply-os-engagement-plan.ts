import type {
  SupplyCaseDashboard,
  SupplyCoordinate,
  SupplyEngagementScope,
} from "./supply-os-case-model";

export const SUPPLY_ENGAGEMENT_OPTIONS: ReadonlyArray<{
  id: SupplyEngagementScope;
  label: string;
  shortLabel: string;
  startLabel: string;
}> = [
  { id: "full_operation", label: "Run the whole operation", shortLabel: "Full operation", startLabel: "the full operation" },
  { id: "supplier_sourcing", label: "Find and qualify suppliers", shortLabel: "Find suppliers", startLabel: "supplier sourcing" },
  { id: "inbound_logistics", label: "Move components to production", shortLabel: "Move components", startLabel: "inbound logistics" },
  { id: "customs", label: "Prepare and coordinate customs", shortLabel: "Handle customs", startLabel: "customs preparation" },
  { id: "finished_goods_delivery", label: "Deliver finished goods", shortLabel: "Deliver goods", startLabel: "finished-goods delivery" },
];

export type SupplyWorkstreamId =
  | "supplier_sourcing"
  | "supplier_coordination"
  | "inbound_logistics"
  | "customs"
  | "finished_goods_delivery";

export type SupplyWorkstream = {
  id: SupplyWorkstreamId;
  number: string;
  label: string;
  outcome: string;
  steps: string[];
  state: "owned" | "start_here" | "available";
  stateLabel: string;
};

export type SupplyNetworkFlow = {
  id: string;
  kind: "inbound" | "outbound";
  from: { label: string; coordinates: SupplyCoordinate | null };
  to: { label: string; coordinates: SupplyCoordinate | null };
  label: string;
  detail: string;
};

export type SupplyExecutionSection = {
  id: string;
  label: string;
  summary: string;
  steps: string[];
};

export type SupplyEngagementPlan = {
  scope: SupplyEngagementScope;
  scopeLabel: string;
  headline: string;
  summary: string;
  workstreams: SupplyWorkstream[];
  kickoffInputs: string[];
  kickoffNote: string;
  flows: SupplyNetworkFlow[];
  executionSections: SupplyExecutionSection[];
  inboundSummary: string;
  outboundSummary: string;
};

function naturalList(values: readonly string[], fallback: string): string {
  const clean = values.map((value) => value.trim()).filter(Boolean);
  if (!clean.length) return fallback;
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean.at(-1)}`;
}

function finishedGoodsLabel(industry: string): string {
  if (/robotics/i.test(industry)) return "robots, spares, and replacement parts";
  if (/aerospace|defense/i.test(industry)) return "systems, spares, and service parts";
  if (/medical/i.test(industry)) return "devices, accessories, and service parts";
  if (/automotive/i.test(industry)) return "production parts and service parts";
  if (/chemical/i.test(industry)) return "finished products and replenishment orders";
  if (/metal/i.test(industry)) return "stock, cut-to-size orders, and replenishment material";
  return "finished goods and service parts";
}

type EngagementCustomsMode = "import" | "domestic" | "unknown";

function engagementCustomsMode(dashboard: SupplyCaseDashboard): EngagementCustomsMode {
  if (dashboard.customsChecks.some((check) => check.id === "domestic-regulatory-review")) return "domestic";
  if (dashboard.customsChecks.some((check) => check.id === "customs-scope-confirmation")) return "unknown";
  return "import";
}

function workstreamState(
  scope: SupplyEngagementScope,
  id: SupplyWorkstreamId,
): Pick<SupplyWorkstream, "state" | "stateLabel"> {
  if (scope === "full_operation") return { state: "owned", stateLabel: "Derya owns" };
  if (scope === id) {
    return { state: "start_here", stateLabel: "Start here" };
  }
  return { state: "available", stateLabel: "Available next" };
}

function engagementSummary(
  scope: SupplyEngagementScope,
  needs: string,
  sources: string,
  production: string,
  destinations: string,
  finishedGoods: string,
  customsMode: EngagementCustomsMode,
): string {
  if (scope === "supplier_sourcing") {
    return `We will qualify suppliers for ${needs} against specification, MOQ, lead time, quality evidence, and landed cost. Derya can take over coordination, inbound movement, customs, and delivery when you want one owner.`;
  }
  if (scope === "inbound_logistics") {
    return `We will coordinate supplier readiness, tender the same door-to-door scope, and move components from ${sources} into ${production}. Supplier sourcing, customs, and finished-goods delivery remain available.`;
  }
  if (scope === "customs") {
    if (customsMode === "domestic") {
      return "We will confirm commodity transport rules, carrier requirements, receiving constraints, and the documents needed for the domestic movement. No import broker workflow is assumed.";
    }
    if (customsMode === "unknown") {
      return "We will confirm the supplier, production, destination, commodity, and transaction facts first. Then Derya will determine whether an import entry and licensed broker are required.";
    }
    return `We will build the product and transaction fact packet, compare licensed brokers, prepare classification candidates, and manage document gaps through release. The broker retains approval and filing authority.`;
  }
  if (scope === "finished_goods_delivery") {
    return `We will plan pickup from ${production}, tender the route, coordinate receiving appointments, and deliver ${finishedGoods} to ${destinations}. Upstream sourcing, imports, and customs remain available.`;
  }
  const customsCoverage = customsMode === "import"
    ? "prepare the licensed-broker handoff"
    : customsMode === "domestic"
      ? "confirm domestic transport and regulatory requirements"
      : "determine whether a customs entry is required";
  return `We can qualify suppliers for ${needs}, coordinate pickups and movement into ${production}, ${customsCoverage}, and deliver ${finishedGoods} to ${destinations}. Start with the whole operation or one workstream.`;
}

function kickoffForScope(
  scope: SupplyEngagementScope,
  customsMode: EngagementCustomsMode,
): Pick<SupplyEngagementPlan, "kickoffInputs" | "kickoffNote"> {
  if (scope === "supplier_sourcing") {
    return {
      kickoffInputs: [
        "Part specifications, target quantities, and target landed cost",
        "Quality, certification, geography, or supplier constraints",
        "Next production deadline and any supplier quotes already received",
      ],
      kickoffNote: "No supplier list is required. Derya can build the market, qualify options, and bring awards back for approval.",
    };
  }
  if (scope === "inbound_logistics") {
    return {
      kickoffInputs: [
        "Supplier pickup locations and confirmed cargo-ready dates",
        "Package count, dimensions, weight, commodity, and handling needs",
        "Production delivery address, deadline, and agreed Incoterm",
      ],
      kickoffNote: "Keep the current forwarder or let Derya retender the lane. Either way, Derya can own follow-ups and exceptions.",
    };
  }
  if (scope === "customs") {
    if (customsMode === "domestic") {
      return {
        kickoffInputs: [
          "Exact pickup and delivery locations with responsible contacts",
          "Commodity, package details, handling needs, and declared value",
          "Ready date, delivery deadline, commercial terms, and current carrier",
        ],
        kickoffNote: "No import entry is modeled. Derya will confirm commodity-specific transport and receiving requirements before tender.",
      };
    }
    if (customsMode === "unknown") {
      return {
        kickoffInputs: [
          "Exact supplier, production, and delivery countries",
          "Product description, material, function, and country of origin",
          "Commercial value, Incoterm, expected movement date, and parties",
        ],
        kickoffNote: "Derya will establish the customs scope first and engage a licensed broker only if an import entry is required.",
      };
    }
    return {
      kickoffInputs: [
        "Product description, material, function, and HTS code if known",
        "Commercial value, country of origin, seller, buyer, and Incoterm",
        "Importer and broker details plus the expected entry date",
      ],
      kickoffNote: "Derya prepares and coordinates the entry packet. A licensed broker approves treatment and files the entry.",
    };
  }
  if (scope === "finished_goods_delivery") {
    return {
      kickoffInputs: [
        "Pickup and delivery addresses with receiving contacts",
        "Package count, dimensions, weight, equipment, and handling needs",
        "Ready date, required delivery date, and appointment requirements",
      ],
      kickoffNote: "Use the current carrier or let Derya compare alternatives. Derya can own pickup through proof of delivery.",
    };
  }
  return {
    kickoffInputs: [
      "BOM or component list with specifications and target quantities",
      "Current supplier contacts, quotes, or purchase orders, if any",
      "Next production date or customer delivery deadline",
    ],
    kickoffNote: "No suppliers yet? Start with the BOM. Keeping current forwarders or brokers? Derya can manage follow-ups while you retain the relationship.",
  };
}

function routeNode(
  dashboard: SupplyCaseDashboard,
  kind: "headquarters" | "source" | "destination",
  label: string,
) {
  return dashboard.routeNodes.find((node) => node.kind === kind && node.label === label)
    ?? dashboard.routeNodes.find((node) => node.kind === kind && node.label.includes(label))
    ?? null;
}

function buildFlows(dashboard: SupplyCaseDashboard): SupplyNetworkFlow[] {
  const production = dashboard.productionLocation ?? dashboard.company.productionSite?.value ?? dashboard.companyLocation;
  if (!production) return [];
  const headquartersNode = routeNode(dashboard, "headquarters", production);
  const caseNeeds = naturalList(dashboard.sourcingNeeds, "production inputs to confirm");
  const flows: SupplyNetworkFlow[] = dashboard.sourceRegions.map((source, index) => {
    const sourceNode = routeNode(dashboard, "source", source);
    return {
      id: `inbound-${index + 1}`,
      kind: "inbound",
      from: { label: source, coordinates: sourceNode?.coordinates ?? null },
      to: { label: production, coordinates: headquartersNode?.coordinates ?? null },
      label: "Components to production",
      detail: dashboard.sourceRegions.length === 1
        ? `${caseNeeds} into ${production}`
        : `Component allocation to ${source} is not confirmed. Case requirements: ${caseNeeds}.`,
    };
  });

  for (const [index, destination] of dashboard.destinations.entries()) {
    const destinationNode = routeNode(dashboard, "destination", destination);
    flows.push({
      id: `outbound-${index + 1}`,
      kind: "outbound",
      from: { label: production, coordinates: headquartersNode?.coordinates ?? null },
      to: { label: destination, coordinates: destinationNode?.coordinates ?? null },
      label: "Finished goods to customer",
      detail: `${finishedGoodsLabel(dashboard.companyDescription)} to ${destination}`,
    });
  }
  return flows;
}

export function buildSupplyEngagementPlan(
  dashboard: SupplyCaseDashboard,
  requestedScope: SupplyEngagementScope = dashboard.engagementScope ?? "full_operation",
): SupplyEngagementPlan {
  const company = dashboard.companyName ?? "This company";
  const production = dashboard.productionLocation
    ?? dashboard.company.productionSite?.value
    ?? dashboard.companyLocation
    ?? "the production site";
  const needs = naturalList(dashboard.sourcingNeeds, "critical production inputs");
  const sources = naturalList(dashboard.sourceRegions, "supplier regions to confirm");
  const destinations = naturalList(dashboard.destinations, "customer locations to confirm");
  const finishedGoods = finishedGoodsLabel(dashboard.companyDescription);
  const customsMode = engagementCustomsMode(dashboard);
  const option = SUPPLY_ENGAGEMENT_OPTIONS.find((item) => item.id === requestedScope)
    ?? SUPPLY_ENGAGEMENT_OPTIONS[0];
  const fullOperation = requestedScope === "full_operation";
  const customsScopeCopy = customsMode === "import"
    ? { label: "Prepare and coordinate customs", startLabel: "customs preparation" }
    : customsMode === "domestic"
      ? { label: "Confirm domestic transport requirements", startLabel: "domestic transport requirements" }
      : { label: "Confirm customs scope", startLabel: "customs scope confirmation" };
  const inboundComplianceStep = customsMode === "import"
    ? "Coordinate the handoff to the customer-approved licensed broker"
    : customsMode === "domestic"
      ? "Confirm commodity and receiving constraints before tender"
      : "Confirm countries and whether a border handoff is required";

  const customsWorkstream = customsMode === "import"
    ? {
        label: "Clear customs",
        outcome: "A product fact packet, qualified licensed broker, entry-document review, and release coordination.",
        steps: [
          "Build item, origin, value, and transaction facts",
          "Prepare classification candidates for broker review",
          "Qualify a licensed broker and confirm importer setup",
          "Track document gaps, entry exceptions, and release",
        ],
      }
    : customsMode === "domestic"
      ? {
          label: "Confirm regulations",
          outcome: "Confirmed commodity transport rules, carrier requirements, shipment documents, and receiving constraints.",
          steps: [
            "Confirm the domestic origin and destination",
            "Check commodity-specific transport and agency rules",
            "Align carrier, handling, and receiving requirements",
            "Approve the documents and operating commitment",
          ],
        }
      : {
          label: "Confirm customs scope",
          outcome: "Confirmed countries, border path, product facts, and a decision on whether an import entry is required.",
          steps: [
            "Confirm supplier, production, and destination countries",
            "Confirm product, origin, value, and transaction facts",
            "Determine whether an import entry is required",
            "Engage a licensed broker only when required",
          ],
        };

  const workstreams: SupplyWorkstream[] = [
    {
      id: "supplier_sourcing",
      number: "01",
      label: "Find suppliers",
      outcome: `Qualified options for ${needs}, with MOQ, lead time, quality evidence, and alternate sources.`,
      steps: [
        "Confirm the specification and target volume",
        "Find and screen capable manufacturers or distributors",
        "Compare MOQ, lead time, quality evidence, and landed cost",
        "Keep a qualified alternate for critical parts",
      ],
      ...workstreamState(requestedScope, "supplier_sourcing"),
    },
    {
      id: "supplier_coordination",
      number: "02",
      label: "Coordinate suppliers",
      outcome: "Confirmed readiness dates, purchase-order follow-ups, export documents, and one pickup plan.",
      steps: [
        "Follow up on orders and production readiness",
        "Collect invoices, packing lists, and origin records",
        "Combine compatible pickups and flag late components",
      ],
      ...workstreamState(requestedScope, "supplier_coordination"),
    },
    {
      id: "inbound_logistics",
      number: "03",
      label: "Move components",
      outcome: `Pickup, consolidation, route tender, milestone control, and delivery from ${sources} into ${production}.`,
      steps: [
        "Build the pickup and consolidation plan",
        "Tender forwarders on the same door-to-door scope",
        "Select mode and gateway against the production deadline",
        inboundComplianceStep,
        "Manage handoffs, exceptions, and factory delivery",
      ],
      ...workstreamState(requestedScope, "inbound_logistics"),
    },
    {
      id: "customs",
      number: "04",
      ...customsWorkstream,
      ...workstreamState(requestedScope, "customs"),
    },
    {
      id: "finished_goods_delivery",
      number: "05",
      label: "Deliver finished goods",
      outcome: `Pickup from ${production}, customer or install-site appointments, tracking, and proof of delivery across ${destinations}.`,
      steps: [
        `Plan shipments for ${finishedGoods}`,
        "Tender the customer or install-site route",
        "Coordinate appointments, equipment, and receiving rules",
        "Track delivery, proof of delivery, returns, and spare-parts needs",
      ],
      ...workstreamState(requestedScope, "finished_goods_delivery"),
    },
  ];

  const selectedWorkstream = (id: SupplyWorkstreamId) => {
    const selected = workstreams.find((workstream) => workstream.id === id);
    if (!selected) throw new Error(`Missing Supply OS workstream: ${id}`);
    return selected;
  };
  const inboundSummary = customsMode === "import"
    ? `${sources} to ${production}: source, coordinate, move, clear, and deliver components into production.`
    : customsMode === "domestic"
      ? `${sources} to ${production}: source, coordinate, move, confirm transport requirements, and deliver components into production.`
      : `${sources} to ${production}: source, coordinate, confirm border requirements, move, and deliver components into production.`;
  const outboundSummary = `${production} to ${destinations}: move ${finishedGoods} to customers or install sites and retain proof of delivery.`;
  const executionSections: SupplyExecutionSection[] = fullOperation
    ? [
        {
          id: "inbound-operation",
          label: "Inbound components",
          summary: inboundSummary,
          steps: [
            "Supplier qualification and award approval",
            "Purchase-order and cargo-readiness follow-up",
            "Pickup, consolidation, and forwarder tender",
            inboundComplianceStep,
            "Production-site delivery and receipt",
          ],
        },
        {
          id: "finished-goods-operation",
          label: "Finished goods",
          summary: outboundSummary,
          steps: selectedWorkstream("finished_goods_delivery").steps,
        },
      ]
    : (() => {
        const workstreamId = requestedScope === "supplier_sourcing"
          ? "supplier_sourcing"
          : requestedScope === "inbound_logistics"
            ? "inbound_logistics"
            : requestedScope === "customs"
              ? "customs"
              : "finished_goods_delivery";
        const workstream = selectedWorkstream(workstreamId);
        return [{
          id: `${workstream.id}-operation`,
          label: workstream.label,
          summary: workstream.outcome,
          steps: workstream.steps,
        }];
      })();

  const headline = fullOperation
    ? `${company} can hand Derya the whole supply chain.`
    : `Derya can start with ${requestedScope === "customs" ? customsScopeCopy.startLabel : option.startLabel} for ${company}.`;
  const kickoff = kickoffForScope(requestedScope, customsMode);

  return {
    scope: requestedScope,
    scopeLabel: requestedScope === "customs" ? customsScopeCopy.label : option.label,
    headline,
    summary: engagementSummary(requestedScope, needs, sources, production, destinations, finishedGoods, customsMode),
    workstreams,
    ...kickoff,
    flows: buildFlows(dashboard),
    executionSections,
    inboundSummary,
    outboundSummary,
  };
}
