import { z } from "zod";

export const SUPPLY_CAPABILITY_NAMES = [
  "erp.ingest",
  "product.scrape",
  "product.map",
  "supplier.find",
  "supplier.assess",
  "compliance.assess",
  "sourcing.compare",
  "shipper.find",
  "logistics.plan",
  "tracking.sync",
  "action.execute",
] as const;

export type SupplyCapabilityName = (typeof SUPPLY_CAPABILITY_NAMES)[number];

export const SUPPLY_EVIDENCE_KINDS = [
  "erp_export",
  "product_page",
  "supplier_source",
  "supplier_quote",
  "compliance_source",
  "carrier_source",
  "carrier_quote",
  "tracking_event",
] as const;

export type SupplyEvidenceKind = (typeof SUPPLY_EVIDENCE_KINDS)[number];
export type SupplyRiskClass = "READ" | "ANALYSIS" | "DECISION" | "EXECUTION";

export type SupplyApprovalPolicy =
  | { kind: "NONE" }
  | { kind: "HUMAN"; allowedRoles: readonly string[] };

export type SupplyCapabilityDefinition = {
  name: SupplyCapabilityName;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  outputSchema: z.ZodObject<z.ZodRawShape>;
  riskClass: SupplyRiskClass;
  requiredEvidence: readonly SupplyEvidenceKind[];
  approvalPolicy: SupplyApprovalPolicy;
};

const reference = z.string().min(1);
const evidenceReference = z.string().regex(/^\$evidence\.[A-Za-z][A-Za-z0-9_-]*$/);

