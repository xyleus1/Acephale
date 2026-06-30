export type ReferenceDealStatus = "BOOKED" | "PRICING" | "SPECULATION" | "MISSED";

export type ReferenceDeal = {
  id: string;
  contact: string;
  type: "Freight" | "Supply" | "Supply + Freight" | "Financing";
  contract: string;
  status: string;
  statusGroup: ReferenceDealStatus;
  cadence: "Monthly" | "One off" | "";
  contractValue: number | null;
  contractCurrency: "USD" | "TRY" | null;
  profit: number | null;
  profitCurrency: "USD" | "TRY" | null;
  quantity: string;
  unit: string;
  product: string;
  origin: string;
  destination: string;
  incoterms: string;
  specs: string;
  notes: string;
};

export type ReferenceDealSummary = {
  totalRows: number;
  activeRows: number;
  monthlyRows: number;
  knownContractUsd: number;
  knownProfitUsd: number;
  byStatus: Record<ReferenceDealStatus, number>;
  byType: Array<{ type: ReferenceDeal["type"]; count: number; knownProfitUsd: number }>;
  byContact: Array<{ contact: string; count: number; knownProfitUsd: number }>;
  topDeals: Array<ReferenceDeal & { score: number; missingFields: string[] }>;
  hygiene: {
    incompleteFreightRows: number;
    missingProfitRows: number;
    missingOriginDestinationRows: number;
  };
};

export type ReferenceDealDecision = {
  key: string;
  tone: "critical" | "high" | "normal";
  title: string;
  meta: string;
  actionLabel: string;
  score: number;
  dealId: string;
  contact: string;
  missingFields: string[];
  nextAction: string;
  priorityFactors: Array<{
    label: string;
    value: string;
    tone: "strong" | "watch" | "weak";
  }>;
  decision: ReferenceDealDecisionPlan;
};

export type ReferenceDealOperatorPlaybook = {
  headline: string;
  firstMove: string;
  safetyRule: string;
  visualTarget: string;
  reviewHref: string;
  topDecision: {
    dealId: string;
    title: string;
    actionLabel: string;
    stageLabel: string;
    owner: ReferenceDealDecisionPlan["owner"];
    canCreateRfq: boolean;
    evidenceGaps: string[];
  } | null;
  decisionCounts: {
    rfqCandidates: number;
    blockedForFacts: number;
    nonRfqContext: number;
    bookedProof: number;
    lossEvidence: number;
  };
  answerRules: string[];
};

export type ReferenceDealRfqDraft = {
  sourceKey: string;
  subject: string;
  fromCompany: string;
  type: "FORWARDING" | "SOURCING";
  origin: string | null;
  destination: string | null;
  mode: string | null;
  containerCount: number | null;
  containerType: string | null;
  commodity: string | null;
  weight: number | null;
  incoterms: string | null;
  targetPriceStatus: "UNKNOWN";
  notes: string;
  rawEmailBody: string;
};

export type ReferenceDealDecisionPlan = {
  stage: "QUALIFY_LEAD" | "PRICE_LEAD" | "VERIFY_DEMAND" | "MARGIN_PROOF" | "LOSS_REVIEW" | "NON_RFQ";
  stageLabel: string;
  owner: "CUSTOMER" | "INTERNAL" | "OPERATOR";
  command: string;
  stopRule: string;
  actionLabel: string;
  canCreateRfq: boolean;
  proofStatus: "blocked" | "review" | "ready" | "info";
  economicsPosture: string;
  evidenceGaps: string[];
};

function usd(value: number) {
  return { value, currency: "USD" as const };
}

function tryAmount(value: number) {
  return { value, currency: "TRY" as const };
}

function statusGroup(status: string): ReferenceDealStatus {
  const s = status.toLowerCase();
  if (s.includes("booked")) return "BOOKED";
  if (s.includes("missed")) return "MISSED";
  if (s.includes("speculation")) return "SPECULATION";
  return "PRICING";
}

