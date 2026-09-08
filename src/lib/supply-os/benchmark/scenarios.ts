import type { BenchmarkScenarioSeed } from "./types";

function scenario(value: BenchmarkScenarioSeed) {
  return value;
}

export const COMMERCIAL_STATE_BENCHMARK_SCENARIOS: readonly BenchmarkScenarioSeed[] = [
  scenario({
    id: "payment-terms-progression",
    ordinal: 1,
    family: "Payment terms NET_30 to NET_45 to NET_60",
    officeIndex: 0,
    companyIndex: 0,
    supplierIndexes: [0, 1],
    requestIndex: 0,
    supplierKey: "atlas-fasteners",
    itemKey: "bearing-6204",
    currentState: { paymentTerms: "NET_60", effectiveAt: "2026-06-15T09:00:00.000Z" },
    contradictoryHistory: [
      { paymentTerms: "NET_30", observedAt: "2025-01-10T09:00:00.000Z", status: "SUPERSEDED" },
      { paymentTerms: "NET_45", observedAt: "2025-11-03T09:00:00.000Z", status: "SUPERSEDED" },
    ],
    factTemplates: [
      { key: "supplier.payment_terms.current", value: "NET_60" },
      { key: "supplier.payment_terms.previous", value: ["NET_30", "NET_45"] },
    ],
    evidenceTemplates: [
      { kind: "supply_profile_fact", logicalId: "payment-terms-net60", source: "APP_DB", supportsFactKeys: ["supplier.payment_terms.current"], content: "Current negotiated payment terms are NET_60, effective 2026-06-15." },
      { kind: "supply_profile_fact", logicalId: "payment-terms-net45", source: "APP_DB", supportsFactKeys: ["supplier.payment_terms.previous"], content: "Superseded payment terms were NET_45." },
      { kind: "company_context", logicalId: "payment-terms-approval", source: "COMPANY_BRAIN", supportsFactKeys: ["supplier.payment_terms.current"], content: "Procurement approved NET_60 for the current supplier relationship." },
    ],
    dependencyTemplates: [
      { key: "supplier.profile_facts:{{workspaceId}}:{{supplierKey}}", source: "APP_DB", entityType: "SupplyProfileFact", entityRef: "{{workspaceId}}:{{supplierKey}}", policy: "STRICT", reason: "Current payment terms determine commercial eligibility.", value: { head: "payment-terms-net60", paymentTerms: "NET_60" }, evidenceLogicalIds: ["payment-terms-net60"] },
    ],
    hardNegativeTemplates: [
      { kind: "supply_profile_fact", logicalId: "payment-terms-net45", reason: "The NET_45 fact is genuine but superseded." },
      { kind: "supply_profile_fact", logicalId: "foreign-payment-terms-net30", reason: "This fact belongs to a similarly named supplier in the other office." },
    ],
    promptSubject: "Atlas Fasteners payment terms",
    promptCurrentQuestion: "The current terms are NET_60; NET_30 and NET_45 are superseded history.",
    concurrencyKind: "supplier_fact_head",
  }),
  scenario({
    id: "standard-versus-missed-rush",
    ordinal: 2,
    family: "Normal standard request versus a missed rush request",
    officeIndex: 0,
    companyIndex: 0,
    supplierIndexes: [1, 2],
    requestIndex: 1,
    supplierKey: "meridian-motion",
    itemKey: "servo-drive-a17",
    currentState: { serviceLevel: "STANDARD", neededBy: "2026-10-30", rush: false },
    contradictoryHistory: [
      { serviceLevel: "RUSH", neededBy: "2026-02-02", outcome: "MISSED", status: "CLOSED" },
    ],
    factTemplates: [
      { key: "procurement.request.service_level", value: "STANDARD" },
      { key: "procurement.request.rush", value: false },
    ],
    evidenceTemplates: [
      { kind: "procurement_order", logicalId: "current-standard-order", source: "WORKFLOW_DB", supportsFactKeys: ["procurement.request.service_level", "procurement.request.rush"], content: "Current request is standard service with needed-by 2026-10-30." },
      { kind: "memory_event", logicalId: "closed-missed-rush", source: "COMPANY_BRAIN", supportsFactKeys: [], content: "A separate rush request missed its deadline and was closed." },
    ],
    dependencyTemplates: [
      { key: "procurement.order_request_context:{{customerId}}:{{orderId}}", source: "WORKFLOW_DB", entityType: "ProcurementOrder", entityRef: "{{customerId}}:{{orderId}}", policy: "STRICT", reason: "The requested service level controls sourcing urgency.", value: { serviceLevel: "STANDARD", rush: false, neededBy: "2026-10-30" }, evidenceLogicalIds: ["current-standard-order"] },
    ],
    hardNegativeTemplates: [
      { kind: "memory_event", logicalId: "closed-missed-rush", reason: "This is a closed historical request, not the current request." },
      { kind: "procurement_order", logicalId: "foreign-rush-order", reason: "This rush order belongs to the other office." },
    ],
    promptSubject: "the current standard request",
    promptCurrentQuestion: "It is STANDARD and not rush; the missed rush record is a closed prior request.",
    concurrencyKind: "vendor_quote",
  }),
  scenario({
    id: "quote-after-follow-up",
    ordinal: 3,
    family: "Quote arrives after a follow-up was prepared",
    officeIndex: 0,
    companyIndex: 0,
    supplierIndexes: [2, 3],
    requestIndex: 2,
    supplierKey: "northstar-metals",
    itemKey: "aluminum-6061-plate",
    currentState: { quoteRecorded: true, quoteRevision: "Q-2026-061-R2", savedFollowUpStatus: "STALE", nextAction: "REVIEW_QUOTE" },
    contradictoryHistory: [
      { quoteRecorded: false, savedFollowUpStatus: "READY", occurredAt: "2026-06-20T14:00:00.000Z" },
    ],
    factTemplates: [
      { key: "procurement.vendor.quote_recorded", value: true },
      { key: "procurement.vendor.next_action", value: "REVIEW_QUOTE" },
    ],
    evidenceTemplates: [
      { kind: "procurement_vendor", logicalId: "vendor-quote-r2", source: "WORKFLOW_DB", supportsFactKeys: ["procurement.vendor.quote_recorded", "procurement.vendor.next_action"], content: "Quote Q-2026-061-R2 is recorded for the request vendor." },
      { kind: "procurement_message", logicalId: "quote-arrival-message", source: "EMAIL_LEDGER", supportsFactKeys: ["procurement.vendor.quote_recorded"], content: "Inbound supplier message delivered quote revision R2." },
      { kind: "execution_task", logicalId: "prepared-follow-up", source: "APP_DB", supportsFactKeys: [], content: "A follow-up draft was prepared before the quote arrived." },
    ],
    dependencyTemplates: [
      { key: "procurement.vendor_quote:{{customerId}}:{{orderId}}:{{vendorId}}", source: "WORKFLOW_DB", entityType: "OrderSupplier", entityRef: "{{customerId}}:{{orderId}}:{{vendorId}}", policy: "STRICT", reason: "A recorded quote makes the saved follow-up obsolete.", value: { recorded: true, revision: "Q-2026-061-R2" }, evidenceLogicalIds: ["vendor-quote-r2", "quote-arrival-message"] },
      { key: "procurement.vendor_saved_draft:{{customerId}}:{{orderId}}:{{vendorId}}", source: "APP_DB", entityType: "SupplyExecutionTask", entityRef: "{{orderId}}:{{vendorId}}", policy: "STRICT", reason: "The exact saved draft input must still match.", value: { status: "STALE", inputHash: "follow-up-before-quote" }, evidenceLogicalIds: ["prepared-follow-up"] },
    ],
    hardNegativeTemplates: [
      { kind: "execution_task", logicalId: "prepared-follow-up", reason: "The draft predates the newly recorded quote." },
      { kind: "procurement_vendor", logicalId: "other-vendor-no-quote", reason: "This no-quote state belongs to another vendor on the same request." },
    ],
    promptSubject: "Northstar Metals quote follow-up",
    promptCurrentQuestion: "The quote is now recorded, so review it and do not send the earlier follow-up.",
    concurrencyKind: "vendor_quote",
  }),
  scenario({
    id: "new-inbound-after-draft",
    ordinal: 4,
    family: "New inbound supplier message after a draft",
    officeIndex: 0,
    companyIndex: 0,
    supplierIndexes: [3, 0],
    requestIndex: 3,
    supplierKey: "harbor-industrial",
    itemKey: "valve-ss316",
    currentState: { latestDirection: "INBOUND", latestProviderMessageId: "msg-new-inbound-004", draftStatus: "STALE", nextAction: "REPLAN" },
    contradictoryHistory: [
      { latestDirection: "OUTBOUND", latestProviderMessageId: "msg-draft-basis-004", draftStatus: "READY" },
    ],
    factTemplates: [
      { key: "procurement.vendor.latest_message_id", value: "msg-new-inbound-004" },
      { key: "procurement.vendor.next_action", value: "REPLAN" },
    ],
    evidenceTemplates: [
      { kind: "procurement_message", logicalId: "new-inbound-after-draft", source: "EMAIL_LEDGER", supportsFactKeys: ["procurement.vendor.latest_message_id", "procurement.vendor.next_action"], content: "A newer routed inbound supplier message arrived after draft preparation." },
      { kind: "execution_task", logicalId: "draft-before-inbound", source: "APP_DB", supportsFactKeys: [], content: "This supplier reply draft was based on an older conversation head." },
    ],
    dependencyTemplates: [
      { key: "procurement.vendor_latest_message:{{customerId}}:{{orderId}}:{{vendorId}}", source: "EMAIL_LEDGER", entityType: "ProcurementCommunicationMessage", entityRef: "{{customerId}}:{{orderId}}:{{vendorId}}", policy: "STRICT", reason: "A new inbound message requires replanning before send.", value: { providerMessageId: "msg-new-inbound-004", direction: "INBOUND" }, evidenceLogicalIds: ["new-inbound-after-draft"] },
    ],
    hardNegativeTemplates: [
      { kind: "execution_task", logicalId: "draft-before-inbound", reason: "This draft was prepared against the previous conversation head." },
      { kind: "procurement_message", logicalId: "other-vendor-new-inbound", reason: "This newer message belongs to another request vendor." },
    ],
    promptSubject: "the Harbor Industrial saved reply",
    promptCurrentQuestion: "A newer inbound message exists, so the saved reply is stale and must be replanned.",
    concurrencyKind: "vendor_latest_message",
  }),
  scenario({
    id: "technical-document-reprocessed",
    ordinal: 5,
    family: "Technical document reprocessed with a changed content hash",
    officeIndex: 0,
    companyIndex: 1,
    supplierIndexes: [0, 2],
    requestIndex: 4,
    supplierKey: "atlas-fasteners",
    itemKey: "bolt-m8-a4-80",
    currentState: { documentVersion: 2, contentHash: "{{hash:technical-spec-v2}}", tensileClass: "A4-80", processingState: "READY" },
    contradictoryHistory: [
      { documentVersion: 1, contentHash: "{{hash:technical-spec-v1}}", tensileClass: "A4-70", status: "SUPERSEDED" },
    ],
    factTemplates: [
      { key: "item.technical_spec.tensile_class", value: "A4-80" },
      { key: "item.technical_spec.processing_state", value: "READY" },
    ],
    evidenceTemplates: [
      { kind: "company_context", logicalId: "technical-spec-v2", source: "COMPANY_BRAIN", supportsFactKeys: ["item.technical_spec.tensile_class", "item.technical_spec.processing_state"], content: "Reprocessed technical specification identifies tensile class A4-80." },
      { kind: "knowledge_object", logicalId: "technical-spec-v1", source: "COMPANY_BRAIN", supportsFactKeys: [], content: "Prior processing output identified A4-70 and is superseded." },
    ],
    dependencyTemplates: [
      { key: "company.context_document:{{companyId}}:{{contextId}}", source: "APP_DB", entityType: "CompanyContext", entityRef: "{{contextId}}", policy: "STRICT", reason: "Technical requirements depend on the current processed document hash.", value: { contentHash: "{{hash:technical-spec-v2}}", processingState: "READY" }, evidenceLogicalIds: ["technical-spec-v2"] },
    ],
    hardNegativeTemplates: [
      { kind: "knowledge_object", logicalId: "technical-spec-v1", reason: "The extracted fact belongs to the superseded processing hash." },
      { kind: "company_context", logicalId: "foreign-technical-spec", reason: "The document belongs to another office's similarly named item." },
    ],
    promptSubject: "the reprocessed M8 technical specification",
    promptCurrentQuestion: "Version 2 with its new content hash is current and specifies A4-80.",
    concurrencyKind: "company_context_document",
  }),
  scenario({
    id: "snapshot-v2-supersedes-v1",
    ordinal: 6,
    family: "Published supply snapshot v2 supersedes v1",
    officeIndex: 0,
    companyIndex: 1,
    supplierIndexes: [1, 3],
    requestIndex: 6,
    supplierKey: "meridian-motion",
    itemKey: "motor-3kw-ie4",
    currentState: { snapshotVersion: 2, snapshotId: "{{snapshotId}}", sourceHash: "{{hash:snapshot-v2}}", published: true },
    contradictoryHistory: [
      { snapshotVersion: 1, sourceHash: "{{hash:snapshot-v1}}", published: true, status: "SUPERSEDED" },
    ],
    factTemplates: [
      { key: "workspace.current_snapshot.version", value: 2 },
      { key: "workspace.current_snapshot.published", value: true },
    ],
    evidenceTemplates: [
      { kind: "supply_snapshot", logicalId: "snapshot-v2", source: "APP_DB", supportsFactKeys: ["workspace.current_snapshot.version", "workspace.current_snapshot.published"], content: "Published snapshot v2 is the workspace head." },
      { kind: "supply_snapshot", logicalId: "snapshot-v1", source: "APP_DB", supportsFactKeys: [], content: "Published snapshot v1 was superseded by v2." },
    ],
    dependencyTemplates: [
      { key: "workspace.current_snapshot:{{workspaceId}}", source: "APP_DB", entityType: "SupplySnapshot", entityRef: "{{workspaceId}}", policy: "STRICT", reason: "Planning and execution must use the latest published snapshot.", value: { snapshotId: "{{snapshotId}}", sourceHash: "{{hash:snapshot-v2}}" }, evidenceLogicalIds: ["snapshot-v2"] },
    ],
    hardNegativeTemplates: [
      { kind: "supply_snapshot", logicalId: "snapshot-v1", reason: "Snapshot v1 is real but no longer current." },
      { kind: "supply_snapshot", logicalId: "foreign-snapshot-v2", reason: "This v2 snapshot belongs to a workspace in the other office." },
    ],
    promptSubject: "the Meridian workspace snapshot",
    promptCurrentQuestion: "Published snapshot v2 is current; v1 is historical.",
    concurrencyKind: "workspace_snapshot",
  }),
  scenario({
    id: "similar-supplier-names",
    ordinal: 7,
    family: "Similar supplier names remain hard identity negatives",
    officeIndex: 1,
    companyIndex: 6,
    supplierIndexes: [60, 64],
    requestIndex: 24,
    supplierKey: "atlas-fasteners",
    itemKey: "bearing-6204",
    currentState: { supplierName: "Atlas Fasteners LLC", normalizedName: "atlas fasteners llc", domain: "atlas-fasteners.example", identityVerified: true },
    contradictoryHistory: [
      { supplierName: "Atlas Fastener LLC", normalizedName: "atlas fastener llc", domain: "atlas-fastener.example", relation: "DISTINCT_ENTITY" },
    ],
    factTemplates: [
      { key: "supplier.identity.name", value: "Atlas Fasteners LLC" },
      { key: "supplier.identity.domain", value: "atlas-fasteners.example" },
    ],
    evidenceTemplates: [
      { kind: "supply_profile_fact", logicalId: "atlas-fasteners-verified-domain", source: "APP_DB", supportsFactKeys: ["supplier.identity.name", "supplier.identity.domain"], content: "Verified identity is Atlas Fasteners LLC at atlas-fasteners.example." },
      { kind: "supply_profile_fact", logicalId: "atlas-fastener-distinct-domain", source: "APP_DB", supportsFactKeys: [], content: "Atlas Fastener LLC is a distinct supplier at atlas-fastener.example." },
    ],
    dependencyTemplates: [
      { key: "supplier.profile:{{workspaceId}}:{{supplierKey}}", source: "APP_DB", entityType: "SupplySupplierProfile", entityRef: "{{workspaceId}}:{{supplierKey}}", policy: "STRICT", reason: "Supplier identity cannot be inferred from a similar name.", value: { normalizedName: "atlas fasteners llc", domain: "atlas-fasteners.example" }, evidenceLogicalIds: ["atlas-fasteners-verified-domain"] },
    ],
    hardNegativeTemplates: [
      { kind: "supply_profile_fact", logicalId: "atlas-fastener-distinct-domain", reason: "Singular Fastener is a distinct legal entity and domain." },
      { kind: "supply_profile_fact", logicalId: "foreign-payment-terms-net30", reason: "A same-name record from the other office cannot establish identity." },
    ],
    promptSubject: "Atlas Fasteners LLC identity",
    promptCurrentQuestion: "Use the exact verified domain; Atlas Fastener LLC is a separate supplier.",
    concurrencyKind: "supplier_fact_head",
  }),
  scenario({
    id: "shared-mailbox-ambiguous-cross-office",
    ordinal: 8,
    family: "Shared mailbox routing with ambiguous cross-office mail",
    officeIndex: 1,
    companyIndex: 6,
    supplierIndexes: [61, 62],
    requestIndex: 25,
    supplierKey: "meridian-motion",
    itemKey: "servo-drive-a17",
    currentState: { accountEmail: "{{accountEmail}}", routedProviderMessageId: "msg-routed-office-b-008", routedOffice: "{{officeId}}", ambiguousIncluded: false },
    contradictoryHistory: [
      { providerMessageId: "msg-ambiguous-shared-008", accountEmail: "{{accountEmail}}", routing: "AMBIGUOUS", included: false },
    ],
    factTemplates: [
      { key: "email.routing.account_email", value: "{{accountEmail}}" },
      { key: "email.routing.latest_included_message", value: "msg-routed-office-b-008" },
      { key: "email.routing.ambiguous_included", value: false },
    ],
    evidenceTemplates: [
      { kind: "procurement_message", logicalId: "routed-office-b-message", source: "EMAIL_LEDGER", supportsFactKeys: ["email.routing.account_email", "email.routing.latest_included_message", "email.routing.ambiguous_included"], content: "The shared-mailbox message is explicitly linked to office B, its order, and vendor." },
      { kind: "email_message", logicalId: "ambiguous-shared-message", source: "APP_DB", supportsFactKeys: [], content: "This shared-mailbox message is unrouted and ambiguous." },
      { kind: "procurement_message", logicalId: "routed-office-a-message", source: "EMAIL_LEDGER", supportsFactKeys: [], content: "This message uses the same mailbox but is explicitly routed to office A." },
    ],
    dependencyTemplates: [
      { key: "procurement.vendor_latest_message:{{customerId}}:{{orderId}}:{{vendorId}}", source: "EMAIL_LEDGER", entityType: "ProcurementCommunicationMessage", entityRef: "{{customerId}}:{{orderId}}:{{vendorId}}", policy: "STRICT", reason: "Only explicitly routed request mail can drive supplier action.", value: { providerMessageId: "msg-routed-office-b-008", direction: "INBOUND" }, evidenceLogicalIds: ["routed-office-b-message"] },
    ],
    hardNegativeTemplates: [
      { kind: "email_message", logicalId: "ambiguous-shared-message", reason: "This ambiguous, unrouted mailbox record cannot establish tenant routing." },
      { kind: "procurement_message", logicalId: "routed-office-a-message", reason: "This message is routed to the other office despite using the same mailbox." },
    ],
    promptSubject: "the shared mailbox supplier reply",
    promptCurrentQuestion: "Only msg-routed-office-b-008 is in scope; ambiguous and office A mail are excluded.",
    concurrencyKind: "vendor_latest_message",
  }),
  scenario({
    id: "capability-versus-bom",
    ordinal: 9,
    family: "Supplier capability versus BOM and manufacturing constraints",
    officeIndex: 1,
    companyIndex: 7,
    supplierIndexes: [62, 63],
    requestIndex: 28,
    supplierKey: "northstar-metals",
    itemKey: "aerospace-bracket-17",
    currentState: { cncMilling: true, requiredProcess: "5_AXIS_CNC", requiredFinish: "MIL-A-8625_TYPE_III", exactCapabilityConfirmed: false },
    contradictoryHistory: [
      { capability: "CNC_MILLING", interpretation: "BROAD_MATCH_ONLY", status: "INSUFFICIENT" },
    ],
    factTemplates: [
      { key: "supplier.capability.broad_cnc", value: true },
      { key: "supplier.capability.exact_bom_match", value: false },
    ],
    evidenceTemplates: [
      { kind: "supply_profile_fact", logicalId: "broad-cnc-capability", source: "APP_DB", supportsFactKeys: ["supplier.capability.broad_cnc"], content: "Supplier reports general CNC milling capability." },
      { kind: "supply_snapshot", logicalId: "bom-five-axis-anodize", source: "APP_DB", supportsFactKeys: ["supplier.capability.exact_bom_match"], content: "BOM requires 5-axis machining and MIL-A-8625 Type III finishing." },
      { kind: "supply_evidence", logicalId: "capability-gap", source: "APP_DB", supportsFactKeys: ["supplier.capability.exact_bom_match"], content: "No evidence confirms the exact 5-axis and finish combination." },
    ],
    dependencyTemplates: [
      { key: "supplier.profile_facts:{{workspaceId}}:{{supplierKey}}", source: "APP_DB", entityType: "SupplyProfileFact", entityRef: "{{workspaceId}}:{{supplierKey}}", policy: "STRICT", reason: "The exact manufacturing capability remains unconfirmed.", value: { cncMilling: true, fiveAxisWithFinishConfirmed: false }, evidenceLogicalIds: ["broad-cnc-capability", "capability-gap"] },
      { key: "workspace.snapshot_hash:{{snapshotId}}", source: "APP_DB", entityType: "SupplySnapshot", entityRef: "{{snapshotId}}", policy: "STRICT", reason: "BOM requirements are sealed in the current snapshot.", value: { requiredProcess: "5_AXIS_CNC", requiredFinish: "MIL-A-8625_TYPE_III" }, evidenceLogicalIds: ["bom-five-axis-anodize"] },
    ],
    hardNegativeTemplates: [
      { kind: "supply_profile_fact", logicalId: "broad-cnc-capability", reason: "A broad CNC claim does not prove the exact BOM capability." },
      { kind: "supply_profile_fact", logicalId: "other-supplier-five-axis", reason: "The exact capability belongs to a different supplier." },
    ],
    promptSubject: "Northstar's capability for aerospace bracket 17",
    promptCurrentQuestion: "General CNC capability is known, but the exact 5-axis and finish combination is unconfirmed.",
    concurrencyKind: "supplier_fact_head",
  }),
  scenario({
    id: "inventory-inbound-demand-availability",
    ordinal: 10,
    family: "Inventory plus inbound supply minus demand determines availability",
    officeIndex: 1,
    companyIndex: 7,
    supplierIndexes: [63, 60],
    requestIndex: 29,
    supplierKey: "harbor-industrial",
    itemKey: "pump-seal-kit-44",
    currentState: { onHand: 40, inbound: 50, demand: 120, availableAfterDemand: -30, shortage: 30 },
    contradictoryHistory: [
      { onHand: 100, inbound: 0, demand: 80, availableAfterDemand: 20, status: "SUPERSEDED_SNAPSHOT" },
    ],
    factTemplates: [
      { key: "item.supply.shortage", value: 30 },
      { key: "item.supply.available_after_demand", value: -30 },
    ],
    evidenceTemplates: [
      { kind: "supply_snapshot", logicalId: "inventory-demand-snapshot", source: "APP_DB", supportsFactKeys: ["item.supply.shortage", "item.supply.available_after_demand"], content: "Current snapshot has 40 on hand, 50 inbound, and 120 demand." },
      { kind: "planning_result", logicalId: "shortage-plan", source: "APP_DB", supportsFactKeys: ["item.supply.shortage"], content: "Deterministic planning result calculates a shortage of 30." },
      { kind: "supply_snapshot", logicalId: "old-positive-availability", source: "APP_DB", supportsFactKeys: [], content: "An old snapshot showed positive availability." },
    ],
    dependencyTemplates: [
      { key: "workspace.snapshot_hash:{{snapshotId}}", source: "APP_DB", entityType: "SupplySnapshot", entityRef: "{{snapshotId}}", policy: "STRICT", reason: "Inventory, inbound, and demand are snapshot-owned facts.", value: { onHand: 40, inbound: 50, demand: 120 }, evidenceLogicalIds: ["inventory-demand-snapshot"] },
      { key: "planning.result:{{planningResultId}}", source: "APP_DB", entityType: "SupplyPlanningResult", entityRef: "{{planningResultId}}", policy: "ADVISORY", reason: "The deterministic result explains the shortage calculation.", value: { availableAfterDemand: -30, shortage: 30 }, evidenceLogicalIds: ["shortage-plan"] },
    ],
    hardNegativeTemplates: [
      { kind: "supply_snapshot", logicalId: "old-positive-availability", reason: "The positive balance belongs to a superseded snapshot." },
      { kind: "planning_result", logicalId: "foreign-shortage-plan", reason: "This result belongs to another office's item." },
    ],
    promptSubject: "pump seal kit 44 availability",
    promptCurrentQuestion: "40 on hand plus 50 inbound minus 120 demand leaves a shortage of 30.",
    concurrencyKind: "workspace_snapshot",
  }),
  scenario({
    id: "legal-commercial-escalation",
    ordinal: 11,
    family: "Legal and commercial supplier question requires escalation",
    officeIndex: 1,
    companyIndex: 6,
    supplierIndexes: [60, 62],
    requestIndex: 26,
    supplierKey: "atlas-fasteners",
    itemKey: "bearing-6205-legal-review",
    currentState: { questionType: "LEGAL_COMMERCIAL", approvedAnswerAvailable: false, nextAction: "ESCALATE", autoSendAllowed: false },
    contradictoryHistory: [
      { answerType: "GENERAL_PAYMENT_GUIDANCE", approved: true, applicability: "DIFFERENT_QUESTION" },
    ],
    factTemplates: [
      { key: "procurement.vendor.triage", value: "LEGAL_COMMERCIAL" },
      { key: "procurement.vendor.next_action", value: "ESCALATE" },
    ],
    evidenceTemplates: [
      { kind: "procurement_message", logicalId: "legal-commercial-question", source: "EMAIL_LEDGER", supportsFactKeys: ["procurement.vendor.triage", "procurement.vendor.next_action"], content: "Supplier asks for a binding indemnity and liability position." },
      { kind: "company_context", logicalId: "no-approved-legal-answer", source: "COMPANY_BRAIN", supportsFactKeys: ["procurement.vendor.next_action"], content: "No approved company answer covers this indemnity question." },
      { kind: "knowledge_chunk", logicalId: "generic-payment-guidance", source: "COMPANY_BRAIN", supportsFactKeys: [], content: "General approved payment guidance applies to payment timing only." },
    ],
    dependencyTemplates: [
      { key: "procurement.vendor_triage:{{customerId}}:{{orderId}}:{{vendorId}}", source: "WORKFLOW_DB", entityType: "OrderSupplier", entityRef: "{{customerId}}:{{orderId}}:{{vendorId}}", policy: "STRICT", reason: "Legal and commercial questions retain the existing escalation policy.", value: { result: "LEGAL_COMMERCIAL", action: "ESCALATE" }, evidenceLogicalIds: ["legal-commercial-question", "no-approved-legal-answer"] },
    ],
    hardNegativeTemplates: [
      { kind: "knowledge_chunk", logicalId: "generic-payment-guidance", reason: "Approved payment guidance does not answer a binding indemnity question." },
      { kind: "company_context", logicalId: "foreign-legal-answer", reason: "This legal position belongs to another company and office." },
    ],
    promptSubject: "the supplier indemnity question",
    promptCurrentQuestion: "No approved answer exists, so the required action is escalation and no automatic send.",
    concurrencyKind: "vendor_latest_message",
  }),
  scenario({
    id: "exact-commercial-identifiers",
    ordinal: 12,
    family: "Exact RFQ, PO, SKU, and provider-message lookups",
    officeIndex: 1,
    companyIndex: 6,
    supplierIndexes: [63, 61],
    requestIndex: 27,
    supplierKey: "harbor-industrial",
    itemKey: "sku-px-4400",
    currentState: { rfq: "RFQ-BENCH-0048", purchaseOrder: "PO-BENCH-0092", sku: "SKU-PX-4400", providerMessageId: "provider-msg-exact-012" },
    contradictoryHistory: [
      { rfq: "RFQ-BENCH-004B", purchaseOrder: "PO-BENCH-0029", sku: "SKU-PX-4040", providerMessageId: "provider-msg-exact-021", relation: "LOOKALIKE" },
    ],
    factTemplates: [
      { key: "procurement.identifiers.rfq", value: "RFQ-BENCH-0048" },
      { key: "procurement.identifiers.purchase_order", value: "PO-BENCH-0092" },
      { key: "procurement.identifiers.sku", value: "SKU-PX-4400" },
      { key: "procurement.identifiers.provider_message", value: "provider-msg-exact-012" },
    ],
    evidenceTemplates: [
      { kind: "procurement_order", logicalId: "exact-rfq-order", source: "WORKFLOW_DB", supportsFactKeys: ["procurement.identifiers.rfq", "procurement.identifiers.purchase_order", "procurement.identifiers.sku"], content: "Exact request identifiers are RFQ-BENCH-0048, PO-BENCH-0092, and SKU-PX-4400." },
      { kind: "procurement_message", logicalId: "exact-provider-message", source: "EMAIL_LEDGER", supportsFactKeys: ["procurement.identifiers.provider_message"], content: "Exact provider message identity is provider-msg-exact-012." },
    ],
    dependencyTemplates: [
      { key: "procurement.order:{{customerId}}:{{orderId}}", source: "WORKFLOW_DB", entityType: "ProcurementOrder", entityRef: "{{customerId}}:{{orderId}}", policy: "STRICT", reason: "Exact request identifiers select the authoritative order.", value: { rfq: "RFQ-BENCH-0048", purchaseOrder: "PO-BENCH-0092", sku: "SKU-PX-4400" }, evidenceLogicalIds: ["exact-rfq-order"] },
      { key: "procurement.vendor_latest_message:{{customerId}}:{{orderId}}:{{vendorId}}", source: "EMAIL_LEDGER", entityType: "ProcurementCommunicationMessage", entityRef: "{{customerId}}:{{orderId}}:{{vendorId}}", policy: "STRICT", reason: "Provider message identity must match exactly.", value: { providerMessageId: "provider-msg-exact-012", direction: "INBOUND" }, evidenceLogicalIds: ["exact-provider-message"] },
    ],
    hardNegativeTemplates: [
      { kind: "procurement_order", logicalId: "lookalike-rfq-order", reason: "The lookalike RFQ, PO, and SKU differ by exact characters." },
      { kind: "procurement_message", logicalId: "lookalike-provider-message", reason: "The provider message ID is similar but not exact." },
    ],
    promptSubject: "RFQ-BENCH-0048 exact identifiers",
    promptCurrentQuestion: "Resolve only the exact RFQ, PO, SKU, and provider-message identifiers.",
    concurrencyKind: "vendor_saved_draft",
  }),
] as const;

if (COMMERCIAL_STATE_BENCHMARK_SCENARIOS.length !== 12) {
  throw new Error("The Commercial State V1 benchmark must define exactly 12 scenario families.");
}