export const supplyCapabilityRegistry = Object.freeze({
  "erp.ingest": {
    name: "erp.ingest",
    description: "Normalize a named ERP dataset into an immutable Supply OS snapshot.",
    inputSchema: z
      .object({
        evidence: evidenceReference,
        dataset: z.enum([
          "locations",
          "items",
          "bom",
          "inventory",
          "demand",
          "purchase_orders",
          "supplier_terms",
          "compliance_records",
        ]),
      })
      .strict(),
    outputSchema: z
      .object({
        snapshot: z.string().min(1),
        recordCount: z.number().int().nonnegative(),
      })
      .strict(),
    riskClass: "READ",
    requiredEvidence: ["erp_export"],
    approvalPolicy: { kind: "NONE" },
  },
  "product.scrape": {
    name: "product.scrape",
    description: "Extract cited product specifications from an allowed public product page.",
    inputSchema: z
      .object({
        evidence: evidenceReference,
        targetUrl: z.string().url(),
      })
      .strict(),
    outputSchema: z
      .object({
        productRecord: z.string().min(1),
        extractedFieldCount: z.number().int().nonnegative(),
      })
      .strict(),
    riskClass: "READ",
    requiredEvidence: ["product_page"],
    approvalPolicy: { kind: "NONE" },
  },
  "product.map": {
    name: "product.map",
    description: "Resolve ERP items and product specifications into a product and BOM identity graph.",
    inputSchema: z
      .object({
        snapshot: reference,
        scrapedProduct: reference,
        productKey: z.string().min(1),
      })
      .strict(),
    outputSchema: z
      .object({
        productMap: z.string().min(1),
        unresolvedCount: z.number().int().nonnegative(),
      })
      .strict(),
    riskClass: "ANALYSIS",
    requiredEvidence: ["erp_export", "product_page"],
    approvalPolicy: { kind: "NONE" },
  },
  "supplier.find": {
    name: "supplier.find",
    description: "Find candidate suppliers for mapped components using cited supplier sources.",
    inputSchema: z
      .object({
        productMap: reference,
        componentItemKey: z.string().min(1),
        market: z.string().min(2),
        evidence: evidenceReference,
      })
      .strict(),
    outputSchema: z
      .object({
        supplierSet: z.string().min(1),
        candidateCount: z.number().int().nonnegative(),
      })
      .strict(),
    riskClass: "ANALYSIS",
    requiredEvidence: ["erp_export", "product_page", "supplier_source"],
    approvalPolicy: { kind: "NONE" },
  },
  "supplier.assess": {
    name: "supplier.assess",
    description: "Assess supplier fit, commercial terms, capacity, provenance, and quote quality.",
    inputSchema: z
      .object({
        supplierSet: reference,
        quoteEvidence: evidenceReference,
      })
      .strict(),
    outputSchema: z
      .object({
        supplierAssessment: z.string().min(1),
        qualifiedSupplierCount: z.number().int().nonnegative(),
      })
      .strict(),
    riskClass: "ANALYSIS",
    requiredEvidence: ["supplier_source", "supplier_quote"],
    approvalPolicy: { kind: "NONE" },
  },
  "compliance.assess": {
    name: "compliance.assess",
    description: "Assess product compliance, origin, classification, and import risk.",
    inputSchema: z
      .object({
        productMap: reference,
        destinationCountry: z.string().length(2),
        evidence: evidenceReference,
      })
      .strict(),
    outputSchema: z
      .object({
        complianceAssessment: z.string().min(1),
        blockingIssueCount: z.number().int().nonnegative(),
      })
      .strict(),
    riskClass: "ANALYSIS",
    requiredEvidence: ["erp_export", "product_page", "compliance_source"],
    approvalPolicy: { kind: "NONE" },
  },
  "sourcing.compare": {
    name: "sourcing.compare",
    description: "Compare sourcing scenarios against cost, lead-time, supply, and compliance constraints.",
    inputSchema: z
      .object({
        supplierAssessment: reference,
        complianceAssessment: reference,
        targetQuantity: z.string().regex(/^\d+(?:\.\d+)?$/),
      })
      .strict(),
    outputSchema: z
      .object({
        scenarioSet: z.string().min(1),
        recommendedScenario: z.string().min(1),
      })
      .strict(),
    riskClass: "DECISION",
    requiredEvidence: [
      "erp_export",
      "product_page",
      "supplier_source",
      "supplier_quote",
      "compliance_source",
    ],
    approvalPolicy: { kind: "NONE" },
  },
  "shipper.find": {
    name: "shipper.find",
    description: "Find role-qualified logistics provider candidates for a scenario and lane using cited sources.",
    inputSchema: z
      .object({
        sourcingScenario: reference,
        lane: z.string().min(3),
        providerRole: z.enum([
          "truck_carrier",
          "customs_broker",
          "freight_forwarder",
          "ocean_carrier",
          "air_carrier",
          "3pl",
        ]),
        evidence: evidenceReference,
      })
      .strict(),
    outputSchema: z
      .object({
        shipperSet: z.string().min(1),
        candidateCount: z.number().int().nonnegative(),
      })
      .strict(),
    riskClass: "ANALYSIS",
    requiredEvidence: ["carrier_source"],
    approvalPolicy: { kind: "NONE" },
  },
  "logistics.plan": {
    name: "logistics.plan",
    description: "Build the shipment, customs, and landed-cost plan for the selected sourcing scenario.",
    inputSchema: z
      .object({
        sourcingScenario: reference,
        shipperSet: reference,
        carrierQuoteEvidence: evidenceReference,
        destinationCountry: z.string().length(2),
      })
      .strict(),
    outputSchema: z
      .object({
        logisticsPlan: z.string().min(1),
        customsPlan: z.string().min(1),
        landedCostEstimate: z.number().nonnegative(),
      })
      .strict(),
    riskClass: "DECISION",
    requiredEvidence: [
      "erp_export",
      "supplier_quote",
      "compliance_source",
      "carrier_source",
      "carrier_quote",
    ],
    approvalPolicy: { kind: "NONE" },
  },
  "tracking.sync": {
    name: "tracking.sync",
    description: "Normalize cited carrier events against an authorized shipment execution receipt.",
    inputSchema: z
      .object({
        executionReceipt: reference,
        evidence: evidenceReference,
      })
      .strict(),
    outputSchema: z
      .object({
        trackingTimeline: z.string().min(1),
        lastEventAt: z.string().datetime(),
      })
      .strict(),
    riskClass: "READ",
    requiredEvidence: ["carrier_quote", "tracking_event"],
    approvalPolicy: { kind: "NONE" },
  },
  "action.execute": {
    name: "action.execute",
    description: "Authorize a side-effecting procurement, shipment, or customs action from an approved plan.",
    inputSchema: z
      .object({
        plan: reference,
        action: z.enum(["request_quote", "place_order", "book_shipment", "file_customs_entry"]),
      })
      .strict(),
    outputSchema: z
      .object({
        executionReceipt: z.string().min(1),
        status: z.enum(["authorized"]),
      })
      .strict(),
    riskClass: "EXECUTION",
    requiredEvidence: [
      "erp_export",
      "product_page",
      "supplier_quote",
      "compliance_source",
      "carrier_quote",
    ],
    approvalPolicy: {
      kind: "HUMAN",
      allowedRoles: ["PROCUREMENT_APPROVER", "LOGISTICS_APPROVER", "CUSTOMS_APPROVER", "OFFICE_ADMIN"],
    },
  },
} satisfies Record<SupplyCapabilityName, SupplyCapabilityDefinition>);

export type SupplyCapabilityRegistry = typeof supplyCapabilityRegistry;

export function getSupplyCapability(name: string): SupplyCapabilityDefinition | undefined {
  return supplyCapabilityRegistry[name as SupplyCapabilityName];
}

export function getCapabilityOutputFields(definition: SupplyCapabilityDefinition) {
  return Object.keys(definition.outputSchema.shape).sort();
}