function row(input: Omit<ReferenceDeal, "id" | "statusGroup">): ReferenceDeal {
  const id = `${input.contact}-${input.type}-${input.contract}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { id, statusGroup: statusGroup(input.status), ...input };
}

export const REFERENCE_DEALS: ReferenceDeal[] = [
  row({
    contact: "Fatih Aksayli",
    type: "Financing",
    contract: "Malaysia",
    status: "Pricing/Chasing",
    cadence: "Monthly",
    contractValue: usd(70000).value,
    contractCurrency: "USD",
    profit: usd(2000).value,
    profitCurrency: "USD",
    quantity: "50",
    unit: "20DC",
    product: "Oil",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Fatih Aksayli",
    type: "Freight",
    contract: "Sudan-Adana",
    status: "Booked",
    cadence: "One off",
    contractValue: usd(70000).value,
    contractCurrency: "USD",
    profit: null,
    profitCurrency: null,
    quantity: "10",
    unit: "20DC",
    product: "Oil",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Fatih Aksayli",
    type: "Financing",
    contract: "Financing Deal",
    status: "Booked",
    cadence: "Monthly",
    contractValue: usd(70000).value,
    contractCurrency: "USD",
    profit: usd(350).value,
    profitCurrency: "USD",
    quantity: "-",
    unit: "-",
    product: "-",
    origin: "-",
    destination: "-",
    incoterms: "-",
    specs: "-",
    notes: "Yield 0.5% monthly",
  }),
  row({
    contact: "Oguzcan K",
    type: "Freight",
    contract: "(Best of Life) Chemicals",
    status: "Missed (price)",
    cadence: "One off",
    contractValue: usd(1750).value,
    contractCurrency: "USD",
    profit: usd(200).value,
    profitCurrency: "USD",
    quantity: "LCL",
    unit: "3 palets",
    product: "Chemicals",
    origin: "Texas",
    destination: "Ambarli",
    incoterms: "EXW",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Oguzcan K",
    type: "Freight",
    contract: "(Best of Life) Chemicals",
    status: "Pricing/Chasing",
    cadence: "One off",
    contractValue: null,
    contractCurrency: null,
    profit: null,
    profitCurrency: null,
    quantity: "LCL",
    unit: "2 Palets",
    product: "Chemicals",
    origin: "Texas",
    destination: "Korfez/Ambarli",
    incoterms: "EXW",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Oguzcan K",
    type: "Freight",
    contract: "Varna Gumruk",
    status: "Booked",
    cadence: "One off",
    contractValue: usd(1153).value,
    contractCurrency: "USD",
    profit: usd(115).value,
    profitCurrency: "USD",
    quantity: "LCL",
    unit: "9 Palets",
    product: "",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Pinar Hn",
    type: "Supply + Freight",
    contract: "Soybean Meal",
    status: "Pricing/Chasing",
    cadence: "Monthly",
    contractValue: usd(227000).value,
    contractCurrency: "USD",
    profit: usd(15000).value,
    profitCurrency: "USD",
    quantity: "350",
    unit: "TONS",
    product: "",
    origin: "Mersin",
    destination: "Ashgabat",
    incoterms: "DDP",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Oguzcan K",
    type: "Freight",
    contract: "China Spare Parts",
    status: "Speculation",
    cadence: "",
    contractValue: usd(15000).value,
    contractCurrency: "USD",
    profit: usd(1200).value,
    profitCurrency: "USD",
    quantity: "3",
    unit: "20DC",
    product: "",
    origin: "Shanghai",
    destination: "Ambarli",
    incoterms: "FOB",
    specs: "",
    notes: "Quote two ways: Suez and Cape of Good Hope. Train if possible.",
  }),
  row({
    contact: "Oguzcan K",
    type: "Freight",
    contract: "Danimarka",
    status: "Booked",
    cadence: "",
    contractValue: usd(1266).value,
    contractCurrency: "USD",
    profit: usd(115).value,
    profitCurrency: "USD",
    quantity: "",
    unit: "",
    product: "",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Oguzcan K",
    type: "Supply",
    contract: "3 x 20 DC, second hand",
    status: "Pricing/Chasing",
    cadence: "",
    contractValue: tryAmount(55000).value,
    contractCurrency: "TRY",
    profit: null,
    profitCurrency: null,
    quantity: "3",
    unit: "20 DC",
    product: "Container Itself",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Oguzcan K",
    type: "Supply + Freight",
    contract: "Styrofoam Granule Macedonia",
    status: "Speculation",
    cadence: "",
    contractValue: null,
    contractCurrency: null,
    profit: null,
    profitCurrency: null,
    quantity: "3",
    unit: "Truck",
    product: "Styro Granule",
    origin: "",
    destination: "Skopje, NM",
    incoterms: "FCA",
    specs: "F200 = 2 trucks; F300 = 1 truck. Price FCA Skopje.",
    notes: "",
  }),
  row({
    contact: "Pinar Hn",
    type: "Supply + Freight",
    contract: "Metal Processing Machinery",
    status: "Speculation",
    cadence: "One off",
    contractValue: usd(3000000).value,
    contractCurrency: "USD",
    profit: usd(40000).value,
    profitCurrency: "USD",
    quantity: "1",
    unit: "QNTY",
    product: "",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Guild AI - Kaya",
    type: "Freight",
    contract: "Random Defence",
    status: "Speculation",
    cadence: "Monthly",
    contractValue: null,
    contractCurrency: null,
    profit: null,
    profitCurrency: null,
    quantity: "",
    unit: "",
    product: "",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Oguzcan K",
    type: "Freight",
    contract: "Quotation Ex Works Shannon Ireland",
    status: "Speculation",
    cadence: "",
    contractValue: null,
    contractCurrency: null,
    profit: null,
    profitCurrency: null,
    quantity: "",
    unit: "",
    product: "",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Pinar Hn",
    type: "Freight",
    contract: "Karbamid",
    status: "Speculation",
    cadence: "",
    contractValue: null,
    contractCurrency: null,
    profit: null,
    profitCurrency: null,
    quantity: "500",
    unit: "TONS",
    product: "",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Pinar Hn",
    type: "Freight",
    contract: "Jet Fuel",
    status: "Speculation",
    cadence: "",
    contractValue: null,
    contractCurrency: null,
    profit: null,
    profitCurrency: null,
    quantity: "",
    unit: "",
    product: "",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
  row({
    contact: "Tugce Hn (Aluminaks)",
    type: "Freight",
    contract: "Aluminum Products",
    status: "Speculation",
    cadence: "",
    contractValue: null,
    contractCurrency: null,
    profit: null,
    profitCurrency: null,
    quantity: "",
    unit: "",
    product: "",
    origin: "",
    destination: "",
    incoterms: "",
    specs: "",
    notes: "",
  }),
];

function cleanField(value: string | null | undefined) {
  const text = (value ?? "").trim();
  return text && text !== "-" ? text : null;
}

function numericText(value: string) {
  const match = value.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function inferMode(deal: ReferenceDeal) {
  const text = `${deal.quantity} ${deal.unit} ${deal.contract} ${deal.notes}`.toLowerCase();
  if (text.includes("lcl") || text.includes("palet") || text.includes("pallet")) return "SEA-LCL";
  if (/\b(?:20|40)\s*(?:dc|gp|hc|dry)\b/.test(text)) return "SEA-FCL";
  if (text.includes("truck") || text.includes("kamyon")) return "ROAD";
  return null;
}

function inferContainer(deal: ReferenceDeal, mode: string | null) {
  if (mode !== "SEA-FCL") return { containerCount: null, containerType: null };
  const text = `${deal.quantity} ${deal.unit}`.toUpperCase();
  const containerType = text.match(/\b(20\s*DC|20\s*GP|40\s*DC|40\s*GP|40\s*HC|20\s*DRY|40\s*DRY)\b/)?.[1]?.replace(/\s+/g, "") ?? null;
  const containerCount = numericText(deal.quantity) ?? numericText(deal.unit) ?? null;
  return { containerCount, containerType };
}

function inferWeightKg(deal: ReferenceDeal) {
  const quantity = numericText(deal.quantity);
  const unit = deal.unit.toLowerCase();
  if (quantity == null) return null;
  if (unit.includes("ton")) return quantity * 1000;
  if (unit === "kg" || unit.includes("kilogram")) return quantity;
  return null;
}

export function getReferenceDealById(id: string) {
  return REFERENCE_DEALS.find((deal) => deal.id === id) ?? null;
}

export function referenceDealToRfqDraft(deal: ReferenceDeal): ReferenceDealRfqDraft {
  const mode = inferMode(deal);
  const container = inferContainer(deal, mode);
  const economics = [
    deal.contractValue != null ? `Contract value: ${deal.contractCurrency ?? ""} ${deal.contractValue}`.trim() : null,
    deal.profit != null ? `Expected profit: ${deal.profitCurrency ?? ""} ${deal.profit}`.trim() : null,
  ].filter(Boolean).join("\n");
  const sourceLines = [
    `Control sheet row: ${deal.contract}`,
    `Contact: ${deal.contact}`,
    `Type: ${deal.type}`,
    `Status: ${deal.status}`,
    `Cadence: ${deal.cadence || "unknown"}`,
    `Quantity: ${[deal.quantity, deal.unit].filter(Boolean).join(" ") || "unknown"}`,
    `Product: ${cleanField(deal.product) ?? "unknown"}`,
    `Origin: ${cleanField(deal.origin) ?? "unknown"}`,
    `Destination: ${cleanField(deal.destination) ?? "unknown"}`,
    `Incoterms: ${cleanField(deal.incoterms) ?? "unknown"}`,
    economics || null,
    cleanField(deal.specs) ? `Specs: ${deal.specs}` : null,
    cleanField(deal.notes) ? `Notes: ${deal.notes}` : null,
  ].filter((line): line is string => Boolean(line));

  return {
    sourceKey: `reference-deal:${deal.id}`,
    subject: `Sheet lead - ${deal.contract}`,
    fromCompany: deal.contact,
    type: deal.type === "Supply" ? "SOURCING" : "FORWARDING",
    origin: cleanField(deal.origin),
    destination: cleanField(deal.destination),
    mode,
    containerCount: container.containerCount,
    containerType: container.containerType,
    commodity: cleanField(deal.product) ?? cleanField(deal.contract),
    weight: inferWeightKg(deal),
    incoterms: cleanField(deal.incoterms),
    targetPriceStatus: "UNKNOWN",
    notes: [
      "Imported from pasted control sheet snapshot.",
      "Do not treat sheet contract value as target price until confirmed by the customer.",
      economics || null,
      cleanField(deal.specs) ? `Specs: ${deal.specs}` : null,
      cleanField(deal.notes) ? `Notes: ${deal.notes}` : null,
    ].filter((line): line is string => Boolean(line)).join("\n"),
    rawEmailBody: sourceLines.join("\n"),
  };
}

export function dealMissingFields(deal: ReferenceDeal) {
  const missing: string[] = [];
  const freightLike = deal.type === "Freight" || deal.type === "Supply + Freight";
  if (!deal.contact) missing.push("contact");
  if (!deal.contract) missing.push("contract");
  if (deal.contractValue == null) missing.push("contract value");
  if (deal.profit == null) missing.push("profit");
  if (freightLike) {
    if (!deal.origin || deal.origin === "-") missing.push("origin");
    if (!deal.destination || deal.destination === "-") missing.push("destination");
    if (!deal.incoterms || deal.incoterms === "-") missing.push("incoterms");
    if (!deal.product || deal.product === "-") missing.push("product");
  }
  return missing;
}

function dealValueLabel(deal: ReferenceDeal) {
  if (deal.contractCurrency === "USD" && deal.contractValue != null) return `$${Math.round(deal.contractValue).toLocaleString()}`;
  if (deal.contractCurrency === "TRY" && deal.contractValue != null) return `TRY ${Math.round(deal.contractValue).toLocaleString()}`;
  return "value unknown";
}

function dealProfitLabel(deal: ReferenceDeal) {
  if (deal.profitCurrency === "USD" && deal.profit != null) return `$${Math.round(deal.profit).toLocaleString()} profit`;
  if (deal.profit != null) return `${deal.profitCurrency ?? ""} ${Math.round(deal.profit).toLocaleString()} profit`.trim();
  return "profit unknown";
}

function economicsPosture(deal: ReferenceDeal) {
  if (deal.profitCurrency === "USD" && (deal.profit ?? 0) >= 10_000) {
    return `${dealProfitLabel(deal)} makes this worth fast qualification; still not a customer target price.`;
  }
  if (deal.contractCurrency === "USD" && (deal.contractValue ?? 0) >= 100_000) {
    return `${dealValueLabel(deal)} is serious contract context; confirm margin and target before quoting.`;
  }
  if (deal.profit != null || deal.contractValue != null) {
    return `${dealValueLabel(deal)} / ${dealProfitLabel(deal)} is context only, not quote authority.`;
  }
  return "Economics are missing, so ranking depends on demand quality and RFQ proof.";
}

function ownerForMissing(field: string | null | undefined): ReferenceDealDecisionPlan["owner"] {
  const normalized = (field ?? "").toLowerCase();
  if (normalized === "profit" || normalized === "contract value") return "INTERNAL";
  if (normalized) return "CUSTOMER";
  return "OPERATOR";
}

export function referenceDealDecisionPlan(deal: ReferenceDeal, missingFields = dealMissingFields(deal)): ReferenceDealDecisionPlan {
  const baseGaps = [
    ...missingFields,
    ...(deal.type === "Freight" || deal.type === "Supply + Freight" ? ["target price or no-target confirmation", "dangerous goods", "customs responsibility"] : []),
  ];
  const evidenceGaps = [...new Set(baseGaps)].slice(0, 6);
  const economics = economicsPosture(deal);

  if (deal.statusGroup === "MISSED") {
    return {
      stage: "LOSS_REVIEW",
      stageLabel: "Loss evidence",
      owner: "INTERNAL",
      command: "Use this row as loss evidence for price learning; only reopen it if the customer brings it back.",
      stopRule: "Do not create a fresh RFQ or chase a missed row without a new customer signal.",
      actionLabel: "Review loss",
      canCreateRfq: false,
      proofStatus: "info",
      economicsPosture: economics,
      evidenceGaps,
    };
  }

  if (deal.type === "Financing") {
    return {
      stage: "NON_RFQ",
      stageLabel: "Non-RFQ deal",
      owner: "INTERNAL",
      command: "Track this as commercial context, not a freight RFQ. Keep it out of forwarder/pricing automation.",
      stopRule: "Do not send financing rows into the freight RFQ workflow.",
      actionLabel: "Review context",
      canCreateRfq: false,
      proofStatus: "review",
      economicsPosture: economics,
      evidenceGaps,
    };
  }

  if (deal.statusGroup === "BOOKED") {
    return {
      stage: "MARGIN_PROOF",
      stageLabel: "Booked proof",
      owner: "INTERNAL",
      command: "Use this row for margin proof and customer history before spending new pricing time.",
      stopRule: "Do not create duplicate RFQs from booked work unless this is a genuinely new shipment.",
      actionLabel: "Review proof",
      canCreateRfq: false,
      proofStatus: missingFields.length ? "review" : "ready",
      economicsPosture: economics,
      evidenceGaps,
    };
  }

  if (missingFields.length > 0) {
    const firstMissing = missingFields[0];
    return {
      stage: "QUALIFY_LEAD",
      stageLabel: "Qualify first",
      owner: ownerForMissing(firstMissing),
      command: `Clear ${firstMissing} first, then create the RFQ with target/no-target, DG, and customs explicitly marked.`,
      stopRule: "Do not forward or quote this row until the missing lane/cargo facts and target posture are explicit.",
      actionLabel: "Create RFQ from lead",
      canCreateRfq: true,
      proofStatus: "blocked",
      economicsPosture: economics,
      evidenceGaps,
    };
  }

  if (deal.statusGroup === "SPECULATION") {
    return {
      stage: "VERIFY_DEMAND",
      stageLabel: "Verify demand",
      owner: "CUSTOMER",
      command: "Confirm this is real demand, then create the RFQ and ask for target/no-target before pricing.",
      stopRule: "Do not spend forwarder attention until the customer confirms this is live demand.",
      actionLabel: "Create RFQ from lead",
      canCreateRfq: true,
      proofStatus: "review",
      economicsPosture: economics,
      evidenceGaps,
    };
  }

  return {
    stage: "PRICE_LEAD",
    stageLabel: "Price lead",
    owner: "OPERATOR",
    command: "Create the RFQ, preserve sheet economics as context, then request rates only after maturity clears.",
    stopRule: "Do not treat sheet contract value as target price; get target/no-target confirmation before customer quote.",
    actionLabel: "Create RFQ from lead",
    canCreateRfq: true,
    proofStatus: "ready",
    economicsPosture: economics,
    evidenceGaps,
  };
}

export function dealScore(deal: ReferenceDeal) {
  let score = 0;
  if (deal.statusGroup === "PRICING") score += 32;
  if (deal.statusGroup === "BOOKED") score += 24;
  if (deal.statusGroup === "SPECULATION") score += 14;
  if (deal.statusGroup === "MISSED") score -= 18;
  if (deal.cadence === "Monthly") score += 20;
  if (deal.contractValue != null && deal.contractCurrency === "USD") score += Math.min(24, Math.log10(Math.max(deal.contractValue, 1)) * 5);
  if (deal.profit != null && deal.profitCurrency === "USD") score += Math.min(24, Math.log10(Math.max(deal.profit, 1)) * 6);
  score -= dealMissingFields(deal).length * 4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function getReferenceDealSummary(deals: ReferenceDeal[] = REFERENCE_DEALS): ReferenceDealSummary {
  const byStatus: Record<ReferenceDealStatus, number> = {
    BOOKED: 0,
    PRICING: 0,
    SPECULATION: 0,
    MISSED: 0,
  };
  const typeMap = new Map<ReferenceDeal["type"], { type: ReferenceDeal["type"]; count: number; knownProfitUsd: number }>();
  const contactMap = new Map<string, { contact: string; count: number; knownProfitUsd: number }>();
  let knownContractUsd = 0;
  let knownProfitUsd = 0;
  let monthlyRows = 0;
  let incompleteFreightRows = 0;
  let missingProfitRows = 0;
  let missingOriginDestinationRows = 0;

  for (const deal of deals) {
    byStatus[deal.statusGroup] += 1;
    if (deal.cadence === "Monthly") monthlyRows += 1;
    if (deal.contractCurrency === "USD" && deal.contractValue != null) knownContractUsd += deal.contractValue;
    if (deal.profitCurrency === "USD" && deal.profit != null) knownProfitUsd += deal.profit;
    if (deal.profit == null) missingProfitRows += 1;
    if ((deal.type === "Freight" || deal.type === "Supply + Freight") && (!deal.origin || !deal.destination)) {
      missingOriginDestinationRows += 1;
    }
    const missing = dealMissingFields(deal);
    if ((deal.type === "Freight" || deal.type === "Supply + Freight") && missing.length > 0) {
      incompleteFreightRows += 1;
    }

    const type = typeMap.get(deal.type) ?? { type: deal.type, count: 0, knownProfitUsd: 0 };
    type.count += 1;
    if (deal.profitCurrency === "USD" && deal.profit != null) type.knownProfitUsd += deal.profit;
    typeMap.set(deal.type, type);

    const contact = contactMap.get(deal.contact) ?? { contact: deal.contact, count: 0, knownProfitUsd: 0 };
    contact.count += 1;
    if (deal.profitCurrency === "USD" && deal.profit != null) contact.knownProfitUsd += deal.profit;
    contactMap.set(deal.contact, contact);
  }

  return {
    totalRows: deals.length,
    activeRows: deals.filter((d) => d.statusGroup !== "MISSED").length,
    monthlyRows,
    knownContractUsd,
    knownProfitUsd,
    byStatus,
    byType: [...typeMap.values()].sort((a, b) => b.knownProfitUsd - a.knownProfitUsd),
    byContact: [...contactMap.values()].sort((a, b) => b.knownProfitUsd - a.knownProfitUsd),
    topDeals: deals
      .map((deal) => ({ ...deal, score: dealScore(deal), missingFields: dealMissingFields(deal) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6),
    hygiene: {
      incompleteFreightRows,
      missingProfitRows,
      missingOriginDestinationRows,
    },
  };
}

export function referenceDealNextAction(deal: ReferenceDeal, missingFields = dealMissingFields(deal)) {
  return referenceDealDecisionPlan(deal, missingFields).command;
}

export function getReferenceDealDecisions(deals: ReferenceDeal[] = REFERENCE_DEALS, limit = 6): ReferenceDealDecision[] {
  return deals
    .map((deal) => {
      const missingFields = dealMissingFields(deal);
      const decision = referenceDealDecisionPlan(deal, missingFields);
      const score = Math.max(0, Math.min(100, dealScore(deal)
        + (missingFields.length > 0 && decision.canCreateRfq ? 10 : 0)
        + (decision.stage === "PRICE_LEAD" ? 8 : 0)
        + (decision.stage === "QUALIFY_LEAD" ? 4 : 0)
        - (!decision.canCreateRfq ? 18 : 0)));
      const value = dealValueLabel(deal);
      const profit = dealProfitLabel(deal);
      const action = referenceDealNextAction(deal, missingFields);
      const valueTone = deal.contractCurrency === "USD" && (deal.contractValue ?? 0) >= 100_000
        ? "strong" as const
        : deal.contractValue != null ? "watch" as const : "weak" as const;
      const profitTone = deal.profitCurrency === "USD" && (deal.profit ?? 0) >= 2_500
        ? "strong" as const
        : deal.profit != null ? "watch" as const : "weak" as const;
      const priorityFactors: ReferenceDealDecision["priorityFactors"] = [
        { label: "Value", value, tone: valueTone },
        { label: "Profit", value: profit, tone: profitTone },
        {
          label: "Status",
          value: deal.cadence === "Monthly" ? `${deal.statusGroup.toLowerCase()} monthly` : deal.statusGroup.toLowerCase(),
          tone: deal.statusGroup === "PRICING" || deal.cadence === "Monthly" ? "strong" : deal.statusGroup === "SPECULATION" ? "watch" : "weak",
        },
        {
          label: "Missing",
          value: missingFields.length > 0 ? `${missingFields.length}` : "none",
          tone: missingFields.length > 0 ? "weak" : "strong",
        },
        {
          label: "Decision",
          value: decision.stageLabel,
          tone: decision.proofStatus === "ready" ? "strong" : decision.proofStatus === "blocked" ? "weak" : "watch",
        },
      ];
      return {
        key: `reference-deal-${deal.id}`,
        tone: score >= 82 ? "critical" as const : score >= 64 ? "high" as const : "normal" as const,
        title: decision.stage === "PRICE_LEAD"
          ? `Price sheet lead: ${deal.contract}`
          : decision.stage === "VERIFY_DEMAND"
            ? `Verify sheet lead: ${deal.contract}`
            : decision.stage === "MARGIN_PROOF"
              ? `Review booked proof: ${deal.contract}`
              : decision.stage === "NON_RFQ"
                ? `Review non-RFQ row: ${deal.contract}`
                : decision.stage === "LOSS_REVIEW"
                  ? `Review lost row: ${deal.contract}`
                  : `Qualify sheet lead: ${deal.contract}`,
        meta: `${deal.contact} · ${deal.type} · ${value} · ${profit}${missingFields.length ? ` · missing ${missingFields.slice(0, 3).join(", ")}` : ""}`,
        actionLabel: decision.actionLabel,
        score,
        dealId: deal.id,
        contact: deal.contact,
        missingFields,
        nextAction: action,
        priorityFactors,
        decision,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function buildReferenceDealOperatorPlaybook(
  decisions: ReferenceDealDecision[] = getReferenceDealDecisions(undefined, 6),
  summary: ReferenceDealSummary = getReferenceDealSummary(),
): ReferenceDealOperatorPlaybook {
  const top = decisions[0] ?? null;
  const allDecisions = getReferenceDealDecisions(REFERENCE_DEALS, REFERENCE_DEALS.length);
  const decisionCounts = allDecisions.reduce<ReferenceDealOperatorPlaybook["decisionCounts"]>((acc, item) => {
    if (item.decision.canCreateRfq) acc.rfqCandidates += 1;
    if (item.decision.stage === "QUALIFY_LEAD") acc.blockedForFacts += 1;
    if (item.decision.stage === "NON_RFQ") acc.nonRfqContext += 1;
    if (item.decision.stage === "MARGIN_PROOF") acc.bookedProof += 1;
    if (item.decision.stage === "LOSS_REVIEW") acc.lossEvidence += 1;
    return acc;
  }, {
    rfqCandidates: 0,
    blockedForFacts: 0,
    nonRfqContext: 0,
    bookedProof: 0,
    lossEvidence: 0,
  });

  return {
    headline: top
      ? `${top.decision.stageLabel}: ${top.title}`
      : "No sheet lead decision available",
    firstMove: top?.decision.command ?? "Inspect the control sheet before creating any RFQ.",
    safetyRule: top?.decision.stopRule ?? "Do not create freight RFQs from sheet rows without an explicit row decision.",
    visualTarget: "reference-deal-top",
    reviewHref: "/dashboard#reference-deals",
    topDecision: top ? {
      dealId: top.dealId,
      title: top.title,
      actionLabel: top.actionLabel,
      stageLabel: top.decision.stageLabel,
      owner: top.decision.owner,
      canCreateRfq: top.decision.canCreateRfq,
      evidenceGaps: top.decision.evidenceGaps,
    } : null,
    decisionCounts,
    answerRules: [
      `Lead board has ${summary.activeRows} active rows and ${summary.knownProfitUsd.toLocaleString()} USD known profit context.`,
      "Use the row decision stage before mentioning score.",
      "Say non-RFQ, booked proof, and loss evidence plainly; do not turn them into freight RFQs.",
      "Sheet contract value and profit are context, not customer target price.",
    ],
  };
}
