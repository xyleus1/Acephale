import assert from "node:assert/strict";
import { supplyCapabilityRegistry } from "../src/lib/supply-os/capabilities";
import { compileSupplyDsl, SupplyDslError } from "../src/lib/supply-os/dsl";

const validDsl = `
supply-os/v1
context office=office-a workspace=workspace-robot actor=planner-7

evidence erp type=erp_export trust=trusted source="ERP inventory export" observedAt=2026-08-08T12:00:00Z
evidence product_page type=product_page trust=trusted source="Robot manufacturer product page" observedAt=2026-08-08T12:02:00Z
evidence suppliers type=supplier_source trust=trusted source="Reviewed supplier directory" observedAt=2026-08-08T12:05:00Z
evidence quote type=supplier_quote trust=trusted source="Signed component quote Q-42" observedAt=2026-08-08T12:08:00Z
evidence rules type=compliance_source trust=trusted source="FCC rules review" observedAt=2026-08-08T12:10:00Z
evidence carriers type=carrier_source trust=trusted source="Vetted forwarder directory" observedAt=2026-08-08T12:12:00Z
evidence carrier_quote type=carrier_quote trust=trusted source="Forwarder quote F-17" observedAt=2026-08-08T12:15:00Z
evidence tracking type=tracking_event trust=trusted source="Carrier event webhook" observedAt=2026-08-08T12:45:00Z

step erp_snapshot uses=erp.ingest evidence=$evidence.erp dataset=inventory
step product_capture uses=product.scrape evidence=$evidence.product_page targetUrl=https://robot.example/products/amr-240
step product_map uses=product.map after=erp_snapshot,product_capture snapshot=$erp_snapshot.snapshot scrapedProduct=$product_capture.productRecord productKey=AMR-240
step supplier_search uses=supplier.find after=product_map productMap=$product_map.productMap componentItemKey=RADIO-1 market=US evidence=$evidence.suppliers
step supplier_review uses=supplier.assess after=supplier_search supplierSet=$supplier_search.supplierSet quoteEvidence=$evidence.quote
step fcc_review uses=compliance.assess after=product_map productMap=$product_map.productMap destinationCountry=US evidence=$evidence.rules
step options uses=sourcing.compare after=supplier_review,fcc_review supplierAssessment=$supplier_review.supplierAssessment complianceAssessment=$fcc_review.complianceAssessment targetQuantity=24
step shippers uses=shipper.find after=options sourcingScenario=$options.recommendedScenario lane=Shenzhen-to-Austin providerRole=freight_forwarder evidence=$evidence.carriers
step movement uses=logistics.plan after=options,shippers sourcingScenario=$options.recommendedScenario shipperSet=$shippers.shipperSet carrierQuoteEvidence=$evidence.carrier_quote destinationCountry=US
step booking uses=action.execute after=movement plan=$movement.logisticsPlan action=book_shipment
approval booking by=manager-2 role=LOGISTICS_APPROVER at=2026-08-08T12:30:00Z
step shipment_tracking uses=tracking.sync after=booking executionReceipt=$booking.executionReceipt evidence=$evidence.tracking
`;

const compiled = compileSupplyDsl(validDsl);
assert.equal(compiled.context.officeId, "office-a");
assert.equal(compiled.context.workspaceId, "workspace-robot");
assert.equal(compiled.steps.length, 11);
assert.deepEqual(
  compiled.steps.map((step) => step.capability),
  [
    "erp.ingest",
    "product.scrape",
    "product.map",
    "compliance.assess",
    "supplier.find",
    "supplier.assess",
    "sourcing.compare",
    "shipper.find",
    "logistics.plan",
    "action.execute",
    "tracking.sync",
  ],
);
const booking = compiled.steps.find((step) => step.capability === "action.execute");
assert.deepEqual(booking?.evidenceIds, [
  "carrier_quote",
  "carriers",
  "erp",
  "product_page",
  "quote",
  "rules",
  "suppliers",
]);
assert.equal(booking?.approval?.approverId, "manager-2");
assert.equal(booking?.context.officeId, "office-a");
assert.equal(compiled.steps.at(-1)?.capability, "tracking.sync");
assert.ok(compiled.steps.at(-1)?.evidenceIds.includes("tracking"));
assert.match(compiled.planId, /^supply-plan-[0-9a-f]{8}$/);
assert.equal(compileSupplyDsl(validDsl).planId, compiled.planId);

const customsDsl = validDsl
  .replace("plan=$movement.logisticsPlan action=book_shipment", "plan=$movement.customsPlan action=file_customs_entry")
  .replace("role=LOGISTICS_APPROVER", "role=CUSTOMS_APPROVER");
const customsPlan = compileSupplyDsl(customsDsl);
assert.equal(customsPlan.steps.find((step) => step.id === "booking")?.inputs.action, "file_customs_entry");

for (const capability of Object.values(supplyCapabilityRegistry)) {
  assert.ok(capability.inputSchema, `${capability.name} must declare an input schema.`);
  assert.ok(capability.outputSchema, `${capability.name} must declare an output schema.`);
  assert.ok(capability.riskClass, `${capability.name} must declare a risk class.`);
  assert.ok(Array.isArray(capability.requiredEvidence));
  assert.ok(capability.approvalPolicy.kind);
}

function expectDslError(source: string, code: SupplyDslError["code"], phrase: string) {
  assert.throws(
    () => compileSupplyDsl(source),
    (error: unknown) => {
      assert.ok(error instanceof SupplyDslError);
      assert.equal(error.code, code);
      assert.match(error.message, new RegExp(phrase, "i"));
      return true;
    },
  );
}

expectDslError(
  validDsl.replace("uses=product.map", "uses=product.teleport"),
  "UNKNOWN_CAPABILITY",
  "unknown capability",
);

expectDslError(
  validDsl.replace(
    "after=erp_snapshot,product_capture snapshot=$erp_snapshot.snapshot",
    "after=missing,product_capture snapshot=$erp_snapshot.snapshot",
  ),
  "INVALID_DEPENDENCY",
  "unknown step",
);

expectDslError(
  validDsl.replace("snapshot=$erp_snapshot.snapshot", "snapshot=$missing.snapshot"),
  "INVALID_DEPENDENCY",
  "unknown step",
);

expectDslError(
  validDsl.replace(
    "after=erp_snapshot,product_capture snapshot=$erp_snapshot.snapshot",
    "after=movement,product_capture snapshot=$erp_snapshot.snapshot",
  ),
  "INVALID_DEPENDENCY",
  "cycle",
);

expectDslError(
  validDsl.replace(
    "approval booking by=manager-2 role=LOGISTICS_APPROVER at=2026-08-08T12:30:00Z",
    "",
  ),
  "MISSING_APPROVAL",
  "human approval",
);

expectDslError(
  validDsl.replace("type=supplier_source trust=trusted", "type=supplier_source trust=untrusted"),
  "UNTRUSTED_EXECUTION",
  "untrusted evidence",
);

expectDslError(
  validDsl.replace("carrierQuoteEvidence=$evidence.carrier_quote", "carrierQuoteEvidence=$evidence.carriers"),
  "MISSING_EVIDENCE",
  "carrier_quote",
);

expectDslError(
  validDsl.replace("snapshot=$erp_snapshot.snapshot", "snapshot=$erp_snapshot.notAnOutput"),
  "INVALID_INPUT",
  "does not output",
);

console.log("Supply OS DSL and concrete capability registry contract passed.");
